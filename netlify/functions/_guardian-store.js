// Who may see and act for a participant, and how a second guardian gets there.
//
//   ogen-guardian-links    link-<participantId>__<accountId>
//   ogen-guardian-invites  inv-<token>
//
// PARTICIPANT FIRST IN THE LINK KEY, and that ordering is load-bearing rather
// than aesthetic: "who are this participant's guardians" becomes a prefix scan,
// and that is the query the max-of-two rule is enforced with, so it has to be
// exact. The other direction — "which participants does this account have" — is
// one list() filtered by key suffix, and keys come back without reading a blob,
// so at Ogen's scale it costs one call and zero reads. Revisit past a few
// thousand links.
//
// Primacy is NOT here. primaryAccountId lives on the participant, so "exactly
// one primary" is one field with one writer rather than an invariant spread
// across two blobs with no transaction to hold it.
//
// THE INVITE IS BOUND TO THE ADDRESS IT WAS SENT TO. The token is a bearer
// secret sitting in an inbox, and without that binding a forwarded link hands a
// stranger access to a child's record. The cost is real — a guardian whose
// account is under a different address cannot accept — and the escape hatch
// already exists rather than needing inventing: an admin adds them directly.
//
// ⚠ Arms the legal gate, correctly.

const crypto = require('crypto');
const { requireStore, optionalStore } = require('./_blobs');

const LINKS = 'guardian-links';
const INVITES = 'guardian-invites';

// Two guardians. Not a configurable number: the shape of the invite flow, the
// unlink refusal and the reassign-on-unlink rule all assume that when a removal
// is permitted there is exactly one other guardian to move things to.
const MAX_GUARDIANS = 2;

// Thirty days, not the fourteen a registration gets. These go to people who may
// not open their email for a fortnight, and a link that has quietly died is
// indistinguishable from a site that does not work.
const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const linkKey = (participantId, accountId) => 'link-' + participantId + '__' + accountId;
const invKey = (token) => 'inv-' + token;
const mintInviteToken = () => crypto.randomBytes(32).toString('base64url');

const ADDED_VIA = ['creator', 'invite', 'admin'];

// --- links -----------------------------------------------------------------

async function guardiansOf(participantId) {
  const store = await optionalStore(LINKS);
  if (!store || !participantId) return [];
  const { blobs } = await store.list({ prefix: 'link-' + participantId + '__' });
  const out = [];
  for (const b of blobs) {
    const row = await store.get(b.key, { type: 'json' });
    if (row) out.push(row);
  }
  return out.sort((a, b) => String(a.addedAt).localeCompare(String(b.addedAt)));
}

// Keys only. list() returns them without reading a blob, so this is one call
// and no reads — which is why the participant-first key shape is worth the
// slightly awkward suffix match here.
async function participantIdsFor(accountId) {
  const store = await optionalStore(LINKS);
  if (!store || !accountId) return [];
  const { blobs } = await store.list({ prefix: 'link-' });
  const suffix = '__' + accountId;
  return blobs
    .map((b) => b.key)
    .filter((k) => k.endsWith(suffix))
    .map((k) => k.slice('link-'.length, k.length - suffix.length));
}

// The link itself, for the one caller that needs more than "is there one" —
// the family list, which asks each link whether that participant is the reader.
async function getLink(participantId, accountId) {
  if (!participantId || !accountId) return null;
  const store = await optionalStore(LINKS);
  if (!store) return null;
  return (await store.get(linkKey(participantId, accountId), { type: 'json' })) || null;
}

async function isGuardian(participantId, accountId) {
  if (!participantId || !accountId) return false;
  const store = await optionalStore(LINKS);
  if (!store) return false;
  return !!(await store.get(linkKey(participantId, accountId), { type: 'json' }));
}

// Throws when the participant already has two guardians. Checked HERE rather
// than only at the point an invite is sent, because an admin may have added
// somebody in between — the invite was valid when it left and is not when it
// arrives.
// IS THIS PARTICIPANT THE ACCOUNT HOLDER THEMSELVES? It lives on the LINK and
// not on the participant, because it is a fact about a pair rather than about a
// person: a couple who each manage the other's record are each "self" on one of
// the two links and not on the other. Put on the participant it would have to
// name an account, which is primacy's job and already has a home.
//
// It changes nothing about what a participant IS — no attendeeType branch, no
// second entity, no different validation. A guardian registering themselves has
// always worked; this is only what lets the screen stop calling them a child.
async function addLink({ participantId, accountId, addedVia, addedBy, inviteId, isSelf }) {
  if (!participantId || !accountId) {
    // Coded like every other refusal here, so account-family.js can render it
    // in the reader's own language rather than passing err.message through.
    const err = new Error('A link needs a participant and an account');
    err.code = 'link-needs-both';
    throw err;
  }
  const via = ADDED_VIA.indexOf(addedVia) !== -1 ? addedVia : 'admin';

  if (await isGuardian(participantId, accountId)) {
    const err = new Error('That account is already a guardian for this participant');
    err.code = 'already-linked';
    throw err;
  }
  const existing = await guardiansOf(participantId);
  if (existing.length >= MAX_GUARDIANS) {
    const err = new Error(`A participant can have at most ${MAX_GUARDIANS} guardians`);
    err.code = 'max-guardians';
    throw err;
  }

  const record = {
    participantId: participantId,
    accountId: accountId,
    addedVia: via,
    addedAt: new Date().toISOString(),
    addedBy: addedBy || null,
    inviteId: inviteId || null,
    isSelf: isSelf === true
  };
  const store = await requireStore(LINKS);
  await store.setJSON(linkKey(participantId, accountId), record);
  return record;
}

async function removeLink(participantId, accountId) {
  const store = await optionalStore(LINKS);
  if (store) await store.delete(linkKey(participantId, accountId)).catch(() => {});
}

// Every link for a participant, for the delete path. A participant record going
// away must not leave links pointing at nothing.
async function removeAllLinks(participantId) {
  const store = await optionalStore(LINKS);
  if (!store) return 0;
  const rows = await guardiansOf(participantId);
  for (const r of rows) await store.delete(linkKey(participantId, r.accountId)).catch(() => {});
  return rows.length;
}

// --- invites ---------------------------------------------------------------

const LIVE = 'pending';

// Marked expired LAZILY, on the first read after expiresAt, so no scheduled job
// is needed for it. An unaccepted invite grants nothing in the meantime — no
// link exists until acceptance — so the status is bookkeeping for a person
// reading a list, not a safety mechanism.
function withExpiry(invite) {
  if (!invite) return null;
  if (invite.status === LIVE && invite.expiresAt && Date.now() > Date.parse(invite.expiresAt)) {
    return Object.assign({}, invite, { status: 'expired' });
  }
  return invite;
}

async function getInvite(token) {
  if (!token) return null;
  const store = await optionalStore(INVITES);
  if (!store) return null;
  return withExpiry(await store.get(invKey(token), { type: 'json' }));
}

async function saveInvite(invite) {
  const store = await requireStore(INVITES);
  await store.setJSON(invKey(invite.token), invite);
  return invite;
}

async function invitesFor(participantId) {
  const store = await optionalStore(INVITES);
  if (!store) return [];
  const { blobs } = await store.list({ prefix: 'inv-' });
  const out = [];
  for (const b of blobs) {
    const inv = await store.get(b.key, { type: 'json' });
    if (inv && inv.participantId === participantId) out.push(withExpiry(inv));
  }
  return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

const isLive = (inv) => !!inv && inv.status === LIVE;

// Re-sending mints a NEW token and revokes the old one, so a forwarded copy of
// the previous link stops working. That is the whole reason re-send is not just
// "send the same email again".
async function revokeInvite(token, byAccountId) {
  const invite = await getInvite(token);
  if (!invite) return null;
  if (invite.status === 'accepted') return invite;
  invite.status = 'revoked';
  invite.revokedAt = new Date().toISOString();
  invite.revokedBy = byAccountId || null;
  return saveInvite(invite);
}

async function createInvite({ participantId, invitedEmail, invitedByAccountId }) {
  const email = String(invitedEmail || '').trim().toLowerCase();
  const now = Date.now();
  const invite = {
    // The token IS the key, so validating a link is one read with no scan.
    token: mintInviteToken(),
    participantId: participantId,
    // Lowercased, and the acceptance check compares against it. An invite is
    // bound to the address it was sent to.
    invitedEmail: email,
    invitedByAccountId: invitedByAccountId,
    status: LIVE,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + INVITE_TTL_MS).toISOString(),
    acceptedAt: null,
    acceptedByAccountId: null
  };
  return saveInvite(invite);
}

async function acceptInvite(token, account) {
  const invite = await getInvite(token);
  if (!invite) {
    const err = new Error('That invitation link is not valid.');
    err.code = 'invite-unknown';
    throw err;
  }
  if (invite.status !== LIVE) {
    // ⚠ WRITTEN OUT, NOT BUILT WITH `'invite-' + invite.status`. A computed
    // code can name a message that does not exist — add a fourth status and
    // the family gets the generic apology with nothing saying why — and it is
    // invisible to the check that reads the keys off the source, which is what
    // stops a message becoming dead copy in three languages. The default is the
    // expiry, which is the only one of the three worth asking for a new link
    // about.
    const code = invite.status === 'accepted' ? 'invite-accepted'
               : invite.status === 'revoked' ? 'invite-revoked'
               : 'invite-expired';
    const err = new Error(
      code === 'invite-accepted' ? 'That invitation has already been accepted.'
      : code === 'invite-revoked' ? 'That invitation was withdrawn.'
      : 'That invitation has expired. Ask for a new one.');
    err.code = code;
    throw err;
  }
  // THE BINDING. Without it a forwarded link hands a stranger access to a
  // child's record, and the token is a bearer secret sitting in an inbox.
  if (String(account.email || '').toLowerCase() !== invite.invitedEmail) {
    const err = new Error(
      'This invitation was sent to a different email address. ' +
      'Sign in with that address, or ask Ogen to add you directly.');
    err.code = 'invite-wrong-account';
    throw err;
  }

  // Re-checked HERE as well as when the invite was sent. An admin may have added
  // somebody in between, and addLink throws on both counts.
  const link = await addLink({
    participantId: invite.participantId,
    accountId: account.accountId,
    addedVia: 'invite',
    addedBy: invite.invitedByAccountId,
    inviteId: invite.token
  });

  invite.status = 'accepted';
  invite.acceptedAt = new Date().toISOString();
  invite.acceptedByAccountId = account.accountId;
  await saveInvite(invite);
  return link;
}

module.exports = {
  LINKS, INVITES, MAX_GUARDIANS, INVITE_TTL_MS, ADDED_VIA,
  guardiansOf, participantIdsFor, isGuardian, getLink, addLink, removeLink, removeAllLinks,
  getInvite, invitesFor, createInvite, acceptInvite, revokeInvite, saveInvite, isLive,
  _keys: { linkKey, invKey }
};
