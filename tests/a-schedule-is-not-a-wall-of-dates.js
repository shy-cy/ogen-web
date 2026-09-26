// What this defends against:
//
// Reported from the live listing, looking at three cards: "Custom date — we
// cannot show all these dates. In Custom cases, we should provide a tri-lingual
// description like — Wednesdays, Twice a month."
//
// ⚠ AND EVERY PIECE OF IT WAS BEHAVING AS WRITTEN. A custom schedule names its
// dates on purpose — "an activity meeting on four particular days could not name
// them" is the bug that put the date in a schedule row at all, and that case is
// real. formatSchedule() then joins every row with " · ", which is right for
// four and is a wall at twenty-four: intro-into-judaism printed its whole year
// into a 320px card, in the tinted band whose entire job is to be SCANNED. The
// listing card's own rule is that a card saying nothing beats a card that is
// confidently wrong, and this was neither — it was a card nobody could read.
//
// Two halves, and the second is why the first is not enough:
//
//   1. PAST FOUR DATED ROWS THE LINE IS DESCRIBED RATHER THAN LISTED. ⚠ And it
//      claims a weekday only when EVERY session shares one: twenty-three
//      Wednesdays and one Thursday is not "Wednesdays and Thursdays", which a
//      reader takes as twice a week. What is left is the count, which is true of
//      any list of dates.
//   2. ⚠ A TRILINGUAL OVERRIDE, because "twice a month" is a judgement about a
//      pattern and nothing derivable from a list of dates can say it without
//      guessing. Word for word the argument groupSize.overrideText is built on.
//
// Three ways this could go quietly wrong, and all three have bitten this file
// before:
//
//   - a key missing from SHAPES.schedule is DELETED on the next save. `date`
//     and `sessionDates` both learned that the hard way.
//   - the client rebuilds facts.schedule from scratch on every commit, so a
//     field not read back there is an input an admin types into and a save drops.
//   - the words are words, so a Russian-only role must reach them — and must
//     still not be able to change which day anybody turns up.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');
const F = require('../netlify/functions/_activity-facts');
const { migrate } = require('../netlify/functions/_activity-migrate');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');

// A custom schedule of N dated Wednesday evenings, plus whatever extras.
const wednesdays = (n, from) => {
  const out = [];
  const d = new Date(Date.UTC(2026, 9, from || 7));
  for (let i = 0; i < n; i++) {
    out.push({ date: d.toISOString().slice(0, 10), time: '19:30' });
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
};
const withSchedule = (sessions, over) => migrate({
  slug: 's', activityId: 'act-0000000000000001', type: 'course',
  facts: { price: { fullPrice: 100 } },
  groups: [{ groupId: 'g-1', name: { he: '', en: '', ru: '' }, capacity: 10, teacherIds: [],
             facts: { schedule: Object.assign({ frequency: 'custom', sessions: sessions },
                                              over || {}) } }]
});

console.log('[a handful of dates is still named, which is why dated rows exist]');
const few = withSchedule(wednesdays(4));
H.ok(/7 באוקטובר/.test(F.scheduleText(few, 'he')),
  'four dates are listed, every one of them: ' + F.scheduleText(few, 'he'));
H.eq(F.scheduleText(few, 'he').split(' · ').length, 4, 'all four');
H.ok(/28 October/.test(F.scheduleText(few, 'en')), 'and the last of them in English too');

console.log('\n[past four it is described, and the weekday is claimed only when it is true]');
const many = withSchedule(wednesdays(24));
H.eq(F.scheduleText(many, 'he'), 'ימי רביעי, 19:30',
  '⚠ twenty-four Wednesdays become "Wednesdays, 19:30" rather than twenty-four dates');
H.eq(F.scheduleText(many, 'en'), 'Wednesdays, 19:30', 'in English');
H.eq(F.scheduleText(many, 'ru'), 'по средам, 19:30', 'and in Russian, in its own idiom');
H.eq(F.scheduleText(many, 'he').indexOf('·'), -1, 'with no list left in it at all');

// ⚠ THE CASE THAT MUST NOT CLAIM A PATTERN. intro-into-judaism is twenty-three
// Wednesdays and one Thursday.
const mixed = withSchedule(wednesdays(23).concat([{ date: '2026-09-03', time: '19:30' }]));
H.eq(F.scheduleText(mixed, 'he'), '24 מפגשים, 19:30',
  '⚠ one Thursday among the Wednesdays and NO weekday is claimed — "Wednesdays and ' +
  'Thursdays" reads as twice a week, which is the confidently-wrong card this avoids');
H.eq(F.scheduleText(mixed, 'en'), '24 sessions, 19:30', 'in English');
H.eq(F.scheduleText(mixed, 'ru'), '24 занятия, 19:30',
  '⚠ and Russian takes the form the number asks for, which a bare plural would get wrong');
H.eq(F.scheduleText(withSchedule(wednesdays(21).concat([{ date: '2026-09-03', time: '19:30' }])), 'ru'),
  '22 занятия, 19:30', 'twenty-two takes the same form');
H.eq(F.scheduleText(withSchedule(wednesdays(24).concat([{ date: '2026-09-03', time: '19:30' }])), 'ru'),
  '25 занятий, 19:30', 'and twenty-five takes the other one');

// A time is stated only when every session agrees on it, for the same reason.
const twoTimes = withSchedule(wednesdays(10).map((s, i) =>
  ({ date: s.date, time: i % 2 ? '18:00' : '19:30' })));
H.eq(F.scheduleText(twoTimes, 'he'), 'ימי רביעי',
  '⚠ two different times and neither is quoted — the weekday survives, the hour does not');

console.log('\n[and words replace the line outright]');
const said = withSchedule(wednesdays(24), {
  overrideText: { he: 'ימי רביעי, פעמיים בחודש', en: 'Wednesdays, twice a month', ru: '' } });
H.eq(F.scheduleText(said, 'he'), 'ימי רביעי, פעמיים בחודש',
  'the sentence an admin typed, which is the thing that was asked for');
H.eq(F.scheduleText(said, 'en'), 'Wednesdays, twice a month', 'per language');
H.eq(F.scheduleText(said, 'ru'), 'Wednesdays, twice a month',
  '⚠ and a language left blank FALLS BACK rather than dropping to the computed line — ' +
  'the same sentence in the wrong language beats three pages describing different timetables');

// It overrides a SHORT schedule too. The override is about a formula that cannot
// state a timetable, not about length.
const shortSaid = withSchedule([{ day: 3, time: '19:30' }],
  { frequency: 'weekly', overrideText: { he: 'בתיאום מראש', en: 'By arrangement', ru: '' } });
H.eq(F.scheduleText(shortSaid, 'en'), 'By arrangement',
  'and it is not a custom-only field: a weekly line can be replaced too');
H.eq(F.scheduleText(withSchedule([{ day: 3, time: '19:30' }], { frequency: 'weekly' }), 'en'),
  'Wednesdays, 19:30', 'while an ordinary weekly schedule is untouched by any of this');

console.log('\n[the three ways this could be lost]');

// 1. A key missing from the shape is deleted on the next save.
const round = migrate(JSON.parse(JSON.stringify(said)));
H.eq(round.groups[0].facts.schedule.overrideText.en, 'Wednesdays, twice a month',
  '⚠ it survives migrate(), which runs on every read AND every save');
H.eq(JSON.stringify(migrate(round)), JSON.stringify(round), 'and a second pass changes nothing');

// 2. The client rebuilds facts.schedule from scratch on commit.
const client = read('js/activities-admin.js');
H.ok(/facts\.schedule = \{[\s\S]{0,200}overrideText: readLangField\(GROUP_PREFIX \+ '-schedule-overrideText'\)/
  .test(client),
  '⚠ the commit reads it back — facts.schedule is REBUILT there, so a field left out ' +
  'is an input an admin types into and a save drops');
H.ok(/GROUP_PREFIX \+ '-schedule-overrideText'/.test(client) &&
     /Instead of the schedule line/.test(client),
  'and the box names the line it replaces, which is the lesson the group-size override paid for');
H.ok(client.indexOf("label: 'Free-text override'") === -1,
  'nothing in this admin is labelled as a bare override any more');

// 3. Words are translatable; the timetable is not.
const adminFn = read('netlify/functions/activities-admin.js');
const subkeys = /const LANG_SUBKEYS = \{[\s\S]*?\};/.exec(adminFn)[0];
H.ok(/schedule: \['overrideText'\]/.test(subkeys),
  '⚠ a Russian-only role may translate the sentence');
H.ok(subkeys.indexOf("'sessions'") === -1 && subkeys.indexOf("'frequency'") === -1,
  'and cannot touch which day anybody turns up');

console.log('\n[the live records this was reported on]');
const live = (slug) => migrate(JSON.parse(read('activities/' + slug + '.json')));
const judaism = F.scheduleText(live('intro-into-judaism'), 'he');
H.ok(judaism.length < 40,
  '⚠ intro-into-judaism is one short line now: "' + judaism + '"');
H.eq(judaism.indexOf('באוקטובר'), -1, 'naming no dates at all');
const ayeka = F.scheduleText(live('beit-midrash-ayeka'), 'he');
H.ok(ayeka.length < 40, 'and so is beit-midrash-ayeka: "' + ayeka + '"');
H.ok(/ימי /.test(ayeka),
  'which DOES share one weekday, so it keeps it rather than falling back to a count');
// And the ordinary weekly activity is byte-for-byte what it was.
H.eq(F.scheduleText(live('hebrew4kids'), 'he'), 'ימי רביעי, 16:00',
  'while hebrew4kids reads exactly as it always has');

H.done();
