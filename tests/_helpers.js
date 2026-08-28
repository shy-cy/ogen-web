// Shared test scaffolding.
//
// Plain Node, no framework, nothing to install — a test that needs installing
// is a test that stops being run. Nothing here talks to GitHub or Blobs; both
// are replaced in require.cache with in-memory doubles before the module under
// test is loaded, so the real handlers run against fake storage.

const path = require('path');
const fs = require('fs');

const FN = path.join(__dirname, '..', 'netlify', 'functions');
const fnPath = (rel) => require.resolve(path.join(FN, rel));

let checks = 0;
let failures = 0;

function ok(condition, message) {
  checks++;
  if (condition) {
    console.log('  ok   ' + message);
  } else {
    failures++;
    console.log('  FAIL ' + message);
  }
}

function eq(actual, expected, message) {
  const shown = JSON.stringify(actual);
  const brief = shown && shown.length > 70 ? shown.slice(0, 67) + '…' : shown;
  ok(actual === expected, `${message}  (got ${brief})`);
}

function done() {
  console.log(`\n${checks - failures}/${checks} assertions passed`);
  process.exit(failures ? 1 : 0);
}

// --- in-memory Blobs -------------------------------------------------------

function makeBlobs() {
  const stores = new Map();
  const storeFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const data = stores.get(name);
    return {
      async get(key, opts) {
        const raw = data.get(key);
        if (raw === undefined) return null;
        return opts && opts.type === 'json' ? JSON.parse(raw) : raw;
      },
      async setJSON(key, value) { data.set(key, JSON.stringify(value)); },
      async set(key, value) { data.set(key, String(value)); },
      async delete(key) { data.delete(key); },
      async list() { return { blobs: Array.from(data.keys()).map((key) => ({ key })) }; }
    };
  };
  return {
    _stores: stores,
    requireStore: async (name) => storeFor(name),
    optionalStore: async (name) => storeFor(name)
  };
}

// --- in-memory GitHub ------------------------------------------------------
// Models the one property that matters: a commit either applies every file and
// every deletion, or it applies none of them.

function makeGithub(seedFiles) {
  const files = new Map(Object.entries(seedFiles || {}));
  const commits = [];
  let failNextCommit = null;

  return {
    _files: files,
    _commits: commits,
    _failNextCommit(err) { failNextCommit = err; },
    config: () => ({ token: 'test', repo: 'shy-cy/ogen-web', branch: 'main' }),
    async readFile(p) { return files.has(p) ? files.get(p) : null; },
    async readJson(p) { return files.has(p) ? JSON.parse(files.get(p)) : null; },
    async getRef() { return 'testsha'; },
    async commitToBranch({ files: toWrite = [], deletes = [], message }) {
      if (failNextCommit) {
        const err = failNextCommit; failNextCommit = null;
        throw err;
      }
      toWrite.forEach((f) => files.set(f.path, f.content));
      // Only paths that were actually there count as removed — the real
      // commitToBranch filters absent paths out, because GitHub 422s on a
      // null-sha entry for a path that is not in the base tree.
      const removed = deletes.filter((p) => files.delete(p));
      const sha = 'commit' + (commits.length + 1);
      commits.push({ sha, message, paths: toWrite.map((f) => f.path), removed: removed });
      return { sha, url: 'https://github.com/shy-cy/ogen-web/commit/' + sha, branch: 'main',
               paths: toWrite.map((f) => f.path), removed: removed };
    },
    async openPullRequest() { throw new Error('not used'); }
  };
}

// Install the doubles and load a freshly-required module under test.
function loadWithStubs({ github, blobs, modules }) {
  [ '_github', '_blobs', '_activity-template', '_activity-index', '_activity-index',
    '_session-store', '_user-store', '_roles', '_audit', 'activities-admin',
    'admin-login', 'admin-users' ].forEach((m) => {
    try { delete require.cache[fnPath(m)]; } catch (err) { /* not all exist in every test */ }
  });

  if (github) require.cache[fnPath('_github')] = { id: fnPath('_github'), filename: fnPath('_github'), loaded: true, exports: github };
  if (blobs) require.cache[fnPath('_blobs')] = { id: fnPath('_blobs'), filename: fnPath('_blobs'), loaded: true, exports: blobs };

  const out = {};
  (modules || []).forEach((m) => { out[m] = require(fnPath(m)); });
  return out;
}

// A session with full rights, without going through bcrypt.
function superAdminSession(overrides) {
  return Object.assign({
    token: 'test-token', email: 'michal@ogen.cy', name: 'Michal',
    role: 'super-admin', roleName: 'Super Admin',
    permissions: {
      activities: { access: true, edit: ['he', 'en', 'ru'], publish: true },
      users: { access: true }, roles: { access: true }
    },
    expiresAt: Date.now() + 3600e3
  }, overrides || {});
}

function ruReviewerSession() {
  return superAdminSession({
    token: 'ru-token', email: 'ru@ogen.cy', name: 'RU Reviewer',
    role: 'ru-reviewer', roleName: 'Russian Reviewer',
    permissions: {
      activities: { access: true, edit: ['ru'], publish: false },
      users: { access: false }, roles: { access: false }
    }
  });
}

// Seed the fake repo with the real committed activity, so tests run against
// the actual record shape rather than a hand-made fixture.
function seedRepo() {
  const record = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'activities', 'hebrew-for-kids.json'), 'utf8')
  );
  return {
    record,
    files: {
      'activities/hebrew-for-kids.json': JSON.stringify(record, null, 2) + '\n',
      'activities/activities-index.json': JSON.stringify(
        [{ slug: record.slug, status: record.status, langs: ['he', 'en', 'ru'], title: record.title }],
        null, 2
      ) + '\n',
      'activities/hebrew-for-kids.html': '<!-- he -->',
      'en/activities/hebrew-for-kids.html': '<!-- en -->',
      'ru/activities/hebrew-for-kids.html': '<!-- ru -->'
    }
  };
}

// Write a real session blob (and the user it points at) so the genuine
// _session-store.authenticate path runs, rather than being stubbed out.
async function installSession(blobs, session) {
  const sessions = await blobs.requireStore('admin-sessions');
  await sessions.setJSON('sess-' + session.token, session);
  const users = await blobs.requireStore('admin-users');
  await users.setJSON('user-' + encodeURIComponent(session.email), {
    email: session.email, name: session.name, adminRole: session.role,
    active: true, passwordHash: 'x', types: ['admin']
  });
  return session;
}

// Call a handler the way Netlify does.
async function call(handler, body) {
  const res = await handler({ httpMethod: 'POST', body: JSON.stringify(body) });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

module.exports = {
  ok, eq, done, fnPath, makeBlobs, makeGithub, loadWithStubs,
  superAdminSession, ruReviewerSession, seedRepo, call, installSession
};
