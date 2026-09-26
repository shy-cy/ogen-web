// What this defends against:
//
// Every endpoint in this admin is one POST with an `action` string, and an
// action the server does not know answers 400 "Unknown action". That failure is
// invisible until somebody presses the button: the screen renders, the row is
// there, the click does nothing useful, and nothing in the build said so. It is
// the same shape as the read-back bug the field groups already have a test for —
// the form draws, the admin types, the save succeeds, and the value is gone.
//
// So the two halves are checked against each other mechanically.
//
// ⚠ AND IT IS CHECKED IN BOTH DIRECTIONS NOW, because the other one is how a
// feature goes missing. This file used to say, in a comment, "the reverse is NOT
// required: an endpoint may offer more than one screen uses, and moveGroup has
// no control yet" — and that sentence sat there while FOUR actions accumulated
// behind it with nothing calling them. A missing button is silent in a way a
// missing endpoint is not: nobody presses it, nothing 400s, and the capability
// is simply absent from the product while the code for it is in the repository
// and passing its tests.
//
// moveGroup was the expensive one. Correcting a child's group had no control at
// all, so the only route was to cancel and re-register — which writes a credit,
// sends a cancellation email and re-freezes the price, all to fix a dropdown.
//
// An action with no caller is allowed, and it has to be NAMED here. That is the
// whole mechanism: writing the endpoint is no longer enough to consider the
// thing built, and the next one added either gets a control or gets a line in
// UNREACHED saying why not.
//
// The second half is the LEGAL GATE, and it is the more important one. The
// family-facing area is held behind ogen-legal-review until the Russian legal
// text has been read by a native speaker. This screen is deliberately outside
// that gate — in the gate's own words, "building the admin side of registration
// is exactly what this gate is meant to allow" — and the exemption has to be
// earned rather than assumed. It is granted by REACHABILITY: referenced by a
// page under /admin/ and by no page outside it. A naming convention would not
// have been enough; anyone can name a public page "-admin".

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');

const SCREEN = 'js/registrations-admin.js';
const PAGE = 'admin/registrations.html';
const SERVER = 'netlify/functions/admin-registrations.js';

console.log('[the screen exists and is wired to the admin]');
H.ok(fs.existsSync(path.join(R, SCREEN)), SCREEN + ' exists');
H.ok(fs.existsSync(path.join(R, PAGE)), PAGE + ' exists');
const page = read(PAGE);
H.ok(/<meta name="robots" content="noindex/.test(page), 'the page is noindex, like the rest of the admin');
H.ok(page.indexOf('src="/js/registrations-admin.js"') !== -1, 'and loads the screen');
H.ok(page.indexOf('src="/js/admin-session.js"') !== -1,
  'through the shared session helper, so a 401 lands the user back at login rather than on a half-broken screen');

console.log('\n[every action the screen sends, the server handles]');
const screen = read(SCREEN);
const server = read(SERVER);
const sent = new Set();
let m;
const ACTION_RE = /action:\s*'([a-zA-Z]+)'/g;
while ((m = ACTION_RE.exec(screen))) sent.add(m[1]);
const handled = new Set();
const CASE_RE = /case\s*'([a-zA-Z]+)'\s*:/g;
while ((m = CASE_RE.exec(server))) handled.add(m[1]);

H.ok(sent.size >= 6, 'the screen sends a real set of actions (' + Array.from(sent).sort().join(', ') + ')');
Array.from(sent).sort().forEach((a) => {
  H.ok(handled.has(a), 'the server handles "' + a + '"');
});
console.log('\n[and every action the server handles, something can reach]');
// Deliberately unreachable, each with the reason. Shrinking this list is the
// point; growing it is a decision somebody has to write down.
const UNREACHED = {
  // Not a queue action at all — the shape of the reply to an unknown one.
  auth: 'the session handshake, called on load rather than from a control',
  // ⚠ `register` AND `markAttendance` CAME OFF THIS LIST, and what took them off
  // is worth keeping: the gap they named was found from the OTHER end. The
  // Roster counted registrations against the size of the room and called the
  // result "over capacity", because an evening — which is the unit on a drop-in
  // — had no screen at all. The count that means something had existed in
  // capacityForDate() since Phase 7 and was returned to nobody.
  //
  // That is what this list is for. It is not an excuse column; it is a standing
  // question, and every line on it is a capability sitting in the repository,
  // passing its tests, that nobody using the product can reach.
  //
  // ⚠ AND `recordSessionPayment` HAS COME OFF IT TOO, which empties the list.
  // It was the last line, and it had sat here since Phase 7 — cash at the desk
  // for one evening, written, tested, and with nothing anywhere to press. The
  // control is on the evening register's money panel, pointed at the booking
  // rather than at the term. An empty list is the state to keep this in; the
  // next endpoint written without a door reappears here on its own.
};
// ⚠ NAMED, not only sent as `action: '…'`. Three of them travel differently:
// approve goes through act('approve', …) as a bare argument, and the two
// previews sit in a config object beside the action they preview. An extractor
// that only knew the one spelling would have reported all three as unreachable
// and taught whoever read it to widen the allowlist rather than the regex.
const named = (a) => sent.has(a) || screen.indexOf("'" + a + "'") !== -1;
const orphans = Array.from(handled).filter((a) => !named(a) && !UNREACHED[a]).sort();
H.eq(orphans.join(', '), '',
  'no action is handled by the server with nothing able to reach it' +
  (orphans.length ? ' — found: ' + orphans.join(', ') : ''));
// And the list cannot rot in the other direction: an entry that has since been
// wired up must come off it, or it hides the next one.
Object.keys(UNREACHED).sort().forEach((a) => {
  H.ok(handled.has(a), 'the unreachable list names a real action: ' + a);
});
H.eq(Object.keys(UNREACHED).filter((a) => named(a) && a !== 'auth').join(', '), '',
  'and nothing on it is actually reachable — a stale entry hides the next gap');
console.log('  ..   ' + Object.keys(UNREACHED).filter((a) => a !== 'auth').length +
            ' server actions have no control anywhere:');
Object.keys(UNREACHED).forEach((a) => {
  if (a !== 'auth') console.log('       ' + a + ' — ' + UNREACHED[a]);
});

console.log('\n[moving a group is a correction, not a cancellation]');
// ⚠ THE ONLY ROUTE WAS TO CANCEL AND RE-REGISTER, which writes a credit, sends
// a cancellation email and re-freezes the price at today's figure — all real,
// none of it wanted, to fix a dropdown somebody picked wrong. The endpoint was
// there the whole time; nothing called it.
H.ok(/action: 'moveGroup', slug: S\.slug/.test(screen), 'the screen calls moveGroup');
H.ok(/function groupCell\(r\)/.test(screen), 'from the Group cell, which is the control');
H.ok(/el\('td', \{\}, \[groupCell\(r\)\]\)/.test(screen), 'and the cell is drawn from it');
const cell = screen.slice(screen.indexOf('function groupCell'), screen.indexOf('function actions'));
// Cosmetic, like every permission check on this side — the server re-decides.
H.ok(/!S\.canApprove/.test(cell), 'a role that may not decide gets the name, not a select');
H.ok(/status === 'pending' \|\| r\.status === 'approved'/.test(cell),
  'and so does a registration that is over — moving one rewrites a record about a place that has gone');
H.ok(/!named\.length/.test(cell), 'a pooled activity has no groups to choose between');
H.ok(/disabled: full \|\| null/.test(cell), 'a full group is offered and disabled, never hidden');
H.ok(/loadQueue\(S\.slug\)/.test(cell),
  'a move redraws the whole queue — the capacity line counts both groups and would otherwise disagree');
H.ok(/sel\.value = r\.groupId \|\| ''/.test(cell),
  'and a refusal puts the select back, or the screen claims a move the server declined');
// The server half: the room check must exclude the registration being moved, or
// a group is full of the very person trying to leave it.
const move = server.slice(server.indexOf("case 'moveGroup'"), server.indexOf("case 'register'"));
H.ok(/!\(r\.participantId === reg\.participantId && r\.activityId === reg\.activityId\)/.test(move),
  'the room check excludes the registration being moved');
H.ok(/canApprove\(session\)/.test(move), 'and the action is refused without the approve axis');
// A history entry nobody can read is not a record. It said "moved to grp-1f3a9c".
H.ok(/note: 'moved group: ' \+ moved/.test(move), 'the history names the move');
H.ok(/const moved = \(name\(from\) \|\| '\\u2014'\)/.test(move),
  'naming BOTH groups — "moved to Advanced" with no "from" is half a record');
H.ok(!/'moved to ' \+ body\.groupId/.test(move), 'and never an id, which is the one spelling nobody can resolve');

console.log('\n[the money controls are behind the cancel axis, on both sides]');
// Reading a ledger is `access`; moving money is `cancel`. The client greys the
// controls out and the server refuses them — the client half is cosmetic, and
// this checks the two agree about WHICH axis rather than trusting either.
['recordPayment', 'applyCredit', 'adjustCredit'].forEach((a) => {
  const at = server.indexOf("case '" + a + "'");
  H.ok(at !== -1, a + ' exists on the server');
  const body = server.slice(at, at + 400);
  H.ok(/canCancel\(session\)/.test(body), a + ' is refused without the cancel axis');
});
const ledgerAt = server.indexOf("case 'ledger'");
H.ok(!/canCancel\(session\)/.test(server.slice(ledgerAt, ledgerAt + 300)),
  'while reading the ledger needs only access — seeing what a family is owed is part of answering them');
H.ok(/S\.canCancel/.test(screen), 'and the screen mirrors that so the buttons are greyed rather than failing on click');

console.log('\n[the gate exemption is earned by reachability, not by a name]');
const adminPages = fs.readdirSync(path.join(R, 'admin')).filter((f) => f.endsWith('.html'));
const publicPages = fs.readdirSync(R).filter((f) => f.endsWith('.html'));
['en', 'ru'].forEach((l) => {
  const d = path.join(R, l);
  if (fs.existsSync(d)) fs.readdirSync(d).filter((f) => f.endsWith('.html')).forEach((f) => publicPages.push(l + '/' + f));
});
const refs = (files, base) => files.filter((f) =>
  read(base ? base + '/' + f : f).indexOf('src="/js/registrations-admin.js"') !== -1);

H.ok(refs(adminPages, 'admin').length > 0, 'an admin page loads it');
H.eq(refs(publicPages, null).length, 0,
  'and no public page does — which is the whole exemption, and it is checked rather than assumed');
// The screen must not be the thing that opens the family area by the back door.
H.ok(!/account-registrations|account-family|account-auth/.test(screen),
  'it talks only to the admin endpoint, never to a guardian one');

console.log('\n[the family area is still not built, and this says why]');
const REVIEW = /<meta name="ogen-legal-review" content="(pending|complete)">/.exec(read('privacy.html'));
H.ok(!!REVIEW, 'the review marker is readable');
if (REVIEW[1] === 'pending') {
  console.log('  ..   PHASE 6 IS HELD. The guardian-facing area is a public registration');
  console.log('       surface, and ogen-legal-review is still "pending": nobody fluent has read');
  console.log('       the Russian legal text, the two price labels, or the account and');
  console.log('       registration emails. The admin half is built instead, which is exactly');
  console.log('       what the gate was designed to allow.');
}
H.ok(true, 'and the admin screen is the half that does not wait on it');

H.done();
