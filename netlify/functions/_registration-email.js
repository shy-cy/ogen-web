// The five messages a registration sends: you are registered, you have a
// place, we cannot offer one, nobody answered in time, and money arrived.
//
// Copy lives here in all three languages, one table per message, the same
// discipline the nav, the footer, the contact form and the account messages
// each follow — a wording change is an edit to a table.
//
// ⚠ THE RUSSIAN HAS NOT BEEN REVIEWED BY A NATIVE SPEAKER. It joins the debt
// ogen-legal-review on the legal pages is tracking, alongside the account
// messages, the guardian invitation and the two Russian price labels.
//
// THE ACTIVITY TITLE IS PICKED IN THE READER'S LANGUAGE, through the same
// FALLBACK chain every sentence on the site uses, so a family reading Russian
// gets the Russian title where there is one and the English or Hebrew where
// there is not — rather than a message half in one language and half in
// another's default.
//
// Every send goes through _email.js and is wrapped in settle(), so a mail
// failure never blocks the action it accompanies: a registration is approved
// whether or not the message about it goes.

const email = require('./_email');
const { lang, pathFor, esc, strip, shell, shellRaw, SITE } = require('./_email-shell');
const { pick } = require('./_activity-facts');

const titleOf = (reg, l) => pick(((reg && reg.frozen) || {}).activityTitle, l) || '';
const childOf = (reg) => ((reg && reg.frozen) || {}).participantName || '';

// Where the messages about NOT having a place land: the public activity page,
// which needs nothing signed in. The expiry message points here because the
// registration it names has been released — sending someone to a registration
// page to read that it is over is a worse door than the activity itself.
const activityHref = (reg, l) => {
  const slug = ((reg && reg.frozen) || {}).activitySlugAtSubmission;
  return slug ? pathFor(l, '/activities/' + slug) : pathFor(l, '/activities');
};

// WHERE MONEY LIVES, which is not where an announcement lives.
//
// The two messages about NOT having a place — rejected and expired — point at
// the public activity page, and rightly: they are about the place, and there may
// be nothing signed in to show. The three that follow a live registration point
// here instead, because every one of them is now partly about paying, and the
// only page showing what is owed, what is paid and what is left is the family's
// own registration page — addressed by participant and activity id, which is the
// registration's key, never by the frozen slug. The frozen slug is audit data;
// following it after a rename opens the wrong record or none, and tells a family
// their registration does not exist.
//
// ⚠ `p` AND `a`, WHICH IS WHAT THE PAGE READS. It was `participantId` and
// `activityId` — self-describing, agreeing with the API, and matching nothing:
// `js/member-account.js` reads `param('p')` and `param('a')`, so every one of
// these links landed a family on "that registration was not found". The test
// that pinned this format only ever read the email, which is how two halves of
// one link disagree in writing. There is one spelling now and a test compares
// the two sides.
//
// `#pay` is why the link exists. The page is the activity, the facts, the
// price, the sessions — and a family opening a message about money has one
// question, which was several screens down. The hash scrolls the cost card
// into view; a reader who wanted the rest scrolls up, which is the cheaper
// mistake.
const registrationHref = (reg, l) =>
  pathFor(l, '/account/activity') +
  '?p=' + encodeURIComponent(reg.participantId || '') +
  '&a=' + encodeURIComponent(reg.activityId || '') + '#pay';

// --- your child is registered ----------------------------------------------
//
// ⚠ IT DOES NOT SAY "REQUEST", AND IT NAMES NO DEADLINE. It used to open "your
// request has arrived" and promise an answer within `expiryDays` — which is
// the shape of our queue, not the shape of what the family did. They signed a
// child up; from their side that is a registration, and being told it is
// pending review reads as a decision that might go either way over something
// they consider settled. If we cannot take the place we write and say so, and
// that message already exists — REJECTED, below.
//
// So this one confirms, and promises the one thing a family is now waiting
// for: the payment link. An activity that auto-approves sends APPROVED instead
// and the link is live the moment they open the page.
// --- we have your request --------------------------------------------------

const RECEIVED = {
  he: {
    subject: (child, act) => `${child} נרשם/ה ל${act}`,
    heading: 'ההרשמה בוצעה',
    body: (child, act) => `${child} נרשם/ה ל${act}.`,
    next: 'קישור לתשלום יישלח אליכם בקרוב.',
    button: 'לעמוד ההרשמה'
  },
  en: {
    subject: (child, act) => `${child} is registered for ${act}`,
    heading: 'Registered',
    body: (child, act) => `${child} is registered for ${act}.`,
    next: 'We will send you a payment link shortly.',
    button: 'Go to the registration'
  },
  ru: {
    subject: (child, act) => `${child} записан(а) на ${act}`,
    heading: 'Запись оформлена',
    body: (child, act) => `${child} записан(а) на ${act}.`,
    next: 'Ссылку на оплату мы пришлём в ближайшее время.',
    button: 'Страница записи'
  }
};

// --- you have a place ------------------------------------------------------
//
// ⚠ ITS SUBJECT MUST NOT CONVERGE WITH RECEIVED's. A manually-approved
// registration sends both, days apart, and "X is registered for Y" followed by
// "X is registered for Y" is one message appearing to arrive twice. This one
// says CONFIRMED in all three languages; the Russian pair was word-for-word
// identical for a moment while that was being worked out.

const APPROVED = {
  he: {
    subject: (child, act) => `ההרשמה של ${child} אושרה · ${act}`,
    heading: 'ההרשמה אושרה',
    body: (child, act) => `${child} רשום/ה ל${act}. נשמח לראותכם.`,
    next: 'מועדי המפגשים והתשלום נמצאים בעמוד ההרשמה. אם משהו לא מתאים, כתבו לנו.',
    button: 'לתשלום ולפרטים',
    pay: 'אפשר לשלם כאן, בלי להתחבר. מועדי המפגשים נמצאים בעמוד ההרשמה.',
    payButton: 'לתשלום'
  },
  en: {
    subject: (child, act) => `${child}'s place in ${act} is confirmed`,
    heading: 'The registration is confirmed',
    body: (child, act) => `${child} has a place in ${act}. We look forward to seeing you.`,
    next: 'The session dates and the payment are on your registration page. If anything does not fit, write to us.',
    button: 'Pay and see the details',
    pay: 'You can pay here, without signing in. The session dates are on your registration page.',
    payButton: 'Pay now'
  },
  ru: {
    subject: (child, act) => `Запись ${child} подтверждена · ${act}`,
    heading: 'Запись подтверждена',
    body: (child, act) => `${child} записан(а) на ${act}. Будем рады видеть вас.`,
    next: 'Даты занятий и оплата — на странице записи. Если что-то не подходит, напишите нам.',
    button: 'Оплата и подробности',
    pay: 'Оплатить можно здесь, без входа в учётную запись. Даты занятий — на странице записи.',
    payButton: 'Оплатить'
  }
};

// --- we cannot offer a place -----------------------------------------------
//
// Approval is binary and carries no reason code, by design — so this message
// must not pretend to explain. What it does instead is open a door: the decision
// is a person's, and a person can be asked about it.

const REJECTED = {
  he: {
    subject: (child, act) => `בקשת ההרשמה של ${child} · ${act}`,
    heading: 'לא נוכל להציע מקום הפעם',
    body: (child, act) => `לא נוכל להציע ל${child} מקום ב${act} בשלב הזה.`,
    talk: 'אם תרצו לדעת יותר או לבדוק אפשרות אחרת, השיבו להודעה הזו ונשמח לדבר.',
    button: 'לפעילויות נוספות'
  },
  en: {
    subject: (child, act) => `About the request for ${child} · ${act}`,
    heading: 'We cannot offer a place this time',
    body: (child, act) => `We are not able to offer ${child} a place in ${act} at this point.`,
    talk: 'If you would like to know more, or to look at something else, reply to this message and we will talk it through.',
    button: 'Other activities'
  },
  ru: {
    subject: (child, act) => `О заявке для ${child} · ${act}`,
    heading: 'Сейчас мы не можем предложить место',
    body: (child, act) => `К сожалению, мы не можем предложить ${child} место на ${act} в данный момент.`,
    talk: 'Если вы хотите узнать больше или рассмотреть другой вариант, ответьте на это письмо — мы обсудим.',
    button: 'Другие занятия'
  }
};

// --- the place has been cancelled ------------------------------------------
//
// ⚠ IT DID NOT EXIST, AND THE SILENCE WAS THE BUG. A family could cancel and
// receive nothing at all; the only record was a reason typed into the history
// for an admin to read later. That was survivable while the confirmation called
// a registration a "request", and stopped being survivable the moment the
// confirmation started saying REGISTERED — a place you were told you had, taken
// away with no message, is the one gap in this sequence a family would notice
// and could not explain.
//
// ⚠ THE CREDIT SENTENCE IS OMITTED WHEN THE CREDIT IS ZERO, and that is not
// tidiness. Nothing on this site has collected money yet, so every cancellation
// today credits exactly nothing — and "credited EUR 0.00" reads as a refusal,
// as a decision taken against the family, rather than as the arithmetic of an
// activity nobody has paid for. A figure appears only once there is one.
//
// The amount comes from the LEDGER ENTRY that was already written, never from a
// second call to creditFor(). Two computations of one figure is how an email and
// a ledger come to disagree about what somebody is owed, and the family reads
// the email.

const CANCELLED = {
  he: {
    subject: (child, act) => `ההרשמה של ${child} בוטלה · ${act}`,
    heading: 'ההרשמה בוטלה',
    body: (child, act) => `ההרשמה של ${child} ל${act} בוטלה.`,
    credited: (amount) => `זוכיתם ב-${amount}. הסכום שמור בחשבון שלכם וניתן להשתמש בו בהרשמה הבאה.`,
    talk: 'אם זה נעשה בטעות או שתרצו לחזור, השיבו להודעה הזו ונשמח לעזור.',
    button: 'לפעילויות נוספות'
  },
  en: {
    subject: (child, act) => `${child}'s registration for ${act} has been cancelled`,
    heading: 'The registration has been cancelled',
    body: (child, act) => `${child}'s place in ${act} has been cancelled.`,
    credited: (amount) => `${amount} has been credited to your account. It stays there and can be used towards a future registration.`,
    talk: 'If this was a mistake, or you would like to come back, reply to this message and we will help.',
    button: 'Other activities'
  },
  ru: {
    subject: (child, act) => `Запись ${child} на ${act} отменена`,
    heading: 'Запись отменена',
    body: (child, act) => `Запись ${child} на ${act} отменена.`,
    credited: (amount) => `На ваш счёт зачислено ${amount}. Эта сумма сохраняется и может быть использована при следующей записи.`,
    talk: 'Если это произошло по ошибке или вы захотите вернуться, ответьте на это письмо — мы поможем.',
    button: 'Другие занятия'
  }
};

// --- nobody answered in time -----------------------------------------------
//
// THE APOLOGY IS OURS, and the copy has to say so. It is tempting to write "your
// request expired", which reads as the family having let something lapse — but
// the thing that lapsed is a registration WE did not answer. The place is
// released so it is not tied up indefinitely; the family did nothing wrong and
// the message must not imply they did.
//
// ⚠ IT NO LONGER SAYS "REQUEST" EITHER, and that costs this message more than
// it costs the others. The family was told they were REGISTERED, so this one
// takes something away — which is exactly why it has to use the same word for
// the thing it is taking. "Your request expired" would be a second, quieter
// falsehood on top of the first: it would imply they had been waiting on an
// answer all along. They were not; we told them it was done.
//
// The compensating change is not in this table. DEFAULT_EXPIRY_DAYS went from
// 14 to 45, so answering a queue beats this message in any ordinary week.

const EXPIRED = {
  he: {
    subject: (child, act) => `ההרשמה של ${child} · ${act}`,
    heading: 'לא הספקנו לחזור אליכם',
    body: (child, act) => `ההרשמה של ${child} ל${act} נשארה ללא מענה מצדנו, והמקום שוחרר.`,
    again: 'מצטערים — זו טעות שלנו. אם הפעילות עדיין מעניינת אתכם, אפשר להירשם שוב או פשוט להשיב להודעה הזו.',
    button: 'לעמוד הפעילות'
  },
  en: {
    subject: (child, act) => `About ${child}'s registration · ${act}`,
    heading: 'We did not get back to you in time',
    body: (child, act) => `${child}'s registration for ${act} went unanswered on our side, and the place has been released.`,
    again: 'We are sorry — this one is ours. If the activity still interests you, you can register again, or simply reply to this message.',
    button: 'Go to the activity'
  },
  ru: {
    subject: (child, act) => `О записи ${child} · ${act}`,
    heading: 'Мы не успели вам ответить',
    body: (child, act) => `Запись ${child} на ${act} осталась без ответа с нашей стороны, и место освобождено.`,
    again: 'Приносим извинения — это наша вина. Если занятие вам всё ещё интересно, можно записаться снова или просто ответить на это письмо.',
    button: 'Страница занятия'
  }
};

function receivedMessage(reg, account) {
  const l = lang(((account || {}).profile || {}).preferredLanguage);
  const T = RECEIVED[l];
  const child = childOf(reg), act = titleOf(reg, l);
  const html = shell(l, T.heading,
    [esc(T.body(child, act)), esc(T.next)],
    { href: registrationHref(reg, l), label: T.button });
  return { to: account.email, subject: T.subject(child, act), html: html, text: strip(html) };
}

// ⚠ THE BUILDERS STAY PURE, AND THE SENDERS DO THE MINTING.
//
// A pay link is a row in a Blobs store, so building one inside a message would
// make every one of these functions open a store — and they are the part of
// this file a test can run with no infrastructure at all, in three languages,
// in a loop. `payUrl` is therefore a parameter: absent, the button points at
// the family's own registration page and the message is exactly what it was.
//
// That absence is also the failure mode. Minting is best effort inside
// settle(), so a Blobs outage costs a family one password rather than the
// email itself.
function approvedMessage(reg, account, payUrl) {
  const l = lang(((account || {}).profile || {}).preferredLanguage);
  const T = APPROVED[l];
  const child = childOf(reg), act = titleOf(reg, l);
  const html = shell(l, T.heading,
    [esc(T.body(child, act)), esc(payUrl ? T.pay : T.next)],
    payUrl ? { href: payUrl, label: T.payButton }
           : { href: registrationHref(reg, l), label: T.button });
  return { to: account.email, subject: T.subject(child, act), html: html, text: strip(html) };
}

// THE ONLY MESSAGE AN ADMIN MAY REWRITE BEFORE IT GOES, and the reason is in
// the note above REJECTED: approval is binary and carries no reason code, so
// this message cannot explain itself. The generated text opens a door — reply
// and we will talk it through — and an admin who already knows what to say
// should be able to say it here rather than in a second email the family has to
// connect to the first.
//
// ⚠ THE DRAFT IS IN THE FAMILY'S LANGUAGE, NOT THE ADMIN'S. That is the whole
// awkwardness of the feature and it is not hidden: an admin editing a message
// to a Russian-reading family is editing Russian, so the draft carries `lang`
// and the screen says so plainly. Sending the generated text unchanged is
// always available and is the default.
//
// The body is returned as the MARKUP the shell would have rendered, so what the
// editor opens on is what would have been sent — not a plain-text
// approximation that silently loses its paragraphs on the way back.
function rejectedDraft(reg, account) {
  const l = lang(((account || {}).profile || {}).preferredLanguage);
  const T = REJECTED[l];
  const child = childOf(reg), act = titleOf(reg, l);
  return {
    lang: l,
    subject: T.subject(child, act),
    heading: T.heading,
    // Bare <p>, which is what the editor produces and what sanitiseRich()
    // allows through. The shell applies the spacing on the way out, so this is
    // both what the editor opens on and what it can hand back unchanged.
    bodyHtml: [esc(T.body(child, act)), esc(T.talk)].map((p) => `<p>${p}</p>`).join('\n')
  };
}

// `override` is {subject, bodyHtml} and arrives ALREADY SANITISED — the caller
// does it, because the caller is the handler that assumes a hostile client and
// this module is also called from places where nothing came from a browser.
function rejectedMessage(reg, account, override) {
  const l = lang(((account || {}).profile || {}).preferredLanguage);
  const T = REJECTED[l];
  const child = childOf(reg), act = titleOf(reg, l);
  const cta = { href: pathFor(l, '/activities'), label: T.button };
  const html = (override && override.bodyHtml)
    ? shellRaw(l, T.heading, override.bodyHtml, cta)
    : shell(l, T.heading, [esc(T.body(child, act)), esc(T.talk)], cta);
  const subject = (override && override.subject) || T.subject(child, act);
  return { to: account.email, subject: subject, html: html, text: strip(html) };
}

// The paragraphs, in the family's language. `creditCents` is what the ledger
// entry actually recorded — 0, or absent, means no credit line at all.
function cancelledLines(reg, account, creditCents) {
  const l = lang(((account || {}).profile || {}).preferredLanguage);
  const T = CANCELLED[l];
  const child = childOf(reg), act = titleOf(reg, l);
  const lines = [T.body(child, act)];
  if (creditCents > 0) lines.push(T.credited(money(creditCents)));
  lines.push(T.talk);
  return { l: l, T: T, child: child, act: act, lines: lines };
}

// Bare <p>, like the rejection draft: the editor strips styles and so does the
// sanitiser, so the shell applies the spacing on the way out and what the editor
// opens on is what it can hand back unchanged.
function cancelledDraft(reg, account, creditCents) {
  const { l, T, child, act, lines } = cancelledLines(reg, account, creditCents);
  return {
    lang: l,
    subject: T.subject(child, act),
    heading: T.heading,
    creditCents: creditCents || 0,
    bodyHtml: lines.map((p) => `<p>${esc(p)}</p>`).join('\n')
  };
}

function cancelledMessage(reg, account, creditCents, override) {
  const { l, T, child, act, lines } = cancelledLines(reg, account, creditCents);
  const cta = { href: pathFor(l, '/activities'), label: T.button };
  const html = (override && override.bodyHtml)
    ? shellRaw(l, T.heading, override.bodyHtml, cta)
    : shell(l, T.heading, lines.map(esc), cta);
  const subject = (override && override.subject) || T.subject(child, act);
  return { to: account.email, subject: subject, html: html, text: strip(html) };
}

function expiredMessage(reg, account) {
  const l = lang(((account || {}).profile || {}).preferredLanguage);
  const T = EXPIRED[l];
  const child = childOf(reg), act = titleOf(reg, l);
  const html = shell(l, T.heading,
    [esc(T.body(child, act)), esc(T.again)],
    { href: activityHref(reg, l), label: T.button });
  return { to: account.email, subject: T.subject(child, act), html: html, text: strip(html) };
}

// --- sending ---------------------------------------------------------------

// --- money has arrived ------------------------------------------------------
//
// A RECEIPT, NOT A CELEBRATION. The family already knows they have a place —
// that was the approval email — so this one exists to answer a single question
// later: did the money get there, and is anything still due.
//
// It states what remains RATHER THAN CONGRATULATING, because a part payment is
// a normal thing here and an email that says "paid!" over an outstanding
// balance is how a debt stops being chased. `outstanding` is computed by the
// caller from the record, so this table never does arithmetic — the figure a
// family reads and the figure the registration holds cannot disagree.
//
// No amount is ever formatted here from cents. money() below is the one place,
// matching js/member-account.js so a family sees the same shape in the email and
// on the screen they opened it from.

const PAID = {
  he: {
    subject: (act) => `קיבלנו את התשלום · ${act}`,
    heading: 'התשלום התקבל',
    body: (child, act, amount) => `קיבלנו ${amount} עבור ${child} ב${act}. תודה.`,
    settled: 'התשלום הושלם במלואו.',
    remaining: (amount) => `נותר לתשלום: ${amount}.`,
    button: 'לעמוד ההרשמה',
    payButton: 'לתשלום היתרה'
  },
  en: {
    subject: (act) => `Payment received · ${act}`,
    heading: 'Payment received',
    body: (child, act, amount) => `We have received ${amount} for ${child} in ${act}. Thank you.`,
    settled: 'This registration is now paid in full.',
    remaining: (amount) => `Still to pay: ${amount}.`,
    button: 'Go to the registration',
    payButton: 'Pay the balance'
  },
  ru: {
    subject: (act) => `Платёж получен · ${act}`,
    heading: 'Платёж получен',
    body: (child, act, amount) => `Мы получили ${amount} за ${child} — ${act}. Спасибо.`,
    settled: 'Оплата внесена полностью.',
    remaining: (amount) => `Осталось оплатить: ${amount}.`,
    button: 'Страница записи',
    payButton: 'Оплатить остаток'
  }
};

// The same shape as js/member-account.js's money(), deliberately.
const money = (cents) => '\u20AC' + (Math.round(Number(cents) || 0) / 100).toFixed(2);

// The pay link is offered only when a BALANCE REMAINS, and that condition is
// the amount rather than the caller's intention — a receipt for a settled
// registration carrying a "pay the balance" button would be asking for money
// that is not owed.
function paidMessage(reg, account, paidCents, outstandingCents, payUrl) {
  const l = lang(((account || {}).profile || {}).preferredLanguage);
  const T = PAID[l];
  const child = childOf(reg), act = titleOf(reg, l);
  const owing = outstandingCents > 0;
  const tail = owing ? T.remaining(money(outstandingCents)) : T.settled;
  const cta = (owing && payUrl)
    ? { href: payUrl, label: T.payButton }
    : { href: registrationHref(reg, l), label: T.button };
  const html = shell(l, T.heading, [esc(T.body(child, act, money(paidCents))), esc(tail)], cta);
  return { to: account.email, subject: T.subject(act), html: html, text: strip(html) };
}

const langOf = (account) => lang(((account || {}).profile || {}).preferredLanguage);

const sendReceived = (reg, account) =>
  email.settle('registration-received', account.email, () =>
    email.send(receivedMessage(reg, account),
      { template: 'registration-received', lang: langOf(account) }));

// MINTED HERE, INSIDE settle(). The link is a row in a Blobs store and the
// message is not — so the store is opened by the sender, never by the builder,
// and a failure to open it costs the family one password rather than the email.
// `payUrl` stays null on that path and the button falls back to the
// registration page, which is where it pointed before any of this existed.
async function payUrlFor(reg, account) {
  try {
    const l = langOf(account);
    const link = await require('./_pay-link').createPayLink(reg, l);
    return SITE + '/pay?t=' + encodeURIComponent(link.token) + '&l=' + l;
  } catch (err) {
    console.warn('[registration-email] pay link not minted: ' + (err && err.message));
    return null;
  }
}

const sendApproved = (reg, account) =>
  email.settle('registration-approved', account.email, async () =>
    email.send(approvedMessage(reg, account, await payUrlFor(reg, account)),
      { template: 'registration-approved', lang: langOf(account) }));

const sendRejected = (reg, account, override) =>
  email.settle('registration-rejected', account.email, () =>
    email.send(rejectedMessage(reg, account, override),
      { template: 'registration-rejected', lang: langOf(account) }));

const sendExpired = (reg, account) =>
  email.settle('registration-expired', account.email, () =>
    email.send(expiredMessage(reg, account),
      { template: 'registration-expired', lang: langOf(account) }));

// TWO CALLERS, ONE MESSAGE. A guardian cancelling their own place gets it
// immediately with no review, because nobody is at a screen to review it; an
// admin cancelling somebody else's gets the panel first, exactly as a rejection
// does. The difference is one optional argument, not a second message.
const sendCancelled = (reg, account, creditCents, override) =>
  email.settle('registration-cancelled', account.email, () =>
    email.send(cancelledMessage(reg, account, creditCents, override),
      { template: 'registration-cancelled', lang: langOf(account) }));

const sendPaid = (reg, account, paidCents, outstandingCents) =>
  email.settle('registration-paid', account.email, async () =>
    email.send(paidMessage(reg, account, paidCents, outstandingCents,
                           outstandingCents > 0 ? await payUrlFor(reg, account) : null),
      { template: 'registration-paid', lang: langOf(account) }));

module.exports = {
  payUrlFor,
  sendReceived, sendApproved, sendRejected, sendExpired, sendCancelled,
  receivedMessage, approvedMessage, rejectedMessage, expiredMessage, rejectedDraft,
  cancelledMessage, cancelledDraft,
  RECEIVED, APPROVED, REJECTED, EXPIRED, CANCELLED,
  paidMessage, sendPaid
};
