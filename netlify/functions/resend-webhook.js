// POST /api/resend-webhook
//
// Resend calls this after every delivery event the endpoint subscribes to. It
// verifies the signature, maps the event to a status, and stamps it onto the
// matching email-log record by its Resend id.
//
// Env:
//   RESEND_WEBHOOK_SECRET   the "whsec_..." signing secret from the endpoint's
//                           own page in the Resend dashboard. It is generated
//                           when the endpoint is created, so it cannot be set
//                           before the endpoint exists.
//
// Subscribe the endpoint to: email.sent, email.delivered, email.opened,
// email.clicked, email.bounced, email.complained, email.delivery_delayed.
//
// Resend signs with Svix, so the headers are svix-id, svix-timestamp and
// svix-signature, and the signed string is "<id>.<timestamp>.<raw body>"
// HMAC-SHA256'd with the base64-decoded secret. That is a dozen lines of
// crypto, done below, rather than a dependency — this project adds a package
// only when it cannot avoid one, and every package is a package that has to be
// kept current for the sake of one function.
//
// RETURN 2xx UNLESS THE SIGNATURE ITSELF FAILS. An event that matches nothing
// is not an error: it is an email sent before this store existed, or a test
// fired from Resend's dashboard. Answering 500 would have Resend retry it for
// days and eventually disable the endpoint.

const crypto = require('crypto');
const log = require('./_email-log');

const SECRET = process.env.RESEND_WEBHOOK_SECRET || '';
// Svix rejects anything older than five minutes and so does this: a signature
// replayed a week later is still a valid signature.
const TOLERANCE_S = 5 * 60;

function json(statusCode, payload) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

// Case insensitive by scanning, not by guessing three spellings. HTTP header
// names are case insensitive and Netlify happens to hand them over lowercased,
// but "Svix-Id" is what most proxies and clients emit and is exactly the
// spelling a three-guess lookup misses. The failure mode is the worst kind:
// every webhook rejected as "missing svix headers", with the signature itself
// perfectly valid and nothing in the log to say why.
function header(headers, name) {
  if (!headers) return '';
  const want = String(name).toLowerCase();
  for (const k of Object.keys(headers)) {
    if (String(k).toLowerCase() === want) return headers[k] || '';
  }
  return '';
}

// Constant time, so a wrong signature cannot be narrowed down by how long the
// answer took.
function sameSignature(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

// Returns null when it verifies, or a string saying why it did not.
function verify(headers, rawBody, secret) {
  const key64 = (secret === undefined ? SECRET : secret) || '';
  if (!key64) return 'RESEND_WEBHOOK_SECRET not configured';
  const id = header(headers, 'svix-id');
  const ts = header(headers, 'svix-timestamp');
  const sigHeader = header(headers, 'svix-signature');
  if (!id || !ts || !sigHeader) return 'missing svix headers';

  const then = Number(ts);
  if (!isFinite(then)) return 'bad timestamp';
  if (Math.abs(Math.floor(Date.now() / 1000) - then) > TOLERANCE_S) return 'timestamp outside tolerance';

  const key = Buffer.from(String(key64).replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key)
    .update(id + '.' + ts + '.' + rawBody)
    .digest('base64');

  // A space separated list of "<version>,<signature>": an endpoint mid-rotation
  // is signed with both the old key and the new one.
  const offered = String(sigHeader).split(' ')
    .map((p) => p.split(','))
    .filter((p) => p[0] === 'v1' && p[1])
    .map((p) => p[1]);
  if (!offered.length) return 'no v1 signature';
  return offered.some((s) => sameSignature(s, expected)) ? null : 'signature mismatch';
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  // Signed against the exact bytes, so the RAW body is what must be hashed —
  // never a re-serialised parse of it, which would reorder keys and change
  // whitespace and fail for reasons nobody could see.
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  const bad = verify(event.headers, rawBody);
  if (bad) {
    console.error('resend-webhook: ' + bad);
    return { statusCode: 400, body: 'Signature verification failed: ' + bad };
  }

  let payload = {};
  try { payload = JSON.parse(rawBody || '{}'); }
  catch (e) { return json(200, { received: true, ignored: 'unparseable body' }); }

  const status = log.EVENT_STATUS[payload.type];
  const resendId = (payload.data && (payload.data.email_id || payload.data.id)) || null;
  if (!status || !resendId) {
    console.log('resend-webhook: ignored ' + payload.type);
    return json(200, { received: true, ignored: payload.type || 'unknown' });
  }

  let result = { ok: false, reason: 'error' };
  try { result = await log.markStatus(resendId, status, payload.created_at || null); }
  catch (e) { console.error('resend-webhook: ' + e.message); }

  // Logged either way. "unknown-id" is the ordinary case for anything sent
  // before the log existed, and reading it as a fault would be misleading.
  console.log('resend-webhook: ' + payload.type + ' ' + resendId + ' -> ' +
    (result.ok ? status : 'no change (' + result.reason + ')'));
  return json(200, { received: true, applied: !!result.ok });
};

// Exported for the tests, which drive verification directly rather than over
// HTTP.
exports.verify = verify;
