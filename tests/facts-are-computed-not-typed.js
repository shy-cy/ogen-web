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

// The Hebrew group-size wording is the one the site already used, and Hebrew
// counts groups in the feminine — "שתי קבוצות", never "2 קבוצות".
H.eq(text('groupSize', 'he'), 'שתי קבוצות של עד 7 תלמידים', 'Hebrew group size reads as a sentence');
H.eq(text('groupSize', 'en'), '2 groups of up to 7 students', 'English group size');
H.eq(F.formatGroupSize({ groups: 1, maxPerGroup: 7 }, 'he'), 'קבוצה אחת של עד 7 תלמידים', 'one group is singular');
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

H.eq(text('duration', 'he'), 'ספטמבר 2026 – יוני 2027 · 12 מפגשים · 90 דקות', 'duration in Hebrew');
H.eq(text('duration', 'en'), 'September 2026 – June 2027 · 12 sessions · 90 min', 'duration in English');
H.eq(F.formatDuration({ sessionCount: 1 }, 'he'), 'מפגש אחד', 'one session is singular');
H.eq(F.formatDuration({}, 'en'), '', 'an empty duration says nothing');

H.eq(text('price', 'he'), 'דמי הרשמה 50 € · 360 € לקורס · 15 € לשעה', 'price in Hebrew, per-hour included');
H.eq(text('price', 'en'), '50 € registration fee · 360 € for the course · 15 € per hour', 'price in English');

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
H.eq(F.factText(filled, 'groupSize', 'he'), 'שתי קבוצות של עד 7 תלמידים',
     'once the numbers are in, the built sentence wins over the old text');

console.log('\n[visibility is carried but not yet enforced]');
// Location defaults to members-only. Nothing filters on it, deliberately:
// there is no registration system, so nobody could be a member, and hiding the
// address would hide it from the families who need it.
H.eq(F.visibilityOf({}, 'location'), 'members', 'location defaults to members-only');
H.eq(F.visibilityOf({}, 'ages'), 'public', 'everything else defaults to public');
H.eq(F.visibilityOf({ factVisibility: { ages: 'members' } }, 'ages'), 'members', 'an explicit flag is honoured');
H.ok(F.isPubliclyVisible('members'), 'members-only still renders publicly for now');
H.ok(F.sidebarRows(ACT, 'he').some((r) => r.key === 'location'),
     'so the location is on the page despite its flag');

H.done();
