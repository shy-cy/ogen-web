// What this defends against:
//
// ⚠ "WHAT DOES THIS MEAN? IT HAS NO MEANING."
//
// The Registration panel showed:
//
//     The dates these were computed from have changed
//     Computed from a start of 2025-09-23 and 1 sessions. It is now — and 1.
//
// The em dash is the bug wearing its symptom. `defaultBasis.startDate` is
// stamped by defaultIfBlank() from `groups.durationFor(activity, firstGroupId)`
// — the GROUP's duration, which is where that fact has lived since a group
// became the unit. The client read it back from `S.record.facts.duration`, the
// ACTIVITY's, which has been empty on every record since that move.
//
// So the comparison was always "a real date versus an empty string". Three
// things followed, and only the first was visible:
//
//   1. The notice fired on EVERY course carrying a basis, permanently, whatever
//      its schedule said. A warning that is always on is a warning nobody reads.
//   2. The sentence had a hole in it, which is what got it reported.
//   3. ⚠ AND THE BUTTON HAD THE SAME FAULT, WHICH IS THE ONE THAT MATTERED. It
//      computed the fee cutoff from that same empty start date, so
//      minusDaysLocal() got undefined and returned '', and regSetInput() skips a
//      blank. The fee cutoff was silently NOT set while the message said "Both
//      dates recomputed" — a claim about two dates that govern refunds, one of
//      which had not moved.
//
// ⚠ THE SERVER'S basisChanged() WAS CORRECT THE WHOLE TIME. This is one rule
// with two implementations, and the second drifted — the shape this project
// keeps meeting. A browser cannot require a Netlify function, so the copy stays
// and is PINNED here, the way MIN_PASSWORD and the activities menu's status
// groups are.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const F = require('./_fixtures');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const ui = read('js/activities-admin.js');
const REG = require(H.fnPath('_activity-registration'));

console.log('[the client reads the basis off the GROUP, as the server wrote it]');

// The server's stamp, and the server's own comparison. Both go through
// groups.durationFor(), never activity.facts.
const server = read('netlify/functions/_activity-registration.js');
const stamp = server.slice(server.indexOf('if (filled && !reg.defaultBasis)'),
                           server.indexOf('return reg;', server.indexOf('if (filled && !reg.defaultBasis)')));
H.ok(/duration\.startDate/.test(stamp), 'the server stamps startDate from a duration it resolved');
const defaults = server.slice(server.indexOf('function defaultIfBlank('),
                              server.indexOf('function basisChanged('));
const durAt = defaults.indexOf('const duration = groups.durationFor(');
const durLine = defaults.slice(durAt, durAt + 200).replace(/\s+/g, ' ');
H.ok(/groups\.durationFor\(activity, groups\.groupList\(activity\)\[0\]/.test(durLine),
  'and that duration is the FIRST GROUP\'s');

// ⚠ And the client now reads the same place. Checked by shape rather than by
// looking for the fix: nothing in the recompute block may reach a duration
// through the activity's own facts.
const block = ui.slice(ui.indexOf('    var basis = reg.defaultBasis;'),
                       ui.indexOf('  function regSetInput('));
H.ok(block.length > 500, 'found the recompute block');
H.ok(/firstGroupDuration\(\)/.test(block),
  '⚠ the notice resolves the current schedule through the group');
H.ok(!/S\.record\.facts/.test(block),
  '⚠ and NEVER through S.record.facts.duration, which has been empty on every ' +
  'record since duration moved onto the group — that read is what compared a ' +
  'real date against an empty string');
H.ok(/function firstGroupDuration\(\)/.test(ui) &&
     /S\.record\.groups\) \|\| \[\]\)\[0\]/.test(
       ui.slice(ui.indexOf('function firstGroupDuration()'),
                ui.indexOf('function firstGroupCalendar()'))),
  'and the helper takes it off groups[0], the same row the server does');

console.log('\n[the button computes BOTH dates from that same place]');
// The half that was silently doing nothing.
H.ok(/minusDaysLocal\(firstGroupDuration\(\)\.startDate, FEE_CUTOFF_DAYS\)/.test(block),
  '⚠ the fee cutoff is computed from the group\'s start date — it was reading ' +
  'the activity\'s, getting undefined, and setting nothing at all');
H.ok(/thirtyPercentLocal\(\)/.test(block), 'and the cancellation cutoff from the calendar');
// ⚠ And it reports what MOVED rather than what was attempted.
H.ok(/moved\.length/.test(block),
  '⚠ the confirmation names the dates that actually changed — "Both dates ' +
  'recomputed" was untrue for a release and nothing on screen contradicted it');
H.ok(/message\('err'/.test(block),
  'and with nothing to compute from, it says so instead of claiming success');

console.log('\n[the two constants are written twice and must agree]');
// A browser cannot require a Netlify function, so the recompute button and the
// sentence describing it carry their own copy. This is the only thing standing
// between them and the server's.
const clientFee = Number(/var FEE_CUTOFF_DAYS = (\d+);/.exec(ui)[1]);
const clientFrac = Number(/var CANCEL_FRACTION = ([\d.]+);/.exec(ui)[1]);
const serverFee = Number(/const FEE_CUTOFF_DAYS = (\d+);/.exec(server)[1]);
const serverFrac = Number(/const CANCEL_FRACTION = ([\d.]+);/.exec(server)[1]);
H.eq(clientFee, serverFee, 'FEE_CUTOFF_DAYS agrees (' + serverFee + ')');
H.eq(clientFrac, serverFrac, 'CANCEL_FRACTION agrees (' + serverFrac + ')');
// And the sentence is built from them rather than repeating the digits, so it
// cannot describe a formula the button does not apply.
H.ok(/FEE_CUTOFF_DAYS \+ ' days before the start/.test(block),
  'the explanation interpolates the constant rather than hardcoding "14"');
H.ok(/Math\.round\(CANCEL_FRACTION \* 100\)/.test(block), 'and the fraction');

console.log('\n[the sentence has no holes in it]');
// Executed, because "1 sessions" and "It is now — and 1" are exactly the kind of
// thing that reads fine in source.
const say = (() => {
  const ctx = vm.createContext({});
  const from = block.indexOf('        var when = function');
  const to = block.indexOf('        box.appendChild');
  vm.runInContext(block.slice(from, to) + '\nthis.when = when; this.many = many;', ctx);
  return ctx;
})();
H.eq(say.many(1), '1 session', '⚠ one session is not "1 sessions"');
H.eq(say.many(6), '6 sessions', 'and six are');
H.eq(say.many(0), '0 sessions', 'and none is too');
H.eq(say.when(''), 'no start date',
  '⚠ a missing start date SAYS SO rather than rendering an em dash mid-sentence, ' +
  'which is what "It is now — and 1." was');
H.eq(say.when('2026-09-30'), '2026-09-30', 'and a real one is itself');

console.log('\n[and the server\'s own check, against real records]');
// The rule this client copy has to agree with, executed on activities rather
// than read. An unmoved schedule must report NOTHING, which is the half that was
// broken: the notice was permanently on.
const act = F.course();
const first = act.groups[0];
const dur = (first.facts || {}).duration || {};
const scheduled = (dur.sessionDates || []).filter((r) => r && r.date && r.status !== 'excluded');

const settled = JSON.parse(JSON.stringify(act));
settled.registration = Object.assign({}, settled.registration, {
  defaultBasis: { startDate: dur.startDate || '', sessionCount: scheduled.length }
});
H.eq(REG.basisChanged(settled), null,
  '⚠ a schedule that has NOT moved reports nothing — the client\'s copy was ' +
  'reporting every course, forever, because it compared against an empty string');

const moved = JSON.parse(JSON.stringify(settled));
moved.registration.defaultBasis = { startDate: '2025-09-23', sessionCount: 1 };
const changed = REG.basisChanged(moved);
H.ok(changed, 'and one that has moved reports it');
H.eq(changed.was.startDate, '2025-09-23', 'naming what it was set from');
H.eq(changed.now.startDate, dur.startDate || '',
  '⚠ and what the schedule says NOW, resolved through the group — this is the ' +
  'exact value the client had as an empty string');
H.ok(changed.now.startDate, 'which is a real date, not a blank');

// A record with no basis has nothing to compare and must stay quiet.
const never = JSON.parse(JSON.stringify(act));
never.registration = Object.assign({}, never.registration, { defaultBasis: null });
H.eq(REG.basisChanged(never), null, 'an activity that never had a computed date says nothing');

H.done();
