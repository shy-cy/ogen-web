// The nightly pass that materialises the expiry rule.
//
// IT IS THE COSMETIC HALF, AND SAYING SO IS THE POINT. holdsASpot() in
// _registration.js already treats a lapsed pending registration as holding
// nothing, so the capacity numbers are correct whether or not this ever runs.
// What this adds is the human-visible half — a queue must not say "pending"
// forever — and the message to the family. If the schedule breaks, a dashboard
// goes stale; nothing is miscounted, and nobody's place is given away twice.
//
// Which is also why it is safe to run by hand, repeatedly, from the admin: it
// only ever rewrites records the derived rule already considers expired, and a
// second pass finds none of them.
//
// ⚠ Arms the legal gate, correctly.

const store = require('./_registration-store');
const accounts = require('./_account-store');
const R = require('./_registration');
const mail = require('./_registration-email');

async function run(now) {
  const at = now == null ? Date.now() : now;
  const all = await store.allRegistrations();
  const lapsed = all.filter((r) => R.hasLapsed(r, at));
  const expired = [];

  for (const reg of lapsed) {
    const next = R.transition(reg, {
      status: 'expired', by: 'system', now: at,
      // Named, because "why did this one expire in three days" is a question
      // somebody asks a month later and the record is the only place with an
      // answer.
      note: 'unanswered for ' + reg.expiryDays + ' days (' + reg.expirySource + ')'
    });
    await store.saveRegistration(next);
    expired.push(R.key(next.participantId, next.activityId));

    // Best effort, after the write, one guardian at a time. The account that
    // SUBMITTED is the one told — it is the one that was waiting for an answer,
    // and it is the one the record names as owing.
    const account = await accounts.getAccount(next.accountId);
    if (account) await mail.sendExpired(next, account);
  }

  return { checked: all.length, expired: expired.length, keys: expired, at: new Date(at).toISOString() };
}

module.exports = { run };
