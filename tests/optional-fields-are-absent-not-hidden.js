// The rule this defends:
//
// An optional field that has no value must not be rendered at all. Not hidden
// with CSS, not emitted as an empty heading for the client script to tidy up
// afterwards — absent. js/activity.js does remove a heading-only block at
// runtime, but that is a safety net for hand-authored pages, and a safety net
// that the generator relies on is just a bug with a longer fuse: the HTML in
// the repository would contain headings for fields nobody filled in, and
// anything reading the file rather than the rendered DOM would see them.
//
// Also asserts the invariants of the shipped template that the admin must not
// quietly break: exactly one h1, the status slots present, credits omitted
// entirely when there are none.

const H = require('./_helpers');
const tpl = require(H.fnPath('_activity-template'));

const base = {
  slug: 'minimal',
  status: 'open',
  title: { he: 'מינימלי', en: 'Minimal', ru: '' },
  about: { he: 'תיאור קצר', en: 'A short description', ru: '' },
  facts: {},
  included: [],
  faq: [],
  teachers: [],
  sponsors: []
};

(async () => {
  console.log('\n[a record with nothing optional renders none of it]');
  const bare = tpl.renderActivityPage(base, 'he');

  ['אורך התוכנית', 'שפת ההוראה', 'דרישות קדם', 'מה להביא', 'שאלות נפוצות'].forEach((label) => {
    H.ok(bare.indexOf(label) === -1, `"${label}" does not appear anywhere in the HTML`);
  });
  H.ok(bare.indexOf('data-optional') === -1, 'no data-optional block was emitted at all');
  H.ok(bare.indexOf('<h2></h2>') === -1, 'no empty heading');
  H.ok(bare.indexOf('data-credits') === -1, 'no credit block when there are no teachers or sponsors');
  H.ok(bare.indexOf('activity-credits') === -1, 'and no empty credits JSON either');
  H.ok(bare.indexOf('facts-list') === -1, 'no bullet list when nothing is included');

  console.log('\n[the one optional block left appears only when it has a value]');
  // Program length, language of instruction and prerequisites used to be
  // optional blocks here; they are facts now. "What to bring" was the last
  // optional TEXT field and is retired — one line on one activity, carried by
  // a whole section, editor and form group. FAQ is what [data-optional] wraps
  // now, and the rule it is wrapped for is unchanged.
  const withFaq = Object.assign({}, base, {
    faq: [{ id: 'q1', q: { he: 'מתי?', en: '', ru: '' }, a: { he: 'ברביעי', en: '', ru: '' } }]
  });
  const one = tpl.renderActivityPage(withFaq, 'he');
  H.ok(one.indexOf('שאלות נפוצות') !== -1, 'the populated section is rendered');
  H.ok(one.indexOf('דרישות קדם') === -1, 'its unpopulated neighbours still are not');
  H.eq((one.match(/data-optional/g) || []).length, 1, 'exactly one optional block exists');

  console.log('\n[a section blank in one language falls back rather than emptying]');
  H.ok(tpl.renderActivityPage(withFaq, 'en').indexOf('Frequently asked questions') !== -1,
       'English shows the Hebrew fallback rather than an empty section');

  console.log('\n[what to bring is gone from the template, not merely unused]');
  // It has to be absent from the rendered page in every language, not just
  // absent from the record: a stale LABELS entry plus a stale call site would
  // keep publishing the heading for any record that still carries the key.
  const stale = Object.assign({}, base, {
    title: { he: 'ישן', en: 'Old', ru: 'Старый' },
    whatToBring: { he: 'מחברת', en: 'Notebook', ru: 'Тетрадь' }
  });
  [['he', 'מה להביא'], ['en', 'What to bring'], ['ru', 'Что взять с собой']].forEach(([lang, label]) => {
    const html = tpl.renderActivityPage(stale, lang);
    H.ok(html.indexOf(label) === -1, lang + ': the heading is not published');
    H.ok(html.indexOf('Notebook') === -1 && html.indexOf('מחברת') === -1,
         lang + ': and neither is the value, even though the record still holds it');
  });

  console.log('\n[structural invariants of the shipped template]');
  const full = tpl.renderActivityPage(Object.assign({}, base, {
    teachers: [{ id: 't1', name: { he: 'מורה', en: 'Teacher', ru: '' } }],
    included: [{ id: 'i1', text: { he: 'פריט', en: 'Item', ru: '' } }]
  }), 'he');
  H.eq((full.match(/<h1[ >]/g) || []).length, 1, 'exactly one h1');
  H.ok(full.indexOf('data-status-badge') !== -1, 'the status badge slot is present');
  H.ok(full.indexOf('data-status-cta') !== -1, 'the CTA slot is present');
  H.ok(full.indexOf('data-status="open"') !== -1, 'status is declared once, on the article');
  H.eq((full.match(/data-status="/g) || []).length, 1, 'and only once — badge and CTA both derive from it');
  H.ok(full.indexOf('/js/activity.js') !== -1, 'the activity script is loaded');
  H.ok(full.indexOf('/js/motifs.js') !== -1, 'the motif script is loaded');

  console.log('\n[generated pages announce that they are generated]');
  H.ok(full.indexOf('GENERATED FILE') !== -1,
       'the file says so, so nobody hand-edits it and loses the change on the next save');

  console.log('\n[escaping]');
  const nasty = tpl.renderActivityPage(Object.assign({}, base, {
    title: { he: '<script>alert(1)</script>', en: 'x', ru: '' },
    about: { he: 'a & b "quoted"', en: 'x', ru: '' }
  }), 'he');
  H.ok(nasty.indexOf('<script>alert(1)</script>') === -1, 'a tag in a field is escaped');
  H.ok(nasty.indexOf('&lt;script&gt;') !== -1, 'and appears as text');
  H.ok(nasty.indexOf('a &amp; b &quot;quoted&quot;') !== -1, 'ampersands and quotes are escaped');

  console.log('\n[unknown enum values fall back rather than emitting garbage]');
  const weird = tpl.renderActivityPage(Object.assign({}, base, { motif: 'wat', corner: 'zz' }), 'he');
  H.ok(weird.indexOf('data-motif="ring"') !== -1, 'an unknown motif falls back to ring');
  H.ok(weird.indexOf('data-corner="tl"') !== -1, 'an unknown corner falls back to tl');

  H.done();
})();
