// What this defends against:
//
// Ogen's payments run through Shirat HaYam's Stripe account. That is a
// decision, not an accident, and it puts two organisations' money in one
// account with one set of keys and one webhook stream.
//
// THE FAILURE THIS GUARDS IS CROSS-DELIVERY. Stripe sends every event on an
// account to every endpoint registered on it, filtered by event TYPE and never
// by metadata. So Ogen's webhook receives Shirat HaYam's donations and event
// registrations, and theirs receives Ogen's. Nothing about the transport keeps
// them apart; a tag does, and only if every object carries it and exactly one
// function reads it.
//
// The sister site ignores Ogen's payments today by looking up
// `events[metadata.event_slug]`, finding nothing, logging "unknown event_slug"
// and returning null. That works. It works by falling off the end of a lookup,
// which is a different thing from a rule — and the day an Ogen session carries
// an `event_slug` matching a real event of theirs, their whole pipeline fires:
// a Sheets row and a confirmation email in their name, to an Ogen parent.
//
// So on this side the rule is explicit and has one implementation. The test
// that matters most is the third one: an object with NO organization tag is not
// ours. Every Shirat HaYam object ever created predates this tag, so reading a
// missing tag as "ours" would claim the entire history of the other
// organisation's payments.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const S = require(H.fnPath('_stripe'));

console.log('[the tag decides, and nothing else does]');
H.eq(S.ORGANIZATION, 'ogen', 'this side is "ogen"');
H.ok(S.isOurs({ metadata: { organization: 'ogen' } }), 'a tagged object is ours');
H.ok(!S.isOurs({ metadata: { organization: 'shirat-hayam' } }), 'another organisation is not');
// THE ONE THAT MATTERS.
H.ok(!S.isOurs({ metadata: {} }), 'an UNTAGGED object is not ours — every Shirat HaYam object is untagged');
H.ok(!S.isOurs({}), 'and neither is one with no metadata at all');
H.ok(!S.isOurs(null), 'nor null, which is what a malformed payload gives you');
// Not a near-miss, not a prefix, not a case fold. An exact tag or nothing.
['Ogen', 'OGEN', 'ogen ', ' ogen', 'ogen-cy'].forEach((v) => {
  H.ok(!S.isOurs({ metadata: { organization: v } }), 'not ours: ' + JSON.stringify(v));
});

console.log('\n[every object we create carries the tag]');
const m = S.meta({ participant_id: 'p-1', activity_id: 'act-1' });
H.eq(m.organization, 'ogen', 'meta() always stamps the organisation');
H.ok(S.isOurs({ metadata: m }), 'and what meta() builds passes isOurs by construction');
// Stripe keeps the first 500 characters of a metadata value and drops the rest
// silently, so a long value becomes a quietly wrong one rather than an error.
const long = S.meta({ note: 'x'.repeat(900) });
H.eq(long.note.length, 500, 'a long value is cut to 500 here rather than truncated by Stripe');
// Empty values are dropped, not sent as "". An empty string in Stripe metadata
// is a key that exists and says nothing, which reads as data in the dashboard.
const sparse = S.meta({ a: '', b: null, c: undefined, d: 0 });
H.ok(!('a' in sparse) && !('b' in sparse) && !('c' in sparse), 'blank values are omitted');
H.eq(sparse.d, '0', 'but a real zero survives, as a string like all Stripe metadata');

console.log('\n[reconciliation needs the join keys, not just the filter]');
H.eq(S.registrationRef({ metadata: { participant_id: 'p-1', activity_id: 'act-1' } }).participantId, 'p-1',
  'both keys present resolves to a registration');
H.eq(S.registrationRef({ metadata: { participant_id: 'p-1' } }), null,
  'HALF the key resolves to nothing — a payment that cannot name its registration ' +
  'is for a person to look at, not for code to guess by matching an amount');
H.eq(S.registrationRef({ metadata: {} }), null, 'and neither key resolves to nothing');

console.log('\n[the statement descriptor obeys the rules we do not control]');
// Verified against docs.stripe.com/get-started/account/statement-descriptors:
// complete descriptor 5-22 chars including the "* " separator, prefix 2-10,
// both halves need a letter, and < > \ ' " * are forbidden.
const suffix = S.STATEMENT_DESCRIPTOR_SUFFIX;
H.ok(/[A-Za-z]/.test(suffix), 'the suffix contains at least one letter, which Stripe requires of BOTH halves');
H.ok(!/[<>\\'"*]/.test(suffix), 'and none of the forbidden characters');
H.ok(/^[\x20-\x7E]+$/.test(suffix), 'and is Latin-only');
// The account prefix is 2-10 characters, so the worst case leaves 22-10-2 = 10
// for us. Sizing the suffix to a bigger budget would make it depend on a
// setting the OTHER organisation can change without telling anyone here.
H.ok(suffix.length <= 10,
  'the suffix fits even the longest permitted account prefix (' + suffix.length + ' chars) — ' +
  'the prefix is not ours and can change without notice');
H.ok(suffix.length >= 1, 'and is not empty');

console.log('\n[statement_descriptor is never set — Stripe errors on it for cards]');
const src = fs.readFileSync(H.fnPath('_stripe'), 'utf8').replace(/\/\/.*$/gm, '');
H.ok(src.indexOf('statement_descriptor_suffix') !== -1 || src.indexOf('STATEMENT_DESCRIPTOR_SUFFIX') !== -1,
  'the suffix is what this module exports');
H.ok(!/statement_descriptor\s*:/.test(src),
  'and statement_descriptor is never assigned — setting it on a card charge returns an error');

console.log('\n[there is exactly one place the SDK is constructed]');
const fns = fs.readdirSync(path.join(R, 'netlify/functions')).filter((f) => f.endsWith('.js'));
const constructs = fns.filter((f) => {
  const s = fs.readFileSync(path.join(R, 'netlify/functions', f), 'utf8').replace(/\/\/.*$/gm, '');
  return /require\(['"]stripe['"]\)/.test(s);
});
H.eq(constructs.join(','), '_stripe.js',
  'only _stripe.js requires the SDK, so the organisation tag cannot be forgotten at a call site');

H.done();
