// What this defends against:
//
// An activity WAS the thing that had an age range, a teacher, a room and a
// timetable, and "named groups" were an optional list inside a fact called
// `groupSize` that could differ only in size and, later, in when they met.
// Everything else was one answer for everybody — so an activity running a
// Hebrew-speaking group with Dorit on Thursdays and a Russian-speaking group
// with Anat on Sundays could not say so. It published one age range, one
// language, one teacher list and one room for two classes sharing none of them.
//
// So `activity.groups[]` is the model now: not optional, not a sub-field, and
// never empty. Seven facts moved onto it; the price, the words, the pictures and
// the search metadata did not, because those are one answer whichever group a
// family joins.
//
// FIVE THINGS HAVE TO HOLD, and four of them are ways this could go quietly
// wrong rather than loudly:
//
//   1. ⚠ THE MIGRATION MUST NOT MOVE A NUMBER. hebrew4kids was `groups: 2,
//      maxPerGroup: 10` — fourteen places on the fixtures, twenty on the real
//      record — and folding it into "its one group" with the wrong half of that
//      product would halve a class with nothing erroring.
//
//   2. ⚠ AND IT MUST BE IDEMPOTENT, because migrate() runs on every READ,
//      including the reads that freeze money onto a registration. The trap found
//      while writing it: normaliseVisibility() decided "this record predates the
//      address field" from `facts.address`, which the migration itself removes —
//      so a second pass would have reset every members-only flag to public and
//      quietly published an address on the next save.
//
//   3. ⚠ A FULL CLASS MUST NOT REPORT AS EMPTY. Every registration taken while
//      an activity was pooled carries `groupId: null`. The moment that activity
//      has a group, bucketing strictly by id files all of them under
//      "unassigned" and shows the group at nought taken.
//
//   4. ⚠ ONE GROUP IS NOT A CHOICE. Every activity has a group now, so the old
//      test — "does this activity name any groups" — would put a one-option
//      picker in front of every family on the site and refuse every submission
//      that did not answer it.
//
//   5. Equal total HOURS across the groups, refused on save. There is one
//      fullPrice and it buys the same teaching whichever group a family picks.
//      This replaced the equal-session-COUNT rule, which was strictly stronger
//      and refused a shape Ogen actually runs.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const F = require('./_fixtures');
const G = require('../netlify/functions/_activity-groups');
const FACTS = require('../netlify/functions/_activity-facts');
const R = require('../netlify/functions/_registration');
const { migrate } = require('../netlify/functions/_activity-migrate');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const record = (slug) => JSON.parse(read('activities/' + slug + '.json'));

console.log('[every real record migrates, and none of them loses a number]');
const REAL = ['hebrew4kids', 'folk-dance', 'bnei-mitzvah-2027', 'beit-midrash'];
REAL.forEach((slug) => {
  const raw = record(slug);
  const m = migrate(raw);
  H.ok(m.groups.length >= 1, slug + ': has at least one group');
  // ⚠ IDEMPOTENT. Anything else is a record that changes every time anybody
  // looks at it, on a function that runs on every read.
  H.eq(JSON.stringify(migrate(m)), JSON.stringify(m), slug + ': a second pass changes nothing');
  // The seven moved off the activity and the two stayed.
  H.eq(Object.keys(m.facts).sort().join(','), 'groupSize,price',
    slug + ': the activity keeps only the price and the grouping override');
  m.groups.forEach((g) => {
    H.eq(Object.keys(g.facts).sort().join(','),
      'address,ages,duration,instructionLanguage,location,prerequisites,schedule',
      slug + ': and its group carries the other seven');
  });
});

// ⚠ THE ONE NUMBER MOST WORTH PINNING. Two pooled groups of ten is twenty
// places, and the group that replaces them holds twenty — not ten, which is
// what reading `maxPerGroup` alone would have given, and not two.
const h4k = migrate(record('hebrew4kids'));
H.eq(h4k.groups.length, 1, 'hebrew4kids was pooled, so it becomes ONE group');
H.eq(h4k.groups[0].capacity, 20, '⚠ holding 20 — the product, not one group of ten');
H.eq(G.totalCapacity(h4k), 20, 'and the activity still holds twenty altogether');
H.eq(FACTS.pick(h4k.groups[0].name, 'en'), '',
  'with no name, because one group offers no choice and nothing is published');

// ⚠ THE UNCAPPED RULE IS PINNED ON A RECORD BUILT HERE, not on whichever real
// activity happens to have no size today. It was folk-dance, until an admin gave
// folk-dance a capacity of 50 — an ordinary edit, through the form, which broke a
// suite that was not about folk-dance at all. The real records are worth reading
// for what MIGRATION does to them; a rule about blanks needs a guaranteed blank.
const noSize = migrate({ slug: 'no-size', activityId: 'act-0000000000000f0f', type: 'course',
                         facts: { groupSize: {} } });
H.eq(noSize.groups[0].capacity, null,
  'an activity with no stated size is UNCAPPED, deliberately not zero — a blank must ' +
  'never read as a restriction');

// The two that already named their groups keep the ids, because frozen
// registrations point at them and a new id is a family attached to nothing.
const bnei = migrate(record('bnei-mitzvah-2027'));
H.eq(bnei.groups.map((g) => g.groupId).join(','), 'g-mu769dzbdoed,g-mu76aeufqfa3',
  'bnei-mitzvah keeps both group ids, which frozen registrations point at');
H.eq(bnei.groups[0].facts.ages.min, 11,
  'and each group is SEEDED with what the activity said, rather than blanked');
H.eq(bnei.groups[1].facts.ages.min, 11, 'both of them');
const beit = migrate(record('beit-midrash'));
H.eq(beit.groups.length, 2, '⚠ beit-midrash has two named groups as well, not one');
H.eq(G.totalCapacity(beit), 50, 'and its capacity is still the sum of them');

console.log('\n[one group is not a choice; two is]');
const one = F.course();
const two = F.course({ facts: Object.assign({}, F.rawCourse().facts, { groupSize: F.NAMED }) });
const kid = { participantId: 'p-1', firstName: 'Noa', dateOfBirth: '2018-03-02' };

H.eq(G.offersAChoice(one), false, 'one group offers none');
H.eq(G.offersAChoice(two), true, 'two do');
H.eq(R.submissionErrors(one, kid, null).join(','), '',
  '⚠ a family that named no group is accepted on a single-group activity — they ' +
  'were never asked');
H.eq(R.groupIdFor(one, null), one.groups[0].groupId,
  'and the registration is recorded against that group rather than against nothing');
H.eq(R.submissionErrors(two, kid, null).join(','), 'group-required',
  'while two groups is a choice, and a submission that skips it is refused');
H.eq(R.submissionErrors(two, kid, 'g-beginners').join(','), '', 'and one that makes it is taken');
H.eq(R.submissionErrors(two, kid, 'g-nope').join(','), 'no-such-group',
  'a group of some other activity is refused rather than quietly reassigned');
H.eq(R.groupIdFor(two, null), null,
  'and nothing is invented for a family on a multi-group activity who named none');

console.log('\n[⚠ a full class does not report as empty]');
// Twenty registrations taken while the activity was pooled, every one of them
// carrying groupId: null. This is the state every live record is in today.
const pooled = F.course();
pooled.groups[0].capacity = 3;
const now = Date.parse('2026-09-01T00:00:00Z');
const oldStyle = [1, 2, 3].map((i) => ({
  participantId: 'p-' + i, activityId: pooled.activityId, groupId: null, status: 'approved'
}));
const report = R.capacityReport(pooled, oldStyle, now);
H.eq(report.taken, 3, 'all three are counted against the activity');
H.eq(report.named[0].taken, 3,
  '⚠ AND AGAINST ITS ONE GROUP — filed as unassigned they would have shown it empty');
H.eq(report.named[0].left, 0, 'so it has no room left');
H.eq(report.unassigned, 0, 'and there is nothing left over to report');
H.eq(R.hasRoom(report, null), false, 'a fourth family is refused');
H.eq(R.hasRoom(report, pooled.groups[0].groupId), false, 'whether or not they name the group');

// With two groups there IS no honest single answer, so they stay unassigned.
const pooledTwo = F.course({ facts: Object.assign({}, F.rawCourse().facts, { groupSize: F.NAMED }) });
const split = R.capacityReport(pooledTwo, oldStyle, now);
H.eq(split.unassigned, 3, 'on a multi-group activity they belong to no row, and say so');
H.eq(split.named[0].taken, 0, 'rather than being credited to whichever group came first');

console.log('\n[groups may differ in shape, never in hours]');
const hours = (g, count, minutes) => {
  g.facts.duration = Object.assign({}, g.facts.duration, {
    sessionCount: count, sessionMinutes: minutes, sessionDates: []
  });
};
const uneven = F.course({ facts: Object.assign({}, F.rawCourse().facts, { groupSize: F.NAMED }) });
hours(uneven.groups[0], 6, 120);   // 12 hours
hours(uneven.groups[1], 12, 60);   // 12 hours
H.eq(G.validateGroups(uneven).length, 0,
  '⚠ six two-hour meetings and twelve one-hour ones are the SAME twelve hours — ' +
  'the shape a stricter equal-count rule refused');
hours(uneven.groups[1], 12, 45);   // 9 hours
const errs = G.validateGroups(uneven);
H.eq(errs.length, 1, 'nine hours against twelve is refused');
H.ok(/12 hours/.test(errs[0]) && /9 hours/.test(errs[0]), 'naming both totals in hours, not minutes');
H.ok(/Beginners/.test(errs[0]) && /Advanced/.test(errs[0]), 'and both groups');

console.log('\n[the page aggregates for the scanner and breaks down for the chooser]');
const differ = F.course({ facts: Object.assign({}, F.rawCourse().facts, { groupSize: F.NAMED }) });
differ.groups[0].facts.ages = { min: 6, max: 9 };
differ.groups[1].facts.ages = { min: 10, max: 13 };
differ.groups[0].facts.location = { text: F.lang('לימסול', 'Limassol', 'Лимассол') };
differ.groups[1].facts.location = { text: F.lang('ניקוסיה', 'Nicosia', 'Никосия') };
differ.groups[0].facts.instructionLanguage = { codes: ['he'], text: {} };
differ.groups[1].facts.instructionLanguage = { codes: ['ru'], text: {} };

H.eq(FACTS.factText(differ, 'ages', 'en'), '6-13',
  'the age range is the union, which is what a parent checks a child against');
H.eq(FACTS.factText(differ, 'location', 'en'), 'Limassol, Nicosia',
  'and the location is the distinct cities, joined');
H.eq(FACTS.factText(differ, 'instructionLanguage', 'en'), 'Hebrew · Russian',
  'and the languages are every one anybody is taught in');
// ⚠ AND ASKED OF ONE GROUP IT IS THAT GROUP'S, which is what the family area and
// the frozen block read.
H.eq(FACTS.factText(differ, 'ages', 'en', 'g-beginners'), '6-9',
  'while one group answers for itself');
H.eq(FACTS.factText(differ, 'ages', 'en', 'g-advanced'), '10-13', 'and so does the other');

const choice = FACTS.groupChoice(differ, 'en');
H.eq(choice.count, 2, 'the breakdown knows there are two');
H.eq(choice.countText, '2 groups', 'and says so in words');
H.eq(choice.differing.join(','), 'ages,instructionLanguage,location',
  '⚠ and lists ONLY what they disagree on — two identical lists under two names ' +
  'bury the one line a reader is there to compare');
H.eq(choice.groups[0].facts.map((f) => f.key + '=' + f.value).join(' '),
  'ages=6-9 instructionLanguage=Hebrew location=Limassol', 'each group answering for itself');
H.eq(FACTS.groupChoice(one, 'en'), null,
  'and an activity with one group has no choice to describe, so there is nothing to draw');
// ⚠ TWO GROUPS THAT AGREE ON EVERY FACT STILL GET THE SECTION, because the NAME
// is the thing they differ in and the name is what a family picks by — which is
// exactly bnei-mitzvah, where the two groups are "with Dorit" and "with Anat"
// and share an age range, a room and a timetable. What they do not get is an
// empty list under each name.
const sameFacts = F.course({ facts: Object.assign({}, F.rawCourse().facts, { groupSize: F.NAMED }) });
const bothNamed = FACTS.groupChoice(sameFacts, 'en');
H.eq(bothNamed.count, 2, 'the section still says there are two');
H.eq(bothNamed.differing.length, 0, 'with nothing to break down');
const rendered = require('../netlify/functions/_activity-template')
  .renderActivityPage(sameFacts, 'en');
H.ok(/<h3>Beginners<\/h3>\s*\n\s*<\/div>/.test(rendered),
  'so the card is the name alone rather than a name over an empty list');
H.ok(rendered.indexOf('Choose your group when you register') !== -1,
  'and the page still says the choice is made at registration');

// When they agree the aggregate IS the shared value, so every page on the site
// renders exactly as it did before any of this existed.
H.eq(FACTS.factText(two, 'ages', 'en'), FACTS.factText(two, 'ages', 'en', 'g-beginners'),
  'groups that agree produce the value itself, not a breakdown of it');

console.log('\n[one builder feeds the page and the card]');
const tpl = read('netlify/functions/_activity-template.js');
H.ok(/const choice = groupChoice\(activity, lang\);/.test(tpl.slice(tpl.indexOf('function cardTags'))),
  'the listing card asks groupChoice()');
H.ok(/const choice = groupChoice\(activity, lang\);/.test(tpl.slice(tpl.indexOf('const groupsBlock'))) ||
     tpl.indexOf('const choice = groupChoice(activity, lang);\n  const groupsBlock') !== -1,
  'and so does the page’s own groups section');
H.ok(/CARD_TAGS = \['groups',/.test(tpl),
  'and the count LEADS the card, because it frames the union under it');

console.log('\n[a two-group activity survives a save]');
(async () => {
  const seed = H.seedRepo();
  const github = H.makeGithub(seed.files);
  const blobs = H.makeBlobs();
  const { 'activities-admin': admin } = H.loadWithStubs({ github, blobs, modules: ['activities-admin'] });
  const session = await H.installSession(blobs, H.superAdminSession());
  const auth = { token: session.token };

  const sent = {
    slug: 'two-groups', status: 'open', type: 'course',
    title: F.lang('שתיים', 'Two', 'Две'), about: F.lang('<p>א</p>', '<p>a</p>', '<p>а</p>'),
    teachers: [{ id: 'tea-1', name: F.lang('דורית', 'Dorit', 'Дорит') },
               { id: 'tea-2', name: F.lang('ענת', 'Anat', 'Анат') }],
    facts: { price: { registrationFee: 50, fullPrice: 300 }, groupSize: {} },
    groups: [
      { groupId: 'g-a', name: F.lang('א', 'A', 'А'), capacity: 8, teacherIds: ['tea-1'],
        facts: {
          ages: { min: 6, max: 9 },
          schedule: { frequency: 'weekly', sessions: [{ day: 1, time: '16:00' }] },
          duration: { startDate: '2026-10-12', endDate: '2026-11-02', sessionCount: 4,
                      sessionMinutes: 90,
                      sessionDates: ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']
                        .map((d) => ({ date: d, status: 'scheduled' })) },
          instructionLanguage: { codes: ['he'], text: {} },
          prerequisites: { level: 'beginner', text: {} },
          location: { text: F.lang('לימסול', 'Limassol', 'Лимассол') },
          address: { text: F.lang('הרצל 5', '5 Herzl St', 'Герцль 5') }
        } },
      { groupId: 'g-b', name: F.lang('ב', 'B', 'Б'), capacity: 6, teacherIds: ['tea-2'],
        facts: {
          ages: { min: 10, max: 13 },
          schedule: { frequency: 'weekly', sessions: [{ day: 3, time: '17:30' }] },
          duration: { startDate: '2026-10-14', endDate: '2026-11-18', sessionCount: 6,
                      sessionMinutes: 60,
                      sessionDates: ['2026-10-14', '2026-10-21', '2026-10-28',
                                     '2026-11-04', '2026-11-11', '2026-11-18']
                        .map((d) => ({ date: d, status: 'scheduled' })) },
          instructionLanguage: { codes: ['ru'], text: {} },
          prerequisites: { level: 'intermediate', text: {} },
          location: { text: F.lang('ניקוסיה', 'Nicosia', 'Никосия') },
          address: { text: {} }
        } }
    ]
  };

  // ⚠ PUBLISHED, NOT SAVED AS A DRAFT. validate() runs inside generate(), which
  // is the publish path — a draft is stored without being rendered, so a draft
  // save is not where a refusal can be observed.
  const saved = await H.call(admin.handler, Object.assign(
    { action: 'publish', baseUpdatedAt: null, activity: sent }, auth));
  H.eq(saved.status, 200, 'four 90-minute meetings and six 60-minute ones are both six hours');
  const back = saved.body.activity;
  H.eq(back.groups.length, 2, 'both groups come back');
  H.eq(back.groups[0].capacity, 8, 'with their capacities');
  H.eq(back.groups[1].facts.duration.sessionDates.length, 6,
    '⚠ and their calendars — a key the group shape does not name is a key the ' +
    'next save deletes, which is how sessionDates was lost once before');
  H.eq(back.groups[0].facts.address.text.en, '5 Herzl St', 'and the words inside their facts');
  H.eq(back.groups[0].teacherIds.join(','), 'tea-1', 'and which teachers take them');
  H.eq(FACTS.pick(back.groups[1].name, 'ru'), 'Б', 'and their names, in every language');

  // ⚠ REFUSED ON SAVE when the totals stop matching, rather than found on a page.
  const bad = JSON.parse(JSON.stringify(sent));
  bad.groups[1].facts.duration.sessionMinutes = 45;
  const refused = await H.call(admin.handler, Object.assign(
    { action: 'publish', baseUpdatedAt: back.isoUpdated, activity: bad }, auth));
  // (The publish path has always answered a validation failure with a 500
  // carrying `validation`, which is its own small wrongness and is not this
  // change's to fix. What matters here is that the save does not go through.)
  H.ok(refused.status >= 400, 'six hours against four and a half is refused');
  H.ok(/totals 6 hours/.test((refused.body.validation || [])[0] || ''),
    'naming both groups and both totals, in hours');
  H.ok(!github._files.has('activities/two-groups.json') ||
       JSON.parse(github._files.get('activities/two-groups.json'))
         .groups[1].facts.duration.sessionMinutes === 60,
    'and the stored record still holds what was last agreed');

  // And an unnamed second group, which is a question nobody can answer.
  const nameless = JSON.parse(JSON.stringify(sent));
  nameless.groups[1].name = { he: '', en: '', ru: '' };
  const noName = await H.call(admin.handler, Object.assign(
    { action: 'publish', baseUpdatedAt: back.isoUpdated, activity: nameless }, auth));
  H.ok(noName.status >= 400, 'a second group with no name is refused');
  H.ok(/Group 2 has no name/.test((noName.body.validation || [])[0] || ''),
    'saying which one, because an unnamed option is a question nobody can answer');

  console.log('\n[the admin form reads a group back the way it drew it]');
  // ⚠ ONE EDITOR AND ONE READ-BACK, BOTH TAKING THE PREFIX. Seven facts are
  // drawn on a group's own page and two on the main form, and a field the form
  // renders which the read-back misses saves successfully and loses the value,
  // with nothing looking wrong. Executed rather than read: the two halves are
  // sliced out and run against a DOM of the ids one of them just wrote.
  const src = read('js/activities-admin.js');
  const slice = (name) => {
    const a = src.indexOf('  function ' + name + '(');
    H.ok(a !== -1, 'found ' + name);
    const b = src.indexOf('\n  function ', a + 1);
    return src.slice(a, b);
  };
  const values = {};
  const ctx = {
    S: { schema: { instructionLanguages: [{ key: 'he' }, { key: 'ru' }], facts: [] },
         record: {} },
    currentType: () => 'course',
    syncBundles: () => [],
    readLangField: (id) => values[id] || { he: '', en: '', ru: '' },
    readNum: (id) => (values[id] === undefined ? null : values[id]),
    readBool: (id) => !!values[id],
    $: (id) => (values[id] === undefined ? null : { value: values[id] }),
    document: { getElementById: (id) => (values[id] === undefined ? null : { checked: !!values[id], value: values[id] }) },
    out: null
  };
  vm.createContext(ctx);
  vm.runInContext(slice('readFactEditor') + '\nout = readFactEditor;', ctx);
  const readOne = ctx.out;

  values['grp-ages-min'] = 6;
  values['grp-ages-max'] = 9;
  H.eq(JSON.stringify(readOne({ key: 'ages', kind: 'ages' }, 'grp', {})), '{"min":6,"max":9}',
    'a group’s age range reads back off the group prefix');
  H.eq(JSON.stringify(readOne({ key: 'ages', kind: 'ages' }, 'fact', {})), '{"min":null,"max":null}',
    '⚠ and the SAME fact under the main form’s prefix reads nothing, which is what ' +
    'stops one screen writing into the other’s ids');

  values['grp-lang-he'] = true;
  H.eq(readOne({ key: 'instructionLanguage', kind: 'languages' }, 'grp', {}).codes.join(','), 'he',
    'and so do its languages');
  values['grp-duration-sessionCount'] = 4;
  values['grp-duration-sessionMinutes'] = 90;
  const dates = [{ date: '2026-10-12', status: 'scheduled' }];
  const dur = readOne({ key: 'duration', kind: 'duration' }, 'grp', { sessionDates: dates });
  H.eq(dur.sessionCount, 4, 'its typed session count');
  H.eq(dur.sessionDates.length, 1,
    '⚠ and the CALENDAR is carried through from what was already held rather than read ' +
    'off a form that does not hold it');

  console.log('\n[and the group list is DRAWN, not just described]');
  // ⚠ EXECUTED. Every assertion above this point reads the source or the record;
  // a typo in the one panel an admin opens first would pass all of them and
  // throw on the screen. The DOM shim from a-ticked-date is enough to run it:
  // it implements what this code actually uses and throws on anything else — a
  // click on a node nobody wired, an appendChild(null) — so it cannot decay into
  // a bad imitation of a browser.
  const elSrc = src.slice(src.indexOf('  function el(tag, attrs, children) {'),
                          src.indexOf('  var langObj ='));
  function node(tag) {
    const n = {
      tagName: String(tag).toUpperCase(), attributes: {}, childNodes: [],
      _text: '', _handlers: {}, _checked: false,
      get className() { return n.attributes['class'] || ''; },
      set className(v) { n.attributes['class'] = v; },
      get checked() { return n._checked; },
      set checked(v) { n._checked = !!v; },
      get disabled() { return n.attributes.disabled != null; },
      set disabled(v) { if (v) n.attributes.disabled = 'true'; else delete n.attributes.disabled; },
      get value() { return n.attributes.value || ''; },
      set value(v) { n.attributes.value = v; },
      get textContent() { return n._text + n.childNodes.map((c) => c.textContent).join(''); },
      set textContent(v) { n.childNodes.length = 0; n._text = String(v); },
      set innerHTML(v) { if (v !== '') throw new Error('innerHTML is not implemented'); n.childNodes.length = 0; },
      setAttribute(k, v) { n.attributes[k] = String(v); },
      getAttribute(k) { return k in n.attributes ? n.attributes[k] : null; },
      addEventListener(ev, fn) { (n._handlers[ev] = n._handlers[ev] || []).push(fn); },
      appendChild(c) {
        if (!c) throw new Error('appendChild(null) — el() is meant to filter those');
        n.childNodes.push(c); return c;
      },
      click() {
        const hs = n._handlers.click || [];
        if (!hs.length) throw new Error('clicked a ' + n.tagName + ' with no click handler');
        hs.forEach((f) => f({ preventDefault() {} }));
      }
    };
    return n;
  }
  const walk = (n, pred) => {
    const found = [];
    (function go(x) { (x.childNodes || []).forEach((c) => { if (pred(c)) found.push(c); go(c); }); })(n);
    return found;
  };
  const buttons = (n, label) =>
    walk(n, (x) => x.tagName === 'BUTTON' && x.textContent.indexOf(label) !== -1);

  const drawCtx = {
    document: { createElement: node },
    window: H.adminHelpWindow(node),
    DAY_NAMES: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    canEditAll: () => true,
    openGroupPage: (id) => { drawCtx.opened = id; },
    S: null, opened: null, exports: null
  };
  vm.createContext(drawCtx);
  vm.runInContext(elSrc + '\n' +
    ['withHelp', 'mintGroupId', 'groupById', 'groupLabel', 'liveDates', 'groupSummary',
     'blankGroupFacts', 'drawGroups', 'duplicateGroup'].map(slice).join('\n') +
    '\nexports = { drawGroups, groupSummary };', drawCtx);

  const withSchema = { schema: { groupFacts: ['ages', 'schedule', 'duration'] }, dirty: false };
  const g = (id, name, cap, day) => ({
    groupId: id, name: name, capacity: cap, teacherIds: [],
    facts: { schedule: { sessions: [{ day: day, time: '16:00' }] },
             duration: { sessionDates: [{ date: '2026-10-12', status: 'scheduled' }] } }
  });

  drawCtx.S = Object.assign({ groups: [g('g-a', { he: '', en: '', ru: '' }, 20, 3)] }, withSchema);
  let box = node('div');
  drawCtx.exports.drawGroups(box);
  H.eq(buttons(box, 'Open this group').length, 1, 'one group draws one way in');
  // ⚠ READ OFF THE (i), NOT OFF THE PAGE. Every explanation in the admin is a
  // control now rather than a paragraph — see js/admin-help.js — so the words
  // live on the badge and the line on screen is the COUNT, which is the part
  // that is true of this activity rather than of activities in general.
  const helpText = (n) => walk(n, (x) => (x.className || '') === 'help')
    .map((x) => x._helpText).join(' ');
  H.ok(box.textContent.indexOf('One group') !== -1, 'the line on screen is the count');
  H.ok(helpText(box).indexOf('One group, so nobody is asked to choose') !== -1,
    'and the (i) says what one group means rather than describing a choice');
  H.ok(box.textContent.indexOf('Wednesday 16:00') !== -1, 'with its timetable summarised on the row');
  H.ok(box.textContent.indexOf('up to 20') !== -1, 'and its places');

  // ⚠ ADD, AND THEN DUPLICATE. A fresh id each time: reusing one attaches last
  // term's registrations to a group nobody registered for.
  buttons(box, '+ Add a group')[0].click();
  H.eq(drawCtx.S.groups.length, 2, 'Add appends a second group');
  H.ok(drawCtx.S.dirty, 'and marks the form dirty, so leaving warns');
  H.ok(drawCtx.S.groups[1].groupId !== drawCtx.S.groups[0].groupId, 'with an id of its own');
  H.eq(Object.keys(drawCtx.S.groups[1].facts).sort().join(','), 'ages,duration,schedule',
    'and a full set of blank facts, so its page has something to draw');

  drawCtx.S = Object.assign({ groups: [
    g('g-a', { he: 'מתחילים', en: 'Beginners', ru: '' }, 7, 1),
    g('g-b', { he: '', en: 'Advanced', ru: '' }, 10, 3)
  ] }, withSchema);
  box = node('div');
  drawCtx.exports.drawGroups(box);
  H.ok(box.textContent.indexOf('2 groups') !== -1, 'the line on screen counts them');
  H.ok(helpText(box).indexOf('a family CHOOSES one when they register') !== -1,
    'and the (i) says that a family chooses');
  H.eq(buttons(box, 'Duplicate').length, 2, 'and each one can be duplicated');
  buttons(box, 'Duplicate')[0].click();
  H.eq(drawCtx.S.groups.length, 3, 'duplicating adds a third');
  H.ok(drawCtx.S.groups[2].groupId !== 'g-a',
    '\u26a0 with a FRESH id \u2014 reusing one would attach the original\u2019s registrations to it');
  H.eq(drawCtx.S.groups[2].name.en, 'Beginners (copy)',
    'and a name that says what it is, because a blank one is refused on save and would read ' +
    'as the copy having failed');
  H.eq(drawCtx.S.groups[2].name.ru, '',
    'without inventing a translation for a language the original had none in');
  H.eq(drawCtx.S.groups[2].facts.duration.sessionDates.length, 1,
    'and everything else copied, which is the point of starting from one');
  drawCtx.S.groups[2].capacity = 99;
  H.eq(drawCtx.S.groups[0].capacity, 7,
    '\u26a0 and a DEEP copy \u2014 a shared facts object would have two groups editing one calendar');

  buttons(box, 'Open this group')[1].click();
  H.eq(drawCtx.opened, 'g-b', 'and each row opens its own group');

  H.done();
})();
