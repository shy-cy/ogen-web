// What this defends against:
//
// This replaces tests/the-registration-link-is-a-link-not-a-label.js, which
// guarded a field that no longer exists. Keeping the history matters, because
// the field is why this file is here at all.
//
// `ctaUrl` was an escape hatch from before registration existed: the button
// needed somewhere to point, so an admin typed it. Phase 6 built the real
// target — /account/activity?register=<slug>, in the reader's own language tree — and
// the hatch stayed open behind it.
//
// EVERY VALUE IT EVER CARRIED ON THIS SITE WAS A MISTAKE. First the button's
// own LABEL, which shipped as <a href="Register Now"> and 404'd in three
// languages while still READING "Register interest" — it looked right and
// failed only on click. Then the site homepage, which sent parents away from
// the form they had come to find, and sat live until somebody tested the
// button.
//
// The old suite's answer was isLinkish(): an allowlist of http(s), site paths,
// fragments, mailto: and tel:. It did its job both times and both bugs shipped
// anyway, because an allowlist can tell a link from prose and CANNOT tell a
// right URL from a wrong one. The second value was a perfectly well-formed
// https:// URL on this very domain. No amount of validating that field would
// have caught it.
//
// So the field is gone and the link is derived. What this pins is that it
// STAYS gone — a reintroduced override would look like a small convenience and
// would restore the exact failure twice already paid for — and that the derived
// link is right in all three languages.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const { renderActivityPage } = require('../netlify/functions/_activity-template');
const { migrate } = require('../netlify/functions/_activity-migrate');

console.log('[the override is gone from every layer]');
const LAYERS = {
  'netlify/functions/_activity-template.js': ['ctaUrl', 'isLinkish', 'data-cta-url'],
  'netlify/functions/activities-admin.js': ['ctaUrl', 'isLinkish'],
  'js/activities-admin.js': ['ctaUrl', 'requireCtaLink', 'LINKISH'],
  'js/activity.js': ['ctaUrl'],
  'admin/activities.html': ['cta-field']
};
Object.keys(LAYERS).forEach((file) => {
  const src = read(file);
  LAYERS[file].forEach((needle) => {
    // Comments are stripped first: this repo has had three tests pass by
    // matching their own explanatory prose, and the files above now DESCRIBE
    // the removed field at length.
    const bare = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    H.ok(bare.indexOf(needle) === -1, file + ' has no live ' + needle);
  });
});

console.log('\n[a record carrying one is cleaned on read]');
const dirty = migrate({ slug: 'x', title: { he: 'ע' }, ctaUrl: { he: 'https://evil.example/' } });
H.eq(dirty.ctaUrl, undefined, 'migrate() drops the key, so a record stops carrying it from its next save');
H.eq(migrate(migrate({ slug: 'x', ctaUrl: { he: 'y' } })).ctaUrl, undefined, 'and it is idempotent');

console.log('\n[and no published page carries the attribute]');
const activity = {
  slug: 'hebrew4kids', status: 'open',
  title: { he: 'עברית', en: 'Hebrew', ru: 'Иврит' },
  about: { he: 'א', en: 'a', ru: 'а' },
  ctaUrl: { he: 'https://www.ogen.cy/', en: 'Register Now', ru: '/#contact' }
};
['he', 'en', 'ru'].forEach((lang) => {
  const html = renderActivityPage(activity, lang);
  H.ok(html.indexOf('data-cta-url') === -1,
    lang + ': the attribute is not emitted even when the record still holds a value');
  H.ok(/<article class="activity" data-status="open">/.test(html),
    lang + ': and the article tag carries status alone');
});

console.log('\n[the derived link is per-language, and a path on this site]');
const js = read('js/activity.js');
H.ok(/const base = lang === 'he' \? '' : '\/' \+ lang/.test(js),
  "the tree prefix is '' for Hebrew — '/' + '/account' would be a host called \"account\"");
H.ok(/base \+ '\/account\/activity\?register=' \+ encodeURIComponent\(slug\)/.test(js),
  'the slug is encoded into the query, not concatenated raw');
H.ok(/: base \+ '\/account'/.test(js),
  'and a page with no readable slug still reaches the family area');
// The one property the old isLinkish() existed to guarantee, now structural:
// the href is assembled from a fixed prefix and an encoded slug, so there is no
// input that can make it leave this site or become a javascript: URL.
H.ok(!/dataset\./.test(js.slice(js.indexOf('data-status-cta'), js.indexOf('data-credits'))),
  'nothing in the CTA branch reads an attribute off the page any more');

console.log('\n[the button still says what the STATUS says, which never changed]');
H.ok(/badge:\s*\{ he:'פתוח לרישום'/.test(js.replace(/\s+/g, ' ')) ||
     /פתוח לרישום/.test(js), 'the open badge text is still in the STATUS table');
H.ok(/cta:\s*\{ he:'הרשמה לחוג'/.test(js.replace(/\s+/g, ' ')) ||
     /הרשמה לחוג/.test(js), 'and so is the button label — the two are different strings');

H.done();
