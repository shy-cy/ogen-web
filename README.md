# Ogen Website

Bilingual (Hebrew / English) website for **Merkaz Ogen** (מרכז עוגן), a
Jewish education, culture, and community center in Cyprus. Static site
hosted on **Netlify** — no framework, no build step.

## Architecture

Two parallel language trees, sharing one stylesheet and JS-injected
header/footer (same model as the Shirat HaYam site):

- **Hebrew** lives at `/` (default, RTL).
- **English** lives at `/en/` (LTR).

Each page is single-language and contains only its own content. The nav,
footer, and contact form are injected by shared scripts, so inner pages
reuse them automatically.

```
index.html              — Hebrew homepage (RTL)
confirmation.html       — Hebrew thank-you page (form redirect target)
404.html                — not-found page (bilingual)
en/
  index.html            — English homepage (LTR)
  confirmation.html     — English thank-you page
shared.css              — all styles: tokens, nav, sections, form, footer
js/
  nav.js                — injects <nav>, language toggle (URL rewrite), mobile menu
  footer.js             — injects <footer> with partner logos
  contact-form.js       — Formspree AJAX submission + intl-tel-input phone field
images/
  hp-bg.jpg             — hero background
  kids.jpg              — hero photo
  favicon.svg           — anchor mark (Ogen = "anchor")
  logo-he.svg           — Hebrew logo lockup (nav + footer)
  logo-en.svg           — English logo lockup (nav + footer)
  partners/             — kkl, ministry, wzo, kehilot
netlify.toml            — pretty URLs, headers, 404 handling
sitemap.xml, robots.txt — SEO
```

## Bilingual model

- `<html lang="he" dir="rtl">` on Hebrew pages; `<html lang="en">` on English pages.
- Page **body** content is written once per language file — no `data-lang` spans.
- Shared **injected chrome** (footer, 404) uses `.he-only` / `.en-only` spans;
  `shared.css` shows the right one based on `<html lang>`.
- The **language toggle** in the nav navigates to the twin URL
  (`/` ↔ `/en`, `/confirmation` ↔ `/en/confirmation`), preserving the hash.

When you change copy, update **both** the HE file and its `/en/` twin.

## Contact form (Formspree)

`js/contact-form.js` renders the form into `<div id="contact-form-mount"></div>`,
loads `intl-tel-input` (Cyprus default) from CDN, and AJAX-submits to
**Formspree** — no backend. On success it shows an inline confirmation and
can redirect to `/confirmation` (or `/en/confirmation`).

**Setup required:** create a free form at <https://formspree.io>, then open
`js/contact-form.js` and replace `FORM_ID = 'YOUR_FORM_ID'` with your form's
ID (the part after `/f/` in its endpoint). Change the destination email in
the Formspree dashboard, not in code.

## ⚠️ Before going live — replace placeholders

- **Domain:** every canonical/OG/sitemap URL uses `https://www.ogen.cy` as a
  placeholder. Find-and-replace it with the real domain across
  `index.html`, `en/index.html`, the confirmation pages, `sitemap.xml`,
  and `robots.txt`.
- **Formspree `FORM_ID`** in `js/contact-form.js` (see above).
- **About section** still contains `[placeholder]` copy in both languages.

## Local preview

Absolute asset paths (`/shared.css`, `/js/…`, `/images/…`) mean the site
must be served from a root, not opened as a `file://`. Use any static
server, e.g. Netlify Dev:

```
netlify dev
```

## Deploying

Connected to Netlify: every push to `main` auto-deploys. Build command and
publish directory are handled by `netlify.toml` (publish = repo root).
