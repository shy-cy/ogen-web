# Ogen Website

Trilingual (Hebrew / English / Russian) website for **Merkaz Ogen**
(מרכז עוגן), an Israeli community centre in Cyprus. Static site hosted on
**Netlify** — no framework, no build step.

## Architecture

Three parallel language trees, sharing one stylesheet and JS-injected
header/footer:

- **Hebrew** at `/` (default, RTL)
- **English** at `/en/` (LTR)
- **Russian** at `/ru/` (LTR)

Each page is single-language and contains only its own content. The nav,
footer, and contact form are injected by shared scripts, so pages reuse
them automatically.

```
index.html              — Hebrew homepage
confirmation.html       — Hebrew thank-you page (form redirect target)
404.html                — not-found page (trilingual, language from URL)
en/index.html, en/confirmation.html   — English
ru/index.html, ru/confirmation.html   — Russian
shared.css              — all styles: tokens, nav, sections, form, footer
js/
  nav.js                — injects <nav>, 3-language toggle (URL rewrite), mobile menu
  footer.js             — injects <footer> with tagline logo + partner logos
  contact-form.js       — Formspree AJAX submission + intl-tel-input phone field
images/
  hp-bg.jpg, kids.jpg   — hero background + photo
  favicon.svg, favicon-32.png, apple-touch-icon.png   — Ogen emblem icon set
  logos/                — logo-he.svg, logo-en.svg, logo-ru.svg (wordmark + tagline lockup)
  partners/             — kkl, ministry, wzo, kehilot
netlify.toml            — pretty URLs, headers, 404 handling
sitemap.xml, robots.txt — SEO
```

## Language & direction model

- `<html lang="he|en|ru">` — **never** with a `dir` attribute.
- **Scrollbar fix:** `<html>` is forced `direction:ltr` so it always owns the
  scrollbar. All visible content is wrapped in `<div id="page" dir="…">`, and
  direction lives only on that wrapper (`rtl` for HE, `ltr` for EN/RU). nav and
  footer are injected into `#page`. Side-relative positioning uses logical
  properties (`inset-inline-*`) so it flips per language automatically.
- Page **body** content is written once per language file (no `data-lang` spans);
  the 404 is the one page that inlines all three via `data-lang`.
- The **language toggle** navigates to the twin URL (`/` ↔ `/en` ↔ `/ru`,
  `/confirmation` ↔ `/en/confirmation` ↔ `/ru/confirmation`), preserving the hash.

**When you change copy, update all three language files.** The approved
source of truth for copy/markup/styling is `ogen-handoff/reference-homepage.html`.

## Heading hierarchy (SEO)

Exactly one `<h1>` per page (the hero headline). Every section eyebrow is an
`<h2>`; the large headline under it is an `<h3>`. The hero subheading and the
Vision heading are `<h2>`. The four Offer card titles are `<h3>`. Heading
margins are reset in `shared.css` so tag changes don't shift spacing.

## Contact form (Formspree)

`js/contact-form.js` renders the form into `<div id="contact-form-mount"></div>`,
loads `intl-tel-input` (Cyprus default) from CDN, and AJAX-submits to
**Formspree** — no backend. It localizes per page (HE/EN/RU) and redirects to
`/confirmation`, `/en/confirmation`, or `/ru/confirmation` on success.

Wired to Formspree form `xpqgvple` → michal.shin@gmail.com. To change the
destination email, use the Formspree dashboard, not code.

## ⚠️ Before going live

- **OG share image:** `og:image` / `twitter:image` point to
  `https://www.ogen.cy/images/og-image.jpg`, which **does not exist yet**. A
  1200×630 branded image is needed for link previews (WhatsApp/Facebook).
- **Russian copy** is drafted from the reference but **has not been reviewed by
  a native speaker** — including the `/ru/` `<title>` and meta description
  (marked with a note in `ru/index.html`).
- **Domain** `https://www.ogen.cy` is live (www primary).

## Local preview

Absolute asset paths mean the site must be served from a root, not opened as a
`file://`:

```
npx serve .        # or: netlify dev
```

## Deploying

Connected to Netlify: every push to `main` auto-deploys. Publish directory and
pretty URLs are handled by `netlify.toml` (publish = repo root).
