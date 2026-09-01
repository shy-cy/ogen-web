// _email-log.js — every email this site sends, and what became of it.
//
// Store "email-log" (so "ogen-email-log"), two kinds of key:
//
//   log-<encoded recipient>__<ISO timestamp>__<random>   the record
//   rid-<resend id>                                      a pointer to that key
//
// The first makes listForRecipient() a prefix scan and keeps one person's mail
// in time order. The second exists because the delivery webhook knows only the
// Resend id: without it, stamping "opened" onto a record would mean reading the
// whole store.
//
// WHY THIS EXISTS. Resend already knows whether a message was delivered and
// whether it was opened, and the send call returns an id that could be matched
// against it. Throw the id away and that knowledge is unreachable from inside
// the site. Shirat HaYam's own note says what that costs: when somebody was
// approved and never paid, there was no way to tell from the admin whether they
// had ignored the email or never received it — AND THOSE NEED OPPOSITE
// RESPONSES. Ogen's reminders will raise exactly that question.
//
// WRITING HERE IS ALWAYS BEST EFFORT. This module is called from inside a send
// that has already happened. Nothing in it throws.

const blobs = require('./_blobs');

const STORE = 'email-log';

// Which emails can be sent, and which of those it is safe to send again by
// hand. Resendability is a judgement about the copy, not a permission: an
// acknowledgement describes a moment that has passed, and arriving a second
// time a fortnight later it reads as a fault rather than as help. A payment
// reminder is the opposite — repeating it is the entire point.
//
// Deliberately nearly empty. The registration and account templates are still
// being designed; each one adds a line here when it is written. An unknown
// template is recorded rather than refused, because losing the record of a
// send is worse than recording one under a name this table has not learnt yet.
const TEMPLATES = {
  'infrastructure-test': { label: 'Infrastructure test', resend: true }
};

function templateLabel(t) { return (TEMPLATES[t] && TEMPLATES[t].label) || String(t || 'Email'); }
function isResendable(t) { return !!(TEMPLATES[t] && TEMPLATES[t].resend); }

// How far a message has got. Two separate things, deliberately:
//
//   PROGRESS  a ladder. Each rung is better news than the one below it, so a
//             "delivered" webhook arriving after an "opened" one must not undo
//             it. Resend does not promise order, and out of order is normal.
//   FINAL     something went wrong. It always wins and is never overwritten,
//             because a bounce is the one status an admin has to act on, and a
//             later "delivered" for the same id would hide it.
//
// `suppressed` belongs with the bad news rather than on the ladder: it means
// Resend refused to send at all because that address bounced before, so the
// person is unreachable and nothing about this message will improve. Without a
// word for it, an address the mail server has given up on looks exactly like
// one nobody ever wrote to.
const PROGRESS = ['sent', 'delivered', 'opened', 'clicked'];
const FINAL = ['bounced', 'complained', 'failed', 'suppressed'];
const STATUSES = PROGRESS.concat(['delayed'], FINAL);

// Resend event names to ours. Anything not listed is ignored rather than
// stored, so a new event type they add cannot write a status nothing reads.
const EVENT_STATUS = {
  'email.sent': 'sent',
  'email.delivered': 'delivered',
  'email.opened': 'opened',
  'email.clicked': 'clicked',
  'email.bounced': 'bounced',
  'email.complained': 'complained',
  'email.failed': 'failed',
  'email.delivery_delayed': 'delayed'
};

// Is `next` better information than `current`?
function supersedes(next, current) {
  if (STATUSES.indexOf(next) === -1) return false;
  if (!current) return true;
  if (FINAL.indexOf(current) !== -1) return false;      // bad news stands
  if (FINAL.indexOf(next) !== -1) return true;
  // A delay is only worth showing while nothing better is known. Once a message
  // is delivered, that it was slow is not news.
  if (next === 'delayed') return current === 'sent';
  if (current === 'delayed') return PROGRESS.indexOf(next) > 0;
  return PROGRESS.indexOf(next) > PROGRESS.indexOf(current);
}

// The store, or null, resolved once per cold start. Ogen's optionalStore warns
// when Blobs is unreachable, and this module runs inside every send — one
// warning per email would drown the log it is complaining about. Caching the
// PROMISE rather than the value also means two concurrent sends open the store
// once between them.
let cached;
function logStore() {
  if (cached === undefined) {
    cached = blobs.optionalStore(STORE).catch(() => null);
  }
  return cached;
}
function resetStore() { cached = undefined; }

function normalizeEmail(e) { return String(e || '').trim().toLowerCase(); }
function nowIso() { return new Date().toISOString(); }
function str(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200); }

// Percent encoded, for the reason it is there at all: an address may contain
// characters that would otherwise split the key.
function recipientPrefix(email) { return 'log-' + encodeURIComponent(normalizeEmail(email)) + '__'; }
function pointerKey(resendId) { return 'rid-' + encodeURIComponent(str(resendId, 120)); }
function keyFor(email, at, rand) {
  return recipientPrefix(email) + (at || nowIso()) + '__' +
    (rand || Math.random().toString(36).slice(2, 10));
}

function normalizeRecord(input) {
  input = input || {};
  const at = input.sentAt || nowIso();
  return {
    id: str(input.id, 200) || keyFor(input.recipient, at),
    recipient: normalizeEmail(input.recipient),
    template: str(input.template, 60),
    // Null for anything not about one activity. It is what will let an admin
    // see one activity's mail on that activity's own row rather than reading a
    // whole history to find it.
    relatedSlug: input.relatedSlug ? str(input.relatedSlug, 80) : null,
    resendId: input.resendId ? str(input.resendId, 120) : null,
    status: STATUSES.indexOf(input.status) !== -1 ? input.status : 'sent',
    sentAt: str(at, 40),
    statusUpdatedAt: input.statusUpdatedAt ? str(input.statusUpdatedAt, 40) : str(at, 40),
    // Context an admin reading the log needs: which of three languages went
    // out, what the subject said, and whether a person pressed the button or a
    // scheduled function did.
    subject: str(input.subject, 250),
    lang: str(input.lang, 4) || 'he',
    sentBy: str(input.sentBy, 120) || 'system',
    manual: !!input.manual,
    error: input.error ? str(input.error, 300) : null
  };
}

// Record one send. Returns the record, or null when there is nowhere to write
// it. NEVER THROWS: the email has already gone.
async function record(input) {
  const store = await logStore();
  if (!store) return null;
  const rec = normalizeRecord(input);
  if (!rec.recipient || !rec.template) return null;
  try {
    await store.setJSON(rec.id, rec);
    // The pointer is written second and separately. If it fails the record is
    // still there and still readable: only the webhook's ability to update it
    // is lost, which is the smaller half.
    if (rec.resendId) {
      try { await store.setJSON(pointerKey(rec.resendId), { key: rec.id }); }
      catch (e) { console.error('[email-log] pointer failed for ' + rec.resendId + ': ' + e.message); }
    }
    return rec;
  } catch (e) {
    console.error('[email-log] could not record ' + rec.template + ' for ' + rec.recipient + ': ' + e.message);
    return null;
  }
}

// One recipient's mail, newest first. The key sorts chronologically within a
// recipient, which is what makes this a prefix scan rather than a read of the
// store — but the ordering is taken from sentAt, because two emails written in
// the same millisecond share the whole timestamp and would otherwise be ordered
// by their random tail.
async function listForRecipient(email) {
  const store = await logStore();
  if (!store) return [];
  try {
    const listing = await store.list({ prefix: recipientPrefix(email) });
    const keys = (listing.blobs || []).map((b) => b.key);
    const out = [];
    for (const k of keys) {
      try {
        const r = await store.get(k, { type: 'json' });
        if (r && r.template) out.push(r);
      } catch (e) { /* skip one unreadable entry rather than lose the history */ }
    }
    return out.sort((a, b) => {
      if (a.sentAt !== b.sentAt) return a.sentAt < b.sentAt ? 1 : -1;
      return String(a.id) < String(b.id) ? 1 : -1;
    });
  } catch (e) { return []; }
}

// Apply a webhook event. Returns what happened, so the endpoint can log a line
// saying WHY nothing changed rather than only that nothing did.
async function markStatus(resendId, status, at) {
  const store = await logStore();
  if (!store) return { ok: false, reason: 'no-store' };
  if (!resendId || STATUSES.indexOf(status) === -1) return { ok: false, reason: 'ignored' };

  let pointer = null;
  try { pointer = await store.get(pointerKey(resendId), { type: 'json' }); }
  catch (e) { return { ok: false, reason: 'unreadable' }; }
  // An email sent before this store existed, or one Resend sent that we did not
  // — a test from their dashboard. Nothing to update, and not an error.
  if (!pointer || !pointer.key) return { ok: false, reason: 'unknown-id' };

  let rec = null;
  try { rec = await store.get(pointer.key, { type: 'json' }); }
  catch (e) { return { ok: false, reason: 'unreadable' }; }
  if (!rec) return { ok: false, reason: 'unknown-id' };

  if (!supersedes(status, rec.status)) return { ok: false, reason: 'not-newer', status: rec.status };

  const updated = Object.assign({}, rec, { status: status, statusUpdatedAt: at || nowIso() });
  try { await store.setJSON(pointer.key, updated); }
  catch (e) { return { ok: false, reason: 'write-failed' }; }
  return { ok: true, record: updated };
}

// Which Resend ids are already recorded. Read from the pointer keys alone, so
// this is one listing rather than a read of every record.
async function knownResendIds() {
  const store = await logStore();
  const out = new Set();
  if (!store) return out;
  try {
    const listing = await store.list({ prefix: 'rid-' });
    for (const b of (listing.blobs || [])) {
      const id = decodeURIComponent(String(b.key).slice(4));
      if (id) out.add(id);
    }
  } catch (e) { /* an unreadable listing means nothing is known, which is safe */ }
  return out;
}

module.exports = {
  STORE, TEMPLATES, STATUSES, PROGRESS, FINAL, EVENT_STATUS,
  templateLabel, isResendable, supersedes, normalizeRecord,
  keyFor, pointerKey, recipientPrefix,
  record, listForRecipient, markStatus, knownResendIds,
  _internal: { resetStore }
};
