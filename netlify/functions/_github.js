// GitHub access for the publisher.
//
// Everything here uses the **git data API** (blobs / trees / commits / refs),
// never the Contents API. The Contents API caps base64 at 1MB and returns an
// empty string past that with no error — which looks like "the file is empty"
// and leads to publishing a blanked page. Reads use Accept: raw for the same
// reason (supported to 100MB).
//
// Every publish is ONE commit: all files land, or none do.
//
// It is also as few round trips as it can be. Netlify kills a function at ten
// seconds, and this used to spend that budget on a queue of sequential requests
// — one POST per file to create its blob, plus two calls just to find the head
// of the branch. A publish with four images took eight seconds, and every extra
// teacher or sponsor pushed it closer to the edge. Three changes fixed it:
//
//   - text files carry their content INLINE in the tree, so they cost no
//     request at all (verified byte-identical, Hebrew included);
//   - the images that genuinely need a blob upload go up concurrently;
//   - one call to /branches/<name> yields both the commit and its tree.
//
// The result grows flat in text — an activity with fifty FAQ entries costs the
// same as one with none — and only sub-linearly in pictures.

const API = 'https://api.github.com';

// Parallel requests per publish. Kept modest on purpose: GitHub's secondary
// rate limits punish bursts, and beyond a handful the wall-clock gain is small
// next to the risk of being throttled mid-commit.
const CONCURRENCY = 6;

// Promise.all with a ceiling. Order of results matches order of input.
async function mapConcurrent(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

function config() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';
  if (!token) throw new Error('GITHUB_TOKEN is not set (netlify env:set GITHUB_TOKEN …)');
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) {
    throw new Error('GITHUB_REPO must be set to "owner/name"');
  }
  return { token, repo, branch };
}

async function gh(path, { method = 'GET', body, accept, token, repo } = {}) {
  const cfg = token && repo ? { token, repo } : config();
  const res = await fetch(`${API}/repos/${cfg.repo}${path}`, {
    method,
    headers: Object.assign(
      {
        Authorization: `Bearer ${cfg.token}`,
        Accept: accept || 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'ogen-admin'
      },
      body ? { 'Content-Type': 'application/json' } : {}
    ),
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 404) return { notFound: true, status: 404 };
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub ${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  }
  if (accept === 'application/vnd.github.raw') return { raw: text };
  return text ? JSON.parse(text) : {};
}

// Read a file's current text from the branch. Returns null when absent.
// Accept: raw, so a file over 1MB comes back whole instead of empty.
async function readFile(path, ref) {
  const cfg = config();
  const at = encodeURIComponent(ref || cfg.branch);
  const out = await gh(`/contents/${encodeURI(path)}?ref=${at}`, {
    accept: 'application/vnd.github.raw'
  });
  if (out.notFound) return null;
  return out.raw;
}

async function readJson(path, ref) {
  const text = await readFile(path, ref);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${err.message}`);
  }
}

// The branch endpoint carries the head commit AND its tree. This replaced a
// getRef() that read /git/ref/heads/<branch> for the commit sha, followed by a
// second call to /git/commits/<sha> for its tree — two round trips to learn one
// pair of facts.
async function getHead() {
  const cfg = config();
  const br = await gh(`/branches/${encodeURIComponent(cfg.branch)}`);
  if (br.notFound) throw new Error(`Branch ${cfg.branch} not found`);
  return { commitSha: br.commit.sha, treeSha: br.commit.commit.tree.sha };
}

// Which of `paths` actually exist in a tree.
//
// GitHub rejects the ENTIRE tree with 422 GitRPC::BadObjectState if a null-sha
// entry names a path that is not already in base_tree — you cannot ask it to
// delete something that was never there. Callers legitimately don't know:
// publishing a Hebrew-only activity asks to clear the EN and RU files, which on
// a first publish have never existed. So "remove these paths if present" is the
// contract, and the filtering belongs here, the one place that has seen the
// base tree.
async function presentIn(treeSha, paths) {
  if (!paths.length) return [];
  const tree = await gh(`/git/trees/${treeSha}?recursive=1`);
  if (tree.truncated) {
    // Repo too big to enumerate in one response — ask about each path instead.
    const found = [];
    for (const p of paths) {
      if ((await readFile(p)) !== null) found.push(p);
    }
    return found;
  }
  const have = new Set((tree.tree || []).filter((e) => e.type === 'blob').map((e) => e.path));
  return paths.filter((p) => have.has(p));
}

/**
 * Commit a set of files atomically.
 *
 * files:   [{ path, content, encoding: 'utf-8' | 'base64' }]
 * deletes: ['path/to/remove.html', …]   — removed if present, ignored if not
 *
 * The ref update uses force:false, so if someone else committed while this was
 * being assembled the update is rejected rather than clobbering their commit.
 */
async function commitToBranch({ files = [], deletes = [], message, authorName, authorEmail }) {
  const cfg = config();
  if (!files.length && !deletes.length) throw new Error('Nothing to commit');

  const { commitSha: baseSha, treeSha: baseTree } = await getHead();

  const removals = await presentIn(baseTree, deletes);
  // Everything asked for was already gone and there is nothing to write, so the
  // commit would be empty. Report the no-op rather than making a hollow commit.
  if (!files.length && !removals.length) {
    return { sha: baseSha, url: `https://github.com/${cfg.repo}/commit/${baseSha}`,
             branch: cfg.branch, paths: [], removed: [], noop: true };
  }

  const tree = [];

  // A tree entry may carry its content directly, and GitHub writes the blob
  // itself. Every HTML page, JSON record and sitemap therefore costs nothing
  // beyond the tree request it is already part of. Only base64 needs the blobs
  // endpoint, because inline content is UTF-8 text.
  files
    .filter((f) => f.encoding !== 'base64')
    .forEach((f) => {
      tree.push({ path: f.path, mode: '100644', type: 'blob', content: String(f.content) });
    });

  const binaries = files.filter((f) => f.encoding === 'base64');
  const uploaded = await mapConcurrent(binaries, CONCURRENCY, async (f) => {
    const blob = await gh('/git/blobs', {
      method: 'POST',
      body: { content: f.content, encoding: 'base64' }
    });
    return { path: f.path, mode: '100644', type: 'blob', sha: blob.sha };
  });
  tree.push(...uploaded);
  // A null sha removes the path from the new tree — this is how unpublish and
  // delete actually take a page off the site.
  for (const path of removals) {
    tree.push({ path, mode: '100644', type: 'blob', sha: null });
  }

  const newTree = await gh('/git/trees', {
    method: 'POST',
    body: { base_tree: baseTree, tree }
  });
  const commit = await gh('/git/commits', {
    method: 'POST',
    body: {
      message,
      tree: newTree.sha,
      parents: [baseSha],
      author: authorName && authorEmail
        ? { name: authorName, email: authorEmail, date: new Date().toISOString() }
        : undefined
    }
  });
  await gh(`/git/refs/heads/${cfg.branch}`, {
    method: 'PATCH',
    body: { sha: commit.sha, force: false }
  });

  return {
    sha: commit.sha,
    url: `https://github.com/${cfg.repo}/commit/${commit.sha}`,
    branch: cfg.branch,
    paths: files.map((f) => f.path),
    removed: removals
  };
}

// Deliberately exported and unused by the app: opening a PR instead of
// committing to main is the natural next step if a review step is ever wanted.
async function openPullRequest({ title, head, base, body }) {
  return gh('/pulls', { method: 'POST', body: { title, head, base, body } });
}

module.exports = { config, gh, readFile, readJson, getHead, mapConcurrent,
                   CONCURRENCY, commitToBranch, openPullRequest };
