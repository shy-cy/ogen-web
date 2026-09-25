// What this defends against:
//
// `seriesId` links the autumn term of a course to its spring, and it exists for
// exactly one reason: the registration fee is charged once a year per
// participant per activity, so a child returning in the spring must not pay it
// twice. feeApplies() gets that right and has a suite of its own.
//
// ⚠ AND THE FEE ITSELF WAS STILL TYPED PER TERM. Every term drew its own
// `registrationFee` box, so the ONE yearly fee of a series had as many values as
// the series had terms — and which of them a family paid was decided by which
// term they happened to walk in through:
//
//   autumn 50, spring 80   join in autumn: pay 50, spring waived.
//                          join in spring: pay 80, autumn waived.
//
// Two families, one series, one "yearly fee", two figures. And each term's
// public price card printed its own as though it were the answer.
//
// Nobody typed anything twice and neither number is wrong on its own. It is the
// PAIR that is wrong, and no screen could show it, because each form draws one
// activity — the same shape as the two facts that printed their structured list
// and a restatement of it underneath.
//
// So the fee belongs to the SERIES, owned by its head: the record whose
// activityId IS its seriesId. Every other term carries a copy the server writes
// on every save, and its form shows that copy read-only.
//
// ⚠ A STORED COPY RATHER THAN A LOOKUP. facts.price.registrationFee is read by
// priceRows() — pure, one activity, feeding the published page, the listing card
// and the family area's facts card — and by owedCentsFor() and the frozen block.
// Writing the resolved figure keeps all of those right with no change to any of
// them. This suite therefore asserts the stored value AND the money that comes
// out of it, because the stored value is only interesting for what it prices.
//
// ⚠ AND ONLY THE FEE. Not fullPrice: a semester is priced per semester, which is
// why two records exist. Not registrationFeeCutoffDate: that is the deadline for
// getting THIS registration's fee back, and a newcomer joining in spring answers
// to the spring's calendar. Both are pinned below, because "inherit the price
// fields" is the tidy-up that would break them.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');
const F = require('./_fixtures');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const SERIES = require(H.fnPath('_activity-series'));
const RR = require(H.fnPath('_registration'));

const adminSrc = read('netlify/functions/activities-admin.js');
const clientSrc = read('js/activities-admin.js');

const feeOn = (a) => a.facts.price.registrationFee;
const setFee = (a, v) => { a.facts.price.registrationFee = v; return a; };

// --------------------------------------------------------------------------
console.log('[which records own their fee, and which inherit one]');

const autumn = setFee(F.course(), 50);
const spring = setFee(F.secondTerm(), 80);

H.ok(!SERIES.isLinkedTerm(autumn), 'the head owns its fee');
H.ok(SERIES.isLinkedTerm(spring), 'a term pointed at another inherits');

// An unlinked activity stores seriesId === activityId, because the merge writes
// its own id into a blank. "A series of one" and "unlinked" are one stored shape
// and neither inherits anything.
const solo = setFee(F.course({ slug: 'solo', activityId: 'act-00000000000solo1' }), 25);
solo.seriesId = solo.activityId;
H.ok(!SERIES.isLinkedTerm(solo), 'a series of one owns its fee');
delete solo.seriesId;
H.ok(!SERIES.isLinkedTerm(solo), 'and so does a record with no seriesId at all');

// ⚠ A NEW ACTIVITY WITH NO ID YET IS STILL A LINKED TERM. seriesId is set by the
// picker and activityId is minted by stamp(), which PREVIEW DOES NOT CALL — so a
// rule reading seriesOf() (which falls back to the record's own id) would answer
// "not linked" on preview and "linked" on publish one save later. The fee would
// preview as typed and publish as inherited, which is the one asymmetry
// preview-matches-publish exists to forbid.
const fresh = setFee(F.course({ slug: 'fresh' }), 80);
delete fresh.activityId;
fresh.seriesId = autumn.activityId;
H.ok(SERIES.isLinkedTerm(fresh),
  'a brand new term with no id yet is linked, so preview and publish agree');

// --------------------------------------------------------------------------
console.log('\n[the head is found by id, never by slug or position]');

const all = [spring, autumn, solo];
H.eq(SERIES.findHead(spring, all).activityId, autumn.activityId, 'the spring finds the autumn');
H.eq(SERIES.findHead(autumn, all).activityId, autumn.activityId,
  'and a head finds itself, because seriesOf() defaults to its own id');
H.eq(SERIES.findHead(spring, [solo]), null, 'and nothing when the head is not in the set');

// --------------------------------------------------------------------------
console.log('\n[what resolve() answers, in all three cases]');

H.eq(SERIES.resolve(autumn, all).inherits, false, 'a head inherits nothing');
{
  const r = SERIES.resolve(spring, all);
  H.eq(r.inherits, true, 'a linked term inherits');
  H.eq(r.fee, 50, "the head's figure, not its own");
  H.eq(r.changed, true, 'and it says the write changes something');
  H.eq(r.problem, undefined, 'with nothing to refuse');
}
{
  // Already agreeing: the same answer, and `changed` false, so the head's own
  // publish has nothing to report about it.
  const agreed = setFee(F.secondTerm(), 50);
  H.eq(SERIES.resolve(agreed, all).fee, 50, 'a term already holding the right fee resolves to it');
  H.eq(SERIES.resolve(agreed, all).changed, false, 'and reports no change');
}
{
  // ⚠ THE HEAD IS GONE — deleted, or unpublished with its draft deleted. Keeping
  // the typed number is the bug this module exists to fix, so it is refused out
  // loud instead.
  const r = SERIES.resolve(spring, [spring]);
  H.eq(r.fee, undefined, 'no figure when there is no head');
  H.eq(r.problem, SERIES.NO_HEAD, 'and a refusal naming why');
  H.ok(/no longer exists/.test(r.problem), 'in words an admin can act on: ' + r.problem);
}

// A head with NO fee at all is a real answer and not a missing one: an activity
// that charges no yearly fee passes that on.
{
  const free = setFee(F.course({ slug: 'free', activityId: 'act-0000000000free1' }), null);
  const term = setFee(F.secondTerm({ seriesId: free.activityId }), 80);
  H.eq(SERIES.resolve(term, [free, term]).fee, null,
    'a head charging no fee hands down no fee, rather than leaving the typed 80');
}
// Blank spellings must not read as different figures, or a save would flip
// between '' and null for ever and every publish would report a change.
{
  const a = F.course({ slug: 'b1', activityId: 'act-000000000000bb1' });
  a.facts.price.registrationFee = '';
  const t = setFee(F.secondTerm({ seriesId: a.activityId }), null);
  H.eq(SERIES.resolve(t, [a, t]).changed, false, "'' and null are one figure, not two");
}

// --------------------------------------------------------------------------
console.log('\n[applyFee writes it, and writes nothing else]');
{
  const term = setFee(F.secondTerm(), 80);
  // Given real values on purpose: an assertion that both sides are null passes
  // with the rule reverted and says nothing at all.
  term.facts.price.fullPrice = 320;
  term.registration.registrationFeeCutoffDate = '2027-02-14';
  const before = JSON.parse(JSON.stringify(term));
  SERIES.applyFee(term, all);
  H.eq(feeOn(term), 50, 'the fee is replaced');
  H.eq(term.facts.price.fullPrice, 320,
    '\u26a0 and the semester price is NOT inherited \u2014 a term is priced per term');
  H.eq(term.registration.registrationFeeCutoffDate, '2027-02-14',
    '\u26a0 nor is the fee cutoff \u2014 that is this term\u2019s own deadline');
  H.eq(term.groups[0].facts.duration.startDate, before.groups[0].facts.duration.startDate,
    'and nothing else about the record moved');
}
{
  // A head is left exactly alone, including a record with no price object.
  const bare = { activityId: 'act-0000000000bare1', seriesId: 'act-0000000000bare1' };
  SERIES.applyFee(bare, [bare]);
  H.eq(bare.facts, undefined, 'a head is not given a facts object it did not have');
}

// --------------------------------------------------------------------------
console.log('\n[the money that comes out of the stored figure]');

// The point of all of it. owedCentsFor() and the frozen block read the ACTIVITY's
// own price object, so the inheritance is only real if what a family is billed
// moved with it.
{
  const term = setFee(F.secondTerm(), 80);
  H.eq(RR.owedCentsFor(term, true), 8000 + RR.owedCentsFor(setFee(F.secondTerm(), 0), true),
    'before inheriting, a newcomer joining in spring is billed the typed 80');
  SERIES.applyFee(term, all);
  H.eq(RR.owedCentsFor(term, true), 5000 + RR.owedCentsFor(setFee(F.secondTerm(), 0), true),
    "after inheriting, they are billed the series's 50");
  H.eq(RR.owedCentsFor(term, false), RR.owedCentsFor(setFee(F.secondTerm(), 0), true),
    'and a returning child, waived, is billed neither');
}

// --------------------------------------------------------------------------
console.log('\n[the other direction: a head whose terms have gone stale]');

// A copy can only go stale one way — the head's fee is edited and a term is not
// saved afterwards — because a term re-reads the head on every one of its saves.
{
  const head = setFee(F.course(), 80);          // just edited
  const stale = setFee(F.secondTerm(), 50);     // still holding the old figure
  const fine = setFee(F.secondTerm({ slug: 'ok', activityId: 'act-00000000000ok11' }), 80);
  const found = SERIES.staleTerms(head, [head, stale, fine, solo]);
  H.eq(found.length, 1, 'only the term that disagrees is named');
  // Guarded, so reverting the comparison fails these cleanly rather than
  // throwing a TypeError and taking the rest of the suite with it.
  H.eq((found[0] || {}).slug, stale.slug, 'and it is the right one');

  const msg = SERIES.staleMessage(head, found) || '';
  H.ok(/course-fixture-spring/.test(msg), 'the message names the term: ' + msg);
  H.ok(/50/.test(msg) && /80/.test(msg),
    'and BOTH figures — "a term disagrees" is a sentence somebody has to go and investigate');
  H.ok(/save/.test(msg), 'and says what to do about it');
  H.eq(SERIES.staleMessage(head, []), null, 'and there is no message when nothing is stale');
  H.eq(SERIES.staleTerms(head, [head, fine]).length, 0, 'nor anything to find');
}
// A head is never its own stale term, and an unrelated activity is never one.
H.eq(SERIES.staleTerms(setFee(F.course(), 999), [setFee(F.course(), 999)]).length, 0,
  'a head does not report itself');

// --------------------------------------------------------------------------
console.log('\n[executed: the handler writes it on save and on publish]');

(async () => {
  const AUT = 'act-00000000000000a1';
  const SPR = 'act-00000000000000b2';

  const head = setFee(F.course({ slug: 'autumn', activityId: AUT }), 50);
  head.seriesId = AUT;
  const term = setFee(F.secondTerm({ slug: 'spring', activityId: SPR, seriesId: AUT }), 50);

  const index = [head, term].map((a) => ({
    slug: a.slug, activityId: a.activityId, seriesId: a.seriesId,
    status: a.status, langs: ['he', 'en', 'ru'], title: a.title
  }));
  const blobs = H.makeBlobs();
  const github = H.makeGithub({
    'activities/autumn.json': JSON.stringify(head),
    'activities/spring.json': JSON.stringify(term),
    'activities/activities-index.json': JSON.stringify(index)
  });
  const mods = H.loadWithStubs({ blobs, github, modules: ['activities-admin'] });
  const A = mods['activities-admin']._internal;
  const session = H.superAdminSession();

  // ⚠ WHAT A HOSTILE — OR MERELY OPTIMISTIC — CLIENT SENDS. The form disables the
  // box, and the server does not believe it: the figure is resolved from the
  // stored records either way.
  const typed = JSON.parse(JSON.stringify(term));
  typed.facts.price.registrationFee = 80;

  {
    const { merged, series } = await A.mergeFor(term, typed, session);
    H.eq(feeOn(merged), 50, 'a save naming 80 stores the series’s 50');
    H.eq(series.inherits, true, 'and says it inherited');
    H.eq(series.problem, undefined, 'with nothing refused');
  }

  // A DRAFT head supersedes its published copy, the same way currentRecord()
  // decides it — so a fee just typed on the autumn is what the spring picks up,
  // rather than the figure the published file still shows.
  {
    const draftHead = setFee(JSON.parse(JSON.stringify(head)), 65);
    await (await blobs.requireStore('activity-drafts')).setJSON('activity-autumn', draftHead);
    const { merged } = await A.mergeFor(term, typed, session);
    H.eq(feeOn(merged), 65, 'an unpublished edit to the head is what a term inherits');
    await (await blobs.requireStore('activity-drafts')).delete('activity-autumn');
  }

  // The head itself is untouched by its own save, whatever the picker says.
  {
    const bump = JSON.parse(JSON.stringify(head));
    bump.facts.price.registrationFee = 75;
    const { merged, series } = await A.mergeFor(head, bump, session);
    H.eq(feeOn(merged), 75, 'the head is where the fee is actually edited');
    H.eq(series.inherits, false, 'and it inherits nothing');
  }

  // ⚠ THE HEAD IS GONE. Refused rather than quietly keeping the typed number.
  {
    const orphan = setFee(F.secondTerm({ slug: 'orphan', activityId: 'act-00000000000000c3',
      seriesId: 'act-0000000000000fff' }), 80);
    const { series } = await A.mergeFor(orphan, orphan, session);
    H.eq(series.problem, SERIES.NO_HEAD, 'pointing at an activity that is not there is refused');
  }

  // And the rendered page prints the inherited figure, which is the half a
  // family actually reads. Executed through generate(), the one render path.
  {
    const { merged } = await A.mergeFor(term, typed, session);
    const out = await A.generate(merged, { commit: false, session });
    H.ok(/50/.test(out.html.he), 'the published Hebrew price card carries the inherited fee');
    H.ok(!/>\s*80\s*&/.test(out.html.he), 'and not the figure the form sent');
  }

  // ⚠ THE HEAD'S PUBLISH NAMES THE TERMS IT HAS LEFT BEHIND. Named rather than
  // rewritten: fixing them here would commit a page nobody asked to publish.
  {
    const bumped = setFee(JSON.parse(JSON.stringify(head)), 80);
    const out = await A.generate(bumped, { commit: false, session });
    H.ok(out.seriesStale, 'publishing a changed fee on the head says something');
    H.ok(/spring/.test(out.seriesStale), 'naming the term: ' + out.seriesStale);
    const same = await A.generate(JSON.parse(JSON.stringify(head)), { commit: false, session });
    H.eq(same.seriesStale, null, 'and an unchanged fee says nothing');
  }

  // --------------------------------------------------------------------------
  console.log('\n[the rule has no exceptions, checked by shape]');

  // Three write paths merged and none of them could inherit anything, so the
  // rule would have had to be remembered three times. Pinned by shape rather
  // than by counting call sites, so a fourth path added next year inherits it.
  // Two occurrences only: the definition, and ONE call — which is inside
  // mergeFor. Any third is a write path that merged without inheriting.
  H.eq((adminSrc.match(/mergeByPermission\(/g) || []).length, 2,
    'mergeByPermission is defined once and called once');
  H.ok(/async function mergeFor\([\s\S]*?mergeByPermission\(/.test(adminSrc),
    'and the one call is inside mergeFor');
  H.eq((adminSrc.match(/await mergeFor\(/g) || []).length, 3,
    'so all three write paths — preview, saveDraft, publish — go through it');

  // Refused at preview and at publish, warned at saveDraft, with the SAME string
  // in all three: that is what stops it becoming two accounts of one rule.
  H.eq((adminSrc.match(/if \(series\.problem\)/g) || []).length, 3,
    'every write path acts on the unresolved case');
  H.eq((adminSrc.match(/if \(series\.problem\) refuse\(series\.problem\);/g) || []).length, 2,
    'preview and publish refuse');
  H.ok(/warnings\.push\(series\.problem\)/.test(adminSrc), 'and a draft is told rather than refused');

  // --------------------------------------------------------------------------
  console.log('\n[the form does not invite the mistake]');

  H.ok(/registrationFee: SERIES\.feeOf\(a\)/.test(adminSrc),
    'the list payload carries each candidate’s fee, so the form can show it at once');
  H.ok(/function feeField\(/.test(clientSrc), 'the fee has its own field builder');
  H.ok(/function linkedTerm\(rec\)/.test(clientSrc) && /function seriesHead\(rec\)/.test(clientSrc),
    'with the two questions it needs answered');
  H.ok(/feeField\(fact\.registrationFee\)/.test(clientSrc),
    'and the price panel draws it rather than a bare number box');
  // Disabled, with the (i) saying where the figure comes from: a filled-in box an
  // admin may not edit has to say why, or it reads as a broken form.
  const fee = clientSrc.slice(clientSrc.indexOf('function feeField('),
                              clientSrc.indexOf('function checkField('));
  H.ok(/disabled: true/.test(fee), 'the box is disabled on a linked term');
  H.ok(/withHelp\(/.test(fee), 'and carries an (i)');
  H.ok(/Inherited from/.test(fee), 'naming where the figure comes from');
  H.ok(/cannot be found/.test(fee), 'and saying so when the head is missing');
  // ⚠ The badge wraps the LABEL, not the whole field: withHelp() builds a
  // .label-row flex row, and handing it the field would put the (i) after the
  // input. Same cascade rule the admin's label-row already carries.
  H.ok(/withHelp\(el\('label'/.test(fee), 'and the badge sits beside the label, not after the input');

  // The read-back sends what it was given rather than reading a disabled box.
  H.ok(/registrationFee: linkedTerm\(S\.record\)/.test(clientSrc),
    'a linked term reads its fee back from the record, not from the input');

  // Moving the picker relocks the box, and reads the form into the model FIRST —
  // the undrawn-field trap, which the type select documents at length.
  const picker = clientSrc.slice(clientSrc.indexOf('function seriesPicker('),
                                 clientSrc.indexOf('function seriesPicker(') + 4000);
  H.ok(/keepUndrawnFacts\(S\.record\.facts, read\.facts\)/.test(picker),
    'the series select merges the read-back rather than assigning it');
  H.ok(/renderFacts\(\)/.test(picker), 'and redraws the panel holding the fee');

  H.ok(/res\.data\.seriesStale/.test(clientSrc),
    'and the publish reports terms it left behind, on screen');

  H.done();
})();
