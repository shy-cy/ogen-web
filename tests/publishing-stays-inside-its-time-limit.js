// The problem this defends against:
//
// Netlify kills a function at ten seconds. Publishing hebrew4kids — four images
// and seven text files — took eight, and every teacher or sponsor added to an
// activity pushed it closer. There was nothing wrong with the code; it just
// asked GitHub for things one at a time: two calls to find the head of the
// branch, then one POST per file to create its blob, each waiting on the last.
//
// The failure mode is nasty. The commit lands and the response never arrives,
// so the admin sees a publish that silently did nothing — which is exactly what
// happened, and is why js/activities-admin.js now reports timeouts explicitly.
//
// The fix is to stop making requests that do not need making:
//
//   - text files carry their content INLINE in the tree, so a page, a record, a
//     sitemap and three listing pages cost ZERO requests between them;
//   - images, which must go through the blobs endpoint because inline content
//     is UTF-8 only, go up concurrently;
//   - /branches/<name> returns the head commit AND its tree, replacing two
//     sequential calls with one.
//
// What this pins is the shape of that: request COUNT, not wall-clock, because
// wall-clock in a test measures the machine it runs on. The property that
// matters is that adding content stops adding round trips.

const { ok, eq, done } = require('./_helpers');

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// A GitHub that records every request, and how many were in flight at once.
function fakeGithub(existing) {
  const calls = [];
  const paths = new Set(existing || []);
  let blobN = 0;
  let inFlight = 0;
  let peakInFlight = 0;

  global.fetch = async (url, init) => {
    const method = (init && init.method) || 'GET';
    const route = String(url).replace('https://api.github.com/repos/shy-cy/ogen-web', '');
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ method, route, body });

    inFlight++;
    peakInFlight = Math.max(peakInFlight, inFlight);
    // A tick of latency, so overlapping requests actually overlap.
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;

    const reply = (status, obj) => ({ ok: status < 400, status, text: async () => JSON.stringify(obj) });

    if (route === '/branches/main') {
      return reply(200, { commit: { sha: 'basecommit', commit: { tree: { sha: 'basetree' } } } });
    }
    if (route.indexOf('/git/trees/basetree') === 0) {
      return reply(200, { truncated: false, tree: Array.from(paths).map((p) => ({ path: p, type: 'blob' })) });
    }
    if (route === '/git/blobs' && method === 'POST') return reply(200, { sha: 'blob' + ++blobN });
    if (route === '/git/trees' && method === 'POST') return reply(200, { sha: 'newtree' });
    if (route === '/git/commits' && method === 'POST') return reply(200, { sha: 'newcommit' });
    if (route === '/git/refs/heads/main' && method === 'PATCH') return reply(200, {});
    return reply(404, { message: 'unexpected ' + method + ' ' + route });
  };

  return { calls, peak: () => peakInFlight };
}

process.env.GITHUB_TOKEN = 'test-token';
process.env.GITHUB_REPO = 'shy-cy/ogen-web';
process.env.GITHUB_BRANCH = 'main';

delete require.cache[require.resolve('../netlify/functions/_github')];
const { commitToBranch, CONCURRENCY, mapConcurrent } = require('../netlify/functions/_github');

const text = (n) => Array.from({ length: n }, (_, i) =>
  ({ path: 'activities/page-' + i + '.html', content: '<!-- ' + i + ' -->', encoding: 'utf-8' }));
const images = (n) => Array.from({ length: n }, (_, i) =>
  ({ path: 'images/activities/pic-' + i + '.png', content: PNG_B64, encoding: 'base64' }));

const count = (calls, route, method) =>
  calls.filter((c) => c.route === route && (!method || c.method === method)).length;

(async () => {
  console.log('\n[text files cost no requests of their own]');
  {
    // A real publish: 3 language pages, the record, 3 listing pages, the index
    // and the sitemap. Nine files that used to be nine sequential blob POSTs.
    const g = fakeGithub();
    await commitToBranch({ files: text(9), message: 'Publish' });
    eq(count(g.calls, '/git/blobs', 'POST'), 0, 'nine text files produce zero blob requests');
    const tree = g.calls.filter((c) => c.route === '/git/trees' && c.method === 'POST')[0].body.tree;
    eq(tree.length, 9, 'all nine are in the single tree request');
    ok(tree.every((e) => typeof e.content === 'string'), 'each carries its content inline');
    ok(tree.every((e) => e.sha === undefined), 'and none of them names a blob sha');
  }

  console.log('\n[so adding content does not add round trips]');
  {
    // This is the property that was failing: an activity with more in it cost
    // more requests, until one day it cost more than ten seconds' worth.
    const small = fakeGithub();
    await commitToBranch({ files: text(4), message: 'small' });
    const large = fakeGithub();
    await commitToBranch({ files: text(60), message: 'large' });
    eq(large.calls.length, small.calls.length,
       'a publish with 60 text files makes the same number of requests as one with 4');
    eq(small.calls.length, 4, 'and that number is four: branch, tree, commit, ref');
  }

  console.log('\n[finding the head of the branch is one request, not two]');
  {
    const g = fakeGithub();
    await commitToBranch({ files: text(1), message: 'x' });
    eq(count(g.calls, '/branches/main'), 1, 'the branch is read once');
    eq(g.calls.filter((c) => c.route.indexOf('/git/ref/heads/') === 0).length, 0,
       'the ref endpoint is not read separately');
    eq(g.calls.filter((c) => /^\/git\/commits\/\w/.test(c.route)).length, 0,
       'nor is the commit fetched to find its tree');
  }

  console.log('\n[images still need blobs, but they go up together]');
  {
    const g = fakeGithub();
    await commitToBranch({ files: text(5).concat(images(12)), message: 'with pictures' });
    eq(count(g.calls, '/git/blobs', 'POST'), 12, 'one blob request per image, and none for the text');
    ok(g.peak() > 1, 'they overlap rather than queueing one behind the next (peak ' + g.peak() + ')');
    ok(g.peak() <= CONCURRENCY, 'but never more than ' + CONCURRENCY + ' at once');
    const tree = g.calls.filter((c) => c.route === '/git/trees' && c.method === 'POST')[0].body;
    eq(tree.tree.length, 17, 'every file lands in the one tree');
  }

  console.log('\n[the concurrency ceiling is real]');
  {
    // Bursts are what GitHub's secondary rate limits punish, so the cap is not
    // decoration — an unbounded Promise.all over 40 images would be a burst.
    const g = fakeGithub();
    await commitToBranch({ files: images(40), message: 'many pictures' });
    ok(g.peak() <= CONCURRENCY, '40 images still peak at ' + g.peak() + ', not 40');
    eq(count(g.calls, '/git/blobs', 'POST'), 40, 'and all 40 are uploaded');
  }

  console.log('\n[mapConcurrent keeps results in the order it was given them]');
  {
    // Tree entries are built from this, so a shuffled result would attach the
    // wrong blob to the wrong path — a silent, and very confusing, corruption.
    const slowFirst = [50, 5, 30, 1, 20];
    const out = await mapConcurrent(slowFirst, 3, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    eq(JSON.stringify(out), '[0,1,2,3,4]', 'results come back in input order, not completion order');
    eq(JSON.stringify(await mapConcurrent([], 3, async () => 1)), '[]', 'an empty list is fine');
    eq(JSON.stringify(await mapConcurrent([1, 2], 99, async (n) => n * 2)), '[2,4]',
       'a limit larger than the list is fine too');
  }

  console.log('\n[a real publish shape, end to end]');
  {
    // hebrew4kids as it actually is: 4 images, 7 text files, 2 stale paths to
    // clear. It took 8.0s of a 10s budget as a sequential queue.
    const g = fakeGithub(['activities/hebrew4kids.html', 'images/activities/hebrew4kids-hero.png']);
    await commitToBranch({
      files: text(7).concat(images(4)),
      deletes: ['activities/hebrew4kids.html', 'images/activities/hebrew4kids-hero.png'],
      message: 'Publish activity: hebrew4kids'
    });
    // branch + recursive tree + 4 blobs + tree + commit + ref
    eq(g.calls.length, 9, 'nine requests in total, of which the four blob uploads overlap');
    eq(count(g.calls, '/git/blobs', 'POST'), 4, 'only the images needed uploading');
  }

  done();
})();
