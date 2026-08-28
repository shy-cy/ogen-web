// Best-effort audit trail in the Blobs store `admin-audit`, keyed
// <ISO>-<slug>-<rand> so entries sort chronologically and two writes in the
// same millisecond cannot overwrite each other.
//
// Audit failures must never block the action they describe.

const { optionalStore } = require('./_blobs');

async function recordAudit(session, action, target, outcome, extra) {
  try {
    const store = await optionalStore('admin-audit');
    if (!store) return;
    const iso = new Date().toISOString();
    const rand = Math.random().toString(36).slice(2, 8);
    const entry = Object.assign({
      iso,
      action,
      target: target || null,
      outcome: outcome || 'ok',
      email: session ? session.email : null,
      name: session ? session.name : null,
      role: session ? session.role : null
    }, extra || {});
    await store.setJSON(`${iso}-${String(target || 'none')}-${rand}`, entry);
  } catch (err) {
    console.warn('[audit] could not record entry:', err.message);
  }
}

async function listAudit(limit) {
  const store = await optionalStore('admin-audit');
  if (!store) return [];
  const { blobs } = await store.list();
  const keys = blobs.map((b) => b.key).sort().reverse().slice(0, limit || 100);
  const out = [];
  for (const k of keys) {
    const e = await store.get(k, { type: 'json' });
    if (e) out.push(e);
  }
  return out;
}

module.exports = { recordAudit, listAudit };
