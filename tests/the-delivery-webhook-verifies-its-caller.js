// What this defends against:
//
// /api/resend-webhook is a public URL that WRITES to the email log. Without a
// signature check, anyone who guesses the address can stamp "delivered" onto a
// message that bounced, which is the exact fact the log exists to preserve.
//
// Resend signs with Svix. The signed string is "<svix-id>.<svix-timestamp>.<raw
// body>", HMAC-SHA256 with the base64-decoded secret, compared against a space
// separated list of "v1,<sig>" pairs — a list, because an endpoint mid-rotation
// is signed with the old key and the new one at once.
//
// Three things here are easy to get wrong and are each asserted:
//
//   THE RAW BODY IS WHAT IS SIGNED. Re-serialising a parsed body reorders keys
//   and changes whitespace, so it fails for reasons nobody can see.
//   THE TIMESTAMP IS CHECKED. A signature replayed a week later is still a
//   valid signature.
//   A 2xx IS RETURNED UNLESS THE SIGNATURE ITSELF FAILS. An event matching
//   nothing is an email sent before this store existed, or a dashboard test.
//   Answering 500 makes Resend retry for days and then disable the endpoint.

const crypto = require('crypto');
const H = require('./_helpers');

const blobs = H.makeBlobs();
require.cache[H.fnPath('_blobs')] = {
  id: H.fnPath('_blobs'), filename: H.fnPath('_blobs'), loaded: true, exports: blobs
};

const SECRET = 'whsec_' + Buffer.from('a-test-signing-key-32-bytes-long').toString('base64');
process.env.RESEND_WEBHOOK_SECRET = SECRET;

const log = require(H.fnPath('_email-log'));
const hook = require(H.fnPath('resend-webhook'));

function sign(id, ts, body, secret) {
  const key = Buffer.from(String(secret || SECRET).replace(/^whsec_/, ''), 'base64');
  return crypto.createHmac('sha256', key).update(id + '.' + ts + '.' + body).digest('base64');
}
function headers(id, ts, sig) {
  return { 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': 'v1,' + sig };
}
const now = () => Math.floor(Date.now() / 1000);

async function post(body, hdrs) {
  const res = await hook.handler({ httpMethod: 'POST', body, headers: hdrs });
  return { status: res.statusCode, body: res.body };
}

(async () => {
  const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 're_live' } });

  console.log('[a good signature verifies]');
  const ts = now();
  H.eq(hook.verify(headers('msg_1', ts, sign('msg_1', ts, body)), body), null, 'null means verified');

  console.log('\n[and every way of being wrong is refused, with a reason]');
  H.eq(hook.verify(headers('msg_1', ts, sign('msg_1', ts, body)), body + ' '), 'signature mismatch',
       'one extra byte in the body fails — the RAW bytes are what is signed');
  H.eq(hook.verify(headers('msg_2', ts, sign('msg_1', ts, body)), body), 'signature mismatch',
       'the svix id is part of the signed string');
  H.eq(hook.verify(headers('msg_1', ts, sign('msg_1', ts, body, 'whsec_' + Buffer.from('wrong-key').toString('base64'))), body),
       'signature mismatch', 'another sender\'s key does not verify');
  H.eq(hook.verify({ 'svix-id': 'x', 'svix-timestamp': String(ts) }, body), 'missing svix headers',
       'a request with no signature header at all');
  H.eq(hook.verify(headers('msg_1', 'not-a-number', 'x'), body), 'bad timestamp', 'a junk timestamp');
  H.eq(hook.verify(headers('msg_1', ts, sign('msg_1', ts, body)), body, ''), 'RESEND_WEBHOOK_SECRET not configured',
       'and with no secret configured it refuses rather than accepting everything');

  console.log('\n[a replay is refused even though the signature is genuine]');
  const old = now() - 3600;
  H.eq(hook.verify(headers('msg_1', old, sign('msg_1', old, body)), body), 'timestamp outside tolerance',
       'an hour later, correctly signed, still refused');
  const soon = now() - 60;
  H.eq(hook.verify(headers('msg_1', soon, sign('msg_1', soon, body)), body), null,
       'a minute of clock skew is fine');

  console.log('\n[rotation: a list of signatures, one of which is ours]');
  const good = sign('msg_1', ts, body);
  H.eq(hook.verify({ 'svix-id': 'msg_1', 'svix-timestamp': String(ts),
                     'svix-signature': 'v1,' + Buffer.from('nonsense').toString('base64') + ' v1,' + good }, body),
       null, 'the second of two offered signatures verifies');
  H.eq(hook.verify({ 'svix-id': 'msg_1', 'svix-timestamp': String(ts), 'svix-signature': 'v2,' + good }, body),
       'no v1 signature', 'a version we do not implement is not silently accepted');

  console.log('\n[headers arrive in whatever case the platform gives them]');
  H.eq(hook.verify({ 'Svix-Id': 'msg_1', 'Svix-Timestamp': String(ts), 'Svix-Signature': 'v1,' + good }, body),
       null, 'title case works too');

  console.log('\n[over HTTP: refused means 400, and nothing is written]');
  await log.record({ recipient: 'dana@example.com', template: 'infrastructure-test', resendId: 're_live' });
  const forged = await post(body, headers('msg_1', ts, 'ZmFrZQ=='));
  H.eq(forged.status, 400, 'a forged request is rejected');
  H.eq((await log.listForRecipient('dana@example.com'))[0].status, 'sent',
       'and the record it tried to change is untouched');

  console.log('\n[over HTTP: accepted means the status lands]');
  const ok = await post(body, headers('msg_2', now(), sign('msg_2', now(), body)));
  H.eq(ok.status, 200, 'a signed request is accepted');
  H.eq(JSON.parse(ok.body).applied, true, 'and says it applied the event');
  H.eq((await log.listForRecipient('dana@example.com'))[0].status, 'delivered', 'the record moved');

  console.log('\n[everything else is a 200, because a retry storm is worse]');
  const cases = [
    ['an id we never sent', JSON.stringify({ type: 'email.delivered', data: { email_id: 're_ghost' } })],
    ['an event type we ignore', JSON.stringify({ type: 'email.scheduled', data: { email_id: 're_live' } })],
    ['an event with no id', JSON.stringify({ type: 'email.delivered', data: {} })],
    ['a body that is not JSON', 'not json at all']
  ];
  for (const [what, b] of cases) {
    const t = now();
    const res = await post(b, headers('m_' + t + what.length, t, sign('m_' + t + what.length, t, b)));
    H.eq(res.status, 200, what + ' returns 200');
  }
  H.eq((await log.listForRecipient('dana@example.com'))[0].status, 'delivered',
       'and none of them changed the record');

  console.log('\n[a bounce arriving late still wins; a delivered arriving later does not]');
  const bounce = JSON.stringify({ type: 'email.bounced', data: { email_id: 're_live' } });
  let t = now();
  await post(bounce, headers('b1', t, sign('b1', t, bounce)));
  H.eq((await log.listForRecipient('dana@example.com'))[0].status, 'bounced', 'the bounce landed');
  t = now();
  await post(body, headers('b2', t, sign('b2', t, body)));
  H.eq((await log.listForRecipient('dana@example.com'))[0].status, 'bounced',
       'and a later delivered did not bury it — the whole point of the endpoint');

  console.log('\n[GET is not a webhook]');
  const get = await hook.handler({ httpMethod: 'GET', headers: {} });
  H.eq(get.statusCode, 405, 'method not allowed');

  H.done();
})();
