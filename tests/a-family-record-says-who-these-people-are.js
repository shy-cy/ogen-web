// What this defends against:
//
// ⚠ THE FAMILIES SCREEN COULD NOT TELL AN ADULT FROM A SEVEN-YEAR-OLD.
//
// It listed the people on an account as a name and a role — "ttt rrr · primary
// guardian" — and nothing else. Reported as "not enough information can be seen.
// Would be good to see also DOB", which is exactly right: an admin opening a
// family record is usually there because somebody rang about a child, and the
// screen could not say which of two names that was.
//
// The rule it was following was written for a DIFFERENT SCREEN and had drifted
// onto this one: "a list of everybody on the site does not need a date of birth,
// so it stays one deliberate click away". That is true of the list of every
// account, which is the picker on the left. It is not true of one account opened
// on purpose, which already shows who is on it, what they are registered to and
// what is owed.
//
// ⚠ AND THE CLICK IT DEFERRED TO DID NOT EXIST. Nothing on that screen opens a
// participant. So the date of birth was not one step away, it was unreachable —
// a rule pointing at a door that was never built, which is the same shape as the
// invite button labelled with a description and the pure bundle module wired to
// nothing.
//
// So the line moved, and it moved ONE WAY. This suite holds both halves: the
// opened account carries dates of birth, and the list of every account still
// does not. The `account` action had never been executed by anything before
// this, which is how a payload nobody had run came to be the one the screen was
// built from.

const H = require('./_helpers');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

(async () => {
  const blobs = H.makeBlobs();
  const github = H.makeGithub({});
  const mods = H.loadWithStubs({
    blobs, github,
    modules: ['_participant-store', 'account-auth', 'account-family', 'admin-family']
  });
  const participants = mods['_participant-store'];
  const auth = mods['account-auth'];
  const family = mods['account-family'];
  const adminFamily = mods['admin-family'];

  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async () => ({ data: { id: 'x' } }) }
  });

  const signed = await H.signUp(auth, blobs, {
    action: 'signup', email: 'dana@example.com', password: 'password-123', termsAccepted: true,
    profile: { firstName: 'Dana', lastName: 'Levi', preferredLanguage: 'en' }
  });
  const dana = { token: signed.body.token, accountId: signed.body.account.accountId };

  // A child and an adult on one account, which is the case the screen could not
  // tell apart: a guardian may register themselves, and the model makes no claim
  // about anybody's age.
  const add = async (first, dob, isSelf) => (await H.call(family.handler, {
    action: 'createParticipant', token: dana.token,
    participant: { firstName: first, lastName: 'Levi', dateOfBirth: dob },
    isSelf: isSelf || undefined
  })).body.participant.participantId;
  const noa = await add('Noa', '2017-04-02');
  const self = await add('Dana', '1988-11-20', true);

  const admin = await H.installSession(blobs, H.superAdminSession({ token: 'full' }));

  // =========================================================================
  console.log('[one account, opened on purpose]');

  const one = await H.call(adminFamily.handler, {
    action: 'account', token: admin.token, accountId: dana.accountId });
  H.eq(one.status, 200, 'the account opens');
  H.eq(one.body.participants.length, 2, 'with both people on it');

  const byName = {};
  one.body.participants.forEach((p) => { byName[p.name] = p; });
  H.eq(byName['Noa Levi'].dateOfBirth, '2017-04-02', '⚠ the child carries a date of birth');
  H.eq(byName['Dana Levi'].dateOfBirth, '1988-11-20', 'and so does the adult');

  // ⚠ DERIVED, NEVER STORED, and derived by counting birthdays rather than
  // dividing by 365.25 — "11 not 12" is exactly the difference an age range
  // turns on, and it is a day out near the end of February either way.
  H.eq(byName['Noa Levi'].age, participants.ageAt('2017-04-02', Date.now()),
    'the age is the store\'s own answer, not a second arithmetic');
  H.eq(byName['Dana Levi'].age, participants.ageAt('1988-11-20', Date.now()),
    'for the adult too');
  H.ok(byName['Dana Levi'].age > byName['Noa Levi'].age,
    'so the screen can finally tell the two apart');

  // Both, not one: the age is what an admin reads for and the date is what they
  // check it against — a birthday next week makes 9 and 10 the same child.
  H.ok('dateOfBirth' in byName['Noa Levi'] && 'age' in byName['Noa Levi'],
    'the payload carries both');

  // =========================================================================
  console.log('\n[⚠ and the list of EVERY account still does not]');
  //
  // This is the half that must not move. The picker is a list of everybody who
  // has signed up, scanned rather than opened, and it needs a name, an address
  // and a count. A date of birth there is a child's data on a screen nobody
  // opened for that child.

  const all = await H.call(adminFamily.handler, { action: 'accounts', token: admin.token });
  H.eq(all.status, 200, 'the list loads');
  H.ok(all.body.accounts.length >= 1, 'and holds the account');
  const asText = JSON.stringify(all.body);
  H.eq(/dateOfBirth/.test(asText), false, 'with no date of birth anywhere in it');
  H.eq(/2017-04-02|1988-11-20/.test(asText), false, 'not even by accident, as a bare value');
  H.eq(/"age"/.test(asText), false, 'and no age either');
  H.eq(all.body.accounts[0].participantCount, 2,
    'a COUNT is what that screen needs, and it is what it gets');

  // =========================================================================
  console.log('\n[and it is Super Admin only, because it names children]');

  const limited = await H.installSession(blobs, H.superAdminSession({
    token: 'limited', email: 'editor@ogen.cy',
    permissions: {
      activities: { access: true, edit: ['he', 'en', 'ru'], publish: true },
      users: { access: false }, roles: { access: false }, family: { access: false },
      registrations: { access: true, approve: true, cancel: true }
    }
  }));
  const refused = await H.call(adminFamily.handler, {
    action: 'account', token: limited.token, accountId: dana.accountId });
  H.eq(refused.status, 403, 'a role without the family tool cannot open one');
  H.eq(/2017-04-02/.test(JSON.stringify(refused.body)), false,
    'and is told nothing about anybody on it');

  H.done();
})();
