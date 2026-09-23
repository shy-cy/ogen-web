// What this defends against:
//
// The obvious way to track capacity is a counter: read "3 of 14 taken",
// increment on approval, decrement on cancellation. It is cheaper to read and it
// is wrong here, because Netlify Blobs has no compare-and-swap — every write is
// a blind overwrite. A lost decrement on a counter is INVISIBLE: the number is
// simply wrong from then on, nobody can tell by looking, and "cancelled twice"
// or "cancelled while an approval was in flight" are each a way to corrupt it.
//
// So capacity is COUNTED, never decremented. The count reads the registrations
// and keeps the ones where holdsASpot() is true, which makes rejection, expiry
// and cancellation ONE mechanism rather than three: writing `cancelled` makes
// the next count one lower, and there is no hold to release, no counter to fix,
// and no window in which the number is wrong.
//
// The properties that pays for, each pinned below:
//
//   - a cancelled or rejected registration frees its place immediately;
//   - an EXPIRED HOLD frees its place the instant it lapses, whether or not the
//     nightly sweep has run — the derived rule is authoritative and the job is
//     cosmetic, so a broken schedule costs a stale queue and never a number;
//   - a pending registration with no deadline stamped holds its place rather
//     than being silently released, because an unstamped record is a bug in the
//     writer and reading it as expired would free a place a family is waiting on;
//   - over-capacity is REPORTED rather than pretended impossible, because two
//     submissions arriving together can both pass the check and there is no
//     atomic increment to close that window;
//   - a missing group size is UNCAPPED, not zero. Defaulting a blank to zero
//     would silently refuse every registration for an activity nobody had
//     finished filling in — the same direction every other blank in this
//     codebase resolves in.
//
// Both fixture pairs, because the branch nobody tests is the branch that works
// until the evening somebody uses it.

const H = require('./_helpers');
const F = require('./_fixtures');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

const child = (n) => ({ participantId: 'p-' + n, firstName: 'Child' + n, dateOfBirth: '2017-04-02' });

// Read from the module rather than typed here. A test that copies the default
// into itself passes when the two agree and says nothing about which is right;
// this one asserts the VALUE separately, once, with the reason beside it.
const REG_DEFAULT_DAYS = require(H.fnPath('_activity-registration')).DEFAULT_EXPIRY_DAYS;

(async () => {
  const blobs = H.makeBlobs();
  const pooledCourse = F.course({ facts: Object.assign(F.rawCourse().facts, { groupSize: F.POOLED }) });
  const namedCourse = F.course({
    slug: 'named-course', activityId: 'act-00000000000naaaa',
    facts: Object.assign({}, F.rawCourse().facts, { groupSize: F.NAMED })
  });
  const namedDropin = F.dropin({
    slug: 'named-dropin', activityId: 'act-00000000000ndddd',
    facts: Object.assign({}, F.rawDropin().facts, { groupSize: F.NAMED })
  });

  const github = H.makeGithub({
    'activities/course-fixture.json': JSON.stringify(pooledCourse),
    'activities/dropin-fixture.json': JSON.stringify(F.dropin()),
    'activities/named-course.json': JSON.stringify(namedCourse),
    'activities/named-dropin.json': JSON.stringify(namedDropin)
  });

  const mods = H.loadWithStubs({
    blobs, github,
    modules: ['_registration', '_registration-store', 'account-auth',
              'account-family', 'account-registrations', '_registration-sweep']
  });
  const R = mods['_registration'];
  const store = mods['_registration-store'];
  const auth = mods['account-auth'];
  const family = mods['account-family'];
  const regs = mods['account-registrations'];
  const sweep = mods['_registration-sweep'];

  const sent = [];
  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async (a) => { sent.push(a); return { data: { id: 'id-' + sent.length } }; } }
  });

  const NOW = Date.parse('2026-09-01T10:00:00Z');
  const make = (activity, n, over) =>
    Object.assign(R.newRegistration({
      activity: activity, participant: child(n), accountId: 'a-1',
      groupId: over && over.groupId || null, now: NOW, env: {}
    }), over || {});

  // ---------------------------------------------------------------- the rule
  console.log('[holdsASpot is derived, and it is the only answer capacity uses]');
  const pending = make(pooledCourse, 1);
  H.eq(R.holdsASpot(pending, NOW), true, 'a live pending hold counts');
  H.eq(R.holdsASpot(Object.assign({}, pending, { status: 'approved' }), NOW), true, 'approved counts');
  ['rejected', 'expired', 'cancelled'].forEach((s) => {
    H.eq(R.holdsASpot(Object.assign({}, pending, { status: s }), NOW), false, s + ' does not');
  });

  // The half that needs no infrastructure. The record still SAYS pending — only
  // the clock has moved — and the place is already free.
  // Past the default, whatever the default is — the point of this half is the
  // derived rule, not the number. (It is 45 days now; see DEFAULT_EXPIRY_DAYS
  // for why a family told they are REGISTERED must not be released in a
  // fortnight.)
  const lapsed = NOW + (REG_DEFAULT_DAYS + 1) * 24 * 3600e3;
  H.eq(pending.status, 'pending', 'the stored status is untouched');
  H.eq(R.holdsASpot(pending, lapsed), false,
    'and the place is free the instant it lapses, before any job has run');
  H.eq(R.hasLapsed(pending, lapsed), true, 'which is exactly what the sweep will look for');
  H.eq(R.hasLapsed(pending, NOW), false, 'and not a moment before');
  H.eq(R.holdsASpot({ status: 'pending', expiresAt: null }, lapsed), true,
    'a pending hold with NO deadline stamped keeps its place rather than being silently released');

  console.log('\n[the deadline is stamped at submission, with the number and its source]');
  H.eq(pending.expiryDays, REG_DEFAULT_DAYS,
    'the module\'s own default, not a number copied into a test');
  H.eq(REG_DEFAULT_DAYS, 45,
    'and it is 45 — the family is told they are REGISTERED, so a fortnight contradicts the message');
  H.eq(pending.expirySource, 'default', 'and the record says where that came from');
  const perActivity = R.newRegistration({
    activity: F.course({ registration: Object.assign(F.course().registration, { pendingExpiryDays: 3 }) }),
    participant: child(9), accountId: 'a-1', now: NOW, env: { PENDING_EXPIRY_DAYS: '21' }
  });
  H.eq(perActivity.expiryDays, 3, 'the per-activity value wins over the env');
  H.eq(perActivity.expirySource, 'activity', 'and says so');
  H.eq(R.newRegistration({ activity: F.course(), participant: child(8), accountId: 'a-1', now: NOW,
    env: { PENDING_EXPIRY_DAYS: '21' } }).expirySource, 'env', 'the env is the middle rung');
  // Computing submittedAt + N on read would make every change retroactive:
  // lowering the number would expire a batch of live registrations the moment it
  // deployed, and raising it would revive ones already released.
  H.eq(Date.parse(perActivity.expiresAt) - Date.parse(perActivity.submittedAt), 3 * 24 * 3600e3,
    'the deadline is a stamped instant, not a sum computed later');

  // --------------------------------------------------------------- the count
  console.log('\n[pooled capacity is the product, and the count is the registrations]');
  let pool = [make(pooledCourse, 1), make(pooledCourse, 2), make(pooledCourse, 3)];
  let rep = R.capacityReport(pooledCourse, pool, NOW);
  H.eq(rep.capacity, 14, '2 groups of 7 is fourteen places');
  H.eq(rep.taken, 3, 'three held');
  H.eq(rep.left, 11, 'eleven left');
  H.eq(rep.over, false, 'and not over');

  pool[0] = R.transition(pool[0], { status: 'cancelled', by: 'a-1', source: 'guardian', now: NOW });
  H.eq(R.capacityReport(pooledCourse, pool, NOW).taken, 2,
    'cancelling makes the NEXT COUNT one lower — nothing was decremented');
  pool[1] = R.transition(pool[1], { status: 'rejected', by: 'admin', now: NOW });
  H.eq(R.capacityReport(pooledCourse, pool, NOW).taken, 1,
    'and rejection is the same mechanism, not a second one');
  H.eq(R.capacityReport(pooledCourse, pool, lapsed).taken, 0,
    'and so is expiry, with no write at all');

  console.log('\n[a missing group size is uncapped, never zero]');
  const blank = F.course({ facts: Object.assign({}, F.rawCourse().facts, { groupSize: {} }) });
  const blankRep = R.capacityReport(blank, [make(blank, 1)], NOW);
  H.eq(blankRep.capacity, null, 'no capacity stated');
  H.eq(blankRep.left, null, 'so nothing is "left" to run out');
  H.eq(R.hasRoom(blankRep, null), true, 'and there is room — a blank must never read as a restriction');

  console.log('\n[over capacity is reported plainly, not pretended impossible]');
  const tiny = F.course({ facts: Object.assign({}, F.rawCourse().facts, { groupSize: { groups: 1, maxPerGroup: 2 } }) });
  const three = [make(tiny, 1), make(tiny, 2), make(tiny, 3)];
  const over = R.capacityReport(tiny, three, NOW);
  H.eq(over.taken, 3, 'three registrations');
  H.eq(over.capacity, 2, 'against two places');
  H.eq(over.over, true, 'says "over capacity" rather than clamping to the capacity');
  H.eq(over.left, -1, 'and the shortfall is a real number an admin can act on');

  console.log('\n[named groups bucket the same count, and the pool does not]');
  [['named course', namedCourse], ['named drop-in', namedDropin]].forEach(([label, activity]) => {
    const held = [
      make(activity, 1, { groupId: 'g-beginners' }),
      make(activity, 2, { groupId: 'g-beginners' }),
      make(activity, 3, { groupId: 'g-advanced' })
    ];
    const r = R.capacityReport(activity, held, NOW);
    H.eq(r.capacity, 17, label + ': capacity is the SUM of the named capacities, not a product');
    H.eq(r.named.length, 2, label + ': one row per group');
    H.eq(r.named[0].taken, 2, label + ': beginners has two');
    H.eq(r.named[0].left, 5, label + ': and five left');
    H.eq(r.named[1].taken, 1, label + ': advanced has one');
    // Bucketing is not one extra read: the registrations were already fetched.
    const full = held.concat([4, 5, 6, 7, 8].map((n) => make(activity, n, { groupId: 'g-beginners' })));
    const rf = R.capacityReport(activity, full, NOW);
    H.eq(R.hasRoom(rf, 'g-beginners'), false, label + ': beginners is full');
    H.eq(R.hasRoom(rf, 'g-advanced'), true, label + ': while the activity still has room overall');
    H.eq(rf.left, 9, label + ': which is the whole reason capacity has to be per group');
  });

  console.log('\n[a place taken while the activity was pooled is counted, and belongs to no group]');
  // Real, and the honest reading: the place IS occupied, and nobody knows by
  // which group. Counting it only in the total is what keeps the rows truthful.
  const mixed = R.capacityReport(namedCourse,
    [make(namedCourse, 1, { groupId: 'g-beginners' }), make(namedCourse, 2, { groupId: null })], NOW);
  H.eq(mixed.taken, 2, 'both count towards the activity');
  H.eq(mixed.unassigned, 1, 'and one belongs to no named group');
  H.eq(mixed.named[0].taken + mixed.named[1].taken, 1, 'so the rows do not sum to the total, and should not');

  // ------------------------------------------------------------ end to end
  console.log('\n[through the handler: the last place, and giving it back]');
  const signup = async (email) => {
    const r = await H.signUp(auth, blobs, {
action: 'signup', email: email, password: 'password-123', termsAccepted: true,
      profile: { firstName: email.split('@')[0], preferredLanguage: 'en' }
    });
    return { token: r.body.token, accountId: r.body.account.accountId };
  };
  const dana = await signup('dana@example.com');
  const kids = [];
  for (const name of ['Noa', 'Ari', 'Tal']) {
    const made = await H.call(family.handler, {
      action: 'createParticipant', token: dana.token,
      participant: { firstName: name, dateOfBirth: '2017-04-02' }
    });
    kids.push(made.body.participant.participantId);
  }

  // A one-place activity, so "full" is one registration away.
  github._files.set('activities/one-place.json', JSON.stringify(F.course({
    slug: 'one-place', activityId: 'act-0000000000001111',
    facts: Object.assign({}, F.rawCourse().facts, { groupSize: { groups: 1, maxPerGroup: 1 } })
  })));

  const first = await H.call(regs.handler, {
    action: 'submit', token: dana.token, slug: 'one-place', participantId: kids[0] });
  H.eq(first.status, 200, 'the first request is taken');
  H.eq(first.body.registration.status, 'pending', 'and waits for a person, because autoApprove is off');

  const second = await H.call(regs.handler, {
    action: 'submit', token: dana.token, slug: 'one-place', participantId: kids[1] });
  H.eq(second.status, 409, 'the second is refused');
  H.eq(second.body.full, true, 'because the activity is full — there is no waitlist yet, by design');

  const cancelled = await H.call(regs.handler, {
    action: 'cancel', token: dana.token, participantId: kids[0], activityId: 'act-0000000000001111' });
  H.eq(cancelled.status, 200, 'the family gives the place back');
  H.eq(cancelled.body.registration.status, 'cancelled', 'the record is kept — a cancellation is something that happened');
  H.eq(cancelled.body.registration.cancelSource, 'guardian', 'with WHO as provenance, not as a sixth status');

  const third = await H.call(regs.handler, {
    action: 'submit', token: dana.token, slug: 'one-place', participantId: kids[1] });
  H.eq(third.status, 200,
    'and the very next submission takes it — no hold to release, no counter to fix');

  console.log('\n[a second request carries the first one\'s history]');
  // One record per participant per activity, so a re-request lands in the same
  // blob. An admin looking at it should still be able to see the refusal.
  const again = await H.call(regs.handler, {
    action: 'submit', token: dana.token, slug: 'one-place', participantId: kids[1] });
  H.eq(again.status, 409, 'while it holds a place, a duplicate is refused');
  const store2 = store;
  const held = await store2.getRegistration(kids[1], 'act-0000000000001111');
  const rejected = await store2.saveRegistration(
    R.transition(held, { status: 'rejected', by: 'admin@ogen.cy', now: NOW }));
  const reapply = await H.call(regs.handler, {
    action: 'submit', token: dana.token, slug: 'one-place', participantId: kids[1] });
  H.eq(reapply.status, 200, 'once it holds nothing, the family may ask again');
  H.ok(reapply.body.registration.history.some((h) => h.action === 'rejected'),
    'and the earlier refusal is still in the record');

  console.log('\n[the sweep changes no number, only what the queue says]');
  // Far enough ahead that the records the handler wrote a moment ago — with
  // real timestamps, not the fixture's — have run out.
  const later = Date.now() + 60 * 24 * 3600e3;
  const before = R.capacityReport(pooledCourse, await store.forActivity('act-0000000000001111'), later);
  const ran = await sweep.run(later);
  const after = R.capacityReport(pooledCourse, await store.forActivity('act-0000000000001111'), later);
  H.ok(ran.expired > 0, 'it materialises the lapsed holds');
  H.eq(after.taken, before.taken, 'and the count is identical either side of it');
  const twice = await sweep.run(later);
  H.eq(twice.expired, 0, 'running it again finds nothing — it only ever rewrites what the rule already released');

  H.done();
})();
