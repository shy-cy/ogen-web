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
                   'h2', 'h3', 'ul', 'ol', 'li', 'a', 'blockquote'];

function sanitiseRich(value) {
  let html = String(value == null ? '' : value);
  // Drop whole elements whose CONTENT is dangerous, not just their tags: the
  // text inside a <script> is code, and keeping it would paste it into the page.
  html = html.replace(/<(script|style|iframe|object|embed|template)[\s\S]*?<\/\1\s*>/gi, '');
  // The attribute part deliberately allows a quoted value to contain '>', or a
  // tag like <a href="data:text/html,<script>"> ends at the wrong character and
  // leaks the rest as text.
  html = html.replace(/<\/?([a-z0-9]+)((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi, (whole, tag, attrs) => {
    const name = tag.toLowerCase();
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

module.exports = { sanitiseRich, RICH_TAGS };
