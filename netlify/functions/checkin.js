// /api/checkin — the QR code's endpoint. NO SESSION, BY DESIGN.
//
// A code is on a wall at the venue. Somebody scans it, sees who is expected this
// evening, taps their own name, and is marked present. The whole point is that
// nobody has to remember a password while standing in a doorway, so there is no
// account here and there never will be.
//
// ⚠ WHAT THAT COSTS, EXACTLY, because "no login" is too coarse a description of
// the risk and the narrower version is what was accepted:
//
//   READ    whoever holds the link sees the names of the people booked for ONE
//           evening of ONE activity. Full names — asked for explicitly, over
//           first-name-plus-initial, because two children called Noa cannot tap
//           the right row otherwise. It names children and places them somewhere
//           at a time, and that is the part that cannot be taken back. Nothing
//           else is exposed: no dates of birth, no contacts, no amounts, no
//           other dates.
//   WRITE   anyone holding the link can mark any listed name present. Marking
//           present MOVES NO MONEY — what an evening costs was decided when it
//           was booked, and a no-show owes it too — so the worst case is a wrong
//           register rather than a wrong bill.
//   NEVER   book, cancel, create a participant, see a balance, or touch any
//           other date. There is no action here that does any of those.
//
// Two guards keep it to one evening rather than a standing key:
//
//   1. the token EXPIRES when its session's day ends in Asia/Nicosia, and
//   2. the register does not OPEN until that day begins.
//
// So a code photographed a week early lists nobody, and the same photograph the
// following morning opens nothing. Between those two instants it is exactly as
// open as a printed class list pinned to the same wall, which is the thing it
// replaces.
//
// IT WRITES INTO THE REGISTER THAT ALREADY EXISTS — the same
// att-<pid>__<aid>__<date> blob, through the same transition() — so the admin
// register, the money and the ledger see one thing. What differs is the history
// line: `by: 'self'`. It deliberately does NOT reuse admin-registrations'
// markAttendance, which is gated on canApprove and stamps the admin's own
// address; sharing it would have meant either opening an admin action to the
// public or writing a fictitious identity into the history.

const attendance = require('./_session-attendance');
const participants = require('./_participant-store');
const codes = require('./_checkin-token');
const credit = require('./_credit');

const json = (code, payload) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0' },
  body: JSON.stringify(payload)
});

// The register is open for the session's own calendar day in Cyprus. A tighter
// window keyed to the start time was considered and dropped: a session's start
// is frozen per booking, so an evening with nothing booked yet would have no
// instant to measure from — and the admin who scans the sheet to check it works
// is exactly the person who would be refused.
const dayOpens = (date) => credit.resolveLocal(date, '00:00', credit.TZ);

// Full name, asked for explicitly. Nothing else about the person travels: this
// list is read by whoever is holding a phone in a doorway.
const nameOf = (p, fallback) =>
  (p ? [p.firstName, p.lastName].filter(Boolean).join(' ') : '') || fallback;

// booked and attended, and nothing else. A cancelled booking is not coming and
// must not be tappable; a no-show is a judgement an admin has already recorded,
// and letting a public tap overwrite it would make the register argue with the
// person who marked it.
const LISTED = ['booked', 'attended'];

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Use POST' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (err) { return json(400, { error: 'Bad request' }); }

  try {
    const code = await codes.readCode(body.token);
    // One answer for an invented token and an expired one. Telling them apart
    // says whether a code ever existed, which is the only thing guessing could
    // learn here.
    if (!code) return json(404, { error: 'This code is not valid any more.', reason: 'expired' });

    const opens = dayOpens(code.sessionDate);
    if (opens != null && Date.now() < opens) {
      // Named rather than hidden: somebody testing the sheet the day it is
      // printed should be told which evening it is for, not shown an error.
      return json(200, {
        ok: true, open: false, reason: 'too-early',
        sessionDate: code.sessionDate, activity: { title: code.title, slug: code.slug }
      });
    }

    const roll = (await attendance.forDate(code.activityId, code.sessionDate))
      .filter((a) => LISTED.indexOf(a.status) !== -1);

    switch (body.action) {
      case 'session': {
        const people = [];
        for (const a of roll) {
          const p = await participants.getParticipant(a.participantId);
          people.push({
            participantId: a.participantId,
            name: nameOf(p, 'Someone'),
            status: a.status
          });
        }
        people.sort((a, b) => a.name.localeCompare(b.name));
        return json(200, {
          ok: true, open: true,
          sessionDate: code.sessionDate,
          activity: { title: code.title, slug: code.slug },
          people: people
        });
      }

      case 'checkIn': {
        const att = roll.filter((a) => a.participantId === body.participantId)[0];
        // Not found covers three cases on purpose — no such booking, a
        // cancelled one, and a participant on another evening — because telling
        // them apart would let the list be probed for names it does not show.
        if (!att) return json(404, { error: 'That name is not on this evening\'s list.' });
        // Already present is a SUCCESS, not an error. Two people scanning one
        // poster in the same minute, or one person tapping twice because the
        // first tap was not obviously received, must not produce a failure on a
        // screen somebody is holding in a doorway.
        if (att.status === 'attended') return json(200, { ok: true, already: true });

        const next = attendance.transition(att, {
          status: 'attended', by: 'self', note: 'QR check-in'
        });
        await attendance.saveAttendance(next);
        return json(200, { ok: true, already: false });
      }

      default:
        return json(400, { error: 'Unknown action' });
    }
  } catch (err) {
    console.error('[checkin] ' + (err && err.stack || err));
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
};
