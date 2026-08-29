// What this defends against:
//
// "I clicked on publish. Didn't get an error, but didn't get a confirmation."
//
// That was reported once and fixed once, for the FAILURE path: send() had no
// .catch, and an error with no text rendered as an empty box. The success path
// then broke the same way, for a different reason, and looked identical from
// the outside — a button that does nothing.
//
// doPublish wrote "Published." into the message box and immediately called
// load() to reload the record. load() begins with message(''), so the
// confirmation was erased microseconds after it was written. The publish had
// worked; the commit was on GitHub; the admin just never said so.
//
// The ordering is the whole fix, so the ordering is what this pins: in any
// action that both reports success and reloads, the report comes AFTER the
// reload resolves. A test that only checked "is there a message() call" would
// have passed throughout the bug.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'activities-admin.js'), 'utf8');

// The body of one top-level function in that file, up to the next one.
function body(name) {
  const start = src.indexOf('function ' + name + '(');
  H.ok(start !== -1, name + ' exists');
  const next = src.indexOf('\n  function ', start + 1);
  return src.slice(start, next === -1 ? src.length : next);
}

console.log('[load() clears the message box, which is what makes order matter]');
const load = body('load');
H.ok(/message\(''\)/.test(load), 'load() still clears the box on its way in');

console.log('\n[so every action that reloads reports afterwards]');
['doPublish', 'doUnpublish'].forEach((name) => {
  const fn = body(name);
  H.ok(/load\(S\.slug\)\.then\(function \(\) \{ message\('ok'/.test(fn),
       name + ' reports success inside load()\'s .then, not before it');
  // And not the old shape: a bare load() after the message.
  const okAt = fn.indexOf("message('ok'");
  const loadAt = fn.indexOf('load(S.slug)');
  H.ok(okAt > loadAt, name + ' mentions the reload before the confirmation, not after');
  H.ok(!/message\('ok'[\s\S]*\n\s*load\(S\.slug\);/.test(fn),
       name + ' does not fall back to the erased-message shape');
});

console.log('\n[actions that do NOT reload may report immediately]');
// refreshList() and fillForm() do not touch the message box, so these are fine
// as they are — the rule is about load(), not about all reporting.
['doSaveDraft', 'doDelete'].forEach((name) => {
  const fn = body(name);
  H.ok(/message\('ok'/.test(fn), name + ' still reports success');
  H.ok(!/load\(S\.slug\)/.test(fn), name + ' does not reload, so nothing erases it');
});

console.log('\n[and the failure path that started all this is still wired]');
H.ok(/function failure\(/.test(src), 'failure() still builds text for an error with no message');
H.ok(/\.catch\(/.test(body('send')), 'send() still catches, so a dead request cannot be silent');

H.done();
