// What this defends against:
//
// FOUR THINGS ON THE DROP-IN SCREENS, ALL OF THE SAME SHAPE: a number or a
// sentence that was true, and that said nothing about why it was what it was.
//
//   1. A late booking was quoted at €10.00 on a picker sitting under a price
//      card reading €7, with nothing anywhere saying a different rate had been
//      applied. `priceBasis` has been in that payload since late pricing was
//      built and nothing ever read it. A figure that disagrees with the
//      published price and does not account for itself reads as a mistake — and
//      the family cannot tell which of the two is the error.
//
//   2. The date and the price were printed with NOTHING BETWEEN THEM —
//      "יום חמישי, 24 בספטמבר€10.00" on the live Hebrew page. A cascade
//      collision, and the interesting kind: `.acc-field label` is (0,1,1) and
//      `.acc-date` is (0,1,0), so the rule saying "the label above a field is a
//      block" beat the rule saying "a date row is a flex row". Neither rule is
//      wrong and neither mentions the other.
//
//   3. An activity with Approve automatically ON did not auto-approve, and said
//      only "we will confirm the place". autoApproves() stands aside when a
//      STATED age range is not positively satisfied — deliberate, and not a
//      rejection.
//
//      ⚠ AND THE FIX FOR THAT ONE WAS ON THE WRONG SCREEN. The family's waiting
//      block was given the reason — "the age is outside the range this activity
//      states" — and it was rejected on sight: too blunt, and it reads as a
//      verdict on somebody's child at the moment they have just signed up, over
//      a flag that is ADVISORY and a decision no person has taken yet. The
//      confusion being answered was the ADMIN'S, and the answer belonged on the
//      admin's screen, where it already was.
//
//      So this section pins the BOUNDARY rather than a sentence: the family is
//      told the state and never the reason, the admin is told the reason with
//      the numbers, and neither half can quietly become the other.
//
//   4. The cost card read "Cost per session €7 · Paid €0.00 · Still to pay
//      €0.00" while an unpaid evening sat in the table below it. owedCentsFor()
//      bills the yearly fee and, for a COURSE, the term price, so a drop-in
//      registration owes nothing — correctly. Every figure was true and the card
//      was answering a question this activity does not have, arriving at "you
//      owe nothing" for a family who owed €7.
//
// Reported together as "very very confusing", which is the right description: no
// single number was wrong and the screen as a whole could not be believed.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const F = require('./_fixtures');
const D = require('./_dom');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const css = read('shared.css');

(async () => {
  // The client's own string table, per language, executed rather than parsed.
  const ui = read('js/member-account.js');
  const strings = (lang) => {
    const from = ui.indexOf('var T = {');
    const to = ui.indexOf('}[lang];', from) + '}[lang];'.length;
    const ctx = { lang: lang };
    vm.runInNewContext(ui.slice(from, to) + '\nresult = T;', ctx);
    return ctx.result;
  };

  // =========================================================================
  console.log('[2. the date and the price are not glued together]');
  //
  // ⚠ CHECKED BY SPECIFICITY, not by looking for the fix. "`.acc-field > label`
  // is present" would pass with the broken descendant rule sitting beside it,
  // and would say nothing about the next rule somebody adds. The property is
  // that NOTHING reaches a `label` nested inside `.acc-field` by accident.
  const rules = [];
  css.replace(/\/\*[\s\S]*?\*\//g, '')
     .replace(/([^{}]+)\{([^}]*)\}/g, (_, sel, body) => {
       sel.split(',').forEach((one) => rules.push({ sel: one.trim(), body: body }));
       return '';
     });

  const reaching = rules.filter((r) =>
    /\.acc-field\b/.test(r.sel) && /(^|[\s>+~])label\s*$/.test(r.sel));
  H.ok(reaching.length > 0, 'the field label is styled at all (' + reaching.length + ' rule(s))');
  reaching.forEach((r) => {
    H.ok(/\.acc-field\s*>\s*label\s*$/.test(r.sel),
      '⚠ "' + r.sel + '" reaches ONLY a direct child — a descendant match would ' +
      'also catch every .acc-date row nested inside the field');
  });

  // And the row it was beating is still a flex row with a gap in it, because the
  // fix is only a fix while both halves hold.
  const dateRow = rules.filter((r) => r.sel === '.acc-date')[0];
  H.ok(dateRow, 'the date row has a rule of its own');
  H.ok(/display\s*:\s*flex/.test(dateRow.body), 'it is a flex row');
  H.ok(/gap\s*:\s*\d/.test(dateRow.body), 'with a real gap between the date and the price');
  H.ok(rules.some((r) => r.sel === '.acc-date-when' && /flex\s*:\s*1/.test(r.body)),
    'and the date grows, which is what pushes the price to the far end');

  // =========================================================================
  console.log('\n[1 and 4: the payload, from real records]');

  const blobs = H.makeBlobs();
  // A drop-in at €7 that charges €10 inside 48 hours of a start.
  const base = F.rawDropin();
  const act = F.dropin({
    slug: 'folk', activityId: 'act-0000000000late1',
    facts: Object.assign({}, base.facts, {
      price: { registrationFee: 0, perSessionPrice: 7,
               lateDropIn: { enabled: true, hoursBefore: 48, price: 10 } }
    })
  });
  const github = H.makeGithub({
    'activities/folk.json': JSON.stringify(act),
    'activities/activities-index.json': JSON.stringify(
      [{ slug: 'folk', activityId: act.activityId, status: 'open', langs: ['he', 'en', 'ru'],
         title: act.title }])
  });
  const mods = H.loadWithStubs({ blobs, github,
    modules: ['_registration-store', '_session-attendance', 'account-auth', 'account-family',
              'account-registrations'] });
  const auth = mods['account-auth'];
  const family = mods['account-family'];
  const api = mods['account-registrations'];
  const attendance = mods['_session-attendance'];

  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async () => ({ data: { id: 'e-1' } }) }
  });

  const up = await H.signUp(auth, blobs, { email: 'dana@example.com',
    profile: { firstName: 'Dana', preferredLanguage: 'en' } });
  const token = up.body.token;
  const made = await H.call(family.handler, { action: 'createParticipant', token: token,
    participant: { firstName: 'Noa', lastName: 'Levi', dateOfBirth: '2016-04-02' } });
  const noa = made.body.participant.participantId;
  await H.call(api.handler, { action: 'submit', token: token, slug: 'folk',
                              participantId: noa, lang: 'en' });

  const sessions = async () => (await H.call(api.handler, { action: 'sessions', token: token,
    slug: 'folk', participantId: noa, lang: 'en' })).body.sessions;

  const list = await sessions();
  H.ok(list.length > 0, 'the picker has evenings to offer');
  const dates = {};
  list.forEach((s) => { dates[s.date] = s; });

  // The fixture's first evening is 2026-10-06 and today is well before it, so
  // every date prices as standard. That is the control: the note must NOT appear
  // on an ordinary booking.
  H.ok(list.every((s) => s.priceBasis === 'standard'),
    'booked far ahead, every evening is the standard rate');
  H.ok(list.every((s) => s.priceCents === 700), 'at €7.00');
  H.ok(list.every((s) => s.standardPriceCents === 700),
    '⚠ and each one carries what it USUALLY costs, which is what a late price ' +
    'needs in order to explain itself');

  // Now make one of them late: freezeSession() decides from `bookedAt` against
  // the start time, so the same evening booked inside the window prices at €10.
  const credit = require(H.fnPath('_credit'));
  const soon = credit.resolveLocal('2026-10-06', '19:30', credit.TZ) - 3 * 3600 * 1000;
  const lateFrozen = credit.freezeSession(act, '2026-10-06', null, { bookedAt: soon });
  H.eq(lateFrozen.priceBasis, 'late', 'inside the window the basis is "late"');
  H.eq(lateFrozen.perSessionPrice, 10, 'and the price is the late one');
  H.eq(credit.freezeSession(act, '2026-10-06', null,
    { bookedAt: soon - 10 * 24 * 3600 * 1000 }).priceBasis, 'standard',
    'outside it, standard — the same function the picker and the booking both use');

  // =========================================================================
  console.log('\n[4. a drop-in cost card is about its evenings]');

  const payload = async () => (await H.call(api.handler, { action: 'registration', token: token,
    participantId: noa, activityId: act.activityId, lang: 'en' })).body;

  let d = await payload();
  H.eq(d.registration.owedCents, 0,
    'the REGISTRATION owes nothing, which is correct and is what made the card lie');
  H.eq(d.perSession.totals.booked, 0, 'no evenings booked yet');
  H.eq(d.perSession.totals.outstandingCents, 0, 'so nothing outstanding');

  const first = list[0].date;
  const booked = await H.call(api.handler, { action: 'bookSession', token: token,
    slug: 'folk', participantId: noa, sessionDate: first, lang: 'en' });
  H.eq(booked.status, 200, 'a family books one evening');

  d = await payload();
  H.eq(d.registration.owedCents, 0, 'the registration still owes nothing');
  H.eq(d.perSession.totals.booked, 1, '⚠ but ONE evening is booked');
  H.eq(d.perSession.totals.owedCents, 700, 'and it owes €7.00');
  H.eq(d.perSession.totals.paidCents, 0, 'with nothing paid');
  H.eq(d.perSession.totals.outstandingCents, 700,
    '⚠ so the card has a real figure to show instead of "still to pay €0.00"');

  // Cancelled and no-show evenings are not money still owed on the card's own
  // terms: the card answers "what do I owe for what I hold".
  const att = await attendance.getAttendance(noa, act.activityId, first);
  await attendance.saveAttendance(Object.assign({}, att, { status: 'cancelled' }));
  H.eq((await payload()).perSession.totals.booked, 0,
    'a cancelled evening drops out of the total, like every count here');

  // =========================================================================
  console.log('\n[3. the family is told the state, never the reason]');

  // ⚠ THE ACTIVITY AUTO-APPROVES. That is the whole point of the case: the rule
  // is right, and what a family should be told about it is "nothing".
  const kids = F.dropin({
    slug: 'kids', activityId: 'act-000000000kids01',
    facts: Object.assign({}, F.rawDropin().facts, {
      price: { registrationFee: 0, perSessionPrice: 7 },
      ages: { min: 6, max: 10 }
    }),
    registration: Object.assign({}, F.rawDropin().registration, { autoApprove: true })
  });
  github._files.set('activities/kids.json', JSON.stringify(kids));
  github._files.set('activities/activities-index.json', JSON.stringify([
    { slug: 'folk', activityId: act.activityId, status: 'open', langs: ['he'], title: act.title },
    { slug: 'kids', activityId: kids.activityId, status: 'open', langs: ['he'], title: kids.title }
  ]));
  api._internal._setReader(async (slug) => JSON.parse(github._files.get('activities/' + slug + '.json')));
  H.eq(kids.registration.autoApprove, true, 'the activity is set to approve automatically');

  const grown = await H.call(family.handler, { action: 'createParticipant', token: token,
    participant: { firstName: 'Adi', lastName: 'Levi', dateOfBirth: '1962-04-02' } });
  const adult = grown.body.participant.participantId;
  const sent = await H.call(api.handler, { action: 'bookAndPay', token: token, slug: 'kids',
    participantId: adult, sessionDates: [first], lang: 'en' });
  H.eq(sent.status, 200, 'the registration is taken');
  H.eq(sent.body.awaitingApproval, true, 'and it waits, which is autoApproves() standing aside');
  H.eq(sent.body.pendingReason, undefined,
    '⚠ and the reply carries NO reason — the family is told the state and nothing else');

  const adultRow = (await H.call(api.handler, { action: 'registration', token: token,
    participantId: adult, activityId: kids.activityId, lang: 'en' })).body.registration;
  H.eq(adultRow.status, 'pending', 'the page sees it as waiting');
  H.eq(adultRow.pendingReason, undefined, 'with no reason on the row either');
  H.eq(adultRow.ageFlag, undefined,
    '⚠ and no age flag, so a later screen cannot start rendering one from this payload');
  // The flag IS on the stored record — it always has been — so this is a
  // decision about what the family's screen is handed, not a loss of data.
  const stored = await mods['_registration-store'].getRegistration(adult, kids.activityId);
  H.eq(stored.ageFlag.inRange, false, 'the record still knows perfectly well');
  H.eq(stored.ageFlag.age, 64, 'and how old they are');

  // And the ordinary case still works, so "no reason" is not "no rule".
  const inRange = await H.call(family.handler, { action: 'createParticipant', token: token,
    participant: { firstName: 'Tal', lastName: 'Levi', dateOfBirth: '2018-04-02' } });
  const child = inRange.body.participant.participantId;
  const okRes = await H.call(api.handler, { action: 'bookAndPay', token: token, slug: 'kids',
    participantId: child, sessionDates: [first], lang: 'en' });
  H.ok(!okRes.body.awaitingApproval, 'a child inside the range auto-approves, as it always did');

  console.log('\n[and the ADMIN is told exactly what the family is not]');
  const admin = H.loadWithStubs({ blobs, github, modules: ['admin-registrations'] })['admin-registrations'];
  const session = await H.installSession(blobs, H.superAdminSession());
  const queue = await H.call(admin.handler, { action: 'queue', token: session.token, slug: 'kids' });
  const row = (queue.body.registrations || []).filter((r) => r.participantId === adult)[0];
  H.ok(row, 'the registration is on the queue');
  H.eq(row.ageFlagAtSubmission.age, 64, 'with the age');
  H.eq(row.ageFlagAtSubmission.min, 6, 'and the stated minimum');
  H.eq(row.ageFlagAtSubmission.max, 10, 'and the maximum');
  H.eq(row.ageFlagAtSubmission.inRange, false, 'and the answer, which is why a person is looking');

  // The admin SCREEN renders those numbers — reading them into the payload and
  // never drawing them is the shape of gap this project keeps finding.
  const adminUi = read('js/registrations-admin.js');
  H.ok(/f\.age \+ ' \u00b7 outside ' \+/.test(adminUi),
    'the queue prints "64 · outside 6-10" rather than a flag with no numbers');
  H.ok(/class: 'flag'/.test(adminUi),
    'amber and advisory — a row to look at, never a row that was refused');

  console.log('\n[no family-facing string names a reason, in any language]');
  // ⚠ CHECKED AS A CLASS, not as three strings. The sentences that were removed
  // are gone; what has to stay gone is the KIND of sentence, and the next one
  // added would be added to this same handful of keys.
  const WAITING_KEYS = ['waitLead', 'waitBody', 'awaitingOk'];
  const REASONS = [
    /\bage\b/i, /eligib/i, /outside/i, /range/i, /too (old|young)/i,
    /גיל/, /טווח/, /מתאים/,
    /возраст/i, /диапазон/i, /подход/i
  ];
  ['he', 'en', 'ru'].forEach((l) => {
    const T = strings(l);
    WAITING_KEYS.forEach((k) => {
      H.ok(typeof T[k] === 'string' && T[k].length > 0, l + ': ' + k + ' says something');
      const bad = REASONS.filter((re) => re.test(T[k]));
      H.eq(bad.length, 0,
        l + ': ' + k + ' names no reason — "' + T[k].slice(0, 58) + '…"');
    });
    // It still has to read as an ordinary step rather than as a problem.
    H.ok(/registered|נרשם|בוצעה|записан|оформлена/i.test(T.waitLead + ' ' + T.waitBody),
      l + ': and it leads with what is TRUE — they are registered');
    // ⚠ AND NOT AS A REQUEST. That word is the queue's framing and this table
    // removed it everywhere — except the Russian drop-in confirmation, which
    // still said "Заявка принята", your application has been received. A family
    // signed a child up; being told a decision is pending reads as a decision
    // that might go either way over something they consider settled.
    WAITING_KEYS.forEach((k) => {
      H.ok(!/\brequest\b|בקשה|заявк/i.test(T[k]),
        l + ': ' + k + ' does not call it a request');
    });
  });

  // The helper that rendered the reason is gone rather than left unused: a
  // function nobody calls is indistinguishable from one whose caller was
  // renamed, and this one would be re-wired by the first person who found it.
  H.ok(!/waitWhy|waitAge|pendingReason/.test(ui),
    '⚠ and the renderer is deleted, not orphaned');

  // =========================================================================
  console.log('\n[the screens: executed, not read]');

  // The picker row, drawn by the real code against a real payload.
  function pickerText(session, lang) {
    const dom = D.makeDom({ lang: lang });
    const box = dom.node('div');
    const T = strings(lang);
    const slice = (a, b) => ui.slice(ui.indexOf(a), ui.indexOf(b));
    const ctx = vm.createContext({
      document: dom.document, T: T,
      money: (c) => '€' + (Number(c) / 100).toFixed(2),
      longDate: (d) => d,
      dates: box
    });
    vm.runInContext(
      slice('  function el(tag, attrs, kids) {', '  function clear(') +
      'this.el = el;', ctx);
    // The row, lifted verbatim from load() so the test cannot drift from it.
    const row = slice('          var why = taken ?', '          if (!off) { rows.push(');
    vm.runInContext('var s = ' + JSON.stringify(session) + ', taken = false, off = false, box = null;\n' +
                    row, ctx);
    return box.textContent;
  }

  const late = { date: '2026-10-06', priceCents: 1000, priceBasis: 'late',
                 standardPriceCents: 700, status: null, full: false };
  const std = Object.assign({}, late, { priceCents: 700, priceBasis: 'standard' });

  const en = pickerText(late, 'en');
  H.ok(/€10\.00/.test(en), 'the late price is shown: ' + en);
  H.ok(/late booking/.test(en), '⚠ and says it is a late booking');
  H.ok(/€7\.00/.test(en), 'naming what it usually costs, which is the actual explanation');
  H.ok(!/late booking/.test(pickerText(std, 'en')),
    'and an ordinary evening says nothing — a note on every row is a note nobody reads');

  ['he', 'ru'].forEach((l) => {
    const t = strings(l);
    H.ok(t.lateWhy && t.lateWhy.indexOf('{price}') !== -1,
      l + ' has the note, with the figure interpolated rather than concatenated');
    H.ok(/€7\.00/.test(pickerText(late, l)), l + ' names the usual price too');
  });

  H.done();
})();
