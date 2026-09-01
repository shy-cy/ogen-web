// _email.js — the one place an email leaves this site.
//
// Infrastructure only. There are no templates here yet: the registration and
// account messages are still being designed, and this module exists so that
// when they arrive they have one send path to use rather than six.
//
// Required env vars:
//   RESEND_API_KEY       from https://resend.com/api-keys
//   RESEND_FROM          e.g.  Merkaz Ogen <noreply@ogen.cy>
//   RESEND_REPLY_TO      optional; replies routed to a real inbox
//   ADMIN_NOTIFY_EMAIL   optional; comma separated
//
// THREE RULES, and each one was a bug somewhere before it was a rule.
//
// 1. SEND FIRST, LOG SECOND, AND NEVER THE OTHER WAY ROUND. An email that was
//    sent and not logged is a gap in a record. An email that was not sent
//    because the log failed is a person left waiting. So the log is written
//    after Resend has accepted the message, and logSend() cannot throw.
//
// 2. THE SEND PATH IS SINGULAR. Shirat HaYam calls resend.emails.send from six
//    places and repeats the error check and the log write at each one. Here
//    there is one send(), so "log after send" is a property of the code rather
//    than a discipline six call sites have to remember.
//
// 3. AN EMAIL FAILURE NEVER BLOCKS THE ACTION IT ACCOMPANIES. settle() is the
//    wrapper for that: an account is created, a registration is approved, and
//    the message about it is best effort. Reversing an action a person already
//    completed because a mail server was slow is the worse outcome.

const log = require('./_email-log');

const FROM = process.env.RESEND_FROM || '';
const REPLY_TO = process.env.RESEND_REPLY_TO || null;
const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || null;

// Lazily constructed, so requiring this module on a machine with no key — a
// test runner, a local static preview — costs nothing and throws nothing. The
// seam is also what lets the suite drive send() without a network.
let transport = null;
function setTransport(t) { transport = t; }
function resetTransport() { transport = null; }
function getTransport() {
  if (transport) return transport;
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not set; cannot send email');
  }
  const { Resend } = require('resend');
  transport = new Resend(process.env.RESEND_API_KEY);
  return transport;
}

// Whether this deploy can send at all. Callers use it to decide between "we
// will email you" and saying nothing, rather than promising a message that
// cannot be sent.
function configured() {
  return !!(process.env.RESEND_API_KEY && FROM);
}

function adminRecipients() {
  return String(ADMIN_NOTIFY_EMAIL || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// The send path
// ─────────────────────────────────────────────────────────────────────────────

// Send one message and record it.
//
// `logAs` is what the email log stores: { template, lang, relatedSlug, sentBy,
// manual }. Omit it and nothing is logged, which is right for a message to an
// internal address — the log exists to answer "what did we send this family",
// and an admin notification is not part of that answer.
//
// Returns Resend's result. THROWS if the send fails, so a caller that needs to
// know can find out; wrap it in settle() where the answer does not change what
// the caller does next.
async function send(message, logAs) {
  if (!FROM) throw new Error('RESEND_FROM is not set; refusing to send with a default sender');
  const to = Array.isArray(message.to) ? message.to.filter(Boolean) : [message.to].filter(Boolean);
  if (!to.length) throw new Error('email has no recipient');
  if (!message.subject) throw new Error('email has no subject');

  const args = {
    from: message.from || FROM,
    to: to,
    subject: message.subject,
    html: message.html,
    text: message.text
  };
  // Resend ignores an empty attachments array but a stray key in the payload is
  // one more thing to explain when a send is being debugged at midnight.
  if (message.attachments && message.attachments.length) args.attachments = message.attachments;
  const replyTo = message.replyTo || REPLY_TO;
  if (replyTo) args.reply_to = replyTo;

  const result = await getTransport().emails.send(args);
  // The SDK reports a rejected send in the body rather than by throwing, which
  // means an unchecked call looks successful and logs a message that never went.
  if (result && result.error) {
    throw new Error('Resend error: ' + JSON.stringify(result.error));
  }

  if (logAs) await logSend(to[0], result, message, logAs);
  return result;
}

// Best effort by construction. The email is already gone by the time this runs,
// so there is nothing a failure here could usefully stop.
async function logSend(recipient, result, message, logAs) {
  try {
    await log.record(Object.assign({
      recipient: recipient,
      subject: message.subject,
      resendId: (result && result.data && result.data.id) || (result && result.id) || null,
      status: 'sent'
    }, logAs || {}));
  } catch (e) {
    console.error('[email] send succeeded but logging failed for ' + recipient + ': ' + e.message);
  }
}

// Run a thunk that sends email and swallow whatever it throws, having said so.
// Returns whether it worked, for a caller that wants to tell the admin "sent"
// or "not sent" without the answer changing anything else.
async function settle(what, who, thunk) {
  try { await thunk(); return true; }
  catch (e) { console.error('[email] ' + what + ' failed for ' + who + ': ' + (e && e.message || e)); return false; }
}

// ─────────────────────────────────────────────────────────────────────────────
// ICS — RFC 5545, the minimal subset, hand rolled.
//
// Relevant to Ogen because an activity already holds its whole calendar:
// facts.duration.sessionDates is a list of dated meetings, so a family
// registering for a ten week course can be handed all ten at once. That is the
// intended caller, and it is why this takes a LIST of events rather than one.
//
// Hand rolled rather than ical-generator, for the reason Shirat HaYam gives:
// that package is ESM only from v8 and awkward from a CommonJS function, and
// this is forty lines.
//
// TIMES ARE INSTANTS, AND COME OUT AS UTC. Pass a Date, or an ISO string that
// carries an offset. Ogen's session times are local wall clock in
// Asia/Nicosia, and resolving wall clock to an instant is the CALLER's job —
// deliberately, because doing it here would bake half a timezone conversion
// into infrastructure that cannot see which zone the caller meant. UTC in the
// file is not a display choice: an instant is rendered in the reader's own zone
// by every calendar client.
// ─────────────────────────────────────────────────────────────────────────────

function escapeIcs(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    // '\;' in a JS string collapses to ';' — the backslash is silently dropped
    // for an unrecognised escape, so this needs the doubled one. Unescaped, a
    // location like "Limassol; Room 2" parses as a parameter and the value is
    // truncated at the semicolon.
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function formatIcsDate(d) {
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) throw new Error('ICS needs a valid date, got: ' + d);
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// RFC 5545 caps a line at 75 OCTETS and folds the rest onto continuation lines
// beginning with a space. Shirat HaYam does not fold, which is invisible until
// a description runs long and a strict parser refuses the file. Folding on
// octets rather than characters matters here: Hebrew and Russian are two bytes
// a character, so a 75 CHARACTER limit would still emit overlong lines, and
// splitting mid-character would corrupt them.
function foldLine(line) {
  const buf = Buffer.from(line, 'utf8');
  if (buf.length <= 75) return line;
  const parts = [];
  let start = 0;
  let limit = 75;
  while (start < buf.length) {
    let end = Math.min(start + limit, buf.length);
    // Walk back off a continuation byte so a multi-byte character is never cut.
    while (end > start && end < buf.length && (buf[end] & 0xc0) === 0x80) end--;
    parts.push((start ? ' ' : '') + buf.slice(start, end).toString('utf8'));
    start = end;
    limit = 74; // a continuation line spends one octet on its leading space
  }
  return parts.join('\r\n');
}

// events: [{ uid, summary, start, end, location, description, url }]
function buildIcs(events, opts) {
  const rows = Array.isArray(events) ? events : [events];
  if (!rows.length) throw new Error('ICS needs at least one event');
  const o = opts || {};
  const domain = o.domain || 'ogen.cy';
  const prodId = o.prodId || '-//Merkaz Ogen//Activities//EN';
  const stamp = formatIcsDate(new Date());
  // Shared by every event in one file so they read as one issue, and unique per
  // file so a second send does not look like an edit of the first.
  const batch = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

  const vevents = rows.reduce((out, r, i) => {
    // Distinct per event. One UID reused across a ten session course would have
    // a calendar treat each session as an edit of the last and keep only one.
    const uid = r.uid || (o.uidPrefix || 'ogen') + '-' + (i + 1) + '-' + batch + '@' + domain;
    const lines = [
      'BEGIN:VEVENT',
      'UID:' + escapeIcs(uid),
      'DTSTAMP:' + stamp,
      'DTSTART:' + formatIcsDate(r.start),
      'DTEND:' + formatIcsDate(r.end || r.start),
      'SUMMARY:' + escapeIcs(r.summary)
    ];
    if (r.location) lines.push('LOCATION:' + escapeIcs(r.location));
    if (r.description) lines.push('DESCRIPTION:' + escapeIcs(r.description));
    if (r.url) lines.push('URL:' + escapeIcs(r.url));
    lines.push('END:VEVENT');
    return out.concat(lines);
  }, []);

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:' + escapeIcs(prodId),
    'CALSCALE:GREGORIAN',
    'METHOD:' + (o.method || 'PUBLISH')
  ].concat(vevents, ['END:VCALENDAR'])
    .map(foldLine)
    .join('\r\n');
}

// Ready to hand to send({ attachments: [...] }). Resend wants base64.
function icsAttachment(events, opts) {
  const o = opts || {};
  return {
    filename: o.filename || 'ogen.ics',
    content: Buffer.from(buildIcs(events, o), 'utf8').toString('base64')
  };
}

module.exports = {
  send, settle, configured, adminRecipients,
  buildIcs, icsAttachment,
  FROM, REPLY_TO,
  _internal: { setTransport, resetTransport, escapeIcs, formatIcsDate, foldLine, logSend }
};
