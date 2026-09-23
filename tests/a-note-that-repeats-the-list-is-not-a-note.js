// What this defends against:
//
// The live hebrew4kids page printed two of its facts twice:
//
//     Prerequisites             Language of instruction
//     Beginners                 Hebrew · English
//     Beginners                 Hebrew and English
//
// `instructionLanguage` and `prerequisites` are a closed list plus an optional
// free line, and the line is there to ADD to the list — so the page rendered
// exactly what it was told to. Nobody typed anything twice either, and neither
// half of the record was wrong on its own:
//
//   - liftBareText() moved the old free-text fact into `text`. That is right,
//     and it is the only place those words could have gone.
//   - the admin then picked the level and the two languages from the controls
//     that replaced the free text. That is also right, and is what they are for.
//
// It is the PAIR that is wrong, and nothing on any screen could have shown it:
// the form draws a filled-in box beside a filled-in select, and neither control
// knows what the other says. Only the rendered page puts them one under the
// other, which is where it was found.
//
// So a line that is only the words the list already prints is dropped on read.
// The two properties that matter pull against each other and are both pinned
// here: a restatement goes, and a line that adds ANYTHING survives untouched —
// including the case where nothing structured is set at all, where the prose is
// the only answer there is and dropping it would blank a published fact.

const H = require('./_helpers');
const { migrate } = require(H.fnPath('_activity-migrate'));
const F = require(H.fnPath('_activity-facts'));

const lang = (he, en, ru) => ({ he: he, en: en, ru: ru });
const facts = (gf) => migrate({
  slug: 'x', activityId: 'act-0000000000000001', type: 'course',
  groups: [{ groupId: 'g-1', facts: gf }]
}).groups[0].facts;

(async () => {
  console.log('[a line that only repeats the list is dropped]');

  // The record as it actually stood. Note the RUSSIAN slot holds the ENGLISH
  // sentence — the free text predates anybody translating it, which is why the
  // words are stripped in all three languages rather than in the one being read.
  const both = facts({ instructionLanguage: {
    codes: ['he', 'en'],
    text: lang('עברית ואנגלית', 'Hebrew and English', 'Hebrew and English') } });
  H.eq(both.instructionLanguage.text.he, '', 'the Hebrew restatement goes');
  H.eq(both.instructionLanguage.text.en, '', 'and the English');
  H.eq(both.instructionLanguage.text.ru, '',
    'and the English sentence sitting in the Russian slot, which is the one a ' +
    'rule looking only at the language being read would have kept');

  const level = facts({ prerequisites: {
    level: 'beginner',
    text: lang('מתחילים', 'Beginners', 'Начинающие') } });
  H.eq(level.prerequisites.text.he + level.prerequisites.text.en + level.prerequisites.text.ru, '',
    'a level named twice is a level named once');

  // ו is a PREFIX in Hebrew: "עברית ואנגלית" is two names with the conjunction
  // glued to the front of the second, so it only becomes a word of its own once
  // the names either side have been taken out. A rule splitting on whitespace
  // first would never have matched it.
  H.eq(facts({ instructionLanguage: { codes: ['he', 'en'],
    text: lang('עברית ואנגלית', '', '') } }).instructionLanguage.text.he, '',
    'the glued Hebrew conjunction is not mistaken for a word of its own');

  console.log('\n[and a line that adds anything at all survives]');
  const greek = facts({ instructionLanguage: { codes: ['he', 'en'],
    text: lang('עברית ואנגלית, קצת יוונית', 'Hebrew and English, some Greek', '') } });
  H.eq(greek.instructionLanguage.text.en, 'Hebrew and English, some Greek',
    'a language the list does not carry is exactly what the free line is for');

  const age = facts({ prerequisites: { level: 'beginner',
    text: lang('', 'Beginners, from age 6', '') } });
  H.eq(age.prerequisites.text.en, 'Beginners, from age 6', 'and a condition on the level');

  // ⚠ THE DANGEROUS DIRECTION. With nothing structured set, the prose IS the
  // fact — every record written before the closed lists existed is in this
  // state, and dropping it here would blank a published row on a live page.
  const bare = facts({ instructionLanguage: { codes: [],
    text: lang('עברית ואנגלית', 'Hebrew and English', '') } });
  H.eq(bare.instructionLanguage.text.en, 'Hebrew and English',
    'with no codes chosen the sentence is the only answer there is, and stays');
  const noLevel = facts({ prerequisites: { level: null, text: lang('', 'Beginners', '') } });
  H.eq(noLevel.prerequisites.text.en, 'Beginners', 'the same with no level chosen');

  // Half a list is not the whole list. The note names a language the codes do
  // not, so it is still telling somebody something.
  const partial = facts({ instructionLanguage: { codes: ['he'],
    text: lang('', 'Hebrew and English', '') } });
  H.eq(partial.instructionLanguage.text.en, 'Hebrew and English',
    'a note naming a language the list leaves out is not a restatement');

  console.log('\n[the rendered rows, which is where it was seen]');
  const record = migrate({
    slug: 'x', activityId: 'act-0000000000000001', type: 'course',
    groups: [{ groupId: 'g-1', facts: {
      prerequisites: { level: 'beginner', text: lang('מתחילים', 'Beginners', 'Beginners') },
      instructionLanguage: { codes: ['he', 'en'],
        text: lang('עברית ואנגלית', 'Hebrew and English', 'Hebrew and English') }
    } }]
  });
  ['he', 'en', 'ru'].forEach((l) => {
    const p = F.factText(record, 'prerequisites', l);
    const i = F.factText(record, 'instructionLanguage', l);
    H.ok(p.indexOf('\n') === -1, `[${l}] the level is one line, not two`);
    H.ok(i.indexOf('\n') === -1, `[${l}] and so is the language list`);
  });
  // The Russian is now IN Russian. It used to print the English sentence on a
  // second line under a Russian list, on the Russian page.
  H.eq(F.factText(record, 'instructionLanguage', 'ru'),
    'иврит · английский', 'and it reads in Russian');

  console.log('\n[idempotent, like everything in migrate()]');
  const once = migrate(record);
  H.eq(JSON.stringify(migrate(once)), JSON.stringify(once),
    'a second pass finds nothing left to drop');

  H.done();
})();
