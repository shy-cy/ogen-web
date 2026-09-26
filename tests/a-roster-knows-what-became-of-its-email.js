// What this defends against:
//
// Asked for as the highest priority of its group: "email delivery status visible
// on both rosters (course and drop-in) — since it's currently the only way to
// distinguish 'never sent,' 'bounced,' or 'delivered but ignored' when a family
// says they never received something."
//
// ⚠ ALL OF IT WAS ALREADY BEING RECORDED AND NONE OF IT HAD EVER BEEN READ.
// _email-log.js opens by saying exactly why it exists — Shirat HaYam's note that
// when somebody was approved and never paid there was no way to tell whether
// they had ignored the email or never received it, "AND THOSE NEED OPPOSITE
// RESPONSES". Every send has been logged since, resend-webhook.js has been
// laddering the statuses up ever since, and no screen anywhere displayed one.
// The webhook was maintaining a field with no reader.
//
// ⚠ AND THE FIELD THE DISPLAY WAS DESIGNED AROUND WAS EMPTY ON EVERY RECORD.
// `relatedSlug` carried a comment saying it "will let an admin see one activity's
// mail on that activity's own row rather than reading a whole history to find
// it", and not one sender ever passed it. The same shape as the pure bundle
// module wired to nothing and the invite button labelled with a description: the
// mechanism is right, is tested, and cannot be reached.
//
// Five things have to hold:
//
//   1. Every template a sender can emit has a LINE IN THE TABLE. It did not:
//      'registration-terms-changed' was missing, so templateLabel() fell through
//      and an admin met a raw key. A list that is correct today and silently
//      wrong tomorrow is the shape this codebase keeps meeting.
//   2. A send RECORDS WHICH ACTIVITY it was about, and by ID. The slug beside it
//      is the spelling at the time, exactly as the frozen slug on a registration
//      is — following one after a rename finds the wrong activity or none.
//   3. "We could not read the log" is NOT "nothing was sent". That is the one
//      wrong turn available here: it sends an admin to apologise for a message
//      that went out perfectly.
//   4. The addresses come from the ACTIVITY, never from the request body.
//   5. The row says the state and the panel says the history, and a bounce is
//      loud — it is the one status that has to be acted on.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const D = require('./_dom');
const F = require('./_fixtures');
const LOG = require('../netlify/functions/_email-log');

// _email.js refuses to send with a default sender, which is right and means a
// suite that wants to execute a send has to say who it is from.
process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const src = read('js/registrations-admin.js');

// ---------------------------------------------------------------------------
console.log('[1. every template a sender can emit has a line in the table]');

// ⚠ READ OFF THE SOURCE, so a message added next year is covered without anybody
// editing this file. Comment-stripped first: a sentence naming a template is not
// a sender emitting one, and the whole point of the check is to tell those apart
// — the same lesson `.activity-card-image img` taught in the stylesheet.
const bare = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const emitted = new Set();
['netlify/functions/_account-email.js', 'netlify/functions/_registration-email.js',
 'netlify/functions/_email.js'].forEach((p) => {
  const s = bare(p);
  let m;
  const re = /template:\s*'([a-z0-9-]+)'|\bas\(\s*'([a-z0-9-]+)'/g;
  while ((m = re.exec(s))) emitted.add(m[1] || m[2]);
});
H.ok(emitted.size >= 10, 'found the senders: ' + emitted.size + ' templates');
H.ok(emitted.has('registration-terms-changed'),
  '⚠ including the one that had no line — the reason this check exists');
const missing = Array.from(emitted).filter((t) => !LOG.TEMPLATES[t]);
H.eq(missing.join(','), '',
  '⚠ and every one of them has a label, or templateLabel() prints the raw key at an admin');
H.eq(LOG.templateLabel('registration-terms-changed'), 'Cancellation dates changed',
  'in words rather than as a key');
H.ok(!LOG.isResendable('registration-terms-changed'),
  'and not resendable: a second copy reads as the dates having moved again');

// ---------------------------------------------------------------------------
console.log('\n[2. a send records WHICH ACTIVITY, and it is the id that resolves]');

const rec = LOG.normalizeRecord({ recipient: 'A@Example.COM ', template: 'registration-approved',
                                  relatedActivityId: 'act-1', relatedSlug: 'hebrew' });
H.eq(rec.relatedActivityId, 'act-1', 'the id is kept');
H.eq(rec.relatedSlug, 'hebrew', 'and the slug beside it, as a label');
H.eq(rec.recipient, 'a@example.com', 'the recipient is normalised, or a prefix scan misses it');
H.eq(LOG.normalizeRecord({ recipient: 'a@b.c', template: 'verify-email' }).relatedActivityId, null,
  'an account message is about no activity at all, and says so');

(async () => {
  // ⚠ THE HARNESS COMES FIRST — requiring a module that reaches a store before
  // the stubs are installed binds the real Blobs.
  const blobs = H.makeBlobs();
  const activity = F.course();
  const AID = activity.activityId;
  const mods = H.loadWithStubs({ blobs,
    github: H.makeGithub({ 'activities/hebrew.json': JSON.stringify(activity) }),
    modules: ['_registration', '_registration-email', '_email-log'] });
  const REG = mods['_registration'];
  const mail = mods['_registration-email'];
  const log = mods['_email-log'];

  const sent = [];
  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async (m) => { sent.push(m); return { data: { id: 'rid-' + sent.length } }; } }
  });

  const reg = REG.newRegistration({
    activity: activity, accountId: 'a-1', groupId: null, now: Date.parse('2026-09-01T10:00:00Z'),
    participant: { participantId: 'p-1', firstName: 'Noa', lastName: 'Levi',
                   dateOfBirth: '2017-05-04' }
  });
  const account = { accountId: 'a-1', email: 'noa@example.com',
                    profile: { preferredLanguage: 'en' } };

  // Executed, not read. The senders are the thing that was leaving the field out,
  // and reading `as()` would only prove `as()` is self-consistent.
  await mail.sendReceived(reg, account, null, null);
  await mail.sendApproved(reg, account, null, null);

  const mine = await log.listForRecipient('noa@example.com');
  H.eq(mine.length, 2, 'both sends are in the log');
  H.eq(mine.filter((e) => e.relatedActivityId === AID).length, 2,
    '⚠ and BOTH carry the activity id — the field that was null on every record ever written');
  H.ok(mine.every((e) => e.relatedSlug === reg.frozen.activitySlugAtSubmission),
    'with the slug beside it as the label it is');

  // ---------------------------------------------------------------------------
  console.log('\n[3. "we could not read it" is not "nothing was sent"]');

  const many = await log.listForRecipients(['noa@example.com', 'NOBODY@example.com', '']);
  H.eq(many['noa@example.com'].total, 2, 'a recipient with mail reports its count');
  H.ok(many['noa@example.com'].read, 'and says it was read');
  H.eq(many['nobody@example.com'].total, 0, 'one with none reports nought');
  H.ok(many['nobody@example.com'].read,
    '⚠ and still says READ — nothing sent is a fact, not a failure to look');
  H.eq(Object.keys(many).length, 2, 'a blank address asks for nothing');

  // Newest first, which is the order a person reads a history in.
  H.ok(many['noa@example.com'].entries[0].sentAt >= many['noa@example.com'].entries[1].sentAt,
    'newest first');

  // The cap is a bound on the read, and the TOTAL is reported past it, so a
  // screen can say "the newest 2 of 9" rather than showing nine as the lot.
  const store = await blobs.optionalStore('email-log');
  for (let i = 0; i < 9; i++) {
    await store.setJSON(log.keyFor('bulk@example.com', '2026-09-0' + (i + 1) + 'T00:00:00.000Z', 'x' + i),
      LOG.normalizeRecord({ id: log.keyFor('bulk@example.com', '2026-09-0' + (i + 1) + 'T00:00:00.000Z', 'x' + i),
                            recipient: 'bulk@example.com', template: 'registration-paid',
                            sentAt: '2026-09-0' + (i + 1) + 'T00:00:00.000Z' }));
  }
  const capped = await log.listForRecipients(['bulk@example.com'], { perRecipient: 3 });
  H.eq(capped['bulk@example.com'].entries.length, 3, 'the read is bounded');
  H.eq(capped['bulk@example.com'].total, 9, '⚠ and the total is reported, so nothing is hidden');
  H.eq(capped['bulk@example.com'].entries[0].sentAt.slice(0, 10), '2026-09-09',
    'and it is the NEWEST three, sliced off the keys before anything is read');

  // ⚠ THE ONE THAT MATTERS. A store that will not answer must not look like an
  // address nobody wrote to.
  const dead = H.loadWithStubs({
    blobs: Object.assign({}, blobs, { optionalStore: async () => null }),
    modules: ['_email-log'] })['_email-log'];
  const nothing = await dead.listForRecipients(['noa@example.com']);
  H.ok(!nothing['noa@example.com'].read,
    '⚠ an unreachable log reads as UNKNOWN, never as "never emailed"');
  H.eq(nothing['noa@example.com'].total, 0, 'with no count to report');

  // ---------------------------------------------------------------------------
  console.log('\n[4. the addresses come from the activity, never from the request]');

  const blobs2 = H.makeBlobs();
  const github2 = H.makeGithub({
    'activities/hebrew.json': JSON.stringify(activity),
    'activities/activities-index.json': JSON.stringify(
      [{ slug: 'hebrew', activityId: AID, status: 'open', langs: ['he'], title: activity.title }])
  });
  const m2 = H.loadWithStubs({ blobs: blobs2, github: github2,
    modules: ['admin-registrations', '_registration-store', '_account-store', '_email-log'] });
  const api = m2['admin-registrations'];
  const regStore = m2['_registration-store'];
  const accts = m2['_account-store'];
  const log2 = m2['_email-log'];
  await H.installSession(blobs2, H.superAdminSession());

  const onRoster = await accts.createAccount({ email: 'onroster@example.com',
    password: 'longenough1', termsAccepted: true });
  await regStore.saveRegistration(Object.assign({}, reg, { accountId: onRoster.accountId }));

  // Mail to somebody who is NOT on this roster. If the body could name addresses,
  // this is the one it would name.
  await log2.record({ recipient: 'stranger@example.com', template: 'verify-email' });
  await log2.record({ recipient: 'onroster@example.com', template: 'registration-approved',
                      relatedActivityId: AID, relatedSlug: 'hebrew-OLD-NAME', status: 'bounced' });
  await log2.record({ recipient: 'onroster@example.com', template: 'verify-email',
                      status: 'opened' });
  await log2.record({ recipient: 'onroster@example.com', template: 'registration-paid',
                      relatedActivityId: 'act-somewhere-else', relatedSlug: 'other' });

  const res = await H.call(api.handler, { action: 'mail', slug: 'hebrew',
                                          token: 'test-token',
                                          emails: ['stranger@example.com'] });
  H.eq(res.status, 200, 'the roster asks for its own mail');
  H.eq(Object.keys(res.body.mail).join(','), 'onroster@example.com',
    '⚠ and gets the addresses ON IT — the one named in the body is not read');
  const box = res.body.mail['onroster@example.com'];
  H.eq(box.total, 3, 'every message to that address, not only this activity\'s');
  H.eq(box.messages.filter((x) => x.final).length, 1, 'the bounce is marked final');
  H.eq(box.messages.filter((x) => x.thisActivity).length, 1,
    '⚠ one message is about this activity, matched by ID — its slug says "hebrew-OLD-NAME", ' +
    'which is what a rename leaves behind');
  H.eq(box.messages.filter((x) => x.thisActivity)[0].label, 'Registration confirmed',
    'labelled from the one table that owns the words');
  H.eq(box.messages.filter((x) => !x.thisActivity && x.relatedSlug).length, 1,
    'and another activity\'s message is present and marked as not this one');
  H.eq(res.body.addressesTotal, 1, 'the count of addresses is reported');
  H.ok(!res.body.capped, 'and whether the read was cut short');

  // ⚠ A BOUNCE IS A FACT ABOUT AN ADDRESS. The verify-email above is about no
  // activity at all, and it is exactly the message a family rings about — so
  // filtering this panel by activity would have hidden it.
  H.eq(box.messages.filter((x) => x.template === 'verify-email').length, 1,
    'the account message is in the list, because it is what somebody rings about');

  // ---------------------------------------------------------------------------
  console.log('\n[5. the row says the state, the panel says the history]');

  const IDS = ['messages', 'picker', 'queue-panel', 'queue-title', 'capacity', 'dates', 'queue',
               'bundles-panel', 'bundles', 'codes-panel', 'codes', 'account-panel',
               'account-title', 'account-body', 'mail-panel', 'mail-title', 'mail-body',
               'app', 'tool', 'no-access', 'who', 'logout',
               'btn-codes', 'btn-bundles', 'btn-sweep'];

  const row = (over) => Object.assign({
    participantId: 'p-1', activityId: 'act-1', name: 'Noa Levi', accountId: 'a-1',
    accountEmail: 'noa@example.com', stillExists: true, status: 'approved',
    groupId: null, groupName: null, submittedAt: '2026-09-01T00:00:00Z',
    ageFlagAtSubmission: { age: 9, inRange: true, min: 6, max: 12 },
    payment: { owedCents: 0, paidCents: 0, creditedCents: 0, status: 'owed' },
    feeCharged: true, feeYear: '2026-27', history: []
  }, over || {});

  const ROWS = [
    row(),
    row({ participantId: 'p-2', name: 'Dana Katz', accountEmail: 'dana@example.com' }),
    row({ participantId: 'p-3', name: 'Yuval Cohen', accountEmail: 'yuval@example.com' }),
    row({ participantId: 'p-4', name: 'Ella Bar', accountEmail: 'ella@example.com' })
  ];
  const msg = (over) => Object.assign({
    template: 'registration-approved', label: 'Registration confirmed',
    subject: 'You have a place', lang: 'en', status: 'delivered', final: false,
    sentAt: '2026-09-02T09:00:00Z', statusUpdatedAt: '2026-09-02T09:00:00Z',
    sentBy: 'system', manual: false, error: null, thisActivity: true, relatedSlug: 'hebrew'
  }, over || {});

  const MAIL = { ok: true, perRecipient: 12, addressesRead: 4, addressesTotal: 4, capped: false,
    mail: {
      // delivered and never opened — "delivered but ignored", the third case
      'noa@example.com': { read: true, total: 1, messages: [msg()] },
      // bounced, and it is not the newest message: the worst news wins.
      'dana@example.com': { read: true, total: 2, messages: [
        msg({ status: 'sent', sentAt: '2026-09-05T09:00:00Z' }),
        msg({ template: 'registration-received', label: 'Registration request received',
              status: 'bounced', final: true, sentAt: '2026-09-01T09:00:00Z' })] },
      // the log would not answer for this one
      'yuval@example.com': { read: false, total: 0, messages: [] }
      // ella@example.com is absent, which the client reads as "nothing sent"
    } };

  function boot(mailAnswer) {
    const dom = D.makeDom({ ids: IDS, lang: 'en' });
    const answers = {
      auth: () => ({ ok: true, data: { name: 'Michal', roleName: 'Super Admin',
                                       canApprove: true, canCancel: true } }),
      activities: () => ({ ok: true, data: { activities: [
        { slug: 'hebrew', title: { en: 'Hebrew' }, status: 'open' }] } }),
      queue: () => ({ ok: true, data: {
        activity: { activityId: 'act-1', slug: 'hebrew', title: { en: 'Hebrew' }, type: 'course' },
        capacity: { capacity: 20, taken: 4, left: 16, over: false, perSession: false,
                    unassigned: 0, named: [] },
        registrations: ROWS,
        waiting: [row({ participantId: 'p-9', name: 'Roni Adler',
                        accountEmail: 'dana@example.com', status: 'waitlisted',
                        waitingSince: '2026-09-10T09:00:00Z' })] } }),
      mail: () => mailAnswer
    };
    dom.window.AdminSession = { requireSession: () => true, logout: () => {},
      post: (url, body) => {
        const fn = answers[body.action];
        if (!fn) throw new Error('no canned answer for "' + body.action + '"');
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
  function whoCellFor(dom, name) {
    return D.byClass(dom.byId('queue'), 'who')
      .filter((c) => c.textContent.indexOf(name) !== -1)[0];
  }

  const dom = boot({ ok: true, data: MAIL });
  await settle();

  const noa = whoCellFor(dom, 'Noa Levi');
  H.ok(/delivered/.test(noa.textContent),
    '⚠ "delivered" is on the row — half of "delivered but ignored", which is the ' +
    'distinction the whole thing was asked for: ' + noa.textContent);
  H.eq(D.byClass(noa, 'pill').length, 0,
    'and it is QUIET, because nothing is wrong with a delivered message');

  const dana = whoCellFor(dom, 'Dana Katz');
  const bad = D.byClass(dana, 'pill')[0];
  H.ok(bad && /bounced/.test(bad.textContent),
    '⚠ a bounce is LOUD, and it wins over the newer message above it: ' + dana.textContent);
  H.ok(/undelivered/.test(bad.className),
    'in the one class this screen keeps for something that has to be acted on');

  H.ok(/mail unknown/.test(whoCellFor(dom, 'Yuval Cohen').textContent),
    '⚠ a log that would not answer says UNKNOWN');
  H.ok(/never emailed/.test(whoCellFor(dom, 'Ella Bar').textContent),
    '⚠ and an address with no record says NEVER EMAILED — two different sentences, ' +
    'because one of them would have an admin apologise for mail that went out');
  H.eq(D.byClass(whoCellFor(dom, 'Ella Bar'), 'flag').length, 1,
    'advisory rather than red: it is a row to look at, not a fault');

  // The waiting list uses the same cell, so it says the same things. That row is
  // the one somebody rings about — "a place has opened" went to everybody at once.
  const waitTable = tableHeaded(dom, 'Waiting');
  H.ok(waitTable && /bounced/.test(waitTable.textContent),
    '⚠ and the WAITING table carries it too, where it answers the most');

  // The envelope, on every table.
  const labels = (t) => D.byTag(t, 'button')
    .map((b) => b.getAttribute('aria-label')).filter(Boolean);
  H.ok(labels(tableHeaded(dom, 'Participant')).indexOf('Email history') !== -1,
    'the queue row opens the history');
  H.ok(labels(waitTable).indexOf('Email history') !== -1, 'and so does a waiting row');

  // ------------------------------------------------------------------ panel --
  const envelope = D.byTag(tableHeaded(dom, 'Participant'), 'button')
    .filter((b) => b.getAttribute('aria-label') === 'Email history')[1];
  envelope._handlers.click.forEach((f) => f({}));
  await settle();
  H.ok(!dom.byId('mail-panel').hidden, 'pressing it opens the panel');
  H.eq(dom.byId('mail-title').textContent, 'Email · dana@example.com',
    'headed with the address it is about');
  const panel = dom.byId('mail-body').textContent;
  H.ok(/Registration request received/.test(panel),
    'every message is named in words: ' + panel.replace(/\s+/g, ' ').slice(0, 120));
  H.ok(/English/.test(panel), 'with the language it went out in, written out rather than as a code');
  H.ok(/this activity/.test(panel), 'and which of them is about the activity on screen');
  H.eq(D.byClass(dom.byId('mail-body'), 'undelivered').length, 1,
    'the bounce is loud here too, and only the bounce');

  // ⚠ NOTHING RECORDED SAYS SO AS A FACT ABOUT THE RECORD. Sending never waits
  // for the log — _email.js sends first and records second — so "nothing was
  // sent" is one of two readings and the panel must not pick the wrong one.
  const ella = D.byTag(tableHeaded(dom, 'Participant'), 'button')
    .filter((b) => b.getAttribute('aria-label') === 'Email history')[3];
  ella._handlers.click.forEach((f) => f({}));
  await settle();
  const empty = dom.byId('mail-body').textContent;
  H.ok(/Either nothing was sent/.test(empty),
    '⚠ and it names BOTH readings rather than accusing anybody: ' +
    empty.replace(/\s+/g, ' ').slice(0, 90));

  // --------------------------------------------------------------- refusal --
  const dom2 = boot({ ok: false, data: { error: 'The email log did not answer.' } });
  await settle();
  H.ok(/mail unknown/.test(whoCellFor(dom2, 'Noa Levi').textContent),
    '⚠ a failed call says unknown on EVERY row, rather than saying nothing at all — ' +
    'a blank line reads as a feature that is not there');

  // ---------------------------------------------------------------------------
  console.log('\n[the address line is reached by a class, not by `span`]');
  // ⚠ SPECIFICITY, NOT "IS THE FIX PRESENT". `.queue .who span` is (0,2,1) and
  // beat every badge that lands in the same cell — `.flag` was already losing its
  // amber to it unnoticed, because amber-on-cream and grey-on-cream both read as
  // quiet. A red pill with grey letters on it does not. Asked by shape, so the
  // next rule somebody adds inherits it.
  const css = read('admin/admin.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const whoRules = css.split('}').map((b) => b.split('{')[0].trim())
    .filter((sel) => /\.who\b/.test(sel) && /\.queue/.test(sel));
  H.ok(whoRules.length, 'there are rules for the participant cell: ' + whoRules.join(' | '));
  H.eq(whoRules.filter((sel) => /\.who\s+span\s*$/.test(sel) || /\.who\s*>\s*span\s*$/.test(sel)).join(','), '',
    '⚠ and none of them reaches a bare `span` from `.who` — a badge in that cell would lose to it');
  H.ok(/\.queue \.who \.addr/.test(css), 'the address is named by the rule that greys it');
  H.ok(/\.pill\.undelivered/.test(css), 'and the bounce has a class of its own');

  H.done();
})();
