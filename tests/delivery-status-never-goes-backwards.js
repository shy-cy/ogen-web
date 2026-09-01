// What this defends against:
//
// Resend sends delivery events over a webhook and DOES NOT PROMISE ORDER. Out
// of order is normal: "delivered" can arrive after "opened", and a retry can
// redeliver an event hours later. Applied naively — last write wins — an opened
// message quietly reverts to delivered, and worse:
//
//   A BOUNCE CAN BE OVERWRITTEN. A bounce is the one status an admin has to act
//   on, because it means the family never got the message. A later "delivered"
//   for the same id, or a retry of the send event, would hide it, and the
//   admin would go on believing a message was received that never was.
//
// So there are two vocabularies, not one list. PROGRESS is a ladder where each
// rung is better news than the one below. FINAL is bad news, which always wins
// and is never overwritten. supersedes() is the only place that decides, and
// this suite is mostly about it.

const H = require('./_helpers');

const blobs = H.makeBlobs();
require.cache[H.fnPath('_blobs')] = {
  id: H.fnPath('_blobs'), filename: H.fnPath('_blobs'), loaded: true, exports: blobs
};
const log = require(H.fnPath('_email-log'));

(async () => {
  console.log('[the ladder only goes up]');
  H.ok(log.supersedes('delivered', 'sent'), 'delivered beats sent');
  H.ok(log.supersedes('opened', 'delivered'), 'opened beats delivered');
  H.ok(log.supersedes('clicked', 'opened'), 'clicked beats opened');
  H.ok(!log.supersedes('sent', 'delivered'), 'sent does NOT beat delivered');
  H.ok(!log.supersedes('delivered', 'opened'),
       'and delivered does NOT undo opened — this is the out-of-order case, not a rare one');
  H.ok(!log.supersedes('opened', 'opened'), 'a repeat of the same event changes nothing');

  console.log('\n[bad news wins, and then stands]');
  H.ok(log.supersedes('bounced', 'sent'), 'a bounce overrides sent');
  H.ok(log.supersedes('bounced', 'opened'), 'a bounce overrides even opened');
  ['sent', 'delivered', 'opened', 'clicked', 'delayed'].forEach((s) => {
    H.ok(!log.supersedes(s, 'bounced'), 'nothing overwrites a bounce: ' + s);
  });
  H.ok(!log.supersedes('delivered', 'complained'), 'nor a complaint');
  H.ok(!log.supersedes('delivered', 'failed'), 'nor a failure');
  H.ok(!log.supersedes('delivered', 'suppressed'),
       'nor suppressed, which means Resend refused to send at all because that address bounced before');

  console.log('\n[a delay is only news while nothing better is known]');
  H.ok(log.supersedes('delayed', 'sent'), 'delayed is worth showing over sent');
  H.ok(!log.supersedes('delayed', 'delivered'), 'but not over delivered — that it was slow is not news');
  H.ok(log.supersedes('delivered', 'delayed'), 'and a delivery clears a delay');
  H.ok(!log.supersedes('sent', 'delayed'), 'while a repeat of sent does not');

  console.log('\n[an unknown status is ignored, not stored]');
  H.ok(!log.supersedes('exploded', 'sent'), 'a word not in the vocabulary never wins');
  H.ok(!log.supersedes('', 'sent'), 'nor an empty one');
  H.ok(log.supersedes('sent', null), 'but anything valid beats nothing at all');

  console.log('\n[the event map only admits what we can act on]');
  H.eq(log.EVENT_STATUS['email.bounced'], 'bounced', 'bounce maps through');
  H.eq(log.EVENT_STATUS['email.delivery_delayed'], 'delayed', 'and the awkwardly named one');
  H.eq(log.EVENT_STATUS['email.something_new'], undefined,
       'an event type Resend adds later maps to nothing rather than to a guess');

  console.log('\n[end to end, through the store]');
  const rec = await log.record({
    recipient: 'Dana@Example.com', template: 'infrastructure-test',
    resendId: 're_abc', subject: 'Hello', lang: 'he'
  });
  H.eq(rec.recipient, 'dana@example.com', 'the address is lowercased so one person is one prefix');
  H.eq(rec.status, 'sent', 'a new record starts at sent');
  H.ok(rec.id.indexOf('log-dana%40example.com__') === 0, 'and is keyed by the encoded address');

  let r = await log.markStatus('re_abc', 'opened');
  H.ok(r.ok && r.record.status === 'opened', 'the webhook can open it');
  r = await log.markStatus('re_abc', 'delivered');
  H.ok(!r.ok && r.reason === 'not-newer', 'a late delivered is refused, with a reason');
  r = await log.markStatus('re_abc', 'bounced');
  H.ok(r.ok && r.record.status === 'bounced', 'a bounce lands');
  r = await log.markStatus('re_abc', 'clicked');
  H.ok(!r.ok && r.reason === 'not-newer', 'and then nothing moves it');
  const after = await log.listForRecipient('dana@example.com');
  H.eq(after[0].status, 'bounced', 'the stored record still reads bounced');

  console.log('\n[an id we never sent is not an error]');
  const unknown = await log.markStatus('re_never_seen', 'delivered');
  H.ok(!unknown.ok && unknown.reason === 'unknown-id',
       'an email sent before this store existed, or a dashboard test, is reported and not treated as a fault');

  console.log('\n[the pointer is what makes the webhook one read]');
  const store = await blobs.optionalStore('email-log');
  const pointer = await store.get(log.pointerKey('re_abc'), { type: 'json' });
  H.eq(pointer.key, rec.id, 'rid-<id> points straight at the record');

  console.log('\n[a record with nothing to identify it is not written]');
  H.eq(await log.record({ template: 'infrastructure-test' }), null, 'no recipient, no record');
  H.eq(await log.record({ recipient: 'a@b.c' }), null, 'no template, no record');

  console.log('\n[one recipient, newest first]');
  await log.record({ recipient: 'a@b.c', template: 'infrastructure-test', sentAt: '2026-01-01T00:00:00.000Z' });
  await log.record({ recipient: 'a@b.c', template: 'infrastructure-test', sentAt: '2026-06-01T00:00:00.000Z' });
  const list = await log.listForRecipient('a@b.c');
  H.eq(list.length, 2, 'both are there');
  H.ok(list[0].sentAt > list[1].sentAt, 'and the newest is first');

  H.done();
})();
