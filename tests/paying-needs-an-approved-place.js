// What this defends against:
//
// ONE GATE STANDS IN FRONT OF TAKING A FAMILY'S MONEY: the place must be
// approved. A `pending` registration is a request that may still be refused.
// Taking money for it means an immediate refund and a family wondering what
// happened — and on a store with no compare-and-swap, a refund racing a
// rejection is a bad afternoon. How it reached `approved` does not matter:
// auto-approval and an admin pressing the button produce the same status, which
// is the whole point of the status being the single source of truth.
//
// ⚠ THERE WAS A SECOND GATE — A CONFIRMED EMAIL ADDRESS — AND IT IS GONE. This
// suite now pins its ABSENCE, because it is the kind of thing somebody
// reinstates in good faith.
//
// It read as a security property and was not one. It never protected anything
// on the paying direction: this is a person signed into their own account
// settling their own bill, and an unverified address grants them nothing extra.
// What it was stated to buy — that messages about money reach an address
// somebody has proved is theirs — was already untrue, because the registration
// confirmation goes to that same unverified address minutes earlier. And it was
// already bypassable BY DESIGN: /pay is a link we ourselves email, deliberately
// exempt, on the reasoning that reading the inbox is what verification ever
// attested. A gate with a door we post through is not a gate.
//
// What it did cost was the only flow that ever hit it: sign up, register, pay,
// in one sitting — which is exactly the shape of a pay-per-session activity,
// where the whole decision is "we will come on Tuesday".
//
// Verification still exists, is still asked for, and is still shown on the
// dashboard. It is simply not what stands between a family and paying us, and
// the assertions below check both halves of that.
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
H.ok(pay.indexOf('mustGuard') < pay.indexOf('getRegistration'),
  'and before the store is read — a stranger must not learn a registration exists');

console.log('\n[there is NO verification gate, on any door that takes money]');
// All three: the term button, one session, and the one-step drop-in that
// registers and pays in a single call.
const paySession = bare.slice(bare.indexOf("case 'paySession'"), bare.indexOf("case 'cancelSession'"));
const bookAndPay = bare.slice(bare.indexOf("case 'bookAndPay'"), bare.indexOf("case 'cancelSession'"));
H.ok(paySession.length > 300 && bookAndPay.length > 600, 'found the other two branches');
[['pay', pay], ['paySession', paySession], ['bookAndPay', bookAndPay]].forEach(([name, branch]) => {
  H.ok(!/emailVerifiedAt/.test(branch), name + ' does not ask whether the address was confirmed');
  H.ok(!/email-unverified/.test(branch), name + ' has no unverified refusal to return');
});
// ...and the emailed link never did, which is the argument the removal rests on.
const payLink = fs.readFileSync(path.join(R, 'netlify/functions/pay-link.js'), 'utf8');
H.ok(!/emailVerifiedAt/.test(payLink.replace(/^\s*\/\/.*$/gm, '')),
  'and /pay — a link we email — never checked it either, by design');

console.log('\n[but verification itself is untouched]');
// Removing the gate must not quietly remove the feature. It is still set, still
// requestable, and the dashboard still says when it is missing.
const store = fs.readFileSync(path.join(R, 'netlify/functions/_account-store.js'), 'utf8');
H.ok(/account\.emailVerifiedAt = new Date\(\)\.toISOString\(\)/.test(store),
  'markEmailVerified() still stamps the field');
const auth = fs.readFileSync(path.join(R, 'netlify/functions/account-auth.js'), 'utf8');
H.ok(/case 'resendVerification'/.test(auth), 'a family can still ask for a new verification mail');
const client = fs.readFileSync(path.join(R, 'js/member-account.js'), 'utf8');
H.ok(/resendVerification/.test(client), 'and the dashboard still offers it');
H.ok(/!account\.emailVerifiedAt/.test(client), 'and still says so when the address is unconfirmed');

console.log('\n[gate 2: the place must be approved]');
H.ok(/if \(reg\.status !== 'approved'\)/.test(pay), 'only an approved registration is payable');
H.ok(/reason: 'not-approved'/.test(pay), 'with a reason and the actual status');
// AUTO-APPROVED COUNTS. Nothing here may ask HOW it was approved.
H.ok(!/autoApproved/.test(pay),
  'and nothing asks whether it was auto-approved — the status is the single source of truth');
H.ok(pay.indexOf('mustGuard') < pay.indexOf("!== 'approved'"),
  'and the guardian link is checked before the status');

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
H.ok(/unit_amount: l\.amountCents/.test(checkout), 'and the computed figure is what Stripe is told');
// There are two debts now — a term and one evening — and they go through ONE
// builder, so the currency, the descriptor and the organisation tag cannot
// drift between them. A drop-in registration owes nothing at all, so without the
// second wrapper a family could book an evening and had no way to settle it.
H.eq((checkout.match(/checkout\.sessions\.create/g) || []).length, 1,
  'through one builder, however many kinds of debt call it');
H.ok(/ogen_kind: 'session'/.test(checkout) && /session_dates: list\.map/.test(checkout),
  'and a session payment carries its DATES, so the webhook settles the right blobs');

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

console.log('\n[the client offers the button under the same one condition]');
// Cosmetic, like every permission check on this side — the server re-decides
// it. It exists so a family is not offered an action about to be refused, and
// so a REFUSAL THEY CAN ACT ON is explained rather than hidden.
const ui = fs.readFileSync(path.join(R, 'js/member-account.js'), 'utf8');
H.ok(/action: 'pay', participantId: r\.participantId, activityId: r\.activityId/.test(ui),
  'the client calls the pay action with the registration key');
H.ok(/left > 0 && r\.status === 'approved'\) \{/.test(ui),
  'and draws the button when the place is approved and something is owed');
H.ok(!/emailVerifiedAt/.test(ui.slice(ui.indexOf('THE PAY BUTTON'))),
  'with no verification condition left anywhere below it');
H.ok(!/payNeedsVerify/.test(ui),
  'and the string that explained that refusal is deleted rather than left orphaned');
H.ok(/T\.payNeedsApproval/.test(ui), 'a place still waiting on approval is TOLD, not silently denied a button');
// Checkout is a redirect. If the call fails the control must come back, or a
// transient error leaves a dead button and a family who cannot pay.
H.ok(/go\.disabled = false;[\s\S]{0,80}go\.textContent = T\.payNow;/.test(ui),
  'a failed attempt re-enables the button rather than leaving it spent');
H.ok(/location\.href = res\.data\.url/.test(ui), 'and a success redirects to Stripe');

H.done();
