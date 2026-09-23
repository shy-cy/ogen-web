// Every refusal a family can be shown, in the three languages they read.
//
// PURE. No store, no clock, no network — a table and two functions. It holds
// nobody's data, so it does not arm the legal gate.
//
// ⚠ WHY THIS EXISTS. A family on the Hebrew page typed an address that already
// had an account and was answered, in a Hebrew form, under a Hebrew heading:
// "An account with that email already exists". Every refusal in the family area
// was like that. The screens were translated from the beginning — eighteen
// shells and one {he,en,ru} table in js/member-account.js — and then the moment
// anything went wrong the page switched to English, which is the moment a
// person most needs to be able to read it. A Russian-speaking parent who cannot
// tell "that password is too short" from "we could not reach the server" will
// try the same thing again, or give up.
//
// THE WORDS ARE ON THE SERVER, not in the client's string table, and that is
// the one real design choice here:
//
//   - The refusal is authored beside the condition that produces it. A code
//     travelling to a client that holds the words means two files to edit and
//     a code with no key rendering as nothing.
//   - Several of them carry a number or a date — how many guardians, when
//     cancellation closed, how many characters a password needs. Interpolating
//     in the client means shipping the parameters too and reassembling a
//     sentence in three grammars.
//   - The server already knows: js/member-session.js sends `lang` from
//     document.documentElement.lang on EVERY request, which was built for
//     exactly this class of problem — the group names, the facts card and the
//     price rows were rendering in the language on the ACCOUNT rather than the
//     language on the SCREEN. An error message is a display string like any
//     other, and it answers to the same rule.
//
// `code` travels beside the sentence anyway, so a client can branch on the
// reason without matching prose. Two clients already do, on `reason` and
// `full`; those fields are untouched.
//
// ⚠ AND THE PURE MODULES RETURN CODES, NOT SENTENCES. submissionErrors() in
// _registration.js and validate() in _session-attendance.js used to return
// English prose. A rule module is handed an activity and asked what is wrong
// with it; it has no reader and therefore no language, so the prose was English
// only because whoever wrote it was. They return keys into this table now, and
// the handler — which does know who is reading — renders them.
//
// ⚠ WHAT IS DELIBERATELY NOT HERE. 'Use POST', 'Body must be JSON' and
// 'Unknown action "x"' stay in English. Nobody using the site can reach them:
// they mean the client is broken or somebody is calling the API by hand, and
// translating a message for a reader who does not exist would put three
// languages of maintenance behind a screen nobody sees.

const LANGS = ['he', 'en', 'ru'];

// The language to answer in. The page's, then the account's, then Hebrew —
// which is the site's own default and the language of the tree at `/`.
//
// The page's first, for the reason the display strings resolve that way: a
// preference is about a message arriving later and out of context, and this is
// a sentence appearing under a form somebody is looking at right now.
function readerLang(body, account) {
  const asked = (body || {}).lang;
  if (LANGS.indexOf(asked) !== -1) return asked;
  const pref = ((account || {}).profile || {}).preferredLanguage;
  return LANGS.indexOf(pref) !== -1 ? pref : 'he';
}

// A message is three strings, or three functions of the same parameters when it
// has a number or a date in it.
const MESSAGES = {

  // --- the ones every action can give --------------------------------------
  'not-signed-in': {
    he: 'צריך להיכנס לחשבון כדי לעשות את זה.',
    en: 'You need to be signed in to do that.',
    ru: 'Чтобы сделать это, нужно войти в учётную запись.'
  },
  'server-error': {
    he: 'משהו השתבש. נסו שוב.',
    en: 'Something went wrong. Please try again.',
    ru: 'Что-то пошло не так. Попробуйте ещё раз.'
  },
  // Deliberately the same answer for "there is no such record" and "that record
  // is not yours". Telling them apart would let anybody holding an id find out
  // whether a participant exists.
  'no-such-participant': {
    he: 'לא מצאנו משתתף/ת כזה/כזו.',
    en: 'No such participant.',
    ru: 'Такой участник не найден.'
  },
  'no-such-activity': {
    he: 'לא מצאנו את הפעילות הזו.',
    en: 'No such activity.',
    ru: 'Такое занятие не найдено.'
  },
  'no-such-registration': {
    he: 'לא מצאנו את ההרשמה הזו.',
    en: 'No such registration.',
    ru: 'Такая запись не найдена.'
  },
  'no-such-booking': {
    he: 'לא מצאנו את ההזמנה הזו.',
    en: 'No such booking.',
    ru: 'Такое бронирование не найдено.'
  },

  // --- opening an account, and getting back into one ------------------------
  'email-taken': {
    he: 'כבר קיים חשבון עם כתובת הדוא״ל הזו.',
    en: 'An account with that email already exists.',
    ru: 'Учётная запись с этим адресом уже существует.'
  },
  'email-invalid': {
    he: 'צריך כתובת דוא״ל תקינה.',
    en: 'A valid email address is required.',
    ru: 'Нужен действительный адрес эл. почты.'
  },
  'password-short': {
    he: (p) => `הסיסמה צריכה להיות באורך ${p.min} תווים לפחות.`,
    en: (p) => `Password must be at least ${p.min} characters.`,
    ru: (p) => `Пароль должен содержать не менее ${p.min} символов.`
  },
  'terms-required': {
    he: 'צריך לאשר את תנאי השימוש ואת מדיניות הפרטיות.',
    en: 'The terms and the privacy policy have to be accepted.',
    ru: 'Нужно принять условия использования и политику конфиденциальности.'
  },
  // ⚠ ONE SENTENCE FOR EVERY WAY SIGNING IN CAN FAIL, in three languages now
  // rather than one. The point of it is unchanged: a wrong password and an
  // address nobody has used must be indistinguishable, or an attacker learns
  // that a person has children attending.
  'signin-failed': {
    he: 'כתובת הדוא״ל והסיסמה האלה לא מתאימות לאף חשבון.',
    en: 'That email address and password do not match an account.',
    ru: 'Этот адрес и пароль не подходят ни к одной учётной записи.'
  },
  'no-such-account': {
    he: 'לא מצאנו את החשבון הזה.',
    en: 'No such account.',
    ru: 'Такая учётная запись не найдена.'
  },
  'wrong-current-password': {
    he: 'זו לא הסיסמה הנוכחית שלכם.',
    en: 'That is not your current password.',
    ru: 'Это не ваш текущий пароль.'
  },
  'reset-link-dead': {
    he: 'הקישור לאיפוס הסיסמה פג או שכבר נעשה בו שימוש. בקשו קישור חדש.',
    en: 'That reset link has expired or has already been used. Ask for a new one.',
    ru: 'Ссылка для сброса пароля истекла или уже была использована. Запросите новую.'
  },
  // ⚠ "TRY AGAIN" IS NOW THE RIGHT ADVICE, and it was not before. This message
  // used to end "ask for a new reset link", because the token was spent before
  // the password was looked at — so a typo under the minimum killed the link and
  // the sentence had to send somebody back to their inbox. account-auth.js checks
  // the length first now, so the link is still good and the only thing needed is
  // a longer password. The two must move together: leave this wording behind and
  // it sends a family to request a mail they do not need.
  'reset-password-short': {
    he: (p) => `הסיסמה צריכה להיות באורך ${p.min} תווים לפחות. הקישור עדיין תקף — בחרו סיסמה ארוכה יותר ונסו שוב.`,
    en: (p) => `Password must be at least ${p.min} characters. This link still works — choose a longer password and try again.`,
    ru: (p) => `Пароль должен содержать не менее ${p.min} символов. Ссылка ещё действует — выберите более длинный пароль и попробуйте ещё раз.`
  },
  'verify-link-dead': {
    he: 'הקישור הזה פג או שכבר נעשה בו שימוש.',
    en: 'That link has expired or has already been used.',
    ru: 'Эта ссылка истекла или уже была использована.'
  },
  'email-unverified': {
    he: 'צריך לאשר את כתובת הדוא״ל לפני התשלום.',
    en: 'Please confirm your email address before paying.',
    ru: 'Подтвердите адрес эл. почты перед оплатой.'
  },

  // --- the people on an account ---------------------------------------------
  'first-name-required': {
    he: 'צריך שם פרטי.',
    en: 'A first name is required.',
    ru: 'Нужно указать имя.'
  },
  'dob-required': {
    he: 'צריך תאריך לידה בפורמט YYYY-MM-DD, והוא לא יכול להיות בעתיד.',
    en: 'A date of birth is required, as YYYY-MM-DD, and it cannot be in the future.',
    ru: 'Нужна дата рождения в формате YYYY-MM-DD, и она не может быть в будущем.'
  },
  'participant-needs-account': {
    he: 'משתתף/ת צריך/ה להיות משויך/ת לחשבון.',
    en: 'A participant needs an account to belong to.',
    ru: 'Участник должен быть привязан к учётной записи.'
  },
  'participant-not-created': {
    he: 'לא הצלחנו ליצור את הרשומה. נסו שוב.',
    en: 'Could not create that record. Please try again.',
    ru: 'Не удалось создать запись. Попробуйте ещё раз.'
  },

  // --- the second guardian ---------------------------------------------------
  'invite-not-primary': {
    he: 'רק האפוטרופוס/ה שיצר/ה את הרשומה יכול/ה להזמין מישהו נוסף.',
    en: 'Only the guardian who created this record can invite someone else.',
    ru: 'Приглашать может только тот опекун, который создал эту запись.'
  },
  'invites-not-primary': {
    he: 'רק האפוטרופוס/ה שיצר/ה את הרשומה יכול/ה לנהל הזמנות.',
    en: 'Only the guardian who created this record can manage invitations.',
    ru: 'Управлять приглашениями может только тот опекун, который создал эту запись.'
  },
  'invite-own-address': {
    he: 'זו הכתובת שלכם - אתם כבר אפוטרופוס/ית כאן.',
    en: 'That is your own address — you are already a guardian here.',
    ru: 'Это ваш собственный адрес — вы уже являетесь опекуном здесь.'
  },
  'max-guardians': {
    he: (p) => `לרשומה הזו כבר יש ${p.max} אפוטרופוסים.`,
    en: (p) => `This record already has ${p.max} guardians.`,
    ru: (p) => `У этой записи уже ${p.max} опекуна.`
  },
  'already-guardian': {
    he: 'האדם הזה כבר אפוטרופוס/ית כאן.',
    en: 'That person is already a guardian here.',
    ru: 'Этот человек уже является опекуном здесь.'
  },
  'invite-already-waiting': {
    he: 'כבר ממתינה הזמנה בכתובת הזו. שלחו אותה שוב או בטלו אותה קודם.',
    en: 'An invitation is already waiting at that address. Resend or withdraw it first.',
    ru: 'По этому адресу уже ожидает приглашение. Отправьте его заново или отзовите.'
  },
  'no-such-invitation': {
    he: 'לא מצאנו את ההזמנה הזו.',
    en: 'No such invitation.',
    ru: 'Такое приглашение не найдено.'
  },
  'invite-link-dead': {
    he: 'קישור ההזמנה הזה אינו תקף או שפג תוקפו.',
    en: 'That invitation link is not valid or has expired.',
    ru: 'Эта ссылка-приглашение недействительна или истекла.'
  },
  // ⚠ NAMES THE ADDRESS RULE, because the invitation is bound to the address it
  // was sent to and "sign in" alone would send somebody to sign in on the
  // account they already have and be refused again.
  'invite-sign-in-first': {
    he: 'היכנסו תחילה, עם הכתובת שאליה נשלחה ההזמנה.',
    en: 'Sign in first, with the address the invitation was sent to.',
    ru: 'Сначала войдите — с того адреса, на который было отправлено приглашение.'
  },
  // ⚠ THE BINDING, EXPLAINED RATHER THAN JUST ENFORCED. An invitation is bound
  // to the address it was sent to, and a guardian whose account is under a
  // different address is a real case — so the refusal has to name both ways
  // out, or it reads as the invitation being broken.
  'invite-wrong-account': {
    he: 'ההזמנה הזו נשלחה לכתובת דוא״ל אחרת. היכנסו עם הכתובת הזו, או בקשו ממרכז עוגן להוסיף אתכם ישירות.',
    en: 'This invitation was sent to a different email address. ' +
        'Sign in with that address, or ask Ogen to add you directly.',
    ru: 'Это приглашение было отправлено на другой адрес. Войдите с того адреса ' +
        'или попросите центр Оген добавить вас напрямую.'
  },
  // An invitation that is not live. These are told apart rather than collapsed
  // into one, which is safe because reaching any of them means already holding
  // the token: the three answers differ in what to do next, and "expired" is
  // the only one worth asking for a new link about.
  'invite-unknown': {
    he: 'קישור ההזמנה הזה אינו תקף.',
    en: 'That invitation link is not valid.',
    ru: 'Эта ссылка-приглашение недействительна.'
  },
  'invite-accepted': {
    he: 'ההזמנה הזו כבר התקבלה.',
    en: 'That invitation has already been accepted.',
    ru: 'Это приглашение уже принято.'
  },
  'invite-revoked': {
    he: 'ההזמנה הזו בוטלה.',
    en: 'That invitation was withdrawn.',
    ru: 'Это приглашение было отозвано.'
  },
  'invite-expired': {
    he: 'תוקף ההזמנה הזו פג. בקשו הזמנה חדשה.',
    en: 'That invitation has expired. Ask for a new one.',
    ru: 'Срок действия этого приглашения истёк. Запросите новое.'
  },
  'already-linked': {
    he: 'החשבון הזה כבר מקושר למשתתף/ת הזה/זו.',
    en: 'That account is already linked to this participant.',
    ru: 'Эта учётная запись уже связана с этим участником.'
  },
  'link-needs-both': {
    he: 'קישור דורש גם משתתף/ת וגם חשבון.',
    en: 'A link needs a participant and an account.',
    ru: 'Для связи нужны и участник, и учётная запись.'
  },
  'last-guardian': {
    he: 'אתם האפוטרופוס/ית היחיד/ה ברשומה הזו, ולכן אי אפשר להסיר את עצמכם. ' +
        'הזמינו מישהו נוסף קודם, או בקשו ממרכז עוגן להסיר את הרשומה.',
    en: 'You are the only guardian on this record, so you cannot remove yourself. ' +
        'Invite someone else first, or ask Ogen to remove the record.',
    ru: 'Вы единственный опекун в этой записи, поэтому вы не можете удалить себя. ' +
        'Сначала пригласите кого-то ещё или попросите центр Оген удалить запись.'
  },

  // --- registering -----------------------------------------------------------
  'registration-not-open': {
    he: 'ההרשמה לפעילות הזו אינה פתוחה.',
    en: 'Registration for this activity is not open.',
    ru: 'Запись на это занятие сейчас закрыта.'
  },
  'group-required': {
    he: 'בפעילות הזו יש כמה קבוצות, ולכן צריך לבחור אחת.',
    en: 'This activity runs several groups, so one has to be chosen.',
    ru: 'В этом занятии несколько групп, поэтому нужно выбрать одну.'
  },
  'no-such-group': {
    he: 'אין קבוצה כזו בפעילות הזו.',
    en: 'No such group on this activity.',
    ru: 'В этом занятии нет такой группы.'
  },
  'no-groups-to-choose': {
    he: 'בפעילות הזו יש קבוצה אחת, ולכן אין מה לבחור.',
    en: 'This activity runs one pool, so there is no group to choose.',
    ru: 'В этом занятии одна общая группа, выбирать не из чего.'
  },
  'activity-full': {
    he: 'הפעילות הזו מלאה.',
    en: 'This activity is full.',
    ru: 'На это занятие мест больше нет.'
  },
  'already-has-a-place': {
    he: 'למשתתף/ת הזה/זו כבר יש מקום בפעילות הזו.',
    en: 'This participant already has a place in this activity.',
    ru: 'У этого участника уже есть место в этом занятии.'
  },
  'already-registered-waiting': {
    he: 'כבר קיימת הרשמה למשתתף/ת הזה/זו, והיא ממתינה לאישור.',
    en: 'There is already a request for this participant, waiting for an answer.',
    ru: 'Для этого участника уже есть заявка, ожидающая ответа.'
  },
  'already-in-status': {
    he: (p) => `ההרשמה הזו כבר ${p.status}.`,
    en: (p) => `This registration is already ${p.status}.`,
    ru: (p) => `Эта запись уже ${p.status}.`
  },
  'cancellation-closed': {
    he: (p) => `הביטול לפעילות הזו נסגר ב-${p.closedOn}. אנא צרו איתנו קשר.`,
    en: (p) => `Cancellation for this activity closed on ${p.closedOn}. Please contact us.`,
    ru: (p) => `Отмена для этого занятия закрылась ${p.closedOn}. Пожалуйста, свяжитесь с нами.`
  },
  'not-approved-for-payment': {
    he: (p) => `ההרשמה הזו ${p.status}. אפשר לשלם רק על מקום מאושר.`,
    en: (p) => `This registration is ${p.status}. Only an approved place can be paid for.`,
    ru: (p) => `Эта запись — ${p.status}. Оплатить можно только подтверждённое место.`
  },
  'nothing-due-registration': {
    he: 'אין חוב פתוח על ההרשמה הזו.',
    en: 'There is nothing outstanding on this registration.',
    ru: 'По этой записи нет задолженности.'
  },

  // --- one evening at a time --------------------------------------------------
  'term-not-by-session': {
    he: 'הפעילות הזו נרשמים אליה לכל הסמסטר, לא למפגש בודד.',
    en: 'This activity is booked for the whole term, not by the session.',
    ru: 'На это занятие записываются на весь семестр, а не на отдельную встречу.'
  },
  'dropin-only': {
    he: 'הרשמה למפגש בודד אפשרית רק בפעילות שנרשמים אליה לפי מפגש.',
    en: 'Sessions are booked one at a time only on a pay-per-session activity.',
    ru: 'Отдельные встречи бронируются только на занятиях с оплатой за встречу.'
  },
  'session-needs-a-date': {
    he: 'מפגש מזוהה לפי התאריך שלו.',
    en: 'A session is identified by its date.',
    ru: 'Встреча определяется своей датой.'
  },
  'not-a-meeting-date': {
    he: 'הפעילות הזו לא מתקיימת בתאריך הזה.',
    en: 'This activity does not meet on that date.',
    ru: 'В этот день занятие не проводится.'
  },
  'need-approved-registration': {
    he: 'צריך קודם הרשמה מאושרת לפעילות הזו.',
    en: 'You need an approved registration for this activity first.',
    ru: 'Сначала нужна подтверждённая запись на это занятие.'
  },
  'evening-already-booked': {
    he: 'המפגש הזה כבר מוזמן.',
    en: 'That evening is already booked.',
    ru: 'Эта встреча уже забронирована.'
  },
  'evening-full': {
    he: 'המפגש הזה מלא.',
    en: 'That evening is full.',
    ru: 'На эту встречу мест больше нет.'
  },
  'evening-not-booked': {
    he: 'המפגש הזה לא מוזמן.',
    en: 'That evening is not booked.',
    ru: 'Эта встреча не забронирована.'
  },
  'evening-already-happened': {
    he: 'המפגש הזה כבר התקיים.',
    en: 'That evening has already happened.',
    ru: 'Эта встреча уже состоялась.'
  },
  'nothing-due-session': {
    he: 'אין חוב פתוח על המפגש הזה.',
    en: 'There is nothing outstanding on that evening.',
    ru: 'По этой встрече нет задолженности.'
  },
  'choose-a-date': {
    he: 'בחרו לפחות תאריך אחד.',
    en: 'Choose at least one date.',
    ru: 'Выберите хотя бы одну дату.'
  },
  'too-many-dates': {
    he: (p) => `אפשר לשלם על עד ${p.max} תאריכים בבת אחת.`,
    en: (p) => `Up to ${p.max} dates can be paid for at once.`,
    ru: (p) => `За один раз можно оплатить не более ${p.max} дат.`
  },
  // ⚠ ALL OR NOTHING, and the sentence has to say so. Being given three of the
  // four evenings that were chosen, plus a charge, is worse than being asked to
  // choose again — so nothing is booked, and the message is what explains why
  // the screen came back unchanged.
  'dates-gone': {
    he: 'חלק מהמפגשים האלה כבר לא זמינים.',
    en: 'Some of those evenings are no longer available.',
    ru: 'Некоторые из этих встреч уже недоступны.'
  },
  'checkout-failed': {
    he: 'לא הצלחנו לפתוח את דף התשלום. נסו שוב.',
    en: 'Could not start the payment. Please try again.',
    ru: 'Не удалось открыть оплату. Попробуйте ещё раз.'
  },

  // --- bundles -----------------------------------------------------------------
  'bundles-dropin-only': {
    he: 'חבילות קיימות רק בפעילויות שנרשמים אליהן לפי מפגש.',
    en: 'Bundles are for pay-per-session activities.',
    ru: 'Абонементы бывают только на занятиях с оплатой за встречу.'
  },
  'bundle-unavailable': {
    he: 'החבילה הזו לא זמינה כרגע.',
    en: 'That bundle is not available at the moment.',
    ru: 'Этот абонемент сейчас недоступен.'
  },
  'session-too-late-to-move': {
    he: 'המפגש הזה קרוב מדי למועד ההתחלה מכדי להעביר אותו.',
    en: 'That session is too close to its start to be moved.',
    ru: 'До начала этой встречи осталось слишком мало времени, чтобы перенести её.'
  },
  'not-a-bundle-entry': {
    he: 'אפשר להעביר רק מפגש ששולם מתוך חבילה.',
    en: 'Only a session paid for from a bundle can be moved.',
    ru: 'Переносить можно только встречу, оплаченную из абонемента.'
  },
  'session-cannot-move': {
    he: 'אי אפשר להעביר את המפגש הזה.',
    en: 'That session cannot be moved.',
    ru: 'Эту встречу нельзя перенести.'
  },
  'bundle-not-found': {
    he: 'לא מצאנו חבילה שהמפגש הזה שייך אליה.',
    en: 'That session is not on a bundle we can find.',
    ru: 'Не удалось найти абонемент, к которому относится эта встреча.'
  },
  'not-a-move-target': {
    he: 'אי אפשר להעביר את החבילה הזו לתאריך הזה.',
    en: 'That date is not one this bundle can move to.',
    ru: 'На эту дату абонемент перенести нельзя.'
  },
  'session-full': {
    he: 'המפגש הזה מלא.',
    en: 'That session is full.',
    ru: 'На эту встречу мест больше нет.'
  },

  // --- credit --------------------------------------------------------------------
  'credit-not-yours': {
    he: 'ההזמנה הזו בוצעה בחשבון אחר, ולכן הזיכוי שלה אינו שלכם.',
    en: 'That was booked on another account, so its credit is not yours to spend.',
    ru: 'Это было оформлено с другой учётной записи, поэтому её баланс вам недоступен.'
  },
  'nothing-outstanding': {
    he: 'אין על זה חוב פתוח.',
    en: 'There is nothing outstanding on this.',
    ru: 'По этому нет задолженности.'
  },
  // --- the code on the wall -------------------------------------------------
  // ⚠ AN INVENTED CODE AND AN EXPIRED ONE ANSWER IDENTICALLY, and so do "not
  // on this list", "cancelled" and "some other evening". Telling them apart
  // would say whether a code ever existed, or let the list be probed for names
  // it does not show. Translating them does not change that: one sentence, in
  // three languages.
  'checkin-code-dead': {
    he: 'הקוד הזה כבר לא תקף.',
    en: 'This code is not valid any more.',
    ru: 'Этот код больше недействителен.'
  },
  'checkin-not-listed': {
    he: 'השם הזה לא נמצא ברשימה של הערב הזה.',
    en: 'That name is not on this evening\'s list.',
    ru: 'Этого имени нет в списке на сегодняшний вечер.'
  },

  'no-credit': {
    he: 'אין יתרת זיכוי בחשבון הזה.',
    en: 'There is no credit on this account.',
    ru: 'На этой учётной записи нет баланса.'
  }
};

// The sentence for one key, in one language.
//
// An unknown key falls back to the generic apology rather than throwing: a
// throw here would turn a 409 a family could act on into a 500 they cannot. The
// gate against a key that does not exist is a test, which reads every key the
// three handlers use straight out of their source.
function text(key, lang, params) {
  const row = MESSAGES[key] || MESSAGES['server-error'];
  const value = row[LANGS.indexOf(lang) !== -1 ? lang : 'en'] || row.en;
  return typeof value === 'function' ? value(params || {}) : value;
}

// The body of a refusal: the sentence, the code beside it, and whatever else the
// caller already sends.
function body(key, lang, extra, params) {
  return Object.assign({ error: text(key, lang, params), code: key }, extra || {});
}

module.exports = { LANGS, MESSAGES, readerLang, text, body };
