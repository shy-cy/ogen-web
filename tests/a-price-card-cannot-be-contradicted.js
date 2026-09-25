// What this defends against:
//
// Three reports from one QA round, and the third is the one that explains the
// other two.
//
// ⚠ 1. YOU COULD REGISTER FOR A CLASS THAT HAD ALREADY HAPPENED.
//
// The registration page listed 3 and 10 September with a live "register for
// this session" link beside them, on the 24th. `sessionsPayload()` has sent a
// `past` flag per date since that screen was built and NOTHING read it —
// neither the table nor the server — so a family could book, and be charged
// for, a class nobody can attend. The register PANEL has always dropped past
// dates, which is exactly why this survived: one list, filtered in one place
// and not the other.
//
// ⚠ 2. THE HEBREW HEADING SAID SOMETHING NOBODY WOULD WRITE. "מה זה עולה" is
// "What it costs" translated a word at a time. The card is a summary of money
// on one registration, so it is headed as one.
//
// ⚠ 3. THE PRICE CARD QUOTED ONE PRICE ON AN ACTIVITY THAT CHARGES TWO.
//
// "Under Price it says 7 EUR and under what to pay it shows 10 EUR. We must
// write under Price: regular 7, late 10." Reported three times in one round as
// three different screens — the picker quoted €10 under a card saying €7, then
// the evenings table did, and both were fixed WHERE THEY WERE NOTICED. That is
// how a card which never mentioned the second rate survived both fixes: each
// screen explained the figure IT was charging, and none of them explained the
// activity. This is the fix at the source.

const H = require('./_helpers');
const F = require('./_fixtures');
const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

const facts = require(H.fnPath('_activity-facts'));

(async () => {
  // ======================================================= the price card ====
  console.log('[the card states BOTH rates, in three languages]');
  const price = { perSessionPrice: 7, lateDropIn: { enabled: true, price: 10, hoursBefore: 3 } };
  ['he', 'en', 'ru'].forEach((l) => {
    const rows = facts.priceRows(price, l, null);
    const keys = rows.map((r) => r.key);
    H.eq(keys.join(','), 'perSession,lateSession', l + ': the ordinary rate, then the late one');
    // Guarded, so dropping the row reads as a failing assertion rather than a
    // stack trace three lines later.
    const late = rows[1] || { value: '', note: '', label: '' };
    H.ok(/10/.test(late.value), l + ': the late figure is on the card');
    H.ok(/7/.test(rows[0].value), l + ': beside the ordinary one — the pair is the point');
    // The note is WHEN, which is the half a figure cannot carry. Without it,
    // "Late booking €10" invites the question it exists to answer.
    H.ok(/3/.test(late.note), l + ': and WHEN it applies — ' + late.note);
    H.ok(late.label && late.label !== rows[0].label, l + ': under a label of its own');
  });

  console.log('\n[and says nothing when there is nothing to say]');
  const plain = facts.priceRows({ perSessionPrice: 7 }, 'en', null);
  H.eq(plain.length, 1, 'an activity with no late price renders exactly as before');
  const off = facts.priceRows(
    { perSessionPrice: 7, lateDropIn: { enabled: false, price: 10, hoursBefore: 3 } }, 'en', null);
  H.eq(off.length, 1, 'and so does one where late pricing is switched off');
  const noHours = facts.priceRows(
    { perSessionPrice: 7, lateDropIn: { enabled: true, price: 10 } }, 'en', null);
  H.eq(noHours.length, 2, 'a late price with no window still shows the figure');
  H.eq(noHours[1].note, '', 'and simply does not claim a window it has not been given');

  // ⚠ The listing card picks its headline figure BY KEY. A new row must not
  // become the one a card advertises, or a drop-in starts announcing its late
  // price to people who have not booked anything.
  console.log('\n[the listing card is unmoved by the new row]');
  const headline = facts.priceRows(price, 'en', null)
    .filter((r) => r.key === 'term' || r.key === 'perSession');
  H.eq(headline.length, 1, 'exactly one headline row');
  H.eq(headline[0].value.indexOf('7') !== -1, true, 'and it is the ORDINARY price');

  // ======================================================== the heading ======
  console.log('\n[the Hebrew heading is Hebrew somebody would write]');
  const ui = read('js/member-account.js');
  H.ok(!/מה זה עולה/.test(ui), 'the word-at-a-time translation is gone');
  H.ok(/costTitle: 'עלות ותשלום'/.test(ui), 'and the card is headed as the summary it is');
  ['he', 'en', 'ru'].forEach((l) => {
    const m = ui.match(new RegExp("costTitle: '([^']+)'", 'g')) || [];
    H.ok(m.length === 3, 'all three languages still have one');
  });

  // ================================================== a past evening ========
  console.log('\n[an evening that has happened is not bookable]');
  const attendance = require(H.fnPath('_session-attendance'));
  const dropin = F.dropin({ slug: 'folk', activityId: 'act-00000000000past1' });
  const dates = attendance.bookableDates(dropin, require(H.fnPath('_activity-groups')).ANY);
  H.ok(dates.length > 2, 'the fixture has a calendar to work with');
  const first = dates[0], last = dates[dates.length - 1];

  // The day AFTER the first session: it has gone, the last one has not.
  const dayAfter = Date.parse(first + 'T23:59:59Z') + 36 * 60 * 60 * 1000;
  H.eq(attendance.validate(dropin, first, dayAfter), 'session-has-passed',
    '⚠ THE SERVER REFUSES IT — this is the half that counts, the screen is cosmetic');
  H.eq(attendance.validate(dropin, last, dayAfter), null, 'and still takes one that is ahead');

  // ⚠ TODAY'S CLASS IS STILL BOOKABLE ALL OF TODAY. A drop-in place can free
  // thirty minutes before the lesson, which is the whole reason late pricing
  // exists — so the deadline is the END of that day in Asia/Nicosia, the same
  // answer the payload's own `past` flag gives.
  const duringThatDay = Date.parse(first + 'T08:00:00Z');
  H.eq(attendance.validate(dropin, first, duringThatDay), null,
    'today\'s evening is bookable all of today — a place can free minutes before it');

  console.log('\n[⚠ and the clock is passed at every call site]');
  const server = read('netlify/functions/account-registrations.js');
  const calls = server.match(/attendance\.validate\([^)]*\)/g) || [];
  H.ok(calls.length >= 3, 'every booking door goes through validate (' + calls.length + ' of them)');
  calls.forEach((c) => {
    // past(date, undefined) is FALSE — the generous direction — so a forgotten
    // clock reads every evening as still ahead. Exactly the shape of bug five
    // callers of creditFor() once had, and it is greppable for the same reason.
    H.ok(c.split(',').length >= 3, 'with a clock: ' + c);
  });

  console.log('\n[the refusal is in the reader\'s language]');
  const E = require(H.fnPath('_family-errors'));
  ['he', 'en', 'ru'].forEach((l) => {
    const m = E.text('session-has-passed', l);
    H.ok(m && m.length > 4, l + ': ' + m);
  });
  H.ok(/[֐-׿]/.test(E.text('session-has-passed', 'he')), 'Hebrew has Hebrew in it');
  H.ok(/[Ѐ-ӿ]/.test(E.text('session-has-passed', 'ru')), 'Russian has Cyrillic in it');

  console.log('\n[and the screen stops offering it]');
  // ⚠ THE WHOLE FUNCTION, not a fixed 4000 bytes of it. This sliced by byte count
  // and broke the day eveningAction grew the two branches that draw an evening's
  // waiting list — the checks it looks for were still there and had simply moved
  // past the window. A test that measures in bytes fails on length rather than on
  // behaviour.
  const fnAt = ui.indexOf('function eveningAction');
  const cell = ui.slice(fnAt, ui.indexOf('\n  function ', fnAt + 1));
  H.ok(cell.length > 1000 && cell.length < 20000, 'found eveningAction whole');
  H.ok(/s\.past/.test(cell),
    'the table reads the `past` flag the payload has always sent');
  H.ok(/!data\.mayBook \|\| s\.past/.test(cell),
    'in the same breath as the other reason there is nothing to press');
  // ⚠ AND `full` LEFT THAT LINE ON PURPOSE. It used to sit beside `past` and
  // return null, which is what made an evening's queue unreachable: a full
  // evening is now the one that HAS something to press. Past is still nothing —
  // a class that has happened cannot be queued for either.
  H.ok(/if \(s\.full\) \{/.test(cell) && /waitlist: true/.test(cell),
    'while a full evening offers its waiting list instead of nothing');
  H.ok(cell.indexOf('s.past') < cell.indexOf('if (s.full) {'),
    'and past is refused BEFORE the queue is offered, so a gone evening is not queueable');

  H.done();
})();
