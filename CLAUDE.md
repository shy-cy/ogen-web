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

`hebrew4kids` is currently the only activity slug. Activity pages and the
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
`.activity-aside`, which stacks the activity's square picture
(`.activity-card-image`) above the `.activity-sidebar` of facts. The column
carries the width and the stickiness so both cards move together; an activity
with no `cardImage` renders no frame at all rather than an empty one.

The picture is **square at every width**. Below 939px it used to flatten to a
16:7 band, on the reasoning that a full-width square is enormous on a phone —
which is true, and is a size problem rather than a ratio one. It was being paid
for in the wrong currency: the upload is cropped to 1:1 and the artwork is
titled, so letterboxing cut the title off the top of every card image on every
phone and tablet. The stacked layout caps `max-width` on the *figure* instead
and never touches the image rule, so `height:auto` and `aspect-ratio:1/1` both
survive. Below the cap the picture is simply full width;
`margin-inline:auto` centres it once it stops filling the column — symmetric,
so there is nothing directional to get wrong in any of the three languages.

That pairing is the trap. `height="800"` on the `<img>` is a presentational
hint, so **`height:auto` and `aspect-ratio` have to travel together** — restate
one in a media query without the other and the attribute wins, the ratio is
ignored, and the picture renders 800px tall. There is deliberately exactly one
`.activity-card-image img` rule in the stylesheet so the pair cannot be split,
and a test asserts that, on comment-stripped CSS — the rule opens with a comment
explaining `height:auto`, and a naive search finds the words in the prose and
passes whether or not the declaration is still there.

The same picture is the listing card's thumbnail. It was **write-only** for a
while — uploaded, cropped, optimised, committed, shown in the admin, and
rendered nowhere, because the listing thumb was a hardcoded empty span. An
activity without one still gets the coloured band, so a mixed listing reads as
a grid. It is decorative in both places: empty `alt`, because the heading beside
it already names the activity. Note `height:auto` in the CSS is load-bearing —
the `width`/`height` attributes are presentational hints, so without it
`height="800"` wins and `aspect-ratio` is ignored.

The card image is **not** the share image. `shareImage` is a separate field with
its own 1200×630 crop, and falls back to the site's `og-image.jpg`, never to the
card.

The main column reads About → What to bring → FAQ → credits. Three of the
sidebar facts used to be sections in the main column; they are facts to scan,
not prose.

**The sidebar is three grouped blocks, not eight label/value rows.** Each is an
icon, a heading, and its facts stacked underneath, ported from the Shirat HaYam
event sidebar (`.sidebar-detail`) onto Ogen tokens:

| Group | Facts, in this order |
|---|---|
| Who it is for | Ages, Group size, Prerequisites |
| Schedule | When, Duration |
| Details | Location, Language of instruction, Price |

It was rows before: label at one edge, value at the other, via
`justify-content:space-between` and `text-align:end`. That shape has to be told
which edge is which, and in a site rendering the same markup both directions
that instruction kept being wrong. It was fixed more than once and came back
each time. **Nothing in the new block is pushed to an edge**, so there is not
one directional override in the sidebar CSS, and a test asserts there never is.

`FACT_GROUPS` in `_activity-facts.js` owns the grouping and declares the order
within each group, which is deliberately *not* `FACT_ORDER` (Location reads
before Language of instruction). `FACT_ORDER` stays the canonical list of what a
fact is, and the module throws at require time if the two disagree, so a fact
cannot be silently dropped from every group or listed in two. A group whose
facts are all empty is dropped whole rather than rendering a lone icon and
heading. Group headings never repeat a label inside their own group, which is
why the schedule group is headed "Schedule" and not "When".

Group icons are Lucide, white in a solid circle, per the icon rule, but at 34px
rather than 56px: a 56px disc beside two lines of text in a 320px column is
larger than the thing it labels. One colour per group from the offer-card
rotation, olive / terracotta / navy.

The status badge sits under the `<h1>` in `.page-header`, so `js/activity.js`
looks it up from the document rather than from the `.activity` article — status
is still declared exactly once, on the article.

**The sidebar comes first in the source**, which puts it at the leading edge of
the reading direction — right in Hebrew, left in EN/RU — with no per-language
rule, because a flex row already places its first item there. Source order
rather than `order:` keeps visual, DOM and keyboard order identical. And the
layout does **not** wrap: two columns need 868px of usable width, so it switches
to a single column at 939px. It used to wrap between 781 and ~915px, dropping
the facts box below the article at its full 320px width.

**The activity page still has no image.** There is no hero, and the template
renders no picture of its own; share cards still fall back to the site's
`og-image.jpg`. That part has not changed and is not an oversight.

**An activity does now carry one image: `cardImage`**, a square picture for the
activities listing and the homepage, added after the rule above was written and
deliberately narrower than it. The activity page does not show it and `og:image`
does not point at it, so a shared link is still the branded site card rather
than a 1:1 crop letterboxed into a 1.91:1 slot.

It is **structure, not words** — one picture for all three languages — so a role
that may only edit Russian cannot change it, exactly as it cannot change the
price. The path is `images/activities/<slug>-card.<ext>`: a fixed name rather
than an id, so re-uploading replaces the file instead of accumulating one per
attempt, and it is listed in `imagePathsOf()` so deleting an activity takes the
photograph down with it. A cleared field travels as `null`, never absent, since
"remove this image" and "this role did not send one" must not be the same
request.

**The homepage and listing display logic is not built yet.** The field, the
upload, the storage and the admin preview are. Nothing renders `cardImage` on a
page.

Sidebar facts are **structured values, not text**. Two of them are the same
`kind: 'location'` — the public `location` and the members-only `address` — so
the admin keys those inputs by the **fact key, never the kind**; a hardcoded id
gave both facts the same DOM ids and the read-back copied the location over the
address. `netlify/functions/_activity-facts.js`
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
- **`factVisibility` is enforced, in one function.** Every fact carries
  `public | members`, and `isPubliclyVisible()` in `_activity-facts.js` is the
  only place that decides. It returns `visibility !== 'members'`, and
  enforcement means the row is **omitted from the generated HTML** — never
  rendered and then hidden with CSS, because the file is static and anyone can
  read its source. When a members area exists, the private rows are served by
  that authenticated view; they still never enter this file.

  It used to return `true` for everything, which was the honest choice while
  Location was the only members-only fact: hiding it would have hidden it from
  the families who needed it. **Splitting location in two removed that
  trade-off** — `location` is the general area ("Limassol") and is public,
  `address` is the exact street address and defaults to `members`. So an
  activity can say where it is without publishing where children will be.

  The changeover needed a migration, and it is the interesting part.
  hebrew4kids had Location *and* Price flagged `members` while showing both on
  the live page, because nothing had ever acted on the flag. Enforcing alone
  would have taken two rows off a published page as a side effect of adding a
  field. So `normaliseVisibility()` resets a **pre-changeover** record — one
  with no `facts.address` — to `public`, which is what its page actually
  showed. The flag starts meaning something from the next save. `address` is
  exempt: new, empty, and members-only from birth.

Driven by three markup contracts:

1. **Status.** `<article class="activity" data-status="open">` is the only
   place status is declared. `js/activity.js` renders the badge *and* the
   sidebar CTA from that one value, so they cannot disagree. The seven
   statuses are `draft`, `announcement`, `open`, `waitlist`, `closed`,
   `cancelled`, `completed`; badge/CTA/banner copy for all three languages
   lives in the `STATUS` table in that file, and `data-cta-url` is the button
   target.

   An entry carries **either a `cta` or a `banner`**, and that is what decides
   whether the status offers anything to press. Four of the seven are banners:
   `draft`, `announcement`, `cancelled`, `completed`. `closed` is the one
   pressable-looking exception, a disabled button.

   **`announcement` deliberately has no button.** It used to render a real
   "Register interest" link, and a link needs a target — but registration is not
   built, so it either led to the contact form pretending to be a registration
   or to whatever was typed in the registration-link field. What got typed there
   once was the button's own *label*, which shipped as
   `<a href="Register Now">` and 404'd in all three languages while still
   *reading* "Register interest". It looked right and failed only on click. The
   `cta` strings are deleted rather than kept unused; they return with the
   registration system, which is also what would give them a real target.

   **`ctaUrl` is only published when it is plainly a link** — `isLinkish()` in
   `_activity-template.js`, an allowlist of http(s), a site path, a fragment,
   `mailto:` and `tel:`. Anything else is dropped and the button falls back to
   `#register`, the contact section, because a dead end is worse than the
   default. `validate()` also refuses it on save, naming the language, so a
   wrong value is corrected rather than silently discarded — silence is how it
   reached the live site. `js/activities-admin.js` repeats the same pattern
   client-side for immediate feedback, and a test asserts the two stay
   character-identical. Being an allowlist is also what keeps `javascript:` out
   of an href.

   There is deliberately **no "places left"**. It was a number an admin typed
   and then had to remember to decrement, so it was wrong the moment anyone
   registered. It comes back when there is a registration system to compute it
   from — capacity minus actual sign-ups — and not before. **"What's included"
   is gone** for the same kind of reason: it was a hand-written bullet list
   restating what Schedule, Duration and Price now say as structured data.
   `migrate()` drops both keys, so a record stops carrying them from its next
   save; old records holding them render fine in the meantime.
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
  _github.js             commitToBranch() — git-data API, atomic, supports deletes,
                         batched to stay well inside the 10s function limit
  _activity-template.js  renderActivityPage(activity, lang) — PURE
  _activity-index.js     listing pages, activities-index.json, sitemap.xml
  activities-admin.js    /api/activities-admin
  admin-login.js         /api/admin-login
  admin-users.js         /api/admin-users
admin/index.html, admin/activities.html, admin/users.html, admin/admin.css
js/admin-session.js, js/activities-admin.js, js/repeatable-items.js
js/image-optimize.js   resizes + re-encodes every upload IN THE BROWSER
```

The form is a **projection of `FIELD_SCHEMA`**, one panel per group, in the
order an activity is actually filled in: **Settings** (slug, status, motif,
corner, card image), **Content** (title, summary, about, what to bring),
**Teachers**, **Sponsors**, **Sidebar facts** (the facts, then the registration
button link — the button sits directly under them on the page), **FAQ**, then
**Search & sharing** last.

**About and What to bring are written in Quill** — the same editor and version
the Shirat HaYam admin uses, loaded from a CDN because this project has no build
step, with the three languages **stacked** rather than in the three-column grid
the short fields use: those are a comparison task, a paragraph of prose is not.
`rich: true` on the descriptor is the whole switch.

That makes the stored value HTML, and `richText()` in the template prints it as
markup. Three things hold that together: `sanitiseRich()` on the server runs on
**every** save against a fixed tag allowlist (the value arrives in a request body
like any other field, and the page prints it unescaped); `plainText()` strips the
markup wherever text is wanted — meta description, og:description, the listing
blurb — or a search result reads `&lt;p&gt;במרכז עוגן…`; and a value that does
**not** start with a block tag is treated as the plain text it is and escaped, so
records written before the editor need no migration and read exactly as before.
Without Quill the field falls back to the plain textarea, so a CDN outage costs
formatting rather than the ability to edit. Meta title and meta description used to sit in
Content, between "About this activity" and "What to bring", where they read as
more body copy to write, which is how a meta description ends up being a
paragraph. They are their own `seo` group now.

That panel also carries the two fields that are **not** words, so they sit on
the schema root rather than in `seo` (which feeds `SIMPLE_KEYS`, the
translatable scalars):

- **`robots`** — `index` (default) or `noindex`. A `noindex` activity renders
  `noindex, follow`, matching `/about` rather than inventing a second
  convention, **and is dropped from `sitemap.xml`** by `_activity-index.js`.
  Those two must move together: a sitemap advertising a page that asks not to
  be indexed contradicts itself. It stays on the activities listing, though —
  robots is an instruction to search engines, not to visitors.
- **`shareImage`** — a per-activity `og:image`, falling back to the site's
  `og-image.jpg`. The page has always declared `og:image:width` 1200 and
  `og:image:height` 630; those were true only because every activity shared one
  file, so the upload is **cropped** to that ratio rather than asked for it.

Both are one answer for all three languages, so both are merged as structure: a
role that may only edit Russian cannot deindex the Hebrew page.

Moving a field between groups touches **three** places that must stay in step:
the client renders each group, the client **reads the form back** from the same
groups, and the server merges `SIMPLE_KEYS`. The read-back is the dangerous one,
because nothing about it looks wrong — the field renders, the admin types into
it, the save succeeds, and the value is gone. `SIMPLE_KEYS` therefore concats
every group, and a test asserts that exactly the groups drawn are the groups
read back.

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

**5. Repeatable items** (FAQ, teachers, sponsors) go through
`js/repeatable-items.js`, which enforces two rules that were bugs first: the form
is read into the model before every redraw (or reordering eats whatever the admin
just typed), and item ids are minted from the clock, never from list position (or
removing a row reissues an id and merges two items' state).

**6. Uploads are shrunk in the browser, not on the server.** `js/image-optimize.js`
resizes and re-encodes before a byte is sent — hero to 1600px on the long edge
as JPEG, teacher/sponsor images to 600px, card images cropped to a centred
square at 800px, share images cropped to 1200×630, transparency keeping them
PNG, to match what the site already does by hand (`og-image.jpg` is 1200×630 at 72KB; `images/partners/*` are
19–51KB). Measured: an 865KB hero became 26KB, a 1.77MB logo 134KB.

A profile with a **`ratio`** (`card` is `1`, `share` is `1200/630`) **crops
rather than fits**, and that changes one rule. Every
other slot may hand back the original file when re-encoding produced something
larger, which is right: a 52KB partner logo becomes 59KB. But the original of a
1000×600 upload is 1000×600, and returning it would silently break the only
promise a fixed-ratio slot makes. So the bail-out is refused whenever anything was
actually cut away — `mustKeepCanvas` in `optimize()`. A source that was already
square may still take it, because the original is square too. Centre is the crop
because a face is usually near the middle and never reliably at an edge; the
alternative is a focal-point picker, which is a bigger feature than this one.

The browser is the right place because a server-side resize would fix only the
page weight. An unoptimised upload also sent ~3.5MB towards Netlify's 6MB
request limit and made the function re-upload all of it to GitHub, pushing it
past its 10-second ceiling — which is what made a publish look like a dead
button. Those two only get fixed before the bytes leave.

**Uploaded filenames carry a content hash** — `<slug>-teachers-<id>-<hash8>.png`
— because `netlify.toml` serves `/images/*` as `immutable` for a year, and item
ids are stable. Re-uploading a photo in the same format used to write different
bytes to the *same* URL, so every visitor who had seen the old one kept it and
could never be sent the new one; one sponsor logo served three different files
under a single URL. The hash makes that header true rather than weakening it,
and it makes the stale-image cleanup in `generate()` fire on **every**
replacement instead of only when the extension happened to change — which is
what stops repeated replacements accumulating orphans. The same picture
re-uploaded hashes the same, so an unchanged image never churns its URL.

**A replaced picture is retired, not deleted** — removed one publish later,
never in the commit that stops referencing it. Deleting immediately opened a
window worse than the orphan it avoided: a deploy does not reach every edge at
once, so for about a minute a reader holding the previous HTML asked for a file
the new tree no longer had. That 404 was served with the `/images/*` long-cache
header and **stuck** — the browser kept it, stopped asking, and the picture was
broken there permanently until a hard reload. It happened to a real teacher
photo. `retiredImages` on the record carries the list; it is recomputed every
publish so it cannot grow, a picture that comes back is dropped from it rather
than deleted, and deleting an activity takes its retired files too.

That is also why **`/images/activities/*` is deliberately not `immutable`** in
`netlify.toml` while the rest of `/images/*` still is. Netlify applies path
headers to error responses, so a transient 404 under a long immutable cache
becomes permanent. Uploads do not need `immutable` to cache well — the content
hash means anything unchanged keeps its URL and revalidates to a 304.

Existing un-hashed files are left alone: `take()` only runs for a `data:` URL,
so a record that already holds a path keeps it, and nothing is renamed behind
anyone's back. A file gets a hashed name the next time that picture is replaced.

**The admin keeps the bytes it uploaded until the URL answers.** A publish
commits the picture and rewrites the record to the path it will have, but
Netlify takes about a minute to deploy — and the admin used to reload the record
and swap the bytes it was showing for a URL that was not being served yet. Every
freshly uploaded picture went to a broken image icon for a minute, and the 404 it
collected sat in the cache for five more. `S.freshBytes` maps a committed path to
the bytes already in hand; a background check swaps in the real file the moment
it answers, by patching the `<img>` rather than redrawing (a redraw would discard
anything typed since the publish). Display only: the record still holds the path.

It declines to act rather than make things worse: never scales up, never
returns a file bigger than it was given (a 52KB PNG re-encodes to 59KB), never
flattens an animated GIF, never rasterises an SVG, and honours EXIF orientation
so a phone photo isn't drawn sideways. Publishing also deletes images the
record has stopped pointing at, since changing format changes the filename.

**7. A publish is a handful of requests, not one per file.** Netlify kills a
function at ten seconds and a publish was taking eight, because it asked GitHub
for everything in sequence. Text files now carry their content **inline in the
tree** (`{path, mode, type, content}`), so pages, records, listing pages and the
sitemap cost no request of their own — verified byte-identical, Hebrew included.
Only base64 images go through `/git/blobs`, concurrently, capped at
`CONCURRENCY` because bursts are what GitHub's secondary rate limits punish.
`/branches/<name>` gives the head commit and its tree together. Net effect: a
publish is ~4 requests plus one per image, and adding content adds none.
`allPublished()` reads its records together for the same reason. Don't
reintroduce a per-file `await` in a loop here.

**8. Client-side permission checks are cosmetic.** The server re-checks
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
