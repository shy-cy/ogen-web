// POST /api/activities-admin — the Activities admin backend.
//
// Actions: auth | list | load | preview | publish | saveDraft | unpublish | delete
//
// THE CORE SPLIT
//   A draft activity lives ONLY in the Blobs store `activity-drafts`. It has no
//   files in the repository, so there is no URL that could serve it — draft is
//   not a display state that hides a page, it is the absence of the page.
//   Publishing renders the record and commits real files; unpublishing deletes
//   those files again and puts the record back in Blobs.
//
// ONE BUILDER
//   generate(activity, { commit }) is the only path to HTML. `preview` calls it
//   with commit:false, `publish` with commit:true. There is deliberately no
//   preview-only render path: a preview that renders through different code is
//   a preview that can lie about what will go live.
//
// OPTIMISTIC LOCKING
//   Every record carries isoUpdated. The client sends back the value it loaded
//   as baseUpdatedAt; the server re-reads the current record (from GitHub for
//   published, Blobs for drafts — never from the deployed bundle, which trails
//   a save by a minute) and refuses to write if it has moved.

const { authenticate, canAccess, canPublish, editLangs, canEditLang } = require('./_session-store');
const { requireStore, optionalStore } = require('./_blobs');
const { readJson, commitToBranch } = require('./_github');
const { recordAudit } = require('./_audit');
const {
  LANGS, STATUSES, MOTIFS, CORNERS, langsPresent, pick,
  filePathFor, pathFor, renderActivityPage
} = require('./_activity-template');
const { buildDerivedFiles, isPublic } = require('./_activity-index');

const TOOL = 'activities';
const DRAFT_STORE = 'activity-drafts';
const draftKey = (slug) => 'activity-' + slug;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

const json = (statusCode, payload) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(payload)
});

// Translatable simple fields, and the repeatable lists. The client renders its
// form from this, so adding a field is a one-line change here.
const FIELD_SCHEMA = {
  simple: [
    { key: 'title', label: 'Title', required: true },
    { key: 'summary', label: 'Card summary', hint: 'One line, shown on the activities listing' },
    { key: 'about', label: 'About this activity', textarea: true, required: true },
    { key: 'metaTitle', label: 'Meta title', hint: 'Defaults to the title' },
    { key: 'metaDescription', label: 'Meta description', textarea: true },
    { key: 'heroAlt', label: 'Hero image alt text' }
  ],
  optional: [
    { key: 'programLength', label: 'Program Length', textarea: true },
    { key: 'instructionLanguage', label: 'Language of instruction', textarea: true },
    { key: 'prerequisites', label: 'Prerequisites / level', textarea: true },
    { key: 'whatToBring', label: 'What to bring', textarea: true }
  ],
  facts: [
    { key: 'ages', label: 'Age range' },
    { key: 'schedule', label: 'Schedule (day/time)' },
    { key: 'location', label: 'Location' },
    { key: 'groupSize', label: 'Group size' },
    { key: 'price', label: 'Price' }
  ],
  lists: [
    { key: 'included', label: "What's included", itemFields: [{ key: 'text', label: 'Item' }] },
    { key: 'faq', label: 'FAQ', itemFields: [{ key: 'q', label: 'Question' }, { key: 'a', label: 'Answer', textarea: true }] },
    { key: 'teachers', label: 'Teachers', itemFields: [{ key: 'name', label: 'Name' }], image: 'photo' },
    { key: 'sponsors', label: 'Sponsors', itemFields: [{ key: 'name', label: 'Name' }], image: 'logo' }
  ],
  statuses: STATUSES,
  motifs: MOTIFS,
  corners: CORNERS,
  langs: LANGS
};

const SIMPLE_KEYS = FIELD_SCHEMA.simple.concat(FIELD_SCHEMA.optional).map((f) => f.key);
const FACT_KEYS = FIELD_SCHEMA.facts.map((f) => f.key);
const LIST_KEYS = FIELD_SCHEMA.lists.map((l) => l.key);
const LIST_BY_KEY = {};
FIELD_SCHEMA.lists.forEach((l) => { LIST_BY_KEY[l.key] = l; });

// --- storage ---------------------------------------------------------------

async function getDraft(slug) {
  const store = await optionalStore(DRAFT_STORE);
  if (!store) return null;
  return (await store.get(draftKey(slug), { type: 'json' })) || null;
}

async function putDraft(record) {
  const store = await requireStore(DRAFT_STORE);
  await store.setJSON(draftKey(record.slug), record);
  return record;
}

async function dropDraft(slug) {
  const store = await optionalStore(DRAFT_STORE);
  if (store) await store.delete(draftKey(slug)).catch(() => {});
}

async function listDrafts() {
  const store = await optionalStore(DRAFT_STORE);
  if (!store) return [];
  const { blobs } = await store.list();
  const out = [];
  for (const b of blobs) {
    const rec = await store.get(b.key, { type: 'json' });
    if (rec) out.push(rec);
  }
  return out;
}

const getPublished = (slug) => readJson(`activities/${slug}.json`);

// Every published record, read from GitHub. Needed in full because the derived
// files (listing pages, sitemap) are rebuilt from the complete set on each save.
async function allPublished() {
  const index = (await readJson('activities/activities-index.json')) || [];
  const out = [];
  for (const entry of index) {
    const rec = await getPublished(entry.slug);
    if (rec) out.push(rec);
  }
  return out;
}

// The working copy: a draft supersedes the published file, because it is the
// newer edit. `load` and the lock check agree on this so their timestamps match.
async function currentRecord(slug) {
  const draft = await getDraft(slug);
  if (draft) return { record: draft, source: 'draft' };
  const published = await getPublished(slug);
  if (published) return { record: published, source: 'git' };
  return { record: null, source: null };
}

// --- optimistic locking ----------------------------------------------------

class Conflict extends Error {
  constructor(payload) { super(payload.error); this.payload = payload; }
}

async function assertFresh(slug, baseUpdatedAt, { overwrite } = {}) {
  const { record, source } = await currentRecord(slug);
  const current = record ? record.isoUpdated || null : null;
  const base = baseUpdatedAt || null;

  if (current === base) return { record, source };
  if (overwrite) return { record, source, overwritten: true };

  throw new Conflict({
    error: 'conflict',
    message: record
      ? 'This activity was changed by someone else while you were editing it.'
      : 'This activity no longer exists — it was deleted while you were editing it.',
    conflict: {
      slug,
      yourBase: base,
      currentUpdatedAt: current,
      lastEditedBy: record ? record.lastEditedByName || record.lastEditedBy || null : null,
      source
    }
  });
}

// --- images ----------------------------------------------------------------

const MIME_EXT = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
  'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg'
};

function decodeImage(dataUrl) {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const ext = MIME_EXT[m[1].toLowerCase()];
  if (!ext) throw new Error(`Unsupported image type: ${m[1]}`);
  const bytes = Buffer.from(m[2], 'base64').length;
  if (bytes > MAX_IMAGE_BYTES) {
    throw new Error(`Image is ${(bytes / 1048576).toFixed(1)}MB; the limit is 3MB`);
  }
  return { base64: m[2], ext, bytes };
}

// Pulls every base64 data URL out of the record, replaces it with a
// site-root-absolute path, and returns the files to commit alongside.
function extractImages(activity) {
  const files = [];
  const slug = activity.slug;

  const take = (dataUrl, name) => {
    const img = decodeImage(dataUrl);
    if (!img) return null;
    const path = `images/activities/${slug}-${name}.${img.ext}`;
    files.push({ path, content: img.base64, encoding: 'base64' });
    return '/' + path;
  };

  if (activity.heroImage && activity.heroImage.startsWith('data:')) {
    activity.heroImage = take(activity.heroImage, 'hero') || null;
  }
  ['teachers', 'sponsors'].forEach((key) => {
    const imageField = LIST_BY_KEY[key].image;
    (activity[key] || []).forEach((item) => {
      const val = item && item[imageField];
      if (val && String(val).startsWith('data:')) {
        item[imageField] = take(val, `${key}-${item.id}`) || null;
      }
    });
  });
  return files;
}

// --- normalising + permissions --------------------------------------------

const emptyLang = () => ({ he: '', en: '', ru: '' });

function langObject(value) {
  if (value && typeof value === 'object') {
    return { he: String(value.he || ''), en: String(value.en || ''), ru: String(value.ru || '') };
  }
  if (typeof value === 'string') return { he: value, en: '', ru: '' };
  return emptyLang();
}

const hasAnyText = (langObj) => LANGS.some((l) => String(langObj[l] || '').trim() !== '');

// Merge an incoming record over the stored one, honouring which languages this
// session may edit. A permission enforced only in the UI is not enforced.
function mergeByPermission(current, incoming, session) {
  const allowed = editLangs(session, TOOL);
  const full = LANGS.every((l) => allowed.indexOf(l) !== -1);
  const base = current ? JSON.parse(JSON.stringify(current)) : null;

  const mergeLang = (currentVal, incomingVal) => {
    const cur = langObject(currentVal);
    const inc = langObject(incomingVal);
    const out = Object.assign({}, cur);
    allowed.forEach((l) => { out[l] = inc[l]; });
    return out;
  };

  const out = base ? Object.assign({}, base) : { slug: incoming.slug };

  // Structure (status, motif, ordering, ids, images) is only writable by a
  // session that may edit every language. A restricted role gets the words
  // and not the structure.
  if (full) {
    ['status', 'motif', 'corner', 'spots', 'heroImage'].forEach((k) => {
      if (incoming[k] !== undefined) out[k] = incoming[k];
    });
    out.ctaUrl = langObject(incoming.ctaUrl !== undefined ? incoming.ctaUrl : out.ctaUrl);
  } else {
    out.ctaUrl = langObject(out.ctaUrl);
  }

  SIMPLE_KEYS.forEach((k) => { out[k] = mergeLang(base && base[k], incoming[k]); });

  out.facts = out.facts || {};
  const incFacts = incoming.facts || {};
  FACT_KEYS.forEach((k) => {
    out.facts[k] = mergeLang(base && base.facts && base.facts[k], incFacts[k]);
  });

  LIST_KEYS.forEach((key) => {
    const spec = LIST_BY_KEY[key];
    const currentItems = (base && base[key]) || [];
    const incomingItems = Array.isArray(incoming[key]) ? incoming[key] : [];

    // Restricted roles keep the stored order and membership; only text merges.
    const skeleton = full
      ? incomingItems.map((it) => ({ id: it && it.id }))
      : currentItems.map((it) => ({ id: it.id }));

    out[key] = skeleton
      .filter((s) => s.id)
      .map((s) => {
        const cur = currentItems.find((c) => c.id === s.id) || { id: s.id };
        const inc = incomingItems.find((c) => c && c.id === s.id) || {};
        const item = { id: s.id };
        spec.itemFields.forEach((f) => { item[f.key] = mergeLang(cur[f.key], inc[f.key]); });
        if (spec.image) {
          item[spec.image] = full
            ? (inc[spec.image] !== undefined ? inc[spec.image] : cur[spec.image] || null)
            : cur[spec.image] || null;
        }
        return item;
      })
      // A blank row is dropped, not published: an item is real once it has the
      // one field that defines it.
      .filter((item) => hasAnyText(item[spec.itemFields[0].key]));
  });

  return out;
}

function validate(activity) {
  const errors = [];
  if (!activity.slug || !SLUG_RE.test(activity.slug)) {
    errors.push('Slug must be lower-case words separated by single hyphens, e.g. hebrew-for-kids');
  }
  if (STATUSES.indexOf(activity.status) === -1) errors.push(`Unknown status "${activity.status}"`);
  if (activity.motif && MOTIFS.indexOf(activity.motif) === -1) errors.push(`Unknown motif "${activity.motif}"`);
  if (activity.corner && CORNERS.indexOf(activity.corner) === -1) errors.push(`Unknown corner "${activity.corner}"`);
  if (!hasAnyText(langObject(activity.title))) errors.push('A title is required in at least one language');
  if (!langsPresent(activity).length) errors.push('At least one language needs a title before this can be published');
  if (errors.length) {
    const err = new Error(errors[0]);
    err.validation = errors;
    throw err;
  }
  return activity;
}

// --- THE ONE BUILDER -------------------------------------------------------
// preview → commit:false, publish → commit:true. Identical up to the commit.

async function generate(input, { commit, session, message }) {
  const activity = validate(JSON.parse(JSON.stringify(input)));
  const imageFiles = extractImages(activity);

  const present = langsPresent(activity);
  const html = {};
  const files = [];

  // Render every language that has its own title. A language without one is
  // not committed at all, rather than published as Hebrew under an /en/ URL.
  present.forEach((lang) => {
    html[lang] = renderActivityPage(activity, lang);
    files.push({ path: filePathFor(activity.slug, lang), content: html[lang], encoding: 'utf-8' });
  });
  // Preview still renders the missing languages so the admin can see what a
  // reader would get; those simply aren't in the file list.
  LANGS.filter((l) => present.indexOf(l) === -1).forEach((lang) => {
    html[lang] = renderActivityPage(activity, lang);
  });

  files.push({
    path: `activities/${activity.slug}.json`,
    content: JSON.stringify(activity, null, 2) + '\n',
    encoding: 'utf-8'
  });
  files.push(...imageFiles);

  // Rebuild the derived files from the full published set, with this record
  // swapped in.
  const others = (await allPublished()).filter((a) => a.slug !== activity.slug);
  const full = isPublic(activity) ? others.concat([activity]) : others;
  files.push(...buildDerivedFiles(full));

  // Languages that used to exist and no longer do must have their files removed.
  const deletes = LANGS.filter((l) => present.indexOf(l) === -1)
    .map((l) => filePathFor(activity.slug, l));

  const result = {
    slug: activity.slug,
    activity,
    html,
    langs: present,
    files: files.map((f) => ({ path: f.path, encoding: f.encoding, bytes: f.content.length })),
    deletes,
    liveUrls: present.map((l) => `https://www.ogen.cy${pathFor(activity.slug, l)}`)
  };
  if (!commit) return result;

  result.commit = await commitToBranch({
    files,
    deletes,
    message: message || `Publish activity: ${activity.slug}`,
    authorName: session && session.name,
    authorEmail: session && session.email
  });
  return result;
}

// --- handler ---------------------------------------------------------------

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { error: 'Body must be JSON' });
  }

  const session = await authenticate(body);
  if (!session) return json(401, { error: 'Unauthorized' });
  if (!canAccess(session, TOOL)) {
    return json(403, { error: 'Your role does not have access to Activities' });
  }

  const stamp = (record) => {
    record.isoUpdated = new Date().toISOString();
    record.isoCreated = record.isoCreated || record.isoUpdated;
    record.lastEditedBy = session.email;
    record.lastEditedByName = session.name;
    return record;
  };

  try {
    switch (body.action) {
      case 'auth':
        return json(200, {
          ok: true,
          email: session.email, name: session.name,
          role: session.role, roleName: session.roleName,
          permissions: session.permissions,
          editLangs: editLangs(session, TOOL),
          canPublish: canPublish(session, TOOL),
          schema: FIELD_SCHEMA
        });

      case 'list': {
        // Read from GitHub and Blobs, never from the deployed bundle: a deploy
        // trails a save by about a minute and the form would refill with the
        // copy from before the edit.
        const published = await allPublished();
        const drafts = await listDrafts();
        const bySlug = new Map();
        published.forEach((a) =>
          bySlug.set(a.slug, {
            slug: a.slug, status: a.status, where: 'published',
            title: a.title, langs: langsPresent(a),
            isoUpdated: a.isoUpdated || null,
            lastEditedByName: a.lastEditedByName || null,
            urls: langsPresent(a).map((l) => pathFor(a.slug, l))
          })
        );
        drafts.forEach((a) =>
          bySlug.set(a.slug, {
            slug: a.slug, status: a.status, where: 'draft',
            title: a.title, langs: langsPresent(a),
            isoUpdated: a.isoUpdated || null,
            lastEditedByName: a.lastEditedByName || null,
            urls: []
          })
        );
        return json(200, {
          ok: true,
          activities: Array.from(bySlug.values()).sort((a, b) => a.slug.localeCompare(b.slug))
        });
      }

      case 'load': {
        const slug = String(body.slug || '');
        if (!SLUG_RE.test(slug)) return json(400, { error: 'Bad slug' });
        const { record, source } = await currentRecord(slug);
        if (!record) return json(404, { error: 'No such activity' });
        return json(200, { ok: true, activity: record, source, baseUpdatedAt: record.isoUpdated || null });
      }

      case 'preview': {
        const { record } = await currentRecord(String(body.activity && body.activity.slug || ''));
        const merged = mergeByPermission(record, body.activity || {}, session);
        const out = await generate(merged, { commit: false, session });
        return json(200, { ok: true, dryRun: true, ...out });
      }

      case 'saveDraft': {
        const incoming = body.activity || {};
        const slug = String(incoming.slug || '');
        if (!SLUG_RE.test(slug)) return json(400, { error: 'Bad slug' });
        const { record } = await assertFresh(slug, body.baseUpdatedAt, { overwrite: body.overwrite });
        const merged = stamp(mergeByPermission(record, incoming, session));
        merged.status = 'draft';
        await putDraft(merged);
        await recordAudit(session, 'save-draft', slug, body.overwrite ? 'overwrite' : 'ok');
        return json(200, { ok: true, slug, baseUpdatedAt: merged.isoUpdated, activity: merged });
      }

      case 'publish': {
        if (!canPublish(session, TOOL)) {
          return json(403, { error: 'Your role may edit Activities but not publish them' });
        }
        const incoming = body.activity || {};
        const slug = String(incoming.slug || '');
        if (!SLUG_RE.test(slug)) return json(400, { error: 'Bad slug' });

        const { record, overwritten } = await assertFresh(slug, body.baseUpdatedAt, { overwrite: body.overwrite });
        const merged = stamp(mergeByPermission(record, incoming, session));
        if (merged.status === 'draft') {
          return json(400, { error: 'Set a status other than Draft to publish. Draft activities are never committed.' });
        }
        merged.lastPublishedAt = merged.isoUpdated;

        const out = await generate(merged, {
          commit: true, session,
          message: `Publish activity: ${slug} (${merged.status})\n\nvia Ogen admin by ${session.name} <${session.email}>`
        });
        // git is now the source of truth for this slug.
        await dropDraft(slug);
        await recordAudit(session, 'publish', slug, overwritten ? 'overwrite' : 'ok', { commit: out.commit.sha });
        return json(200, { ok: true, ...out, baseUpdatedAt: merged.isoUpdated });
      }

      case 'unpublish': {
        if (!canPublish(session, TOOL)) return json(403, { error: 'Your role may not unpublish' });
        const slug = String(body.slug || '');
        if (!SLUG_RE.test(slug)) return json(400, { error: 'Bad slug' });
        const published = await getPublished(slug);
        if (!published) return json(404, { error: 'That activity is not published' });
        await assertFresh(slug, body.baseUpdatedAt, { overwrite: body.overwrite });

        // Back to a draft: the record survives and stays editable, the files do not.
        const record = stamp(Object.assign({}, published, { status: 'draft' }));
        await putDraft(record);

        const others = (await allPublished()).filter((a) => a.slug !== slug);
        const deletes = LANGS.map((l) => filePathFor(slug, l)).concat([`activities/${slug}.json`]);
        const commit = await commitToBranch({
          files: buildDerivedFiles(others),
          deletes,
          message: `Unpublish activity: ${slug}\n\nvia Ogen admin by ${session.name} <${session.email}>`,
          authorName: session.name, authorEmail: session.email
        });
        await recordAudit(session, 'unpublish', slug, 'ok', { commit: commit.sha });
        return json(200, { ok: true, slug, commit, removed: commit.removed, baseUpdatedAt: record.isoUpdated });
      }

      case 'delete': {
        if (!canPublish(session, TOOL)) return json(403, { error: 'Your role may not delete activities' });
        const slug = String(body.slug || '');
        if (!SLUG_RE.test(slug)) return json(400, { error: 'Bad slug' });
        if (body.confirmSlug !== slug) {
          return json(400, { error: 'Type the slug to confirm deletion' });
        }
        const published = await getPublished(slug);
        let commit = null;
        if (published) {
          const others = (await allPublished()).filter((a) => a.slug !== slug);
          const deletes = LANGS.map((l) => filePathFor(slug, l)).concat([`activities/${slug}.json`]);
          commit = await commitToBranch({
            files: buildDerivedFiles(others),
            deletes,
            message: `Delete activity: ${slug}\n\nvia Ogen admin by ${session.name} <${session.email}>`,
            authorName: session.name, authorEmail: session.email
          });
        }
        await dropDraft(slug);
        await recordAudit(session, 'delete', slug, 'ok', { commit: commit && commit.sha });
        return json(200, { ok: true, slug, commit, deleted: true });
      }

      default:
        return json(400, { error: `Unknown action "${body.action}"` });
    }
  } catch (err) {
    if (err instanceof Conflict) return json(409, err.payload);
    console.error('[activities-admin]', err);
    return json(500, { error: err.message, validation: err.validation || null });
  }
};

// Exported for the test suites, which call the real functions.
exports._internal = {
  generate, validate, mergeByPermission, assertFresh, extractImages, decodeImage,
  currentRecord, langObject, FIELD_SCHEMA, Conflict, SLUG_RE
};
