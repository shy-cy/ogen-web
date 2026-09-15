// Activity fixtures, IN PAIRS.
//
// The standing rule from the design: every suite that builds an activity builds
// a course and a drop-in, a pooled activity and a grouped one. The branch nobody
// tests is the branch that works until the evening somebody uses it — and both
// of these pairs are branches that will sit unexercised for months, because Ogen
// has exactly one activity today and it is a pooled course.
//
// So the pairs live here rather than being hand-made per suite. A new field on
// one half of a pair is a diff the other half has to answer for, which is the
// property that matters: it is hard to add a course-only field and not notice
// that the drop-in fixture now looks wrong.
//
// These are minimal on purpose. They carry what the thing under test needs and
// nothing else, so a failure names a field rather than a fixture.

const lang = (he, en, ru) => ({ he: he, en: en, ru: ru });

// A semester course: a term price, a start and an end, a resolved calendar.
// Modelled on hebrew4kids, which is the shape everything so far assumes.
function course(over) {
  return Object.assign({
    slug: 'course-fixture',
    activityId: 'act-000000000000c0de',
    type: 'course',
    status: 'open',
    title: lang('קורס', 'Course', 'Курс'),
    facts: {
      duration: {
        startDate: '2026-10-14', endDate: '2026-12-16',
        sessionCount: 10, sessionMinutes: 90,
        sessionDates: [
          '2026-10-14', '2026-10-21', '2026-10-28', '2026-11-04', '2026-11-11',
          '2026-11-18', '2026-11-25', '2026-12-02', '2026-12-09', '2026-12-16'
        ].map((d) => ({ date: d, status: 'scheduled' }))
      },
      schedule: { frequency: 'weekly', sessions: [{ day: 3, time: '16:00' }] },
      groupSize: { groups: 2, maxPerGroup: 7 },
      price: { registrationFee: 50, fullPrice: 300 }
    },
    registration: {
      autoApprove: false,
      pendingExpiryDays: null,
      registrationFeeCutoffDate: null,
      cancellationPolicy: { mode: 'flat', cancellationCutoffDate: null },
      defaultBasis: null
    }
  }, over || {});
}

// Weekly folk dancing: it runs indefinitely, a family pays for the evenings they
// come, and there is no term to withdraw from. No fullPrice, no endDate, no
// cancellation policy — those are absent rather than configured differently.
function dropin(over) {
  return Object.assign({
    slug: 'dropin-fixture',
    activityId: 'act-000000000000d00d',
    type: 'dropin',
    status: 'open',
    title: lang('ריקודי עם', 'Folk dancing', 'Народные танцы'),
    facts: {
      duration: {
        startDate: '2026-10-06', endDate: '',
        sessionCount: null, sessionMinutes: 90,
        sessionDates: ['2026-10-06', '2026-10-13', '2026-10-20']
          .map((d) => ({ date: d, status: 'scheduled' }))
      },
      schedule: { frequency: 'weekly', sessions: [{ day: 2, time: '19:30' }] },
      groupSize: {},
      price: { registrationFee: 50, perSessionPrice: 12 }
    },
    registration: {
      autoApprove: true,
      pendingExpiryDays: null,
      registrationFeeCutoffDate: null,
      cancellationPolicy: { mode: 'flat', cancellationCutoffDate: null },
      sessionCancelHours: 24,
      defaultBasis: null
    }
  }, over || {});
}

// THE THIRD PAIR: an autumn term and the spring term of the same course.
//
// A slug is one semester, so the spring term is a second record with its own
// dates, its own calendar and its own page. `seriesId` is what says the two are
// the same activity, and it exists for exactly one consumer — the registration
// fee, which is charged once an academic year per participant per activity. The
// pair is here rather than hand-made per suite for the usual reason: the waived
// branch will sit unexercised for months, and the branch nobody tests is the
// branch that works until the evening somebody uses it.
//
// Same academic year as course(): October-December 2026 and February-June 2027
// are both 2026/27. That is the point — on a CALENDAR year they would not be,
// and a returning child would be charged the fee twice.
function secondTerm(over) {
  const first = course();
  return Object.assign(course(), {
    slug: 'course-fixture-spring',
    activityId: 'act-000000000000spr1',
    // Points at the autumn term's id, which is what an admin choosing "another
    // term of: Course" in the form produces.
    seriesId: first.activityId,
    facts: Object.assign({}, first.facts, {
      duration: Object.assign({}, first.facts.duration, {
        startDate: '2027-02-03', endDate: '2027-04-07',
        sessionDates: ['2027-02-03', '2027-02-10', '2027-02-17', '2027-02-24',
                       '2027-03-03', '2027-03-10', '2027-03-17', '2027-03-24',
                       '2027-03-31', '2027-04-07'].map((d) => ({ date: d, status: 'scheduled' }))
      })
    })
  }, over || {});
}

// The other pair. Pooled is the default and is what hebrew4kids is: two groups
// of seven meeting at the same hour, and which one a child lands in is the
// teacher's business. Named is for the case where the family has to choose, and
// then the choice has to be recorded and counted.
const POOLED = { groups: 2, maxPerGroup: 7 };
const NAMED = {
  named: [
    { groupId: 'g-beginners', name: lang('מתחילים', 'Beginners', 'Начинающие'), capacity: 7 },
    { groupId: 'g-advanced', name: lang('מתקדמים', 'Advanced', 'Продолжающие'), capacity: 10 }
  ]
};

// The two pairs, ready to iterate. A suite that loops over these cannot quietly
// cover one half.
const TYPE_PAIR = [
  { name: 'course', build: course },
  { name: 'dropin', build: dropin }
];
// Autumn and spring of one course. Iterated by anything that has to behave the
// same whether or not the yearly fee was charged on this particular term.
const TERM_PAIR = [
  { name: 'first term', build: course, feeCharged: true },
  { name: 'second term', build: secondTerm, feeCharged: false }
];
const GROUP_PAIR = [
  { name: 'pooled', groupSize: POOLED },
  { name: 'named', groupSize: NAMED }
];

module.exports = { course, dropin, secondTerm, POOLED, NAMED,
                   TYPE_PAIR, GROUP_PAIR, TERM_PAIR, lang };
