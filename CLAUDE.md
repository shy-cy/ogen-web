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
| `/account` | `account.html` | `he` | `rtl` |
| `/account/details`, `/account/activity` | `account/{details,activity}.html` | `he` | `rtl` |
| `/en/account…`, `/ru/account…` | `{en,ru}/account…` | | |
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
                  HTML carries s-maxage=60 so the EDGE caches it too
sitemap.xml, robots.txt
```

Homepage sections, in order: `hero` → `about` → `offer` (4 cards + "coming soon"
banner) → `why-ogen` → `vision` → `contact`.

⚠ **The hero button goes to `/activities`, not to `#offer`.** It pointed at the
four themed teaser cards further down the same page — which is not the list, and
is what the reader is about to scroll past anyway. That is word for word the
reason **"What We Offer" left the menu**, and the button was left behind: the
most pressed control on the site promising "our programs" and delivering a jump
to a section. The `#offer` section itself is untouched in all three languages; it
simply is not what the button is for. Each tree's button points inside its own
tree, and a test pins all three.

⚠ **And the `#offer` section's closing banner is now that same button.** It was
a `<p class="coming-soon">` reading "Coming soon: we'll be publishing next
year's full program and opening registration" — written before there was a
programme to link to, and still sitting there after four activities were
published. It was also, property for property, **a solid terracotta full pill
with white bold text**, which is exactly the shape this file reserves for things
you can press. The site's own badge rule was learned from the same mistake one
page over: *solid fill plus a full pill means pressable*, and a reader who
presses it gets nothing.

So it is the hero's button, repeated, at the foot of the section that has just
listed what is on offer — the same href and the same words, per tree. A reader
who has scrolled the four teaser cards is at the point of asking "so what is
there", and that is the one place a second copy of the primary CTA earns its
place rather than diluting it. `.coming-soon` is deleted rather than left
unused.

## Shared chrome is JS-injected

Page files contain **only their own body copy**. The nav, footer, and contact
form are injected at runtime into `<div id="page">`:

- **`js/nav.js`** — fixed 96px nav, centered logo, **account chip**, עב/EN/RU
  toggle, hamburger menu. Detects language from `location.pathname`. The toggle
  navigates to the twin URL (`/` ↔ `/en` ↔ `/ru`, `/confirmation` ↔
  `/en/confirmation` ↔ …), preserving `location.search` **and**
  `location.hash`. `.nav-right` is forced `direction:ltr` so the lang buttons
  and hamburger stay pinned to the physical right in a fixed `[עב][EN][RU]`
  order in all three languages. See **The account chip** below, and **The
  Activities group** for the one menu entry that is built rather than written.
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

⚠ **Reserving the colour was not enough; the SHAPE had to be reserved too.**
The badge was a solid fill, white text, `font-weight:800` and
`border-radius:999px` — property for property, `.sidebar-cta` — and for `open`
it was the same terracotta as well. So the site's most common state rendered a
tag that *was* the button beneath it, and a reader pressed the tag and nothing
happened. The badge is now outlined and tinted: `6px` radius, `1px` border,
dark text, `font-weight:700`. **Solid fill plus a full pill means pressable**,
and nothing else on an activity page uses it.

Each status keeps its own hue — only the shape changed. But **the text colour
is not always the token**, and that is not an oversight: five of the seven were
chosen as *backgrounds* behind white text and fail as foregrounds
(`--muted-warm` is 1.70:1 on paper, `--camel` 2.30, `--muted` 2.71, `--gold`
3.05). Each has a darkened same-hue variant, checked against its own tinted
ground rather than plain paper, since the tint is what sits behind the letters.
`--navy` and `--danger` pass as they are. A test computes all seven rather than
trusting the eye.

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
"sessions sessions"` — the picture leads the trailing column, level with the
fact cards, with the price card directly under it, the registration button under
that, and staff & sponsors under that: see the activity, see the cost, act, then
see who is behind it. Below, the areas become
`"pic" / "row" / "main" / "aside" / "sessions"` and nothing else changes.

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

⚠ **And the thumb rendered it in a 150px band, which is the SAME BUG the
activity page had already fixed.** `object-fit:cover` into a fixed height threw
away 53% of a 290px card's picture, centred — and because these are *titled*
graphics with the name typeset near the top, the half discarded was the half
naming the activity. The live listing showed `עברית` sliced through the middle
and `Hebrew for kids` gone entirely. It is `aspect-ratio:1/1` now, which crops
nothing, because `image-optimize.js` already guarantees the square. The lesson
had to be learned twice because the two rules were written separately; a test
now pins both, and pins that there is exactly one rule for each so the
`height:auto` pairing cannot be split across a media query.

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
| Side column, under the button | Staff & sponsors | Teachers, then sponsors |

The grouping answers the questions a parent asks in the order they ask them — is
this for my child, when and where is it, what does it cost — and then who
teaches it. It replaced a **"Details" card that was the leftovers of the other
three**: Location, Language of instruction and Price had nothing in common
except not fitting elsewhere. Language of instruction is a prerequisite in
practice, a reader asking when also asks where, and a number a family decides on
should not be the last line of a mixed list. Details is gone, not emptied.

Price sits **at the head of the side column**, directly above the registration
button: read what it costs, then press the thing that acts on it. Staff &
sponsors sits **directly under that button**.

It was a **full-width band under everything** until the session calendar landed
between the article and it. The band was the better shape in isolation — the
measure let its two groups lay out across and halve in height, 310px in a 320px
column becoming 160px across 1050, via a container query on the card's own
inline size at 520px. What changed is what sits above it: a table running to
eleven rows put the teachers past the fold on every screen. **A wider block
nobody scrolls to is worth less than a narrower one they see**, so the block is
back in the column and back to stacking. The container query needed no edit —
the card decides its own layout from its own width, so moving it into a
narrower parent is the whole instruction.

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
a group's `{capacity: 7}` renders as "עד 7 תלמידים" in Hebrew and "Up to 7
students" in English, and the three languages cannot drift. Two groups render a
named line each.

**⚠ EVERY FACT IS STRUCTURED NOW — `TEXT_FACTS` IS EMPTY.** `instructionLanguage`
and `prerequisites` were the last two free-text facts: a Hebrew box, an English
box and a Russian box holding whatever somebody typed. That is the shape this
module exists to replace — an admin who fills in one language publishes one
language, three pages can disagree about what a class requires, and "Beginners"
is spelled four ways across four activities.

They are a **closed list plus an optional line** now. `instructionLanguage` is
`{codes:['he','ru'], text}` over `he | en | ru | el` (Greek, because the centre
is in Cyprus, and a class taught in two languages picks two); `prerequisites` is
`{level, text}` over `beginner | intermediate | advanced`. Both render per
language in `_activity-facts.js`, the list first and the free text on a second
line — the list answers the question, the sentence adds to it. The Hebrew levels
are `מתחילים / ממשיכים / מתקדמים`, the idiomatic Israeli triple rather than a
word-for-word translation, the same choice the schedule headings make.

Nothing typed before this is lost: `liftBareText()` moves an old bare `{he,en,ru}`
bag into `text`, detected by shape rather than by a version flag, so an activity
that said "No experience needed" goes on saying it until somebody picks a level.
The `text` half is in `LANG_SUBKEYS` and the list half deliberately is not — a
Russian-only role may translate the sentence and cannot change which languages a
class is taught in.

⚠ **The loop that copies these two through `migrate()` used to iterate
`TEXT_FACTS`**, which was exactly them — so emptying that list stopped copying
them at all, and every record came back blank with nothing erroring. They are
named explicitly now. A list that is correct today and becomes a silent deletion
tomorrow is the shape to avoid.

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

The fee row is labelled plainly — "Registration fee" / `דמי הרשמה` /
`Регистрационный взнос`. ⚠ **It used to carry the scope in the label itself**
("Yearly registration fee" / `דמי הרשמה לשנה`), on the argument that annual-ness
is the one thing about the fee a family cannot infer from the number. That is
still true, and the label was still the wrong place to say it: three words among
two-word labels read as clutter rather than as information, and it said "yearly"
on every card whether or not anybody's yearly-ness was in question. The scope
now lands where the question is actually asked — the **waived** line on the
family's own cost card, which appears exactly when a returning child is *not*
being charged it again, which is the moment somebody asks why this term is 300
and not 350.

The scope itself is unchanged and is enforced in `feeApplies()`: the fee is
**per participant per activity per academic year**, so a sibling pays it again
and so does the same child in a second activity. The public card therefore
carries **no waiver logic at all** — whether
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
   lives in the `STATUS` table in that file. The button's **target is derived**,
   not stored — see below.

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

   ⚠ **`ctaUrl` is gone, and why is worth keeping.**

   **The registration button's target is built from the slug** —
   `/account/activity?register=<slug>` in the reader's own language tree — and there is
   no field to override it. There used to be: `ctaUrl`, per language, because
   registration did not exist and the button needed somewhere to point. Phase 6
   built the real target and the escape hatch stayed open behind it.

   **Every value that field ever carried on this site was a mistake.** First
   the button's own *label*, which shipped as `<a href="Register Now">` and
   404'd in three languages while still *reading* "Register interest" — it
   looked right and failed only on click. Then `https://www.ogen.cy/`, the site
   homepage, which sent parents away from the form they had come to find and
   sat live until somebody pressed the button.

   It was guarded, and the guard was the interesting part. `isLinkish()` was an
   allowlist — http(s), a site path, a fragment, `mailto:`, `tel:` — with
   `validate()` refusing a bad value on save, naming the language, and
   `js/activities-admin.js` mirroring the pattern client-side for immediate
   feedback. It did its job both times and **both bugs shipped anyway**,
   because an allowlist can tell a link from prose and **cannot tell a right
   URL from a wrong one**. The second value was a well-formed `https://` URL on
   this very domain. No amount of validating that field would have caught it.

   The field's own hint made it worse: it promised that empty "points at the
   contact form", true before Phase 6 and stale after, which makes empty sound
   like the broken option. That is plausibly why it got filled in at all.

   So the link is derived and the guard is structural instead: the href is a
   fixed prefix plus an `encodeURIComponent`'d slug, so no input can send it
   off this site or make it a `javascript:` URL — the property the allowlist
   existed for, now unable to fail. `migrate()` drops the key, so a record
   stops carrying it from its next save.

   If an activity ever genuinely registers somewhere else, the honest shape is
   a deliberate setting saying so, not a free-text box on every activity that
   is wrong by default.

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

### What a listing card answers at a glance

A card was a picture, a title and a blurb. That answers *what is this* and none
of the questions somebody standing in front of a grid is actually deciding on,
so every card had to be opened to find out whether it was even possible.

Four tags now, and they are the same four facts the activity page's own cards
lead with, in the order it already establishes — **is it for my child, what
language is it taught in, when does it meet, what does it cost**. The card is a
preview of that page rather than a second description of the activity, so it
answers in the page's order.

| Tag | Where it comes from |
|---|---|
| Ages | `formatAges` |
| Language of instruction | the code list; an optional free-text note is dropped |
| When | `scheduleFor`, **only when one line covers everybody** |
| Price | the `term` or `perSession` row — never the fee, never per-lesson |

**Everything is read through `sidebarRows()`, the same builder the page uses**,
so a card cannot start describing an activity differently from the page it
links to. That also filters members-only facts for free: the exact address is
off a card for the same reason it is off the page, as a property of the code
rather than a rule this function remembers.

**It added no copy.** All four labels were already in `LABELS` in three
languages, because the page's own fact rows use them — so a row of tags in
Hebrew, English and Russian cost one list of four keys.

⚠ **A SCHEDULE OF MORE THAN ONE LINE IS MORE THAN ONE GROUP, and the tag is
dropped.** `scheduleText()` renders "Beginners: Monday, 16:00" and "Advanced:
Wednesday, 16:00"; a card showing the first tells half its readers a day they do
not attend, in the one place on the site meant to be scanned rather than read. A
card that says nothing beats a card that is confidently wrong, and the page
under it prints every group's line. The other multi-line case is the opposite
and is truncated rather than dropped: a language list carries an optional note
on a second line, and the list alone is a complete answer.

**The price tag brings its own label**, which is why `priceRows()` gained a
`key` per row. Picking the headline figure by matching a label would mean
matching three translations of it and would break silently the next time one is
reworded; with a key, a drop-in's tag says "Cost per session" and a course's
says "Cost per semester" without the card knowing which it got.

**Stacked rows, not pills.** Each tag is a label *and* a value, and a pill
holding both is either too wide for a 320px card or drops the label — which is
what makes a bare "7-10" or "€300" ambiguous in the first place. Nothing is
pushed to an edge, so there is not one directional override and the row reads
correctly in all three languages: the same shape the price card was rebuilt into
after its label-at-one-edge version kept breaking in Hebrew. The label is
`--navy` (10.8:1 on paper) and **not `--camel`**, which is 2.3:1 — the warm
tokens are backgrounds chosen to sit under white text and fail as foregrounds.

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

⚠ **A `custom` schedule names its dates.** Its rows were a weekday and a time —
"Wednesday, 16:00" — which is the right shape for something that repeats and says
almost nothing about something that does not. An activity meeting on four
particular days could not name them, and three things followed: the card said
"Wednesday, 16:00" for meetings scattered across two months, no calendar could be
generated because `custom` was the one frequency with nothing to enumerate, and
**prorated cancellation had to be refused** because it divides by a session list
that did not exist. All three came back at once. `enumerate()` reads a custom
schedule rather than walking it — the admin has already written the answer down —
and it is deliberately **not** bounded by the term's start and end dates, because
filtering would drop a date somebody typed on purpose. `limit` still caps.

⚠ **The weekday is DERIVED from the date, never stored beside it.** A row saying
"Tuesday" and "14 October 2026" — a Wednesday — is two claims that can disagree,
with nothing to say which a reader should believe. `SHAPES.schedule` computes it
on every save and the form computes it in the browser, where the select shows the
answer and is **disabled** rather than hidden: the day a date landed on is
exactly what an admin is checking after typing it. The form and the server also
apply the **same filter** for what counts as a row (`day`, `time` or `date`) —
two filters that differ is one of them dropping a line on save with nothing
erroring. And `date` had to be added to `SHAPES.schedule` or it would have been
deleted on the next write, which is precisely what happened to `sessionDates`.

⚠ **Times are a text box, not `<input type="time">`.** A native time input renders
AM/PM or 24h from the **browser's locale** and there is no attribute that changes
it — so an admin in Cyprus, where 16:00 is how anybody writes an afternoon class,
was shown "04:00 PM". The stored value was always 24h `HH:MM`, so this was never
a data question; it was a display the page could not control. `1600`, `930`, `16`
and `9` all normalise on blur; anything genuinely unreadable is handed **back
unchanged** so the pattern marks it rather than the box silently eating it. What
is lost is the native picker, which on a desktop admin is worth less than four
digits typed.

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

⚠ **A TICK MEANS THE CLASS HAPPENS.** It meant the opposite: `cb.checked` was
`status === 'excluded'`, so the dates that were **not** happening were the ticked
ones. Each half was defensible — the label read "No class this date", and
`excluded` is genuinely the stored status — and the pair was not. A column of
dates is a list, a tick in a list means "this one counts", and it is what every
other checkbox in the admin means; an admin scanning a term saw the two holidays
lit up and the eleven teaching dates blank. Nothing downstream moved: `excluded`
is still what is stored.

⚠ **AND IT WAS WRITTEN TWICE, WORDED DIFFERENTLY.** The activity's editor said
"No class this date" and a group's said " not meeting"; one had a reason box and
the other dropped it on save. Both inverted. The two collapsed into one
`sessionCalendarBox()` **before** the bug was fixed, so it could only be fixed
once — and neither reads a checkbox back out of the DOM by id any more, which is
what put the meaning of a tick in a second place that had to agree with the
first.

⚠ **DELETING A DATE IS A DIFFERENT ACT FROM UNTICKING ONE**, and there was no
way to do it. Regeneration already **replaces** the list — `mergeExclusions()`
returns the newly enumerated dates and reads the old list only to carry
exclusions and their reasons forward — so a wrong frequency is usually fixed by
regenerating. Usually: switch to `custom` and regeneration refuses outright,
because a custom schedule is whatever was typed and there is nothing to
enumerate. The wrong dates then sat there with no way to shift them, and
unticking all eleven stored eleven exclusions describing a term that never
existed. There is a per-row **Delete** and a **Clear all N dates** that names its
count, because it cannot be undone.

**An excluded date keeps its place in the record** so it can be put back and so
it survives a regeneration, and its `reason` travels with it. None of that
reaches the page: the published table lists the sessions that are happening and
nothing else — no marked row, no "no class". That also makes the numbering free.
If nothing skipped is shown, nothing skipped can take a number, so session 3 is
the third row and the third meeting with no rule saying so, and the table is
**exactly** the list the credit arithmetic divides by.

The table is the full-width band at the foot of the page, `"sessions sessions"`
in the grid. **The row list tracks the areas in BOTH directions** — four areas,
four `grid-template-rows` values, or the 117px hole under the picture reopens
just as silently as before. The reverse bites too, and nearly did: when staff &
sponsors left the grid for the side column, a fifth track left behind would have
been inflated by the same spanning fact row. A test asserts the two counts are
equal rather than matching a fixed prefix, which is what caught it. No year in
the rows, because the date range is already on the page as the duration fact;
the exception is a term spanning two calendar
years, where a bare "6 January" is ambiguous.

### ⚠ A group is the unit

An activity **WAS** the thing that had an age range, a teacher, a room and a
timetable. "Named groups" were an opt-in list inside a fact called `groupSize`
that could differ only in size and, later, in when they met. Everything else was
one answer for everybody — so an activity running a Hebrew-speaking group with
Dorit on Thursdays and a Russian-speaking group with Anat on Sundays could not
say so. It published one age range, one language, one teacher list and one room
for two classes that shared none of them.

So the list came first. **`activity.groups[]` is not optional, not a sub-field
of a fact, and never empty.**

```
groups[] = { groupId, name{he,en,ru}, capacity, teacherIds[], facts{ … } }
```

**Seven facts moved onto the group** — `ages`, `schedule`, `duration`,
`instructionLanguage`, `prerequisites`, `location`, `address`. **Two stayed on
the activity**, because they are genuinely one answer whichever group a family
joins: `price` (with its bundles and late drop-in pricing) and what is left of
`groupSize`, which is the free-text override alone. So did the words, the
pictures, `type`, `seriesId`, the FAQ, the sponsors and the search metadata.

`GROUP_FACTS` and `ACTIVITY_FACTS` live in `_activity-groups.js` — the module
that requires nothing — and `_activity-facts.js` throws at require time unless
the two together are exactly `FACT_ORDER`. A fact in neither renders nowhere; a
fact in both is asked of two records that can disagree.

⚠ **ONE GROUP IS NOT A CHOICE.** The family is asked which group they want when,
and only when, there are **two or more**. With one, the group is assigned, its
name is not published and the page renders exactly as it did before any of this
existed. `submissionErrors()` asks the **count**, not whether anybody typed a
name — the old test ("does this activity name any groups") would now put a
one-option picker in front of every family on the site and refuse every
submission that did not answer it. A name is required on save once there are
two, because that is the thing a family picks by.

⚠ **AND A FULL CLASS WOULD HAVE REPORTED AS EMPTY.** Every registration taken
while an activity was pooled carries `groupId: null`. The moment `migrate()`
gives that activity its one group, bucketing strictly by id files all of them
under "unassigned" and shows the group row at nought taken — with nothing
erroring, and nobody finding out until somebody arrived to a room with no chair.
With exactly one group there is one honest answer, so they count into it;
`hasRoom()` answers from the single row for the same reason. With two or more
there is no such answer, so they stay unassigned exactly as before, and the rows
deliberately do not sum to the total.

### ⚠ Equal total instructional hours

Groups may meet a **different number of times for a different length** — six
two-hour meetings and twelve one-hour ones are both twelve hours — and may not
differ in **how much of it there is**. There is one `fullPrice` and it buys the
same teaching whichever group a family picks. `validateGroups()` refuses a save
naming both groups and both totals, in hours rather than minutes because 720 and
540 are harder to compare at a glance than 12 and 9.

This **replaces** the older rule that every group met the same *number* of
times, which was strictly stronger and refused a shape Ogen actually runs.

Four things follow from it:

- **`sessionMinutes` is per group**, or the rule is not expressible.
- **`durationFor(activity, groupId)` takes the group**, and throws on a
  forgotten argument once there are two — the same discipline `calendarFor()`
  has always had, for the same reason: a plausible wrong calendar is the shape
  of bug that surfaces as two families comparing receipts.
- **The "(N sessions × M lessons)" qualifier is suppressed when the groups
  differ.** `pricingDuration()` sets `qualify: false`. The figure above it
  survives, because the equal-hours rule means every group was sold the same
  teaching; the sentence does not, because it describes one group's term and
  there is no single true version of it.
- **Both cutoff dates resolve per group at registration**, onto the frozen
  block, from the calendar that family was actually sold —
  `REG.resolveCutoffs(activity, groupId)`, called by `freezeCancellation()`. A
  stored date always wins, including `"none"`, which is a value meaning switched
  off. `defaultIfBlank()` still writes an activity-level default, but **only
  when every group resolves to the same answer**: storing one group's would
  quietly govern the other group's families.

The age range and the start date are per group too, so `flagFor()`,
`ageCheckMoment()` and `feeYearOf()` all take a `groupId`, and
`newRegistration()` resolves it **once**, at the top, before anything is frozen
against it.

### The public page: an aggregate for the scanner, a breakdown for the chooser

**Per fact, not per activity.** Ages might differ while language does not, so
each row asks its own question. When the groups **agree** — every published page
today, and every activity with one group — the answer is that value, rendered
exactly as it was before groups existed. Nothing about the model change reaches
a page until an admin makes two groups actually differ.

When they differ, three facts have a true short answer and the rest do not:

| Fact | Aggregate |
|---|---|
| Ages | the **union range**, `6-13` — and only when *every* group states that bound, since one group with no upper limit makes the activity's unknown |
| Location | the **distinct cities, joined** — `Limassol, Nicosia` |
| Language of instruction | **every language anybody is taught in**, in written order |

Everything else falls through to a line per group, named. There is no union
worth printing for a schedule, a date range or a level: "January to June and
February to May" is not a date range, and "Beginners and Advanced" is not a
level.

⚠ **The distinct cities are computed on the PICKED text**, not on the stored
bag. `pick()` falls back across languages, so two groups sharing a Hebrew city
name and differing in English would otherwise report one city on one page and
two on another, about the same activity on the same day.

**And the union says less than it looks like it says.** "6-13" across a 6-9
group and a 10-13 one means a nine-year-old has somewhere to go, not that they
may join either. That is what the groups section under it is for.

`groupChoice()` is the **one builder both surfaces read** — the page's groups
section and the listing card's leading tag. A card cannot advertise a choice the
page does not offer, or a different number of them. It returns `null` with one
group, so there is nothing to draw.

The section lists **only what the groups disagree on**: repeating the agreed
facts under every name makes two identical lists and buries the one line a
reader is there to compare. It says `Choose your group when you register` out
loud rather than leaving it to be inferred from a heading, and it sits in the
**article** rather than in a new grid area — the areas and the row list have to
move together or the 117px hole under the picture reopens, and this is prose a
reader works through rather than a fact they scan. On a phone that puts it after
About and before the price, which is the order the question is asked in.

On the listing card, `groups` **leads** the tags: "Ages 6-13" on an activity
with two groups is a union, and read without knowing there is a choice it says a
nine-year-old may join either one.

### Teachers by reference, not by copy

The roster stays at the record root and a group holds **`teacherIds[]`**. An
**empty list means the whole roster**, which is what every migrated group gets
and what "this group is taught by whoever teaches this activity" is spelled as.

The reason is the image pipeline: an uploaded photo is
`<slug>-teachers-<id>-<hash8>.png`, and `imagePathsOf()`, `retiredImages` and the
stale-image cleanup all key off that one list. Nesting the list inside each group
multiplies every one of them, and a teacher taking both groups would upload their
face twice and get two files under two names. An id pointing at a teacher since
removed is filtered on read rather than rendering a blank credit.

Writing the roster out on migration was rejected for the same reason the empty
list means "all": it would freeze the list, so a teacher added next month would
appear in the credits and in no group.

### The admin: a group is one screen

The **Activity facts** panel draws the **group list**, then the two facts that
are the activity's, then **who can see what**. Every row opens that group's own
sub-page, which holds everything about it — name, places, teachers, the seven
facts, the timetable and the calendar.

⚠ **THE FIRST ROW IS A REAL GROUP NOW.** It was "Everyone", a visible row
standing for the activity's own timetable that any unnamed group followed. That
implicit default is gone: a group is a group from the start, renamable, and what
decides whether a family is *asked* is the count. The argument the old row
existed for — that auto-creating "Group 1" would put a one-option picker on the
registration form and switch capacity to the sum of the named capacities — was
answered by making the count the rule rather than by keeping a row that had to
be explained.

⚠ **ONE EDITOR PER FACT KIND, KEYED BY A PREFIX.** `factEditor(d, fact, p)` and
`readFactEditor(d, p, previous)` are one pair, drawn under `'fact'` on the main
form and `'grp'` on a group's page. Two copies of a fact editor is two places a
checkbox can come to mean opposite things, which is exactly how the calendar's
tick did.

⚠ **THE MEMBERS-ONLY TOGGLES ARE IN ONE BLOCK, on the main panel.** Whether a
fact is published is one policy for the whole activity — the exact address being
private is not a per-group decision — and the fields it governs are edited once
per group. Beside the field it would be the same setting on two groups' pages,
where changing one silently changes both: the same shape that gave this codebase
a checkbox meaning opposite things in two editors a release apart.

**Copy comes in two sizes.** *Duplicate* on the list takes a whole group as a
starting point — two groups of one activity usually differ in one or two things
and agree about the rest, so starting from a copy and editing down is fewer
fields, and fewer fields is fewer forgotten. ⚠ It mints a **fresh groupId**;
reusing one would attach the original's registrations to a group nobody
registered for. The name gains a `(copy)` suffix rather than being blanked,
because an unnamed second group is refused on save and a silent blank would read
as the copy having failed. It is a **deep** copy, or two groups would share one
calendar object and excluding a date for one would take it off the other.

*Copy from another group* on the sub-page takes one **section** — the teachers,
the schedule, the ages — out of a group of this activity or of another. ⚠ **The
dates never cross an activity.** A schedule is a pattern ("Wednesdays at 16:00")
and copies anywhere; a calendar is absolute dates, and last year's term copied
into this one is a page of dates nobody meets on, quietly and plausibly.
Cross-activity copy offers the pattern, refuses the calendar, and says to
regenerate. It reads the source through the ordinary `load` action, so there is
nothing new on the server for it.

⚠ **NOTHING ABOUT A GROUP IS READ BACK OFF THE MAIN FORM.** Not a name, a
capacity, a teacher list, a fact, a schedule or a calendar — none of it has an
input there, and the sub-page is hidden rather than detached. A save that walked
the DOM would find nothing and clear all of it. The model is the record:
`primeGroups()` loads `S.groups` **before the first panel draws** — it has to,
because the panel draws the group list and the price preview inside it reads a
group's session length — and `readForm()` sends `S.groups`. That is the
undrawn-field trap this project keeps meeting, and the answer is the same every
time.

It is a **view swap** rather than a second HTML page: the record is already
loaded and dirty-tracked, the save path and the optimistic lock are one, and a
real second page would have to re-implement all three to edit a slice of the
same record. The back button is also the commit and says so, and a sub-page left
open is committed on save, so what is on screen is what is stored.

A frequency that names a session count pads and trims to it for every group. The
activity's old editor did and a group's did not, so a group could be set to
"twice weekly" and given one day, which enumerates half a term with nothing
erroring.

### Translation reaches a group's name

`LANG_SUBKEYS` merges a scalar sub-key of a **fact**. A group's name lives at
`groups[i].name` — per **item** — which it cannot reach, and that gap was
written down in a test for a release: a role permitted to edit only Russian
could not translate "Advanced".

`mergeGroups()` is that per-item merge. Matched by **groupId, never by
position**, so reordering the list cannot hand one group's capacity to another.
With full access the membership and the order come from the request; a
restricted role keeps the stored list exactly and may change only the words in
it — the name, and the word half of each group's facts — which is the same rule
`LIST_KEYS` already applies to teachers and sponsors.

### The migration, and the trap in it

`migrate()` builds `groups` when a record has none and leaves it alone when it
has some, so a second pass finds what the first wrote — the same shape
`activityId` already had, and the reason it is safe to run on every read.

| Record | Becomes |
|---|---|
| a **pooled** activity | exactly **one** group, name blank, capacity `groups × maxPerGroup` |
| an activity with **named groups** | one group per entry, **ids preserved**, each seeded with the activity's shared facts |

⚠ **hebrew4kids is `2 × 10` and becomes one group of TWENTY**, not ten. Folding
a pooled activity into "its one group" with the wrong half of that product would
halve a class with nothing erroring. `beit-midrash` turned out to have two named
groups as well, not one, and keeps both at 20 and 30.

Seeding is deliberately a **copy rather than a guess**: two groups that differ in
language and teacher still shared an age range and a room, and an admin adjusts
from something true rather than from blank fields.

⚠ **AND THE IDEMPOTENCE TRAP IS WORTH KEEPING.** `normaliseVisibility()` decided
"this record predates the exact address field" from `facts.address` — which the
migration itself removes. A second pass would have read that as a pre-changeover
record, reset every members-only flag to `public`, and published an address on
the next save. It asks both places now: the activity's facts *and* the groups'.

A record created today has no facts to derive a group from, so the id has to be
minted — which a pure function cannot do. It is minted in `mergeByPermission()`
rather than in `stamp()`, because **preview does not stamp**: in `stamp()` a new
activity would preview as a validation failure and publish fine, which is the
one asymmetry `preview-matches-publish` exists to forbid.

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
that list**, never a stored count: hebrew4kids carried a typed session count
disagreeing with its own calendar from before any of this was built until the
calendar was regenerated, and this is the one place that disagreement would have
decided money. The record agrees with itself today — eleven sessions ending on
23 December — which is the reason to keep the rule structural rather than a
thing somebody remembers to check: the disagreement was invisible for months,
and nothing stops the next one appearing the same way.

The hard cutoff governs **entitlement, not the ability to end a registration**.
It refuses the guardian's own cancel button (`reason: 'cancellation-closed'`,
carrying the date so a 409 can name it); an admin cancelling in week nine for a
safety reason still goes through and credits nothing. `creditFor()` therefore
says nothing at all about admin cancellation.

## Legal pages, and the two gates on them

`/privacy` and `/terms` exist in all three languages, carry real reviewed text,
are `final`, indexable, in `sitemap.xml`, and linked from the footer.

**English is the binding version.** A governing-language clause sits at the top
of all six pages, in each page's own language: the document is provided in
Hebrew, English and Russian, the English version is legally binding, the others
are courtesy translations, and English prevails on any discrepancy.

It is **at the top, not as a closing clause**, and that placement is the point —
a reader who only reads Russian has to learn they are holding a courtesy
translation *before* they read it. Put at the end it would be the last thing
reached by exactly the reader it is addressed to. It is **not a numbered
section**, because adding one would renumber every section below it in three
languages, and this is a notice about the document rather than a term inside it.

Three machine-readable markers, and they gate different things:

```html
<meta name="ogen-legal-status"  content="final">     <!-- may registration be BUILT?   -->
<meta name="ogen-legal-review"  content="complete">  <!-- has THIS text been read?     -->
<meta name="ogen-legal-binding" content="en">        <!-- which version GOVERNS?       -->
```

`ogen-legal-review` is **per page** and has three states:

| | |
|---|---|
| `complete` | Hebrew and English. Somebody fluent has read this text. |
| `courtesy` | Russian. Offered for convenience; nobody fluent has read it. |
| `pending` | the original state, before any review |

**Russian is `courtesy`, not `complete`, and that was the whole decision.**
Flattening it would have made the marker a lie in order to get a gate to pass,
and the marker is the only machine-readable thing standing between this system
and a family agreeing to terms nobody checked. A third state costs one word and
keeps the truth writable.

### What the second gate asks now

`tests/registration-waits-for-real-legal-pages.js` used to ask *"has every
language been reviewed"*, because every language was equally binding — a
Russian-speaking parent agreeing to unreviewed Russian was agreeing to those
Russian words. The clause changed what is true, so the gate changed what it asks:

1. **Is the binding version reviewed?** Whichever language `ogen-legal-binding`
   names must be `complete` on both its pages. If the version that governs has
   not been read, nothing else matters.
2. **Does every page carry the clause?** Checked on **all six**, the binding
   language included — a Hebrew reader has to be told which version governs just
   as much as a Russian one. And a `courtesy` page is only honest while it says
   it is a courtesy translation: remove the clause and that page silently becomes
   unreviewed text a family agrees to with no notice at all, which is the exact
   thing this gate exists to stop.

The clause is matched by a `data-governing-language` attribute rather than by its
prose — matching the words would mean matching them in three languages and would
break on any rewording, and the clause is meant to be rewordable. The attribute
and the meta tag must name the same language; two machine-readable statements of
one fact are two statements that can disagree.

Both failure modes are verified to bite: removing the clause from one page fails,
and marking the binding version `courtesy` fails.

### ⚠ What the clause does not do

It closes a **legal** gap, not a quality one, and it does not reach everything:

- **GDPR Article 12(1)** requires privacy information to be "concise,
  transparent, intelligible and easily accessible, using clear and plain
  language", addressed to the data subject. That is a transparency duty owed to
  the reader, and a governing-language clause does not discharge it — a Russian-
  speaking parent who can only read the Russian notice is the person Article 12
  is about. It bears on the **Privacy Policy** much more than on the Terms.
- **EU unfair-terms law** (Directive 93/13/EEC, as implemented in Cyprus) makes a
  non-negotiated consumer term that is not in plain intelligible language liable
  to be unenforceable *against the consumer*. A clause saying "the English
  governs" is itself a term, and a court asked about it will look at whether the
  consumer could understand what they agreed to.

So the clause makes the Russian **honest rather than hidden**, which is a real
improvement and is why it no longer blocks public registration. It does not make
the Russian **good**. The native-speaker review is now a quality and trust item
rather than a blocker, and it is still worth doing — the Russian text, the two
price labels (`Годовой регистрационный взнос`, `Стоимость семестра`), and the
account, invite and registration emails. **The emails are not covered by the
clause at all**: nobody agrees to an email, so a governing-language notice buys
nothing there — they are simply the product, in a language nobody has checked.

`ogen-legal-status` is the older, coarser marker: may registration be *built*. It
has said `final` since the text landed. The gate existed because the placeholder
looked finished — proper URL, breadcrumb, site typography, real headings — and
the reason the pages were created early is exactly the reason nobody would have
noticed they were still empty. Ogen has never stored a person's name; the
registration system stores a **minor's name and date of birth, in the EU**.

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
  _family-errors.js      every refusal a family can be shown, in three
                         languages; no store, no clock; PURE
  _activity-autocomplete.js  when a closed activity has finished, and nothing
                         else; no store, no clock, no GitHub; PURE
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
as JPEG, teacher/sponsor images to **240px** (see below), card images cropped to
a centred square at 800px, share images cropped to 1200×630, transparency
keeping them PNG, to match what the site already does by hand (`og-image.jpg`
is 1200×630 at 72KB; `images/partners/*` are 19–51KB). Measured: an 865KB hero
became 26KB, a 1.77MB logo 134KB.

**The credit profile was 600px for a 40px circle**, and the comment beside it
admitted as much — "far more than they need" — justified by keeping the file
sizes near the partner logos'. That optimises for a coincidence rather than for
anything a reader sees, and it cost 57KB and 36KB on two teacher photos nobody
can see the pixels of. It is **240** now.

240 rather than the 160 a 40px circle strictly needs, and **the asymmetry is
the whole argument**: too many pixels costs bytes, too few cannot be recovered
without asking somebody to find the original and upload it again. 240 covers a
6× render, survives the credit block being redesigned larger, and lands near
15KB. The test pins a range with that reasoning rather than a digit. Note a
profile change reaches only the **next** upload — existing images keep their
bytes until someone replaces them.

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

⚠ **And it happened again, at the CDN rather than in a browser.** Two teacher
photos published in the same commit as the HTML referencing them answered
**404 on the live site while both files sat in the tree** — `cf-cache-status:
HIT`, `age: 211`, a cache-busting query string returning 200, and the Netlify
origin serving all 58435 bytes. Cloudflare caches by file extension, so `.jpg`
is exactly what it *does* keep, and it had asked during the seconds between the
HTML reaching an edge and the image doing so.

The 300 was this rule working: it is what made a permanent broken image into a
five-minute one. But five minutes is still visible, and visible to precisely the
wrong person — **whoever just pressed Publish and opened the page**, who is the
first request for every new URL and therefore the one who fills the edge cache
with whatever the origin happens to say at that instant. It went to **60**.

⚠ **And sixty was still visible, so it is ZERO now.** Reported a second time from
the other side of the same window: a newly published activity showed a broken
image on the listing while the file itself answered 200 to `curl`. Sixty seconds
of somebody else's 404, held by the browser that asked first.

There was nothing left to trade away. These names carry a **content hash**, so a
URL's bytes never change — caching them buys one saved round trip and nothing
else, and `max-age=0, must-revalidate` still answers **304** in a few hundred
bytes for every unchanged file. What it stops buying is the ability to hold a
404. Netlify applying path headers to error responses is what made this class of
bug possible, and is now what fixes it: the transient 404 carries `max-age=0`
too, so the next request re-asks and gets the picture.

The complete fix is still purging Cloudflare on deploy; that needs an API token
and a deploy webhook, lives outside this repository, and does not exist yet.

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

### ⚠ And the HTML was not cached anywhere at all

Every path in `netlify.toml` had a `Cache-Control` except the one most people
request. With none set, Netlify's default applied — `max-age=0,
must-revalidate` — and **Cloudflare will not keep a copy of a response like
that**. Measured against `www.ogen.cy`, every page answered `cf-cache-status:
DYNAMIC`: a full origin round trip on *every* view, 0.76-4.96s on an activity
page and 6.21s on the homepage, while `/shared.css` sat beside them at 0.33s and
`REVALIDATED`, because the edge was allowed to keep that.

The fix is **`s-maxage=60`**, which speaks only to a shared cache. `max-age`
stays 0, so a returning browser still revalidates and still sees a publish
immediately; what changes is that a shared cache may serve repeat traffic
itself instead of forwarding all of it to origin.

⚠ **And the shared cache that honours it is Netlify's, not Cloudflare's.** This
was added expecting Cloudflare to start keeping the HTML, and measured after
deploying, it does not: every page still answers `cf-cache-status: DYNAMIC`.
Cloudflare caches by file **extension** by default and HTML is not in that set
— no `Cache-Control` value changes that on its own, only a Cache Rule in the
dashboard. What did change is **Netlify's own CDN**, which was revalidating to
origin on every request and now serves a minute of repeat traffic itself.

The numbers say the header earns its place regardless: the homepage went 6.21s
→ ~0.30s and an activity page 0.76-4.96s → ~0.29s. Closing the last hop would
mean a Cloudflare Cache Rule, worth perhaps 0.25s more (`/shared.css` is a
`HIT` at 0.04s) — and it is **not recommended**: it is a dashboard setting
outside this repository, the same class of thing as Browser Cache TTL, which
this file already records silently rewriting every header on the site. Trading
a quarter of a second for another invisible control plane is the wrong way
round.

**Sixty seconds, and the number is the interesting part.** It is the window in
which a stale page can be served after a publish — and a Netlify deploy already
takes about a minute to go live, so at 60s the edge adds nothing a publisher can
perceive. Raise it without purging Cloudflare on deploy and an admin reloads a
page that has already changed, concludes the publish failed, and publishes
again. That exact confusion is why `/admin/*` is `no-cache`, and a test pins the
ceiling as well as the floor.

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
laptop dies within a week. **Admin sessions run 4 hours idle with a 12-hour
absolute cap** — see below. The two sets of numbers must not be unified.

### ⚠ The admin session limit was a browser detail wearing a policy's costume

`js/admin-session.js` kept the token in `sessionStorage`, under a comment saying
publish rights "should not outlive the tab". That read as a security decision and
was not one.

`sessionStorage` is scoped to a **browsing context**. It survives reloads and
same-tab navigation; it is **not** affected by switching tabs; it dies when the
tab closes; and it is **not shared between tabs**. So the rule being enforced was
*"how long is this tab open"*, which is unrelated to how long a session should
last — and it was wrong in both directions at once. An admin who closed a tab was
signed out while an 8-hour session sat live on the server. An admin who left one
open for a week was never signed out at all. Opening the admin in a second tab
meant signing in again.

The limit moved to the only place that can enforce one, and became two limits
because they answer different questions:

| | | |
|---|---|---|
| **Idle** | 4 hours | how long a session survives being unused, and it **slides** while in use |
| **Absolute** | 12 hours | from sign-in, whatever the activity |

The cap is what the idle window cannot give: a session touched every three hours
never idles out, and publish rights must not be indefinite. Twelve hours means an
admin signs in about once a day and a session left running overnight is dead by
morning. Four hours covers a lunch, a morning of meetings, an afternoon away.

Two ordering rules in `getSession()` carry weight:

- **The slide happens after every refusal check.** A session that was going to be
  rejected must not have its clock moved forward on the way out — the record left
  behind would quietly claim it was alive.
- **The slide is skipped for five minutes.** An admin clicking around must not
  rewrite a blob to move a timestamp on every request. Same rule the member
  session follows, at a shorter interval because the window is shorter.

A record written before this existed has no `createdAt`, so the cap is measured
from now rather than expiring it retroactively; it is gone within a day either
way.

**One property is genuinely weaker, and it is worth naming.** On a shared machine
the token now survives closing the browser. The idle window is the compensating
control, and so is **cross-tab sign-out**: `localStorage` is shared between tabs,
so signing out in one now ends the others through a `storage` listener.
Otherwise a second tab left open would keep working against a token the person
believed they had revoked, and "I signed out" would be false in a way nothing on
screen showed.

**The admin/guardian boundary is untouched.** It was never client storage — it is
two Blobs stores with two key prefixes (`sess-` / `msess-`), and neither
`authenticate()` can find the other's token. The two clients use different
`localStorage` keys on the same origin, and neither reads the other's; a token
pasted across would still be refused server-side, which is what the cross-feed
test proves. `tests/an-admin-session-outlives-the-tab.js` asserts the admin's
idle window **and its cap** are both shorter than a guardian's ordinary window,
so the numbers cannot be quietly unified.

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

⚠ **But the PASSWORD is checked before the token is spent, and that ordering is
the fix for a real lockout.** `resetPassword` consumed the one-time token first
and validated second, on the argument that a token surviving a failed attempt
was the more dangerous shape. It is not: whoever holds a reset link already has
everything the link grants, so a second try costs nothing — and a password under
the minimum is not an attack, it is the form failing to say what the minimum was.

What the old order cost was a family's only way back in. QA typed a short
password; the link was spent; the refusal said to request a new one; and the two
tabs already open answered *“that link has expired or has already been used”* —
the sentence for a link **somebody else** has used. Reported as three tabs, three
dead links, and no password accepted.

The message moved with the code, and the two have to: `reset-password-short` used
to end “ask for a new reset link”, which is now wrong advice. It says the link
still works.

⚠ **AND NOTHING ANYWHERE SAID THE MINIMUM WAS EIGHT.** Five password inputs in
the family area and not one `minlength` between them, so the rule existed only as
a refusal — the shape that guarantees somebody breaks it, and on the reset screen
breaking it also cost the link. `field()` takes a hint now, wired with
`aria-describedby` rather than as a second label, and the three fields that take
a **new** password carry it. Sign-in deliberately does not: that box wants the
password you already have, and a rule printed under it reads as a demand to
change it. `MIN_PASSWORD` is written twice — a browser cannot `require` a Netlify
function — so a test pins the two against each other, the same way the activities
menu's duplicated status groups are pinned.

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
  _registration-sweep.js  run() the nightly pass (both halves, schedule only);
                          runRegistrations() the admin's narrower "run now"
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

Capacity is the **sum of the groups' capacities** and no new field, with **null
meaning uncapped, deliberately not zero** — a blank must never read as a
restriction, and one group with no capacity makes the whole activity uncapped,
because a sum missing one of its terms is not a sum. The groups bucket the same
count with no extra read.

⚠ A place taken while the activity was still pooled carries `groupId: null`.
With **one** group that is not ambiguous and it counts into it — see **A group is
the unit** for why reading it any other way makes a full class report as empty.
With two or more it belongs to no row and says so, and the rows deliberately do
not sum to the total.

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
in `netlify.toml`, 06:00 UTC daily. It has **three jobs now** — releasing
registrations nobody answered, completing activities that have finished (see
**The three groups**), and keeping every bundle's promise against a calendar that
moved (see **Bundles**) — sharing a schedule rather than a subject: each writes
down something that has already become true, and none is load-bearing. The third
is the one exception worth naming: when an activity is genuinely over and a
bundle could not be honoured in full it writes a **credit**, so that half follows
the money rule rather than the cosmetic one. It rewrites lapsed `pending` to `expired`,
stamps the reason, and mails the family. Two things about Netlify's scheduler
that look like bugs: it invokes the function as a **POST carrying
`{"next_run":…}`**, so a handler treating a request body as proof of a human has
it backwards; and the edge answers **403 to every external HTTP request** to a
scheduled function, which is why the admin's "run now" calls `run()` directly
rather than fetching the endpoint. Running it twice finds nothing the second
time — it only ever rewrites what the derived rule already released.

**The expiry email apologises.** The thing that expired is a request *we* did not
answer, so "your request expired" — which reads as the family having let
something lapse — is the wrong sentence. Five messages in
`_registration-email.js`, and only the confirmation is resendable: a family
legitimately loses "you have a place", whereas re-delivering a refusal a
fortnight later is the clearest case in that table of a resend doing harm.

**⚠ AND NOTHING ELSE IN THAT TABLE SAYS "REQUEST" ANY MORE.** The submission
message opened with "your request has arrived" and promised an answer within
`expiryDays`; the family area's submit button said "send the request", its
confirmation said one had been sent, and a `pending` registration showed the
family the words "waiting for an answer". All of that describes **the shape of
our queue, not the shape of what the family did** — they signed a child up, and
being told a decision is pending reads as a decision that might go either way
over something they consider settled. If we cannot take the place we write and
say so, and that message already exists.

So the button is `הרשמה` / Register / `Записаться`, the confirmation and the
email both say the child is registered and point at the page the payment is on,
and **`pending` and `approved` both read "registered" to a family**. `pending`
survives in the admin queue, which is the only place that word belongs.

⚠ **THE DIFFERENCE IS STILL A PAY BUTTON, AND THE ROUND TRIP IS WORTH KEEPING.**
For one release `pending` was payable. The bug that prompted it was real: the
cost card read **Still to pay €500.00** with no button under it and the sentence
*"we will send you a payment link shortly"* in its place — a bill with the means
to settle it withheld, naming a link that on a manually-approved activity exists
only once an admin reaches the queue.

**The fix for a bill with no button was never to make it payable.** `pending`
arises *only* when a person has something to decide — `autoApprove` is off, or an
age could not be confirmed — so there is no such thing as a pending registration
nobody needs to look at, and "pending is payable" means *pay for a place we have
not agreed to give you* in **every** case rather than in an edge one. The tell
was what had to be built beside it: `paidRefusal()`, a guard stopping an admin
rejecting a family who had already paid. Needing machinery to contain a
consequence usually means the change created the problem.

`isPayable()` in `_checkout.js` is `['approved']`, read by the signed-in `pay`
action **and** by the emailed `/pay` link, so the two doors cannot disagree about
what is chargeable. `paidRefusal()` **stays** — approved → paid → an admin
rejects is still reachable and is exactly the case it was written for.

**What a pending family sees is the waiting block**, `waitLead` / `waitBody` on
the cost card. It is the branch that was missing, not a line of copy that was
wrong: one grey sentence under a figure says as much about a screen that is
working as about one that is broken. It leads with **what is true** — `Registered
— payment opens soon` / `ההרשמה בוצעה — התשלום ייפתח בקרוב` / `Запись оформлена —
оплата откроется скоро` — and then explains: the participant is registered, we
are confirming the last few details, payment will open here, we will email. The
participant's name is in it and the activity's is not, because the page is
already headed with the activity.

The wording is **lifted from `_registration-email.js` rather than invented** —
`נרשם/ה` and `записан(а)` are that module's gender-neutral forms and
`ההרשמה בוצעה` / `Запись оформлена` its headings — so the inbox and the screen
cannot drift. None of it says *pending*, *awaiting*, *approval* or *request*; a
test asserts all four are absent from the rendered screen.

**The treatment had to not look pressable.** It sits where the pay button would
be, and this codebase already learned that **a solid fill plus a full pill means
press me** — so it is a tinted ground, an 8px radius and dark text, borrowing
`.acc-notice`'s leading-rule idiom so it reads as family rather than as a new
invention. **Olive, not gold**: gold is the advisory colour the admin queue uses
for the age flag and reads as *look at this*, where olive is this site's
*nothing is wrong* — the same reason the nav chip's signed-in initial is olive
rather than terracotta. Computed rather than eyeballed: olive on the 10% tint is
5.45:1 and ink on it 9.45:1.

The glyph is a **check, not a clock**, and that is the whole job of it — the
block exists to say *nothing is wrong* at a glance, and a clock says *wait*,
which is the reading it exists to prevent. What is done is the registration; the
payment opening is the follow-on, and the sentence carries that. It is 15px and
inline rather than white in a 56px disc, because rule 6's shape is for section
markers and a 56px circle beside one line is larger than the thing it labels —
the same argument that took the fact-group icons to 34px. A test pins the path
data, not the name of the constant holding it.

⚠ **It is built with `createElementNS`.** An `<svg>` made with `createElement` is
an `HTMLUnknownElement` and draws nothing. `js/nav.js` and `js/motifs.js` set
`innerHTML` instead; this file has never used it, which is the reason
`tests/_dom.js` can execute it at all, and adding an HTML parser to that shim to
draw one tick would be the wrong trade. The shim gained the one namespaced
factory and nothing else.

⚠ **And a separate contrast bug was fixed in the same pass.**
`.acc-pill.is-pending` painted white on `--gold`, which is **3.18:1** — below AA
for 12.5px bold text. The token is a *background* chosen to sit under white at
display sizes, and a pill is neither. It is `#96651F` now, darkened along the
same hue so the gold reading survives, at 5.03:1. Its sibling `.is-approved` is
white on olive at 6.53:1 and needed nothing.

⚠ **There was no `pending` fixture anywhere in the tests**, which is why the
screen a family sees while an admin has not answered yet had never once been
drawn by anything. Every row in `the-three-family-screens-render.js` was approved
or over. There is one now, and the branch is executed rather than read.

**That moved `DEFAULT_EXPIRY_DAYS` from 14 to 45**, because the number and the
sentence were one thing. The confirmation used to promise an answer within the
same fortnight the sweep then acted on; a family now told they are *registered*
and released a fortnight later is met by a message contradicting the one that
created it.

**Off was the wrong answer, and why is worth keeping.** Capacity is counted from
`holdsASpot()`, so a pending registration that never expires holds a place on a
capped activity **forever** and the family is never told anything at all —
limbo with no message beats no limbo, but it loses to an apology, and the expiry
is also the only thing that frees that place. So the pressure moved rather than
disappearing: long enough that answering a queue beats it in any ordinary week,
short enough that a place is not held for a term by a request somebody forgot.
An activity that genuinely fills in a week still sets its own shorter value.

Changing it is **not retroactive** — `expiresAt` is stamped at submission, so
every registration already taken keeps the deadline it was given. The expiry
message stopped saying "request" too, and that word costs more there than
anywhere else: it is the one message that takes something away, so implying the
family had been waiting on an answer all along would be a second, quieter
falsehood on top of the first.

**Three of the five now link to the family's own registration page** rather than
the public activity page: registered, approved and the receipt are each partly
about paying, and that page is the only one showing what is owed. The two about
*not* having a place still point at the activity, which needs nothing signed in.
The approval subject says CONFIRMED in all three languages, because a manually
approved registration sends both messages days apart and the Russian pair was
word-for-word identical for a moment.

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

## Pay-per-session (Phase 7)

A drop-in is not a course with a different price. It is the same activity record
with `type: "dropin"`, and **exactly five places are allowed to notice**:
`priceRows()`, `creditFor()`, the capacity count, `validate()` and
`FIELD_SCHEMA`. The page, the listing, the sitemap, the image pipeline, the
publish path, the optimistic locking, `_roles.js` and the session table never
ask — which is the concrete form of the argument against a second content type:
the surface a second type would have duplicated is the surface that turns out not
to care.

```
netlify/functions/
  _session-attendance.js   ogen-session-attendance; att-<pid>__<aid>__<YYYY-MM-DD>
```
plus `creditForSession()` / `freezeSession()` in `_credit.js`, `capacityForDate()`
in `_registration.js`, and three actions on each registration handler.

### ⚠ `creditFor()` would have answered, and answered wrong

This is the one that mattered. A drop-in has no cancellation policy, so the
frozen block carries mode `flat` with **both cutoffs null** — and every null in
`_credit.js` resolves towards the family. Run a drop-in cancellation through the
course path and the joining fee comes back at 100% and the "course" at 50%, on an
activity with no course to prorate. Nobody would have seen a wrong number; they
would have seen a **plausible** one, on a real receipt.

So `creditFor()` refuses at the top, on `frozen.type === 'dropin'`, returning
`total: 0` with `reason: 'per-session'` — a zero that says why rather than one
that fell out of the arithmetic. That makes "creditFor() is not called for a
drop-in" a property of the code rather than a rule every call site remembers.
`frozen.type` is captured at submission for the same reason the price is: an
admin switching the type in March must not change what a January family is owed.

**Cancelling a drop-in registration credits nothing** and instead releases the
evenings that have not happened yet, each judged on its own deadline. There was
no upfront commitment to unwind — a family that stops coming has cancelled
nothing and simply owes nothing further.

### One blob per evening

`att-<participantId>__<activityId>__<YYYY-MM-DD>`, holding status, the frozen
start time and window, and the same `owedCents`/`paidCents`/`creditedCents`
vocabulary the registration uses — so the ledger, the reminders and the admin
views work against one shape rather than learning a second.

Hanging session charges off the registration is the obvious move and is wrong for
a reason this design has met twice: it makes the registration a **hot blob**
rewritten every week on a store with no compare-and-swap, so two writes on one
evening lose one silently. Separate keys make that impossible rather than
unlikely — the same argument that made a registration one-per-participant rather
than an `attendees[]` array, and capacity counted rather than decremented.

The date is **in the key** rather than an id, because a session is identified by
when it happened, and it makes the register for one evening readable from a
`list()` without opening a blob.

### Capacity is a room on one evening

"The room holds twenty on Tuesday, not twenty forever." `capacityForDate()` sits
beside `capacityReport()` in `_registration.js` so the two counting rules cannot
drift about what a place means. Same `facts.groupSize` figure, counted against a
different list. `booked` and `attended` occupy a place; `cancelled` and
**`no-show` do not** — the question is "is there room", and somebody who did not
come is not in the room. Whether they still owe for it is a different question,
answered by the payment on their own record.

⚠ **A drop-in registration is not capped by the size of the room**, and it was.
For a course the two are one question — a place is held for the whole term. For a
drop-in they are not: forty families can be registered and eight turn up.
Counting registrations against the room refused the twenty-first family from ever
registering, on an activity that was never more than half full on the night, and
the refusal read *"this activity is full"* — untrue of every actual evening.

### Cancelling one evening is all or nothing

`registration.sessionCancelHours`, a single number, no modes and no proration —
one evening has nothing to be part of, and 1/1 or 0/1 is a boolean in a
fraction's clothes. Null means creditable until it starts, the same generous
direction every blank in `_credit.js` takes.

It is **hours before a start time**, not the end of a day, because a session is a
moment where a cutoff date is a day — but it reuses the same `Asia/Nicosia`
resolution, the same ledger and the same credit-never-refund rule. Past the
deadline the booking is still **cancellable** and simply earns nothing: the same
split between entitlement and the ability to act that the course cutoff makes.

`freezeSession()` lives beside `creditForSession()`, and freezes only a session
that is **actually happening** — a date the calendar does not hold, or one that
is excluded, freezes `null` rather than a plausible instant built from the
default time, which would make a booking for a date the activity does not meet on
look well formed.

⚠ `creditForSession()` **must not call `Date.now()`**. The whole contract of
`_credit.js` is one record and one timestamp and nothing else, so the same pair
returns the same figure a year later. A test asserts the file never asks what
time it is, and it caught this function reaching for a fallback clock.

### The conditional-panel trap, in the direction nobody had tested

`mergeRegistration()` carried undrawn fields across from `from` — the base
normalised **to the target type**, which is exactly what strips the other type's
fields. So the loop looked like it was protecting a field and was quietly writing
`undefined` over it.

Only one field has the asymmetry: `normaliseRegistration()` writes the cutoffs
whatever the type, but a course has no `sessionCancelHours`. So five of the six
fields were protected **by coincidence** and the sixth was not — and a drop-in
configured with a 24-hour window, switched to course to fix something and
switched back, came back with no window at all. Nothing typed, the save
succeeded, and the policy quietly became more generous than the one agreed. It
now reads undrawn values from the **raw stored record**, which makes the
protection the rule rather than an accident and covers the next type-scoped field
without anyone remembering to.

Note the deliberate limit: when a type **does** draw a field and sends it empty,
that is the admin clearing it, and it clears. Absent means "this type did not
send it"; empty from a form that drew it means empty.

## The account chip

Ported from the sister project's nav (`js/nav.js` there, lines 238-318), which
shows a person icon and "Log in" when signed out and the member's initial plus
"My account" when signed in. Ogen's says **"My family"** — the area is about
children rather than billing.

Two things carried over verbatim, because both are the reason the pattern works:

- **It reads `localStorage` directly, not through `MemberSession`.** `js/nav.js`
  loads on every page; `js/member-session.js` loads only under `/account`. A chip
  that reached for the helper would throw on the homepage, which is most of the
  site. This is the one place that duplication is correct rather than lazy, and a
  test asserts the nav never touches the global.
- **Sign-out drops the token locally first, then tells the server.** If the
  network call fails the person standing at the screen is still signed out, which
  is the half that matters to them. It reloads in place rather than navigating —
  a change of state, not of place — *except* on an account page, where reloading
  would only ask them to sign back in, which is the opposite of signing out.

Sign-out lives in the bar rather than inside `/account` because shared and family
devices are normal here; leaving has to be one click from anywhere.

### ⚠ The chip does NOT mirror across the bar, and that is correct

This looks like a violation of the logical-properties rule and is not. The chip
joins `.nav-right`, which is pinned to the physical right and forced
`direction:ltr` **on purpose**: the language toggle has to keep one place and one
`[עב][EN][RU]` order in all three languages, because the reader who needs it most
is the one who cannot read what is currently on screen. Mirroring the chip alone
would fling it to the far side of the bar in Hebrew, away from the controls it
belongs with.

So it sits on the same physical side in every language — exactly as the sister
project's does, on the other side and for a documented reason rather than by
accident. The sister project pins its chip with `position:absolute; left:0`, a
physical edge on a site that renders Hebrew; that part is **not** copied.

**What genuinely mirrors is the inside of the chip.** `html[lang="he"]
.nav-account { direction: rtl }` opts Hebrew back in, so the avatar sits at the
reading start and the label follows it; the padding is `padding-inline: 6px 11px`
so the rounded end stays on the label's side; and the exit arrow is flipped with
`scaleX(-1)` so "leaving" points the way the language reads. A test asserts there
is not one physical inset in the block, and that the rtl opt-in and the arrow flip
are both present.

### Colour, and the one CTA

The signed-out icon is **terracotta**, because signing in is the one actionable
thing in the bar and rule 5 says every actionable CTA is terracotta. The
signed-in initial is **olive**, because a "this is you" marker is not a call to
action — keeping it off terracotta leaves the way in as the only such element in
the nav.

### Persistent at every width

Requested explicitly, so below 760px the chip sheds its **label** rather than
itself: the avatar or icon stays, still a reachable target and still saying which
state you are in. The hamburger entry carries the words, and now says "Sign in"
when signed out rather than always offering the same phrase.

### ⚠ The chip goes to the family area, and `?next=` is gone

It carried `?next=<the page you were on>`, so signing in from the homepage
signed you in and **put you back on the homepage**. That was built as a courtesy
and is the wrong one: the chip is labelled **My family**, and pressing it is a
request to go there, not a request to stay where you are. Somebody who has just
typed a password is looking for the thing they pressed, and being returned to
the page they left reads as a sign-in that did not take.

The one case "come back to where you were" genuinely serves — pressing Register
on an activity page — **never used it**: that goes to
`/account/activity?register=<slug>`, which is already the right page, and
`boot()` simply draws it once signed in. So the parameter was solving a problem
solved better elsewhere while being wrong for the only path that used it.

**Removing it removed an open redirect with it.** `next` arrived in a URL anyone
could write and was followed the instant a password was typed, so an absolute or
protocol-relative value would have made a link that looks like ogen.cy, asks for
a password and lands somewhere else. It needed a one-line guard, and a one-line
guard is exactly what gets simplified away later. Nothing sets it and nothing
reads it now, so there is nothing to guard — and the test checks **both halves**,
because either one alone is worse than neither: a generator with no consumer is
dead copy, and a consumer with no generator is a redirect anyone can still reach
by typing the parameter.

Signing in re-runs `boot()`, which draws whichever account view the reader is on.
That is the right answer every time.

### ⚠ The chip says Sign in / Register, because the page behind it is both

It said **Sign in**. `/account` draws the sign-in card with *"No account yet?
Create an account"* under it, so somebody with no account could always start
there — the chip simply did not say so, and "Sign in" tells a first-time visitor
that this control is for other people. It is the only way into the family area
from the nav, on every page of the site, so a reader who reads it as *not for
me* has nowhere else to be sent from.

`כניסה / הרשמה` · `Sign in / Register` · `Вход / Регистрация`. The label is also
the `title` and the hamburger entry, so all three follow.

The Hebrew shares a word with the activity page's Register button, and that is
judged acceptable rather than overlooked: `כניסה / הרשמה` is the standard
pairing on an Israeli site header, and there is no activity in view from the nav
bar for `הרשמה` to be read as registering *for*. Below 760px the chip sheds its
label as before, so the longer string costs nothing on a phone.

### The initial comes from a cached name

`js/nav.js` cannot ask the server who this is — it has no session helper and runs
on static pages. So `sessionFor()` in `js/member-account.js` caches the first
name beside the token, and refreshes it on every visit to the account area, so
the letter follows a change of name rather than showing what somebody first
registered under. It is the only thing about a person kept in browser storage,
and **nothing authorises on it**.

## The Activities group

The one menu entry that is **built rather than written**. It replaced
**"What We Offer"**, which pointed at the homepage's four themed cards — the
promise and the actual list were two entries for the same thing, and the promise
is what the reader has just scrolled past. The `#offer` section itself is
untouched; it simply no longer has a menu entry.

It is an **accordion inside the hamburger**, not a hover dropdown, because
neither this site nor the sister project has desktop nav links at all: both navs
are logo + language buttons + account chip + hamburger, at every width, and
everything else lives in the panel.

The menu ships with a plain `/activities` link inside `<div
id="activities-slot">`. `loadActivities()` reads
`activities/activities-index.json` and **replaces** that link with a group
naming what is on offer — so publishing an activity puts it in the menu of every
page with nobody editing `js/nav.js`.

**It fails open.** No `fetch`, a 404, unparseable JSON, nothing live: the plain
link is left alone, and the worst outcome is the menu the site would have had
anyway. There is no state in which this *removes* a way to reach the activities.
A test exercises all five failure paths.

⚠ **The index is read on first open of the menu, not on page load.** This script
runs on every page, and most visits never open the hamburger — fetching at load
buys a request per page view for a panel almost nobody sees. The sister project
pays exactly that. One flag avoids it, and a test pins that opening the menu
twice asks once.

**Only activities with a page in this language are listed.** `langs` is checked
the way the listing page checks it; without that, the Russian menu links to a
Russian page that was never generated.

### The three groups, and where the split lives

`STATUS_GROUPS` in `_activity-template.js` is the canonical mapping, and the
module throws at require time unless the groups between them cover every status
but `draft` — which is in none of them and cannot be, since a draft has no files
at all.

| Group | Statuses | he · en · ru |
|---|---|---|
| **Open** | `open`, `announcement`, `waitlist` | פתוח להרשמה · Open for registration · Открыта запись |
| **Currently Running** | `closed` | פעיל · Currently Running · Активные |
| **Archived** | `completed`, `cancelled` | ארכיון · Archived · Архив |

The order `open, announcement, waitlist` is written, not sorted: it is the order
the menu lists them in, so what you can join now comes before what is only
announced.

**`waitlist` is in Open.** The brief that settled this mapping named only
`announcement` and `open`, leaving `waitlist` with no group — which the
require-time assertion refuses, and which the brief's own earlier definition of
the group ("anything still accepting or about to accept registration interest")
answers.

**`פעיל`, not `פעילות`.** Unvocalised, `פעילות` is ambiguous between *activity /
activities* and *active (f.pl.)*, so that heading inside a menu called
`פעילויות` would be genuinely confusing. The short masculine form sidesteps it at
the cost of grammatical agreement, which is the right trade for a label.

**The split necessarily exists twice**: the server groups the listing page by it,
the browser filters the menu by it, and a browser cannot `require` a Netlify
function. There is no way to share the array, only a test comparing the two —
including the order. Same for the words: `L.running` / `L.archived` in
`js/nav.js` must be character-identical to `LABELS[lang].indexRunning` /
`.indexArchived`, or a link's label changes on arrival, which reads as the wrong
link.

### ⚠ It is status alone, never a date — and what keeps the status true

Nothing in the listing or the menu asks a clock. Two reasons, both specific to
this site:

- **Every other part of it decides display from the declared status.**
  `js/activity.js` renders the badge *and* the CTA from `data-status` and asks no
  clock. A date-checking menu would be the only component here overriding an
  admin, and it would contradict the page it links to.
- **The listing pages are static build artifacts.** They regenerate only when
  somebody publishes, so a date comparison baked into one is right on the day it
  is written and wrong afterwards, with nothing to notice.

That leaves one drift: `closed` means "underway, registration shut" and is set
months before the thing ends, so an admin who never flips it to `completed`
leaves a finished activity filed as running, for good.

**`_activity-autocomplete.js` closes it from the other end.** Nightly, a `closed`
activity whose last session has passed becomes `completed`. The status stays the
single source of truth; something else keeps it honest, and the three readers
stay simple.

It is **pure** — activities in, the due ones out, `now` passed in — so it is
testable with no fixtures, and it reuses `past()` from `_credit.js` rather than
writing a second timezone: the deadline is the **end of that day in
`Asia/Nicosia`**, so an activity whose last session is today runs all of today,
and a course finishing on a Tuesday does not complete at 02:00 Cyprus time on
that Tuesday because a server is on UTC.

**The last day is the LATER of the calendar and the typed `endDate`**, and that
direction is the safety argument. The two can disagree — this repo carried, for
months, an activity whose session count ran out a week before its stated end.
The errors are not symmetric: completing too **early** archives a running
activity and rewrites its public page under a family still attending;
completing too **late** leaves exactly the state this job exists to improve on,
harmlessly. An excluded date is not a session and cannot be the last one, the
same rule `freezeCancellation()` follows. No dates at all reads as *not ended*,
the direction every blank in `_credit.js` takes.

### ⚠ It is a PUBLISH, not a field edit

The status lives in the record, in three static pages and in the listing, so
writing it to the record alone would leave the live site saying "registration
closed" under an activity that ended in December — the same bug, moved. It goes
through `activities-admin`'s **`generate()`**, the same function an admin's
publish goes through and the one `preview-matches-publish` asserts byte-identity
against. A second renderer would be a second thing to keep in step.

Consequences worth knowing:

- **One commit per activity**, not one batched commit. Batching is fewer requests
  and also means one bad record takes the rest down — and this runs unattended,
  so that failure is a log line nobody reads until a family asks why a page is
  wrong. A failure leaves that activity `closed`, names it in the result, and
  tomorrow finds it again.
- **`activities-admin` is required lazily**, inside the function. It pulls in
  GitHub, Blobs, the template and the image pipeline; the registration half needs
  none of that and a scheduled function has ten seconds.
- **It bumps `isoUpdated`**, so an admin holding that record open gets a 409 on
  their next save. That is the optimistic lock working, not a bug.
- **`lastEditedBy` is `system`**, and the record carries `autoCompletedAt` and
  `autoCompletedAfter` — the date it acted on, because "it completed on the 24th"
  is not a useful record and "its last session was the 23rd" is.

### ⚠ The admin's "Run now" button must not call `run()`

`run()` is the scheduled entry point and does both halves. The admin's button
calls **`runRegistrations()`**.

That button is gated on `canApprove`, a **registrations** permission, and its own
hint says it "only updates what the queue says and tells the family". The
activity half commits to git and republishes live pages, which is an
**activities** permission. Wiring the button to `run()` would let an admin who
may work the queue but may not publish do exactly that, from a control saying it
does something else. The scheduled function has no session at all, so there is
nothing there for a permission to leak through. A test pins both call sites.

### The listing page grew group headings

`/activities` was one flat grid of every public status, sorted by slug. It now
renders the three groups in order, and **a group with nothing in it gets no
heading** — with a single group there are no headings at all, which is how the
page rendered before groups existed and how it still renders today. Verified by
regenerating against the live record, not assumed.

`id="open"`, `id="running"` and `id="archived"` are the menu's jump targets, on
the headings rather than on wrappers so a reader lands on the words. They carry
`scroll-margin-block-start:112px`, or the 96px fixed nav lands on top. A menu
entry is **absent until its section exists**, since jumping to an anchor the page
does not render does nothing and looks broken.

Card titles are `<h2>` with one group and `<h3>` under headings when there are
more — the levels follow the outline rather than being pinned to a tag. Still
exactly one `<h1>`.

### ⚠ Two mechanics from the sister project deliberately NOT copied

- **Its submenu is bounded by `max-height:480px; overflow:hidden` with no cap on
  rows.** Past roughly eight events the rest are **invisible but still in the
  DOM** — focusable by keyboard, announced by a screen reader, shown to nobody,
  with nothing on screen saying the list was cut. Ogen caps at **six rows** and
  collapses with `display:none`, so nothing can be hidden and reachable at the
  same time; "See all activities" is always there, so the cap costs one tap and
  never hides a row it claims to be showing.
- **Its RTL is a pair of physical rules per element** —
  `[lang="he"] {text-align:right; padding-right:44px}` and an LTR twin. That is
  two declarations doing what `start` does in one, and it is the shape rule 2
  forbids. Ogen's block has no per-language override at all, and a test asserts
  there is not one physical inset in it.

⚠ **The chevron is the one thing in that block that must NOT mirror, and it
did.** Built from `border-inline-end` plus `border-block-end` and rotated 45°,
it turns about a corner that moves with the direction — so it pointed down in
English and **left** in Hebrew when collapsed, right when open. That is a link's
gesture, on a control that is not one. Logical properties are for things
positioned relative to a side; a caret meaning "this opens downwards" is
vertical in all three languages, so its borders are physical on purpose and
there is nothing to flip. A test pins that, and pins that the rail and the
indent stay logical.

It also sat at the far end of the row on a `margin-inline-start:auto`, which on
a wide menu is most of a screen away from the word it labels. It is beside the
label now; the row keeps `width:100%` so all of it is still pressable.

Also fixed in passing: the sister's toggle is a `<button>` with no
`aria-expanded`, so a screen reader is never told the group opened. Ogen's sets
it, and `aria-controls`.

## The family area (Phase 6)

The first thing on this site a family signs into. Trilingual, RTL, and the whole
of it reachable from the activity page's Register button.

```
account.html                  /account            the dashboard
account/details.html          /account/details    your details, and the people
account/activity.html         /account/activity   one registration, in full
account/verify.html           /account/verify     the three token-bearing views,
account/reset.html            /account/reset      which exist as real URLs because
account/guardian-invite.html                      the emails already point at them
en/…  ru/…                    the same six, per tree — eighteen shells
js/member-session.js          the token, and the one post() every call goes through
js/member-account.js          every view, and the ONE {he,en,ru} table
```

**The eighteen pages are shells.** Every word a person reads is in the string
table in `js/member-account.js`, exactly as the nav, the footer and the contact
form each carry their own — so a wording change is an edit to one table rather
than to eighteen HTML files in three languages, which is the shape that
guarantees the Russian drifts from the Hebrew. A test asserts the body of each
page is a mount point and nothing else, that the three languages have **exactly**
the same keys (a missing Russian key is not a missing translation, it is
`undefined` rendered into a label), and that **no key is left unreferenced** — an
orphan is dead copy three languages carry, and is indistinguishable from a key
whose only caller was renamed, which is a real bug wearing a harmless costume.

A shell's `.page-header` carries the page's single `<h1>`; the heading the script
draws is an **`<h2>`**. Two h1s are two claims about what the page is. These are
noindex so nothing is reading them for SEO, but a screen reader announces the
outline.

### Three signed-in views, split by what a person came to do

| | |
|---|---|
| `account` | the dashboard — who you are, and what you are registered to |
| `details` | your own details, and the people on this account |
| `activity` | one registration: the facts, what it costs, what is paid, the sessions |

It was **one screen holding a summary and five forms**, and the one thing a
family opens it for — *is Noa in?* — was the hardest thing on it to find. The
dashboard is now two summary tiles and the list, and the tiles are links rather
than ornaments: "My family · 4" is how you reach the four people.

**And it answers "what else is there", which it did not.** The dashboard listed
what you are registered to and offered **no route to anything new** — the only
way to the listing was the nav of some other page, which is not the page a family
is standing on when the thought occurs. There is a `See all activities` /
`לכל הפעילויות` / `Все занятия` link at the foot of the registrations card in
both states, in the reader's own tree.

⚠ **AND THE REGISTER PANEL IS NOT ON THE DASHBOARD AT ALL.** It was, drawn from
`?register=<slug>`, and sitting at the top of a page headed "My family" it read
as the place registration lives — which is the thing the link above exists to
deny. Dropping the query after use was not enough: the panel was still the first
thing on the screen every time somebody arrived from an activity page.

It lives on **`/account/activity?register=<slug>`** now — the family area's page
*about* one activity, in the state it is in before there is a registration to
show. It has to be behind a sign-in, because the public activity page is static
and cannot ask *who*; this is the signed-in page that was already about an
activity. One view with two entry points rather than two views.

**And the same URL becomes the registration page the moment the form succeeds.**
`submit` hands back the record, so the query is rewritten from `?register=` to
that registration's own `?p=&a=` key and the view is drawn again — so a family
lands on the page answering the question they have the instant they press
Register (the waiting block, or the pay button), rather than on a notice sitting
where a form was. Rewriting also stops the form outliving the errand: left in the
URL, a reload reopens a filled-in form for something already joined.

⚠ The message is said **after** the redraw, not before — `renderActivity()`
replaces the notice node on its way in, so saying it first writes into something
discarded inside one repaint. That is the bug this file already warns about, one
screen over. The `flash()` drain in `boot()` had the same shape of fault and is
fixed in passing: it sat past two early `return`s, so a message carried towards
`/account/details` or `/account/activity` was dropped in silence.

⚠ **`pending` and `approved` share a pill, because they share a word.** Both
render "Registered" / `רשום/ה` / `Записан(а)` on purpose, and they were painted
gold and olive — so a family read two rows saying one thing in two colours, with
nothing on the page explaining the difference. **A colour with no legend is not
information**; it is our queue leaking onto their screen and asking them to
decode it. The distinction is real and surfaces where it is *actionable*: the
cost card draws a pay button on one and the waiting block on the other. The word
"pending" stays in the admin queue, which has its own styles and is untouched.

⚠ **White on `--gold` is 3.18:1**, below AA for 12.5px bold text — the token is a
*background* chosen to sit under white at display sizes, and a pill is neither.
`.acc-pill.is-s-booked` is `#96651F` now, darkened along the same hue at 5.03:1.
There the colour earns its keep, unlike the pair above: "booked" and "attended"
are different words, so the hue supports a distinction the text already makes.

**Every row is a person AND an activity**, never an activity alone. Ogen
registers one participant to one activity, so two children in the same class are
two registrations with their own status, price and cancellation; a row naming
only the activity would hide which of them it was about. Rows group **live and
finished** rather than upcoming and past — a row carries no end date, so grouping
by time would be a claim the list cannot support.

`/account/activity` is addressed by **participantId and activityId**, which is
the registration's key, and the server resolves the activity through
`activities-index.json`. Never by the frozen slug:
`frozen.activitySlugAtSubmission` is audit only, and following it after a rename
opens the wrong record or none — and the family is told their registration does
not exist. One server-side `regRow()` builds the shape for both the list and the
page, so the row a family reads on the dashboard cannot disagree with the page
they opened from it.

The facts on that page come from **`sidebarGroups()` — the same module the
published page uses**, so the family area cannot start describing an activity
differently from the page it is published on. `isPubliclyVisible()` keeps its
exact current meaning and its only caller: the members-only address is **omitted
from the payload**, not hidden in the client, and `memberVisibleRows()` is still
not built. One wrinkle worth knowing: `LABELS` is authored for an HTML template,
so `gSchedule` is literally `When &amp; where`. The client sets `textContent`, so
there is one `plainLabel()` decoder at the point the two worlds meet — JSON is
not HTML, and an undecoded entity reaches a family's screen as itself.

### ⚠ The area was not about children, and said it was

`_participant-store.js` has opened by saying so since Phase 3 — *"a guardian must
be able to register themselves… One entity"* — and nothing in the model branches
on age. A parent could always add themselves and sign up for the folk dancing.

**The words drifted, and only half of them**, which is why nobody noticed: the
button already said "Add a participant" / `הוספת משתתף/ת` while the heading
directly above it said "My children" / `הילדים שלי` / `Мои дети`. A model that is
right and a screen that says otherwise is worse than either alone — the
capability was built, paid for, and invisible.

The heading is `familyTitle` now, the list holds whoever takes part, and **"Add
myself" is a button** rather than something you have to work out is allowed. It
prefills the name the account already knows. A test pins the words to the model
rather than to a review somebody has to repeat: no string in any language calls
anybody a child.

**`isSelf` lives on the LINK, not on the participant.** It is a fact about a
*pair* — a couple who each manage the other's record are "self" on one of their
two links and not on the other. Put on the participant it would have to name an
account, which is primacy's job and already has a home. It authorises nothing: a
client that lies about it has mislabelled its own screen.

Two edges it exposed. **"Remove myself from this record" is hidden on the record
that is you** — you would be handing your own attendance to somebody else and
losing sight of it. And the guardian **invitation email** still says "second
guardian for &lt;name&gt;", which reads oddly adult-to-adult; it is trilingual
copy whose Russian is already awaiting review, so it belongs in that pass.

### ⚠ A button labelled with a description hid the invite flow

The guardian invitation has worked since Phase 3 — bound to the address it was
sent to, re-sendable, revocable, offered only to the primary guardian and only
below the maximum. QA could not find it, and said so four times in a row: *“I
cannot find where to invite the other guardian.”*

The panel holding it opens from one button on a participant's row, and that
button was labelled **“Who can see and manage this record”** — the panel's own
heading, six words, sitting next to “Edit” in a row of one-word controls. It
never used the word *invite* or the word *guardian*. A label that describes a
container is a caption; a reader scanning for an action does not press it.

The button names what it opens now — `Guardians` / `אפוטרופוסים` / `Опекуны` —
and the sentence stays as the heading **inside** the panel, which is where a
description belongs. Same lesson as the nav chip that said “Sign in” to somebody
who had no account yet, and as the family area that said “my children” over a
model that never cared about age: a capability nobody can find is a capability
nobody has.

⚠ **AND THE TEST WAS CLICKING IT THE WHOLE TIME.**
`the-three-family-screens-render.js` found that button by its text and pressed
it happily, so the invite flow was covered, passing, and unreachable in practice.
Finding a control by its label proves it exists; it can never prove anybody would
read it as a control. The suite now pins **both halves** — the short label on the
button and the sentence as the panel's heading — so the next tidy-up cannot put
the description back on the control.

### The credit card stays, and renders nothing

Payments are not built, so the card was going to be removed until the same
release. It is kept and simply draws nothing while the ledger is empty, because
**cancelling in time already writes a credit** — removing it would give a family
credit they cannot see. Today every balance is €0.00 because nothing collects
money. The day that changes, it is already there.

### The screens are EXECUTED by a test, not read

`tests/_dom.js` is a DOM small enough to run `js/member-account.js` in and no
smaller. There is no jsdom on purpose: *"a test that needs installing is a test
that stops being run"* is the rule this directory is built on, and the same one
that put fake Blobs and fake GitHub in `_helpers.js`. It implements what this one
script actually uses and **throws on anything else** — a class selector that is
not a class selector, a click on a node with no handler, an `appendChild(null)` —
so it cannot quietly decay into a bad imitation of a browser.

Over a thousand lines of client code had never been run by anything. It found two
bugs in one sitting, and both read fine on the page: registering said "your
request has been sent" and then rebooted the dashboard, which threw the notice
away inside one repaint; and the two tabs on `/account/details` told themselves
apart by comparing their own **label text**, which would have lit both up in any
language where the wording converged.

`data-view` on the mount is the entire router. The three token views are real
URLs rather than query parameters on one page because **`_account-email.js` has
been sending those links since Phase 2**, and once a message is sent the link
lives in an inbox where it cannot be corrected. A test builds every message in
every language, extracts every href, and asserts each one resolves to a file that
exists — neither side is the source of truth on its own.

**Noindex, and deliberately absent from `sitemap.xml`.** A sign-in page has
nothing for a search engine and everything behind it is one family's record.

### ⚠ The language toggle was dropping the token

`setLang` preserved `location.hash` and not `location.search`. Three of these
pages carry their token in the query string, so a reader switching a
Hebrew-looking link to Russian — *exactly* what that toggle is for — silently
turned a valid invitation into a dead one, and the page could only say "that link
has expired or has already been used". It now carries both. A test pins it.

The same edit fixed a second thing in waiting: the family-area link is built from
a bare tree prefix (`''` / `'/en'` / `'/ru'`), not from `home`, because `home` is
`'/'` in Hebrew and `'/' + '/account'` is a protocol-relative URL pointing at a
host called `account`.

### What the client does and does not decide

Permission checks here are **cosmetic**, like the admin's. "Invite a second
guardian" is offered only to the primary guardian and only below the maximum;
"remove myself" only when another guardian would remain; "cancel" only when the
terms frozen on that registration allow it. Every one of those is re-decided
server-side, and the client's copy exists so a family is not offered an action
that is about to be refused.

Two of them are worth naming because the server rule is the interesting half:
a participant is **never** left with no guardian, and the cancel button is shown
from the same `creditFor()` the server will apply — so what is offered is what
happens.

**The invited address is filled in and locked** on the invitation path. An invite
is bound to the address it was sent to, so letting it be edited would produce a
sign-in that succeeds and then an acceptance that is refused, which reads as the
invitation being broken. `inviteDetails` returns `hasAccount`, so the page opens
the door that person actually needs — sign in, or sign up — with no second round
trip and revealing nothing they do not already know about their own address.

### ⚠ A press with nothing happening reads as a broken button

Reported as *"clicking Create account — nothing happened; after a long time, an
error"*, and it was two bugs wearing one symptom.

**`.btn-primary` had no states at all** — no `:hover`, no `:active`, no
`:disabled`, no `:focus-visible`. Every form here already disabled its button for
the length of the call, and that was the *whole* of the feedback: a disabled
button with no style is pixel-for-pixel a button sitting there doing nothing.
Sign-up is also the slowest action on the site — a password hashed at cost 12 and
several records written — so the gap is seconds long on the one form where it is
least affordable, and the tallest, so the notice renders off screen.

The button now moves when pressed, which is the only feedback that arrives before
the network does, and `busy()` relabels it. One helper rather than a line in each
handler, because the failure *was* every handler doing the same half-measure and
the next form added would have done it too. The handlers that still disable by
hand are the ones writing their own label ("Opening payment…", "Register and pay
· €27.00"); a test checks each rather than counting them.

**And "after a long time, an error" was a second bug underneath.** `settle()`
promised that an email failure never blocks the action it accompanies — true of a
send that *fails* and false of one that *hangs*. It waited forever, Netlify killed
the function at ten seconds, and the caller was told something went wrong about an
account that had already been created. The person then tries a different address,
because that is what the message told them to do.

`SEND_TIMEOUT_MS` is 6000: inside Netlify's ten with room for the work that ran
first, and far longer than a healthy send. The timeout does **not** cancel the
request, it stops us waiting on it — so the mail may well land afterwards and its
log entry may not be written, which is the honest cost of this file's opening
rule. A gap in a record beats a person staring at a dead button.

`flash()` carries one message across a redraw. `say()` writes into the notice the
current screen owns, and signing up *replaces* that screen — so the one thing a
new account needs to know ("we have emailed you to confirm the address") was
being written into a node discarded in the same repaint.

### ⚠ A family could see their credit and not spend it

Cancelling in time has written a ledger entry since Phase 5 and the dashboard has
shown the balance since Phase 6. There was no action anywhere that turned it back
into a paid place: `applyCredit` is gated on `canCancel`, an **admin**
permission, so the only person who could spend a family's credit was somebody
else. *"It comes back as credit"* was true and useless.

`_spend-credit.js` is the one spender, called by both sides. Two
implementations would be two that can cap differently or write the two halves in
a different order, and the difference surfaces when a family reads their balance
to the admin reading theirs.

- **The ledger is written first** — the opposite of the rule for a *credit* and
  right for the same reason. A debit without the payment is a visible line in an
  append-only record a person reads, and is reversible with an adjustment; a
  payment without the debit is credit spent twice with nothing saying so.
- **⚠ Capped at what is owed**, which the admin's version did not do. Credit paid
  beyond a debt is not a payment, it is credit **deleted**: the record reads
  "paid" by more than it cost and the balance is lower with nothing to show for
  the difference. A genuine correction is `adjustCredit`, which writes a line
  saying what it was for.
- **The amount is decided server-side** — the smaller of what is owed and what is
  held. A client that names its own figure is a client that can name somebody
  else's balance, and there is no other useful number to choose.
- **The account that owes is the one credited.** A second guardian can book an
  evening on a participant somebody else registered; a guardian link does not
  authorise spending another account's credit.

One action for both kinds of debt, because it is one question and the two records
carry the same payment vocabulary on purpose — `sessionDate` says which. The
balance now rides on the `registration` payload too, so the page showing a debt
also shows the thing that settles it; the dashboard is not where anybody is
standing when they owe something.

### ⚠ "Includes the yearly registration fee" was printed under everything

It sat under **every** cost card. It restated a row already on the card, labelled
and priced — and on a drop-in with no registration fee it described a charge
nobody is making: €7 for an evening, followed by a sentence about an annual fee.

The half worth keeping is the other one. *"Already paid"* is why a second term is
300 and not 350, and it is the one thing about the fee a family cannot work out
from the figures in front of them. It appears only when a fee was actually
waived; with no fee on the activity there is nothing to have been waived, and it
says nothing at all. `feeIncluded` is deleted rather than left as dead copy in
three languages.

### ⚠ `window.confirm` is not ours to style

Three destructive actions in the family area asked through the browser's dialog.
It is pinned to the top of the viewport, headed with the site's **domain**, and
painted in the operating system's colours — so the most consequential question
this site asks arrived looking like a security warning from somewhere else.

The third problem is the one that mattered: a browser dialog takes a single
string and **cannot say what the answer costs**. On a cancellation that is the
whole of what somebody needs to know, and the server has already computed it —
`creditForSession()` decided it before the button was drawn. The credit line is
in the question now, from that same figure, so what is asked and what happens
cannot disagree.

**Staying is the terracotta.** Rule 5 says every actionable CTA is terracotta,
and the action here is the one that changes nothing: a cancellation cannot be
undone, so the easy press is the one that leaves things alone. The dialog mounts
inside `#page`, so direction comes from there and there is not one physical inset
in the block.

### The Families screen

`/admin/families.html` — every account somebody has opened on the site: who they
are, who they guard, what those people are registered to, and what the account is
holding in credit.

⚠ **It did not exist, and the reason it stayed missing is a word.** The admin had
`findAccount`, which answers *"is there an account at this address"* — useful
when somebody has read you their address over the phone, and no use at all for
*"who has signed up"*. The page called **Accounts** was admin **logins**, so the
bar already appeared to have a screen for this and did not. Renaming it to
**Admins** closed the ambiguity and left the gap behind it.

Gated on the `family` tool, Super Admin only, for the reason that permission
exists: opening a family record means reading who somebody's children are.

**No dates of birth.** The `participant` action returns one, because an admin
opening a single child's record is doing the job the age flag exists for. A list
of everybody on the site is a different thing and does not need one, so this
carries the name and the link and the DOB stays one deliberate click away.

`allAccounts()` is the only scan in `_account-store.js` and says so: nothing in
the signed-in area ever needs it, because a family reads their own record through
a pointer, which is the whole reason the pointer store exists. Filtering happens
in the browser — the list is a community centre's, and the day it stops fitting
in one response it needs paging rather than a cleverer query.

It is **see**, mostly. Unlinking a guardian and deleting a participant already
live in the flows that own them, with the last-guardian refusal and the debt
disposition attached; a second door to them from a list would be a second place
those refusals have to be remembered.

### ⚠ Six files claimed to arm the legal gate and none of them did

Every phase after the first added a store naming a participant, wrote
*"Arms the legal gate, correctly"* at the top, and never appeared in the gate's
own list: the attendance register, the bundles, the check-in tokens, the pay
links and the credit ledger were all invisible to it while each file said
otherwise.

It fired anyway, because the files that **do** match are enough to arm it — which
is exactly why nobody noticed. **A gate that is already armed cannot tell you
what it is failing to see.** The store list is the thing that has to be complete,
not the count of signals. `_spend-credit.js` now says the opposite and means it:
it opens no store, so it does not arm the gate, and the records it writes through
do.

### ⚠ Fewer calls, and a cached read that must never reach money

The family area was slow because every screen was several API calls and each one
read the same activity file from the GitHub API.

**One call per screen.** The dashboard was four requests — `me`, the participant
count, the registrations, the balance — which is two functions asked three
questions about one account, each authenticating and each opening its own
stores. It is `me` plus `dashboard` now. The activity page was three — the
registration, then the evenings, then the bundles — each a GitHub round trip for
the same file; `registration` carries a `perSession` block built from the copy
already in hand. `sessionsPayload()` and `bundlesPayload()` are the one builder
each, so the combined call and the narrow ones cannot return different shapes.

The narrow actions stay, and should: booking, cancelling and moving redraw **one
panel**, and re-fetching a whole page to repaint a table is the trade in the
other direction. `list` and `balance` are **gone** rather than left beside
`dashboard` — an action nothing calls is dead copy indistinguishable from one
whose caller was renamed.

**⚠ And the cache is the part with teeth.** The argument for it was *"this is
only display data, and the money paths verify everything fresh anyway"* — which
was **not true when it was made**. One `published()` served ten call sites in
`account-registrations.js` and **six of them write**: `submit`, `bookSession`,
`bookAndPay`, `paySession`, `buyBundle`, `rescheduleSession`. Caching that would
mean a family charged a price edited ten seconds earlier, and nothing about it
looks wrong until two receipts are compared.

So the premise is true **by construction**:

| | |
|---|---|
| `published()` | every path that freezes terms onto a record or opens a Checkout. Never cached. |
| `publishedForDisplay()` | the four read-only actions — `activity`, `sessions`, `bundles`, `registration`. Cached for **10 seconds**. |

Ten seconds covers the burst one page load makes and a redraw straight after it,
which is all it has to do. The number to compare it against is not zero: **the
deployed bundle already trails a save by about a minute**, which is the
staleness the uncached read exists to beat, and this is a sixth of it.

The cache holds a **string** and parses per call, so an action that mutates what
it got back cannot poison the next reader. It is per container, so it empties on
its own and there is nothing to invalidate.

`tests/a-cached-read-never-reaches-money.js` reads the classification **off the
source** rather than listing it, so an action added tomorrow is covered without
anyone editing the test — and it fails on an action that reads an activity and
appears on neither list, because picking the wrong reader is invisible. It also
checks the property behind the list: nothing on the cached side saves a record or
opens a Checkout.

### ⚠ Coming back from a completed Checkout

`?paid=<kind>` is set on Stripe's `success_url`, and it means one thing and not
the other: **somebody has just come back from Checkout**. It is not proof of
payment &mdash; a person can type it &mdash; and Stripe redirects the moment the
card clears, which is routinely **before** the webhook that settles the record.
The webhook is the only thing here that moves money.

For a release **nothing read the parameter at all**. A family who had just paid
&euro;350 was returned to a card reading *"Still to pay &euro;350.00"* with no
acknowledgement and no explanation, which is indistinguishable from a payment
that failed. Printing "paid" on arrival would have been the other half of the
same lie, because the figure underneath can still be the old one.

So the URL opens the question and **the payload answers it**. Three kinds settle
into three different places, which is why the kind travels rather than being
guessed &mdash; it is the same discriminator the webhook dispatches on:

| `paid=` | what moves |
|---|---|
| `registration` | a debt on the registration falls |
| `session` | a debt on one or more evenings falls |
| `bundle` | a bundle **appears**, with nothing outstanding either side of it |

The first two are watched by the figure falling or reaching zero; the third has
no figure, so it watches the bundle list change. Settled on arrival is
acknowledged at once and the parameter is dropped from the URL, so a reload does
not announce the same payment twice. Otherwise the page says it is being
recorded, re-asks six times at 1.5s, and redraws the moment the figures move; the
redraw re-enters the wait and `paidTries` survives it, so the wait is bounded
whether the figures move once, partly, or not at all.

⚠ **The bundle branch cannot read perfectly and says so.** If the webhook won the
race the bundle is already listed on arrival and nothing will change, so the wait
ends on the slow message &mdash; which is worded *"if the figures here have not
caught up"* precisely so it is true in both cases rather than reporting a failure
that did not happen.

`say()` gained a `sticky` flag for this one caller: the recording message has to
outlast the wait it describes, and saying it again on a timer would also scroll
the page under the reader every few seconds. Every other `ok` notice still clears
itself after five seconds, and a test pins that default.

### ⚠ A refusal was the one string that stayed English

A family on the **Hebrew** page, filling in a **Hebrew** form, under a **Hebrew**
heading, typed an address that already had an account and was answered:

> An account with that email already exists

Every refusal in the family area was like that. Eighteen shells, one `{he,en,ru}`
table, RTL, a language toggle — all of it translated, and then the moment
anything went wrong the page switched to English, which is the moment somebody
most needs to be able to read it. A parent who cannot tell *that password is too
short* from *we could not reach the server* tries the same thing again, or gives
up, or opens an account under a second address, which is the one outcome that
leaves real mess behind.

It was not a missing translation. It was a whole **class** of string that had
never been treated as copy, because it lived on the server — and the server's
other display strings had only just been fixed, when the group names and price
rows turned out to be rendering in the language on the **account** rather than
the language on the **screen**.

**`_family-errors.js` is the one table**, pure, opening no store. ~76 messages ×
three languages, each either a string or a function of the same parameters.

**The words are on the server rather than in the client's string table**, which
is the one real design choice:

- the refusal is authored beside the condition that produces it; a code
  travelling to a client that holds the words is two files to edit and a code
  with no key rendering as nothing;
- several carry a number or a date — how many guardians, when cancellation
  closed, how many characters a password needs — and interpolating in the client
  means shipping the parameters and reassembling a sentence in three grammars;
- **the server already knows.** `js/member-session.js` sends `lang` from
  `document.documentElement.lang` on every request, built for exactly this class
  of problem. An error message is a display string like any other.

`code` travels beside the sentence anyway, so a client can branch on a reason
without matching prose. The `reason` and `full` fields two screens already read
are untouched.

**The stores say what went wrong; the endpoint says it in a language.** A store
has no business knowing which language a browser is set to, so
`_account-store.js`, `_participant-store.js` and `_guardian-store.js` throw with
a `code` and an English message that is a **log line, not something a family
reads**. The same for the pure rule modules: `submissionErrors()` and
`validate()` returned English prose, which is how a module that is handed an
activity and asked what is wrong with it ends up holding one language's copy.
They return keys.

⚠ **`'invite-' + invite.status` is written out.** A computed code can name a
message that does not exist — add a fourth invite status and the family gets the
generic apology with nothing saying why — and it is invisible to the check that
reads keys off the source, which is what stops a message becoming dead copy in
three languages. That check **found these three** the moment it was made honest.

**What stays English, on purpose:** `Use POST`, `Body must be JSON`,
`Unknown action "x"`. They mean the client is broken or somebody is calling the
API by hand; nobody using the site can reach them, and translating a message for
a reader who does not exist is three languages of maintenance behind a screen
nobody sees.

**The default is Hebrew**, not English — the language of the tree at `/`, which
is the direction every other blank on this site falls.

`tests/a-refusal-is-in-the-language-it-is-read-in.js` asks four things, and the
fourth is the one that matters in a year:

1. every message is complete in all three, and **Hebrew contains Hebrew letters
   and Russian contains Cyrillic** — a key quietly left holding the English is
   invisible to a reviewer who does not read the language;
2. every key the code uses exists, and every key that exists is **used** — an
   orphan is dead copy three languages carry, indistinguishable from a key whose
   only caller was renamed. ⚠ This check was **self-satisfying** at first: it
   scanned the whole functions directory, so every key matched the quoted string
   that *declares* it and an orphan looked used. Excluding the table's own file
   is what made it bite;
3. the handlers are **executed** in all three languages, with no session, and
   the refusal that comes back is read;
4. ⚠ **no family endpoint emits an English sentence any more**, which is what
   stops the next refusal somebody adds from being English, silently, in the one
   place nobody looks until a family writes in.

All four failure modes are verified to fail.

**The check-in page is the fourth endpoint and the odd one.** It has no session
and no language in its URL, because a code on a wall cannot be three posters —
so the page chooses with its own toggle and sends that, read live so switching
language and tapping again switches both.

### ⚠ And one refusal was never ours to translate

The terms checkbox carried `required`, and a native validation bubble is drawn
by the **browser**, in the browser's language, with no attribute that changes
it: a Hebrew form refusing in English. Same shape as a native
`<input type="time">` printing AM/PM at an admin in Cyprus — the value was never
in question, the display was one the page could not control.

It is checked in the submit handler now, with the **same sentence the server
would have sent**, so the two doors cannot word it differently, and through
`say()`, which scrolls its notice into view — the half of the bubble worth
keeping on the tallest form in the family area.

**The other nine `required` fields keep it, deliberately.** On a text or email
box the attribute also buys format checking, focus and scroll, and the message
is the browser's own UI in the language its owner set. A checkbox has no format
to check, so `required` buys the bubble and nothing else — which makes it the
one place the trade is free.

### The wait has a shape

Every screen here fetches, and the wait was the word "Loading…" on an otherwise
empty page — which says exactly as much about a call that takes 200ms as about
one that has already failed, and leaves the page to jump when the content arrives
at a different height.

`skeleton(shape)` draws blocks at the size of what is coming, built from the
site's own tokens: `--stone` on `--paper`, the cards' own 10px radius, and a
sheen that is a slow pass of `--paper` across `--stone`. Not a stock spinner, and
not a grey box from somewhere else. The shapes are named for the content —
`tiles`, `list`, `panel`, `table` — so a caller asks for a list of rows and does
not have to know that a row is 66px.

Three things it has to get right: it is appended **synchronously**, before the
request leaves, or it is not a loading state; it carries `role="status"` and the
`T.loading` string as its label, because a stack of grey blocks announces nothing
to a screen reader; and under `prefers-reduced-motion` the sheen stops while the
blocks stay, because motion is the decoration and never the message.

### ⚠ The language on screen is the PAGE's, not the account's

A family reading the **Hebrew** page was offered group names in **English**.

Every display string `account-registrations.js` renders — the named groups, the
facts card, the price rows, the session table, the language Stripe Checkout opens
in and the tree it returns to — was built from `profile.preferredLanguage`. That
is the right language for an **email**, which arrives later and out of context,
and the wrong one for a screen somebody is looking at right now. Somebody had
once picked English as a preference, and every Hebrew page they opened afterwards
was half in English.

`post()` in `js/member-session.js` now sends `lang` from
`document.documentElement.lang` on **every** request — from the one place rather
than per action, because the next action added would forget — and the server
prefers it, falling back to the preference so an older tab still answers in
something. **The emails are untouched**: they read the account, and a test asserts
no `mail.send*` call in that file is ever handed a page language.

Note the client was already right about half of it: the activity title on that
same screen comes through `pick()` in the browser and was in Hebrew. Only the
server-rendered strings were wrong, which is why it looked like a translation gap
rather than a plumbing one.

### The session is localStorage, and the admin's is not

A guardian session is seven days on a sliding window, sized for a parent who
visits once a month; losing it every time a tab closes would defeat the reason it
is seven days. **Both clients use `localStorage` now** — the admin's used to use
`sessionStorage` under a comment calling that a security property, which it was
not; the real limits are server-side and differ on purpose, four hours idle with
a twelve-hour cap against seven sliding days. Different store, different key,
different lifetime — and server-side they are different Blobs stores with
different key prefixes, which is the actual security boundary.

`post()` clears a dead session on a 401 but **never navigates**: a family halfway
through a form should not lose it to a redirect they did not ask for. One place
also decides what a failure says, because "you are offline" and "that was
refused" are different things and a person should not be told the wrong one.

### The Register button now leads somewhere

`js/activity.js` fell back to `#register`, the contact section, because
registration did not exist and a dead end was worse than a form. It now defaults
to `/account/activity?register=<slug>` **in the reader's own tree**, so a Russian-speaking
parent lands on the Russian page rather than in the Hebrew default with a
language switch to find. There is **no override** — see the `ctaUrl` note under
the status contract for why the field was removed.

### ⚠ Registering for a drop-in is ONE step

A term and a drop-in are two different decisions, and the family area was making
the second walk the first: register for the activity, wait, come back, book dates
one at a time, then find a way to pay for each. A term deserves that shape — one
choice, for months, with a price agreed up front and a person deciding who gets a
place. A drop-in is *we will come on Tuesday*.

Two of those steps did not exist. **A drop-in registration owes nothing** —
`owedCentsFor()` bills the yearly fee and, for a *course*, the term price — so
"a payment link is on its way" was a promise about a debt of zero, and the panel
could not say which session was being registered to because the honest answer was
*none of them*.

So `bookAndPay` does all of it in one call: who, which dates, Checkout. **The
registration still exists underneath** — it carries the guardian link, the frozen
terms and an admin's ability to say no — and a family never has to know that.
`openRegistration()` is the one place a registration is created, called by both
`submit` and this, because two copies are two places the fee waiver, the capacity
rule and the carried-forward history can drift.

Two orderings carry the weight, and they are opposite:

- **Everything that can refuse, refuses before anything is written.** Every
  chosen date is checked for room together; if any has gone, nothing is booked
  and the family chooses again. Being given three of four dates plus a charge is
  worse than being asked once more. Over-capacity is still *reported* rather than
  prevented — there is no atomic increment — which is the rule everywhere here.
- **The bookings are written, then the charge is made.** A Checkout failure
  leaves evenings booked and unpaid, which the family can see and settle from
  their own page. The other order takes money for a place that might not exist —
  and reporting the failure as a failure would send them to book again and hold
  two.

`pending` stops the whole thing before any money moves. An activity that does not
auto-approve, or a participant whose age cannot be confirmed, is a case where a
person has something to decide, and the message explaining the wait already
exists. **A free evening is not sent to a payment page for €0.00** either — a
bundle entry freezes the price at zero, and saying so is the answer.

The picker asks `sessions` rather than the activity view, because it needs each
date's **price**, each date's **room**, and whether *this* participant already
holds it. The price comes from `freezeSession()` with the same `bookedAt` the
booking will use, so a screen quoting the standard price cannot be followed by a
charge at the late one — which is also why `newAttendance()` now passes
`bookedAt` through at all. A date that cannot be taken is dimmed and still says
**which** reason: "full" and "already booked" are different answers.

The next available date arrives **ticked**. A family pressing Register usually
means the coming session, and a screen with nothing chosen and a dead button
reads as a screen that has not loaded. The running total is **on the button**,
because that is what it is the price of.

**Several evenings are one payment, not several.** A family sent through Checkout
four times abandons somewhere in the middle, and we would hold three paid
evenings and a fourth booked and unpaid with nothing saying so. `build()` takes a
list of lines — one per date, each named by its date, or ten identical charges
appear on a statement — and the breakdown rides in `session_amounts`. **The
webhook settles nothing unless that breakdown adds up to Stripe's own total**:
splitting money across blobs by a figure nobody checked lands it against the
wrong debt, which is worse than money nobody can place, because nobody goes
looking for it. The cap is twelve, from the 500-character metadata limit rather
than from a round number.

The activity page still books **one evening at a time**, with a Pay button on
each. That is the remaining surface running the old shape.

### ⚠ The verified-address gate is a COURSE rule

It has been wrong in both directions inside a week, which is why it is now one
function with a test around it: `verificationRefusal()` in
`account-registrations.js`.

**A course asks for a confirmed address. A drop-in does not.** The split is the
friction each one can carry, not a difference in how much the payer is trusted.
A term is a considered commitment — hundreds of euros, months of attendance, a
place an admin agreed to — and a minute spent clicking a link in an inbox buys
something real in return: the receipt, the reminders and every later message
about that money reach an address somebody has proved is theirs. A drop-in is a
walk-up: decided and paid for in one sitting, often by a family who signed up
minutes earlier.

It was on **everything** first. `emailVerifiedAt` had been stored since Phase 2,
shown as a banner since Phase 6 and enforced by nothing; payment was where it was
finally enforced, and it turned out to refuse exactly one flow and no others —
sign up, register, pay, in one visit. On a pay-per-session activity that is not an
edge case, it is **the** case.

Then it came off everything, which was too far. The argument for removing it —
that `/pay` is a link we ourselves email and is deliberately exempt, so a gate
with a door we post through is not a gate — is a good argument about the
**emailed** door and not a reason to drop the check where the friction is
affordable and the message trail matters.

Four things hold the rule together:

- **One function, three call sites decided by it.** `pay` asks, from the
  **frozen** type on the registration — it never opens the activity. `paySession`
  asks, from the activity, and today that always passes, because an attendance
  record exists only for a drop-in; the call is there anyway so a course that
  ever becomes payable by the session inherits the rule instead of it being
  something to remember. `bookAndPay` does not ask, and cannot need to: the line
  above it has already refused everything that is not a drop-in.
- **⚠ A missing type reads as `course`, which inverts this file's usual rule.**
  Every blank in `_credit.js` resolves towards the family; this one resolves
  towards the gate. A record with no `type` was written before drop-ins existed,
  so it *is* a course — and the errors are not symmetric: guessing drop-in skips
  a gate somebody asked for, guessing course costs one verification email.
- **The client reads the same field.** `regRow()` sends `frozen.type` with the
  same `|| 'course'` default. Reading anything else would hide a button the
  server would have honoured, which reads as a broken page rather than as a rule.
- **The refusal is shown, not hidden.** An unverified family on a term gets a
  line saying so, because the resend button is on the dashboard and a missing
  button teaches nobody anything.

`tests/what-stands-between-a-family-and-paying.js` pins both halves, the
direction a blank falls, and that `emailVerifiedAt` is read in exactly one place
in that file. The drop-in half is also *executed*, by
`tests/a-drop-in-is-booked-and-paid-in-one-step.js`, whose account is unverified
throughout — it walks the whole booking flow to Checkout and is still asked to
confirm its address on a term.

### Not built

The public "places left" count on the static activity page, and
`memberVisibleRows()` — the authenticated view that serves the members-only
address to a guardian with an approved participant. The family area shows a
places-left count on the register panel, from an authenticated call; the *static*
page still says nothing, and `isPubliclyVisible()` keeps its exact current
meaning and its only caller.

## Bundles (Phase 8)

N sessions of one drop-in activity, bought in advance at a fixed rate.

```
netlify/functions/
  _bundle.js        every rule; PURE — no store, no clock, `now` passed in
  _bundle-store.js  ogen-bundles; bun-<participantId>__<activityId>__<ISO>
```
plus `createBundleCheckout()`, `settleBundle()` in the webhook, three guardian
actions, a third job in the nightly sweep, the Price panel's editor, and a
panel on each of the two screens that read a purchase.

⚠ **The pure half was written first and wired to NOTHING for a release.** The
rules were right and tested and unreachable: no admin could define a bundle, no
family could buy one, booking never looked for an entry, and the nightly pass
had never heard of any of it. A pure module nothing calls is a design document
that compiles.

**THE PROMISE IS THE ENTRY COUNT, NOT THE WINDOW**, and every rule is that one
sentence at a different moment:

| | |
|---|---|
| at purchase | a bundle the calendar ahead cannot cover **in full** is not offered — never resized, never sold with a warning |
| afterwards | a session excluded after purchase is replaced by the next bookable date, **reaching past the validity window** if it must |
| at the end | when the calendar genuinely runs out, the shortfall becomes account credit **at the rate that was paid** |

**⚠ Entries are derived, never decremented** — `entries - usedDates.length`, the
rule capacity already follows, because Blobs has no compare-and-swap and a lost
decrement is invisible. And **`usedDates` is a list of dates, not a count**,
which is what makes `reconcile()` safe: a count cannot say whether the session
just cancelled had already been attended, so it would either strand an entry or
hand one back twice.

### Nothing is written until Stripe says it was paid

Every other payment here settles a debt on a record that already exists. A
bundle is a **purchase** — there is nothing to owe until it is bought — so the
obvious shape, writing the record and then charging for it, leaves an unpaid
bundle in the store with entries in it, and `covers()` would have to learn a
fourth status. The one place that can go wrong is the one place it must not.

So the terms travel in the Checkout metadata and `settleBundle()` writes the
record on the way back. **The covered DATES travel too**, rather than being
recomputed: coverage is read off the calendar as it stands, and an admin can
edit that calendar in the seconds a card takes to clear — so recomputing would
hand a family a bundle covering dates other than the ones they chose from. What
they saw is what they get, and the nightly pass repairs it if the calendar
really has moved.

Idempotent **by key**, not by a settled-payments list, because there is no
record yet to keep one on. The purchase timestamp is the third part of the key,
so a redelivered event resolves to the same blob and finds it there — which
matters more here than elsewhere: by the time Stripe retries, entries may have
been spent, and rewriting would hand them back.

The offer is **re-decided server-side from the activity** at the moment of
purchase. The client sends a `bundleId` and nothing else — never a price, never
a count.

### Spending an entry

`bookSession` and `bookAndPay` look for a bundle covering the date before
freezing a price; one that does freezes the evening at zero with
`priceBasis: 'bundle'`. **The attendance is written first and the bundle
second**: a crash between them costs us a free session, where the other order
costs the family an entry they paid for.

⚠ **Entries are allocated across a whole multi-date booking in ONE pass.**
`spendableFor()` answers for one date, and calling it per date re-reads a store
that has not been written yet — so a family with one entry left choosing four
evenings would get four free ones. `allocateEntries()` loads the records once
and marks each spend in memory, so `covers()` sees it when it decides the next
date.

Oldest bundle first, because a bundle has a window and spending the one closest
to expiring first is the only order that does not strand entries.

### Moving one session is not cancelling and rebooking

Cancelling a bundle entry and booking another date works on any ordinary evening
and is wrong here: the cancellation credits **nothing** (a bundle entry is frozen
at zero), so the entry would be spent and gone, and the replacement would be
charged at the standard price. A move keeps the entry and relocates it.

**Twenty-four hours, fixed** — not a per-activity field, because
`sessionCancelHours` uses null to mean *no* deadline and a second null meaning
the opposite is a trap this codebase keeps finding. Inside the window there is no
move at all and the entry is spent exactly as a no-show spends it.

`rescheduleTargets()` is **bounded by the window that was sold**, which is the
one place this is deliberately less generous than `reconcile()`: the repair
function reaches past the window because the system failed, and a guardian's own
change of plan does not, or repeated moves would extend a bundle indefinitely.
The server computes the list and the client offers exactly it — a client
filtering the calendar itself would offer a full evening.

Order: **the new booking, then the old one, then the bundle.** A failure leaves
the family holding two evenings on one entry, which is visible on their own page
and costs them nothing; the other order takes the evening away and gives nothing
back.

`afterReschedule()` has **two branches and they are not the same move**. The
entry always moves; the *coverage* moves only when the target is outside it.
Moving to a date the bundle already covers changes nothing about which dates it
may be spent on, and treating them alike removed `fromDate` anyway — so a
three-entry bundle came back covering two. Both branches keep the coverage the
same **length**, which is what lets the nightly reconcile run afterwards and find
nothing to do.

### The third job in the nightly sweep

`reconcileBundles()` runs last, after registrations and after autocompletion. It
touches no git and publishes nothing, so a failure in the activity half cannot
stop a family's bundle being repaired. `reconcile()` is idempotent, so it runs
over every bundle every night with no flag saying whether it has already looked.

⚠ **The shortfall is credited only when the activity is OVER** — when
`datesAhead()` is empty. An admin who excludes a session this week usually adds
one next week, and crediting on the spot pays a family for a date they are about
to be given back, and then hands them the date too.

And note what is **not** a shortfall: a date the family simply let pass unused.
`reconcile()` deliberately keeps those in the coverage so they cannot be
replaced — that is the window doing its job, and the entry was theirs. Only a
date that **left the calendar** is ours to make good. The distinction is the one
the first version got wrong, and getting it wrong gave entries away.

The credit is written **ledger first, record second** — the money rule, which is
the opposite of the email rule and wins over it. `bundle-shortfall` is its own
reason on the ledger's closed list rather than an adjustment, because nobody
adjusted anything: the calendar ran out. `shortfallCreditedCents` on the record
stops it being written twice.

### One view, two screens

`bundleView()` in `_bundle.js` is pure and is read by the family's own card and
by the admin roster. Two builders would be two screens that can disagree about
how many entries somebody has left — **and the family would be reading one of
them out to the admin reading the other**.

Four states per covered date, and the difference between the last two is the
whole point of the window:

| | |
|---|---|
| `used` | the entry was spent and the session has happened |
| `booked` | spent, still ahead — the only state that can be moved |
| `available` | not spent, still ahead |
| `gone` | not spent, and the date has passed |

**`gone` is rendered "not used", never "expired"**, in both screens and all three
languages. The window doing its job and a promise we broke are two different
events, and only the second is credited back.

### In the admin

Bundles live in the **Price panel**, drop-in only, as a repeatable list — "5
entries" and "10 entries" are two products on one activity. All three numbers are
required and **refused on save**: `normaliseBundles()` drops an incomplete one,
which is right on read and silent on save, so an admin would publish an activity
offering nothing with the form still showing what they typed. The cap on entries
is what the Stripe metadata field can hold, not a round number.

Both `bundles` and `lateDropIn` are in `TYPE_SCOPED_FACT_KEYS`, so a save from
the **course** form keeps them. That matters more than the two prices already
there: a term price is one number an admin can retype, and a bundle list is
several products with ids a family's purchase points at.

On the Roster, **Bundles bought** is a card per purchase rather than a column —
one family can hold two, and what matters about one is a list of dates, which
does not fit in a cell.

### Not built

A bundle cannot be **refunded** or transferred by an admin, and there is no
admin-side "grant a bundle" for a family who paid in cash. Both are real gaps
rather than decisions; today an admin compensates with `adjustCredit`, which
writes a line in the ledger with a note.

## The emailed payment link

`/pay?t=<token>` — a link in a payment email that opens Stripe Checkout with no
sign-in. It was asked for as *"can we auto-login the client via this link and
send him to the payment page"*, and the honest version of that — a magic link
minting a session — was refused.

```
netlify/functions/
  _checkout.js    the ONE Stripe Checkout session; both doors call it; no store
  _pay-link.js    ogen-pay-links; pay-<token>; arms the legal gate
  pay-link.js     /pay — the only endpoint here that acts with no session at all
```

**A magic link hands whoever opens a forwarded message the whole family
record** — children's names, dates of birth, medical notes, the members-only
address. Family inboxes get forwarded. This project already refuses that shape
once, in the guardian invitation, which is bound to the address it was sent to
for exactly that reason. **This link hands them a bill instead.**

What holding one lets you do, in full: start a Checkout for the amount
outstanding on one approved registration. **It never returns a body** — the only
successful answer is a 302 to Stripe, and every refusal is a 302 to a page that
asks for a password — so trying tokens can never read a name, a date of birth or
a balance.

**Its own Blobs store, and that is the security argument.** The obvious
implementation is `createToken('pay', …)` in `_member-session.js`: same shape,
same TTL machinery, no new file. It is refused for the reason the admin and
member *session* stores are refused a merge — a token filed beside the
password-reset tokens is one forgotten `purpose` argument away from being
redeemable as one, and `consumeToken(token)` takes that argument **optionally**.
A store that does not contain the key cannot be talked into honouring it.

**Both gates are still satisfied.** The registration must be `approved`, re-read
from the record on every redemption rather than trusted from the token — so an
old email cannot charge for a place since cancelled, and a part payment opens a
session for what is *left*, not for the figure that was outstanding when the
message went out.

The second gate, a verified address, applies to a course — and this link is
exempt from it
**by construction and by something stronger**: the token was mailed to that
address and nowhere else, so following it is itself proof of reading that inbox,
which is all `emailVerifiedAt` ever attested. That exemption is the argument the
whole split rests on — see **The verified-address gate is a COURSE rule**.
Following the link is still deliberately **not** treated as a verification:
confirming an address is a separate act with separate consequences, and a payment
must not quietly perform one. So an emailed link pays a **course** without the
gate; nothing else does.

**Not single use**, the one place it parts company with the reset and verify
tokens. Those grant something once; this names a debt, and a debt can
legitimately be looked at twice — a family interrupted halfway through Checkout,
or paying a balance a week later, must not find the link dead. It stops working
when the debt does. Thirty days, matching a guardian invitation rather than a
password reset: a reset is minutes of work by somebody at a screen, a payment
waits on a household and a payday.

**Minted per message, not per registration**, so a re-send does not kill the copy
already in an inbox. Several live tokens for one registration is harmless — each
is scoped to the same single debt, and the debt decides.

**The senders mint; the builders stay pure.** `approvedMessage()` and
`paidMessage()` take the URL as a parameter, so the message table is still
runnable in three languages with no store. Minting happens inside `settle()`, so
a Blobs outage costs a family one password rather than the email itself — the
button falls back to the registration page. The receipt offers it only when a
**balance remains**, decided by the amount rather than by the caller: a settled
receipt carrying "pay the balance" asks for money that is not owed.

⚠ **`_checkout.js` exists because there are now two doors to one payment.** The
button on the family's page and the emailed link must charge the same amount in
the same currency against the same metadata with the same descriptor. Two copies
would drift, and that drift surfaces as a family charged a figure nobody here can
explain. The amount is computed **inside** it, from the record, and is never a
parameter — this is reachable from an endpoint with no session, so an amount that
can be passed in is an amount somebody can edit. A test asserts exactly one file
in `netlify/functions` calls `checkout.sessions.create`.

⚠ **`/pay` MUST NEVER BE CACHED.** `/*` carries `s-maxage=60` so a shared cache
can serve a minute of repeat HTML traffic. Applied here that is not a saving: the
response is a 302 to a **one-time** Checkout URL minted for one family, and sixty
seconds of shared cache hands the next reader somebody else's session. The
function sets `no-store` and `netlify.toml` sets it again for the path, and a
test pins that the block carries no `s-maxage`.

`_stripe.js` gained `_internal.setClient()`, the same seam `_email.js` has and
for the same reason: static analysis can assert a descriptor suffix is set, and
only *executing* the thing catches an endpoint building a session for the wrong
registration.

## QR check-in (drop-ins)

A code on a wall at the venue. Somebody scans it, sees who is expected that
evening, taps their own name, and is marked present.

```
checkin.html                    /checkin — ONE page, three languages
js/checkin.js                   the screen, and the one {he,en,ru} table
netlify/functions/
  _checkin-token.js   ogen-checkin-tokens; chk-<token>; arms the legal gate
  checkin.js          /api/checkin — reads names and writes, with NO session
```

**It writes into the register that already existed** — the same
`att-<pid>__<aid>__<date>` blob, through the same `transition()` — so the admin
register, the money and the ledger see one thing. It deliberately does **not**
reuse `admin-registrations`' `markAttendance`, which is gated on `canApprove` and
stamps the admin's own address: sharing it would have meant either opening an
admin action to the public or writing a fictitious identity into the history.
What differs is one field — `by: 'self'`, note `QR check-in` — so an admin
reading the register can tell who marked themselves from who the staff marked.

**Drop-ins only, because only drop-ins have the data.** A course creates no
per-session records at all; its `sessionDates` are a published timetable, not a
register. The admin button is **absent** on a course rather than disabled, and
the action answers 400.

### ⚠ What "no login" costs, exactly

The coarse description is "anyone with the link could mark any name present".
The accepted version is narrower and is what the tests pin:

| | |
|---|---|
| **Read** | the names booked for **one evening of one activity**. **Full names** — chosen over first-name-plus-initial, because two children called Noa cannot otherwise tap the right row. Nothing else: no dates of birth, no contacts, no amounts, no other date. A test asserts each of those is absent from the payload. |
| **Write** | mark a listed name present. This **moves no money** — what an evening costs is decided when it is booked and a no-show owes it too — so the worst case is a wrong register, never a wrong bill. |
| **Never** | book, cancel, create a participant, read a balance, or reach any other date. There is no action that does any of those, and a test calls four that do not exist. |

It names children and places them somewhere at a time, and that is the part that
cannot be taken back. It was accepted knowingly, and the name format was widened
afterwards with the disclosure already on the table.

**Two guards turn a photographable code into a key to one evening:**

- it **expires when its session's day ends** in `Asia/Nicosia`, through the same
  `endOfDay()` the cancellation cutoffs use — not a second timezone, and not
  UTC, which on a Tuesday-evening class would kill it mid-class;
- it **does not open until that day begins**, so a code photographed a week early
  lists nobody and instead says which evening it is for.

A tighter window keyed to the start time was considered and dropped: a session's
start is frozen **per booking**, so an evening with nothing booked yet has no
instant to measure from — and the person that would refuse is the admin scanning
the sheet to check it works.

### The parts that look cosmetic and are not

**`codeFor()` is idempotent per (activity, date)**, through a `for-` pointer. If
re-opening the admin panel minted a fresh token, every poster already on a wall
would stop working the moment somebody looked at the screen.

**The title and slug are frozen onto the token**, so the public endpoint reads no
repository at all. A public handler holding a GitHub credential is a different
class of thing, for a string that was printed weeks ago and cannot change on the
wall anyway.

**An invented token and an expired one answer identically**, and so do "not on
this list", "cancelled" and "some other evening" — telling them apart would say
whether a code ever existed, or let the list be probed for names it does not
show.

**Tapping twice is a success.** Two people scanning one poster in the same
minute, or one person tapping again because the first tap was not obviously
received, must not produce a failure on a screen held in a doorway. A name
already marked **stays on the list, shown as done** rather than disappearing — a
name that vanishes after a tap reads as a tap that went wrong.

**A walk-in is told to speak to a teacher.** Creating a participant here would be
an unauthenticated stranger writing a child's record in the EU, which is the one
thing this project is most careful about. Out of scope, deliberately, and said on
the page rather than left to be discovered.

### ⚠ One page, three languages — the exception to the rule

Every other trilingual screen has a file per language, because the reader arrives
from a link or a menu that already knows which language they read. **Nobody
arrives here from a link.** They arrive from a code on a wall, and one poster
cannot be three posters.

So the language is chosen **on** the page and the toggle **re-renders in place
rather than navigating** — which also means it cannot drop the token out of the
query string, the exact bug that shipped once on the account pages and turned a
valid invitation into a dead one. It opens in the browser's own language when
that is one of the three, and Hebrew otherwise.

There is **no nav and no footer**, which is not an omission: this is opened in a
doorway, one-handed, to do one thing, and a site menu here is a way to leave the
only screen that matters. Rows are 60px.

**The QR picture is drawn in the browser** and the URL is printed under every
code. A QR is a picture of a string, so the handler returns the string; if the
CDN that draws it is unavailable the address is still on screen, still correct
and still typeable — the same trade the Quill fallback makes. `admin.css` carries
a `@media print` block, because a card is a thing that gets pinned to a wall.

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

⚠ **The Group cell is a control, because correcting one must not move money.**
A child put in Beginners who belongs in Advanced is ordinary, and there was no
control for it anywhere &mdash; so the only route was to **cancel and register
again**, which writes a credit, sends a cancellation email, re-freezes the terms
at today's price and re-decides the yearly fee. All of it real, none of it
wanted, to fix a dropdown. `moveGroup` had existed server-side the whole time
with nothing calling it.

It is a **select rather than a button**: the entire action is choosing one of two
or three things, and a button here opens a dialog whose only content is this
control. Cosmetic like every check on this side &mdash; a pooled activity, a role
without `approve`, or a registration that is over gets the frozen name instead,
and the server re-decides all three. A **full group is offered and disabled**
rather than hidden, and the room check server-side **excludes the registration
being moved**, or a group is full of the very person trying to leave it. A move
redraws the whole queue, because the capacity line counts both groups.

The history entry said `moved to grp-1f3a9c` &mdash; an id is the one spelling
nobody reading a record months later can resolve, which is why `groupName` is
frozen at all. It names **both** groups now: the frozen one on the way out and
the activity's current one on the way in, which is correct rather than
inconsistent.

⚠ **And the parity test now runs in BOTH directions.** It checked that every
action the screen sends exists on the server, and carried a comment saying the
reverse was not required &mdash; while **four** actions accumulated behind that
sentence with nothing calling them. A missing button is silent in a way a missing
endpoint is not: nobody presses it, nothing 400s, and the capability is simply
absent from the product while its code sits in the repository passing its tests.
An unreachable action is allowed and has to be **named** in `UNREACHED` with its
reason, so writing an endpoint is no longer enough to consider a thing built. It
prints the remaining three on every run: `register`, `markAttendance` and
`recordSessionPayment` &mdash; **there is no admin screen for an evening**, so
attendance is written by the QR check-in page and nothing else, and a teacher
with no signal cannot take the register.

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

### ⚠ A cancellation used to send nothing at all

Every other state change on a registration sent a message — registered,
confirmed, not offered, we did not answer in time, payment received — and
**cancelling sent silence**. The only trace was a reason typed into the history
for an admin to read later.

That was survivable while the confirmation called a registration a *request*. It
stopped being survivable the moment the confirmation started saying
**registered**: a place a family was told they had, taken away with no message,
is the one gap in the sequence they would notice and could not explain.

`sendCancelled` is the sixth message. Four rules carry it:

- **The figure comes from the ledger entry that was written**, never from a
  second call to `creditFor()`. Two computations of one number is how an email
  and a ledger come to disagree about what somebody is owed, and the family reads
  the email.
- **After the ledger, never before.** The email rule here is that a send never
  blocks the action; the money rule is the opposite, and **the money rule decides
  the order**. A credit not written is money lost with nobody able to tell; a
  message not sent leaves a person who can ask.
- **No credit line when the credit is zero.** Nothing on this site has collected
  money yet, so every cancellation today credits nothing — and *"credited
  €0.00"* reads as a decision taken against the family rather than as the
  arithmetic of an activity nobody has paid for. The sentence appears only once
  there is a figure.
- **Two send paths, one message.** A guardian cancelling their own place gets it
  immediately, because nobody is at a screen to review it. An admin cancelling
  somebody else's reviews it first, exactly as a rejection is reviewed. The
  difference is one optional argument, not a second message.

**One panel now serves both decisions.** Rejecting and cancelling have different
permissions and different consequences, and the review is the same job in both.
A second copy would be a second place for the sanitise contract, the language
warning and the did-the-email-go reporting to drift. The `window.prompt` that
used to collect a cancellation reason is gone — a prompt cannot show a family
the message about to be sent to them — and its job survives as an explicit
**internal note** field, which goes to the history and the audit trail and never
into the family's copy.

⚠ **This draft carries money, which the rejection draft does not.** The cutoffs
are days, so a panel opened at 23:59 and sent at 00:01 can straddle one, and the
family would be told a figure nobody credited them. So the draft's number travels
back with the message and is compared **before anything is cancelled** — the
same shape as the optimistic lock on an activity record, and the same answer:
409, `reason: 'credit-moved'`, nothing touched.

### ⚠ A refusal nobody can see is a dead button

Reported as *"clicking Create account does nothing"*. The API was fine: the
address already had an account and the server answered 409 saying so, in words.

Sign-up is the tallest form in the family area — seven fields, a language picker
and the terms — so the submit button sits near the fold while the one notice
renders above the heading, off screen. The refusal explained itself perfectly to
a part of the page nobody was looking at.

`say()` scrolls the notice into view and sets `aria-live`: off screen and
unannounced are the same failure twice. Fixed in the one place rather than by
moving a message next to one button, because there is one notice and a dozen
forms, and the next tall form would bring it straight back.

### The nav says Roster, and Admins

`Registrations` became **Roster** and `Accounts` became **Admins**. The filenames
did not move — `admin/registrations.html` is still the page, so nothing
bookmarked broke.

*Manage Activities* was the alternative and was refused: the bar would have read
**Activities · Manage Activities · Admins**, and a reader would have had to work
out which of the two they wanted — when the honest answer ("one edits the page,
one lists the people") is exactly what that label fails to say. The CMS is also
the entry that genuinely manages activities. Two entries sharing a word is worse
than one vague word.

**Admins** because that page is admin logins and roles, and has nothing to do
with the family accounts this screen is full of. Once the roster started showing
account emails, `Accounts` was not vague, it was wrong.

### ⚠ A refusal is read before it is sent

The one message on this site an admin may rewrite before it goes, edited in the
**same Quill build `admin/activities.html` loads** for the activity body, with the
same textarea fallback when the CDN is unavailable.

The reason is the one already written above `REJECTED`: approval is binary and
carries no reason code, so the generated message **cannot explain itself** — it
opens a door instead ("reply and we will talk it through"). That is the right
default and a poor answer when the admin pressing the button already knows the
reason, because the alternative is a second email the family has to connect to
the first. Nothing else is editable: a confirmation and a receipt state facts,
and an expiry message is an apology.

Four things hold it together.

**⚠ THE DRAFT IS IN THE FAMILY'S LANGUAGE, NOT THE ADMIN'S.** An admin rejecting
a Russian-reading family is handed Russian to edit. That is the awkward part of
the feature and it is not hidden or worked around — `rejectPreview` returns
`lang` and the panel names it in words rather than as a code, and sending the
generated text untouched is the default. Rewriting it in the admin's own
language would send a family a message they cannot read, which is worse than a
formal one they can.

**The shell owns the typography, the author owns the words.** Quill strips inline
styles and so does `sanitiseRich()` — correctly, since `style` is exactly what an
allowlist exists to remove — so a body coming back from the editor carries bare
`<p>` tags, and an email has no stylesheet. Authoring the spacing into the draft
would mean every reviewed message arrived spaced unlike every generated one. So
`shellRaw()` applies it on the way out, and the draft is bare markup: **what the
editor opens on is what it can hand back unchanged**. A test asserts a draft
opened and sent with no edit is **byte-identical** to the generated message, in
all three languages — the property `preview-matches-publish` asserts about a page.

**A blank message is refused before the decision is taken.** Refusing afterwards
would leave a family rejected with nothing sent, and a rejection is the one
message `_email-log.js` marks unresendable. The check is on `strip()`ped text,
not on the markup's length: `<p><br></p>` is three tags and no words.

**`emailed` is reported.** `settle()` already answered whether a send succeeded
and nothing read it. The decision still stands when mail fails — that rule is
untouched — but an admin who has just written a refusal by hand must not be left
believing a family was told something nobody told them, so the row says so
loudly and tells them to make contact another way.

**`sanitiseRich()` moved into `_sanitise-rich.js`**, unchanged, and
`activities-admin.js` re-exports it so nothing that imported it from there had to
change. There are two callers now — a published page and an inbox — and both
print the markup unescaped, so a second implementation would be a second
allowlist to keep in step; a test asserts there is exactly one. It was lifted
rather than imported because requiring `activities-admin.js` would drag GitHub,
Blobs, the template and the image pipeline into a handler with ten seconds to
answer in, to clean one string.

### ⚠ Why this shipped a release before the family area

The guardian-facing area (Phase 6) is a **public registration surface**, and at
the time this screen was built `ogen-legal-review` was `pending` on every page.
The admin is explicitly the other side of that line — the gate's own comment
says "building the admin side of registration is exactly what this gate is meant
to allow" — so this shipped and the family area could not.

The gate opened when English became the declared binding version and both its
pages were confirmed `complete`, which is what let Phase 6 follow. The ordering
is worth keeping in mind rather than treating as an accident: the admin side has
no dependency on that gate at all, so it is always the half that can be built
while the words are still being argued about.

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
  the About and activity pages, every string in `_account-email.js` and
  `_registration-email.js`, and now the ~76 refusals in `_family-errors.js`.
  Flagged inline at the top of each `/ru/` file and at the top of both mail
  modules. The refusals are the newest and largest addition to that pile and
  the Hebrew in them wants a read too.
- **English activity copy** is a first-pass translation of the approved Hebrew
  and has not been proofread, including the status strings in `js/activity.js`.
- **`/about` is placeholder copy** (`[content needed]`), hence `noindex` and no
  sitemap entry.
- **`/privacy` and `/terms` are live, `final` and linked** from the footer in
  all three languages, and no longer block the registration system. The gate is
  **open**: English is the binding version and both its pages are
  `ogen-legal-review: complete`, as are both Hebrew pages; Russian is a declared
  `courtesy` translation and says so on the page. ⚠ The **Russian text and the
  two Russian price labels are still awaiting a native-speaker review** — a
  quality and trust item now rather than a blocker. See the Legal pages
  section.
- **Nothing in the nav links to `/about`.** It is still `[content needed]`
  placeholder copy carrying `noindex`, and a menu entry is exactly how a
  placeholder page gets found. `/activities` **is** linked now — see **The
  Activities group** — and so are the account chip and the hamburger's
  `/account` entry.
- **Registration is wired end to end.** The `open` CTA defaults to
  `/account/activity?register=<slug>` in the reader's own tree, and the family area is
  the public surface behind it, with no override field. **A drop-in registers
  and pays in one step** — who, which dates, Checkout — rather than walking a
  term's machinery; see **Registering for a drop-in is ONE step**. What is still
  not built is the **public
  places-left count** on the static activity page and `memberVisibleRows()` —
  both deliberate, both described above.
  **Phase 1 is done** — the activity side: `activityId`, `type`, the
  registration settings block, the session calendar and its table on the page,
  groups and `perSessionPrice`. All of it ships to the live site.
  **A group is the unit**: every activity has at least one, seven facts belong
  to it, and one group is not a choice. See **A group is the unit** for the
  whole of it, and ⚠ note the one visible change to a published page — a single
  group prints its size and no longer prints "1 group".
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
  **Phase 6 (the family area) is done**: sign up, sign in, reset, verify, the
  people on an account and their guardians, the invitation flow, registering for
  an activity, cancelling, and the credit balance — in all three languages, from
  one string table. `/admin/registrations.html` is the admin's side of the same
  system. It is now **three signed-in screens** rather than one — a dashboard,
  `/account/details`, and `/account/activity` — and the area is about the
  **family**, the account holder included, rather than about children. A DOM
  shim in `tests/_dom.js` runs all three.
  **Phase 7 (pay-per-session) is done**: the attendance store, per-date capacity,
  the all-or-nothing per-session cancellation, and the register. All seven
  phases of the registration system are built.
  The gate that held Phase 6 opened when English became the binding version and
  was confirmed reviewed; the Russian is now a declared courtesy translation.
- **Rotate the setup credentials.** The GitHub PAT and Netlify token were pasted
  into a chat transcript during setup.
