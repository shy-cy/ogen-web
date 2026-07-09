# Ogen Website

Homepage preview for Merkaz Ogen (מרכז עוגן), bilingual Hebrew/English.

## Structure

```
index.html          — homepage
images/
  hp-bg.jpg          — hero background
  kids.jpg           — hero photo
  logo-he.svg        — horizontal Hebrew logo lockup (nav + footer)
  logo-en.svg        — horizontal English logo lockup (nav + footer)
  partners/
    kkl.png          — KKL-JNF
    ministry.png     — Ministry of Diaspora Affairs
    wzo.png          — World Zionist Organization, Dept. of Education
    kehilot.png      — Kehilot Institute
```

## Local preview

No build step needed — just open `index.html` directly in a browser, or
run a simple local server from this folder if you want relative paths
to behave exactly as they will on Netlify:

```
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Deploying

This repo is set up to connect directly to Netlify:
Netlify → Add new site → Import an existing project → GitHub → select
this repo → leave build command and publish directory blank → Deploy.

Every push to `main` will auto-deploy after that.

## Notes

- Language toggle (top right) switches between Hebrew (default) and
  English. Only Hebrew is used site-wide for the logo per current
  direction.
- Scrollbar is intentionally locked to the right regardless of language:
  `dir` is toggled on the `#page` wrapper only, never on `<html>` or
  `<body>`, so the browser's own scrollbar never moves.
- Contact form uses a `data-netlify="true"` attribute, which enables
  Netlify's built-in form handling automatically once deployed — no
  extra setup needed for basic form submissions to reach your Netlify
  dashboard.
