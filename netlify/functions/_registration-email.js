// The four messages a registration sends: we have your request, you have a
// place, we cannot offer one, and nobody answered in time.
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
const { lang, pathFor, esc, strip, shell } = require('./_email-shell');
const { pick } = require('./_activity-facts');

const titleOf = (reg, l) => pick(((reg && reg.frozen) || {}).activityTitle, l) || '';
const childOf = (reg) => ((reg && reg.frozen) || {}).participantName || '';

// Every message ends somewhere a family can act. There is no family area yet —
// that is Phase 6 — so the link is the activity page, which is real today and
// stays right when the area arrives.
const activityHref = (reg, l) => {
  const slug = ((reg && reg.frozen) || {}).activitySlugAtSubmission;
  return slug ? pathFor(l, '/activities/' + slug) : pathFor(l, '/activities');
};

// WHERE A RECEIPT SHOULD LAND, which is not where an announcement should.
//
// The other four messages point at the public activity page, and rightly: they
// are about the place, and the reader may not be signed in. A payment receipt is
// about the MONEY, and the only page that shows what has been paid and what is
// left is the family's own registration page — addressed by participant and
// activity id, which is the registration's key, never by the frozen slug. The
// frozen slug is audit data; following it after a rename opens the wrong record
// or none, and tells a family their registration does not exist.
const registrationHref = (reg, l) =>
  pathFor(l, '/account/activity') +
  '?participantId=' + encodeURIComponent(reg.participantId || '') +
  '&activityId=' + encodeURIComponent(reg.activityId || '');

// --- we have your request --------------------------------------------------

const RECEIVED = {
  he: {
    subject: (child, act) => `קיבלנו את הבקשה עבור ${child} · ${act}`,
    heading: 'הבקשה התקבלה',
    body: (child, act) => `קיבלנו את בקשת ההרשמה של ${child} ל${act}.`,
    wait: (days) => `נחזור אליכם בתוך ${days} ימים. המקום שמור עד אז.`,
    button: 'לעמוד הפעילות'
  },
  en: {
    subject: (child, act) => `We have your request for ${child} · ${act}`,
    heading: 'Your request has arrived',
    body: (child, act) => `We have received the registration request for ${child} for ${act}.`,
    wait: (days) => `We will come back to you within ${days} days. The place is held until then.`,
    button: 'Go to the activity'
  },
  ru: {
    subject: (child, act) => `Мы получили заявку для ${child} · ${act}`,
    heading: 'Заявка получена',
    body: (child, act) => `Мы получили заявку на запись ${child} на ${act}.`,
    wait: (days) => `Мы ответим в течение ${days} дней. Место сохраняется за вами до этого момента.`,
    button: 'Страница занятия'
  }
};

// --- you have a place ------------------------------------------------------

const APPROVED = {
  he: {
    subject: (child, act) => `${child} רשום/ה ל${act}`,
    heading: 'ההרשמה אושרה',
    body: (child, act) => `${child} רשום/ה ל${act}. נשמח לראותכם.`,
    next: 'פרטי המפגשים והתשלום נמצאים בעמוד הפעילות. אם משהו לא מתאים, כתבו לנו.',
    button: 'לעמוד הפעילות'
  },
  en: {
    subject: (child, act) => `${child} has a place in ${act}`,
    heading: 'The registration is confirmed',
    body: (child, act) => `${child} has a place in ${act}. We look forward to seeing you.`,
    next: 'The session dates and the cost are on the activity page. If anything does not fit, write to us.',
    button: 'Go to the activity'
  },
  ru: {
    subject: (child, act) => `${child} записан(а) на ${act}`,
    heading: 'Запись подтверждена',
    body: (child, act) => `${child} записан(а) на ${act}. Будем рады видеть вас.`,
    next: 'Даты занятий и стоимость указаны на странице занятия. Если что-то не подходит, напишите нам.',
    button: 'Страница занятия'
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

// --- nobody answered in time -----------------------------------------------
//
// THE APOLOGY IS OURS, and the copy has to say so. It is tempting to write "your
// request expired", which reads as the family having let something lapse — but
// the thing that expired is a request WE did not answer. The hold is released so
// the place is not tied up indefinitely; the family did nothing wrong and the
// message should not imply they did.

const EXPIRED = {
  he: {
    subject: (child, act) => `בקשת ההרשמה של ${child} · ${act}`,
    heading: 'לא הספקנו לחזור אליכם',
    body: (child, act) => `הבקשה עבור ${child} ל${act} נשארה ללא מענה מצדנו, והמקום שהיה שמור שוחרר.`,
    again: 'מצטערים. אם הפעילות עדיין מעניינת אתכם, אפשר להירשם שוב או פשוט להשיב להודעה הזו.',
    button: 'לעמוד הפעילות'
  },
  en: {
    subject: (child, act) => `About the request for ${child} · ${act}`,
    heading: 'We did not get back to you in time',
    body: (child, act) => `The request for ${child} for ${act} went unanswered on our side, and the place that was being held has been released.`,
    again: 'We are sorry. If the activity still interests you, you can register again, or simply reply to this message.',
    button: 'Go to the activity'
  },
  ru: {
    subject: (child, act) => `О заявке для ${child} · ${act}`,
    heading: 'Мы не успели вам ответить',
    body: (child, act) => `Заявка для ${child} на ${act} осталась без ответа с нашей стороны, и удерживаемое место освобождено.`,
    again: 'Приносим извинения. Если занятие вам всё ещё интересно, можно записаться снова или просто ответить на это письмо.',
    button: 'Страница занятия'
  }
};

function receivedMessage(reg, account) {
  const l = lang(((account || {}).profile || {}).preferredLanguage);
  const T = RECEIVED[l];
  const child = childOf(reg), act = titleOf(reg, l);
  const html = shell(l, T.heading,
    [esc(T.body(child, act)), esc(T.wait(reg.expiryDays))],
    { href: activityHref(reg, l), label: T.button });
  return { to: account.email, subject: T.subject(child, act), html: html, text: strip(html) };
}

function approvedMessage(reg, account) {
  const l = lang(((account || {}).profile || {}).preferredLanguage);
  const T = APPROVED[l];
  const child = childOf(reg), act = titleOf(reg, l);
  const html = shell(l, T.heading,
    [esc(T.body(child, act)), esc(T.next)],
    { href: activityHref(reg, l), label: T.button });
  return { to: account.email, subject: T.subject(child, act), html: html, text: strip(html) };
}

function rejectedMessage(reg, account) {
  const l = lang(((account || {}).profile || {}).preferredLanguage);
  const T = REJECTED[l];
  const child = childOf(reg), act = titleOf(reg, l);
  const html = shell(l, T.heading,
    [esc(T.body(child, act)), esc(T.talk)],
    { href: pathFor(l, '/activities'), label: T.button });
  return { to: account.email, subject: T.subject(child, act), html: html, text: strip(html) };
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
    button: 'לעמוד ההרשמה'
  },
  en: {
    subject: (act) => `Payment received · ${act}`,
    heading: 'Payment received',
    body: (child, act, amount) => `We have received ${amount} for ${child} in ${act}. Thank you.`,
    settled: 'This registration is now paid in full.',
    remaining: (amount) => `Still to pay: ${amount}.`,
    button: 'Go to the registration'
  },
  ru: {
    subject: (act) => `Платёж получен · ${act}`,
    heading: 'Платёж получен',
    body: (child, act, amount) => `Мы получили ${amount} за ${child} — ${act}. Спасибо.`,
    settled: 'Оплата внесена полностью.',
    remaining: (amount) => `Осталось оплатить: ${amount}.`,
    button: 'Страница записи'
  }
};

// The same shape as js/member-account.js's money(), deliberately.
const money = (cents) => '\u20AC' + (Math.round(Number(cents) || 0) / 100).toFixed(2);

function paidMessage(reg, account, paidCents, outstandingCents) {
  const l = lang(((account || {}).profile || {}).preferredLanguage);
  const T = PAID[l];
  const child = childOf(reg), act = titleOf(reg, l);
  const tail = outstandingCents > 0 ? T.remaining(money(outstandingCents)) : T.settled;
  const html = shell(l, T.heading,
    [esc(T.body(child, act, money(paidCents))), esc(tail)],
    { href: registrationHref(reg, l), label: T.button });
  return { to: account.email, subject: T.subject(act), html: html, text: strip(html) };
}

const langOf = (account) => lang(((account || {}).profile || {}).preferredLanguage);

const sendReceived = (reg, account) =>
  email.settle('registration-received', account.email, () =>
    email.send(receivedMessage(reg, account),
      { template: 'registration-received', lang: langOf(account) }));

const sendApproved = (reg, account) =>
  email.settle('registration-approved', account.email, () =>
    email.send(approvedMessage(reg, account),
      { template: 'registration-approved', lang: langOf(account) }));

const sendRejected = (reg, account) =>
  email.settle('registration-rejected', account.email, () =>
    email.send(rejectedMessage(reg, account),
      { template: 'registration-rejected', lang: langOf(account) }));

const sendExpired = (reg, account) =>
  email.settle('registration-expired', account.email, () =>
    email.send(expiredMessage(reg, account),
      { template: 'registration-expired', lang: langOf(account) }));

const sendPaid = (reg, account, paidCents, outstandingCents) =>
  email.settle('registration-paid', account.email, () =>
    email.send(paidMessage(reg, account, paidCents, outstandingCents),
      { template: 'registration-paid', lang: langOf(account) }));

module.exports = {
  sendReceived, sendApproved, sendRejected, sendExpired,
  receivedMessage, approvedMessage, rejectedMessage, expiredMessage,
  RECEIVED, APPROVED, REJECTED, EXPIRED,
  paidMessage, sendPaid
};
