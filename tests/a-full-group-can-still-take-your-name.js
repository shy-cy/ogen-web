// What this defends against:
//
// "WHERE IS THE WAITING LIST FEATURE??" — asked while looking at an activity
// with two groups, one of them full, and no way anywhere on the screen to wait
// for it.
//
// The waiting list has worked since it was built. `hasRoom(report, groupId)`
// answers PER GROUP, `submit` takes a groupId beside `waitlist`, and a queue for
// one group of a half-empty activity has always been writable. THE DOOR WAS
// NEVER DRAWN — the same shape as the invite button labelled with a description,
// and as the pure bundle module wired to nothing for a release.
//
// Two lines did it, and each looks correct on its own:
//
//   1. `var isFull = !!a.full` — the ACTIVITY's fullness. activityView() sets
//      that field `&& !groups.offersAChoice(activity)`, deliberately, because
//      "is the activity full" has no honest answer once two groups can each be
//      full or not. So on every multi-group activity it is PERMANENTLY FALSE,
//      and the waiting-list button could never appear however full every group
//      was.
//
//   2. the full group's option was `disabled`, so it could not even be chosen —
//      and it was labelled with `registerFull`, "This activity is full", which
//      rendered directly under a line counting the places still free. Two
//      statements on one screen contradicting each other, and the one a family
//      would act on was the wrong one.
//
// ⚠ AND THE COST IS NOT "A CONTROL WAS HARD TO FIND". Under the equal-hours rule
// two groups may meet on a different day, at a different hour, in a different
// place, with different teachers and a different age range — that is what groups
// are FOR. So "the other group has room" is not an answer to a family whose
// child can only come on Thursdays. Disabling the row told them to go away, on
// an activity that would have taken their name.
//
// This suite EXECUTES the panel, because both halves read perfectly as source: a
// flag consulted at the wrong level, and a disabled attribute that looks like
// care.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const F = require('./_fixtures');
const D = require('./_dom');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const memberSession = read('js/member-session.js');
const memberAccount = read('js/member-account.js');

const ACCOUNT = {
  accountId: 'a-1', email: 'michal@example.com',
  emailVerifiedAt: '2026-01-01T00:00:00Z',
  profile: { firstName: 'Michal', preferredLanguage: 'en' }
};
const PARTICIPANTS = [
  { participantId: 'p-1', firstName: 'Michal', lastName: 'Shinitzky', isSelf: true, isPrimary: true }
];

// The reported shape exactly: an activity with places left, whose SECOND group
// has none. `full` is false at the activity level because there is a choice —
// which is activityView() working, not a bug.
const TWO_GROUPS = {
  activityId: 'act-2', slug: 'test1', type: 'course', perSession: false,
  title: { en: 'Test 1' }, status: 'open',
  capacity: 4, taken: 2, left: 2, full: false,
  groups: [
    { groupId: 'g-1', name: { en: 'Test 1' }, label: 'Test 1, up to 2 students',
      capacity: 2, left: 2, full: false, cancellationTerms: ['Group one terms.'] },
    { groupId: 'g-2', name: { en: 'Test 2' }, label: 'Test 2, up to 2 students',
      capacity: 2, left: 0, full: true, cancellationTerms: ['Group two terms.'] }
  ]
};
// One group and no choice: `full` IS the activity's answer here, and the old
// behaviour was right in this case — which is why nobody found the other one.
const SOLE_FULL = {
  activityId: 'act-3', slug: 'solo', type: 'course', perSession: false,
  title: { en: 'Solo' }, status: 'open',
  capacity: 2, taken: 2, left: 0, full: true, groups: null
};

const sent = [];
function fetchFor(activity, overrides) {
  const table = Object.assign({
    me: () => ({ ok: true, account: ACCOUNT, expiresAt: Date.now() + 1e7 }),
    registerPanel: () => ({ ok: true, activity: activity, participants: PARTICIPANTS }),
    submit: (b) => ({ ok: true, waiting: b.waitlist === true,
                      registration: { participantId: 'p-1', activityId: activity.activityId,
                                      status: b.waitlist ? 'waitlisted' : 'approved' } }),
    registration: () => ({ ok: true, registration: { status: 'waitlisted', frozen: {}, payment: {} },
                           activity: activity, balanceCents: 0 })
  }, overrides || {});
  return function (endpoint, init) {
    const body = JSON.parse(init.body);
    sent.push(body);
    const fn = table[body.action];
    const out = fn ? fn(body) : { ok: true };
    const status = out._status || 200;
    delete out._status;
    return Promise.resolve({ ok: status < 400, status: status,
                             json: () => Promise.resolve(out) });
  };
}

const settle = () => new Promise((r) => setTimeout(r, 40));

async function screen(opts) {
  const dom = D.makeDom(Object.assign({ fetch: fetchFor(opts.activity, opts.api) }, opts));
  dom.window.localStorage.setItem('ogenMemberSession', JSON.stringify({
    token: 't', firstName: 'Michal', email: ACCOUNT.email, expiresAt: Date.now() + 1e7 }));
  const ctx = vm.createContext({
    window: dom.window, document: dom.document, console: console,
    location: dom.window.location,
    Intl: Intl, Date: Date, Math: Math, JSON: JSON, Object: Object, Array: Array,
    String: String, Number: Number, RegExp: RegExp, Promise: Promise, setTimeout: setTimeout,
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent
  });
  vm.runInContext(memberSession, ctx, { filename: 'js/member-session.js' });
  vm.runInContext(memberAccount, ctx, { filename: 'js/member-account.js' });
  await settle();
  return dom;
}

const has = (dom, s) => dom.mount.textContent.indexOf(s) !== -1;
const button = (dom) => D.byTag(dom.mount, 'button')
  .filter((b) => b.attributes.type === 'submit')[0];
const shown = (dom, cls) => D.byClass(dom.mount, cls)
  .filter((n) => n.attributes.hidden == null);

(async () => {
  // =========================================================================
  console.log('[a full group can be chosen — that is how you join its queue]');
  sent.length = 0;
  const dom = await screen({ view: 'activity', lang: 'en', search: '?register=test1',
                             activity: TWO_GROUPS });

  const sel = D.byTag(dom.mount, 'select').filter((s) => s.childNodes.length === 2)[0];
  H.ok(sel, 'the group select is drawn with both groups');
  const opts = sel.childNodes;
  H.eq(opts.length, 2, 'the full group is still offered — never hidden');
  // ⚠ THE HALF THAT WAS THE BUG. Disabled, it could not be selected, so there
  // was no way to reach the queue for it at all.
  H.ok(opts[1].attributes.disabled == null,
    '⚠ and it is NOT disabled — choosing it is the only way to join its waiting list');
  H.ok(opts[0].attributes.disabled == null, 'the one with room is choosable too, obviously');

  // ⚠ AND IT SAYS WHAT IS FULL. `registerFull` said "This activity is full",
  // under a line saying two places are left.
  H.ok(/full/i.test(opts[1].attributes.text || opts[1]._text || ''),
    'the full group says so on its own row');
  H.ok(!/this activity is full/i.test(dom.mount.textContent),
    '⚠ and NOTHING on the screen claims the activity is full — it is not, and ' +
    'the line above counts the places still free');
  H.ok(has(dom, '2 places left'), 'which is still there and still true');

  console.log('\n[and the button follows the group, before the press rather than after]');
  H.eq(button(dom).textContent, 'Register',
    'the group with room offers a place');
  H.eq(shown(dom, 'acc-waiting').length, 0, 'and no waiting block over it');

  sel.value = 'g-2';
  sel.dispatch('change');
  await settle();
  H.eq(button(dom).textContent, 'Join the waiting list',
    '⚠ choosing the full group turns the button into the queue — said BEFORE ' +
    'the press, because a button that quietly means something else is a ' +
    'surprise about a child\'s place');
  H.eq(shown(dom, 'acc-waiting').length, 1, 'and the block explaining the queue appears');
  H.ok(has(dom, 'This group is full'),
    '⚠ naming the GROUP, not the activity — there are places on this activity');
  H.ok(has(dom, 'first person to take it'),
    'and saying plainly that everybody waiting is told and it goes to the first back');
  H.ok(has(dom, 'Group two terms'),
    'the cancellation terms follow the group too, as they already did');

  // Back again: the panel is not a one-way door.
  sel.value = 'g-1';
  sel.dispatch('change');
  await settle();
  H.eq(button(dom).textContent, 'Register', 'and back to a place when the group has one');
  H.eq(shown(dom, 'acc-waiting').length, 0, 'with the block hidden again');

  // =========================================================================
  console.log('\n[what is sent, and it is the group that was chosen]');
  sel.value = 'g-2';
  sel.dispatch('change');
  await settle();
  sent.length = 0;
  D.byTag(dom.mount, 'form')[0].submit();
  await settle();
  const sub = sent.filter((b) => b.action === 'submit')[0];
  H.ok(sub, 'it posts submit');
  H.eq(sub.groupId, 'g-2', 'for the group that was picked');
  H.eq(sub.waitlist, true, '⚠ with waitlist true — which the server reads as ' +
    '"queue me rather than refuse me", and it only ever chooses between those two');
  H.ok(has(dom, 'on the waiting list'), 'and the family is told they are on it');

  // And the other way: a group with room must not send the flag, or a family
  // could be queued for a place that was free.
  sent.length = 0;
  const other = await screen({ view: 'activity', lang: 'en', search: '?register=test1',
                               activity: TWO_GROUPS });
  D.byTag(other.mount, 'form')[0].submit();
  await settle();
  H.eq(sent.filter((b) => b.action === 'submit')[0].waitlist, false,
    'a group with room sends waitlist false');

  // =========================================================================
  console.log('\n[one group and no choice still reads the activity]');
  // This case was always right, which is exactly why the other one survived.
  const solo = await screen({ view: 'activity', lang: 'en', search: '?register=solo',
                              activity: SOLE_FULL });
  H.eq(button(solo).textContent, 'Join the waiting list', 'a full sole-group activity queues');
  H.eq(shown(solo, 'acc-waiting').length, 1, 'with the block up from the start');
  H.ok(has(solo, 'This activity is full'),
    '⚠ and here it says ACTIVITY — telling a family "this group is full" about ' +
    'the only group there is would describe a structure the page never showed them');
  H.eq(D.byTag(solo.mount, 'select').length, 1, 'and no group picker at all');

  // =========================================================================
  console.log('\n[the three languages]');
  for (const [l, reg, wait, groupFull] of [
    ['he', 'הרשמה', 'הצטרפות לרשימת המתנה', 'הקבוצה הזו מלאה'],
    ['ru', 'Записаться', 'В список ожидания', 'В этой группе сейчас нет мест']
  ]) {
    const d = await screen({ view: 'activity', lang: l, search: '?register=test1',
                             activity: TWO_GROUPS });
    const s = D.byTag(d.mount, 'select').filter((x) => x.childNodes.length === 2)[0];
    H.eq(button(d).textContent, reg, l + ': a place reads as a place');
    s.value = 'g-2';
    s.dispatch('change');
    await settle();
    H.eq(button(d).textContent, wait, l + ': and a full group reads as a queue');
    H.ok(has(d, groupFull), l + ': naming the group');
  }

  // =========================================================================
  console.log('\n[the server half, which was right all along]');
  const blobs = H.makeBlobs();
  const act = F.course({ slug: 'two', activityId: 'act-0000000000two01' });
  // Two groups of one place each, so one can be filled and the other left open.
  act.groups = [
    Object.assign({}, act.groups[0], { groupId: 'g-1', name: { he: 'א', en: 'One' }, capacity: 1 }),
    Object.assign({}, JSON.parse(JSON.stringify(act.groups[0])),
                  { groupId: 'g-2', name: { he: 'ב', en: 'Two' }, capacity: 1 })
  ];
  const github = H.makeGithub({
    'activities/two.json': JSON.stringify(act),
    'activities/activities-index.json': JSON.stringify(
      [{ slug: 'two', activityId: act.activityId, status: 'open',
         langs: ['he', 'en', 'ru'], title: act.title }])
  });
  const mods = H.loadWithStubs({ blobs, github,
    modules: ['_registration', 'account-auth', 'account-family', 'account-registrations'] });
  const Reg = mods['_registration'];
  const auth = mods['account-auth'];
  const fam = mods['account-family'];
  const api = mods['account-registrations'];

  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async () => ({ data: { id: 'e-1' } }) }
  });

  const kid = async (auth1, first) => {
    const up = await H.signUp(auth1, blobs, { email: first + '@example.com',
      profile: { firstName: first, preferredLanguage: 'en' } });
    const made = await H.call(fam.handler, { action: 'createParticipant', token: up.body.token,
      participant: { firstName: first, lastName: 'Levi', dateOfBirth: '2016-04-02' } });
    return { token: up.body.token, id: made.body.participant.participantId };
  };
  const a1 = await kid(auth, 'ann');
  const a2 = await kid(auth, 'ben');
  const a3 = await kid(auth, 'cal');

  // Fill g-1.
  const first = await H.call(api.handler, { action: 'submit', token: a1.token, slug: 'two',
                                            participantId: a1.id, groupId: 'g-1', lang: 'en' });
  H.eq(first.status, 200, 'the first family takes the one place in group one');

  // g-2 still has room, so the ACTIVITY is not full — and yet g-1 is.
  const report = Reg.capacityReport(act, [first.body.registration]);
  H.eq(Reg.hasRoom(report, 'g-1'), false, 'group one has no room');
  H.eq(Reg.hasRoom(report, 'g-2'), true, 'group two does');
  H.ok(report.left > 0, '⚠ and the ACTIVITY still reports places left — which is ' +
    'why an activity-level `full` could never have found this');

  // Refused without the flag, queued with it. Both against the FULL group, on an
  // activity that is not full.
  const refused = await H.call(api.handler, { action: 'submit', token: a2.token, slug: 'two',
                                              participantId: a2.id, groupId: 'g-1', lang: 'en' });
  H.eq(refused.status, 409, 'a second family is refused that group');
  H.eq(refused.body.canWaitlist, true, '⚠ and is told a queue is available — the server has ' +
    'offered this the whole time');

  const queued = await H.call(api.handler, { action: 'submit', token: a2.token, slug: 'two',
                                             participantId: a2.id, groupId: 'g-1',
                                             waitlist: true, lang: 'en' });
  H.eq(queued.status, 200, 'and with the flag they are queued');
  H.eq(queued.body.waiting, true, 'as a waiting entry');
  H.eq(queued.body.registration.status, 'waitlisted', 'stored as waitlisted');
  H.eq(queued.body.registration.groupId, 'g-1', '⚠ against the GROUP they are waiting for');
  // A queue holds nothing, which is what lets it exist beside a real count.
  H.eq(queued.body.registration.payment.owedCents, 0, 'owing nothing — a queue is not a bill');
  const after = Reg.capacityReport(act, [first.body.registration, queued.body.registration]);
  H.eq(Reg.hasRoom(after, 'g-2'), true,
    '⚠ and waiting for group one takes nothing from group two');
  H.eq(after.named.filter((r) => r.groupId === 'g-1')[0].taken, 1,
    'nor from group one — holdsASpot() does not recognise the status, so a ' +
    'queue cannot move a number');

  // The other group is unaffected and still takes an ordinary registration.
  const third = await H.call(api.handler, { action: 'submit', token: a3.token, slug: 'two',
                                            participantId: a3.id, groupId: 'g-2', lang: 'en' });
  H.eq(third.status, 200, 'and the group with room still gives out its place');
  H.eq(third.body.waiting, false, 'as a place, not a queue');

  H.done();
})();
