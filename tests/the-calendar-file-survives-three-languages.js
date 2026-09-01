// What this defends against:
//
// An .ics is a text format with escaping rules, and every one of them is a way
// to corrupt a file that still looks fine until a calendar opens it.
//
//   ';' MUST BE ESCAPED. It separates a property's parameters, so an unescaped
//   one in "Limassol; Room 2" truncates the location at the semicolon. This was
//   a real bug here: '\;' in a JavaScript string is just ';' — the backslash is
//   silently dropped for an unrecognised escape — so the replacement did
//   nothing at all and the tests are the only thing that would notice.
//
//   LINES FOLD AT 75 OCTETS, NOT CHARACTERS. Hebrew and Russian are two bytes a
//   character, so a character-based limit still emits overlong lines, and a
//   naive split cuts a character in half and corrupts the text.
//
//   EVERY VEVENT NEEDS ITS OWN UID. Ogen's caller is a course with ten dated
//   sessions in one file. Reuse the UID and a calendar treats each session as
//   an edit of the last and keeps exactly one.

const H = require('./_helpers');
process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';
const mail = require(H.fnPath('_email'));
const { escapeIcs, foldLine } = mail._internal;

const lines = (s) => s.split('\r\n');
const unfold = (s) => s.replace(/\r\n /g, '');

(async () => {
  console.log('[escaping, all four cases]');
  // NOTE the doubled backslash in the EXPECTED value. Writing 'Limassol\; Room 2'
  // here collapses to 'Limassol; Room 2' and the assertion passes against
  // unescaped output — the same trap, one level up. It caught this test too.
  H.eq(escapeIcs('Limassol; Room 2'), 'Limassol\\; Room 2', 'a semicolon is escaped');
  H.eq(escapeIcs('Ogen, Limassol'), 'Ogen\\, Limassol', 'a comma is escaped');
  H.eq(escapeIcs('line one\nline two'), 'line one\\nline two', 'a newline becomes a literal \\n');
  H.eq(escapeIcs('a\\b'), 'a\\\\b', 'a backslash is doubled');
  H.eq(escapeIcs('a\r\nb'), 'a\\nb', 'CRLF collapses to one \\n rather than two');
  H.eq(escapeIcs(null), '', 'and nothing is nothing, not "null"');

  console.log('\n[folding is by octet, and never mid-character]');
  const ascii = foldLine('DESCRIPTION:' + 'x'.repeat(300));
  H.ok(lines(ascii).every((l) => Buffer.byteLength(l) <= 75), 'no line exceeds 75 octets');
  H.ok(lines(ascii).slice(1).every((l) => l[0] === ' '), 'continuations start with a space');
  H.eq(unfold(ascii), 'DESCRIPTION:' + 'x'.repeat(300), 'and it unfolds back to exactly what went in');

  const heb = 'SUMMARY:' + 'מפגש עברית לילדים '.repeat(8);
  const foldedHe = foldLine(heb);
  H.ok(lines(foldedHe).every((l) => Buffer.byteLength(l) <= 75), 'Hebrew folds within 75 OCTETS');
  H.eq(unfold(foldedHe), heb, 'and round trips with no character cut in half');

  const ru = 'SUMMARY:' + 'Занятие по ивриту для детей '.repeat(6);
  H.eq(unfold(foldLine(ru)), ru, 'Russian round trips too');
  H.eq(foldLine('SUMMARY:short'), 'SUMMARY:short', 'a short line is left alone');

  console.log('\n[a ten session course is ten VEVENTs with ten UIDs]');
  const sessions = Array.from({ length: 10 }, (_, i) => ({
    summary: 'מפגש ' + (i + 1),
    start: new Date(Date.UTC(2026, 9, 14 + i * 7, 13, 0)),
    end: new Date(Date.UTC(2026, 9, 14 + i * 7, 14, 30)),
    location: 'Limassol; Room 2'
  }));
  const ics = mail.buildIcs(sessions, { uidPrefix: 'hebrew4kids' });
  H.eq((ics.match(/BEGIN:VEVENT/g) || []).length, 10, 'ten events');
  H.eq((ics.match(/END:VEVENT/g) || []).length, 10, 'each one closed');
  const uids = (ics.match(/^UID:.*$/gm) || []).map((l) => l.trim());
  H.eq(uids.length, 10, 'ten UIDs');
  H.eq(new Set(uids).size, 10, 'and all ten are DIFFERENT, or a calendar keeps only the last');
  H.ok(ics.indexOf('LOCATION:Limassol\\; Room 2') !== -1,
       'the semicolon in the location survived as an escaped one');

  console.log('\n[two files for the same course do not collide]');
  const again = mail.buildIcs(sessions, { uidPrefix: 'hebrew4kids' });
  const uids2 = (again.match(/^UID:.*$/gm) || []).map((l) => l.trim());
  H.eq(uids.filter((u) => uids2.indexOf(u) !== -1).length, 0,
       'a resend mints fresh UIDs rather than looking like an edit of the first');

  console.log('\n[the envelope]');
  H.ok(ics.indexOf('BEGIN:VCALENDAR\r\n') === 0, 'starts with VCALENDAR');
  H.ok(/END:VCALENDAR$/.test(ics), 'and ends with it');
  H.ok(ics.indexOf('VERSION:2.0') !== -1, 'declares the version');
  H.ok(ics.indexOf('\r\n') !== -1 && ics.indexOf('\n\n') === -1, 'lines are CRLF terminated');
  H.ok(/DTSTART:20261014T130000Z/.test(ics), 'times are absolute UTC instants');
  H.ok(!/DTSTART;TZID/.test(ics),
       'and carry no TZID — resolving Asia/Nicosia wall clock to an instant is the CALLER\'s job');

  console.log('\n[an unusable date is refused, not printed as NaN]');
  let bad = false;
  try { mail.buildIcs([{ summary: 'x', start: 'not a date', end: 'nor this' }]); } catch (e) { bad = true; }
  H.ok(bad, 'a bad date throws instead of emitting DTSTART:Invalid');
  bad = false;
  try { mail.buildIcs([]); } catch (e) { bad = true; }
  H.ok(bad, 'and an empty list is refused rather than producing an empty calendar');

  console.log('\n[end omitted means a zero length event, not a missing property]');
  const one = mail.buildIcs([{ summary: 'x', start: new Date(Date.UTC(2026, 0, 1, 10, 0)) }]);
  H.ok(/DTEND:20260101T100000Z/.test(one), 'DTEND falls back to DTSTART');

  console.log('\n[ready to hand to Resend]');
  const att = mail.icsAttachment(sessions.slice(0, 2), { filename: 'hebrew4kids.ics' });
  H.eq(att.filename, 'hebrew4kids.ics', 'the filename is the caller\'s');
  H.eq(Buffer.from(att.content, 'base64').toString('utf8').slice(0, 15), 'BEGIN:VCALENDAR',
       'and the content is base64, which is what Resend wants');

  H.done();
})();
