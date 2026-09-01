// What this defends against:
//
// The email is never the point. An account is created, a registration is
// approved, a spot is released — and a message goes out about it. If the send
// throws and nobody caught it, the action that already happened is reported as
// a failure, or worse, half-rolled-back. Shirat HaYam learned this and wrapped
// every send in settle(); this is that wrapper, plus the two ordering rules
// that make it worth having.
//
//   SEND FIRST, LOG SECOND. An email sent and not logged is a gap in a record.
//   An email not sent because the log failed is a person left waiting.
//
//   THE SEND PATH IS SINGULAR. Shirat HaYam calls resend.emails.send from six
//   places and repeats the error check and the log write at each. Here there is
//   one send(), so the ordering is a property of the code rather than a
//   discipline six call sites have to remember. A second call site added later
//   is the bug this asserts against.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const FN = path.join(__dirname, '..', 'netlify', 'functions');
const blobs = H.makeBlobs();
require.cache[H.fnPath('_blobs')] = {
  id: H.fnPath('_blobs'), filename: H.fnPath('_blobs'), loaded: true, exports: blobs
};

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';
const log = require(H.fnPath('_email-log'));
const mail = require(H.fnPath('_email'));

// A transport that records what it was asked to send, and can be told to fail.
function fakeTransport() {
  const sent = [];
  let fail = null;
  return {
    sent,
    failNext(err) { fail = err; },
    emails: {
      async send(args) {
        if (fail) { const e = fail; fail = null; throw e; }
        sent.push(args);
        return { data: { id: 're_' + sent.length }, error: null };
      }
    }
  };
}

(async () => {
  console.log('[settle swallows, and says so]');
  let ran = false;
  const good = await mail.settle('test', 'a@b.c', async () => { ran = true; });
  H.ok(good === true && ran, 'a send that works returns true');

  const errs = [];
  const realError = console.error;
  console.error = (m) => errs.push(String(m));
  const bad = await mail.settle('welcome email', 'dana@example.com', async () => {
    throw new Error('Resend is down');
  });
  console.error = realError;
  H.ok(bad === false, 'a send that throws returns false instead of propagating');
  H.ok(errs.length === 1 && /welcome email/.test(errs[0]) && /dana@example\.com/.test(errs[0]),
       'and it is logged with what failed and for whom, so a silent swallow is still visible');

  console.log('\n[the action survives an email that does not]');
  // The shape every caller will use: do the thing, then settle() the message.
  let accountCreated = false;
  const t = fakeTransport();
  mail._internal.setTransport(t);
  t.failNext(new Error('smtp exploded'));
  console.error = () => {};
  await (async function createAccount() {
    accountCreated = true;                       // the real work
    await mail.settle('welcome', 'x@y.z', () =>
      mail.send({ to: 'x@y.z', subject: 'Welcome', html: '<p>hi</p>' },
                { template: 'infrastructure-test' }));
  })();
  console.error = realError;
  H.ok(accountCreated === true, 'the account exists even though the welcome email failed');

  console.log('\n[send first, log second]');
  const order = [];
  const t2 = fakeTransport();
  const realSend = t2.emails.send;
  t2.emails.send = async (a) => { order.push('send'); return realSend(a); };
  mail._internal.setTransport(t2);
  const realRecord = log.record;
  log.record = async (r) => { order.push('log'); return realRecord(r); };
  await mail.send({ to: 'dana@example.com', subject: 'Hello', html: '<p>x</p>' },
                  { template: 'infrastructure-test', lang: 'he' });
  H.eq(JSON.stringify(order), '["send","log"]', 'the send happens first and the log second');

  console.log('\n[a failed send is never logged as sent]');
  order.length = 0;
  t2.failNext(new Error('rejected'));
  let threw = false;
  try {
    await mail.send({ to: 'nope@example.com', subject: 'X', html: '<p>x</p>' },
                    { template: 'infrastructure-test' });
  } catch (e) { threw = true; }
  H.ok(threw, 'send() throws so a caller that needs to know can find out');
  // The attempt is in `order` because the wrapper records it before delegating;
  // what matters is that no log entry follows it.
  H.ok(order.indexOf('log') === -1, 'and nothing was written to the log');
  log.record = realRecord;

  console.log('\n[the SDK reports a rejected send in the body, not by throwing]');
  // The trap: result.error is set and no exception is raised, so an unchecked
  // call looks successful and logs a message that never went anywhere.
  mail._internal.setTransport({
    emails: { async send() { return { data: null, error: { message: 'domain not verified' } }; } }
  });
  let caught = null;
  try { await mail.send({ to: 'a@b.c', subject: 'X', html: '<p>x</p>' }, { template: 'infrastructure-test' }); }
  catch (e) { caught = e; }
  H.ok(caught && /domain not verified/.test(caught.message),
       'result.error is turned into a throw rather than treated as success');

  console.log('\n[logging cannot break a send that already happened]');
  const t3 = fakeTransport();
  mail._internal.setTransport(t3);
  log.record = async () => { throw new Error('blobs are down'); };
  console.error = () => {};
  const res = await mail.send({ to: 'a@b.c', subject: 'X', html: '<p>x</p>' },
                              { template: 'infrastructure-test' });
  console.error = realError;
  log.record = realRecord;
  H.ok(res && res.data && res.data.id, 'the send still returns its result when the log throws');
  H.eq(t3.sent.length, 1, 'and the message really did go');

  console.log('\n[refusals happen before the network, not after]');
  mail._internal.setTransport(fakeTransport());
  for (const [msg, why] of [
    [{ to: '', subject: 'x', html: 'x' }, 'no recipient'],
    [{ to: 'a@b.c', subject: '', html: 'x' }, 'no subject']
  ]) {
    let bad = false;
    try { await mail.send(msg, null); } catch (e) { bad = true; }
    H.ok(bad, 'refuses a message with ' + why);
  }

  console.log('\n[one send path, asserted rather than hoped for]');
  const src = fs.readFileSync(path.join(FN, '_email.js'), 'utf8');
  const callSites = (src.match(/emails\.send\(/g) || []).length;
  H.eq(callSites, 1, 'resend.emails.send appears exactly once in the module');
  const others = fs.readdirSync(FN)
    .filter((f) => f.endsWith('.js') && f !== '_email.js')
    .filter((f) => /emails\.send\(|new Resend\(/.test(fs.readFileSync(path.join(FN, f), 'utf8')));
  H.eq(JSON.stringify(others), '[]', 'and no other function talks to Resend directly');

  mail._internal.resetTransport();
  H.done();
})();
