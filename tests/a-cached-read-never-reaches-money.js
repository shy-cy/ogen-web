// What this defends against:
//
// The family area was slow because every screen was several API calls and each
// one read the same activity file from the GitHub API. Two fixes, and the second
// is the dangerous one.
//
// A. FEWER CALLS. The dashboard was four requests (`me`, the participant count,
//    the registrations, the balance) for one question about one account, and the
//    activity page was three (the registration, the evenings, the bundles), each
//    a GitHub round trip for the same file. They are one call each now.
//
// B. A CACHED READ — and the argument for it was "this is only display data,
//    and the money paths verify everything fresh anyway", WHICH WAS NOT TRUE
//    WHEN IT WAS MADE. One published() served ten call sites in that file and
//    SIX OF THEM WRITE: booking, paying, buying, moving, submitting. Caching it
//    would have meant a family charged a price that was edited ten seconds ago,
//    and nothing about that looks wrong until two receipts are compared.
//
//    So the premise is true by construction rather than by assumption. Two
//    functions, and this suite is the thing that keeps them apart — because the
//    next action added will pick one of them, and the wrong pick is invisible.
//
// The TTL is short on purpose and the number to compare it against is not zero:
// the deployed bundle already trails a save by about a minute, which is exactly
// what the uncached read exists to beat.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const src = read('netlify/functions/account-registrations.js');
const bare = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Every `case 'x': {` and the reader it uses. Read off the source rather than
// listed here, so an action added tomorrow is covered without anybody editing
// this file — which is the only way a rule like this survives.
function readsByAction() {
  const out = {};
  let current = null;
  bare.split('\n').forEach((line) => {
    const m = /case '(\w+)': \{/.exec(line);
    if (m) current = m[1];
    if (!current) return;
    if (/await publishedForDisplay\(/.test(line)) out[current] = 'cached';
    else if (/await published\(/.test(line)) out[current] = 'fresh';
  });
  return out;
}
const READS = readsByAction();

console.log('[every action that writes or takes money reads FRESH]');
// Six of them, and each one either freezes terms onto a record or opens a
// Checkout. A stale activity here is a wrong price, a wrong capacity, or a wrong
// age range, agreed to by a family and frozen where nothing will revisit it.
const MUST_BE_FRESH = ['submit', 'bookSession', 'bookAndPay', 'paySession',
                       'buyBundle', 'rescheduleSession'];
MUST_BE_FRESH.forEach((a) => {
  H.eq(READS[a], 'fresh', a + ' reads the activity fresh');
});

console.log('\n[and only the read-only ones are cached]');
const MAY_BE_CACHED = ['registerPanel', 'sessions', 'bundles', 'registration'];
MAY_BE_CACHED.forEach((a) => {
  H.eq(READS[a], 'cached', a + ' may use the cached read — it renders and writes nothing');
});
// ⚠ THE CATCH-ALL. Anything that reads an activity and is not on either list is
// a new action nobody classified, and the safe answer is not "probably fine".
Object.keys(READS).forEach((a) => {
  H.ok(MUST_BE_FRESH.indexOf(a) !== -1 || MAY_BE_CACHED.indexOf(a) !== -1,
    a + ' is classified — a new action reading an activity must be put on a list, ' +
    'because picking the wrong reader is invisible');
});

console.log('\n[the cached ones write nothing at all]');
// The classification above is a list; this checks the property behind it. An
// action on the cached list that saves a record has become a writer without
// anyone moving it.
const WRITES = /saveRegistration\(|saveAttendance\(|saveBundle\(|ledger\.append\(|createCheckout|createSessionsCheckout|createBundleCheckout/;
MAY_BE_CACHED.forEach((a) => {
  const start = bare.indexOf("case '" + a + "': {");
  const rest = bare.slice(start + 1);
  const next = rest.search(/\n      (case '|default:)/);
  const branch = rest.slice(0, next === -1 ? rest.length : next);
  H.ok(!WRITES.test(branch), a + ' writes nothing and opens no Checkout');
});

console.log('\n[the TTL is short, and shorter than the staleness it replaces]');
const ttl = Number(/const DISPLAY_TTL_MS = (\d+);/.exec(src)[1]);
H.ok(ttl >= 2000, 'long enough to collapse one page\'s burst of calls (' + ttl + 'ms)');
H.ok(ttl <= 30000,
  'and far shorter than the ~60s the deployed bundle already trails a save by, ' +
  'which is the staleness the uncached read exists to beat');

console.log('\n[a caller cannot poison the next reader]');
// Cached as a string and parsed per call: publishedForDisplay hands back a fresh
// object every time, so an action that mutates what it got — normalising,
// annotating, sorting — cannot change what the next request sees.
H.ok(/JSON\.stringify\(value\)/.test(src) && /JSON\.parse\(hit\.json\)/.test(src),
  'the cache holds a string and parses per call');

// Executed, because "it caches" and "it expires" are two claims and only one of
// them is visible in the source.
const { _internal } = require(H.fnPath('account-registrations'));
if (_internal && _internal.publishedForDisplay) {
  (async () => {
    let reads = 0;
    _internal._setReader(async (slug) => { reads++; return { activityId: 'act-1', slug: slug, n: reads }; });
    const t = 1000000;
    const a = await _internal.publishedForDisplay('x', t);
    const b = await _internal.publishedForDisplay('x', t + 500);
    H.eq(reads, 1, 'two calls inside the window are one read');
    H.eq(b.n, 1, 'and the second gets what the first got');
    a.n = 99;
    const c = await _internal.publishedForDisplay('x', t + 600);
    H.eq(c.n, 1, 'mutating the first copy does not reach the third');
    await _internal.publishedForDisplay('x', t + ttl + 1);
    H.eq(reads, 2, 'and past the window it reads again');
    const d = await _internal.publishedForDisplay('y', t);
    H.eq(d.slug, 'y', 'a different activity is a different entry');
    _internal._setReader(null);
    H.done();
  })();
} else {
  H.ok(false, 'account-registrations exposes publishedForDisplay for this test');
  H.done();
}
