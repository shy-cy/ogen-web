// What this defends against:
//
// The "Registration button link" field is where the sidebar CTA points. It is
// free text, and it sits next to a button whose WORDING comes from somewhere
// else entirely — the STATUS table in js/activity.js. So the obvious thing to
// type into a field labelled "registration button" is the words you want on the
// registration button. That is exactly what was typed:
//
//   ctaUrl = { he: "לחץ להרשמה", en: "Register Now", ru: "Register Now" }
//
// It was published. The value went straight into the href, resolved relative to
// the page, and every language's registration button led to a 404 —
// /activities/לחץ להרשמה and /en/activities/Register%20Now, both verified live.
// Nothing looked wrong: the button still read "Register interest", because that
// text never came from this field. It failed only on click.
//
// Three layers now, and they must not drift apart:
//   1. the template refuses to publish a value that is not plainly a link, so
//      the button falls back to the contact section rather than a dead end;
//   2. the server says so on save, naming the language, so a wrong value is
//      corrected rather than silently discarded;
//   3. the client says the same thing before the round trip.
//
// The allowlist is also the reason `javascript:` cannot reach an href here.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const { isLinkish, renderActivityPage } = require('../netlify/functions/_activity-template');
const { validate } = require('../netlify/functions/activities-admin')._internal;
const adminJs = fs.readFileSync(path.join(R, 'js/activities-admin.js'), 'utf8');
const templateJs = fs.readFileSync(path.join(R, 'netlify/functions/_activity-template.js'), 'utf8');

console.log('[what counts as a link]');
[
  ['https://forms.gle/abc',  'an absolute https URL'],
  ['http://example.com',     'and a plain http one'],
  ['/#contact',              'a path on this site'],
  ['/en/activities',         'including a deeper one'],
  ['#register',              'a fragment, which is the default target'],
  ['mailto:info@ogen.cy',    'an email link'],
  ['tel:+35799123456',       'a phone link']
].forEach(([v, why]) => H.ok(isLinkish(v), why));

console.log('\n[what does not]');
[
  ['Register Now',    'the English label that actually got published'],
  ['לחץ להרשמה',      'and the Hebrew one'],
  ['Оставить заявку', 'and the Russian equivalent'],
  ['www.ogen.cy',     'a bare host, which a browser would treat as a relative path'],
  ['',                'nothing at all'],
  ['   ',             'or whitespace'],
  ['/a path',         'a path with a space in it is prose, not a URL']
].forEach(([v, why]) => H.ok(!isLinkish(v), why));

console.log('\n[the allowlist is what keeps script out of the href]');
// Not a blocklist: these fail because they are never matched, so a scheme
// nobody thought of fails the same way rather than needing to be remembered.
['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,<script>alert(1)</script>',
 'vbscript:x', ' javascript:alert(1)'].forEach((v) => {
  H.ok(!isLinkish(v), `refused: ${v.trim().slice(0, 28)}`);
});

console.log('\n[the page falls back to the contact form, never to a dead end]');
const activity = (ctaUrl) => ({
  slug: 'hebrew4kids', status: 'open',
  title: { he: 'עברית לילדים', en: 'Hebrew for kids' },
  about: { he: 'תיאור' }, facts: {}, teachers: [], sponsors: [], faq: []
});
const attrOf = (html) => (/data-cta-url="([^"]*)"/.exec(html) || [null, null])[1];

const withLabel = Object.assign(activity(), { ctaUrl: { he: 'לחץ להרשמה', en: 'Register Now' } });
H.eq(attrOf(renderActivityPage(withLabel, 'he')), null,
  'a label is not published as a link — the attribute is absent');
H.eq(attrOf(renderActivityPage(withLabel, 'en')), null, 'in English too');
// Absent is the whole point: js/activity.js reads `root.dataset.ctaUrl ||
// '#register'`, so an absent attribute IS the contact section.
H.ok(/root\.dataset\.ctaUrl \|\| '#register'/.test(
  fs.readFileSync(path.join(R, 'js/activity.js'), 'utf8')),
  "and an absent attribute means '#register', the contact section");

const withLink = Object.assign(activity(), { ctaUrl: { he: '/#contact', en: '/en/#contact' } });
H.eq(attrOf(renderActivityPage(withLink, 'he')), '/#contact', 'a real link is published as given');
H.eq(attrOf(renderActivityPage(withLink, 'en')), '/en/#contact', 'per language');
const withScript = Object.assign(activity(), { ctaUrl: { he: 'javascript:alert(1)' } });
H.eq(attrOf(renderActivityPage(withScript, 'he')), null, 'and a script URL never reaches the page');

console.log('\n[the save says so, rather than discarding it quietly]');
// Silence would mean the admin typed a value, watched it save, and never
// learned it was being thrown away — which is how it reached the live site.
const saving = (ctaUrl) => {
  try {
    validate({ slug: 'hebrew4kids', status: 'open', title: { he: 'עברית' }, ctaUrl });
    return null;
  } catch (err) { return err; }
};
H.eq(saving({ he: '', en: '', ru: '' }), null, 'an empty field saves — it is optional');
H.eq(saving({ he: '/#contact', en: '/en/#contact', ru: '' }), null, 'a real link saves');
H.eq(saving(undefined), null, 'and so does a record that has no such field at all');

const err = saving({ he: '/#contact', en: 'Register Now', ru: '' });
H.ok(!!err, 'a label is refused');
H.ok(err && err.message.indexOf('EN') !== -1,
  'and the message names the language, because only one of three is usually wrong');
H.ok(err && err.message.indexOf('Register Now') !== -1, 'quoting what was actually typed');
H.ok(err && /https:\/\/|\/#contact/.test(err.message), 'and showing what one looks like');
H.ok(err && err.validation.length === 1, 'one error, for the one bad language');
H.ok(saving({ he: 'javascript:alert(1)' }) !== null, 'a script URL is refused on save too');

console.log('\n[the client says the same thing, before the round trip]');
const clientPattern = /var LINKISH = (\/\^.*\$\/i);/.exec(adminJs);
const serverPattern = /const LINKISH = (\/\^.*\$\/i);/.exec(templateJs);
H.ok(!!clientPattern && !!serverPattern, 'both files declare the rule');
H.eq(clientPattern && clientPattern[1], serverPattern && serverPattern[1],
  'and the two patterns are identical, character for character');
// The guard has to run before every path that stores the value, not just publish:
// a draft saved with a label in it is a label waiting to be published.
['doPreview', 'doSaveDraft', 'doPublish'].forEach((fn) => {
  const body = adminJs.slice(adminJs.indexOf('function ' + fn));
  H.ok(body.slice(0, 400).indexOf('requireCtaLink()') !== -1,
    `${fn} checks the link before sending`);
});
H.ok(/f-ctaUrl-/.test(adminJs), 'reading the per-language field by its real id');

console.log('\n[the field says what it wants]');
const hintText = adminJs.slice(adminJs.indexOf("label: 'Registration button link'"),
                               adminJs.indexOf("'f-ctaUrl'"));
H.ok(/https:\/\//.test(hintText), 'the hint shows what a link looks like');
H.ok(/\/#contact/.test(hintText), 'including a path on this site');
H.ok(/wording/.test(hintText),
  "and says outright that it is not the button's wording, which is the mistake it invites");

H.done();
