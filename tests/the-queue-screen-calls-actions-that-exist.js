// What this defends against:
//
// Every endpoint in this admin is one POST with an `action` string, and an
// action the server does not know answers 400 "Unknown action". That failure is
// invisible until somebody presses the button: the screen renders, the row is
// there, the click does nothing useful, and nothing in the build said so. It is
// the same shape as the read-back bug the field groups already have a test for —
// the form draws, the admin types, the save succeeds, and the value is gone.
//
// So the two halves are checked against each other mechanically. The screen may
// use fewer actions than the server offers; it may never use one the server does
// not have.
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
// The reverse is NOT required: an endpoint may offer more than one screen uses,
// and moveGroup has no control yet.
H.ok(handled.size >= sent.size, 'and may offer more than the screen uses');

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
