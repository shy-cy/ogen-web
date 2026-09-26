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
  'infrastructure-test': { label: 'Infrastructure test', resend: true },

  // Account messages. Resendability is a judgement about the COPY, not a
  // permission: a verification link and a reset link are both things a person
  // may legitimately need again, and both mint a fresh token when they are
  // re-sent, so nothing stale is re-delivered.
  'verify-email': { label: 'Verify your email', resend: true },
  'password-reset': { label: 'Password reset link', resend: true },
  // NOT resendable. It describes a moment that has passed — "your password was
  // changed" — and arriving a second time a fortnight later it reads as a second
  // change nobody made, which is alarming in exactly the wrong direction.
  'password-changed': { label: 'Password changed', resend: false },
  // Re-sending mints a NEW token and revokes the old one, so the resend here is
  // a fresh invitation rather than a second copy of a link already in an inbox.
  'guardian-invite': { label: 'Invitation to join a child\'s record', resend: true },

  // Registration messages. Only the confirmation is resendable, and the reason
  // is the copy in each case rather than a policy: a family legitimately loses
  // "you have a place" and needs it again, whereas "we have your request",
  // "we cannot offer a place" and "we did not answer in time" all describe a
  // moment that has passed. Re-delivering a refusal a fortnight later is the
  // clearest case in this table of a resend doing harm.
  'registration-received': { label: 'Registration request received', resend: false },
  'registration-approved': { label: 'Registration confirmed', resend: true },
  'registration-rejected': { label: 'Registration not offered', resend: false },
  'registration-expired': { label: 'Registration request expired', resend: false },
  // Not resendable for the same reason a refusal is not: it describes a moment
  // that has passed, and a second copy arriving a fortnight later would read as
  // a second cancellation. It carries a figure as well, and a figure re-read out
  // of context is the one thing in this table that could be acted on wrongly.
  'registration-cancelled': { label: 'Registration cancelled', resend: false },
  // The waiting list. Neither is resendable, and the second one emphatically:
  // "a place has opened" re-delivered once it has gone sends a family to a
  // register button that will refuse them, which is worse than never writing.
  // The first describes a standing state rather than a moment, and a family who
  // has since been given a place would read it as having lost one.
  'registration-waiting': { label: 'On the waiting list', resend: false },
  'registration-place-open': { label: 'A place has opened', resend: false },
  // Not resendable: a second copy of "the group has changed" reads as a second
  // move, and the family would go looking for a third group.
  'registration-moved': { label: 'Group changed', resend: false },
  'registration-paid': { label: 'Payment received', resend: false },
  // ⚠ THIS ONE WAS MISSING, so templateLabel() fell through to the raw
  // 'registration-terms-changed' and an admin reading the log met a key rather
  // than a sentence. Not resendable: it says two dates that govern refunds have
  // moved, and a second copy a fortnight later reads as them having moved again.
  'registration-terms-changed': { label: 'Cancellation dates changed', resend: false },
  // One evening, taken off a family's list by an admin. Not resendable: it
  // names a date and a figure, and a second copy a fortnight later reads as a
  // second evening cancelled — the family would go looking for which one.
  'session-cancelled': { label: 'Session cancelled', resend: false }
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
    // ⚠ WHICH ACTIVITY THIS WAS ABOUT, AND THE ID IS THE HALF THAT RESOLVES.
    //
    // `relatedSlug` came first, described here as what "will let an admin see
    // one activity's mail on that activity's own row rather than reading a whole
    // history to find it" — and NOTHING EVER SET IT. Every record ever written
    // carries null, so the screen it was designed for could not have been built
    // from it, which is why it took building that screen to notice. Same shape
    // as the pure bundle module wired to nothing and the invite button labelled
    // with a description.
    //
    // It is the id that is matched against, never the slug, and that is the same
    // rule the registration record already states about its own frozen copy: a
    // slug is the filename and can be renamed, and following one after a rename
    // finds the wrong activity or none. So the slug stays as a LABEL — what this
    // message was about, spelled the way it was spelled at the time, audit only
    // — and the id is what a roster filters on.
    relatedActivityId: input.relatedActivityId ? str(input.relatedActivityId, 60) : null,
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
    // skipErrors, because one unreadable entry must not lose the history —
    // the one caller in this codebase that wants that, and it says why.
    const out = (await blobs.readMany(store, keys, { skipErrors: true }))
      .filter((r) => r && r.template);
    return out.sort(newestFirst);
  } catch (e) { return []; }
}

function newestFirst(a, b) {
  if (a.sentAt !== b.sentAt) return a.sentAt < b.sentAt ? 1 : -1;
  return String(a.id) < String(b.id) ? 1 : -1;
}

// How many of one recipient's messages a roster reads. The cell needs the newest
// and the panel wants recent history; twelve covers a registration's whole run
// (received, confirmed, paid) plus the account messages a family asks about most
// — the verification link and a reset. It is a bound rather than a judgement:
// this is read for every address on a roster at once, and an unbounded read is
// an admin watching a screen not answer.
const MAIL_PER_RECIPIENT = 12;

// Several recipients' mail in one pass, for a roster.
//
// ⚠ ONE PREFIX LISTING PER RECIPIENT, SEVERAL AT A TIME — deliberately not one
// listing of the whole store. A prefix is filtered by Blobs rather than by us
// and comes back in tens of keys; this store holds every email the site has ever
// sent, so after a few terms a full listing is pages of keys almost all of which
// belong to somebody who is not on this roster. That is the same reason
// `log-<recipient>__` puts the recipient first, and the same reason a guardian
// link is keyed participant-first.
//
// ⚠ AND "WE COULD NOT READ IT" IS NOT "NOTHING WAS SENT". Each recipient carries
// its own `read`, so a store having a bad minute shows as unknown rather than as
// a family we never wrote to — which is the one reading that would send an admin
// to apologise for a message that went out perfectly.
async function listForRecipients(emails, opts) {
  const per = Math.max(1, (opts && opts.perRecipient) || MAIL_PER_RECIPIENT);
  const want = [];
  const seen = new Set();
  for (const e of (emails || [])) {
    const n = normalizeEmail(e);
    if (n && !seen.has(n)) { seen.add(n); want.push(n); }
  }
  const out = {};
  for (const n of want) out[n] = { entries: [], total: 0, read: false };

  const store = await logStore();
  if (!store || !want.length) return out;

  const wanted = [];
  let next = 0;
  const lister = async () => {
    for (;;) {
      const i = next++;
      if (i >= want.length) return;
      const n = want[i];
      try {
        const listing = await store.list({ prefix: recipientPrefix(n) });
        // The key sorts chronologically within a recipient, so newest-first is a
        // sort of the KEYS — which is what lets the slice happen before anything
        // is read rather than after.
        const keys = (listing.blobs || []).map((b) => b.key).sort().reverse();
        out[n].total = keys.length;
        out[n].read = true;
        for (const key of keys.slice(0, per)) wanted.push({ recipient: n, key: key });
      } catch (e) { /* `read` stays false, which is the honest answer */ }
    }
  };
  await Promise.all(new Array(Math.min(blobs.READ_CONCURRENCY, want.length)).fill(0).map(lister));

  const recs = await blobs.readMany(store, wanted.map((w) => w.key), { skipErrors: true });
  wanted.forEach((w, i) => {
    const rec = recs[i];
    if (rec && rec.template) out[w.recipient].entries.push(rec);
  });
  for (const n of want) out[n].entries.sort(newestFirst);
  return out;
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
  record, listForRecipient, listForRecipients, markStatus, knownResendIds,
  MAIL_PER_RECIPIENT,
  _internal: { resetStore }
};
