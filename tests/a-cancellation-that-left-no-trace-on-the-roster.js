// What this defends against:
//
// A family registered, cancelled, and registered again for the same activity.
// The Roster showed one row, live, with nothing anywhere saying a place had been
// given up and taken back — and an admin went looking for a cancelled row that
// does not exist and never did.
//
// It was not lost. There is ONE record per participant per activity, keyed
// reg-<pid>__<aid>, so a second request lands in the same blob on purpose; and
// openRegistration() carries the earlier history forward rather than
// overwriting it, with a comment saying why: "an admin looking at a second
// request can see the first". admin-registrations.js has been putting `history`
// on every row of the payload since it was written.
//
// ⚠ AND THE SCREEN THREW IT AWAY. js/registrations-admin.js never read the
// field. So the data was right, the API was right, the comment explaining the
// design was right, and the capability was absent from the product — the same
// shape as the invite button labelled with a description, and as the pure bundle
// module that was wired to nothing for a release.
//
// A second ROW was the wrong fix and is asserted against here. Two rows for one
// place read as two places, and the capacity line above the table counts
// records: a cancelled row beside its live replacement would say 2 / 20 for one
// child on one place, on the one screen that exists to answer "is there room".
//
// So it is one row carrying what it has been through, and only the ENDINGS —
// cancelled, rejected, expired. Every submission and approval in between is the
// ordinary run of a registration and would bury the one line somebody is looking
// for.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const client = fs.readFileSync(path.join(R, 'js/registrations-admin.js'), 'utf8');
const server = fs.readFileSync(path.join(R, 'netlify/functions/admin-registrations.js'), 'utf8');

// --------------------------------------------------------------------------
console.log('[the two halves, against each other]');

// Neither half is the source of truth on its own: a payload nothing reads is
// dead weight, and a reader with nothing to read is a blank column.
H.ok(/history:\s*reg\.history/.test(server),
  'the server still sends each row its history');
H.ok(/r\.history/.test(client),
  'and the screen reads it — which is the half that was missing');
H.ok(/priorCell\(r\)/.test(client),
  'and puts it on the row');

// ⚠ NOT A SECOND ROW. The rows are built one per registration; anything that
// mapped history into rows of its own would make the count above the table
// disagree with the table.
//
// It used to be spelled `q.registrations.map` and is now one list, narrowed by
// one predicate, mapped in one place — the table can be filtered. The rule is
// the same and it is asked by shape, because pinning the old spelling would fail
// on a rename and say nothing about a second row builder appearing beside it.
H.eq((client.match(/q\.registrations \|\| \[\]/g) || []).length, 1,
  'the rows come from one list');
H.ok(/var show = regs\.filter\(passes\)/.test(client),
  'narrowed by one predicate, so what is drawn is a subset and never a rebuild');
H.eq((client.match(/show\.map\(function \(r\)/g) || []).length, 1,
  'and there is exactly one place that builds them');

// --------------------------------------------------------------------------
console.log('[what a row says it has been through]');

// The function is sliced out and EXECUTED rather than read, because what was
// wrong before was not the words in it — there were none — and reading is what
// missed it the first time.
const from = client.indexOf('  var ENDINGS =');
const to = client.indexOf('  function when(r)');
H.ok(from !== -1 && to > from, 'priorCell is where this test expects to find it');

const drawn = [];
const ctx = vm.createContext({
  // A DOM stub narrow enough that anything priorCell does beyond building
  // spans of text is a ReferenceError rather than a silent pass.
  el: function (tag, attrs, kids) {
    if (attrs && attrs.text) drawn.push(attrs.text);
    return { tag: tag, attrs: attrs || {}, kids: kids || [] };
  }
});
vm.runInContext(client.slice(from, to) + '\nthis.priorCell = priorCell;', ctx,
  { filename: 'js/registrations-admin.js (slice)' });
const priorCell = ctx.priorCell;

const say = (reg) => { drawn.length = 0; const out = ctx.priorCell(reg); return { out: out, said: drawn.slice() }; };

// The reported case, exactly: registered, cancelled, registered again.
const reRegistered = {
  status: 'pending',
  history: [
    { iso: '2026-09-01T09:00:00Z', action: 'submitted' },
    { iso: '2026-09-02T09:00:00Z', action: 'approved' },
    { iso: '2026-09-10T09:00:00Z', action: 'cancelled' },
    { iso: '2026-09-20T09:00:00Z', action: 'submitted' }
  ]
};
{
  const r = say(reRegistered);
  H.ok(r.out, 'a re-registration says so on its row');
  H.eq(r.said.length, 1, 'in one line, not four');
  H.ok(/cancelled/.test(r.said[0]), 'naming what happened: ' + r.said[0]);
  H.ok(/2026-09-10/.test(r.said[0]), 'and when — the date is the whole of what an admin is checking');
  H.ok(!/09:00|T09/.test(r.said[0]), 'to the day, not the second');
  // ⚠ THE APPROVAL AND THE TWO SUBMISSIONS ARE NOT LISTED. They are the
  // ordinary run of a registration; printing them would bury the one line the
  // admin opened the row for.
  H.ok(!/submitted|approved/.test(r.said.join(' ')), 'and nothing else from the history');
}

// A first registration has nothing to say, and must say nothing — a row that
// always carries a line teaches an admin to stop reading it.
{
  const r = say({ status: 'approved', history: [
    { iso: '2026-09-01T09:00:00Z', action: 'submitted' },
    { iso: '2026-09-02T09:00:00Z', action: 'approved' }
  ] });
  H.eq(r.out, null, 'an ordinary registration draws nothing');
}

// ⚠ AND A CURRENTLY CANCELLED ROW DOES NOT ALSO REPORT ITSELF AS PREVIOUSLY
// CANCELLED. The pill beside it already says cancelled; saying it twice in two
// shapes reads as two cancellations.
{
  const r = say({ status: 'cancelled', history: [
    { iso: '2026-09-01T09:00:00Z', action: 'submitted' },
    { iso: '2026-09-10T09:00:00Z', action: 'cancelled' }
  ] });
  H.eq(r.out, null, 'a row that IS cancelled does not repeat itself');
}

// A record with no history at all — every registration written before history
// existed, and anything an older path wrote.
H.eq(say({ status: 'approved' }).out, null, 'a row with no history is not an error');
H.eq(say({ status: 'approved', history: [] }).out, null, 'nor is an empty one');

// The other two endings, because a re-request after a REFUSAL is the case the
// carry-forward comment was originally written about.
{
  const r = say({ status: 'approved', history: [
    { iso: '2026-09-01T09:00:00Z', action: 'submitted' },
    { iso: '2026-09-03T09:00:00Z', action: 'rejected' },
    { iso: '2026-09-05T09:00:00Z', action: 'submitted' }
  ] });
  H.ok(/rejected/.test(r.said.join(' ')), 'an earlier refusal shows too');
}
{
  const r = say({ status: 'approved', history: [
    { iso: '2026-09-01T09:00:00Z', action: 'submitted' },
    { iso: '2026-09-03T09:00:00Z', action: 'expired' },
    { iso: '2026-09-05T09:00:00Z', action: 'submitted' }
  ] });
  H.ok(/expired/.test(r.said.join(' ')),
    'and so does a request we did not answer in time');
}

// A record that has been round several times is bounded, most recent first —
// an admin reading a row wants the last thing that happened, and a row is not a
// place to print a life story.
{
  const many = { status: 'approved', history: [] };
  ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'].forEach((m) => {
    many.history.push({ iso: m + '-01T09:00:00Z', action: 'submitted' });
    many.history.push({ iso: m + '-05T09:00:00Z', action: 'cancelled' });
  });
  many.history.push({ iso: '2026-06-01T09:00:00Z', action: 'submitted' });
  const r = say(many);
  H.eq(r.said.length, 3, 'five previous cancellations are shown as three');
  H.ok(/2026-05-05/.test(r.said[0]), 'and the most recent one leads: ' + r.said[0]);
  H.ok(/2026-03-05/.test(r.said[2]), 'with the oldest of the three last');
}

H.done();
