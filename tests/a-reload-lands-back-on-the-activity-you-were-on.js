// What this defends against:
//
// ⚠ THE ADMIN FORGOT WHICH ACTIVITY YOU WERE ON THE MOMENT YOU RELOADED.
//
// Reported from QA: "when I reload the Roster section, and I'm in a specific
// activity page, I get back to the first default activity. Same case for the
// Activities section." Both screens are a picker beside one record, both kept
// the selection in a `S.slug` that lives for exactly as long as the page does,
// and both booted by choosing for you — the Roster to the first row of the
// list, Activities to an empty "new activity" form.
//
// Every other piece of state on those screens is cheap to re-reach. This one is
// not: it is the thing you were working on, and on the Roster it is the row you
// had just finished finding. A reload is also what an admin does when something
// looks stale, which makes "reload" and "lose your place" the same gesture on
// the one screen where that costs the most.
//
// The URL holds it now — per tab, so two activities can be open side by side,
// and a link, so an admin can send another admin the screen rather than the
// name of it.
//
// Three ways this could rot, and each is pinned below:
//
//   1. ⚠ pushState instead of replaceState. Pressing a row in the picker is not
//      a navigation, and a history entry per press puts the Back button in
//      charge of swapping the record underneath an admin — WITHOUT the
//      beforeunload guard the activities form relies on, which fires on a real
//      unload and never on a history move. Back would silently discard whatever
//      had been typed. This is the rule the shared module exists to hold.
//   2. a slug in the URL TRUSTED rather than checked. A tab left open across a
//      delete holds a name the server will refuse, and the screen that used to
//      choose for you would then choose nothing at all.
//   3. a new place that assigns S.slug and does not carry the URL with it —
//      which is silent, because the screen is right and only the address bar is
//      wrong, until somebody reloads.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');

const urlSrc = read('js/admin-url.js');
const roster = read('js/registrations-admin.js');
const acts = read('js/activities-admin.js');

// Comments are stripped before every search below. The same lesson the CSS
// checks and the drop-in suite learned the hard way: this file's own prose
// names `pushState` several times, and a naive search finds the warning and
// reports the bug.
// Whole lines go, newline included, so "within the next few lines" below
// counts CODE rather than the paragraph explaining it.
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*\n/gm, '');
const bareUrl = strip(urlSrc);
const bareRoster = strip(roster);
const bareActs = strip(acts);

console.log('[one module, loaded by both screens that have a selection]');
H.ok(/window\.AdminUrl = \{ read: read, remember: remember \};/.test(bareUrl),
  'js/admin-url.js publishes exactly read and remember');

[['admin/activities.html', 'js/activities-admin.js'],
 ['admin/registrations.html', 'js/registrations-admin.js']].forEach(([page, client]) => {
  const src = read(page);
  H.ok(src.indexOf('src="/js/admin-url.js"') !== -1, page + ' loads the module');
  // Before the client that calls it, or the first call throws on a screen that
  // otherwise looks fine.
  H.ok(src.indexOf('src="/js/admin-url.js"') < src.indexOf('src="/' + client + '"'),
    page + ' loads it before ' + client);
});

console.log('[⚠ the history is not touched — replaceState, never pushState]');
H.ok(bareUrl.indexOf('replaceState') !== -1, 'the module replaces the entry');
H.eq(bareUrl.indexOf('pushState'), -1, 'and never pushes one');
// Nobody else reaches for the history API. Two callers is two places this rule
// has to be remembered, and it is the one that costs an admin their unsaved
// work when it is forgotten.
[['js/activities-admin.js', bareActs], ['js/registrations-admin.js', bareRoster]].forEach(([name, src]) => {
  H.eq(src.indexOf('history.pushState'), -1, name + ' does not push history');
  H.eq(src.indexOf('history.replaceState'), -1, name + ' does not write the URL itself');
});

console.log('[⚠ every assignment to S.slug carries the URL with it]');
// By shape rather than by counting the call sites that exist today: a fourth
// one added next year inherits the rule instead of having to remember it.
[['js/activities-admin.js', bareActs], ['js/registrations-admin.js', bareRoster]].forEach(([name, src]) => {
  const lines = src.split('\n');
  let seen = 0;
  lines.forEach((line, i) => {
    if (!/^\s*S\.slug = /.test(line)) return;
    seen++;
    const after = lines.slice(i, i + 6).join('\n');
    H.ok(/AdminUrl\.remember\('activity'/.test(after),
      name + ' line ' + (i + 1) + ': ' + line.trim() + ' is followed by the URL write');
  });
  H.ok(seen > 0, name + ' assigns S.slug somewhere (the check is looking at something)');
});

console.log('[⚠ the slug in the URL is checked, not trusted]');
H.ok(/var want = window\.AdminUrl\.read\('activity'\);/.test(bareRoster),
  'the roster reads the URL at boot');
H.ok(/S\.activities\.some\(function \(a\) \{ return a\.slug === want; \}\)/.test(bareRoster),
  'and only opens it when the list actually holds it');
H.ok(/loadQueue\(known \? want : S\.activities\[0\]\.slug\)/.test(bareRoster),
  'falling back to the first row, which rewrites the stale URL on its way');

// Activities cannot check against a list — the list arrives from the same call
// the record does — so it recovers instead: a failed load draws the picker.
H.ok(/var want = window\.AdminUrl\.read\('activity'\);/.test(bareActs),
  'activities reads the URL at boot');
const boot = bareActs.slice(bareActs.lastIndexOf("send({ action: 'auth' })"));
H.ok(boot.indexOf("AdminUrl.read('activity')") < boot.indexOf('fillForm(blankRecord(), null);'),
  '⚠ and reads it BEFORE drawing the blank form, which clears it');
const loadFn = bareActs.slice(bareActs.indexOf('function load(slug) {'));
H.ok(/Loading that activity'\)\);\s*\n\s*return refreshList\(null\);/.test(loadFn),
  'a failed load still draws the picker, so a deleted slug is recoverable');

console.log('[the module is executed, not read]');

// A window small enough to run js/admin-url.js in and no smaller — the same
// rule tests/_dom.js is built on. Reading the source can prove the source is
// self-consistent; only running it proves that pressing a row changes the
// address bar and that reloading reads the same thing back.
function runIn(href, opts) {
  const o = opts || {};
  const calls = [];
  const win = {
    location: { href: href },
    history: o.noHistory ? undefined : {
      replaceState: function (state, title, url) {
        calls.push(['replace', url]);
        win.location.href = new URL(url, win.location.href).href;
      },
      pushState: function () { calls.push(['push']); }
    },
    URL: URL
  };
  const ctx = { window: win, URL: URL };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(urlSrc, ctx);
  return { api: win.AdminUrl, win: win, calls: calls };
}

const base = 'https://www.ogen.cy/admin/registrations.html';

let t = runIn(base + '?activity=hebrew4kids');
H.eq(t.api.read('activity'), 'hebrew4kids', 'a slug in the query comes back');
H.eq(t.api.read('nothing'), null, 'a parameter that is not there reads as null');

t = runIn(base);
H.eq(t.api.read('activity'), null, 'no parameter reads as null rather than as an empty name');
t.api.remember('activity', 'beit-midrash');
H.eq(t.calls.length, 1, 'writing the URL is one call');
H.eq(t.calls[0][0], 'replace', '⚠ and it REPLACES the history entry');
H.eq(t.api.read('activity'), 'beit-midrash', 'and reads back as what was written');

// Switching activity five times must leave the history exactly as it was, or
// Back walks backwards through records rather than off the screen.
t = runIn(base);
['a', 'b', 'c', 'd', 'e'].forEach((s) => t.api.remember('activity', s));
H.eq(t.calls.filter((c) => c[0] === 'push').length, 0, 'five switches push nothing');
H.eq(t.api.read('activity'), 'e', 'and the last one is what is remembered');

t = runIn(base + '?activity=old&other=keep#panel');
t.api.remember('activity', 'new');
H.ok(t.win.location.href.indexOf('other=keep') !== -1, 'another parameter survives the write');
H.ok(t.win.location.href.indexOf('#panel') !== -1, 'and so does the fragment');
H.eq(t.api.read('activity'), 'new', 'while the activity is the one that moved');

// ⚠ "nothing is open" is a real state — a blank new-activity form is one — and
// `?activity=` reloading into it would be a URL that looks like it names
// something.
t = runIn(base + '?activity=hebrew4kids');
t.api.remember('activity', null);
H.eq(t.api.read('activity'), null, 'a null value removes the parameter');
H.eq(t.win.location.href.indexOf('activity='), -1, 'rather than writing an empty one');
t.api.remember('activity', '');
H.eq(t.api.read('activity'), null, 'and so does an empty string');

// Fails open in both directions: the memory is a convenience, and a browser
// that cannot provide it must cost exactly that and nothing else.
t = runIn(base + '?activity=hebrew4kids', { noHistory: true });
t.api.remember('activity', 'other');
H.eq(t.calls.length, 0, 'no history API means nothing is written');
H.eq(t.api.read('activity'), 'hebrew4kids', 'and reading still works');

t = runIn('not a url at all');
H.eq(t.api.read('activity'), null, 'an unparseable address reads as null rather than throwing');
t.api.remember('activity', 'x');
H.ok(true, 'and writing to one does not throw either');

H.done();
