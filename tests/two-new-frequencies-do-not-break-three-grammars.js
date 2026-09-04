// What this defends against:
//
// Adding biweekly and monthly to FREQUENCIES looks like adding two rows to a
// table. It is not, because the grammar of the three languages does not divide
// the same way, and the old formatter had exactly one rule: pick the plural day
// name unless the frequency is one-time. Added without touching it, an
// every-other-Wednesday class publishes "ימי רביעי, 16:00" — "Wednesdays" — which
// asserts a weekly repetition it does not have. It looks completely fine.
//
// Two specific traps, both reviewed:
//
//   - Number is a property of (frequency, LANGUAGE), not of frequency. English
//     and Hebrew take the singular day for biweekly; Russian takes the plural,
//     because "раз в две недели, среда" is not how anyone says it.
//   - Russian ordinals agree in gender with the weekday, and the weekdays use
//     all THREE genders. воскресенье is neuter, so a masculine/feminine pair
//     silently gets Sunday wrong.
//
// Hebrew uses week-based phrasing ("in the second week of the month") rather
// than the literal "second Tuesday", because Hebrew weekday names are themselves
// ordinals and the literal form says the same word twice: יום שני השני.

const H = require('./_helpers');
const F = require('../netlify/functions/_activity-facts');

const SUN = 0, TUE = 2, WED = 3, FRI = 5;
const at = (day, time) => ({ sessions: [{ day: day, time: time }] });
const sched = (spec, lang) => F.formatSchedule(spec, lang);

console.log('[the reviewed wording, exactly]');
const REVIEWED = [
  ['weekly',      'en', { frequency: 'weekly' },                     WED, '16:00', 'Wednesdays, 16:00'],
  ['weekly',      'he', { frequency: 'weekly' },                     WED, '16:00', 'ימי רביעי, 16:00'],
  ['weekly',      'ru', { frequency: 'weekly' },                     WED, '16:00', 'по средам, 16:00'],
  ['biweekly',    'en', { frequency: 'biweekly' },                   WED, '16:00', 'Every other Wednesday, 16:00'],
  ['biweekly',    'he', { frequency: 'biweekly' },                   WED, '16:00', 'אחת לשבועיים, יום רביעי, 16:00'],
  ['biweekly',    'ru', { frequency: 'biweekly' },                   WED, '16:00', 'раз в две недели, по средам, 16:00'],
  ['monthly',     'en', { frequency: 'monthly', weekOfMonth: 2 },    TUE, '17:00', 'Second Tuesday of each month, 17:00'],
  ['monthly',     'he', { frequency: 'monthly', weekOfMonth: 2 },    TUE, '17:00', 'יום שלישי, בשבוע השני של החודש, 17:00'],
  ['monthly',     'ru', { frequency: 'monthly', weekOfMonth: 2 },    TUE, '17:00', 'второй вторник каждого месяца, 17:00'],
  ['one-time',    'en', { frequency: 'one-time' },                   WED, '16:00', 'Wednesday, 16:00'],
  ['one-time',    'he', { frequency: 'one-time' },                   WED, '16:00', 'יום רביעי, 16:00'],
  ['one-time',    'ru', { frequency: 'one-time' },                   WED, '16:00', 'среда, 16:00']
];
REVIEWED.forEach(function (r) {
  H.eq(sched(Object.assign({}, r[2], at(r[3], r[4])), r[1]), r[5], r[1] + ' ' + r[0]);
});

console.log('\n[biweekly takes the singular day, EXCEPT in Russian]');
H.ok(sched({ frequency: 'biweekly', sessions: [{ day: WED }] }, 'en').indexOf('Wednesdays') === -1,
     'English biweekly does not say Wednesdays');
H.ok(sched({ frequency: 'biweekly', sessions: [{ day: WED }] }, 'he').indexOf('ימי רביעי') === -1,
     'nor does Hebrew');
H.ok(sched({ frequency: 'biweekly', sessions: [{ day: WED }] }, 'ru').indexOf('по средам') !== -1,
     'but Russian does, because that is the natural recurring form');

console.log('\n[Russian ordinals agree with the weekday, in all three genders]');
H.eq(sched(Object.assign({ frequency: 'monthly', weekOfMonth: 2 }, at(TUE, '17:00')), 'ru'),
     'второй вторник каждого месяца, 17:00', 'masculine: вторник');
H.eq(sched(Object.assign({ frequency: 'monthly', weekOfMonth: 2 }, at(WED, '17:00')), 'ru'),
     'вторая среда каждого месяца, 17:00', 'feminine: среда');
H.eq(sched(Object.assign({ frequency: 'monthly', weekOfMonth: 2 }, at(SUN, '11:00')), 'ru'),
     'второе воскресенье каждого месяца, 11:00', 'NEUTER: воскресенье, the one a two-gender table loses');
H.eq(sched(Object.assign({ frequency: 'monthly', weekOfMonth: 'last' }, at(FRI, '17:00')), 'ru'),
     'последняя пятница каждого месяца, 17:00', 'and "last" agrees too');
H.eq(F.RU_DAY_GENDER.length, 7, 'every weekday has a gender');
H.eq(F.RU_DAY_GENDER[SUN], 'n', 'Sunday is neuter');

console.log('\n[twice-weekly still joins with a middle dot]');
H.eq(sched({ frequency: 'twice-weekly', sessions: [{ day: WED, time: '16:00' }, { day: SUN, time: '18:00' }] }, 'en'),
     'Wednesdays, 16:00 · Sundays, 18:00', 'both days, plural, one separator');
H.eq(sched({ frequency: 'twice-weekly', sessions: [{ day: WED, time: '16:00' }, { day: SUN, time: '18:00' }] }, 'ru'),
     'по средам, 16:00 · по воскресеньям, 18:00', 'and in Russian');

console.log('\n[no generated schedule string contains an en or em dash]');
// The project already asserts this for every other fact. These strings are new
// surface, so they get held to it the moment they exist rather than later.
['en', 'he', 'ru'].forEach(function (lang) {
  ['one-time', 'weekly', 'biweekly', 'twice-weekly', 'monthly'].forEach(function (freq) {
    [SUN, TUE, WED, FRI].forEach(function (d) {
      [1, 2, 3, 4, 5, 'last'].forEach(function (nth) {
        const out = sched({ frequency: freq, weekOfMonth: nth, sessions: [{ day: d, time: '16:00' }] }, lang);
        H.ok(out.indexOf('–') === -1 && out.indexOf('—') === -1,
             lang + '/' + freq + '/' + d + '/' + nth + ' is dash free');
      });
    });
  });
});

console.log('\n[the session table lists only sessions that happen]');
const cal = [
  { date: '2026-10-14', status: 'scheduled' },
  { date: '2026-10-21', status: 'excluded' },
  { date: '2026-11-25', status: 'scheduled' }
];
const he = F.sessionRows({ sessionDates: cal }, 'he');
H.eq(he.length, 2, 'an excluded date is ABSENT, not rendered as a "no class" row');
H.eq(he[0].label, 'מפגש 1', 'rows are numbered by what happens');
H.eq(he[1].label, 'מפגש 2', 'so the number after an exclusion does not skip');
H.eq(he[0].day + ' · ' + he[0].date, 'יום רביעי · 14 באוקטובר', 'Hebrew prefixes the month with ב');
const ru = F.sessionRows({ sessionDates: cal }, 'ru');
H.eq(ru[1].label + ' · ' + ru[1].day + ' · ' + ru[1].date, 'Занятие 2 · среда · 25 ноября',
     'Russian uses the genitive month inside a date');
const en = F.sessionRows({ sessionDates: cal }, 'en');
H.eq(en[0].label + ' · ' + en[0].day + ' · ' + en[0].date, 'Session 1 · Wednesday · 14 October', 'and English reads plainly');
H.eq(F.sessionRows({ sessionDates: [] }, 'he').length, 0, 'no calendar is no rows rather than a throw');

console.log('\n[the caption says the same thing in three languages, not the same words]');
H.eq(F.SESSION_TABLE.he.caption, 'מועדי המפגשים', 'Hebrew');
H.eq(F.SESSION_TABLE.en.caption, 'Session dates', 'English');
H.eq(F.SESSION_TABLE.ru.caption, 'Расписание занятий',
     'Russian: for a table of dated lessons this is always the form, per review');

H.done();
