// WHAT CANCELLING WILL BE WORTH, SAID BEFORE ANYBODY COMMITS.
//
// Every rule in _credit.js was already frozen onto a registration at the moment
// it was made, reproducible a year later and applied identically by both cancel
// paths — and a family was never told any of it. They learned the deadline by
// meeting it: the cancel button simply stopped being offered, or the credit came
// back smaller than they expected, with the first mention of a cutoff being the
// refusal that named it. A policy nobody is shown is, from outside, a policy
// invented at the moment it is enforced.
//
// So this module says the same rules in words. It is PURE — no store, no clock,
// no activity lookup — and it reads the SAME frozen block creditFor() reads, so
// the sentence and the arithmetic cannot describe two different policies. That
// is the whole design: not a second statement of the rules, a rendering of the
// one that already decides.
//
// ⚠ IT TAKES THE FROZEN BLOCK, NEVER THE ACTIVITY. The terms are frozen at
// submission precisely so an admin switching a course from flat to prorated in
// March cannot change what a January family agreed to — and a footnote built
// from the live activity would quietly re-quote the new policy to the old
// family, which is the failure this file exists on the other side of. The one
// place it is handed a shape built from an activity is the register panel, where
// there is no registration yet: that shape comes out of freezeCancellation(),
// which is the function whose output is about to be stored.
//
// Three languages, like every other display string on the server — see the
// _family-errors.js note for why the words are here rather than in the client's
// table. The email needs them too, and two copies of a policy is two policies.
//
// ⚠ THE RUSSIAN HAS NOT BEEN REVIEWED BY A NATIVE SPEAKER, like the rest of the
// Russian on this site.

const { dayAndMonth, ruPlural } = require('./_activity-facts');

const OFF = 'none';
const LANGS = ['he', 'en', 'ru'];
const langOf = (l) => (LANGS.indexOf(l) >= 0 ? l : 'he');

// A cutoff that is a real date, or null. `"none"` is a value meaning SWITCHED
// OFF and must not be printed as a deadline — it is the opposite of one.
function dateOr(value) {
  if (value == null || value === OFF) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim()) ? String(value).trim() : null;
}

// THE YEAR IS ALWAYS PRINTED, which the session table deliberately does not do.
// A row in a timetable is read inside a term with the date range above it; a
// cancellation deadline is read alone, months later, in an email, and "28
// October" on a course running into January is a date a family can get wrong in
// the one direction that costs them money.
function fullDate(iso, lang) {
  const day = dayAndMonth(iso, lang);
  if (!day) return '';
  return day + ' ' + String(iso).slice(0, 4);
}

const HOURS = {
  he: (n) => (n === 1 ? 'שעה אחת' : n + ' שעות'),
  en: (n) => n + (n === 1 ? ' hour' : ' hours'),
  ru: (n) => n + ' ' + ruPlural(n, 'час', 'часа', 'часов')
};

const T = {
  he: {
    closes: (d) => `אפשר לבטל את ההרשמה עד ${d}.`,
    closesNever: 'אפשר לבטל את ההרשמה בכל שלב.',
    closed: (d) => `חלון הביטול נסגר ב-${d}.`,
    beforeStart: 'ביטול לפני המפגש הראשון מזכה בזיכוי מלא על עלות הפעילות.',
    flat: 'ביטול אחרי שהפעילות התחילה מזכה בזיכוי של מחצית מעלות הפעילות.',
    prorated: 'ביטול אחרי שהפעילות התחילה מזכה בזיכוי יחסי למפגשים שטרם התקיימו.',
    fee: (d) => `דמי ההרשמה מזוכים בביטול עד ${d}, ולא לאחר מכן.`,
    feeAlways: 'דמי ההרשמה מזוכים בכל ביטול.',
    session: (h) => `אפשר לבטל מפגש עד ${h} לפני תחילתו ולקבל זיכוי; לאחר מכן המפגש מחויב.`,
    sessionUntilStart: 'אפשר לבטל מפגש בכל רגע לפני תחילתו ולקבל זיכוי.',
    credit: 'הזיכוי נשמר בחשבון ומשמש להרשמה אחרת; אין החזר כספי לכרטיס.',
    title: 'תנאי ביטול'
  },
  en: {
    closes: (d) => `You can cancel this registration up to ${d}.`,
    closesNever: 'You can cancel this registration at any time.',
    closed: (d) => `Cancellation closed on ${d}.`,
    beforeStart: 'Cancel before the first session and the whole activity fee comes back as credit.',
    flat: 'Cancel after it has started and half of the activity fee comes back as credit.',
    prorated: 'Cancel after it has started and the sessions you have not had come back as credit.',
    fee: (d) => `The registration fee comes back as credit if you cancel by ${d}, and not after that.`,
    feeAlways: 'The registration fee comes back as credit whenever you cancel.',
    session: (h) => `An evening can be cancelled up to ${h} before it starts and comes back as credit; later than that it is charged.`,
    sessionUntilStart: 'An evening can be cancelled any time before it starts and comes back as credit.',
    credit: 'Credit stays on your account and goes towards another registration; it is not refunded to a card.',
    title: 'Cancellation terms'
  },
  ru: {
    closes: (d) => `Отменить запись можно до ${d}.`,
    closesNever: 'Отменить запись можно в любой момент.',
    closed: (d) => `Окно отмены закрылось ${d}.`,
    beforeStart: 'При отмене до первого занятия вся стоимость возвращается на счёт в виде кредита.',
    flat: 'При отмене после начала занятий на счёт возвращается половина стоимости.',
    prorated: 'При отмене после начала занятий на счёт возвращается стоимость занятий, которые ещё не прошли.',
    fee: (d) => `Регистрационный взнос возвращается при отмене до ${d}, позже — нет.`,
    feeAlways: 'Регистрационный взнос возвращается при любой отмене.',
    session: (h) => `Занятие можно отменить не позднее чем за ${h} до начала — оплата вернётся кредитом; позже занятие оплачивается.`,
    sessionUntilStart: 'Занятие можно отменить в любой момент до начала — оплата вернётся кредитом.',
    credit: 'Кредит остаётся на счёте и идёт в счёт другой записи; возврат на карту не производится.',
    title: 'Условия отмены'
  }
};

// The lines, in reading order, for one set of frozen terms.
//
//   spec = { type, cancellation, sessionCancelHours, hasFee }
//
// `type` and `cancellation` are exactly what the frozen block carries;
// `sessionCancelHours` is the drop-in's per-evening window, which lives on the
// activity for a registration and on each attendance record once an evening is
// booked; `hasFee` says whether a registration fee is actually being charged on
// THIS registration, because a line about a fee nobody is billing is the same
// mistake "includes the yearly registration fee" made under every cost card.
//
// ⚠ THE ORDER MIRRORS creditFor()'s OWN ORDER — the hard cutoff answers for
// everything and comes first, then the course, then the fee on its own date —
// so a reader works down the rules in the order they are applied rather than in
// the order they happen to have been written.
function termsFor(spec, lang) {
  const l = langOf(lang);
  const t = T[l];
  const s = spec || {};
  const C = s.cancellation || {};
  const lines = [];

  // A drop-in has no term to unwind: cancelling the registration credits
  // nothing, and creditFor() refuses at the top rather than answering. What is
  // creditable is one evening, so that is the only rule there is to state.
  if (s.type === 'dropin') {
    const hours = s.sessionCancelHours == null ? null : Number(s.sessionCancelHours);
    lines.push(hours == null || !(hours > 0)
      ? t.sessionUntilStart
      : t.session(HOURS[l](hours)));
    lines.push(t.credit);
    return lines;
  }

  // ⚠ THE TENSE IS THE CALLER'S TO DECIDE, not this module's. Whether the window
  // has passed is a question about the clock, and this file asks the clock for
  // the same reason _credit.js does not: the same spec has to produce the same
  // sentence a year later. creditFor() has already answered it — `mayCancel`
  // false with reason 'cancellation-closed' — so the caller passes the answer
  // in. Printing "you can cancel up to 16 December" to somebody it is already
  // too late for is a screen contradicting the button it is under.
  const closes = dateOr(C.cancellationCutoffDate);

  // Once the window is shut there is one thing left to say. The three rules
  // under it describe what cancelling would have earned, in a tense that no
  // longer applies — and a family reading "cancel before the first session and
  // the whole fee comes back" under a page with no cancel button on it is being
  // offered something twice over that is not available at all.
  if (s.closed && closes) return [t.closed(fullDate(closes, l))];

  lines.push(closes ? t.closes(fullDate(closes, l)) : t.closesNever);
  lines.push(t.beforeStart);
  lines.push(C.mode === 'prorated' ? t.prorated : t.flat);

  if (s.hasFee) {
    const feeDate = dateOr(C.registrationFeeCutoffDate);
    lines.push(feeDate ? t.fee(fullDate(feeDate, l)) : t.feeAlways);
  }

  lines.push(t.credit);
  return lines;
}

const titleFor = (lang) => T[langOf(lang)].title;

module.exports = { termsFor, titleFor, _internal: { fullDate, dateOr } };
