// A family on the HEBREW page, filling in a HEBREW form, under a HEBREW
// heading, typed an address that already had an account — and was answered:
//
//     An account with that email already exists
//
// Every refusal in the family area was like that. The eighteen shells, the one
// {he,en,ru} table, the RTL, the language toggle: all of it translated, and
// then the moment anything went wrong the page switched to English, which is
// the moment somebody most needs to be able to read it. A parent who cannot
// tell "that password is too short" from "we could not reach the server" tries
// the same thing again, or gives up, or opens an account under a second
// address — which is the one outcome that leaves real mess behind.
//
// It was not a missing translation. It was a whole CLASS of string that had
// never been treated as copy at all, because it lived on the server, and the
// server's other display strings had only just been fixed (the group names and
// the price rows were rendering in the language on the ACCOUNT rather than the
// language on the SCREEN).
//
// So this suite asks four things, and the last one is the one that matters in a
// year's time:
//
//   1. every message is complete in all three languages
//   2. every key the code uses exists, and every key that exists is used
//   3. the handlers ANSWER in the language they were asked in
//   4. ⚠ no family endpoint emits an English sentence any more — which is what
//      stops the next refusal somebody adds from being English, silently, in
//      the one place nobody looks until a family writes in.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const E = require(H.fnPath('_family-errors'));
const fnDir = path.dirname(H.fnPath('_family-errors'));
const read = (f) => fs.readFileSync(path.join(fnDir, f), 'utf8');

// The three endpoints a family's browser talks to.
const HANDLERS = ['account-auth.js', 'account-family.js', 'account-registrations.js'];

// The check-in page is the fourth family-facing endpoint and is the odd one:
// it has no session at all, and no language in its URL, because a code on a
// wall cannot be three posters. The page chooses and sends it. Its refusals go
// through the same table, but it cannot be driven by the `me`/401 loop below —
// so it is held to the static half of this suite and exercised by
// a-code-on-a-wall-opens-one-evening.js.
const WITH_NO_SESSION = ['checkin.js'];

console.log('[every message is complete, in all three languages]');
const keys = Object.keys(E.MESSAGES);
H.ok(keys.length > 50, 'there is a table, and it is not a stub (' + keys.length + ' messages)');

keys.forEach((k) => {
  const row = E.MESSAGES[k];
  E.LANGS.forEach((l) => {
    const v = row[l];
    H.ok(v != null, k + ' has ' + l);
    // A function is the parametrised form; render it with a filler so the
    // shape is checked the same way as a plain string.
    const text = typeof v === 'function' ? v({ min: 8, max: 2, status: 'x', closedOn: '2026-01-01' }) : v;
    H.ok(typeof text === 'string' && text.trim().length > 0, k + '.' + l + ' is not blank');
    // undefined inside a template literal is the failure this catches: it
    // renders as the word, and it renders perfectly happily.
    H.ok(text.indexOf('undefined') === -1, k + '.' + l + ' interpolates rather than printing "undefined"');
  });
});

console.log('\n[and the three are actually three, not one copied across]');
keys.forEach((k) => {
  const row = E.MESSAGES[k];
  const at = (l) => (typeof row[l] === 'function' ? row[l]({ min: 8, max: 2, status: 'x', closedOn: 'd' }) : row[l]);
  // Hebrew must contain Hebrew letters and Russian must contain Cyrillic. A
  // key quietly left holding the English is exactly the failure this whole
  // suite exists for, and it is invisible to a reviewer who does not read the
  // language.
  H.ok(/[֐-׿]/.test(at('he')), k + ' is in Hebrew');
  H.ok(/[Ѐ-ӿ]/.test(at('ru')), k + ' is in Russian');
});

console.log('\n[a parameter reaches all three grammars]');
[['password-short', { min: 8 }, '8'],
 ['max-guardians', { max: 2 }, '2'],
 ['too-many-dates', { max: 12 }, '12'],
 ['cancellation-closed', { closedOn: '2026-11-04' }, '2026-11-04'],
 ['already-in-status', { status: 'cancelled' }, 'cancelled']].forEach(([key, params, needle]) => {
  E.LANGS.forEach((l) => {
    H.ok(E.text(key, l, params).indexOf(needle) !== -1,
      key + ' carries its ' + needle + ' in ' + l);
  });
});

console.log('\n[an unknown key apologises rather than throwing]');
// A throw here would turn a 409 a family can act on into a 500 they cannot, so
// the fallback is deliberate — and the gate against it is the next section,
// which reads the keys off the source.
H.eq(E.text('no-such-key-at-all', 'en'), E.text('server-error', 'en'),
  'an unrecognised key falls through to the generic apology');
H.eq(E.text('not-signed-in', 'xx'), E.text('not-signed-in', 'en'),
  'and an unrecognised language falls back to English rather than to nothing');

console.log('\n[every key the code uses exists, and every key that exists is used]');
// Read straight off the source, so a key added tomorrow is covered without
// anybody editing this file.
//
// ⚠ EXCLUDING THE TABLE'S OWN FILE. Scanning it too made this check pass on
// every key by definition — each key matched the quoted string that DECLARES
// it, so an orphan looked used and the assertion below was decoration. The
// check is about whether anything CALLS a message, and the declaration is not
// a call.
const allSrc = fs.readdirSync(fnDir)
  .filter((f) => f.endsWith('.js') && f !== '_family-errors.js')
  .map((f) => read(f)).join('\n');
const quoted = new Set((allSrc.match(/'[a-z][a-z0-9-]{3,}'/g) || []).map((q) => q.slice(1, -1)));

const used = keys.filter((k) => quoted.has(k));
const orphans = keys.filter((k) => !quoted.has(k));
// An orphan is dead copy that three languages carry — and it is
// indistinguishable from a key whose only caller was renamed, which is a real
// bug wearing a harmless costume. Same rule the family area's T table follows.
H.eq(orphans.join(', '), '', 'no message is unreachable');
H.ok(used.length === keys.length, 'every message has a caller');

// The other direction: a handler naming a key that is not in the table would
// render the generic apology, and nothing would say so.
HANDLERS.concat(WITH_NO_SESSION).forEach((f) => {
  const src = read(f);
  const named = (src.match(/\bno\(\s*\d+\s*,\s*'([a-z][a-z0-9-]+)'/g) || [])
    .map((m) => m.replace(/.*'([a-z][a-z0-9-]+)'$/, '$1'));
  H.ok(named.length > 0, f + ' refuses through the table');
  named.forEach((k) => H.ok(keys.indexOf(k) !== -1, f + ' names a real message: ' + k));
});

console.log('\n[⚠ NO FAMILY ENDPOINT EMITS AN ENGLISH SENTENCE ANY MORE]');
// These three are wire-level and stay English ON PURPOSE. They mean the client
// is broken or somebody is calling the API by hand; nobody using the site can
// reach them, and translating a message for a reader who does not exist would
// be three languages of maintenance behind a screen nobody sees.
const WIRE = ['Use POST', 'Body must be JSON', 'Bad request', 'Unknown action'];
HANDLERS.concat(WITH_NO_SESSION).forEach((f) => {
  const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const literals = (src.match(/error:\s*(['`])(?:\\.|(?!\1).)*\1/g) || [])
    .map((m) => m.replace(/^error:\s*['`]/, '').replace(/['`]$/, ''));
  const stray = literals.filter((t) => WIRE.indexOf(t) === -1 && !/^Unknown action/.test(t));
  H.eq(stray.join(' | '), '',
    f + ' puts no English sentence on a family\'s screen');
  // And the allowed ones are still there rather than having been deleted: the
  // rule is "translate what a family reads", not "stop answering".
  H.ok(/error: 'Use POST'/.test(src), f + ' still refuses a non-POST');
});

console.log('\n[the pure rule modules answer with keys, not prose]');
// A pure rule module is handed an activity and asked what is wrong with it. It
// has no reader, so it has no language. They name the refusal; whoever asked
// renders it.
const R = require(H.fnPath('_registration'));
const att = require(H.fnPath('_session-attendance'));
H.eq(R.submissionErrors(null, null, null).join(','), 'no-such-activity',
  'submissionErrors names a key');
H.eq(att.validate({ type: 'course' }, '2026-10-14'), 'dropin-only', 'so does validate()');
[].concat(R.submissionErrors({ status: 'closed', facts: {} }, { participantId: 'p' }, null),
          [att.validate({ type: 'course' }, 'x')])
  .forEach((k) => H.ok(keys.indexOf(k) !== -1, 'and the key it names is a real message: ' + k));

console.log('\n[EXECUTED: each endpoint answers in the language it was asked in]');
// Not a source match. The three handlers are invoked, with no session, and the
// refusal that comes back is read. It reaches no store — authenticate() with no
// token answers before opening one — so this needs no fixtures.
(async () => {
  for (const f of HANDLERS) {
    const handler = require(path.join(fnDir, f)).handler;
    const seen = {};
    for (const lang of E.LANGS) {
      const res = await handler({
        httpMethod: 'POST', headers: {},
        body: JSON.stringify({ action: 'me', lang: lang })
      });
      const payload = JSON.parse(res.body);
      H.eq(res.statusCode, 401, f + ' refuses an unsigned-in ' + lang + ' caller');
      H.eq(payload.code, 'not-signed-in', f + ' says which refusal it is, in ' + lang);
      seen[lang] = payload.error;
    }
    H.ok(/[֐-׿]/.test(seen.he), f + ' answers Hebrew in Hebrew');
    H.ok(/[Ѐ-ӿ]/.test(seen.ru), f + ' answers Russian in Russian');
    H.ok(/^[\x20-\x7E]+$/.test(seen.en), f + ' answers English in English');
  }

  // ⚠ AND THE DEFAULT IS HEBREW, not English. A caller that names no language
  // is answered in the language of the tree at `/`, which is the site's own
  // default — the same direction every other blank on this site falls.
  const auth = require(path.join(fnDir, 'account-auth.js')).handler;
  const bare = JSON.parse((await auth({
    httpMethod: 'POST', headers: {}, body: JSON.stringify({ action: 'me' })
  })).body);
  H.ok(/[֐-׿]/.test(bare.error), 'a caller naming no language gets Hebrew');

  H.done();
})();
