// What this defends against:
//
// Every path in netlify.toml had a Cache-Control except the one most people
// actually request: the HTML. So Netlify's default applied — `max-age=0,
// must-revalidate` — and Cloudflare will not keep a copy of a response like
// that. Measured against www.ogen.cy, every page answered
// `cf-cache-status: DYNAMIC`, meaning an origin round trip on EVERY view:
// 0.76-4.96s on an activity page, 6.21s on the homepage, while /shared.css sat
// beside them at 0.33s and REVALIDATED, because the edge was allowed to keep
// THAT.
//
// The fix is s-maxage, which speaks only to a shared cache. max-age stays 0, so
// a returning browser still revalidates and still sees a publish immediately;
// what changes is that a shared cache may answer repeat traffic itself.
//
// ⚠ Measured after deploying: the shared cache that honours it is NETLIFY'S,
// not Cloudflare's. Cloudflare still answers cf-cache-status: DYNAMIC, because
// it caches by file extension by default and HTML is not in that set — only a
// dashboard Cache Rule changes that, and no Cache-Control value can. Netlify's
// own CDN was revalidating to origin on every request and now does not, which
// took the homepage from 6.21s to ~0.30s. The header is right; the hop it
// turned out to fix was one earlier than intended.
//
// SIXTY SECONDS is the number, and the reasoning is what this pins. It is the
// window in which a stale page can be served after a publish — and a Netlify
// deploy already takes about a minute to go live, so at 60s the edge adds
// nothing a publisher can perceive. Raise it without purging Cloudflare on
// deploy and an admin reloads a page that has already changed, concludes the
// publish failed, and publishes again. That exact confusion is why /admin/* is
// no-cache.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const toml = fs.readFileSync(path.join(R, 'netlify.toml'), 'utf8');

// Pull each [[headers]] block with its `for` and its values.
function blocks() {
  const out = [];
  const parts = toml.split(/\[\[headers\]\]/).slice(1);
  parts.forEach((p) => {
    const stop = p.search(/\n\[\[/);
    const chunk = stop === -1 ? p : p.slice(0, stop);
    const forM = chunk.match(/for\s*=\s*"([^"]+)"/);
    if (!forM) return;
    const vals = {};
    chunk.replace(/^\s*([A-Za-z-]+)\s*=\s*"([^"]*)"/gm, (_, k, v) => { vals[k] = v; return ''; });
    out.push({ for: forM[1], values: vals });
  });
  return out;
}
const B = blocks();
const find = (p) => B.filter((b) => b.for === p);

console.log('[the catch-all lets a shared cache keep the HTML]');
const all = find('/*');
H.eq(all.length, 1, 'there is one /* block');
const cc = all[0].values['Cache-Control'];
H.ok(cc, '/* declares a Cache-Control at all — this is what was missing');
H.ok(/s-maxage=(\d+)/.test(cc), 'and it carries an s-maxage for the edge');
const s = parseInt(cc.match(/s-maxage=(\d+)/)[1], 10);
H.ok(s >= 30, 's-maxage is long enough to be worth having (' + s + 's)');
H.ok(s <= 300,
  's-maxage stays short (' + s + 's) — longer needs a Cloudflare purge on deploy, ' +
  'or an admin sees a stale page after publishing and republishes');

console.log('\n[but the BROWSER still revalidates, so a publish is never hidden]');
H.ok(/max-age=0/.test(cc), 'max-age is 0');
H.ok(/must-revalidate/.test(cc), 'and must-revalidate');
H.ok(!/\bimmutable\b/.test(cc), 'and never immutable — these files change on every publish');

console.log('\n[the paths that had their own rules still do]');
// These were all set for reasons written up in netlify.toml itself; a catch-all
// Cache-Control must not read as permission to collapse them.
const specific = {
  '/images/*': /max-age=31536000/,
  '/images/activities/*': /max-age=300/,
  '/admin/*': /no-cache/
};
Object.keys(specific).forEach((p) => {
  const hit = find(p).filter((b) => b.values['Cache-Control']);
  H.ok(hit.length >= 1, p + ' still has its own Cache-Control');
  H.ok(specific[p].test(hit[0].values['Cache-Control']),
    p + ': ' + hit[0].values['Cache-Control']);
});
// The uploads path must stay NON-immutable: Netlify applies these headers to
// 404s too, and a transient 404 under a year-long immutable cache stuck
// permanently in a real visitor's browser.
const up = find('/images/activities/*')[0].values['Cache-Control'];
H.ok(!/immutable/.test(up),
  '/images/activities/* is deliberately not immutable — a cached 404 there was permanent');

console.log('\n[the security headers survived the edit]');
['X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy'].forEach((h) => {
  H.ok(all[0].values[h], '/* still sets ' + h);
});

H.done();
