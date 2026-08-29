// What this defends against:
//
// An activity's location was one field with a members-only flag that nothing
// acted on. That combination is the worst of both: the flag said "private", the
// page published it anyway, and the only honest options were to publish a street
// address or to publish nothing at all about where the activity happens.
//
// It is two facts now. `location` is the general one — "Limassol" — and is
// public, because a family needs to know whether an activity is near them.
// `address` is the exact one, and is members-only from birth.
//
// That makes the flag safe to enforce, and enforcement is what this suite pins.
// Enforcement means the row is OMITTED from the generated HTML. Rendering it and
// hiding it with CSS or a `hidden` attribute would publish it: these files are
// static, served to anyone who asks, and a page's source is one keystroke away.
//
// The address must survive in the record, though. It is not secret from the
// admin who typed it, and an authenticated members view has to be able to read
// it later — so "never published" must not decay into "never stored".

const H = require('./_helpers');
const F = require('../netlify/functions/_activity-facts');
const { migrate } = require('../netlify/functions/_activity-migrate');
const tpl = require('../netlify/functions/_activity-template');

const STREET = { he: 'רחוב הרצל 5, לימסול', en: '5 Herzl Street, Limassol', ru: 'ул. Герцля 5, Лимассол' };

const activity = () => migrate({
  slug: 'purim-workshop', status: 'open',
  title: { he: 'סדנת פורים', en: 'Purim workshop', ru: 'Мастерская Пурим' },
  about: { he: 'תיאור', en: 'Description', ru: 'Описание' },
  facts: {
    ages: { min: 6, max: 10 },
    location: { text: { he: 'לימסול', en: 'Limassol', ru: 'Лимассол' } },
    address: { text: STREET }
  },
  teachers: [], sponsors: [], faq: []
});

console.log('[the two locations are separate facts, not one field with a mood]');
H.ok(F.FACT_ORDER.indexOf('location') !== -1, 'the general location is a fact');
H.ok(F.FACT_ORDER.indexOf('address') !== -1, 'the exact address is a fact of its own');
H.eq(F.visibilityOf({}, 'location'), 'public', 'the general one is public by default');
H.eq(F.visibilityOf({}, 'address'), 'members', 'the exact one is members-only by default');

console.log('\n[the flag is enforced, in exactly one place]');
H.ok(!F.isPubliclyVisible('members'), 'members-only is not publicly visible');
H.ok(F.isPubliclyVisible('public'), 'public is');
const src = require('fs').readFileSync(require.resolve('../netlify/functions/_activity-facts'), 'utf8');
H.eq((src.match(/isPubliclyVisible\(/g) || []).length, 2,
     'isPubliclyVisible is defined once and called once — no second copy of the rule');

console.log('\n[so it never reaches the published rows]');
const act = activity();
const keys = F.sidebarRows(act, 'he').map((r) => r.key);
H.ok(keys.indexOf('location') !== -1, 'the general location is published');
H.ok(keys.indexOf('address') === -1, 'the exact address is not');
const grouped = [].concat(...F.sidebarGroups(act, 'he').map((g) => g.facts.map((f) => f.key)));
H.ok(grouped.indexOf('address') === -1, 'nor does it survive into the grouped sidebar');
H.ok(grouped.indexOf('location') !== -1, 'while the general one does');

console.log('\n[and never reaches the HTML, in any language]');
// The real assertion: not "is it flagged" but "is the street in the file".
['he', 'en', 'ru'].forEach((lang) => {
  const html = tpl.renderActivityPage(act, lang);
  H.ok(html.indexOf(STREET[lang]) === -1, 'the street address is absent from the ' + lang + ' page');
  H.ok(html.indexOf('data-fact="address"') === -1, 'and so is any row for it (' + lang + ')');
  H.ok(html.indexOf('Herzl') === -1 && html.indexOf('הרצל') === -1,
       'no fragment of it leaks in another language on the ' + lang + ' page');
});
// It is omitted, not hidden: nothing may render it and then style it away.
const he = tpl.renderActivityPage(act, 'he');
H.ok(!/data-fact-visibility="members"/.test(he),
     'no members-only row is written into the page at all');
H.ok(he.indexOf('לימסול') !== -1, 'the general location IS on the page');

console.log('\n[but it is stored, because an authenticated view will need it]');
H.eq(F.factText(act, 'address', 'he'), STREET.he, 'the fact still reads back for a caller that may see it');
H.eq(act.facts.address.text.en, STREET.en, 'and survives in the record');
const round = migrate(JSON.parse(JSON.stringify(act)));
H.eq(round.facts.address.text.ru, STREET.ru, 'and survives a second migration');

console.log('\n[migrating an old record invents no address]');
// The words in `location` are a city. Moving them into the address field would
// claim an activity has a street address nobody ever typed.
const old = migrate({ facts: { location: { he: 'לימסול', en: 'Limassol', ru: '' } } });
H.eq(old.facts.location.text.he, 'לימסול', 'the general location keeps its words');
H.eq(old.facts.address.text.he, '', 'and the address starts empty');
H.eq(F.factText(old, 'address', 'he'), '', 'so nothing is published for it');

console.log('\n[the admin draws two of them without collapsing them into one]');
// Both facts are kind:'location'. The editor keyed its inputs by the KIND, so
// the second fact reused the first one's element ids — duplicate ids, and a
// read-back that took the first match for both. Saving would have written the
// general location into the exact address and lost whatever was typed there.
const adminJs = require('fs').readFileSync(require('path').join(__dirname, '..', 'js/activities-admin.js'), 'utf8');
H.ok(adminJs.indexOf("'fact-location'") === -1,
     'no input id is hardcoded to the kind');
H.ok(/body = fieldRow\(\{ label: 'Text' \}, langObj\(fact\.text\), 'fact-' \+ d\.key\)/.test(adminJs),
     'the field is keyed by the fact key when it is drawn');
H.ok(/d\.kind === 'location'\) out = \{ text: readLangField\('fact-' \+ d\.key\) \}/.test(adminJs),
     'and by the same key when it is read back');
const locationKinds = require('../netlify/functions/activities-admin')._internal
  .FIELD_SCHEMA.facts.filter((f) => f.kind === 'location').map((f) => f.key);
H.eq(JSON.stringify(locationKinds), '["location","address"]',
     'and there really are two facts of this kind, which is what made it matter');

H.done();
