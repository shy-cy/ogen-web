// GitHub access for the publisher.
//
// Everything here uses the **git data API** (blobs / trees / commits / refs),
// never the Contents API. The Contents API caps base64 at 1MB and returns an
// empty string past that with no error — which looks like "the file is empty"
// and leads to publishing a blanked page. Reads use Accept: raw for the same
// reason (supported to 100MB).
//
// Every publish is ONE commit: all files land, or none do.

const API = 'https://api.github.com';

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

async function getRef() {
  const cfg = config();
  const ref = await gh(`/git/ref/heads/${cfg.branch}`);
  if (ref.notFound) throw new Error(`Branch ${cfg.branch} not found`);
  return ref.object.sha;
}

/**
 * Commit a set of files atomically.
 *
 * files:   [{ path, content, encoding: 'utf-8' | 'base64' }]
 * deletes: ['path/to/remove.html', …]   — omitted from the new tree
 *
 * The ref update uses force:false, so if someone else committed while this was
 * being assembled the update is rejected rather than clobbering their commit.
 */
async function commitToBranch({ files = [], deletes = [], message, authorName, authorEmail }) {
  const cfg = config();
  if (!files.length && !deletes.length) throw new Error('Nothing to commit');

  const baseSha = await getRef();
  const baseCommit = await gh(`/git/commits/${baseSha}`);
  const baseTree = baseCommit.tree.sha;

  const tree = [];
  for (const f of files) {
    const blob = await gh('/git/blobs', {
      method: 'POST',
      body: {
        content: f.encoding === 'base64' ? f.content : String(f.content),
        encoding: f.encoding === 'base64' ? 'base64' : 'utf-8'
      }
    });
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  // A null sha removes the path from the new tree — this is how unpublish and
  // delete actually take a page off the site.
  for (const path of deletes) {
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
    removed: deletes.slice()
  };
}

// Deliberately exported and unused by the app: opening a PR instead of
// committing to main is the natural next step if a review step is ever wanted.
async function openPullRequest({ title, head, base, body }) {
  return gh('/pulls', { method: 'POST', body: { title, head, base, body } });
}

module.exports = { config, gh, readFile, readJson, getRef, commitToBranch, openPullRequest };
