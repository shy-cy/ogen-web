// The property this defends:
//
// preview and publish must go through ONE render path. A preview that renders
// through different code is a preview that can lie about what will go live —
// and a lying preview is worse than no preview, because it is trusted.
//
// The structural guarantee is that both actions call generate(), which differs
// only in whether it commits. This suite asserts the observable consequence:
// the HTML returned by `preview` is byte-identical to the HTML the very next
// `publish` writes into the repository, for every language.
//
// If someone later adds a preview-only branch, these assertions fail.

const H = require('./_helpers');

(async () => {
  const seed = H.seedRepo();
  const github = H.makeGithub(seed.files);
  const blobs = H.makeBlobs();
  const { 'activities-admin': admin } = H.loadWithStubs({
    github, blobs, modules: ['activities-admin']
  });
  const session = await H.installSession(blobs, H.superAdminSession());
  const auth = { token: session.token };

  // A record with something in every awkward corner: optional fields, a list
  // that must reflow, an entity-ish character, and one language left blank.
  const activity = {
    slug: 'preview-check',
    status: 'open',
    motif: 'hatch',
    corner: 'br',
    ctaUrl: { he: '/#contact', en: '/en/#contact', ru: '' },
    title: { he: 'בדיקה', en: 'Preview check', ru: '' },
    about: { he: 'תיאור', en: 'Description with a & ampersand', ru: '' },
    facts: {
      ages: { min: 6, max: 10 },
      duration: { sessionCount: 30, sessionMinutes: 45 },
      price: { fullPrice: 90 }
    },
    faq: [
      { id: 'faq-a', q: { he: 'שאלה', en: 'A question', ru: '' }, a: { he: 'תשובה', en: 'An answer', ru: '' } },
      { id: 'faq-b', q: { he: '', en: '', ru: '' }, a: { he: '', en: '', ru: '' } }
    ],
    teachers: [{ id: 'tch-a', name: { he: 'מורה', en: 'A teacher', ru: '' } }],
    sponsors: []
  };

  console.log('\n[preview HTML equals the HTML that publish commits]');
  const preview = await H.call(admin.handler,
    Object.assign({ action: 'preview', activity }, auth));
  H.eq(preview.status, 200, 'preview succeeds');
  H.ok(preview.body.dryRun === true, 'preview is flagged as a dry run');
  H.eq(github._commits.length, 0, 'preview committed nothing');

  const publish = await H.call(admin.handler,
    Object.assign({ action: 'publish', baseUpdatedAt: null, activity }, auth));
  H.eq(publish.status, 200, 'publish succeeds');

  // The record gains a timestamp on save, which legitimately differs between
  // the two calls. It is not rendered into the page, so the HTML must match.
  ['he', 'en'].forEach((lang) => {
    const path = lang === 'he' ? 'activities/preview-check.html' : `${lang}/activities/preview-check.html`;
    H.eq(preview.body.html[lang], github._files.get(path),
         `${lang}: previewed HTML is byte-identical to the committed file`);
  });

  console.log('\n[preview shows the file list it would commit]');
  const previewPaths = preview.body.files.map((f) => f.path).sort();
  const committedPaths = publish.body.files.map((f) => f.path).sort();
  H.eq(JSON.stringify(previewPaths), JSON.stringify(committedPaths),
       'preview lists exactly the paths publish writes');
  H.ok(previewPaths.indexOf('activities/preview-check.json') !== -1, 'the source JSON is in the list');
  H.ok(previewPaths.indexOf('sitemap.xml') !== -1, 'the regenerated sitemap is in the list');

  console.log('\n[a language with no title is previewed but not committed]');
  H.ok(preview.body.html.ru && preview.body.html.ru.length > 0,
       'Russian still renders in the preview, so the admin can see what a reader would get');
  H.eq(JSON.stringify(preview.body.langs), JSON.stringify(['he', 'en']),
       'but Russian is not in the published language list');
  H.ok(!github._files.has('ru/activities/preview-check.html'),
       'and no Russian file was committed — better than Hebrew under an /ru/ URL');

  console.log('\n[the language fallback chain is the same in both]');
  // ru falls back to en, then he. The preview must apply the identical chain,
  // or a half-translated record previews blank and publishes filled.
  const { _internal } = admin;
  const tpl = require(H.fnPath('_activity-template'));
  H.eq(tpl.pick({ he: 'H', en: 'E', ru: '' }, 'ru'), 'E', 'ru falls back to en');
  H.eq(tpl.pick({ he: 'H', en: '', ru: '' }, 'ru'), 'H', 'ru falls back past en to he');
  H.eq(tpl.pick({ he: 'H', en: '', ru: '' }, 'en'), 'H', 'en falls back to he');
  H.eq(tpl.pick({ he: '', en: 'E', ru: 'R' }, 'he'), '', 'he does NOT fall back — Hebrew is the source');
  H.ok(preview.body.html.ru.includes('Description with a &amp; ampersand'),
       'the previewed Russian page shows the English fallback, escaped');

  console.log('\n[blank repeatable rows are dropped, not published]');
  H.eq((preview.body.html.he.match(/class="faq-item"/g) || []).length, 1,
       'exactly one FAQ entry survives — the blank row is not published');
  H.ok(!preview.body.html.he.includes('<span class="faq-q"></span>'),
       'and it left no empty question behind');

  H.done();
})();
