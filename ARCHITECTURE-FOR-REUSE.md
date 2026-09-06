# Architecture for reuse

How the Shirat HaYam admin backend works, written for someone reimplementing the
same patterns in a different project with no prior knowledge of this codebase.

Stack: hand-written static HTML, no build step, no bundler, no framework.
`package.json` has **no `scripts`**. Netlify hosting, Netlify Functions (CommonJS,
Node 20, esbuild), Netlify Blobs. Every path below is real and current.

**The one-sentence version:** the admin is a browser CMS whose backends render
static HTML and commit it into this repository through the GitHub REST API, which
triggers a Netlify deploy. Content lives in git. Blobs holds everything that is
not content.

---

## 1. Authentication

### Mechanism: custom, not Netlify Identity

There is no third-party auth. Netlify Identity is not used. Auth is ~200 lines
across three files.

| File | Role |
|---|---|
| `netlify/functions/_user-store.js` | Accounts in the Blobs store `admin-users`, keyed `user-<encodeURIComponent(email)>`. Passwords hashed with `bcryptjs` at 12 rounds. Plaintext never stored or logged. |
| `netlify/functions/_session-store.js` | Sessions in the Blobs store `admin-sessions`, keyed `sess-<token>`. `authenticate()` is the single entry point. |
| `netlify/functions/admin-login.js` | `POST /api/admin-login` — `{ action: 'login' \| 'logout' }`. |

**Login flow:**

1. Client posts `{ action: 'login', email, password }` to `/api/admin-login`.
2. `getUser(email)` → `verifyPassword()` (`bcrypt.compare`).
3. `createSession(user)` mints `crypto.randomUUID()`, resolves the user's role via
   `_roles.js`, and writes to `admin-sessions`:

```json
{
  "token": "6f1c…-uuid",
  "email": "someone@example.org",
  "name": "Someone",
  "role": "content-editor",
  "roleName": "Content Editor",
  "permissions": { "pageBuilder": { "access": true, "edit": ["he","en","ru"], "publish": true }, "…": {} },
  "expiresAt": 1756300000000
}
```

4. The client gets back `{ token, name, role, roleName, permissions }` and keeps
   it in **`sessionStorage`** (`js/admin-session.js`, `window.AdminSession`).

The permission object is **copied onto the session at login**, not looked up per
request. Changing a role does not affect live sessions until they expire.

### How a protected route checks the session

There are no protected *routes*. Every admin page is a plain static HTML file
that anyone can fetch; the gate is on the **API**, and every admin function opens
with the identical three lines:

```js
const session = await authenticate(body);
if (!session) return json(401, { error: 'Unauthorized' });
if (!canAccess(session, 'pageBuilder')) return json(403, { error: '…' });
```

`authenticate(body)` accepts `{ token }`. The client supplies it by merging
`AdminSession.auth()` into **every request body** — auth travels in the JSON body,
not a header, because every endpoint is already a POST with an action.

`getSession()` re-validates on every call: token exists, not past `expiresAt`, and
the underlying user still exists and is `active !== false`. Expired or orphaned
tokens are **deleted on read** (lazy cleanup, no sweeper job). Deactivating a user
kills their live session on their next request.

**Client-side permission checks are cosmetic.** `js/admin-session.js` mirrors the
server helpers so the UI can grey things out; the server re-checks
`canAccess` / `canPublish` / `canEditLang` on every action. Assume the client is
hostile.

### Bootstrap: the legacy password escape hatch

Worth copying. `authenticate()` also accepts `{ password }` — but **only while
`anyUsersExist()` is false** — and returns a synthetic Super Admin session
(`legacySession()`, flagged `legacy: true`). This means a freshly deployed site
with an empty Blobs store still works from `ADMIN_PASSWORD` alone, long enough to
create the first real account. The moment one user exists, the password stops
being accepted. No chicken-and-egg, no seed script.

### Roles and permissions

`netlify/functions/_roles.js`. Four **built-in roles defined in code** that cannot
be deleted; custom roles live in the Blobs store `admin-roles` keyed by `roleId`.
`listRoles()` merges built-ins first, then custom.

Permission shape is **per tool**, and the shape differs by tool:

```js
pageBuilder    : { access: bool, edit: ['he','en','ru'], publish: bool }
homepageEditor : { access: bool, edit: [...],            publish: bool }
eventGenerator : { access: bool, edit: [...],            publish: bool }
members        : { access: bool }
users          : { access: bool }
roles          : { access: bool }
```

| Role | Shape |
|---|---|
| `super-admin` | Everything, including `users` and `roles` |
| `content-editor` | Pages + events + homepage, all languages, may publish |
| `event-manager` | `eventGenerator` only |
| `ru-reviewer` | `access: true`, `edit: ['ru']`, **`publish: false`** across the three content tools |

**Yes, the structure supports more than one role and is genuinely used.** The
three-axis model (`access` / `edit[langs]` / `publish`) is the part worth
stealing. It cleanly expresses "may open the tool, may only touch these
languages, may not publish", which turned into a real workflow — see the RU
Reviewer draft flow in §3.

Helpers exported from `_session-store.js`, all null-safe:
`canAccess(session, tool)`, `canPublish(session, tool)`,
`editLangs(session, tool)` → array, `canEditLang(session, tool, lang)`,
`isSuperAdmin(session)`.

### Provisioning a new admin user

Super Admin only, at `/admin/users.html` → `POST /api/admin-users`
(`netlify/functions/admin-users.js`, gated on the `users` permission):

1. `{ action: 'create', email, name, adminRole, password }`.
2. `_user-store.js` hashes the password and writes:

```json
{
  "email": "someone@example.org",
  "passwordHash": "$2a$12$…",
  "name": "Someone",
  "types": ["admin"],
  "adminRole": "content-editor",
  "active": true,
  "createdAt": "2026-08-27T09:00:00.000Z",
  "createdBy": "michal@example.org",
  "lastLogin": null
}
```

`listUsers()` returns `publicUser()` shapes and **never leaks `passwordHash`**.

There is no invite email and no self-service password reset on the admin side —
a Super Admin sets the password and communicates it. (The separate *member*
system does have token-based set-password links; see the note below.)

### Two identity systems, deliberately not shared

This project also has a public community-member login (`_member-store.js`,
`_member-session.js`, store `member-sessions`, keys `msess-<token>`). It is a
**completely separate system** from the admin one: different store, different key
prefix, neither can resolve the other's token, member sessions carry no
permissions object, and there is no legacy-password fallback on the member side.
Asymmetries are deliberate — member sessions last 7 days in `localStorage` and
slide on use; admin sessions are 8 hours in `sessionStorage` because they carry
publish rights.

If your project has both staff and public accounts, **keep them separate**.
The temptation to unify them is strong and wrong.

---

## 2. Content storage

### Netlify Blobs is used — but *not* for content

This is the single most important correction to make before copying anything.

| Data | Lives in |
|---|---|
| Pages, events, homepage copy, images | **git** (this repo), committed by the admin functions |
| Sessions, users, roles, drafts, registrations, members, audit log, email log | **Netlify Blobs** |

Content is in git because the site is static: the deployed artifact *is* the
content. Blobs holds operational state that must not require a deploy to change.

### `_blobs.js` — the only place a store is opened

```js
const { requireStore, optionalStore } = require('./_blobs');
```

- `requireStore(name)` — throws a readable error naming the env vars to set. Use
  where a misconfiguration should surface loudly (writes).
- `optionalStore(name)` — returns `null` and logs. Use where the path should
  degrade quietly (reads, best-effort writes like the audit log).
- It **prefers explicit `siteID` + `token`** (`NETLIFY_BLOBS_SITE_ID`,
  `NETLIFY_BLOBS_TOKEN`) over the automatic runtime context, because the
  automatic context can resolve to a non-durable scope. Copy this. Passing
  `consistency: 'strong'`.

Stores in use: `admin-users`, `admin-roles`, `admin-sessions`, `admin-audit`,
`email-log`, `page-drafts`, `homepage-drafts`, `enquiries`, `potluck`,
`community-members`, `member-sessions`, `member-tokens`, `event-registrations`,
`wallet-transactions`.

### Blob key conventions

Two conventions, both worth copying:

**1. Prefix + encoded id, so a listing is a prefix scan rather than a full read.**

```
reg-<encodeURIComponent(email)>__<event-slug>     event-registrations
log-<encodeURIComponent(email)>__<ISO>__<rand>    email-log
wal-<encodeURIComponent(email)>__<ISO>__<rand>    wallet-transactions
user-<encodeURIComponent(email)>                  admin-users
```

`encodeURIComponent` because an email can contain characters that break a key.
`__` as the separator because it cannot appear in a percent-encoded segment.
The ISO timestamp in the middle makes entries sort chronologically *within* a
member. The random tail stops two writes in the same millisecond overwriting
each other.

**2. A pointer key when a second lookup axis is needed.**

`email-log` also writes `rid-<resend-id>` → `{ key: "log-…" }`, because the
delivery webhook knows only the provider's message id and scanning the store for
it would not scale. One extra write, one extra read, no index to maintain.

### Content record shapes

**Events** — `events/events-index.json`, a **public** file, an array, newest
first. This is the single source of truth for events; `events/<slug>.html` is a
build artifact generated from it.

```json
{
  "slug": "rosh-hashanah-5787",
  "status": "open",
  "isoDate": "2026-09-11T18:00:00+03:00",
  "endIso": "2026-09-12T12:00:00+03:00",
  "thumb": "/images/events/rosh-hashanah-5787.png",
  "ogImage": null,
  "timeRange": "18:00 – 12:00",
  "pricePerPerson": 0,
  "capacity": null,
  "emoji": "",
  "needsPotluck": false,
  "potluckUrl": null,
  "heroGradient": { "color": "#7f8169", "direction": "diagonal" },
  "showExpect": false,
  "schedule": [
    { "id": "session-1", "date": "2026-09-11", "timeRange": "18:00 – 22:00",
      "he": { "name": "ערב ראש השנה" }, "en": { "name": "Rosh HaShanah Eve" } }
  ],
  "he": {
    "title": "ראש השנה",
    "date": "יום שישי, 11 בספטמבר 2026",
    "desc": "…short description…",
    "about": "<p>…rich HTML from Quill…</p>",
    "expect": ["bullet", "bullet"],
    "locationPublic": "לימסול. מיקום מדויק יינתן לאחר רישום.",
    "metaTitle": "…", "metaDescription": "…"
  },
  "en": { "…": "identical shape" },
  "ru": { "…": "identical shape, may be partial" }
}
```

**Pages** — `pages/<slug>.json` is the source; `pages/pages-index.json` is a
lightweight list for the admin and the nav. Top-level keys:

```
slug, type, navPlacement, title, navLabel, hero, folds, faq, form, seo,
ruState, flatReviewState, groupChangeLog, lastEditedBy, lastEditedAt, isoUpdated
```

`folds` is the repeatable body: an ordered array of `{ type, … }` where `type` is
`text` | `textimage` | `cards` | `gallery`. One fold:

```json
{
  "type": "textimage",
  "title":     { "he": "…", "en": "…", "ru": "…" },
  "body":      { "he": "<p>…</p>", "en": "…", "ru": "…" },
  "imageAlt":  { "he": "…", "en": "…", "ru": "…" },
  "imagePosition": "left",
  "bg": "cream",
  "image": "/images/pages/bar-mitzvah-cyprus-fold-0.jpg",
  "ruState":      { "title": "ai", "body": "manual" },
  "reviewState":  { "needsReview": false },
  "changeLog":    [ { "action": "EN updated", "userName": "Michal", "timestamp": "…" } ]
}
```

**Every user-facing string is a `{he, en, ru}` object, not a string.** Do this
from day one. Retrofitting it is expensive — `langBlockFrom()` in
`_event-costs.js` exists only to migrate old plain strings into every language
rather than dropping them.

### Public vs private data in the same record

A deliberate split worth copying. `events/events-index.json` is served by the web
server, so **anything in it is published**. Data that must not be public lives in
JSON files under `netlify/functions/`, which `netlify.toml` excludes from the
published directory:

- `netlify/functions/_event-locations.json` — exact street addresses and map links
- `netlify/functions/_event-costs.json` — price tiers and amounts

Functions `require()` them at runtime and release them only to an authorised
caller. `netlify/functions/_events.js` joins the public and private files into
the view used for checkout and confirmation emails — it is generated, never
hand-maintained.

### Drafts, versioning, timestamps

- **Versioning: git.** Every publish is a commit. `git log`/`git revert` is the
  version history and the rollback. There is no in-app version list.
- **Drafts: Blobs, keyed by slug.** `page-drafts` store:
  - `draft-<slug>` — the admin's own autosave (`_new` for an unsaved page).
    Mirrored to `localStorage` under `shPageDraft` for cross-device sync.
  - `ru-review-draft-<slug>` — an RU Reviewer's submission, **deliberately a
    different key** so a reviewer and an admin can never clobber each other.
  - `event-meta-<slug>` — change history for an event.
  - Drafts strip base64 image bytes (`stripImageData`) — images are re-selected
    before publishing. A Blob holding a 1.3 MB data URL per autosave is not fine.
- **Published state is the file's existence in git.** There is no
  `published: true` flag. An event's `status` field (`announced` / `open` /
  `cancelled` / `archived`) controls *display*, not publication.
- **Timestamps:** `isoCreated` / `isoUpdated` on the page index entry;
  `lastEditedBy` / `lastEditedAt` / `lastPublishedAt` on the meta record.
  Change history that names staff is kept **out of the public JSON** and in Blobs
  (`event-meta-<slug>`, `homepage-meta`) — a public change log is a list of the
  names of the people who work here.

---

## 3. Publishing — how saved content becomes a live page

**It writes real static HTML files into the repository via the GitHub API.**
Nothing is rendered at request time. There is no build-time regeneration step
(no SSG; Netlify's "build" for this repo is a no-op that just publishes the
directory).

### Step by step, when an admin hits Publish

Taking the Page Builder (`netlify/functions/page-builder.js`, `case 'save'`):

1. **Auth + permission.** `authenticate(body)` → `canPublish(session, 'pageBuilder')`.
   403 if the role may not publish.
2. **Validate and collect artifacts.** `buildArtifacts(input)` validates the slug
   (`^[a-z0-9]+(?:-[a-z0-9]+)*$`), the page type, and required titles. Images
   arrive as **base64 data URLs** in the JSON body, are decoded by
   `decodeImage()`, and become `{ path, content, encoding: 'base64' }` entries.
   The stored reference is rewritten to a site-root-absolute path
   (`/images/pages/<slug>-hero.jpg`) because pages live at `/services/<slug>`
   where a relative path would 404.
3. **Render the HTML.** `renderPage(page, lang)` from
   `netlify/functions/_page-template.js`, once per language. This is a pure
   function: JSON in, complete HTML document out.
4. **Read the current index and nav from GitHub** (`getFileContent()`), not from
   the deployed bundle. See the pitfall in §6.
5. **Recompute derived files.** The page index entry, and `patchNav()` which
   inserts the page into the `const services = [...]` / `const infoPages = [...]`
   arrays inside `js/nav.js` by regex.
6. **Assemble one file list:**

```js
[
  { path: 'services/<slug>.html',    content: heHtml,  encoding: 'utf-8' },
  { path: 'en/services/<slug>.html', content: enHtml,  encoding: 'utf-8' },
  { path: 'ru/services/<slug>.html', content: ruHtml,  encoding: 'utf-8' },  // only if it has Russian
  { path: 'pages/<slug>.json',       content: json,    encoding: 'utf-8' },  // the source
  { path: 'pages/pages-index.json',  content: json,    encoding: 'utf-8' },
  { path: 'js/nav.js',               content: newNav,  encoding: 'utf-8' },
  { path: 'images/pages/<slug>-hero.jpg', content: b64, encoding: 'base64' }
]
```

7. **One atomic commit.** `commitToBranch()` in `netlify/functions/_github.js`
   uses the **git data API**, not the contents API: create a blob per file →
   create a tree on top of the base commit's tree → create a commit → `PATCH`
   `refs/heads/main` with `force: false`. Every file lands in a single commit or
   none does. There is no PR and no merge step.
8. **Audit.** `recordAudit(session, 'create-page', slug, 'publish')` appends one
   best-effort entry to the `admin-audit` store, keyed `<ISO>-<slug>` so keys
   sort chronologically. **Audit failures must never block the action they
   describe.**
9. **Return** `{ ok, slug, commitUrl, liveUrls }`.

Netlify sees the push to `main` and deploys.

### Functions involved

| Function | Route | Does |
|---|---|---|
| `admin-login.js` | `/api/admin-login` | login / logout |
| `admin-users.js` | `/api/admin-users` | user CRUD (Blobs only) |
| `admin-roles.js` | `/api/admin-roles` | custom roles (Blobs only) |
| `page-builder.js` | `/api/page-builder` | `auth`, `list`, `load`, `preview`, `save`, review-draft actions. Commits pages. |
| `event-generator.js` | `/api/event-generator` | same shape for events. Commits events. |
| `homepage-editor.js` | `/api/homepage-editor` | commits the three `index.html` files |
| `_github.js` | — | `commitToBranch()`, `openPullRequest()`, `getFileContent()` |
| `_page-template.js` | — | `renderPage(page, lang)` → HTML |
| `_event-template.js` | — | `renderEventPage(record, lang)` → HTML |
| `_blobs.js`, `_session-store.js`, `_roles.js`, `_user-store.js`, `_audit.js` | — | shared helpers |

Helpers are prefixed `_`. Netlify still deploys them as endpoints; nothing routes
to them. Convention only — if that matters to you, exclude them explicitly.

Friendly routing comes from `netlify.toml`: `/api/*` → `/.netlify/functions/:splat`.

### The delay

**About one minute** between pressing Publish and the page being live. It is
Netlify's deploy: clone, publish the directory, invalidate the CDN. The commit is
instant; the deploy is not.

Consequences you must design around:

- The admin's own "reload the list" must read from **GitHub**, not from the
  deployed site, or it will show the state from before the edit and every change
  will look ignored.
- Two admins publishing within the same minute are two commits — fine — but two
  admins editing *the same record* is last-write-wins with no warning. See §6.

### Two deliberate exceptions to "render the whole file"

1. **The homepage is patched, never re-rendered.** `index.html` / `en/index.html`
   / `ru/index.html` are edited by find-and-replace on `data-edit-key="…"`
   attributes (`extractInner()` / `patchInner()` in `homepage-editor.js`). They
   contain hand-written markup and inline base64 images that a re-render would
   destroy. Those attributes are load-bearing.
2. **One bounded rendered region inside that patched file.** The Community
   Services cards are a list an admin can add to, remove from and reorder, and
   find-and-replace cannot change how many `<div>`s exist. So exactly that region
   is generated, between markers:

```html
<div class="services-grid">
  <!-- services:cards:start -->  … generated …  <!-- services:cards:end -->
</div>
```

`patchRegion()` in `_homepage-services.js` replaces only what lies between them,
and a file missing its markers is **reported as a save error**, never published
quietly with stale content. If you adopt this, write the test that asserts the
region contains no `data-edit-key` and no `data:image` — widening it is how you
lose the images.

---

## 4. Preview before publish

### It renders through the same template as the real site

`preview` is the **same code path as `save`, with the commit skipped.** Both call
one builder:

```js
// page-builder.js
case 'preview': {
  const g = await generate(body.page || {}, false);   // false = do not commit
  return json(200, { dryRun: true, slug: g.slug,
    preview: { he: g.heHtml, en: g.enHtml, ru: g.ruHtml || renderPage(g.page, 'ru') } });
}
case 'save': {
  const g = await generate(pageInput, true);          // same builder
  … commitToBranch({ files: g.files.concat([...]) })
}
```

The returned HTML string goes into an **iframe via `srcdoc`**. No preview server,
no separate route, no draft URL, nothing to clean up. The Event Generator's
preview additionally returns the *file list* it would commit (paths + whether
each is text or an image), which is a cheap and genuinely useful confirmation of
scope before you publish.

This is the property to protect: **there is no preview-only render path.** A
preview that renders through different code is a preview that lies.

### What has to stay in sync

Three things, and each has burned this project at least once:

1. **Any maths duplicated between server and client.** The hero-gradient HSL
   derivation lives in both `_event-template.js` and `js/event-generator.js` so
   the client can show a live swatch without a round trip. The icon set is
   duplicated between `_page-template.js` and `js/page-builder.js`. Both are
   flagged in comments as intentional duplication that must be kept in step. If
   you can avoid duplicating, avoid it; if you cannot, comment it at both sites
   and write a test that compares them.
2. **Client-side quote/total calculations.** `EventCost.quote()` in
   `js/event-cost.js` mirrors `quote()` in `_event-costs.js` line for line. The
   rule that saves you: **the server's number is the one that is used.** The
   client's copy exists only to render a live total. Nothing a browser sends
   about money is trusted.
3. **The language fallback chain.** Preview must apply the same field-by-field
   fallback the template does (`ru → en → he`), or a half-translated record
   previews with blank rows and publishes with filled ones, or vice versa.

---

## 5. Admin UI conventions worth reusing

### Backend shape: action-based POST

One endpoint per tool. Every request is `POST` with `{ action: '…', …auth }` in
the body. Replies are built by a local `json(statusCode, payload)` helper. No
REST verbs, no path params, no router.

```js
switch (action) {
  case 'auth':    // validate session, return role + permissions + field schema
  case 'list':    // everything the form needs to populate its picker
  case 'load':    // one record
  case 'preview': // dry run
  case 'save':    // commit
  default: return json(400, { error: 'Unknown action' });
}
```

`auth` returning the **field schema** alongside the permissions is the pattern
that makes the next two sections work: the form is a projection of a
server-defined schema, so adding a field is a one-line change on the server.

### The flow: list → edit → preview → publish

1. Page loads. `AdminSession.get()` or redirect to `/admin/`.
2. `action: 'auth'` — if it 403s, render a "your role cannot access this" panel
   instead of the tool. The body stays `hidden` until this resolves.
3. `action: 'list'` — populate a picker of existing records plus a "new" option.
4. Selecting one calls `fillForm(record)`. **Read the list from the server, not
   from a cached array that predates the last save.**
5. Autosave to `localStorage` *and* Blobs on a debounce, with a "last saved X
   minutes ago" indicator and a Restore/Discard banner on next load.
6. **Preview** into an iframe. **Publish** commits and shows the live URLs and the
   commit link.
7. After publishing, **re-run `list`** — the client's cached array is stale and
   `fillForm` reads from it.

### Multi-language input: three columns, not tabs

Every translatable field renders as a three-column grid, HE / EN / RU
side by side, one row per field:

```
┌─ Card 1 title ────────────────────────────────────┐
│ Hebrew        │ English        │ Russian  [AI ↺] │
│ [input]       │ [input]        │ [input]         │
└───────────────────────────────────────────────────┘
```

Tabs were rejected: translating is a comparison task, and you cannot compare
what you cannot see at once. On narrow screens the grid collapses to two columns
with Russian spanning both (`@media (max-width:1100px)`).

Two things hang off the Russian column's label:

- **A per-field translate control** with a state machine:
  `empty` → `ai` (blue "AI" pill) → `manual` (green "Edited" pill). **`manual` is
  permanent and is never overwritten by machine translation.** A reset button (↺)
  clears back to `empty` so it can be retranslated.
- **A `needsReview` flag**, raised automatically when a Hebrew or English source
  is edited underneath an existing translation, cleared when the Russian is
  edited or explicitly dismissed by a publisher.

**`js/ru-field.js` is the single implementation.** It takes a `host` of nine
callbacks rather than closing over one editor's internals, so three different
editors share it. This is the load-bearing decision in that subsystem: two copies
of a rule whose whole point is "manual is never overwritten" would diverge and
silently destroy somebody's translation. If you build the same thing, build it
once and inject the host.

Translation itself is `POST /api/translate` (Claude API). Its `SYSTEM_PROMPT` is
a tuned style guide — register, gendered forms, domain vocabulary, punctuation
rules — and should be treated as content, not boilerplate.

### Repeatable items — add / remove / reorder

**This maps directly onto "multiple teachers/sponsors per activity".** The pattern
appears three times in this codebase (page-builder folds, event sittings,
homepage service cards) and converged on the same rules.

The shape: an array in the record, rendered as a list of boxes, each with its own
controls in a header row.

```html
<div class="svc-card">
  <div class="svc-head">
    <b>Card 2: Giur</b>
    <span class="svc-ctrls">
      <button class="svc-up"   ↑ disabled-if-first>
      <button class="svc-down" ↓ disabled-if-last>
      <button class="svc-del">Remove</button>
    </span>
  </div>
  …per-item fields, rendered by the SAME field renderer as every other field…
</div>
<button class="svc-add">+ Add a card</button>
```

Up/down buttons rather than drag-and-drop: they work on touch, they are
keyboard-accessible, and they cost about eight lines. Reference:
`js/homepage-editor.js` (`renderCards`, `stashCardText`, `rebuildCardFields`).

**Six rules, each of which was a bug first:**

1. **Read the form into the model before every redraw.** Reordering re-renders the
   list, which destroys the inputs. Anything not captured first is typing the
   admin watches disappear.

   ```js
   function redrawCards() { stashCardText(); rebuildCardFields(); render(); applyLocks(); }
   ```

2. **Give each item a permanent id, minted from the clock, never from its
   position.** Per-item change history and translation state are keyed by id. A
   positional id (`item-3`) gets reissued after a removal and silently merges two
   items' histories.

   ```js
   var id = 'svc-' + Date.now().toString(36);
   ```

3. **Never renumber existing ids.** The three original service cards keep
   `service-1..3` forever, even though they can now be reordered, because the
   meta store is keyed by them. Renaming would throw away who translated what and
   *look like it worked*.

4. **Field keys are derived from the id, and the per-item fields go through the
   same renderer as every other field** (`renderField(descriptor, host)`). The
   server expands the item list into field descriptors and hands them to the
   client, so per-item copy gets translation, review flags and change history for
   free. The item-level controls (add/remove/reorder/link) are the only genuinely
   new UI.

5. **Structure and text travel separately.** The client sends the item array
   carrying **only** ids, order and non-text settings; the words travel in the
   same content map as every other field. One path for text, and the server never
   has to reconcile two sources.

6. **A restricted role gets the words and not the structure.** For the RU
   Reviewer the add/remove/reorder controls are disabled *and* the server does
   not read an item list out of a review draft at all. A permission enforced only
   in the UI is not enforced.

Also: a **blank row is dropped, not published** (an item is "real" once it has the
one field that defines it — a name, a date), and the key is **omitted entirely**
when the list is empty, so a record with no repeatables is byte-identical to what
the pre-repeatable version produced.

### Rich text

Quill, with a deliberately minimal toolbar (`bold`, `italic`, `underline`, `link`,
`clean`). Output is trusted admin markup but still passes a small allowlist
sanitiser server-side (`sanitizeRich()` in `homepage-editor.js`) that keeps
`<br> <strong> <em> <u> <a href>` and strips every other tag while keeping its
text. `href` is restricted to `http(s):`, `mailto:`, `/`, `#`.

---

## 6. Known limitations and things not to copy uncritically

**Direct-to-`main`, no review step.** Every admin save commits straight to the
default branch. It is fast and it suits a two-person team. `_github.js` exports
`openPullRequest()` and nothing calls it. If your project has more editors or a
staging environment, wire that up from the start — retrofitting a review step
into the client flows is more work than starting with one. Note the token then
needs `Pull requests: R/W` as well as `Contents: R/W`.

**No optimistic locking — last write wins.** Two admins editing the same record
in the same window silently overwrite each other, with no warning and no
conflict. The records carry `isoUpdated`; nothing checks it. If you copy one
thing from this section, copy the fix rather than the bug: send the timestamp you
loaded and reject the save if it has moved.

**Generated files are build artifacts under version control.** `events/*.html`,
the service pages, `pages/*.json`'s rendered output — hand-editing them works
right up until someone re-saves that record in the admin, which silently
overwrites the change. This trips up every new contributor. Either accept it and
document it loudly (as `CLAUDE.md` does), or keep generated output out of the
repo and render at deploy time.

**Regex-patched source files.** `patchNav()` inserts nav entries into `js/nav.js`
by matching `const services = [` and inserting after the bracket. It requires
that declaration to stay a literal array. It works, and it is the most fragile
thing here. A JSON data file that `nav.js` reads would have been better.

**The GitHub Contents API caps base64 at 1 MB.** The homepage files are ~1.3 MB
because of inline images, and `getFileContent()` returned an empty string for
them with no error — extraction then found nothing and the save wrote a page with
every field blanked. The fix is to request `Accept: application/vnd.github.raw`
(supported to 100 MB) — see `readFile()` in `homepage-editor.js`. If you commit
large files, hit this on purpose in testing before it hits you in production.

**Read from the API, not the deployed bundle.** `event-generator.js`'s `list`
action reads `events-index.json` from GitHub, not from `require()` of the local
file, because the bundle is whatever was last *deployed* and a deploy trails a
save by a minute. Reading the bundle refills the form with the copy from before
your edit and makes every change look ignored.

**Never use `<input type="date">` or `type="time">` for values the site
publishes.** The browser renders them in its own locale and no page-level
attribute reliably overrides it, so an admin on a 12-hour locale cannot enter or
read 24-hour times. Plain text inputs normalised by a `normTime()` helper.

**Auth in the request body, not a header.** It works and it keeps every endpoint
a single POST, but it means auth cannot be handled by middleware or an edge
function, and it shows up in any body logging you add later. A header would be
more conventional.

**Sessions carry a permissions snapshot.** Changing a role does not affect
sessions already issued. With an 8-hour TTL that is acceptable; with a longer TTL
it would not be. Re-resolve the role in `getSession()` if you need it live.

**Blobs is unreliable locally.** `netlify link` first, then pass credentials
inline (`NETLIFY_BLOBS_TOKEN=x NETLIFY_BLOBS_SITE_ID=y netlify dev`), and even
then expect to test against the live site. Budget for this.

**Set env vars from the CLI (`netlify env:set`) only.** Dashboard saves have not
persisted reliably on this project. Also: an env change does not reach deployed
functions until there is a **new deploy** — an empty commit is the usual trigger,
and forgetting it has cost hours here more than once.

**No build step is a real constraint, not just a simplification.** It buys
zero-config deploys and instant edits, and it costs you modules, TypeScript, and
any dependency that is ESM-only. `_email.js` generates ICS calendar files by hand
rather than pull in `ical-generator` for exactly that reason. Browser JS is
ES5-flavoured IIFEs attaching to `window`. Decide this deliberately.

**Test suite worth copying wholesale.** `tests/` — ~44 files, each a plain Node
script that reads the real source and calls the real functions, prints one line
per assertion, and exits non-zero on failure. `node tests/run.js` runs everything
in about six seconds. **No framework and nothing to install**, because a test
that needs installing is a test that stops being run. Each suite is named for the
bug it was written against and opens with a comment explaining what went wrong —
that comment is the point. Nothing talks to GitHub, Stripe, Blobs or the mail
provider; those are stubbed by replacing the module in `require.cache` or
intercepting `Module._load`.
