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

// ⚠ THE SHELL OWNS THE TYPOGRAPHY, NOT THE AUTHOR.
//
// One caller: the rejection message, which an admin may edit in the same
// WYSIWYG the activity body uses before it is sent. That editor strips inline
// styles and so does sanitiseRich() — correctly, since `style` is one of the
// attributes an allowlist exists to remove — so a body that came back from it
// carries bare <p> tags. Emails have no stylesheet: a bare <p> in an inbox is
// whatever the client decides, and the message would arrive spaced differently
// from every other mail Ogen sends.
//
// So the spacing is applied HERE, to the markup as it arrives, rather than
// being authored into it and hoping it survives. The author owns the words; the
// shell owns how they look. That also makes the round trip exact: a draft
// opened and sent unedited is byte-identical to the generated message, which a
// test pins — the same property preview-matches-publish asserts about a page.
const EMAIL_STYLE = {
  p: 'margin:0 0 14px;',
  h2: 'font-size:17px;margin:20px 0 10px;',
  h3: 'font-size:15px;margin:18px 0 8px;',
  ul: 'margin:0 0 14px;padding-inline-start:22px;',
  ol: 'margin:0 0 14px;padding-inline-start:22px;',
  li: 'margin:0 0 4px;',
  blockquote: 'margin:0 0 14px;padding-inline-start:14px;border-inline-start:3px solid #E4DFD3;color:#6B705C;',
  a: 'color:#C8674A;'
};

// Opening tags only, and only ones already carrying no attributes — which is
// every tag sanitiseRich() lets through, apart from <a href>. An <a> that
// already has its href keeps it and gains the colour.
function styleForEmail(html) {
  return String(html == null ? '' : html).replace(/<([a-z0-9]+)((?:\s[^>]*)?)>/gi, (whole, tag, attrs) => {
    const style = EMAIL_STYLE[tag.toLowerCase()];
    if (!style || /\sstyle\s*=/i.test(attrs)) return whole;
    return '<' + tag + attrs + ' style="' + style + '">';
  });
}

// The same chrome, wrapped around a body somebody WROTE rather than a list of
// sentences this codebase built.
//
// The wrapper is identical to shell()'s, deliberately. The whole reason this
// file exists is that there is one shell and the messages cannot drift apart
// visually — and a hand-edited message is the one most likely to be taken for a
// forgery if it arrives looking unlike every other mail Ogen sends.
//
// ⚠ THE CALLER SANITISES. Nothing is escaped here, exactly as `paragraphs` is
// not escaped here: shell() has always trusted its caller, and every caller does
// it with esc(). The rich caller does it with sanitiseRich().
function shellRaw(l, heading, bodyHtml, button, footnote) {
  return render(l, heading, styleForEmail(bodyHtml), button, footnote);
}

// `footnote` is small print AFTER the call to action and before the rule: the
// cancellation terms, today, and whatever else is reference rather than news.
// It sits below the button on purpose — set at body size above one, the terms
// of getting out of a thing read as a warning about the thing the message is
// delivering, and a family reads the deadline before they read that they have a
// place. It is raw HTML like shellRaw's body, because the caller has already
// escaped what it built.
function shell(l, heading, paragraphs, button, footnote) {
  return render(l, heading, paragraphs.map((p) => `<p style="margin:0 0 14px;">${p}</p>`).join('\n'),
                button, footnote);
}

function render(l, heading, body, button, footnote) {
  const cta = button
    ? `<p style="margin:24px 0;"><a href="${esc(button.href)}" style="background:#C8674A;color:#ffffff;` +
      `padding:12px 22px;border-radius:6px;text-decoration:none;display:inline-block;">${esc(button.label)}</a></p>`
    : '';
  return `<div dir="${DIR[l]}" style="font-family:Arial,Helvetica,sans-serif;font-size:15px;` +
    `line-height:1.6;color:#2F3E46;max-width:560px;margin:0 auto;padding:24px;">
<h1 style="font-size:20px;margin:0 0 18px;">${esc(heading)}</h1>
${body}
${cta}
${footnote ? `<p style="margin:0 0 14px;">${footnote}</p>` : ''}
<hr style="border:0;border-top:1px solid #E4DFD3;margin:28px 0 14px;">
<p style="font-size:12px;color:#6B705C;margin:0;">${esc(FOOT[l])}</p>
</div>`;
}

module.exports = { SITE, LANGS, lang, pathFor, DIR, FOOT, esc, strip, shell, shellRaw, styleForEmail };
