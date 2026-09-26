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

const { dayAndMonth, ruPlural, pick } = require('./_activity-facts');
// ⚠ THE SCHEDULE IS READ THROUGH _credit.js, NEVER RE-DERIVED HERE. tiersFrom()
// is the one place a frozen policy becomes a list of steps, including the
// translation of a record written before the schedule existed — and this module's
// entire premise is that it renders the policy that decides rather than stating
// it a second time. A local copy of that translation is a second policy.
const { tiersFrom, closingOf, AT_START, PRORATED } = require('./_credit');

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
    closes: (d) => `אפשר לבטל את ההרשמה בכל שלב. ביטול עד ${d} מזכה בזיכוי; לאחר מכן הביטול אינו מזכה בזיכוי.`,
    closesNever: 'אפשר לבטל את ההרשמה בכל שלב, ואין מועד שאחריו הביטול אינו מזכה בזיכוי.',
    closed: (d) => `חלון הזיכוי נסגר ב-${d}. עדיין אפשר לבטל את ההרשמה, אך היא אינה מזכה בזיכוי.`,
    beforeStart: 'ביטול לפני המפגש הראשון מזכה בזיכוי מלא על עלות הפעילות.',
    flat: 'ביטול אחרי שהפעילות התחילה מזכה בזיכוי של מחצית מעלות הפעילות.',
    prorated: 'ביטול אחרי שהפעילות התחילה מזכה בזיכוי יחסי למפגשים שטרם התקיימו.',
    fee: (d) => `דמי ההרשמה מזוכים בביטול עד ${d}, ולא לאחר מכן.`,
    feeAlways: 'דמי ההרשמה מזוכים בכל ביטול.',
    session: (h) => `אפשר לבטל מפגש עד ${h} לפני תחילתו ולקבל זיכוי; לאחר מכן המפגש מחויב.`,
    sessionUntilStart: 'אפשר לבטל מפגש בכל רגע לפני תחילתו ולקבל זיכוי.',
    credit: 'הזיכוי נשמר בחשבון ומשמש להרשמה אחרת; אין החזר כספי לכרטיס.',
    scheduleLead: 'אפשר לבטל את ההרשמה בכל שלב. מה שיוחזר כזיכוי תלוי במועד הביטול:',
    untilStart: 'עד תחילת הפעילות',
    untilDate: (d) => `עד ${d}`,
    untilAlways: 'בכל מועד',
    afterThat: 'לאחר מכן',
    whole: 'כל עלות הפעילות',
    nothingBack: 'אין זיכוי',
    proratedShort: 'המפגשים שעוד לא התקיימו',
    title: 'תנאי ביטול'
  },
  en: {
    closes: (d) => `You can cancel this registration at any time. Up to ${d} it earns credit back; after that it earns nothing.`,
    closesNever: 'You can cancel this registration at any time, and there is no date after which it stops earning credit back.',
    closed: (d) => `The credit window closed on ${d}. You can still cancel this registration, and nothing comes back.`,
    beforeStart: 'Cancel before the first session and the whole activity fee comes back as credit.',
    flat: 'Cancel after it has started and half of the activity fee comes back as credit.',
    prorated: 'Cancel after it has started and the sessions you have not had come back as credit.',
    fee: (d) => `The registration fee comes back as credit if you cancel by ${d}, and not after that.`,
    feeAlways: 'The registration fee comes back as credit whenever you cancel.',
    session: (h) => `An evening can be cancelled up to ${h} before it starts and comes back as credit; later than that it is charged.`,
    sessionUntilStart: 'An evening can be cancelled any time before it starts and comes back as credit.',
    credit: 'Credit stays on your account and goes towards another registration; it is not refunded to a card.',
    scheduleLead: 'You can cancel this registration at any time. What comes back as credit depends on when:',
    untilStart: 'until it starts',
    untilDate: (d) => `until ${d}`,
    untilAlways: 'at any time',
    afterThat: 'after that',
    whole: 'the whole activity fee',
    nothingBack: 'nothing',
    proratedShort: 'the sessions you have not had',
    title: 'Cancellation terms'
  },
  ru: {
    closes: (d) => `Отменить запись можно в любой момент. При отмене до ${d} средства возвращаются на счёт, позже — нет.`,
    closesNever: 'Отменить запись можно в любой момент, и нет даты, после которой средства перестают возвращаться.',
    closed: (d) => `Окно возврата закрылось ${d}. Отменить запись всё ещё можно, но средства не возвращаются.`,
    beforeStart: 'При отмене до первого занятия вся стоимость возвращается на счёт в виде кредита.',
    flat: 'При отмене после начала занятий на счёт возвращается половина стоимости.',
    prorated: 'При отмене после начала занятий на счёт возвращается стоимость занятий, которые ещё не прошли.',
    fee: (d) => `Регистрационный взнос возвращается при отмене до ${d}, позже — нет.`,
    feeAlways: 'Регистрационный взнос возвращается при любой отмене.',
    session: (h) => `Занятие можно отменить не позднее чем за ${h} до начала — оплата вернётся кредитом; позже занятие оплачивается.`,
    sessionUntilStart: 'Занятие можно отменить в любой момент до начала — оплата вернётся кредитом.',
    credit: 'Кредит остаётся на счёте и идёт в счёт другой записи; возврат на карту не производится.',
    scheduleLead: 'Отменить запись можно в любой момент. Сколько вернётся на счёт, зависит от даты отмены:',
    untilStart: 'до начала занятий',
    untilDate: (d) => `до ${d}`,
    untilAlways: 'в любой момент',
    afterThat: 'после этого',
    whole: 'вся стоимость занятия',
    nothingBack: 'ничего',
    proratedShort: 'занятия, которые ещё не прошли',
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
    // The note is offered on a drop-in too: the window it explains is a number of
    // hours rather than a date, and "the hall is booked and paid for on the day"
    // is exactly the kind of thing that cannot account for itself either.
    noteLine(C, l).forEach((x) => lines.push(x));
    lines.push(t.credit);
    return lines;
  }

  // ⚠ THE TENSE IS THE CALLER'S TO DECIDE, not this module's. Whether the window
  // has passed is a question about the clock, and this file asks the clock for
  // the same reason _credit.js does not: the same spec has to produce the same
  // sentence a year later. creditFor() has already answered it — reason
  // 'cancellation-closed' — so the caller passes the answer in. Printing "you can cancel up to 16 December" to somebody it is already
  // too late for is a screen contradicting the button it is under.
  const closes = dateOr(closingOf(C));

  // Once the window is shut there is one thing left to say. The three rules
  // under it describe what cancelling would have earned, in a tense that no
  // longer applies — and a family reading "cancel before the first session and
  // the whole fee comes back" on a registration that can now earn nothing is
  // being offered something that is not available.
  //
  // ⚠ THE CUTOFF ENDS THE CREDIT, NOT THE CANCELLATION, and these sentences say
  // so because the code does. It used to refuse the guardian's cancel button
  // outright, which QA read — correctly — as the wrong rule: "I don't understand
  // why a family should be rejected to cancel their course. They can cancel, but
  // not get a refund." A family who is not coming back has to be able to say so,
  // and per-EVENING cancellation has always worked exactly that way. One split
  // between entitlement and the ability to act, in both places.
  if (s.closed && closes) {
    // The reason still applies, and this is the moment it is worth the most: a
    // family reading that nothing comes back is exactly the reader asking why.
    return [t.closed(fullDate(closes, l))].concat(noteLine(C, l));
  }

  const tiers = tiersFrom(C);

  // ⚠ SENTENCES FOR THE CLASSIC SHAPE, A TABLE FOR EVERYTHING ELSE — and the
  // test is the SHAPE rather than the number of steps.
  //
  // Counting steps was the obvious rule and it lies: a two-step schedule of 75%
  // then 50% is not "cancel before the first session and the whole fee comes
  // back". The three sentences below describe one specific schedule, so they are
  // used for exactly that schedule and no other. That also means every page and
  // every email on the site today is byte-identical to before, because every
  // activity on it holds precisely this shape.
  if (isClassic(tiers)) {
    lines.push(closes ? t.closes(fullDate(closes, l)) : t.closesNever);
    lines.push(t.beforeStart);
    lines.push(tiers[1].percent === PRORATED ? t.prorated : t.flat);
  } else {
    // ⚠ A SCHEDULE IS RENDERED AS A SCHEDULE. Four sentences of "cancel by X and
    // Y% comes back" is the long undifferentiated list a reader skips, and the
    // one thing they are looking for — which band am I in — is the hardest thing
    // to find in it. Two columns and they can find their own date.
    lines.push(t.scheduleLead);
    lines.push({ schedule: scheduleRows(tiers, l) });
  }

  // ⚠ THE EXPLANATION SITS WITH THE DATES IT EXPLAINS, above the fee. The fee is
  // a different pot of money answering to its own date, so a note about why the
  // course closes when it does reads as being about the fee if it follows it.
  noteLine(C, l).forEach((x) => lines.push(x));

  if (s.hasFee) {
    const feeDate = dateOr(C.registrationFeeCutoffDate);
    lines.push(feeDate ? t.fee(fullDate(feeDate, l)) : t.feeAlways);
  }

  lines.push(t.credit);
  return lines;
}

// Exactly the schedule the three sentences describe: everything back until the
// first session, then one step of half or of the sessions still to come. This is
// what `mode: 'flat'` and `mode: 'prorated'` translate to, so a record written
// before the schedule existed always matches.
function isClassic(tiers) {
  if (!Array.isArray(tiers) || tiers.length !== 2) return false;
  if (tiers[0].until !== AT_START || Number(tiers[0].percent) !== 100) return false;
  return tiers[1].percent === PRORATED || Number(tiers[1].percent) === 50;
}

// One row per step, plus a closing row when the schedule actually closes. A last
// step with no date does not close, so there is nothing to say after it.
function scheduleRows(tiers, l) {
  const t = T[l];
  const rows = tiers.map((x) => ({ when: whenText(x.until, l), credit: creditText(x.percent, l) }));
  const closing = tiers.length ? tiers[tiers.length - 1].until : null;
  if (closing != null && closing !== OFF) rows.push({ when: t.afterThat, credit: t.nothingBack });
  return rows;
}

function whenText(until, l) {
  const t = T[l];
  if (until === AT_START) return t.untilStart;
  const d = dateOr(until);
  return d ? t.untilDate(fullDate(d, l)) : t.untilAlways;
}

// ⚠ THE PHRASE FOR ONE BOUNDARY, for the cancel dialog rather than for the table.
//
// It is a PHRASE and not a date, which is the whole reason this exists: the
// commonest step of all ends "when it starts", and a dialog that could only
// interpolate a date said nothing at all in exactly the case a family most wants
// it — full credit now, half of it once the course begins. Empty for a boundary
// that never arrives, because there is then no "after that" to warn about.
function boundaryText(until, lang) {
  const l = langOf(lang);
  if (until == null || until === OFF) return '';
  return whenText(until, l);
}

// Words for the three values that have them, a bare percentage for the rest.
// "100%" of what is the question "the whole activity fee" answers, and "0%" is a
// figure where "nothing" is a fact.
function creditText(percent, l) {
  const t = T[l];
  if (percent === PRORATED) return t.proratedShort;
  const n = Number(percent);
  if (n >= 100) return t.whole;
  if (!(n > 0)) return t.nothingBack;
  return n + '%';
}

// The admin's own sentence, in the reader's language, or nothing at all.
//
// It falls back through the usual chain, so a note typed in Hebrew alone is shown
// in Hebrew on all three pages until somebody translates it — the same choice the
// group-size override makes, and for the same reason: the same sentence in the
// wrong language beats three pages accounting for one deadline differently.
function noteLine(C, l) {
  const said = pick((C || {}).note, l);
  return said ? [said] : [];
}

// The schedule flattened to plain strings, for a caller with no room for two
// columns — and for a test that has to look for these words somewhere they must
// not appear.
function termsText(spec, lang) {
  return termsFor(spec, lang).reduce((out, line) => {
    if (typeof line === 'string') return out.concat([line]);
    (line.schedule || []).forEach((r) => out.push(r.when + ': ' + r.credit));
    return out;
  }, []);
}

const titleFor = (lang) => T[langOf(lang)].title;

module.exports = { termsFor, termsText, titleFor, dateText: fullDate, boundaryText,
                   _internal: { fullDate, dateOr, isClassic, scheduleRows, creditText, whenText } };
