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
const GROUP_PAIR = [
  { name: 'pooled', groupSize: POOLED },
  { name: 'named', groupSize: NAMED }
];

module.exports = { course, dropin, POOLED, NAMED, TYPE_PAIR, GROUP_PAIR, lang };
