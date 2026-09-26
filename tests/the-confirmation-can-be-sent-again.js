// What this defends against:
//
// `_email-log.js` has carried a `resend` flag per template since it was written,
// with the reasoning beside each entry: a family legitimately loses "you have a
// place", where re-delivering a refusal or a cancellation a fortnight later does
// harm. Exactly one message is marked resendable. `isResendable()` reads the
// flag. ⚠ AND IT HAD NO CALLER — the judgement was described, justified, and
// unreachable, which is the same shape as the delivery statuses the webhook
// maintained for releases with no screen reading them.
//
// The mail panel made it worse than absent: its own empty state ended by telling
// an admin to "send it again from the row", pointing at a control that did not
// exist. That is the invite button labelled with a description, one screen over.
//
// Six things have to hold:
//
//   1. ⚠ THE TABLE DECIDES, NOT THE HANDLER. A hardcoded "the approval is
//      resendable" is a second copy of that judgement, free to disagree with the
//      first the day somebody edits it.
//   2. ⚠ IT IS REBUILT, NEVER RE-DELIVERED. The log stores that a message went
//      and what became of it, not the words. So a family whose room has moved
//      gets the new room.
//   3. ⚠ THE GATE IS THE STATUS NOW. "Your place is confirmed" sent to somebody
//      cancelled, rejected, expired or still `pending` is a sentence that is not
//      true — and on the evening register `status` is the BOOKING's, so a screen
//      reading it as the registration's would offer exactly that.
//   4. ⚠ IT IS RECORDED AS A PERSON'S DOING. `sentBy` and `manual` are one fact
//      and are derived from one argument, so they cannot disagree.
//   5. ⚠ NO MESSAGE CARRIES A PAY LINK FOR A DEBT THAT IS NOT THERE. `/pay`
//      refuses at `nothing-due`, so a link minted against a settled registration
//      is a Pay now button leading to a refusal. The receipt already knew this;
//      the approval never did, and resending is what made it bite — the likeliest
//      reason to resend a confirmation is a family who has since paid.
//   6. ⚠ A DROP-IN'S PER-EVENING WINDOW REACHES THE MESSAGE. The admin's approval
//      passed `null` where the family's path passed the real number, and null
//      reads as "you can cancel an evening until it starts" — a false promise of
//      credit on an activity with a 24-hour window.

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const D = require('./_dom');
const F = require('./_fixtures');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const src = read('js/registrations-admin.js');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

(async () => {
  // ------------------------------------------------ the table decides -------
  console.log('[the resendable flag finally has a reader]');

  const log = require(H.fnPath('_email-log'));
  H.eq(log.isResendable('registration-approved'), true,
    'the confirmation is the one message marked resendable');
  ['registration-rejected', 'registration-cancelled', 'registration-expired',
   'session-cancelled'].forEach((t) => {
    H.eq(log.isResendable(t), false, t + ' is not, and the reason is beside it in the table');
  });

  const fnDir = path.join(R, 'netlify/functions');
  const readers = fs.readdirSync(fnDir).filter((f) => /\.js$/.test(f))
    .filter((f) => f !== '_email-log.js')
    .filter((f) => /isResendable\s*\(/.test(strip(read('netlify/functions/' + f))));
  H.eq(readers.join(','), 'admin-registrations.js',
    '⚠ and something asks it now — for releases nothing did: ' + (readers.join(',') || 'nobody'));

  // ------------------------------------------------------------- server -----
  console.log('\n[an approved registration can be confirmed again]');

  const blobs = H.makeBlobs();
  const activity = F.course();
  const AID = activity.activityId;
  // The room, which the message reads LIVE rather than from the frozen block —
  // an address is not an agreement, it is where to turn up on Tuesday.
  activity.groups[0].facts.address = {
    text: { he: 'רחוב הים 1', en: 'Sea Street 1', ru: 'Улица Моря 1' }, mapUrl: '' };
  activity.groups[0].facts.address.visibility = 'members';
  const files = {
    'activities/course.json': JSON.stringify(Object.assign({}, activity, { slug: 'course' })),
    'activities/activities-index.json': JSON.stringify(
      [{ slug: 'course', activityId: AID, status: 'open', langs: ['he'], title: activity.title }])
  };
  const github = H.makeGithub(files);
  const mods = H.loadWithStubs({ blobs, github,
    modules: ['admin-registrations', '_registration-store', '_registration', '_account-store'] });
  const api = mods['admin-registrations'];
  const regStore = mods['_registration-store'];
  const REG = mods['_registration'];
  const accts = mods['_account-store'];

  const sent = [];
  let failNext = false;
  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async (a) => {
      if (failNext) { failNext = false; throw new Error('Resend is down'); }
      sent.push(a); return { data: { id: 'id-' + sent.length } };
    } }
  });

  await H.installSession(blobs, H.superAdminSession());
  const account = await accts.createAccount({ email: 'dana@example.com',
    password: 'longenough1', termsAccepted: true,
    profile: { firstName: 'Dana', preferredLanguage: 'en' } });

  const make = async (pid, status) => {
    const reg = REG.newRegistration({
      activity: activity, accountId: account.accountId, groupId: activity.groups[0].groupId,
      participant: { participantId: pid, firstName: 'Noa', lastName: 'Levi',
                     dateOfBirth: '2016-01-01' }
    });
    reg.status = status;
    await regStore.saveRegistration(reg);
    return reg;
  };
  const approved = await make('p-1', 'approved');
  H.ok(approved.payment.owedCents > 0, 'the term owes something: ' + approved.payment.owedCents);

  const resend = (over) => H.call(api.handler, Object.assign({
    action: 'resendApproval', token: 'test-token',
    participantId: 'p-1', activityId: AID, slug: 'course'
  }, over || {}));

  let res = await resend();
  H.eq(res.status, 200, 'it sends');
  H.eq(res.body.emailed, true, 'and says so');
  H.eq(res.body.to, 'dana@example.com', 'naming the address, which is what an admin reads back');
  let msg = sent[sent.length - 1];
  H.ok(/confirmed/i.test(msg.subject), 'the confirmation went: ' + msg.subject);
  H.ok(msg.html.indexOf('Sea Street 1') !== -1,
    '⚠ carrying the address, read LIVE from the activity rather than from the frozen block');

  console.log('\n[and it is rebuilt, not re-delivered]');
  // The room moves. A copy of what was sent would still say Sea Street.
  const moved = JSON.parse(JSON.stringify(activity));
  moved.groups[0].facts.address.text = { he: 'רחוב ההר 9', en: 'Mountain Road 9', ru: 'Горная 9' };
  github._files.set('activities/course.json',
    JSON.stringify(Object.assign({}, moved, { slug: 'course' })));
  res = await resend();
  H.eq(res.status, 200, 'it sends again');
  msg = sent[sent.length - 1];
  H.ok(msg.html.indexOf('Mountain Road 9') !== -1,
    '⚠ THE NEW ROOM — a resend is the message built again today, not a copy of the old one');
  H.ok(msg.html.indexOf('Sea Street 1') === -1, 'and not the old one');

  console.log('\n[recorded as a person’s doing]');
  const mailRes = await H.call(api.handler, { action: 'mail', token: 'test-token', slug: 'course' });
  H.eq(mailRes.status, 200, 'the mail panel reads');
  const mine = mailRes.body.mail['dana@example.com'];
  H.ok(mine && mine.messages.length >= 2, 'the resends are in the log: ' + mine.messages.length);
  const manual = mine.messages.filter((x) => x.manual);
  H.eq(manual.length, mine.messages.length,
    'every one of these was asked for by a person');
  H.eq(manual[0].sentBy, 'michal@ogen.cy',
    '⚠ and says WHICH person — `sentBy` and `manual` are one fact, from one argument');
  H.eq(manual[0].template, 'registration-approved', 'under the template that was resent');

  console.log('\n[only a confirmed place has a confirmation]');
  for (const st of ['pending', 'cancelled', 'rejected', 'expired', 'waitlisted']) {
    await make('p-2', st);
    const r2 = await resend({ participantId: 'p-2' });
    H.eq(r2.status, 409, '⚠ ' + st + ' is refused: the message would say something untrue');
    H.ok(r2.body.error.indexOf(st) !== -1, 'and the refusal names the status: ' + r2.body.error);
  }
  const before = sent.length;
  await resend({ participantId: 'p-2' });
  H.eq(sent.length, before, 'and none of those sent anything');

  H.eq((await resend({ participantId: 'nobody' })).status, 404,
    'a participant with no registration is a 404');

  const noDecide = H.superAdminSession({ token: 'read-only' });
  noDecide.permissions.registrations = { access: true, approve: false, cancel: true };
  await H.installSession(blobs, noDecide);
  H.eq((await resend({ token: 'read-only' })).status, 403,
    '⚠ a role that may read the queue but not decide on it may not write to families');
  await H.installSession(blobs, H.superAdminSession());

  console.log('\n[the register row carries the REGISTRATION\u2019s status]');
  // ⚠ The client cannot be the only thing checked here: it reads a canned
  // payload, so a server that never sent the field — or sent the booking's
  // status under its name — would look identical from that side.
  const dropReg = F.dropin();
  const rblobs = H.makeBlobs();
  const rmods = H.loadWithStubs({ blobs: rblobs,
    github: H.makeGithub({
      'activities/d2.json': JSON.stringify(Object.assign({}, dropReg, { slug: 'd2' })),
      'activities/activities-index.json': JSON.stringify(
        [{ slug: 'd2', activityId: dropReg.activityId, status: 'open', langs: ['he'],
           title: dropReg.title }]) }),
    modules: ['admin-registrations', '_session-attendance', '_registration-store',
              '_registration', '_account-store'] });
  await H.installSession(rblobs, H.superAdminSession());
  const racct = await rmods['_account-store'].createAccount({ email: 'reg@example.com',
    password: 'longenough1', termsAccepted: true });
  const rdate = dropReg.groups[0].facts.duration.sessionDates[0].date;
  for (const [pid, st] of [['r-1', 'approved'], ['r-2', 'cancelled']]) {
    const rr = rmods['_registration'].newRegistration({
      activity: dropReg, accountId: racct.accountId, groupId: dropReg.groups[0].groupId,
      participant: { participantId: pid, firstName: 'R', lastName: pid, dateOfBirth: '2015-01-01' }
    });
    rr.status = st;
    await rmods['_registration-store'].saveRegistration(rr);
    await rmods['_session-attendance'].saveAttendance(rmods['_session-attendance'].newAttendance({
      activity: dropReg, participantId: pid, accountId: racct.accountId,
      groupId: dropReg.groups[0].groupId, sessionDate: rdate,
      resolveSessionInstant: () => Date.now() + 8.64e7 }));
  }
  res = await H.call(rmods['admin-registrations'].handler,
    { action: 'register', token: 'test-token', slug: 'd2', sessionDate: rdate });
  H.eq(res.status, 200, 'the register opens');
  const byId = {};
  res.body.register.forEach((x) => { byId[x.participantId] = x; });
  H.eq(byId['r-1'].status, 'booked', 'both seats are booked');
  H.eq(byId['r-2'].status, 'booked', 'including the one whose registration is over');
  H.eq(byId['r-1'].regStatus, 'approved', 'and the row carries the registration\u2019s status');
  H.eq(byId['r-2'].regStatus, 'cancelled',
    '⚠ WHICH IS A DIFFERENT ANSWER FROM THE BOOKING\u2019S — the seat is live and the ' +
    'registration is not, and the confirmation is about the registration');

  console.log('\n[a settled registration is not handed a dead pay button]');
  const paidReg = await regStore.getRegistration('p-1', AID);
  paidReg.payment.paidCents = paidReg.payment.owedCents;
  paidReg.payment.status = 'paid';
  await regStore.saveRegistration(paidReg);
  res = await resend();
  H.eq(res.status, 200, 'the confirmation still goes — it is about having a place');
  msg = sent[sent.length - 1];
  H.ok(msg.html.indexOf('/pay?t=') === -1,
    '⚠ AND CARRIES NO PAY LINK. /pay refuses at `nothing-due`, so a link on a ' +
    'settled registration is a button that leads to a refusal');
  H.ok(msg.html.indexOf('Pay now') === -1, 'so the button is not labelled Pay now either');
  H.ok(/registration/i.test(msg.html), 'it points at the registration page instead');

  // And the other direction, or the assertion above passes on a build that never
  // mints a link at all.
  paidReg.payment.paidCents = 0;
  paidReg.payment.status = 'owed';
  await regStore.saveRegistration(paidReg);
  res = await resend();
  msg = sent[sent.length - 1];
  H.ok(msg.html.indexOf('/pay?t=') !== -1,
    'while a registration that DOES owe gets one, or the check above proves nothing');

  console.log('\n[a drop-in’s per-evening window reaches the message]');
  const drop = F.dropin();
  H.eq(drop.registration.sessionCancelHours, 24, 'the fixture drop-in has a 24-hour window');
  const dblobs = H.makeBlobs();
  const dgh = H.makeGithub({
    'activities/drop.json': JSON.stringify(Object.assign({}, drop, { slug: 'drop' })),
    'activities/activities-index.json': JSON.stringify(
      [{ slug: 'drop', activityId: drop.activityId, status: 'open', langs: ['he'],
         title: drop.title }])
  });
  const dmods = H.loadWithStubs({ blobs: dblobs, github: dgh,
    modules: ['admin-registrations', '_registration-store', '_registration', '_account-store'] });
  // A second module set is a second copy of _email, so the transport has to be
  // installed again or the send falls back to the real client and refuses.
  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async (a) => { sent.push(a); return { data: { id: 'id-' + sent.length } }; } }
  });
  await H.installSession(dblobs, H.superAdminSession());
  const dacct = await dmods['_account-store'].createAccount({ email: 'omer@example.com',
    password: 'longenough1', termsAccepted: true,
    profile: { firstName: 'Omer', preferredLanguage: 'en' } });
  const dreg = dmods['_registration'].newRegistration({
    activity: drop, accountId: dacct.accountId, groupId: drop.groups[0].groupId,
    participant: { participantId: 'p-9', firstName: 'Omer', lastName: 'Ziv',
                   dateOfBirth: '2010-01-01' }
  });
  dreg.status = 'pending';
  await dmods['_registration-store'].saveRegistration(dreg);
  const dbefore = sent.length;
  res = await H.call(dmods['admin-registrations'].handler, { action: 'approve',
    token: 'test-token', participantId: 'p-9', activityId: drop.activityId, slug: 'drop' });
  H.eq(res.status, 200, 'the admin approves a drop-in registration');
  const dmsg = sent.slice(dbefore).filter((m) => /confirmed/i.test(m.subject))[0];
  H.ok(dmsg, 'and the confirmation goes');
  H.ok(/24 hours|24 hour/.test(dmsg.text),
    '⚠ NAMING THE 24-HOUR WINDOW. `null` was being passed here and reads as "cancel ' +
    'an evening any time until it starts" — credit this activity would refuse: ' +
    (dmsg.text.match(/[^.]*hour[^.]*\./) || [''])[0].trim());
  H.ok(!/until it starts/i.test(dmsg.text), 'so the until-it-starts sentence is not the one used');

  // ------------------------------------------------------------- client -----
  console.log('\n[the button is in the mail panel, on both rosters]');

  const IDS = ['messages', 'picker', 'queue-panel', 'queue-title', 'capacity', 'dates', 'queue',
               'bundles-panel', 'bundles', 'codes-panel', 'codes', 'account-panel',
               'account-title', 'account-body', 'mail-panel', 'mail-title', 'mail-body',
               'app', 'tool', 'no-access', 'who', 'logout',
               'btn-codes', 'btn-bundles', 'btn-sweep'];

  const MAIL = {
    'dana@example.com': { read: true, total: 1, messages: [
      { template: 'registration-approved', label: 'Registration confirmed', subject: 'Confirmed',
        lang: 'en', status: 'delivered', final: false, sentAt: '2026-09-20T09:00:00Z',
        statusUpdatedAt: '2026-09-20T09:00:00Z', sentBy: 'system', manual: false,
        error: null, thisActivity: true, relatedSlug: 'course' }] },
    'bounced@example.com': { read: true, total: 1, messages: [
      { template: 'registration-approved', label: 'Registration confirmed', subject: 'Confirmed',
        lang: 'en', status: 'bounced', final: true, sentAt: '2026-09-20T09:00:00Z',
        statusUpdatedAt: '2026-09-21T09:00:00Z', sentBy: 'system', manual: false,
        error: 'mailbox not found', thisActivity: true, relatedSlug: 'course' }] },
    'never@example.com': { read: true, total: 0, messages: [] }
  };

  const posted = [];
  function boot(over) {
    over = over || {};
    const dom = D.makeDom({ ids: IDS, lang: 'en' });
    const ACT = { activityId: 'act-1', slug: 'course', title: { en: 'Course' }, type: over.type || 'course' };
    const qrow = (o) => Object.assign({
      participantId: 'q-1', name: 'Noa Levi', accountId: 'a-1',
      accountEmail: 'dana@example.com', status: 'approved', groupId: null, groupName: null,
      ageFlag: null, history: [], feeCharged: true, feeYear: '2026',
      payment: { owedCents: 35000, paidCents: 0, currency: 'EUR', status: 'owed', creditedCents: 0 }
    }, o || {});
    const srow = (o) => Object.assign({
      participantId: 's-1', sessionDate: '2026-10-05', name: 'Seat One', accountId: 'a-1',
      accountEmail: 'dana@example.com', groupId: null, status: 'booked', regStatus: 'approved',
      waitingSince: null, startsAt: Date.now() + 8.64e7, history: [],
      cancelCredit: 0, cancelReason: 'in-time',
      payment: { owedCents: 700, paidCents: 0, currency: 'EUR', status: 'owed', creditedCents: 0 }
    }, o || {});
    const answers = {
      auth: () => ({ ok: true, data: { name: 'Michal', roleName: 'Super Admin',
        canApprove: over.canApprove !== false, canCancel: true } }),
      activities: () => ({ ok: true, data: { activities: [
        { slug: 'course', title: { en: 'Course' }, status: 'open' }] } }),
      queue: () => ({ ok: true, data: { activity: ACT,
        capacity: { capacity: 20, taken: 3, left: 17, over: false, unassigned: 0, named: [] },
        registrations: [
          qrow(),
          qrow({ participantId: 'q-2', name: 'Bounced Bill', accountEmail: 'bounced@example.com' }),
          qrow({ participantId: 'q-3', name: 'Never Ness', accountEmail: 'never@example.com' }),
          qrow({ participantId: 'q-4', name: 'Gone Gil', status: 'cancelled' })
        ], waiting: [] } }),
      register: () => ({ ok: true, data: { activity: ACT,
        dates: [{ sessionDate: '2026-10-05', taken: 2, capacity: 10, left: 8, full: false }],
        sessionDate: '2026-10-05',
        capacity: { sessionDate: '2026-10-05', taken: 2, capacity: 10, left: 8, over: false },
        registered: 2,
        register: [
          srow(),
          // ⚠ The row that matters: the BOOKING is live and the REGISTRATION is
          // not. Reading `status` here would offer to resend a confirmation for
          // a place that has gone.
          srow({ participantId: 's-2', name: 'Seat Two', status: 'booked',
                 regStatus: 'cancelled' })
        ], waiting: [] } }),
      mail: () => ({ ok: true, data: { ok: true, mail: MAIL, perRecipient: 12,
                                       addressesRead: 3, addressesTotal: 3, capped: false } }),
      resendApproval: (b) => { posted.push(b); return { ok: true, data: { ok: true,
        emailed: over.emailed === undefined ? true : over.emailed, to: 'dana@example.com' } }; }
    };
    dom.window.AdminSession = { requireSession: () => true, logout: () => {},
      post: (url, body) => {
        const fn = answers[body.action];
        if (!fn) throw new Error('no canned answer for admin action "' + body.action + '"');
        return Promise.resolve(fn(body));
      } };
    dom.window.AdminUrl = { remember: () => {}, read: () => null };
    dom.window.AdminHelp = { badge: () => dom.node('span'), wire: () => {} };
    const ctx = vm.createContext({
      window: dom.window, document: dom.document, console: console,
      Date: Date, Math: Math, JSON: JSON, Object: Object, Array: Array,
      String: String, Number: Number, RegExp: RegExp, Promise: Promise, setTimeout: setTimeout,
      encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent
    });
    vm.runInContext(src, ctx, { filename: 'js/registrations-admin.js' });
    return dom;
  }
  const settle = () => new Promise((r) => setTimeout(r, 40));
  const tableHeaded = (dom, first) => D.byTag(dom.byId('queue'), 'table')
    .filter((x) => (D.byTag(x, 'th')[0] || {}).textContent === first)[0];
  const rowFor = (dom, name) => D.byTag(tableHeaded(dom, 'Participant'), 'tr')
    .filter((tr) => tr.textContent.indexOf(name) !== -1)[0];
  const buttons = (node) => D.byTag(node, 'button')
    .map((b) => ({ label: b.getAttribute('aria-label') || b.textContent, off: !!b.disabled, el: b }));
  const press = (b) => b.el._handlers.click.forEach((f) => f({}));
  const openMailFor = (dom, name) => press(
    buttons(rowFor(dom, name)).filter((b) => b.label === 'Email history')[0]);
  const RESEND = 'Send the confirmation again';
  const panelButton = (dom) => buttons(dom.byId('mail-body'))
    .filter((b) => b.label === RESEND)[0];

  let dom = boot();
  await settle();
  openMailFor(dom, 'Noa Levi');
  await settle();
  let go = panelButton(dom);
  H.ok(go, '⚠ the queue roster offers it — the panel told an admin to do this and had no control');
  H.eq(go.off, false, 'and it is live on an approved registration');

  openMailFor(dom, 'Gone Gil');
  await settle();
  H.eq(panelButton(dom).off, true,
    '⚠ and DISABLED on a cancelled one: "your place is confirmed" would not be true');

  openMailFor(dom, 'Never Ness');
  await settle();
  H.ok(panelButton(dom), '⚠ and it is there on an address with NOTHING logged, which is ' +
    'the case it exists for');
  H.ok(dom.byId('mail-body').textContent.indexOf('send it again above') !== -1,
    'and the empty state points at it rather than at a control on the row: ' +
    dom.byId('mail-body').textContent.slice(-90));

  openMailFor(dom, 'Bounced Bill');
  await settle();
  H.ok(panelButton(dom), 'a bounced address still offers it');
  H.ok(/very likely do the same/.test(dom.byId('mail-body').textContent),
    '⚠ under a warning that the ADDRESS may be the problem — `suppressed` means the ' +
    'provider will not try again, and what is needed is a new address');

  console.log('\n[and on the evening register, from the REGISTRATION’s status]');
  // A drop-in, so loadQueue() opens the register rather than the queue.
  dom = boot({ type: 'dropin' });
  await settle();
  H.ok(rowFor(dom, 'Seat One'), 'the evening register drew');
  openMailFor(dom, 'Seat One');
  await settle();
  H.eq(panelButton(dom).off, false, 'a booked seat on an approved registration offers it');
  openMailFor(dom, 'Seat Two');
  await settle();
  H.eq(panelButton(dom).off, true,
    '⚠ AND A BOOKED SEAT ON A CANCELLED REGISTRATION DOES NOT. `status` on a register ' +
    'row is the booking’s; the confirmation is about the registration');

  console.log('\n[what it sends, and what it says]');
  dom = boot();
  await settle();
  openMailFor(dom, 'Noa Levi');
  await settle();
  press(panelButton(dom));
  await settle();
  H.eq(posted.length, 1, 'one request');
  H.eq(posted[0].action, 'resendApproval', 'to the action that exists');
  H.eq(posted[0].participantId, 'q-1', 'naming the participant');
  H.eq(posted[0].slug, 'course',
    'and the slug, which is how the server reads the room and the per-evening window');
  H.ok(/sent again to dana@example.com/.test(dom.byId('messages').textContent),
    'and it says where it went: ' + dom.byId('messages').textContent);

  const noSend = boot({ emailed: false });
  await settle();
  openMailFor(noSend, 'Noa Levi');
  await settle();
  press(panelButton(noSend));
  await settle();
  H.ok(/did NOT go/.test(noSend.byId('messages').textContent),
    '⚠ a failed send is said loudly, or an admin believes a family was told: ' +
    noSend.byId('messages').textContent);

  const noApprove = boot({ canApprove: false });
  await settle();
  openMailFor(noApprove, 'Noa Levi');
  await settle();
  H.eq(panelButton(noApprove).off, true,
    'a role without the approve axis sees it greyed — cosmetically, the server re-decides');

  H.done();
})();
