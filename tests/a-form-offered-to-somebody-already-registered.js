// What this defends against:
//
// A family already registered for an activity opened
// /account/activity?register=<slug>, and was shown the register form again —
// the participant select listing the child who was already in, a live Register
// button under it, and nothing anywhere saying so. Reported as "I'm already
// registered to this activity. Why is it still open for me to register again?"
//
// ⚠ NOTHING WAS EVER DAMAGED BY PRESSING IT, and that is what kept it hidden.
// openRegistration() opens with
//
//     if (existing && R.holdsASpot(existing)) return { reg: existing, already: true };
//
// so a second submit hands back the registration that already exists rather than
// creating a second one or re-freezing the terms at today's price. The press
// even appeared to work: `submit` returns the record, the client rewrites the
// query to its ?p=&a= key, and the page redraws as the registration the family
// already had. Server right, screen wrong, and the only symptom was a door that
// led nowhere new — the same shape as the invite button labelled with a
// description, and as the waiting list that had every rule and no control.
//
// The panel now says it BEFORE the press, in the two places the family looks:
// on the option, because the option is what they choose with (the same rule the
// group select learned when the room moved onto it), and instead of the button,
// because the useful action is the registration they already have.
//
// ⚠ AND IT IS DERIVED, never the stored status. holdsASpot() is what capacity
// counts, so a lapsed pending hold lets the family register again on exactly the
// schedule it frees the place — and a cancelled or rejected record is not held
// at all, which is what makes registering again after a refusal work.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');
const F = require('./_fixtures');

process.env.RESEND_FROM = process.env.RESEND_FROM || 'Ogen <noreply@ogen.cy>';

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const client = read('js/member-account.js');
const api = read('netlify/functions/account-registrations.js');

(async () => {
  const blobs = H.makeBlobs();
  const activity = F.course({ slug: 'term', activityId: 'act-00000000000000e1' });
  // Room for everybody, so nothing in this suite is measuring fullness.
  activity.groups[0].capacity = 20;
  const github = H.makeGithub({
    'activities/term.json': JSON.stringify(activity),
    'activities/activities-index.json': JSON.stringify(
      [{ slug: 'term', activityId: activity.activityId, status: 'open',
         langs: ['he', 'en', 'ru'], title: activity.title }])
  });
  const mods = H.loadWithStubs({ blobs, github,
    modules: ['account-auth', 'account-family', 'account-registrations',
              '_registration-store'] });
  const auth = mods['account-auth'];
  const family = mods['account-family'];
  const regs = mods['account-registrations'];
  const store = mods['_registration-store'];

  const up = await H.signUp(auth, blobs, { email: 'dana@example.com', firstName: 'Dana' });
  const token = up.body.token;

  const add = async (firstName, dob) => {
    const res = await H.call(family.handler, { action: 'createParticipant', token: token,
      participant: { firstName: firstName, lastName: 'Levi', dateOfBirth: dob } });
    return res.body.participant.participantId;
  };
  const noa = await add('Noa', '2017-04-02');
  const eli = await add('Eli', '2015-03-11');

  const panel = async () => (await H.call(regs.handler,
    { action: 'registerPanel', token: token, slug: 'term', lang: 'en' })).body;

  // --------------------------------------------------------------------------
  console.log('[nobody registered: the panel offers the form to everybody]');
  {
    const p = await panel();
    H.eq(p.ok, true, 'the panel opens');
    H.eq(Object.keys(p.registered || {}).length, 0, 'and reports nobody as already in');
  }

  // --------------------------------------------------------------------------
  console.log('\n[the reported case: registered, and offered the form again]');

  const submit = (participantId) => H.call(regs.handler,
    { action: 'submit', token: token, slug: 'term', participantId: participantId, lang: 'en' });

  {
    const res = await submit(noa);
    H.eq(res.status, 200, 'Noa registers');
    const p = await panel();
    const mine = p.registered[noa] || {};
    H.ok(p.registered[noa], '⚠ and the panel now says so — which it never did');
    H.eq(mine.waiting, false, 'holding a place rather than waiting for one');
    H.ok(['pending', 'approved'].indexOf(mine.status) !== -1,
      'and names what it is: ' + mine.status);
    H.eq(p.registered[eli], undefined,
      '⚠ and says nothing about the sibling, who is the reason the select stays live');
  }

  // ⚠ AND THE FORM COULD ONLY EVER LOSE, which is the sharper version of the
  // complaint and the argument for replacing the button rather than disabling it.
  //
  // The server does not quietly succeed: openRegistration() short-circuits on
  // holdsASpot() and `submit` turns that into a 409. So the panel was drawing a
  // live control whose every press was guaranteed to be refused — word for word
  // the shape the address gate is written against one screen up, where the form
  // is "NOT DRAWN AT ALL rather than drawn and refused, because a filled-in form
  // that always loses is worse than no form".
  //
  // Asserted rather than assumed, because a screen must not be the only thing
  // standing between a family and a second record.
  {
    const before = await store.getRegistration(noa, activity.activityId);
    const res = await submit(noa);
    H.eq(res.status, 409, 'a second submit is refused');
    H.ok(['already-has-a-place', 'already-registered-waiting'].indexOf(res.body.code) !== -1,
      'and says exactly why: ' + res.body.code);
    const after = await store.getRegistration(noa, activity.activityId);
    H.eq(after.submittedAt, before.submittedAt, 'it is the same registration, not a new one');
    H.eq(JSON.stringify(after.frozen), JSON.stringify(before.frozen),
      '⚠ and the frozen terms did NOT move — nothing was re-priced at today\u2019s price');
  }

  // --------------------------------------------------------------------------
  console.log('\n[waiting is a different answer from registered]');
  {
    const res = await H.call(regs.handler, { action: 'submit', token: token, slug: 'term',
      participantId: eli, waitlist: true, lang: 'en' });
    H.eq(res.status, 200, 'Eli joins the queue');
    const reg = await store.getRegistration(eli, activity.activityId);
    // The activity has room, so `submit` gave him a place rather than a queue —
    // which is right, and is not what this section is about. Put him in the
    // queue directly, which is the state a full activity produces.
    reg.status = 'waitlisted';
    await store.saveRegistration(reg);
    const p = await panel();
    H.ok(p.registered[eli], 'somebody waiting is reported too');
    H.eq((p.registered[eli] || {}).waiting, true,
      '⚠ as WAITING, because "you are in" and "you are waiting" are different sentences');
  }

  // --------------------------------------------------------------------------
  console.log('\n[⚠ a record that holds nothing lets the family register again]');

  // Every one of these is the derived rule doing its job. Reading the stored
  // status instead would lock a family out of an activity they were refused
  // from, or whose hold we let lapse — which is the opposite of the bug.
  const setStatus = async (participantId, patch) => {
    const reg = await store.getRegistration(participantId, activity.activityId);
    Object.assign(reg, patch);
    await store.saveRegistration(reg);
    return (await panel()).registered[participantId];
  };

  H.eq(await setStatus(noa, { status: 'cancelled' }), undefined,
    'a family who cancelled may register again');
  H.eq(await setStatus(noa, { status: 'rejected' }), undefined,
    'and so may one we refused — rejected is reversible on both sides');
  H.eq(await setStatus(noa, { status: 'expired' }), undefined,
    'and one whose request we did not answer in time');
  H.eq(await setStatus(noa, { status: 'pending', expiresAt: '2020-01-01T00:00:00.000Z' }),
    undefined,
    '⚠ and a LAPSED pending hold, on exactly the schedule holdsASpot() frees the place');
  H.ok(await setStatus(noa, { status: 'pending', expiresAt: '2099-01-01T00:00:00.000Z' }),
    'while a live one still says so');

  // --------------------------------------------------------------------------
  console.log('\n[the screen says it in both places]');

  H.ok(/registered: heldBy\(people, regs, Date\.now\(\)\)/.test(api),
    'the panel carries it');
  H.ok(/function heldBy\(people, regs, now\)/.test(api), 'built from one helper');
  H.ok(/R\.holdsASpot\(reg, now\)/.test(api) && /R\.isWaiting\(reg\)/.test(api),
    '⚠ from the derived rules, never from the stored status');
  // No extra request: the registrations were already read for the capacity line.
  const panelSrc = api.slice(api.indexOf("case 'registerPanel'"),
                             api.indexOf("case 'registerPanel'") + 2200);
  H.eq((panelSrc.match(/store\.forActivity\(/g) || []).length, 1,
    'and it costs no extra read — the rows were already in hand');

  // On the OPTION, because the option is what a family chooses with. Same rule
  // the group select learned when the places count moved onto it.
  H.ok(/function peopleSelect\(people, held\)/.test(client),
    'the participant select is told who is already in');
  H.ok(/T\.registerHeldWait : T\.registerHeldIn/.test(client),
    'and marks the two states differently');

  // INSTEAD OF the button, not beside it. A disabled Register under a notice is
  // the filled-in form that always loses, which this file rejects one screen up
  // for the address gate.
  H.ok(/go\.setAttribute\('hidden', 'hidden'\)/.test(client), 'the button is taken away');
  H.ok(/heldBox\.removeAttribute\('hidden'\)/.test(client), 'and the block replaces it');
  H.ok(/who\.addEventListener\('change', syncWho\)/.test(client),
    '⚠ and it follows the select, because registered is a property of the CHILD');
  H.ok(/T\.registerHeldGo/.test(client) && /account\/activity/.test(client),
    'with a link to the registration they already have');

  // Three keys, three languages. A key missing from one table renders as
  // `undefined` in a sentence about somebody's child.
  ['registerHeldIn', 'registerHeldWait', 'registerHeldLead', 'registerHeldBody',
   'registerHeldGo'].forEach((k) => {
    H.eq((client.match(new RegExp('\\s' + k + ':', 'g')) || []).length, 3,
      k + ' is in all three language tables');
  });

  H.done();
})();
