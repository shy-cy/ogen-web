// What this defends against:
//
// ⚠ "IT COMES BACK AS CREDIT" WAS TRUE AND USELESS.
//
// Cancelling in time has written a line in the ledger since Phase 5. The
// dashboard has shown the balance since Phase 6. And there was no action
// anywhere that turned it back into a paid place: `applyCredit` is gated on
// `canCancel`, an ADMIN permission, so the only person who could spend a
// family's credit was somebody else. Reported as "when we cancelled and paid,
// the money should appear in our wallet so we can reuse it later" — the money
// was there; the button was not.
//
// Three things this pins, and the third is the one that would have bitten:
//
//   1. ONE SPENDER. Two implementations of "put credit against this" would be
//      two that can cap differently or write the two halves in a different
//      order, and the difference surfaces when a family reads their balance to
//      an admin reading theirs.
//   2. THE LEDGER FIRST — the opposite of the rule for a credit and right for
//      the same reason. A debit without the payment is a visible line in an
//      append-only record; a payment without the debit is credit spent twice
//      with nothing anywhere saying so.
//   3. CAPPED AT WHAT IS OWED, which the admin's version did not do. Credit paid
//      beyond a debt is not a payment, it is credit deleted: the record reads
//      "paid" by more than it cost and the balance is lower with nothing to show
//      for the difference.
//
// And the wording that started the same report: "includes the yearly
// registration fee" was printed under every cost card, restating a row already
// on it — and on a drop-in with no registration fee it was simply untrue.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');

console.log('[one spender, two callers]');
const spender = read('netlify/functions/_spend-credit.js');
const admin = read('netlify/functions/admin-registrations.js');
const api = read('netlify/functions/account-registrations.js');
H.ok(/function spendCredit\(/.test(spender), 'there is one spendCredit()');
H.ok(/spend\.spendCredit\(/.test(admin), 'the admin calls it');
H.ok(/spend\.spendCredit\(/.test(api), 'and so does the family');
// Neither may keep its own copy of the arithmetic.
[['admin-registrations', admin], ['account-registrations', api]].forEach(([name, src]) => {
  const bare = src.replace(/^\s*\/\/.*$/gm, '');
  H.ok(!/reason: 'credit-applied'/.test(bare),
    name + ' does not write its own ledger debit — the spender does');
});

console.log('\n[the ledger is written before the record]');
const bare = spender.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
H.ok(bare.indexOf('ledger.append') < bare.indexOf('saveAttendance'),
  'the debit lands before the session is marked paid');
H.ok(bare.indexOf('ledger.append') < bare.indexOf('saveRegistration'),
  'and before the registration is');
H.ok(bare.indexOf('balanceFor') < bare.indexOf('ledger.append'),
  'and the balance is checked before anything is written at all');

console.log('\n[it refuses more than is held, and more than is owed]');
const { spendable, owingOn } = require(H.fnPath('_spend-credit'));
const reg = { payment: { owedCents: 5000, paidCents: 2000 } };
H.eq(owingOn(reg), 3000, 'what is owed is billed minus paid');
H.eq(spendable(reg, 10000), 3000, 'a big balance is capped at the debt');
H.eq(spendable(reg, 1000), 1000, 'a small one is capped at the balance');
H.eq(spendable(reg, 0), 0, 'and no credit spends nothing');
H.eq(spendable({ payment: { owedCents: 0, paidCents: 0 } }, 5000), 0,
  'nothing owed spends nothing — credit paid beyond a debt is credit DELETED');
// Negative or absurd figures are not a cap question, they are a refusal.
H.eq(spendable(reg, -500), 0, 'a negative balance cannot be spent');

console.log('\n[the family action decides the amount, never the request]');
const useCredit = api.slice(api.indexOf("case 'useCredit'"), api.indexOf("case 'cancelSession'"));
H.ok(useCredit.length > 400, 'found the branch');
H.ok(/const cents = spend\.spendable\(record, balance\)/.test(useCredit),
  '⚠ the amount is computed here — a client that names its own figure is a ' +
  'client that can name somebody else\'s balance');
H.ok(!/body\.amountCents|body\.cents/.test(useCredit), 'and none is read from the body');
H.ok(/record\.accountId !== me\.accountId/.test(useCredit),
  'and the account that OWES is the one credited — a guardian link does not ' +
  'authorise spending another account\'s credit');
H.ok(/mustGuard\(body\.participantId\)/.test(useCredit), 'behind the usual guardian check');
// One action, both kinds of debt: it is one question, and the two records carry
// the same payment vocabulary on purpose.
H.ok(/body\.sessionDate\s*\n?\s*\? await attendance\.getAttendance/.test(useCredit) ||
     /body\.sessionDate$/m.test(useCredit),
  'a sessionDate says which record is meant');

console.log('\n[and the page that shows a debt also shows the wallet]');
const ui = read('js/member-account.js');
H.ok(/balanceCents: await ledger\.balanceFor\(me\.accountId\)/.test(api),
  'the activity page is told the balance');
H.ok(/function creditButton\(owing, balance, body, onDone, cls\)/.test(ui), 'and draws a control for it');
H.ok(/text: T\.useCredit \+ ' · ' \+ money\(Math\.min\(owing, balance\)\)/.test(ui),
  'carrying the FIGURE — "use credit" beside a €7 debt with €20 on the account ' +
  'raises the question the label should answer');
H.ok(/if \(!\(owing > 0\) \|\| !\(balance > 0\)\) return null;/.test(ui),
  'and absent when there is nothing to spend or nothing to spend it on');
// Both places money is owed. One handler either way, so the two cannot come to
// send different things: the cost card wraps the button in a block, and a row
// of per-evening actions wants a link beside the others.
H.ok(/function creditBlock\(owing, balance, body, onDone\)/.test(ui) &&
     /creditButton\(owing, balance, body, onDone, 'btn-secondary acc-credit-go'\)/.test(ui),
  'the block on the cost card is that same button in a wrapper, not a second one');
H.ok(/creditBlock\(left, balance/.test(ui), 'offered on the term cost card');
H.ok(/creditButton\(owing, balance, \{\n\s*participantId/.test(ui), 'and on a single evening');

// ⚠ AND THE WALLET IS BEHIND THE SAME TWO GATES AS THE PAY BUTTON.
//
// It was drawn ABOVE that button with no conditions at all, so on a card where
// paying was correctly withheld — a registration still waiting for an admin, or
// an address never confirmed — a "Use credit" button sat in its place settling
// the very same debt. Reported from one QA session, both ways round.
//
// Spending credit is paying: same figure, same record, same payment status. The
// only difference is which pocket it comes out of, and neither gate is about
// the pocket.
H.ok(/var useIt = \(left > 0 && payable && !needsVerify\)/.test(ui),
  'the cost card offers credit only where it would offer a card');
H.ok(!/kids\.push\(useIt\);[\s\S]{0,200}var needsVerify/.test(ui),
  'and not above the block that decides it, which is where it used to sit');

// The server half, which is the one that decides. A client is hostile by
// assumption, so the cosmetic check above proves only that a family is not
// offered something about to be refused.
const useCreditGates = api.slice(api.indexOf("case 'useCredit'"), api.indexOf("case 'cancelSession'"));
H.ok(/verificationRefusal\(me, \(record\.frozen && record\.frozen\.type\) \|\| 'course'\)/.test(useCreditGates),
  'the server asks for a confirmed address on a term, from the FROZEN type');
H.ok(/checkout\.isPayable\(record\)/.test(useCreditGates),
  'and reads the same isPayable() both other doors read — a pending place is not ' +
  'payable with credit either');
H.ok(/if \(!body\.sessionDate\) \{/.test(useCreditGates),
  'and skips both for a single evening, which is a drop-in booking rather than a ' +
  'request somebody may refuse');

console.log('\n[the fee line stopped saying something untrue]');
// It was printed under EVERY cost card: it restated a row already on the card,
// and on a drop-in with no registration fee it described a charge that does not
// exist. The half worth keeping is the waiver, which is the one thing about the
// fee a family cannot work out from the figures in front of them.
H.ok(/if \(r\.feeCharged === false && r\.registrationFee\)/.test(ui),
  'the line appears only when a fee was actually waived');
H.ok(!/feeIncluded/.test(ui),
  'and the string that restated the row is deleted rather than left as dead copy ' +
  'in three languages');
H.ok(/T\.feeAlready/.test(ui), 'while the waiver explanation stays');

console.log('\n[asking before something is undone is our own dialog]');
// window.confirm is pinned to the top of the viewport, headed with the site's
// DOMAIN, painted in the operating system's colours — and takes a single string,
// so it cannot say what the answer COSTS. On a cancellation that is the whole of
// what somebody needs to know.
H.ok(!/window\.confirm/.test(ui.replace(/^\s*\/\/.*$/gm, '')),
  'no browser confirm is left in the family area');
H.ok(/function confirmAction\(opts, onYes\)/.test(ui), 'there is one dialog');
H.ok(/function creditNote\(cancellation\)/.test(ui),
  'and the question carries what cancelling is worth');
// ⚠ READ, NOT EXECUTED, AND THAT IS WHY IT IS ONE LINE. An earlier version of
// this assertion checked both halves of creditNote() against the source
// separately and passed while the dialog said "no credit back" on every
// registration. The suite that EXECUTES it against real payloads is
// a-dialog-about-money-must-not-be-backwards.js; this only pins that the figure
// comes from the server's object rather than from anything the screen computed.
H.ok(/cancellation\.credit > 0/.test(ui),
  'from the same figure the server will apply, so the question and the outcome agree');
H.ok(/T\.whyNothing\[cancellation\.whyNothing\]/.test(ui),
  'and when there is nothing to get back, the reason comes from the server too');
// Rule 5 in reverse: the action here is the one that changes nothing.
H.ok(/class: 'btn-primary', text: T\.confirmNo/.test(ui),
  '⚠ STAYING is the terracotta — a cancellation cannot be undone, so the easy ' +
  'press must be the one that leaves things alone');
H.ok(/class: 'acc-link is-danger', text: opts\.yes/.test(ui), 'and going through is the quiet one');
const css = read('shared.css');
H.ok(/\.acc-modal\{[^}]*position:fixed/.test(css) && /align-items:center/.test(css.slice(css.indexOf('.acc-modal{'))),
  'centred rather than pinned to the top of the window');
H.ok(!/\.acc-modal[^{]*\{[^}]*(left:|right:)/.test(css),
  'and nothing in the block is positioned to a physical side');

H.done();
