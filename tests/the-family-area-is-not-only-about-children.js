// What this defends against:
//
// _participant-store.js opens by saying a participant is NOT a child — "a
// guardian must be able to register themselves, and that leaves two shapes: a
// second parallel entity for adults, or one entity that happens usually to be a
// child. One entity." The model has been right since Phase 3. Nothing in it
// branches on age, and a guardian could always add themselves.
//
// THE WORDS DRIFTED, AND ONLY HALF OF THEM, which is why nobody noticed: the
// button already said "Add a participant" / "הוספת משתתף/ת" while the heading
// directly above it said "My children" / "הילדים שלי" / "Мои дети". So the one
// screen that decides whether a parent realises they can sign up for the folk
// dancing class told them, in every language, that this list was for their kids.
//
// A model that is right and a screen that says otherwise is worse than either
// alone: the capability is built, paid for, and invisible. So this pins the
// words to the model rather than to a review that has to be repeated.
//
// It also pins the two edges the change exposed:
//
//   1. "Remove myself from this record" is meaningless on the record that IS
//      you. It is hidden there. (The server would refuse it anyway when you are
//      the only guardian — but a second guardian on your own record is a legal
//      state, and the button would then work and do something nobody wants.)
//   2. `isSelf` lives on the LINK, not on the participant. It is a fact about a
//      pair: a couple who each manage the other's record are "self" on one of
//      their two links and not on the other. Put on the participant it would
//      have to name an account, which is primacy's job and already has a home.
//
// And the three new signed-in views are checked against the router, because a
// data-view with no branch renders a blank page and a branch with no page is
// dead code — neither fails loudly.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const F = require('./_fixtures');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const LANGS = ['he', 'en', 'ru'];

const src = read('js/member-account.js');
const tableSrc = src.slice(src.indexOf('var T = {'),
                           src.indexOf('}[lang];', src.indexOf('var T = {')) + '}[lang];'.length);
const tableFor = (l) => {
  const ctx = { lang: l };
  vm.runInNewContext(tableSrc + '\nresult = T;', ctx);
  return ctx.result;
};

console.log('[the list is of people, not of children]');
// The words for "child" in all three languages, in the forms this table would
// plausibly use them. Checked against every string, not only the heading — the
// point is that the area stops being about children anywhere a person reads.
const CHILD_WORDS = [
  /\bchild\b/i, /\bchildren\b/i, /\bkids?\b/i,
  /ילד/, /ילדים/, /ילדיי/,
  /дет(и|ей|ям|ьми)/i, /ребён|ребен/i
];
LANGS.forEach((l) => {
  const t = tableFor(l);
  const offenders = [];
  Object.keys(t).forEach((k) => {
    const values = typeof t[k] === 'string' ? [t[k]] : Object.keys(t[k]).map((s) => t[k][s]);
    values.forEach((v) => {
      if (typeof v === 'string' && CHILD_WORDS.some((re) => re.test(v))) offenders.push(k + ': ' + v);
    });
  });
  H.eq(offenders.length, 0,
    l + ' calls nobody a child' + (offenders.length ? ' — ' + offenders.join(' | ') : ''));
});

// And it says what it IS about, in each language rather than by translating one.
const HEADING = { he: 'המשפחה שלי', en: 'My family', ru: 'Моя семья' };
const ADD_SELF = { he: 'הוספת עצמי', en: 'Add myself', ru: 'Добавить себя' };
LANGS.forEach((l) => {
  const t = tableFor(l);
  H.eq(t.familyTitle, HEADING[l], l + ': the heading is the family, not the children');
  H.eq(t.addSelf, ADD_SELF[l], l + ': and adding yourself is a button, not something to work out');
  H.ok(t.addSomeone && t.addSomeone !== t.addSelf, l + ': with adding someone else beside it');
});

console.log('\n[adding yourself is a real thing, end to end]');
H.ok(/isSelf: existing \? undefined : !!isSelf/.test(src),
  'the form sends isSelf only on create — an edit cannot change who a record is about');
H.ok(/prof\.firstName \|\| ''/.test(src),
  'and "Add myself" fills in the name the account already knows');

const family = read('netlify/functions/account-family.js');
H.ok(/isSelf: body\.isSelf === true/.test(family),
  'the server takes it strictly — anything but true is somebody else');
H.ok(/isSelf: !!\(link && link\.isSelf\)/.test(family),
  'and reports it back per participant, read from THIS account\'s link');

const store = read('netlify/functions/_guardian-store.js');
H.ok(/isSelf: isSelf === true/.test(store), 'it is stored on the link record');
H.ok(!/isSelf/.test(read('netlify/functions/_participant-store.js')),
  'and NOT on the participant — a participant still makes no claim about who it is');

console.log('\n["remove myself" is never offered on your own record]');
H.ok(/if \(!p\.isSelf && \(res\.data\.guardians \|\| \[\]\)\.length > 1\)/.test(src),
  'hidden on your own record, and still only when another guardian would remain');

console.log('\n[the three signed-in views, the router and the pages agree]');
const VIEWS = ['account', 'details', 'activity'];
VIEWS.forEach((v) => {
  LANGS.forEach((l) => {
    const file = (l === 'he' ? '' : l + '/') +
      (v === 'account' ? 'account.html' : 'account/' + v + '.html');
    H.ok(fs.existsSync(path.join(R, file)), file + ' exists');
    H.ok(read(file).indexOf('data-view="' + v + '"') !== -1, file + ' declares data-view="' + v + '"');
  });
});
H.ok(/if \(view === 'details'\) return renderDetails/.test(src), 'the router branches on details');
H.ok(/if \(view === 'activity'\) return renderActivity/.test(src), 'and on activity');

console.log('\n[a registration page is addressed by ids, never by the frozen slug]');
// `activitySlugAtSubmission` is audit only. Following it after an admin renames
// an activity opens the wrong record or none at all, and the family would be
// told their registration does not exist.
H.ok(/'p=' \+ encodeURIComponent\(r\.participantId\) \+/.test(src),
  'the dashboard row links by participantId');
H.ok(/'&a=' \+ encodeURIComponent\(r\.activityId\)/.test(src), 'and activityId');
const regs = read('netlify/functions/account-registrations.js');
const action = regs.slice(regs.indexOf("case 'registration': {"), regs.indexOf("case 'submit': {"));
H.ok(/a\.activityId === reg\.activityId/.test(action),
  'and the server resolves the activity by id through the index');
H.ok(!/activitySlugAtSubmission/.test(action),
  'never through the slug frozen onto the registration');

console.log('\n[one row shape, so a list and a page cannot disagree]');
H.ok(/^function regRow\(reg, participant\)/m.test(regs),
  'the server builds a registration row in one place');
// ⚠ SCOPED TO THE ROW BUILDER. This counted the whole file once, which made it
// a test about the string "participantName:" rather than about rows — and it
// fired the first time a name was needed for something that is not a row (the
// line description on a bundle's Stripe session, so a family buying for two
// children can tell the two receipts apart). The property worth pinning is that
// there is ONE row builder, not that a word appears once.
const rowFn = regs.slice(regs.indexOf('function regRow(reg, participant)'), regs.indexOf('exports.handler'));
H.eq((rowFn.match(/participantName:/g) || []).length, 1,
  'and only one place names the participant INTO A ROW');
H.eq((regs.match(/regRow\(/g) || []).length > 2, true,
  'and both views go through it rather than composing their own');

console.log('\n[the facts on the page are the PUBLIC facts, and nothing more]');
// isPubliclyVisible() keeps its exact current meaning and its only caller. The
// members-only address is the whole reason that function exists, and a family
// area is exactly where somebody would be tempted to reach past it.
H.ok(/facts\.sidebarGroups\(activity, lang\)/.test(action),
  'built from sidebarGroups, which filters through isPubliclyVisible()');
H.ok(!/memberVisibleRows|visibility: *'members'|factText\(/.test(action),
  'and nothing here reaches around it');

console.log('\n[labels reach the screen as words, not as entities]');
// LABELS is authored for an HTML template, so "When &amp; where" is correct
// there. The client sets textContent, so an undecoded entity would be read by a
// family literally.
H.ok(/const plainLabel = /.test(regs), 'there is one decoder');
H.ok(/heading: plainLabel\(/.test(regs) && /label: plainLabel\(/.test(regs),
  'and both the group heading and the fact label go through it');
const { LABELS } = require(H.fnPath('_activity-template'));
H.ok(/&amp;/.test(LABELS.en.gSchedule), 'the source really does carry an entity (so this matters)');

// --------------------------------------------------------------- end to end
//
// The static checks above say the code is SHAPED right. These say it WORKS:
// an account adds itself and a child, and the screen can tell the two apart.
(async () => {
  const blobs = H.makeBlobs();
  const activity = F.course({ facts: Object.assign({}, F.course().facts, {
    location: { text: { he: 'לימסול', en: 'Limassol', ru: 'Лимасол' } },
    // The members-only one, and it defaults to `members` — it is here precisely
    // so the assertion below is about a field that exists rather than about an
    // empty object.
    address: { text: { he: 'רחוב לדוגמה 12', en: '12 Example Street, Limassol',
                       ru: 'Улица Пример, 12' } }
  }) });
  const github = H.makeGithub({
    'activities/course-fixture.json': JSON.stringify(activity),
    'activities/activities-index.json': JSON.stringify([
      { slug: 'course-fixture', activityId: activity.activityId,
        seriesId: activity.activityId, type: 'course', status: 'open', title: activity.title }
    ])
  });
  const mods = H.loadWithStubs({ blobs, github,
    modules: ['account-auth', 'account-family', 'account-registrations'] });
  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async () => ({ data: { id: 'x' } }) }
  });
  const auth = mods['account-auth'], family = mods['account-family'],
        regs = mods['account-registrations'];

  const up = await H.call(auth.handler, {
    action: 'signup', email: 'michal@example.com', password: 'password-123',
    termsAccepted: true,
    profile: { firstName: 'Michal', lastName: 'Shinitzky', preferredLanguage: 'en' }
  });
  const token = up.body.token;

  console.log('\n[an account can add itself, and the list says which row is you]');
  const me = await H.call(family.handler, {
    action: 'createParticipant', token: token, isSelf: true,
    participant: { firstName: 'Michal', lastName: 'Shinitzky', dateOfBirth: '1975-07-31' } });
  const kid = await H.call(family.handler, {
    action: 'createParticipant', token: token,
    participant: { firstName: 'Noa', lastName: 'Levi', dateOfBirth: '2017-04-02' } });
  H.eq(me.status, 201, 'adding yourself is the same call, with one flag');
  H.eq(kid.status, 201, 'so is adding a child');

  const listed = await H.call(family.handler, { action: 'listParticipants', token: token });
  const byName = {};
  listed.body.participants.forEach((p) => { byName[p.firstName] = p; });
  H.eq(byName.Michal.isSelf, true, 'the account holder\'s own row is marked');
  H.eq(byName.Noa.isSelf, false, "and the child's is not");
  H.eq(listed.body.participants.length, 2, 'both are on one list — one entity, no attendeeType branch');
  // Age is derived from the date of birth and says nothing about which is which.
  H.ok(byName.Michal.age > byName.Noa.age, 'and an adult is simply older, not a different kind of thing');

  console.log('\n[a registration page answers by ids, through a rename]');
  const sub = await H.call(regs.handler, {
    action: 'submit', token: token, slug: 'course-fixture', participantId: byName.Michal.participantId });
  H.eq(sub.status, 200, 'the account holder registers themselves for a course');

  // The admin renames it. The frozen slug on the registration is now stale, and
  // that is the rename working — not a broken record.
  github._files.set('activities/folk-dancing.json',
    JSON.stringify(Object.assign({}, activity, { slug: 'folk-dancing' })));
  github._files.set('activities/activities-index.json', JSON.stringify([
    { slug: 'folk-dancing', activityId: activity.activityId,
      seriesId: activity.activityId, type: 'course', status: 'open', title: activity.title }
  ]));

  const page = await H.call(regs.handler, {
    action: 'registration', token: token,
    participantId: byName.Michal.participantId, activityId: activity.activityId });
  H.eq(page.status, 200, 'the page still opens after the rename');
  H.eq(page.body.registration.slug, 'course-fixture', 'the registration keeps the slug it was made under');
  H.eq(page.body.activity.slug, 'folk-dancing', 'and the activity is the one it actually is now');
  H.eq(page.body.registration.participantName, 'Michal Shinitzky', 'named from the live record');

  console.log('\n[the page carries the public facts, priced, and not the address]');
  const flat = JSON.stringify(page.body.activity.facts);
  H.ok(page.body.activity.facts.length >= 2, 'there are fact groups (' + page.body.activity.facts.length + ')');
  H.ok(flat.indexOf('Limassol') !== -1, 'the public location is there');
  H.ok(flat.indexOf('12 Example Street') === -1,
    'and the members-only address is NOT — omitted from the payload, never hidden in the client');
  H.ok(flat.indexOf('&amp;') === -1, 'no HTML entity survives into a label a person reads');
  H.ok(page.body.activity.priceRows.length >= 2, 'the price is rows');
  const labels = page.body.activity.priceRows.map((r) => r.label).join(' | ');
  H.ok(!/total/i.test(labels), 'and there is no total: ' + labels);
  // 50 + 300 is a figure nobody is ever billed — the fee is yearly, the course
  // is per semester. A test elsewhere asserts the sum appears in no language;
  // this one asserts it did not sneak back in through the family area.
  H.ok(JSON.stringify(page.body.activity.priceRows).indexOf('350') === -1,
    'nor the sum of the yearly fee and the term price anywhere on it');

  console.log('\n[and a registration belonging to somebody else is not yours to open]');
  const other = await H.call(auth.handler, {
    action: 'signup', email: 'stranger@example.com', password: 'password-123',
    termsAccepted: true, profile: { firstName: 'Stranger', preferredLanguage: 'en' } });
  const stolen = await H.call(regs.handler, {
    action: 'registration', token: other.body.token,
    participantId: byName.Michal.participantId, activityId: activity.activityId });
  H.eq(stolen.status, 404, 'a guardian link is checked per participant, on this action too');

  H.done();
})();
