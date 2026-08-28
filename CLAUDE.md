# CLAUDE.md — Ogen website

Orientation for a fresh session. Read this first; it should be enough to work
in this repo without exploring.

## What this is

Static trilingual (Hebrew / English / Russian) marketing site for **Merkaz Ogen**
(מרכז עוגן), an Israeli community centre in Cyprus.

- **No framework, no build step, no package.json.** Plain HTML + CSS + vanilla JS.
- Hosted on **Netlify**, publish directory = repo root. Every push to `main`
  auto-deploys. Pretty URLs and the 404 fallback come from `netlify.toml`.
- **Live at https://www.ogen.cy** (www is primary).

## Routes and files

Three parallel language trees. Hebrew is the default and lives at the root.

| Route | File | `lang` | `#page` dir |
|---|---|---|---|
| `/` | `index.html` | `he` | `rtl` |
| `/en` | `en/index.html` | `en` | `ltr` |
| `/ru` | `ru/index.html` | `ru` | `ltr` |
| `/about` | `about.html` | `he` | `rtl` |
| `/en/about` | `en/about.html` | `en` | `ltr` |
| `/ru/about` | `ru/about.html` | `ru` | `ltr` |
| `/activities` | `activities/index.html` | `he` | `rtl` |
| `/en/activities`, `/ru/activities` | `{en,ru}/activities/index.html` | | |
| `/activities/<slug>` | `activities/<slug>.html` | `he` | `rtl` |
| `/en/activities/<slug>` | `en/activities/<slug>.html` | `en` | `ltr` |
| `/ru/activities/<slug>` | `ru/activities/<slug>.html` | `ru` | `ltr` |
| `/confirmation` | `confirmation.html` | `he` | `rtl` |
| `/en/confirmation` | `en/confirmation.html` | `en` | `ltr` |
| `/ru/confirmation` | `ru/confirmation.html` | `ru` | `ltr` |
| any unknown path | `404.html` | set by JS from URL | set by JS |

`hebrew-for-kids` is currently the only activity slug. Activity pages and the
listing pages are **generated** — see the Admin backend section. `/admin/` is
the CMS; it is noindex and excluded in robots.txt.

Confirmation pages are the contact form's redirect targets. `404.html` is the
one page that inlines all three languages at once (via `data-lang` spans, shown
/hidden by CSS keyed off `html[lang]`); every other page is single-language.

```
shared.css        all styles: tokens, nav, every section, form, footer
js/nav.js         injects <nav> + mobile menu into #page
js/footer.js      injects <footer> into #page
js/contact-form.js  renders the form into #contact-form-mount
js/motifs.js      draws any [data-motif] element; holds the canonical SVGs
js/activity.js    activity-page status badge + CTA, credits, optional fields
images/
  hp-bg.jpg, kids.jpg          hero background + hero photo
  og-image.jpg                 1200×630 branded share image
  favicon.svg, favicon-32.png, apple-touch-icon.png
  logos/logo-{he,en,ru}.svg    wordmark + tagline lockup, one per language
  partners/                    kkl, ministry, wzo, kehilot
netlify.toml      publish root, pretty URLs, security/cache headers, 404
sitemap.xml, robots.txt
```

Homepage sections, in order: `hero` → `about` → `offer` (4 cards + "coming soon"
banner) → `why-ogen` → `vision` → `contact`.

## Shared chrome is JS-injected

Page files contain **only their own body copy**. The nav, footer, and contact
form are injected at runtime into `<div id="page">`:

- **`js/nav.js`** — fixed 96px nav, centered logo, עב/EN/RU toggle, hamburger
  menu. Detects language from `location.pathname`. The toggle navigates to the
  twin URL (`/` ↔ `/en` ↔ `/ru`, `/confirmation` ↔ `/en/confirmation` ↔ …),
  preserving `location.hash`. `.nav-right` is forced `direction:ltr` so the lang
  buttons and hamburger stay pinned to the physical right in a fixed
  `[עב][EN][RU]` order in all three languages.
- **`js/footer.js`** — tagline logo → divider → partner logo row → copyright.
- **`js/contact-form.js`** — builds the form, lazy-loads `intl-tel-input` from
  CDN (Cyprus default country), and AJAX-POSTs to Formspree. Language comes from
  `document.documentElement.lang`, not the path.
- **`js/motifs.js`** — draws the decorative accents. Load it **after**
  `footer.js`, so it also dresses the motifs the footer just injected.
- **`js/activity.js`** — activity pages only. Load it last.

Each of these three carries its own `{ he, en, ru }` string table. **A copy
change in the nav, footer, or form means editing that table, not the HTML.**

## Conventions — follow these

**1. Copy lives in triplicate.** Any wording change must land in all three
`index.html` files (and, for chrome, in the `he`/`en`/`ru` maps inside the JS).
Never update one language and leave the others behind. The live site is the
source of truth — there is no reference mockup file.

**2. Never put `dir` on `<html>` or `<body>`.** This is a real bug that was
fixed the hard way; don't undo it. `html` is pinned `direction:ltr;
overflow-y:scroll` in `shared.css` so it always owns the scrollbar and never
jumps when direction flips. Direction is set **only** on the `#page` wrapper.
For anything positioned relative to a side, use logical properties
(`inset-inline-start/end`, `margin-inline-*`) rather than `left`/`right`, so it
flips per language with no per-language override.

**3. Heading hierarchy (SEO) — exactly one `<h1>` per page**, the hero headline.
Then:
- section eyebrow (icon + short terracotta label) → `<h2>`
- the large headline directly under an eyebrow → `<h3>`
- hero subheading (right under the h1) → `<h2>`
- Vision heading → `<h2>` (no eyebrow above it)
- the four Offer card titles → `<h3>`

Heading margins are explicitly reset (`margin-top:0`) in `shared.css`, so
changing a tag doesn't shift spacing. Keep it that way.

**4. Decorative motifs are a shared system.** Six of them — `ring`, `scatter`,
`hatch`, `leaf`, `wave`, `book` — drawn with inline SVG or pure CSS, never image
files. Each shape is defined **once**: geometry/colour in the MOTIFS block of
`shared.css`, SVG path data in `js/motifs.js`. Never paste motif SVG into a
page; declare it and let the injector draw it:

```html
<span class="motif offer-corner" data-motif="scatter" data-corner="tl"></span>
<div class="page-header" data-motif="leaf" data-corner="tl">   <!-- slot is built for you -->
```

`data-corner` is `tl` / `tr` / `bl` / `br`, meaning top|bottom plus inline
**start|end** — so a corner mirrors between Hebrew and EN/RU rather than
staying physically put. Homepage sections keep their own placement classes
(`about-corner`, `why-corner`, `contact-leaf-top`, …) which only override
inset, size and tone. Use each motif once per page; don't repeat one.

**5. Every actionable CTA is terracotta** — `.btn-primary` in the hero, the
contact form, and every `.sidebar-cta` regardless of status. Status is
communicated by the coloured `.status-badge` above it, not by recolouring the
one button on the page. Only `.sidebar-cta.is-closed` differs, because it is
not pressable.

**6. Icons are Lucide**, always white inside a 56px solid-color circle — never a
colored icon on a transparent background. The anchor icon is the eyebrow marker
in every section; reuse the same inline SVG rather than re-sourcing it. Offer
cards use `book-open` / `music` / `users` / `graduation-cap`, colored olive /
terracotta / navy / gold in that order.

**7. Nav height is 96px** and several things key off it (`.hero` margin-top,
`.mobile-menu` top, `.thankyou` min-height). Change all of them together.

**8. Design tokens** live in `:root` in `shared.css` — olive, camel, terracotta,
gold, navy, paper, stone, ink. Hebrew uses Heebo, EN/RU use Mulish, switched via
`html[lang="…"]` selectors. Use the tokens; don't hardcode hexes.

## Page templates

Two shells for pages beyond the homepage. Both open with the shared
`.page-header` (breadcrumb + the page's single `<h1>` + optional corner motif).

**Inner page** — `.inner-body` holding h2s, paragraphs, `.pullquote`,
`.placeholder-img` / `.inner-image`, and `.team-grid` of `.team-card`
(photo, name, role). `/about` is the worked example; its body is still
`[content needed]` placeholder copy, so it carries `noindex` and is
deliberately **absent from `sitemap.xml`**. Flip both once real copy lands.

**Activity page** — `.activity-layout`: `.activity-main` beside a sticky
`.activity-sidebar` of facts.

The main column reads About → What's included → What to bring → FAQ → credits.
The sidebar is Ages → Schedule → Duration → Group size → Language of
instruction → Prerequisites → Location → Price → CTA. The last three of those
used to be sections in the main column; they are facts to scan, not prose.

Sidebar facts are **structured values, not text**. `netlify/functions/_activity-facts.js`
is the one place a fact becomes a sentence, built per language — so
`{groups:2, maxPerGroup:7}` renders as "שתי קבוצות של עד 7 תלמידים" in Hebrew
and "2 groups of up to 7 students" in English, and the three languages cannot
drift. Price per hour is **computed**: `fullPrice ÷ (sessionCount × sessionMinutes ÷ 45)`,
the 45 being the academic hour. `perHourOverride` wins when the arithmetic
doesn't describe an activity.

Two rules hold the change-over together:

- **`legacyText` is not a leftover, it is the fallback.** Facts were free text
  once. The migration in `_activity-migrate.js` converts only what is
  unambiguous (an age range is two integers), keeps every other sentence
  verbatim, and `factText()` publishes it until the structured fields are
  filled in. A half-migrated record never blanks a live page. `migrate()` runs
  on every read and is idempotent.
- **`factVisibility` is built but not enforced.** Every fact carries
  `public | members`, Location defaults to `members`, and
  `isPubliclyVisible()` in `_activity-facts.js` returns `true` for everything
  — deliberately, because there is no registration system yet and nobody could
  be a member. That one function is what changes when it ships; the
  members-only rows must then be served by the authenticated view, never
  rendered into the static file and hidden with CSS.

Driven by three markup contracts:

1. **Status.** `<article class="activity" data-status="open">` is the only
   place status is declared. `js/activity.js` renders the badge *and* the
   sidebar CTA from that one value, so they cannot disagree. The seven
   statuses are `draft`, `announcement`, `open`, `waitlist`, `closed`,
   `cancelled`, `completed`; badge/CTA/banner copy for all three languages
   lives in the `STATUS` table in that file. `data-spots` feeds the "places
   left" note (`open` only) and `data-cta-url` the button target.
2. **Teachers and sponsors are arrays**, in the page's
   `<script type="application/json" id="activity-credits">` block —
   `{ teachers: [{name, photo}], sponsors: [{name, logo}] }`. Any count
   renders; a group with no entries gets no heading, and if both are empty
   the whole credit block is removed.
3. **Optional fields.** Wrap each in `<div data-optional>`. The rule is to
   **delete the block** when an activity has nothing to say there. As a
   safety net `js/activity.js` removes any `[data-optional]` that ends up
   with only a heading in it, so no orphaned label survives. Optional blocks
   are: program length, language of instruction, prerequisites, what to
   bring, FAQ.

`draft` deserves a warning: `js/activity.js` redirects a draft page to
`/404.html` (bypass with `?preview=1`), but the site is static with no auth,
so **that is a courtesy, not access control** — the HTML is still served to
anyone who asks for it. Until an admin backend exists, a genuinely
unpublished activity should not be committed or deployed at all, and must
stay out of `sitemap.xml`.

## Admin backend (Activities)

A browser CMS at `/admin/` whose Netlify Functions render static HTML and commit
it into this repository through the GitHub API, which triggers a deploy. **Content
lives in git. Blobs holds everything that is not content.**

```
netlify/functions/
  _activity-facts.js     structured facts → one sentence per language; PURE
  _activity-migrate.js   old free-text facts → structured, losing nothing; PURE
  _blobs.js              the only place a Blobs store is opened; ALL store names
                         are prefixed `ogen-` (see the warning below)
  _user-store.js         ogen-admin-users, bcrypt @12
  _session-store.js      ogen-admin-sessions, authenticate() + permission helpers
  _roles.js              built-in roles in code; custom roles in ogen-admin-roles
  _audit.js              ogen-admin-audit, best-effort, never blocks an action
  _github.js             commitToBranch() — git-data API, atomic, supports deletes
  _activity-template.js  renderActivityPage(activity, lang) — PURE
  _activity-index.js     listing pages, activities-index.json, sitemap.xml
  activities-admin.js    /api/activities-admin
  admin-login.js         /api/admin-login
  admin-users.js         /api/admin-users
admin/index.html, admin/activities.html, admin/users.html, admin/admin.css
js/admin-session.js, js/activities-admin.js, js/repeatable-items.js
```

### The rules that hold this together

**1. A draft has no files.** `draft` is not a display state that hides a page —
it is the absence of the page. A draft activity lives only in the
`ogen-activity-drafts` Blobs store; nothing is committed, so there is no URL that
could serve it. Publishing renders and commits; **unpublishing deletes those
files again** and returns the record to Blobs, still editable. `delete` removes
the record entirely. Never reintroduce a "publish it but hide it" draft.

**2. Preview and publish share one render path.** Both call `generate()` in
`activities-admin.js`, which differs only in whether it commits. There is
deliberately no preview-only branch: a preview that renders through different
code is a preview that can lie. `tests/preview-matches-publish.js` asserts the
previewed HTML is byte-identical to the committed file.

That is also why a just-uploaded image cannot be inlined into a preview: the
render rewrites it to the path it *will* have, and preview doesn't commit, so
the file isn't there yet. The data URLs come back **beside** the HTML as
`imagePreview` and are put back in the iframe's DOM after it loads. The markup
stays byte-identical. Never fix this by changing what `generate()` emits.

**3. Optimistic locking.** Every record carries `isoUpdated`. The client sends
back the value it loaded as `baseUpdatedAt`; the server re-reads the current
record — **from GitHub, never from the deployed bundle**, which trails a save by
about a minute — and returns 409 if it has moved. An explicit `overwrite: true`
is available and audited; nothing is ever silently clobbered.

**4. Generated files are build artifacts.** `activities/<slug>.html`,
`{en,ru}/activities/<slug>.html`, `activities/index.html` and its translations,
`activities/activities-index.json` and `sitemap.xml` are all **generated**.
Hand-editing one works right up until the next admin save silently overwrites
it. Every generated page says so in a comment at the top. If a fix is needed
outside the admin, change `activities/<slug>.json` (the source) or
`_activity-template.js` (the markup) and regenerate — never the HTML.

**5. Repeatable items** (what's included, FAQ, teachers, sponsors) go through
`js/repeatable-items.js`, which enforces two rules that were bugs first: the form
is read into the model before every redraw (or reordering eats whatever the admin
just typed), and item ids are minted from the clock, never from list position (or
removing a row reissues an id and merges two items' state).

**6. Client-side permission checks are cosmetic.** The server re-checks
`canAccess` / `canPublish` / `canEditLang` on every action and assumes the client
is hostile. A role that may only edit Russian gets its Hebrew and English edits
discarded server-side, and cannot add, remove or reorder items at all.

### ⚠ Blobs namespacing

Every store name is prefixed `ogen-` in `_blobs.js`. This is not decorative:
during setup the configured credentials reached a store that already held
**another site's** `admin-users`, `page-drafts` and `admin-audit` entries.
Un-prefixed, that other site's admin accounts could have signed into the Ogen
admin and published to this repo. Do not remove the prefix.

### Environment

Set with `netlify env:set` only — dashboard saves have not persisted reliably on
this account — and remember that **an env change does not reach deployed
functions until the next deploy**.

| Var | For |
|---|---|
| `GITHUB_TOKEN` | fine-grained PAT, Contents R/W on `shy-cy/ogen-web` |
| `GITHUB_REPO` / `GITHUB_BRANCH` | `shy-cy/ogen-web` / `main` |
| `NETLIFY_BLOBS_SITE_ID` / `NETLIFY_BLOBS_TOKEN` | Blobs |
| `ADMIN_PASSWORD` | bootstrap only — stops being accepted the moment one account exists |

### Tests

`node tests/run.js` — plain Node scripts, no framework, nothing to install.
Each suite is named for the bug it defends against and opens with a comment
explaining what went wrong. That comment is the point. Write new ones as you
build, not afterwards.

## Local preview

Asset paths are absolute (`/shared.css`, `/images/…`), so `file://` will not
work. Serve from the repo root:

```
npx serve .        # static pages only
netlify dev        # needed for anything under /admin/ or /api/
```

Blobs is unreliable locally: `netlify link` first, then pass credentials inline
(`NETLIFY_BLOBS_TOKEN=… NETLIFY_BLOBS_SITE_ID=… netlify dev`), and expect to do
final testing against the deployed site.

## Contact form

Wired to Formspree form `xpqgvple` → michal.shin@gmail.com. Working and
confirmed. To change the destination address use the Formspree dashboard, not
code. The form sets a per-submission `_subject` so email threads don't collapse
into one, and converts the phone to full international format before sending.

## Current status

Site is live and launched. Everything that was once a pre-launch blocker (OG
share image, Formspree wiring, domain) is done. Open items:

- **Russian copy has never been reviewed by a native speaker** — the homepage,
  and now the About and activity pages too. Flagged inline at the top of each
  `/ru/` file.
- **English activity copy** is a first-pass translation of the approved Hebrew
  and has not been proofread, including the status strings in `js/activity.js`.
- **`/about` is placeholder copy** (`[content needed]`), hence `noindex` and no
  sitemap entry.
- **Nothing in the nav links to `/about` or `/activities`** yet.
- **Registration is not built.** The `open` CTA points at the contact section.
- **Rotate the setup credentials.** The GitHub PAT and Netlify token were pasted
  into a chat transcript during setup.
