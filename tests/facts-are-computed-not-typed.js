// What this defends against:
//
// Sidebar facts used to be free text, three boxes per fact. That produced three
// separate problems, all of them invisible until someone read the live site:
// every activity phrased the same fact differently, the English and Russian
// versions drifted from the Hebrew as one got edited and the others did not,
// and nothing could be derived from any of it — a price per hour cannot be
// computed from the sentence "360 אירו ל-12 שיעורים".
//
// Facts are numbers and dates now and the sentence is BUILT, once per language.
// This suite pins the arithmetic and the wording, because both are the kind of
// thing that looks fine in code review and is wrong on the page.

const H = require('./_helpers');
const F = require('../netlify/functions/_activity-facts');

const DURATION = { startDate: '2026-09-01', endDate: '2027-06-30', sessionCount: 12, sessionMinutes: 90 };

console.log('\n[price per hour is computed from real numbers]');
// The worked example: 360 € for 12 sessions of 90 minutes. At the 45-minute
// academic hour that is 24 hours, so 15 € an hour.
H.eq(F.academicHours(DURATION), 24, '12 × 90 min is 24 academic hours');
H.eq(F.pricePerHour({ fullPrice: 360 }, DURATION).value, 15, '360 € over 24 hours is 15 €/hour');
H.eq(F.pricePerHour({ fullPrice: 360 }, DURATION).source, 'computed', 'and it reports itself as computed');
H.eq(F.ACADEMIC_MINUTES, 45, 'the academic hour is 45 minutes');

console.log('\n[half the numbers produce no price rather than a wrong one]');
H.eq(F.academicHours({ sessionCount: 12 }), null, 'sessions without a length is not an hour count');
H.eq(F.academicHours({ sessionMinutes: 90 }), null, 'a length without a count is not either');
H.eq(F.pricePerHour({ fullPrice: 360 }, { sessionCount: 12 }), null, 'so no per-hour price is invented');
H.eq(F.pricePerHour({}, DURATION), null, 'and none without a full price');
H.eq(F.pricePerHour({ fullPrice: 0 }, DURATION), null, 'a zero price is not divided by anything');

console.log('\n[an override wins, and says so]');
const over = F.pricePerHour({ fullPrice: 360, perHourOverride: 18 }, DURATION);
H.eq(over.value, 18, 'the override is the number used');
H.eq(over.source, 'override', 'and it is labelled as an override, not as a calculation');
H.eq(F.pricePerHour({ perHourOverride: 12 }, {}).value, 12, 'an override needs no duration at all');

console.log('\n[the built sentences]');
const ACT = {
  facts: {
    ages: { min: 6, max: 10 },
    schedule: { frequency: 'weekly', sessions: [{ day: 3, time: '16:30' }] },
    duration: DURATION,
    groupSize: { groups: 2, maxPerGroup: 7 },
    location: { text: { he: 'לימסול', en: 'Limassol', ru: 'Лимасол' } },
    price: { registrationFee: 50, fullPrice: 360 },
    instructionLanguage: { he: 'עברית', en: 'Hebrew', ru: 'Иврит' },
    prerequisites: { he: 'מתחילים', en: 'Beginners', ru: 'Начинающие' }
  }
};
const text = (key, lang) => F.factText(ACT, key, lang);

// Two lines, not a sentence: how many groups, then how big one is. They are
// separate numbers a reader compares, and as one phrase they wrapped mid-clause
// in a 320px column. The Hebrew takes the numeral rather than the feminine word
// form ("2 קבוצות", not "שתי קבוצות") — on its own line it is a data point.
H.eq(text('groupSize', 'he'), '2 קבוצות\nעד 7 תלמידים בקבוצה', 'Hebrew group size is two lines');
H.eq(text('groupSize', 'en'), '2 groups\nup to 7 students per group', 'English group size');
H.eq(text('groupSize', 'ru'), '2 группы\nдо 7 учеников в группе', 'Russian group size');
H.eq(F.formatGroupSize({ groups: 1, maxPerGroup: 7 }, 'he'), 'קבוצה אחת\nעד 7 תלמידים בקבוצה', 'one group is singular');
// With no group count there is nothing to say "per group" about.
H.eq(F.formatGroupSize({ maxPerGroup: 7 }, 'en'), 'Up to 7 students', 'and no group count drops the qualifier');
H.eq(F.formatGroupSize({ maxPerGroup: 7 }, 'he'), 'עד 7 תלמידים', 'no group count, just a cap');
H.eq(F.formatGroupSize({ groups: 5 }, 'ru'), '5 групп', 'Russian takes the right plural for 5');
H.eq(F.formatGroupSize({ groups: 2 }, 'ru'), '2 группы', 'and for 2');

H.eq(text('ages', 'he'), '6-10', 'an age range');
H.eq(F.formatAges({ min: 6 }, 'he'), 'מגיל 6', 'a minimum only');
H.eq(F.formatAges({ max: 10 }, 'en'), 'Up to age 10', 'a maximum only');
H.eq(F.formatAges({}, 'he'), '', 'and nothing at all when neither is set');

H.eq(text('schedule', 'he'), 'ימי רביעי, 16:30', 'a weekly day reads as a plural in Hebrew');
H.eq(text('schedule', 'en'), 'Wednesdays, 16:30', 'and in English');
H.eq(F.formatSchedule({ frequency: 'one-time', sessions: [{ day: 3, time: '16:30' }] }, 'he'),
     'יום רביעי, 16:30', 'a one-off is singular instead');
H.eq(F.formatSchedule({ frequency: 'twice-weekly', sessions: [{ day: 1, time: '17:00' }, { day: 3, time: '16:30' }] }, 'en'),
     'Mondays, 17:00 · Wednesdays, 16:30', 'twice weekly lists both days');

// The date range takes its own line; how often and how long stay together.
H.eq(text('duration', 'he'), 'ספטמבר 2026 – יוני 2027\n12 מפגשים · 90 דקות', 'duration in Hebrew');
H.eq(text('duration', 'en'), 'September 2026 – June 2027\n12 sessions · 90 min', 'duration in English');
H.eq(text('duration', 'ru'), 'сентябрь 2026 – июнь 2027\n12 занятий · 90 мин', 'duration in Russian');
H.eq(F.formatDuration({ sessionCount: 12, sessionMinutes: 90 }, 'en'), '12 sessions · 90 min',
     'with no dates there is no first line and no stray newline');
H.eq(F.formatDuration({ sessionCount: 1 }, 'he'), 'מפגש אחד', 'one session is singular');
H.eq(F.formatDuration({}, 'en'), '', 'an empty duration says nothing');

// Four lines, one number each. They were a single ·-joined sentence, which made
// the registration fee and the course price read as one figure and hid that they
// add up. Nothing here is typed: the fee and the full price are fields, per-lesson
// is fullPrice ÷ academic hours, and the qualifier and the total are derived.
H.eq(text('price', 'he'),
  'דמי הרשמה – 50 €\nעלות לשיעור – 15 €\nעלות לסמסטר: 12 מפגשים של 2 שיעורים – 360 €\nסה״כ לסמסטר – 410 €',
  'price in Hebrew, four lines');
H.eq(text('price', 'en'),
  'Registration fee – 50 €\nCost per lesson – 15 €\nCost per semester: 12 sessions of 2 lessons – 360 €\nTotal for the semester – 410 €',
  'price in English');
H.eq(text('price', 'ru'),
  'Регистрационный взнос – 50 €\nСтоимость урока – 15 €\nСтоимость семестра: 12 занятий по 2 урока – 360 €\nИтого за семестр – 410 €',
  'price in Russian');

// The total is COMPUTED, so it cannot drift from the two numbers above it.
const bumped = { registrationFee: 80, fullPrice: 360 };
H.ok(F.formatPrice(bumped, 'en', { sessionCount: 12, sessionMinutes: 90 }).indexOf('Total for the semester – 440 €') !== -1,
     'change the fee and the total follows');
// And it only appears when there are two numbers to add.
H.ok(F.formatPrice({ fullPrice: 360 }, 'en', {}).indexOf('Total') === -1,
     'a price with nothing to add shows no total repeating the line above it');
// Every line is conditional, so this is the shape for every activity.
H.eq(F.formatPrice({ fullPrice: 360 }, 'en', {}), 'Cost per semester – 360 €',
     'an activity with only a full price renders one line');
H.eq(F.formatPrice({}, 'en', {}), '', 'and one with no price says nothing');
// "N sessions of M lessons" only when a session divides into whole lessons.
H.ok(F.formatPrice({ fullPrice: 360 }, 'en', { sessionCount: 12, sessionMinutes: 60 }).indexOf('of') === -1,
     'a 60-minute session is 1.33 lessons, so the qualifier is dropped rather than printed');

console.log('\n[the sidebar, in order, with empties dropped]');
const rows = F.sidebarRows(ACT, 'he');
H.eq(rows.map((r) => r.key).join(','),
     'ages,schedule,duration,groupSize,instructionLanguage,prerequisites,location,price',
     'the sidebar order is the one the page asks for');
const sparse = F.sidebarRows({ facts: { ages: { min: 6, max: 10 }, price: {} } }, 'he');
H.eq(sparse.length, 1, 'a fact with no values is not rendered as an empty row');

console.log('\n[legacy free text keeps publishing until the fields are filled in]');
// The migration cannot safely parse a sentence, so it keeps it. A record
// half-way through migration must not go blank on the live site.
const half = { facts: { groupSize: { legacyText: { he: 'שתי קבוצות של 7 תלמידים', en: '', ru: '' } } } };
H.eq(F.factText(half, 'groupSize', 'he'), 'שתי קבוצות של 7 תלמידים', 'the old words still show');
H.eq(F.factText(half, 'groupSize', 'en'), 'שתי קבוצות של 7 תלמידים', 'and fall back the same way translations do');
const filled = { facts: { groupSize: { groups: 2, maxPerGroup: 7, legacyText: { he: 'ישן', en: '', ru: '' } } } };
H.eq(F.factText(filled, 'groupSize', 'he'), '2 קבוצות\nעד 7 תלמידים בקבוצה',
     'once the numbers are in, the built value wins over the old text');

console.log('\n[visibility is carried AND enforced]');
// Where an activity happens is two facts now. The general one is public, so a
// family can tell whether it is near them; the exact address is members-only,
// because it is where children will physically be at a known hour.
//
// This used to render members-only facts anyway, which was the honest thing to
// do when Location was the only one: hiding it would have hidden it from
// everyone. Splitting the field removes that trade-off, so the flag is now real.
H.eq(F.visibilityOf({}, 'address'), 'members', 'the exact address defaults to members-only');
H.eq(F.visibilityOf({}, 'location'), 'public', 'the general location is public');
H.eq(F.visibilityOf({}, 'ages'), 'public', 'and so is everything else');
H.eq(F.visibilityOf({ factVisibility: { ages: 'members' } }, 'ages'), 'members', 'an explicit flag is honoured');
H.ok(!F.isPubliclyVisible('members'), 'a members-only fact is NOT publicly visible');
H.ok(F.isPubliclyVisible('public'), 'a public one is');
H.ok(F.sidebarRows(ACT, 'he').some((r) => r.key === 'location'),
     'so the general location is on the page');
// Enforcement means OMISSION. Rendering it and hiding it with CSS would publish
// it: the file is static and anyone can read it.
const withAddress = JSON.parse(JSON.stringify(ACT));
withAddress.facts.address = { text: { he: 'רחוב הרצל 5', en: '5 Herzl St', ru: '' } };
const addrRows = F.sidebarRows(withAddress, 'he');
H.ok(!addrRows.some((r) => r.key === 'address'), 'the exact address is not among the published rows');
H.ok(F.factText(withAddress, 'address', 'he') === 'רחוב הרצל 5',
     'even though the fact itself still reads back, for an authenticated view later');

H.done();
