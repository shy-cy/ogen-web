// What this defends against:
//
// The menu used to carry "What We Offer", pointing at the homepage's four themed
// cards, and nothing in the nav reached /activities at all — a published
// activity was findable only by someone who already knew the URL. CLAUDE.md
// carried that as an open item for months.
//
// The replacement is an accordion built at runtime from the generated index, and
// three things about it are easy to get wrong in ways nothing shows:
//
//   1. THE STATUS SPLIT EXISTS TWICE. _activity-template.js groups the listing
//      page by it; js/nav.js filters the menu by it. The server cannot be
//      required from a browser, so there is no way to share the array — only a
//      test comparing the two. Drift means the menu offers a link to a section
//      the page does not render, or hides an activity the listing shows.
//   2. IT MUST FAIL OPEN. The plain /activities link ships in the HTML and is
//      only REPLACED once the index has been read. Every failure path — no
//      fetch, a 404, unparseable JSON, nothing live — has to leave that link
//      alone. A menu that loses its way to the activities because a JSON file
//      moved is worse than a menu with no accordion.
//   3. "Past activities" LINKS TO AN ANCHOR THAT HAS TO EXIST. The listing page
//      renders no #past heading until something is actually past, so the menu
//      entry has to be absent until then or it jumps to nothing.
//
// It also pins the thing the sister project gets wrong and this deliberately
// does not: bounding the list with max-height + overflow:hidden, which leaves
// rows past the clamp in the DOM — focusable, announced by a screen reader, and
// invisible — with nothing saying the list was cut.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const D = require('./_dom');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const navSrc = read('js/nav.js');
// COMMENT-STRIPPED, because every check below is looking for a declaration and
// this file's comments discuss the very things being looked for — "#offer",
// "max-height", "[lang=". A naive search finds the prose and passes whether or
// not the code is still there. The repo has been caught by this twice.
const navCode = navSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const T = require(H.fnPath('_activity-template'));
const IDX = require(H.fnPath('_activity-index'));
const LANGS = ['he', 'en', 'ru'];

console.log('[the status split is the same one in both halves]');
const arr = (name) => {
  const m = new RegExp('var ' + name + ' = \\[([^\\]]*)\\]').exec(navSrc);
  return m ? m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean) : null;
};
H.eq(JSON.stringify(arr('LIVE')), JSON.stringify(T.LIVE_STATUSES),
  'js/nav.js LIVE matches _activity-template.js LIVE_STATUSES — including the ORDER, which is the menu order');
H.eq(JSON.stringify(arr('PAST')), JSON.stringify(T.PAST_STATUSES),
  'and PAST matches PAST_STATUSES');
// Every public status is on exactly one side. The module asserts this at require
// time; this proves the assertion is reached rather than trusting it.
const both = T.LIVE_STATUSES.concat(T.PAST_STATUSES);
H.eq(both.slice().sort().join(','), IDX.PUBLIC_STATUSES.slice().sort().join(','),
  'and between them they are exactly the statuses that reach the index');
H.ok(T.STATUSES.indexOf('draft') !== -1 && both.indexOf('draft') === -1,
  'draft is in neither, and cannot be — a draft has no files at all');

console.log('\n[the menu entry and the heading it jumps to say the same thing]');
LANGS.forEach((l) => {
  const menu = new RegExp("past:'([^']+)'").exec(navSrc.split(l + ': {')[1] || '');
  H.ok(menu, l + ': the menu has a past label');
  H.eq(menu[1], T.LABELS[l].indexPast,
    l + ': it is character-identical to LABELS.indexPast — a link whose words change on arrival reads as the wrong link');
});

console.log('\n["What We Offer" is gone, and Activities is in its place]');
H.ok(!/offer:/.test(navCode), 'the offer string is deleted, not left unused');
H.ok(!/#offer/.test(navCode), 'and nothing links to the homepage section from the menu');
H.ok(/activities-slot/.test(navSrc), 'there is a slot to replace');
H.ok(/<a href="\$\{base\}\/activities"/.test(navSrc),
  'and a plain /activities link ships inside it, so the menu works before any script does');
// The homepage section itself is untouched — the entry went, not the content.
H.ok(/id="offer"/.test(read('index.html')), 'the #offer section is still on the Hebrew homepage');
H.ok(/id="offer"/.test(read('en/index.html')) && /id="offer"/.test(read('ru/index.html')),
  'and on the other two');

console.log('\n[the CSS mirrors on its own]');
const css = read('shared.css');
// Sliced from the first DECLARATION, not from the comment above it — starting
// mid-comment leaves the opening /* outside the slice, so the comment survives
// stripping and its own prose answers the search.
const rawBlock = css.slice(css.indexOf('.mobile-menu .menu-group{'),
                           css.indexOf('/* ============================== HERO'));
const block = rawBlock.replace(/\/\*[\s\S]*?\*\//g, '');
H.ok(rawBlock.length > 400, 'the block is there');
H.eq((block.match(/(^|[^-])(left|right)\s*:/g) || []).length, 0,
  'not one directional property — the sister project uses a pair of rules per element');
H.ok(!/\[lang=/.test(block), 'and no per-language override at all');
H.ok(/padding-inline-start/.test(block) && /border-inline-start/.test(block) &&
     /margin-inline-start:auto/.test(block), 'the indent, the rail and the chevron are all logical');
// ⚠ The one the sister project gets wrong.
H.ok(!/max-height/.test(block),
  'collapsed by display:none, never by a max-height clamp that leaves rows reachable and invisible');
H.ok(/scroll-margin-block-start/.test(css.slice(css.indexOf('.activity-group'))),
  'and #past clears the 96px fixed nav when jumped to');

// ---------------------------------------------------------------- running it
const INDEX = [
  { slug: 'open-one', status: 'open', langs: ['he', 'en', 'ru'],
    title: { he: 'זמרה', en: 'Singing', ru: 'Пение' } },
  { slug: 'announced-one', status: 'announcement', langs: ['he', 'en', 'ru'],
    title: { he: 'ריקודי עם', en: 'Folk dancing', ru: 'Народные танцы' } },
  { slug: 'waitlist-one', status: 'waitlist', langs: ['he', 'en', 'ru'],
    title: { he: 'מקהלה', en: 'Choir', ru: 'Хор' } },
  { slug: 'closed-one', status: 'closed', langs: ['he', 'en', 'ru'],
    title: { he: 'סגור', en: 'Closed one', ru: 'Закрытое' } },
  { slug: 'done-one', status: 'completed', langs: ['he', 'en', 'ru'],
    title: { he: 'הסתיים', en: 'Finished one', ru: 'Завершённое' } },
  { slug: 'he-only', status: 'open', langs: ['he'],
    title: { he: 'רק בעברית' } }
];

// The nav wants a #page to inject into and a fetch to read the index with.
async function menu(opts) {
  opts = opts || {};
  const dom = D.makeDom({ lang: opts.lang || 'en' });
  const page = dom.node('div');
  page.setAttribute('id', 'page');
  const els = { page: page };
  dom.document.getElementById = (id) => els[id] || findById(page, id);
  dom.document.querySelector = () => null;
  dom.document.addEventListener = () => {};
  dom.window.location.pathname = opts.lang === 'he' || !opts.lang ? '/' : '/' + opts.lang;
  if (opts.lang === 'en') dom.window.location.pathname = '/en';
  if (opts.lang === 'ru') dom.window.location.pathname = '/ru';
  dom.window.fetch = opts.fetch !== undefined ? opts.fetch : function () {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(opts.index || INDEX) });
  };
  // insertAdjacentHTML is how nav.js injects; the shim has no parser, so the
  // markup is handed over as a string and the parts this test needs are read
  // back out of it. The menu STRUCTURE is what nav.js then mutates, so that half
  // is built for real below.
  let injected = '';
  page.insertAdjacentHTML = (where, html) => { injected = html; };
  const ctx = vm.createContext({
    window: dom.window, document: dom.document, location: dom.window.location,
    console: console, fetch: dom.window.fetch, Promise: Promise, JSON: JSON,
    Object: Object, Array: Array, String: String, Date: Date, Math: Math,
    setTimeout: setTimeout, encodeURIComponent: encodeURIComponent
  });
  vm.runInContext(navSrc, ctx, { filename: 'js/nav.js' });
  return { dom, ctx, injected, page };
}
function findById(root, id) {
  let found = null;
  (function walk(n) {
    if (found) return;
    n.childNodes.forEach((c) => {
      if (found) return;
      if (c.getAttribute && c.getAttribute('id') === id) { found = c; return; }
      walk(c);
    });
  })(root);
  return found;
}

(async () => {
  console.log('\n[the markup that ships, before any fetch]');
  let m = await menu({ lang: 'en' });
  H.ok(m.injected.indexOf('id="activities-slot"') !== -1, 'the slot is in the markup');
  H.ok(m.injected.indexOf('href="/en/activities"') !== -1,
    'holding a real link in the reader\'s own tree');
  H.ok(m.injected.indexOf('What We Offer') === -1, 'and "What We Offer" is not');
  let he = await menu({ lang: 'he' });
  H.ok(he.injected.indexOf('href="/activities"') !== -1,
    'Hebrew gets /activities, not //activities — the prefix is "" and `home` is "/"');

  // Building the group for real, against the shim, by calling the same slot the
  // live script does.
  async function group(opts) {
    const dom = D.makeDom({ lang: opts.lang || 'en' });
    const slot = dom.node('div');
    slot.setAttribute('id', 'activities-slot');
    slot.appendChild(dom.node('a'));
    const menuEl = dom.node('div'); menuEl.setAttribute('id', 'mobile-menu');
    const burger = dom.node('div'); burger.setAttribute('id', 'hamburger');
    const page = dom.node('div');
    const ids = { 'activities-slot': slot, 'mobile-menu': menuEl, hamburger: burger, page: page };
    dom.document.getElementById = (id) => ids[id] || null;
    dom.document.querySelector = () => null;
    dom.document.addEventListener = () => {};
    const p = opts.lang === 'en' ? '/en' : opts.lang === 'ru' ? '/ru' : '/';
    dom.window.location.pathname = p;
    dom.window.fetch = opts.fetch !== undefined ? opts.fetch : function () {
      return Promise.resolve({ ok: !!opts.index, json: () => Promise.resolve(opts.index) });
    };
    page.insertAdjacentHTML = () => {};
    const ctx = vm.createContext({
      window: dom.window, document: dom.document, location: dom.window.location,
      console: console, fetch: dom.window.fetch, Promise: Promise, JSON: JSON,
      Object: Object, Array: Array, String: String, Date: Date, Math: Math,
      setTimeout: setTimeout, encodeURIComponent: encodeURIComponent
    });
    vm.runInContext(navSrc, ctx, { filename: 'js/nav.js' });
    ctx.window.toggleMenu();                       // the lazy load fires here
    await new Promise((r) => setTimeout(r, 25));
    return { slot, ctx, dom };
  }

  console.log('\n[opened, it names what a family can act on]');
  let g = await group({ lang: 'en', index: INDEX });
  let links = D.byTag(g.slot, 'a');
  let texts = links.map((a) => a.textContent);
  H.ok(texts.indexOf('Singing') !== -1, 'an open activity is listed');
  H.ok(texts.some((t) => t.indexOf('Folk dancing') === 0), 'an announced one too');
  H.ok(texts.some((t) => t.indexOf('Choir') === 0), 'and a waitlisted one');
  H.eq(texts.filter((t) => /Closed one|Finished one/.test(t)).length, 0,
    'a closed or completed activity is NOT — the menu is a way in, and there is nothing to enter');
  H.eq(texts.filter((t) => t.indexOf('רק בעברית') !== -1).length, 0,
    'nor one with no page in this language — `langs` is checked, or the link would 404');
  H.eq(texts[0], 'Singing', 'open comes first, because it is the one you can act on now');
  H.ok(texts.indexOf('See all activities') !== -1, 'the way through to the full list is always there');
  H.ok(texts.indexOf('Past activities') !== -1, 'and Past activities, because this index has some');
  H.eq(links.filter((a) => (a.getAttribute('href') || '').indexOf('/en/') !== 0).length, 0,
    'every link stays in the reader\'s tree');
  H.ok(links.filter((a) => a.textContent === 'Past activities')[0].getAttribute('href') === '/en/activities#past',
    'past points at the anchor the listing page renders');
  const notes = D.byClass(g.slot, 'menu-note').map((n) => n.textContent);
  H.eq(notes.join('|'), 'Coming soon|Waiting list',
    'a second line only where the status is not open — open is what a reader already assumes');

  console.log('\n[the accordion opens, and says so]');
  const toggle = D.byClass(g.slot, 'menu-group-toggle')[0];
  H.eq(toggle.getAttribute('aria-expanded'), 'false', 'it starts closed and announces it');
  toggle.click();
  H.eq(toggle.getAttribute('aria-expanded'), 'true',
    'and updates on open — the sister project never sets this at all');
  H.eq(toggle.getAttribute('aria-controls'), 'activities-sub', 'pointing at the list it opens');

  console.log('\n[Hebrew and Russian, from the same markup]');
  g = await group({ lang: 'he', index: INDEX });
  texts = D.byTag(g.slot, 'a').map((a) => a.textContent);
  H.ok(texts.indexOf('לכל הפעילויות') !== -1, 'Hebrew: the see-all row');
  H.ok(texts.indexOf('פעילויות קודמות') !== -1, 'Hebrew: the past row, matching the page heading');
  H.ok(texts.some((t) => t.indexOf('רק בעברית') === 0), 'the Hebrew-only activity IS listed in Hebrew');
  H.eq(D.byTag(g.slot, 'a').filter((a) => /^\/(en|ru)\//.test(a.getAttribute('href') || '')).length, 0,
    'and a Hebrew reader is never linked out of the Hebrew tree');
  g = await group({ lang: 'ru', index: INDEX });
  texts = D.byTag(g.slot, 'a').map((a) => a.textContent);
  H.ok(texts.indexOf('Все занятия') !== -1, 'Russian: the see-all row');
  H.ok(texts.some((t) => t.indexOf('Хор') === 0), 'and the titles come through the fallback chain');

  console.log('\n[the cap is honest]');
  const many = [];
  for (let i = 0; i < 12; i++) {
    many.push({ slug: 'a' + i, status: 'open', langs: ['en'], title: { en: 'Activity ' + String.fromCharCode(65 + i) } });
  }
  g = await group({ lang: 'en', index: many });
  const rows = D.byTag(g.slot, 'a').filter((a) => !/menu-sub-all/.test(a.className));
  H.eq(rows.length, 6, 'six rows at most');
  H.eq(D.byTag(g.slot, 'a').filter((a) => a.textContent === 'See all activities').length, 1,
    'and the twelfth activity is one tap away, not clipped out of a panel while still in the DOM');

  console.log('\n[no past activities, no past link]');
  g = await group({ lang: 'en', index: INDEX.filter((a) => T.PAST_STATUSES.indexOf(a.status) === -1) });
  texts = D.byTag(g.slot, 'a').map((a) => a.textContent);
  H.ok(texts.indexOf('See all activities') !== -1, 'the see-all row is still there');
  H.eq(texts.indexOf('Past activities'), -1,
    'and Past activities is absent — the listing renders no #past heading to jump to');

  console.log('\n[every way this can fail leaves the plain link alone]');
  const cases = [
    ['nothing live', { index: INDEX.filter((a) => T.LIVE_STATUSES.indexOf(a.status) === -1) }],
    ['the index 404s', { index: null }],
    ['the JSON is not a list', { index: { oops: true } }],
    ['the fetch rejects', { fetch: () => Promise.reject(new Error('offline')) }],
    ['there is no fetch at all', { fetch: undefined, noFetch: true }]
  ];
  for (const [label, opts] of cases) {
    const built = await group(Object.assign({ lang: 'en' }, opts,
      opts.noFetch ? { fetch: null } : {}));
    H.eq(D.byClass(built.slot, 'menu-group').length, 0, label + ': no accordion is built');
    H.eq(built.slot.childNodes.length, 1, label + ': and the plain link is untouched');
  }

  console.log('\n[the index is read once, on first open, not on every page load]');
  let calls = 0;
  const counted = await group({ lang: 'en', fetch: function () {
    calls++;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(INDEX) });
  } });
  H.eq(calls, 1, 'one request after the menu is opened');
  counted.ctx.window.toggleMenu();
  counted.ctx.window.toggleMenu();
  await new Promise((r) => setTimeout(r, 15));
  H.eq(calls, 1, 'and opening it again does not ask a second time');

  console.log('\n[the listing page grows a past section, and only then]');
  const rec = (over) => Object.assign({
    slug: 'x', status: 'open', title: { he: 'א', en: 'A', ru: 'А' },
    summary: { he: 'ס', en: 'S', ru: 'С' }
  }, over || {});
  const onlyLive = T.renderActivitiesIndexPage([rec()], 'en');
  H.ok(onlyLive.indexOf('id="past"') === -1, 'no past heading while nothing is past');
  H.ok(onlyLive.indexOf('activity-group') === -1, 'and no group headings at all');
  H.ok(/<h2>A<\/h2>/.test(onlyLive), 'the card title is the page\'s h2, exactly as before');

  const mixed = T.renderActivitiesIndexPage(
    [rec(), rec({ slug: 'y', status: 'completed', title: { he: 'ב', en: 'B', ru: 'Б' } })], 'en');
  H.ok(mixed.indexOf('id="past"') !== -1, 'a completed activity brings the anchor');
  H.ok(mixed.indexOf('>Current activities<') !== -1 && mixed.indexOf('>Past activities<') !== -1,
    'with both headings');
  H.ok(/<h3>A<\/h3>/.test(mixed) && /<h3>B<\/h3>/.test(mixed),
    'and the card titles drop to h3 under them — the levels follow the outline');
  H.eq((mixed.match(/<h1/g) || []).length, 1, 'still exactly one h1');
  LANGS.forEach((l) => {
    const p = T.renderActivitiesIndexPage(
      [rec(), rec({ slug: 'y', status: 'completed' })], l);
    H.ok(p.indexOf('>' + T.LABELS[l].indexPast + '<') !== -1, l + ': the heading is translated');
  });

  console.log('\n[a closed activity is reachable, just not from the live list]');
  const withClosed = T.renderActivitiesIndexPage(
    [rec(), rec({ slug: 'z', status: 'closed', title: { he: 'ג', en: 'C', ru: 'В' } })], 'en');
  H.ok(withClosed.indexOf('id="past"') !== -1,
    'closed lands in the past group — which is what a parent looking for their child\'s activity needs');
  H.ok(withClosed.indexOf('/en/activities/z') !== -1, 'and its page is still linked');

  H.done();
})();
