// What this defends against:
//
// Two gates stand in front of taking a family's money, and both exist because
// of what happens when money moves and shouldn't have.
//
// 1. THE ACCOUNT MUST BE VERIFIED. `emailVerifiedAt` has been stored since
//    Phase 2, shown as a banner on the dashboard since Phase 6, and ENFORCED BY
//    NOTHING. This is the first place in the system that acts on it. Payment is
//    the right place to start: the receipt, and every later message about money,
//    goes to an address nobody has proved belongs to this person. If that
//    address is a typo, a family pays and hears nothing — and the person who
//    does hear is a stranger.
//
//    It must not be a dead end, which is why the refusal carries a reason the
//    client can act on: the dashboard already has a resend button.
//
// 2. THE PLACE MUST BE APPROVED. A `pending` registration is a request that may
//    still be refused. Taking money for it means an immediate refund and a
//    family wondering what happened — and on a store with no compare-and-swap,
//    a refund racing a rejection is a bad afternoon. How it reached `approved`
//    does not matter: auto-approval and an admin pressing the button produce
//    the same status, which is the whole point of the status being the single
//    source of truth.
//
// And the amount is computed server-side. An amount in a request body is an
// amount somebody can edit before sending it.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(R, 'netlify/functions/account-registrations.js'), 'utf8');
const bare = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const pay = bare.slice(bare.indexOf("case 'pay'"), bare.indexOf("case 'balance'"));
H.ok(pay.length > 400, 'found the pay branch');

console.log('[the guardian link is checked before anything else]');
// Same rule as every other branch here: owning one child grants nothing about
// another, and the check is the FIRST thing, not a later filter.
H.ok(/^\s*case 'pay': \{\s*const participant = await mustGuard\(body\.participantId\);/m.test(pay),
  'mustGuard runs first');
H.ok(pay.indexOf('mustGuard') < pay.indexOf('emailVerifiedAt'),
  'and before the verification gate — a stranger must not learn a registration exists');

console.log('\n[gate 1: the account must be verified]');
H.ok(/if \(!me\.emailVerifiedAt\)/.test(pay), 'unverified accounts are refused');
H.ok(/reason: 'email-unverified'/.test(pay), 'with a machine-readable reason, so the client can offer the resend');
H.ok(/json\(403/.test(pay), 'as a 403 — it is a permission, not a missing thing');
// The field must be the one the rest of the system writes.
const store = fs.readFileSync(path.join(R, 'netlify/functions/_account-store.js'), 'utf8');
H.ok(/account\.emailVerifiedAt = new Date\(\)\.toISOString\(\)/.test(store),
  'and it is the same field markEmailVerified() sets');
// The escape hatch has to exist or the gate is a wall.
const auth = fs.readFileSync(path.join(R, 'netlify/functions/account-auth.js'), 'utf8');
H.ok(/case 'resendVerification'/.test(auth), 'a blocked family can request a new verification mail');
const client = fs.readFileSync(path.join(R, 'js/member-account.js'), 'utf8');
H.ok(/resendVerification/.test(client), 'and the dashboard offers it');

console.log('\n[gate 2: the place must be approved]');
H.ok(/if \(reg\.status !== 'approved'\)/.test(pay), 'only an approved registration is payable');
H.ok(/reason: 'not-approved'/.test(pay), 'with a reason and the actual status');
// AUTO-APPROVED COUNTS. Nothing here may ask HOW it was approved.
H.ok(!/autoApproved/.test(pay),
  'and nothing asks whether it was auto-approved — the status is the single source of truth');
H.ok(pay.indexOf('emailVerifiedAt') < pay.indexOf("!== 'approved'"),
  'the cheap check runs before the store read');

console.log('\n[the amount is ours, not the browser\'s]');
// ⚠ AND IT IS BUILT IN ONE PLACE. There are two doors to this payment now — the
// button on the family's own page and an emailed link that needs no password —
// and they must charge the same amount against the same metadata with the same
// descriptor. Two copies would be two copies that can drift, and that drift
// surfaces as a family charged a figure nobody on this side can explain. So the
// assertions below read _checkout.js, and the last one in this block is that
// nothing else builds a session at all.
const checkout = fs.readFileSync(path.join(R, 'netlify/functions/_checkout.js'), 'utf8');
H.ok(/\(p\.owedCents \|\| 0\) - \(p\.paidCents \|\| 0\)/.test(checkout),
  'due = owedCents - paidCents, computed from the record');
H.ok(!/amount|cents/i.test((/function createCheckout\(([^)]*)\)/.exec(checkout) || [, ''])[1]),
  'and no amount is a parameter — this is reachable from an endpoint with no session');
H.ok(!/body\.amount|body\.cents|body\.amountCents/.test(pay + checkout),
  'nor is one ever read from a request body');
H.ok(/if \(!\(due > 0\)\)/.test(pay), 'nothing outstanding is refused rather than charged zero');
H.ok(/unit_amount: due/.test(checkout), 'and the computed figure is what Stripe is told');

console.log('\n[the session is tagged so a shared account can tell it apart]');
H.ok(/metadata: S\.meta\(/.test(checkout), 'metadata goes through S.meta, which always stamps the organisation');
H.eq((checkout.match(/S\.meta\(/g) || []).length, 2,
  'twice: on the session AND on payment_intent_data — a session-only tag is ' +
  'invisible on the PaymentIntent a dispute arrives attached to');
H.ok(/statement_descriptor_suffix: S\.STATEMENT_DESCRIPTOR_SUFFIX/.test(checkout),
  'and the descriptor suffix is set, or the charge reads as the other organisation');
H.ok(/participant_id: reg\.participantId/.test(checkout) && /activity_id: reg\.activityId/.test(checkout),
  'the join keys travel with it, so the webhook need not guess');

console.log('\n[the frozen title is what the payer sees]');
H.ok(/reg\.frozen && facts\.pick\(reg\.frozen\.activityTitle, lang\)/.test(checkout),
  'the FROZEN title, not the activity\'s current one — a rename must not change ' +
  'what a family sees on the payment they are making');

console.log('\n[and exactly one file builds a checkout session]');
const fnDir = path.join(R, 'netlify/functions');
const builders = fs.readdirSync(fnDir).filter((f) => f.endsWith('.js')).filter((f) =>
  /checkout\.sessions\.create/.test(fs.readFileSync(path.join(fnDir, f), 'utf8')));
H.eq(builders.join(','), '_checkout.js',
  'one, and it is the shared builder — a second would be a second amount to keep in step');

console.log('\n[a Stripe failure is a 502, not a crash]');
H.ok(/catch \(err\)[\s\S]{0,200}json\(502/.test(pay), 'a failed session creation answers 502');
H.ok(!/json\(200[\s\S]*catch/.test(pay.slice(pay.indexOf('try {'))),
  'and nothing claims success on the way out of the catch');

console.log('\n[the receipt is best effort; the settlement is not]');
const hook = fs.readFileSync(path.join(R, 'netlify/functions/stripe-webhook.js'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
H.ok(hook.indexOf('saveRegistration') < hook.indexOf('sendPaid'),
  'the record is written BEFORE the email — a payment not recorded loses money nobody can trace');
H.ok(/catch \(err\)[\s\S]{0,160}receipt not sent/.test(hook),
  'and a failed send is swallowed rather than taking the settlement down with it');
H.ok(/Math\.max\(0, owedCents - paid\)/.test(hook),
  'the outstanding figure is computed from the record, so the email and the record agree');

console.log('\n[the receipt exists in all three languages and says what is left]');
process.env.RESEND_FROM = process.env.RESEND_FROM || 'Ogen <noreply@ogen.cy>';
const mail = require(H.fnPath('_registration-email'));
const reg = { participantId: 'p-1', activityId: 'act-1',
  frozen: { participantName: 'נועה', activityTitle: { he: 'עברית', en: 'Hebrew', ru: 'Иврит' } } };
['he', 'en', 'ru'].forEach((l) => {
  const acct = { email: 'd@example.com', profile: { preferredLanguage: l } };
  const part = mail.paidMessage(reg, acct, 15000, 20000);
  const full = mail.paidMessage(reg, acct, 35000, 0);
  H.ok(part.subject && part.html && part.text, l + ': a part payment renders');
  H.ok(full.subject && full.html && full.text, l + ': a settled payment renders');
  H.ok(part.html !== full.html, l + ': and the two say different things');
  H.ok(part.html.indexOf('200.00') !== -1, l + ': a part payment states what is still owed');
  // A receipt must open the page that shows what is paid — the family's own
  // registration page, addressed by participant and activity id, which is the
  // registration's key. NEVER the frozen slug: that is audit data, and
  // following it after a rename opens the wrong record or none, and tells a
  // family their registration does not exist.
  //
  // ⚠ AND IN THE SPELLING THE PAGE READS. This assertion used to pin
  // `?participantId=…&activityId=…`, which is the API's spelling and is not
  // what `js/member-account.js` looks for — it reads `p` and `a`, so every one
  // of these links landed on "that registration was not found" while a test
  // sat here calling the format correct. A test that reads one half of a link
  // proves nothing about the link. See the suite below, which compares the two
  // sides instead of describing one.
  H.ok(/\/account\/activity\?p=p-1&amp;a=act-1#pay/.test(part.html),
    l + ': and links to the registration, addressed by id');
});

console.log('\n[the client offers the button under the same two conditions]');
// Cosmetic, like every permission check on this side — the server re-decides
// all of it. It exists so a family is not offered an action about to be
// refused, and so a REFUSAL THEY CAN FIX is explained rather than hidden: a
// missing button teaches nobody that their email needs confirming.
const ui = fs.readFileSync(path.join(R, 'js/member-account.js'), 'utf8');
H.ok(/action: 'pay', participantId: r\.participantId, activityId: r\.activityId/.test(ui),
  'the client calls the pay action with the registration key');
H.ok(/left > 0 && r\.status === 'approved' && S\.account && S\.account\.emailVerifiedAt/.test(ui),
  'and draws the button only when both gates pass and something is owed');
H.ok(/T\.payNeedsVerify/.test(ui), 'an unverified account is TOLD, not silently denied a button');
H.ok(/T\.payNeedsApproval/.test(ui), 'and so is one still waiting on approval');
// Checkout is a redirect. If the call fails the control must come back, or a
// transient error leaves a dead button and a family who cannot pay.
H.ok(/go\.disabled = false;[\s\S]{0,80}go\.textContent = T\.payNow;/.test(ui),
  'a failed attempt re-enables the button rather than leaving it spent');
H.ok(/location\.href = res\.data\.url/.test(ui), 'and a success redirects to Stripe');
// S.account has to be populated before the activity view renders, or the gate
// reads undefined and hides the button from a verified family.
H.ok(/S\.account = res\.data\.account;[\s\S]{0,600}if \(view === 'activity'\) return renderActivity\(\);/.test(ui),
  'boot() sets S.account before rendering the activity view');

H.done();
