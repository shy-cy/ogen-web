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
H.ok(courseFields.indexOf('cancellationPolicy.mode') !== -1, 'and the cancellation policy');
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
const configured = {
  autoApprove: true,
  pendingExpiryDays: 7,
  registrationFeeCutoffDate: '2026-09-30',
  cancellationPolicy: { mode: 'prorated', cancellationCutoffDate: '2026-10-28' }
};
// What the drop-in form would actually send: the two shared fields and its own,
// and nothing at all for the three it did not draw.
const asDropin = REG.mergeRegistration(configured,
  { autoApprove: false, pendingExpiryDays: 7, sessionCancelHours: 24 }, 'dropin');

H.eq(asDropin.registrationFeeCutoffDate, '2026-09-30',
  'the fee cutoff survives a save that never mentioned it');
H.eq(asDropin.cancellationPolicy.cancellationCutoffDate, '2026-10-28', 'so does the other date');
H.eq(asDropin.cancellationPolicy.mode, 'prorated',
  'and the mode, which would otherwise silently fall back to the default');
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
H.eq(backToCourse.cancellationPolicy.mode, 'prorated', 'and the mode');
H.eq(backToCourse.cancellationPolicy.cancellationCutoffDate, '2026-10-28', 'and the date');

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

H.done();
