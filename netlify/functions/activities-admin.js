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
const { requireStore, optionalStore, readMany } = require('./_blobs');
const { readJson, commitToBranch, mapConcurrent, CONCURRENCY } = require('./_github');
const { recordAudit } = require('./_audit');
const {
  LANGS, STATUSES, MOTIFS, CORNERS, langsPresent, pick,
  filePathFor, pathFor, renderActivityPage,
  SUMMARY_CHARS: TEMPLATE_SUMMARY_CHARS
} = require('./_activity-template');
const { buildDerivedFiles, isPublic } = require('./_activity-index');
const FACTS = require('./_activity-facts');
const {
  FACT_ORDER, TEXT_FACTS, DEFAULT_VISIBILITY, ACADEMIC_MINUTES,
  num, pricePerHour
} = FACTS;
const { migrate, normaliseFacts, normaliseGroups, normaliseVisibility, SHAPES } =
  require('./_activity-migrate');
const SESSIONS = require('./_activity-sessions');
const REG = require('./_activity-registration');
const BUNDLE = require('./_bundle');
const GROUPS = require('./_activity-groups');
const SERIES = require('./_activity-series');
const { GROUP_FACTS } = GROUPS;

// How many day+time rows a frequency asks for. 'custom' means "as many as the
// admin adds", so it has no fixed count.
// Every frequency the calendar module can enumerate, plus custom, which it
// cannot — `custom` is whatever the admin typed, which is why it has no
// generator and why prorated cancellation has to refuse it.
//
// `generates` says whether "Generate sessions" can build a calendar from this.
// It is read from _activity-sessions rather than repeated, because a list of
// frequencies repeated in two files is a list that falls out of step, and this
// one already had: biweekly and monthly could be enumerated and rendered while
// this array coerced both back to weekly on save.
const FREQUENCIES = [
  { key: 'one-time', label: 'One time', sessions: 1 },
  { key: 'weekly', label: 'Weekly', sessions: 1 },
  { key: 'biweekly', label: 'Every other week', sessions: 1 },
  { key: 'twice-weekly', label: 'Twice weekly', sessions: 2 },
  { key: 'monthly', label: 'Monthly', sessions: 1 },
  { key: 'custom', label: 'Custom', sessions: null }
].map((f) => Object.assign({ generates: SESSIONS.GENERATED.indexOf(f.key) !== -1 }, f));

// Which week of the month a monthly activity meets in. 'last' clamps rather
// than failing on a month with only four of that weekday.
const WEEKS_OF_MONTH = [
  { key: 1, label: 'First week' }, { key: 2, label: 'Second week' },
  { key: 3, label: 'Third week' }, { key: 4, label: 'Fourth week' },
  { key: 5, label: 'Fifth week' }, { key: 'last', label: 'Last week' }
];

// act- so it is recognisable at a glance beside the a- and p- prefixes the
// account and participant ids will use, with no lookup needed to tell what a
// key refers to. Sixteen hex characters from the system CSPRNG: this is an
// identifier rather than a secret, but it is also permanent and public, and
// Math.random() collides far sooner than its output length suggests.
const mintActivityId = () => 'act-' + require('crypto').randomBytes(8).toString('hex');
const mintGroupId = () => 'g-' + require('crypto').randomBytes(6).toString('hex');
// A seriesId is always some activity's id, never a new identifier, so this is
// the only shape it may take. Validated on the way in because it decides whether
// a family is billed a registration fee: a client able to write an arbitrary
// string here is a client able to put an activity in a series that does not
// exist, where the waiver would silently never match.
const SERIES_ID = /^act-[0-9a-f]{16}$/;

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
    { key: 'summary', label: 'Card summary', counter: TEMPLATE_SUMMARY_CHARS,
      hint: 'Shown on the activities listing. The card gives it three lines and trims anything ' +
            'longer with an ellipsis. The count under each box is what three lines hold in the ' +
            'tightest of the three languages, so a summary inside it is not cut in any of them — ' +
            'it is a recommendation rather than a limit, and a longer one still saves.' },
    { key: 'about', label: 'About this activity', textarea: true, rich: true, required: true }
  ],
  // There is no `optional` group any more. It held exactly one field, "What to
  // bring", and that field is retired — see migrate(). An empty group is a shape
  // describing nothing, and the client would still have to render a container
  // for it, so it goes rather than staying as a hollow.
  //
  // Search and share. Its own group, and its own panel at the foot of the form,
  // because it is written once and then left alone, while everything above it is
  // what an admin actually comes here to edit. Sitting in the middle of the
  // content fields it read as another piece of body copy and got filled in with
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
    // ⚠ NOT `text` ANY MORE. These were the last two free-text facts — three
    // boxes holding whatever somebody typed — which meant an admin filling in
    // one language published one language, and "Beginners" was spelled a
    // different way on every activity. A list answers the question and is
    // rendered per language; the text box stays for anything the list cannot
    // say, which is the half an admin genuinely has to write.
    { key: 'instructionLanguage', label: 'Language of instruction', kind: 'languages' },
    { key: 'prerequisites', label: 'Prerequisites / level', kind: 'level' },
    { key: 'location', label: 'Location', kind: 'location',
      hint: 'The general area — "Limassol". Shown to everyone' },
    { key: 'address', label: 'Exact address', kind: 'location',
      hint: 'Street address. Members-only: it is NOT published on the page, and will not be until a members area exists' },
    { key: 'price', label: 'Price', kind: 'price' }
  ],
  // The Registration panel, between Activity facts and Search & sharing. None
  // of these is words: one answer serves all three languages, exactly like
  // robots and shareImage, so they merge as STRUCTURE and must never enter
  // SIMPLE_KEYS — that list is the translatable scalars, and a role permitted
  // to edit only Russian must not be able to move a cutoff date on the Hebrew
  // page.
  //
  // `types` says which activity types draw a field. A group the form did not
  // draw is not read back and is not merged, so switching a course to a drop-in
  // and back does not clear the term price — absent must mean "this type did
  // not send it", never "the admin emptied it".
  registration: REG.FIELDS,
  types: REG.TYPES,
  cancellationModes: REG.CANCELLATION_MODES,
  cutoffOff: REG.OFF,
  defaultExpiryDays: REG.DEFAULT_EXPIRY_DAYS,
  // The two closed lists the form draws from, labelled in English because the
  // admin is. The page renders them in the reader's own language.
  // ⚠ WHICH PANEL DRAWS WHICH FACT, from the one list that decides it. The
  // descriptors above stay a single list — one label, one hint, one editor kind
  // per fact, wherever it is drawn — and these two say where each one belongs.
  // A third copy in the client is how a fact ends up rendered on both screens,
  // or on neither.
  activityFacts: FACTS.ACTIVITY_FACTS,
  groupFacts: FACTS.GROUP_FACTS,
  instructionLanguages: FACTS.INSTRUCTION_LANGUAGES.map((c) => ({ key: c, label: FACTS.LANGUAGE_NAMES.en[c] })),
  levels: FACTS.LEVELS.map((k) => ({ key: k, label: FACTS.LEVEL_NAMES.en[k] })),
  frequencies: FREQUENCIES,
  weeksOfMonth: WEEKS_OF_MONTH,
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
  .concat(FIELD_SCHEMA.seo)
  .map((f) => f.key);
// Fields edited in the WYSIWYG, so their stored value is markup rather than
// words. Derived from the schema, so marking a field `rich` is the whole change.
const RICH_KEYS = FIELD_SCHEMA.simple.filter((f) => f.rich).map((f) => f.key);

const { sanitiseRich, RICH_TAGS } = require('./_sanitise-rich');

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
  return (await readMany(store, blobs.map((b) => b.key))).filter(Boolean);
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

// Every record a series head could be. Published pages AND drafts, because the
// form's series picker offers both — a spring term is usually created while the
// autumn one is still a draft.
//
// ⚠ A DRAFT SUPERSEDES ITS PUBLISHED COPY, the same way currentRecord() decides
// it: the draft is the newer edit, so a fee an admin has just typed on the head
// is the one a term saved a moment later must inherit. Reading the published
// file there would hand the term a figure the head itself has stopped showing.
async function seriesCandidates() {
  const [published, drafts] = await Promise.all([allPublished(), listDrafts()]);
  const bySlug = new Map();
  published.forEach((a) => { if (a && a.slug) bySlug.set(a.slug, a); });
  drafts.forEach((a) => { if (a && a.slug) bySlug.set(a.slug, a); });
  return Array.from(bySlug.values());
}

// The merge, plus the one field a record does not own by itself.
//
// ⚠ ONE HELPER RATHER THAN THREE CALL SITES. saveDraft, preview and publish all
// merged and none of them could have inherited anything, so the rule would have
// had to be remembered three times — and the one that forgot would be the one
// where an admin types a fee and it sticks. A test pins that nothing else in
// this file calls mergeByPermission directly.
//
// The candidate set is read ONLY when it can matter. An unlinked activity —
// which is every activity on this site today — asks nothing and pays nothing.
async function mergeFor(record, incoming, session) {
  const merged = mergeByPermission(record, incoming, session);
  const series = SERIES.isLinkedTerm(merged)
    ? SERIES.applyFee(merged, await seriesCandidates())
    : { inherits: false };
  return { merged, series };
}

// Thrown in the shape validate() throws, so the one channel the client already
// reads for a refusal carries this one too.
function refuse(message) {
  const err = new Error(message);
  err.validation = [message];
  throw err;
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

// Which sub-keys of a structured fact are WORDS. A role that may only edit
// Russian may translate these and nothing else — so the language codes and the
// level, which are one answer for all three pages, are deliberately absent.
//
// Module scope rather than inside the merge, because the SAME table now governs
// two merges: the activity's own facts and every group's copy of them. Two
// copies would be two places `address` can be forgotten, which is the bug this
// list was written to end.
const LANG_SUBKEYS = {
  location: ['text'], address: ['text'], groupSize: ['overrideText'],
  instructionLanguage: ['text'], prerequisites: ['text']
};

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

// One group list merged over another. `mergeLang` is passed in rather than
// imported because it closes over which languages this session may edit — the
// whole permission model in one function, and there is deliberately only one of
// it.
//
// A group's STRUCTURE — its capacity, its teachers, its timetable, its age range
// — comes from the request only with full access, and from the stored record
// otherwise. Its NAME and the word half of its facts merge per language. That is
// the same line every other field on this record is split along, drawn here by
// where the value sits rather than by a rule somebody has to remember.
function mergeGroups(baseGroups, incomingGroups, full, mergeLang) {
  const current = Array.isArray(baseGroups) ? baseGroups : [];
  const incoming = Array.isArray(incomingGroups) ? incomingGroups : [];
  const byId = (list, id) => list.filter((g) => g && g.groupId === id)[0];

  const skeleton = (full ? incoming : current).map((g) => g && g.groupId).filter(Boolean);

  return skeleton
    .filter((id, i) => skeleton.indexOf(id) === i)
    .map((id) => {
      const cur = byId(current, id) || { groupId: id };
      const inc = byId(incoming, id) || {};
      const out = {
        groupId: id,
        name: mergeLang(cur.name, inc.name),
        capacity: full ? (inc.capacity === undefined ? cur.capacity : inc.capacity) : cur.capacity,
        teacherIds: full && Array.isArray(inc.teacherIds) ? inc.teacherIds : (cur.teacherIds || []),
        facts: {}
      };
      GROUP_FACTS.forEach((key) => {
        const curF = (cur.facts || {})[key] || {};
        const incF = (inc.facts || {})[key] || {};
        const merged = SHAPES[key] ? SHAPES[key](full ? incF : curF) : {};
        (LANG_SUBKEYS[key] || []).forEach((sub) => {
          merged[sub] = mergeLang(curF[sub], incF[sub]);
        });
        const legacy = mergeLang(curF.legacyText, incF.legacyText);
        if (LANGS.some((l) => String(legacy[l] || '').trim())) merged.legacyText = legacy;
        out.facts[key] = merged;
      });
      return out;
    });
}

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
    // ⚠ A TEST ACTIVITY: published for real, reachable only by its own URL.
    //
    // Structure for the same reason robots is — whether an activity is on the
    // listing is one answer for all three trees, and a Russian-only role must
    // not be able to take the Hebrew page off it. It is deliberately NOT a
    // status: a test activity has to behave exactly like an open one, because
    // what it exists for is rehearsing registration and payment on the live
    // site. Only the ways of FINDING it are removed.
    if (incoming.testActivity !== undefined) out.testActivity = !!incoming.testActivity;
    // Which kind of activity this is, and everything the registration system
    // will read off it. Structure, so a restricted role keeps the stored values
    // below rather than sending them.
    if (incoming.type !== undefined) out.type = REG.normaliseType(incoming.type);
    // Field by field, keeping whatever this type's form did not draw. See
    // mergeRegistration — absent must mean "this type did not send it".
    if (incoming.registration !== undefined) {
      out.registration = REG.mergeRegistration(
        base && base.registration, incoming.registration, out.type);
    }
  } else {
    out.cardImage = (base && base.cardImage) || null;
    out.shareImage = (base && base.shareImage) || null;
    out.robots = (base && base.robots) || 'index';
    out.testActivity = !!(base && base.testActivity);
    out.type = REG.normaliseType(base && base.type);
    out.registration = REG.normaliseRegistration(base && base.registration, out.type);
  }

  // NEVER from the incoming request, at any permission level. The id is the
  // thing registrations will point at, so a client able to change it is a client
  // able to reattach one activity's registrations to another. It is minted once
  // by stamp() and only ever copied forward from the stored record.
  if (base && base.activityId) out.activityId = base.activityId;
  else delete out.activityId;

  // The series IS settable, and that is the difference between the two. An
  // activityId answers "which record is this"; a seriesId answers "which
  // activity is this a term of", which is a judgement an admin makes when they
  // create the spring term. It is structure rather than words — one answer for
  // all three languages — so a role permitted to edit only Russian cannot move
  // an activity into another's series and change what a family is billed.
  if (full && incoming.seriesId !== undefined) {
    out.seriesId = SERIES_ID.test(String(incoming.seriesId || '')) ? incoming.seriesId : null;
  } else if (base && base.seriesId) {
    out.seriesId = base.seriesId;
  }
  // A blank series is this record's own id: every activity is a series of one
  // until somebody says otherwise. Written here rather than left absent so the
  // stored record always answers the question.
  if (!out.seriesId && out.activityId) out.seriesId = out.activityId;

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
  // Which sub-keys of a structured fact are words, listed rather than tested for
  // one at a time. `address` was missing from the if-chain this replaces, so a
  // Russian-only role could never translate the address — the numbers path took
  // it from the stored record and the merge never ran. A list makes forgetting
  // one a visible omission instead of a silent read-only field.
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
    // The same undrawn-field rule the registration block has, for the two price
    // fields that are type-scoped: a course draws the term price and a drop-in
    // draws the session price, and the one that was not drawn has to survive.
    const incFact = full ? REG.keepUndrawnFactKeys(key, cur, inc, out.type) : cur;
    const merged = SHAPES[key] ? SHAPES[key](incFact) : {};
    (LANG_SUBKEYS[key] || []).forEach((sub) => {
      merged[sub] = mergeLang(cur[sub], inc[sub]);
    });
    const legacy = mergeLang(cur.legacyText, inc.legacyText);
    if (LANGS.some((l) => String(legacy[l] || '').trim())) merged.legacyText = legacy;
    facts[key] = merged;
  });
  out.facts = normaliseFacts(facts);

  // ⚠ THE GROUPS, MERGED PER ITEM — which is the thing LANG_SUBKEYS could not do.
  //
  // That table merges a scalar sub-key of ONE fact. A group's name lives at
  // groups[i].name, per item, which it cannot reach — so a translator-only role
  // had no way to rename a group and, worse, would have had the stored list
  // written back over itself by any merge that walked the record key by key.
  //
  // Matched by groupId, never by position: reordering the list in the admin must
  // not hand one group's capacity to another. With full access the membership
  // and the order come from the request; a restricted role keeps the stored list
  // exactly and may change only the words in it — the same rule LIST_KEYS below
  // already applies to teachers and sponsors.
  out.groups = mergeGroups(base && base.groups, incoming.groups, full, mergeLang);

  // ⚠ EVERY ACTIVITY HAS AT LEAST ONE GROUP, and a brand-new one gets it here —
  // in the merge rather than in stamp(), because PREVIEW does not stamp. Put it
  // in stamp() and a new activity previews as a validation failure and publishes
  // fine, which is the one asymmetry `preview-matches-publish` exists to forbid.
  //
  // migrate() builds the group for a record that predates groups, out of the
  // facts that record already had. A record created today has no facts to build
  // from, so there is nothing for a pure function to derive and the id has to be
  // minted — the same reason activityId is minted on this side and not in there.
  // Its name stays blank: one group offers no choice, so nothing is published
  // and nobody is asked.
  if (!out.groups.length) out.groups = normaliseGroups([{ groupId: mintGroupId() }]);

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
  // The registration settings, refused on save rather than accepted and found
  // to be unusable at the moment a family is cancelling.
  REG.validateRegistration(activity).forEach((m) => errors.push(m));
  // Bundles, for the same reason: a half-filled one is silently never offered,
  // and "the bundle I set up does not appear" is a bug report rather than a
  // message. Only on a drop-in, because a course draws no bundle fields and its
  // stored list — if it has one from before a type switch — is not being edited.
  if (activity.type === 'dropin') {
    BUNDLE.validateBundles(((activity.facts) || {}).price).forEach((m) => errors.push(m));
  }
  // ⚠ EQUAL TOTAL INSTRUCTIONAL HOURS, AND A NAME ONCE THERE IS A CHOICE.
  //
  // There is one `fullPrice` for an activity, so what it buys has to be the same
  // whichever group a family joins — groups may cut that time up differently
  // (six two-hour meetings, twelve one-hour ones) and may not differ in how much
  // of it there is. Refused here rather than rendered, because the symptom would
  // be one group's family being quoted the other group's term.
  //
  // This REPLACES the older rule that every group met the same NUMBER of times,
  // which was strictly stronger and refused a shape Ogen actually runs.
  GROUPS.validateGroups(activity).forEach((m) => errors.push(m));

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
  const published = await allPublished();
  const others = published.filter((a) => a.slug !== activity.slug);

  // ⚠ THE OTHER DIRECTION OF THE INHERITED FEE, and it costs no extra request.
  //
  // A linked term re-reads its head's fee on every one of its own saves, so the
  // copy can only go stale one way: the HEAD's fee is edited and a term is not
  // saved afterwards. That term's page then goes on printing the old figure and
  // charging a newcomer it, with nothing erroring.
  //
  // Named rather than fixed here: rewriting another activity's record inside
  // this publish would commit a page nobody asked to publish, and generate()
  // already runs close to the ten seconds Netlify allows. Two clicks that are
  // visible beat a silent write.
  const seriesStale = SERIES.staleMessage(activity, SERIES.staleTerms(activity, published));
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
    liveUrls: present.map((l) => `https://www.ogen.cy${pathFor(activity.slug, l)}`),
    seriesStale
  };
  // Only preview needs the data URLs; sending megabytes back on a publish that
  // has already written the files would be pure waste.
  if (!commit) {
    result.imagePreview = imageMap;
    return result;
  }

  // ⚠ WHAT WAS ON THE SITE BEFORE THIS PUBLISH, which is NOT `previous`.
  //
  // `previous` is the working copy, and a draft supersedes the published file —
  // see currentRecord(). So an admin who changes a cutoff, presses Save, then
  // presses Publish hands this function a `previous` that already carries the new
  // date, and a comparison against it says nothing moved. The families' terms
  // were frozen against what was PUBLISHED, so that is what the change has to be
  // measured from.
  //
  // It costs no extra request: allPublished() above already reads this slug's own
  // record and then filters it out to rebuild the derived files.
  //
  // Underscored, and stripped by the caller, so it never travels to the browser.
  result._publishedBefore = published.filter((a) => a.slug === activity.slug)[0] || null;

  result.commit = await commitToBranch({
    files,
    deletes,
    message: message || `Publish activity: ${activity.slug}`,
    authorName: session && session.name,
    authorEmail: session && session.email
  });
  return result;
}

// One line for the audit trail. Rewriting terms a family agreed to and mailing
// them about it is the most consequential thing a publish can do, and `ok` beside
// a commit sha says nothing about it.
function falloutAudit(fallout) {
  if (!fallout) return null;
  if (fallout.error) return 'fallout failed: ' + fallout.error;
  const bits = [];
  const t = fallout.terms || {}, r = fallout.room || {};
  if (t.changed) bits.push(t.changed + ' re-termed, ' + t.emailed + ' emailed');
  if (r.groups && r.groups.length) bits.push(r.told + ' told of ' + r.groups.length + ' reopened group(s)');
  (t.failed || []).concat(r.failed || []).forEach((f) => bits.push('FAILED ' + f));
  return bits.length ? bits.join(' · ') : null;
}

// Does the generated calendar actually reach the stated end date? Returns a
// sentence when it does not, and null when there is nothing to say.
function reachesEnd(dates, duration) {
  const end = duration && duration.endDate;
  if (!dates.length || !end) return null;
  const last = dates[dates.length - 1];
  const typed = Number(duration.sessionCount);
  if (last < end && typed > 0 && dates.length >= typed) {
    return `The ${dates.length} sessions run out on ${last}, but the end date says ${end}. ` +
      'Either the count is low, the end date is late, or there is a break week — worth ' +
      'settling now rather than when a refund is being calculated.';
  }
  return null;
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

  // The single place a save marks a record, which makes it the single place the
  // two things a save must do to the registration block can live.
  const stamp = (record) => {
    record.isoUpdated = new Date().toISOString();
    record.isoCreated = record.isoCreated || record.isoUpdated;
    record.lastEditedBy = session.email;
    record.lastEditedByName = session.name;
    // Minted here rather than in migrate(), which is pure and must stay so: an
    // id is random, and a pure function that invents one is not idempotent.
    // Only ever filled in when absent.
    if (!record.activityId) record.activityId = mintActivityId();
    // A series of one, unless the admin pointed this term at another. Never
    // minted: a seriesId is always some activity's id.
    if (!record.seriesId) record.seriesId = record.activityId;
    // Fill a blank cutoff, never overwrite a value that is there. On save
    // rather than on create, because at create time the dates these are
    // computed from have usually not been typed yet.
    record.registration = REG.defaultIfBlank(record);
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
            // The form's series picker needs both: the id to point AT, and the
            // series each candidate already belongs to, so choosing a term that
            // is itself part of a series joins the series rather than starting a
            // third one.
            activityId: a.activityId || null, seriesId: a.seriesId || a.activityId || null,
            // ⚠ AND ITS REGISTRATION FEE, so the form can show the figure a term
            // is about to inherit the moment the picker moves rather than after a
            // save. Cosmetic like every client-side check here: the server
            // resolves it again from the record and its answer is the one stored.
            registrationFee: SERIES.feeOf(a),
            title: a.title, langs: langsPresent(a),
            // So the picker can mark it. A test activity is invisible everywhere
            // it is supposed to be invisible, which makes the admin's own list
            // the only place anybody can see that it exists at all.
            testActivity: !!a.testActivity,
            isoUpdated: a.isoUpdated || null,
            lastEditedByName: a.lastEditedByName || null,
            urls: langsPresent(a).map((l) => pathFor(a.slug, l))
          })
        );
        drafts.forEach((a) =>
          bySlug.set(a.slug, {
            slug: a.slug, status: a.status, where: 'draft',
            activityId: a.activityId || null, seriesId: a.seriesId || a.activityId || null,
            registrationFee: SERIES.feeOf(a),
            title: a.title, langs: langsPresent(a),
            testActivity: !!a.testActivity,
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
        const { merged, series } = await mergeFor(record, body.activity || {}, session);
        // Refused on preview exactly as at publish: a preview that renders a fee
        // publish would not is a preview that lies, which is the one thing
        // preview-matches-publish forbids.
        if (series.problem) refuse(series.problem);
        const out = await generate(merged, { commit: false, session });
        return json(200, { ok: true, dryRun: true, ...out });
      }

      // Generate the session calendar. A round trip rather than the same
      // enumeration written again in the browser: the dates the admin edits
      // here are the dates the page publishes and the dates a refund is priced
      // against, and two implementations of that is one of them being wrong.
      //
      // It COMMITS NOTHING. The rows come back, the admin edits them, and they
      // are saved with the rest of the record like any other field — so
      // "generate once, then edit by hand" is literally what happens.
      case 'sessions': {
        const schedule = (body.schedule && typeof body.schedule === 'object') ? body.schedule : {};
        const duration = (body.duration && typeof body.duration === 'object') ? body.duration : {};
        const dates = SESSIONS.enumerate({
          frequency: schedule.frequency,
          sessions: schedule.sessions,
          weekOfMonth: schedule.weekOfMonth,
          startDate: duration.startDate,
          endDate: duration.endDate,
          // The typed count is a CAP, not the answer. An admin who says ten
          // sessions and a span holding eleven gets ten; the calendar is then
          // the source of truth and the count is derived from it.
          limit: duration.sessionCount
        });
        return json(200, {
          ok: true,
          sessionDates: SESSIONS.mergeExclusions(dates, duration.sessionDates),
          // Surfaced rather than silently resolved. hebrew4kids already says
          // ten sessions across a span holding eleven, and nothing has ever
          // read those two fields against each other — under prorated
          // cancellation the disagreement decides how much money a family gets
          // back, so it is shown to an admin while one is present.
          note: reachesEnd(dates, duration)
        });
      }

      case 'saveDraft': {
        const incoming = body.activity || {};
        const slug = String(incoming.slug || '');
        if (!SLUG_RE.test(slug)) return json(400, { error: 'Bad slug' });
        const { record } = await assertFresh(slug, body.baseUpdatedAt, { overwrite: body.overwrite });
        const { merged: draftRecord, series } = await mergeFor(record, incoming, session);
        const merged = stamp(draftRecord);
        merged.status = 'draft';
        await putDraft(merged);
        await recordAudit(session, 'save-draft', slug, body.overwrite ? 'overwrite' : 'ok');
        // ⚠ A DRAFT IS SAVED WHATEVER IS IN IT, AND IS TOLD WHAT WOULD STOP IT.
        //
        // validate() ran on preview and on publish and never here, which is the
        // right call — a draft is work in progress, and a form that refuses a
        // save because a panel further down is half-filled is a form people
        // fight. But saying NOTHING made the same rule invisible: QA set
        // prorated cancellation on an activity with no session calendar, saved,
        // and reported that it went through with no issue. It had. The refusal
        // was waiting at publish, which is the wrong moment to meet a
        // configuration problem and the wrong screen to be looking at.
        //
        // So the answer is neither accept-in-silence nor refuse: the draft is
        // saved and the same messages come back as `warnings`. One validate(),
        // so what a warning says here and what the refusal says at publish
        // cannot drift into two different accounts of one rule.
        let warnings = [];
        try { validate(JSON.parse(JSON.stringify(merged))); }
        catch (err) { warnings = err.validation || [err.message]; }
        // A draft saves whatever is in it, this one included — and is told. The
        // same string publish refuses with, so the two cannot drift into two
        // accounts of one rule.
        if (series.problem) warnings.push(series.problem);
        return json(200, { ok: true, slug, baseUpdatedAt: merged.isoUpdated,
                           activity: merged, warnings: warnings });
      }

      case 'publish': {
        if (!canPublish(session, TOOL)) {
          return json(403, { error: 'Your role may edit Activities but not publish them' });
        }
        const incoming = body.activity || {};
        const slug = String(incoming.slug || '');
        if (!SLUG_RE.test(slug)) return json(400, { error: 'Bad slug' });

        const { record, overwritten } = await assertFresh(slug, body.baseUpdatedAt, { overwrite: body.overwrite });
        const { merged: toPublish, series } = await mergeFor(record, incoming, session);
        if (series.problem) refuse(series.problem);
        const merged = stamp(toPublish);
        if (merged.status === 'draft') {
          return json(400, { error: 'Set a status other than Draft to publish. Draft activities are never committed.' });
        }
        merged.lastPublishedAt = merged.isoUpdated;

        const { _publishedBefore: publishedBefore, ...out } = await generate(merged, {
          commit: true, session, previous: record,
          message: `Publish activity: ${slug} (${merged.status})\n\nvia Ogen admin by ${session.name} <${session.email}>`
        });
        // git is now the source of truth for this slug.
        await dropDraft(slug);

        // ⚠ AND THE PUBLISH REACHES THE PEOPLE ALREADY REGISTERED.
        //
        // Two things on this form are facts about them rather than page content:
        // a cutoff date, which now governs the registrations already taken, and a
        // group's capacity, which opens places the waiting list has to hear
        // about. See _registration-fallout.js for both rules and for the cost of
        // the first one.
        //
        // ⚠ REQUIRED LAZILY, and after the commit. It pulls in the registration
        // store, the account store and the mailer, none of which an ordinary
        // publish needs; and the files are in git by now, so nothing here may
        // throw the publish away. A failure is NAMED rather than swallowed —
        // silence would leave an admin believing families were told — and both
        // halves are idempotent, so the next publish finishes the job.
        let fallout = null;
        try {
          fallout = await require('./_registration-fallout')
            .afterPublish(merged, publishedBefore);
        } catch (err) {
          fallout = { error: err.message };
        }

        await recordAudit(session, 'publish', slug, overwritten ? 'overwrite' : 'ok',
          { commit: out.commit.sha, detail: falloutAudit(fallout) });
        return json(200, { ok: true, ...out, fallout: fallout, baseUpdatedAt: merged.isoUpdated });
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
  // generate/allPublished/getPublished are also the nightly sweep's publish
  // path. It must go through THIS generate() and not a second renderer, for the
  // same reason preview does: a publish that renders through different code is
  // a publish that can differ from the one an admin would have made.
  generate, allPublished, getPublished,
  validate, mergeByPermission, mergeFor, seriesCandidates, assertFresh, extractImages, decodeImage,
  sanitiseRich, RICH_KEYS,
  currentRecord, langObject, FIELD_SCHEMA, Conflict, SLUG_RE
};
