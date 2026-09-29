// What an admin may write, and nothing else.
//
// ⚠ LIFTED OUT OF activities-admin.js, unchanged, because a SECOND caller
// arrived. The rejection email can now be edited in the same editor before it
// is sent, and that markup reaches a family's inbox unescaped exactly as the
// About field reaches a published page unescaped — so it has to pass the same
// allowlist. Requiring activities-admin.js for it would have dragged in GitHub,
// Blobs, the template and the image pipeline to clean one string, on a handler
// with ten seconds to answer in.
//
// One sanitiser, two callers, and activities-admin.js re-exports it so nothing
// that already imported it from there had to change.
//
// The editor only ever produces these tags, so this is not there to fight the
// editor — it is there because the value arrives as a string in a request body
// and the server assumes the client is hostile, exactly as it does for every
// other field. Both destinations render this markup UNESCAPED, so anything not
// on this list would run.
const RICH_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
                   'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'blockquote'];

// ⚠ A HEADING IS NEVER SILENTLY DEMOTED TO PROSE.
//
// h1 and h4 used to be off the list, and an unlisted tag is STRIPPED WITH ITS
// TEXT KEPT — which is right for a <span> and wrong for a heading: the words
// survive as a bare text node and the page renders somebody's section title as
// an ordinary sentence. It is the shape of damage this file already met once,
// where three activities lost their bodies to a guess, and it is invisible in
// the editor because the editor shows the heading right up until Save.
//
// Nearly every document pasted in here opens with a `# Title`, which Quill
// converts to a real <h1>, so that was the commonest heading on the clipboard
// and the one certain to be thrown away.
//
// So headings are CLAMPED into the range the page can render rather than
// filtered. h1 becomes h2 — rule 3 allows exactly one h1 per page and the page
// already has it, in .page-header — and h5/h6 become h4, which is the deepest
// level .activity-main styles. A level is lost; a heading never is.
const HEADING_AS = { h1: 'h2', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h4', h6: 'h4' };

function sanitiseRich(value) {
  let html = String(value == null ? '' : value);
  // Drop whole elements whose CONTENT is dangerous, not just their tags: the
  // text inside a <script> is code, and keeping it would paste it into the page.
  html = html.replace(/<(script|style|iframe|object|embed|template)[\s\S]*?<\/\1\s*>/gi, '');
  // The attribute part deliberately allows a quoted value to contain '>', or a
  // tag like <a href="data:text/html,<script>"> ends at the wrong character and
  // leaks the rest as text.
  html = html.replace(/<\/?([a-z0-9]+)((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi, (whole, tag, attrs) => {
    // Clamped before the allowlist is asked, so the closing tag is renamed with
    // the opening one and the two cannot come apart.
    const name = HEADING_AS[tag.toLowerCase()] || tag.toLowerCase();
    const closing = whole.charAt(1) === '/';
    if (RICH_TAGS.indexOf(name) === -1) return '';   // strip the tag, keep its text
    if (closing) return '</' + name + '>';
    if (name === 'a') {
      const m = /href\s*=\s*"([^"]*)"/i.exec(attrs) || /href\s*=\s*'([^']*)'/i.exec(attrs);
      let href = m ? m[1].trim() : '';
      // Anything that is not plainly a link is not one. javascript: and data:
      // both execute in an href.
      if (!/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(href)) href = '';
      if (!href) return '<a>';
      return '<a href="' + href.replace(/"/g, '%22') + '" rel="noopener">';
    }
    // Every other tag keeps its name and loses its attributes — that is where
    // style, onclick and the rest would ride in.
    return '<' + name + '>';
  });
  return html.trim();
}

module.exports = { sanitiseRich, RICH_TAGS, HEADING_AS };
