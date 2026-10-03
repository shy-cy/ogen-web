// /api/reminders — stop (or restart) the session reminders for ONE class.
//
// No session. The token in the link is the whole of the authority, and that is
// deliberate: an unsubscribe a family cannot use without first remembering a
// password is an unsubscribe that does not work.
//
// ⚠ A GET DOES NOTHING AND CANNOT. Mail scanners and link-preview bots fetch
// every URL in a message before a person has read it — this project already has
// that scar, in _member-session.js: "a link followed twice, by a person and then
// by a mail scanner, works once". A one-click GET here would silently switch off
// a family's reminders because their employer's spam filter opened the email.
// So reading the link only ever reports STATE, and changing it takes a POST that
// a human has pressed a button for.
//
// ⚠ WHAT HOLDING A TOKEN LETS YOU DO, IN FULL: see one activity's title, and
// switch that activity's reminders off or on for the one account it was issued
// to. It reads back no email address, no name, no date of birth, no balance and
// no other class. The scope is STRUCTURAL — the record names one activityId and
// the handler writes one key derived from it, so there is no parameter that
// could widen it and no rule anybody has to keep.

const links = require('./_reminder-link');
const prefs = require('./_reminder-store');

const json = (status, body) => ({
  statusCode: status,
  headers: {
    'Content-Type': 'application/json',
    // Never cached. /*'s s-maxage would let a shared cache hand the next reader
    // somebody else's answer, which is the rule /pay already states.
    'Cache-Control': 'no-store'
  },
  body: JSON.stringify(body)
});

// One refusal for an unknown token, an expired one and a malformed one. Telling
// them apart would say whether a token ever existed.
const NOPE = { ok: false, error: 'bad-link' };

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'use-post' });
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (err) { return json(400, { ok: false, error: 'bad-json' }); }

  const record = await links.readLink(String(body.token || ''));
  if (!record || !record.accountId || !record.activityId) return json(404, NOPE);

  const shown = {
    title: record.title || null,
    lang: record.lang || 'he'
  };

  if (body.action === 'status') {
    const off = await prefs.isOff(record.accountId, record.activityId);
    return json(200, Object.assign({ ok: true, off: off }, shown));
  }

  if (body.action === 'set') {
    // `off` is read as a strict boolean: anything else is a client that has not
    // said what it wants, and the safe reading of silence is not "unsubscribe".
    if (body.off !== true && body.off !== false) {
      return json(400, { ok: false, error: 'bad-state' });
    }
    await prefs.setOff(record.accountId, record.activityId, body.off, 'unsubscribe-link');
    return json(200, Object.assign({ ok: true, off: body.off }, shown));
  }

  return json(400, { ok: false, error: 'unknown-action' });
};
