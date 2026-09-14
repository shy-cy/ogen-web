// The visual shell every message this site sends is built in, and the small
// helpers around it.
//
// Lifted out of _account-email.js when registration messages arrived. It had
// said from the beginning that there is ONE shell "so they cannot drift apart
// visually", and a second family of messages was the moment that either became
// a shared module or became two copies. Inline styles because an email client
// is not a browser and a stylesheet is not reliably applied; kept to the few
// that matter.
//
// The palette is Ogen's, by hand: an email cannot read shared.css, so these are
// the one place in this repository where the tokens are restated as literals.

const SITE = 'https://www.ogen.cy';
const LANGS = ['he', 'en', 'ru'];
const lang = (l) => (LANGS.indexOf(l) !== -1 ? l : 'he');

// Per-language path, so a link lands a reader in their own tree rather than in
// the Hebrew default with a language switch to find.
const pathFor = (l, p) => SITE + (l === 'he' ? '' : '/' + l) + p;

const DIR = { he: 'rtl', en: 'ltr', ru: 'ltr' };

const FOOT = {
  he: 'מרכז עוגן · לימסול, קפריסין · ogen.cy',
  en: 'Merkaz Ogen · Limassol, Cyprus · ogen.cy',
  ru: 'Центр Оген · Лимассол, Кипр · ogen.cy'
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// A plain-text twin for every message. Not a fallback nobody sees: a mail
// client that blocks HTML shows this, and a message with no text part is more
// likely to be filtered before anyone decides whether to trust it.
const strip = (html) => html
  .replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g, '$2: $1')
  .replace(/<[^>]+>/g, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

function shell(l, heading, paragraphs, button) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;">${p}</p>`).join('\n');
  const cta = button
    ? `<p style="margin:24px 0;"><a href="${esc(button.href)}" style="background:#C8674A;color:#ffffff;` +
      `padding:12px 22px;border-radius:6px;text-decoration:none;display:inline-block;">${esc(button.label)}</a></p>`
    : '';
  return `<div dir="${DIR[l]}" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;` +
    `line-height:1.6;color:#2F3E46;max-width:560px;margin:0 auto;padding:24px;">
<h1 style="font-size:20px;margin:0 0 18px;">${esc(heading)}</h1>
${body}
${cta}
<hr style="border:0;border-top:1px solid #E4DFD3;margin:28px 0 14px;">
<p style="font-size:12px;color:#6B705C;margin:0;">${esc(FOOT[l])}</p>
</div>`;
}

module.exports = { SITE, LANGS, lang, pathFor, DIR, FOOT, esc, strip, shell };
