// Bug: publishing a new activity failed with
//   GitHub POST /git/trees → 422: {"message":"GitRPC::BadObjectState"}
//
// commitToBranch turns each requested deletion into a tree entry with a null
// sha. GitHub rejects the WHOLE tree if such an entry names a path that is not
// already in base_tree — you cannot delete what was never there. Every caller
// asks speculatively: generate() asks to clear the language files the activity
// does not have, and on a first publish none of them exist. So the very first
// publish of any activity that was not filled in in all three languages was
// impossible, and unpublish/delete had the same hole.
//
// The contract is now "remove these paths if present", enforced against the
// real base tree. This suite drives the REAL _github.js against a fake fetch,
// because the bug lived in the code the handler tests stub out.

const { ok, eq, done } = require('./_helpers');

// --- a small, faithful GitHub -----------------------------------------------
// Faithful in exactly the way that matters: creating a tree with a null-sha
// entry for an unknown path is a 422, the same as the live API.

function fakeGithub(existing) {
  const calls = [];
  const paths = new Set(existing);
  let blobN = 0;

  global.fetch = async (url, init) => {
    const method = (init && init.method) || 'GET';
    const route = String(url).replace('https://api.github.com/repos/shy-cy/ogen-web', '');
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ method, route, body });

    const reply = (status, obj) => ({
      ok: status < 400,
      status,
      text: async () => JSON.stringify(obj)
    });

    if (route === '/git/ref/heads/main') return reply(200, { object: { sha: 'basecommit' } });
    if (route === '/git/commits/basecommit') return reply(200, { tree: { sha: 'basetree' } });
    if (route === '/git/trees/basetree?recursive=1') {
      return reply(200, {
        truncated: false,
        tree: Array.from(paths).map((p) => ({ path: p, type: 'blob' }))
      });
    }
    if (route === '/git/blobs' && method === 'POST') return reply(200, { sha: 'blob' + ++blobN });
    if (route === '/git/trees' && method === 'POST') {
      const bad = (body.tree || []).filter((e) => e.sha === null && !paths.has(e.path));
      if (bad.length) {
        return reply(422, { message: 'GitRPC::BadObjectState' });
      }
      return reply(200, { sha: 'newtree' });
    }
    if (route === '/git/commits' && method === 'POST') return reply(200, { sha: 'newcommit' });
    if (route === '/git/refs/heads/main' && method === 'PATCH') return reply(200, {});
    return reply(404, { message: 'unexpected ' + method + ' ' + route });
  };

  return calls;
}

process.env.GITHUB_TOKEN = 'test-token';
process.env.GITHUB_REPO = 'shy-cy/ogen-web';
process.env.GITHUB_BRANCH = 'main';

delete require.cache[require.resolve('../netlify/functions/_github')];
const { commitToBranch } = require('../netlify/functions/_github');

const treeBody = (calls) => (calls.filter((c) => c.route === '/git/trees' && c.method === 'POST')[0] || {}).body;
const nulls = (calls) => ((treeBody(calls) || {}).tree || []).filter((e) => e.sha === null).map((e) => e.path);

(async () => {
  console.log('\ndeleting-an-absent-file-is-not-an-error');

  // --- the exact failure: a first publish, Hebrew only -----------------------
  {
    // Nothing for this slug exists yet. generate() still asks to clear EN + RU.
    const calls = fakeGithub(['index.html', 'activities/hebrew-for-kids.html']);
    let threw = null;
    let out = null;
    try {
      out = await commitToBranch({
        files: [{ path: 'activities/purim-workshop.html', content: '<!-- he -->', encoding: 'utf-8' }],
        deletes: ['en/activities/purim-workshop.html', 'ru/activities/purim-workshop.html'],
        message: 'Publish activity: purim-workshop'
      });
    } catch (err) {
      threw = err;
    }
    ok(!threw, 'a first Hebrew-only publish commits' + (threw ? ' — threw: ' + threw.message : ''));
    eq(nulls(calls).length, 0, 'no null-sha entry is sent for a file that never existed');
    ok(out && out.sha === 'newcommit', 'the commit went through');
    eq(JSON.stringify(out && out.removed), '[]', 'nothing is reported as removed');
    ok(
      (treeBody(calls).tree || []).some((e) => e.path === 'activities/purim-workshop.html'),
      'the Hebrew page is still in the tree'
    );
  }

  // --- a real deletion still deletes ----------------------------------------
  {
    const calls = fakeGithub([
      'activities/hebrew-for-kids.html',
      'en/activities/hebrew-for-kids.html',
      'ru/activities/hebrew-for-kids.html'
    ]);
    const out = await commitToBranch({
      files: [{ path: 'activities/index.html', content: '<!-- listing -->', encoding: 'utf-8' }],
      deletes: ['en/activities/hebrew-for-kids.html', 'ru/activities/hebrew-for-kids.html'],
      message: 'Unpublish'
    });
    eq(nulls(calls).length, 2, 'both existing files get a null-sha entry');
    ok(nulls(calls).indexOf('en/activities/hebrew-for-kids.html') !== -1, 'the EN page is removed');
    ok(nulls(calls).indexOf('ru/activities/hebrew-for-kids.html') !== -1, 'the RU page is removed');
    eq(out.removed.length, 2, 'both are reported as removed');
  }

  // --- a mixed list keeps the ones that are there ---------------------------
  {
    const calls = fakeGithub(['activities/hebrew-for-kids.html']);
    const out = await commitToBranch({
      files: [{ path: 'sitemap.xml', content: '<urlset/>', encoding: 'utf-8' }],
      deletes: [
        'activities/hebrew-for-kids.html',   // exists
        'en/activities/hebrew-for-kids.html' // does not
      ],
      message: 'Unpublish a Hebrew-only activity'
    });
    eq(JSON.stringify(nulls(calls)), JSON.stringify(['activities/hebrew-for-kids.html']),
       'only the path that exists is deleted');
    eq(JSON.stringify(out.removed), JSON.stringify(['activities/hebrew-for-kids.html']),
       'removed reports what was really removed, not what was asked for');
  }

  // --- nothing to do is a no-op, not a hollow commit -------------------------
  {
    const calls = fakeGithub(['index.html']);
    const out = await commitToBranch({
      deletes: ['en/activities/gone.html'],
      message: 'Unpublish something already gone'
    });
    ok(out.noop === true, 'an all-absent deletion is reported as a no-op');
    eq(out.sha, 'basecommit', 'the branch head is unchanged');
    eq(calls.filter((c) => c.route === '/git/trees' && c.method === 'POST').length, 0,
       'no tree is created');
    eq(calls.filter((c) => c.method === 'PATCH').length, 0, 'the ref is not moved');
  }

  // --- a truncated tree falls back to asking per path ------------------------
  {
    // A repo too big to enumerate in one response must not silently decide
    // that every path is absent — that would turn deletions into no-ops.
    const paths = new Set(['activities/hebrew-for-kids.html']);
    let perPath = 0;
    global.fetch = async (url, init) => {
      const method = (init && init.method) || 'GET';
      const route = String(url).replace('https://api.github.com/repos/shy-cy/ogen-web', '');
      const body = init && init.body ? JSON.parse(init.body) : null;
      const reply = (status, obj, raw) => ({
        ok: status < 400, status, text: async () => (raw !== undefined ? raw : JSON.stringify(obj))
      });
      if (route === '/git/ref/heads/main') return reply(200, { object: { sha: 'basecommit' } });
      if (route === '/git/commits/basecommit') return reply(200, { tree: { sha: 'basetree' } });
      if (route === '/git/trees/basetree?recursive=1') return reply(200, { truncated: true, tree: [] });
      if (route.indexOf('/contents/') === 0) {
        perPath++;
        const p = decodeURI(route.slice('/contents/'.length).split('?')[0]);
        return paths.has(p) ? reply(200, null, '<!-- he -->') : reply(404, {});
      }
      if (route === '/git/blobs' && method === 'POST') return reply(200, { sha: 'blob1' });
      if (route === '/git/trees' && method === 'POST') {
        const bad = (body.tree || []).filter((e) => e.sha === null && !paths.has(e.path));
        if (bad.length) return reply(422, { message: 'GitRPC::BadObjectState' });
        return reply(200, { sha: 'newtree' });
      }
      if (route === '/git/commits' && method === 'POST') return reply(200, { sha: 'newcommit' });
      if (route === '/git/refs/heads/main' && method === 'PATCH') return reply(200, {});
      return reply(404, { message: 'unexpected ' + route });
    };

    const out = await commitToBranch({
      files: [{ path: 'sitemap.xml', content: '<urlset/>', encoding: 'utf-8' }],
      deletes: ['activities/hebrew-for-kids.html', 'en/activities/hebrew-for-kids.html'],
      message: 'Unpublish against a truncated tree'
    });
    eq(perPath, 2, 'each path is checked individually when the tree is truncated');
    eq(JSON.stringify(out.removed), JSON.stringify(['activities/hebrew-for-kids.html']),
       'the file that exists is still removed');
  }

  done();
})();
