// What this defends against:
//
// Conditional panels are the one genuinely new mechanism the drop-in type
// brings, and they put a NEW VERSION of a bug this codebase already documents
// one step away.
//
// The old one: the form draws its groups by iterating FIELD_SCHEMA and reads the
// form back by iterating the same lists, and the read-back is the dangerous
// half, because nothing about it looks wrong — the field renders, the admin
// types into it, the save succeeds, and the value is gone.
//
// The new one is worse, because nobody typed anything at all. Switch an activity
// from course to drop-in and the term price and both cutoff dates sit in panels
// the form no longer draws. The read-back sends nothing for them, and "nothing"
// merged as "cleared" silently destroys three configured values as a side effect
// of changing a dropdown. Switch back and they are gone.
//
// The rule: A GROUP THE FORM DID NOT DRAW IS NOT READ BACK AND IS NOT MERGED.
// Absent must mean "this type did not send it", never "the admin emptied it" —
// the same distinction cardImage already draws, where a cleared image travels as
// null and an unsent one is simply absent.
//
// It is decided from the TYPE, server-side, rather than from a list of drawn
// fields the client sends. The client is hostile by assumption, and a rule that
// depends on the client telling the truth about what it rendered is not a rule.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');
const F = require('./_fixtures');
// The closing date, which is the last step of the refund schedule.
const closes = (reg) => {
  const list = (reg.cancellationPolicy || {}).tiers || [];
  return list.length ? list[list.length - 1].until : null;
};
const REG = require('../netlify/functions/_activity-registration');

const R = path.join(__dirname, '..');
const adminJs = fs.readFileSync(path.join(R, 'js/activities-admin.js'), 'utf8');

console.log('[each type draws its own fields, and the list says so once]');
// One list, shared by the form and by the merge. Two lists is one list falling
// out of step, and the way it fails is by clearing a value nobody touched.
H.ok(REG.FIELDS.length > 0, 'the panel descriptor exists');
H.ok(/registration: REG\.FIELDS/.test(fs.readFileSync(path.join(R, 'netlify/functions/activities-admin.js'), 'utf8')),
  'and the form schema points AT it rather than repeating it');

const courseFields = REG.FIELDS.filter((f) => REG.draws(f, 'course')).map((f) => f.key);
const dropinFields = REG.FIELDS.filter((f) => REG.draws(f, 'dropin')).map((f) => f.key);
H.ok(courseFields.indexOf('registrationFeeCutoffDate') !== -1, 'a course draws the fee cutoff');
H.ok(courseFields.indexOf('cancellationPolicy.tiers') !== -1, 'and the refund schedule');
H.ok(dropinFields.indexOf('registrationFeeCutoffDate') === -1,
  'a drop-in draws neither, because it has no term to withdraw from');
H.ok(dropinFields.indexOf('sessionCancelHours') !== -1, 'it draws its own per-session window');
H.ok(courseFields.indexOf('sessionCancelHours') === -1, 'which a course does not');
// Both types share the two that are about the request rather than the money.
['autoApprove', 'pendingExpiryDays'].forEach((k) => {
  H.ok(courseFields.indexOf(k) !== -1 && dropinFields.indexOf(k) !== -1,
    k + ' is drawn by both, because it is about the request, not about a term');
});

console.log('\n[a configured course, saved as a drop-in, keeps everything]');
// ⚠ THE SCHEDULE, WHICH USED TO BE A MODE AND A DATE. The rule under test has not
// changed — an undrawn field survives a save that never mentioned it — but the
// field it is asked about is a LIST now rather than two scalars, and that is the
// interesting half: getPath/setPath were only ever exercised on scalars, and an
// array silently kept by reference or dropped as "not a value" would look exactly
// like the sessionCancelHours bug in mirror image.
const configured = {
  autoApprove: true,
  pendingExpiryDays: 7,
  registrationFeeCutoffDate: '2026-09-30',
  cancellationPolicy: { tiers: [{ until: 'start', percent: 100 },
                                { until: '2026-10-28', percent: 'remaining' }] }
};
// What the drop-in form would actually send: the two shared fields and its own,
// and nothing at all for the three it did not draw.
const asDropin = REG.mergeRegistration(configured,
  { autoApprove: false, pendingExpiryDays: 7, sessionCancelHours: 24 }, 'dropin');

H.eq(asDropin.registrationFeeCutoffDate, '2026-09-30',
  'the fee cutoff survives a save that never mentioned it');
H.eq(closes(asDropin), '2026-10-28', 'so does the closing date, which is its last step');
H.eq(asDropin.cancellationPolicy.tiers[1].percent, 'remaining',
  'and the prorated step, which would otherwise silently fall back to the default 50');
H.eq(asDropin.cancellationPolicy.tiers.length, 2, 'with the schedule the same length it was');
H.eq(asDropin.sessionCancelHours, 24, 'the drop-in field it DID draw was applied');
H.eq(asDropin.autoApprove, false, 'and so was the shared one it changed');

console.log('\n[and switching back finds them where they were]');
// The round trip. The course form redraws populated from the stored record, so
// it sends the values back — this asserts they were there to be drawn from.
const backToCourse = REG.mergeRegistration(asDropin, {
  autoApprove: false,
  pendingExpiryDays: 7,
  registrationFeeCutoffDate: asDropin.registrationFeeCutoffDate,
  cancellationPolicy: asDropin.cancellationPolicy
}, 'course');
H.eq(backToCourse.registrationFeeCutoffDate, '2026-09-30', 'the fee cutoff came back');
H.eq(backToCourse.cancellationPolicy.tiers[1].percent, 'remaining', 'and the prorated step');
H.eq(closes(backToCourse), '2026-10-28', 'and the closing date');

console.log('\n[the same rule for the two prices, which are the same trap]');
// A course quotes the term and a drop-in quotes the session, so exactly one of
// the two is drawn — and the undrawn one has to survive being undrawn.
const stored = { registrationFee: 50, fullPrice: 300, perSessionPrice: null };
const sentByDropinForm = { registrationFee: 50, perSessionPrice: 12 };
const kept = REG.keepUndrawnFactKeys('price', stored, sentByDropinForm, 'dropin');
H.eq(kept.fullPrice, 300, 'the term price survives a save from the drop-in form');
H.eq(kept.perSessionPrice, 12, 'and the session price it did draw was applied');

const storedDropin = { registrationFee: 50, fullPrice: null, perSessionPrice: 12 };
const sentByCourseForm = { registrationFee: 50, fullPrice: 300 };
const keptBack = REG.keepUndrawnFactKeys('price', storedDropin, sentByCourseForm, 'course');
H.eq(keptBack.perSessionPrice, 12, 'and the other way round, the session price survives');
H.eq(keptBack.fullPrice, 300, 'while the term price applies');

// Nothing else is scoped, and that is asserted rather than assumed: a fact key
// quietly added to the scoped list would stop being editable by one type with
// no other symptom.
H.eq(Object.keys(REG.TYPE_SCOPED_FACT_KEYS).join(','), 'price',
  'price is the only type-scoped fact — every other one is drawn by both');

console.log('\n[the client draws and reads back from the same list]');
// The rule is enforced on the server, which is what makes it a rule. But a
// client that draws a field and forgets to read it back loses what an admin
// typed, and no server rule can recover that — so the two loops are pinned to
// the same source here, the way the SEO panel already is.
H.ok(/S\.schema\.registration\.forEach/.test(adminJs), 'the panel is drawn from the schema list');
H.ok(/\(S\.schema\.registration \|\| \[\]\)\.forEach/.test(adminJs),
  'and read back by walking the same list, not a hand-written set of ids');
H.ok(/if \(!drawsField\(d, type\)\) return;/.test(adminJs),
  'skipping exactly the fields it did not draw');
H.ok(/rec\.registration = readRegistration\(\)/.test(adminJs),
  'and the result reaches the record that is sent');

// The price read-back is the client half of the same trap, and it now covers
// FOUR fields rather than one. Two of them — the late price and the bundle list
// — are drop-in only and are not one number an admin can retype: a bundle list
// is several products, each with an id a family's purchase points at.
H.ok(/if \(currentType\(\) === 'dropin'\) \{\s*\n\s*out\.perSessionPrice/.test(adminJs),
  'the client sends only the price fields it drew');
H.ok(/out\.bundles = syncBundles\(\);/.test(adminJs),
  'including the bundle list, read from the model the editor keeps');
H.ok(/out\.lateDropIn = \{/.test(adminJs), 'and the late price');
const scoped = fs.readFileSync(path.join(R, 'netlify/functions/_activity-registration.js'), 'utf8');
H.ok(/lateDropIn: \['dropin'\], bundles: \['dropin'\]/.test(scoped),
  'and the server keeps both of them when a course does not send them');
H.ok(!/perSessionPrice: readNum\('fact-price-perSessionPrice'\),\s*\n\s*fullPrice:/.test(adminJs),
  'and never both, which would send null for the one it did not show');

console.log('\n[none of it is words, so a restricted role cannot touch it]');
// One answer serves all three languages, exactly like robots and shareImage.
// A role permitted to edit only Russian must not be able to move a cutoff date
// on the Hebrew page.
const serverJs = fs.readFileSync(path.join(R, 'netlify/functions/activities-admin.js'), 'utf8');
const simpleKeys = (serverJs.match(/const SIMPLE_KEYS = [\s\S]*?;/) || [''])[0];
H.ok(simpleKeys.indexOf('registration') === -1,
  'the registration group is NOT in SIMPLE_KEYS, which is the translatable scalars');
H.ok(/if \(incoming\.registration !== undefined\) \{\s*\n\s*out\.registration = REG\.mergeRegistration/
  .test(serverJs.replace(/\/\/[^\n]*\n/g, '')),
  'and it is merged inside the full-access branch, with the rest of the structure');

// ⚠ AND THE SAME BUG WAS ONE LAYER UP, IN THE CLIENT'S OWN MODEL.
//
// Everything above is the SERVER half, and it was right the whole time. The
// values were destroyed before the server ever saw them.
//
// The type select's handler read the form into S.record before redrawing —
// correct on its own, and there for a real reason: a redraw that has not
// captured what the admin just typed eats it. But it ASSIGNED the read-back:
//
//     S.record.facts = readFacts();
//
// readFacts() returns ONLY WHAT IS DRAWN, by design and for the same reason the
// server has keepUndrawnFactKeys. So the instant the select moved to Drop-in,
// the term price, the bundles and both cutoffs vanished from the model. The form
// then drew empty boxes for them on the way back to Course — and saving an empty
// box that the form DID draw is an admin clearing it, which the server honours,
// correctly.
//
// So nothing was broken at either end and the values were lost in between.
// Reported from QA as "the registration fee was kept, but the rest of the
// information was lost (course price and cutoff dates)" — the fee survived
// because it is the one price field BOTH types draw.
console.log('\n[the client keeps what its own form did not draw]');
const vm = require('vm');
const sliceFn = (name) => {
  const a = adminJs.indexOf('  function ' + name + '(');
  H.ok(a !== -1, 'found ' + name);
  return adminJs.slice(a, adminJs.indexOf('\n  function ', a + 1));
};
const clientCtx = { out: null };
vm.createContext(clientCtx);
vm.runInContext([sliceFn('keepUndrawnFacts'), sliceFn('keepUndrawnRegistration'),
                 'out = { facts: keepUndrawnFacts, reg: keepUndrawnRegistration };'].join('\n'),
                clientCtx);
const keep = clientCtx.out;

// A configured course, and what a DROP-IN form reads back off the screen: no
// fullPrice input exists, so no fullPrice key is sent.
const storedFacts = { price: { registrationFee: 50, fullPrice: 300, showPerLesson: false },
                      groupSize: { overrideText: { he: '', en: '', ru: '' } } };
const drawnAsDropin = { price: { registrationFee: 50, showPerLesson: false,
                                 perSessionPrice: 12, bundles: [{ id: 'b1', entries: 5 }] },
                        groupSize: { overrideText: { he: '', en: '', ru: '' } } };
const afterSwitch = keep.facts(storedFacts, drawnAsDropin);
H.eq(afterSwitch.price.fullPrice, 300,
  'the term price survives the select moving to Drop-in');
H.eq(afterSwitch.price.perSessionPrice, 12, 'and what WAS drawn is taken');

// And back again: a COURSE form draws neither the per-session price nor the
// bundles. The bundles matter more than the number — a family's purchase points
// at a bundle id, so losing the list strands live entries.
const drawnAsCourse = { price: { registrationFee: 50, showPerLesson: false, fullPrice: 300 },
                        groupSize: { overrideText: { he: '', en: '', ru: '' } } };
const roundTrip = keep.facts(afterSwitch, drawnAsCourse);
H.eq(roundTrip.price.perSessionPrice, 12, 'the per-session price survives the trip back');
H.eq(roundTrip.price.bundles.length, 1,
  'and so does the bundle list, which is products a purchase points at rather than a number');

// The cutoffs live one level down, at cancellationPolicy.<key>, so a form that
// does not draw them sends the PARENT without that key in it.
const storedReg = { autoApprove: false, registrationFeeCutoffDate: '2026-09-30',
                    cancellationPolicy: { tiers: [{ until: 'start', percent: 100 },
                                                  { until: '2026-10-28', percent: 50 }] } };
const drawnReg = { autoApprove: false, sessionCancelHours: 24, cancellationPolicy: {} };
const afterReg = keep.reg(storedReg, drawnReg);
H.eq(afterReg.registrationFeeCutoffDate, '2026-09-30', 'the fee cutoff survives');
H.eq(closes(afterReg), '2026-10-28',
  'and the schedule nested inside cancellationPolicy, which a shallow merge would have lost');
H.eq(afterReg.sessionCancelHours, 24, 'while what the drop-in form drew is taken');

// The handler must USE them, or the helpers are two functions nothing calls.
const stripped = adminJs.replace(/\/\/[^\n]*\n/g, '');
H.ok(/S\.record\.facts = keepUndrawnFacts\(S\.record\.facts, read\.facts\)/.test(stripped),
  'the type handler merges the facts rather than assigning them');
H.ok(/S\.record\.registration = keepUndrawnRegistration\(/.test(stripped),
  'and the registration too');
H.ok(!/S\.record\.facts = read\.facts/.test(stripped),
  'and the bare assignment that caused it is gone, not left beside the fix');

// ---------------------------------------------------------------------------
// ⚠ AND THE WHOLE ROUND TRIP, THROUGH REAL SAVES.
//
// Everything above tests the two halves apart: the server's merge with hand-made
// records, and the client's merge in a VM. QA reported it a third way — "I
// switched and saved as draft, then switched back to Course and saved as draft,
// and lost the term price and both cutoff dates" — which is neither half on its
// own but the sequence: merge, SAVE, reload what came back, merge again, SAVE.
//
// The save is what makes it a different test. saveDraft goes through
// mergeByPermission and hands the merged record back, and the client then adopts
// that record wholesale (`S.record = res.data.activity`). A merge that is right
// in isolation and a response that drops a key would look exactly like the bug
// that was fixed, and neither half above would notice.
(async () => {
  const blobs = H.makeBlobs();
  const mods = H.loadWithStubs({ blobs, github: H.makeGithub(), modules: ['activities-admin'] });
  const admin = mods['activities-admin'];
  const s = await H.installSession(blobs, H.superAdminSession());
  const save = (activity, base) => H.call(admin.handler,
    { token: s.token, action: 'saveDraft', activity: activity, baseUpdatedAt: base });
  const figures = (rec) => ({
    fullPrice: ((rec.facts || {}).price || {}).fullPrice,
    fee: (rec.registration || {}).registrationFeeCutoffDate,
    cancel: closes(rec.registration || {})
  });

  console.log('\n[the whole trip: configure, save as drop-in, save back as course]');

  let rec = (await save({
    slug: 'roundtrip', status: 'draft', type: 'course',
    title: { he: '\u05d1\u05d3\u05d9\u05e7\u05d4', en: 'Roundtrip', ru: '\u0422\u0435\u0441\u0442' },
    about: { he: 'x', en: 'x', ru: 'x' },
    groups: [{ groupId: 'g1', name: { he: '', en: '', ru: '' }, capacity: 10,
               teacherIds: [], facts: {} }],
    facts: { price: { registrationFee: 50, fullPrice: 300, showPerLesson: false } },
    registration: { autoApprove: true, registrationFeeCutoffDate: '2026-09-30',
                    cancellationPolicy: { tiers: [{ until: 'start', percent: 100 },
                                                  { until: '2026-10-28', percent: 50 }] } }
  })).body.activity;
  H.eq(JSON.stringify(figures(rec)),
    JSON.stringify({ fullPrice: 300, fee: '2026-09-30', cancel: '2026-10-28' }),
    '1. a configured course');

  // What a DROP-IN form sends: no term-price box, no cutoff boxes, so neither
  // key is in the request at all. This is the shape the client produces AFTER
  // its own keepUndrawnFacts has run, which is why the merge is being asked the
  // question twice — once on each side of the wire.
  rec = (await save(Object.assign({}, rec, {
    type: 'dropin',
    facts: { price: { registrationFee: 50, perSessionPrice: 12, showPerLesson: false, bundles: [] } },
    registration: { autoApprove: true, sessionCancelHours: 24, cancellationPolicy: {} }
  }), rec.isoUpdated)).body.activity;
  H.eq(JSON.stringify(figures(rec)),
    JSON.stringify({ fullPrice: 300, fee: '2026-09-30', cancel: '2026-10-28' }),
    '2. saved as a drop-in, and the course fields are still on the record');
  H.eq(((rec.facts || {}).price || {}).perSessionPrice, 12, '   with what the drop-in form DID draw');

  rec = (await save(Object.assign({}, rec, {
    type: 'course',
    facts: { price: { registrationFee: 50, fullPrice: figures(rec).fullPrice, showPerLesson: false } },
    registration: { autoApprove: true, registrationFeeCutoffDate: figures(rec).fee,
                    cancellationPolicy: rec.registration.cancellationPolicy }
  }), rec.isoUpdated)).body.activity;
  H.eq(JSON.stringify(figures(rec)),
    JSON.stringify({ fullPrice: 300, fee: '2026-09-30', cancel: '2026-10-28' }),
    '3. and saved back as a course, unchanged — which is the report');
  H.eq(((rec.facts || {}).price || {}).perSessionPrice, 12,
    '   and the per-session price survived the trip out and back too');

  // ⚠ AND A DRAFT SAYS WHAT WOULD STOP IT BEING PUBLISHED.
  //
  // validate() runs on preview and on publish and deliberately not here — a
  // draft is work in progress, and a save that fights back over a panel further
  // down is a save people learn to dread. But saying NOTHING made the rule
  // invisible: QA set prorated cancellation on an activity with no session
  // calendar, saved, and reported that it went through with no issue. It had.
  // The refusal was several screens and one decision later.
  console.log('\n[a draft is saved whatever is in it, and told what would stop it]');
  const clean = await save(Object.assign({}, rec, { slug: 'roundtrip' }), rec.isoUpdated);
  H.eq(JSON.stringify(clean.body.warnings || []), '[]', 'a sound draft warns about nothing');

  const bad = await save(Object.assign({}, clean.body.activity, {
    registration: Object.assign({}, clean.body.activity.registration, {
      cancellationPolicy: { mode: 'prorated' } })
  }), clean.body.activity.isoUpdated);
  H.eq(bad.status, 200, 'prorated with no session calendar still SAVES — a draft is never refused');
  H.eq((bad.body.warnings || []).length, 1, 'and comes back with exactly what would stop it');
  H.ok(/session calendar/.test(bad.body.warnings[0]),
    'naming the missing calendar: ' + bad.body.warnings[0]);

  // ONE validate(), so the warning here and the refusal at publish cannot become
  // two different accounts of one rule.
  const published = await H.call(admin.handler, { token: s.token, action: 'publish',
    activity: Object.assign({}, bad.body.activity, { status: 'open' }),
    baseUpdatedAt: bad.body.activity.isoUpdated });
  H.ok(published.status >= 400, 'and publishing it is refused, as it always was');
  H.eq(published.body.error, bad.body.warnings[0],
    'in the very same words, because it is the same validate()');

  H.done();
})();
