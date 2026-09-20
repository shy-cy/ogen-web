// Participants: the people who attend. Blobs store `ogen-participants`, keyed
// part-<participantId>.
//
// A PARTICIPANT, NOT A CHILD. The brief called it "User (child)", but a guardian
// must be able to register themselves, and that leaves two shapes: a second
// parallel entity for adults, or one entity that happens usually to be a child.
// One entity. It has a name, a date of birth and a stable id, and it makes no
// claim about age — so a guardian registering themselves creates a participant
// for themselves, and the age flag, the frozen-details pattern and the capacity
// count all work unchanged with no attendeeType branch anywhere except wording.
//
// IT IS ITS OWN RECORD, and that is the sharpest divergence from the sister
// project, which holds household members as a familyMembers[] array inside the
// member record. There they have no identity outside one account, which makes
// "linked to two guardians" literally unrepresentable. Here the link is a
// separate record precisely so it can be.
//
// AGE IS DERIVED, NEVER STORED. dateOfBirth is the source of truth and ageAt()
// computes from it. A stored age is wrong from the day after it is written, and
// age now annotates an approval queue — so a stale one would mislabel a child as
// in or out of range for a year at a time.
//
// ⚠ Arms the legal gate, correctly. This record is a minor's name and date of
// birth, held in the EU. It is the reason the gate exists.

const crypto = require('crypto');
const { requireStore, optionalStore } = require('./_blobs');

const STORE = 'participants';

// p- so a participant id is distinguishable at a glance from an account's a-
// and an activity's act-, with no lookup needed to tell what a key refers to.
const mintParticipantId = () => 'p-' + crypto.randomBytes(8).toString('hex');
const key = (id) => 'part-' + String(id);

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// A real calendar date, in the past, and not implausibly far in it. The upper
// bound is today: a date of birth in the future is a typo every time, and
// catching it here is cheaper than an age flag reading "-3".
function validDateOfBirth(value, now) {
  const m = ISO_DATE.exec(String(value || '').trim());
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return false;
  const today = now == null ? Date.now() : now;
  if (t > today) return false;
  return y >= 1900;
}

// Whole years at a moment, counting birthdays rather than dividing by 365.25 —
// which is off by a day for anyone born near the end of February in the years
// around a leap year, and "11 not 12" is exactly the difference an age flag
// turns on.
//
// Returns null when there is no usable date, and that null is meaningful: a
// missing date of birth is NOT a blocker, it sets the flag to "unknown" and the
// registration proceeds. The alternative was choosing between refusing the
// registration and letting it through unflagged, and neither is right.
function ageAt(dateOfBirth, at) {
  const m = ISO_DATE.exec(String(dateOfBirth || '').trim());
  if (!m) return null;
  const birth = { y: +m[1], mo: +m[2], d: +m[3] };
  const when = at instanceof Date ? at : new Date(at == null ? Date.now() : at);
  if (isNaN(when.getTime())) return null;
  let age = when.getUTCFullYear() - birth.y;
  const month = when.getUTCMonth() + 1;
  const day = when.getUTCDate();
  if (month < birth.mo || (month === birth.mo && day < birth.d)) age -= 1;
  return age < 0 ? null : age;
}

// Is this participant inside an activity's stated range, at a moment?
//
// ADVISORY ONLY. It annotates the approval queue — "outside the stated range
// 6-10: this child is 12" — and the admin decides, exactly as for every other
// registration. It is not a gate, and nothing here rejects anything.
//
// inRange: true | false | null, where null means "there is nothing to say" —
// either no date of birth, or an activity with no stated range. Those are not
// special cases to branch on; they are the same answer.
function ageFlag(participant, ages, at) {
  const age = ageAt(participant && participant.dateOfBirth, at);
  const min = ages && ages.min != null && ages.min !== '' ? Number(ages.min) : null;
  const max = ages && ages.max != null && ages.max !== '' ? Number(ages.max) : null;

  if (age == null) {
    return { age: null, min: min, max: max, inRange: null, reason: 'no-date-of-birth' };
  }
  if (min == null && max == null) {
    return { age: age, min: null, max: null, inRange: null, reason: 'no-stated-range' };
  }
  const belowMin = min != null && age < min;
  const aboveMax = max != null && age > max;
  return {
    age: age, min: min, max: max,
    inRange: !belowMin && !aboveMax,
    reason: belowMin ? 'below-minimum' : aboveMax ? 'above-maximum' : 'in-range'
  };
}

// `notes` may hold allergies or medical information, which is health data and
// raises the bar under GDPR. It is capped and never indexed, and nothing
// derives anything from it — but the field being here is a decision that the
// privacy policy has to keep describing.
function publicParticipant(p) {
  if (!p) return null;
  return {
    participantId: p.participantId,
    firstName: p.firstName || '',
    lastName: p.lastName || '',
    dateOfBirth: p.dateOfBirth || '',
    primaryAccountId: p.primaryAccountId || null,
    notes: p.notes || '',
    createdAt: p.createdAt || null,
    isoUpdated: p.isoUpdated || null
  };
}

async function getParticipant(participantId) {
  if (!participantId) return null;
  const store = await optionalStore(STORE);
  if (!store) return null;
  return (await store.get(key(participantId), { type: 'json' })) || null;
}

async function saveParticipant(record) {
  const store = await requireStore(STORE);
  record.isoUpdated = new Date().toISOString();
  await store.setJSON(key(record.participantId), record);
  return record;
}

// A refusal a caller can render. ⚠ THE CODE IS WHAT TRAVELS, not the sentence:
// a store has no business knowing which language a browser is set to, and the
// message is a fallback for a log. _family-errors.js turns the code into a
// sentence in the reader's own language.
const fail = (code, message) => {
  const err = new Error(message);
  err.code = code;
  return err;
};

function validate(input) {
  const first = String((input && input.firstName) || '').trim();
  if (!first) throw fail('first-name-required', 'A first name is required');
  if (!validDateOfBirth(input && input.dateOfBirth)) {
    throw fail('dob-required', 'A date of birth is required, as YYYY-MM-DD, and it cannot be in the future');
  }
}

async function createParticipant(input, creatorAccountId) {
  if (!creatorAccountId) throw fail('participant-needs-account', 'A participant needs an account to belong to');
  validate(input);
  const now = new Date().toISOString();
  const record = {
    participantId: mintParticipantId(),
    firstName: String(input.firstName).trim().slice(0, 80),
    lastName: String((input.lastName || '')).trim().slice(0, 80),
    // SOURCE OF TRUTH. Age is computed from this and never written down.
    dateOfBirth: String(input.dateOfBirth).trim(),
    // PRIMACY LIVES HERE, not on the link records. One field on one record makes
    // "exactly one primary" a local invariant with a single writer; spread
    // across two links it would be an invariant across two blobs with no
    // transaction to hold it.
    primaryAccountId: creatorAccountId,
    notes: String((input.notes || '')).trim().slice(0, 2000),
    createdAt: now,
    isoUpdated: now
  };
  await saveParticipant(record);
  return publicParticipant(record);
}

async function updateParticipant(participantId, patch) {
  const record = await getParticipant(participantId);
  if (!record) throw fail('no-such-participant', 'No such participant');
  const next = patch || {};
  if (next.firstName != null) {
    const v = String(next.firstName).trim();
    if (!v) throw fail('first-name-required', 'A first name is required');
    record.firstName = v.slice(0, 80);
  }
  if (next.lastName != null) record.lastName = String(next.lastName).trim().slice(0, 80);
  if (next.dateOfBirth != null) {
    if (!validDateOfBirth(next.dateOfBirth)) {
      throw fail('dob-required', 'A date of birth is required, as YYYY-MM-DD, and it cannot be in the future');
    }
    record.dateOfBirth = String(next.dateOfBirth).trim();
  }
  if (next.notes != null) record.notes = String(next.notes).trim().slice(0, 2000);
  await saveParticipant(record);
  return publicParticipant(record);
}

// Only an admin path deletes a participant. A guardian removing a child from
// their own view is an unlink, which is a different thing: the record may still
// be linked to the other guardian.
async function deleteParticipant(participantId) {
  const store = await optionalStore(STORE);
  if (store) await store.delete(key(participantId)).catch(() => {});
}

module.exports = {
  STORE, mintParticipantId, validDateOfBirth, ageAt, ageFlag, publicParticipant,
  getParticipant, saveParticipant, createParticipant, updateParticipant, deleteParticipant,
  _keys: { key }
};
