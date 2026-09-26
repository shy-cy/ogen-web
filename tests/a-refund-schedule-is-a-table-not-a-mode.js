// What this defends against:
//
// A CANCELLATION POLICY THAT COULD ONLY BE ONE OF TWO SHAPES.
//
// It was a MODE — flat or prorated — plus one closing date. Ogen runs terms where
// what comes back should step down more than once, and there was no way to say
// so: an admin could pick "half" or "by sessions remaining" and one deadline, and
// nothing else was expressible.
//
// It is a list of steps now, each with its own boundary and its own percentage.
// The migration is exact rather than approximate, and it is exact because the old
// pair WAS a two-step schedule that could not say so — see
// tests/a-frozen-policy-means-what-it-meant.js, which compares the two
// arithmetics to the cent across thirteen thousand combinations. This suite is
// about everything else: what the admin may configure, what is refused, what a
// family reads, and the optional sentence that explains a date.
//
// ⚠ EVERY VALIDATION RULE IS ASSERTED IN BOTH DIRECTIONS. "This is refused" alone
// passes on a function that refuses everything, and that failure would only be
// found by an admin who could no longer publish.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');
const F = require('./_fixtures');
const REG = require(H.fnPath('_activity-registration'));
const C = require(H.fnPath('_credit'));
const terms = require(H.fnPath('_cancellation-terms'));

const R = path.join(__dirname, '..');
const closes = (reg) => {
  const list = ((reg.cancellationPolicy || reg) || {}).tiers || [];
  return list.length ? list[list.length - 1].until : null;
};
const withTiers = (tiers, over) => F.course(Object.assign({
  registration: { autoApprove: true, registrationFeeCutoffDate: '2026-09-30',
                  cancellationPolicy: { tiers: tiers } }
}, over || {}));
const errs = (activity) => REG.validateRegistration(activity);
const refuses = (activity, pattern, why) => {
  const list = errs(activity);
  H.ok(list.some((e) => pattern.test(e)), why + (list.length ? '' : ' (nothing was refused at all)'));
};

// ---------------------------------------------------------------------------
console.log('[the default for a new activity is what the site has always done]');
// A default that changes behaviour is a silent policy change on every activity
// created after it. The old default was mode 'flat' plus a closing date computed
// on save, which is exactly this — now visible as two rows instead of hidden in a
// select and a date box.
const fresh = REG.normaliseRegistration({}, 'course');
H.eq(fresh.cancellationPolicy.tiers.length, 2, 'two steps');
H.eq(fresh.cancellationPolicy.tiers[0].until, 'start', 'everything back until it starts');
H.eq(fresh.cancellationPolicy.tiers[0].percent, 100, 'all of it');
H.eq(fresh.cancellationPolicy.tiers[1].percent, 50, 'then half');
H.eq(fresh.cancellationPolicy.tiers[1].until, null,
  'until a closing date nobody has set yet, which defaultIfBlank() fills on save');
H.eq(fresh.cancellationPolicy.mode, undefined, 'and no mode is stored at all');
H.eq(fresh.cancellationPolicy.cancellationCutoffDate, undefined,
  '⚠ nor a closing date of its own — beside a table of steps it would be a second ' +
  'field able to contradict the last one');

console.log('\n[a record written before the schedule is translated, once, on read]');
const legacyPro = REG.normaliseRegistration(
  { cancellationPolicy: { mode: 'prorated', cancellationCutoffDate: '2026-11-04' } }, 'course');
H.eq(legacyPro.cancellationPolicy.tiers[1].percent, 'remaining', 'prorated becomes a prorated step');
H.eq(closes(legacyPro), '2026-11-04', 'and the closing date becomes its boundary');
// Idempotent, the rule migrate() follows: the second pass finds what the first
// wrote rather than translating a translation.
const twice = REG.normaliseRegistration(legacyPro, 'course');
H.eq(JSON.stringify(twice.cancellationPolicy.tiers), JSON.stringify(legacyPro.cancellationPolicy.tiers),
  'and a second pass changes nothing');
// ⚠ ABSENT AND EMPTY ARE DIFFERENT ANSWERS. Conflating them would re-invent a
// policy an admin deleted.
H.eq(REG.normaliseRegistration({ cancellationPolicy: { tiers: [] } }, 'course')
       .cancellationPolicy.tiers.length, 0,
  'an admin who deleted every step keeps an empty schedule');
H.eq(REG.normaliseRegistration({}, 'course').cancellationPolicy.tiers.length, 2,
  'while a record that never had one is translated');

console.log('\n[defaultIfBlank fills the last boundary and nothing else]');
const filled = REG.defaultIfBlank(withTiers(
  [{ until: 'start', percent: 100 }, { until: null, percent: 50 }]));
H.eq(closes(filled), '2026-10-28', 'the 30%-through session date, as it always was');
H.eq(filled.cancellationPolicy.tiers[0].until, 'start', 'and the step above it is untouched');
const kept = REG.defaultIfBlank(withTiers(
  [{ until: 'start', percent: 100 }, { until: '2026-01-02', percent: 50 }]));
H.eq(closes(kept), '2026-01-02', 'a date that is there is not overwritten');
const switchedOff = REG.defaultIfBlank(withTiers(
  [{ until: 'start', percent: 100 }, { until: 'none', percent: 50 }]));
H.eq(closes(switchedOff), 'none',
  'and "never closes" is a value, so the default does not refill it');

// ---------------------------------------------------------------------------
console.log('\n[what is refused, and what is not]');

const good = withTiers([{ until: 'start', percent: 100 },
                        { until: '2026-10-20', percent: 75 },
                        { until: '2026-11-04', percent: 50 }]);
H.eq(errs(good).length, 0, 'a three-step schedule in order is fine');

// 1. boundaries must increase
refuses(withTiers([{ until: '2026-11-04', percent: 100 }, { until: '2026-10-20', percent: 50 }]),
  /earliest first/, 'a step ending before the one above it is refused');
// 2. credit may not rise
refuses(withTiers([{ until: 'start', percent: 50 }, { until: '2026-11-04', percent: 75 }]),
  /more back by cancelling later/, 'a later step crediting more is refused');
H.eq(errs(withTiers([{ until: 'start', percent: 50 }, { until: '2026-11-04', percent: 50 }])).length, 0,
  '⚠ while EQUAL steps are allowed — redundancy is not a contradiction, and refusing ' +
  'it is a form fighting somebody halfway through an edit');
// 3. prorated only last
refuses(withTiers([{ until: 'start', percent: 'remaining' }, { until: '2026-11-04', percent: 50 }]),
  /Only the last refund step can be prorated/, 'prorated anywhere but last is refused');
// 4. prorated may only follow full-credit steps
refuses(withTiers([{ until: 'start', percent: 100 }, { until: '2026-10-20', percent: 50 },
                   { until: '2026-11-04', percent: 'remaining' }]),
  /can only follow steps that credit in full/,
  '⚠ and a prorated step after a 50% one is refused, because just as it opens it ' +
  'credits nearly everything — which would make the credit RISE');
H.eq(errs(withTiers([{ until: 'start', percent: 100 }, { until: '2026-10-20', percent: 100 },
                     { until: '2026-11-04', percent: 'remaining' }])).length, 0,
  'while after two full-credit steps it is fine');
// 5. a middle step that never closes
refuses(withTiers([{ until: 'none', percent: 100 }, { until: '2026-11-04', percent: 50 }]),
  /never stops/, 'a middle step that never closes makes the ones below unreachable');
H.eq(errs(withTiers([{ until: 'start', percent: 100 }, { until: 'none', percent: 50 }])).length, 0,
  'while the LAST step may never close — that is "cancellation always earns credit"');
// 6. a middle step with no date
refuses(withTiers([{ until: null, percent: 100 }, { until: '2026-11-04', percent: 50 }]),
  /Only the last step can be left blank/, 'a blank boundary above the last is refused');
// 7. the cap
const many = withTiers(Array.from({ length: 7 }, (_, i) =>
  ({ until: '2026-1' + (i < 3 ? '0-0' : '1-0') + ((i % 3) + 1), percent: 100 - i * 10 })));
refuses(many, /make the last step prorated/,
  '⚠ seven steps is refused, and the refusal names the thing that IS the unlimited case');
H.eq(REG.MAX_TIERS, 6, 'the cap is six');
// 8. a half-typed row
refuses(withTiers([{ until: 'start', percent: 100 }, { until: '2026-11-04', percent: '' }]),
  /has no percentage/,
  '⚠ a row with a date and no rate is refused rather than silently dropped — which is ' +
  'how normaliseBundles() once let an activity publish with nothing on offer');
// while a wholly empty row is dropped in silence: pressing "+" and changing your
// mind is not a mistake.
H.eq(errs(withTiers([{ until: 'start', percent: 100 }, { until: '2026-11-04', percent: 50 }, {}])).length, 0,
  'while a wholly empty row is dropped without complaint');
H.eq(REG.normaliseTiers([{ until: 'start', percent: 100 }, {}]).length, 1,
  'and really is dropped');

console.log('\n[⚠ an unscheduled activity is not refused, in either half]');
// 'start' on an activity with no start date and no calendar is EVERY activity
// somebody has just created. Refusing it blocked every first publish, which is
// what the suite caught. It resolves the generous way instead: hasStarted() on an
// empty list is false, so the step never closes and everything comes back — which
// is exactly what flat mode did, and the reason flat was the default.
const unscheduled = { type: 'course', facts: { duration: {} }, groups: [
  { groupId: 'g1', name: { he: '', en: '', ru: '' }, capacity: 10, teacherIds: [], facts: {} }],
  registration: { cancellationPolicy: { tiers: [{ until: 'start', percent: 100 },
                                                { until: null, percent: 50 }] } } };
H.eq(errs(unscheduled).length, 0, 'no start date and no calendar is not a refusal');
H.eq(REG.boundaryKey('start', unscheduled, 'g1'), Infinity,
  'an unresolvable boundary reads as "not reached"');

console.log('\n[a prorated step needs a calendar, per group]');
refuses(withTiers([{ until: 'start', percent: 100 }, { until: null, percent: 'remaining' }],
                  { facts: { duration: { startDate: '2026-10-14' } } }),
  /session calendar/, 'prorated with no calendar is refused');
H.eq(errs(withTiers([{ until: 'start', percent: 100 },
                     { until: null, percent: 'remaining' }])).length, 0,
  'and with one it is not');

// ---------------------------------------------------------------------------
console.log('\n[the schedule resolves per GROUP, because the boundaries do]');
const twoGroups = require('./_fixtures').TERM_PAIR ? null : null;
const perGroup = F.course({
  registration: { cancellationPolicy: { tiers: [{ until: 'start', percent: 100 },
                                                { until: null, percent: 50 }] } },
  groups: [
    { groupId: 'g-beg', name: { he: '', en: 'Beginners', ru: '' }, capacity: 10, teacherIds: [],
      facts: { duration: { startDate: '2026-10-05', endDate: '2026-10-26', sessionMinutes: 60,
        sessionDates: ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']
          .map((d) => ({ date: d, status: 'scheduled' })) },
        schedule: { frequency: 'weekly', sessions: [{ day: 'monday', time: '16:00' }] } } },
    { groupId: 'g-adv', name: { he: '', en: 'Advanced', ru: '' }, capacity: 10, teacherIds: [],
      facts: { duration: { startDate: '2026-10-07', endDate: '2026-11-25', sessionMinutes: 30,
        sessionDates: ['2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28',
                       '2026-11-04', '2026-11-11', '2026-11-18', '2026-11-25']
          .map((d) => ({ date: d, status: 'scheduled' })) },
        schedule: { frequency: 'weekly', sessions: [{ day: 'wednesday', time: '17:30' }] } } }
  ]
});
const begClose = closes({ cancellationPolicy: { tiers: REG.resolveTiers(perGroup, 'g-beg') } });
const advClose = closes({ cancellationPolicy: { tiers: REG.resolveTiers(perGroup, 'g-adv') } });
H.ok(begClose && advClose, 'each group resolves its own closing date');
H.ok(begClose !== advClose,
  '⚠ and they are DIFFERENT — four meetings and eight have different 30% points, so one ' +
  'activity-level date would have governed the other group\'s families invisibly');
// defaultIfBlank writes only when every group agrees, which here they do not.
H.eq(closes(REG.defaultIfBlank(perGroup)), null,
  'so nothing is written to the activity, and the answer is resolved at registration');
// And what a family actually freezes is their own group's.
H.eq(C.closingOf(C.freezeCancellation(perGroup, 'g-beg')), begClose,
  'Beginners freeze theirs');
H.eq(C.closingOf(C.freezeCancellation(perGroup, 'g-adv')), advClose, 'and Advanced theirs');

// ---------------------------------------------------------------------------
console.log('\n[what a family reads: sentences for the classic shape, a table otherwise]');
const classic = { tiers: [{ until: 'start', percent: 100 }, { until: '2026-11-04', percent: 50 }],
                  registrationFeeCutoffDate: '2026-09-09' };
['he', 'en', 'ru'].forEach((l) => {
  const lines = terms.termsFor({ type: 'course', cancellation: classic, hasFee: true }, l);
  H.ok(lines.every((x) => typeof x === 'string'),
    l + ': the classic shape is still sentences — every page on the site today is unchanged');
  H.eq(lines.length, 5, l + ': and the same five of them');
});
const stepped = { tiers: [{ until: 'start', percent: 100 }, { until: '2026-10-15', percent: 75 },
                          { until: '2026-11-04', percent: 50 }],
                  registrationFeeCutoffDate: '2026-09-09' };
['he', 'en', 'ru'].forEach((l) => {
  const lines = terms.termsFor({ type: 'course', cancellation: stepped, hasFee: true }, l);
  const table = lines.filter((x) => x && typeof x === 'object')[0];
  H.ok(table && table.schedule, l + ': three steps are rendered as a schedule, not four sentences');
  H.eq(table.schedule.length, 4, l + ': three steps and a closing row');
  H.eq(table.schedule[3].credit, terms.termsFor({ type: 'course', cancellation:
    { tiers: [{ until: '2026-01-01', percent: 0 }] } }, l)
    .filter((x) => x && typeof x === 'object')[0].schedule[0].credit,
    l + ': and "nothing" is the same word in both places');
  H.ok(table.schedule[0].credit !== '100%',
    l + ': ⚠ 100% is words rather than a figure — "100% of what" is the question the words answer');
  H.ok(/75/.test(table.schedule[1].credit), l + ': while anything in between is a percentage');
});
// A schedule that never closes has no "after that" row: there is nothing after it.
const never = terms.termsFor({ type: 'course', cancellation:
  { tiers: [{ until: 'start', percent: 100 }, { until: '2026-10-15', percent: 75 },
            { until: 'none', percent: 50 }] } }, 'en')
  .filter((x) => x && typeof x === 'object')[0];
H.eq(never.schedule.length, 3, 'a schedule that never closes prints no closing row');
// And the flattened form, for a caller with no room for two columns.
H.ok(terms.termsText({ type: 'course', cancellation: stepped, hasFee: true }, 'en')
       .every((x) => typeof x === 'string'), 'termsText() is strings all the way down');

// ⚠ AND THE EMAIL STILL HOLDS NO COPY OF THE POLICY. The words are the server's,
// in one module, because two copies of a policy is two policies.
const emailSrc = fs.readFileSync(H.fnPath('_registration-email'), 'utf8');
let checked = 0;
['he', 'en', 'ru'].forEach((l) => {
  [classic, stepped].forEach((cancellation) => {
    terms.termsText({ type: 'course', cancellation: cancellation, hasFee: true }, l).forEach((line) => {
      checked++;
      H.ok(emailSrc.indexOf(line) === -1, 'not a copy of: ' + line.slice(0, 40));
    });
  });
});
H.ok(checked > 20, checked + ' sentences and rows checked');

// ---------------------------------------------------------------------------
console.log('\n[the optional explanation: blank means nothing, anywhere]');
const noNote = terms.termsFor({ type: 'course', cancellation: classic, hasFee: true }, 'en');
const withNote = terms.termsFor({ type: 'course', hasFee: true, cancellation:
  Object.assign({}, classic, { note: { he: '', en: 'Materials are bought in advance.', ru: '' } }) }, 'en');
H.eq(withNote.length, noNote.length + 1, 'a note adds exactly one line');
H.ok(withNote.indexOf('Materials are bought in advance.') !== -1, 'which is the admin\'s own sentence');
H.eq(JSON.stringify(terms.termsFor({ type: 'course', hasFee: true, cancellation:
  Object.assign({}, classic, { note: { he: '', en: '', ru: '' } }) }, 'en')),
  JSON.stringify(noNote), 'and an empty note is byte-for-byte no note at all');
H.eq(REG.noteIsEmpty(REG.noteBag({})), true, 'a blank bag is empty');
H.eq(REG.noteIsEmpty(REG.noteBag({ ru: '  ' })), true, 'and whitespace is blank');
H.eq(REG.noteIsEmpty(REG.noteBag({ ru: 'x' })), false, 'while one language is not');
// It falls back through the usual chain, so a note typed in one language shows
// everywhere until it is translated — the same choice the group-size override
// makes, for the same reason.
H.ok(terms.termsFor({ type: 'course', hasFee: true, cancellation:
  Object.assign({}, classic, { note: { he: 'הרכישות בוצעו מראש.', en: '', ru: '' } }) }, 'ru')
  .indexOf('הרכישות בוצעו מראש.') !== -1,
  'a note typed in Hebrew alone still reaches the Russian page');
// The drop-in has one too: its window is hours rather than a date, and "the hall
// is paid for on the day" cannot account for itself either.
H.ok(terms.termsFor({ type: 'dropin', sessionCancelHours: 24, cancellation:
  { note: { en: 'The hall is paid for on the day.' } } }, 'en')
  .indexOf('The hall is paid for on the day.') !== -1, 'and so does a drop-in');

console.log('\n[⚠ it is FROZEN with the dates it explains, not read live]');
const act = withTiers([{ until: 'start', percent: 100 }, { until: '2026-11-04', percent: 50 }]);
act.registration.cancellationPolicy.note = { he: '', en: 'Books were bought in advance.', ru: '' };
const frozen = C.freezeCancellation(act, act.groups[0].groupId);
H.eq(frozen.note.en, 'Books were bought in advance.', 'the note is copied onto the registration');
// Reworded for next term, the family who already registered keeps theirs — which
// is the whole point: the note justifies a particular deadline, and a new one
// would be a justification for a policy they do not hold.
act.registration.cancellationPolicy.note = { he: '', en: 'Something else entirely.', ru: '' };
H.eq(frozen.note.en, 'Books were bought in advance.', 'and a later rewording does not reach it');
H.eq(C.freezeCancellation(withTiers([{ until: 'start', percent: 100 }]),
  act.groups[0].groupId).note, null, 'a blank note freezes as null rather than three empty strings');

// ---------------------------------------------------------------------------
console.log('\n[a restricted role may translate the note and may not move a figure]');
const stored = { autoApprove: true, registrationFeeCutoffDate: '2026-09-30',
  cancellationPolicy: { tiers: [{ until: 'start', percent: 100 },
                                { until: '2026-11-04', percent: 50 }],
                        note: { he: 'סיבה', en: 'Reason', ru: '' } } };
const hostile = { autoApprove: false, registrationFeeCutoffDate: '2099-01-01',
  cancellationPolicy: { tiers: [{ until: 'start', percent: 100 }, { until: 'none', percent: 0 }],
                        note: { he: 'X', en: 'Y', ru: 'Причина' } } };
const asRu = REG.mergeRegistration(stored, hostile, 'course', ['ru']);
H.eq(asRu.cancellationPolicy.note.ru, 'Причина', 'the Russian is taken');
H.eq(asRu.cancellationPolicy.note.he, 'סיבה', 'the Hebrew is kept');
H.eq(asRu.cancellationPolicy.note.en, 'Reason', 'and so is the English');
H.eq(asRu.cancellationPolicy.tiers[1].percent, 50,
  '⚠ while the percentage is the stored one — a role that may only translate must not ' +
  'be able to change what a cancellation is worth');
H.eq(closes(asRu), '2026-11-04', 'nor the closing date');
H.eq(asRu.registrationFeeCutoffDate, '2026-09-30', 'nor the fee cutoff');
H.eq(asRu.autoApprove, true, 'nor anything else in the block');
// With every language, it is the ordinary merge.
H.eq(REG.mergeRegistration(stored, hostile, 'course', ['he', 'en', 'ru'])
       .cancellationPolicy.tiers[1].percent, 0, 'full access merges normally');
H.eq(REG.mergeRegistration(stored, hostile, 'course').cancellationPolicy.tiers[1].percent, 0,
  'and so does an omitted language list');

// ⚠ AND THE TRANSLATION IS ONE FUNCTION, NOT TWO.
//
// An ACTIVITY's stored policy and a FROZEN block are both translated from the old
// mode-and-date pair, and for one bite-check the rule was written out in both
// places — so reverting it in one left the other correct and half the suite went on
// passing. _credit.js requires this module already, so there is nothing to buy by
// keeping a copy.
H.eq(JSON.stringify(C.tiersFrom({ mode: 'prorated', cancellationCutoffDate: '2026-11-04' })),
     JSON.stringify(REG.legacyTiers({ mode: 'prorated', cancellationCutoffDate: '2026-11-04' })),
  'the frozen block and the activity are translated by the same function');
const creditSrc = fs.readFileSync(H.fnPath('_credit'), 'utf8');
H.ok(/REG\.legacyTiers\(/.test(creditSrc), 'and _credit.js calls it rather than repeating it');
H.ok(!/percent: c\.mode === 'prorated'/.test(creditSrc), 'with no second copy left beside it');

// ---------------------------------------------------------------------------
console.log('\n[a publish reports who is still on the old schedule, and moves nobody]');
const fallout = require(H.fnPath('_registration-fallout'));
const before = withTiers([{ until: 'start', percent: 100 }, { until: '2026-11-04', percent: 50 }]);
const after = withTiers([{ until: 'start', percent: 100 }, { until: '2026-10-20', percent: 75 },
                         { until: '2026-11-04', percent: 50 }]);
H.ok(fallout.scheduleShapeMoved(before, after), 'a changed shape is noticed');
H.ok(!fallout.scheduleShapeMoved(before, before), 'an identical republish is not');
// ⚠ AND MOVING THE CLOSING DATE IS NOT A CHANGED SHAPE. That date DOES propagate,
// so counting it as a different schedule would report every family as stale every
// time a cutoff moved.
const movedDate = withTiers([{ until: 'start', percent: 100 }, { until: '2026-12-01', percent: 50 }]);
H.ok(!fallout.scheduleShapeMoved(before, movedDate),
  'while moving the closing date is not — that one is carried across');
H.ok(fallout.cutoffFieldsMoved(before, movedDate), 'and it is the cutoff trigger that fires for it');

const live = (tiers) => ({ status: 'approved', participantId: 'p1', activityId: 'a1', groupId: null,
  frozen: { cancellation: { tiers: tiers, sessionStartsAt: [] } } });
H.eq(fallout.olderSchedules(after, [live(after.registration.cancellationPolicy.tiers)]), 0,
  'a family already on the new schedule is not counted');
H.eq(fallout.olderSchedules(after, [live(before.registration.cancellationPolicy.tiers)]), 1,
  'and one on the old one is');
// A legacy frozen block counts through the same translation.
H.eq(fallout.olderSchedules(after, [{ status: 'approved', groupId: null,
  frozen: { cancellation: { mode: 'flat', cancellationCutoffDate: '2026-11-04',
                            sessionStartsAt: [] } } }]), 1,
  'and so does one frozen before the schedule existed');
H.eq(fallout.olderSchedules(after, [{ status: 'cancelled', groupId: null,
  frozen: { cancellation: { tiers: before.registration.cancellationPolicy.tiers } } }]), 0,
  'while a cancelled registration is nobody\'s terms any more');

// ---------------------------------------------------------------------------
console.log('\n[the form draws the schedule, and reads it back]');
const adminJs = fs.readFileSync(path.join(R, 'js/activities-admin.js'), 'utf8');
const schema = REG.FIELDS.filter((f) => REG.draws(f, 'course')).map((f) => f.key);
H.ok(schema.indexOf('cancellationPolicy.tiers') !== -1, 'the course draws the schedule');
H.ok(schema.indexOf('cancellationPolicy.mode') === -1, 'and no mode select survives');
H.ok(schema.indexOf('cancellationPolicy.cancellationCutoffDate') === -1,
  'nor a closing date of its own');
H.ok(/if \(d\.kind === 'tiers'\) return tiersField\(d, value\)/.test(adminJs),
  'the editor is drawn for it');
H.ok(/if \(d\.kind === 'tiers'\) \{ regSet\(out, d\.key, readTierRows\(\)\); return; \}/.test(adminJs),
  'and read back — a field drawn and not read back is the trap this admin keeps meeting');
H.ok(/if \(d\.kind === 'langtext'\) \{ regSet\(out, d\.key, readLangField\(regId\(d\.key\)\)\); return; \}/
  .test(adminJs), 'and so is the note, through the one trilingual reader');
H.ok(!/cancellationModes/.test(adminJs) &&
     !/cancellationModes/.test(fs.readFileSync(H.fnPath('activities-admin'), 'utf8')),
  '⚠ and the mode list is gone from both sides rather than left as a payload nothing reads');
// ⚠ THE CAP IS SENT RATHER THAN WRITTEN TWICE. MIN_PASSWORD and the activities
// menu's status groups are duplicated because a browser cannot require a Netlify
// function; here it can simply be sent, so it is.
H.ok(/maxRefundTiers: REG\.MAX_TIERS/.test(fs.readFileSync(H.fnPath('activities-admin'), 'utf8')),
  'the server sends the cap');
H.ok(/Number\(S\.schema\.maxRefundTiers\)/.test(adminJs), 'and the browser reads it');
// The recompute button writes the closing date into the last step, and adds no step.
H.ok(/setClosingInput\(cancelDate\)/.test(adminJs),
  'recompute writes the closing date into the last step');
H.ok(!/regSetInput\('cancellationPolicy\./.test(adminJs),
  'and not into a field that no longer exists');

console.log('\n[and the client renders a schedule as a schedule]');
const ui = fs.readFileSync(path.join(R, 'js/member-account.js'), 'utf8');
H.ok(/acc-terms-steps/.test(ui), 'the family area draws the steps');
H.ok(/dl/.test(ui.slice(ui.indexOf('function termsNote'), ui.indexOf('function termsNote') + 900)),
  'as a definition list, which is a pair of columns rather than four sentences');
const css = fs.readFileSync(path.join(R, 'shared.css'), 'utf8');
H.ok(/\.acc-terms-steps\{/.test(css), 'and the stylesheet has a rule for it');
H.ok(/\.acc-terms-steps dt\{/.test(css) && /\.acc-terms-steps dd\{/.test(css),
  'including the two halves, or a definition list ships with a margin that breaks the columns');

// ---------------------------------------------------------------------------
// ⚠ EXECUTED, THROUGH THE REAL HANDLER, because the unit check above passes on a
// call site that never hands the languages over — which is exactly what a
// bite-check found: reverting mergeByPermission() to normaliseRegistration() left
// every assertion above green while a translator could no longer reach the note.
// Reading the merge proves the merge; only driving the handler proves the wiring.
console.log('\n[executed: a Russian reviewer saves a note and nothing else]');
(async () => {
  const seed = H.seedRepo();
  const blobs = H.makeBlobs();
  const { 'activities-admin': admin } =
    H.loadWithStubs({ github: H.makeGithub(seed.files), blobs, modules: ['activities-admin'] });
  const boss = await H.installSession(blobs, H.superAdminSession());
  const ru = await H.installSession(blobs, H.ruReviewerSession());

  // A super admin sets the schedule and an English note.
  const base = Object.assign({}, seed.record, { registration: Object.assign(
    {}, seed.record.registration, { registrationFeeCutoffDate: '2026-09-30', cancellationPolicy: {
      tiers: [{ until: 'start', percent: 100 }, { until: '2026-11-04', percent: 50 }],
      note: { he: '', en: 'Books are bought in advance.', ru: '' } } }) });
  const set = await H.call(admin.handler, { token: boss.token, action: 'saveDraft',
    activity: base, baseUpdatedAt: seed.record.isoUpdated });
  H.eq(set.status, 200, 'the super admin sets a schedule and a note');
  const stored0 = set.body.activity.registration.cancellationPolicy;
  H.eq(stored0.note.en, 'Books are bought in advance.', 'which is stored');

  // The reviewer sends a Russian translation — and, hostile by assumption, also
  // tries to make every cancellation free.
  const attempt = JSON.parse(JSON.stringify(set.body.activity));
  attempt.registration.cancellationPolicy.note.ru = 'Книги покупаются заранее.';
  attempt.registration.cancellationPolicy.note.en = 'REWRITTEN';
  attempt.registration.cancellationPolicy.tiers = [{ until: 'none', percent: 100 }];
  attempt.registration.registrationFeeCutoffDate = '2099-01-01';
  const saved = await H.call(admin.handler, { token: ru.token, action: 'saveDraft',
    activity: attempt, baseUpdatedAt: set.body.activity.isoUpdated });
  H.eq(saved.status, 200, 'the reviewer may save');
  const got = saved.body.activity.registration.cancellationPolicy;
  H.eq(got.note.ru, 'Книги покупаются заранее.',
    '⚠ and the Russian note IS taken — a translator who cannot reach the one field ' +
    'of words in this panel is the gap LANG_SUBKEYS was invented to close');
  H.eq(got.note.en, 'Books are bought in advance.', 'while the English is kept');
  H.eq(got.tiers.length, 2, 'the schedule is the stored one');
  H.eq(got.tiers[1].percent, 50, 'with the percentage nobody was allowed to change');
  H.eq(set.body.activity.registration.registrationFeeCutoffDate, '2026-09-30',
    'the fee cutoff was a real date to begin with, so the next line is not vacuous');
  H.eq(saved.body.activity.registration.registrationFeeCutoffDate, '2026-09-30',
    'and the reviewer\'s 2099 never landed on it');
  H.done();
})();
