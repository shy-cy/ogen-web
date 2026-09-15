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
| `/privacy` | `privacy.html` | `he` | `rtl` |
| `/en/privacy`, `/ru/privacy` | `{en,ru}/privacy.html` | | |
| `/terms` | `terms.html` | `he` | `rtl` |
| `/en/terms`, `/ru/terms` | `{en,ru}/terms.html` | | |
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

**Activity page** — `.activity-body` is **one CSS grid** holding four things:
the square picture (`.activity-card-image`), a `.fact-row` of two cards,
`.activity-main`, and `.activity-aside` carrying the other two cards and the
status CTA. An activity with no `cardImage` renders no frame at all rather than
an empty one.

Above 939px the grid is `"row pic" / "row aside" / "main aside" /
"credits credits"` — the picture leads the trailing column, level with the fact
cards, with the price card directly under it and the registration button under
that: see the activity, see the cost, act. Below, the areas become
`"pic" / "row" / "main" / "aside" / "credits"` and nothing else changes.

**The fact row spans the first two rows, and that span is load-bearing.** It is
what lets the two columns behave as independent stacks: row 1 is then sized by
the picture alone, so the aside starts directly beneath it instead of waiting
for the cards to finish. `grid-template-rows: min-content min-content auto auto`
is load-bearing for the same reason — CSS grid shares a spanning item **equally**
across auto tracks, so without the pin the fact row inflates row 2 and opens a
117px hole under the picture. That failure is silent: nothing overflows, nothing
errors, there is just a gap. A test pins both.

**The fact row wraps rather than switching direction at a breakpoint.**
`flex-wrap:wrap` with `flex:1 1 320px` per card: side by side while each card
can hold 320px, stacked below that. One declaration covers the 684px the row
gets beside the picture on a desktop, the full width of a tablet, and a phone —
and it is the row that decides, from the space it actually has. It replaced a
`flex-direction:column` inside the 939px media query, which was forcing two
cards to stack on a tablet that had room for both. Note the row is only 584px
between about 940 and 1080px, so the cards stack there; that is the wrap working,
not a bug.

That is the whole point of using areas: **the picture exists once in the
markup** and sits in two places. Rendering it twice and hiding one would drift,
and the hidden copy would still be downloaded. It is also the only element whose
visual position differs from its place in the source, and it may be, because it
is decorative — `aria-hidden` with an empty alt, so it is in neither the
accessibility tree nor the tab order. Everything readable is still placed by
source order alone.

Grid also retired the old wrap trap. Two flex columns needed 868px of usable
width, so between 781px and ~915px the sidebar dropped below the article at its
full 320px while the page still looked like two columns. Areas cannot wrap.

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

**The side column is capped the same way, one size up.** Full width, the stacked
aside is an ~860px track holding a price card whose content is about 300px wide
— and the price card is deliberately one column at every width, because its four
numbers add up and in two columns the total lands beside the semester price
instead of under the figures it sums. So it cannot fill the space it is given,
and the answer is to stop giving it the space: `max-width:480px` with
`margin-inline:auto`, in the same media query.

480 rather than the picture's 360, because **the picture is not what sits above
it**. The stacked order is picture → cards → article → price → button, so the
block directly above the price card is the full-width article, and against that
a wider block reads better than one narrowed to match something several blocks
up the page.

`width:100%` on that rule is **load-bearing**. `max-width` plus auto margins is
enough for the picture because a `<figure>` is a block; `.activity-aside` is a
**flex container**, and a flex container that is a grid item with auto inline
margins sizes *shrink-to-fit* rather than filling its track — the two
declarations alone collapsed it to 90px. A test pins it.

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

The main column reads About → FAQ. Three of the facts used to be sections in it;
they are facts to scan, not prose. Credits used to end it and are a card now.

**"What to bring" is retired.** It was one line on the one activity that had it,
carried by a whole optional section, a rich-text editor, a form group and a
`FIELD_SCHEMA.optional` group that held nothing else. `migrate()` drops the key,
so a record stops carrying it from its next save; the words are in git history.
The `optional` group is gone rather than left empty — an empty group is a shape
describing nothing, and the client would still have to render a container for
it. FAQ is now the only `[data-optional]` block.

**The facts are four cards in two placements, not eight label/value rows.** Each
is an icon, a heading, and its contents stacked underneath, ported from the
Shirat HaYam event sidebar (`.sidebar-detail`) onto Ogen tokens:

| Placement | Card | Contents, in this order |
|---|---|---|
| Above the article | Who it is for | Ages, Group size, Prerequisites, Language of instruction |
| Above the article | When & where | When, Duration, Location |
| Side column | Price | its four derived rows |
| Full-width band | Staff & sponsors | Teachers, then sponsors |

The grouping answers the questions a parent asks in the order they ask them — is
this for my child, when and where is it, what does it cost — and then who
teaches it. It replaced a **"Details" card that was the leftovers of the other
three**: Location, Language of instruction and Price had nothing in common
except not fitting elsewhere. Language of instruction is a prerequisite in
practice, a reader asking when also asks where, and a number a family decides on
should not be the last line of a mixed list. Details is gone, not emptied.

Price is **alone in the side column**, directly above the registration button:
read what it costs, then press the thing that acts on it. Staff & sponsors is a
**full-width band under everything**, where the measure lets it lay its two
groups across and halve in height — 310px in a 320px column becomes 160px across
1050. That is a container query on the card's own inline size at 520px, the same
mechanism the fact cards use, so the narrow rendering is untouched.

A card wide enough lays its facts **across** rather than stacked, decided by a
container query on the card's own inline size — so the same component serves the
~500px row and the 320px column with no variant and no viewport breakpoint of
its own. It is **two columns, not `auto-fit`**, and that one declaration does two
things: four facts land two-by-two instead of leaving the fourth beside two
empty tracks, and three flow so **Location sits under When** while Duration
keeps half the card — the width its date range needs to hold one line. Put
`auto-fit` back and both regress silently.

The threshold is **500px, and it is measured rather than judged**: half a card
has to hold the date range on one line, which needs 490px of card in English,
470 in Russian, 410 in Hebrew. Below the widest of those, two columns are a
*downgrade* — the date range wraps to a third line, which is the exact thing
splitting Location out of it was meant to fix. It used to be 360px, which was
fine while the cards ran the full measure and became wrong the moment they
shared it with the picture's column.

The **price card is the one exception**, one column at every width. Every other
card holds facts a reader scans in any order; the price is four numbers that add
up, and in two columns the total lands beside the semester price rather than
under the figures it sums.

It was rows before: label at one edge, value at the other, via
`justify-content:space-between` and `text-align:end`. That shape has to be told
which edge is which, and in a site rendering the same markup both directions
that instruction kept being wrong. It was fixed more than once and came back
each time. **Nothing in the new block is pushed to an edge**, so there is not
one directional override in the card CSS, and a test asserts there never is.

`FACT_GROUPS` in `_activity-facts.js` owns the grouping and declares the order
within each group, which is deliberately *not* `FACT_ORDER` — Location comes
after Duration so the two-column flow puts it under When. `FACT_ORDER` stays the
canonical list of what a fact is, and the module throws at require time if the
two disagree, so a fact cannot be silently dropped from every group or listed in
two. A group whose facts are all empty is dropped whole rather than rendering a
lone icon and heading. Group headings never repeat a label inside their own
group, which is why the schedule card is headed "When & where" (מתי ואיפה /
Когда и где) rather than "When", and why the price card renders its four derived
rows rather than one row labelled "Price" under a heading saying the same
thing.

Group icons are Lucide, white in a solid circle, per the icon rule, but at 34px
rather than 56px: a 56px disc beside two lines of text in a 320px column is
larger than the thing it labels. One colour per group from the offer-card
rotation, olive / terracotta / navy / gold in card order — gold being the one
the page was not already using, so the fourth card joined without moving the
other three. Price kept the navy the retired Details card had, so regrouping
moved no colour either. The
cards are **one plain `--paper` ground with a `--stone` border**, told apart by
the icon disc alone: a tint per card was tried and dropped, because four tinted
panels in a set read as four states of one thing rather than four kinds of
information.

The status badge sits under the `<h1>` in `.page-header`, so `js/activity.js`
looks it up from the document rather than from the `.activity` article — status
is still declared exactly once, on the article.

**The article comes before the side column in the source**, and that single fact
decides two things that look unrelated. On a phone it is what puts About and
ahead of Price and Staff. On a desktop it is why the column sits
at the **trailing** edge — left in Hebrew, right in EN/RU — because a grid row
places its first item at the leading edge. They cannot be changed independently:
keeping the column on the leading edge would need `order` or `column-reverse`,
which splits visual from DOM order, and that is the rule this layout broke on
before. The sidebar led the source until the redesign, when the required mobile
order inverted it.

There is **no `position:sticky`** on the column. It was `sticky; top:112px` and
had stopped engaging the day the card image was added — sticky only applies
while the element is shorter than the viewport, and the column measured 1032px
against an 800px one. A rule describing behaviour the page does not have is
worse than no rule.

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

Activity facts are **structured values, not text**. Two of them are the same
`kind: 'location'` — the public `location` and the members-only `address` — so
the admin keys those inputs by the **fact key, never the kind**; a hardcoded id
gave both facts the same DOM ids and the read-back copied the location over the
address. `netlify/functions/_activity-facts.js`
is the one place a fact becomes display text, built per language — so
`{groups:2, maxPerGroup:7}` renders as "2 קבוצות / עד 7 תלמידים בקבוצה" in
Hebrew and "2 groups / up to 7 students per group" in English, and the three
languages cannot drift.

**Several facts are more than one line.** Group size splits the count from the
size; duration puts the date range above the sessions. The value stays plain
**escaped text with a `\n` in it** — never markup — and `.sidebar-facts span`
carries `white-space:pre-line`. Nothing in a fact is ever interpreted as HTML,
which is one less place the sanitiser has to matter. **No fact ever contains an
en or em dash**; the date range joins its two months with a plain hyphen, the
same character the age range uses, and a test asserts every generated fact in
every language is free of both.

**The price is derived rows and nothing is typed twice:**

| Row | Where it comes from |
|---|---|
| Yearly registration fee | `registrationFee` |
| Cost per lesson | `fullPrice ÷ (sessionCount × sessionMinutes ÷ 45)`, or `perHourOverride`; **off unless `showPerLesson`** |
| Cost per semester | `fullPrice`, qualified by "(N sessions × M lessons)" |

**There is deliberately no total.** The card used to end with one, computed
rather than typed so it could not drift from the two numbers above it — but
computing it was never the problem, adding those two numbers at all was. The
registration fee is charged once a **year** and the course fee once a
**semester**, so their sum is a figure nobody is ever billed: a child returning
for the spring, having paid the fee for this activity in the autumn, pays 300,
not 350. The total was
right only for a first-semester registration, which is also the one case where a
reader can do the addition unaided. A test asserts the sum appears nowhere, in
any language, under any label.

Rows, not lines in one value: the price is its own card now, and a card
headed "Price" whose single fact is also labelled "Price" says it twice.
`priceRows()` returns `{label, note, value}` and is the single builder —
`formatPrice()` derives the one-string form from it, so a page and a caller with
no room for rows cannot disagree. The qualifier is the `note`, its own quiet
italic line (`.fact-note`) between the label and the number: it is neither, and
glued onto either it reads as a second label or as part of the figure.

A "lesson" is the 45-minute academic hour; a "session" is one meeting, so a
90-minute session is two lessons. That is the same number per-hour always
computed — the label changed, the arithmetic did not.

Every line is conditional on the data behind it, so this is the shape for every
activity rather than a layout that fits one: an activity with only a full price
renders a single row. The "(N sessions × M lessons)" qualifier appears only when
a session divides into whole lessons — a 60-minute session is 1.33 lessons,
which is arithmetic, not a sentence.

**Cost per lesson is off by default**, behind `price.showPerLesson`. It is a
number a teacher reads as a rate to be compared against other schools, and it
is a division of two figures that are both already on the card. The other three
other rows are unaffected either way, and the admin's live preview mirrors
`priceRows()` exactly — the same rows, and the same absent total — so the toggle
is checked without publishing to find out.

The registration fee is **annual, and the label says so** — "Yearly
registration fee" / `דמי הרשמה לשנה` / `Годовой регистрационный взнос`. It is
the one thing about the fee a family cannot infer from the number. What the
label cannot carry is the scope: the fee is **per participant per activity per
year**, so a sibling pays it again and so does the same child in a second
activity. The public card therefore carries **no waiver logic at all** — whether
a particular participant already paid it for this activity this year is a
question about a person, and the page is static and has no idea who is reading
it. That check belongs at the point of payment, behind a login, and lives in the
registration flow. See the Phase 4 section for the scope rule in full.

**A fact can be overridden with words, and the words are trilingual.**
`groupSize.overrideText` is a `{he, en, ru}` bag, and a filled-in language
replaces the computed sentence outright — not every grouping is "N groups of up
to M" and no amount of number-formatting makes one so. It shipped as a single
string for a day, which meant whoever typed it published their language on all
three pages. Half-translated, it still overrides in all three via the usual
FALLBACK chain: the same sentence in the wrong language beats two pages making
different claims about how the activity is grouped.

That split — numbers are structure, sentences are words — is enforced in the
merge, so a Russian-only role can translate an override or an address without
being able to change a count. `LANG_SUBKEYS` in `activities-admin.js` lists
which sub-keys of a structured fact are words. It is a list rather than a test
per fact because the version that tested per fact named `location` and was
never updated when `address` was split out of it, so the exact address was
silently read-only for every restricted role. A test pins both.

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
   with only a heading in it, so no orphaned label survives. Program length,
   language of instruction and prerequisites became facts, and what to bring
   is retired, so **FAQ is the only one left**.

`draft` deserves a warning: `js/activity.js` redirects a draft page to
`/404.html` (bypass with `?preview=1`), but the site is static with no auth,
so **that is a courtesy, not access control** — the HTML is still served to
anyone who asks for it. Until an admin backend exists, a genuinely
unpublished activity should not be committed or deployed at all, and must
stay out of `sitemap.xml`.

### An activity has an id, a kind, and registration settings

Three root-level fields, all **structure** — one answer for all three languages,
merged like `robots` and `shareImage`, so a role that may only edit Russian
cannot touch any of them.

**`activityId`** (`act-` + 16 hex) is minted once and is **never editable, at any
permission level**. The slug is the filename, the URL and the sitemap entry, so
today it is the identity — and renaming one would orphan every registration
attached to it. Minting it now, with nothing to migrate, costs one field.
Delete-and-recreate deliberately produces a **new** id: that is a different
activity, and old registrations must not silently attach to it. It joins
`indexEntry()`, so a public form can resolve slug → id from a file the page
already fetches.

The design said `migrate()` mints it "idempotently", and those two words pull
against each other — a pure function that invents a random value returns
something different every call, and this module's whole contract is that it is
safe to run on every read. **So the randomness is injected.** `migrate(record)`
leaves a record without an id exactly as it found it; `migrate(record, {mintId})`
fills one in, and the second pass finds what the first wrote. The real minting
happens in `stamp()`, the one place a save marks a record.

**`type`** is `course` or `dropin`, and it is a flag rather than a second content
type. The two differ in exactly three respects — how money is quoted, how it is
collected, and what cancelling means — and are identical in every other respect
the site has: same URL space, same template, same listing, same publish pipeline,
same permissions. A second content type would have duplicated all of that. The
page, the listing, the sitemap and the image pipeline **never ask what type an
activity is**; `priceRows()` was already built out of "if there is a fee", "if
there is a term price", so a drop-in is one more conditional row.

**`registration`** is what a registration system will read: `autoApprove`,
`pendingExpiryDays`, `registrationFeeCutoffDate`, `cancellationPolicy.{mode,
cancellationCutoffDate}`, and `sessionCancelHours` on a drop-in. It lives in
`_activity-registration.js`, which is **pure and does not arm the legal gate** —
the gate matches a filename *starting* with `registration`, and this module holds
nobody's data. Do not rename it to something that begins with that word.

**A cutoff is one field with three states**: a date, `"none"`, or `null`. Not a
date beside a `disabled` boolean, because two fields can contradict each other
and something then has to decide which wins — here the contradiction is not
representable. `defaultIfBlank()` runs on save and fills only `null`, so a cutoff
an admin switched off stays off. The two defaults are the start date minus 14
calendar days, and the date of session `ceil(30% × count)` — **counted in
sessions, not days**, because the credit formula divides sessions remaining by
sessions total and a day-based cutoff would have the two halves of one policy
disagreeing. For hebrew4kids that is 28 Oct rather than the calendar's 4 Nov.

`defaultBasis` records what those dates were computed from, so the form can
**notice the inputs have moved and offer to recompute**. Never so anything
recomputes on its own: an activity postponed by a month keeps the dates it was
given, because a formula re-evaluating would rewrite terms already agreed.

### Conditional panels, and the trap they bring

**A group the form did not draw is not read back and is not merged.** Switch a
course to a drop-in and the term price and both cutoff dates sit in panels the
form no longer draws — so the read-back sends nothing for them, and "nothing"
merged as "cleared" destroys three configured values as a side effect of changing
a dropdown. Nobody typed anything, which is what makes it worse than the
read-back bug this file already describes.

Absent must mean "this type did not send it", never "the admin emptied it" — the
same distinction `cardImage` draws. `mergeRegistration()` and
`keepUndrawnFactKeys()` enforce it, and both decide from the **type**,
server-side, rather than from a list of drawn fields the client sends: the client
is hostile by assumption, so a rule depending on it telling the truth about what
it rendered is not a rule. `REG.FIELDS` is the single list the form draws from
and the merge reads, because two copies fall out of step.

### The session calendar

`facts.duration.sessionDates` is `[{date, status, reason?}]` and is the source of
truth: `sessionCount` is derived from it, not read beside it. `_activity-sessions.js`
enumerates it from the frequency; the admin then edits it by hand. **Generate
once, then edit.**

It was already half-built and **silently lossy**: `SHAPES.duration` is applied to
every record on every read and every save and did not list `sessionDates`, so the
calendar could be generated, stored and rendered, and the next save deleted it.
The frequency list had the same shape of bug — repeated rather than read from the
calendar module, so `biweekly` and `monthly` were enumerable and renderable while
a save coerced both back to `weekly`.

Generation goes through a **server action** (`action: 'sessions'`) rather than a
second enumeration in the browser. It commits nothing. The action also reports
when the generated dates do not reach the stated end date — which on hebrew4kids
says ten sessions run out on 16 December against an end date of 23 December, a
disagreement that has been in the record since before any of this existed and
that nothing has ever read.

**An excluded date keeps its place in the record** so it can be put back and so
it survives a regeneration, and its `reason` travels with it. None of that
reaches the page: the published table lists the sessions that are happening and
nothing else — no marked row, no "no class". That also makes the numbering free.
If nothing skipped is shown, nothing skipped can take a number, so session 3 is
the third row and the third meeting with no rule saying so, and the table is
**exactly** the list the credit arithmetic divides by.

The table is a full-width band between the article and the credits, `"sessions
sessions"` in the grid. **The row list grows with the areas** — five areas, five
`grid-template-rows` values, or the 117px hole under the picture reopens just as
silently as before. A test now asserts the two counts are equal rather than
matching a fixed prefix. No year in the rows, because the date range is already
on the page as the duration fact; the exception is a term spanning two calendar
years, where a bare "6 January" is ambiguous.

### Named groups, and the second price

Both **opt-in, absent by default**, and both add a branch that will sit
unexercised — which is why `tests/_fixtures.js` builds every activity in pairs:
course and drop-in, pooled and named.

`facts.groupSize.named[]` is `{groupId, name:{he,en,ru}, capacity}`. Absent means
the pooled model, unchanged. Present, `groups` and the capacity become derived —
the length of the list and the sum of the capacities — and `formatGroupSize()`
builds a different sentence. It lives inside the fact rather than in
`registration` because **a group name is words a family reads and a capacity is
not**: putting it there draws the permission line by where the field sits rather
than by a rule someone has to remember. `totalCapacity()` returns `null` for
uncapped, deliberately not zero, since zero would silently refuse every
registration for an activity nobody had finished setting up.

`facts.price.perSessionPrice` is the drop-in counterpart of `fullPrice`, not an
extra line beside it. It carries no "(N sessions × M lessons)" qualifier, because
that hangs off `fullPrice` and disappears on its own. `pricePerHour()` gained one
more source rather than a branch.

### `creditFor()` — what a cancellation credits

`netlify/functions/_credit.js`. The first piece of Phase 5, written before
anything depends on it because it is pure and needs no fixtures. It opens no
store and names no person, so it does not arm the legal gate; the ledger it
feeds does, and is not built.

**It reads one registration and one timestamp, and nothing else** — no activity
lookup, no GitHub call, no live schedule, no `Date.now()`. That is not style: the
cancellation policy is **frozen onto the registration at submission**, so an
admin who switches an activity from flat to prorated in March cannot change what
a family who registered in January is owed. Once the terms are frozen, the
calculation has nothing to reach that could have moved. The failure mode to watch
for is somebody later "simplifying" it by reading the activity — which gives the
same answer almost always.

Two properties follow: it is testable with no fixtures, and re-running it against
the same record and timestamp returns the same figure a year later. That second
one is what `basisFor()` sells — a family credited 150 out of 350 will ask why,
and the ledger entry carries the mode, both dates, sessions remaining over
sessions total, and the two figures that were added.

**Three thresholds, and they are not one timeline.** The fee answers to its own
date and to nothing else; the course answers to the first session and to the hard
cutoff. The fee's cutoff can fall before registration closes or after the course
ends, so there is no ordering between them to rely on.

| | Course | Fee |
|---|---|---|
| Before the first session | 100% | — |
| After it | 50% flat, or remaining ÷ total | — |
| Before `registrationFeeCutoffDate` | — | 100% |
| After it | — | 0% |
| After `cancellationCutoffDate` | 0% | 0% |

Four rules carry the weight:

- **The generous default is one line, not three branches.** All three dates
  default to null and every null resolves towards the family, because
  `past(null)` is false and an empty session list cannot have started. A missing
  date is an activity nobody finished configuring, and reading a blank as "the
  cutoff has passed" keeps a family's money on the strength of an empty field.
  Same rule capacity follows, where a missing group size is uncapped, not zero.
- **A cutoff is the END of its day, in `Asia/Nicosia`.** Midnight would cost the
  family the last day; UTC would move the deadline by the two or three hours
  Cyprus runs ahead, refusing 01:00 local on the final day as late. Both errors
  point the same way, which is how they survive review. The offset comes from
  `Intl` rather than a table, resolved on **whole seconds** with the `.999` added
  after — `formatToParts` has no millisecond field, so resolving an instant
  already carrying `.999` came back a second short and put the end of the day one
  second inside the next one.
- **Flat is proration with a fixed ratio.** `share(cents, 1, 2)` versus
  `share(cents, remaining, total)` — one division, one guard, one rounding rule,
  rounded **up**. Two formulas can round differently, and the difference surfaces
  when two families compare receipts.
- **The fee is split off, never stored.** `splitPaid()` takes the fee first,
  capped at the frozen fee; the remainder is the course. Two stored fields would
  need `paidFee + paidCourse === paidCents` to hold on a store with no
  transaction, and a broken invariant in a money field is found by a family
  rather than by a test. It assumes **the payment flow bills the fee first** —
  true in practice today, a requirement once payments exist.

`freezeCancellation()` builds the frozen block and lives beside the function that
reads it, so the two shapes cannot drift. It freezes **only the sessions that are
happening** — an excluded date never enters the list — which is what lets
`creditFor()` stay ignorant of exclusions entirely, and means a holiday appears
in neither the numerator nor the denominator. The denominator is the **length of
that list**, never a stored count: hebrew4kids has had a typed session count
disagreeing with its own calendar since before any of this was built, and this
is the one place that disagreement would have decided money.

The hard cutoff governs **entitlement, not the ability to end a registration**.
It refuses the guardian's own cancel button (`reason: 'cancellation-closed'`,
carrying the date so a 409 can name it); an admin cancelling in week nine for a
safety reason still goes through and credits nothing. `creditFor()` therefore
says nothing at all about admin cancellation.

## ⚠ Legal pages: the first gate is open, the second is not

`/privacy` and `/terms` exist in all three languages and now carry **real
reviewed text**. They are `final`, indexable, in `sitemap.xml`, and their draft
banners are gone. **Nothing links to them yet** — the footer links are still to
be added.

Each page carries **two** machine-readable markers, and they gate different
things:

```html
<meta name="ogen-legal-status" content="final">     <!-- may registration be BUILT? -->
<meta name="ogen-legal-review" content="pending">   <!-- may it be OPENED? -->
```

**`ogen-legal-status` is `final`, and that was a deliberate trade.** The Hebrew
and English text is reviewed; the Russian has never been read by a native
speaker, nor have the two price labels the activity pages publish
(`Годовой регистрационный взнос`, `Стоимость семестра`). Holding the entire
registration system closed behind that one outstanding review was judged the
wrong call, so the first gate was opened knowingly.

**`ogen-legal-review` is what keeps that a decision rather than an oversight.**
While it says `pending`, the same suite refuses to let a *public* registration
surface ship — a page a family can reach (`register.html`, `account.html`, a
`js/member-*.js`), never the admin, which is staff-only and noindex and is
exactly what the open first gate is meant to allow. So development continues and
the door does not open. Flip it to `complete` on all six pages when the review
is done.

Russian is not a courtesy language here. It is one of three equals, and a
Russian-speaking parent agreeing to terms nobody fluent has checked is the
situation the first gate existed to prevent, one language down.

**`tests/registration-waits-for-real-legal-pages.js` reads that marker and is
the safeguard.** It passes quietly today. The moment any registration surface
appears — a function named `member-*` / `account-*` / `participant-*` /
`guardian-*` / `registration-*`, a `requireStore`/`optionalStore` call opening
one of the people stores, or a `registrations` entry in `_roles.js` `TOOLS` —
the suite **fails the build** until every legal page is marked `final`.

That has now happened, and the four things moved together as the test requires:

1. `ogen-legal-status` → `final`, on **all six pages at once** (a reviewed
   English policy beside an untranslated Hebrew one is not "partly done" —
   Hebrew is this site's default language and the Hebrew reader is the one who
   cannot read what they agreed to);
2. the `noindex` meta removed;
3. the draft banner element deleted, and no `[content needed]` left;
4. `/privacy` and `/terms` added to `STATIC_ROUTES` in `_activity-index.js`, so
   the sitemap and the meta tag agree — the same pairing `/about` is still on
   the other side of.

The gate existed because the placeholder looked finished: proper URL,
breadcrumb, site typography, real headings. The reason the pages were created
early was exactly the reason nobody would have noticed they were still empty.
Ogen has never stored a person's name; the registration system stores a
**minor's name and date of birth, in the EU**.

**What is still owed is now `ogen-legal-review`**, and it enforces the same idea
one step further down the road: the Russian text and the two Russian price
labels have not been read by a native speaker, and while the marker says
`pending` the suite refuses a **public** registration surface — a page a family
can reach, never the admin. The test proves it bites rather than asserting it
does; dropping a `register.html` into the repo turns the suite red.

Real legal content was expected to be written through an inner-page editor
modelled on Shirat HaYam's. It was pasted in instead, and that editor still does
not exist — so the next substantive edit to these pages is a hand edit to six
HTML files.

## Admin backend (Activities)

A browser CMS at `/admin/` whose Netlify Functions render static HTML and commit
it into this repository through the GitHub API, which triggers a deploy. **Content
lives in git. Blobs holds everything that is not content.**

```
netlify/functions/
  _activity-facts.js     structured facts → one sentence per language; PURE
  _activity-migrate.js   old free-text facts → structured, losing nothing; PURE
  _activity-sessions.js  the session calendar: which dates an activity meets on; PURE
  _activity-registration.js  registration SETTINGS on an activity — no person, no
                         store, no gate. See the naming warning at its top; PURE
  _credit.js             what a cancellation credits; reads one registration and
                         one timestamp, and nothing else; PURE
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
admin/index.html, admin/activities.html, admin/registrations.html,
admin/users.html, admin/admin.css
js/admin-session.js, js/activities-admin.js, js/registrations-admin.js,
js/repeatable-items.js
js/image-optimize.js   resizes + re-encodes every upload IN THE BROWSER
```

The form is a **projection of `FIELD_SCHEMA`**, one panel per group, in the
order an activity is actually filled in: **Settings** (kind, slug, status, motif,
corner, card image), **Content** (title, summary, about), **Teachers**,
**Sponsors**, **Activity facts** (the facts, then the registration button link),
**Registration**, **FAQ**, then **Search & sharing** last.

**About is written in Quill** — the same editor and version the Shirat HaYam
admin uses, loaded from a CDN because this project has no build step, with the
three languages **stacked** rather than in the three-column grid the short
fields use: those are a comparison task, a paragraph of prose is not.
`rich: true` on the descriptor is the whole switch, and About is now the only
field carrying it.

That makes the stored value HTML, and `richText()` in the template prints it as
markup. Three things hold that together: `sanitiseRich()` on the server runs on
**every** save against a fixed tag allowlist (the value arrives in a request body
like any other field, and the page prints it unescaped); `plainText()` strips the
markup wherever text is wanted — meta description, og:description, the listing
blurb — or a search result reads `&lt;p&gt;במרכז עוגן…`; and a value that does
**not** start with a block tag is treated as the plain text it is and escaped, so
records written before the editor need no migration and read exactly as before.
Without Quill the field falls back to the plain textarea, so a CDN outage costs
formatting rather than the ability to edit. Meta title and meta description used
to sit in the middle of the content fields, where they read as more body copy to
write, which is how a meta description ends up being a paragraph. They are their
own `seo` group now.

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

Retiring one touches the same places, which is why "What to bring" leaving took
the `optional` group with it in all three. Moving a field between groups touches
**three** places that must stay in step:
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

⚠ **`www.ogen.cy` is proxied through Cloudflare, so measure cache behaviour
against the domain, never against `ogen-web.netlify.app`.** A CDN sits between
this repo's headers and a visitor, and for a while it was rewriting them:
Cloudflare's Browser Cache TTL raises any origin header shorter than its setting
up to that setting, and at the four-hour default `/images/activities/*` left
Netlify as `max-age=300` and reached a browser as `max-age=14400`, `/shared.css`
left as `max-age=0` and arrived the same way, and `no-cache` on the admin scripts
arrived as `max-age=14400`. Only headers **longer** than four hours survived.

Browser Cache TTL is now **"Respect Existing Headers"** and all five paths were
re-measured origin against edge: every one arrives unchanged, with
`server: cloudflare` and a `cf-ray` still on the response, so this is the proxy
passing headers through rather than the proxy being gone. The five-minute
transient-404 window on `/images/activities/*` is real again, and a stylesheet
change reaches a returning visitor immediately.

That setting is one click and is not in this repository, so it can be changed
back without anything here failing. Re-measure both hosts before trusting a
short `Cache-Control`, and note the edge keeps its own copy independently of
this — `cf-cache-status` and `age` describe Cloudflare's cache, not the
browser's, and `max-age=0, must-revalidate` correctly shows as `REVALIDATED`
rather than as a miss.

The paragraph above used to end by saying this rule was "verified against the
deployed site, not assumed from the documentation". It had been verified against
Netlify, which is not the deployed site. There is a CDN in front of it.

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

## Accounts (Phase 2)

The first thing this project has ever built that stores a person's name, and the
people are guardians of children.

```
netlify/functions/
  _account-store.js    ogen-accounts + ogen-account-emails; bcrypt @12
  _member-session.js   ogen-member-sessions + ogen-member-tokens; 7-day sliding
  _account-email.js    the three account messages, in three languages
  account-auth.js      /api/account-auth
```

**Identity is an id, not an email**, diverging from the sister project on
purpose. It keys members by email and its own source says what that costs —
"change my email address has never been safely buildable" — and carries a
five-phase migration to escape it. Ogen starts where that migration is trying to
arrive: `acct-<accountId>` holds the record, `email-<encoded>` is a one-line
pointer, and **the pointer store is the entire login index**. Changing an address
is three writes with no transaction, and the worst outcome is two pointers
resolving to one account, which is recoverable — rather than an identity split
across seven stores. The pointer is written **last** on create, so a crash
leaves an account nobody can sign in to rather than a pointer to nothing.

**⚠ THE SESSION STORES ARE SEPARATE, AND THAT IS THE SECURITY BOUNDARY.**
`ogen-admin-sessions` is keyed `sess-`, `ogen-member-sessions` is keyed `msess-`.
A guardian token handed to an admin function is not found, because it is not
there. The tempting shape — one store with a role on the record — makes the
boundary a *check*, and a check can be forgotten at one call site out of thirty,
and the one that forgets is a publish endpoint authenticated by a parent's
cookie. Do not merge them. A test cross-feeds the tokens both ways.

Guardian sessions run **7 days on a sliding window**, refreshed on each
validated read (skipped unless the session is over an hour old, or every request
rewrites a blob to move a timestamp). Long enough for a parent who visits monthly
not to be signed out mid-term; short enough that a session on a shared family
laptop dies within a week. **Admin sessions stay at 8 hours** because they carry
publish rights — the two numbers must not be unified.

**Nothing reveals whether an address has an account.** Sign-in answers
identically for a wrong password and an address nobody has used — including the
bcrypt cost, which is paid against a throwaway hash when there is no account, or
the timing difference leaks the same fact more slowly. A reset request answers
identically whether or not it sent anything. On the admin this would be
tidiness; here, an attacker who learns `dana@example.com` has an Ogen account has
learned she has children attending and roughly where they are on a Wednesday
afternoon. Sign-up is the one unavoidable exception, and it is the loudest and
most rate-limitable action.

**A reset ends every other session.** A reset exists because somebody may have
lost control of the account; leaving other sessions alive would lock out the
owner and leave whoever took it signed in. `changePassword` spares only the
session doing it. One-time tokens are **deleted before the handler returns**, so
a link followed twice — by a person and then by a mail scanner — works once.

**An account cannot exist without accepting the terms**, and `termsAcceptedAt` is
stored. That is the tie to the legal pages: they are final, published and linked
from the footer, so there is a document to point at.

The failed-sign-in throttle (8 attempts, 15-minute lock) is **best effort by
construction** — Blobs has no compare-and-swap, so two simultaneous failures can
lose a count. It is weaker than the number suggests and better than nothing; real
rate limiting belongs at the edge, which is Cloudflare, already in front.

No cached balance on the account, now or ever by default — see the ledger note.

## The family (Phase 3)

```
netlify/functions/
  _participant-store.js  ogen-participants; age DERIVED, never stored
  _guardian-store.js     ogen-guardian-links + ogen-guardian-invites
  account-family.js      /api/account-family   — guardian session
  admin-family.js        /api/admin-family     — ADMIN session, separate on purpose
```

**A participant, not a child.** A guardian must be able to register themselves,
which leaves two shapes: a second entity for adults, or one that happens usually
to be a child. One entity, making no claim about age — so the age flag, the
freeze and the capacity count all work with no `attendeeType` branch anywhere
except wording.

**It is its own record**, which is the sharpest divergence from the sister
project, where household members are an array inside the member record and
"linked to two guardians" is literally unrepresentable. Here the link is its own
record precisely so it can be.

**Age is derived, never stored.** `ageAt()` counts birthdays rather than
dividing by 365.25 — off by a day near the end of February, and "11 not 12" is
exactly the difference an age flag turns on. **The flag is advisory and never a
gate**: any age can be submitted, `ageFlag()` annotates the approval queue, the
admin decides. A missing date of birth and an activity with no stated range are
the same answer (`inRange: null`), not two special cases — and a missing date
stops being a blocker, which is what the earlier design had to choose against.

**`link-<participantId>__<accountId>`, participant first**, and that ordering is
load-bearing: "who are this participant's guardians" is a prefix scan, and that
is the query the max-of-two rule is enforced with. The other direction is one
`list()` filtered by key suffix, which returns keys without reading blobs.
**Primacy is not on the link** — `primaryAccountId` is one field on the
participant, so "exactly one primary" has a single writer rather than being an
invariant across two blobs with no transaction.

**⚠ A PARTICIPANT IS NEVER LEFT WITH NO GUARDIAN.** It would be a record no
account can see, reachable only by an admin who goes looking, invisible to the
family it is about. Refused from all three directions: a guardian cannot leave
when they are the only one, an admin cannot unlink the last one, and a
participant whose creator-link write fails is deleted rather than kept. The
refusal also **dissolves** the reassign-with-no-target edge — a permitted unlink
implies a remaining guardian by definition.

**Primacy moves in the same write as the unlink**, to the remaining guardian.
Not a prompt, since there is one possible answer, but it must not be forgotten:
primacy authorises inviting, so a participant whose primary is no longer linked
could never gain a second guardian again.

**The invite is bound to the address it was sent to.** The token is a bearer
secret sitting in an inbox; without the binding, a forwarded link hands a
stranger a child's record. The cost is real — a guardian whose account is under
another address cannot accept — and `admin-family.js` is the escape hatch that
cost was accepted against. Re-sending **mints a new token and revokes the old
one**, so a forwarded copy of the previous link dies. Invites run 30 days rather
than a registration's 14, and expire **lazily on read**: no link exists until
acceptance, so an unaccepted invite grants nothing and needs no sweep.

**`token` authenticates; an invite is `inviteToken`.** `sessions.authenticate()`
reads `body.token`, so an invite action reading the same key hands a session
token to `acceptInvite()` — which then reports a perfectly valid link as
invalid. One name, one meaning.

**`family` is its own admin tool**, granted to Super Admin only. An admin who may
publish pages is not thereby an admin who may read a child's date of birth.

The debt disposition on unlink is **Phase 5**. `debtsFor()` now reads the
registrations and still returns nothing, because `payment.owedCents` is null on
every record until something can say what a registration is billed — and the
ORDER was already right: the last-guardian refusal comes first, so an admin is
never shown a debt prompt for an action that was never going to complete.

## Registration (Phase 4)

An admin can now run a term. Server-side only, like Phases 2 and 3 — there is no
page in front of it, deliberately, so the family area stays a rendering job.

```
netlify/functions/
  _registration.js        what a registration IS, and every rule needing no storage; PURE
  _registration-store.js  ogen-registrations; reg-<participantId>__<activityId>
  _registration-email.js  the four messages, in three languages
  _registration-sweep.js  run(); the nightly pass, shared by the schedule and the admin
  registration-sweep.js   the scheduled entry point — see netlify.toml
  account-registrations.js  /api/account-registrations — guardian session
  admin-registrations.js    /api/admin-registrations   — ADMIN session, separate on purpose
```

**A SPOT IS COUNTED, NEVER DECREMENTED**, and everything else follows from it.

```
holdsASpot(reg, now) = reg.status === 'approved'
                    || (reg.status === 'pending' && now < reg.expiresAt)
```

Capacity calls that, never the stored status. So rejection, expiry and
cancellation are **one mechanism rather than three**: writing `cancelled` makes
the next count one lower, and there is no hold to release, no counter to fix and
no window in which the number is wrong. A counter blob would have been cheaper to
read and would have needed a decrement that can be **lost without trace** on a
store with no compare-and-swap — and a lost decrement is invisible, where an
extra registration record is at least visible and reversible. Cancellation
arrived free because rejection and expiry had already paid for it.

Two consequences worth stating plainly:

- **An expired hold frees its place the instant it lapses**, whether or not the
  nightly sweep has run. The derived rule is authoritative and the job is
  cosmetic — a broken schedule costs a stale queue, never a number. A pending
  record with no `expiresAt` stamped **keeps** its place, because an unstamped
  record is a bug in the writer and reading it as expired would free a place a
  family is waiting on.
- **Over-capacity is reported, not prevented.** Two submissions arriving together
  both read "one place left" and both write; the window is a few hundred
  milliseconds and there is no atomic increment. The queue says "23 / 20 — over
  capacity" and an admin rejects the surplus.

Capacity is `facts.groupSize` and no new field: the product when pooled, the sum
of the named capacities when an activity names its groups, and **null means
uncapped, deliberately not zero** — a blank must never read as a restriction.
Named groups bucket the same count with no extra read. A place taken while the
activity was still pooled carries `groupId: null`, so it counts towards the
activity and belongs to no row; the rows deliberately do not sum to the total.

**There is no waitlist.** The place is simply gone and the next submission takes
it, first come. A waitlist has to choose who gets a freed place, tell them, and
give them a deadline before it moves on again, and none of that is decided. The
counting model supports one without change.

**`expiresAt` is stamped at submission**, with `expiryDays` and `expirySource`
beside it. Computing `submittedAt + N` on read would make every change
retroactive — lowering the number would expire a batch of live registrations the
moment it deployed, and raising it would revive ones already released. Three
levels resolve it: the activity, then `PENDING_EXPIRY_DAYS`, then 14.

**Auto-approve stops at an age it cannot confirm**, which is one step past what
the design settled. The design's rule was that an out-of-range age falls through
to manual review — `autoApprove` means "this activity has no gate a human needs
to apply", and an out-of-range age is exactly a case where a human has something
to decide. The case it did not name is an age that cannot be checked **at all**,
so the rule is written as *a stated range must be positively satisfied* rather
than *inRange must not be false*: reading a blank as a pass makes the one case
nobody can verify the one case nobody looks at. An activity with no stated range
has nothing to satisfy and auto-approves in full. **Falling through is not a
rejection** — the request waits for a person, and the person may well say yes.
Nothing in this system is rejected by a machine, which is what makes the binary
approval model genuinely binary.

**The age is measured at the activity's start**, not at submission, where there
is a start date. A child who turns seven the week before a 7-10 class begins is
seven for that class.

**The frozen block is the only thing standing between a Blobs record and a git
record an admin edits daily.** It captures the inputs to the decision — name,
date of birth, the age range as it read, the price, the group's *name*, and the
cancellation terms from `freezeCancellation()` — so a price edit in March cannot
rewrite what a family agreed to in January, and a group renamed from "Advanced"
to "Level 3" cannot rewrite what they chose. `activitySlugAtSubmission` is audit
only; if it later disagrees with the activity's slug, that is a rename working.

**One record per participant per activity**, keyed `reg-<participantId>__<activityId>`.
Two siblings are two blobs that know nothing about each other, so approving one
is a write to one key — an `attendees[]` array has one outcome to give, and on a
store with no compare-and-swap two admins working the queue at once would
silently undo each other. A re-request after a refusal lands in the same blob and
**carries the earlier history forward**, so an admin can see the first attempt.

**Five statuses, and cancellation is not a sixth.** A guardian's cancellation and
an admin's are the same thing to capacity, the queue and the reminders; what
differs is who did it, so that lands in `cancelSource`. What a decision may be
taken **from** is a table in `admin-registrations.js`, and its interesting
entries are `rejected -> approved` (an admin who rejects by mistake must be able
to undo it — "approving is undone by rejecting" only holds both ways) and
`expired -> approved` (the request lapsed because *we* did not answer; answering
late is the right outcome). `cancelled -> anything` is refused: the family
withdrew, and reinstating them without their asking is not an admin's to do.

**`registrations` is the first tool whose axes are not `{access, edit, publish}`.**
It carries `{access, approve, cancel}`, and **cancel is a third axis** because
cancelling moves money — it writes a credit a family can spend and cannot be
undone at all, only compensated. `access` is its own gate for the same reason
`family` is: opening the queue means reading children's names and dates of birth.
Super Admin only.

**The credit ledger does not exist, and both cancel paths refuse rather than
round down.** `creditFor()` is computed on every cancellation; if it comes to
more than zero, the request is refused with `requires: 'credit-ledger'`. That
branch is unreachable today — nothing collects money, so `paidCents` is zero
everywhere and a family who has paid nothing is owed nothing, which is also why
the design writes no ledger entry in that case at all. It is a refusal so that
the day payments arrive, a cancellation cannot quietly drop what a family is
owed. The **admin's** cancellation is never refused by the hard cutoff, only
credited nothing: a child has to be removable in week nine for a reason that is
not about money.

**`payment.owedCents` is computed at submission**, with the registration fee
already decided — see the Phase 5 section for the waiver.

**The sweep is the cosmetic half and says so.** `[functions."registration-sweep"]`
in `netlify.toml`, 06:00 UTC daily. It rewrites lapsed `pending` to `expired`,
stamps the reason, and mails the family. Two things about Netlify's scheduler
that look like bugs: it invokes the function as a **POST carrying
`{"next_run":…}`**, so a handler treating a request body as proof of a human has
it backwards; and the edge answers **403 to every external HTTP request** to a
scheduled function, which is why the admin's "run now" calls `run()` directly
rather than fetching the endpoint. Running it twice finds nothing the second
time — it only ever rewrites what the derived rule already released.

**The expiry email apologises.** The thing that expired is a request *we* did not
answer, so "your request expired" — which reads as the family having let
something lapse — is the wrong sentence. Four messages in
`_registration-email.js`, and only the confirmation is resendable: a family
legitimately loses "you have a place", whereas re-delivering a refusal a
fortnight later is the clearest case in that table of a resend doing harm.

**`_email-shell.js`** was lifted out of `_account-email.js` when these arrived.
That file had said from the beginning that there is one shell "so they cannot
drift apart visually", and a second family of messages was the moment that either
became a shared module or became two copies. The lift is byte-identical.

**Not built, and deliberately:** a payment PROVIDER (every payment is recorded
by an admin, which is how Ogen already collects money), the public "places left"
count (an
unauthenticated endpoint returning a number, never a list), and
`memberVisibleRows()` — the authenticated view that serves the members-only
address to a guardian with an approved participant. Both are rendering-side and
belong with Phase 6, and the second must never be reached by
`_activity-template.js`: `isPubliclyVisible()` keeps its exact current meaning
and its only caller.

## Money (Phase 5)

```
netlify/functions/
  _credit-ledger.js       ogen-account-credits; append-only, no cached balance
  _registration-cancel.js cancelAndCredit() — the one function both cancel paths call
```

Plus `feeApplies()` / `owedCentsFor()` in `_registration.js`, `seriesId` on the
activity, and a third argument on `splitPaid()`.

### The registration fee, and the one case it is waived

**THE FEE IS SCOPED TO ONE PARTICIPANT, ONE ACTIVITY, ONE ACADEMIC YEAR.**

| | Fee |
|---|---|
| Same child, same activity, second term | **not** charged again |
| Same child, a different activity | charged |
| A sibling, same or different activity | charged |

Not per family and not per account. The scope is what makes the waiver
answerable from **that child's own registrations and nothing else** — a prefix
scan of `reg-<participantId>__`, which is the cheap direction of the key. No
sibling lookup, no account aggregate, no ledger, nothing to reconcile. This file
briefly described a family-level rule, which was wrong in both directions at
once: it would have waived a sibling's fee, which Ogen does charge, and it would
have needed the whole family resolved before it could price one registration.

**The year is academic, not calendar, and that is the feature rather than a
refinement.** Autumn runs October to December and spring January to June, so on
a calendar year the two halves of one course fall either side of the boundary and
a returning child is charged twice — the exact case the waiver exists for.
September is the boundary, which is when the school year starts in both Israel
and Cyprus. It is measured from the **activity's start date**, not from the
moment of submission, so 31 August and 1 September enrolments for one October
term land in the same year.

**`seriesId` is what says two records are the same activity**, and it **defaults
to the record's own `activityId`**. A slug is one semester: hebrew4kids runs
mid-October to mid-December and its `fullPrice` is labelled *per semester*, so
the spring term is a second record with its own dates, its own calendar and its
own page. That is right for everything the site publishes and wrong for exactly
one question, which is the fee. Defaulting to the record's own id is what makes
it free — every activity is a series of one, nothing that reads it changes
meaning, there is no migration and **the registration key does not move**.

It is a **pointer, never minted**: a series carries the id of whichever term was
created first. The admin's picker therefore offers each candidate's *seriesId*,
not its activityId, so a third term pointed at the second joins the series rather
than starting a third one. It is structure, so a Russian-only role cannot move an
activity into another's series and change what a family is billed. It rides in
`indexEntry()` beside `activityId`.

**What counts as "already charged" depends on whether the prior registration is
live or finished**, and collapsing the two left a hole:

- `pending` / `approved` — it stands, so the fee is billed on it and will be
  collected. Counts **even if nothing has been paid yet**, or a family
  registering for both terms before paying anything would be billed twice.
- `rejected` / `expired` — never became a place, so nothing was owed.
- `cancelled` — over, so "billed" promises nothing. Counts only if the fee was
  actually **paid and not given back**. Reading `cancelled` as charged outright
  made register → don't pay → cancel → register again a way to never pay the fee
  at all. A test found it.

That last clause is why `payment.feeCreditedCents` is tracked **apart from**
`creditedCents`: a family refunded the fee is paying it again next time, and the
total cannot answer that.

**`frozen.price.feeCharged` is the third argument to `splitPaid()`**, and it has
to be. `splitPaid` takes the fee off the top of whatever was paid; on a waived
registration **nothing paid is fee**, so without the flag the first €50 of a
course payment comes back as a fee credit. That is not a labelling error — the
fee and the course answer to **different dates**, so it moves the total too. The
flag is tri-state: `false` waived, `true` billed, **absent reads as charged**,
because every registration written before the waiver existed was charged.

### The ledger

`ogen-account-credits`, keyed `cred-<accountId>__<ISO>__<random>`.

**Append-only. An entry is never edited and never deleted** — a ledger that can
be rewritten is not a ledger. A mistake is corrected by writing the opposite
line, which leaves both in the record; the question a family asks is not what
their balance is but why it is that.

**There is no cached balance, now or by default ever.** A stored total and a list
of entries are two representations of one fact on a store with no transaction to
keep them agreeing, and the sister project's wallet warns that this failure is
silent and loses money. It is summed every time.

Account, then timestamp, then a random tail: the prefix makes a balance one scan,
the timestamp orders a person's entries without sorting on a field, and **the
random tail stops two entries written in the same millisecond overwriting each
other** — which matters here more than elsewhere, because there is no
compare-and-swap. Integer cents throughout, `amountCents` **always positive**
with the sign in `type`, and `reason` a closed list so a typo cannot invent a
category. **Zero is refused**: a zero entry is a line in a financial record that
means nothing and still has to be explained, so a caller with nothing to write
writes nothing.

`basis` carries what `basisFor()` produced — the mode, both dates, sessions
remaining over sessions total, and the two figures added — so a family credited
150 out of 350 gets the answer from the record.

### `cancelAndCredit()` — written once, called by both

A guardian's cancellation and an admin's differ in exactly two things: who did
it, and whether the hard cutoff stops them. Everything after that is identical
and involves money, so two copies would be two copies that can round differently
— and the difference surfaces when two families compare receipts. `entitled` is
the caller's decision, which is where the two genuinely differ: a guardian past
the cutoff cannot cancel at all, an **admin past it still can and credits
nothing**.

**The ledger is written first, the registration second** — the opposite of the
email rule, for the opposite reason. An email not sent leaves a person waiting; a
credit not written is money lost with nobody able to tell. A failed ledger write
takes the whole action down and the family keeps their place, which is
recoverable. The cost is a possible double credit on a retry, which is visible in
an append-only ledger a person reads, and reversible with an adjustment.

### Money is the `cancel` axis

`recordPayment`, `applyCredit` and `adjustCredit` all sit behind `cancel` rather
than `approve`, because that is the axis that exists to mean "may move money".
Reading a ledger is `access` — seeing what a family is owed is part of answering
their question about it.

`recordPayment` **adds rather than sets**, so two part payments are two calls and
both are in the history; it settles to `paid` only when the total covers what was
billed, because a part payment reading as settled is a debt nobody chases.
`applyCredit` writes the debit **and** the payment in one action, or the ledger
and the registration disagree about the same euros, and it refuses more than the
account holds. `adjustCredit` requires a note.

### The unlink debt disposition

`debtsFor()` is real now. An unpaid registration attached to the guardian being
removed is **a question, not a rule**: the unlink answers 409 with what is owed
and who is left, and completes only when told `reassign` or `write-off`. There is
deliberately no third option meaning "leave it" — a debt owed by an account that
can no longer see the participant is a debt nobody will ever be asked about. The
disposition is applied **before** the unlink, so a failure leaves the guardian
linked and the debt where it was. `reassignedFrom` is kept because the person
being asked to pay did not submit it, and will ask why.

The ordering the Phase 3 stub already had is what makes this safe: the
last-guardian refusal comes first, so an admin is never shown a debt prompt for
an action that was never going to complete — and "reassign has no target"
cannot arise, because a permitted unlink implies a remaining guardian.

## The approval queue (admin)

`admin/registrations.html` + `js/registrations-admin.js`, against
`/api/admin-registrations`. It is the screen that makes "an admin can run a
term" true rather than true in principle — Phases 4 and 5 shipped the API with
nothing in front of it.

**It is a table where the rest of the admin is cards**, and the difference is the
job: every other screen is opened to edit one thing, this one is opened to find
the rows that need something doing. Columns line up so the eye runs down them,
and the numbers are `tabular-nums`.

Four things it shows that are easy to get wrong:

- **The capacity line says "23 / 20 — over capacity" plainly.** Uncapped says
  "no limit set" rather than warning: a blank group size means nobody finished
  filling the activity in, and reading it as zero would refuse everybody.
  Registrations taken before the groups were named are counted and shown as
  belonging to no row, because they are.
- **The age flag is amber, never red.** It is advisory: auto-approve stood aside
  and left the decision to a person, and the person may well say yes. Styling it
  as an error would make the one thing that is not a refusal look like one.
- **A lapsed hold reads as lapsed before anything has rewritten it**, because the
  row asks `holdsASpot()` rather than the stored status. The sweep button says
  so too: *the place is already free either way — this only updates what the
  queue says and tells the family.*
- **Whether the yearly fee was billed on this term**, beside the amount. An
  admin looking at a €300 next to a €350 should not have to open the other term
  to find out why.

**Every money control lives in one panel, not on the row.** Money is its own
permission axis, and the ledger is the context all three controls need: what a
family is owed is the first thing to know before recording a payment against it
or spending it. Euros in the box, cents on the wire — that conversion happens in
exactly one place. Each ledger line shows its `basis`, so "credited 150 of 350"
explains itself on the screen a family is being read it from.

Cancelling asks for a reason and says what it is about to do, because it writes
into a ledger that cannot be edited afterwards — only corrected with another
entry.

**The client's permission checks are cosmetic**, as everywhere else here: they
grey buttons out, and the server re-checks `canAccess` / `canApprove` /
`canCancel` on every action. `tests/the-queue-screen-calls-actions-that-exist.js`
checks the two halves against each other mechanically — every `action:` the
screen sends is a `case` the server handles, and the three money actions are
behind `canCancel` on both sides. An unknown action answers 400 and that failure
is otherwise invisible until somebody presses the button.

### ⚠ Why this exists and the family area does not

The guardian-facing area (Phase 6) is a **public registration surface**, and
`ogen-legal-review` is still `pending`. The admin is explicitly the other side of
that line — the gate's own comment says "building the admin side of registration
is exactly what this gate is meant to allow" — so this shipped and the family
area did not.

The gate's script check is by filename, which would have flagged
`js/registrations-admin.js` as public. That was fixed by making the exemption
**earned rather than assumed**: a script is exempt only when it is referenced by
a page under `/admin/` and by no page outside it. Reachability, not a naming
convention — anyone can name a public page "-admin", and the check is now
stricter in that direction than it was, since a public page loading an
admin-named script still trips it.

### Email (Resend)

The infrastructure, plus the account, invite and registration messages that now
run on it. `_email.js` is still the one send path; `_email-shell.js` is the one
visual shell.

```
netlify/functions/
  _email.js          the ONE send path, settle(), and the ICS builder
  _email-log.js      ogen-email-log; every send, and what became of it
  resend-webhook.js  /api/resend-webhook — Svix signature check, status updates
```

Three rules, each a bug somewhere before it was a rule:

1. **Send first, log second.** An email sent and not logged is a gap in a
   record; an email not sent because the log failed is a person left waiting.
   `logSend()` cannot throw.
2. **The send path is singular.** `resend.emails.send` appears exactly once, in
   `_email.js`, so "log after send" is a property of the code rather than a
   discipline every call site has to remember. A test asserts no other function
   talks to Resend.
3. **An email failure never blocks the action it accompanies.** `settle(what,
   who, thunk)` swallows and logs. An account is created, a registration is
   approved, and the message about it is best effort.

**Delivery status is a ladder plus a floor.** `PROGRESS` (sent → delivered →
opened → clicked) only goes up, because Resend does not promise order and
out-of-order is normal. `FINAL` (bounced, complained, failed, suppressed) always
wins and is **never overwritten** — a bounce is the one status an admin has to
act on, and a later "delivered" would hide it. `supersedes()` is the only place
that decides.

The log is keyed `log-<encoded recipient>__<ISO>__<random>` with an
`rid-<resend id>` pointer beside it, so the webhook is one read rather than a
scan of the store.

**The webhook returns 2xx unless the signature itself fails.** An event matching
nothing is an email sent before the store existed, or a dashboard test;
answering 500 makes Resend retry for days and then disable the endpoint.

**The ICS builder takes instants and emits UTC.** Ogen's session times are local
wall clock in `Asia/Nicosia`, and resolving wall clock to an instant is the
**caller's** job — doing it inside the builder would bake half a timezone
conversion into infrastructure that cannot see which zone the caller meant.
Lines fold at 75 **octets**, not characters, because Hebrew and Russian are two
bytes a character. Every VEVENT gets its own UID, or a calendar treats a ten
session course as nine edits of one event.

| Var | For |
|---|---|
| `RESEND_API_KEY` | Sending-only key. Resend key permissions cannot be changed after creation, so a Full-access key is set only for a backfill and unset afterwards |
| `RESEND_FROM` | `Ogen <noreply@ogen.cy>` |
| `RESEND_REPLY_TO` / `ADMIN_NOTIFY_EMAIL` | a real inbox |
| `RESEND_WEBHOOK_SECRET` | `whsec_…`, generated when the endpoint is created in Resend — so it cannot be set before the endpoint exists |

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
  the About and activity pages, and every string in `_account-email.js` and
  `_registration-email.js`. Flagged inline at the top of each `/ru/` file and at
  the top of both mail modules.
- **English activity copy** is a first-pass translation of the approved Hebrew
  and has not been proofread, including the status strings in `js/activity.js`.
- **`/about` is placeholder copy** (`[content needed]`), hence `noindex` and no
  sitemap entry.
- **`/privacy` and `/terms` are live and `final`** in all three languages, and
  no longer block the registration system. **Nothing links to them yet** — the
  footer needs the links. ⚠ The **Russian text and the two Russian price labels
  are still awaiting a native-speaker review**; `ogen-legal-review` is `pending`
  and gates public registration until it is done. See the Legal pages section.
- **Nothing in the nav links to `/about` or `/activities`** yet.
- **Registration has no page.** The API is built; nothing on the public site
  reaches it, and the `open` CTA still points at the contact section. Wiring is
  Phase 6's, and `ogen-legal-review` has to be `complete` before a public
  surface may ship at all.
  **Phase 1 is done** — the activity side: `activityId`, `type`, the
  registration settings block, the session calendar and its table on the page,
  named groups and `perSessionPrice`. All of it ships to the live site.
  **`creditFor()` is called on every cancellation, from both sides**, and the
  ledger entry it produces is written before the registration is touched.
  **Phase 2 (accounts) is done**: sign up, sign in, sign out, password reset,
  email verification, profile.
  **Phase 3 (the family) is done**: participants, guardian links, the invite
  flow, the admin override, and unlink with its last-guardian refusal.
  **Phase 4 (registration) is done**: submission, the approval queue, capacity
  counted rather than decremented, auto-approve with its fall-through, the
  expiry sweep, and the `registrations` tool with `{access, approve, cancel}`.
  **Phase 5 (money) is done**: the append-only credit ledger, the fee waiver
  scoped to one participant / one activity / one academic year, `seriesId`
  linking an autumn term to its spring, payments, applying credit, adjustments,
  and the unlink debt disposition.
  **The admin half now has a screen**: `/admin/registrations.html` is the
  approval queue, the capacity line, the sweep and every money control.
  ⚠ **Phase 6 (the family-facing area) is HELD BY `ogen-legal-review`** and is
  the first thing that gate has ever actually blocked. It is a public
  registration surface, and nobody fluent has read the Russian legal text, the
  two price labels, or the account and registration emails. Accounts, family and
  registration are therefore reachable only through the admin. **Phase 7
  (pay-per-session) remains** and is not gated.
- **Rotate the setup credentials.** The GitHub PAT and Netlify token were pasted
  into a chat transcript during setup.
