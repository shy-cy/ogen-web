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

const crypto = require('crypto');
const { authenticate, canAccess, canPublish, editLangs, canEditLang } = require('./_session-store');
const { requireStore, optionalStore } = require('./_blobs');
const { readJson, commitToBranch, mapConcurrent, CONCURRENCY } = require('./_github');
const { recordAudit } = require('./_audit');
const {
  LANGS, STATUSES, MOTIFS, CORNERS, langsPresent, pick,
  filePathFor, pathFor, renderActivityPage
} = require('./_activity-template');
const { buildDerivedFiles, isPublic } = require('./_activity-index');
const {
  FACT_ORDER, TEXT_FACTS, DEFAULT_VISIBILITY, ACADEMIC_MINUTES,
  num, pricePerHour
} = require('./_activity-facts');
const { migrate, normaliseFacts, normaliseVisibility, SHAPES } = require('./_activity-migrate');

// How many day+time rows a frequency asks for. 'custom' means "as many as the
// admin adds", so it has no fixed count.
const FREQUENCIES = [
  { key: 'one-time', label: 'One time', sessions: 1 },
  { key: 'weekly', label: 'Weekly', sessions: 1 },
  { key: 'twice-weekly', label: 'Twice weekly', sessions: 2 },
  { key: 'custom', label: 'Custom', sessions: null }
];

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
// index is the default; noindex matches /about — kept out of search results but
// its links still worth following.
const ROBOTS = ['index', 'noindex'];

const FIELD_SCHEMA = {
  simple: [
    { key: 'title', label: 'Title', required: true },
    { key: 'summary', label: 'Card summary', hint: 'One line, shown on the activities listing' },
    { key: 'about', label: 'About this activity', textarea: true, rich: true, required: true }
  ],
  optional: [
    { key: 'whatToBring', label: 'What to bring', textarea: true, rich: true }
  ],
  // Search and share. Its own group, and its own panel at the foot of the form,
  // because it is written once and then left alone, while everything above it is
  // what an admin actually comes here to edit. Sitting between "About" and
  // "What to bring" it read as another piece of body copy and got filled in with
  // one, which is how a meta description ends up being a paragraph.
  seo: [
    { key: 'metaTitle', label: 'Meta title', hint: 'Defaults to the title. Shown as the headline in search results' },
    { key: 'metaDescription', label: 'Meta description', textarea: true,
      hint: 'The grey text under the search result. Around 155 characters' }
  ],
  // Sidebar facts, in the order they appear on the page. `kind` tells the client
  // which editor to draw. Everything except the two text facts is structured
  // values, so the sentence on the page is BUILT per language rather than typed
  // three times and drifting.
  facts: [
    { key: 'ages', label: 'Ages', kind: 'ages' },
    { key: 'schedule', label: 'Schedule', kind: 'schedule' },
    { key: 'duration', label: 'Duration', kind: 'duration',
      hint: 'Start, end, how many sessions, and how long each one runs' },
    { key: 'groupSize', label: 'Group size', kind: 'groupSize' },
    { key: 'instructionLanguage', label: 'Language of instruction', kind: 'text' },
    { key: 'prerequisites', label: 'Prerequisites / level', kind: 'text' },
    { key: 'location', label: 'Location', kind: 'location',
      hint: 'The general area — "Limassol". Shown to everyone' },
    { key: 'address', label: 'Exact address', kind: 'location',
      hint: 'Street address. Members-only: it is NOT published on the page, and will not be until a members area exists' },
    { key: 'price', label: 'Price', kind: 'price' }
  ],
  frequencies: FREQUENCIES,
  visibilities: ['public', 'members'],
  defaultVisibility: DEFAULT_VISIBILITY,
  academicMinutes: ACADEMIC_MINUTES,
  lists: [
    { key: 'faq', label: 'FAQ', itemFields: [{ key: 'q', label: 'Question' }, { key: 'a', label: 'Answer', textarea: true }] },
    { key: 'teachers', label: 'Teachers', itemFields: [{ key: 'name', label: 'Name' }], image: 'photo' },
    { key: 'sponsors', label: 'Sponsors', itemFields: [{ key: 'name', label: 'Name' }], image: 'logo' }
  ],
  statuses: STATUSES,
  motifs: MOTIFS,
  corners: CORNERS,
  // Search and sharing, and structure rather than words: one instruction for the
  // page in every language. `noindex` also drops the activity from sitemap.xml —
  // see _activity-index.js, because a sitemap listing a page that asks not to be
  // indexed contradicts itself.
  robotsOptions: ROBOTS,
  langs: LANGS
};

// Every translatable scalar field, whichever panel it is drawn in. Grouping is a
// question for the form, not for the record: an SEO field is saved, merged and
// permission checked exactly like a content one.
const SIMPLE_KEYS = FIELD_SCHEMA.simple
  .concat(FIELD_SCHEMA.optional)
  .concat(FIELD_SCHEMA.seo)
  .map((f) => f.key);
// Fields edited in the WYSIWYG, so their stored value is markup rather than
// words. Derived from the schema, so marking a field `rich` is the whole change.
const RICH_KEYS = FIELD_SCHEMA.simple.concat(FIELD_SCHEMA.optional)
  .filter((f) => f.rich).map((f) => f.key);

// What an admin may write, and nothing else.
//
// The editor only ever produces these tags, so this is not there to fight the
// editor — it is there because the value arrives as a string in a request body
// and the server assumes the client is hostile, exactly as it does for every
// other field. The page renders this markup UNESCAPED, so anything not on this
// list would run.
const RICH_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
                   'h2', 'h3', 'ul', 'ol', 'li', 'a', 'blockquote'];

function sanitiseRich(value) {
  let html = String(value == null ? '' : value);
  // Drop whole elements whose CONTENT is dangerous, not just their tags: the
  // text inside a <script> is code, and keeping it would paste it into the page.
  html = html.replace(/<(script|style|iframe|object|embed|template)[\s\S]*?<\/\1\s*>/gi, '');
  // The attribute part deliberately allows a quoted value to contain '>', or a
  // tag like <a href="data:text/html,<script>"> ends at the wrong character and
  // leaks the rest as text.
  html = html.replace(/<\/?([a-z0-9]+)((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi, (whole, tag, attrs) => {
    const name = tag.toLowerCase();
    const closing = whole.charAt(1) === '/';
    if (RICH_TAGS.indexOf(name) === -1) return '';   // strip the tag, keep its text
    if (closing) return '</' + name + '>';
    if (name === 'a') {
      const m = /href\s*=\s*"([^"]*)"/i.exec(attrs) || /href\s*=\s*'([^']*)'/i.exec(attrs);
      let href = m ? m[1].trim() : '';
      // Anything that is not plainly a link is not one. javascript: and data:
      // both execute in an href.
      if (!/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(href)) href = '';
      if (!href) return '<a>';
      return '<a href="' + href.replace(/"/g, '%22') + '" rel="noopener">';
    }
    // Every other tag keeps its name and loses its attributes — that is where
    // style, onclick and the rest would ride in.
    return '<' + name + '>';
  });
  return html.trim();
}

const FACT_KEYS = FACT_ORDER;
const FACT_BY_KEY = {};
FIELD_SCHEMA.facts.forEach((f) => { FACT_BY_KEY[f.key] = f; });
const LIST_KEYS = FIELD_SCHEMA.lists.map((l) => l.key);
const LIST_BY_KEY = {};
FIELD_SCHEMA.lists.forEach((l) => { LIST_BY_KEY[l.key] = l; });

// --- storage ---------------------------------------------------------------

// Every record is migrated on the way IN, so the rest of this file — merging,
// validating, rendering — only ever deals with one shape. A record saved before
// facts became structured is brought forward the moment it is opened.
async function getDraft(slug) {
  const store = await optionalStore(DRAFT_STORE);
  if (!store) return null;
  const raw = (await store.get(draftKey(slug), { type: 'json' })) || null;
  return raw ? migrate(raw) : null;
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

const getPublished = async (slug) => {
  const raw = await readJson(`activities/${slug}.json`);
  return raw ? migrate(raw) : null;
};

// Every published record, read from GitHub. Needed in full because the derived
// files (listing pages, sitemap) are rebuilt from the complete set on each save.
async function allPublished() {
  const index = (await readJson('activities/activities-index.json')) || [];
  // Together, not one after another. Every save rebuilds the derived files from
  // the complete set, so this runs on every preview and every publish, and read
  // number twenty used to be waiting on read number nineteen for no reason.
  const records = await mapConcurrent(index, CONCURRENCY, (entry) => getPublished(entry.slug));
  return records.filter(Boolean);
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
//
// `map` is that substitution in reverse: future path → the data URL it came
// from. Preview needs it. A just-uploaded image is rewritten to
// /images/activities/… by the line above, but preview does not commit, so that
// file does not exist yet and the preview showed a broken image for every
// picture the admin had just chosen. The map lets the preview iframe put the
// data URL back — WITHOUT touching the rendered HTML, which stays byte-for-byte
// what publish would commit. See tests/preview-matches-publish.js.
function extractImages(activity) {
  const files = [];
  const map = {};
  const slug = activity.slug;

  // The filename carries a hash OF THE PICTURE, so replacing one produces a new
  // URL rather than new bytes at the old one.
  //
  // netlify.toml serves /images/* as `immutable` for a year, which tells a
  // browser never to revalidate. That was true when /images/ held only
  // hand-placed files; the admin made it a lie. Item ids are stable, so
  // re-uploading a teacher's photo in the same format reused the exact
  // filename — and every visitor who had already seen the old one kept it for
  // a year and could not be sent the new one. One sponsor logo here has served
  // three different files under a single URL.
  //
  // Hashing makes the header honest instead of weakening it. It also makes the
  // stale-image cleanup below fire on EVERY replacement rather than only when
  // the format (and so the extension) happened to change, which is what stops
  // repeated replacements accumulating orphans.
  //
  // Same picture re-uploaded means the same hash, so an unchanged image does
  // not churn its URL or bust anyone's cache for nothing.
  const take = (dataUrl, name) => {
    const img = decodeImage(dataUrl);
    if (!img) return null;
    const digest = crypto.createHash('sha256').update(img.base64).digest('hex').slice(0, 8);
    const path = `images/activities/${slug}-${name}-${digest}.${img.ext}`;
    files.push({ path, content: img.base64, encoding: 'base64' });
    map['/' + path] = dataUrl;
    return '/' + path;
  };

  // The square listing image. One per activity, so a fixed name rather than an
  // id: re-uploading replaces the file instead of accumulating one per attempt.
  // The extension still varies with the format, which is why publish also
  // deletes the paths a record has stopped pointing at.
  if (activity.cardImage && String(activity.cardImage).startsWith('data:')) {
    activity.cardImage = take(activity.cardImage, 'card') || null;
  }

  // The share card, overriding the site's own og-image for this activity. Same
  // fixed name for the same reason: one per activity, so re-uploading replaces
  // the file rather than leaving a trail of attempts behind.
  if (activity.shareImage && String(activity.shareImage).startsWith('data:')) {
    activity.shareImage = take(activity.shareImage, 'share') || null;
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
  return { files, map };
}

// Every image file a record owns, by exact path.
//
// Deliberately NOT a prefix match on `images/activities/<slug>-`: the slug
// "hebrew" would match "hebrew-for-kids-hero.png" and take another activity's
// pictures down with it. The record already knows precisely which files are
// its own, so it is asked.
// Pictures this record has STOPPED pointing at but has not deleted yet. See the
// deferred deletion in generate() for why they linger for one publish.
const retiredOf = (activity) =>
  ((activity && activity.retiredImages) || []).filter((p) => typeof p === 'string' && p);

function imagePathsOf(activity) {
  const out = [];
  const take = (value) => {
    const v = String(value || '');
    if (v.indexOf('/images/activities/') === 0) out.push(v.slice(1));
  };
  if (activity) {
    take(activity.cardImage);
    take(activity.shareImage);
    (activity.teachers || []).forEach((t) => take(t && t.photo));
    (activity.sponsors || []).forEach((s) => take(s && s.logo));
  }
  return out.filter((v, i) => out.indexOf(v) === i);
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
    ['status', 'motif', 'corner'].forEach((k) => {
      if (incoming[k] !== undefined) out[k] = incoming[k];
    });
    // The card image is one picture for every language, so it is structure, not
    // words. A role that may only edit Russian must not be able to change the
    // image every language shows, exactly as it cannot change the price.
    if (incoming.cardImage !== undefined) out.cardImage = incoming.cardImage || null;
    // The share image and the robots flag are one answer for all three
    // languages, so they travel with the structure. A Russian-only role must
    // not be able to deindex the Hebrew and English pages.
    if (incoming.shareImage !== undefined) out.shareImage = incoming.shareImage || null;
    if (incoming.robots !== undefined) {
      out.robots = ROBOTS.indexOf(incoming.robots) !== -1 ? incoming.robots : 'index';
    }
    out.ctaUrl = langObject(incoming.ctaUrl !== undefined ? incoming.ctaUrl : out.ctaUrl);
  } else {
    out.cardImage = (base && base.cardImage) || null;
    out.shareImage = (base && base.shareImage) || null;
    out.robots = (base && base.robots) || 'index';
    out.ctaUrl = langObject(out.ctaUrl);
  }

  SIMPLE_KEYS.forEach((k) => { out[k] = mergeLang(base && base[k], incoming[k]); });
  // The rich fields are markup, and the page prints that markup as markup.
  RICH_KEYS.forEach((k) => {
    const v = langObject(out[k]);
    LANGS.forEach((l) => { v[l] = sanitiseRich(v[l]); });
    out[k] = v;
  });

  // Facts split cleanly along the same line as everything else: the WORDS in a
  // fact (the location, the language of instruction, the not-yet-migrated
  // legacy sentence) merge per language, and the NUMBERS are structure that
  // only a full-access session may touch. A Russian reviewer can translate
  // "Limassol"; they cannot change the price.
  const baseFacts = (base && base.facts) || {};
  const incFacts = incoming.facts || {};
  const facts = {};
  FACT_KEYS.forEach((key) => {
    const cur = baseFacts[key] || {};
    const inc = incFacts[key] || {};

    if (TEXT_FACTS.indexOf(key) !== -1) {
      facts[key] = mergeLang(cur, inc);
      return;
    }
    const merged = SHAPES[key] ? SHAPES[key](full ? inc : cur) : {};
    if (key === 'location') merged.text = mergeLang(cur.text, inc.text);
    const legacy = mergeLang(cur.legacyText, inc.legacyText);
    if (LANGS.some((l) => String(legacy[l] || '').trim())) merged.legacyText = legacy;
    facts[key] = merged;
  });
  out.facts = normaliseFacts(facts);

  // Which facts are members-only is structure, not words.
  out.factVisibility = normaliseVisibility(
    full && incoming.factVisibility ? incoming.factVisibility : (base && base.factVisibility)
  );

  // These three moved into facts. Drop any copy an older client still sends,
  // so a stale tab cannot resurrect the pre-migration shape.
  delete out.programLength;
  delete out.instructionLanguage;
  delete out.prerequisites;

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

async function generate(input, { commit, session, message, previous }) {
  const activity = validate(JSON.parse(JSON.stringify(input)));
  const { files: imageFiles, map: imageMap } = extractImages(activity);

  // --- deferred image deletion ---------------------------------------------
  // A picture is NOT deleted in the same commit that stops referencing it. It is
  // recorded as retired, and removed one publish later.
  //
  // Deleting immediately opened a window that was worse than the orphan it
  // avoided. A deploy does not reach every edge at the same instant, and a
  // reader can be holding the previous HTML: for a minute after a replacement,
  // a page still asking for the old file met a tree that no longer had it. That
  // 404 was then served with /images/* long-cache headers and STUCK — the
  // browser kept it and stopped asking, so the picture was broken there for
  // good. It happened to a real teacher photo on this site.
  //
  // One publish of slack is enough: by the time a retired file is removed, the
  // deploy that referenced it is two deploys old. The list is recomputed from
  // scratch every publish, so it cannot grow, and a picture that comes back
  // (the same bytes hash to the same name) is dropped from it rather than
  // deleted. This must happen before the record is serialised below.
  const keeping = imagePathsOf(activity);
  const retiredNow = imagePathsOf(previous).filter((p) => keeping.indexOf(p) === -1);
  const dueForDeletion = retiredOf(previous).filter((p) => keeping.indexOf(p) === -1);
  if (retiredNow.length) activity.retiredImages = retiredNow;
  else delete activity.retiredImages;

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

  // And pictures retired by the PREVIOUS publish, which nothing has referenced
  // for a full deploy cycle. Without this they would sit in the repository for
  // good, unreferenced and still served, the way deleted activities used to
  // leave their photos behind.
  dueForDeletion.forEach((p) => { if (deletes.indexOf(p) === -1) deletes.push(p); });

  const result = {
    slug: activity.slug,
    activity,
    html,
    langs: present,
    files: files.map((f) => ({ path: f.path, encoding: f.encoding, bytes: f.content.length })),
    deletes,
    liveUrls: present.map((l) => `https://www.ogen.cy${pathFor(activity.slug, l)}`)
  };
  // Only preview needs the data URLs; sending megabytes back on a publish that
  // has already written the files would be pure waste.
  if (!commit) {
    result.imagePreview = imageMap;
    return result;
  }

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
          commit: true, session, previous: record,
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
        // Both, because a record can have a published page AND a newer draft
        // whose images were uploaded but never published.
        const published = await getPublished(slug);
        const draft = await getDraft(slug);
        let commit = null;
        if (published || draft) {
          const others = (await allPublished()).filter((a) => a.slug !== slug);
          // Delete means the activity should not exist. Leaving its images
          // behind left them on public URLs for good — including photographs of
          // children, for an activity someone had deliberately removed. Nothing
          // references them and nothing ever would; they were simply
          // unreachable-but-served. Unpublish is different and keeps them: the
          // draft still points at those paths and has to republish intact.
          // Retired-but-not-yet-removed pictures go too. They are still in the
          // repository and still served; nothing else will ever come back for
          // them once the record is gone.
          const images = imagePathsOf(published).concat(imagePathsOf(draft))
            .concat(retiredOf(published)).concat(retiredOf(draft));
          const deletes = LANGS.map((l) => filePathFor(slug, l))
            .concat([`activities/${slug}.json`])
            .concat(images.filter((v, i) => images.indexOf(v) === i));
          commit = await commitToBranch({
            files: buildDerivedFiles(others),
            deletes,
            message: `Delete activity: ${slug}\n\nvia Ogen admin by ${session.name} <${session.email}>`,
            authorName: session.name, authorEmail: session.email
          });
        }
        await dropDraft(slug);
        await recordAudit(session, 'delete', slug, 'ok', { commit: commit && commit.sha });
        return json(200, { ok: true, slug, commit, deleted: true,
                           removed: commit ? commit.removed : [] });
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
  sanitiseRich, RICH_KEYS,
  currentRecord, langObject, FIELD_SCHEMA, Conflict, SLUG_RE
};
