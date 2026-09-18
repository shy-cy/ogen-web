// The family area — Phase 6, and the first thing on this site a family signs
// into.
//
// ONE SCRIPT, ONE STRING TABLE, THREE LANGUAGES, exactly as js/nav.js,
// js/footer.js and js/contact-form.js each do. The pages under /account are
// empty shells with a mount point; everything a person reads is in T below, so
// a wording change is an edit to a table rather than to eighteen HTML files. The
// alternative — body copy in each page, in triplicate, times six views — is the
// shape that guarantees the Russian drifts from the Hebrew.
//
// IT IS NOT ABOUT CHILDREN. A participant is a person who attends, and a
// guardian registering themselves has always worked — _participant-store.js
// says so in its first paragraph and makes no claim about age anywhere. The
// WORDS had drifted, and only half of them: "Add a participant" was already
// neutral while the heading above it said "My children". The heading is now
// "My family", the list holds whoever takes part, and "Add myself" is a button
// rather than a thing you have to realise is allowed.
//
// THREE SIGNED-IN VIEWS, and the split is what a person is there to do:
//   account   the dashboard — who you are, and what you are registered to
//   details   your own details, and the people on this account
//   activity  one registration: what it costs, what is paid, which sessions
// A dashboard that also held every form was one screen doing three jobs, and
// the one thing a family opens it for — "is Noa in?" — was the hardest to find.
//
// DIRECTION IS NEVER SET HERE. The page wrapper already carries it, `html` is
// pinned ltr in shared.css so it keeps the scrollbar, and every inset in the
// stylesheet is logical. This file emits the same markup in all three languages
// and the layout flips on its own.
//
// It reads the language from document.documentElement.lang rather than from the
// path, like the contact form — the path says which tree a page is in, the lang
// attribute says what the reader is actually reading.
(function () {
  var AUTH = '/api/account-auth';
  var FAMILY = '/api/account-family';
  var REGS = '/api/account-registrations';

  var lang = (document.documentElement.lang || 'he').slice(0, 2);
  if (['he', 'en', 'ru'].indexOf(lang) === -1) lang = 'he';
  var base = lang === 'he' ? '' : '/' + lang;

  // ---------------------------------------------------------------- copy ----
  var T = {
    he: {
      signInTitle: 'כניסה לאזור המשפחה', email: 'דוא״ל', password: 'סיסמה',
      signIn: 'כניסה', forgot: 'שכחתי סיסמה', noAccount: 'אין לכם חשבון עדיין?',
      createAccount: 'פתיחת חשבון', haveAccount: 'כבר יש לכם חשבון?',
      signUpTitle: 'פתיחת חשבון', firstName: 'שם פרטי', lastName: 'שם משפחה',
      phone: 'טלפון', prefLang: 'שפה מועדפת',
      termsPre: 'קראתי ואני מסכים/ה ל', termsLink: 'תנאי השימוש', termsMid: ' ול',
      privacyLink: 'מדיניות הפרטיות',
      signUp: 'פתיחת חשבון',
      forgotTitle: 'איפוס סיסמה',
      forgotIntro: 'הזינו את כתובת הדוא״ל שלכם ונשלח קישור לאיפוס.',
      forgotSend: 'שליחת קישור',
      forgotSent: 'אם קיים חשבון בכתובת הזו, הקישור נשלח. בדקו את תיבת הדואר.',
      resetTitle: 'בחירת סיסמה חדשה', newPassword: 'סיסמה חדשה', resetSave: 'שמירה',
      resetDone: 'הסיסמה עודכנה. אפשר להיכנס.',
      linkDead: 'הקישור פג או כבר נוצל. אפשר לבקש חדש.',
      verifyOk: 'כתובת הדוא״ל אומתה. תודה.',
      verifyBanner: 'כתובת הדוא״ל עדיין לא אומתה.', verifyResend: 'שליחה מחדש',
      verifySent: 'קישור חדש בדרך.',
      inviteTitle: 'הזמנה להצטרף', inviteFor: 'הוזמנתם לנהל יחד את הרשומה של',
      inviteBy: 'ההזמנה נשלחה על ידי',
      inviteSignIn: 'היכנסו לחשבון שלכם כדי לקבל את ההזמנה.',
      inviteSignUp: 'אין לכם חשבון? פתחו חשבון עם אותה כתובת דוא״ל.',
      inviteAccept: 'קבלת ההזמנה', inviteDone: 'ההזמנה התקבלה.',
      hello: 'שלום', signOut: 'יציאה', back: 'חזרה',

      familyTitle: 'המשפחה שלי', people: 'אנשים',
      addSomeone: 'הוספת משתתף/ת', addSelf: 'הוספת עצמי',
      noParticipants: 'עדיין לא הוספתם משתתפים.',
      me: 'אני', edit: 'עריכה',
      dob: 'תאריך לידה', notes: 'הערות (אלרגיות, מידע רפואי)',
      save: 'שמירה', cancel: 'ביטול', age: 'גיל',
      manages: 'מי רואה ומנהל/ת את הרשומה', primary: 'ראשי/ת',
      inviteGuardian: 'הזמנת אפוטרופוס שני', inviteEmail: 'כתובת דוא״ל',
      inviteSend: 'שליחת הזמנה', invitePending: 'הזמנה ממתינה',
      inviteResend: 'שליחה מחדש', inviteRevoke: 'ביטול הזמנה',
      leave: 'הסרת עצמי מהרשומה',
      leaveConfirm: 'להסיר את עצמכם מהרשומה של המשתתף/ת הזה/זו?',

      tabFamily: 'בני המשפחה',
      emailFixed: 'לשינוי כתובת הדוא״ל פנו אלינו.',

      activitiesTitle: 'הפעילויות שלי', noRegs: 'אין עדיין הרשמות.',
      grpCurrent: 'פעילות כעת', grpPast: 'הסתיימו', viewDetails: 'לפרטים',
      cancelReg: 'ביטול הרשמה', cancelRegConfirm: 'לבטל את ההרשמה?',
      regNotFound: 'לא נמצאה הרשמה.',
      activityGone: 'הפעילות אינה מפורסמת כרגע. פרטי ההרשמה נשמרו.',

      costTitle: 'מה זה עולה', stillToPay: 'נותר לתשלום', credited: 'זוכה',
      payNow: 'תשלום מאובטח', payOpening: 'פותח תשלום…',
      payNeedsVerify: 'כדי לשלם, יש לאשר את כתובת האימייל. הקישור לאישור נמצא בעמוד החשבון.',
      payNeedsApproval: 'קישור לתשלום יישלח אליכם בקרוב.',
      sessionsTitle: 'המפגשים', dateCol: 'תאריך', statusCol: 'סטטוס',
      book: 'הרשמה למפגש', cancelSession: 'ביטול מפגש',
      cancelSessionConfirm: 'לבטל את המפגש הזה?',
      sessionStatus: { booked: 'רשום/ה', attended: 'הגיע/ה',
                       'no-show': 'לא הגיע/ה', cancelled: 'בוטל' },

      creditTitle: 'יתרת זיכוי',
      profileTitle: 'הפרטים שלי', editDetails: 'עריכת הפרטים',
      changePassword: 'שינוי סיסמה',
      currentPassword: 'סיסמה נוכחית', saved: 'נשמר.',
      registerTitle: 'הרשמה לפעילות', registerWho: 'מי נרשם/ת?',
      registerGroup: 'קבוצה', registerGo: 'הרשמה',
      registerFull: 'הפעילות מלאה.',
      registerDone: 'ההרשמה בוצעה. קישור לתשלום יישלח אליכם בקרוב.',
      owes: 'לתשלום', paid: 'שולם', feeIncluded: 'כולל דמי הרשמה שנתיים',
      feeAlready: 'דמי ההרשמה השנתיים כבר שולמו',
      places: 'מקומות פנויים', unlimited: 'ללא הגבלה',
      loading: 'טוען…', problem: 'משהו השתבש. נסו שוב.',
      offline: 'אין חיבור לשרת. נסו שוב בעוד רגע.',
      status: { pending: 'רשום/ה', approved: 'רשום/ה', rejected: 'לא אושר',
                expired: 'פג תוקף', cancelled: 'בוטל' }
    },
    en: {
      signInTitle: 'Sign in', email: 'Email', password: 'Password',
      signIn: 'Sign in', forgot: 'Forgotten your password?', noAccount: 'No account yet?',
      createAccount: 'Create an account', haveAccount: 'Already have an account?',
      signUpTitle: 'Create an account', firstName: 'First name', lastName: 'Last name',
      phone: 'Phone', prefLang: 'Preferred language',
      termsPre: 'I have read and accept the ', termsLink: 'Terms of Use', termsMid: ' and the ',
      privacyLink: 'Privacy Policy',
      signUp: 'Create account',
      forgotTitle: 'Reset your password',
      forgotIntro: 'Enter your email address and we will send you a link.',
      forgotSend: 'Send the link',
      forgotSent: 'If there is an account at that address, the link is on its way. Check your inbox.',
      resetTitle: 'Choose a new password', newPassword: 'New password', resetSave: 'Save',
      resetDone: 'Your password has been changed. You can sign in.',
      linkDead: 'That link has expired or has already been used. You can ask for a new one.',
      verifyOk: 'Your email address is confirmed. Thank you.',
      verifyBanner: 'Your email address is not confirmed yet.', verifyResend: 'Send again',
      verifySent: 'A new link is on its way.',
      inviteTitle: 'An invitation to join', inviteFor: 'You have been invited to help manage the record for',
      inviteBy: 'Invited by',
      inviteSignIn: 'Sign in to your account to accept.',
      inviteSignUp: 'No account? Create one with the same email address.',
      inviteAccept: 'Accept the invitation', inviteDone: 'Invitation accepted.',
      hello: 'Hello', signOut: 'Sign out', back: 'Back',

      familyTitle: 'My family', people: 'people',
      addSomeone: 'Add someone', addSelf: 'Add myself',
      noParticipants: 'You have not added anyone yet.',
      me: 'me', edit: 'Edit',
      dob: 'Date of birth', notes: 'Notes (allergies, medical information)',
      save: 'Save', cancel: 'Cancel', age: 'Age',
      manages: 'Who can see and manage this record', primary: 'Primary',
      inviteGuardian: 'Invite a second guardian', inviteEmail: 'Email address',
      inviteSend: 'Send invitation', invitePending: 'Invitation pending',
      inviteResend: 'Send again', inviteRevoke: 'Withdraw',
      leave: 'Remove myself from this record',
      leaveConfirm: 'Remove yourself as a guardian for this participant?',

      tabFamily: 'Family members',
      emailFixed: 'To change your email address, please contact us.',

      activitiesTitle: 'My activities', noRegs: 'No registrations yet.',
      grpCurrent: 'Current', grpPast: 'Finished', viewDetails: 'View details',
      cancelReg: 'Cancel registration', cancelRegConfirm: 'Cancel this registration?',
      regNotFound: 'That registration was not found.',
      activityGone: 'This activity is not published at the moment. Your registration details are kept.',

      costTitle: 'What it costs', stillToPay: 'Still to pay', credited: 'Credited',
      payNow: 'Pay securely', payOpening: 'Opening payment…',
      payNeedsVerify: 'To pay, please confirm your email address. The link to resend it is on your account page.',
      payNeedsApproval: 'We will send you a payment link shortly.',
      sessionsTitle: 'Sessions', dateCol: 'Date', statusCol: 'Status',
      book: 'Book', cancelSession: 'Cancel this session',
      cancelSessionConfirm: 'Cancel this session?',
      sessionStatus: { booked: 'Booked', attended: 'Attended',
                       'no-show': 'Did not come', cancelled: 'Cancelled' },

      creditTitle: 'Credit',
      profileTitle: 'My details', editDetails: 'Edit my details',
      changePassword: 'Change password',
      currentPassword: 'Current password', saved: 'Saved.',
      registerTitle: 'Register for an activity', registerWho: 'Who is registering?',
      registerGroup: 'Group', registerGo: 'Register',
      registerFull: 'This activity is full.',
      registerDone: 'Registered. We will send you a payment link shortly.',
      owes: 'To pay', paid: 'Paid', feeIncluded: 'includes the yearly registration fee',
      feeAlready: 'yearly registration fee already paid',
      places: 'places left', unlimited: 'no limit',
      loading: 'Loading…', problem: 'Something went wrong. Please try again.',
      offline: 'Could not reach the server. Try again in a moment.',
      status: { pending: 'Registered', approved: 'Registered', rejected: 'Not offered',
                expired: 'Expired', cancelled: 'Cancelled' }
    },
    ru: {
      signInTitle: 'Вход', email: 'Эл. почта', password: 'Пароль',
      signIn: 'Войти', forgot: 'Забыли пароль?', noAccount: 'Ещё нет учётной записи?',
      createAccount: 'Создать учётную запись', haveAccount: 'Уже есть учётная запись?',
      signUpTitle: 'Создание учётной записи', firstName: 'Имя', lastName: 'Фамилия',
      phone: 'Телефон', prefLang: 'Предпочитаемый язык',
      termsPre: 'Я прочитал(а) и принимаю ', termsLink: 'Условия использования', termsMid: ' и ',
      privacyLink: 'Политику конфиденциальности',
      signUp: 'Создать',
      forgotTitle: 'Сброс пароля',
      forgotIntro: 'Укажите адрес электронной почты, и мы пришлём ссылку.',
      forgotSend: 'Отправить ссылку',
      forgotSent: 'Если учётная запись с таким адресом существует, ссылка отправлена. Проверьте почту.',
      resetTitle: 'Новый пароль', newPassword: 'Новый пароль', resetSave: 'Сохранить',
      resetDone: 'Пароль изменён. Можно войти.',
      linkDead: 'Ссылка истекла или уже была использована. Можно запросить новую.',
      verifyOk: 'Адрес электронной почты подтверждён. Спасибо.',
      verifyBanner: 'Адрес электронной почты ещё не подтверждён.', verifyResend: 'Отправить снова',
      verifySent: 'Новая ссылка отправлена.',
      inviteTitle: 'Приглашение', inviteFor: 'Вас приглашают совместно вести запись участника',
      inviteBy: 'Пригласил(а)',
      inviteSignIn: 'Войдите в свою учётную запись, чтобы принять приглашение.',
      inviteSignUp: 'Нет учётной записи? Создайте её с тем же адресом электронной почты.',
      inviteAccept: 'Принять приглашение', inviteDone: 'Приглашение принято.',
      hello: 'Здравствуйте', signOut: 'Выйти', back: 'Назад',

      familyTitle: 'Моя семья', people: 'человек',
      addSomeone: 'Добавить участника', addSelf: 'Добавить себя',
      noParticipants: 'Вы ещё никого не добавили.',
      me: 'я', edit: 'Изменить',
      dob: 'Дата рождения', notes: 'Примечания (аллергии, медицинская информация)',
      save: 'Сохранить', cancel: 'Отмена', age: 'Возраст',
      manages: 'Кто видит эту запись и управляет ею', primary: 'Основной',
      inviteGuardian: 'Пригласить второго опекуна', inviteEmail: 'Адрес электронной почты',
      inviteSend: 'Отправить приглашение', invitePending: 'Приглашение отправлено',
      inviteResend: 'Отправить снова', inviteRevoke: 'Отозвать',
      leave: 'Удалить себя из этой записи',
      leaveConfirm: 'Удалить себя как опекуна этого участника?',

      tabFamily: 'Члены семьи',
      emailFixed: 'Чтобы изменить адрес электронной почты, свяжитесь с нами.',

      activitiesTitle: 'Мои занятия', noRegs: 'Записей пока нет.',
      grpCurrent: 'Текущие', grpPast: 'Завершённые', viewDetails: 'Подробнее',
      cancelReg: 'Отменить запись', cancelRegConfirm: 'Отменить эту запись?',
      regNotFound: 'Запись не найдена.',
      activityGone: 'Это занятие сейчас не опубликовано. Данные вашей записи сохранены.',

      costTitle: 'Сколько это стоит', stillToPay: 'Осталось оплатить', credited: 'Зачислено',
      payNow: 'Оплатить', payOpening: 'Открываем оплату…',
      payNeedsVerify: 'Чтобы оплатить, подтвердите адрес электронной почты. Ссылка для повторной отправки — на странице аккаунта.',
      payNeedsApproval: 'Ссылку на оплату мы пришлём в ближайшее время.',
      sessionsTitle: 'Занятия', dateCol: 'Дата', statusCol: 'Статус',
      book: 'Записаться', cancelSession: 'Отменить занятие',
      cancelSessionConfirm: 'Отменить это занятие?',
      sessionStatus: { booked: 'Записан(а)', attended: 'Посетил(а)',
                       'no-show': 'Не пришёл(ла)', cancelled: 'Отменено' },

      creditTitle: 'Кредит',
      profileTitle: 'Мои данные', editDetails: 'Изменить данные',
      changePassword: 'Изменить пароль',
      currentPassword: 'Текущий пароль', saved: 'Сохранено.',
      registerTitle: 'Запись на занятие', registerWho: 'Кто записывается?',
      registerGroup: 'Группа', registerGo: 'Записаться',
      registerFull: 'Свободных мест нет.',
      registerDone: 'Запись оформлена. Ссылку на оплату мы пришлём в ближайшее время.',
      owes: 'К оплате', paid: 'Оплачено', feeIncluded: 'включая годовой регистрационный взнос',
      feeAlready: 'годовой регистрационный взнос уже оплачен',
      places: 'свободных мест', unlimited: 'без ограничения',
      loading: 'Загрузка…', problem: 'Что-то пошло не так. Попробуйте ещё раз.',
      offline: 'Не удалось связаться с сервером. Попробуйте через минуту.',
      status: { pending: 'Записан(а)', approved: 'Записан(а)', rejected: 'Не предложено',
                expired: 'Истекло', cancelled: 'Отменено' }
    }
  }[lang];

  // ---------------------------------------------------------------- utils ---
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] === null || attrs[k] === undefined || attrs[k] === false) return;
      if (k === 'text') n.textContent = attrs[k];
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  var mount = document.getElementById('account-mount');
  var view = mount ? (mount.getAttribute('data-view') || 'account') : 'account';
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function money(cents) { return cents == null ? '—' : '€' + (cents / 100).toFixed(2); }
  function euros(value) { return value == null ? '—' : '€' + Number(value).toFixed(2); }
  function pick(bag) {
    if (!bag) return '';
    if (typeof bag === 'string') return bag;
    // The same fallback chain the rest of the site uses, so an activity with no
    // Russian title shows its English rather than an empty line.
    var chain = { he: ['he'], en: ['en', 'he'], ru: ['ru', 'en', 'he'] }[lang];
    for (var i = 0; i < chain.length; i++) if (bag[chain[i]]) return bag[chain[i]];
    return '';
  }
  function param(name) {
    var m = new RegExp('[?&]' + name + '=([^&#]*)').exec(window.location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
  }
  var full = function (p) { return [p.firstName, p.lastName].filter(Boolean).join(' '); };

  // A date in the reader's language. The PUBLISHED activity page formats its
  // session table on the server, because it is static HTML built once for three
  // languages; this page is live in a browser that already knows the locale, so
  // asking Intl is one line against a second copy of twelve month names.
  var LOCALE = { he: 'he-IL', en: 'en-GB', ru: 'ru-RU' }[lang];
  function dayMonth(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    try {
      return new Intl.DateTimeFormat(LOCALE, {
        day: 'numeric', month: 'long', timeZone: 'UTC'
      }).format(d);
    } catch (err) { return iso; }
  }

  // WHERE TO GO BACK TO. The nav chip carries the page you were on into the
  // sign-in link, so signing in from an activity page returns you to it rather
  // than dropping you on a dashboard with your place lost.
  //
  // ⚠ ONLY A PATH ON THIS SITE IS FOLLOWED. `next` arrives in a URL anyone can
  // write, so an absolute one — or a protocol-relative `//evil.example` — would
  // make this an open redirect: a link that looks like ogen.cy, asks for a
  // password, and lands somewhere else. It must start with a single slash and
  // nothing more.
  function nextTarget() {
    var raw = param('next');
    if (!raw) return null;
    if (raw.charAt(0) !== '/' || raw.charAt(1) === '/' || raw.charAt(1) === '\\') return null;
    return raw;
  }
  function goNext() {
    var target = nextTarget();
    if (!target) return false;
    window.location.href = target;
    return true;
  }
  // Every internal link is built from the tree prefix, never from a hardcoded
  // '/account' — in Hebrew the prefix is '' and in the other two it is '/en' or
  // '/ru', so one helper keeps a reader inside the language they are reading.
  function url(path, query) {
    return base + path + (query ? '?' + query : '');
  }

  var notice = null;
  function say(kind, text) {
    if (!notice) return;
    clear(notice);
    notice.appendChild(el('p', { class: 'acc-notice is-' + kind, text: text }));
    if (kind === 'ok') window.setTimeout(function () { if (notice) clear(notice); }, 5000);
  }
  // One place decides what a failed call says. A network failure and a refusal
  // are different things and a family should not be told "something went wrong"
  // when the truth is "you are offline".
  function failure(res) {
    if (res.status === 0) return T.offline;
    return (res.data && res.data.error) || T.problem;
  }

  function field(label, attrs) {
    var id = 'f-' + label.replace(/\W+/g, '') + Math.random().toString(36).slice(2, 7);
    var input = el('input', Object.assign({ id: id, type: 'text' }, attrs || {}));
    return { row: el('div', { class: 'acc-field' }, [
      el('label', { for: id, text: label }), input
    ]), input: input };
  }

  // Any row of buttons. One helper rather than a margin on each button, so the
  // gap cannot be forgotten the next time two of them end up side by side — and
  // it is a flex row with `gap`, so the order follows the page direction and
  // there is nothing directional to get wrong in Hebrew.
  function actions(kids) {
    return el('div', { class: 'acc-actions' }, kids);
  }

  function section(title, kids) {
    return el('section', { class: 'acc-card' },
      [title ? el('h2', { text: title }) : null].concat(kids || []));
  }

  // ⚠ `pending` AND `approved` BOTH READ "registered" TO A FAMILY, on purpose.
  // The two are a real distinction on our side — approved is what opens
  // payment — but "waiting for an answer" is not the state a parent is in.
  // They have registered; if we cannot take the place we write to them and say
  // so, which is the rejection message. The difference between the two is
  // already expressed where it matters: a pay button on one, "a payment link
  // is on its way" on the other. Do not put the word "pending" back in front
  // of a family — the admin queue is where that word belongs.
  function pill(status, table) {
    return el('span', { class: 'acc-pill is-' + status, text: (table || T.status)[status] || status });
  }

  // The page heading and the one control beside it. On the dashboard that is
  // sign-out; on a page reached from it, the way back.
  //
  // AN h2, NOT AN h1. The shell already carries the page's single h1 in its
  // .page-header, and a second one is a second top-level heading — two claims
  // about what the page is. These pages are noindex so no search engine is
  // reading them, but a screen reader is, and this is the outline it announces.
  function head(title, aside) {
    return el('div', { class: 'acc-head' }, [el('h2', { text: title }), aside]);
  }
  function backLink(to) {
    return el('a', { class: 'acc-link', href: to, text: T.back });
  }
  function signOutButton() {
    return el('button', { type: 'button', class: 'acc-link', text: T.signOut, onclick: function () {
      post(AUTH, { action: 'signout' }).then(function () {
        window.MemberSession.clear();
        boot();
      });
    } });
  }

  var post = function (url, body) { return window.MemberSession.post(url, body); };

  // The nav chip draws an initial, and js/nav.js runs on every page WITHOUT the
  // member scripts — so it cannot ask the server who this is. The name is cached
  // beside the token here, where it is already in hand, and it is the only thing
  // about a person kept in browser storage. Nothing authorises on it.
  function sessionFor(data) {
    var p = (data.account && data.account.profile) || {};
    return {
      token: data.token, expiresAt: data.expiresAt,
      firstName: p.firstName || '',
      email: data.account ? data.account.email : ''
    };
  }

  // ------------------------------------------------------------ sign in -----
  function renderSignedOut(where, opts) {
    opts = opts || {};
    clear(where);
    var mode = opts.mode || 'signin';

    if (mode === 'forgot') {
      var fe = field(T.email, { type: 'email', autocomplete: 'email' });
      var btn = el('button', { type: 'submit', class: 'btn-primary', text: T.forgotSend });
      var form = el('form', { onsubmit: function (e) {
        e.preventDefault();
        btn.disabled = true;
        post(AUTH, { action: 'requestReset', email: fe.input.value }).then(function (res) {
          btn.disabled = false;
          // The SAME answer whether or not an account exists. An attacker who
          // learns dana@example.com has an Ogen account has learned she has
          // children attending and roughly where they are on a Wednesday.
          say(res.ok ? 'ok' : 'err', res.ok ? T.forgotSent : failure(res));
        });
      } }, [el('p', { class: 'acc-intro', text: T.forgotIntro }), fe.row, btn]);
      where.appendChild(section(T.forgotTitle, [form,
        el('p', { class: 'acc-alt' }, [
          el('a', { href: '#', onclick: function (e) { e.preventDefault(); renderSignedOut(where, {}); },
                    text: T.signIn })])]));
      return;
    }

    if (mode === 'signup') return renderSignUp(where, opts);

    var e1 = field(T.email, { type: 'email', autocomplete: 'email', required: 'required' });
    var p1 = field(T.password, { type: 'password', autocomplete: 'current-password', required: 'required' });
    // AN INVITE IS BOUND TO THE ADDRESS IT WAS SENT TO, so on that path the
    // address is filled in and locked. Letting it be edited here would only
    // produce a sign-in that succeeds and then an acceptance that is refused,
    // which reads as the invitation being broken.
    if (opts.email) { e1.input.value = opts.email; e1.input.readOnly = true; }
    var go = el('button', { type: 'submit', class: 'btn-primary', text: T.signIn });
    var form = el('form', { onsubmit: function (e) {
      e.preventDefault();
      go.disabled = true;
      post(AUTH, { action: 'signin', email: e1.input.value, password: p1.input.value })
        .then(function (res) {
          go.disabled = false;
          if (!res.ok) return say('err', failure(res));
          window.MemberSession.set(sessionFor(res.data));
          if (opts.onSignedIn) return opts.onSignedIn(res.data.account);
          if (goNext()) return;
          boot();
        });
    } }, [e1.row, p1.row, go]);

    where.appendChild(section(opts.title || T.signInTitle, [
      opts.intro ? el('p', { class: 'acc-intro', text: opts.intro }) : null,
      form,
      el('p', { class: 'acc-alt' }, [
        el('a', { href: '#', onclick: function (e) { e.preventDefault(); renderSignedOut(where, { mode: 'forgot' }); },
                  text: T.forgot })]),
      el('p', { class: 'acc-alt' }, [
        el('span', { text: T.noAccount + ' ' }),
        el('a', { href: '#', onclick: function (e) {
          e.preventDefault(); renderSignedOut(where, Object.assign({}, opts, { mode: 'signup' }));
        }, text: T.createAccount })])
    ]));
  }

  function renderSignUp(where, opts) {
    clear(where);
    var f = field(T.firstName, { required: 'required', autocomplete: 'given-name' });
    var l = field(T.lastName, { autocomplete: 'family-name' });
    var ph = field(T.phone, { type: 'tel', autocomplete: 'tel' });
    var e1 = field(T.email, { type: 'email', required: 'required', autocomplete: 'email' });
    var p1 = field(T.password, { type: 'password', required: 'required', autocomplete: 'new-password' });
    if (opts.email) { e1.input.value = opts.email; e1.input.readOnly = true; }

    var langSel = el('select', {});
    [['he', 'עברית'], ['en', 'English'], ['ru', 'Русский']].forEach(function (o) {
      langSel.appendChild(el('option', { value: o[0], text: o[1], selected: o[0] === lang || null }));
    });

    // AN ACCOUNT CANNOT EXIST WITHOUT ACCEPTING THE TERMS, and termsAcceptedAt
    // is stored. The links are per-language and point at the reader's own tree;
    // the pages themselves say which version is legally binding.
    var agree = el('input', { type: 'checkbox', id: 'acc-terms', required: 'required' });
    var terms = el('div', { class: 'acc-check' }, [agree, el('label', { for: 'acc-terms' }, [
      el('span', { text: T.termsPre }),
      el('a', { href: base + '/terms', target: '_blank', rel: 'noopener', text: T.termsLink }),
      el('span', { text: T.termsMid }),
      el('a', { href: base + '/privacy', target: '_blank', rel: 'noopener', text: T.privacyLink })
    ])]);

    var go = el('button', { type: 'submit', class: 'btn-primary', text: T.signUp });
    var form = el('form', { onsubmit: function (e) {
      e.preventDefault();
      go.disabled = true;
      post(AUTH, {
        action: 'signup', email: e1.input.value, password: p1.input.value,
        termsAccepted: agree.checked,
        profile: { firstName: f.input.value, lastName: l.input.value,
                   phone: ph.input.value, preferredLanguage: langSel.value }
      }).then(function (res) {
        go.disabled = false;
        if (!res.ok) return say('err', failure(res));
        // A session immediately. Making somebody sign in again with the password
        // they typed ten seconds ago is a step that exists only because it was
        // easier to build.
        window.MemberSession.set(sessionFor(res.data));
        if (opts.onSignedIn) return opts.onSignedIn(res.data.account);
        if (goNext()) return;
        boot();
      });
    } }, [f.row, l.row, ph.row, e1.row, p1.row,
          el('div', { class: 'acc-field' }, [el('label', { text: T.prefLang }), langSel]),
          terms, go]);

    where.appendChild(section(T.signUpTitle, [
      opts.intro ? el('p', { class: 'acc-intro', text: opts.intro }) : null,
      form,
      el('p', { class: 'acc-alt' }, [
        el('span', { text: T.haveAccount + ' ' }),
        el('a', { href: '#', onclick: function (e) {
          e.preventDefault(); renderSignedOut(where, Object.assign({}, opts, { mode: 'signin' }));
        }, text: T.signIn })])
    ]));
  }

  // ------------------------------------------------------- the dashboard ----
  //
  // WHAT YOU LAND ON, and it answers one question: is Noa in? Two summary cards
  // and the list of registrations, grouped by whether they are still live. The
  // forms all moved to /account/details, because a screen that was both a
  // summary and five forms buried the summary.
  function renderAccount(account) {
    clear(mount);
    mount.appendChild(head(
      T.hello + ', ' + ((account.profile && account.profile.firstName) || account.email),
      signOutButton()));
    notice = el('div', {});
    mount.appendChild(notice);

    if (!account.emailVerifiedAt) {
      mount.appendChild(el('p', { class: 'acc-notice is-warn' }, [
        el('span', { text: T.verifyBanner + ' ' }),
        el('button', { type: 'button', class: 'acc-link', text: T.verifyResend, onclick: function () {
          post(AUTH, { action: 'resendVerification' }).then(function (res) {
            say(res.ok ? 'ok' : 'err', res.ok ? T.verifySent : failure(res));
          });
        } })
      ]));
    }

    var slug = param('register');
    var panels = {
      register: el('div', {}), summary: el('div', {}),
      regs: el('div', {}), credit: el('div', {})
    };
    Object.keys(panels).forEach(function (k) { mount.appendChild(panels[k]); });

    if (slug) renderRegister(panels.register, slug, function () {
      renderRegistrations(panels.regs);
      renderSummary(panels.summary, account);
    });
    renderSummary(panels.summary, account);
    renderRegistrations(panels.regs);
    renderCredit(panels.credit);
  }

  // Two cards: who is on this account, and who you are. Both lead to the same
  // page on different tabs — the count is a link, not an ornament.
  function renderSummary(where, account) {
    clear(where);
    var familyCard = el('a', { class: 'acc-tile', href: url('/account/details', 'tab=family') }, [
      el('span', { class: 'acc-tile-label', text: T.familyTitle }),
      el('span', { class: 'acc-stat', text: '—' }),
      el('span', { class: 'acc-meta', text: T.people })
    ]);
    var stat = familyCard.querySelector('.acc-stat');

    var meCard = el('a', { class: 'acc-tile', href: url('/account/details') }, [
      el('span', { class: 'acc-tile-label', text: T.profileTitle }),
      el('span', { class: 'acc-meta', text: account.email }),
      el('span', { class: 'acc-tile-go', text: T.editDetails })
    ]);

    where.appendChild(el('div', { class: 'acc-tiles' }, [familyCard, meCard]));
    post(FAMILY, { action: 'listParticipants' }).then(function (res) {
      if (!res.ok) return;
      stat.textContent = String((res.data.participants || []).length);
    });
  }

  // ---- registering for an activity ----
  function renderRegister(where, slug, onDone) {
    clear(where);
    where.appendChild(section(T.registerTitle, [el('p', { class: 'acc-intro', text: T.loading })]));
    Promise.all([
      post(REGS, { action: 'activity', slug: slug }),
      post(FAMILY, { action: 'listParticipants' })
    ]).then(function (r) {
      var act = r[0], fam = r[1];
      clear(where);
      if (!act.ok) return where.appendChild(section(T.registerTitle,
        [el('p', { class: 'acc-notice is-err', text: failure(act) })]));
      var a = act.data.activity;
      var people = (fam.data && fam.data.participants) || [];

      var who = el('select', {});
      people.forEach(function (c) {
        // "Noa Levi" and "Michal Shinitzky (me)" in the same list, because they
        // are the same kind of thing — a person this account may register.
        who.appendChild(el('option', { value: c.participantId,
          text: full(c) + (c.isSelf ? ' (' + T.me + ')' : '') }));
      });

      var groupSel = null;
      if (a.groups) {
        groupSel = el('select', {});
        a.groups.forEach(function (g) {
          groupSel.appendChild(el('option', {
            value: g.groupId, text: g.label + (g.full ? ' — ' + T.registerFull : ''),
            disabled: g.full || null
          }));
        });
      }

      var go = el('button', { type: 'submit', class: 'btn-primary', text: T.registerGo,
                              disabled: !people.length || null });
      var form = el('form', { onsubmit: function (e) {
        e.preventDefault();
        go.disabled = true;
        post(REGS, { action: 'submit', slug: slug, participantId: who.value,
                     groupId: groupSel ? groupSel.value : null }).then(function (res) {
          go.disabled = false;
          if (!res.ok) return say('err', failure(res));
          // IN PLACE, not a reboot. Rebooting the dashboard threw away the
          // notice that had just been written into it, so the one thing a family
          // needed to see — that the child is registered and a payment link is
          // coming — was on screen for the length of one repaint.
          clear(where);
          where.appendChild(section(null, [
            el('p', { class: 'acc-notice is-ok', text: T.registerDone })
          ]));
          if (onDone) onDone();
        });
      } }, [
        el('div', { class: 'acc-field' }, [el('label', { text: T.registerWho }), who]),
        groupSel ? el('div', { class: 'acc-field' }, [el('label', { text: T.registerGroup }), groupSel]) : null,
        go
      ]);

      // A COUNT, never a list. How many places are left is public-ish; who is in
      // them is not.
      var left = a.left == null ? T.unlimited : a.left + ' ' + T.places;
      where.appendChild(section(T.registerTitle + ' · ' + pick(a.title), [
        el('p', { class: 'acc-intro', text: left }),
        people.length
          ? form
          : el('p', { class: 'acc-intro' }, [
              el('span', { text: T.noParticipants + ' ' }),
              el('a', { class: 'acc-link', href: url('/account/details', 'tab=family'),
                        text: T.addSomeone })
            ])
      ]));
    });
  }

  // ---- what this account is registered to ----
  //
  // EVERY ROW IS A PERSON AND AN ACTIVITY, never an activity alone: Ogen
  // registers one participant to one activity, so two children in the same class
  // are two registrations with their own status, price and cancellation. A row
  // that named only the activity would be hiding which of them it was about.
  function renderRegistrations(where) {
    if (!where) return;
    clear(where);
    post(REGS, { action: 'list' }).then(function (res) {
      clear(where);
      if (!res.ok) return where.appendChild(section(T.activitiesTitle,
        [el('p', { class: 'acc-notice is-err', text: failure(res) })]));
      var list = res.data.registrations || [];
      if (!list.length) {
        return where.appendChild(section(T.activitiesTitle,
          [el('p', { class: 'acc-intro', text: T.noRegs })]));
      }
      // LIVE OR FINISHED, which is what the data actually says. Not "upcoming
      // and past" — a row carries no end date, so grouping by time would be a
      // claim this list cannot support.
      var live = function (r) { return r.status === 'pending' || r.status === 'approved'; };
      var groups = [
        { label: T.grpCurrent, rows: list.filter(live) },
        { label: T.grpPast, rows: list.filter(function (r) { return !live(r); }) }
      ].filter(function (g) { return g.rows.length; });

      var kids = [];
      groups.forEach(function (g) {
        kids.push(el('h3', { class: 'acc-group', text: g.label }));
        g.rows.forEach(function (r) { kids.push(regRow(r)); });
      });
      where.appendChild(section(T.activitiesTitle, kids));
    });
  }

  function regRow(r) {
    var bits = pick(r.groupName);
    return el('div', { class: 'acc-row' + (r.status === 'cancelled' ? ' is-muted' : '') }, [
      el('div', {}, [
        el('b', { text: r.participantName + ' · ' + pick(r.title) }),
        bits ? el('span', { class: 'acc-meta', text: bits }) : null
      ]),
      el('div', { class: 'acc-actions' }, [
        pill(r.status),
        el('a', { class: 'acc-link',
                  href: url('/account/activity', 'p=' + encodeURIComponent(r.participantId) +
                                                 '&a=' + encodeURIComponent(r.activityId)),
                  text: T.viewDetails })
      ])
    ]);
  }

  // ---- credit ----
  //
  // KEPT ON THE DASHBOARD even though payments are not built, and it renders
  // nothing until there is something to show. Cancelling in time already WRITES
  // a credit to the ledger, so removing the card would give a family credit they
  // cannot see. Today every balance is €0.00 because nothing collects money;
  // the day that changes, this is already here.
  function renderCredit(where) {
    clear(where);
    post(REGS, { action: 'balance' }).then(function (res) {
      clear(where);
      if (!res.ok || !res.data.entries || !res.data.entries.length) return;
      where.appendChild(section(T.creditTitle, [
        el('p', { class: 'acc-balance', text: money(res.data.balanceCents) })
      ].concat(res.data.entries.map(function (e) {
        return el('div', { class: 'acc-row' }, [
          el('span', { class: 'acc-meta', text: (e.createdAt || '').slice(0, 10) }),
          el('span', { text: (e.type === 'debit' ? '−' : '+') + money(e.amountCents) })
        ]);
      }))));
    });
  }

  // --------------------------------------------------------- /account/details
  //
  // TWO TABS, not four. Dietary and Accessibility are the sister project's, and
  // Ogen has neither field — a participant carries one free-text "notes
  // (allergies, medical information)" instead, which belongs to the person
  // rather than to the account.
  //
  // The tab is in the QUERY STRING so the dashboard's family card can link
  // straight to it, and so a reader who switches language keeps the tab they
  // were on — js/nav.js carries location.search across the toggle.
  function renderDetails(account) {
    clear(mount);
    mount.appendChild(head(T.profileTitle, backLink(url('/account'))));
    notice = el('div', {});
    mount.appendChild(notice);

    var tab = param('tab') === 'family' ? 'family' : 'details';
    var body = el('div', {});
    var bar = el('div', { class: 'acc-tabs', role: 'tablist' });
    [['details', T.profileTitle], ['family', T.tabFamily]].forEach(function (t) {
      bar.appendChild(el('button', {
        type: 'button', role: 'tab', 'data-tab': t[0],
        class: 'acc-tab' + (tab === t[0] ? ' is-on' : ''),
        'aria-selected': tab === t[0] ? 'true' : 'false', text: t[1],
        onclick: function () {
          // A real URL change, not just a repaint: the tab is addressable, so a
          // link to the family list from anywhere else lands on the family list.
          if (window.history && window.history.replaceState) {
            window.history.replaceState({}, '', url('/account/details', t[0] === 'family' ? 'tab=family' : ''));
          }
          tab = t[0];
          // Keyed off the value, never off the label — two tabs whose wording
          // converged in one language would silently both light up.
          Array.prototype.forEach.call(bar.children, function (b) {
            var on = b.getAttribute('data-tab') === tab;
            b.className = 'acc-tab' + (on ? ' is-on' : '');
            b.setAttribute('aria-selected', on ? 'true' : 'false');
          });
          draw();
        }
      }));
    });
    mount.appendChild(bar);
    mount.appendChild(body);

    function draw() {
      if (tab === 'family') renderFamily(body);
      else renderProfile(body, account);
    }
    draw();
  }

  // ---- the people on this account ----
  function renderFamily(where) {
    clear(where);
    post(FAMILY, { action: 'listParticipants' }).then(function (res) {
      clear(where);
      if (!res.ok) return where.appendChild(section(T.familyTitle,
        [el('p', { class: 'acc-notice is-err', text: failure(res) })]));
      var list = res.data.participants || [];
      // The account holder first when they are on the list, then everyone else.
      // Not alphabetical over the top of it: the reader knows which row is
      // theirs and should not have to find it.
      list.sort(function (a, b) {
        if (!!a.isSelf !== !!b.isSelf) return a.isSelf ? -1 : 1;
        return String(a.firstName).localeCompare(String(b.firstName), LOCALE);
      });
      var kids = list.map(function (p) { return personRow(p, where); });
      if (!list.length) kids = [el('p', { class: 'acc-intro', text: T.noParticipants })];

      // TWO BUTTONS, and the second is the whole point of this pass. Adding
      // yourself has always been possible and nothing said so.
      var hasSelf = list.some(function (p) { return p.isSelf; });
      kids.push(actions([
        el('button', { type: 'button', class: 'acc-link', text: T.addSomeone,
          onclick: function () { personForm(where, null, false); } }),
        hasSelf ? null : el('button', { type: 'button', class: 'acc-link', text: T.addSelf,
          onclick: function () { personForm(where, null, true); } })
      ].filter(Boolean)));
      where.appendChild(section(T.familyTitle, kids));
    });
  }

  function personRow(p, where) {
    var box = el('div', { class: 'acc-row' }, [
      el('div', {}, [
        el('b', {}, [
          el('span', { text: full(p) }),
          p.isSelf ? el('span', { class: 'acc-pill is-self', text: T.me }) : null
        ]),
        el('span', { class: 'acc-meta', text: T.age + ' ' + (p.age == null ? '—' : p.age) })
      ]),
      el('div', { class: 'acc-actions' }, [
        el('button', { type: 'button', class: 'acc-link', text: T.edit,
          onclick: function () { personForm(where, p, !!p.isSelf); } }),
        el('button', { type: 'button', class: 'acc-link', text: T.manages,
          onclick: function () { guardiansFor(box, p); } })
      ])
    ]);
    return box;
  }

  function personForm(where, existing, isSelf) {
    var f = field(T.firstName, { required: 'required' });
    var l = field(T.lastName, {});
    var d = field(T.dob, { type: 'date', required: 'required' });
    var n = field(T.notes, {});
    if (existing) {
      f.input.value = existing.firstName; l.input.value = existing.lastName;
      d.input.value = existing.dateOfBirth; n.input.value = existing.notes || '';
    } else if (isSelf && S.account) {
      // Adding yourself, from what the account already knows. Retyping your own
      // name into a form that is showing it three lines above is a step that
      // exists only because nothing filled it in.
      var prof = S.account.profile || {};
      f.input.value = prof.firstName || '';
      l.input.value = prof.lastName || '';
    }
    var go = el('button', { type: 'submit', class: 'btn-primary', text: T.save });
    var form = el('form', { class: 'acc-inline', onsubmit: function (e) {
      e.preventDefault();
      go.disabled = true;
      post(FAMILY, {
        action: existing ? 'updateParticipant' : 'createParticipant',
        participantId: existing ? existing.participantId : undefined,
        // Only on create: which of the two buttons was pressed. It is written
        // onto the LINK, so it says "this participant is the person holding this
        // account" rather than making any claim about the participant.
        isSelf: existing ? undefined : !!isSelf,
        participant: { firstName: f.input.value, lastName: l.input.value,
                       dateOfBirth: d.input.value, notes: n.input.value }
      }).then(function (res) {
        go.disabled = false;
        if (!res.ok) return say('err', failure(res));
        renderFamily(where);
      });
    } }, [f.row, l.row, d.row, n.row,
          // WRAPPED, because these are built with createElement and adjacent
          // siblings made that way have no whitespace text node between them —
          // so the cancel link sat flush against the Save button's rounded edge
          // with literally zero gap. Inline-block spacing that "usually just
          // works" in hand-written HTML does not exist here at all.
          actions([go, el('button', { type: 'button', class: 'acc-link', text: T.cancel,
                                      onclick: function () { renderFamily(where); } })])]);
    clear(where);
    where.appendChild(section(isSelf && !existing ? T.addSelf : T.familyTitle, [form]));
  }

  function guardiansFor(box, p) {
    post(FAMILY, { action: 'listGuardians', participantId: p.participantId }).then(function (res) {
      if (!res.ok) return say('err', failure(res));
      var existing = box.querySelector('.acc-sub');
      if (existing) { box.removeChild(existing); return; }
      var sub = el('div', { class: 'acc-sub' });
      sub.appendChild(el('h3', { class: 'acc-group', text: full(p) + ' · ' + T.manages }));
      (res.data.guardians || []).forEach(function (g) {
        sub.appendChild(el('div', { class: 'acc-row' }, [
          el('span', { text: (g.name || g.email) + (g.isPrimary ? ' · ' + T.primary : '') })
        ]));
      });
      // `pendingInvites`, and the server has already filtered them — an invite
      // expires LAZILY, on read, so the client must not second-guess the status
      // it is handed.
      (res.data.pendingInvites || []).forEach(function (i) {
          sub.appendChild(el('div', { class: 'acc-row' }, [
            el('span', { text: i.invitedEmail + ' · ' + T.invitePending }),
            actions([
              el('button', { type: 'button', class: 'acc-link', text: T.inviteResend, onclick: function () {
                post(FAMILY, { action: 'resendInvite', participantId: p.participantId, inviteToken: i.token })
                  .then(function (r) { say(r.ok ? 'ok' : 'err', r.ok ? T.saved : failure(r)); });
              } }),
              el('button', { type: 'button', class: 'acc-link', text: T.inviteRevoke, onclick: function () {
                post(FAMILY, { action: 'revokeInvite', participantId: p.participantId, inviteToken: i.token })
                  .then(function (r) { if (!r.ok) return say('err', failure(r)); box.removeChild(sub); });
              } })
            ])
          ]));
        });

      // INVITING IS THE PRIMARY GUARDIAN'S ALONE. A second guardian may see and
      // act; they may not bring in a third. The server enforces it — this only
      // avoids offering an action that would be refused.
      if (res.data.iAmPrimary && (res.data.guardians || []).length < (res.data.maxGuardians || 2)) {
        var ie = field(T.inviteEmail, { type: 'email', required: 'required' });
        var ib = el('button', { type: 'submit', class: 'btn-primary', text: T.inviteSend });
        sub.appendChild(el('form', { class: 'acc-inline', onsubmit: function (e) {
          e.preventDefault();
          ib.disabled = true;
          post(FAMILY, { action: 'invite', participantId: p.participantId, email: ie.input.value })
            .then(function (r) {
              ib.disabled = false;
              if (!r.ok) return say('err', failure(r));
              say('ok', T.saved);
              box.removeChild(sub);
            });
        } }, [el('h3', { text: T.inviteGuardian }), ie.row, ib]));
      }

      // A PARTICIPANT IS NEVER LEFT WITH NO GUARDIAN, so this is offered only
      // when somebody else would remain. The server refuses it either way.
      //
      // And NEVER ON YOUR OWN RECORD. "Remove myself from this record" on the
      // record that is you is a sentence with no meaning — you would be handing
      // your own attendance to somebody else and losing sight of it.
      if (!p.isSelf && (res.data.guardians || []).length > 1) {
        sub.appendChild(el('button', { type: 'button', class: 'acc-link is-danger', text: T.leave,
          onclick: function () {
            if (!window.confirm(T.leaveConfirm)) return;
            post(FAMILY, { action: 'leaveParticipant', participantId: p.participantId })
              .then(function (r) {
                if (!r.ok) return say('err', failure(r));
                boot();
              });
          } }));
      }
      box.appendChild(sub);
    });
  }

  // ---- profile ----
  function renderProfile(where, account) {
    clear(where);
    var p = account.profile || {};
    var f = field(T.firstName, {}); f.input.value = p.firstName || '';
    var l = field(T.lastName, {}); l.input.value = p.lastName || '';
    var ph = field(T.phone, { type: 'tel' }); ph.input.value = p.phone || '';
    var langSel = el('select', {});
    [['he', 'עברית'], ['en', 'English'], ['ru', 'Русский']].forEach(function (o) {
      langSel.appendChild(el('option', { value: o[0], text: o[1],
        selected: o[0] === (p.preferredLanguage || lang) || null }));
    });
    var go = el('button', { type: 'submit', class: 'btn-primary', text: T.save });

    // THE EMAIL IS SHOWN AND NOT EDITABLE. Identity here is an accountId and the
    // address is a pointer to it, so changing one is three writes with no
    // transaction — buildable, and not built. Showing it read-only with a line
    // saying so is honest; leaving it out entirely would leave a person unable
    // to check which address they signed up with.
    var em = field(T.email, { type: 'email', readonly: 'readonly' });
    em.input.value = account.email || '';
    em.row.appendChild(el('span', { class: 'acc-meta', text: T.emailFixed }));

    var cur = field(T.currentPassword, { type: 'password', autocomplete: 'current-password' });
    var nw = field(T.newPassword, { type: 'password', autocomplete: 'new-password' });
    var pgo = el('button', { type: 'submit', class: 'btn-primary', text: T.changePassword });

    where.appendChild(section(T.profileTitle, [
      el('form', { onsubmit: function (e) {
        e.preventDefault();
        go.disabled = true;
        post(AUTH, { action: 'updateProfile', profile: {
          firstName: f.input.value, lastName: l.input.value,
          phone: ph.input.value, preferredLanguage: langSel.value
        } }).then(function (res) {
          go.disabled = false;
          if (!res.ok) return say('err', failure(res));
          // The cached name feeds the nav chip's initial, so a change of name
          // has to reach it or the letter in the bar keeps saying who somebody
          // used to be. The EXPIRY IS CARRIED OVER rather than dropped: it is
          // the client's cheap "is this token obviously dead" check, and writing
          // a session without one makes every dead token cost a round trip.
          if (res.data && res.data.account) S.account = res.data.account;
          var held = window.MemberSession.get() || {};
          window.MemberSession.set(sessionFor({
            token: held.token, expiresAt: held.expiresAt, account: S.account
          }));
          say('ok', T.saved);
        });
      } }, [f.row, l.row, em.row, ph.row,
            el('div', { class: 'acc-field' }, [el('label', { text: T.prefLang }), langSel]), go]),
      el('form', { class: 'acc-inline', onsubmit: function (e) {
        e.preventDefault();
        pgo.disabled = true;
        post(AUTH, { action: 'changePassword', currentPassword: cur.input.value,
                     newPassword: nw.input.value }).then(function (res) {
          pgo.disabled = false;
          if (!res.ok) return say('err', failure(res));
          // A password change ends every OTHER session and deliberately keeps
          // this one — the person is standing here and should not be signed out
          // of the device they are using. So there is no new token to take, and
          // the session in localStorage stays valid.
          //
          // A RESET is the opposite and ends this one too, because a reset
          // exists on the assumption somebody may have lost control of the
          // account.
          cur.input.value = ''; nw.input.value = '';
          say('ok', T.saved);
        });
      } }, [el('h3', { text: T.changePassword }), cur.row, nw.row, pgo])
    ]));
  }

  // ------------------------------------------------------- /account/activity
  //
  // ONE REGISTRATION, in full: what it is, what it costs, what is paid, and —
  // for a pay-per-session activity — which evenings. This is the screen the
  // dashboard rows lead to, and the only place "paid" and "attended" appear.
  //
  // It is addressed by participantId AND activityId, because that pair is the
  // registration's key. A slug would not do: `activitySlugAtSubmission` is audit
  // only, and following it after a rename opens the wrong record or none.
  function renderActivity() {
    clear(mount);
    notice = el('div', {});
    var body = el('div', {});
    var p = param('p'), a = param('a');
    mount.appendChild(head(T.activitiesTitle, backLink(url('/account'))));
    mount.appendChild(notice);
    mount.appendChild(body);
    if (!p || !a) return body.appendChild(section(null,
      [el('p', { class: 'acc-notice is-err', text: T.regNotFound })]));

    body.appendChild(section(null, [el('p', { class: 'acc-intro', text: T.loading })]));
    post(REGS, { action: 'registration', participantId: p, activityId: a }).then(function (res) {
      clear(body);
      if (!res.ok) return body.appendChild(section(null,
        [el('p', { class: 'acc-notice is-err', text: failure(res) })]));
      var r = res.data.registration, act = res.data.activity;

      // The heading is the activity and the line under it is who — the row that
      // led here said both, and this page is about one of the two.
      mount.replaceChild(head(pick(r.title), backLink(url('/account'))), mount.firstChild);
      body.appendChild(el('p', { class: 'acc-sub-head' }, [
        el('b', { text: r.participantName }),
        pill(r.status),
        pick(r.groupName) ? el('span', { class: 'acc-meta', text: pick(r.groupName) }) : null
      ]));

      if (!act) body.appendChild(el('p', { class: 'acc-notice is-warn', text: T.activityGone }));
      else body.appendChild(factsBlock(act));

      body.appendChild(costBlock(r, act));

      // The sessions. A course lists the dates it meets on, which is the same
      // table the published page carries. A drop-in lists the evenings with what
      // each one is, what it cost, and whether it can still be booked or given
      // back — an activity paid for one evening at a time is the only place
      // "attended" means anything.
      if (r.type === 'dropin') renderEvenings(body, r, act);
      else if (act && act.sessionRows && act.sessionRows.length) {
        body.appendChild(section(T.sessionsTitle, [courseSessions(act.sessionRows)]));
      }

      // Offered only when the frozen terms allow it. The same creditFor() the
      // server will apply decided this, so what is shown is what happens.
      if ((r.status === 'pending' || r.status === 'approved') &&
          r.cancellation && r.cancellation.guardianMayCancel !== false) {
        body.appendChild(actions([
          el('button', { type: 'button', class: 'acc-link is-danger', text: T.cancelReg,
            onclick: function () {
              if (!window.confirm(T.cancelRegConfirm)) return;
              post(REGS, { action: 'cancel', participantId: r.participantId, activityId: r.activityId })
                .then(function (c) {
                  if (!c.ok) return say('err', failure(c));
                  window.location.href = url('/account');
                });
            } })
        ]));
      }
    });
  }

  // THE SAME FACTS THE PUBLIC PAGE SHOWS, built by the same module on the
  // server. Nothing members-only reaches here: isPubliclyVisible() filtered the
  // rows exactly as it does for the static page, so the exact address is still
  // not published — the authenticated view that would serve it is not built.
  function factsBlock(act) {
    return el('div', { class: 'acc-facts' }, (act.facts || []).map(function (g) {
      return el('div', { class: 'acc-fact' }, [
        el('h3', { text: g.heading })
      ].concat(g.facts.map(function (f) {
        return el('p', {}, [
          el('b', { text: f.label }),
          el('span', { text: f.value })
        ]);
      })));
    }));
  }

  // What it costs, and what is left. ROWS, NEVER A TOTAL of the fee and the
  // term price: the fee is charged once a year and the course once a semester,
  // so their sum is a figure nobody is ever billed. The figures come from
  // priceRows() on the server, the same builder the public page uses.
  function costBlock(r, act) {
    var rows = (act && act.priceRows) || [];
    var kids = rows.map(function (row) {
      return el('div', { class: 'acc-money' }, [
        el('span', {}, [
          el('span', { text: row.label }),
          row.note ? el('span', { class: 'acc-note', text: row.note }) : null
        ]),
        el('b', { text: row.value })
      ]);
    });
    // Why 300 and not 350. The waiver is per participant, per activity, per
    // academic year, and a family looking at a second term should be able to see
    // that rather than wonder.
    kids.push(el('p', { class: 'acc-meta', text: r.feeCharged === false ? T.feeAlready : T.feeIncluded }));
    kids.push(el('div', { class: 'acc-money is-sum' }, [
      el('span', { text: T.paid }), el('b', { text: money(r.paidCents) })
    ]));
    if (r.creditedCents) {
      kids.push(el('div', { class: 'acc-money' }, [
        el('span', { text: T.credited }), el('b', { text: money(r.creditedCents) })
      ]));
    }
    var left = r.owedCents == null ? null
      : Math.max(0, r.owedCents - (r.paidCents || 0) - (r.creditedCents || 0));
    kids.push(el('div', { class: 'acc-money is-sum' }, [
      el('span', { text: T.stillToPay }), el('b', { text: money(left) })
    ]));

    // THE PAY BUTTON, and what decides whether it is drawn.
    //
    // Cosmetic, like every permission check on this side: the server re-decides
    // all of it, and the copy exists so a family is not offered an action about
    // to be refused. The three conditions mirror the two gates in the `pay`
    // branch of account-registrations.js plus the obvious one.
    //
    // A refusal is SHOWN RATHER THAN HIDDEN when it is something the reader can
    // fix. An unverified account gets a line saying so, because the resend
    // button is on the dashboard and a missing button explains nothing; a
    // registration still awaiting approval gets a line too, because "wait" is
    // the answer and silence is not. Only a settled balance draws nothing,
    // since the figures above already say why.
    if (left > 0 && r.status === 'approved' && S.account && S.account.emailVerifiedAt) {
      var go = el('button', { type: 'submit', class: 'btn-primary', text: T.payNow });
      var payForm = el('form', { onsubmit: function (e) {
        e.preventDefault();
        go.disabled = true;
        go.textContent = T.payOpening;
        post(REGS, { action: 'pay', participantId: r.participantId, activityId: r.activityId })
          .then(function (res) {
            // Stripe Checkout is a redirect, not a fetch. On failure the button
            // has to come back, or a transient error leaves a dead control.
            if (res.ok && res.data && res.data.url) { location.href = res.data.url; return; }
            go.disabled = false;
            go.textContent = T.payNow;
            say('err', failure(res));
          });
      } }, [go]);
      kids.push(payForm);
    } else if (left > 0 && r.status === 'approved') {
      kids.push(el('p', { class: 'acc-note', text: T.payNeedsVerify }));
    } else if (left > 0) {
      kids.push(el('p', { class: 'acc-note', text: T.payNeedsApproval }));
    }
    return section(T.costTitle, kids);
  }

  // The dates a course meets on, exactly the list the published page carries —
  // sessions that are happening and nothing else, so the numbering is free: if
  // nothing skipped is shown, nothing skipped can take a number.
  function courseSessions(rows) {
    var table = el('table', { class: 'acc-table' });
    rows.forEach(function (row) {
      table.appendChild(el('tr', {}, [
        el('td', { text: row.label }),
        el('td', { text: row.day }),
        el('td', { text: row.date })
      ]));
    });
    return el('div', { class: 'acc-scroll' }, [table]);
  }

  // ---- the evenings of a drop-in ----
  function renderEvenings(where, r, act) {
    var panel = el('div', {});
    where.appendChild(panel);
    if (!act) return;
    draw();

    function draw() {
      clear(panel);
      panel.appendChild(section(T.sessionsTitle, [el('p', { class: 'acc-intro', text: T.loading })]));
      post(REGS, { action: 'sessions', participantId: r.participantId, slug: act.slug })
        .then(function (res) {
          clear(panel);
          if (!res.ok) return panel.appendChild(section(T.sessionsTitle,
            [el('p', { class: 'acc-notice is-err', text: failure(res) })]));
          var table = el('table', { class: 'acc-table' });
          table.appendChild(el('tr', {}, [
            el('th', { text: T.dateCol }), el('th', { text: T.statusCol }),
            el('th', { class: 'is-num', text: T.owes }), el('th', { class: 'is-num', text: T.paid }),
            el('th', {})
          ]));
          (res.data.sessions || []).forEach(function (s) {
            table.appendChild(el('tr', {}, [
              el('td', { text: dayMonth(s.date) }),
              el('td', {}, [s.status
                ? el('span', { class: 'acc-pill is-s-' + s.status,
                               text: T.sessionStatus[s.status] || s.status })
                : el('span', { class: 'acc-meta', text: '—' })]),
              el('td', { class: 'is-num', text: money(s.owedCents) }),
              el('td', { class: 'is-num', text: money(s.paidCents) }),
              el('td', {}, [eveningAction(s, res.data, r, act, draw)])
            ]));
          });
          panel.appendChild(section(T.sessionsTitle, [el('div', { class: 'acc-scroll' }, [table])]));
        });
    }
  }

  // Book, give back, or nothing. BOOKING NEEDS AN APPROVED REGISTRATION behind
  // it — the registration is the "may come" decision and an admin makes it once,
  // so this does not quietly become a second way in. Cancelling is offered past
  // the deadline too, because a family can always say they are not coming; what
  // changes past it is only what it earns, and creditForSession() on the server
  // decided that before this button was drawn.
  function eveningAction(s, data, r, act, redraw) {
    if (s.status === 'booked') {
      return el('button', { type: 'button', class: 'acc-link is-danger', text: T.cancelSession,
        onclick: function () {
          if (!window.confirm(T.cancelSessionConfirm)) return;
          post(REGS, { action: 'cancelSession', participantId: r.participantId,
                       activityId: r.activityId, sessionDate: s.date }).then(function (c) {
            if (!c.ok) return say('err', failure(c));
            redraw();
          });
        } });
    }
    if (s.status === 'attended' || s.status === 'no-show') return null;
    if (!data.mayBook || s.full) return null;
    return el('button', { type: 'button', class: 'acc-link', text: T.book,
      onclick: function () {
        post(REGS, { action: 'bookSession', participantId: r.participantId,
                     slug: act.slug, sessionDate: s.date }).then(function (b) {
          if (!b.ok) return say('err', failure(b));
          redraw();
        });
      } });
  }

  // ------------------------------------------------ the token-bearing views --
  function renderVerify() {
    clear(mount);
    notice = el('div', {});
    mount.appendChild(notice);
    var token = param('token');
    if (!token) return mount.appendChild(section(null, [el('p', { class: 'acc-notice is-err', text: T.linkDead })]));
    post(AUTH, { action: 'verifyEmail', token: token }).then(function (res) {
      mount.appendChild(section(null, [
        el('p', { class: 'acc-notice is-' + (res.ok ? 'ok' : 'err'),
                  text: res.ok ? T.verifyOk : failure(res) }),
        el('p', {}, [el('a', { href: url('/account'), text: T.signInTitle })])
      ]));
    });
  }

  function renderReset() {
    clear(mount);
    notice = el('div', {});
    mount.appendChild(notice);
    var token = param('token');
    if (!token) return mount.appendChild(section(null, [el('p', { class: 'acc-notice is-err', text: T.linkDead })]));
    var p1 = field(T.newPassword, { type: 'password', required: 'required', autocomplete: 'new-password' });
    var go = el('button', { type: 'submit', class: 'btn-primary', text: T.resetSave });
    mount.appendChild(section(T.resetTitle, [
      el('form', { onsubmit: function (e) {
        e.preventDefault();
        go.disabled = true;
        // A reset ENDS EVERY OTHER SESSION: a reset exists because somebody may
        // have lost control of the account, and leaving the others alive would
        // lock out the owner while whoever took it stayed signed in.
        post(AUTH, { action: 'resetPassword', token: token, password: p1.input.value })
          .then(function (res) {
            go.disabled = false;
            if (!res.ok) return say('err', failure(res));
            clear(mount);
            mount.appendChild(section(null, [
              el('p', { class: 'acc-notice is-ok', text: T.resetDone }),
              el('p', {}, [el('a', { href: url('/account'), text: T.signIn })])
            ]));
          });
      } }, [p1.row, go])
    ]));
  }

  function renderInvite() {
    clear(mount);
    notice = el('div', {});
    mount.appendChild(notice);
    var token = param('token');
    var body = el('div', {});
    mount.appendChild(body);
    if (!token) return body.appendChild(section(null, [el('p', { class: 'acc-notice is-err', text: T.linkDead })]));

    // `inviteToken`, never `token`. The session token travels as `token`, so an
    // invite action reusing that name would hand a session token to
    // acceptInvite() — which then calls a perfectly valid invitation invalid.
    post(FAMILY, { action: 'inviteDetails', inviteToken: token }).then(function (res) {
      if (!res.ok) return body.appendChild(section(T.inviteTitle,
        [el('p', { class: 'acc-notice is-err', text: failure(res) })]));
      var inv = res.data.invite;
      var header = [
        el('p', { class: 'acc-intro', text: T.inviteFor + ' ' + inv.participantFirstName }),
        inv.invitedByName ? el('p', { class: 'acc-meta', text: T.inviteBy + ' ' + inv.invitedByName }) : null
      ];

      var accept = function () {
        post(FAMILY, { action: 'acceptInvite', inviteToken: token }).then(function (a) {
          if (!a.ok) return say('err', failure(a));
          clear(body);
          body.appendChild(section(null, [
            el('p', { class: 'acc-notice is-ok', text: T.inviteDone }),
            el('p', {}, [el('a', { href: url('/account'), text: T.familyTitle })])
          ]));
        });
      };

      if (window.MemberSession.token()) {
        return body.appendChild(section(T.inviteTitle, header.concat([
          el('button', { type: 'button', class: 'btn-primary', text: T.inviteAccept, onclick: accept })
        ])));
      }
      // Signed out: one page, two doors. Signing in or signing up both end in
      // the same accept, because the invitation arriving in that inbox IS the
      // verification — there is no separate round trip to make somebody do.
      var where = el('div', {});
      body.appendChild(section(T.inviteTitle, header.concat([where])));
      // `hasAccount` is why this needs no second round trip: the invited person
      // is shown the door they actually need. It reveals nothing they do not
      // already know about their own address.
      renderSignedOut(where, {
        mode: inv.hasAccount ? 'signin' : 'signup',
        intro: inv.hasAccount ? T.inviteSignIn : T.inviteSignUp,
        email: inv.invitedEmail, onSignedIn: accept
      });
    });
  }

  // ----------------------------------------------------------------- boot ---
  //
  // The account, once, for whichever signed-in view this page is. S is the only
  // state this script keeps; every screen re-reads its own data from the server
  // rather than sharing a cache, because a family area that shows a stale price
  // is worse than one that waits a moment.
  var S = { account: null };

  function boot() {
    if (!mount) return;
    clear(mount);
    notice = el('div', {});
    mount.appendChild(notice);
    var body = el('div', {});
    mount.appendChild(body);

    if (view === 'verify') return renderVerify();
    if (view === 'reset') return renderReset();
    if (view === 'invite') return renderInvite();

    if (!window.MemberSession.token()) return renderSignedOut(body, {});
    post(AUTH, { action: 'me' }).then(function (res) {
      if (!res.ok) return renderSignedOut(body, {});
      S.account = res.data.account;
      // Refresh the cached name on every visit, so the nav chip is right for
      // somebody who signed in before it existed, and follows a change of name
      // rather than showing the letter they first registered under.
      window.MemberSession.set(sessionFor({
        token: window.MemberSession.token(),
        expiresAt: res.data.expiresAt,
        account: res.data.account
      }));
      if (view === 'details') return renderDetails(S.account);
      if (view === 'activity') return renderActivity();
      renderAccount(S.account);
    });
  }

  boot();
})();
