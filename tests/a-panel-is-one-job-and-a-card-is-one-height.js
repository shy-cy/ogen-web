// What this defends against: two screens that were correct and unreadable.
//
// 1. THE ADMIN PANEL THAT WAS THREE JOBS. "Activity facts" held the group list,
//    a free-text override, four price fields, the late-booking block, a
//    repeatable list of bundles and nine visibility checkboxes, under one
//    heading in one scroll. Nothing about it was broken and it was reported as
//    "very bad UX" — and the cost was already visible in the data, where
//    beit-midrash's group-size override had been filled in with "Dates will be
//    announced soon". That box replaces the GROUP SIZE line, so the page
//    published "Group size: Dates will be announced soon". A control with no
//    context of its own collects whatever the person wanted to say next.
//
//    It is three panels now — Groups, Price, What is published — in the order
//    the questions are asked. ⚠ The mount ids changed, and NOTHING EXECUTED
//    renderFacts(), so a mount the HTML no longer carried would have thrown at
//    the top of the panel an admin opens first with every suite still green.
//    The parity check below is the one that would have caught it: every literal
//    id the client looks up has to exist in the markup.
//
// 2. THE CARDS THAT NEVER LINED UP. Folk dancing's summary ran to five lines and
//    Hebrew-for-kids' to two, so the facts underneath started at a different
//    height on every card and the row read as a mess. The fix is a pair, and
//    BOTH halves are load-bearing: `-webkit-line-clamp` fixes only the long end,
//    and without the matching min-height a short summary still lifts its card's
//    facts above its neighbours'. That is the same shape as height:auto and
//    aspect-ratio on the thumbnail one rule above it — two declarations that
//    have to travel together, where dropping one fails silently and visibly.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(R, f), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

const client = read('js/activities-admin.js');
const markup = read('admin/activities.html');
const css = stripComments(read('shared.css'));
const template = require(H.fnPath('_activity-template'));
const admin = require(H.fnPath('activities-admin'))._internal;

(async () => {
  console.log('[every id the admin looks up exists in the markup]');
  // ⚠ THE CHECK THAT WOULD HAVE CAUGHT THE PANEL SPLIT. $('x') on an id the page
  // does not carry returns null, and the next line throws — at the top of a
  // render, so the panel is simply blank. Literal ids only: the dynamic ones
  // ($('fact-vis-' + key)) are built from the schema and are covered by the
  // suites that exercise the schema.
  const ids = new Set();
  const re = /\$\('([a-z0-9-]+)'\)/gi;
  let m;
  while ((m = re.exec(client)) !== null) ids.add(m[1]);
  H.ok(ids.size > 10, 'the client looks up a good number of ids (' + ids.size + ')');

  // An id is answerable either by the page (a mount in the markup) or by the
  // client itself (a control it builds and later reads back). Both count; what
  // must not exist is an id answered by NEITHER, which is the typo or the
  // renamed mount that leaves a panel blank.
  // "Built" means the id appears in the client somewhere OTHER than the lookup
  // itself — as `id: 'f-slug'` on an element, or as the first argument to the
  // select() helper. The lookups are removed first, so an id that exists only
  // inside a $() call is answered by nothing and fails, which is the typo and
  // the renamed mount this is here for.
  const clientWithoutLookups = client.replace(/\$\('[a-z0-9-]+'\)/gi, '$()');
  const built = (id) => clientWithoutLookups.indexOf("'" + id + "'") !== -1;
  const inPage = (id) => markup.indexOf('id="' + id + '"') !== -1;
  const missing = [...ids].filter((id) => !inPage(id) && !built(id));
  H.eq(missing.length, 0,
    'every id the admin looks up is either a mount in the markup or a control it builds' +
    (missing.length ? ' — answered by neither: ' + missing.join(', ') : ''));

  // And the three panel mounts specifically are the PAGE's, not built — a mount
  // the client invents is a panel that exists only when something remembered to
  // create it.
  ['groups-fields', 'price-fields', 'visibility-fields'].forEach((id) => {
    H.ok(inPage(id), '#' + id + ' is in the markup rather than conjured');
  });

  console.log('\n[the facts panel is three panels, each one job]');
  ['groups-fields', 'price-fields', 'visibility-fields'].forEach((id) => {
    H.ok(markup.indexOf('id="' + id + '"') !== -1, 'the markup carries #' + id);
    H.ok(client.indexOf("$('" + id + "')") !== -1, 'and the client fills it');
  });
  H.ok(markup.indexOf('id="facts"') === -1, 'the single "facts" mount is gone, not left behind');
  H.ok(!/<h2>Activity facts<\/h2>/.test(markup), 'and so is the heading that held all three');
  ['<h2>Groups</h2>', '<h2>Price</h2>', '<h2>What is published</h2>'].forEach((h) => {
    H.ok(markup.indexOf(h) !== -1, 'panel heading present: ' + h);
  });

  // The override belongs with the GROUPS, because what it replaces is the line
  // the group list produces — not with the price, which answers a different
  // question. Read off the source rather than trusted from a comment.
  const renderFacts = client.slice(client.indexOf('function renderFacts()'),
                                   client.indexOf('function readFacts()'));
  H.ok(/groupSize.*groupsBox|groupsBox.*groupSize/s.test(renderFacts),
    'the group-size override is drawn into the groups panel');
  H.ok(/visBox\.appendChild\(visibilityBlock\(\)\)/.test(renderFacts),
    'and the visibility block into its own');

  // ⚠ ONE CONTROL FOR THE VISIBILITY FLAGS, STILL. Splitting the panel must not
  // become an excuse to put a copy of the checkbox on each group's page: the
  // same setting editable from two places is the trap this codebase already met.
  H.eq((client.match(/function visibilityBlock\(/g) || []).length, 1,
    'there is exactly one visibility block, wherever the panel it sits in ends up');

  console.log('\n[the card summary is clamped, and the min-height travels with it]');
  const pRule = css.match(/\.activity-card p\s*\{[^}]*\}/g) || [];
  H.eq(pRule.length, 1,
    'exactly ONE .activity-card p rule, so the pair below cannot be split across a media query');
  H.ok(/line-clamp:\s*3/.test(pRule[0]), 'it clamps to three lines');
  H.ok(/min-height:/.test(pRule[0]),
    'AND sets a min-height — the clamp alone fixes only the long summaries, and a ' +
    'short one still lifts its card’s facts above its neighbours’');
  H.ok(/overflow:\s*hidden/.test(pRule[0]), 'with the overflow the clamp needs to bite');

  console.log('\n[the facts sit in a band, edge to edge]');
  const tagRule = (css.match(/\.activity-card-tags\s*\{[^}]*\}/g) || [])[0];
  H.ok(!!tagRule, 'the tag list has a rule');
  H.ok(/background:/.test(tagRule), 'it is tinted, so the facts read as a block rather than more prose');
  H.ok(/margin:\s*0\s*;/.test(tagRule),
    'and NOT inset — a band held off the card edges is a fourth floating paragraph, ' +
    'which is what it was');
  H.ok(/border-block-start/.test(tagRule) && !/border-top|border-left|border-right/.test(tagRule),
    'the edge above it is logical, so it needs no per-language override');

  const moreRule = (css.match(/\.activity-card-more\s*\{[^}]*\}/g) || [])[0];
  H.ok(/margin:\s*auto/.test(moreRule),
    'the link absorbs the slack, so the band keeps its own height and the link sits on the bottom edge');

  console.log('\n[one number for the recommended length]');
  const summary = admin.FIELD_SCHEMA.simple.filter((f) => f.key === 'summary')[0];
  H.ok(!!summary, 'the card summary is a field');
  H.eq(summary.counter, template.SUMMARY_CHARS,
    'the admin counts against the template’s own figure, not a second one');
  H.ok(read('netlify/functions/_activity-template.js').indexOf('slice(0, SUMMARY_CHARS)') !== -1,
    'and the fallback slice off `about` uses it too, so the count and the generated ' +
    'summary cannot drift');
  H.ok(client.indexOf('descriptor.counter') !== -1, 'the client draws a counter when a field has one');
  H.ok(/is-over/.test(client) && /is-over/.test(read('admin/admin.css')),
    'and it marks itself when it is past — the state and its style both exist');

  H.done();
})();
