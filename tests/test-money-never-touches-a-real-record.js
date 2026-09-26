// What this defends against:
//
// ⚠ THERE WAS ONE STRIPE CONFIGURATION, SO REHEARSING MEANT CHARGING A REAL CARD.
//
// A test activity was published for real and behaved exactly like an open one,
// which is the point of it — but "exactly like" included the money: one secret
// key, one webhook endpoint, one signing secret, and every rehearsal therefore a
// real charge on somebody's real card, to be refunded by hand afterwards.
//
// There are two complete configurations now, chosen by the activity's listing
// state, and "complete" is the load-bearing word: its own key, its own endpoint,
// its own signing secret. A half-shared pair is the shape that produces a test
// card charging real money, because the piece that was shared is the piece
// nobody checked.
//
// FOUR THINGS THIS PINS, and the last two are the ones that would lose money:
//
//   1. THE MODE IS DERIVED FROM THE LISTING AND FROZEN ONTO EVERY RECORD at the
//      moment a place is taken or an evening booked — never read live off the
//      activity. An admin switching a listing to Test in March must not turn
//      money already taken in January into a rehearsal, and /pay has no session
//      and no repository read at all, so the record is the only place it can ask.
//   2. NOTHING IS SHARED. Two keys, two secrets, two endpoints, and the
//      descriptor suffix is set on a live charge and not on a rehearsal, because
//      a test payment reaches no bank statement for a cardholder to read it on.
//   3. A PAYMENT IN THE WRONG MODE SETTLES NOTHING. The webhook compares the mode
//      it arrived in against the mode the record was SOLD in and writes nothing
//      if they differ — before the idempotency list, so a retry on the right
//      endpoint does not find it already counted.
//   4. TEST CREDIT CANNOT BE SPENT ON A REAL CLASS, and that is refused BY
//      CONSTRUCTION rather than by a check: the balance is asked for per mode, so
//      a rehearsal's €50 is not in the figure a real registration is measured
//      against, and no branch anywhere has to remember to exclude it.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const bare = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const LST = require(H.fnPath('_activity-listing'));
const S = require(H.fnPath('_stripe'));
const credit = require(H.fnPath('_credit'));

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

(async () => {

console.log('[the listing decides the mode, and nothing else does]');
H.eq(LST.paymentModeOf({ listing: 'listed' }), 'live', 'Listed is real money');
H.eq(LST.paymentModeOf({ listing: 'unlisted' }), 'live',
  '⚠ and so is UNLISTED — it is a real class that is simply not advertised, which ' +
  'is exactly the distinction the old tickbox could not draw');
H.eq(LST.paymentModeOf({ listing: 'test' }), 'test', 'and Test is the rehearsal');
H.eq(LST.paymentModeOf({ testActivity: true }), 'test',
  'a record written before the field existed still answers correctly, on read');
H.eq(LST.paymentModeOf({}), 'live',
  '⚠ and an absent state is LIVE. Every payment ever taken on this site was taken ' +
  'with the one key that existed, and it was the real one — reading a blank as a ' +
  'rehearsal would relabel the whole history of real money as pretend');
// PAYMENT_MODES is owned once, by the select that produces it.
H.eq(S.PAYMENT_MODES.join(','), 'live,test', '_stripe.js re-exports the same list');
H.eq(require(H.fnPath('_credit-ledger')).PAYMENT_MODES.join(','), 'live,test',
  'and so does the ledger — one list, or one of the copies drifts');
H.ok(!/PAYMENT_MODES\s*=\s*\[/.test(bare('netlify/functions/_stripe.js')) &&
     !/PAYMENT_MODES\s*=\s*\[/.test(bare('netlify/functions/_credit-ledger.js')),
  'neither declares its own copy of it');

console.log('\n[two complete configurations, and nothing crosses between them]');
H.eq(S.SECRET_ENV.live + ' / ' + S.SECRET_ENV.test,
  'STRIPE_SECRET_KEY / STRIPE_TEST_SECRET_KEY', 'two secret keys');
H.eq(S.WEBHOOK_ENV.live + ' / ' + S.WEBHOOK_ENV.test,
  'STRIPE_WEBHOOK_SECRET / STRIPE_TEST_WEBHOOK_SECRET', 'two signing secrets');
H.ok(S.SECRET_ENV.live !== S.SECRET_ENV.test && S.WEBHOOK_ENV.live !== S.WEBHOOK_ENV.test,
  'and no variable is read by both modes');
// ⚠ THE DESCRIPTOR IS THE ONE GENUINE ASYMMETRY, and it is asymmetric for a
// reason rather than by omission: a statement descriptor is what a CARDHOLDER
// reads on a bank statement, and a rehearsal reaches none.
H.eq(S.descriptorSuffixFor('live'), 'Ogen CTR', 'a live charge carries the suffix');
H.eq(S.descriptorSuffixFor('test'), null, 'and a rehearsal carries none');
// ⚠ THE KEY'S OWN PREFIX IS CHECKED AGAINST THE MODE, before a request is made.
// A test key pasted into STRIPE_SECRET_KEY would build "live" sessions that are
// actually test ones, and every real payment on the site would quietly stop
// arriving — detectable, because a Stripe key says which mode it is.
const savedKeys = { live: process.env.STRIPE_SECRET_KEY, test: process.env.STRIPE_TEST_SECRET_KEY };
const keyRefusal = (mode, key) => {
  const old = process.env[S.SECRET_ENV[mode]];
  process.env[S.SECRET_ENV[mode]] = key;
  let msg = null;
  try { S.stripe(mode); } catch (e) { msg = e.message; }
  if (old === undefined) delete process.env[S.SECRET_ENV[mode]];
  else process.env[S.SECRET_ENV[mode]] = old;
  return msg;
};
H.ok(/does not hold a live-mode key/.test(keyRefusal('live', 'sk_test_abc') || ''),
  '⚠ a TEST key in the live variable is refused at construction — otherwise every ' +
  'real payment on the site silently stops arriving');
H.ok(/does not hold a test-mode key/.test(keyRefusal('test', 'sk_live_abc') || ''),
  'and a LIVE key in the test variable is refused too, which is the direction that ' +
  'charges a real card during a rehearsal');
H.ok(/is not set/.test(keyRefusal('live', '') || ''), 'and a missing key says which one');
process.env.STRIPE_SECRET_KEY = savedKeys.live;
process.env.STRIPE_TEST_SECRET_KEY = savedKeys.test;
if (savedKeys.live === undefined) delete process.env.STRIPE_SECRET_KEY;
if (savedKeys.test === undefined) delete process.env.STRIPE_TEST_SECRET_KEY;

console.log('\n[the mode is on the metadata, and the organisation tag still is too]');
H.eq(S.meta({}, 'test').ogen_mode, 'test', 'a session says which configuration built it');
H.eq(S.meta({}).ogen_mode, 'live', 'and an omitted mode reads live');
// ⚠ THE ORGANISATION TAG IS WRITTEN IN BOTH MODES. It is the only thing that
// tells an Ogen event from Shirat HaYam's, and the account is shared in test mode
// exactly as in live mode — their developers press test cards too. Dropping it on
// rehearsals would mean isOurs() had to accept UNTAGGED events on one endpoint,
// which is the single relaxation _stripe.js exists to forbid.
H.eq(S.meta({}, 'test').organization, 'ogen', 'a rehearsal is tagged as ours as well');
H.ok(S.isOurs({ metadata: S.meta({}, 'test') }), 'so isOurs() still answers for it');
H.ok(!S.isOurs({ metadata: { ogen_mode: 'test' } }),
  'and an untagged test-mode object is STILL not ours — the relaxation never happened');
H.eq(S.modeOfEvent({ livemode: false }), 'test', 'Stripe’s own livemode is read');
H.eq(S.modeOfEvent({ livemode: true }), 'live', 'both ways');
H.eq(S.modeOfEvent({}), 'live',
  'and an absent livemode reads live — a missing flag must never downgrade real money');

console.log('\n[frozen onto every record at the moment of payment]');
const activity = (listing) => ({
  activityId: 'act-1', slug: 's', listing: listing, type: 'dropin',
  title: { he: 't', en: 't', ru: 't' },
  facts: { price: { perSessionPrice: 7 } },
  registration: {},
  groups: [{ groupId: 'g-1', name: { he: '', en: '', ru: '' }, capacity: 10,
             facts: { duration: { sessionDates: [{ date: '2026-10-27', status: 'scheduled' }] },
                      schedule: { frequency: 'weekly', sessions: [{ day: 2, time: '17:00' }] } } }]
});
// An evening, through the same freezeSession() that freezes its price.
H.eq(credit.freezeSession(activity('test'), '2026-10-27', null, {}).paymentMode, 'test',
  'freezeSession() stamps the mode beside the price it freezes');
H.eq(credit.freezeSession(activity('listed'), '2026-10-27', null, {}).paymentMode, 'live',
  'and a listed activity’s evening is real money');
H.eq(credit.freezeSession(activity('unlisted'), '2026-10-27', null, {}).paymentMode, 'live',
  'as is an unlisted one’s');
// A registration, through freeze().
const Rmod = require(H.fnPath('_registration'));
const regFor = (listing) => Rmod.newRegistration({
  activity: Object.assign(activity(listing), { type: 'course' }),
  participant: { participantId: 'p-1', firstName: 'Noa', lastName: 'Levi',
                 dateOfBirth: '2016-05-05' },
  accountId: 'a-1', groupId: 'g-1', now: Date.parse('2026-09-01T09:00:00Z'), siblings: []
});
H.eq(regFor('test').frozen.paymentMode, 'test', 'a registration freezes it too');
H.eq(regFor('listed').frozen.paymentMode, 'live', 'and a real one freezes live');
// ⚠ READ BACK OFF THE RECORD, never off the activity. This is what lets /pay pick
// a Stripe key with no session and no repository read, and it is what makes a
// later listing change unable to move money already agreed.
H.eq(LST.modeOfRecord({ frozen: { paymentMode: 'test' } }), 'test', 'modeOfRecord reads it');
H.eq(LST.modeOfRecord({ frozen: {} }), 'live',
  'and a record frozen before this field existed is real money');
H.eq(LST.modeOfRecord(null), 'live', 'as is nothing at all');

console.log('\n[a bundle freezes it too, because it is paid for before it exists]');
const bundleStore = require(H.fnPath('_bundle-store'));
const bun = bundleStore.newBundle({
  participantId: 'p-1', activityId: 'act-1', accountId: 'a-1',
  bundle: { bundleId: 'b-1', entries: 5, pricePerEntry: 6, validityDays: 60 },
  coveredDates: ['2026-10-27'], purchasedAt: Date.parse('2026-09-01T09:00:00Z'),
  paymentMode: 'test'
});
H.eq(bun.frozen.paymentMode, 'test', 'the mode is frozen with the entries and the rate');
H.eq(bundleStore.newBundle({
  participantId: 'p-1', activityId: 'act-1', accountId: 'a-1',
  bundle: { bundleId: 'b-1', entries: 5, pricePerEntry: 6, validityDays: 60 },
  coveredDates: ['2026-10-27'], purchasedAt: Date.now()
}).frozen.paymentMode, 'live', 'and a bundle written without one is real money');
// The nightly shortfall credit reads it back, so a rehearsal is made good in
// rehearsal credit rather than in real money.
H.ok(/mode: LST\.normaliseMode\(\(bundle\.frozen \|\| \{\}\)\.paymentMode\)/
  .test(bare('netlify/functions/_registration-sweep.js')),
  'and reconcileBundles() credits a shortfall in the mode the bundle was bought in');

console.log('\n[every Checkout is built for one mode, and none defaults]');
const checkout = bare('netlify/functions/_checkout.js');
H.ok(/async function build\(\{ lang, email, lines, back, meta, mode \}\)/.test(checkout),
  'build() takes a mode');
H.ok(/S\.stripe\(mode\)/.test(checkout), 'and it picks the key');
// ⚠ COUNTED, LIKE THE CLOCK ON creditFor(). A mode that is optional in syntax and
// not in meaning is the shape five call sites once got wrong, and the omission
// here resolves to charging a real card.
let calls = 0;
let i = 0;
while ((i = checkout.indexOf('return build({', i)) !== -1) {
  let depth = 0, j = i + 11, body = '';
  for (; j < checkout.length; j++) {
    if ('({['.indexOf(checkout[j]) !== -1) depth++;
    else if (')}]'.indexOf(checkout[j]) !== -1 && --depth === 0) break;
  }
  body = checkout.slice(i, j + 1);
  i = j + 1;
  calls++;
  H.ok(/\bmode:/.test(body), 'build() call #' + calls + ' names its mode');
}
H.eq(calls, 3, 'and there are three of them — a term, some evenings, a bundle');
H.ok(/mode: LST\.modeOfRecord\(reg\)/.test(checkout),
  'a term takes it off the registration, which is all /pay has');
H.ok(/mode: LST\.paymentModeOf\(activity\)/.test(checkout),
  'and a bundle off the activity, because its record does not exist yet');
// ⚠ ONE PAYMENT CANNOT STRADDLE THE TWO. Several evenings are one session built
// with one key, so a mixed list is refused rather than resolved.
H.ok(/reason: 'mode-mixed'/.test(checkout),
  'a list of evenings sold in two different modes is refused, not resolved');

console.log('\n[running it: each builder opens the configuration it was asked for]');
{
  const mods = H.loadWithStubs({ blobs: H.makeBlobs(), modules: ['_stripe', '_checkout'] });
  const seen = { live: [], test: [] };
  ['live', 'test'].forEach((m) => {
    mods['_stripe']._internal.setClient({
      checkout: { sessions: { create: async (args) => {
        seen[m].push(args);
        return { id: 'cs_' + m, url: 'https://checkout.stripe.com/c/pay/' + m };
      } } }
    }, m);
  });
  const co = mods['_checkout'];

  const term = (mode) => ({
    participantId: 'p-1', activityId: 'act-1', accountId: 'a-1', status: 'approved',
    payment: { owedCents: 30000, paidCents: 0, creditedCents: 0 },
    frozen: { paymentMode: mode, participantName: 'Noa Levi',
              activityTitle: { he: 'x', en: 'x', ru: 'x' } }
  });
  await co.createCheckout(term('live'), 'en', 'a@b.c');
  H.eq(seen.live.length, 1, 'a live registration opens the LIVE configuration');
  H.eq(seen.test.length, 0, '   and not the test one');
  H.eq(seen.live[0].payment_intent_data.statement_descriptor_suffix, 'Ogen CTR',
    '   with the descriptor a cardholder will read');
  H.eq(seen.live[0].metadata.ogen_mode, 'live', '   tagged live');

  await co.createCheckout(term('test'), 'en', 'a@b.c');
  H.eq(seen.test.length, 1, 'a rehearsal opens the TEST configuration');
  H.eq(seen.live.length, 1, '   and the live one was not touched');
  H.eq(seen.test[0].payment_intent_data.statement_descriptor_suffix, undefined,
    '   with no descriptor, because no statement will carry it');
  H.eq(seen.test[0].metadata.ogen_mode, 'test', '   tagged test');
  H.eq(seen.test[0].metadata.organization, 'ogen',
    '   and STILL tagged as ours, on an account shared in test mode as well as live');

  // Evenings, which travel as a list and may not straddle the two.
  const evening = (mode, date) => ({
    participantId: 'p-1', activityId: 'act-1', sessionDate: date,
    payment: { owedCents: 700, paidCents: 0 }, frozen: { paymentMode: mode }
  });
  await co.createSessionsCheckout([evening('test', '2026-10-27'), evening('test', '2026-11-03')],
    { he: 'x', en: 'x', ru: 'x' }, 'en', 'a@b.c');
  H.eq(seen.test.length, 2, 'two rehearsal evenings are one test-mode session');
  let mixed = null;
  try {
    await co.createSessionsCheckout([evening('test', '2026-10-27'), evening('live', '2026-11-03')],
      { he: 'x', en: 'x', ru: 'x' }, 'en', 'a@b.c');
  } catch (e) { mixed = e; }
  H.eq(mixed && mixed.reason, 'mode-mixed',
    '⚠ and a list straddling the two is refused rather than resolved — one session ' +
    'is built with one key, so there is no honest answer');
  H.eq(seen.live.length + seen.test.length, 3, 'and nothing was opened for it');

  // ⚠ AND THE BUNDLE BUILDER IS EXECUTED, which it never was. It read a `groupId`
  // that was not in its own parameter list, so every bundle purchase on the site
  // threw a ReferenceError, was swallowed by the try around the call, and answered
  // 502. The suite that owned it asserted the function EXISTED and nothing ran it.
  const bundleActivity = {
    activityId: 'act-1', slug: 's', listing: 'test', type: 'dropin',
    title: { he: 'x', en: 'x', ru: 'x' }, facts: {}, registration: {}, groups: []
  };
  const session = await co.createBundleCheckout({
    activity: bundleActivity,
    bundle: { bundleId: 'b-1', entries: 5, pricePerEntry: 6, validityDays: 60 },
    coveredDates: ['2026-10-27', '2026-11-03'], participantId: 'p-1', accountId: 'a-1',
    groupId: 'g-1', purchasedAt: Date.parse('2026-09-01T09:00:00Z'), lang: 'en',
    email: 'a@b.c', participantName: 'Noa Levi'
  });
  H.ok(session && session.url, 'a bundle Checkout is built at all, which it was not');
  H.eq(seen.test.length, 3, 'and on a test activity it opens the TEST configuration');
  const bun = seen.test[2];
  H.eq(bun.metadata.group_id, 'g-1',
    '⚠ carrying the group whose calendar it was sold against — the parameter that ' +
    'was read and never declared');
  H.eq(bun.metadata.ogen_mode, 'test', 'and the mode, so settleBundle() can freeze it');
  H.eq(bun.line_items[0].price_data.unit_amount, 3000, 'for five entries at €6');
}

console.log('\n[two endpoints, one implementation]');
const hookFile = read('netlify/functions/stripe-webhook-test.js');
H.ok(/require\('\.\/stripe-webhook'\)\.handlerFor\('test'\)/.test(hookFile),
  'the test endpoint is the live one’s implementation with a different mode');
H.ok(hookFile.split('\n').filter((l) => l.trim() && !/^\s*\/\//.test(l)).length <= 2,
  'and is nothing but that — a second copy is a second place the retry rule drifts');
const hook = bare('netlify/functions/stripe-webhook.js');
H.ok(/exports\.handler = async \(event\) => runWebhook\(event, 'live'\)/.test(hook),
  'the live endpoint names its own mode');
H.ok(/const secret = S\.webhookSecret\(mode\)/.test(hook),
  'each verifies with ITS OWN signing secret, which is what makes the mode unforgeable');
H.ok(/client\.webhooks\.constructEvent\(raw, sig, secret\)/.test(hook),
  'and with its own client');
// ⚠ AND THE CLIENT IS BUILT OUTSIDE THAT try. Inside it, a key set to the wrong
// mode was caught by the signature handler and answered `400 Bad signature` —
// the guard fired and then described itself, from outside, as the one failure it
// is not. Asserted by shape AND executed below, because the ordering of two
// try blocks is exactly what reading proves nothing about.
H.ok(hook.indexOf('client = S.stripe(mode)') < hook.indexOf('client.webhooks.constructEvent'),
  '⚠ and builds it BEFORE the signature try, so a wrongly configured key does not ' +
  'report itself as a bad body');
H.ok(/S\.modeOfEvent\(stripeEvent\) !== mode/.test(hook),
  'Stripe’s own livemode is checked against the endpoint it arrived on');
// Every settle path is handed the mode.
H.ok(/settle\(stripeEvent\.data\.object, mode\)/.test(hook), 'settle() is given it');
H.ok(/settleSession\(session, meta, mode\)/.test(hook) &&
     /settleBundle\(session, meta, mode\)/.test(hook) &&
     /settleOneSession\(session, meta, dates\[i\], parts\[i\], mode\)/.test(hook),
  'and so is every branch of it');
H.ok(/mode: mode,/.test(hook), 'and the record is stamped with it');
// ⚠ BEFORE THE IDEMPOTENCY LIST, IN BOTH BRANCHES. A wrong-mode payment recorded
// as counted would make the retry on the RIGHT endpoint find it already settled.
// Scoped to each function's own body rather than to the whole file: the two
// branches read different blobs and either could have the ordering wrong on its
// own, and searching the file finds whichever comes first and says nothing about
// the other.
[['settleOneSession', 'modeRefused(att, mode'],
 ['registration branch', 'modeRefused(reg, mode']].forEach(([what, guard]) => {
  const at = hook.indexOf(guard);
  H.ok(at !== -1, what + ' asks the guard');
  const nextSettled = hook.indexOf('settled.indexOf(session.id)', at);
  H.ok(nextSettled !== -1 && at < nextSettled,
    what + ': the mode check precedes the settled-sessions list, or a retry finds it counted');
  const save = hook.indexOf(what === 'settleOneSession' ? 'saveAttendance' : 'saveRegistration', at);
  H.ok(save !== -1 && at < save, what + ': and precedes the write');
});
// ⚠ AND IT IS STILL A 200. A retry cannot fix a mismatch, and Stripe disables an
// endpoint that keeps erroring — so the guard returns a boolean and never throws.
const guardBody = hook.slice(hook.indexOf('function modeRefused('));
H.ok(/console\.error\(/.test(guardBody.slice(0, 700)), 'a mismatch is logged loudly');
H.ok(/return true;/.test(guardBody.slice(0, 900)) && !/throw/.test(guardBody.slice(0, 900)),
  'and reported rather than thrown, because the endpoint still has to answer 200');

console.log('\n[the guard itself]');
H.eq(LST.paymentModeRefusal({ frozen: { paymentMode: 'live' } }, 'live'), null,
  'a live payment on a live record proceeds');
H.eq(LST.paymentModeRefusal({ frozen: { paymentMode: 'test' } }, 'test'), null,
  'and a rehearsal on a rehearsal');
H.eq(LST.paymentModeRefusal({ frozen: { paymentMode: 'live' } }, 'test').reason, 'mode-mismatch',
  '⚠ a TEST payment on a real record is refused — the whole point of the pair');
H.eq(LST.paymentModeRefusal({ frozen: { paymentMode: 'test' } }, 'live').reason, 'mode-mismatch',
  'and a real payment on a rehearsal, which would be real money nobody meant to take');
H.eq(LST.paymentModeRefusal({}, 'live'), null,
  'a record frozen before this existed takes a live payment, as it always did');
H.eq(LST.paymentModeRefusal({}, 'test').reason, 'mode-mismatch',
  'and refuses a test one, because absent means real');
// The second refusal: a record that has already taken money in the other mode.
// Only reachable from a hand-edited frozen block, and the one state that must
// never be added to — a paidCents part real and part pretend cannot be unpicked.
H.eq(LST.paymentModeRefusal({ frozen: { paymentMode: 'test' }, payment: { mode: 'live' } },
  'test').reason, 'mode-frozen',
  'and a record already holding the other mode’s money refuses to mix');

console.log('\n[the ledger says which kind of money every entry is]');
const ledger = require(H.fnPath('_credit-ledger'));
const refuse = (entry) => { try { ledger.validate(entry); return null; } catch (e) { return e.message; } };
const good = { accountId: 'a-1', type: 'credit', amountCents: 500, reason: 'admin-adjustment' };
H.ok(/payment mode/.test(refuse(good) || ''),
  '⚠ an entry with NO mode is refused rather than defaulted — a default would read ' +
  'as live, which is right for every entry written before modes existed and wrong ' +
  'for every one a caller forgot');
H.ok(/payment mode/.test(refuse(Object.assign({ mode: 'sandbox' }, good)) || ''),
  'and an unknown mode is refused too');
H.eq(refuse(Object.assign({ mode: 'test' }, good)), null, 'test is accepted');
H.eq(refuse(Object.assign({ mode: 'live' }, good)), null, 'and so is live');
// ⚠ EVERY append() CALL SITE NAMES ONE, greppable for the reason the clock on
// creditFor() is: a rule that is only checked at run time is a rule that is
// checked by a family noticing.
const appenders = fs.readdirSync(path.join(R, 'netlify/functions'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => [f, bare('netlify/functions/' + f)])
  .filter(([, src]) => /ledger\.append\(/.test(src));
H.ok(appenders.length >= 4, 'there are real append() sites to check (' + appenders.length + ')');
appenders.forEach(([f, src]) => {
  let n = 0, k = 0;
  while ((k = src.indexOf('ledger.append(', k)) !== -1) {
    let depth = 0, j = k + 13;
    for (; j < src.length; j++) {
      if ('({['.indexOf(src[j]) !== -1) depth++;
      else if (')}]'.indexOf(src[j]) !== -1 && --depth === 0) break;
    }
    const call = src.slice(k, j + 1);
    k = j + 1;
    n++;
    H.ok(/\bmode:/.test(call), f + ': append() #' + n + ' says which kind of money it is');
  }
});

console.log('\n[one balance per mode, and they are never added together]');
const entries = [
  { type: 'credit', amountCents: 5000, mode: 'live' },
  { type: 'credit', amountCents: 7000, mode: 'test' },
  { type: 'debit', amountCents: 1000, mode: 'test' },
  { type: 'credit', amountCents: 300 }            // written before modes existed
];
H.eq(ledger.balanceOf(entries, 'live'), 5300,
  'the live balance is the live entries plus the unmarked ones');
H.eq(ledger.balanceOf(entries, 'test'), 6000, 'and the test balance is its own');
H.ok(ledger.balanceOf(entries, 'live') + ledger.balanceOf(entries, 'test') === 11300,
  'the two sum to the whole ledger, and nothing anywhere asks for that sum');
let noMode = null;
try { ledger.balanceOf(entries); } catch (e) { noMode = e.message; }
H.ok(/per payment mode/.test(noMode || ''),
  '⚠ and a balance with no mode is refused rather than summing both — a single ' +
  'figure across the two is exactly what would let a rehearsal settle a real term');

console.log('\n[running it: a rehearsal’s credit cannot pay for a real class]');
{
  const blobs = H.makeBlobs();
  const mods = H.loadWithStubs({ blobs,
    modules: ['_credit-ledger', '_spend-credit', '_registration-store', '_session-attendance'] });
  const L = mods['_credit-ledger'];
  const spend = mods['_spend-credit'];
  const store = mods['_registration-store'];

  // €100 of REHEARSAL credit, and nothing else.
  await L.append({ accountId: 'a-1', type: 'credit', amountCents: 10000,
                   reason: 'registration-cancelled-by-admin', mode: 'test' });
  H.eq(await L.balanceFor('a-1', 'test'), 10000, 'the account holds €100 of test credit');
  H.eq(await L.balanceFor('a-1', 'live'), 0, 'and nothing real');

  const real = {
    participantId: 'p-1', activityId: 'act-real', accountId: 'a-1', status: 'approved',
    payment: { owedCents: 5000, paidCents: 0, currency: 'EUR', status: 'owed' },
    frozen: { paymentMode: 'live' }, history: []
  };
  await store.saveRegistration(real);
  let err = null;
  try {
    await spend.spendCredit({ record: real, kind: 'registration', cents: 5000, by: 'a-1' });
  } catch (e) { err = e; }
  H.eq(err && err.reason, 'insufficient',
    '⚠ spending it on a REAL registration is refused — by construction, because the ' +
    'balance was asked for in the record’s own mode and the test credit is not in it');
  H.eq(err && err.balanceCents, 0, 'and the figure it reports is the honest one: nothing held');
  H.eq(err && err.mode, 'live', 'naming the mode it looked in');
  H.eq((await store.getRegistration('p-1', 'act-real')).payment.paidCents, 0,
    'and the registration was not touched');
  H.eq(await L.balanceFor('a-1', 'test'), 10000, 'nor was the test balance');

  // The same credit on a REHEARSAL settles perfectly.
  const rehearsal = {
    participantId: 'p-1', activityId: 'act-test', accountId: 'a-1', status: 'approved',
    payment: { owedCents: 5000, paidCents: 0, currency: 'EUR', status: 'owed' },
    frozen: { paymentMode: 'test' }, history: []
  };
  await store.saveRegistration(rehearsal);
  const done = await spend.spendCredit({ record: rehearsal, kind: 'registration',
                                         cents: 5000, by: 'a-1' });
  H.eq(done.spentCents, 5000, 'on a test activity the same credit spends');
  H.eq(done.mode, 'test', 'in test mode');
  H.eq(done.entry.mode, 'test', 'and the ledger line says so');
  H.eq(done.record.payment.mode, 'test',
    'and the payment on the record is frozen as test money');
  H.eq(await L.balanceFor('a-1', 'test'), 5000, 'the test balance fell');
  H.eq(await L.balanceFor('a-1', 'live'), 0, 'and the real one never moved');
}

console.log('\n[running it: a misconfigured endpoint does not answer "bad signature"]');
{
  // ⚠ THE QUESTION A PROBE IS SENT TO ANSWER. A wrongly configured endpoint and a
  // body that is not from Stripe are the two things somebody curling this URL is
  // trying to tell apart, and for a release they answered identically — because
  // S.stripe(mode) was constructed inside the signature try, so the key guard's
  // message went to a log and the wire said `400 Bad signature`. Both halves are
  // driven here rather than read: this is an ordering between two try blocks, and
  // reading one proves only that it is self-consistent.
  const post = (mod, body) => mod.handlerFor('test')({
    httpMethod: 'POST', body: body || '{}',
    headers: { 'stripe-signature': 't=1,v1=deadbeef' }
  });

  const savedKey = process.env.STRIPE_TEST_SECRET_KEY;
  const savedSec = process.env.STRIPE_TEST_WEBHOOK_SECRET;
  process.env.STRIPE_TEST_WEBHOOK_SECRET = 'whsec_pretend';

  // A LIVE key in the test variable — the direction that charges a real card
  // during a rehearsal, and the reason the prefix is checked at all.
  process.env.STRIPE_TEST_SECRET_KEY = 'sk_live_wrongmode';
  {
    const mods = H.loadWithStubs({ blobs: H.makeBlobs(), modules: ['stripe-webhook'] });
    const res = await post(mods['stripe-webhook']);
    H.eq(res.statusCode, 500,
      '⚠ a key set to the OTHER mode answers 500 Not configured, like a missing ' +
      'signing secret — never 400, which claims the body was the problem');
    H.eq(JSON.parse(res.body).error, 'Not configured', '   and says so');
  }

  // A missing key, same answer — it is the same class of thing.
  delete process.env.STRIPE_TEST_SECRET_KEY;
  {
    const mods = H.loadWithStubs({ blobs: H.makeBlobs(), modules: ['stripe-webhook'] });
    H.eq((await post(mods['stripe-webhook'])).statusCode, 500,
      'and so does a key that is not set at all');
  }

  // And with the configuration right, a body that will not verify still gets the
  // 400 — or this fix has quietly swallowed the one refusal that must survive.
  process.env.STRIPE_TEST_SECRET_KEY = 'sk_test_fine';
  {
    const mods = H.loadWithStubs({ blobs: H.makeBlobs(), modules: ['_stripe', 'stripe-webhook'] });
    mods['_stripe']._internal.setClient({
      webhooks: { constructEvent: () => { throw new Error('No signatures found'); } }
    }, 'test');
    const res = await post(mods['stripe-webhook']);
    H.eq(res.statusCode, 400,
      'while a properly configured endpoint handed an unsigned body still refuses it');
    H.eq(JSON.parse(res.body).error, 'Bad signature', '   as a bad signature');
  }

  if (savedKey === undefined) delete process.env.STRIPE_TEST_SECRET_KEY;
  else process.env.STRIPE_TEST_SECRET_KEY = savedKey;
  if (savedSec === undefined) delete process.env.STRIPE_TEST_WEBHOOK_SECRET;
  else process.env.STRIPE_TEST_WEBHOOK_SECRET = savedSec;
}

console.log('\n[running it: a test-mode payment settles nothing on a real booking]');
{
  const blobs = H.makeBlobs();
  const mods = H.loadWithStubs({ blobs,
    modules: ['_session-attendance', 'stripe-webhook'] });
  const att = mods['_session-attendance'];
  const hookMod = mods['stripe-webhook'];
  const book = (aid, mode) => att.saveAttendance({
    participantId: 'p-1', activityId: aid, sessionDate: '2026-10-27', accountId: 'a-1',
    status: 'booked', frozen: { type: 'dropin', sessionDate: '2026-10-27', paymentMode: mode },
    payment: { owedCents: 700, paidCents: 0, currency: 'EUR', status: 'owed' }, history: []
  });
  await book('act-real', 'live');
  await book('act-test', 'test');

  const sessionFor = (aid, mode) => ({
    id: 'cs_' + aid + '_' + mode, amount_total: 700,
    metadata: { organization: 'ogen', ogen_mode: mode, ogen_kind: 'session',
                participant_id: 'p-1', activity_id: aid, session_date: '2026-10-27' }
  });

  // The wrong endpoint for this money: a test payment against a real evening.
  await hookMod.settle(sessionFor('act-real', 'test'), 'test');
  H.eq((await att.getAttendance('p-1', 'act-real', '2026-10-27')).payment.paidCents, 0,
    '⚠ a test-mode payment settles NOTHING on an evening that was sold for real');
  // And the mirror, which is the one that takes real money by mistake.
  await hookMod.settle(sessionFor('act-test', 'live'), 'live');
  H.eq((await att.getAttendance('p-1', 'act-test', '2026-10-27')).payment.paidCents, 0,
    'and a live payment settles nothing on a rehearsal');

  // A session built for the other configuration, arriving on this endpoint. It
  // cannot normally happen — so when it does, a key is set to the wrong mode.
  await hookMod.settle(sessionFor('act-real', 'test'), 'live');
  H.eq((await att.getAttendance('p-1', 'act-real', '2026-10-27')).payment.paidCents, 0,
    'a session built for the other mode is refused before anything is read');

  // Each on its own endpoint settles, and stamps the mode.
  await hookMod.settle(sessionFor('act-real', 'live'), 'live');
  await hookMod.settle(sessionFor('act-test', 'test'), 'test');
  const paidReal = await att.getAttendance('p-1', 'act-real', '2026-10-27');
  const paidTest = await att.getAttendance('p-1', 'act-test', '2026-10-27');
  H.eq(paidReal.payment.paidCents, 700, 'the real evening settles on the live endpoint');
  H.eq(paidReal.payment.mode, 'live', 'stamped live');
  H.eq(paidTest.payment.paidCents, 700, 'and the rehearsal on the test one');
  H.eq(paidTest.payment.mode, 'test', 'stamped test');

  // ⚠ AND A SECOND PAYMENT IN THE OTHER MODE IS STILL REFUSED, which is what
  // `mode-frozen` is for: paidCents part real and part pretend cannot be unpicked.
  const shifted = Object.assign({}, paidTest,
    { frozen: Object.assign({}, paidTest.frozen, { paymentMode: 'live' }) });
  await att.saveAttendance(shifted);
  await hookMod.settle(Object.assign(sessionFor('act-test', 'live'), { id: 'cs_again' }), 'live');
  H.eq((await att.getAttendance('p-1', 'act-test', '2026-10-27')).payment.paidCents, 700,
    'a record that has already taken the other mode’s money takes no more');
}

console.log('\n[the desk and the adjustment, which are the paths Stripe never sees]');
const adminSrc = bare('netlify/functions/admin-registrations.js');
// Cash at a desk is derived from the record, exactly like a card payment: a test
// activity's register is a rehearsal whether the money arrives by card or in an
// envelope. Executed in cash-at-the-desk-for-one-evening.js; pinned here so both
// desk actions are covered rather than only the one with a suite of its own.
H.eq((adminSrc.match(/mode: LST\.modeOfRecord\((?:att|reg)\),/g) || []).length, 2,
  'both desk payments stamp the mode off the record, never off a request');
// ⚠ THE ONE PLACE A MODE IS CHOSEN RATHER THAN DERIVED. An adjustment hangs off an
// ACCOUNT and no record, so there is no frozen block to read — it defaults to real
// money, which is what an adjustment almost always is, and the roster sends the
// mode of the activity the admin is standing on.
const adjust = adminSrc.slice(adminSrc.indexOf("case 'adjustCredit'"),
                              adminSrc.indexOf("case 'ledger'"));
H.ok(/const mode = LST\.normaliseMode\(body\.mode\);/.test(adjust),
  'an adjustment takes a mode, normalised, so an unknown value reads as real money');
H.ok(/reason: 'admin-adjustment', mode: mode,/.test(adjust), 'and writes it on the entry');
H.ok(/balanceFor\(account\.accountId, mode\)/.test(adjust),
  'and answers with the balance in that mode rather than a combined one');
H.ok(/mode: mode,/.test(read('js/registrations-admin.js')),
  'the roster sends it');
H.ok(/var mode = r\.paymentMode === 'test' \? 'test' : 'live';/.test(read('js/registrations-admin.js')),
  'from the row, which carries the mode the activity it is on was sold in');
// And the panel offers the balance it is allowed to spend rather than a combined
// figure the server would then refuse.
H.ok(/testBalanceCents: ledger\.balanceOf\(entries, 'test'\)/.test(adminSrc),
  'the ledger panel is sent both balances, because one number would be a sum nobody is owed');

console.log('\n[a listing change is counted rather than applied]');
const fallout = require(H.fnPath('_registration-fallout'));
H.ok(!fallout.paymentModeMoved(null, { listing: 'test' }),
  'a first publish has nothing to have moved from');
H.ok(fallout.paymentModeMoved({ listing: 'listed' }, { listing: 'test' }),
  'listed -> test moves the mode');
H.ok(!fallout.paymentModeMoved({ listing: 'listed' }, { listing: 'unlisted' }),
  '⚠ and listed -> UNLISTED does not, because unlisted is real money — hiding a ' +
  'class is not the same act as rehearsing one');
H.eq(fallout.onOldMode({ listing: 'test' }, [
  { status: 'approved', frozen: { paymentMode: 'live' } },
  { status: 'pending', frozen: { paymentMode: 'live' } },
  { status: 'cancelled', frozen: { paymentMode: 'live' } },
  { status: 'approved', frozen: { paymentMode: 'test' } }
]), 2, 'and the live registrations still on the old mode are counted, cancelled ones aside');
H.ok(/payments now ' \+ fallout\.mode\.to \+ ' mode/.test(read('netlify/functions/activities-admin.js')),
  'the audit line names it');
H.ok(/Payments on this activity now run through the/.test(read('js/activities-admin.js')),
  'and so does the notice on the screen');

H.done();
})();
