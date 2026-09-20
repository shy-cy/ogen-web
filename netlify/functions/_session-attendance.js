// ogen-session-attendance — one blob per participant per evening.
//
//   att-<participantId>__<activityId>__<YYYY-MM-DD>       drop-in only
//
// ONE SMALL RECORD, NOT A LIST ON THE REGISTRATION. Hanging session charges off
// the registration is the obvious move and is wrong for a reason this design has
// already met twice: it makes the registration a hot blob rewritten every week,
// on a store with no compare-and-swap, so two writes on the same evening lose
// one silently. Separate keys make that impossible rather than unlikely — the
// same argument that made a registration one-per-participant instead of an
// attendees[] array, and that made capacity counted rather than decremented.
//
// Nothing contends here: two admins marking two different evenings touch two
// different keys, and two families booking the same evening touch two more.
//
// THE DATE IS IN THE KEY, not an id, because a session is identified by when it
// happened — and it makes the register for one evening readable from a list()
// without opening a single blob.
//
// Participant first, so a family's own history is a prefix scan; the register
// for one evening is the list()-and-filter-by-suffix trick used twice already.
//
// IT REUSES THE PAYMENT VOCABULARY of the registration deliberately —
// owedCents, paidCents, status, creditedCents — so the credit ledger, the
// reminders and the admin views work against one shape rather than learning a
// second.
//
// ⚠ Arms the legal gate, correctly.

const { requireStore, optionalStore } = require('./_blobs');
const credit = require('./_credit');
const groups = require('./_activity-groups');
const R = require('./_registration');

const STORE = 'session-attendance';
const PREFIX = 'att-';

// booked  — coming, and holding a place on that evening
// attended— came
// no-show — did not come, and the money question is answered by the payment on
//           this record rather than by the status
// cancelled — told us in advance; releases the place immediately, because the
//           count reads the status rather than a decremented number
const STATUSES = ['booked', 'attended', 'no-show', 'cancelled'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const key = (participantId, activityId, date) =>
  PREFIX + participantId + '__' + activityId + '__' + date;

const eur = (v) => (v == null || v === '' ? 0 : Math.max(0, Math.round(Number(v) * 100)) || 0);

async function getAttendance(participantId, activityId, date) {
  if (!participantId || !activityId || !date) return null;
  const store = await optionalStore(STORE);
  if (!store) return null;
  return store.get(key(participantId, activityId, date), { type: 'json' });
}

async function saveAttendance(att) {
  const store = await requireStore(STORE);
  att.isoUpdated = new Date().toISOString();
  await store.setJSON(key(att.participantId, att.activityId, att.sessionDate), att);
  return att;
}

// One family's own history, in date order. The prefix scan the key shape buys.
async function forParticipant(participantId, activityId) {
  const store = await optionalStore(STORE);
  if (!store || !participantId) return [];
  const prefix = PREFIX + participantId + '__' + (activityId ? activityId + '__' : '');
  const { blobs } = await store.list({ prefix: prefix });
  const out = [];
  for (const b of blobs) {
    const a = await store.get(b.key, { type: 'json' });
    if (a) out.push(a);
  }
  return out.sort((a, b) => String(a.sessionDate).localeCompare(String(b.sessionDate)));
}

// Every booking for one activity. Keys first — the suffix match runs over names
// only, so nothing is opened that is not wanted.
async function forActivity(activityId, sessionDate) {
  const store = await optionalStore(STORE);
  if (!store || !activityId) return [];
  const { blobs } = await store.list({ prefix: PREFIX });
  const suffix = '__' + activityId + '__' + (sessionDate || '');
  const out = [];
  for (const b of blobs) {
    if (sessionDate ? !b.key.endsWith(suffix) : b.key.indexOf('__' + activityId + '__') === -1) continue;
    const a = await store.get(b.key, { type: 'json' });
    if (a) out.push(a);
  }
  return out.sort((a, b) => String(a.sessionDate).localeCompare(String(b.sessionDate)));
}

// The register for one evening, which is what an admin opens on the night.
const forDate = (activityId, sessionDate) => forActivity(activityId, sessionDate);

// Which dates this activity actually meets on, from the calendar that is already
// the source of truth. An excluded date never appears, so it cannot be booked.
// ⚠ WHICH EVENINGS THIS PARTICIPANT MAY BOOK, which is a per-group question the
// moment the groups keep their own calendars — offering a Beginners family the
// Advanced dates is offering them a room they are not counted in.
//
// `groups.ANY` is the honest answer for a caller with no participant in hand:
// the codes an admin prints for the wall cover every evening the activity runs,
// whoever is coming to it.
function bookableDates(activity, groupId) {
  return groups.calendarFor(activity, groupId)
    .filter((r) => r && r.date && r.status !== 'excluded')
    .map((r) => r.date);
}

function validate(activity, sessionDate) {
  if ((activity && activity.type) !== 'dropin') {
    return 'Sessions are booked one at a time only on a pay-per-session activity.';
  }
  if (!ISO_DATE.test(String(sessionDate || ''))) return 'A session is identified by its date.';
  if (bookableDates(activity).indexOf(sessionDate) === -1) {
    return 'This activity does not meet on that date.';
  }
  return null;
}

// What one evening costs, frozen at booking. The price is frozen for the same
// reason a term price is: an admin raising it in March must not change what a
// family already booked in January owes.
function newAttendance({ activity, participantId, accountId, groupId, sessionDate,
                         resolveSessionInstant, bookedAt, bundle, bundleId }) {
  const now = new Date().toISOString();
  // ⚠ `bookedAt` IS WHAT MAKES LATE PRICING REAL. priceForSession() needs to
  // know when the booking was made to tell a late one from an ordinary one, and
  // without it every booking prices as standard — so a screen showing the late
  // price and a booking charging the standard one would disagree about the same
  // evening. It is passed in rather than read from the clock here for the reason
  // the whole of _credit.js is: the same record and the same instant must give
  // the same figure a year later.
  const frozen = credit.freezeSession(activity, sessionDate, resolveSessionInstant, {
    bookedAt: bookedAt || now, bundle: bundle || false, bundleId: bundleId || null,
    // WHICH CALENDAR THIS EVENING IS ON. The groupId was already here, naming
    // which room the place is counted against; it names the timetable too now,
    // because two groups can meet on different evenings at different hours.
    groupId: groupId || null
  });
  const owed = eur(frozen.perSessionPrice);
  return {
    participantId: participantId,
    activityId: activity.activityId,
    sessionDate: sessionDate,
    // WHO OWES for THIS session — the account that booked it, which need not be
    // the account that registered the participant in the first place.
    accountId: accountId,
    groupId: groupId || null,
    status: 'booked',
    frozen: frozen,
    payment: {
      owedCents: owed, paidCents: 0, currency: 'EUR',
      status: owed > 0 ? 'owed' : 'paid',
      paidAt: null, creditedCents: 0, creditedToAccountId: null
    },
    history: [{ iso: now, action: 'booked', by: accountId, note: null }],
    createdAt: now,
    isoUpdated: now
  };
}

// Every change goes through here, so the history is written by the same code
// that writes the status and cannot be forgotten at one call site.
function transition(att, { status, by, note }) {
  const iso = new Date().toISOString();
  const next = Object.assign({}, att, { status: status, isoUpdated: iso });
  next.history = (att.history || []).concat([{ iso: iso, action: status, by: by || null, note: note || null }]);
  return next;
}

// Deleting a participant takes their sessions with it, the same as their
// registrations — a booking pointing at a participant that is gone is a name on
// a register that resolves to nothing.
async function removeForParticipant(participantId) {
  const store = await optionalStore(STORE);
  if (!store || !participantId) return 0;
  const { blobs } = await store.list({ prefix: PREFIX + participantId + '__' });
  for (const b of blobs) await store.delete(b.key).catch(() => {});
  return blobs.length;
}

// How full one evening is. The counting rule lives in _registration.js beside
// the term one, so the two cannot drift apart about what "a place" means.
const capacityForDate = R.capacityForDate;

module.exports = {
  STORE, PREFIX, STATUSES,
  getAttendance, saveAttendance, forParticipant, forActivity, forDate,
  bookableDates, validate, newAttendance, transition, removeForParticipant,
  capacityForDate, _keys: { key }
};
