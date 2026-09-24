// What this defends against:
//
// ⚠ THE EMAIL SAID "TAKE THE PLACE" AND SENT PEOPLE WHERE THERE WAS NO BUTTON.
//
// Reported as "it should be simply: I accept the invite or join the course —
// you click on it and you get the payment button", looking at a waiting-list
// card whose only control was *Leave the waiting list*.
//
// Three things were wrong and each hid the next:
//
//   1. THE CARD HAD NO CLAIM BUTTON. The queue has always been claimable —
//      openRegistration() reads a waiting record and converts it, because
//      "claiming is not an action" and a family who was queueing and is now
//      registering IS claiming. So the mechanism worked and the door was never
//      drawn: the same shape as the waiting list itself being unreachable on a
//      multi-group activity, one screen over.
//
//   2. THE EMAIL POINTED AT THE PUBLIC PAGE. placeOpenMessage() carried a
//      comment saying it points at the REGISTRATION page "because that is where
//      the button that takes the place is" — and called activityHref(). The one
//      message whose whole job is "come and take this place" sent a family to a
//      static page that cannot know who is reading it.
//
//   3. AND IT RESOLVED THROUGH THE FROZEN SLUG. activityHref() reads
//      `activitySlugAtSubmission`, which this project says everywhere is AUDIT
//      ONLY: after a rename it opens the wrong page or none at all.
//
// Nothing caught the mismatch between (1) and (2) because the comment was right
// about where the button belonged and there was no button anywhere to compare
// it against. Reading each side proved each side self-consistent — the same
// failure as the dialog that was backwards about money.
//
// ⚠ AND THE PLACE IS THIS GROUP'S, NEVER THE ACTIVITY'S. Under the equal-hours
// rule the other group having room is not this family's place, and a button
// offered on it would lose every single time.

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

// Waiting for group one of a two-group activity.
const REG = {
  participantId: 'p-1', activityId: 'act-2', slug: 'test1',
  participantName: 'Noa Levi', groupId: 'g-1', status: 'waitlisted',
  title: { en: 'Test 1' }, frozen: { price: {} },
  payment: { owedCents: 0, paidCents: 0, creditedCents: 0 },
  cancellation: null, priceRows: []
};
const activityWith = (g1Full, g2Full) => ({
  activityId: 'act-2', slug: 'test1', type: 'course', perSession: false,
  title: { en: 'Test 1' }, status: 'open', full: false,
  capacity: 4, taken: 2, left: 2, facts: [], priceRows: [], sessionRows: [],
  groups: [
    { groupId: 'g-1', name: { en: 'One' }, label: 'One, up to 2',
      capacity: 2, left: g1Full ? 0 : 1, full: g1Full },
    { groupId: 'g-2', name: { en: 'Two' }, label: 'Two, up to 2',
      capacity: 2, left: g2Full ? 0 : 1, full: g2Full }
  ]
});

const sent = [];
function fetchFor(activity, overrides) {
  const table = Object.assign({
    me: () => ({ ok: true, account: ACCOUNT, expiresAt: Date.now() + 1e7 }),
    registration: () => ({ ok: true, registration: REG, activity: activity,
                           balanceCents: 0, perSession: null }),
    submit: () => ({ ok: true, waiting: false,
                     registration: Object.assign({}, REG, { status: 'approved' }) })
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
const labelled = (dom, text) => D.byTag(dom.mount, 'button')
  .filter((b) => b.textContent === text)[0];

(async () => {
  // =========================================================================
  console.log('[a place free in THIS group offers the button]');
  sent.length = 0;
  const open = await screen({ view: 'activity', lang: 'en', search: '?p=p-1&a=act-2',
                              activity: activityWith(false, true) });

  const take = labelled(open, 'Take the place');
  H.ok(take, '⚠ the claim button exists at all — it never has before, on the card ' +
    'the place-open email sends people to');
  H.eq(take.attributes.class, 'btn-primary',
    'and it is the primary, because taking the place is what this screen is now for');
  H.ok(has(open, 'A place has opened'), 'the lead says a place has opened');
  H.ok(has(open, 'pay here straight afterwards'),
    'and says the payment follows immediately, which is what was asked for');
  H.ok(labelled(open, 'Leave the waiting list'), 'leaving is still offered, one rank down');

  console.log('\n[pressing it claims the place, and asks for a PLACE not a queue]');
  sent.length = 0;
  take.click();
  await settle();
  const sub = sent.filter((b) => b.action === 'submit')[0];
  H.ok(sub, 'it posts submit — the same action registering uses, because claiming is not a separate act');
  H.eq(sub.slug, 'test1', 'by the activity\'s CURRENT slug from the payload');
  H.eq(sub.participantId, 'p-1', 'for this participant');
  H.eq(sub.groupId, 'g-1', 'and the group they were waiting for');
  // ⚠ The flag that decides whether losing the race is visible.
  H.eq(sub.waitlist, false,
    '⚠ waitlist FALSE — with it true the server would quietly re-queue them and ' +
    'the screen would look like the claim had worked');
  H.ok(has(open, 'The place is yours'), 'and the family is told plainly');

  // =========================================================================
  console.log('\n[still full: no button, and the card says what is true]');
  const waiting = await screen({ view: 'activity', lang: 'en', search: '?p=p-1&a=act-2',
                                 activity: activityWith(true, true) });
  H.ok(!labelled(waiting, 'Take the place'),
    'nothing to press — a dead button under "a place has opened" is worse than none');
  H.ok(has(waiting, 'On the waiting list'), 'the lead is the state');
  H.ok(has(waiting, 'You have not been charged'),
    'and the body leads with the cost, because the card is headed "What it costs"');
  // ⚠ THE SENTENCE THAT CONTRADICTED ITSELF. "we have kept your place in the
  // queue" and "no place is being held", two sentences apart.
  H.ok(!/kept your place/i.test(waiting.mount.textContent) &&
       !/no place is being held/i.test(waiting.mount.textContent),
    '⚠ and it no longer says both "we kept your place" and "no place is held"');
  H.ok(!/was full/i.test(waiting.mount.textContent),
    'nor "the activity was full" — past tense about a thing that may now be a GROUP');

  // =========================================================================
  console.log('\n[⚠ the place is the GROUP\'s, never the activity\'s]');
  // Group one full, group two free. The activity has room and this family does
  // not — offering the button here is a button that loses every time.
  const otherOnly = await screen({ view: 'activity', lang: 'en', search: '?p=p-1&a=act-2',
                                   activity: activityWith(true, false) });
  H.ok(!labelled(otherOnly, 'Take the place'),
    '⚠ the OTHER group having room offers nothing — under the equal-hours rule ' +
    'that is a different day, place and teacher, and not this family\'s place');
  H.ok(has(otherOnly, 'On the waiting list'), 'and the card still reads as waiting');

  // A pooled registration with no group falls back to the activity, which is
  // the honest answer when there was never a choice.
  const pooled = await screen({ view: 'activity', lang: 'en', search: '?p=p-1&a=act-2',
    activity: Object.assign(activityWith(true, true), { groups: null, full: false }),
    api: { registration: () => ({ ok: true, balanceCents: 0, perSession: null,
      registration: Object.assign({}, REG, { groupId: null }),
      activity: Object.assign(activityWith(true, true), { groups: null, full: false }) }) } });
  H.ok(labelled(pooled, 'Take the place'),
    'with no group to choose, the activity is the answer');

  // =========================================================================
  console.log('\n[losing the race is said out loud, and the button goes away]');
  sent.length = 0;
  let acts = [activityWith(false, true), activityWith(true, true)];
  let n = 0;
  const raced = await screen({ view: 'activity', lang: 'en', search: '?p=p-1&a=act-2',
    activity: acts[0],
    api: {
      // The second read is after somebody else took it.
      registration: () => ({ ok: true, registration: REG, activity: acts[Math.min(n++, 1)],
                             balanceCents: 0, perSession: null }),
      submit: () => ({ _status: 409, error: 'This activity is full.', full: true })
    } });
  labelled(raced, 'Take the place').click();
  await settle();
  H.ok(has(raced, 'full'), 'the refusal is shown rather than swallowed');
  H.ok(!labelled(raced, 'Take the place'),
    '⚠ and the card is redrawn, so the button that just lost is not left there to press again');

  // =========================================================================
  console.log('\n[the three languages]');
  for (const [l, lead, btn] of [
    ['he', 'התפנה מקום', 'תפוס/י מקום'],
    ['ru', 'Освободилось место', 'Занять место']
  ]) {
    const d = await screen({ view: 'activity', lang: l, search: '?p=p-1&a=act-2',
                             activity: activityWith(false, true) });
    H.ok(has(d, lead), l + ': the lead is in the reader\'s language');
    H.ok(labelled(d, btn), l + ': and so is the button');
  }

  // =========================================================================
  console.log('\n[the email points where the button is]');
  const mail = require(H.fnPath('_registration-email'));
  const src = read('netlify/functions/_registration-email.js');
  const body = src.slice(src.indexOf('function placeOpenMessage'),
                         src.indexOf('\n}', src.indexOf('function placeOpenMessage')));
  H.ok(/registrationHref\(/.test(body),
    '⚠ placeOpenMessage links to the REGISTRATION page, which is what its own ' +
    'comment has claimed all along');
  H.ok(!/activityHref\(/.test(body),
    '⚠ and NOT to the public page, which cannot know who is reading it and ' +
    'resolves through the frozen slug this project calls audit-only');

  const reg = { participantId: 'p-9', activityId: 'act-9', status: 'waitlisted',
                frozen: { activitySlugAtSubmission: 'renamed-long-ago',
                          participantName: 'Noa', activityTitle: { en: 'Test 1' } } };
  for (const [l, tree] of [['he', ''], ['en', '/en'], ['ru', '/ru']]) {
    const m = mail.placeOpenMessage(reg, { email: 'a@b.c', profile: { preferredLanguage: l } }, null);
    const href = /href="([^"]+)"/.exec(m.html);
    H.ok(href, l + ': the message has a button');
    H.ok(href[1].indexOf(tree + '/account/activity') !== -1,
      l + ': pointing at the registration page in the reader\'s own tree (' + href[1] + ')');
    H.ok(href[1].indexOf('p=p-9') !== -1 && href[1].indexOf('a=act-9') !== -1,
      l + ': addressed by ids');
    H.ok(href[1].indexOf('renamed-long-ago') === -1,
      '⚠ ' + l + ': and NEVER by the frozen slug — after a rename that opens the wrong page or none');
  }

  // ⚠ THE INBOX AND THE SCREEN USE THE SAME WORDS. A family reads "Take the
  // place" in an email and has to find it on the page; two tables holding that
  // string is two places it can be reworded, and a browser cannot require a
  // Netlify function. So it is pinned, the way the activities menu's duplicated
  // status labels are.
  const tableSrc = memberAccount.slice(memberAccount.indexOf('var T = {'),
    memberAccount.indexOf('}[lang];', memberAccount.indexOf('var T = {')) + '}[lang];'.length);
  for (const l of ['he', 'en', 'ru']) {
    const ctx = { lang: l };
    vm.runInNewContext(tableSrc + '\nresult = T;', ctx);
    H.eq(ctx.result.takePlace, mail.PLACE_OPEN[l].button,
      '⚠ ' + l + ': the button on the page says exactly what the email\'s button said');
  }

  // =========================================================================
  console.log('\n[end to end: a queue entry becomes a real place that owes money]');
  const blobs = H.makeBlobs();
  const act = F.course({ slug: 'one', activityId: 'act-0000000000claim1' });
  act.groups = [Object.assign({}, act.groups[0], { groupId: 'g-1', capacity: 1 })];
  act.registration = Object.assign({}, act.registration, { autoApprove: true });
  const github = H.makeGithub({
    'activities/one.json': JSON.stringify(act),
    'activities/activities-index.json': JSON.stringify(
      [{ slug: 'one', activityId: act.activityId, status: 'open',
         langs: ['he', 'en', 'ru'], title: act.title }])
  });
  const mods = H.loadWithStubs({ blobs, github,
    modules: ['_registration', '_registration-store', 'account-auth', 'account-family',
              'account-registrations'] });
  const api = mods['account-registrations'];
  const fam = mods['account-family'];
  const Reg = mods['_registration'];
  const store = mods['_registration-store'];

  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async () => ({ data: { id: 'e-1' } }) }
  });

  const person = async (first) => {
    const up = await H.signUp(mods['account-auth'], blobs, { email: first + '@example.com',
      profile: { firstName: first, preferredLanguage: 'en' } });
    const made = await H.call(fam.handler, { action: 'createParticipant', token: up.body.token,
      participant: { firstName: first, lastName: 'Levi', dateOfBirth: '2016-04-02' } });
    return { token: up.body.token, id: made.body.participant.participantId };
  };
  const ann = await person('ann');
  const ben = await person('ben');

  const first = await H.call(api.handler, { action: 'submit', token: ann.token, slug: 'one',
                                            participantId: ann.id, lang: 'en' });
  H.eq(first.status, 200, 'ann takes the only place');

  const queued = await H.call(api.handler, { action: 'submit', token: ben.token, slug: 'one',
                                             participantId: ben.id, waitlist: true, lang: 'en' });
  H.eq(queued.body.registration.status, 'waitlisted', 'ben waits');
  H.eq(queued.body.registration.payment.owedCents, 0, 'owing nothing while he waits');

  // Ann leaves, so the place is free — the derived rule, with nothing swept.
  await H.call(api.handler, { action: 'cancel', token: ann.token,
    participantId: ann.id, activityId: act.activityId, lang: 'en' });

  // And this is the press: the SAME action, from the same door.
  const claimed = await H.call(api.handler, { action: 'submit', token: ben.token, slug: 'one',
                                              participantId: ben.id, lang: 'en' });
  H.eq(claimed.status, 200, 'ben claims it through the ordinary submit');
  H.ok(['approved', 'pending'].indexOf(claimed.body.registration.status) !== -1,
    '⚠ and the queue entry becomes a real place — one record, one key, not a second row');
  H.eq(claimed.body.waiting, false, 'no longer waiting');
  H.ok(claimed.body.registration.payment.owedCents > 0,
    '⚠ and it now OWES, which is what makes the pay button appear (' +
    claimed.body.registration.payment.owedCents + ')');
  // ⚠ HOURS, NOT WEEKS. Unpaid holds are why the queue exists.
  H.eq(claimed.body.registration.expirySource, 'waitlist-claim',
    '⚠ held on the CLAIM window, not the ordinary 45 days — handing the claimer ' +
    'the open-ended hold would rebuild the problem the queue exists to solve');
  H.ok(claimed.body.registration.expiryDays * 24 <= Reg.CLAIM_HOURS + 0.001,
    'which is ' + Reg.CLAIM_HOURS + ' hours');

  const stored = await store.getRegistration(ben.id, act.activityId);
  H.eq(stored.status, claimed.body.registration.status, 'and that is what is stored');

  H.done();
})();
