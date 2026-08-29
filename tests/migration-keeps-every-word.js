// What this defends against:
//
// Facts became structured while two activities were already published and one
// of them was live. A migration that "tidied up" the old free text would have
// silently blanked rows on a page families were reading — and there is no undo,
// because the generated HTML is rebuilt from the record on the next save.
//
// The rule is therefore: convert only what is unambiguous, keep everything else
// verbatim, delete nothing. An age range really is two integers and can only
// mean one thing. A price sentence cannot be taken apart safely and is not
// guessed at — it keeps publishing exactly as before until a human fills the
// fields in.
//
// The pre-migration records are pinned in tests/fixtures/ rather than read live
// from activities/. They were read live at first, which broke the moment those
// records were republished in the new shape: migrating an already-migrated
// record is a no-op, so there was no longer any legacy text to compare against.
// The old shape is history now, and history belongs in a fixture. The real
// records are still used, for the one property that stays true of them — that
// migrating them again changes nothing.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');
const { migrate, parseAgeRange, isLangObject } = require('../netlify/functions/_activity-migrate');
const F = require('../netlify/functions/_activity-facts');

// Exactly what these two records looked like before facts were structured,
// taken from commit d92bb5b.
const legacyFixture = (slug) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'legacy-' + slug + '.json'), 'utf8'));

// The records as they stand in the repo today.
const live = (slug) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'activities', slug + '.json'), 'utf8'));

console.log('\n[migrating is safe to run twice]');
// It runs on every read, so it will be applied to already-migrated records
// constantly. If it were not idempotent it would corrode the data over time.
['hebrew-for-kids', 'hebrew4kids'].forEach((slug) => {
  [['the legacy', legacyFixture], ['the live', live]].forEach(([what, load]) => {
    const once = migrate(load(slug));
    const twice = migrate(once);
    H.eq(JSON.stringify(twice), JSON.stringify(once),
         what + ' ' + slug + ' record is unchanged by a second migration');
  });
});

console.log('\n[nothing an admin typed is lost]');
const legacy = legacyFixture('hebrew4kids');
const moved = migrate(legacy);

// Every old fact sentence survives somewhere the page can still read it.
const survives = (needle) =>
  JSON.stringify(moved).indexOf(needle) !== -1;
H.ok(survives('שתי קבוצות של 7 תלמידים'), 'the group-size sentence survives');
H.ok(survives('דמי הרשמה של 50 אירו + 360 אירו ל-12 שיעורים'), 'the price sentence survives');
H.ok(survives('ימי רביעי, 16:30'), 'the schedule sentence survives');
H.ok(survives('90 דקות, עם הפסקה באמצע.'), 'the program length survives');
H.ok(survives('עברית ואנגלית'), 'the language of instruction survives');
H.ok(survives('מתחילים'), 'the prerequisites survive');
H.ok(survives('לימסול'), 'the location survives');

console.log('\n[and the live page does not change while it waits to be filled in]');
const before = legacy.facts;
H.eq(F.factText(moved, 'groupSize', 'he'), before.groupSize.he, 'group size reads exactly as it did');
H.eq(F.factText(moved, 'price', 'he'), before.price.he, 'the price reads exactly as it did');
H.eq(F.factText(moved, 'schedule', 'he'), before.schedule.he, 'the schedule reads exactly as it did');
H.eq(F.factText(moved, 'location', 'he'), before.location.he, 'the location reads exactly as it did');
H.eq(F.factText(moved, 'duration', 'he'), legacy.programLength.he, 'program length becomes the duration row');
H.eq(F.factText(moved, 'instructionLanguage', 'he'), legacy.instructionLanguage.he, 'language of instruction moves across');
H.eq(F.factText(moved, 'prerequisites', 'he'), legacy.prerequisites.he, 'prerequisites move across');

console.log('\n[ages convert, because an age range can only mean one thing]');
H.eq(moved.facts.ages.min, 6, 'the youngest age is parsed out');
H.eq(moved.facts.ages.max, 10, 'and the oldest');
H.ok(!moved.facts.ages.legacyText, 'so no legacy text is kept for it');
H.eq(F.factText(moved, 'ages', 'he'), '6-10', 'and it renders identically to before');
// The parser is deliberately narrow. Anything with a word in it is left alone.
H.eq(JSON.stringify(parseAgeRange({ he: '6-10' })), '{"min":6,"max":10}', 'a plain range parses');
H.eq(JSON.stringify(parseAgeRange({ he: '6–10' })), '{"min":6,"max":10}', 'an en dash parses too');
H.eq(parseAgeRange({ he: '6 ומעלה' }), null, '"6 and up" is not guessed at');
H.eq(parseAgeRange({ he: 'from 6 to 10' }), null, 'nor is a sentence');
H.eq(parseAgeRange({ he: '10-6' }), null, 'nor a backwards range');
const vague = migrate({ facts: { ages: { he: '6 ומעלה', en: '', ru: '' } } });
H.eq(F.factText(vague, 'ages', 'he'), '6 ומעלה', 'an unparseable age range keeps publishing its words');

console.log('\n[the old shape cannot come back]');
H.ok(moved.programLength === undefined, 'programLength is gone from the top level');
H.ok(moved.instructionLanguage === undefined, 'and instructionLanguage');
H.ok(moved.prerequisites === undefined, 'and prerequisites');
H.ok(!isLangObject(moved.facts.location), 'location is a structured fact, not a bare lang object');
H.ok(isLangObject(moved.facts.prerequisites), 'text facts stay lang objects, because they are words');

console.log('\n[visibility is filled in for every fact]');
const vis = moved.factVisibility;
H.eq(Object.keys(vis).length, F.FACT_ORDER.length, 'every fact has a flag');
H.eq(vis.location, 'members', 'location defaults to members-only');
H.eq(vis.price, 'public', 'and the rest to public');
const kept = migrate(Object.assign({}, legacy, { factVisibility: { price: 'members' } }));
H.eq(kept.factVisibility.price, 'members', 'an explicit flag survives migration');
H.eq(migrate({ factVisibility: { ages: 'nonsense' } }).factVisibility.ages, 'public', 'a junk flag falls back to public');

console.log('\n[retired fields are ignored, and stop being carried]');
// "Places left" was a number an admin typed and then had to remember to
// decrement, so it was wrong the moment anyone registered; it comes back
// computed once registration exists. "What's included" was a bullet list saying
// what Schedule, Duration and Price now say properly. Both were REMOVED while
// two activities were published holding them — hebrew-for-kids had spots:4 and
// four bullets — so the question is whether that old data breaks anything.
const withRetired = legacyFixture('hebrew-for-kids');
H.eq(withRetired.spots, 4, 'the fixture really does carry a places-left count');
H.eq(withRetired.included.length, 4, 'and four bullet items');

const cleaned = migrate(withRetired);
H.ok(cleaned.spots === undefined, 'spots is dropped on the way through');
H.ok(cleaned.included === undefined, 'and so is the bullet list');
H.eq(JSON.stringify(migrate(cleaned)), JSON.stringify(cleaned), 'and it stays dropped on a second pass');

// Nothing else about the record is disturbed by their removal.
H.eq(cleaned.title.he, withRetired.title.he, 'the title is untouched');
H.eq(cleaned.faq.length, withRetired.faq.length, 'the FAQ is untouched');
H.eq(cleaned.teachers.length, withRetired.teachers.length, 'the teachers are untouched');
H.eq(F.factText(cleaned, 'price', 'he'), withRetired.facts.price.he, 'the price row still reads as it did');

// And a page built from the old record shows no trace of either.
const tpl = require('../netlify/functions/_activity-template');
const page = tpl.renderActivityPage(cleaned, 'he');
H.ok(page.indexOf('data-spots') === -1, 'the rendered page has no places-left attribute');
H.ok(page.indexOf('facts-list') === -1, 'no bullet list is rendered');
H.ok(page.indexOf('מה כלול') === -1, "and no What's included heading");
H.ok(page.indexOf('<h1>') !== -1, 'the page still renders');
H.ok(page.indexOf(withRetired.faq[0].q.he) !== -1, 'the FAQ still renders');

// An unmigrated record handed straight to the template must not break either —
// the generated pages already committed still carry these fields.
const raw = tpl.renderActivityPage(Object.assign({}, withRetired, { facts: {} }), 'he');
H.ok(raw.indexOf('data-spots') === -1, 'even an unmigrated record renders no places-left attribute');
H.ok(raw.indexOf('facts-list') === -1, 'and no bullet list');

console.log('\n[a record with no facts at all does not crash]');
const empty = migrate({ slug: 'x' });
H.eq(F.sidebarRows(empty, 'he').length, 0, 'it just has an empty sidebar');
H.ok(migrate(null) === null, 'and null passes straight through');

H.done();
