// The three messages an account sends about itself: verify this address, reset
// this password, this password was changed.
//
// Copy lives here in all three languages, in one table per message, exactly as
// the nav, footer and contact form each carry their own — a wording change is
// an edit to a table, never to a template scattered across a function.
//
// ⚠ THE RUSSIAN HAS NOT BEEN REVIEWED BY A NATIVE SPEAKER, like the rest of the
// Russian on this site. It is short and mechanical, which is the best that can
// be said for it. ogen-legal-review on the legal pages is the marker tracking
// that debt; these strings belong to the same review.
//
// Every send goes through _email.js — the single send path, so "log after send"
// is a property of the code rather than a discipline each call site remembers —
// and every send is wrapped in settle(), so a mail failure never blocks the
// action it accompanies. An account is created whether or not the welcome
// message goes; a password is changed whether or not the notice arrives.

const email = require('./_email');

// The shell, the escaping and the plain-text twin live in _email-shell.js —
// lifted there when registration messages arrived, so the two families of
// message cannot drift apart visually. pathFor is re-exported below because
// callers already import it from here.
const { lang, pathFor, esc, strip, shell } = require('./_email-shell');

// --- verify this address ---------------------------------------------------

const VERIFY = {
  he: {
    subject: 'אימות כתובת הדוא״ל · מרכז עוגן',
    heading: 'אימות כתובת הדוא״ל',
    intro: (name) => `שלום${name ? ' ' + name : ''},`,
    body: 'נפתח חשבון במרכז עוגן עם כתובת הדוא״ל הזו. לאישור הכתובת יש ללחוץ על הכפתור.',
    button: 'אישור הכתובת',
    ignore: 'אם לא פתחתם חשבון, אפשר להתעלם מההודעה. לא ייעשה דבר.',
    expires: 'הקישור תקף לשבעה ימים.'
  },
  en: {
    subject: 'Confirm your email address · Merkaz Ogen',
    heading: 'Confirm your email address',
    intro: (name) => `Hello${name ? ' ' + name : ''},`,
    body: 'An account was created at Merkaz Ogen with this email address. Press the button to confirm it.',
    button: 'Confirm this address',
    ignore: 'If you did not create an account, you can ignore this message. Nothing will happen.',
    expires: 'The link is valid for seven days.'
  },
  ru: {
    subject: 'Подтвердите адрес электронной почты · Центр Оген',
    heading: 'Подтвердите адрес электронной почты',
    intro: (name) => `Здравствуйте${name ? ', ' + name : ''},`,
    body: 'В центре Оген была создана учётная запись с этим адресом электронной почты. Нажмите кнопку, чтобы подтвердить его.',
    button: 'Подтвердить адрес',
    ignore: 'Если вы не создавали учётную запись, просто проигнорируйте это письмо. Ничего не произойдёт.',
    expires: 'Ссылка действительна семь дней.'
  }
};

function verifyMessage(account, token) {
  const l = lang(account.profile && account.profile.preferredLanguage);
  const T = VERIFY[l];
  const href = pathFor(l, '/account/verify?token=' + encodeURIComponent(token));
  const html = shell(l, T.heading, [
    esc(T.intro((account.profile && account.profile.firstName) || '')),
    esc(T.body), esc(T.expires), esc(T.ignore)
  ], { href: href, label: T.button });
  return { to: account.email, subject: T.subject, html: html, text: strip(html) };
}

// --- reset this password ---------------------------------------------------

const RESET = {
  he: {
    subject: 'איפוס סיסמה · מרכז עוגן',
    heading: 'איפוס סיסמה',
    intro: (name) => `שלום${name ? ' ' + name : ''},`,
    body: 'התקבלה בקשה לאיפוס הסיסמה לחשבון שלכם במרכז עוגן.',
    button: 'בחירת סיסמה חדשה',
    expires: 'הקישור תקף לשעה אחת וניתן לשימוש פעם אחת בלבד.',
    ignore: 'אם לא ביקשתם לאפס סיסמה, אפשר להתעלם מההודעה. הסיסמה הנוכחית תישאר בתוקף.'
  },
  en: {
    subject: 'Reset your password · Merkaz Ogen',
    heading: 'Reset your password',
    intro: (name) => `Hello${name ? ' ' + name : ''},`,
    body: 'Someone asked to reset the password for your Merkaz Ogen account.',
    button: 'Choose a new password',
    expires: 'The link is valid for one hour and can be used once.',
    ignore: 'If you did not ask for this, you can ignore the message. Your current password still works.'
  },
  ru: {
    subject: 'Сброс пароля · Центр Оген',
    heading: 'Сброс пароля',
    intro: (name) => `Здравствуйте${name ? ', ' + name : ''},`,
    body: 'Поступил запрос на сброс пароля от вашей учётной записи в центре Оген.',
    button: 'Выбрать новый пароль',
    expires: 'Ссылка действительна один час и может быть использована один раз.',
    ignore: 'Если вы не запрашивали сброс, проигнорируйте это письмо. Текущий пароль продолжит работать.'
  }
};

function resetMessage(account, token) {
  const l = lang(account.profile && account.profile.preferredLanguage);
  const T = RESET[l];
  const href = pathFor(l, '/account/reset?token=' + encodeURIComponent(token));
  const html = shell(l, T.heading, [
    esc(T.intro((account.profile && account.profile.firstName) || '')),
    esc(T.body), esc(T.expires), esc(T.ignore)
  ], { href: href, label: T.button });
  return { to: account.email, subject: T.subject, html: html, text: strip(html) };
}

// --- this password was changed ---------------------------------------------

const CHANGED = {
  he: {
    subject: 'הסיסמה שונתה · מרכז עוגן',
    heading: 'הסיסמה שונתה',
    body: 'הסיסמה לחשבון שלכם במרכז עוגן שונתה זה עתה, וכל ההתחברויות האחרות נותקו.',
    warn: 'אם לא אתם ביצעתם את השינוי, יש ליצור קשר מיד:'
  },
  en: {
    subject: 'Your password was changed · Merkaz Ogen',
    heading: 'Your password was changed',
    body: 'The password for your Merkaz Ogen account has just been changed, and every other sign-in was ended.',
    warn: 'If this was not you, contact us straight away:'
  },
  ru: {
    subject: 'Пароль изменён · Центр Оген',
    heading: 'Пароль изменён',
    body: 'Пароль вашей учётной записи в центре Оген был только что изменён, все другие сеансы завершены.',
    warn: 'Если это были не вы, немедленно свяжитесь с нами:'
  }
};

// Sent to the address on the account AFTER the change. It is the one message
// here that exists for a person who did not act: if a password was changed by
// somebody else, this is how its owner finds out.
function changedMessage(account) {
  const l = lang(account.profile && account.profile.preferredLanguage);
  const T = CHANGED[l];
  const html = shell(l, T.heading, [
    esc(T.body),
    esc(T.warn) + ' <a href="mailto:contact-us@ogen.cy">contact-us@ogen.cy</a>'
  ], null);
  return { to: account.email, subject: T.subject, html: html, text: strip(html) };
}

// --- an invitation to become a second guardian -----------------------------
//
// It lives in this file rather than its own because it shares the shell and the
// plain-text twin, and two shells drift. It is the one message here sent to
// somebody who may have no account at all, so it has to make sense cold.

const INVITE = {
  he: {
    subject: (child) => `הזמנה להצטרף לרשומה של ${child} · מרכז עוגן`,
    heading: 'הזמנה להצטרף',
    body: (inviter, child) =>
      `${inviter} הזמין אתכם להצטרף כאפוטרופוס נוסף לרשומה של ${child} במרכז עוגן.`,
    what: 'אפוטרופוס נוסף יכול לראות את הפרטים, לרשום לפעילויות ולנהל את ההרשמות.',
    button: 'קבלת ההזמנה',
    bound: 'יש לקבל את ההזמנה מהחשבון עם כתובת הדוא״ל הזו. אם יש לכם חשבון בכתובת אחרת, פנו אלינו ונקשר אתכם ידנית.',
    expires: 'ההזמנה תקפה ל-30 יום.'
  },
  en: {
    subject: (child) => `An invitation to join ${child}'s record · Merkaz Ogen`,
    heading: 'An invitation to join',
    body: (inviter, child) =>
      `${inviter} has invited you to be a second guardian on ${child}'s record at Merkaz Ogen.`,
    what: 'A second guardian can see the details, register for activities and manage those registrations.',
    button: 'Accept the invitation',
    bound: 'Accept it from the account using this email address. If your account uses a different one, contact us and we will link you directly.',
    expires: 'The invitation is valid for 30 days.'
  },
  ru: {
    subject: (child) => `Приглашение присоединиться к записи ${child} · Центр Оген`,
    heading: 'Приглашение присоединиться',
    body: (inviter, child) =>
      `${inviter} приглашает вас стать вторым опекуном в записи ${child} в центре Оген.`,
    what: 'Второй опекун может видеть данные, записывать на занятия и управлять записями.',
    button: 'Принять приглашение',
    bound: 'Примите приглашение из учётной записи с этим адресом электронной почты. Если ваша учётная запись использует другой адрес, свяжитесь с нами, и мы добавим вас вручную.',
    expires: 'Приглашение действительно 30 дней.'
  }
};

// The language is the INVITER's, because the invited person may have no account
// and therefore no stated preference. It is a guess, and the alternative is no
// message at all.
function inviteMessage(invite, inviterName, childName, inviterLang) {
  const l = lang(inviterLang);
  const T = INVITE[l];
  const href = pathFor(l, '/account/guardian-invite?token=' + encodeURIComponent(invite.token));
  const html = shell(l, T.heading, [
    esc(T.body(inviterName || 'A guardian', childName)),
    esc(T.what), esc(T.bound), esc(T.expires)
  ], { href: href, label: T.button });
  return { to: invite.invitedEmail, subject: T.subject(childName), html: html, text: strip(html) };
}

// --- sending ---------------------------------------------------------------
//
// settle() swallows and logs. An email failure never blocks the action it
// accompanies: the account exists, the password is changed, and the message
// about it is best effort.

const sendVerify = (account, token) =>
  email.settle('verify-email', account.email, () =>
    email.send(verifyMessage(account, token),
      { template: 'verify-email', lang: lang(account.profile && account.profile.preferredLanguage) }));

const sendReset = (account, token) =>
  email.settle('password-reset', account.email, () =>
    email.send(resetMessage(account, token),
      { template: 'password-reset', lang: lang(account.profile && account.profile.preferredLanguage) }));

const sendPasswordChanged = (account) =>
  email.settle('password-changed', account.email, () =>
    email.send(changedMessage(account),
      { template: 'password-changed', lang: lang(account.profile && account.profile.preferredLanguage) }));

const sendGuardianInvite = (invite, inviterName, childName, inviterLang) =>
  email.settle('guardian-invite', invite.invitedEmail, () =>
    email.send(inviteMessage(invite, inviterName, childName, inviterLang),
      { template: 'guardian-invite', lang: lang(inviterLang) }));

module.exports = {
  sendVerify, sendReset, sendPasswordChanged, sendGuardianInvite,
  verifyMessage, resetMessage, changedMessage, inviteMessage,
  VERIFY, RESET, CHANGED, INVITE, pathFor
};
