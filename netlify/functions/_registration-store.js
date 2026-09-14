// ogen-registrations — one blob per participant per activity.
//
//   reg-<participantId>__<activityId>
//
// PARTICIPANT FIRST, the same ordering the guardian links use and for the same
// reason: "what is this child registered for" is a prefix scan, which is the
// query a family's own page makes. The other direction — every registration for
// one activity, which is the admin queue — is one list() filtered by key suffix,
// and list() returns keys without reading a blob, so the scan is cheap and only
// the matching records are read.
//
// THE KEY CARRIES THE ACTIVITY ID, NEVER THE SLUG. A slug is a filename and a
// URL and an admin may rename one; an activityId is minted once and never
// changes. That is what Phase 1 minted it for, and it is why named groups could
// be added later without a migration — a child is in one group of one activity,
// so the group lives in the record and the key does not move.
//
// ⚠ Arms the legal gate, correctly.

const { requireStore, optionalStore } = require('./_blobs');
const { key, holdsASpot } = require('./_registration');

const STORE = 'registrations';
const PREFIX = 'reg-';

async function getRegistration(participantId, activityId) {
  if (!participantId || !activityId) return null;
  const store = await optionalStore(STORE);
  if (!store) return null;
  return store.get(key(participantId, activityId), { type: 'json' });
}

async function saveRegistration(reg) {
  const store = await requireStore(STORE);
  await store.setJSON(key(reg.participantId, reg.activityId), reg);
  return reg;
}

// A prefix scan, which is what the participant-first key shape buys.
async function forParticipant(participantId) {
  const store = await optionalStore(STORE);
  if (!store || !participantId) return [];
  const { blobs } = await store.list({ prefix: PREFIX + participantId + '__' });
  const out = [];
  for (const b of blobs) {
    const r = await store.get(b.key, { type: 'json' });
    if (r) out.push(r);
  }
  return out.sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
}

// Keys first, blobs second. The suffix match runs over key names only, so an
// activity with twelve registrations costs one list() and twelve reads rather
// than reading the whole store.
async function forActivity(activityId) {
  const store = await optionalStore(STORE);
  if (!store || !activityId) return [];
  const { blobs } = await store.list({ prefix: PREFIX });
  const suffix = '__' + activityId;
  const out = [];
  for (const b of blobs) {
    if (!b.key.endsWith(suffix)) continue;
    const r = await store.get(b.key, { type: 'json' });
    if (r) out.push(r);
  }
  return out.sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)));
}

// Every record, for the nightly sweep. Ogen registers tens of people a term, not
// tens of thousands; when that stops being true the sweep is what needs a
// pending- index, not the reads above.
async function allRegistrations() {
  const store = await optionalStore(STORE);
  if (!store) return [];
  const { blobs } = await store.list({ prefix: PREFIX });
  const out = [];
  for (const b of blobs) {
    const r = await store.get(b.key, { type: 'json' });
    if (r) out.push(r);
  }
  return out;
}

// Deleting a participant takes their registrations with it. A registration
// pointing at a participant that is gone is a row in every queue that resolves
// to nothing — and it is a child's name and date of birth in the frozen block,
// which is the half that matters.
async function removeForParticipant(participantId) {
  const store = await optionalStore(STORE);
  if (!store || !participantId) return 0;
  const { blobs } = await store.list({ prefix: PREFIX + participantId + '__' });
  for (const b of blobs) await store.delete(b.key).catch(() => {});
  return blobs.length;
}

// Convenience for the one question every caller asks after reading a list.
const spotsHeld = (regs, now) => (regs || []).filter((r) => holdsASpot(r, now)).length;

module.exports = {
  STORE, PREFIX,
  getRegistration, saveRegistration, forParticipant, forActivity,
  allRegistrations, removeForParticipant, spotsHeld
};
