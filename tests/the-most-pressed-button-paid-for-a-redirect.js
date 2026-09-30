// What this defends against: the site's most-pressed control costing an extra
// round trip before the page it points at began to load.
//
// /activities is a DIRECTORY on disk and a FILE everywhere else. The homepage
// hero button, the #offer banner, the nav's Activities link, the family area's
// "See all activities", every activity page's breadcrumb, the canonical tag and
// the sitemap all publish `/activities` with no trailing slash — and Netlify's
// pretty-URL handling answered that with a 301 to `/activities/`. Measured
// against the live site: 0.56s to follow the link against 0.28s for the page on
// its own, so the hop roughly DOUBLED the time to the listing.
//
// ⚠ AND IT WAS AN SEO FAULT AS WELL AS A SLOW ONE. The canonical tag named a URL
// that redirects and the sitemap submitted the same one, so the page told a
// crawler its address was `/activities` and the server said otherwise.
//
// The fix is a REWRITE, so the URL stays the one everything already publishes.
// That makes this a pair, and both halves are pinned below: a rewrite for a path
// nothing links to would be dead config, and a slashless link with no rewrite is
// the 301 back again.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const toml = read('netlify.toml');

const TREES = [['he', ''], ['en', '/en'], ['ru', '/ru']];

console.log('[nothing links to the listing with a trailing slash]');

// The buttons a reader presses, per tree — the hero and the #offer banner.
TREES.forEach(([lang, base]) => {
  const file = lang === 'he' ? 'index.html' : lang + '/index.html';
  const html = read(file);
  const want = 'href="' + base + '/activities"';
  const n = html.split(want).length - 1;
  H.ok(n >= 2, file + ' points at ' + base + '/activities ' + n + ' times (hero and offer banner)');
  H.ok(html.indexOf('href="' + base + '/activities/"') === -1,
    'and never with a trailing slash');
});

// The three built links: the nav, the family area, the breadcrumb.
H.ok(/base \+ '\/activities'/.test(read('js/nav.js')), "js/nav.js builds it slashless");
H.ok(/url\('\/activities'\)/.test(read('js/member-account.js')), 'the family area does too');
console.log('\n[and the canonical and the sitemap say the same thing]');
TREES.forEach(([lang, base]) => {
  const file = (lang === 'he' ? '' : lang + '/') + 'activities/index.html';
  const html = read(file);
  H.ok(html.indexOf('<link rel="canonical" href="https://www.ogen.cy' + base + '/activities">') !== -1,
    file + ' is canonical at ' + base + '/activities');
});
const sitemap = read('sitemap.xml');
TREES.forEach(([lang, base]) => {
  H.ok(sitemap.indexOf('<loc>https://www.ogen.cy' + base + '/activities</loc>') !== -1,
    'the sitemap submits ' + base + '/activities');
  H.ok(sitemap.indexOf('<loc>https://www.ogen.cy' + base + '/activities/</loc>') === -1,
    'and not the redirecting form');
});

console.log('\n[so the server has to answer that URL itself]');

// Every rule, in file order — the order IS the behaviour: the first match wins.
const rules = [];
toml.replace(/\[\[redirects\]\]([\s\S]*?)(?=\n\[|\s*$)/g, (_, body) => {
  const from = (body.match(/from\s*=\s*"([^"]+)"/) || [])[1];
  const status = Number((body.match(/status\s*=\s*(\d+)/) || [])[1]);
  const to = (body.match(/to\s*=\s*"([^"]+)"/) || [])[1];
  const force = /force\s*=\s*true/.test(body);
  if (from) rules.push({ from, to, status, force });
  return '';
});
H.ok(rules.length >= 5, 'netlify.toml declares ' + rules.length + ' redirect rules');

const at = (from) => rules.findIndex((r) => r.from === from);
TREES.forEach(([lang, base]) => {
  const i = at(base + '/activities');
  H.ok(i !== -1, base + '/activities has a rule');
  H.eq(rules[i].status, 200, 'and it is a rewrite, not a redirect');
  H.eq(rules[i].to, base + '/activities/index.html', 'serving the listing directly');
  // ⚠ WITHOUT `force` THE RULE IS DECLARED AND NEVER RUNS, which is how this
  // shipped once and changed nothing. A Netlify redirect is only consulted when
  // NOTHING in the publish tree matches the request — and `activities/` is a
  // directory in the tree, so the directory-index normalisation answers first
  // with the very 301 this rule exists to remove. Every other assertion in this
  // file passed for a deploy that still redirected, because reading the config
  // proves the config says what it says and can never make the CDN honour it.
  // Verified on a draft deploy: 200 with `force`, 301 without.
  H.eq(rules[i].force, true,
    base + '/activities is FORCED, or the static directory match wins and the rule is dead config');
});

// ⚠ THE ORDERING IS THE WHOLE THING. The first matching rule wins, so below the
// catch-all these would never run, and above /api/* a function route could be
// shadowed by one of them.
const four04 = at('/*');
H.ok(four04 !== -1, 'the catch-all 404 is still there');
TREES.forEach(([lang, base]) => {
  H.ok(at(base + '/activities') < four04,
    base + '/activities is matched before the catch-all 404');
  H.ok(at(base + '/activities') > at('/api/*'),
    'and after the function routes, which must not be shadowed');
});
H.eq(rules[four04].status, 404, 'and the catch-all is still a 404');

console.log('\n[the activity pages breadcrumb to the same URL]');
// One place builds it, so the breadcrumb, the canonical and the sitemap cannot
// disagree about where the listing lives.
const tsrc = read('netlify/functions/_activity-template.js');
H.ok(/indexPathFor = \(lang\) => \(lang === 'he' \? '\/activities' : `\/\$\{lang\}\/activities`\)/.test(tsrc),
  'indexPathFor builds the slashless path, in one place');
H.ok(tsrc.indexOf("'/activities/'") === -1, 'and nowhere in the template adds a trailing slash');

H.done();
