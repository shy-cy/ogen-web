// What this defends against:
//
// ⚠ THE EXACT ADDRESS WAS NEVER REVEALED TO ANYBODY, AND NOTHING SAID SO.
//
// `address` has been members-only from birth, deliberately, so that an activity
// can say where it is without publishing where children will be. The flag is
// enforced by omitting the row from the generated HTML, and the comment beside
// it has always ended "when a members area exists, the private rows are served
// by that authenticated view". That view was never built. So:
//
//   the published page   filtered, correctly
//   the family's own page  filtered too — the SAME builder, the same filter
//   all ten emails       silent; not one of them says where to go
//
// A family registered, paid, and was never told the room. The gap was invisible
// because every piece of it was behaving exactly as written — the same shape as
// the waiting list that had every rule and no control.
//
// Asked for as a Google Maps link "added to the email that will [go] to those
// that register", and "as a link under or next to the precise address once it's
// revealed" — which is the half that could not be built, because nothing
// revealed it.
//
// ⚠ THE PIN LIVES ON THE ADDRESS FACT, and that is the whole privacy design. A
// dropped pin says where a child will be just as plainly as a street name does,
// so it is governed by the same visibility flag rather than by a second rule
// somebody has to remember. Put it on `location` — the public, general one —
// and it would publish the thing the split exists to keep back.
//
// The sister project reached the same split independently and decided it the
// same way: "Private, like the address it belongs to, so it rides beside the
// record rather than on it and never reaches events-index.json."

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');
const F = require('./_fixtures');

process.env.RESEND_FROM = process.env.RESEND_FROM || 'Ogen <noreply@ogen.cy>';

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const FACTS = require(H.fnPath('_activity-facts'));
const { migrate } = require(H.fnPath('_activity-migrate'));
const tpl = require(H.fnPath('_activity-template'));
const mail = require(H.fnPath('_registration-email'));

const STREET = { he: 'רחוב הרצל 5, לימסול', en: '5 Herzl Street, Limassol', ru: 'ул. Герцля 5, Лимассол' };
const PIN = 'https://maps.app.goo.gl/inqPQ1wB5Qas86Cn9';

// --------------------------------------------------------------------------
console.log('[what counts as a map link, and what is refused]');

// Accepted: every shape Google actually hands somebody. maps.app.goo.gl is
// first because it is what the Share button produces on a phone, which is where
// an admin standing in the room will get it — the sister project's own stored
// data is that form.
[PIN, 'https://goo.gl/maps/abc', 'https://www.google.com/maps/place/x',
 'https://google.co.il/maps/@34.6,33.0', 'https://maps.google.com/?q=x'
].forEach((u) => H.eq(FACTS.mapUrlOf({ mapUrl: u }), u, 'accepted: ' + u));

// ⚠ Refused. `javascript:` is the one that matters and http:// is the one that
// would otherwise be plausible. This is NOT claimed as a guarantee the pin is
// correct — ctaUrl proved an allowlist cannot tell a right URL from a wrong
// one, and the second bad value it held was a well-formed https link on this
// very domain. What it buys is narrower: nothing unsafe is storable, and a
// half-pasted string is refused while somebody still has the right one copied.
['javascript:alert(1)', 'http://maps.app.goo.gl/x', 'https://evil.example/maps',
 'https://google.com', 'maps.app.goo.gl/x', 'https://notgoogle.com/maps/x', ' '
].forEach((u) => H.eq(FACTS.mapUrlOf({ mapUrl: u }), '', 'refused: ' + JSON.stringify(u)));

H.eq(FACTS.mapUrlProblem(''), null, 'blank is not a problem — the field is optional');
H.eq(FACTS.mapUrlProblem(PIN), null, 'nor is a real one');
H.ok(/Share/.test(FACTS.mapUrlProblem('https://evil.example/maps') || ''),
  'and the refusal names what to paste instead');

// --------------------------------------------------------------------------
console.log('\n[the pin is stored on the address, and only on the address]');

const withPin = () => migrate({
  slug: 'purim', status: 'open',
  title: { he: 'סדנה', en: 'Workshop', ru: 'Мастерская' },
  facts: {
    location: { text: { he: 'לימסול', en: 'Limassol', ru: 'Лимассол' } },
    address: { text: STREET, mapUrl: PIN }
  },
  teachers: [], sponsors: [], faq: []
});
const act = withPin();
const gid = act.groups[0].groupId;

H.eq(act.groups[0].facts.address.mapUrl, PIN, 'it survives a migration');
H.eq(migrate(JSON.parse(JSON.stringify(act))).groups[0].facts.address.mapUrl, PIN,
  'and a second one, so a save does not lose it');
// ⚠ `location` IS PUBLIC. A pin there would publish where children will be, and
// a pin for "Limassol" answers nothing anybody asked, so the stored shape drops
// it outright rather than keeping a field nothing may render.
const onPublic = migrate({ slug: 'x', facts: { location: { text: { en: 'Limassol' }, mapUrl: PIN } } });
H.eq(onPublic.groups[0].facts.location.mapUrl, undefined,
  '⚠ a pin typed onto the PUBLIC location fact is not stored at all');

// --------------------------------------------------------------------------
console.log('\n[⚠ and it never reaches the published page, in any language]');

// The real assertion is not "is it flagged" but "is the URL in the file".
['he', 'en', 'ru'].forEach((lang) => {
  const html = tpl.renderActivityPage(act, lang);
  H.ok(html.indexOf(PIN) === -1, 'the pin is absent from the ' + lang + ' page');
  H.ok(html.indexOf('maps.app.goo.gl') === -1, 'and so is any fragment of it (' + lang + ')');
  H.ok(html.indexOf(STREET[lang]) === -1, 'along with the address it belongs to (' + lang + ')');
});
// It is the SAME filter, not a second one — which is the point of putting the
// pin on the address rather than beside it.
H.ok(FACTS.sidebarRows(act, 'en').every((r) => r.key !== 'address'),
  'one filter governs both, because they are one fact');

// --------------------------------------------------------------------------
console.log('\n[the authenticated view is a second door onto one builder]');

const memberKeys = FACTS.memberSidebarRows(act, 'en', gid).map((r) => r.key);
H.ok(memberKeys.indexOf('address') !== -1, 'the members view has the address');
H.ok(memberKeys.indexOf('location') !== -1, 'and everything the public one has');
H.ok(FACTS.sidebarRows(act, 'en', gid).indexOf('address') === -1, 'the public one still does not');

// ⚠ TWO EXPORTED NAMES RATHER THAN A FLAG, so the published template cannot
// reach the private rows by forgetting an argument — the same reason
// published() and publishedForDisplay() are two names for one read.
H.ok(!/memberSidebar/.test(read('netlify/functions/_activity-template.js')),
  '⚠ the template that is served to anyone never mentions the members view');
// And one builder underneath, or the two would drift about what a fact is.
const factsSrc = read('netlify/functions/_activity-facts.js');
H.eq((factsSrc.match(/return FACT_GROUPS/g) || []).length, 1,
  'the two views group their rows through one function');

// --------------------------------------------------------------------------
console.log('\n[whereFor: the bags travel, never the picked text]');

const where = FACTS.whereFor(act, gid);
H.eq(where.address.he, STREET.he, 'all three languages travel');
H.eq(where.address.ru, STREET.ru, 'including the one the caller is not in');
H.eq(where.mapUrl, PIN, 'with the pin beside them');
// ⚠ An email is written in the language of the ACCOUNT and a screen in the
// language of the PAGE. A resolver that picked would hand a family whichever
// one the handler happened to be running in — the bug the group-move message
// already had, where an admin's screen language reached a family's inbox.
H.ok(!/lang/.test(FACTS.whereFor.toString()), 'whereFor takes no language at all');
H.eq(FACTS.whereFor(migrate({ slug: 'none' }), undefined), null,
  'an activity with no address says nothing rather than an empty line');
// A bad pin stored on a record reads as no pin, so a broken link can never be
// built from one — better than a confirmation that says the centre cannot find
// its own class.
const bad = migrate({ slug: 'b', facts: { address: { text: STREET, mapUrl: 'https://evil.example/maps' } } });
H.eq(FACTS.whereFor(bad, bad.groups[0].groupId).mapUrl, '', 'a refused pin reads as absent');

// --------------------------------------------------------------------------
console.log('\n[the two messages that mean "you are in" carry it]');

const account = (l) => ({ accountId: 'a-1', email: 'dana@example.com',
                          profile: { firstName: 'Dana', preferredLanguage: l } });
const reg = {
  participantId: 'p-1', activityId: act.activityId, accountId: 'a-1', status: 'approved',
  slug: 'purim', groupId: gid,
  frozen: { participantName: 'Noa Levi', activityTitle: act.title, type: 'course',
            price: { registrationFee: 0, fullPrice: 100, feeCharged: false },
            cancellation: { mode: 'flat', sessionStartsAt: [] } },
  payment: { owedCents: 10000, paidCents: 0, currency: 'EUR' }, history: []
};

['he', 'en', 'ru'].forEach((l) => {
  const got = mail.receivedMessage(reg, account(l), null, where);
  H.ok(got.html.indexOf(STREET[l]) !== -1, 'the confirmation says the address in ' + l);
  H.ok(got.html.indexOf(PIN) !== -1, 'and links the pin in ' + l);
  H.ok(got.html.indexOf(FACTS.mapLabel(l)) !== -1,
    '\u26a0 as a LABELLED link \u2014 a bare goo.gl string in a confirmation reads as '
    + 'something to be suspicious of (' + l + ')');
  const ok = mail.approvedMessage(reg, account(l), null, 0, null, where);
  H.ok(ok.html.indexOf(STREET[l]) !== -1, 'and so does the approval in ' + l);
  H.ok(ok.html.indexOf(PIN) !== -1, 'with the pin (' + l + ')');
});

// \u26a0 THE LANGUAGE IS THE ACCOUNT'S, read out of the bag here. A Hebrew
// account gets the Hebrew address even when the handler that sent it was
// running in English.
H.ok(mail.receivedMessage(reg, account('he'), null, where).html.indexOf(STREET.en) === -1,
  '\u26a0 and one language only \u2014 not every spelling of the street at once');

// \u26a0 NOT ON THE MESSAGES THAT DO NOT MEAN "YOU ARE IN". Telling somebody with
// no place where the place is, in the message taking it away, is the worst
// pairing available; and a receipt, an expiry apology and a waiting-list note
// are each about something other than where to turn up.
[['rejectedMessage', [reg, account('en')]],
 ['expiredMessage', [reg, account('en')]],
 ['waitingMessage', [reg, account('en')]]].forEach(([name, args]) => {
  const out = mail[name].apply(null, args);
  H.ok(out.html.indexOf(STREET.en) === -1, name + ' carries no address');
  H.ok(out.html.indexOf(PIN) === -1, name + ' carries no pin');
});

// A registration whose activity has no address is unchanged: no line, no gap.
['he', 'en', 'ru'].forEach((l) => {
  const bare = mail.receivedMessage(reg, account(l), null, null);
  H.ok(bare.html.length > 200, 'a message with no address still builds (' + l + ')');
  H.ok(bare.html.indexOf('maps') === -1, 'and says nothing about a map (' + l + ')');
});

// \u26a0 AND THE PIN IS RE-CHECKED AT THE POINT IT BECOMES AN HREF, never trusted
// from the record. The stored value can only have been checked when it was
// written; an older record, a hand-edited file and a restored backup are three
// ways for it to stop being true with nothing saved.
const hostile = mail.receivedMessage(reg, account('en'), null,
  { address: STREET, mapUrl: 'javascript:alert(1)' });
H.ok(hostile.html.indexOf('javascript:') === -1,
  '\u26a0 a hostile value handed straight to the builder never becomes an href');
H.ok(hostile.html.indexOf(STREET.en) !== -1, 'while the address itself still shows');
const emailSrc = read('netlify/functions/_registration-email.js');
H.ok(/FACTS\.mapUrlOf\(where\)/.test(emailSrc), 'because the builder asks mapUrlOf itself');

// --------------------------------------------------------------------------
// ⚠ THE GATE, EXECUTED. Everything above proves the two views differ; this
// proves the right reader gets the right one, through the real handler.
(async () => {
  console.log('\n[\u26a0 who is actually shown the address]');
  const blobs = H.makeBlobs();
  const live = F.course({ slug: 'term', activityId: 'act-0000000000000a11' });
  live.groups[0].capacity = 20;
  live.groups[0].facts.address = { text: STREET, mapUrl: PIN };
  const github = H.makeGithub({
    'activities/term.json': JSON.stringify(live),
    'activities/activities-index.json': JSON.stringify(
      [{ slug: 'term', activityId: live.activityId, status: 'open',
         langs: ['he', 'en', 'ru'], title: live.title }])
  });
  const mods = H.loadWithStubs({ blobs, github,
    modules: ['account-auth', 'account-family', 'account-registrations',
              '_registration-store'] });
  const up = await H.signUp(mods['account-auth'], blobs,
    { email: 'dana@example.com', firstName: 'Dana' });
  const token = up.body.token;
  const made = await H.call(mods['account-family'].handler, { action: 'createParticipant',
    token: token, participant: { firstName: 'Noa', lastName: 'Levi', dateOfBirth: '2017-04-02' } });
  const pid = made.body.participant.participantId;
  await H.call(mods['account-registrations'].handler,
    { action: 'submit', token: token, slug: 'term', participantId: pid, lang: 'en' });

  const store = mods['_registration-store'];
  const page = async () => (await H.call(mods['account-registrations'].handler,
    { action: 'registration', token: token, participantId: pid,
      activityId: live.activityId, lang: 'en' })).body;
  const shown = async () => JSON.stringify(((await page()).activity || {}).facts || []);

  {
    const flat = await shown();
    H.ok(flat.indexOf(STREET.en) !== -1, 'a family holding a place is told the address');
    H.ok(flat.indexOf(PIN) !== -1, 'and given the pin');
    H.ok(/"mapLabel":"Get directions"/.test(flat), 'labelled in the language of the page');
    H.ok(flat.indexOf('"key":"address"') !== -1, 'the row itself is in the payload');
  }

  // ⚠ AND EVERY STATE THAT IS NOT A PLACE FALLS BACK, on exactly the schedule
  // holdsASpot() stops counting them. These are not four special cases; they
  // are one derived rule, which is why a fifth status added later inherits it.
  const setTo = async (patch) => {
    const reg2 = await store.getRegistration(pid, live.activityId);
    Object.assign(reg2, patch);
    await store.saveRegistration(reg2);
    return shown();
  };
  const cases = [
    ['cancelled', { status: 'cancelled' }],
    ['rejected', { status: 'rejected' }],
    ['expired', { status: 'expired' }],
    ['waitlisted \u2014 nothing has been given yet', { status: 'waitlisted' }],
    ['a LAPSED pending hold', { status: 'pending', expiresAt: '2020-01-01T00:00:00.000Z' }]
  ];
  for (const [name, patch] of cases) {
    const flat = await setTo(patch);
    H.ok(flat.indexOf(STREET.en) === -1, name + ' is not told the address');
    H.ok(flat.indexOf(PIN) === -1, name + ' is not given the pin');
    // The public rows are untouched — it is one row that is withheld, not the
    // card. Asserted on the KEY rather than on a word, so the fixture's own
    // wording cannot make this pass or fail for the wrong reason.
    H.ok(flat.indexOf('"key":"address"') === -1, name + ': no address row at all');
    H.ok(flat.length > 50, name + ' still gets the rest of the facts');
  }
  // And a live hold gets it back, which is what makes the rule derived rather
  // than a door that closes once.
  const back = await setTo({ status: 'pending', expiresAt: '2099-01-01T00:00:00.000Z' });
  H.ok(back.indexOf(STREET.en) !== -1, 'a live pending hold is told it again');

  H.done();
})();
