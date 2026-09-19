// What this defends against:
//
// TWO GATES STAND IN FRONT OF TAKING A FAMILY'S MONEY, and one of them applies
// to only half the activities.
//
// 1. THE PLACE MUST BE APPROVED, always. A `pending` registration is a request
//    that may still be refused. Taking money for it means an immediate refund
//    and a family wondering what happened — and on a store with no
//    compare-and-swap, a refund racing a rejection is a bad afternoon. How it
//    reached `approved` does not matter: auto-approval and an admin pressing the
//    button produce the same status, which is the whole point of the status
//    being the single source of truth.
//
// 2. A COURSE NEEDS A CONFIRMED ADDRESS; A DROP-IN DOES NOT.
//
// ⚠ THAT SPLIT IS THE PART THIS SUITE EXISTS FOR, because it has been wrong in
// both directions inside a week.
//
// It was on everything first. `emailVerifiedAt` had been stored since Phase 2,
// shown as a banner since Phase 6 and enforced by nothing, and payment was where
// it was finally enforced — which turned out to refuse exactly one flow and no
// others: sign up, register, pay, in one sitting. That is not an edge case on a
// pay-per-session activity, it is the ONLY case. A walk-up decision made and
// paid for in a single visit is what a drop-in is.
//
// Then it came off everything, which was too far the other way. A term is a
// considered commitment — hundreds of euros, months of attendance, a place an
// admin agreed to — and it can carry a minute of friction once, in exchange for
// a receipt and every later message about that money reaching an address
// somebody has proved is theirs.
//
// So the rule is the activity's shape, it lives in ONE function, and the
// assertions below check both halves of it and the direction a blank falls.
//
// And the amount is computed server-side. An amount in a request body is an
// amount somebody can edit before sending it.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(R, 'netlify/functions/account-registrations.js'), 'utf8');
const bare = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
// ⚠ BOUNDED BY `default:`, not by the action that used to follow. It was sliced
// to "case 'balance'", and when that action was retired indexOf returned -1 —
// so the slice silently became the whole rest of the file and every assertion
// below started reading code it was not about. A test that cannot find its
// subject must not quietly widen to everything.
const payStart = bare.indexOf("case 'pay'");
const payEnd = bare.indexOf('default:', payStart);
H.ok(payStart !== -1 && payEnd > payStart, 'the pay branch and its end were both found');
const pay = bare.slice(payStart, payEnd);
H.ok(pay.length > 400, 'found the pay branch');

console.log('[the guardian link is checked before anything else]');
// Same rule as every other branch here: owning one child grants nothing about
// another, and the check is the FIRST thing, not a later filter.
H.ok(/^\s*case 'pay': \{\s*const participant = await mustGuard\(body\.participantId\);/m.test(pay),
  'mustGuard runs first');
H.ok(pay.indexOf('mustGuard') < pay.indexOf('getRegistration'),
  'and before the store is read — a stranger must not learn a registration exists');

console.log('\n[the verification gate is a COURSE rule, decided in one place]');
const bare2 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const helper = bare2.slice(bare2.indexOf('function verificationRefusal'),
                           bare2.indexOf('function regRow'));
H.ok(helper.length > 80, 'there is one verificationRefusal()');
H.ok(/if \(type === 'dropin'\) return null;/.test(helper), 'a drop-in is never asked');
H.ok(/if \(me\.emailVerifiedAt\) return null;/.test(helper), 'and a confirmed address passes');
H.ok(/reason: 'email-unverified'/.test(helper), 'the refusal carries a reason the client can act on');
H.ok(/json\(403/.test(helper), 'as a 403 — it is a permission, not a missing thing');
// ONE function, or the condition is written at three call sites and the third
// one is added later without it.
H.eq((bare2.match(/emailVerifiedAt/g) || []).length, 1,
  'and the field is read in exactly one place in the whole file');

console.log('\n[and every paying branch is wired to it, or provably cannot need it]');
const paySession = bare2.slice(bare2.indexOf("case 'paySession'"), bare2.indexOf("case 'cancelSession'"));
const bookAndPay = bare2.slice(bare2.indexOf("case 'bookAndPay'"), bare2.indexOf("case 'paySession'"));
H.ok(paySession.length > 300 && bookAndPay.length > 600, 'found the other two branches');
// A course: from the FROZEN type on the record, which is what the family
// registered under — and this branch never opens the activity at all.
H.ok(/verificationRefusal\(me, \(reg\.frozen && reg\.frozen\.type\) \|\| 'course'\)/.test(pay),
  'pay asks, from the frozen type on the registration');
H.ok(pay.indexOf('verificationRefusal') < pay.indexOf('isPayable'),
  'and the cheap check runs before the status one');
// ⚠ A MISSING TYPE READS AS `course`. This inverts the usual rule in this
// project, where every blank resolves towards the family — and deliberately: a
// record with no type was written before drop-ins existed, so it IS a course,
// and the errors are not symmetric. Guessing drop-in skips a gate somebody
// asked for; guessing course costs one verification email.
H.ok(/\|\| 'course'/.test(pay), 'with a blank falling to the gated side, not the open one');
// Present today only so a future course-by-the-session inherits the rule
// instead of it being something somebody has to remember.
H.ok(/verificationRefusal\(me, activity\.type\)/.test(paySession),
  'paySession asks too, from the activity it was called for');
// And the one-step drop-in does not, because the line above it has already
// refused everything that is not a drop-in.
H.ok(!/verificationRefusal/.test(bookAndPay),
  'bookAndPay does not — the flow the gate used to block is the flow it is exempt from');
H.ok(/activity\.type !== 'dropin'/.test(bookAndPay),
  'and it is exempt BY CONSTRUCTION: it refuses anything that is not a drop-in first');
// The emailed link never asked, and that exemption is the argument the whole
// split rests on — following it is itself proof of reading the inbox.
const payLink = fs.readFileSync(path.join(R, 'netlify/functions/pay-link.js'), 'utf8');
H.ok(!/emailVerifiedAt/.test(payLink.replace(/^\s*\/\/.*$/gm, '')),
  'and /pay — a link we email — never checked it, by design');

console.log('\n[verification itself is untouched either way]');
const store = fs.readFileSync(path.join(R, 'netlify/functions/_account-store.js'), 'utf8');
H.ok(/account\.emailVerifiedAt = new Date\(\)\.toISOString\(\)/.test(store),
  'markEmailVerified() still stamps the field');
const auth = fs.readFileSync(path.join(R, 'netlify/functions/account-auth.js'), 'utf8');
H.ok(/case 'resendVerification'/.test(auth), 'a family can still ask for a new verification mail');
const client0 = fs.readFileSync(path.join(R, 'js/member-account.js'), 'utf8');
H.ok(/resendVerification/.test(client0), 'and the dashboard still offers it');
H.ok(/!account\.emailVerifiedAt/.test(client0), 'and still says so when the address is unconfirmed');

console.log('\n[gate 2: the place must be a LIVE one — and pending counts]');
// ⚠ IT WAS `approved` ONLY, AND THAT PRODUCED A BILL WITH NO BUTTON. A family's
// cost card read "Still to pay  €500.00" with nothing under it but the sentence
// "We will send you a payment link shortly" — a link that, on a manually
// approved activity, exists only once an admin reaches the queue. It also
// contradicted the copy above it: `pending` and `approved` both read
// "registered" to a family on purpose, so one told they are registered and
// shown what they owe must be able to settle it.
//
// ONE LIST, BOTH DOORS. The signed-in action and the emailed link must never
// disagree about what is chargeable, so neither compares a status itself.
H.ok(/if \(!checkout\.isPayable\(reg\)\)/.test(pay),
  'the pay action asks isPayable() rather than comparing a status of its own');
H.ok(/reason: 'not-approved'/.test(pay), 'with a reason and the actual status');
H.ok(/if \(!isPayable\(reg\)\) return refuse\(lang, 'not-approved', reg\)/.test(payLink),
  'and so does /pay — which matters there too: a receipt for a part payment on a '
  + 'pending registration mints a link that would otherwise be dead on arrival');
const payable = (/const PAYABLE_STATUSES = \[([^\]]*)\]/.exec(
  fs.readFileSync(path.join(R, 'netlify/functions/_checkout.js'), 'utf8')) || [, ''])[1];
H.ok(/'pending'/.test(payable) && /'approved'/.test(payable), 'the list is pending and approved');
['rejected', 'expired', 'cancelled'].forEach((st) => {
  H.ok(payable.indexOf("'" + st + "'") === -1, st + ' is not payable — there is no place to pay for');
});
// AUTO-APPROVED COUNTS. Nothing here may ask HOW it was approved.
H.ok(!/autoApproved/.test(pay),
  'and nothing asks whether it was auto-approved — the status is the single source of truth');
H.ok(pay.indexOf('mustGuard') < pay.indexOf('isPayable'),
  'and the guardian link is checked before the status');

console.log('\n[and the new state that opens is GUARDED, not ignored]');
// A paid PENDING registration an admin then wants to refuse. Rejecting it would
// leave us holding the money with nothing in the record saying we owe it back —
// the family has no place, so nothing bills it and nothing ever asks. The
// refusal names the route that does account for it.
const adminRegs = fs.readFileSync(path.join(R, 'netlify/functions/admin-registrations.js'), 'utf8');
H.ok(/if \(status === 'rejected'\) \{\s*\n\s*const refusal = paidRefusal\(reg\);/.test(adminRegs),
  'rejecting a registration that is holding money is refused');
H.ok(/reason: 'paid-not-refunded'/.test(adminRegs), 'with a reason a screen can act on');
H.ok(/amountCents: held/.test(adminRegs), 'and the figure, so the refusal can name it');
H.ok(/Cancel it instead/.test(adminRegs),
  'and it names cancelling, which credits the family through the ledger');
// creditedCents comes OFF, because credit already given back is money no longer
// held — the opposite of dueCents(), where it is already inside paidCents.
H.ok(/paidCents\) \|\| 0\)\s*\n\s*- \(\(reg\.payment && reg\.payment\.creditedCents\)/.test(adminRegs),
  'and what is held is paid minus credited, not paid alone');
// ⚠ ASKED AT THE DRAFT TOO. The send is refused either way; an admin told at the
// top has not yet written a paragraph explaining a decision they cannot take.
const preview = adminRegs.slice(adminRegs.indexOf("case 'rejectPreview'"),
                                adminRegs.indexOf("case 'approve'"));
H.ok(preview.length > 200 && /const paid = paidRefusal\(reg\);/.test(preview),
  'and the rejection DRAFT asks the same question before it is written');
H.eq((adminRegs.match(/paid-not-refunded/g) || []).length, 1,
  'through one builder, so the two cannot disagree about the figure or the wording');
// It must not block the decision that DOES handle money.
H.ok(!/if \(status === 'cancelled' && held > 0\)/.test(adminRegs),
  'cancelling is deliberately not blocked — it is the route the refusal points at');

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

console.log('\n[the client draws the same split, from the same field]');
// Cosmetic, like every permission check on this side — the server re-decides it.
// It exists so a family is not offered an action about to be refused, and so a
// REFUSAL THEY CAN ACT ON is explained rather than hidden.
const ui = fs.readFileSync(path.join(R, 'js/member-account.js'), 'utf8');
H.ok(/action: 'pay', participantId: r\.participantId, activityId: r\.activityId/.test(ui),
  'the client calls the pay action with the registration key');
H.ok(/var needsVerify = r\.type !== 'dropin' && !\(S\.account && S\.account\.emailVerifiedAt\)/.test(ui),
  'the term card asks for a confirmed address, and only on a term');
H.ok(/var payable = r\.status === 'approved' \|\| r\.status === 'pending';/.test(ui),
  'the client reads the same two statuses the server does');
H.ok(/left > 0 && payable && !needsVerify/.test(ui),
  'and draws the button when both gates pass and something is owed');
// ⚠ THE SAME FIELD AS THE SERVER. regRow() sends the FROZEN type, defaulting to
// course — if the client read anything else it would hide a button the server
// would have honoured, which reads as a broken page rather than as a rule.
const api = fs.readFileSync(path.join(R, 'netlify/functions/account-registrations.js'), 'utf8');
H.ok(/type: reg\.frozen\.type \|\| 'course'/.test(api),
  'and that field is the frozen type, with the same default on both sides');
H.ok(/T\.payNeedsVerify/.test(ui), 'an unverified account is TOLD, not silently denied a button');
// And there is no longer anything to say about waiting for approval, because
// waiting no longer stops anyone paying. The key is DELETED rather than left
// unreferenced in three languages — an orphan is dead copy indistinguishable
// from a key whose only caller was renamed.
H.ok(!/payNeedsApproval/.test(ui), 'the "a link is coming" line is gone from all three tables');
// The per-session button is the drop-in half, and must NOT ask.
const evening = ui.slice(ui.indexOf('function eveningAction'));
H.ok(!/emailVerifiedAt/.test(evening.slice(0, evening.indexOf('cancelSession'))),
  'paying for one session asks for no confirmed address — that is the walk-up half');
// Checkout is a redirect. If the call fails the control must come back, or a
// transient error leaves a dead button and a family who cannot pay.
H.ok(/go\.disabled = false;[\s\S]{0,80}go\.textContent = T\.payNow;/.test(ui),
  'a failed attempt re-enables the button rather than leaving it spent');
H.ok(/location\.href = res\.data\.url/.test(ui), 'and a success redirects to Stripe');

H.done();
