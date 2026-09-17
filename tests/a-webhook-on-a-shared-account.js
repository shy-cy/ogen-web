// What this defends against:
//
// Ogen's Stripe webhook receives ANOTHER ORGANISATION'S PAYMENTS. The account is
// shared with Shirat HaYam, and Stripe delivers every event on an account to
// every endpoint registered on it, filtered by event type and never by metadata.
// So their donations and event registrations land on this endpoint, at volume,
// forever.
//
// Everything below is about the two ways that goes wrong:
//
//   - Settling somebody else's payment onto an Ogen registration. Guarded by
//     isOurs(), which reads the organization tag and NOTHING else.
//   - Answering Stripe with an error. A 4xx or 5xx makes Stripe retry for days
//     and then disable the endpoint, and a retry means a family's payment
//     counted twice. The only non-200 is a failed signature, because an
//     unverified body did not come from Stripe at all.
//
// The third thing is idempotency. Webhook delivery is at-least-once BY DESIGN —
// not a rare failure — and Blobs has no compare-and-swap, so the record refuses
// a repeat rather than a lock preventing one.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(R, 'netlify/functions/stripe-webhook.js'), 'utf8');
// Comment-stripped: this file's own prose names the things it forbids, and a
// naive search finds them in the explanation and passes either way.
const bare = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('[the only non-200 is a bad signature]');
H.ok(/return json\(400, \{ error: 'Bad signature' \}\)/.test(bare),
  'a failed signature answers 400 — an unverified body is not from Stripe');
// Every OTHER path must end 200. A 5xx is what makes Stripe retry for days.
const handler = bare.slice(bare.indexOf('exports.handler'), bare.indexOf('async function settle'));
const codes = (handler.match(/json\((\d{3})/g) || []).map((s) => s.slice(5));
H.eq(codes.filter((c) => c === '500').length, 1,
  'exactly one 500, and it is the missing-secret case — a misconfiguration, not an event');
H.ok(/return json\(200, \{ received: true \}\)/.test(handler),
  'the handler ends by acknowledging');
H.ok(/catch[\s\S]{0,200}console\.error[\s\S]{0,120}\n\s*\}\n\s*return json\(200/.test(handler),
  'and a thrown handler is caught and STILL acknowledged — retries are worse than a miss');

console.log('\n[the signature is checked on the raw body]');
H.ok(/constructEvent\(raw, sig, secret\)/.test(bare), 'constructEvent gets the raw string');
H.ok(/isBase64Encoded[\s\S]{0,120}Buffer\.from/.test(bare),
  'base64 bodies are decoded rather than parsed — re-serialising JSON changes the bytes');
H.ok(!/JSON\.parse\(event\.body/.test(bare),
  'and event.body is never JSON.parsed before verification, which would break the signature');

console.log('\n[the organisation check comes first, and reads the tag alone]');
const settle = bare.slice(bare.indexOf('async function settle'));
const firstStatement = settle.slice(0, settle.indexOf('\n', settle.indexOf('isOurs')));
H.ok(/if \(!S\.isOurs\(session\)\) return;/.test(firstStatement),
  'settle() returns immediately unless the event is ours');
const beforeCheck = settle.slice(0, settle.indexOf('isOurs'));
H.ok(!/getRegistration|saveRegistration/.test(beforeCheck),
  'and NOTHING touches the store before that check — not even a read');
// The tag, never the shape. Inferring "this looks like one of ours" is exactly
// how the sister site ends up firing its pipeline at an Ogen parent.
H.ok(!/metadata\.(?!organization)/.test(settle.replace(/registrationRef|isOurs/g, '')),
  'settle() reads no metadata of its own — _stripe.js owns that');

console.log('\n[Stripe\'s figure is the authority, never ours]');
H.ok(/Number\(session\.amount_total\)/.test(bare), 'the amount comes from session.amount_total');
// The rule is about the SETTLED AMOUNT, not about arithmetic in general. The
// receipt legitimately computes what is still outstanding from the record —
// that is a figure to display, not a figure to bank. What must never happen is
// the amount CREDITED being derived from the record it is being credited to,
// which would make the check circular and settle any payment as "correct".
const centsLine = (bare.match(/const cents = [^;]+;/) || [''])[0];
H.ok(/session\.amount_total/.test(centsLine),
  'the settled amount comes from Stripe: ' + centsLine.trim());
H.ok(!/owedCents|paidCents|reg\./.test(centsLine),
  'and nothing in it is read from the registration being credited');
H.ok(/if \(!\(cents > 0\)\)/.test(bare), 'a zero or missing amount settles nothing');

console.log('\n[a repeat delivery counts once]');
H.ok(/settledSessions/.test(bare), 'the record carries the sessions it has counted');
H.ok(/settled\.indexOf\(session\.id\) !== -1\) return;/.test(bare),
  'and a session already in the list returns without writing');
H.ok(/settledSessions: settled\.concat\(\[session\.id\]\)/.test(bare),
  'a new one is appended rather than replacing the list');
// The check must come BEFORE the write, which is the only ordering that works.
H.ok(bare.indexOf('settled.indexOf') < bare.indexOf('saveRegistration'),
  'the idempotency check precedes the save');

console.log('\n[a part payment does not read as settled]');
// The same rule admin-registrations.js applies when an admin records a payment
// by hand. Two ways in, one rule about what "paid" means — a part payment
// reading as settled is a debt nobody chases.
const admin = fs.readFileSync(path.join(R, 'netlify/functions/admin-registrations.js'), 'utf8');
const rule = /status: next\.payment\.owedCents != null && paid >= next\.payment\.owedCents \? 'paid' : 'owed'/;
H.ok(rule.test(bare), 'the webhook settles to paid only when the total covers what was billed');
H.ok(rule.test(admin), 'and the admin path uses the identical rule, character for character');

console.log('\n[an unattributable payment is escalated, not guessed at]');
H.ok(/registrationRef\(session\)/.test(bare), 'the join keys come from the metadata');
H.ok(/if \(!ref\)[\s\S]{0,260}console\.error/.test(bare),
  'a payment that cannot name its registration is logged loudly and left for a person');
H.ok(!/forActivity|forParticipant/.test(bare),
  'and is never matched by scanning registrations for one with the right amount');

H.done();
