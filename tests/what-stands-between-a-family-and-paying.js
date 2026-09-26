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
// 2. THE ADDRESS MUST BE CONFIRMED, for everything.
//
// ⚠ THAT RULE IS THE PART THIS SUITE EXISTS FOR, because it has been wrong in
// three directions now.
//
// It was on everything first, and asked ONLY AT PAYMENT. That turned out to
// refuse exactly one flow and no others: sign up, register, pay, in one sitting
// — which on a pay-per-session activity is not an edge case, it is the case.
//
// Then it came off everything, which was too far the other way. A term is a
// considered commitment and can carry a minute of friction once, in exchange
// for every later message about that money reaching an address somebody has
// proved is theirs.
//
// ⚠ THEN IT EXEMPTED DROP-INS, AND THAT WAS THE LAST WRONG ANSWER. QA registered
// and paid for a drop-in on an account nobody had confirmed and asked whether
// that was meant to be possible. The exemption was argued on FRICTION — a
// walk-up is decided in one sitting — and the thing it was trading away is not
// convenience: we store a MINOR'S NAME AND DATE OF BIRTH against that address,
// in the EU, and send the booking, the receipt and every reminder to it. A class
// on Tuesday stores exactly the record a term does.
//
// So there is one rule, in one function, and ⚠ THE FUNCTION TAKES NO TYPE. That
// is the half worth pinning: a rule with a type in it is a rule each call site
// can get wrong, and one call site already had no check at all because the
// exemption made it unreachable. With no parameter there is nothing to leave
// out, and a door added tomorrow inherits the rule instead of remembering it.
//
// ⚠ AND IT IS ASKED AT THE FRONT, not at payment. Asked only at payment it let a
// family register, wait days for an admin to answer, open the email saying they
// had a place, and meet the wall there — friction discovered after the
// commitment rather than before it, which reads as a system that changed its
// mind.
//
// The gates at payment STAY, and are not redundant. A registration taken before
// this existed sits on an unverified account already, and the client is hostile
// by assumption. What changed is that they now almost never fire.
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

console.log('\n[the verification gate is one rule, with no type in it]');
const bare2 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const helper = bare2.slice(bare2.indexOf('function verificationRefusal'),
                           bare2.indexOf('function regRow'));
H.ok(helper.length > 80, 'there is one verificationRefusal()');
H.ok(/function verificationRefusal\(me\) \{/.test(helper),
  '⚠ it takes ONE argument — no type, so no call site can apply a narrower rule ' +
  'than the others, and none can forget to pass one');
H.ok(!/dropin/.test(helper), 'and nothing in it knows what kind of activity this is');
H.ok(/me\.emailVerifiedAt \? null : 'email-unverified'/.test(helper),
  'a confirmed address passes and nothing else does');
// ⚠ IT ANSWERS WITH A KEY, NOT A RESPONSE. It is called from two actions and
// has no language of its own, so the caller renders it — in the language of the
// page, like every other string this file puts on a screen.
H.ok(/'email-unverified'/.test(helper), 'the refusal names itself');
// ⚠ FIVE CALL SITES, AND THE COUNT IS PINNED BECAUSE THREE OF THEM WERE MISSING.
//
// `useCredit` settles the same debt on the same record and writes the same
// payment status, and it asked NEITHER of the two questions `pay` asks — so an
// account whose address was never confirmed settled a term with credit, on a
// card where the pay button had been correctly withheld for exactly that
// reason. Spending credit is paying; the only difference is which pocket.
//
// `submit` is the one a family meets first. And `bookAndPay` is the fifth: it
// had no check at all, because the exemption made one unreachable — so the one
// flow with no confirmed address was also the one flow that wrote a child's
// record and then took money.
H.eq((bare2.match(/no\(403, refusal, \{ reason: 'email-unverified' \}\)/g) || []).length, 5,
  'and every call site answers 403 with the reason the client acts on — ' +
  'a permission, not a missing thing');

// ⚠ REGISTERING IS ASKED FIRST, AND BEFORE ANYTHING IS WRITTEN. A refusal that
// came after openRegistration() would leave the record it was refusing.
const submit = bare2.slice(bare2.indexOf("case 'submit'"), bare2.indexOf("case 'cancel'"));
H.ok(submit.length > 300, 'found the submit branch');
H.ok(/verificationRefusal\(me\)/.test(submit), 'submit asks');
H.ok(submit.indexOf('verificationRefusal') < submit.indexOf('openRegistration'),
  'and before a registration is opened, so a refusal leaves nothing behind');

// ⚠ AND THE DROP-IN DOOR ASKS TOO, BEFORE ANYTHING IS OPENED. This is the call
// site that did not exist: `bookAndPay` sits behind a line refusing everything
// that is not a drop-in, so while the gate stood aside for a drop-in the check
// here would have been unreachable — and this is the flow that registers, writes
// a child's name and date of birth, and opens Checkout in one request.
const bap = bare2.slice(bare2.indexOf("case 'bookAndPay'"), bare2.indexOf("case 'paySession'"));
H.ok(/verificationRefusal\(me\)/.test(bap), 'bookAndPay asks');
H.ok(bap.indexOf('verificationRefusal') < bap.indexOf('openRegistration'),
  'and before a registration is opened, so a refusal leaves nothing behind');
// ONE function, or the condition is written at three call sites and the third
// one is added later without it.
H.eq((bare2.match(/emailVerifiedAt/g) || []).length, 1,
  'and the field is read in exactly one place in the whole file');

console.log('\n[and every paying branch is wired to it, or provably cannot need it]');
const paySession = bare2.slice(bare2.indexOf("case 'paySession'"), bare2.indexOf("case 'cancelSession'"));
const bookAndPay = bare2.slice(bare2.indexOf("case 'bookAndPay'"), bare2.indexOf("case 'paySession'"));
H.ok(paySession.length > 300 && bookAndPay.length > 600, 'found the other two branches');
H.ok(/verificationRefusal\(me\)/.test(pay), 'pay asks');
H.ok(pay.indexOf('verificationRefusal') < pay.indexOf('isPayable'),
  'and the cheap check runs before the status one');
// ⚠ AND THERE IS NO LONGER A BLANK TO RESOLVE. The old rule read a missing type
// as `course`, which inverted this project's usual direction on purpose —
// guessing drop-in skipped a gate somebody asked for, guessing course cost one
// verification email. With one rule there is no type to be missing, which is a
// whole class of asymmetry that simply stops existing.
H.ok(!/'course'/.test(pay), 'no type is read, so no blank has to fall anywhere');
H.ok(/verificationRefusal\(me\)/.test(paySession), 'paySession asks');
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

console.log('\n[gate 2: the place must be APPROVED — pending is explained, not charged]');
// ⚠ THE ROUND TRIP IS THE POINT, and this suite is where it is pinned.
//
// `pending` was briefly payable, to fix a real bug: a cost card reading "Still
// to pay €500.00" with nothing under it but "We will send you a payment link
// shortly" — a link that, on a manually approved activity, exists only once an
// admin reaches the queue.
//
// The fix for a bill with no button was never to make it payable. `pending`
// arises ONLY when a person has something to decide, so paying then buys a place
// nobody has agreed to give — in every case, not an edge one. What the family
// gets instead is the waiting block, asserted below.
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
H.eq(payable.trim(), "'approved'", 'the list is approved and nothing else');
['pending', 'rejected', 'expired', 'cancelled'].forEach((st) => {
  H.ok(payable.indexOf("'" + st + "'") === -1, st + ' is not payable');
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
// ⚠ THROUGH descriptorSuffixFor(mode) RATHER THAN THE CONSTANT. A statement
// descriptor is what a CARDHOLDER reads on a bank statement, and a test payment
// never reaches one — so it is set on a live charge and deliberately left unset on
// a rehearsal. Asserting the constant was reachable only while there was one mode.
H.ok(/statement_descriptor_suffix: S\.descriptorSuffixFor\(mode\) \|\| undefined/.test(checkout),
  'and the descriptor suffix is set for the mode being charged, or the charge ' +
  'reads as the other organisation');
H.eq(require(H.fnPath('_stripe')).descriptorSuffixFor('live'), 'Ogen CTR',
  'live gets the suffix');
H.eq(require(H.fnPath('_stripe')).descriptorSuffixFor('test'), null,
  'and a rehearsal gets none — there is no statement for it to appear on');
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
H.ok(/catch \(err\)[\s\S]{0,260}no\(502, 'checkout-failed'\)/.test(pay),
  'a failed session creation answers 502');
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

console.log('\n[the client draws the same rule, from the same field]');
// Cosmetic, like every permission check on this side — the server re-decides it.
// It exists so a family is not offered an action about to be refused, and so a
// REFUSAL THEY CAN ACT ON is explained rather than hidden.
const ui = fs.readFileSync(path.join(R, 'js/member-account.js'), 'utf8');
H.ok(/action: 'pay', participantId: r\.participantId, activityId: r\.activityId/.test(ui),
  'the client calls the pay action with the registration key');
H.ok(/var needsVerify = !\(S\.account && S\.account\.emailVerifiedAt\);/.test(ui),
  'the cost card asks for a confirmed address, on both shapes');
H.ok(!/r\.type !== 'dropin'/.test(ui.replace(/^\s*\/\/.*$/gm, '')),
  '⚠ and the type is gone from the condition — a client reading a field the ' +
  'server has stopped reading hides a button the server would have honoured');
// Asked ONCE, above the branch that picks between the two register shapes, so a
// third shape inherits it rather than copying it.
const panelTail = ui.slice(ui.indexOf('if (a.perSession) registerPerSession'));
H.ok(!/emailVerifiedAt/.test(panelTail.slice(0, panelTail.indexOf('function costBlock'))) ||
     ui.indexOf('emailVerifiedAt') < ui.indexOf('if (a.perSession) registerPerSession'),
  'and the register panel asks it above the branch, not inside one arm of it');
H.ok(/var payable = r\.status === 'approved';/.test(ui),
  'the client reads the same single status the server does');
// ⚠ AND THE WAITING STATE IS ITS OWN BRANCH, not the absence of a button. A
// family shown what they owe and given nothing to press learns nothing from
// silence; this is where the words go.
H.ok(/else if \(left > 0 && r\.status === 'pending'\)/.test(ui),
  'a pending registration draws the waiting block');
H.ok(/class: 'acc-waiting'/.test(ui), 'with its own treatment, not a bare grey line');
H.ok(/lucide\(CHECK, '15'\)/.test(ui), 'a check — the registration IS done; the payment is the follow-on');
// The glyph itself, not the name of the constant holding it. Lucide's `check` is
// one polyline; anything else here would be a different icon wearing the name,
// and a clock in particular would say WAIT — the reading this block exists to
// prevent. Read off the source with comments stripped, or the prose explaining
// that decision trips the assertion asserting it.
H.eq((/var CHECK = '([^']*)'/.exec(ui) || [, ''])[1], 'M20 6 9 17l-5-5', 'and it is the check path');
H.ok(!/clock/i.test(ui.replace(/\/\/[^\n]*\n/g, '')), 'no clock anywhere in the client');
// It must not look pressable. Solid fill plus a full pill is what this codebase
// learned means "press me", so the block is tinted with an 8px radius instead.
const css = fs.readFileSync(path.join(R, 'shared.css'), 'utf8');
const waiting = (/\.acc-waiting\{([^}]*)\}/.exec(css) || [, ''])[1];
H.ok(/border-radius:8px/.test(waiting), 'the waiting block is not a pill');
H.ok(!/var\(--terracotta\)/.test(waiting), 'and carries none of the actionable colour');
H.ok(/var\(--olive\)/.test(waiting), 'olive, which is this site\'s "nothing is wrong"');
H.ok(/border-inline-start/.test(waiting) && !/border-left|border-right/.test(waiting),
  'and its rule is logical, so it mirrors with the page');
// ⚠ THE SEPARATE CONTRAST BUG, fixed in the same pass. White on --gold is
// 3.18:1, below AA for 12.5px bold text; the token is a background chosen to sit
// under white at DISPLAY sizes, and a pill is neither.
H.ok(!/background:var\(--gold\); color:#fff/.test(css),
  'no pill paints white on the raw gold token — 3.18:1, below AA for 12.5px bold');
H.ok(/\.acc-pill\.is-s-booked\{ background:#96651F/.test(css),
  'the booked pill is darkened along the same hue, so the gold reading survives');
// ⚠ AND THE TWO THAT SHARE A WORD NOW SHARE A COLOUR. `pending` and `approved`
// both render "Registered" on purpose; painted differently, a family saw one
// word in two colours with no legend anywhere — a colour nobody can decode is
// not information, it is our queue leaking onto their screen. The distinction
// surfaces where it is actionable, on the cost card.
H.ok(/\.acc-pill\.is-pending, \.acc-pill\.is-approved\{ background:var\(--olive\)/.test(css),
  'pending and approved are one rule, because they are one word');
const ui2 = ui.replace(/\/\/[^\n]*\n/g, '');
H.eq(/status: \{ pending: '([^']*)', approved: '([^']*)'/.exec(ui2)[1],
     /status: \{ pending: '([^']*)', approved: '([^']*)'/.exec(ui2)[2],
     'and the words really are identical, which is what makes one colour correct');
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
