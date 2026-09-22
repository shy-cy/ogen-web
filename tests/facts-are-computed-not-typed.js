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
// ⚠ MIGRATED, because every record the site reads has been. migrate() moves the
// seven per-group facts onto a group and leaves the price and the grouping
// override on the activity — so a fixture built the old way would be testing a
// shape nothing can produce.
const ACT = require('../netlify/functions/_activity-migrate').migrate({
  facts: {
    ages: { min: 6, max: 10 },
    schedule: { frequency: 'weekly', sessions: [{ day: 3, time: '16:30' }] },
    duration: DURATION,
    groupSize: { groups: 2, maxPerGroup: 7 },
    location: { text: { he: 'לימסול', en: 'Limassol', ru: 'Лимасол' } },
    // showPerLesson opts this fixture in, so the assertions below keep
    // exercising the full four-row shape. Default-off is covered on its own.
    price: { registrationFee: 50, fullPrice: 360, showPerLesson: true },
    // Structured now, not three boxes of free text: the last two facts to be
    // converted. A code and a level, rendered per language, with the free text
    // kept as an optional extra line.
    instructionLanguage: { codes: ['he'], text: { he: '', en: '', ru: '' } },
    prerequisites: { level: 'beginner', text: { he: '', en: '', ru: '' } }
  }
});
const text = (key, lang) => F.factText(ACT, key, lang);

// ⚠ THE GROUPING SENTENCE IS READ OFF THE GROUP LIST, not off two numbers kept
// beside it. `groups` and `maxPerGroup` are gone: a count is the length of
// activity.groups and a size is a field on one of its entries, so the sentence
// and the capacity check can no longer disagree about the same activity.
//
// One group prints no count, because one group is not a grouping and "1 group /
// up to 7" says the same thing twice with the first half saying nothing.
const sized = (caps) => ({ groups: caps.map((c, i) => ({ groupId: 'g' + i, capacity: c })) });
H.eq(F.formatGroupSize(sized([7]), 'he'), 'עד 7 תלמידים', 'one group is just its size');
H.eq(F.formatGroupSize(sized([7]), 'en'), 'Up to 7 students', 'in English too');
H.eq(F.formatGroupSize(sized([7]), 'ru'), 'до 7 учеников', 'and in Russian');
H.eq(F.formatGroupSize(sized([null]), 'en'), '', 'and a group with no capacity says nothing at all');
// Two groups name themselves, because now there is a choice to describe.
const named2 = { groups: [
  { groupId: 'g1', name: { he: 'מתחילים', en: 'Beginners', ru: 'Начинающие' }, capacity: 7 },
  { groupId: 'g2', name: { he: 'מתקדמים', en: 'Advanced', ru: 'Продолжающие' }, capacity: 10 }
] };
H.eq(F.formatGroupSize(named2, 'en'), 'Beginners, up to 7 students\nAdvanced, up to 10 students',
     'two groups are a line each, named, because a family picks by the name');
H.eq(F.formatGroupSize(named2, 'he'), 'מתחילים, עד 7 תלמידים\nמתקדמים, עד 10 תלמידים', 'in Hebrew');
H.eq(F.formatGroupSize(named2, 'ru'), 'Начинающие, до 7 учеников\nПродолжающие, до 10 учеников',
     'and Russian takes the right plural');

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

// The date range takes its own line; how often and how long stay together. The
// two months are joined with a PLAIN HYPHEN — an en dash renders unpredictably
// beside Hebrew numerals, and the age range has always used a hyphen anyway.
H.eq(text('duration', 'he'), 'ספטמבר 2026 - יוני 2027\n12 מפגשים · 90 דקות', 'duration in Hebrew');
H.eq(text('duration', 'en'), 'September 2026 - June 2027\n12 sessions · 90 min', 'duration in English');
H.eq(text('duration', 'ru'), 'сентябрь 2026 - июнь 2027\n12 занятий · 90 мин', 'duration in Russian');
H.eq(F.formatDuration({ sessionCount: 12, sessionMinutes: 90 }, 'en'), '12 sessions · 90 min',
     'with no dates there is no first line and no stray newline');
H.eq(F.formatDuration({ sessionCount: 1 }, 'he'), 'מפגש אחד', 'one session is singular');
H.eq(F.formatDuration({}, 'en'), '', 'an empty duration says nothing');

// NO EN OR EM DASH ANYWHERE IN A GENERATED FACT. This is the assertion, not the
// three above it: those pin three strings, and a fourth formatter could
// reintroduce one without any of them noticing. Facts are built here, so the
// character can only enter here.
F.FACT_ORDER.forEach((key) => {
  ['he', 'en', 'ru'].forEach((lang) => {
    const value = F.factText(ACT, key, lang);
    H.ok(!/[\u2013\u2014]/.test(value), 'no dash in ' + key + '/' + lang + (value ? '' : ' (empty)'));
  });
});

// ONE NUMBER PER ROW. They were a single ·-joined sentence, which made the
// registration fee and the course price read as one figure. Rows rather than
// lines because the price is its own card now: a card headed "Price" whose one
// fact is also labelled "Price" says it twice.
//
// Nothing here is typed: the fee and the full price are fields, per-lesson is
// fullPrice ÷ academic hours, and the qualifier is derived.
const D12 = { sessionCount: 12, sessionMinutes: 90 };
H.eq(JSON.stringify(F.priceRows(ACT.facts.price, 'he', D12)),
  JSON.stringify([
    { key: 'fee', label: 'דמי הרשמה', note: '', value: '50 €' },
    { key: 'lesson', label: 'עלות לשיעור', note: '', value: '15 €' },
    { key: 'term', label: 'עלות לסמסטר', note: '(12 מפגשים × 2 שיעורים)', value: '360 €' }
  ]), 'price in Hebrew, three rows');
H.eq(JSON.stringify(F.priceRows(ACT.facts.price, 'en', D12)),
  JSON.stringify([
    { key: 'fee', label: 'Registration fee', note: '', value: '50 €' },
    { key: 'lesson', label: 'Cost per lesson', note: '', value: '15 €' },
    { key: 'term', label: 'Cost per semester', note: '(12 sessions × 2 lessons)', value: '360 €' }
  ]), 'price in English');
H.eq(JSON.stringify(F.priceRows(ACT.facts.price, 'ru', D12)),
  JSON.stringify([
    { key: 'fee', label: 'Регистрационный взнос', note: '', value: '50 €' },
    { key: 'lesson', label: 'Стоимость урока', note: '', value: '15 €' },
    { key: 'term', label: 'Стоимость семестра', note: '(12 занятий × 2 урока)', value: '360 €' }
  ]), 'price in Russian');

// The qualifier is its OWN field, not glued onto the label. It renders as a
// quiet italic line between the label and the number, so a label that carried it
// would print the parenthesis in bold beside the heading.
['he', 'en', 'ru'].forEach((lang) => {
  const rows = F.priceRows(ACT.facts.price, lang, D12);
  H.ok(rows.filter((r) => r.note).length === 1, lang + ': exactly one row carries a qualifier');
  H.ok(!rows.some((r) => /[()×]/.test(r.label)), lang + ': and no label has it glued on');
});

// The string form is DERIVED from the rows, so a page and a caller with no room
// for rows cannot disagree about the price.
H.eq(text('price', 'en'),
  'Registration fee - 50 €\nCost per lesson - 15 €\n' +
  'Cost per semester (12 sessions × 2 lessons) - 360 €',
  'and the one-string form says the same thing');

// THERE IS NO TOTAL, and this is the assertion that keeps it that way.
//
// The card used to end with "Total for the semester - 410 €", computed from the
// two numbers above it. Computing it was never the problem; adding those two
// numbers at all was. The registration fee is charged once a YEAR and the course
// fee once a SEMESTER, so their sum is a figure nobody is ever billed: a family
// joining in the spring, having paid the fee in the autumn, pays 360. The total
// was right only for a first-semester registration -- which is also the one case
// where the reader can do the addition unaided.
const TOTAL_LABELS = ['Total for the semester', 'סה״כ לסמסטר', 'Итого за семестр'];
['he', 'en', 'ru'].forEach((lang) => {
  const rows = F.priceRows({ registrationFee: 50, fullPrice: 360 }, lang, D12);
  H.eq(rows.length, 2, lang + ': a fee and a semester price are two rows, not three');
  H.ok(!rows.some((r) => TOTAL_LABELS.indexOf(r.label) !== -1),
       lang + ': and neither of them is a total');
  H.ok(!rows.some((r) => r.value === '410 €'),
       lang + ': the sum appears nowhere, under any label');
});
H.ok(F.formatPrice({ registrationFee: 50, fullPrice: 360 }, 'en', D12).indexOf('410') === -1,
     'nor in the one-string form, which is derived from the same rows');
// Every row is conditional, so this is the shape for every activity.
H.eq(JSON.stringify(F.priceRows({ fullPrice: 360 }, 'en', {})),
     JSON.stringify([{ key: 'term', label: 'Cost per semester', note: '', value: '360 €' }]),
     'an activity with only a full price renders one row');
H.eq(JSON.stringify(F.priceRows({}, 'en', {})), '[]', 'and one with no price says nothing');
// The qualifier appears only when a session divides into whole lessons.
H.eq(F.priceRows({ fullPrice: 360 }, 'en', { sessionCount: 12, sessionMinutes: 60 })[0].note, '',
     'a 60-minute session is 1.33 lessons, so the qualifier is dropped rather than printed');

// factPriceRows() is the entry point the template uses, and it takes the whole
// activity so the duration it divides by cannot be passed in wrong.
H.eq(JSON.stringify(F.factPriceRows(ACT, 'en')),
     JSON.stringify(F.priceRows(ACT.facts.price, 'en', ACT.groups[0].facts.duration)),
     'factPriceRows finds the duration itself — off the group, which is where it lives');
H.eq(JSON.stringify(F.factPriceRows({ facts: { price: { legacyText: { en: '50 euro' } } } }, 'en')), '[]',
     'a price that is still free text has no rows, so it renders as an ordinary fact');

console.log('\n[cost per lesson is OFF unless the activity opts in]');
// It was the one row that invited arithmetic rather than answering a question.
// Default off means an absent key is off, so no existing record starts showing
// a row nobody configured, and only an explicit true turns it on.
const OFF = { registrationFee: 50, fullPrice: 360 };
const offRows = F.priceRows(OFF, 'en', D12);
H.eq(offRows.length, 2, 'two rows by default, not three');
H.ok(!offRows.some((r) => r.label === 'Cost per lesson'), 'and cost per lesson is not one of them');
H.eq(offRows.map((r) => r.label).join(' | '),
     'Registration fee | Cost per semester',
     'the other two are untouched, in order');
H.eq(F.priceRows(Object.assign({ showPerLesson: true }, OFF), 'en', D12).length, 3, 'opting in restores it');
H.eq(F.priceRows(Object.assign({ showPerLesson: 'yes' }, OFF), 'en', D12).length, 2,
     'only a real true counts, so a stray string does not switch it on');
H.eq(F.showPerLesson({}), false, 'absent is off');

console.log('\n[the public card prices the activity, never a person]');
// Pricing is public and the page is one static file served to everyone, so it
// cannot know who is reading it. "Already paid this year" is a fact about one
// participant, knowable only after login; a card that tried to reflect it could
// only ever be wrong for somebody. It belongs to the registration flow.
H.eq(F.priceRows.length, 3, 'priceRows takes no per-family argument at all');
H.eq(JSON.stringify(F.priceRows(OFF, 'en', D12, { feeWaived: true })),
     JSON.stringify(F.priceRows(OFF, 'en', D12)),
     'and passing one anyway changes nothing, so it cannot creep back in unnoticed');
['he', 'en', 'ru'].forEach((lang) => {
  const rows = F.priceRows(OFF, lang, D12);
  H.eq(rows.length, 2, lang + ': the standard yearly fee and the semester fee, separately');
  H.ok(rows[0].note === '' && rows[0].value === '50 €',
       lang + ': the yearly fee is shown plainly, with no note qualifying who pays it');
});
// ⚠ THE LABEL NO LONGER CARRIES THE SCOPE, and that was a deliberate reversal.
// It said "Yearly registration fee" on the argument that annual-ness is the one
// thing about the fee a family cannot infer from the number. It still is — but
// a three-word label among two-word ones read as clutter rather than as
// information, and the scope now lands where the question is actually asked:
// the waived line on the family's own cost card, which appears exactly when a
// returning child is NOT being charged it again. The SCOPE itself is unchanged
// and lives in feeApplies() — one participant, one activity, one academic year.
H.eq(F.priceRows(OFF, 'en', D12)[0].label, 'Registration fee', 'the label names the fee, plainly');
H.eq(F.priceRows(OFF, 'he', D12)[0].label, 'דמי הרשמה', 'and the Hebrew does too');
H.eq(F.priceRows(OFF, 'ru', D12)[0].label, 'Регистрационный взнос', 'and the Russian');
['he', 'en', 'ru'].forEach((lang) => {
  H.ok(!/לשנה|Yearly|Годов/.test(F.priceRows(OFF, lang, D12)[0].label),
       lang + ': and none of the three still says "yearly"');
});

console.log('\n[group size takes a free-text override, like price already does]');
// The override started life as ONE string, and that string was published on all
// three pages: an English-speaking admin typing "One mixed-age group" put those
// English words on the Hebrew and Russian pages, where every other sentence in
// the same card was translated. It is words, so it is a { he, en, ru } bag.
const OVERRIDE = { he: 'קבוצה אחת מעורבת', en: 'One mixed-age group', ru: 'Одна смешанная группа' };
const withOverride = (text) => ({ groups: sized([7]).groups, facts: { groupSize: { overrideText: text } } });
H.eq(F.formatGroupSize(withOverride(OVERRIDE), 'en'),
     'One mixed-age group', 'a filled override replaces the computed sentence outright');
H.eq(F.formatGroupSize(withOverride(OVERRIDE), 'he'),
     'קבוצה אחת מעורבת', 'and each language gets its own words, not the first one typed');
H.eq(F.formatGroupSize(withOverride(OVERRIDE), 'ru'),
     'Одна смешанная группа', 'including Russian, which the single-string version could never reach');
H.eq(F.formatGroupSize(withOverride({ he: '   ', en: '', ru: '' }), 'en'),
     F.formatGroupSize(sized([7]), 'en'),
     'whitespace is blank, so it falls through rather than publishing an empty fact');
H.eq(F.formatGroupSize({ facts: { groupSize: { overrideText: OVERRIDE } } }, 'he'), 'קבוצה אחת מעורבת',
     'and it works with no groups at all behind it');

// An override half-translated shows the words that ARE there rather than the
// computed line. Two pages saying the same thing in one language beats two
// pages making different claims about how the activity is grouped.
const HE_ONLY = { he: 'קבוצה אחת מעורבת', en: '', ru: '' };
['he', 'en', 'ru'].forEach((lang) => {
  H.eq(F.formatGroupSize(withOverride(HE_ONLY), lang),
       'קבוצה אחת מעורבת',
       lang + ': an untranslated override still overrides, following the site-wide fallback');
});

// A record written before the field was split still holds a bare string, and
// migrate() is what turns it into a bag. Both halves are pinned: the formatter
// reads a legacy string directly, and the migration puts it where Hebrew is.
H.eq(F.formatGroupSize({ facts: { groupSize: { overrideText: 'קבוצה אחת מעורבת' } } }, 'he'),
     'קבוצה אחת מעורבת',
     'a pre-split single string is still published, so no page blanks mid-migration');
const migratedOverride = require('../netlify/functions/_activity-migrate')
  .migrate({ slug: 'x', facts: { groupSize: { overrideText: 'קבוצה אחת מעורבת' } } })
  .facts.groupSize.overrideText;
H.eq(migratedOverride.he, 'קבוצה אחת מעורבת', 'and migrating it lands the words in Hebrew');
H.eq(migratedOverride.en + migratedOverride.ru, '',
     'never copied into the other two, which would claim a translation that was never made');

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
const filled = { groups: [{ groupId: 'g1', capacity: 7 }],
                 facts: { groupSize: { legacyText: { he: 'ישן', en: '', ru: '' } } } };
H.eq(F.factText(filled, 'groupSize', 'he'), 'עד 7 תלמידים',
     'once a group carries a capacity, the built value wins over the old text');

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
withAddress.groups[0].facts.address = { text: { he: 'רחוב הרצל 5', en: '5 Herzl St', ru: '' } };
const addrRows = F.sidebarRows(withAddress, 'he');
H.ok(!addrRows.some((r) => r.key === 'address'), 'the exact address is not among the published rows');
H.ok(F.factText(withAddress, 'address', 'he') === 'רחוב הרצל 5',
     'even though the fact itself still reads back, for an authenticated view later');

H.done();
