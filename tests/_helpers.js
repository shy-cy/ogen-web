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

// ⚠ THE REAL readMany/deleteMany, NOT A SECOND COPY. They are pure functions
// over whatever store object they are handed, so the fake store can be fed to
// the genuine article — and a bug in the bounded-concurrency pool is then a
// failing suite rather than something only production meets. Requiring the real
// module here is safe: it loads @netlify/blobs lazily, inside a call.
const realBlobs = require('../netlify/functions/_blobs');

function makeBlobs(options) {
  const stores = new Map();
  // Every read costs this many milliseconds. Zero by default, so nothing pays
  // for it — but a suite that wants to prove reads OVERLAP rather than queue
  // sets it, which is the only way to tell the two apart from outside.
  const latency = (options && options.latencyMs) || 0;
  const pause = () => (latency ? new Promise((r) => setTimeout(r, latency)) : null);
  let reads = 0;
  let live = 0, peak = 0;
  const storeFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const data = stores.get(name);
    return {
      async get(key, opts) {
        reads++;
        live++; if (live > peak) peak = live;
        try {
          const wait = pause();
          if (wait) await wait;
          const raw = data.get(key);
          if (raw === undefined) return null;
          return opts && opts.type === 'json' ? JSON.parse(raw) : raw;
        } finally { live--; }
      },
      async setJSON(key, value) { data.set(key, JSON.stringify(value)); },
      async set(key, value) { data.set(key, String(value)); },
      async delete(key) { data.delete(key); },
      // Honours `prefix`, because the real one does and because almost every
      // store in this project is READ BY PREFIX — a member's email log, an
      // activity's registrations, one participant's guardian links. Ignoring it
      // here made those scans look correct while returning the whole store, so
      // a test could pass against a query that matched everything.
      async list(opts) {
        const prefix = (opts && opts.prefix) || '';
        return {
          blobs: Array.from(data.keys())
            .filter((key) => key.indexOf(prefix) === 0)
            .map((key) => ({ key }))
        };
      }
    };
  };
  return {
    _stores: stores,
    // What the reads actually did: how many there were, and how many were ever
    // in flight at once. `_peak` of 1 means they queued.
    _counts: () => ({ reads: reads, peak: peak }),
    _reset: () => { reads = 0; peak = 0; },
    requireStore: async (name) => storeFor(name),
    optionalStore: async (name) => storeFor(name),
    readMany: realBlobs.readMany,
    deleteMany: realBlobs.deleteMany,
    READ_CONCURRENCY: realBlobs.READ_CONCURRENCY,
    STORE_PREFIX: realBlobs.STORE_PREFIX
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
    CONCURRENCY: 6,
    // Same contract as the real one: bounded parallelism, results in input
    // order. Kept faithful so a handler that relies on the ordering is tested
    // against the ordering it will actually get.
    async mapConcurrent(items, limit, fn) {
      const out = new Array(items.length);
      let next = 0;
      await Promise.all(new Array(Math.min(limit, items.length)).fill(null).map(async () => {
        for (;;) {
          const i = next++;
          if (i >= items.length) return;
          out[i] = await fn(items[i], i);
        }
      }));
      return out;
    },
    async getHead() { return { commitSha: 'testsha', treeSha: 'testtree' }; },
    async readFile(p) { return files.has(p) ? files.get(p) : null; },
    async readJson(p) { return files.has(p) ? JSON.parse(files.get(p)) : null; },
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
    'admin-login', 'admin-users',
    '_account-store', '_member-session', '_account-email', '_email-shell', '_email',
    '_email-log', 'account-auth',
    '_participant-store', '_guardian-store', 'account-family', 'admin-family',
    '_registration', '_registration-store', '_registration-email',
    '_registration-sweep', '_registration-cancel', '_credit', '_credit-ledger',
    '_session-attendance', 'account-registrations', 'admin-registrations',
    'registration-sweep', '_pay-link', '_checkout', 'pay-link', '_stripe' ].forEach((m) => {
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
      users: { access: true }, roles: { access: true }, family: { access: true },
      registrations: { access: true, approve: true, cancel: true }
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
      users: { access: false }, roles: { access: false }, family: { access: false },
      registrations: { access: false, approve: false, cancel: false }
    }
  });
}

// Seed the fake repo with a real published activity, so tests run against the
// actual record shape rather than a hand-made one.
//
// It is PINNED in tests/fixtures/, not read from activities/. It used to be
// read live, which meant the whole suite depended on a particular activity
// still existing — and six suites broke the day hebrew-for-kids was deleted,
// which is a normal thing for an admin to do and must not be able to break the
// tests. The fixture is that record as it was last published (commit 973084f):
// still real data, just no longer a moving target. Re-pin it from a current
// record if the shape changes.
function seedRepo() {
  const record = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'activity-record.json'), 'utf8')
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

// ⚠ CONFIRM AN ADDRESS, because registering for a COURSE now needs one.
//
// The gate used to sit at payment, so every fixture in this directory signed up
// and registered without ever touching it. Moving it to the front of a course
// registration broke nine suites at once, which is the clearest evidence it
// bites — and the right fix is one helper rather than nine copies of the same
// two lines, because the next suite would copy the ninth.
//
// It writes the record directly rather than going through the verify token: a
// suite about capacity or about the ledger should not have to mint and redeem
// an email link to get to its subject.
// Pass `false` to clear it again, which is how a suite reaches a registration
// that exists on an unconfirmed account: one taken before the gate moved to the
// front. That state is not creatable through the handlers any more, and it is
// exactly what the gates further down still defend.
async function confirmAddress(blobs, accountId, on) {
  const store = await blobs.requireStore('accounts');
  const raw = await store.get('acct-' + accountId);
  const account = JSON.parse(raw);
  account.emailVerifiedAt = on === false ? null : new Date().toISOString();
  await store.setJSON('acct-' + accountId, account);
  return account;
}

// Sign up AND confirm the address, which is what a suite about something else
// wants. A suite whose SUBJECT is the gate signs up with plain `call` and
// leaves the address unconfirmed.
async function signUp(auth, blobs, body) {
  const res = await call(auth.handler, Object.assign({ action: 'signup', password: 'password-123',
                                                       termsAccepted: true }, body));
  if (res.body && res.body.account) await confirmAddress(blobs, res.body.account.accountId);
  return res;
}

// ⚠ THE ADMIN RUNTIME NOW INCLUDES js/admin-help.js, so a VM executing admin
// client code has to provide it exactly as it provides `document`.
//
// Every explanation in the admin is an (i) beside its label rather than a
// paragraph under it, and the builder lives in one file loaded by all five admin
// pages. A VM that left `window` undefined would throw the moment a field with a
// hint is drawn — which is the right failure: a silent fallback that returned the
// label unchanged would let a page ship with every explanation missing and every
// test still green.
function adminHelpWindow(makeNode) {
  return {
    AdminHelp: {
      badge: function (text) {
        var n = makeNode('button');
        n.className = 'help';
        n.textContent = 'i';
        n._helpText = String(text == null ? '' : text);
        return n;
      },
      setText: function (n, text) { if (n) n._helpText = String(text == null ? '' : text); },
      wire: function () {},
      close: function () {}
    }
  };
}

// Call a handler the way Netlify does.
async function call(handler, body) {
  const res = await handler({ httpMethod: 'POST', body: JSON.stringify(body) });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

module.exports = {
  ok, eq, done, fnPath, makeBlobs, makeGithub, loadWithStubs,
  superAdminSession, ruReviewerSession, seedRepo, call, installSession, confirmAddress, signUp,
  adminHelpWindow
};
