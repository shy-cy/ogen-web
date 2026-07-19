# Prompt for Claude Code: sync homepage changes + add Russian

Paste everything below into Claude Code, with `reference-homepage.html` and
the `images/` folder (both attached) available in the project or uploaded
alongside this prompt.

---

## Context

`reference-homepage.html` is an approved, up-to-date single-file mockup of
the homepage — content, structure, styling, and behavior have all been
signed off. The production site currently has a different architecture
(separate `/` and `/en/` pages sharing `nav.js`, `footer.js`, and
`shared.css`). Your job is to bring production up to date with everything
in the reference file, **and** add a third language (Russian, `/ru/`) that
doesn't exist in production yet.

Treat `reference-homepage.html` as the source of truth for exact copy,
markup patterns, and CSS. Where production's file structure differs
(shared CSS/JS vs. inline), adapt the same rules into the shared files
rather than duplicating them per page.

---

## 1. Add Russian as a third language

- New route: `/ru/index.html`, mirroring the structure of `/` and `/en/`
- Russian uses `lang="ru"` and `dir="ltr"` (same direction as English)
- Update `nav.js`'s language toggle to support three options (עב / EN / RU)
  instead of two. The toggle must still:
  - Navigate between twin URLs (`/` ↔ `/en/` ↔ `/ru/`), preserving the
    current page and scroll hash
  - Keep the hamburger + language buttons pinned to the **physical right**
    edge in all three languages, and keep their internal left-right order
    identical regardless of language (don't let the buttons visually swap
    order when direction flips between Hebrew and the other two)
- Add `hreflang` alternates for all three versions on every page
  (`he`, `en`, `ru`, plus `x-default`)
- Add the three Russian-language URLs to `sitemap.xml`
- All Russian copy is provided inline in `reference-homepage.html`
  (`data-lang="ru"` blocks) — use it verbatim, but flag to the user that a
  native speaker should review it before launch; it hasn't been
  professionally checked

---

## 2. Homepage content — replace entirely with the reference file's copy

Every section's copy has changed since production was last synced. Do not
merge/diff — replace section content wholesale with what's in
`reference-homepage.html`, section by section:

- **Hero**: new H1, new H2 subheading, new body paragraph, button text
  now "התוכניות שלנו" / "Discover our programs" / "Наши программы"
  (all three languages inline in reference file)
- **About**: new eyebrow, new heading, two new body paragraphs (replaces
  any placeholder text)
- **Offer** (four cards): titles and descriptions have all changed —
  use the reference file's exact card copy for all three languages
- **Why Ogen** (new section, may not exist in production yet): add it,
  full copy in reference file
- **Vision** (new section, may not exist in production yet): add it —
  note its background is navy with white/paper text, distinct from the
  paper/stone alternation used elsewhere
- **"A Place for Everyone" section does NOT exist** — if a section like
  this exists in production from an earlier sync, remove it. It was
  built, then explicitly cut.
- **Contact**: new eyebrow + heading pattern (see heading hierarchy
  below), same form fields, placeholder text now includes all three
  languages: `"שם / Name / Имя"` etc.
- **Footer**: restructured — big logo at top → thin divider → "תודה
  לשותפינו" partner logo row → copyright line. Partner logo image files
  are in `images/partners/`.

---

## 3. Heading hierarchy (SEO — important, don't skip)

Every page must have **exactly one `<h1>`** (the hero headline). Everything
else follows this pattern, consistently, in every section:

- The small red/terracotta "eyebrow" label (icon + short text) → `<h2>`
- The large headline directly under it → `<h3>`
- The hero's own subheading (the one immediately under the H1) stays `<h2>`
- The Vision section's heading stays `<h2>` (it has no eyebrow above it)
- The four Offer card titles are `<h3>` (siblings of the Offer section's
  own H3, which is fine — multiple H3s under one H2 is valid)

Watch for browser default heading margins when converting tags — reset
`margin-top: 0` explicitly on the new H2/H3 elements or spacing will shift
unexpectedly. `reference-homepage.html` already has this handled; copy its
CSS values.

---

## 4. Logo

- Replace whatever logo asset is currently used in `nav.js` and
  `footer.js` with the new versions in `images/logos/` — these include
  the "Education · Culture · Community" tagline built into the lockup
  itself (one file per language: `logo-he.svg`, `logo-en.svg`,
  `logo-ru.svg`)
- Because the new logo has two lines of text (wordmark + tagline) instead
  of one, it needs more vertical room than the old nav logo did:
  - Nav bar height: 96px (was 76px)
  - Logo height inside nav: 78px
  - Footer logo height: 130px
- Update anything else positioned relative to the nav's height (mobile
  menu drop-down position, hero's top offset) to match the new 96px nav
  height
- Since the logo now includes the tagline, **remove any standalone
  "חינוך · תרבות · קהילה" tagline row** if one exists elsewhere on the
  page (e.g. top of hero) — it's now redundant

---

## 5. Decorative motif system

Six lightweight CSS/inline-SVG accents (no image files) are used across
the page, each in exactly one place — don't repeat the same one twice:

| Motif | Section | Notes |
|---|---|---|
| Ring/arc outline | About, top-right corner | CSS circle, bled off-corner |
| Organic scattered dots | Offer, top-left corner | Inline SVG, irregular circles |
| Leaf sprig (×2, tilted diagonally) | Contact | Hand-drawn inline SVG |
| Gentle wave line | Footer, above partner logos | Inline SVG |
| Open book watermark | Footer, bottom corner | Oversized Lucide icon, ~12% opacity |
| Diagonal hatch lines | Built but currently unused | Available if a future section needs an accent |

Exact SVG paths and positioning CSS are all in `reference-homepage.html`
— copy directly rather than recreating.

---

## 6. Icon system

- Icons are from **Lucide** (lucide.dev), not any other icon set
- Pattern used throughout: icon inside a solid-color circle (56px), icon
  itself is white (`stroke="currentColor"` inheriting `color: #fff` from
  the circle) — never a colored icon on a transparent background
- The anchor icon is used as the eyebrow marker in every section — reuse
  the same inline SVG each time, don't re-source it
- The four Offer cards use `book-open`, `music`, `users`, and
  `graduation-cap` respectively — colors are olive / terracotta / navy /
  gold in that order

---

## 7. Scrollbar fix (RTL/LTR mirroring bug — please implement exactly as described)

This was a real bug that took several iterations to solve correctly, so
implement it precisely:

- **Never set the `dir` attribute on `<html>` or `<body>`.** Both stay
  untouched permanently.
- Wrap all visible page content in a dedicated wrapper (`<div id="page">`
  in the reference file) and toggle `dir="rtl"`/`dir="ltr"` **only** on
  that wrapper via the language-switch JS.
- Force `html { overflow-y: scroll; direction: ltr; height: 100%; }` so
  the browser's scrollbar is always owned by `<html>` (which never
  changes direction) rather than being pulled along with whatever element
  toggles RTL/LTR.
- Anywhere content is positioned relative to a side (corner accents,
  margins, badges), use logical CSS properties (`inset-inline-start/end`,
  `margin-inline-start/end`) instead of `left`/`right`, so positioning
  auto-flips correctly across all three languages without per-language
  overrides.

---

## 8. Mobile fixes

- The hero photo circle must not have a fixed pixel width that refuses to
  shrink — use `width: min(340px, 78vw)` (or equivalent) so it scales
  down on narrow phones instead of causing horizontal overflow
- Add a small-screen breakpoint (~480px) that scales down the larger
  headings (56px hero H1, 32–34px section H3s) so they don't overwhelm a
  small screen

---

## 9. Meta title & description (homepage)

Current approved copy (Hebrew is primary/default, so this is what search
engines will index unless separate per-language meta is set up for `/en/`
and `/ru/`):

- **Title (HE)**: מרכז עוגן | מרכז קהילתי ישראלי בקפריסין
- **Description**: An Israeli Community Centre in Cyprus. A place where
  Hebrew, Israeli culture, and joint heritage become part of everyday
  life for children, families, and adults. *(Note: description is in
  English by explicit request even though the title is Hebrew — this
  was a deliberate choice, not an oversight.)*
- Matching Open Graph and Twitter Card tags should use the same
  title/description
- **Domain is live**: `https://www.ogen.cy/` is connected and confirmed —
  canonical, `og:url`, and JSON-LD `url` in `reference-homepage.html`
  already use this exact URL, so no domain placeholder swap is needed.
- **Still a placeholder**: `og:image`/`twitter:image` point to
  `https://www.ogen.cy/images/og-image.jpg`, which doesn't exist yet — a
  proper 1200×630 branded share image is still needed before this will
  work correctly in link previews (WhatsApp, Facebook, etc.)
- Russian equivalents for title/description should be written once
  someone reviews the RU copy for accuracy (see note in section 1)

---

## After this sync, please provide:

1. A list of anything in `reference-homepage.html` that couldn't be
   cleanly mapped into the existing shared.css/nav.js/footer.js
   architecture, so it can be resolved manually
2. Confirmation that all 12 routes (4 sections × 3 languages, or however
   many pages currently exist) still return 200 and mount correctly
3. A reminder of the existing pre-launch blockers that are unrelated to
   this sync: Formspree ID still needs to be set (in progress), and the
   OG share image still needs to be created. The domain is now live and
   resolved, no longer a blocker.
