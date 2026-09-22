// What this defends against:
//
// A `custom` schedule could not say WHICH DAYS it meant. Its rows were a weekday
// and a time — "Wednesday, 16:00" — which is the right shape for something that
// repeats and says almost nothing about something that does not. An activity
// meeting on four particular dates had no way to name them, and three things
// followed from that:
//
//   - the public card said "Wednesday, 16:00" for a course with four meetings
//     scattered across two months;
//   - no session calendar could be GENERATED, because `custom` was the one
//     frequency with nothing to enumerate;
//   - and prorated cancellation had to be refused, because it divides by the
//     session list and there was no session list to divide by.
//
// All three came back the moment a row could carry a date. The rows are the
// calendar: there is nothing to walk, because the admin has already written the
// answer down and the generator's job is to read it.
//
// TWO TRAPS, and this file exists mostly for them.
//
// 1. SHAPES.schedule runs on every read and every save, so a key it does not
//    name is gone by the next write. That is exactly how sessionDates was lost
//    before it was listed — generated, stored, rendered, and wiped, with nothing
//    erroring. A `date` the shape did not know about would have done the same.
//
// 2. A row carrying BOTH a stored weekday and a date is two claims that can
//    disagree, and nothing could then say which one a reader should believe.
//    The weekday is DERIVED from the date wherever there is one, on the server
//    and in the form, so the disagreement is not representable.
//
// And the time field, which is a smaller thing that was wrong for a bigger
// reason: `<input type="time">` renders AM/PM or 24h from the BROWSER'S locale
// and no attribute changes it. The stored value was always 24h, so this was
// never a data question — it was a display the page could not control, showing
// "04:00 PM" to an admin in Cyprus.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const S = require('../netlify/functions/_activity-sessions');
const F = require('../netlify/functions/_activity-facts');
const { migrate } = require('../netlify/functions/_activity-migrate');

// 14 October 2026 is a Wednesday; 1 November 2026 is a Sunday.
const DATED = {
  frequency: 'custom',
  sessions: [{ date: '2026-11-01', time: '10:30' }, { date: '2026-10-14', time: '16:00' }]
};

console.log('[the date survives a save, which is where the last one was lost]');
const saved = migrate({ slug: 'x', facts: { schedule: JSON.parse(JSON.stringify(DATED)) } });
const rows = saved.facts.schedule.sessions;
H.eq(rows.length, 2, 'both rows are kept');
H.eq(rows[0].date, '2026-11-01', 'and each keeps its date');
H.eq(rows[1].date, '2026-10-14', 'in the order it was given');
// Idempotent, like the rest of migrate(): the second pass finds what the first
// wrote rather than normalising it away.
const again = migrate(saved).facts.schedule.sessions;
H.eq(JSON.stringify(again), JSON.stringify(rows), 'and a second pass changes nothing');

console.log('\n[the weekday is derived, so it cannot disagree with the date]');
// A row insisting on Monday for a date that is a Wednesday. The date wins,
// because it is the more specific claim and the one somebody typed on purpose.
const lying = migrate({ slug: 'x', facts: { schedule: {
  frequency: 'custom', sessions: [{ day: 1, date: '2026-10-14', time: '16:00' }]
} } }).facts.schedule.sessions[0];
H.eq(lying.day, 3, 'the stored weekday is replaced by the date\'s own');
H.eq(lying.date, '2026-10-14', 'and the date is untouched');
// A row with no date keeps the weekday it was given — this is still the shape
// every repeating frequency uses.
const plain = migrate({ slug: 'x', facts: { schedule: {
  frequency: 'weekly', sessions: [{ day: 2, time: '17:00' }]
} } }).facts.schedule.sessions[0];
H.eq(plain.day, 2, 'a row with no date keeps its weekday');
H.eq(plain.date, undefined, 'and gains no empty date key');
// An unreadable date is not a date. It must not silently become one, and it
// must not take the weekday down with it.
const bad = migrate({ slug: 'x', facts: { schedule: {
  frequency: 'custom', sessions: [{ day: 4, date: '2026-02-30', time: '09:00' }]
} } }).facts.schedule.sessions[0];
H.eq(bad.date, undefined, '30 February is refused rather than rolled into March');
H.eq(bad.day, 4, 'and the row keeps the weekday it did have');

console.log('\n[a dated custom schedule enumerates, which is what it could not do]');
H.eq(S.enumerate(DATED).join(' '), '2026-10-14 2026-11-01',
  'the dates are the calendar — sorted, because they were typed in no order');
H.eq(S.enumerate({ frequency: 'custom', sessions: [
  { date: '2026-10-14' }, { date: '2026-10-14' }] }).length, 1,
  'and deduplicated, because the same date twice is one meeting');
// ⚠ NOT BOUNDED BY THE TERM DATES. Every other frequency counts FROM a start;
// these need nothing, and filtering them would drop a date an admin wrote on
// purpose — the one thing a list of exact dates must never do.
H.eq(S.enumerate(Object.assign({ startDate: '2026-12-01', endDate: '2026-12-31' }, DATED)).length, 2,
  'a start and end date do not filter dates that were named explicitly');
H.eq(S.enumerate(Object.assign({ limit: 1 }, DATED)).join(' '), '2026-10-14',
  'but a limit still caps, because that is a cap on how many to take');
// Nothing regresses: a custom schedule with no dates enumerates to nothing,
// which is exactly what every custom schedule did before.
H.eq(S.enumerate({ frequency: 'custom', sessions: [{ day: 2, time: '16:00' }] }).length, 0,
  'a custom schedule with no dates still enumerates to nothing');
H.eq(S.enumerate({ frequency: 'weekly', sessions: [{ day: 3 }],
                   startDate: '2026-10-01', endDate: '2026-10-31' }).length, 4,
  'and a repeating frequency is walked exactly as before');
H.ok(S.GENERATED.indexOf('custom') !== -1, 'custom is generable now');
['one-time', 'weekly', 'biweekly', 'twice-weekly', 'monthly'].forEach((f) => {
  H.ok(S.GENERATED.indexOf(f) !== -1, f + ' still is');
});

console.log('\n[and it reads as a date on the page, in all three languages]');
const line = (lang) => F.formatSchedule(saved.facts.schedule, lang);
H.eq(line('en'), 'Sunday, 1 November, 10:30 · Wednesday, 14 October, 16:00',
  'English: the weekday leads, then the date, then the time');
H.eq(line('he'), 'יום ראשון, 1 בנובמבר, 10:30 · יום רביעי, 14 באוקטובר, 16:00',
  'Hebrew, with the ב prefix on the month');
H.eq(line('ru'), 'воскресенье, 1 ноября, 10:30 · среда, 14 октября, 16:00',
  'Russian, in the genitive');
// ⚠ NEVER PLURAL. Some frequencies render "Wednesdays"; one date is one meeting,
// and "Wednesdays, 14 October" is not a sentence in any of the three.
['he', 'en', 'ru'].forEach((l) => {
  const plural = F.formatSchedule({ frequency: 'weekly', sessions: DATED.sessions }, l);
  H.ok(plural.indexOf('14') !== -1, l + ': a dated row stays dated whatever the frequency says');
});
H.ok(line('en').indexOf('Wednesdays') === -1, 'and is not pluralised');
// The undated shape is untouched — this is still how every repeating activity
// on the site renders.
H.eq(F.formatSchedule({ frequency: 'weekly', sessions: [{ day: 3, time: '16:00' }] }, 'en'),
  'Wednesdays, 16:00', 'a weekly schedule reads exactly as it did');
// No en or em dash, the rule every generated fact follows.
['he', 'en', 'ru'].forEach((l) => {
  H.ok(!/[—–]/.test(line(l)), l + ': no en or em dash in a generated fact');
});

console.log('\n[the form: 24 hours, because the browser decides otherwise]');
const admin = read('js/activities-admin.js');
H.ok(!/type: 'time'/.test(admin),
  'no native time input anywhere — its format follows the browser locale and no attribute changes it');
H.ok(/pattern: TIME_PATTERN/.test(admin), 'the field is a text box with a 24-hour pattern');
H.eq((/var TIME_PATTERN = '([^']+)'/.exec(admin) || [, ''])[1], '([01][0-9]|2[0-3]):[0-5][0-9]',
  'which admits 00:00 to 23:59 and nothing else');
// Typed shorthand is normalised rather than refused, and the unreadable case is
// handed back UNCHANGED so the pattern marks it instead of the box eating it.
const normalise = new Function('return ' +
  /function normaliseTime\(raw\)[\s\S]*?\n  \}/.exec(admin)[0])();
[['1600', '16:00'], ['930', '09:30'], ['16', '16:00'], ['9', '09:00'],
 ['0930', '09:30'], ['16.30', '16:30'], ['16:00', '16:00'], ['', '']
].forEach(([raw, want]) => H.eq(normalise(raw), want, JSON.stringify(raw) + ' reads as ' + want));
H.eq(normalise('24:00'), '24:00', 'an hour that does not exist is handed back for the pattern to mark');
H.eq(normalise('9:5'), '9:5', 'and so is a minute that is one digit — 9:05 and 9:50 are both readings');

console.log('\n[the form: a date, and a weekday it cannot contradict]');
// ⚠ ONE ROW BUILDER. There were two — an inline one for the activity's own
// schedule and scheduleRowBox() for a named group's — and only the inline one
// ever grew the date field, so a group on a custom schedule could not name its
// dates at all. They are one editor on one sub-page now, so this is the only
// place to look.
const rowsFn = admin.slice(admin.indexOf('function scheduleRowBox'),
                           admin.indexOf('function readScheduleRows'));
H.ok(/if \(freq === 'custom'\)/.test(rowsFn), 'the date input is drawn only for a custom schedule');
H.ok(/type: 'date', id: id \+ '-date'/.test(rowsFn), 'as a real date field');
H.ok(/daySel\.disabled = true;/.test(rowsFn),
  'and the weekday select is disabled once a date fills it');
H.ok(/daySel\.value = String\(d\);/.test(rowsFn), 'having been set from that date');
// Disabled rather than hidden: the day a date landed on is the thing an admin
// wants to see after typing it.
H.ok(/\.session-row select:disabled/.test(read('admin/admin.css')),
  'and it stays visible, greyed, because that is what an admin is checking');
// UTC, for the same reason the server enumerates in UTC.
H.ok(/Date\.UTC\(\+m\[1\], \+m\[2\] - 1, \+m\[3\]\)/.test(admin),
  'the weekday is computed in UTC — a local parse puts a DST boundary inside the date');

console.log('\n[the two filters agree about what a row is]');
// A client filter stricter than the server's drops a row on save with nothing
// erroring; looser, and it sends one the server throws away. Either way the
// admin types something and it is gone.
H.ok(/return x\.day != null \|\| x\.time \|\| x\.date;/.test(admin),
  'the form keeps a row with a day, a time OR a date');
H.ok(/\.filter\(\(s\) => s\.day != null \|\| s\.time \|\| s\.date\)/
  .test(read('netlify/functions/_activity-migrate.js')),
  'and so does the shape on the server');

console.log('\n[prorated cancellation stops being refused on a dated custom]');
// It was refused because it divides the sessions remaining by the sessions
// total, and custom had no total. It is a consequence rather than a separate
// change: nothing about proration knows what a frequency is.
const REG = require('../netlify/functions/_activity-registration');
const errs = REG.validateRegistration(
  { autoApprove: false, cancellationPolicy: { mode: 'prorated' } },
  { type: 'course',
    facts: { duration: { sessionDates: S.enumerate(DATED).map((d) => ({ date: d, status: 'scheduled' })) } } },
  'course');
H.eq((errs || []).length, 0, 'a dated custom schedule can use prorated cancellation');

H.done();
