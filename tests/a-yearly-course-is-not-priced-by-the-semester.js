// What this defends against:
//
// Reported from the live listing, beside the wall-of-dates bug and for the same
// reason — a card stating something it could not know: "Cost per Semester —
// another issue, as some courses, like intro to Judaism, is a Yearly Course."
//
// ⚠ AND THE LABEL WAS HARD-CODED IN THREE LANGUAGES BECAUSE IT WAS TRUE ONCE.
// "A slug is one semester" is written into _activity-series.js, _activity-migrate.js
// and the no-total argument on the price card, and it IS true of hebrew4kids:
// the spring term is a second record with its own dates and its own page. It is
// not true of intro-into-judaism, whose twenty-four evenings run October to
// October. No figure on that card was wrong; the word beside the figure was.
//
// A CLOSED LIST, not a text box, for the reason `instructionLanguage` and
// `prerequisites` are closed lists: a typed label is one language published,
// three pages that can disagree about what somebody is buying, and "Semester"
// spelled four ways across four activities. `custom` is the escape hatch and is
// the one value that reads the words beside it.
//
// Five things have to hold:
//
//   1. ⚠ THE DEFAULT IS TODAY'S MEANING. Every record written before this said
//      semester by saying nothing, so nothing on the site may move until an
//      admin picks otherwise.
//   2. ⚠ IT CHANGES NO ARITHMETIC. feeApplies() is per participant, per
//      activity, per ACADEMIC YEAR whatever this label says, and a course set to
//      "per month" still takes its whole fullPrice once — nothing in this system
//      bills monthly. The label describes the figure; it must never bill it.
//   3. THE ROW KEEPS ITS KEY. The listing card picks its headline figure by
//      `term` precisely so a reworded label cannot break it silently.
//   4. A blank `custom` is refused at publish and falls back to something TRUE
//      at render — and the fallback is deliberately not "semester", which is a
//      period nobody chose.
//   5. The unit is structure and the words are words: a Russian-only role may
//      translate the label and may not decide that this course is sold by the
//      year.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');
const F = require('../netlify/functions/_activity-facts');
const M = require('../netlify/functions/_activity-migrate');
const { migrate } = M;

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');

const priced = (price) => migrate({
  slug: 'c', activityId: 'act-0000000000000001', type: 'course',
  facts: { price: Object.assign({ fullPrice: 1200 }, price || {}) }
}).facts.price;
const termRow = (price, lang) =>
  F.priceRows(priced(price), lang).filter((r) => r.key === 'term')[0];

console.log('[the default is what every record already meant]');
H.eq(priced({}).termUnit, 'semester',
  '⚠ a record that says nothing says semester, so nothing on the site moves');
H.eq(termRow({}, 'he').label, 'עלות לסמסטר', 'and prints exactly what it printed before');
H.eq(termRow({}, 'en').label, 'Cost per semester', 'in English');
H.eq(termRow({}, 'ru').label, 'Стоимость семестра', 'and in Russian');
// The live records, which is the half a fixture cannot prove.
//
// ⚠ ASKED AS THE RULE, NOT AS A SNAPSHOT. This listed the live records and
// asserted each read `semester`, which was true on the day it was written and
// stopped being true the moment somebody used the feature: `intro-into-judaism`
// is twenty-four evenings from October to October and an admin has set it to
// `year`, which is the whole point of the field existing. A test that fails when
// the feature is USED is a test that has to be edited every time, and the next
// person edits it without reading why. What has to hold is the DEFAULT: a record
// that has never said otherwise still says semester.
['hebrew4kids', 'bnei-mitzvah-2027', 'intro-into-judaism'].forEach((slug) => {
  const raw = JSON.parse(read('activities/' + slug + '.json'));
  const a = migrate(raw);
  const chose = ((raw.facts || {}).price || {}).termUnit;
  H.eq(a.facts.price.termUnit, chose || 'semester',
    chose ? slug + ' reads as the ' + chose + ' an admin chose'
          : slug + ' has never said otherwise, so it reads as semester');
});

console.log('\n[and every unit prints in all three]');
const UNITS = { year: ['עלות לשנה', 'Cost per year', 'Стоимость за год'],
                course: ['עלות לקורס', 'Cost for the course', 'Стоимость курса'],
                month: ['עלות לחודש', 'Cost per month', 'Стоимость за месяц'] };
Object.keys(UNITS).forEach((unit) => {
  ['he', 'en', 'ru'].forEach((lang, i) => {
    H.eq(termRow({ termUnit: unit }, lang).label, UNITS[unit][i], unit + ' in ' + lang);
  });
});
// ⚠ NO LANGUAGE IS LEFT HOLDING ANOTHER ONE'S WORDS, which is invisible to a
// reviewer who does not read it. Checked by script, on the letters themselves.
Object.keys(UNITS).forEach((unit) => {
  H.ok(/[א-ת]/.test(termRow({ termUnit: unit }, 'he').label), unit + ': the Hebrew is Hebrew');
  H.ok(/[А-я]/.test(termRow({ termUnit: unit }, 'ru').label), unit + ': the Russian is Cyrillic');
});
H.eq(M.PRICE_UNITS.join(','), 'semester,year,course,month,custom',
  'and the list is written once, where the shape that stores it lives');
H.eq(priced({ termUnit: 'fortnight' }).termUnit, 'semester',
  'a value off the list is not stored — a hostile client cannot invent a period');

console.log('\n[the escape hatch, and what happens when it is empty]');
const said = { termUnit: 'custom',
               termLabel: { he: 'עלות לשנת הלימודים', en: '', ru: '' } };
H.eq(termRow(said, 'he').label, 'עלות לשנת הלימודים', 'the words an admin wrote');
H.eq(termRow(said, 'en').label, 'עלות לשנת הלימודים',
  '⚠ and a language left blank FALLS BACK, as every other trilingual override does');
H.eq(termRow({ termUnit: 'custom' }, 'en').label, 'Cost for the course',
  '⚠ an empty custom falls back to "for the course" — true of any course. NOT to ' +
  '"semester", which is a period nobody chose');
H.eq(termRow({ termUnit: 'custom' }, 'he').label, 'עלות לקורס', 'in the reader\'s own language');
// The words survive a change of mind, like lateDropIn's figures do.
H.eq(priced({ termUnit: 'year', termLabel: { he: 'x', en: '', ru: '' } }).termLabel.he, 'x',
  'and the words are KEPT while another period is picked, so trying one is not losing the other');

console.log('\n[it labels the figure and never bills it]');
const row = termRow({ termUnit: 'year' }, 'en');
H.eq(row.key, 'term',
  '⚠ the KEY is unchanged — the listing card picks its headline figure by it, which is ' +
  'why it is a key and not a label match');
H.eq(row.value, F.priceRows(priced({}), 'en').filter((r) => r.key === 'term')[0].value,
  'and the figure is the same figure');
// ⚠ NOTHING BUT THE LABEL READS IT. A grep, because the danger is not that this
// is wrong today: it is that somebody later reads "the price buys a year" as a
// statement about billing, and the fee waiver, the frozen price and the refund
// schedule all assume one payment per registration.
const readers = fs.readdirSync(path.join(R, 'netlify/functions'))
  .filter((f) => /\.js$/.test(f))
  .filter((f) => /termUnit/.test(read('netlify/functions/' + f)
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')))
  .sort();
H.eq(readers.join(','), '_activity-facts.js,_activity-migrate.js,activities-admin.js',
  '⚠ only the shape that stores it, the label that prints it and the form that sets it ' +
  '— no money path has learned to read it');
H.ok(!/termUnit/.test(read('netlify/functions/_registration.js')),
  'the fee waiver has never heard of it');
H.ok(!/termUnit/.test(read('netlify/functions/_credit.js')),
  'and neither has the credit arithmetic');

const src = read('netlify/functions/activities-admin.js');

console.log('\n[structure and words, split the usual way]');
const subkeys = /const LANG_SUBKEYS = \{[\s\S]*?\};/.exec(src)[0];
H.ok(/price: \['termLabel'\]/.test(subkeys),
  '⚠ a Russian-only role may translate the label');
H.ok(subkeys.indexOf("'termUnit'") === -1 && subkeys.indexOf("'fullPrice'") === -1,
  'and may not decide the period, or the figure');

console.log('\n[the form sets it, and the list is sent rather than written twice]');
const client = read('js/activities-admin.js');
H.ok(/priceUnits: \[/.test(src), 'the server sends the list');
H.ok(/S\.schema\.priceUnits/.test(client),
  '⚠ and the form reads it from there — a second copy is two lists that can disagree ' +
  'about what a value means');
H.ok(/fact-price-termUnit/.test(client) && /fact-price-termLabel/.test(client),
  'both controls exist');
H.ok(/isDropin \? null : termUnitField/.test(client),
  'and a drop-in draws neither: a session IS the period');
H.ok(/out\.termUnit = unitNode \? unitNode\.value : \(previous\.termUnit/.test(client),
  '⚠ read back with a fallback to what was stored, or switching to a drop-in and back ' +
  'clears it — the undrawn-field trap this form has met three times');
H.ok(/out\.termLabel = \$\(p \+ '-price-termLabel-he'\)/.test(client),
  '⚠ and the WORDS survive the boxes being hidden, or trying another period loses them');

// ---------------------------------------------------------------------------
// ⚠ EXECUTED, because reading validate() proves validate() is self-consistent.
// A draft is WARNED and a publish is REFUSED, by the one validate() — the rule
// this admin already holds itself to, so the two accounts of one rule cannot
// drift into two sentences.
(async () => {
  const seed = H.seedRepo();
  const github = H.makeGithub(seed.files);
  const blobs = H.makeBlobs();
  const { 'activities-admin': admin } = H.loadWithStubs({
    github, blobs, modules: ['activities-admin'] });
  const session = await H.installSession(blobs, H.superAdminSession());

  const record = (price) => ({
    slug: 'yearly', status: 'open', type: 'course',
    title: { he: 'קורס', en: 'Course', ru: '' },
    about: { he: 'טקסט', en: 'Text', ru: '' },
    facts: { price: Object.assign({ fullPrice: 1200 }, price) }
  });
  const send = (action, price, baseUpdatedAt) => H.call(admin.handler, {
    token: session.token, action: action, baseUpdatedAt: baseUpdatedAt || null,
    activity: record(price) });

  console.log('\n[warned on a draft, refused on a publish, in one sentence]');
  const blank = { termUnit: 'custom', termLabel: { he: '', en: '', ru: '' } };
  const draft = await send('saveDraft', blank);
  H.eq(draft.status, 200, '⚠ the draft SAVES — a save that fights back is a save people dread');
  const warned = (draft.body.warnings || []).filter((w) => /price is set to be labelled/.test(w));
  H.eq(warned.length, 1, 'and says what would stop it: ' + (warned[0] || '—'));

  // The refusal travels as `validation`, which is the one channel this handler
  // has always used for it — thrown by validate() and answered on that key.
  const refused = await send('preview', blank);
  H.ok(refused.status >= 400, 'while a preview is refused (' + refused.status + ')');
  const said = (refused.body.validation || []).filter((e) => /price is set to be labelled/.test(e));
  H.eq(said.length, 1, 'naming the same thing');
  H.eq(said[0], warned[0],
    '⚠ WORD FOR WORD the draft\'s warning — one validate(), so what a warning says here ' +
    'and what the refusal says there cannot become two accounts of one rule');

  // And it is the BLANK that is refused, not the unit.
  const written = await send('preview',
    { termUnit: 'custom', termLabel: { he: 'עלות לשנת הלימודים', en: '', ru: '' } });
  H.eq(written.status, 200, 'one language written is enough to publish');
  const yearly = await send('preview', { termUnit: 'year' });
  H.eq(yearly.status, 200, 'and a period needs no words at all');
  const pages = yearly.body.html || {};
  H.ok(/עלות לשנה/.test(pages.he || ''),
    '⚠ which is what the PAGE then prints — asserted on the rendered HTML, because a ' +
    'label that only a unit test has seen is a label no reader has');
  H.ok(!/סמסטר/.test(pages.he || ''), 'and the word "semester" is nowhere on it');
  H.ok(/Cost per year/.test(pages.en || '') && /За год|за год/.test(pages.ru || ''),
    'in all three trees, from the one publish');

  H.done();
})();
