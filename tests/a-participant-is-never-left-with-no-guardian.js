// What this defends against:
//
// A participant record is a child's name and date of birth. There is exactly one
// way for that record to become invisible to the family it is about — for it to
// end up with no guardian linked to it — and this suite is what makes that
// unreachable from every direction.
//
//   - A guardian removing themselves when they are the only one.
//   - An admin unlinking the last guardian.
//   - A participant created and then losing its creator link to a failed write.
//
// It is refused rather than repaired, because the repaired state has no owner to
// notice it is wrong: the record would be reachable only by an admin who happens
// to go looking, and the family would simply never see the child again.
//
// The refusal also DISSOLVES a second problem rather than adding a branch.
// "Reassigning a debt has no target when there is only one guardian" was a real
// edge; with the unlink refused, a permitted unlink implies a remaining guardian
// by definition, so reassign always has somewhere to go.
//
// The rest is the ways a guardian invitation leaks access to a child's record:
//
//   - a FORWARDED link accepted by whoever received it. The token is a bearer
//     secret sitting in an inbox, so acceptance is bound to the address it was
//     sent to, and an admin override exists precisely because that binding
//     sometimes gets in the way of a real guardian.
//   - a link that still works after being re-sent, which would leave two live
//     tokens for one invitation and only one of them known to the sender.
//   - a third guardian slipping in between an invite being sent and accepted.
//   - one family reading another's record by guessing a participant id.

const H = require('./_helpers');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

(async () => {
  const blobs = H.makeBlobs();
  const sent = [];

  const mods = H.loadWithStubs({
    blobs,
    modules: ['account-auth', 'account-family', 'admin-family',
              '_guardian-store', '_participant-store']
  });
  const auth = mods['account-auth'];
  const family = mods['account-family'];
  const adminFamily = mods['admin-family'];
  const guardians = mods['_guardian-store'];
  const parts = mods['_participant-store'];

  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async (args) => { sent.push(args); return { data: { id: 'id-' + sent.length } }; } }
  });

  const signup = async (email, lang) => {
    const r = await H.call(auth.handler, {
      action: 'signup', email: email, password: 'password-123', termsAccepted: true,
      profile: { firstName: email.split('@')[0], preferredLanguage: lang || 'en' }
    });
    return { token: r.body.token, accountId: r.body.account.accountId, email: email };
  };
  const fam = (body) => H.call(family.handler, body);
  const adm = (body) => H.call(adminFamily.handler, body);

  const dana = await signup('dana@example.com');
  const yossi = await signup('yossi@example.com');
  const stranger = await signup('stranger@example.com');

  console.log('[a participant is created with its creator already linked]');
  const made = await fam({
    action: 'createParticipant', token: dana.token,
    participant: { firstName: 'Noa', lastName: 'Levi', dateOfBirth: '2017-04-02' }
  });
  H.eq(made.status, 201, 'the record is created');
  const noa = made.body.participant.participantId;
  H.ok(/^p-[0-9a-f]{16}$/.test(noa), 'the id is p- prefixed');
  H.eq(made.body.participant.primaryAccountId, dana.accountId, 'the creator is the primary guardian');
  H.ok(await guardians.isGuardian(noa, dana.accountId), 'and the link exists immediately');
  // A record with no guardian is invisible to the family it is about, so it must
  // not be creatable even for the instant between two writes.
  H.eq((await guardians.guardiansOf(noa)).length, 1, 'exactly one guardian, from the start');

  console.log('\n[age is derived, never stored]');
  const listed = await fam({ action: 'listParticipants', token: dana.token });
  H.eq(listed.body.participants.length, 1, 'the child is on the list');
  H.ok(typeof listed.body.participants[0].age === 'number', 'with an age');
  const stored = await parts.getParticipant(noa);
  H.ok(!('age' in stored), 'and the stored record holds no age at all, only a date of birth');
  // A written-down age is wrong from the day after it is written, and age now
  // annotates an approval queue, so a stale one mislabels a child for a year.
  H.eq(parts.ageAt('2017-04-02', Date.parse('2026-04-01T12:00:00Z')), 8, 'the day before a birthday');
  H.eq(parts.ageAt('2017-04-02', Date.parse('2026-04-02T12:00:00Z')), 9, 'and the day of it');
  H.eq(parts.ageAt('', Date.now()), null, 'no date of birth is null, not zero');
  H.eq(parts.validDateOfBirth('2030-01-01'), false, 'a date in the future is a typo every time');

  console.log('\n[age is a FLAG, and never a gate]');
  // Any age can be submitted. facts.ages annotates the queue — "outside the
  // stated range 6-10: this child is 12" — and the admin decides.
  const at = Date.parse('2026-10-14T12:00:00Z');
  const child = { dateOfBirth: '2017-04-02' };                       // 9
  H.eq(parts.ageFlag(child, { min: 6, max: 10 }, at).inRange, true, 'in range says so');
  H.eq(parts.ageFlag(child, { min: 10, max: 12 }, at).inRange, false, 'out of range says so');
  H.eq(parts.ageFlag(child, { min: 10, max: 12 }, at).reason, 'below-minimum', 'and which end');
  // Two cases that are the same answer rather than two special cases to branch
  // on: nothing to measure, and nothing to measure against.
  H.eq(parts.ageFlag({}, { min: 6, max: 10 }, at).inRange, null,
    'a missing date of birth is "nothing to say", NOT a blocker');
  H.eq(parts.ageFlag(child, {}, at).inRange, null, 'and neither is an activity with no stated range');

  console.log('\n[one family cannot read another family\'s record]');
  const peek = await fam({ action: 'listGuardians', token: stranger.token, participantId: noa });
  H.eq(peek.status, 404, 'a stranger gets 404');
  const edit = await fam({
    action: 'updateParticipant', token: stranger.token, participantId: noa,
    participant: { firstName: 'Changed' }
  });
  H.eq(edit.status, 404, 'and cannot edit it either');
  // The same words for "no such participant" and "not yours". Telling them apart
  // confirms that an id exists, which is a fact about another family.
  const missing = await fam({ action: 'listGuardians', token: stranger.token, participantId: 'p-0000' });
  H.eq(missing.body.error, peek.body.error, 'and cannot tell "not yours" from "does not exist"');

  console.log('\n[the invite token and the session token are different arguments]');
  // Found while writing this suite, and it is the kind of bug that reads as
  // correct: sessions.authenticate(body) takes body.token, and acceptInvite was
  // ALSO reading body.token — so it compared a session token against the stored
  // invites, found nothing, and answered "that invitation link is not valid" for
  // a link that was perfectly valid. One name meaning two things.
  const invited = await fam({
    action: 'invite', token: dana.token, participantId: noa, email: 'yossi@example.com'
  });
  H.eq(invited.status, 201, 'the primary guardian may invite');
  const inviteToken = invited.body.invite.token;
  H.ok(sent.some((m) => m.to[0] === 'yossi@example.com'), 'and an email goes to that address');
  H.ok(inviteToken !== yossi.token, 'the invite token is not anybody\'s session token');

  console.log('\n[an invitation is bound to the address it was sent to]');
  // THE BINDING. The token is a bearer secret sitting in an inbox, so without
  // this a forwarded link hands a stranger access to a child's record.
  const forwarded = await fam({
    action: 'acceptInvite', token: stranger.token, inviteToken: inviteToken
  });
  H.eq(forwarded.status, 403, 'somebody the invitation was not sent to is refused');
  H.ok(/different email address/i.test(forwarded.body.error), 'and told why, so a real guardian can act on it');
  H.eq((await guardians.guardiansOf(noa)).length, 1, 'and no link was created');

  const accepted = await fam({
    action: 'acceptInvite', token: yossi.token, inviteToken: inviteToken
  });
  H.eq(accepted.status, 200, 'the person it was sent to may accept');
  H.ok(await guardians.isGuardian(noa, yossi.accountId), 'and the link now exists');
  H.eq((await guardians.guardiansOf(noa)).length, 2, 'two guardians');

  const twice = await fam({ action: 'acceptInvite', token: yossi.token, inviteToken: inviteToken });
  H.eq(twice.status, 400, 'an accepted invitation cannot be accepted again');

  console.log('\n[a second guardian may act, but may not bring in a third]');
  const asSecond = await fam({
    action: 'updateParticipant', token: yossi.token, participantId: noa,
    participant: { lastName: 'Levi-Cohen' }
  });
  H.eq(asSecond.status, 200, 'the second guardian may edit the record');
  const thirdParty = await fam({
    action: 'invite', token: yossi.token, participantId: noa, email: 'third@example.com'
  });
  H.eq(thirdParty.status, 403, 'but may not invite anybody');
  H.ok(/created this record/i.test(thirdParty.body.error), 'because inviting is the primary guardian\'s alone');

  const third = await fam({
    action: 'invite', token: dana.token, participantId: noa, email: 'third@example.com'
  });
  H.eq(third.status, 409, 'and not even the primary can, once there are two');

  console.log('\n[re-sending kills the old link]');
  const solo = await fam({
    action: 'createParticipant', token: dana.token,
    participant: { firstName: 'Ari', dateOfBirth: '2019-01-05' }
  });
  const ari = solo.body.participant.participantId;
  const first = await fam({ action: 'invite', token: dana.token, participantId: ari, email: 'yossi@example.com' });
  const firstToken = first.body.invite.token;
  const resent = await fam({
    action: 'resendInvite', token: dana.token, participantId: ari, inviteToken: firstToken
  });
  H.eq(resent.status, 200, 'it can be re-sent');
  H.ok(resent.body.invite.token !== firstToken, 'and mints a NEW token');
  // Re-sending the same link would leave a forwarded copy of the old one
  // working, known to nobody. This is why re-send is not "send it again".
  const stale = await fam({ action: 'acceptInvite', token: yossi.token, inviteToken: firstToken });
  H.eq(stale.status, 400, 'the old link is dead');
  H.ok(/withdrawn|expired|not valid/i.test(stale.body.error), 'and says so');

  console.log('\n[THE REFUSAL: the last guardian cannot be removed, from either side]');
  // A guardian removing themselves.
  const lastOut = await fam({ action: 'leaveParticipant', token: dana.token, participantId: ari });
  H.eq(lastOut.status, 409, 'the only guardian cannot leave');
  H.ok(await guardians.isGuardian(ari, dana.accountId), 'and is still linked');

  // An admin doing it.
  const boss = await H.installSession(blobs, H.superAdminSession());
  const adminOut = await adm({
    action: 'unlinkGuardian', token: boss.token, participantId: ari, accountId: dana.accountId
  });
  H.eq(adminOut.status, 409, 'and neither can an admin');
  H.ok(/only guardian/i.test(adminOut.body.error), 'for the same stated reason');
  H.ok(await guardians.isGuardian(ari, dana.accountId), 'the link survives');

  console.log('\n[primacy moves rather than being lost]');
  // Noa has two guardians, and Dana is primary. Removing Dana must hand primacy
  // to Yossi in the same write — primacy is what authorises inviting, so a
  // participant whose primary is no longer linked could never gain a second
  // guardian again.
  const beforeUnlink = await parts.getParticipant(noa);
  H.eq(beforeUnlink.primaryAccountId, dana.accountId, 'Dana is primary to begin with');
  const unlinked = await adm({
    action: 'unlinkGuardian', token: boss.token, participantId: noa, accountId: dana.accountId
  });
  H.eq(unlinked.status, 200, 'with two guardians the unlink is allowed');
  const afterUnlink = await parts.getParticipant(noa);
  H.eq(afterUnlink.primaryAccountId, yossi.accountId, 'and primacy moved to the remaining guardian');
  H.eq((await guardians.guardiansOf(noa)).length, 1, 'one guardian left');
  // Which means the record is still fully manageable: the new primary can invite.
  const reinvite = await fam({
    action: 'invite', token: yossi.token, participantId: noa, email: 'dana@example.com'
  });
  H.eq(reinvite.status, 201, 'the new primary can invite a replacement');

  console.log('\n[a guardian who leaves voluntarily hands primacy over too]');
  const twoAgain = await fam({
    action: 'acceptInvite', token: dana.token, inviteToken: reinvite.body.invite.token
  });
  H.eq(twoAgain.status, 200, 'Dana is back');
  const left = await fam({ action: 'leaveParticipant', token: yossi.token, participantId: noa });
  H.eq(left.status, 200, 'the primary may leave when somebody else is there');
  H.eq((await parts.getParticipant(noa)).primaryAccountId, dana.accountId, 'and primacy follows');

  console.log('\n[the admin override, which the address binding assumes]');
  // An invitation is bound to its address on purpose, and the cost is real: a
  // guardian whose account is under a different address cannot accept. This is
  // the escape hatch that cost was accepted against, so it has to work.
  const override = await adm({
    action: 'linkGuardian', token: boss.token, participantId: ari, email: 'stranger@example.com'
  });
  H.eq(override.status, 200, 'an admin can link an account directly');
  H.ok(await guardians.isGuardian(ari, stranger.accountId), 'no invitation, no acceptance');
  const links = await guardians.guardiansOf(ari);
  H.eq(links.find((l) => l.accountId === stranger.accountId).addedVia, 'admin',
    'and the record says how they got there, which is what makes it auditable');

  const overThird = await adm({
    action: 'linkGuardian', token: boss.token, participantId: ari, email: 'yossi@example.com'
  });
  H.eq(overThird.status, 409, 'the two-guardian limit binds the admin too');

  console.log('\n[the family tool is its own permission]');
  // An admin who may publish pages is not thereby an admin who may read a
  // child's date of birth.
  const editor = await H.installSession(blobs, H.superAdminSession({
    token: 'editor', email: 'editor@ogen.cy', role: 'content-editor',
    permissions: {
      activities: { access: true, edit: ['he', 'en', 'ru'], publish: true },
      users: { access: false }, roles: { access: false }, family: { access: false }
    }
  }));
  const refused = await adm({ action: 'participant', token: editor.token, participantId: ari });
  H.eq(refused.status, 403, 'a content editor cannot open a family record');
  const roles = require(H.fnPath('_roles'));
  H.ok(roles.TOOLS.indexOf('family') !== -1, 'family is a declared tool');
  H.eq(roles.builtinRoles().find((r) => r.id === 'content-editor').permissions.family.access, false,
    'and the built-in Content Editor does not have it');

  console.log('\n[a guardian token is not an admin token, here either]');
  // The boundary again, on the new pair of endpoints: they authenticate through
  // different stores, which is why they are separate functions.
  H.eq((await adm({ action: 'participant', token: dana.token, participantId: ari })).status, 401,
    'a guardian token gets nowhere on the admin endpoint');
  H.eq((await fam({ action: 'listParticipants', token: boss.token })).status, 401,
    'and an admin token gets nowhere on the guardian one');

  console.log('\n[deleting takes the links with it]');
  const del = await adm({
    action: 'deleteParticipant', token: boss.token, participantId: ari, confirmName: 'wrong'
  });
  H.eq(del.status, 400, 'the name has to be typed back, as for an activity');
  const gone = await adm({
    action: 'deleteParticipant', token: boss.token, participantId: ari, confirmName: 'Ari'
  });
  H.eq(gone.status, 200, 'with the right name it goes');
  H.eq(await parts.getParticipant(ari), null, 'the record is gone');
  H.eq((await guardians.guardiansOf(ari)).length, 0,
    'and so are its links — a link pointing at nothing is a row in a guardian\'s ' +
    'list that resolves to an empty space');

  H.done();
})();
