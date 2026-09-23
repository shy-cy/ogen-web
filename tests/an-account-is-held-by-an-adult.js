// What this defends against:
//
// A FOURTEEN-YEAR-OLD OPENED AN ACCOUNT AND BECAME A GUARDIAN.
//
// Nothing objected, because nothing was being asked. A participant makes no
// claim about age on purpose — _participant-store.js has said since Phase 3 that
// "a guardian must be able to register themselves", which is why there is one
// entity rather than a second one for adults, and why no rule in that file gates
// on age. That is still right: a minor taking part is the ordinary case here.
//
// An ACCOUNT is a different thing. Whoever holds one accepts the terms, holds
// other people's records, invites the second guardian, is billed, and is the
// person we write to about a child's registration. The age is a fact about a
// PARTICIPANT; being a guardian is a fact about an ACCOUNT; and "Add myself" is
// the one place in the whole system where the two meet — `isSelf` on the link is
// the client saying that this participant IS the person holding the account, so
// that participant's date of birth is the only one we ever learn about them.
//
// Four properties, and three of them are the directions it must NOT fire in:
//
//   - a minor added by a parent is created, exactly as before. That is the case
//     the entire product exists for.
//   - a blank date of birth is not refused. A missing date has never been a
//     blocker here — ageAt() returns null and the age flag reads "unknown" — and
//     reading a blank as "under 18" would turn an empty field into a locked
//     account. This is the one rule in the family area where a null resolves
//     towards the GATE rather than towards the family, and it does so by saying
//     nothing rather than by guessing.
//   - the rule is checked BEFORE anything is written, so a refusal leaves no
//     participant and no link behind.
//   - and it survives a second save. Create yourself with the date left blank
//     and fill it in afterwards, and the gate above is one save wide — so
//     updateParticipant asks too, of EVERY link rather than the caller's own,
//     because `isSelf` is a fact about a pair and the second guardian editing
//     this record is editing somebody else's self record.

const H = require('./_helpers');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

// A date of birth N years before today, to the day — so this suite does not
// expire. Counting back by year rather than by 365.25 days for the same reason
// ageAt() counts birthdays.
function aged(years) {
  const t = new Date();
  return [t.getUTCFullYear() - years, String(t.getUTCMonth() + 1).padStart(2, '0'),
          String(t.getUTCDate()).padStart(2, '0')].join('-');
}

(async () => {
  const blobs = H.makeBlobs();
  const mods = H.loadWithStubs({
    blobs, modules: ['account-auth', 'account-family', '_participant-store', '_guardian-store']
  });
  const auth = mods['account-auth'];
  const family = mods['account-family'];
  const parts = mods['_participant-store'];
  const guardians = mods['_guardian-store'];

  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async () => ({ data: { id: 'e-1' } }) }
  });

  const signup = async (email) => {
    const r = await H.call(auth.handler, {
      action: 'signup', email: email, password: 'password-123', termsAccepted: true,
      profile: { firstName: email.split('@')[0], preferredLanguage: 'en' }
    });
    return r.body.token;
  };
  const add = (token, person, isSelf, lang) => H.call(family.handler, Object.assign(
    { action: 'createParticipant', token: token, participant: person },
    isSelf === undefined ? {} : { isSelf: isSelf },
    lang ? { lang: lang } : {}));

  H.eq(parts.MIN_SELF_AGE, 18,
    'the age at which somebody may hold an account is eighteen, which is majority in Cyprus and Israel');

  // -------------------------------------------------------------------------
  console.log('[the report: a fourteen-year-old holding the account]');

  const token = await signup('teen@example.com');
  const young = await add(token, { firstName: 'Yotam', lastName: 'Bar', dateOfBirth: aged(14) }, true);
  H.eq(young.status, 403, 'adding yourself at fourteen is refused');
  H.eq(young.body.code, 'self-too-young', 'and says which rule refused it');
  H.ok(/18/.test(young.body.error), 'and names the age, so the answer is actionable: ' + young.body.error);

  // ⚠ NOTHING WAS WRITTEN. The refusal comes before createParticipant, so there
  // is no record left behind for an admin to find in the Families screen and no
  // link pointing at it — the same ordering the creator-link failure already
  // takes in the other direction, where a participant whose link write fails is
  // deleted rather than kept.
  const after = await H.call(family.handler, { action: 'listParticipants', token: token });
  H.eq(after.body.participants.length, 0, 'and no participant was created on the way to being refused');

  // Just under and just over, to pin that the boundary is the birthday rather
  // than somewhere near it.
  const seventeen = await add(token, { firstName: 'A', lastName: 'B', dateOfBirth: aged(17) }, true);
  H.eq(seventeen.status, 403, 'seventeen is refused');
  const eighteen = await add(token, { firstName: 'Dana', lastName: 'Cohen', dateOfBirth: aged(18) }, true);
  H.eq(eighteen.status, 201, 'and eighteen today is not — the boundary is the birthday');

  // -------------------------------------------------------------------------
  console.log('[the three directions it must not fire in]');

  // A minor added by a parent. This is the product.
  const parent = await signup('parent@example.com');
  const child = await add(parent, { firstName: 'Noa', lastName: 'Levi', dateOfBirth: aged(9) }, false);
  H.eq(child.status, 201, 'a nine-year-old added by a parent is created, exactly as before');

  // ...and with isSelf simply absent, which is what an older client sends.
  const older = await H.call(family.handler, {
    action: 'createParticipant', token: parent,
    participant: { firstName: 'Ari', lastName: 'Levi', dateOfBirth: aged(11) } });
  H.eq(older.status, 201, 'and a client that sends no isSelf at all is not gated either');

  // A blank date of birth. The STORE refuses that on its own — a participant is
  // created with a date or not at all — so the gate never sees one here. What
  // matters is that it is a different refusal: the rule above must not be what
  // turns an empty field into "you are under eighteen", which is how a blank
  // becomes a locked account.
  const blank = await add(parent, { firstName: 'Michal', lastName: 'Levi', dateOfBirth: '' }, true);
  H.ok(blank.status >= 400, 'a participant still cannot be created with no date of birth');
  H.ok(blank.body.code !== 'self-too-young',
    'but it is the date being refused, not the age — got ' + blank.body.code);

  // -------------------------------------------------------------------------
  console.log('[and it survives the second save]');

  // The hole the create-side check alone would leave: add yourself at an age
  // that passes, then correct the date downwards.
  const selfId = eighteen.body.participant.participantId;
  const filled = await H.call(family.handler, {
    action: 'updateParticipant', token: token, participantId: selfId,
    participant: { firstName: 'Dana', lastName: 'Cohen', dateOfBirth: aged(14) } });
  H.eq(filled.status, 403, 'and correcting a self record down to fourteen is refused too');
  H.eq(filled.body.code, 'self-too-young', 'with the same code, from the same rule');

  const grown = await H.call(family.handler, {
    action: 'updateParticipant', token: token, participantId: selfId,
    participant: { firstName: 'Dana', lastName: 'Cohen', dateOfBirth: aged(40) } });
  H.eq(grown.status, 200, 'while an ordinary correction on the same record goes through');

  // ⚠ AND THE SAME EDIT ON A CHILD'S RECORD IS UNTOUCHED. The rule is about
  // whose account it is, never about who is being described — a suite that only
  // checked the refusal would pass against one that refused every date of birth
  // under eighteen anywhere on the site.
  const childEdit = await H.call(family.handler, {
    action: 'updateParticipant', token: parent, participantId: child.body.participant.participantId,
    participant: { firstName: 'Noa', lastName: 'Levi', dateOfBirth: aged(10) } });
  H.eq(childEdit.status, 200, 'and a child\'s date of birth is still freely correctable');

  // -------------------------------------------------------------------------
  console.log('[asked of every link, not the caller\'s own]');

  // ⚠ `isSelf` IS A FACT ABOUT A PAIR. A second guardian on somebody's self
  // record has isSelf false on their OWN link, so a check reading only the
  // caller's link would let them set the account holder's age to fourteen —
  // which is the same account held by the same minor, reached by a different
  // door.
  const friend = await signup('friend@example.com');
  await guardians.addLink({ participantId: selfId, accountId:
    (await H.call(auth.handler, { action: 'me', token: friend })).body.account.accountId,
    addedVia: 'invite', addedBy: 'a', isSelf: false });
  const byOther = await H.call(family.handler, {
    action: 'updateParticipant', token: friend, participantId: selfId,
    participant: { firstName: 'Dana', lastName: 'Cohen', dateOfBirth: aged(14) } });
  H.eq(byOther.status, 403,
    'the second guardian cannot set the account holder\'s age below the limit either');

  // -------------------------------------------------------------------------
  console.log('[and the refusal is in the language it is read in]');

  // It is a family-facing refusal like every other one, so it goes through
  // _family-errors.js rather than being an English sentence in the handler.
  const he = await add(token, { firstName: 'X', lastName: 'Y', dateOfBirth: aged(12) }, true, 'he');
  H.ok(/[֐-׿]/.test(he.body.error), 'Hebrew: ' + he.body.error);
  const ru = await add(token, { firstName: 'X', lastName: 'Y', dateOfBirth: aged(12) }, true, 'ru');
  H.ok(/[Ѐ-ӿ]/.test(ru.body.error), 'Russian: ' + ru.body.error);

  // ⚠ AND IT REFUSES A ROLE, NOT A PERSON. Somebody reading "you are too young"
  // and nothing else concludes they are not welcome at the centre, which is the
  // opposite of true — so the sentence has to carry what to do instead.
  const en = await add(token, { firstName: 'X', lastName: 'Y', dateOfBirth: aged(12) }, true, 'en');
  H.ok(/parent|guardian/i.test(en.body.error),
    'and every one of them says what to do instead rather than turning somebody away');
  H.ok(!/too young|not allowed|cannot/i.test(en.body.error),
    'and none of them reads as "you are too young to come here"');

  H.done();
})();
