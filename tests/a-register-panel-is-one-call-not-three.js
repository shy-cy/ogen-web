// What this defends against:
//
// "The website is slow when I try to enter directly to the register page like
// /account/activity?register=test1."
//
// That URL is where every activity page's Register button points, so it is the
// first signed-in screen most families ever see — and it was THREE round trips
// deep before it drew anything:
//
//   1. `me`, to find out who is signed in
//   2. `activity` and `listParticipants` together — two functions, two floors
//   3. `sessions`, for whoever the person select happened to land on
//
// Each of those pays the function's own ~0.7-1.0s floor at the Netlify origin
// before it does any work, plus what Cloudflare adds in front of it. Two of them
// also read the same activity file: `activity` and `sessions` are separate
// INVOCATIONS, so the ten-second display cache in account-registrations.js only
// helps when one container happens to serve both, which is not something a page
// load can rely on.
//
// This is the dashboard's fix one screen over — it was four calls and is one —
// and the same argument: none of the three questions needs anything from the one
// before it. The slug is in the URL, the account is the session's, and the
// evenings are for the participant the select opens on, which the server knows
// because it is the server that decides the order of that list.
//
// So the panel is ONE call. What this suite pins:
//
//   A. the screen makes one request and draws everything from it — and NEVER
//      calls the three actions it replaced;
//   B. the server answers all of it from ONE read of the activity;
//   C. ⚠ the seeded evenings are used only when the payload NAMES the
//      participant the select is on. Seeding by position would put one child's
//      bookings under another child's name the first time the two lists came
//      back in a different order — the one bug this shortcut can cause, and it
//      would be invisible;
//   D. the seed is spent once. Changing the select, or reloading after a
//      booking, asks again — that is a person asking a new question, not a page
//      loading.
//
// And the list of people is now ONE walk, in _guardian-store.js, because the
// family screen and this panel ask the identical question and the select is
// picked from by position.

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
  { participantId: 'p-1', firstName: 'Michal', lastName: 'Shinitzky', isSelf: true, isPrimary: true },
  { participantId: 'p-2', firstName: 'Noa', lastName: 'Levi', isSelf: false, isPrimary: true }
];
const DROPIN = { activityId: 'act-2', slug: 'folk', type: 'dropin', perSession: true,
  title: { en: 'Folk dancing' }, capacity: null, taken: null, left: null,
  groups: null, full: false };

// Two evenings for p-1 and a DIFFERENT pair for p-2, so a payload attached to
// the wrong person is visible on screen rather than merely wrong in principle.
const MINE = [
  { date: '2026-10-06', past: false, status: null, full: false, left: 5, priceCents: 1200 },
  { date: '2026-10-13', past: false, status: null, full: false, left: 5, priceCents: 1200 }
];
const THEIRS = [
  { date: '2026-10-06', past: false, status: 'booked', full: false, left: 5, priceCents: 1200 },
  { date: '2026-10-13', past: false, status: null, full: false, left: 5, priceCents: 3300 }
];

const sent = [];
function answers(overrides) {
  return Object.assign({
    me: () => ({ ok: true, account: ACCOUNT, expiresAt: Date.now() + 1e7 }),
    registerPanel: () => ({
      ok: true, activity: DROPIN, participants: PARTICIPANTS,
      sessionsFor: 'p-1', mayBook: true, registrationStatus: 'approved', sessions: MINE
    }),
    sessions: (b) => ({ ok: true, mayBook: true, registrationStatus: 'approved',
                        sessions: b.participantId === 'p-1' ? MINE : THEIRS }),
    listParticipants: () => ({ ok: true, participants: PARTICIPANTS })
  }, overrides || {});
}

function fetchFor(overrides) {
  const table = answers(overrides);
  return function (endpoint, init) {
    const body = JSON.parse(init.body);
    sent.push(body);
    const fn = table[body.action];
    const out = fn ? fn(body) : { ok: true };
    const status = out._status || 200;
    delete out._status;
    return Promise.resolve({
      ok: status < 400, status: status,
      json: () => Promise.resolve(out)
    });
  };
}

const settle = () => new Promise((r) => setTimeout(r, 40));

async function screen(opts) {
  const dom = D.makeDom(Object.assign({ fetch: fetchFor(opts.api) }, opts));
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

const countOf = (a) => sent.filter((b) => b.action === a).length;

(async () => {
  // =========================================================================
  console.log('[A. the register panel is one request, and it draws everything]');
  sent.length = 0;
  const dom = await screen({ view: 'activity', lang: 'en', search: '?register=folk' });

  H.eq(countOf('registerPanel'), 1, 'one call for the panel');
  // The three it replaced. Each one is a whole round trip on the screen a family
  // meets first, and the point of the merge is that none of them happens.
  H.eq(countOf('activity'), 0, '⚠ and never the old `activity` action — it is gone from the server too');
  H.eq(countOf('listParticipants'), 0, '⚠ nor listParticipants, which is a second FUNCTION and a second floor');
  H.eq(countOf('sessions'), 0, '⚠ nor a third call for the evenings — they arrived with the panel');
  // `me` stays: boot() has to know whether anybody is signed in before it draws
  // a screen at all. Two calls total, and the second is the whole page.
  H.eq(sent.length, 2, 'two requests in total for the whole screen — `me`, then the panel');

  // And all three answers are actually on screen, or "one call" would just mean
  // "one call that leaves the page empty".
  H.ok(dom.mount.textContent.indexOf('Folk dancing') !== -1, 'the activity is named');
  const who = D.byTag(dom.mount, 'select')[0];
  H.ok(who, 'the person select is drawn');
  H.eq(who.childNodes.length, 2, 'from the family list that came in the same payload');
  H.eq(D.byClass(dom.mount, 'acc-date').length, 2, 'and the evenings are drawn from the seed');
  H.ok(dom.mount.textContent.indexOf('€12.00') !== -1, 'with their prices');

  // =========================================================================
  console.log('\n[D. the seed is spent once — a new question asks again]');
  sent.length = 0;
  who.value = 'p-2';
  who.dispatch('change');
  await settle();
  H.eq(countOf('sessions'), 1, 'changing the person fetches — that is a new question, not a page load');
  H.ok(sent[0] && sent[0].participantId === 'p-2', 'for the person now chosen');
  H.ok(dom.mount.textContent.indexOf('€33.00') !== -1,
    'and the screen shows THEIR evenings, not the ones it arrived with');
  H.ok(dom.mount.textContent.indexOf('already booked') !== -1, 'including what they already hold');

  // Back to the first person: the seed is gone, so it asks rather than replaying
  // a payload that is now two interactions old.
  sent.length = 0;
  who.value = 'p-1';
  who.dispatch('change');
  await settle();
  H.eq(countOf('sessions'), 1,
    '⚠ and coming back asks again rather than replaying the seed, which by now ' +
    'describes the evening before');

  // =========================================================================
  console.log('\n[C. a seed that does not NAME the right participant is not used]');
  //
  // The dangerous shortcut is "the payload came with the panel, so it must be
  // for the person the select opens on". It is only true while the two lists
  // agree, and the failure is silent: one child's bookings under another child's
  // name, with every figure on screen internally consistent.
  sent.length = 0;
  const mismatched = await screen({ view: 'activity', lang: 'en', search: '?register=folk',
    api: { registerPanel: () => ({ ok: true, activity: DROPIN, participants: PARTICIPANTS,
      // Named for somebody who is not first in the list.
      sessionsFor: 'p-2', mayBook: true, sessions: THEIRS }) } });
  H.eq(countOf('sessions'), 1,
    '⚠ the seed is ignored and the evenings are fetched for the person actually selected');
  H.ok(sent.some((b) => b.action === 'sessions' && b.participantId === 'p-1'),
    'for p-1, which is who the select is on');
  H.ok(mismatched.mount.textContent.indexOf('€33.00') === -1,
    'and the other person\'s prices are nowhere on screen');

  // A payload with no name at all is the same answer, which is what makes a
  // course (no sessions in the payload) and a stale client both safe.
  sent.length = 0;
  await screen({ view: 'activity', lang: 'en', search: '?register=folk',
    api: { registerPanel: () => ({ ok: true, activity: DROPIN, participants: PARTICIPANTS,
                                   sessions: MINE }) } });
  H.eq(countOf('sessions'), 1, 'an unnamed seed is not used either');

  // =========================================================================
  console.log('\n[B. the server answers all of it from ONE read of the activity]');
  const blobs = H.makeBlobs();
  const act = F.dropin({ slug: 'folk', activityId: 'act-0000000000pane1' });
  const github = H.makeGithub({
    'activities/folk.json': JSON.stringify(act),
    'activities/activities-index.json': JSON.stringify(
      [{ slug: 'folk', activityId: act.activityId, status: 'open', langs: ['he', 'en', 'ru'],
         title: act.title }])
  });
  const mods = H.loadWithStubs({ blobs, github,
    modules: ['account-auth', 'account-family', 'account-registrations'] });
  const auth = mods['account-auth'];
  const family = mods['account-family'];
  const api = mods['account-registrations'];

  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async () => ({ data: { id: 'e-1' } }) }
  });

  const up = await H.signUp(auth, blobs, { email: 'dana@example.com',
    profile: { firstName: 'Dana', preferredLanguage: 'en' } });
  const token = up.body.token;
  for (const p of [{ firstName: 'Noa', lastName: 'Levi', dateOfBirth: '2016-04-02' },
                   { firstName: 'Avi', lastName: 'Levi', dateOfBirth: '2014-02-11' }]) {
    await H.call(family.handler, { action: 'createParticipant', token: token, participant: p });
  }

  // The reader seam this file already has, so "one read" is counted rather than
  // argued — the whole reason the merge is worth anything is that it collapses
  // two GitHub round trips into one.
  const listed = await H.call(family.handler, { action: 'listParticipants', token: token });
  const people = listed.body.participants;
  H.eq(people.length, 2, 'the account has two people');

  let reads = 0;
  api._internal._setReader(async () => { reads++; return act; });
  const panel = await H.call(api.handler, { action: 'registerPanel', token: token,
                                            slug: 'folk', lang: 'en' });
  api._internal._setReader(null);

  H.eq(panel.status, 200, 'the panel answers');
  H.eq(reads, 1, '⚠ ONE read of the activity for all three answers');
  H.ok(panel.body.activity && panel.body.activity.activityId === act.activityId,
    'and it carries the activity');
  H.eq((panel.body.participants || []).length, 2, 'the family list');
  H.ok(Array.isArray(panel.body.sessions) && panel.body.sessions.length > 0,
    'and the evenings');

  // ⚠ NAMED, not implied by position — the property the client's guard rests on.
  H.eq(panel.body.sessionsFor, people[0].participantId,
    '⚠ named for the first participant, which is the one the select opens on');

  // The two lists come from ONE walk now, so they cannot come back in different
  // orders — which is what the client is allowed to assume.
  H.eq(panel.body.participants.map((p) => p.participantId).join(','),
       people.map((p) => p.participantId).join(','),
    'and the panel\'s list is the family screen\'s list, in the same order — ' +
    'one walk in _guardian-store, not two copies of it');

  // =========================================================================
  console.log('\n[a course carries no evenings, and says so by omission]');
  const courseAct = F.course({ slug: 'hebrew', activityId: 'act-0000000000pane2' });
  const github2 = H.makeGithub({
    'activities/hebrew.json': JSON.stringify(courseAct),
    'activities/activities-index.json': JSON.stringify(
      [{ slug: 'hebrew', activityId: courseAct.activityId, status: 'open',
         langs: ['he', 'en', 'ru'], title: courseAct.title }])
  });
  const mods2 = H.loadWithStubs({ blobs, github: github2,
    modules: ['account-auth', 'account-family', 'account-registrations'] });
  const api2 = mods2['account-registrations'];
  const up2 = await H.signUp(mods2['account-auth'], blobs, { email: 'rina@example.com',
    profile: { firstName: 'Rina', preferredLanguage: 'en' } });
  await H.call(mods2['account-family'].handler, { action: 'createParticipant', token: up2.body.token,
    participant: { firstName: 'Tal', lastName: 'Cohen', dateOfBirth: '2016-04-02' } });
  const term = await H.call(api2.handler, { action: 'registerPanel', token: up2.body.token,
                                            slug: 'hebrew', lang: 'en' });
  H.eq(term.status, 200, 'a course answers too');
  H.ok(term.body.activity, 'with its activity');
  H.eq((term.body.participants || []).length, 1, 'and the family list');
  H.ok(term.body.sessions === undefined && term.body.sessionsFor === undefined,
    'and NO evenings — a term is not booked one night at a time, so there is ' +
    'nothing to seed and nothing to be wrong about');

  // =========================================================================
  console.log('\n[an unknown slug is still refused]');
  const missing = await H.call(api.handler, { action: 'registerPanel', token: token,
                                              slug: 'nope', lang: 'en' });
  H.eq(missing.status, 404, 'a slug nobody published is a 404, before any of the rest');

  H.done();
})();
