// Telling everybody who is waiting that a place has opened.
//
// ⚠ EVERYONE AT ONCE, AND THE FIRST ONE BACK TAKES IT. That is the behaviour
// that was asked for, and it is worth writing down why it is not the obvious
// alternative — offering the place to the first person on the list, with a
// deadline, and moving down if they do not answer.
//
// A sequential offer has to run a clock per person. On a course that is
// survivable; on a drop-in it is not, because an evening can free up thirty
// minutes before the class and there is no time to work down a list. A single
// announcement is also the only version that is honest with no machinery: every
// family learns at the same instant and the fastest one wins, which is a fair
// thing to lose.
//
// The cost is that most people on a list lose, every time. That is answered in
// the words rather than in the code — PLACE_OPEN says out loud that everybody
// waiting has been sent this and the place goes to whoever takes it first.
//
// ⚠ IT IS BEST EFFORT AND NEVER BLOCKS. It is called immediately after a
// cancellation, a rejection or an expiry, and the place is already free by then:
// capacity is counted, never decremented, so the seat opened the instant the
// status was written. A failure here costs an announcement, never a place.
//
// ⚠ Arms the legal gate, correctly.

const store = require('./_registration-store');
const attendance = require('./_session-attendance');
const accounts = require('./_account-store');
const mail = require('./_registration-email');
const R = require('./_registration');

// One address is told once. Two guardians on one participant are two accounts
// and get two messages, which is right — either of them may be the one holding
// the phone — but the SAME account waiting for two of its own children gets one
// message per child, because each names a different person.
async function tell(reg, when) {
  const account = await accounts.getAccount(reg.accountId);
  if (!account || !account.email) return false;
  // The ISO date, and the MESSAGE formats it — in the language of the account it
  // is going to rather than of anything here. See waitingMessage().
  await mail.sendPlaceOpen(reg, account, when || null);
  return true;
}

// A place has opened on a COURSE. Everybody waitlisted for that activity hears.
async function placeOpened(activityId) {
  const waiting = (await store.forActivity(activityId)).filter(R.isWaiting);
  let told = 0;
  for (const reg of waiting) if (await tell(reg, null)) told++;
  return { told: told, waiting: waiting.length };
}

// ⚠ A SEAT HAS OPENED ON ONE EVENING, so only that evening's queue hears.
//
// Waiting for Tuesday says nothing about Thursday: the room is per date, the
// queue is per date, and telling everybody who ever waited for this activity
// would be a message most of them cannot act on. The registration record is
// what the message is built from — an attendance row knows the date and the
// participant and nothing about what to call them — so a family with a waiting
// evening but no registration record is skipped rather than guessed at.
async function seatOpened(activityId, sessionDate) {
  if (!sessionDate) return { told: 0, waiting: 0 };
  const waiting = (await attendance.forActivity(activityId, sessionDate))
    .filter((a) => a && a.status === 'waiting');
  let told = 0;
  for (const a of waiting) {
    const reg = await store.getRegistration(a.participantId, activityId);
    if (!reg) continue;
    // The evening's own account, not the registration's: a second guardian can
    // book an evening on a participant somebody else registered, and the person
    // who joined the queue is the person waiting on the answer.
    if (await tell(Object.assign({}, reg, { accountId: a.accountId || reg.accountId }), sessionDate)) told++;
  }
  return { told: told, waiting: waiting.length };
}

module.exports = { placeOpened, seatOpened };
