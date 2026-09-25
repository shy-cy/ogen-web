// WHAT MAKES TWO TERMS ONE ACTIVITY, and the one field that has to follow.
//
// A slug is one semester. The spring term of a course is a second record with
// its own dates, its own calendar and its own page, and everything the site
// publishes wants it that way. `seriesId` is the one thing that says two of
// those records are the same activity, and it exists for exactly one reason:
// the registration fee is charged once a year per participant per activity, so
// a child returning in the spring must not be charged it twice.
//
// ⚠ AND THE FEE ITSELF WAS STILL TYPED PER TERM. feeApplies() waives it
// correctly, which is why nothing looked wrong — but every term drew its own
// `registrationFee` box, so the ONE yearly fee of a series had as many values
// as the series had terms, and which of them a family paid was decided by
// which term they happened to walk in through:
//
//   autumn 50, spring 80   a child joining in autumn pays 50 and the spring is
//                          waived. A child joining in spring pays 80 and the
//                          autumn is waived. Two families, one series, one
//                          "yearly fee", two figures — and each term's public
//                          price card printed its own as if it were the answer.
//
// Nobody typed anything twice and neither number was wrong on its own. It is
// the PAIR that is wrong, which is the same shape as the two facts that printed
// their structured list and a restatement of it underneath: no single screen
// could show it, because each form draws one activity.
//
// So the fee belongs to the SERIES, and a series' owner is its head — the
// record whose activityId IS its seriesId. Every other term carries a copy the
// server writes on every save, and its form shows that copy read-only.
//
// ⚠ A STORED COPY RATHER THAN A LOOKUP, on purpose.
// `facts.price.registrationFee` is read by priceRows() — which is PURE, takes
// ONE activity, and feeds the published page, the listing card and the family
// area's facts card — and by owedCentsFor() and the frozen block. Writing the
// resolved figure onto the record keeps every one of those right with no change
// to any of them. Resolving at read time would mean threading a second record
// through four call sites in three handlers, and two of those modules are pure
// and take one activity by contract. That is the written-twice trap this
// codebase keeps meeting.
//
// What a copy costs is staleness, in one direction only: the head's fee is
// edited and a linked term is not saved afterwards. staleTerms() is that
// direction — the head's publish names the terms still carrying the old figure,
// rather than leaving the divergence to be found on a family's invoice.
//
// ⚠ ONLY THE FEE.
//
//   fullPrice                  NOT inherited. A semester is priced per
//                              semester, which is the whole reason two records
//                              exist rather than one.
//   registrationFeeCutoffDate  NOT inherited. It is the deadline for getting
//                              THIS registration's fee back, and a newcomer
//                              joining at the spring term answers to the
//                              spring's own calendar. Inheriting it would let
//                              one term's dates govern another term's families,
//                              which is exactly what resolving the cutoffs per
//                              GROUP exists to prevent.
//
// Pure: no store, no clock, no GitHub. It is handed the candidate records and
// says what follows from them.

const idOf = (a) => (a && a.activityId) || null;

// The series this record belongs to. Defaults to its own id, so every activity
// is a series of one — the same rule seriesOf() in _registration.js applies,
// and for the same reason: "does this carry a seriesId" cannot tell a linked
// first term from an unlinked activity, because the first term of a series is
// usually the pointer TARGET and carries nothing itself.
const seriesOf = (a) => (a && (a.seriesId || a.activityId)) || null;

// Is this a term of somebody ELSE's series?
//
// ⚠ IT READS THE STORED FIELD, NOT seriesOf(). The difference is a record that
// has no activityId yet — a brand new activity an admin has just pointed at
// another term. seriesOf() would fall back to its own (absent) id and answer
// "no", and the fee would not be inherited on preview while it would be on
// publish, one save later. That asymmetry is precisely what
// preview-matches-publish exists to forbid, so the test is the raw field: a
// seriesId is always some OTHER activity's id unless the merge has just written
// this record's own id into it, which is what "its own activity" is stored as.
function isLinkedTerm(activity) {
  const series = (activity && activity.seriesId) || null;
  if (!series) return false;
  const own = idOf(activity);
  return !own || series !== own;
}

// The record that owns the series, matched by id and never by slug or position.
// A slug is renameable and a position is an accident; the id is the thing
// registrations point at.
function findHead(activity, candidates) {
  const series = seriesOf(activity);
  if (!series) return null;
  return (candidates || []).filter((c) => idOf(c) === series)[0] || null;
}

// A number or null, never '' and never NaN — the same normalisation
// _activity-migrate.js applies to this field, so a comparison here and a value
// stored there cannot disagree about what an empty box means.
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

const feeOf = (a) => num(((((a || {}).facts) || {}).price || {}).registrationFee);

// The one refusal, in one string, because two callers read it — saveDraft shows
// it as a warning and publish refuses with it, and this file's own rule is that
// those must not become two accounts of one thing.
//
// Unresolvable means the head has been deleted, or unpublished and its draft
// deleted. Keeping the typed number would be the bug this module exists to fix,
// silently, so it is said out loud instead.
const NO_HEAD = 'This is marked as a term of another activity, but that activity no longer '
  + 'exists. The registration fee belongs to the series, so there is nothing to inherit it '
  + 'from — point it at a term that does exist, or set it back to its own activity.';

// What this record's fee must be, and whether writing it changes anything.
//
//   { inherits: false }                        a head, or unlinked: it owns its fee
//   { inherits: true, problem }                linked, and the head is gone
//   { inherits: true, head, fee, changed }     linked: `fee` is the answer
function resolve(activity, candidates) {
  if (!isLinkedTerm(activity)) return { inherits: false };
  const head = findHead(activity, candidates);
  if (!head) return { inherits: true, head: null, problem: NO_HEAD };
  const fee = feeOf(head);
  return { inherits: true, head, fee, changed: feeOf(activity) !== fee };
}

// Writes the resolved figure onto the record. The path
// `facts.price.registrationFee` is spelled once, here, rather than at each
// caller — a second spelling is a second place it can be written to the wrong
// key and quietly do nothing.
function applyFee(activity, candidates) {
  const r = resolve(activity, candidates);
  if (!r.inherits || r.problem) return r;
  const facts = activity.facts || (activity.facts = {});
  const price = facts.price || (facts.price = {});
  price.registrationFee = r.fee;
  return r;
}

// The other direction, read on a HEAD's publish: linked terms whose stored copy
// no longer matches. A copy can only go stale this way round, because a linked
// term re-reads the head on every one of its own saves.
function staleTerms(head, candidates) {
  const own = idOf(head);
  if (!own) return [];
  const mine = feeOf(head);
  return (candidates || []).filter((c) =>
    idOf(c) && idOf(c) !== own && (c.seriesId || null) === own && feeOf(c) !== mine);
}

// Said on the head's publish. It names the figures rather than only the fact
// that they differ: "a term disagrees" is a sentence somebody has to go and
// investigate, and the two numbers are the whole of the investigation.
function staleMessage(head, terms) {
  if (!terms || !terms.length) return null;
  const mine = feeOf(head);
  const money = (v) => (v == null ? 'none' : v + ' €');
  return terms.length + ' linked term' + (terms.length === 1 ? '' : 's')
    + ' still carr' + (terms.length === 1 ? 'ies' : 'y') + ' the previous registration fee: '
    + terms.map((t) => t.slug + ' (' + money(feeOf(t)) + ')').join(', ')
    + '. The fee is now ' + money(mine) + '. Open each and save it to bring it across — '
    + 'a term inherits the fee when it is saved, so nothing has changed on those pages yet.';
}

module.exports = {
  isLinkedTerm, findHead, resolve, applyFee, staleTerms, staleMessage,
  seriesOf, feeOf, NO_HEAD
};
