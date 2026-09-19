// /pay?t=<token> — the emailed payment link.
//
// ⚠ NO SESSION, AND NOTHING READ BACK. This is the only endpoint on the site
// that acts on a registration without a signed-in anybody, so what it is
// allowed to do is worth stating exactly: on success it answers a 302 to
// Stripe, and on every refusal it answers a 302 to a page that asks for a
// password. It never returns a body, so it can never become a way to read a
// registration, a name, a date of birth or a balance by trying tokens.
//
// WHY THIS IS NOT A WEAKER DOOR THAN THE PASSWORD ONE. The signed-in `pay`
// action checks two things: that the account's address is confirmed, and that
// the registration is one that can be paid for. The second is re-checked here,
// from the record, every time, through the same isPayable() that door reads. The first is satisfied by construction and by something stronger
// — the token was mailed to that address and nowhere else, so following it is
// itself proof of reading that inbox, which is all `emailVerifiedAt` ever
// attested. It is deliberately NOT treated as a verification: confirming an
// address is a separate act with separate consequences, and a payment must not
// quietly perform one.
//
// The alternative that was refused: a magic link that signs the reader in. It
// is the same one click for the family and it hands whoever opens a forwarded
// message the whole family record — children's names, dates of birth, medical
// notes, the members-only address. This one hands them a bill.

const links = require('./_pay-link');
const store = require('./_registration-store');
const accounts = require('./_account-store');
const { createCheckout, dueCents, isPayable } = require('./_checkout');
const { SITE } = require('./_email-shell');

const LANGS = ['he', 'en', 'ru'];
const langOf = (v) => (LANGS.indexOf(v) !== -1 ? v : 'he');
const treeOf = (l) => (l === 'he' ? '' : '/' + l);

// 302, never a body. `no-store` because the destination is a one-time Stripe
// URL and `/pay` is a stable address: a cached redirect would send the next
// reader to a Checkout session that has already been paid or has expired.
const go = (url) => ({
  statusCode: 302,
  headers: { Location: url, 'Cache-Control': 'no-store, max-age=0' },
  body: ''
});

// Every refusal lands on a real page in the reader's own language, carrying a
// reason the screen can put into words. Falling back to the account page rather
// than the registration page when the token is unknown is not tidiness: naming
// a participant and an activity in a URL handed to somebody holding an invalid
// token would make a wrong guess informative.
const refuse = (lang, reason, reg) => go(
  reg
    ? SITE + treeOf(lang) + '/account/activity'
      + '?p=' + encodeURIComponent(reg.participantId)
      + '&a=' + encodeURIComponent(reg.activityId)
      + '&pay=' + reason + '#pay'
    : SITE + treeOf(lang) + '/account?pay=' + reason
);

exports.handler = async (event) => {
  const q = (event && event.queryStringParameters) || {};
  // The query's language is for routing a REFUSAL, since an unknown token
  // cannot say which tree the reader came from. A valid token carries the
  // language the message it was sent in was written in, and that one wins.
  let lang = langOf(q.l);

  try {
    const link = await links.readPayLink(q.t);
    if (!link) return refuse(lang, 'expired');
    lang = langOf(link.lang || lang);

    const reg = await store.getRegistration(link.participantId, link.activityId);
    if (!reg) return refuse(lang, 'expired');

    // Re-read every time rather than trusting what was true when the link was
    // written. A registration cancelled, rejected or settled since the message
    // went out must not be chargeable by an old email.
    // isPayable(), not a status compared here — the signed-in door and this one
    // must never disagree about what is chargeable. See _checkout.js: `pending`
    // is payable, which matters more here than there, because a receipt for a
    // part payment on a pending registration mints one of these links and it
    // would otherwise be dead on arrival.
    if (!isPayable(reg)) return refuse(lang, 'not-approved', reg);
    if (!(dueCents(reg) > 0)) return refuse(lang, 'nothing-due', reg);

    // The address on the ACCOUNT, not on the link and not on the query — it is
    // only a prefill for Stripe, and a prefill taken from a URL would put an
    // attacker's address on a family's receipt.
    let email = null;
    if (link.accountId) {
      const account = await accounts.getAccount(link.accountId).catch(() => null);
      email = (account && account.email) || null;
    }

    const session = await createCheckout(reg, lang, email);
    return go(session.url);
  } catch (err) {
    console.error('[pay-link] ' + (err && err.stack || err));
    return refuse(lang, 'failed');
  }
};
