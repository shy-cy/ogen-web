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
const { pick, dayAndMonth } = require('./_activity-facts');
const terms = require('./_cancellation-terms');

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
//
// `hash` is '#pay' for every message that is partly about money, and is passed
// as '' by the one that is not: a group change is about when and where the
// class meets, and scrolling that message's reader past the facts to the cost
// card would answer a question they did not ask.
const registrationHref = (reg, l, hash) =>
  pathFor(l, '/account/activity') +
  '?p=' + encodeURIComponent(reg.participantId || '') +
  '&a=' + encodeURIComponent(reg.activityId || '') +
  (hash === undefined ? '#pay' : hash);

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
// ⚠ AND IT STILL DOES NOT PROMISE A LINK. It used to say "we will send you a
// payment link shortly", which was the shape of our queue again rather than of
// the family: on a manually-approved activity that link exists only once an
// admin gets to it, and "shortly" was a guess. It says what is actually
// happening instead — we are finishing the details, payment opens on the page,
// we will write — matching `waitBody` on the card word for word in intent, so
// the inbox and the screen say one thing. An activity that auto-approves sends
// APPROVED instead and the payment is live the moment they open the page.
// --- we have your request --------------------------------------------------

const RECEIVED = {
  he: {
    subject: (child, act) => `${child} נרשם/ה ל${act}`,
    heading: 'ההרשמה בוצעה',
    body: (child, act) => `${child} נרשם/ה ל${act}.`,
    next: 'נשלים כמה פרטים אחרונים, והתשלום ייפתח בעמוד ההרשמה. נעדכן אתכם במייל.',
    button: 'לעמוד ההרשמה'
  },
  en: {
    subject: (child, act) => `${child} is registered for ${act}`,
    heading: 'Registered',
    body: (child, act) => `${child} is registered for ${act}.`,
    next: 'We are confirming the last few details, and payment will open on your registration page. We will email you.',
    button: 'Go to the registration'
  },
  ru: {
    subject: (child, act) => `${child} записан(а) на ${act}`,
    heading: 'Запись оформлена',
    body: (child, act) => `${child} записан(а) на ${act}.`,
    next: 'Мы уточняем последние детали, оплата откроется на странице записи. Мы напишем вам.',
    button: 'Страница записи'
  }
};

// --- the waiting list ------------------------------------------------------
//
// TWO MESSAGES, AND THE SECOND ONE IS A RACE, WHICH IT HAS TO SAY OUT LOUD.
//
// When a place frees, everyone waiting is told at once and the first to come
// back takes it. That is the behaviour that was asked for, and it is fair — but
// only if the message says so. "A place is yours" followed by nothing is a
// promise broken; "a place has opened and the first person to take it gets it"
// is a fair thing to receive and lose. Most people on a list lose, every time,
// so the wording is the whole difference between disappointment and betrayal.
//
// `when` is the evening, on a drop-in, and null on a course. One pair of
// messages rather than four: what a family is waiting for differs by a date, not
// by a paragraph.
const WAITING = {
  he: {
    subject: (child, act) => `${child} ברשימת ההמתנה ל${act}`,
    heading: 'ברשימת ההמתנה',
    body: (child, act, when) => when
      ? `${child} ברשימת ההמתנה למפגש בתאריך ${when} ב${act}.`
      : `${child} ברשימת ההמתנה ל${act}.`,
    next: 'אין מקום פנוי כרגע. ברגע שיתפנה מקום נשלח מייל לכל הממתינים, והמקום יינתן למי שיירשם ראשון. לא בוצע חיוב.',
    button: 'לעמוד הפעילות'
  },
  en: {
    subject: (child, act) => `${child} is on the waiting list for ${act}`,
    heading: 'On the waiting list',
    body: (child, act, when) => when
      ? `${child} is on the waiting list for the session on ${when} of ${act}.`
      : `${child} is on the waiting list for ${act}.`,
    next: 'There is no place free at the moment. As soon as one opens we email everybody waiting, and it goes to the first person to take it. Nothing has been charged.',
    button: 'Go to the activity'
  },
  ru: {
    subject: (child, act) => `${child} в списке ожидания на ${act}`,
    heading: 'В списке ожидания',
    body: (child, act, when) => when
      ? `${child} в списке ожидания на занятие ${when} — ${act}.`
      : `${child} в списке ожидания на ${act}.`,
    next: 'Свободных мест сейчас нет. Как только место освободится, мы напишем всем, кто ждёт, и оно достанется тому, кто запишется первым. Оплата не списана.',
    button: 'Страница занятия'
  }
};

const PLACE_OPEN = {
  he: {
    subject: (child, act) => `התפנה מקום ב${act}`,
    heading: 'התפנה מקום',
    body: (child, act, when) => when
      ? `התפנה מקום במפגש בתאריך ${when} ב${act}, ו${child} ברשימת ההמתנה.`
      : `התפנה מקום ב${act}, ו${child} ברשימת ההמתנה.`,
    // ⚠ THE RACE, NAMED. Everybody waiting gets this at the same moment.
    next: 'המייל הזה נשלח לכל מי שברשימת ההמתנה, והמקום יינתן למי שיירשם ראשון. כדי לשמור את המקום צריך להשלים את התשלום — אחרת המקום חוזר לרשימה.',
    button: 'תפוס/י מקום'
  },
  en: {
    subject: (child, act) => `A place has opened on ${act}`,
    heading: 'A place has opened',
    body: (child, act, when) => when
      ? `A place has opened on the session on ${when} of ${act}, and ${child} is on the waiting list.`
      : `A place has opened on ${act}, and ${child} is on the waiting list.`,
    next: 'Everybody on the waiting list has been sent this, and the place goes to the first person to take it. Paying is what secures it \u2014 an unpaid place goes back to the list.',
    button: 'Take the place'
  },
  ru: {
    subject: (child, act) => `Освободилось место на ${act}`,
    heading: 'Освободилось место',
    body: (child, act, when) => when
      ? `Освободилось место на занятии ${when} — ${act}, а ${child} в списке ожидания.`
      : `Освободилось место на ${act}, а ${child} в списке ожидания.`,
    next: 'Это письмо получили все, кто в списке ожидания, и место достанется тому, кто запишется первым. Место закрепляется оплатой \u2014 неоплаченное место возвращается в список.',
    button: 'Занять место'
  }
};

// ⚠ `when` IS AN ISO DATE AND IS FORMATTED HERE, not by the caller. A caller
// formatting it would be formatting it in ITS language — and the one caller
// that matters is a request handler, whose language is the language of the PAGE
// somebody is looking at, where an email's is the language of the ACCOUNT it
// is going to. Those differ exactly when a family has a preference and is
// reading a different tree, and the result would be a Russian message naming a
// date in Hebrew. A test greps for this and caught it.
function waitingMessage(reg, account, when) {
  const l = lang(((account || {}).profile || {}).preferredLanguage);
  const T = WAITING[l];
  const child = childOf(reg), act = titleOf(reg, l);
  when = when ? dayAndMonth(when, l) || when : null;
  const html = shell(l, T.heading,
    [esc(T.body(child, act, when || null)), esc(T.next)],
    { href: registrationHref(reg, l), label: T.button });
  return { to: account.email, subject: T.subject(child, act), html: html, text: strip(html) };
}

// ⚠ IT POINTS AT THE REGISTRATION PAGE, not the public activity page, because
// that is where the button that takes the place is. The waiting-list
// acknowledgement above points at the public page instead: nothing can be done
// there yet, and a link to a page offering no action reads as a broken button.
//
// ⚠ AND FOR A RELEASE IT DID NOT. This comment said `registrationHref` and the
// code said `activityHref` — so the one message whose whole job is "come and
// take this place" sent a family to the PUBLIC page, which cannot know who is
// reading it and offers a Register button that starts the flow again. Twice
// wrong, because activityHref() resolves through `activitySlugAtSubmission`,
// which this project says everywhere is AUDIT ONLY: after a rename it opens the
// wrong page or none.
//
// The claim button it was describing did not exist either, which is why nothing
// caught the mismatch — the comment was right about where the button belongs and
// there was no button anywhere. Both halves are built now.
function placeOpenMessage(reg, account, when) {
  const l = lang(((account || {}).profile || {}).preferredLanguage);
  const T = PLACE_OPEN[l];
  const child = childOf(reg), act = titleOf(reg, l);
  when = when ? dayAndMonth(when, l) || when : null;
  const html = shell(l, T.heading,
    [esc(T.body(child, act, when || null)), esc(T.next)],
    { href: registrationHref(reg, l), label: T.button });
  return { to: account.email, subject: T.subject(child, act), html: html, text: strip(html) };
}

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
    payButton: 'לתשלום',
    credit: (amount, href) => `בחשבון שלכם יש זיכוי של ${amount}. כפתור התשלום כאן גובה את מלוא הסכום — כדי לנצל קודם את הזיכוי, <a href="${href}">היכנסו לעמוד ההרשמה</a>.`
  },
  en: {
    subject: (child, act) => `${child}'s place in ${act} is confirmed`,
    heading: 'The registration is confirmed',
    body: (child, act) => `${child} has a place in ${act}. We look forward to seeing you.`,
    next: 'The session dates and the payment are on your registration page. If anything does not fit, write to us.',
    button: 'Pay and see the details',
    pay: 'You can pay here, without signing in. The session dates are on your registration page.',
    payButton: 'Pay now',
    credit: (amount, href) => `Your account is holding ${amount} in credit. The button here charges the full amount — to put the credit towards it first, <a href="${href}">open your registration page</a>.`
  },
  ru: {
    subject: (child, act) => `Запись ${child} подтверждена · ${act}`,
    heading: 'Запись подтверждена',
    body: (child, act) => `${child} записан(а) на ${act}. Будем рады видеть вас.`,
    next: 'Даты занятий и оплата — на странице записи. Если что-то не подходит, напишите нам.',
    button: 'Оплата и подробности',
    pay: 'Оплатить можно здесь, без входа в учётную запись. Даты занятий — на странице записи.',
    payButton: 'Оплатить',
    credit: (amount, href) => `На вашем счету есть зачёт ${amount}. Кнопка здесь спишет всю сумму — чтобы сначала использовать зачёт, <a href="${href}">откройте страницу записи</a>.`
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

// --- the group has changed --------------------------------------------------
//
// ⚠ A MOVE BETWEEN GROUPS IS NEWS, AND IT USED TO BE SILENT.
//
// `moveGroup` was built so that correcting a child's group would not have to go
// through cancel-and-re-register — which writes a credit, sends a cancellation
// email and re-freezes the price at today's figure, all to fix a dropdown. It
// saved the record, wrote the history and told nobody, and that gap is exactly
// the shape a cancellation had before it got a message: every other change to a
// registration writes to the family, and the one that changes which room a
// child walks into on Tuesday did not.
//
// It is the only thing about a registration an admin can change that alters
// what the family has to DO. The groups under the equal-hours rule can meet on
// different days, at a different hour, in a different place, with a different
// teacher — so the message says that out loud and points at the page carrying
// the new group's own facts, rather than restating them here where they would
// be a second copy able to drift.
//
// It says nothing about a decision and nothing about our queue: a move is a
// fact, so there is no draft to review the way a rejection and a cancellation
// have one. What there IS to say about money is that there is nothing to say —
// one `fullPrice` buys the same teaching whichever group a family is in, and a
// family told their child has changed class will ask.

const MOVED = {
  he: {
    subject: (child, act, to) => `${child} עבר/ה לקבוצת ${to} · ${act}`,
    heading: 'שינוי קבוצה',
    body: (child, act, from, to) => from
      ? `${child} הועבר/ה מקבוצת ${from} לקבוצת ${to} ב${act}.`
      : `${child} שובץ/ה לקבוצת ${to} ב${act}.`,
    next: 'הימים, השעות, המקום והמורים יכולים להיות שונים בין הקבוצות. הפרטים של הקבוצה החדשה מופיעים בעמוד ההרשמה.',
    money: 'המחיר לא השתנה ולא בוצע חיוב נוסף.',
    talk: 'אם זה נעשה בטעות, השיבו להודעה הזו ונתקן.',
    button: 'לפרטי ההרשמה'
  },
  en: {
    subject: (child, act, to) => `${child} has moved to ${to} · ${act}`,
    heading: 'The group has changed',
    body: (child, act, from, to) => from
      ? `${child} has moved from ${from} to ${to} in ${act}.`
      : `${child} has been placed in ${to} in ${act}.`,
    next: 'Groups can meet on different days, at a different hour, in a different place and with different teachers. The new group\u2019s details are on the registration page.',
    money: 'The price has not changed and nothing further has been charged.',
    talk: 'If this was a mistake, reply to this message and we will put it right.',
    button: 'Open the registration'
  },
  ru: {
    subject: (child, act, to) => `${child} переведён(а) в группу ${to} · ${act}`,
    heading: 'Группа изменена',
    body: (child, act, from, to) => from
      ? `${child} переведён(а) из группы ${from} в группу ${to} — ${act}.`
      : `${child} зачислен(а) в группу ${to} — ${act}.`,
    next: 'Дни, время, место и преподаватели у групп могут отличаться. Данные новой группы есть на странице записи.',
    money: 'Стоимость не изменилась, дополнительных списаний нет.',
    talk: 'Если это произошло по ошибке, ответьте на это письмо — мы исправим.',
    button: 'Открыть запись'
  }
};

// ⚠ THE GROUP NAMES ARRIVE AS {he,en,ru} BAGS AND ARE PICKED HERE, for the same
// reason `when` is an ISO date above: the caller is a request handler, whose
// language is the language of the SCREEN an admin is looking at, and an email's
// is the language of the ACCOUNT it is going to. A handler that picked would
// send a Russian family a Hebrew message naming an English group name.
//
// `from` is null on a registration taken while the activity was still pooled —
// there is no group it came out of, so the sentence says where it landed
// instead of naming a group nobody was ever in.
function movedMessage(reg, account, fromName, toName) {
  const l = lang(((account || {}).profile || {}).preferredLanguage);
  const T = MOVED[l];
  const child = childOf(reg), act = titleOf(reg, l);
  const from = pick(fromName, l) || '';
  const to = pick(toName, l) || '';
  const html = shell(l, T.heading,
    [esc(T.body(child, act, from || null, to)), esc(T.next), esc(T.money), esc(T.talk)],
    { href: registrationHref(reg, l, ''), label: T.button });
  return { to: account.email, subject: T.subject(child, act, to), html: html, text: strip(html) };
}

// --- the terms moved under a registration that already existed -------------
//
// ⚠ THE ONE MESSAGE ABOUT SOMETHING A FAMILY ALREADY AGREED TO.
//
// Every other message here reports something the family did, or something we
// decided about it. This one reports that WE changed the deal — the cancellation
// cutoff, or the date the registration fee stops coming back — on a registration
// that was taken under the old dates. It exists because that change was asked to
// apply to the people already registered rather than only to new ones; see
// _registration-fallout.js for the rule and for what it costs.
//
// ⚠ IT DOES NOT CLAIM THE CHANGE IS AN IMPROVEMENT. A cutoff can move either
// way, and a message that says "you now have longer" would be false half the
// time, in the half where a family has lost something. So it says the dates may
// be earlier or later and puts them in front of the reader — the terms block
// under the button is built from the registration's UPDATED frozen block, which
// is the same block the family's own page now reads.
//
// No draft to review, for the same reason a group move has none: the two dates
// are the whole of it, and there is nothing an admin could usefully reword.

const TERMS_CHANGED = {
  he: {
    subject: (child, act) => `עדכון בתנאי הביטול · ${act}`,
    heading: 'תנאי הביטול התעדכנו',
    body: (child, act) => `עדכנו את תנאי הביטול של ${act}, והתנאים החדשים חלים מעכשיו גם על ההרשמה של ${child}.`,
    next: 'התנאים המעודכנים מופיעים למטה וגם בעמוד ההרשמה. כדאי לקרוא אותם — התאריכים יכולים להיות מוקדמים או מאוחרים מאלה שהיו.',
    money: 'המחיר לא השתנה ולא בוצע חיוב נוסף.',
    talk: 'אם השינוי משנה משהו עבורכם, השיבו להודעה הזו ונדבר.',
    button: 'לפרטי ההרשמה'
  },
  en: {
    subject: (child, act) => `Updated cancellation terms · ${act}`,
    heading: 'The cancellation terms have changed',
    body: (child, act) => `We have updated the cancellation terms for ${act}, and the new terms now apply to ${child}'s registration as well.`,
    next: 'The updated terms are below and on the registration page. They are worth reading — the dates may be earlier or later than the ones you had.',
    money: 'The price has not changed and nothing further has been charged.',
    talk: 'If this changes anything for you, reply to this message and we will talk it through.',
    button: 'Open the registration'
  },
  ru: {
    subject: (child, act) => `Изменение условий отмены · ${act}`,
    heading: 'Условия отмены изменились',
    body: (child, act) => `Мы обновили условия отмены для ${act}, и новые условия теперь действуют и для записи ${child}.`,
    next: 'Обновлённые условия приведены ниже и на странице записи. Их стоит прочитать — даты могут оказаться как более ранними, так и более поздними, чем прежде.',
    money: 'Стоимость не изменилась, дополнительных списаний нет.',
    talk: 'Если это что-то меняет для вас, ответьте на это письмо — обсудим.',
    button: 'Открыть запись'
  }
};

function termsChangedMessage(reg, account, sessionCancelHours) {
  const l = lang(((account || {}).profile || {}).preferredLanguage);
  const T = TERMS_CHANGED[l];
  const child = childOf(reg), act = titleOf(reg, l);
  // NO `#pay`. Every other message about a live registration is partly about
  // money and scrolls to the cost card; this one is about the rules, and the
  // terms footnote is under it — the same argument the group move makes.
  const html = shell(l, T.heading,
    [esc(T.body(child, act)), esc(T.next), esc(T.money), esc(T.talk)],
    { href: registrationHref(reg, l, ''), label: T.button },
    termsBlock(reg, l, sessionCancelHours));
  return { to: account.email, subject: T.subject(child, act), html: html, text: strip(html) };
}

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

// ⚠ THE CANCELLATION TERMS TRAVEL WITH THE MESSAGE THAT CREATES THE COMMITMENT.
//
// A family read "you are registered" and had no way to find out until when they
// could change their mind, or what changing it would be worth. The screen they
// registered from says it now — and a screen is read once, at the moment of
// deciding, by whoever was holding the laptop. The email is the copy the
// household keeps, so it is the one that has to carry the deadline.
//
// The words come from _cancellation-terms.js, which is also what the family
// area renders, so the inbox and the screen cannot come to describe two
// different policies — the same reason there is one shell and one send path.
//
// It is SMALL and it is LAST, under the button. This is reference material a
// family comes back to, not the news the message is delivering, and set at body
// size above the call to action it would read as a warning about the thing they
// have just done.
//
// `sessionCancelHours` is a parameter for exactly the reason `payUrl` and
// `creditCents` are: a drop-in's per-evening window lives on the activity and is
// frozen onto each evening when it is booked, never onto the registration, and
// opening an activity here would stop this table being runnable in three
// languages with no infrastructure at all.
function termsBlock(reg, l, sessionCancelHours) {
  const lines = terms.termsFor({
    type: ((reg && reg.frozen) || {}).type || 'course',
    cancellation: ((reg && reg.frozen) || {}).cancellation,
    sessionCancelHours: sessionCancelHours,
    hasFee: ((reg.frozen || {}).price || {}).feeCharged !== false &&
            Number(((reg.frozen || {}).price || {}).registrationFee) > 0
  }, l);
  if (!lines.length) return '';
  return '<span style="font-size:13px;color:#6B705C;">' +
    '<b>' + esc(terms.titleFor(l)) + '</b><br>' +
    lines.map(esc).join('<br>') + '</span>';
}

function receivedMessage(reg, account, sessionCancelHours) {
  const l = lang(((account || {}).profile || {}).preferredLanguage);
  const T = RECEIVED[l];
  const child = childOf(reg), act = titleOf(reg, l);
  const html = shell(l, T.heading,
    [esc(T.body(child, act)), esc(T.next)],
    { href: registrationHref(reg, l), label: T.button },
    termsBlock(reg, l, sessionCancelHours));
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
// ⚠ AND A BALANCE THE FAMILY IS HOLDING HAS TO BE NAMED HERE.
//
// The emailed pay button opens Checkout for the whole amount with no sign-in,
// which is the whole point of it — and a family holding credit followed that
// link and was never offered the chance to spend it. Reported as: "I like the
// direct link, but in this case, when I can use the credit and click on the
// direct link, I don't get the chance to use it."
//
// The link is NOT withheld and the credit is NOT spent for them. Both would be
// wrong: the link exists for the household that wants to pay in one press, and
// credit is the family's to put where they choose — spending it unasked is the
// same mistake as an admin doing it for them, which is the gap _spend-credit.js
// was written to close. So the message says the balance is there and where to
// go, and the button stays exactly where it was.
//
// `creditCents` is a parameter for the same reason `payUrl` is: this builder
// opens no store, so the whole table stays runnable in three languages with no
// infrastructure.
function approvedMessage(reg, account, payUrl, creditCents, sessionCancelHours) {
  const l = lang(((account || {}).profile || {}).preferredLanguage);
  const T = APPROVED[l];
  const child = childOf(reg), act = titleOf(reg, l);
  const lines = [esc(T.body(child, act)), esc(payUrl ? T.pay : T.next)];
  if (payUrl && creditCents > 0) {
    lines.push(T.credit(money(creditCents), esc(registrationHref(reg, l))));
  }
  const html = shell(l, T.heading, lines,
    payUrl ? { href: payUrl, label: T.payButton }
           : { href: registrationHref(reg, l), label: T.button },
    termsBlock(reg, l, sessionCancelHours));
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

// `sessionCancelHours` rides in from the caller for the reason termsBlock()
// gives: a drop-in's per-evening window lives on the activity, and a message
// builder that opened one would stop being runnable with no infrastructure. A
// course sends nothing and needs to: its terms are frozen on the record.
const sendReceived = (reg, account, sessionCancelHours) =>
  email.settle('registration-received', account.email, () =>
    email.send(receivedMessage(reg, account, sessionCancelHours),
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

// The balance is read by the SENDER, like the pay link and for the same reason:
// the builder opens no store. Best effort in the same way too — a ledger that
// will not answer costs this message one sentence rather than costing the
// family the message.
async function creditFor(account) {
  try { return await require('./_credit-ledger').balanceFor(account.accountId); }
  catch (err) {
    console.warn('[registration-email] balance not read: ' + (err && err.message));
    return 0;
  }
}

const sendApproved = (reg, account, sessionCancelHours) =>
  email.settle('registration-approved', account.email, async () =>
    email.send(approvedMessage(reg, account, await payUrlFor(reg, account),
                               await creditFor(account), sessionCancelHours),
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

const sendWaiting = (reg, account, when) =>
  email.settle('registration-waiting', account.email, () =>
    email.send(waitingMessage(reg, account, when),
      { template: 'registration-waiting', lang: langOf(account) }));

const sendPlaceOpen = (reg, account, when) =>
  email.settle('registration-place-open', account.email, () =>
    email.send(placeOpenMessage(reg, account, when),
      { template: 'registration-place-open', lang: langOf(account) }));

// NO DRAFT, unlike the rejection and the cancellation. Those two are reviewed
// because approval carries no reason code and money is about to move, so an
// admin has something to word. A move has nothing to word: the two group names
// are the whole of it, and a panel asking somebody to approve a sentence they
// cannot usefully change is a step that teaches them to press through.
const sendMoved = (reg, account, fromName, toName) =>
  email.settle('registration-moved', account.email, () =>
    email.send(movedMessage(reg, account, fromName, toName),
      { template: 'registration-moved', lang: langOf(account) }));

const sendTermsChanged = (reg, account, sessionCancelHours) =>
  email.settle('registration-terms-changed', account.email, () =>
    email.send(termsChangedMessage(reg, account, sessionCancelHours),
      { template: 'registration-terms-changed', lang: langOf(account) }));

const sendPaid = (reg, account, paidCents, outstandingCents) =>
  email.settle('registration-paid', account.email, async () =>
    email.send(paidMessage(reg, account, paidCents, outstandingCents,
                           outstandingCents > 0 ? await payUrlFor(reg, account) : null),
      { template: 'registration-paid', lang: langOf(account) }));

module.exports = {
  payUrlFor,
  sendReceived, sendApproved, sendRejected, sendExpired, sendCancelled,
  sendWaiting, sendPlaceOpen, sendMoved, sendTermsChanged,
  receivedMessage, approvedMessage, rejectedMessage, expiredMessage, rejectedDraft,
  cancelledMessage, cancelledDraft, waitingMessage, placeOpenMessage,
  movedMessage, termsChangedMessage,
  RECEIVED, APPROVED, REJECTED, EXPIRED, CANCELLED, WAITING, PLACE_OPEN, MOVED, TERMS_CHANGED,
  paidMessage, sendPaid
};
