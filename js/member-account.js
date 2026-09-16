// The family area — Phase 6, and the first thing on this site a family signs
// into.
//
// ONE SCRIPT, ONE STRING TABLE, THREE LANGUAGES, exactly as js/nav.js,
// js/footer.js and js/contact-form.js each do. The pages under /account are
// empty shells with a mount point; everything a person reads is in T below, so
// a wording change is an edit to a table rather than to twelve HTML files. The
// alternative — body copy in each page, in triplicate, times four views — is
// the shape that guarantees the Russian drifts from the Hebrew.
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
      inviteTitle: 'הזמנה להצטרף', inviteFor: 'הוזמנתם להיות אפוטרופוס נוסף עבור',
      inviteBy: 'ההזמנה נשלחה על ידי',
      inviteSignIn: 'היכנסו לחשבון שלכם כדי לקבל את ההזמנה.',
      inviteSignUp: 'אין לכם חשבון? פתחו חשבון עם אותה כתובת דוא״ל.',
      inviteAccept: 'קבלת ההזמנה', inviteDone: 'ההזמנה התקבלה.',
      hello: 'שלום', signOut: 'יציאה',
      childrenTitle: 'הילדים שלי', addChild: 'הוספת משתתף/ת',
      noChildren: 'עדיין לא הוספתם משתתפים.',
      dob: 'תאריך לידה', notes: 'הערות (אלרגיות, מידע רפואי)',
      save: 'שמירה', cancel: 'ביטול', age: 'גיל',
      guardians: 'אפוטרופוסים', primary: 'אפוטרופוס ראשי',
      inviteGuardian: 'הזמנת אפוטרופוס שני', inviteEmail: 'כתובת דוא״ל',
      inviteSend: 'שליחת הזמנה', invitePending: 'הזמנה ממתינה',
      inviteResend: 'שליחה מחדש', inviteRevoke: 'ביטול הזמנה',
      leave: 'הסרת עצמי מהרשומה',
      leaveConfirm: 'להסיר את עצמכם מהרשומה של המשתתף/ת הזה/זו?',
      regsTitle: 'ההרשמות שלי', noRegs: 'אין עדיין הרשמות.',
      cancelReg: 'ביטול הרשמה', cancelRegConfirm: 'לבטל את ההרשמה?',
      creditTitle: 'יתרת זיכוי', noCredit: 'אין יתרת זיכוי.',
      profileTitle: 'הפרטים שלי', changePassword: 'שינוי סיסמה',
      currentPassword: 'סיסמה נוכחית', saved: 'נשמר.',
      registerTitle: 'הרשמה לפעילות', registerWho: 'מי נרשם/ת?',
      registerGroup: 'קבוצה', registerGo: 'שליחת בקשה',
      registerFull: 'הפעילות מלאה.', registerDone: 'הבקשה נשלחה.',
      owes: 'לתשלום', paid: 'שולם', feeIncluded: 'כולל דמי הרשמה שנתיים',
      feeAlready: 'דמי ההרשמה השנתיים כבר שולמו',
      places: 'מקומות פנויים', unlimited: 'ללא הגבלה',
      loading: 'טוען…', problem: 'משהו השתבש. נסו שוב.',
      offline: 'אין חיבור לשרת. נסו שוב בעוד רגע.',
      status: { pending: 'ממתין לאישור', approved: 'מאושר', rejected: 'לא אושר',
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
      inviteTitle: 'An invitation to join', inviteFor: 'You have been invited to be a second guardian for',
      inviteBy: 'Invited by',
      inviteSignIn: 'Sign in to your account to accept.',
      inviteSignUp: 'No account? Create one with the same email address.',
      inviteAccept: 'Accept the invitation', inviteDone: 'Invitation accepted.',
      hello: 'Hello', signOut: 'Sign out',
      childrenTitle: 'My children', addChild: 'Add a participant',
      noChildren: 'You have not added anyone yet.',
      dob: 'Date of birth', notes: 'Notes (allergies, medical information)',
      save: 'Save', cancel: 'Cancel', age: 'Age',
      guardians: 'Guardians', primary: 'Primary guardian',
      inviteGuardian: 'Invite a second guardian', inviteEmail: 'Email address',
      inviteSend: 'Send invitation', invitePending: 'Invitation pending',
      inviteResend: 'Send again', inviteRevoke: 'Withdraw',
      leave: 'Remove myself from this record',
      leaveConfirm: 'Remove yourself as a guardian for this participant?',
      regsTitle: 'My registrations', noRegs: 'No registrations yet.',
      cancelReg: 'Cancel registration', cancelRegConfirm: 'Cancel this registration?',
      creditTitle: 'Credit', noCredit: 'No credit on this account.',
      profileTitle: 'My details', changePassword: 'Change password',
      currentPassword: 'Current password', saved: 'Saved.',
      registerTitle: 'Register for an activity', registerWho: 'Who is registering?',
      registerGroup: 'Group', registerGo: 'Send the request',
      registerFull: 'This activity is full.', registerDone: 'Your request has been sent.',
      owes: 'To pay', paid: 'Paid', feeIncluded: 'includes the yearly registration fee',
      feeAlready: 'yearly registration fee already paid',
      places: 'places left', unlimited: 'no limit',
      loading: 'Loading…', problem: 'Something went wrong. Please try again.',
      offline: 'Could not reach the server. Try again in a moment.',
      status: { pending: 'Waiting for an answer', approved: 'Confirmed', rejected: 'Not offered',
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
      inviteTitle: 'Приглашение', inviteFor: 'Вас приглашают стать вторым опекуном для',
      inviteBy: 'Пригласил(а)',
      inviteSignIn: 'Войдите в свою учётную запись, чтобы принять приглашение.',
      inviteSignUp: 'Нет учётной записи? Создайте её с тем же адресом электронной почты.',
      inviteAccept: 'Принять приглашение', inviteDone: 'Приглашение принято.',
      hello: 'Здравствуйте', signOut: 'Выйти',
      childrenTitle: 'Мои дети', addChild: 'Добавить участника',
      noChildren: 'Вы ещё никого не добавили.',
      dob: 'Дата рождения', notes: 'Примечания (аллергии, медицинская информация)',
      save: 'Сохранить', cancel: 'Отмена', age: 'Возраст',
      guardians: 'Опекуны', primary: 'Основной опекун',
      inviteGuardian: 'Пригласить второго опекуна', inviteEmail: 'Адрес электронной почты',
      inviteSend: 'Отправить приглашение', invitePending: 'Приглашение отправлено',
      inviteResend: 'Отправить снова', inviteRevoke: 'Отозвать',
      leave: 'Удалить себя из этой записи',
      leaveConfirm: 'Удалить себя как опекуна этого участника?',
      regsTitle: 'Мои записи', noRegs: 'Записей пока нет.',
      cancelReg: 'Отменить запись', cancelRegConfirm: 'Отменить эту запись?',
      creditTitle: 'Кредит', noCredit: 'Кредита на этой учётной записи нет.',
      profileTitle: 'Мои данные', changePassword: 'Изменить пароль',
      currentPassword: 'Текущий пароль', saved: 'Сохранено.',
      registerTitle: 'Запись на занятие', registerWho: 'Кто записывается?',
      registerGroup: 'Группа', registerGo: 'Отправить заявку',
      registerFull: 'Свободных мест нет.', registerDone: 'Заявка отправлена.',
      owes: 'К оплате', paid: 'Оплачено', feeIncluded: 'включая годовой регистрационный взнос',
      feeAlready: 'годовой регистрационный взнос уже оплачен',
      places: 'свободных мест', unlimited: 'без ограничения',
      loading: 'Загрузка…', problem: 'Что-то пошло не так. Попробуйте ещё раз.',
      offline: 'Не удалось связаться с сервером. Попробуйте через минуту.',
      status: { pending: 'Ожидает ответа', approved: 'Подтверждено', rejected: 'Не предложено',
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

  function section(title, kids) {
    return el('section', { class: 'acc-card' },
      [title ? el('h2', { text: title }) : null].concat(kids || []));
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

  // ---------------------------------------------------------- signed in -----
  function renderAccount(account) {
    clear(mount);
    mount.appendChild(el('div', { class: 'acc-head' }, [
      el('h1', { text: T.hello + ', ' + ((account.profile && account.profile.firstName) || account.email) }),
      el('button', { type: 'button', class: 'acc-link', text: T.signOut, onclick: function () {
        post(AUTH, { action: 'signout' }).then(function () {
          window.MemberSession.clear();
          boot();
        });
      } })
    ]));
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
      register: el('div', {}), children: el('div', {}),
      regs: el('div', {}), credit: el('div', {}), profile: el('div', {})
    };
    Object.keys(panels).forEach(function (k) { mount.appendChild(panels[k]); });

    if (slug) renderRegister(panels.register, slug);
    renderChildren(panels.children);
    renderRegistrations(panels.regs);
    renderCredit(panels.credit);
    renderProfile(panels.profile, account);
  }

  // ---- registering for an activity ----
  function renderRegister(where, slug) {
    clear(where);
    where.appendChild(section(T.registerTitle, [el('p', { class: 'acc-intro', text: T.loading })]));
    Promise.all([
      post(REGS, { action: 'activity', slug: slug }),
      post(FAMILY, { action: 'listParticipants' })
    ]).then(function (r) {
      var act = r[0], kids = r[1];
      clear(where);
      if (!act.ok) return where.appendChild(section(T.registerTitle,
        [el('p', { class: 'acc-notice is-err', text: failure(act) })]));
      var a = act.data.activity;
      var children = (kids.data && kids.data.participants) || [];

      var who = el('select', {});
      children.forEach(function (c) {
        who.appendChild(el('option', { value: c.participantId,
          text: [c.firstName, c.lastName].filter(Boolean).join(' ') }));
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
                              disabled: !children.length || null });
      var form = el('form', { onsubmit: function (e) {
        e.preventDefault();
        go.disabled = true;
        post(REGS, { action: 'submit', slug: slug, participantId: who.value,
                     groupId: groupSel ? groupSel.value : null }).then(function (res) {
          go.disabled = false;
          if (!res.ok) return say('err', failure(res));
          say('ok', T.registerDone);
          renderRegistrations(document.getElementById('acc-regs') || where.nextSibling);
          boot();
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
        children.length ? form : el('p', { class: 'acc-intro', text: T.noChildren })
      ]));
    });
  }

  // ---- the children ----
  function renderChildren(where) {
    clear(where);
    post(FAMILY, { action: 'listParticipants' }).then(function (res) {
      clear(where);
      if (!res.ok) return where.appendChild(section(T.childrenTitle,
        [el('p', { class: 'acc-notice is-err', text: failure(res) })]));
      var list = res.data.participants || [];
      var kids = list.map(function (p) { return childRow(p, where); });
      if (!list.length) kids = [el('p', { class: 'acc-intro', text: T.noChildren })];
      kids.push(el('button', { type: 'button', class: 'acc-link', text: T.addChild,
        onclick: function () { childForm(where, null); } }));
      where.appendChild(section(T.childrenTitle, kids));
    });
  }

  function childRow(p, where) {
    var name = [p.firstName, p.lastName].filter(Boolean).join(' ');
    var box = el('div', { class: 'acc-row' }, [
      el('div', {}, [
        el('b', { text: name }),
        el('span', { class: 'acc-meta', text: T.age + ' ' + (p.age == null ? '—' : p.age) })
      ]),
      el('button', { type: 'button', class: 'acc-link', text: T.guardians, onclick: function () {
        guardiansFor(box, p);
      } })
    ]);
    return box;
  }

  function childForm(where, existing) {
    var f = field(T.firstName, { required: 'required' });
    var l = field(T.lastName, {});
    var d = field(T.dob, { type: 'date', required: 'required' });
    var n = field(T.notes, {});
    if (existing) {
      f.input.value = existing.firstName; l.input.value = existing.lastName;
      d.input.value = existing.dateOfBirth; n.input.value = existing.notes || '';
    }
    var go = el('button', { type: 'submit', class: 'btn-primary', text: T.save });
    var form = el('form', { class: 'acc-inline', onsubmit: function (e) {
      e.preventDefault();
      go.disabled = true;
      post(FAMILY, {
        action: existing ? 'updateParticipant' : 'createParticipant',
        participantId: existing ? existing.participantId : undefined,
        participant: { firstName: f.input.value, lastName: l.input.value,
                       dateOfBirth: d.input.value, notes: n.input.value }
      }).then(function (res) {
        go.disabled = false;
        if (!res.ok) return say('err', failure(res));
        renderChildren(where);
      });
    } }, [f.row, l.row, d.row, n.row, go,
          el('button', { type: 'button', class: 'acc-link', text: T.cancel,
                         onclick: function () { renderChildren(where); } })]);
    clear(where);
    where.appendChild(section(T.childrenTitle, [form]));
  }

  function guardiansFor(box, p) {
    post(FAMILY, { action: 'listGuardians', participantId: p.participantId }).then(function (res) {
      if (!res.ok) return say('err', failure(res));
      var existing = box.querySelector('.acc-sub');
      if (existing) { box.removeChild(existing); return; }
      var sub = el('div', { class: 'acc-sub' });
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
            el('span', {}, [
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
      if ((res.data.guardians || []).length > 1) {
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

  // ---- registrations ----
  function renderRegistrations(where) {
    if (!where) return;
    where.id = 'acc-regs';
    clear(where);
    post(REGS, { action: 'list' }).then(function (res) {
      clear(where);
      if (!res.ok) return where.appendChild(section(T.regsTitle,
        [el('p', { class: 'acc-notice is-err', text: failure(res) })]));
      var list = res.data.registrations || [];
      if (!list.length) {
        return where.appendChild(section(T.regsTitle, [el('p', { class: 'acc-intro', text: T.noRegs })]));
      }
      where.appendChild(section(T.regsTitle, list.map(function (r) {
        var bits = [
          el('div', {}, [
            el('b', { text: r.participantName }),
            el('span', { class: 'acc-meta', text: pick(r.title) +
              (r.groupName ? ' · ' + pick(r.groupName) : '') })
          ]),
          el('div', {}, [
            el('span', { class: 'acc-pill is-' + r.status, text: T.status[r.status] || r.status }),
            el('div', { class: 'acc-meta', text: T.owes + ' ' + money(r.owedCents) +
              ' · ' + T.paid + ' ' + money(r.paidCents) }),
            // Why 300 and not 350. The waiver is per participant, per activity,
            // per academic year, and a family looking at a second term should be
            // able to see that rather than wonder.
            el('div', { class: 'acc-meta', text: r.feeCharged ? T.feeIncluded : T.feeAlready })
          ])
        ];
        // Offered only when the frozen terms allow it. The same creditFor() the
        // server will apply decided this, so what is shown is what happens.
        if ((r.status === 'pending' || r.status === 'approved') &&
            r.cancellation && r.cancellation.guardianMayCancel !== false) {
          bits.push(el('button', { type: 'button', class: 'acc-link is-danger', text: T.cancelReg,
            onclick: function () {
              if (!window.confirm(T.cancelRegConfirm)) return;
              post(REGS, { action: 'cancel', participantId: r.participantId, activityId: r.activityId })
                .then(function (c) {
                  if (!c.ok) return say('err', failure(c));
                  boot();
                });
            } }));
        }
        return el('div', { class: 'acc-row' }, bits);
      })));
    });
  }

  // ---- credit ----
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
          say(res.ok ? 'ok' : 'err', res.ok ? T.saved : failure(res));
        });
      } }, [f.row, l.row, ph.row,
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
        el('p', {}, [el('a', { href: base + '/account', text: T.signInTitle })])
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
              el('p', {}, [el('a', { href: base + '/account', text: T.signIn })])
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
            el('p', {}, [el('a', { href: base + '/account', text: T.childrenTitle })])
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
      // Refresh the cached name on every visit, so the nav chip is right for
      // somebody who signed in before it existed, and follows a change of name
      // rather than showing the letter they first registered under.
      window.MemberSession.set(sessionFor({
        token: window.MemberSession.token(),
        expiresAt: res.data.expiresAt,
        account: res.data.account
      }));
      renderAccount(res.data.account);
    });
  }

  boot();
})();
