// What this defends against:
//
// ⚠ A GROUP COULD BE DELETED WHILE FAMILIES WERE REGISTERED TO IT, AND THE
// PUBLISH SAID NOTHING AT ALL.
//
// Asked as "is it true that there is no way to cancel/delete a sub-group?" — and
// it was not true, which is how this was found. `Remove this group` existed on
// the group's own sub-page, in a `fact-grid` cell under a BLANK label
// (`el('label', { text: ' ' })`) beside "Places in this group", so it read as
// an orphaned button rather than as the control for the group whose page you were
// on. The list where anybody would look for it offered Duplicate and the way in
// and nothing else. That is this admin's own scar: a control with no context of
// its own collects whatever somebody wanted to do next.
//
// Probed against the real handlers before anything changed — register a child
// into grp-bbbb, then publish with that group removed:
//
//     publish with the group removed: 200
//       error   : (none)
//       warnings: null
//       fallout : {"terms":{"changed":0,"emailed":0},"room":{"groups":[],"told":0}}
//
// ⚠ HALF OF WHAT HAPPENED NEXT IS THE FREEZE WORKING, and that half is not a bug.
// `frozen.groupName` kept the roster row and the family's own page reading
// "Advanced", so nothing a family had been told became wrong.
//
// ⚠ THE CAPACITY REPORT IS WHERE IT BITES. capacityReport() buckets by id, so a
// registration whose groupId matches no surviving group falls through the named
// rows AND through `unassigned`: counted in the activity total and in NO row.
// The probe's report read taken:1, unassigned:0, and grp-aaaa at taken:0 — a full
// class reading as empty, which is word for word the failure CLAUDE.md already
// names in the other direction.
//
// And it was the one change an admin can make that reaches a live registration
// while saying nothing. A moved cutoff is counted and emailed, a raised capacity
// is counted and announced, a rewritten refund schedule is counted, a listing
// change is counted. This was silent.
//
// ⚠ SO IT IS REFUSED, NOT RESOLVED. Silently reassigning a family puts a child in
// a room nobody agreed to — under the equal-hours rule the other group can meet
// on a different day, at a different hour, in a different place, with different
// teachers — and orphaning them is the bug itself. The roster already has a Move
// group control, so the path is: move them, then remove the empty group.
//
// ⚠ AND THE SAME STRING WARNS ON A DRAFT. One rule, said once, the way every
// other publish-time rule on that form is said: a draft saves whatever is in it
// and is told what would stop it.
//
// ⚠ THE OTHER HALF IS THAT THE CONTROL IS WHERE PEOPLE LOOK. It moved onto the
// group list beside Duplicate, and all three controls there are glyphs — "I would
// avoid buttons with long text, so here would change it to icons" — with the word
// surviving in aria-label, data-tip and title, which is js/admin-icons.js's
// contract and is pinned in a-roster-of-forty-families-can-be-narrowed.js. What
// is pinned HERE is that both doors are one removeGroup(), that the last group
// cannot go, and that the sub-page's label is no longer blank.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const RR = require(H.fnPath('_registration'));

// =========================================================================
console.log('[the rule itself: pure, and counted with holdsASpot()]');

const G = (id, en) => ({ groupId: id, name: { he: '', en: en, ru: '' }, capacity: 10,
                         teacherIds: [], facts: {} });
const BEG = G('grp-aaaa', 'Beginners');
const ADV = G('grp-bbbb', 'Advanced');
const reg = (gid, status, over) => Object.assign(
  { participantId: 'p1', activityId: 'act-1', groupId: gid, status: status }, over || {});
const NOW = '2026-10-01T10:00:00Z';

H.eq(RR.removedGroupIds([BEG, ADV], [BEG, ADV]).join(','), '',
  'an ordinary save removes nothing');
H.eq(RR.removedGroupIds([BEG, ADV], [BEG]).join(','), 'grp-bbbb',
  'and dropping one names it');
// ⚠ THE CHEAP HALF IS ASKED FIRST, and this is why it exists: the caller reads no
// registrations at all unless a group has actually gone. A publish that scanned
// the store on every reworded summary would be paying for this rule on every save
// that cannot possibly break it.
H.eq(RR.removedGroupIds([BEG], [BEG, ADV]).join(','), '',
  '⚠ and ADDING a group removes nothing — the check is one-directional');
H.eq(RR.removedGroupIds(null, [BEG]).join(','), '',
  'a brand-new activity has no previous list and nothing to protect');

const problems = (prev, next, regs) => RR.groupRemovalProblems(prev, next, regs, NOW);

H.eq(problems([BEG, ADV], [BEG], []).length, 0,
  'an EMPTY group goes with no argument — this refuses a removal, not removals');
H.eq(problems([BEG, ADV], [BEG], [reg('grp-aaaa', 'approved')]).length, 0,
  'and a family in the group that SURVIVES is not a reason to refuse');

const one = problems([BEG, ADV], [BEG], [reg('grp-bbbb', 'approved')]);
H.eq(one.length, 1, 'a family in the group being removed is');
H.ok(/^Advanced: /.test(one[0]), '⚠ NAMED — an id is the one spelling nobody can resolve');
H.ok(/\b1 family is\b/.test(one[0]), '⚠ AND COUNTED, which is what the admin needs: ' + one[0]);
H.ok(/Roster/.test(one[0]) && /[Mm]ove/.test(one[0]),
  'and it names the control that fixes it rather than leaving it to be found');

const three = problems([BEG, ADV], [BEG],
  [reg('grp-bbbb', 'approved'), Object.assign(reg('grp-bbbb', 'pending'), { participantId: 'p2' }),
   Object.assign(reg('grp-bbbb', 'approved'), { participantId: 'p3' })]);
H.ok(/\b3 families are\b/.test(three[0]), 'three reads as three, and agrees with itself: ' + three[0]);

// ⚠ DERIVED, NEVER THE STORED STATUS. holdsASpot() is what capacity counts by, so
// every way a place stops being a place releases the group on exactly the same
// schedule — rather than on a list of statuses a seventh would have to be added
// to by somebody who remembered.
['cancelled', 'rejected', 'expired', 'waitlisted'].forEach((s) => {
  H.eq(problems([BEG, ADV], [BEG], [reg('grp-bbbb', s)]).length, 0,
    'a ' + s + ' registration holds no place, so it does not block the removal');
});
H.eq(problems([BEG, ADV], [BEG],
  [reg('grp-bbbb', 'pending', { expiresAt: '2026-09-01T00:00:00Z' })]).length, 0,
  '⚠ and a LAPSED hold frees the group the instant it lapses, whether or not the ' +
  'nightly sweep has run — the same property that makes capacity correct');
H.eq(problems([BEG, ADV], [BEG],
  [reg('grp-bbbb', 'pending', { expiresAt: '2026-12-01T00:00:00Z' })]).length, 1,
  'while a hold that is still running does block it');
// An unstamped pending record holds its place — reading it as expired would free
// a place a family is waiting on — so it blocks here too.
H.eq(problems([BEG, ADV], [BEG], [reg('grp-bbbb', 'pending')]).length, 1,
  'as does one nothing stamped a deadline onto');

// Two groups dropped in one save is two sentences, because an admin fixing one
// and republishing should not discover the second afterwards.
const both = problems([BEG, ADV, G('grp-cccc', 'Evening')], [BEG],
  [reg('grp-bbbb', 'approved'),
   Object.assign(reg('grp-cccc', 'approved'), { participantId: 'p9' })]);
H.eq(both.length, 2, 'both are named at once');
H.ok(/Advanced/.test(both[0]) && /Evening/.test(both[1]), 'each by its own name');

// =========================================================================
console.log('\n[⚠ the previous list is the STORED record\'s, never the request\'s]');
// A hostile client sending a short `groups` array is exactly the case being
// caught, so asking the request what used to be there would let it answer
// "nothing was removed" and delete whatever it liked.
const admin = read('netlify/functions/activities-admin.js');
const gather = admin.slice(admin.indexOf('async function groupRemovalProblems(record, merged)'),
                           admin.indexOf('// ⚠ A CUSTOM SCHEDULE\'S CALENDAR'));
H.ok(gather.length > 100, 'the gathering step is in activities-admin.js');
H.ok(/R\.removedGroupIds\(record\.groups, merged\.groups\)/.test(gather),
  '⚠ record.groups is the BEFORE and merged.groups the after — never incoming.groups');
H.ok(/incoming/.test(gather) === false,
  'and nothing in it reads the request body at all');
H.ok(/if \(!R\.removedGroupIds\([^)]*\)\.length\) return \[\];/.test(gather),
  '⚠ and the store is opened only when a group has actually gone, so an ordinary ' +
  'save pays nothing for this');
H.ok(gather.indexOf("require('./_registration-store')") >
     gather.indexOf('removedGroupIds'),
  'the store is required lazily, after that question is answered');

// ⚠ ONE HELPER, NOT THREE CALL SITES — the reason mergeFor() exists. saveDraft,
// preview and publish all merge, and the one that forgot would be the one where a
// group is deleted out from under a family.
const mf = admin.slice(admin.indexOf('async function mergeFor(record, incoming, session)'),
                       admin.indexOf('// ⚠ REMOVING A GROUP SOMEBODY IS REGISTERED TO'));
H.ok(/groupsInUse = await groupRemovalProblems\(record, merged\)/.test(mf),
  'mergeFor() gathers it, so every write path inherits the rule');
['preview', 'saveDraft', 'publish'].forEach((a) => {
  const at = admin.indexOf("case '" + a + "': {");
  H.ok(at !== -1, a + ' is a case');
  const body = admin.slice(at, admin.indexOf('\n      case ', at + 10));
  H.ok(/groupsInUse/.test(body), a + ' reads the answer rather than dropping it');
});

// =========================================================================
console.log('\n[executed: the real handlers, a real family, a real publish]');

(async () => {
  const REG = require(H.fnPath('_activity-registration'));
  const seed = H.seedRepo();
  const gh = H.makeGithub(seed.files);
  const bl = H.makeBlobs();
  const mods = H.loadWithStubs({ blobs: bl, github: gh,
    modules: ['activities-admin', '_registration-store', 'account-auth', '_registration-fallout'] });
  const api = mods['activities-admin'];
  const store = mods['_registration-store'];
  const auth = mods['account-auth'];
  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async () => ({ data: { id: 'x' } }) } });

  const session = await H.installSession(bl, H.superAdminSession());
  const as = { token: session.token };
  const loaded = await H.call(api.handler, Object.assign({ action: 'load', slug: 'hebrew-for-kids' }, as));
  H.eq(loaded.status, 200, 'the seeded activity loads');

  // Two groups, and the second is the one that will be removed. `activityId` is
  // minted on save and never editable, so this has to publish once before a
  // registration can be keyed against it.
  const first = JSON.parse(JSON.stringify(loaded.body.activity));
  // Both need a name: once there is more than one group a family chooses between
  // them by name, and a save is refused without one.
  first.groups[0].name = { he: 'מתחילים', en: 'Beginners', ru: 'Начинающие' };
  const copy = JSON.parse(JSON.stringify(first.groups[0]));
  copy.groupId = 'grp-bbbb';
  copy.name = { he: 'מתקדמים', en: 'Advanced', ru: 'Продвинутые' };
  first.groups.push(copy);
  const pub1 = await H.call(api.handler, Object.assign({ action: 'publish',
    activity: first, baseUpdatedAt: loaded.body.baseUpdatedAt }, as));
  H.eq(pub1.status, 200, 'and publishes with two groups');
  const rec = pub1.body.activity;
  const aid = rec.activityId;
  H.eq(rec.groups.length, 2, 'which is what is on the site');

  const drop = (base) => {
    const next = JSON.parse(JSON.stringify(base));
    next.groups = next.groups.filter((g) => g.groupId !== 'grp-bbbb');
    return next;
  };

  // ⚠ AN EMPTY GROUP GOES. This is the half that must keep working, and it is
  // asserted FIRST — "this is refused" on its own passes on a rule that refuses
  // everything, and that failure is only found by an admin who can no longer
  // publish.
  const gone = await H.call(api.handler, Object.assign({ action: 'publish',
    activity: drop(rec), baseUpdatedAt: rec.isoUpdated }, as));
  H.eq(gone.status, 200, '⚠ with nobody registered, removing a group just works');
  H.eq(gone.body.activity.groups.length, 1, 'and the group is gone');

  // Put it back, then register a family into it.
  const back = await H.call(api.handler, Object.assign({ action: 'publish',
    activity: Object.assign(JSON.parse(JSON.stringify(gone.body.activity)),
      { groups: rec.groups }), baseUpdatedAt: gone.body.activity.isoUpdated }, as));
  H.eq(back.status, 200, 'the group is restored for the rest of this');
  const live = back.body.activity;

  const fam = await H.signUp(auth, bl, { email: 'dana@example.com',
    profile: { firstName: 'Dana', preferredLanguage: 'en' } });
  await store.saveRegistration({
    participantId: 'p-noa', activityId: aid,
    accountId: fam.body.account.accountId, groupId: 'grp-bbbb',
    status: 'approved', isoUpdated: '2026-09-01T00:00:00Z', history: [],
    payment: { owedCents: 30000, paidCents: 0, creditedCents: 0 },
    frozen: { type: 'course', participantName: 'Noa Levi', activityTitle: live.title,
              groupName: { he: 'מתקדמים', en: 'Advanced', ru: 'Продвинутые' },
              price: { registrationFee: 50, fullPrice: 300, feeCharged: true, currency: 'EUR' },
              cancellation: { mode: 'flat', sessionStartsAt: [] } }
  });

  const refused = await H.call(api.handler, Object.assign({ action: 'publish',
    activity: drop(live), baseUpdatedAt: live.isoUpdated }, as));
  // 500 with a `validation` array is how every refusal on this form answers —
  // the one channel the client already draws a list of problems from.
  H.eq(refused.status, 500, '⚠ AND NOW THE PUBLISH IS REFUSED, where it used to answer 200');
  H.ok(/Advanced/.test(refused.body.error), 'naming the group: ' + refused.body.error);
  H.ok(/\b1 family is\b/.test(refused.body.error), 'and the count');
  H.eq((refused.body.validation || []).length, 1,
    'through the same channel a missing title or a bad map link uses');

  // ⚠ NOTHING WAS WRITTEN. A refusal that had already committed the pages would
  // be the bug with an error message on top of it.
  const after = await H.call(api.handler, Object.assign({ action: 'load', slug: 'hebrew-for-kids' }, as));
  H.eq(after.body.activity.groups.length, 2, 'and the group is still there');

  // ⚠ PREVIEW REFUSES TOO. A preview that renders what a publish would not is a
  // preview that lies, which is the one thing preview-matches-publish forbids.
  const prev = await H.call(api.handler, Object.assign({ action: 'preview',
    activity: drop(live) }, as));
  H.eq(prev.status, 500, 'preview refuses in the same breath');
  H.eq(prev.body.error, refused.body.error, 'with the same words');

  // ⚠ AND THE DRAFT SAVES AND IS TOLD. A draft has no page and no registrations
  // point at it, so refusing a save would be a form that fights back several
  // panels from where somebody is working — but saying nothing is how a publish
  // rule becomes invisible.
  const draft = await H.call(api.handler, Object.assign({ action: 'saveDraft',
    activity: drop(live), baseUpdatedAt: after.body.baseUpdatedAt }, as));
  H.eq(draft.status, 200, 'the draft saves whatever is in it');
  H.ok((draft.body.warnings || []).indexOf(refused.body.error) !== -1,
    '⚠ and carries the PUBLISH\'S OWN STRING as a warning, so the two cannot ' +
    'drift into two accounts of one rule: ' + JSON.stringify(draft.body.warnings));

  // The draft that was just saved supersedes the published file and has only one
  // group in it, so the working copy is put back to two before the next check —
  // otherwise nothing would be removed and the assertion would prove nothing.
  const restored = await H.call(api.handler, Object.assign({ action: 'saveDraft',
    activity: live, baseUpdatedAt: draft.body.baseUpdatedAt }, as));
  H.eq(restored.status, 200, 'the working copy is back to two groups');
  H.eq(restored.body.activity.groups.length, 2, 'really two');

  // ⚠ AND IT LIFTS WHEN THE PLACE DOES. Cancel the registration and the same
  // publish goes through — because the rule asks holdsASpot() rather than a list
  // of statuses somebody has to keep current.
  const held = await store.getRegistration('p-noa', aid);
  await store.saveRegistration(Object.assign({}, held, { status: 'cancelled' }));
  const fresh = await H.call(api.handler, Object.assign({ action: 'load', slug: 'hebrew-for-kids' }, as));
  const going = drop(fresh.body.activity);
  going.status = live.status;   // saveDraft stamps `draft`, and a draft has no page
  const ok = await H.call(api.handler, Object.assign({ action: 'publish',
    activity: going, baseUpdatedAt: fresh.body.baseUpdatedAt }, as));
  H.eq(ok.status, 200, '⚠ once nobody holds a place, the group goes');
  H.eq(ok.body.activity.groups.length, 1, 'and it really is removed');

  // =======================================================================
  console.log('\n[the control is where people look, and there is one of it]');
  const ui = read('js/activities-admin.js');

  // ⚠ ONE REMOVAL, TWO DOORS. The list is where an admin looks for it; the
  // sub-page is where they are standing when they decide a group is wrong. Two
  // copies is two places the last-group guard, the dirty flag and the confirm can
  // come apart — the same argument openRegistration() is one function on.
  // ⚠ COUNTED ON COMMENT-STRIPPED SOURCE. The prose above each door names the
  // function, and a naive count reads those as call sites — the same lesson
  // `.activity-card-image img` taught in the stylesheet, where a search found the
  // words in a comment and passed whether or not the declaration was still there.
  const code = ui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  H.eq((code.match(/function removeGroup\(/g) || []).length, 1, 'removeGroup is defined once');
  H.eq((code.match(/removeGroup\(/g) || []).length, 3,
    'and called from exactly two places — the list and the sub-page');
  // The filter that actually drops the group may appear only inside it.
  H.eq((ui.match(/\.filter\(function \(x\) \{ return x\.groupId !== groupId; \}\)/g) || []).length, 1,
    '⚠ and the list is spliced in ONE place, so a second door cannot forget the guard');

  // ⚠ A MODULE NOTHING LOADS IS THIS CODEBASE'S OLDEST BUG — the pure bundle
  // module wired to nothing, the delivery statuses the webhook laddered up for
  // releases with no screen reading them. Both admin pages have to carry it, and
  // BEFORE the client that calls it.
  ['admin/activities.html', 'admin/registrations.html'].forEach((page) => {
    const html = read(page);
    const at = html.indexOf('src="/js/admin-icons.js"');
    H.ok(at !== -1, page + ' loads js/admin-icons.js');
    const client = page.indexOf('activities') !== -1 ? 'activities-admin' : 'registrations-admin';
    H.ok(at < html.indexOf('src="/js/' + client + '.js"'),
      'and loads it before ' + client + ', which calls it at paint');
  });
  H.eq((read('js/registrations-admin.js').match(/createElementNS/g) || []).length, 0,
    '⚠ and the queue screen keeps no copy of the builder — two glyph builders is ' +
    'two tooltip contracts, free to stop being true on one screen');

  const list = ui.slice(ui.indexOf('function drawGroups(box)'), ui.indexOf('function severalGroups'));
  H.ok(/AdminIcons\.button\('remove', 'Remove this group'/.test(list),
    '⚠ REMOVE IS ON THE GROUP LIST, beside Duplicate, where it was looked for');
  ['copy', 'remove', 'open'].forEach((g) => {
    H.ok(new RegExp("AdminIcons\\.button\\('" + g + "'").test(list),
      'and all three controls are glyphs: ' + g);
  });
  H.eq(/text: 'Duplicate'/.test(list), false,
    'with no long label left on the row — "I would avoid buttons with long text"');
  H.ok(/!severalGroups\(list\)/.test(list),
    'Remove is disabled while this is the only group');

  const sub = ui.slice(ui.indexOf("who.appendChild(el('div', { class: 'fact-grid' }"),
                       ui.indexOf('// --- the facts this group answers for'));
  H.eq(/el\('label', \{ text: ' ' \}\)/.test(sub), false,
    '⚠ AND THE SUB-PAGE\'S BLANK LABEL IS GONE — a control in a grid cell under ' +
    'an empty label is the "no context of its own" shape this admin has a scar for');
  H.ok(/text: 'Ending this group'/.test(sub),
    'it has a heading naming the topic');
  H.ok(/text: 'Remove this group'/.test(sub),
    'above a button naming the act');
  H.ok(/if \(removeGroup\(e\.groupId\)\) closeOwnerPage\(\);/.test(sub),
    '⚠ and it goes through the SAME removeGroup(), rather than filtering the list itself');
  H.ok(/refused while anybody is still registered/.test(sub),
    'and the (i) says what the server will refuse, before somebody meets it');

  // ⚠ EXECUTED, because reading the source proves the source is self-consistent
  // and can never prove that pressing the thing works. This is the shim
  // a-group-is-the-unit uses, plus the real js/admin-icons.js.
  const elSrc = ui.slice(ui.indexOf('  function el(tag, attrs, children) {'),
                         ui.indexOf('  var langObj ='));
  const slice = (name) => {
    const at = ui.indexOf('  function ' + name + '(');
    if (at === -1) throw new Error('no function ' + name);
    const end = ui.indexOf('\n  }\n', at);
    return ui.slice(at, end + 4);
  };
  function node(tag) {
    const n = {
      tagName: String(tag).toUpperCase(), attributes: {}, childNodes: [],
      _text: '', _handlers: {},
      get className() { return n.attributes['class'] || ''; },
      set className(v) { n.attributes['class'] = v; },
      get disabled() { return n.attributes.disabled != null; },
      set disabled(v) { if (v) n.attributes.disabled = 'true'; else delete n.attributes.disabled; },
      get value() { return n.attributes.value || ''; },
      set value(v) { n.attributes.value = v; },
      get textContent() { return n._text + n.childNodes.map((c) => c.textContent).join(''); },
      set textContent(v) { n.childNodes.length = 0; n._text = String(v); },
      set innerHTML(v) { if (v !== '') throw new Error('innerHTML is not implemented'); n.childNodes.length = 0; },
      setAttribute(k, v) { n.attributes[k] = String(v); },
      getAttribute(k) { return k in n.attributes ? n.attributes[k] : null; },
      addEventListener(ev, fn) { (n._handlers[ev] = n._handlers[ev] || []).push(fn); },
      appendChild(c) { if (!c) throw new Error('appendChild(null)'); n.childNodes.push(c); return c; },
      click() {
        const hs = n._handlers.click || [];
        if (!hs.length) throw new Error('clicked a ' + n.tagName + ' with no click handler');
        hs.forEach((f) => f({ preventDefault() {} }));
      }
    };
    return n;
  }
  const walk = (n, pred) => {
    const found = [];
    (function go(x) { (x.childNodes || []).forEach((c) => { if (pred(c)) found.push(c); go(c); }); })(n);
    return found;
  };
  const icons = (n, label) =>
    walk(n, (x) => x.tagName === 'BUTTON' && x.getAttribute('aria-label') === label);

  const ctx = {
    document: { createElement: node,
                createElementNS: (ns, tag) => { const n = node(tag); n.namespaceURI = ns; return n; } },
    window: H.adminHelpWindow(node),
    DAY_NAMES: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    canEditAll: () => true,
    openGroupPage: () => {},
    S: null, asked: null, answer: true, exports: null
  };
  ctx.window.confirm = (m) => { ctx.asked = m; return ctx.answer; };
  vm.createContext(ctx);
  vm.runInContext(elSrc + '\n' +
    ['withHelp', 'mintGroupId', 'groupById', 'groupLabel', 'liveDates', 'groupSummary',
     'blankGroupFacts', 'drawGroups', 'severalGroups', 'removeGroup', 'duplicateGroup']
      .map(slice).join('\n') +
    '\nexports = { drawGroups, removeGroup };', ctx);
  H.runAdminIcons(ctx);

  const grp = (id, en) => ({ groupId: id, name: { he: '', en: en, ru: '' }, capacity: 10,
    teacherIds: [], facts: { schedule: { sessions: [{ day: 1, time: '16:00' }] },
      duration: { sessionDates: [{ date: '2026-10-12', status: 'scheduled' }] } } });
  const schema = { schema: { groupFacts: ['schedule', 'duration'] }, dirty: false };

  ctx.S = Object.assign({ groups: [grp('g-a', 'Beginners'), grp('g-b', 'Advanced')] }, schema);
  let box = node('div');
  ctx.exports.drawGroups(box);
  H.eq(icons(box, 'Remove this group').length, 2, 'every row offers it');
  const bin = icons(box, 'Remove this group')[1];
  H.eq(bin.textContent, '', 'as a glyph, with no text node on the row');
  H.ok(bin.getAttribute('data-tip').indexOf('Remove this group') === 0,
    '⚠ and the word is still there, in the tooltip that opens with the same verb');
  H.eq(bin.getAttribute('title'), bin.getAttribute('data-tip'),
    'and in the title, which is all a touch device with no hover has');
  // ⚠ THE <svg> ITSELF, not any node under it. Walking the subtree passes on a
  // builder that made the wrapper with createElement and the <path> inside it
  // namespaced — which draws nothing at all, and which a bite-check found this
  // assertion sailing through.
  const pic = walk(bin, (x) => x.tagName === 'SVG')[0];
  H.ok(pic, 'there is a picture in it');
  H.eq(pic.namespaceURI, 'http://www.w3.org/2000/svg',
    '⚠ drawn in the SVG namespace — createElement makes an HTMLUnknownElement ' +
    'that renders nothing');

  // ⚠ IT ASKS FIRST, and the question names the group: its places, teachers,
  // facts, timetable and calendar go with it, and none of that is recoverable
  // from this screen.
  ctx.answer = false;
  bin.click();
  H.ok(ctx.asked && /Advanced/.test(ctx.asked), 'the confirm names the group: ' + ctx.asked);
  H.ok(/Roster/.test(ctx.asked),
    'and says what the save will refuse, so nobody meets it as a surprise');
  H.eq(ctx.S.groups.length, 2, '⚠ and saying no removes nothing');
  H.eq(ctx.S.dirty, false, 'nor marks the form dirty');

  ctx.answer = true;
  box = node('div');
  ctx.exports.drawGroups(box);
  icons(box, 'Remove this group')[1].click();
  H.eq(ctx.S.groups.length, 1, 'saying yes removes it');
  H.eq(ctx.S.groups[0].groupId, 'g-a', 'the right one');
  H.ok(ctx.S.dirty, 'and marks the form dirty, so leaving warns');

  // ⚠ THE LAST GROUP CANNOT GO. An activity always has at least one — a group is
  // the unit, and a record with none has nowhere to put a family.
  box = node('div');
  ctx.exports.drawGroups(box);
  const last = icons(box, 'Remove this group')[0];
  H.eq(last.disabled, true, 'with one group the control is disabled');
  H.ok(/at least one group/.test(last.getAttribute('data-tip')), 'and says why');
  ctx.asked = null;
  H.eq(ctx.exports.removeGroup('g-a'), false,
    '⚠ and the function refuses even called directly — the guard is not the button\'s');
  H.eq(ctx.asked, null, 'without even asking');
  H.eq(ctx.S.groups.length, 1, 'the activity keeps its group');

  H.done();
})();
