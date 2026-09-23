// What this defends against:
//
// `registrations` is the first tool in _roles.js whose axes are not {access,
// edit, publish}. Approving a registration is none of those three, so it carries
// {access, approve, cancel} — and CANCEL IS A THIRD AXIS rather than part of
// approve, on purpose:
//
//   approving costs nothing and is undone by rejecting;
//   cancelling moves money — it writes a credit a family can spend — and cannot
//   be undone at all, only compensated.
//
// Two powers that differ that much must not share one flag, and a role granted
// the queue must not thereby be granted the till. The other half is `access`
// itself: opening the queue means reading children's names and dates of birth,
// which is the same line `family` draws, so a Content Editor gets none of it.
//
// And the boundary underneath all of it: the admin and member SESSION STORES are
// separate, keyed `sess-` and `msess-`, so a guardian's token handed to an admin
// function is not found because it is not there. That is an arrangement, not a
// check — a check can be forgotten at one call site out of thirty, and the one
// that forgets is an approval endpoint authenticated by a parent's cookie. Both
// new handlers are cross-fed here, both ways.

const H = require('./_helpers');
const F = require('./_fixtures');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

(async () => {
  const blobs = H.makeBlobs();
  const activity = F.course({ slug: 'term', activityId: 'act-0000000000000t01' });
  const github = H.makeGithub({ 'activities/term.json': JSON.stringify(activity) });

  const mods = H.loadWithStubs({
    blobs, github,
    modules: ['_roles', '_session-store', '_registration-store', 'account-auth',
              'account-family', 'account-registrations', 'admin-registrations',
              'admin-family']
  });
  const roles = mods['_roles'];
  const store = mods['_registration-store'];
  const auth = mods['account-auth'];
  const family = mods['account-family'];
  const regs = mods['account-registrations'];
  const adminRegs = mods['admin-registrations'];
  const adminFamily = mods['admin-family'];

  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async () => ({ data: { id: 'x' } }) }
  });

  console.log('[the tool exists, with three axes, and is granted to one role]');
  H.ok(roles.TOOLS.indexOf('registrations') !== -1, 'registrations is a tool');
  const byId = {};
  roles.builtinRoles().forEach((r) => { byId[r.id] = r.permissions.registrations; });
  H.eq(byId['super-admin'].approve, true, 'a Super Admin may approve');
  H.eq(byId['super-admin'].cancel, true, 'and may cancel');
  H.eq(byId['content-editor'].access, false,
    'a Content Editor may not even open the queue — it is children\'s names and dates of birth');
  H.eq(byId['ru-reviewer'].access, false, 'and neither may a Russian Reviewer');
  // Adding a tool was meant to be "a key, not a redesign". It was.
  H.eq(Object.keys(byId['super-admin']).length, 3, 'exactly three axes, no more');

  // --- set up one real registration -----------------------------------------
  const signed = await H.signUp(auth, blobs, {
action: 'signup', email: 'dana@example.com', password: 'password-123', termsAccepted: true,
    profile: { firstName: 'Dana', preferredLanguage: 'en' }
  });
  const dana = { token: signed.body.token, accountId: signed.body.account.accountId };
  const other = await H.signUp(auth, blobs, {
action: 'signup', email: 'stranger@example.com', password: 'password-123', termsAccepted: true,
    profile: { firstName: 'Stranger', preferredLanguage: 'en' }
  });
  const stranger = { token: other.body.token };

  const made = await H.call(family.handler, {
    action: 'createParticipant', token: dana.token,
    participant: { firstName: 'Noa', dateOfBirth: '2017-04-02' }
  });
  const noa = made.body.participant.participantId;
  const submitted = await H.call(regs.handler, {
    action: 'submit', token: dana.token, slug: 'term', participantId: noa });
  H.eq(submitted.status, 200, 'a registration exists to act on');

  console.log('\n[one family cannot register another family\'s child]');
  const poach = await H.call(regs.handler, {
    action: 'submit', token: stranger.token, slug: 'term', participantId: noa });
  H.eq(poach.status, 404, 'refused');
  H.eq(poach.body.error, 'No such participant.',
    'in the SAME WORDS a missing participant gets — telling the two apart confirms a child exists');

  // --- the axes -------------------------------------------------------------
  const admin = (perm, token) => H.installSession(blobs, H.superAdminSession({
    token: token, email: token + '@ogen.cy', permissions: Object.assign({}, H.superAdminSession().permissions,
      { registrations: perm })
  }));
  const full = await admin({ access: true, approve: true, cancel: true }, 'full');
  const reader = await admin({ access: true, approve: false, cancel: false }, 'reader');
  const approver = await admin({ access: true, approve: true, cancel: false }, 'approver');
  const outsider = await admin({ access: false, approve: false, cancel: false }, 'outsider');

  const adm = (session, body) => H.call(adminRegs.handler, Object.assign({ token: session.token }, body));
  const target = { participantId: noa, activityId: activity.activityId };

  console.log('\n[access opens the queue, and nothing else]');
  H.eq((await adm(outsider, { action: 'queue', slug: 'term' })).status, 403,
    'no access, no queue');
  const queued = await adm(reader, { action: 'queue', slug: 'term' });
  H.eq(queued.status, 200, 'access alone is enough to read it');
  H.eq(queued.body.registrations.length, 1, 'and the request is in it');
  H.eq(queued.body.capacity.taken, 1, 'with the capacity line above it');
  H.eq((await adm(reader, Object.assign({ action: 'approve' }, target))).status, 403,
    'but reading is not deciding');
  H.eq((await adm(reader, Object.assign({ action: 'reject' }, target))).status, 403,
    'in either direction');
  H.eq((await adm(reader, { action: 'sweep' })).status, 403,
    'and a reader may not expire anybody\'s request either');

  console.log('\n[approve and cancel are separate powers]');
  const approved = await adm(approver, Object.assign({ action: 'approve' }, target));
  H.eq(approved.status, 200, 'an approver approves');
  H.eq(approved.body.registration.status, 'approved', 'and the record says so');
  H.eq(approved.body.registration.autoApproved, false, 'decided by a person, not by a machine');
  H.eq(approved.body.registration.decidedBy, 'approver@ogen.cy', 'and by which person');
  // Undoing it costs the same power it took.
  H.eq((await adm(approver, Object.assign({ action: 'reject' }, target))).status, 200,
    'and can undo it by rejecting — which is why the two share one flag');
  H.eq((await adm(approver, Object.assign({ action: 'approve' }, target))).status, 200,
    'and back again — undoing only works if it works BOTH ways');

  H.eq((await adm(approver, Object.assign({ action: 'cancel' }, target))).status, 403,
    'the same admin may NOT cancel — cancelling writes a credit and cannot be undone');
  const cancelled = await adm(full, Object.assign({ action: 'cancel', note: 'eligibility' }, target));
  H.eq(cancelled.status, 200, 'only the cancel axis can');
  H.eq(cancelled.body.registration.cancelSource, 'admin', 'recorded as provenance, not as a sixth status');
  H.ok(cancelled.body.registration.history.some((h) => h.note === 'eligibility'),
    'and the reason lands in the history');

  console.log('\n[what a decision may be taken from]');
  // The one direction that is refused, and the reason is not symmetry: the
  // family withdrew, and reinstating them without their asking is not an
  // admin's to do. They register again, which re-reads the terms and re-freezes
  // them.
  const withdrawn = await store.getRegistration(noa, activity.activityId);
  await store.saveRegistration(Object.assign({}, withdrawn, { status: 'cancelled' }));
  H.eq((await adm(approver, Object.assign({ action: 'approve' }, target))).status, 409,
    'a cancelled registration cannot be approved back into life');
  await store.saveRegistration(Object.assign({}, withdrawn, { status: 'expired' }));
  H.eq((await adm(approver, Object.assign({ action: 'approve' }, target))).status, 200,
    'but an EXPIRED one can — it lapsed because we did not answer, and answering late is the right outcome');

  console.log('\n[a guardian token is not an admin token, on either new handler]');
  H.eq((await H.call(adminRegs.handler, { action: 'queue', slug: 'term', token: dana.token })).status, 401,
    'a guardian session handed to the approval queue is simply not found');
  H.eq((await H.call(regs.handler, { action: 'list', token: full.token })).status, 401,
    'and an admin session is not a guardian');
  // Not "not permitted" — NOT FOUND. The tokens live in different stores, so
  // there is no check to forget.
  H.eq((await H.call(adminRegs.handler, { action: 'queue', slug: 'term', token: 'made-up' })).status, 401,
    'and an invented token is the same answer');

  console.log('\n[deleting a participant takes its registrations with it]');
  H.eq((await store.forParticipant(noa)).length, 1, 'the registration is there');
  const gone = await H.call(adminFamily.handler, {
    action: 'deleteParticipant', token: full.token, participantId: noa, confirmName: 'Noa' });
  H.eq(gone.status, 200, 'the participant is deleted');
  H.eq((await store.forParticipant(noa)).length, 0,
    'and so is the registration — a row in a queue that resolves to nothing still carries a date of birth');

  H.done();
})();
