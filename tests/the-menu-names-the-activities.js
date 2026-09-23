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
const byKey = {};
T.STATUS_GROUPS.forEach((g) => { byKey[g.key] = g.statuses; });
H.eq(JSON.stringify(arr('OPEN')), JSON.stringify(byKey.open),
  'js/nav.js OPEN matches the template, including the ORDER, which is the menu order');
H.eq(JSON.stringify(arr('RUNNING')), JSON.stringify(byKey.running), 'RUNNING matches');
H.eq(JSON.stringify(arr('ARCHIVED')), JSON.stringify(byKey.archived), 'ARCHIVED matches');
// The mapping itself, spelled out — this is the decision, and it should be
// readable here rather than inferred from two arrays.
H.eq(byKey.open.slice().sort().join(','), 'announcement,open,waitlist',
  'Open holds announcement, open AND waitlist — a waitlist is still accepting interest');
H.eq(byKey.running.join(','), 'closed', 'Currently Running is exactly `closed`');
H.eq(byKey.archived.slice().sort().join(','), 'cancelled,completed', 'Archived is the two terminal ones');
// Every public status is in exactly one group. The module asserts this at
// require time; this proves the assertion is reached rather than trusting it.
const all3 = [].concat(byKey.open, byKey.running, byKey.archived);
H.eq(all3.slice().sort().join(','), IDX.PUBLIC_STATUSES.slice().sort().join(','),
  'between them they are exactly the statuses that reach the index — no status has no home');
H.ok(T.STATUSES.indexOf('draft') !== -1 && all3.indexOf('draft') === -1,
  'draft is in none of them, and cannot be — a draft has no files at all');

console.log('\n[the menu entry and the heading it jumps to say the same thing]');
LANGS.forEach((l) => {
  const table = navSrc.split(l + ': {')[1] || '';
  [['running', 'indexRunning'], ['archived', 'indexArchived']].forEach(([key, label]) => {
    const m = new RegExp(key + ":'([^']+)'").exec(table);
    H.ok(m, l + ': the menu has a ' + key + ' label');
    H.eq(m[1], T.LABELS[l][label],
      l + '.' + key + ' is character-identical to LABELS.' + label +
      ' — a link whose words change on arrival reads as the wrong link');
  });
});
// The labels themselves, so a rename has to be deliberate in all three.
H.eq(T.LABELS.he.indexRunning, 'פעיל', 'Hebrew: פעיל, not פעילות — unvocalised, פעילות is ambiguous between "activities" and "active"');
H.eq(T.LABELS.ru.indexRunning, 'Активные', 'Russian: Активные');
H.eq(T.LABELS.he.indexArchived, 'ארכיון', 'Hebrew: ארכיון');
H.eq(T.LABELS.ru.indexArchived, 'Архив', 'Russian: Архив');

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

console.log('\n[and the hero button makes the same promise the menu entry did]');
// ⚠ THE SAME BUG, ONE FLOOR DOWN. "Discover our programs" / התוכניות שלנו /
// Наши программы pointed at #offer — four themed teaser cards on the page the
// reader is already on, which is not the list and is what they are about to
// scroll past anyway. That is word for word the reason "What We Offer" left the
// menu, and the button was left behind. It is the most pressed control on the
// site and it led to a section rather than to the activities.
[['index.html', '/activities'],
 ['en/index.html', '/en/activities'],
 ['ru/index.html', '/ru/activities']].forEach(([file, href]) => {
  const hero = read(file);
  const cta = /<a href="([^"]+)" class="btn-primary">/.exec(hero);
  H.ok(!!cta, file + ' has a hero button');
  H.eq(cta[1], href, file + ': it goes to the activities listing, in its own tree');
});

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
H.ok(/padding-inline-start/.test(block) && /border-inline-start/.test(block),
  'the indent and the rail are logical');
// ⚠ THE CHEVRON IS THE EXCEPTION, and it is an exception because it was a bug.
// Built from border-inline-end it rotated about a corner that moves with the
// direction, so in Hebrew it pointed left when collapsed and right when open —
// a link's gesture on a control that is not one. Down is down in all three
// languages, so the borders are physical on purpose.
H.ok(/\.menu-chev\{[^}]*border-right[^}]*border-bottom/.test(block),
  'the chevron is built from PHYSICAL borders, so down stays down in Hebrew');
// It also sits next to the label rather than at the far end of the row: on a
// wide menu an auto margin put it most of a screen away from its own word.
H.ok(!/margin-inline-start:auto/.test(block),
  'and beside the label, not pushed to the far edge by an auto margin');
H.ok(/\.menu-group-toggle\{[^}]*width:100%/.test(block),
  'while the row stays full width, so all of it is still pressable');
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
    title: { he: 'רק בעברית' } },
  // ⚠ IN THE INDEX AND NOT IN THE MENU. A test activity is published for real —
  // the page serves, registration and payment run on it — and every route to it
  // is removed. The index keeps the row because it is the lookup that turns a
  // slug into an activityId; the menu is a way of FINDING things, which is the
  // one thing a test activity must not offer. See
  // a-test-activity-is-reachable-only-by-its-link.js.
  { slug: 'test4', status: 'open', langs: ['he', 'en', 'ru'], testActivity: true,
    title: { he: 'בדיקה', en: 'Test four', ru: 'Тест' } }
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
  H.eq(texts.filter((t) => /Test four/.test(t)).length, 0,
    'nor a TEST activity, which is in this very index and is reachable only by its own URL');
  H.eq(texts[0], 'Singing', 'open comes first, because it is the one you can act on now');
  H.ok(texts.indexOf('See all activities') !== -1, 'the way through to the full list is always there');
  H.ok(texts.indexOf('Currently Running') !== -1, 'and Currently Running, because a closed activity is in this index');
  H.ok(texts.indexOf('Archived') !== -1, 'and Archived, because a completed one is too');
  H.eq(links.filter((a) => (a.getAttribute('href') || '').indexOf('/en/') !== 0).length, 0,
    'every link stays in the reader\'s tree');
  H.eq(links.filter((a) => a.textContent === 'Currently Running')[0].getAttribute('href'),
    '/en/activities#running', 'Currently Running points at the anchor the listing page renders');
  H.eq(links.filter((a) => a.textContent === 'Archived')[0].getAttribute('href'),
    '/en/activities#archived', 'and so does Archived');
  H.eq(links.filter((a) => a.textContent === 'See all activities')[0].getAttribute('href'),
    '/en/activities', 'while See all goes to the top of the page');
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
  H.ok(texts.indexOf('פעיל') !== -1, 'Hebrew: the currently-running row, matching the page heading');
  H.ok(texts.indexOf('ארכיון') !== -1, 'Hebrew: the archive row');
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

  console.log('\n[a section with nothing in it gets no link]');
  // The listing page renders no heading for an empty group, so an unconditional
  // link would jump to an anchor that is not on the page — which does nothing at
  // all and reads as a broken menu.
  g = await group({ lang: 'en', index: INDEX.filter((a) => byKey.open.indexOf(a.status) !== -1) });
  texts = D.byTag(g.slot, 'a').map((a) => a.textContent);
  H.ok(texts.indexOf('See all activities') !== -1, 'the see-all row is still there');
  H.eq(texts.indexOf('Currently Running'), -1, 'Currently Running is absent with nothing closed');
  H.eq(texts.indexOf('Archived'), -1, 'and Archived with nothing finished');

  g = await group({ lang: 'en', index: INDEX.filter((a) => a.status !== 'closed') });
  texts = D.byTag(g.slot, 'a').map((a) => a.textContent);
  H.eq(texts.indexOf('Currently Running'), -1, 'each section is judged on its own…');
  H.ok(texts.indexOf('Archived') !== -1, '…so Archived survives while Currently Running does not');

  console.log('\n[every way this can fail leaves the plain link alone]');
  const cases = [
    ['nothing open', { index: INDEX.filter((a) => byKey.open.indexOf(a.status) === -1) }],
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
  const onlyOpen = T.renderActivitiesIndexPage([rec()], 'en');
  H.ok(onlyOpen.indexOf('activity-group') === -1, 'one group, so no headings at all');
  H.ok(/<h2>A<\/h2>/.test(onlyOpen), 'and the card title is the page\'s h2, exactly as before');

  const three = T.renderActivitiesIndexPage([
    rec(),
    rec({ slug: 'y', status: 'closed', title: { he: 'ב', en: 'B', ru: 'Б' } }),
    rec({ slug: 'z', status: 'completed', title: { he: 'ג', en: 'C', ru: 'В' } })
  ], 'en');
  ['open', 'running', 'archived'].forEach((k) => {
    H.ok(three.indexOf('id="' + k + '"') !== -1, 'the ' + k + ' anchor is rendered');
  });
  H.ok(three.indexOf('>Open for registration<') !== -1 &&
       three.indexOf('>Currently Running<') !== -1 &&
       three.indexOf('>Archived<') !== -1, 'with all three headings');
  H.ok(three.indexOf('id="open"') < three.indexOf('id="running"') &&
       three.indexOf('id="running"') < three.indexOf('id="archived"'),
    'in that order — what you can join, what is happening, what is over');
  H.ok(/<h3>A<\/h3>/.test(three) && /<h3>C<\/h3>/.test(three),
    'and the card titles drop to h3 under them — the levels follow the outline');
  H.eq((three.match(/<h1/g) || []).length, 1, 'still exactly one h1');
  LANGS.forEach((l) => {
    const p = T.renderActivitiesIndexPage([
      rec(), rec({ slug: 'y', status: 'closed' }), rec({ slug: 'z', status: 'completed' })], l);
    ['indexOpen', 'indexRunning', 'indexArchived'].forEach((k) => {
      H.ok(p.indexOf('>' + T.LABELS[l][k] + '<') !== -1, l + ': ' + k + ' is translated');
    });
  });

  console.log('\n[a closed activity is Currently Running, not archived]');
  const withClosed = T.renderActivitiesIndexPage(
    [rec(), rec({ slug: 'z', status: 'closed', title: { he: 'ג', en: 'C', ru: 'В' } })], 'en');
  H.ok(withClosed.indexOf('>Currently Running<') !== -1,
    'closed is underway — registration is shut, the activity is not over');
  H.ok(withClosed.indexOf('>Archived<') === -1, 'and nothing is archived by it');
  H.ok(withClosed.indexOf('/en/activities/z') !== -1, 'its page is still linked');

  H.done();
})();
