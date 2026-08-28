// The only place a Netlify Blobs store is opened.
//
// Prefers explicit siteID + token over the automatic runtime context: the
// automatic context can resolve to a non-durable deploy-scoped store, which
// looks like it works and then loses everything on the next deploy.

// Every store name is prefixed with the project, so Ogen's admin data can
// never share a namespace with another project's.
//
// This is not hypothetical: during setup, the credentials configured here
// reached a store that already held another site's `admin-users`,
// `page-drafts` and `admin-audit` entries. Un-prefixed, that would have let
// that site's admin accounts sign into the Ogen admin and publish to the Ogen
// repo. Prefixing removes the possibility whatever the credentials resolve to.
const STORE_PREFIX = 'ogen-';

const SITE_ID = process.env.NETLIFY_BLOBS_SITE_ID || process.env.SITE_ID;
const TOKEN = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN;

let getStore = null;
async function loadGetStore() {
  if (!getStore) ({ getStore } = await import('@netlify/blobs'));
  return getStore;
}

function opts(name) {
  const base = { name: STORE_PREFIX + name, consistency: 'strong' };
  if (SITE_ID && TOKEN) return Object.assign(base, { siteID: SITE_ID, token: TOKEN });
  return base;
}

// Use where a misconfiguration should surface loudly — i.e. writes.
async function requireStore(name) {
  if (!SITE_ID || !TOKEN) {
    // Fall through to the ambient context, but say so clearly if it also fails.
    try {
      const g = await loadGetStore();
      return g(opts(name));
    } catch (err) {
      throw new Error(
        `Blobs store "${name}" unavailable. Set NETLIFY_BLOBS_SITE_ID and ` +
        `NETLIFY_BLOBS_TOKEN (netlify env:set). Underlying error: ${err.message}`
      );
    }
  }
  const g = await loadGetStore();
  return g(opts(name));
}

// Use where the path should degrade quietly — reads, best-effort writes.
async function optionalStore(name) {
  try {
    return await requireStore(name);
  } catch (err) {
    console.warn(`[blobs] store "${name}" unavailable: ${err.message}`);
    return null;
  }
}

module.exports = { requireStore, optionalStore, STORE_PREFIX };
