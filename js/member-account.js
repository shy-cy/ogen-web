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

  // ⚠ THE MINIMUM IS STATED ON THE FORM, not discovered from a refusal. It is
  // MIN_PASSWORD in _account-store.js, repeated here because a browser cannot
  // require a Netlify function — the same duplication the activities menu makes,
  // and pinned by a test for the same reason. A form that does not say the rule
  // is a form somebody breaks, and on the reset screen breaking it used to cost
  // the link as well.
  var MIN_PASSWORD = 8;

  // ⚠ THE ATTEMPT COUNT IS THE BROWSER'S OWN, AND THAT IS THE WHOLE DESIGN.
  //
  // A person failing to sign in was told the same sentence eight times and then
  // a ninth, with nothing saying they were running out of tries or that the
  // door had shut — reported as "it doesn't lock", against a lock that was
  // working the whole time.
  //
  // The server cannot be the one to say it. A wrong password and an address
  // nobody has used answer identically ON PURPOSE: an attacker who learns
  // dana@example.com has an Ogen account has learned she has children attending
  // and roughly where they are on a Wednesday afternoon. "You have 3 tries left"
  // can only be true of an account that exists, so sending it would make the
  // refusal tell them apart — which is the one thing sign-in must never do.
  //
  // So the COUNTING moves to the browser, which is counting its own user's
  // keystrokes rather than reporting anything about our records. The same words
  // appear for an address with an account and one without, because the browser
  // cannot tell and never asks. Nothing here is enforcement: the lock is still
  // _account-store.js's, server-side, and unchanged.
  //
  // What it costs: a reload resets the display, and for an address with no
  // account the advice to wait is unnecessary rather than wrong. Both are worth
  // it against a refusal that reveals who has children at this centre.
  //
  // These two must match MAX_FAILED and LOCK_MS in _account-store.js — a browser
  // cannot require a Netlify function, the same duplication MIN_PASSWORD has,
  // pinned by the same test.
  var MAX_SIGNIN_ATTEMPTS = 8;
  var SIGNIN_LOCK_MINUTES = 15;
  var signinFails = {};

  var lang = (document.documentElement.lang || 'he').slice(0, 2);
  if (['he', 'en', 'ru'].indexOf(lang) === -1) lang = 'he';
  var base = lang === 'he' ? '' : '/' + lang;

  // ---------------------------------------------------------------- copy ----
  var T = {
    he: {
      signInTitle: 'כניסה לאזור המשפחה', email: 'דוא״ל', password: 'סיסמה',
      signIn: 'כניסה', forgot: 'שכחתי סיסמה', noAccount: 'אין לכם חשבון עדיין?',
      signinAttempt: 'ניסיון {n} מתוך {max}.',
      signinLocked: 'יותר מדי ניסיונות — הכניסה חסומה ל־{min} דקות.',
      createAccount: 'פתיחת חשבון', haveAccount: 'כבר יש לכם חשבון?',
      signUpTitle: 'פתיחת חשבון', firstName: 'שם פרטי', lastName: 'שם משפחה',
      phone: 'טלפון', prefLang: 'שפה מועדפת',
      termsRequired: 'צריך לאשר את תנאי השימוש ואת מדיניות הפרטיות.',
      termsPre: 'קראתי ואני מסכים/ה ל', termsLink: 'תנאי השימוש', termsMid: ' ול',
      privacyLink: 'מדיניות הפרטיות',
      signUp: 'פתיחת חשבון',
      working: 'רגע…',
      signUpDone: 'החשבון נוצר. שלחנו לכם אימייל לאישור הכתובת.',
      forgotTitle: 'איפוס סיסמה',
      forgotIntro: 'הזינו את כתובת הדוא״ל שלכם ונשלח קישור לאיפוס.',
      forgotSend: 'שליחת קישור',
      forgotSent: 'אם קיים חשבון בכתובת הזו, הקישור נשלח. בדקו את תיבת הדואר.',
      resetTitle: 'בחירת סיסמה חדשה', newPassword: 'סיסמה חדשה', resetSave: 'שמירה',
      passwordHint: 'לפחות {n} תווים.',
      needValue: 'צריך למלא את השדה הזה.',
      needEmail: 'זו לא כתובת דוא״ל.',
      needDate: 'צריך תאריך מלא — יום, חודש ושנה.',
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
      guardians: 'אפוטרופוסים', selfAccess: 'גישה',
      inviteManager: 'הזמנת מישהו לנהל את הרשומה',
      manages: 'מי רואה ומנהל/ת את הרשומה', primary: 'ראשי/ת',
      inviteGuardian: 'הזמנת אפוטרופוס שני', inviteEmail: 'כתובת דוא״ל',
      inviteSend: 'שליחת הזמנה', invitePending: 'הזמנה ממתינה',
      inviteResend: 'שליחה מחדש', inviteRevoke: 'ביטול הזמנה',
      leave: 'הסרת עצמי מהרשומה',
      leaveConfirm: 'להסיר את עצמכם מהרשומה של המשתתף/ת הזה/זו?',

      tabFamily: 'בני המשפחה',
      emailFixed: 'לשינוי כתובת הדוא״ל פנו אלינו.',

      activitiesTitle: 'הפעילויות שלי', noRegs: 'אין עדיין הרשמות.',
      browseActivities: 'לכל הפעילויות',
      grpCurrent: 'פעילות כעת', grpPast: 'הסתיימו', viewDetails: 'לפרטים',
      cancelReg: 'ביטול הרשמה', cancelRegConfirm: 'לבטל את ההרשמה?',
      regNotFound: 'לא נמצאה הרשמה.',
      activityGone: 'הפעילות אינה מפורסמת כרגע. פרטי ההרשמה נשמרו.',

      costTitle: 'עלות ותשלום', stillToPay: 'נותר לתשלום', credited: 'זוכה',
      payNow: 'תשלום מאובטח', payOpening: 'פותח תשלום…',
      paidThanks: 'התשלום התקבל. תודה!',
      paidSettling: 'התשלום התקבל — אנחנו רושמים אותו. הסכומים כאן יתעדכנו עוד רגע.',
      paidSlow: 'התשלום התקבל. הרישום לוקח עוד קצת זמן — אם הסכומים כאן עדיין לא '
              + 'מתעדכנים, אפשר לרענן בעוד דקה, ואם גם אז לא, כתבו לנו.',
      waitLead: 'ההרשמה בוצעה — התשלום ייפתח בקרוב',
      lateWhy: 'הרשמה מאוחרת · רגיל {price}',
      eveningsBooked: 'מפגשים שנקבעו', noEveningsYet: 'עוד לא נקבעו מפגשים, ולכן אין מה לשלם עדיין.',
      waitBody: '{name} נרשם/ה. אנחנו משלימים כמה פרטים אחרונים, והתשלום ייפתח כאן. '
              + 'נעדכן אתכם במייל ברגע שאפשר.',
      payNeedsVerify: 'כדי לשלם, יש לאשר את כתובת האימייל. הקישור לאישור נמצא בעמוד החשבון.',
      registerNeedsVerify: 'לפני ההרשמה צריך לאשר את כתובת הדוא״ל. שלחנו לכם קישור — אם הוא לא הגיע:',
      sessionsTitle: 'המפגשים', dateCol: 'תאריך', statusCol: 'סטטוס',
      book: 'הרשמה למפגש', cancelSession: 'ביטול מפגש',
      cancelSessionConfirm: 'לבטל את המפגש הזה?',
      sessionStatus: { booked: 'רשום/ה', attended: 'הגיע/ה',
                       'no-show': 'לא הגיע/ה', cancelled: 'בוטל' },

      creditTitle: 'יתרת זיכוי',
      profileTitle: 'הפרטים שלי', editDetails: 'עריכת הפרטים',
      changePassword: 'שינוי סיסמה',
      currentPassword: 'סיסמה נוכחית', saved: 'נשמר.',
      confirmTitle: 'לאשר?', confirmYes: 'כן, לבטל', confirmNo: 'חזרה',
      confirmCredit: 'הסכום ששולם יוחזר כזיכוי לחשבון:',
      confirmNoCredit: 'לא יוחזר זיכוי על הביטול הזה.',
      confirmFeeHeld: 'דמי ההרשמה אינם כלולים בסכום הזה: הם נגבים פעם בשנה עבור הפעילות הזו, '
                    + 'ועדיין קיימת הרשמה פעילה למחזור אחר.',
      // ⚠ WHY there is nothing to get back. The dialog said only that there was
      // not, which reads as a penalty whatever the actual reason — and the
      // commonest reason is the gentlest one, that nothing has been paid yet.
      whyNothing: {
        'nothing-paid': 'עדיין לא שולם דבר על המפגש הזה, ולכן אין מה לזכות.',
        'too-late': 'חלון הביטול המזכה על המפגש הזה נסגר.',
        'started': 'המפגש כבר התחיל.',
        'per-session': 'בפעילות הזו התשלום הוא לכל מפגש בנפרד, ולכן אין תשלום מראש להחזיר. '
                     + 'מפגשים שכבר נקבעו מתבטלים אחד־אחד.',
        'past-cutoff': 'המועד האחרון לקבלת זיכוי על הסכום ששולם כבר עבר.',
        'closed': 'המועד האחרון לקבלת זיכוי על ההרשמה הזו כבר עבר. אפשר עדיין לבטל, אך ללא זיכוי.',
        'fee-held': 'כל מה ששולם על ההרשמה הזו הוא דמי ההרשמה, הנגבים פעם בשנה עבור הפעילות '
                  + 'הזו — ועדיין קיימת הרשמה פעילה למחזור אחר, ולכן הם נשארים בתוקף.'
      },
      registerFullLead: 'הפעילות מלאה כרגע.',
      groupFullLead: 'הקבוצה הזו מלאה כרגע.',
      registerWaitGo: 'הצטרפות לרשימת המתנה',
      registerWaitBody: 'אין מקום פנוי כרגע. אפשר להצטרף לרשימת ההמתנה ללא תשלום. '
                      + 'ברגע שיתפנה מקום נשלח מייל לכל הממתינים, והמקום יינתן למי שיירשם ראשון.',
      registerWaitDone: 'הצטרפתם לרשימת ההמתנה. נשלח מייל ברגע שיתפנה מקום.',
      waitingLead: 'ברשימת ההמתנה',
      waitingWhy: 'לא חויבתם. כשיתפנה מקום נשלח מייל לכל הממתינים, '
                + 'והמקום יינתן לראשון שיירשם.',
      waitingOpenLead: 'התפנה מקום',
      waitingOpenWhy: 'שלחנו מייל לכל הממתינים, אז כדאי לתפוס אותו עכשיו. '
                    + 'מיד אחר כך אפשר לשלם כאן.',
      takePlace: 'לתפוס את המקום',
      takePlaceDone: 'המקום שלכם. אפשר להשלים את התשלום כאן.',
      leaveWait: 'יציאה מרשימת ההמתנה',
      leaveWaitConfirm: 'לצאת מרשימת ההמתנה?',
      leaveWaitDone: 'יצאתם מרשימת ההמתנה.',
      useCredit: 'שימוש בזיכוי',
      creditUsed: 'הזיכוי נוצל.', creditHave: 'יש לכם זיכוי:',
      creditAll: '{used} יקוזזו מהסכום הזה, ולא יישאר מה לשלם.',
      creditPart: '{used} יקוזזו מהסכום הזה. יישאר לתשלום {left}.',
      registerTitle: 'הרשמה לפעילות', registerWho: 'מי נרשם/ת?',
      registerGroup: 'קבוצה', registerGo: 'הרשמה',
      groupFull: 'מלאה — רשימת המתנה',
      perSessionIntro: 'בוחרים מי מגיע/ה ולאילו מפגשים, ומשלמים רק עליהם. אפשר להוסיף מפגשים נוספים בכל עת.',
      pickDates: 'לאילו מפגשים?', pickAtLeastOne: 'יש לבחור לפחות מפגש אחד.',
      dateFull: 'מלא', dateBooked: 'כבר נרשמתם',
      noDates: 'עדיין לא פורסמו מפגשים קרובים.',
      bookAndPay: 'הרשמה ותשלום',
      bookedFree: 'נרשמתם. אין תשלום על המפגשים האלה.',
      bookedUnpaid: 'המפגשים נשמרו, אבל לא הצלחנו לפתוח את דף התשלום. אפשר לשלם מעמוד הפעילות.',
      datesGone: 'חלק מהמפגשים כבר אינם זמינים. אפשר לבחור שוב.',
      // ⚠ THE SAME WORDS THE WAITING BLOCK USES, AND NO REASON IN ANY OF THEM.
      // "Заявка принята" — a REQUEST has been received — was still here, which
      // is the queue's own framing and the one word this table removed
      // everywhere else: a family signed a child up, and being told a decision
      // is pending reads as a decision that might go either way over something
      // they consider settled.
      awaitingOk: 'ההרשמה בוצעה. אנחנו משלימים כמה פרטים לפני בחירת מפגשים — לא בוצע חיוב.',
      chooseSessions: 'מעבר לעמוד הפעילות',
      bundleTitle: 'כרטיסיות',
      bundleIntro: 'מפגשים שנרכשו מראש. מספר המפגשים הוא ההבטחה — אם ניאלץ לבטל מפגש שאי אפשר להחליף, הסכום יוחזר כזיכוי לפי המחיר ששולם.',
      bundleLeft: 'נותרו', bundleOf: 'מתוך', bundleValid: 'בתוקף עד',
      bundleCredited: 'הוחזר כזיכוי עבור מפגשים שלא יכולנו להציע:',
      entryState: { used: 'נוצל', booked: 'רשום/ה', available: 'זמין', gone: 'לא נוצל' },
      reschedule: 'שינוי מועד', rescheduleTo: 'להעביר לתאריך',
      rescheduleGo: 'העברה', rescheduleDone: 'המפגש הועבר.',
      fromBundle: 'מהכרטיסייה',
      buyTitle: 'רכישת כרטיסייה',
      buyNone: 'אין כרגע כרטיסייה זמינה לפעילות הזו.',
      buyIntro: 'כרטיסייה מוצעת רק כשלוח המפגשים יכול לכסות את כולה בתוך תקופת התוקף.',
      buySessions: 'מפגשים', buyGo: 'רכישה', buyOpening: 'פותח תשלום…',
      buyValid: 'תוקף', buyDays: 'ימים',
      paySession: 'תשלום על המפגש', payingSession: 'פותח תשלום…',
      registerDone: 'ההרשמה בוצעה. הפרטים והתשלום נמצאים בעמוד ההרשמה.',
      owes: 'לתשלום', paid: 'שולם', feeAlready: 'דמי ההרשמה כבר שולמו',
      places: 'מקומות פנויים', unlimited: 'ללא הגבלה',
      payLink: { expired: 'קישור התשלום פג או כבר אינו בתוקף. אפשר להתחבר ולשלם כאן.',
                 'not-approved': 'לא ניתן לשלם על ההרשמה הזו כרגע.',
                 'nothing-due': 'אין יתרה לתשלום בהרשמה הזו.',
                 failed: 'לא הצלחנו לפתוח את דף התשלום. נסו שוב.' },
      loading: 'טוען…', problem: 'משהו השתבש. נסו שוב.',
      offline: 'אין חיבור לשרת. נסו שוב בעוד רגע.',
      status: { pending: 'רשום/ה', approved: 'רשום/ה', rejected: 'לא אושר',
                expired: 'פג תוקף', cancelled: 'בוטל', waitlisted: 'ברשימת המתנה' }
    },
    en: {
      signInTitle: 'Sign in', email: 'Email', password: 'Password',
      signIn: 'Sign in', forgot: 'Forgotten your password?', noAccount: 'No account yet?',
      signinAttempt: 'Attempt {n} of {max}.',
      signinLocked: 'Too many attempts — signing in is blocked for {min} minutes.',
      createAccount: 'Create an account', haveAccount: 'Already have an account?',
      signUpTitle: 'Create an account', firstName: 'First name', lastName: 'Last name',
      phone: 'Phone', prefLang: 'Preferred language',
      termsRequired: 'The terms and the privacy policy have to be accepted.',
      termsPre: 'I have read and accept the ', termsLink: 'Terms of Use', termsMid: ' and the ',
      privacyLink: 'Privacy Policy',
      signUp: 'Create account',
      working: 'One moment…',
      signUpDone: 'Your account is ready. We have sent you an email to confirm your address.',
      forgotTitle: 'Reset your password',
      forgotIntro: 'Enter your email address and we will send you a link.',
      forgotSend: 'Send the link',
      forgotSent: 'If there is an account at that address, the link is on its way. Check your inbox.',
      resetTitle: 'Choose a new password', newPassword: 'New password', resetSave: 'Save',
      passwordHint: 'At least {n} characters.',
      needValue: 'Please fill in this field.',
      needEmail: 'That is not an email address.',
      needDate: 'Please give a full date — day, month and year.',
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
      guardians: 'Guardians', selfAccess: 'Access',
      inviteManager: 'Invite someone to manage this record',
      manages: 'Who can see and manage this record', primary: 'Primary',
      inviteGuardian: 'Invite a second guardian', inviteEmail: 'Email address',
      inviteSend: 'Send invitation', invitePending: 'Invitation pending',
      inviteResend: 'Send again', inviteRevoke: 'Withdraw',
      leave: 'Remove myself from this record',
      leaveConfirm: 'Remove yourself as a guardian for this participant?',

      tabFamily: 'Family members',
      emailFixed: 'To change your email address, please contact us.',

      activitiesTitle: 'My activities', noRegs: 'No registrations yet.',
      browseActivities: 'See all activities',
      grpCurrent: 'Current', grpPast: 'Finished', viewDetails: 'View details',
      cancelReg: 'Cancel registration', cancelRegConfirm: 'Cancel this registration?',
      regNotFound: 'That registration was not found.',
      activityGone: 'This activity is not published at the moment. Your registration details are kept.',

      costTitle: 'What it costs', stillToPay: 'Still to pay', credited: 'Credited',
      payNow: 'Pay securely', payOpening: 'Opening payment…',
      paidThanks: 'Payment received. Thank you!',
      paidSettling: 'Payment received \u2014 we are recording it. The figures here will '
                  + 'update in a moment.',
      paidSlow: 'Payment received. It is taking a little longer to record \u2014 if the '
              + 'figures here have not caught up, reload in a minute, and write to us if '
              + 'they still have not.',
      waitLead: 'Registered — payment opens soon',
      lateWhy: 'late booking \u00b7 usually {price}',
      eveningsBooked: 'Sessions booked', noEveningsYet: 'No sessions booked yet, so there is nothing to pay.',
      waitBody: '{name} is registered. We\u2019re confirming the last few details, and payment '
              + 'will open here. We\u2019ll email you the moment it does.',
      payNeedsVerify: 'To pay, please confirm your email address. The link to resend it is on your account page.',
      registerNeedsVerify: 'Please confirm your email address before registering. We have sent you a link — if it has not arrived:',
      sessionsTitle: 'Sessions', dateCol: 'Date', statusCol: 'Status',
      book: 'Book', cancelSession: 'Cancel this session',
      cancelSessionConfirm: 'Cancel this session?',
      sessionStatus: { booked: 'Booked', attended: 'Attended',
                       'no-show': 'Did not come', cancelled: 'Cancelled' },

      creditTitle: 'Credit',
      profileTitle: 'My details', editDetails: 'Edit my details',
      changePassword: 'Change password',
      currentPassword: 'Current password', saved: 'Saved.',
      confirmTitle: 'Are you sure?', confirmYes: 'Yes, cancel it', confirmNo: 'Go back',
      confirmCredit: 'What you paid comes back as credit on your account:',
      confirmNoCredit: 'This cancellation earns no credit back.',
      confirmFeeHeld: 'The registration fee is not part of this: it is charged once a year for '
                    + 'this activity, and another term is still registered.',
      whyNothing: {
        'nothing-paid': 'Nothing has been paid for this session yet, so there is nothing to credit back.',
        'too-late': 'The window for cancelling this session with credit has closed.',
        'started': 'The session has already started.',
        'per-session': 'This activity is paid for one session at a time, so there is no payment '
                     + 'up front to give back. Sessions you have booked are cancelled one by one.',
        'past-cutoff': 'The date for getting back what has been paid has passed.',
        'closed': 'The period for getting credit back on this registration has closed. It can still be cancelled, with nothing credited.',
        'fee-held': 'Everything paid on this registration was the registration fee, which is '
                  + 'charged once a year for this activity — and another term is still '
                  + 'registered, so it stays paid.'
      },
      registerFullLead: 'This activity is full at the moment.',
      groupFullLead: 'This group is full at the moment.',
      registerWaitGo: 'Join the waiting list',
      registerWaitBody: 'There is no place free at the moment. You can join the waiting list, '
                      + 'which costs nothing. As soon as a place opens we email everybody waiting, '
                      + 'and it goes to the first person to take it.',
      registerWaitDone: 'You are on the waiting list. We will email you as soon as a place opens.',
      waitingLead: 'On the waiting list',
      waitingWhy: 'You have not been charged. When a place opens we email everyone waiting, '
                + 'and the first to take it gets it.',
      waitingOpenLead: 'A place has opened',
      waitingOpenWhy: 'Everyone waiting has been emailed, so take it now to keep it. '
                    + 'You can pay here straight afterwards.',
      takePlace: 'Take the place',
      takePlaceDone: 'The place is yours. You can pay for it here.',
      leaveWait: 'Leave the waiting list',
      leaveWaitConfirm: 'Leave the waiting list?',
      leaveWaitDone: 'You have left the waiting list.',
      useCredit: 'Use credit',
      creditUsed: 'Your credit has been used.', creditHave: 'You have credit:',
      creditAll: '{used} comes off this, and nothing is left to pay.',
      creditPart: '{used} comes off this. {left} would still be payable.',
      registerTitle: 'Register for an activity', registerWho: 'Who is registering?',
      registerGroup: 'Group', registerGo: 'Register',
      groupFull: 'full — waiting list',
      perSessionIntro: 'Choose who is coming and which sessions. You pay only for the sessions you pick, and you can book more at any time.',
      pickDates: 'Which sessions?', pickAtLeastOne: 'Choose at least one session.',
      dateFull: 'full', dateBooked: 'already booked',
      noDates: 'No upcoming sessions have been published yet.',
      bookAndPay: 'Register and pay',
      bookedFree: 'Booked. There is nothing to pay for these sessions.',
      bookedUnpaid: 'The sessions are booked, but we could not open the payment page. You can pay from the activity page.',
      datesGone: 'Some of those sessions are no longer available. Please choose again.',
      awaitingOk: 'Registered. We are confirming a few details before sessions can be booked \u2014 nothing has been charged.',
      chooseSessions: 'Go to the activity page',
      bundleTitle: 'Bundles',
      bundleIntro: 'Sessions bought in advance. The number of sessions is the promise — if we have to cancel one we cannot replace, it comes back as credit at the rate you paid.',
      bundleLeft: 'left', bundleOf: 'of', bundleValid: 'Valid until',
      bundleCredited: 'Credited back for sessions we could not offer:',
      entryState: { used: 'used', booked: 'booked', available: 'available', gone: 'not used' },
      reschedule: 'Move', rescheduleTo: 'Move to',
      rescheduleGo: 'Move it', rescheduleDone: 'That session has been moved.',
      fromBundle: 'from your bundle',
      buyTitle: 'Buy a bundle',
      buyNone: 'No bundle is available for this activity at the moment.',
      buyIntro: 'A bundle is offered only when the calendar can cover every session inside its validity window.',
      buySessions: 'sessions', buyGo: 'Buy', buyOpening: 'Opening payment…',
      buyValid: 'valid', buyDays: 'days',
      paySession: 'Pay for this session', payingSession: 'Opening payment…',
      registerDone: 'Registered. The details and the payment are on the registration page.',
      owes: 'To pay', paid: 'Paid', feeAlready: 'registration fee already paid',
      places: 'places left', unlimited: 'no limit',
      payLink: { expired: 'That payment link has expired or is no longer valid. You can sign in and pay here.',
                 'not-approved': 'This registration cannot be paid for at the moment.',
                 'nothing-due': 'There is nothing outstanding on this registration.',
                 failed: 'We could not open the payment page. Please try again.' },
      loading: 'Loading…', problem: 'Something went wrong. Please try again.',
      offline: 'Could not reach the server. Try again in a moment.',
      status: { pending: 'Registered', approved: 'Registered', rejected: 'Not offered',
                expired: 'Expired', cancelled: 'Cancelled', waitlisted: 'Waiting list' }
    },
    ru: {
      signInTitle: 'Вход', email: 'Эл. почта', password: 'Пароль',
      signIn: 'Войти', forgot: 'Забыли пароль?', noAccount: 'Ещё нет учётной записи?',
      signinAttempt: 'Попытка {n} из {max}.',
      signinLocked: 'Слишком много попыток — вход заблокирован на {min} минут.',
      createAccount: 'Создать учётную запись', haveAccount: 'Уже есть учётная запись?',
      signUpTitle: 'Создание учётной записи', firstName: 'Имя', lastName: 'Фамилия',
      phone: 'Телефон', prefLang: 'Предпочитаемый язык',
      termsRequired: 'Нужно принять условия использования и политику конфиденциальности.',
      termsPre: 'Я прочитал(а) и принимаю ', termsLink: 'Условия использования', termsMid: ' и ',
      privacyLink: 'Политику конфиденциальности',
      signUp: 'Создать',
      working: 'Минуту…',
      signUpDone: 'Учётная запись создана. Мы отправили письмо для подтверждения адреса.',
      forgotTitle: 'Сброс пароля',
      forgotIntro: 'Укажите адрес электронной почты, и мы пришлём ссылку.',
      forgotSend: 'Отправить ссылку',
      forgotSent: 'Если учётная запись с таким адресом существует, ссылка отправлена. Проверьте почту.',
      resetTitle: 'Новый пароль', newPassword: 'Новый пароль', resetSave: 'Сохранить',
      passwordHint: 'Не менее {n} символов.',
      needValue: 'Пожалуйста, заполните это поле.',
      needEmail: 'Это не адрес электронной почты.',
      needDate: 'Укажите полную дату — день, месяц и год.',
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
      guardians: 'Опекуны', selfAccess: 'Доступ',
      inviteManager: 'Пригласить кого-то управлять этой записью',
      manages: 'Кто видит эту запись и управляет ею', primary: 'Основной',
      inviteGuardian: 'Пригласить второго опекуна', inviteEmail: 'Адрес электронной почты',
      inviteSend: 'Отправить приглашение', invitePending: 'Приглашение отправлено',
      inviteResend: 'Отправить снова', inviteRevoke: 'Отозвать',
      leave: 'Удалить себя из этой записи',
      leaveConfirm: 'Удалить себя как опекуна этого участника?',

      tabFamily: 'Члены семьи',
      emailFixed: 'Чтобы изменить адрес электронной почты, свяжитесь с нами.',

      activitiesTitle: 'Мои занятия', noRegs: 'Записей пока нет.',
      browseActivities: 'Все занятия',
      grpCurrent: 'Текущие', grpPast: 'Завершённые', viewDetails: 'Подробнее',
      cancelReg: 'Отменить запись', cancelRegConfirm: 'Отменить эту запись?',
      regNotFound: 'Запись не найдена.',
      activityGone: 'Это занятие сейчас не опубликовано. Данные вашей записи сохранены.',

      costTitle: 'Сколько это стоит', stillToPay: 'Осталось оплатить', credited: 'Зачислено',
      payNow: 'Оплатить', payOpening: 'Открываем оплату…',
      paidThanks: 'Платёж получен. Спасибо!',
      paidSettling: 'Платёж получен — мы его записываем. Суммы на этой странице обновятся '
                  + 'через мгновение.',
      paidSlow: 'Платёж получен. Запись занимает немного больше времени — если суммы здесь '
              + 'не обновились, обновите страницу через минуту, а если и тогда нет, '
              + 'напишите нам.',
      waitLead: 'Запись оформлена — оплата откроется скоро',
      lateWhy: 'поздняя запись \u00b7 обычно {price}',
      eveningsBooked: 'Записанные занятия', noEveningsYet: 'Пока нет записанных занятий, поэтому платить нечего.',
      waitBody: '{name} записан(а). Мы уточняем последние детали, оплата откроется здесь. '
              + 'Напишем вам, как только всё будет готово.',
      payNeedsVerify: 'Чтобы оплатить, подтвердите адрес электронной почты. Ссылка для повторной отправки — на странице аккаунта.',
      registerNeedsVerify: 'Подтвердите адрес эл. почты перед записью. Мы отправили вам ссылку — если она не пришла:',
      sessionsTitle: 'Занятия', dateCol: 'Дата', statusCol: 'Статус',
      book: 'Записаться', cancelSession: 'Отменить занятие',
      cancelSessionConfirm: 'Отменить это занятие?',
      sessionStatus: { booked: 'Записан(а)', attended: 'Посетил(а)',
                       'no-show': 'Не пришёл(ла)', cancelled: 'Отменено' },

      creditTitle: 'Кредит',
      profileTitle: 'Мои данные', editDetails: 'Изменить данные',
      changePassword: 'Изменить пароль',
      currentPassword: 'Текущий пароль', saved: 'Сохранено.',
      confirmTitle: 'Вы уверены?', confirmYes: 'Да, отменить', confirmNo: 'Назад',
      confirmCredit: 'Оплаченная сумма вернётся на счёт как зачёт:',
      confirmNoCredit: 'За эту отмену зачёт не начисляется.',
      confirmFeeHeld: 'Регистрационный взнос в эту сумму не входит: он взимается один раз в год '
                    + 'за это занятие, а другой семестр остаётся оформленным.',
      whyNothing: {
        'nothing-paid': 'За это занятие пока ничего не оплачено, поэтому возвращать нечего.',
        'too-late': 'Срок отмены этого занятия с возвратом на счёт уже истёк.',
        'started': 'Занятие уже началось.',
        'per-session': 'Это занятие оплачивается по одному разу, поэтому предоплаты, которую можно '
                     + 'вернуть, нет. Уже записанные занятия отменяются по одному.',
        'past-cutoff': 'Срок возврата уплаченной суммы на счёт уже прошёл.',
        'closed': 'Срок возврата средств по этой записи истёк. Отменить запись можно, но без зачёта.',
        'fee-held': 'Всё, что оплачено по этой записи, — это регистрационный взнос. Он '
                  + 'взимается один раз в год за это занятие, а другой семестр остаётся '
                  + 'оформленным, поэтому взнос сохраняется.'
      },
      registerFullLead: 'Сейчас на занятии нет мест.',
      groupFullLead: 'В этой группе сейчас нет мест.',
      registerWaitGo: 'В список ожидания',
      registerWaitBody: 'Свободных мест сейчас нет. Можно встать в список ожидания — это бесплатно. '
                      + 'Как только место освободится, мы напишем всем, кто ждёт, и оно достанется '
                      + 'тому, кто запишется первым.',
      registerWaitDone: 'Вы в списке ожидания. Мы напишем, как только появится место.',
      waitingLead: 'В списке ожидания',
      waitingWhy: 'Оплата не списана. Как только освободится место, мы напишем всем, кто ждёт, '
                + 'и оно достанется тому, кто займёт его первым.',
      waitingOpenLead: 'Освободилось место',
      waitingOpenWhy: 'Мы написали всем, кто ждёт, поэтому займите его сейчас. '
                    + 'Оплатить можно здесь же сразу после.',
      takePlace: 'Занять место',
      takePlaceDone: 'Место ваше. Оплатить можно здесь.',
      leaveWait: 'Выйти из списка ожидания',
      leaveWaitConfirm: 'Выйти из списка ожидания?',
      leaveWaitDone: 'Вы вышли из списка ожидания.',
      useCredit: 'Использовать зачёт',
      creditUsed: 'Зачёт использован.', creditHave: 'На счету есть зачёт:',
      creditAll: '{used} будет вычтено из этой суммы, доплачивать не придётся.',
      creditPart: '{used} будет вычтено из этой суммы. Останется к оплате {left}.',
      registerTitle: 'Запись на занятие', registerWho: 'Кто записывается?',
      registerGroup: 'Группа', registerGo: 'Записаться',
      groupFull: 'мест нет — список ожидания',
      perSessionIntro: 'Выберите, кто придёт и на какие занятия. Вы платите только за выбранные даты и можете добавить другие в любой момент.',
      pickDates: 'Какие занятия?', pickAtLeastOne: 'Выберите хотя бы одно занятие.',
      dateFull: 'мест нет', dateBooked: 'уже записаны',
      noDates: 'Ближайшие занятия пока не опубликованы.',
      bookAndPay: 'Записаться и оплатить',
      bookedFree: 'Вы записаны. За эти занятия платить не нужно.',
      bookedUnpaid: 'Занятия забронированы, но страницу оплаты открыть не удалось. Оплатить можно на странице занятия.',
      datesGone: 'Некоторые даты уже недоступны. Пожалуйста, выберите снова.',
      awaitingOk: 'Запись оформлена. Мы уточняем несколько деталей до выбора занятий \u2014 оплата не списана.',
      chooseSessions: 'Перейти к занятию',
      bundleTitle: 'Абонементы',
      bundleIntro: 'Занятия, оплаченные заранее. Обещание — это количество занятий: если нам придётся отменить занятие и заменить его нечем, сумма вернётся на счёт по оплаченной цене.',
      bundleLeft: 'осталось', bundleOf: 'из', bundleValid: 'Действует до',
      bundleCredited: 'Возвращено за занятия, которые мы не смогли предложить:',
      entryState: { used: 'использовано', booked: 'записаны', available: 'доступно', gone: 'не использовано' },
      reschedule: 'Перенести', rescheduleTo: 'Перенести на',
      rescheduleGo: 'Перенести', rescheduleDone: 'Занятие перенесено.',
      fromBundle: 'из абонемента',
      buyTitle: 'Купить абонемент',
      buyNone: 'Сейчас для этого занятия нет доступных абонементов.',
      buyIntro: 'Абонемент предлагается только тогда, когда расписание покрывает все занятия в пределах срока действия.',
      buySessions: 'занятий', buyGo: 'Купить', buyOpening: 'Открываем оплату…',
      buyValid: 'срок', buyDays: 'дней',
      paySession: 'Оплатить это занятие', payingSession: 'Открываем оплату…',
      registerDone: 'Запись оформлена. Подробности и оплата — на странице записи.',
      owes: 'К оплате', paid: 'Оплачено', feeAlready: 'регистрационный взнос уже оплачен',
      places: 'свободных мест', unlimited: 'без ограничения',
      payLink: { expired: 'Ссылка на оплату истекла или больше не действует. Вы можете войти и оплатить здесь.',
                 'not-approved': 'Эту запись сейчас нельзя оплатить.',
                 'nothing-due': 'По этой записи нет задолженности.',
                 failed: 'Не удалось открыть страницу оплаты. Попробуйте ещё раз.' },
      loading: 'Загрузка…', problem: 'Что-то пошло не так. Попробуйте ещё раз.',
      offline: 'Не удалось связаться с сервером. Попробуйте через минуту.',
      status: { pending: 'Записан(а)', approved: 'Записан(а)', rejected: 'Не предложено',
                expired: 'Истекло', cancelled: 'Отменено', waitlisted: 'Список ожидания' }
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
  // A date a family reads, in their own language, from the ISO date the calendar
  // stores. It falls back to the ISO string rather than throwing: a plain
  // 2026-09-22 is worse than "Tuesday, 22 September" and very much better than a
  // panel that does not render.
  function longDate(iso) {
    var d = new Date(String(iso) + 'T00:00:00');
    if (isNaN(d.getTime())) return String(iso || '');
    try {
      return d.toLocaleDateString({ he: 'he-IL', en: 'en-GB', ru: 'ru-RU' }[lang] || 'en-GB',
                                  { weekday: 'long', day: 'numeric', month: 'long' });
    } catch (err) { return String(iso); }
  }

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
  // ⚠ THERE IS NO `next` PARAMETER, and its absence is the feature.
  //
  // Signing in used to follow `?next=<path>`, set by the nav chip, so somebody
  // who pressed a control labelled MY FAMILY on the homepage signed in and
  // landed back on the homepage. boot() re-renders whichever account view the
  // reader is actually on, which is the right answer every time: the chip goes
  // to /account and draws the dashboard, and the register flow goes to
  // /account/activity?register=<slug> and draws that.
  //
  // It also carried an open redirect. `next` arrived in a URL anyone could
  // write and was followed the instant a password was typed, so an absolute or
  // protocol-relative value would have made a link that looks like ogen.cy,
  // asks for a password and lands elsewhere. That needed a one-line guard, and
  // a one-line guard is exactly what gets simplified away later. Nothing sets
  // the parameter and nothing reads it now, so there is nothing to guard.
  // Every internal link is built from the tree prefix, never from a hardcoded
  // '/account' — in Hebrew the prefix is '' and in the other two it is '/en' or
  // '/ru', so one helper keeps a reader inside the language they are reading.
  function url(path, query) {
    return base + path + (query ? '?' + query : '');
  }

  // Change the query without navigating — a redraw is already happening, and a
  // navigation would throw away the message it just wrote and cost a round trip
  // for a page we are about to draw anyway. Guarded because replaceState is a
  // browser method and the DOM this script is tested in implements only what it
  // uses; when it is absent the redraw still happens, reading the old query,
  // which is the same screen one state behind rather than a broken one.
  function rewriteQuery(query) {
    try {
      var h = window.history;
      if (!h || !h.replaceState) return;
      h.replaceState(null, '', window.location.pathname + (query ? '?' + query : '') +
                                window.location.hash);
    } catch (err) {}
  }

  var notice = null;
  // ⚠ THE NOTICE IS AT THE TOP OF THE MOUNT, AND THE BUTTON IS AT THE BOTTOM.
  //
  // This looked like a dead button and was not. Sign-up is the tallest form in
  // the area — seven fields, a language picker and the terms — so on a laptop
  // the submit button sits near the fold and the notice renders somewhere above
  // the heading, off screen. A refusal that says exactly what is wrong ("an
  // account with that email already exists") was being written to a part of the
  // page nobody was looking at, and the honest description of what a person saw
  // is: they pressed Create account and nothing happened.
  //
  // Scrolled into view rather than moved next to each button, because there is
  // one notice and a dozen forms, and the next tall form would reintroduce it.
  // Guarded because scrollIntoView is a browser method and the DOM this script
  // is tested in implements only what it uses.
  //
  // aria-live for the same reason in the other direction: a message that appears
  // outside the viewport is also a message a screen reader never announces.
  // ⚠ THE BUTTON THAT TURNS A BALANCE BACK INTO A PAID PLACE.
  //
  // Cancelling in time has written a credit since Phase 5 and the dashboard has
  // shown the number since Phase 6, and until now that was the whole of it: a
  // family could see what they were owed and could not use it. An admin could,
  // from the Roster. The money was theirs and the button was somebody else's.
  //
  // It carries the FIGURE, because "use credit" beside a debt of €7 with €20 on
  // the account raises the one question the label should answer. The amount is
  // decided server-side — the smaller of what is owed and what is held — and the
  // client shows the same arithmetic rather than sending a number of its own.
  // ⚠ A BALANCE IS NOT AN OFFER UNTIL IT SAYS WHAT PRESSING IT DOES.
  //
  // This was one grey sentence — "You have €50.00 in credit" — with a text link
  // under it, sitting between the figures and the pay button, and it was
  // reported as not good enough. It was: money about to move, drawn as a
  // footnote, and it did not say the two things somebody actually needs before
  // pressing — how much of the balance this takes, and what is left to pay
  // afterwards.
  //
  // So it is a block, built from .acc-waiting's idiom (tinted ground, 8px
  // radius, a leading rule, a bold lead over a plain body) because that is
  // already this area's shape for "here is something about your registration".
  // It is NOT a solid full pill: this codebase's oldest rule is that solid fill
  // plus a full pill means pressable, and the pressable thing here is the button
  // inside it.
  //
  // Olive rather than gold: gold is the advisory colour that reads as LOOK AT
  // THIS, and a credit balance is good news rather than a warning — the same
  // choice the waiting block and the nav chip's signed-in initial make.
  // The control itself. A row of per-evening actions wants a link beside the
  // others; the cost card wants the block below. One handler either way, so the
  // two cannot come to send different things.
  function creditButton(owing, balance, body, onDone, cls) {
    if (!(owing > 0) || !(balance > 0)) return null;
    var btn = el('button', { type: 'button', class: cls || 'acc-link',
      text: T.useCredit + ' · ' + money(Math.min(owing, balance)),
      onclick: function () {
        var done = busy(btn);
        post(REGS, Object.assign({ action: 'useCredit' }, body)).then(function (res) {
          done();
          if (!res.ok) return say('err', failure(res));
          say('ok', T.creditUsed);
          onDone();
        });
      } });
    return btn;
  }

  function creditBlock(owing, balance, body, onDone) {
    // ⚠ SECONDARY, NOT PRIMARY. It was .btn-primary and sat directly above the
    // pay button, which is also .btn-primary — two solid terracotta pills, the
    // credit one wider because its label is longer, with nothing saying which
    // one the card is for. Paying is what this screen is for; putting credit
    // towards it is a step on the way, after which the rest is still owed and
    // the pay button is still the thing to press.
    var btn = creditButton(owing, balance, body, onDone, 'btn-secondary acc-credit-go');
    if (!btn) return null;
    var amount = Math.min(owing, balance);
    var after = owing - amount;
    return el('div', { class: 'acc-credit' }, [
      el('p', { class: 'acc-credit-lead' }, [
        lucide(WALLET, '15'), el('span', { text: T.creditHave + ' ' + money(balance) })
      ]),
      // The arithmetic, said rather than left to be done. "It covers all of it"
      // and "€250 would still be payable" are different decisions, and which one
      // this is cannot be read off a balance and a total.
      el('p', { class: 'acc-credit-body',
                text: after > 0 ? T.creditPart.replace('{used}', money(amount))
                                          .replace('{left}', money(after))
                                : T.creditAll.replace('{used}', money(amount)) }),
      btn
    ]);
  }

  // ⚠ ASKING BEFORE SOMETHING IS UNDONE, IN OUR OWN WORDS.
  //
  // This was `window.confirm`, and three things were wrong with it. It is pinned
  // to the top of the viewport, it is headed with the site's DOMAIN, and it
  // paints in the operating system's colours — so the most consequential
  // question this site asks a family arrived looking like a security warning
  // from somewhere else.
  //
  // The third is the one that matters: a browser dialog takes a single string
  // and cannot show what the answer COSTS. On a cancellation that is the whole
  // of what somebody needs to know, and the server has already computed it —
  // creditForSession() decided it before the button was drawn. So the credit
  // line goes in the question.
  //
  // STAYING IS THE TERRACOTTA. Rule 5 says every actionable CTA is terracotta,
  // and the action here is the one that changes nothing: a cancellation cannot
  // be undone, so the easy press must be the one that leaves things alone.
  function confirmAction(opts, onYes) {
    var box = el('div', { class: 'acc-modal-box', role: 'dialog', 'aria-modal': 'true' }, [
      el('h2', { text: T.confirmTitle }),
      el('p', { text: opts.question }),
    ].concat((opts.note || []).map(function (line, i) {
      // The first line is the figure or its absence; anything after it is why.
      // Quieter, because a reason is context for the sentence above rather than
      // a second claim of equal weight.
      return el('p', { class: i ? 'acc-modal-why' : 'acc-note', text: line });
    })));
    var modal = el('div', { class: 'acc-modal' }, [box]);
    function close() { if (modal.parentNode) modal.parentNode.removeChild(modal); }
    box.appendChild(el('div', { class: 'acc-modal-acts' }, [
      el('button', { type: 'button', class: 'btn-primary', text: T.confirmNo, onclick: close }),
      el('button', { type: 'button', class: 'acc-link is-danger', text: opts.yes || T.confirmYes,
        onclick: function () { close(); onYes(); } })
    ]));
    // On the mount rather than on <body>: #page owns the direction, so the
    // buttons read in the right order in all three languages with nothing
    // directional written into the block.
    mount.appendChild(modal);
  }

  // What a cancellation is about to be worth, in a sentence. Taken from the
  // SAME figure the server will apply, so the question and the outcome cannot
  // disagree — a family told "€7 comes back" and credited nothing would have
  // been told a lie by the screen that asked them.
  // ⚠ ONE KEY, BECAUSE THE SERVER NOW SENDS ONE SHAPE. This read `.credit`,
  // which _credit.js puts on a SESSION's answer and has never put on a
  // registration's — that one says `total`. So `undefined > 0` was false and the
  // dialog said "this cancellation earns no credit back" on every registration,
  // whatever was actually owed back: the last sentence somebody reads before an
  // action that cannot be undone, about money, and confidently backwards.
  // cancellationView() in account-registrations.js is what makes the two agree.
  // ⚠ IT RETURNS THE LINES, NOT A LINE. "No credit back" with no account of
  // itself reads as a penalty, whatever the actual reason — and the commonest
  // reason is that nothing has been paid yet, which is the opposite of a
  // penalty. The server decided which reason applies, from the same object the
  // figure came out of; this only renders it.
  //
  // Nothing is added when there IS credit: the figure explains itself, and a
  // sentence under it would be answering a question nobody asked.
  function creditNote(cancellation) {
    if (!cancellation) return null;
    var lines;
    if (cancellation.credit > 0) {
      lines = [T.confirmCredit + ' ' + money(cancellation.credit)];
    } else {
      var why = T.whyNothing[cancellation.whyNothing];
      lines = why ? [T.confirmNoCredit, why] : [T.confirmNoCredit];
    }
    // ⚠ SAID EVEN WHEN THERE IS CREDIT, which every other line here is not.
    //
    // The rule above is that a figure explains itself and a sentence under it
    // answers a question nobody asked. This is the case where it does not: a
    // family who paid €350 is being offered €300 back, and the €50 that is
    // missing is the yearly registration fee staying paid because another term
    // of this year is still registered. Unexplained, that gap reads as a
    // deduction — in the last thing somebody reads before an action that cannot
    // be undone.
    if (cancellation.feeHeldElsewhere) lines.push(T.confirmFeeHeld);
    return lines;
  }

  // ⚠ WHAT IS COMING, DRAWN AT ITS OWN SHAPE.
  //
  // Every screen here fetches, and the wait was the word "Loading…" on an
  // otherwise empty page — which says exactly as much about a call that takes
  // 200ms as about one that has already failed, and leaves the page to jump
  // when the real content lands at a different height.
  //
  // A skeleton says the thing a spinner cannot: how much is coming, and how it
  // is laid out. `T.loading` is still here and is what a screen reader is told,
  // because a stack of grey blocks announces nothing at all.
  //
  // The shapes are named for the content rather than for their width, so a
  // caller asks for a list of rows and does not have to know that a row is 66px.
  function skeleton(shape) {
    var plan = {
      tiles: ['card', 'card'],
      list: ['title', 'card', 'card', 'card'],
      panel: ['title', 'wide', 'half', 'short'],
      table: ['title', 'wide', 'wide', 'wide', 'wide']
    }[shape] || ['title', 'wide', 'half'];
    return el('div', { class: 'acc-skeleton', role: 'status', 'aria-label': T.loading },
      plan.map(function (k) { return el('div', { class: 'acc-skel is-' + k }); }));
  }

  // ⚠ A BUTTON THAT CANNOT BE PRESSED MUST LOOK LIKE ONE.
  //
  // Every form here already disabled its button for the length of the call, and
  // that was the whole of the feedback: `disabled` had no style, so on sign-up —
  // the tallest form, and the slowest, because a password is hashed and several
  // records are written — what a person saw was nothing at all. They pressed
  // Create account and the screen did not change for several seconds.
  //
  // So the label says what is happening as well. One helper rather than a line
  // in each handler, because the failure was every handler doing the same
  // half-measure, and the next form added would have done it too. It hands back
  // the undo, so a caller cannot restore the wrong text.
  function busy(btn) {
    if (!btn) return function () {};
    var was = btn.textContent;
    btn.disabled = true;
    btn.textContent = T.working;
    return function () { btn.disabled = false; btn.textContent = was; };
  }

  // A message that has to survive a redraw. say() writes into the notice the
  // current screen owns, and signing up REPLACES that screen — so the one thing
  // a new account needs to be told ("we have emailed you") was being written
  // into a node that was discarded in the same repaint. This carries it across.
  function flash(text) { S.flash = text; }

  // `sticky` keeps an 'ok' notice up instead of clearing it after five seconds.
  // One caller: the message shown while a payment is being recorded, which has
  // to outlast the wait it is describing. Saying it again on a timer would work
  // and would also scroll the page under the reader every few seconds.
  function say(kind, text, sticky) {
    if (!notice) return;
    clear(notice);
    notice.setAttribute('aria-live', kind === 'err' ? 'assertive' : 'polite');
    notice.appendChild(el('p', { class: 'acc-notice is-' + kind, text: text }));
    if (notice.scrollIntoView) notice.scrollIntoView({ block: 'center' });
    if (kind === 'ok' && !sticky) {
      window.setTimeout(function () { if (notice) clear(notice); }, 5000);
    }
  }
  // ⚠ COMING BACK FROM A COMPLETED CHECKOUT.
  //
  // `?paid=<kind>` is set on Stripe's success_url, so it means one thing and
  // not the other: SOMEBODY HAS JUST COME BACK FROM CHECKOUT. It is not proof
  // of payment — a person can type it — and, more to the point, Stripe
  // redirects the moment the card clears, which is routinely BEFORE the webhook
  // that settles the record has landed. The webhook is the only thing here that
  // moves money.
  //
  // So the URL opens the question and the PAYLOAD answers it. Before this,
  // nothing read the parameter at all: a family who had just paid €350 was
  // returned to a page reading "Still to pay €350.00" with no acknowledgement
  // and no explanation, which is indistinguishable from a payment that failed.
  //
  // Three kinds settle into three different places, which is why the kind
  // travels rather than being guessed:
  //
  //   registration  a debt on the registration falls
  //   session       a debt on one or more evenings falls
  //   bundle        a bundle APPEARS, with nothing outstanding either side of it
  //
  // The first two are watched by the figure going down or reaching zero. The
  // third has no figure to watch, so it watches the bundle list change — and
  // that is the one case this cannot read perfectly: if the webhook won the race
  // the bundle is already listed on arrival and nothing will change, so the
  // wait ends on the slow message. Its wording is true either way, which is why
  // it is phrased as "if it is not listed below" rather than as a failure.
  var PAID_TRIES = 6;
  var PAID_GAP_MS = 1500;

  // What to watch, per kind. A number that is expected to FALL, or a count
  // expected to CHANGE. Null means there is nothing sensible to watch and the
  // acknowledgement is all a family gets.
  function owedOnReg(d) {
    var r = (d && d.registration) || {};
    if (r.owedCents == null) return 0;
    return Math.max(0, r.owedCents - (r.paidCents || 0) - (r.creditedCents || 0));
  }
  function owedOnSessions(d) {
    var rows = (d && d.perSession && d.perSession.sessions) || [];
    var total = 0;
    rows.forEach(function (row) {
      if (row.owedCents) total += Math.max(0, row.owedCents - (row.paidCents || 0));
    });
    return total;
  }
  function bundleCount(d) {
    // `held`, which is what bundlesPayload() calls the list of bundles this
    // participant owns — `offers` beside it is what they could buy, and that
    // one changes for reasons nothing to do with a purchase.
    var list = (d && d.perSession && d.perSession.held) || [];
    // The LENGTH and the entries together: buying a second five-entry bundle
    // when one is already held changes the count, and buying the first changes
    // both. Either way this string moves when a purchase lands.
    return list.length + ':' + list.reduce(function (n, b) { return n + (b.entries || 0); }, 0);
  }
  var PAID_WATCH = {
    registration: { read: owedOnReg, falls: true },
    session: { read: owedOnSessions, falls: true },
    bundle: { read: bundleCount, falls: false }
  };

  var paidTries = 0;

  // Called after each registration payload lands on the activity view. `again`
  // redraws the page from scratch, which is what runs when the figures move.
  function paidWatch(data, again) {
    var kind = param('paid');
    if (!kind) return;
    var watch = PAID_WATCH[kind];

    // An older Checkout, opened before the kind travelled, comes back as
    // `paid=1`. It still deserves the acknowledgement; there is just nothing
    // named to wait for.
    if (!watch) { paidSettled(); return; }

    var now = watch.read(data);
    if (watch.falls && !(now > 0)) { paidSettled(); return; }

    if (paidTries === 0) say('ok', T.paidSettling, true);
    // Giving up still drops the marker. The message has been delivered, and
    // leaving it in the URL means a reload re-runs the whole six-try wait and
    // says the same thing again — on figures that have almost certainly caught
    // up by then, since the webhook is what we were waiting for.
    if (paidTries >= PAID_TRIES) { say('ok', T.paidSlow, true); dropPaid(); return; }
    paidTries++;

    window.setTimeout(function () {
      post(REGS, { action: 'registration',
                   participantId: param('p'), activityId: param('a') })
        .then(function (res) {
          if (!res.ok || !res.data) { say('ok', T.paidSlow, true); return; }
          var then = watch.read(res.data);
          var moved = watch.falls ? (then < now) : (then !== now);
          // A redraw re-enters this function with the new payload, and
          // paidTries is kept across it, so the wait is bounded whether the
          // figures move once, partly, or not at all.
          if (moved) return again();
          paidWatch(res.data, again);
        });
    }, PAID_GAP_MS);
  }

  // Thank them, and take the parameter out of the URL so a reload does not
  // announce the same payment again.
  function paidSettled() {
    say('ok', T.paidThanks);
    dropPaid();
  }

  // The p/a pair is what addresses this page, so it stays; `paid` is the only
  // thing being taken out.
  function dropPaid() {
    rewriteQuery('p=' + encodeURIComponent(param('p') || '') +
                 '&a=' + encodeURIComponent(param('a') || ''));
  }

  // WHY A PAYMENT LINK DID NOT OPEN STRIPE.
  //
  // /pay answers a 302 and never a body, so a refusal has nowhere to put its
  // own words — it lands here instead, with a reason in the query, and this is
  // where the reason becomes a sentence. Every one of them is recoverable by
  // signing in, which is why the page underneath is the family's own and not an
  // error screen: an expired link is a slower route to the same payment, not a
  // dead end.
  function payLinkNotice() {
    var reason = param('pay');
    if (!reason) return;
    var table = T.payLink || {};
    // 'nothing-due' is the one that is good news — somebody already paid.
    say(reason === 'nothing-due' ? 'ok' : 'warn', table[reason] || T.problem);
  }

  // One place decides what a failed call says. A network failure and a refusal
  // are different things and a family should not be told "something went wrong"
  // when the truth is "you are offline".
  function failure(res) {
    if (res.status === 0) return T.offline;
    return (res.data && res.data.error) || T.problem;
  }

  // The rule, in the reader's own language, with the number from the one
  // constant. Said in three places, so it is built in one.
  function pwHint() { return T.passwordHint.replace('{n}', MIN_PASSWORD); }

  // The optional third argument is a HINT: the rule a field expects, said before
  // it is broken rather than as a refusal afterwards. It is `aria-describedby`
  // and not a second label, so a screen reader reads it after the label rather
  // than in place of it.
  // ⚠ THE NATIVE BUBBLE IS THE BROWSER'S UI, AND ITS WORDS ARE OURS TO SET.
  //
  // A family on the HEBREW page, filling in a HEBREW form, under a HEBREW
  // heading, typed a partial date of birth and was answered "Please enter a
  // valid value. The field is incomplete or has an invalid date." That is the
  // same class of bug as the terms checkbox one screen over and as the native
  // <input type="time"> the admin dropped: the VALUE was never in question, the
  // display was one the page could not control.
  //
  // The difference is that this one has an API for it. setCustomValidity()
  // replaces the sentence and keeps every property `required` was kept for --
  // the bubble is anchored to the field, the browser scrolls there, and the
  // submit is still blocked. So `required`, `minlength` and type="email" stay
  // exactly as they were and only the words change; there is no second
  // validation pass to fall out of step with the server's.
  //
  // It is done HERE rather than per form, because there is one field() and a
  // dozen callers, and the next form added would otherwise bring the English
  // straight back -- the same reason say() scrolls rather than each handler.
  //
  // ⚠ IT MUST BE CLEARED ON INPUT. A custom message IS the invalid state
  // rather than a description of one, so a field set once and never cleared can
  // never be submitted again, whatever is typed into it.
  function guardNative(input) {
    input.addEventListener('invalid', function () {
      var v = input.validity;
      input.setCustomValidity(
        v.valueMissing ? T.needValue
        : v.typeMismatch ? T.needEmail
        // An incomplete date -- "31/mm/yyyy". It reads as EMPTY from script, so
        // no handler of ours could tell it from an untouched box; only the
        // widget knows, which is why this one has to be said in the bubble.
        : v.badInput ? T.needDate
        : v.tooShort ? pwHint()
        : T.needValue);
    });
    input.addEventListener('input', function () { input.setCustomValidity(''); });
  }

  function field(label, attrs, hint) {
    var id = 'f-' + label.replace(/\W+/g, '') + Math.random().toString(36).slice(2, 7);
    var tipId = hint ? id + '-h' : null;
    var input = el('input', Object.assign({ id: id, type: 'text' },
                                          tipId ? { 'aria-describedby': tipId } : {},
                                          attrs || {}));
    guardNative(input);
    return { row: el('div', { class: 'acc-field' }, [
      el('label', { for: id, text: label }), input,
      hint ? el('p', { class: 'acc-hint', id: tipId, text: hint }) : null
    ]), input: input };
  }

  // Any row of buttons. One helper rather than a margin on each button, so the
  // gap cannot be forgotten the next time two of them end up side by side — and
  // it is a flex row with `gap`, so the order follows the page direction and
  // there is nothing directional to get wrong in Hebrew.
  function actions(kids) {
    return el('div', { class: 'acc-actions' }, kids);
  }

  function section(title, kids, id) {
    return el('section', { class: 'acc-card', id: id || null },
      [title ? el('h2', { text: title }) : null].concat(kids || []));
  }

  // ⚠ `pending` AND `approved` BOTH READ "registered" TO A FAMILY, on purpose.
  // The two are a real distinction on our side — approved is what opens
  // payment — but "waiting for an answer" is not the state a parent is in.
  // They have registered; if we cannot take the place we write to them and say
  // so, which is the rejection message. Both are payable, so the difference is
  // not a button either. Do not put the word "pending" back in front of a
  // family — the admin queue is where that word belongs.
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
        var done = busy(btn);
        post(AUTH, { action: 'requestReset', email: fe.input.value }).then(function (res) {
          done();
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
      var done = busy(go);
      var who = (e1.input.value || '').trim().toLowerCase();
      post(AUTH, { action: 'signin', email: e1.input.value, password: p1.input.value })
        .then(function (res) {
          done();
          if (!res.ok) {
            // Counted per address, so trying a second address does not arrive
            // already half way to the limit — and 401 only, because a network
            // failure is not a wrong password and must not spend a try.
            var n = res.status === 401
              ? (signinFails[who] = (signinFails[who] || 0) + 1)
              : (signinFails[who] || 0);
            var tail = !n ? ''
              : n >= MAX_SIGNIN_ATTEMPTS
                ? ' ' + T.signinLocked.replace('{min}', SIGNIN_LOCK_MINUTES)
                : ' ' + T.signinAttempt.replace('{n}', n).replace('{max}', MAX_SIGNIN_ATTEMPTS);
            return say('err', failure(res) + tail);
          }
          // Getting in clears the count, or a person who signs in, signs out and
          // mistypes once is told they are on their fourth try.
          delete signinFails[who];
          window.MemberSession.set(sessionFor(res.data));
          if (opts.onSignedIn) return opts.onSignedIn(res.data.account);
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
    var p1 = field(T.password, { type: 'password', required: 'required',
                                 minlength: MIN_PASSWORD, autocomplete: 'new-password' }, pwHint());
    if (opts.email) { e1.input.value = opts.email; e1.input.readOnly = true; }

    var langSel = el('select', {});
    [['he', 'עברית'], ['en', 'English'], ['ru', 'Русский']].forEach(function (o) {
      langSel.appendChild(el('option', { value: o[0], text: o[1], selected: o[0] === lang || null }));
    });

    // AN ACCOUNT CANNOT EXIST WITHOUT ACCEPTING THE TERMS, and termsAcceptedAt
    // is stored. The links are per-language and point at the reader's own tree;
    // the pages themselves say which version is legally binding.
    // ⚠ NOT `required`, AND THAT IS THE ONLY FIELD ON THIS FORM WHERE IT IS
    // WORTH THE TRADE. A native validation bubble is drawn by the BROWSER, in
    // the browser's language, with no attribute that changes it — so a family
    // on the Hebrew page was shown "Please tick this box if you want to
    // proceed." in English, over a Hebrew form. Same class of problem as a
    // native <input type="time"> printing AM/PM at an admin in Cyprus: the
    // stored value was never in question, the display was one the page could
    // not control.
    //
    // The other nine `required` fields here keep it, deliberately. On a text or
    // email box the attribute also buys format checking, focus and scroll, and
    // the message is the browser's own UI in the language its owner set it to.
    // A checkbox has no format to check, so `required` buys the bubble and
    // nothing else — which makes this the one place the trade is free.
    var agree = el('input', { type: 'checkbox', id: 'acc-terms' });
    var terms = el('div', { class: 'acc-check' }, [agree, el('label', { for: 'acc-terms' }, [
      el('span', { text: T.termsPre }),
      el('a', { href: base + '/terms', target: '_blank', rel: 'noopener', text: T.termsLink }),
      el('span', { text: T.termsMid }),
      el('a', { href: base + '/privacy', target: '_blank', rel: 'noopener', text: T.privacyLink })
    ])]);

    var go = el('button', { type: 'submit', class: 'btn-primary', text: T.signUp });
    var form = el('form', { onsubmit: function (e) {
      e.preventDefault();
      // Checked here rather than on the way back, so the answer arrives with no
      // round trip — and it is the SAME sentence the server would have sent, out
      // of the one table, so the two doors cannot word it differently. say()
      // scrolls its notice into view, which the bubble did for free and is the
      // half worth keeping: this is the tallest form in the family area.
      if (!agree.checked) return say('err', T.termsRequired);
      var done = busy(go);
      post(AUTH, {
        action: 'signup', email: e1.input.value, password: p1.input.value,
        termsAccepted: agree.checked,
        profile: { firstName: f.input.value, lastName: l.input.value,
                   phone: ph.input.value, preferredLanguage: langSel.value }
      }).then(function (res) {
        done();
        if (!res.ok) return say('err', failure(res));
        // SAID, rather than left to be inferred from the screen changing. The
        // dashboard appearing is a real signal and it is not the whole story:
        // an address still has to be confirmed, and the mail saying so has just
        // been sent.
        flash(T.signUpDone);
        // A session immediately. Making somebody sign in again with the password
        // they typed ten seconds ago is a step that exists only because it was
        // easier to build.
        window.MemberSession.set(sessionFor(res.data));
        if (opts.onSignedIn) return opts.onSignedIn(res.data.account);
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
        el('span', { text: T.verifyBanner + ' ' }), resendButton()
      ]));
    }

    // ⚠ THERE IS NO REGISTER PANEL HERE, and that is the point of the screen.
    // The dashboard answers "what am I in" and "what else is there" — a form for
    // joining one particular activity is neither, and sitting at the top of a
    // page headed "My family" it read as the place registration lives. It moved
    // to /account/activity?register=<slug>, which is a page ABOUT an activity,
    // and which the same URL then becomes the registration page for.
    var panels = {
      summary: el('div', {}), regs: el('div', {}), credit: el('div', {})
    };
    Object.keys(panels).forEach(function (k) { mount.appendChild(panels[k]); });

    // ⚠ ONE CALL FOR THE WHOLE DASHBOARD. It was three — the participant count,
    // the registrations and the credit balance — asked of two functions, each
    // authenticating and each opening its own stores. They are one question
    // about one account.
    //
    // The skeletons go in FIRST and synchronously, so the screen has its shape
    // before the request leaves. A blank page that fills in later is
    // indistinguishable from a page that is broken.
    panels.summary.appendChild(skeleton('tiles'));
    panels.regs.appendChild(skeleton('list'));
    load();

    function load() {
      post(REGS, { action: 'dashboard' }).then(function (res) {
        clear(panels.summary);
        clear(panels.regs);
        clear(panels.credit);
        if (!res.ok) {
          return panels.regs.appendChild(section(T.activitiesTitle,
            [el('p', { class: 'acc-notice is-err', text: failure(res) })]));
        }
        renderSummary(panels.summary, account, res.data.participantCount);
        renderRegistrations(panels.regs, res.data.registrations || []);
        renderCredit(panels.credit, res.data);
      });
    }
  }

  // Two cards: who is on this account, and who you are. Both lead to the same
  // page on different tabs — the count is a link, not an ornament.
  function renderSummary(where, account, count) {
    clear(where);
    var familyCard = el('a', { class: 'acc-tile', href: url('/account/details', 'tab=family') }, [
      el('span', { class: 'acc-tile-label', text: T.familyTitle }),
      el('span', { class: 'acc-stat', text: count == null ? '—' : String(count) }),
      el('span', { class: 'acc-meta', text: T.people })
    ]);

    var meCard = el('a', { class: 'acc-tile', href: url('/account/details') }, [
      el('span', { class: 'acc-tile-label', text: T.profileTitle }),
      el('span', { class: 'acc-meta', text: account.email }),
      el('span', { class: 'acc-tile-go', text: T.editDetails })
    ]);

    where.appendChild(el('div', { class: 'acc-tiles' }, [familyCard, meCard]));
  }

  // ---- registering for an activity ----
  //
  // ⚠ A DROP-IN AND A TERM ARE TWO DIFFERENT DECISIONS, AND THIS DRAWS BOTH.
  //
  // A term is one choice — this child, this activity, for months — and it is
  // made once. A drop-in is "we will come on Tuesday": who, which dates, pay.
  // Running the second through the first meant registering, waiting, coming
  // back, booking dates one at a time and then hunting for a way to pay each of
  // them, which is a term's machinery charged to somebody buying one evening.
  //
  // So the drop-in panel asks the whole question at once and ends at Checkout.
  // The registration still exists underneath — it carries the guardian link, the
  // frozen terms and an admin's ability to say no — and a family never has to
  // know that.
  function renderRegister(where, slug) {
    clear(where);
    where.appendChild(section(T.registerTitle, [skeleton('panel')]));
    // ⚠ ONE CALL. This was the activity and the family list together, and then a
    // third fetch for the evenings once the select existed — three waits on the
    // first signed-in screen an activity page sends anybody to. The server
    // answers all of it from one read of the activity; see `registerPanel`.
    post(REGS, { action: 'registerPanel', slug: slug }).then(function (act) {
      clear(where);
      if (!act.ok) return where.appendChild(section(T.registerTitle,
        [el('p', { class: 'acc-notice is-err', text: failure(act) })]));
      var a = act.data.activity;
      var people = act.data.participants || [];
      var title = T.registerTitle + ' · ' + pick(a.title);

      if (!people.length) {
        return where.appendChild(section(title, [
          el('p', { class: 'acc-intro' }, [
            el('span', { text: T.noParticipants + ' ' }),
            el('a', { class: 'acc-link', href: url('/account/details', 'tab=family'),
                      text: T.addSomeone })
          ])
        ]));
      }

      // ⚠ THE ADDRESS GATE IS ASKED HERE, ABOVE BOTH SHAPES, because it is one
      // rule now. It sat inside registerTerm() while a drop-in was exempt, so
      // moving it up is the client half of verificationRefusal() losing its
      // type — and it means the next register shape added inherits it instead
      // of somebody remembering to copy the branch.
      //
      // The form is NOT DRAWN AT ALL rather than drawn and refused, which is
      // the one place in the family area where a cosmetic check replaces a
      // control instead of greying one: the server will refuse every time, and
      // a filled-in form that always loses is worse than no form — somebody
      // picks a child, picks dates, presses, and is told the thing they could
      // have been told before they started. The resend button is under the
      // sentence, because this is the first wall a family meets and a refusal
      // plus directions to another page is most of the way to a missing button.
      if (!(S.account && S.account.emailVerifiedAt)) {
        return where.appendChild(section(title, [
          el('p', { class: 'acc-notice is-warn' }, [
            el('span', { text: T.registerNeedsVerify + ' ' }), resendButton()
          ])
        ]));
      }

      if (a.perSession) registerPerSession(where, a, people, slug, title, act.data);
      else registerTerm(where, a, people, slug, title);
    });
  }

  // Who is coming. One list for both shapes, because "Noa Levi" and "Michal
  // Shinitzky (me)" are the same kind of thing — a person this account may
  // register.
  function peopleSelect(people) {
    var who = el('select', {});
    people.forEach(function (c) {
      who.appendChild(el('option', { value: c.participantId,
        text: full(c) + (c.isSelf ? ' (' + T.me + ')' : '') }));
    });
    return who;
  }

  // ⚠ WHAT CANCELLING WILL BE WORTH, SAID BEFORE THE BUTTON THAT COMMITS.
  //
  // The cutoffs have been frozen onto every registration since Phase 5 and the
  // family was never told any of them. They found out by meeting one: the cancel
  // button quietly stopped being offered, or the credit came back smaller than
  // expected, and the first mention of a deadline was the refusal applying it.
  //
  // The words are the SERVER'S, from _cancellation-terms.js, for the same reason
  // every refusal here is — the email carries the identical lines, and two copies
  // of a policy is two policies. There is no key for any of this in T.
  //
  // It is deliberately SMALL and deliberately NOT a notice. `.acc-notice` is for
  // something that has happened or is about to go wrong; this is reference, read
  // once here and again in the inbox, and a tinted panel with a leading rule
  // would put a warning under a form nobody has filled in yet.
  function termsNote(lines, title) {
    if (!lines || !lines.length) return null;
    var box = el('div', { class: 'acc-terms' });
    if (title) box.appendChild(el('b', { text: title }));
    lines.forEach(function (line) { box.appendChild(el('span', { text: line })); });
    return box;
  }

  function registerTerm(where, a, people, slug, title) {
    // The address check used to live here and is one level up, above the branch
    // that chooses between this and registerPerSession — one rule for both.
    var who = peopleSelect(people);

    // ⚠ A FULL GROUP IS CHOOSABLE, BECAUSE CHOOSING IT IS HOW YOU JOIN ITS QUEUE.
    //
    // It was `disabled`, with the activity-level "This activity is full" hung
    // off it as a label — so on an activity with two groups, one full and one
    // not, the screen said "2 places left" at the top and "this activity is
    // full" against a row nobody could select, and there was NO WAY TO WAIT for
    // the full one. Reported as "where is the waiting list feature??".
    //
    // The server was right the whole time: hasRoom() answers PER GROUP and
    // `submit` takes a groupId beside `waitlist`, so a queue for one group of a
    // half-empty activity has always been writable. Only the door was missing —
    // the same shape as the invite button labelled with a description.
    //
    // And it matters more here than "a control was hard to find". Under the
    // equal-hours rule two groups can meet on a different day, at a different
    // hour, in a different place, with different teachers and a different age
    // range — that is what groups are FOR. So "the other group has room" is not
    // an answer to a family whose child can only come on Thursdays, and
    // disabling the row told them to go away.
    var groupSel = null;
    if (a.groups) {
      groupSel = el('select', {});
      a.groups.forEach(function (g) {
        groupSel.appendChild(el('option', {
          // ⚠ NOT `registerFull`, which says the ACTIVITY is full. That string
          // sat on a group row directly under a line counting the places still
          // free, which is two statements on one screen contradicting each
          // other. This names what is full and what pressing it will do.
          value: g.groupId, text: g.label + (g.full ? ' — ' + T.groupFull : '')
        }));
      });
    }

    // ⚠ ONE BUTTON, TWO JOBS, AND THE SERVER DECIDES WHICH. `full` comes off the
    // same capacityReport() the refusal is built from, so the label cannot
    // promise a place the next line is about to refuse. The flag it sends only
    // ever chooses between a refusal and a queue — if a place has appeared while
    // this screen was open, the family gets the place, whatever the button said.
    // ⚠ FULLNESS IS THE SELECTED GROUP'S, NOT THE ACTIVITY'S. `a.full` is
    // deliberately ALWAYS FALSE once there is a choice — activityView() sets it
    // `&& !offersAChoice(activity)`, because "is the activity full" is not a
    // question with an honest answer when two groups can each be full or not.
    // Reading it here meant the waiting list could never appear on any
    // multi-group activity, however full every one of its groups was.
    var chosenGroup = function () {
      if (!groupSel || !a.groups) return null;
      return a.groups.filter(function (g) { return g.groupId === groupSel.value; })[0] || null;
    };
    var fullNow = function () {
      var g = chosenGroup();
      return g ? !!g.full : !!a.full;
    };

    // The lead names WHAT is full. On an activity with a choice that is a group;
    // with one group, or none to pick, it is the activity — and saying "this
    // group is full" about the only group there is would be telling a family
    // about a structure the page has never shown them.
    var leadText = function () {
      return chosenGroup() ? T.groupFullLead : T.registerFullLead;
    };

    var isFull = fullNow();
    var wait = null, waitLead = null;
    var go = el('button', { type: 'submit', class: 'btn-primary',
                            text: isFull ? T.registerWaitGo : T.registerGo });
    var form = el('form', { onsubmit: function (e) {
      e.preventDefault();
      var done = busy(go);
      post(REGS, { action: 'submit', slug: slug, participantId: who.value,
                   waitlist: isFull,
                   groupId: groupSel ? groupSel.value : null }).then(function (res) {
        done();
        if (!res.ok) return say('err', failure(res));

        // ⚠ THE PAGE BECOMES THE REGISTRATION IT JUST CREATED. Not a redirect
        // and not a notice sitting where a form was: `submit` hands back the
        // record, so the URL is rewritten from ?register=<slug> to the
        // registration's own ?p=&a= key and the view is drawn again. A family
        // lands on the page that tells them what happens next — the waiting
        // block, or the pay button — which is the question they have the instant
        // they press Register.
        //
        // Rewriting the query also stops the form outliving the errand: left in
        // the URL, a reload or a back button reopens a filled-in registration
        // form for something they have already joined.
        //
        // ⚠ THE MESSAGE IS WRITTEN AFTER THE REDRAW, not before it. renderActivity
        // replaces the notice node on its way in, so saying it first writes into
        // something discarded inside one repaint — the exact bug this file
        // already carries a warning about, one screen over. It builds its notice
        // synchronously, before the fetch leaves, so there is one to write to by
        // the time this line runs.
        var r = res.data && res.data.registration;
        if (!r) return say('err', failure(res));
        rewriteQuery('p=' + encodeURIComponent(r.participantId) +
                     '&a=' + encodeURIComponent(r.activityId));
        renderActivity();
        say('ok', res.data.waiting ? T.registerWaitDone : T.registerDone);
      });
    } }, [
      // ⚠ SAID BEFORE THE PRESS, NOT AFTER IT. A form whose button quietly means
      // something else is a form that surprises people, and the surprise here is
      // about a child's place. `.acc-waiting` is the tinted, unpressable idiom
      // this file already uses for "nothing is wrong, here is what happens next"
      // — deliberately not the solid pill, which on this site means press me.
      wait = el('div', { class: 'acc-waiting', hidden: isFull ? null : 'hidden' }, [
        // ⚠ THE BLOCK'S OWN CLASSES, not a bare <b> and <p>. Its children are
        // styled by class and nothing else, so unclassed elements here would
        // render at browser defaults inside a designed panel — the same shape as
        // `.acc-evening-acts`, which had a name the stylesheet had never heard
        // of and rendered three buttons flush against each other.
        //
        // No glyph, deliberately. The check in the other use of this block means
        // "nothing is wrong, you are registered"; here nothing has been agreed
        // yet, and a tick over "this activity is full" would say the opposite of
        // what the words under it say.
        waitLead = el('p', { class: 'acc-waiting-lead' }, [el('span', { text: leadText() })]),
        el('p', { class: 'acc-waiting-body', text: T.registerWaitBody })
      ]),
      el('div', { class: 'acc-field' }, [el('label', { text: T.registerWho }), who]),
      groupSel ? el('div', { class: 'acc-field' }, [el('label', { text: T.registerGroup }), groupSel]) : null,
      go
    ]);

    // ⚠ THE TERMS FOLLOW THE GROUP, because the cutoffs do. Two groups under
    // the equal-hours rule can meet four times and six, so resolveCutoffs()
    // answers per group and there is no single third session to default from.
    // The server hoists the lines to the activity only when every group says
    // the same thing, which is every activity today; when they differ each
    // option carries its own and this swaps them, rather than printing one
    // group's deadline under a picker offering two.
    var note = el('div', {});
    var showTerms = function (lines) {
      clear(note);
      var box = termsNote(lines, a.cancellationTermsTitle);
      if (box) note.appendChild(box);
    };
    var groupTerms = function () {
      var g = chosenGroup();
      return g ? g.cancellationTerms : null;
    };

    // ⚠ THE BUTTON AND THE BLOCK FOLLOW THE SELECT, because what is being
    // offered changes with it: one group of this activity may have a place and
    // the next may only have a queue. Said BEFORE the press, never discovered
    // after it — a button that quietly means something else is a surprise about
    // a child's place.
    var syncFullness = function () {
      isFull = fullNow();
      go.textContent = isFull ? T.registerWaitGo : T.registerGo;
      if (!wait) return;
      if (isFull) wait.removeAttribute('hidden');
      else wait.setAttribute('hidden', 'hidden');
      if (waitLead) waitLead.childNodes[0].textContent = leadText();
    };

    showTerms(a.cancellationTerms || groupTerms());
    if (groupSel) {
      groupSel.addEventListener('change', function () {
        showTerms(a.cancellationTerms || groupTerms());
        syncFullness();
      });
    }

    where.appendChild(section(title, [
      el('p', { class: 'acc-intro',
                text: a.left == null ? T.unlimited : a.left + ' ' + T.places }),
      form,
      note
    ]));
  }

  // ⚠ ONE SCREEN: WHO, WHICH DATES, PAY.
  //
  // The dates carry their own price and their own room, so they are fetched per
  // person rather than baked into the panel — a participant who already booked
  // the 22nd must not be offered it again and charged twice. The server refuses
  // that anyway; this is so it is never asked for.
  function registerPerSession(where, a, people, slug, title, seed) {
    var who = peopleSelect(people);
    var dates = el('div', { class: 'acc-dates' });
    var go = el('button', { type: 'submit', class: 'btn-primary', text: T.bookAndPay,
                            disabled: true });
    var rows = [];

    who.addEventListener('change', load);

    var form = el('form', { onsubmit: function (e) {
      e.preventDefault();
      var chosen = rows.filter(function (row) { return row.box.checked; })
                       .map(function (row) { return row.date; });
      if (!chosen.length) return say('err', T.pickAtLeastOne);
      go.disabled = true;
      go.textContent = T.payOpening;
      post(REGS, { action: 'bookAndPay', slug: slug, participantId: who.value,
                   sessionDates: chosen }).then(function (res) {
        if (!res.ok) {
          go.disabled = false;
          go.textContent = T.bookAndPay;
          // A refusal naming dates is worth re-reading the list for: what
          // changed is on the screen the family is looking at.
          if (res.data && res.data.reason === 'unavailable') { load(); return say('err', T.datesGone); }
          return say('err', failure(res));
        }
        var d = res.data || {};
        // Checkout is a redirect, not a fetch.
        if (d.url) { location.href = d.url; return; }
        clear(where);
        var link = el('p', {}, [el('a', { class: 'acc-link',
          href: url('/account/activity', 'p=' + encodeURIComponent(who.value) +
                                         '&a=' + encodeURIComponent(a.activityId)),
          text: T.chooseSessions })]);
        var note = d.awaitingApproval ? T.awaitingOk
                 : d.paymentFailed ? T.bookedUnpaid
                 : T.bookedFree;
        where.appendChild(section(null, [
          el('p', { class: 'acc-notice is-ok', text: note }), link
        ]));
      });
    } }, [
      el('div', { class: 'acc-field' }, [el('label', { text: T.registerWho }), who]),
      el('div', { class: 'acc-field' }, [el('label', { text: T.pickDates }), dates]),
      go
    ]);

    where.appendChild(section(title, [
      el('p', { class: 'acc-intro', text: T.perSessionIntro }),
      form,
      termsNote(a.cancellationTerms, a.cancellationTermsTitle)
    ]));
    load();

    // The running total is on the button, because that is what it is the price
    // of. A separate "Total" line beside a button reading only "Pay" asks a
    // reader to connect two things that could have been one.
    function retotal() {
      var sum = 0, n = 0;
      rows.forEach(function (row) { if (row.box.checked) { sum += row.price; n++; } });
      go.disabled = !n;
      go.textContent = n ? T.bookAndPay + ' · ' + money(sum) : T.bookAndPay;
    }

    function load() {
      rows = [];
      clear(dates);
      // ⚠ THE FIRST DRAW USES WHAT THE PANEL ALREADY ARRIVED WITH, and only when
      // the payload NAMES the participant the select is on. Seeding by position
      // would put one child's bookings under another child's name the first time
      // the list came back in a different order. It is spent once: a reload after
      // a booking has to ask again, or the table describes the evening before.
      if (seed && seed.sessionsFor && seed.sessionsFor === who.value) {
        var first = seed;
        seed = null;
        return paint(first);
      }
      dates.appendChild(skeleton('table'));
      post(REGS, { action: 'sessions', slug: slug, participantId: who.value }).then(function (res) {
        clear(dates);
        if (!res.ok) return dates.appendChild(el('p', { class: 'acc-notice is-err', text: failure(res) }));
        paint(res.data);
      });
    }

    function paint(data) {
      var list = (data.sessions || []).filter(function (s) { return !s.past; });
      if (!list.length) {
        go.disabled = true;
        return dates.appendChild(el('p', { class: 'acc-note', text: T.noDates }));
      }
      var firstFree = null;
      list.forEach(function (s) {
        var taken = s.status === 'booked' || s.status === 'attended';
        var off = taken || s.full;
        var box = el('input', { type: 'checkbox', value: s.date, disabled: off || null,
                                onchange: retotal });
        var why = taken ? T.dateBooked : s.full ? T.dateFull : money(s.priceCents);
        // ⚠ A LATE PRICE SAYS IT IS ONE, AND NAMES THE ORDINARY ONE.
        //
        // The figure came through alone: €10.00 on a picker under a price card
        // reading €7, with nothing anywhere explaining that a different rate
        // had been applied. A number that disagrees with the published price
        // and does not account for itself reads as a mistake — and the family
        // cannot tell which of the two figures is the error. `priceBasis` has
        // been in this payload since late pricing was built and nothing read
        // it; the standard figure travels beside it now, because "late" on its
        // own is a label and "usually €7.00" is an explanation.
        var late = !off && s.priceBasis === 'late' && s.standardPriceCents != null;
        dates.appendChild(el('label', { class: 'acc-date' + (off ? ' is-off' : '') }, [
          box,
          el('span', { class: 'acc-date-when', text: longDate(s.date) }),
          el('span', { class: 'acc-date-what' }, [
            el('span', { text: why }),
            late ? el('span', { class: 'acc-date-why',
              text: T.lateWhy.replace('{price}', money(s.standardPriceCents)) }) : null
          ])
        ]));
        if (!off) { rows.push({ date: s.date, price: s.priceCents || 0, box: box }); if (!firstFree) firstFree = box; }
      });
      // THE NEXT ONE IS TICKED. A family arriving from a Register button
      // usually means the coming session, and a screen with nothing chosen
      // and a dead button reads as a screen that has not loaded.
      if (firstFree) firstFree.checked = true;
      retotal();
    }
  }

  // ---- what this account is registered to ----
  //
  // EVERY ROW IS A PERSON AND AN ACTIVITY, never an activity alone: Ogen
  // registers one participant to one activity, so two children in the same class
  // are two registrations with their own status, price and cancellation. A row
  // that named only the activity would be hiding which of them it was about.
  // ⚠ THE WAY OUT TO SOMETHING NEW, and it was missing entirely.
  //
  // The family area answers "what am I registered to" and had no answer at all
  // for "what else is there" — the only route to a new activity was the public
  // listing, reachable from the nav of every page except the one a family is
  // standing on when they think of it. Registering happens on an activity page,
  // which is right: that is where the description, the price and the dates are,
  // and the register panel here only exists because the Register button on that
  // page has to land somewhere signed in. So this is a link out, not a second
  // place to register.
  //
  // In the reader's own tree — /activities, /en/activities, /ru/activities.
  // A Lucide glyph, built with createElementNS because an SVG element made with
  // createElement is an HTMLUnknownElement and renders nothing. js/nav.js and
  // js/motifs.js set innerHTML instead; this file has never used it, which is
  // why it can be executed by the DOM shim at all, and adding an HTML parser to
  // that shim to draw one tick would be the wrong trade.
  var SVG_NS = 'http://www.w3.org/2000/svg';
  function lucide(d, size) {
    var svg = window.document.createElementNS(SVG_NS, 'svg');
    [['viewBox', '0 0 24 24'], ['width', size], ['height', size], ['fill', 'none'],
     ['stroke', 'currentColor'], ['stroke-width', '2.5'], ['stroke-linecap', 'round'],
     ['stroke-linejoin', 'round'], ['aria-hidden', 'true'], ['focusable', 'false']
    ].forEach(function (a) { svg.setAttribute(a[0], a[1]); });
    // One string or several. Most Lucide glyphs are one path; a few — the wallet
    // below — are two, and drawing half of one is worse than drawing none.
    (typeof d === 'string' ? [d] : d).forEach(function (one) {
      var path = window.document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', one);
      svg.appendChild(path);
    });
    return svg;
  }
  // ⚠ A CHECK, NOT A CLOCK, and the difference is the whole job of this icon.
  // The block's purpose is "this is normal, nothing is wrong" at a glance; a
  // clock says WAIT, which is the reading it exists to prevent. What is done is
  // the registration — the payment opening is the follow-on, and the sentence
  // carries that.
  //
  // It is 15px and inline rather than white in a 56px disc, which is rule 6's
  // shape. That rule is about section markers: a 56px circle beside one line of
  // text is larger than the thing it labels, the same argument that took the
  // fact-group icons to 34px.
  var CHECK = 'M20 6 9 17l-5-5';
  // Lucide `wallet-minimal`, two paths. A wallet rather than a coin or a card:
  // what the block is about is the balance this account is holding, not a
  // payment instrument, and a card glyph beside a button that takes NO card
  // would say the wrong thing about which pocket the money comes from.
  var WALLET = ['M17 14h.01',
                'M7 7h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2'];

  // ⚠ THE RESEND IS WHEREVER THE REFUSAL IS, not only on the dashboard.
  //
  // A missing button teaches nobody anything, and a button on ANOTHER page is
  // most of the way to a missing one — the register panel used to say "the link
  // to resend it is on your account page", which is a refusal plus directions.
  // Now that a confirmed address is what stands between a family and a course,
  // the one control that fixes it has to be under the sentence that asks for it.
  function resendButton() {
    return el('button', { type: 'button', class: 'acc-link', text: T.verifyResend,
      onclick: function () {
        post(AUTH, { action: 'resendVerification' }).then(function (res) {
          say(res.ok ? 'ok' : 'err', res.ok ? T.verifySent : failure(res));
        });
      } });
  }

  function browseLink() {
    return el('p', { class: 'acc-browse' },
      [el('a', { class: 'acc-link', href: url('/activities'), text: T.browseActivities })]);
  }

  function renderRegistrations(where, list) {
    if (!where) return;
    clear(where);
    if (!list.length) {
      return where.appendChild(section(T.activitiesTitle,
        [el('p', { class: 'acc-intro', text: T.noRegs }), browseLink()]));
    }
    // LIVE OR FINISHED, which is what the data actually says. Not "upcoming and
    // past" — a row carries no end date, so grouping by time would be a claim
    // this list cannot support.
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
    kids.push(browseLink());
    where.appendChild(section(T.activitiesTitle, kids));
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
  function renderCredit(where, data) {
    clear(where);
    var entries = (data && data.entries) || [];
    if (!entries.length) return;
    where.appendChild(section(T.creditTitle, [
      el('p', { class: 'acc-balance', text: money(data.balanceCents) })
    ].concat(entries.map(function (e) {
      return el('div', { class: 'acc-row' }, [
        el('span', { class: 'acc-meta', text: (e.createdAt || '').slice(0, 10) }),
        el('span', { text: (e.type === 'debit' ? '−' : '+') + money(e.amountCents) })
      ]);
    }))));
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
        // ⚠ THIS BUTTON IS THE ONLY DOOR TO INVITING A SECOND GUARDIAN, and it
        // was labelled with the panel's own heading — "Who can see and manage
        // this record". A six-word description, sitting next to "Edit" in a row
        // of one-word controls, reads as a caption rather than as a control, and
        // it never says the word anybody is looking for. QA reported it four
        // times in a row as "I cannot find where to invite the other guardian",
        // against a flow that was built, tested and reachable the whole time.
        //
        // The button names the thing it opens; the sentence stays as the panel's
        // heading, which is where a description belongs. Same lesson as the nav
        // chip that said "Sign in" to somebody who had no account yet: a label
        // that does not name what is behind it hides a feature as effectively as
        // not building it.
        // ⚠ AND ON YOUR OWN RECORD IT IS NOT THE WORD "GUARDIANS".
        //
        // The panel behind it is the same one and belongs there: `isSelf` lives
        // on the LINK precisely because a couple who each manage the other's
        // record are "self" on one of their two links and not on the other, so
        // inviting somebody to co-manage YOUR attendance is a state the model
        // was built to hold, and this is its only door. Removing it would be the
        // invite button labelled with a description all over again, one step
        // further on.
        //
        // What is wrong is the label. An adult holding this account is nobody's
        // ward, and a row reading "Ogen Michal · me · Edit · Guardians" says
        // otherwise in the one place the area has just stopped calling people
        // children. The panel's own heading — "who can see and manage this
        // record" — was already neutral and stays; only the control naming it
        // had to learn that this row is a person rather than a dependant.
        el('button', { type: 'button', class: 'acc-link',
          text: p.isSelf ? T.selfAccess : T.guardians,
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
      var done = busy(go);
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
        done();
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
          var done = busy(ib);
          post(FAMILY, { action: 'invite', participantId: p.participantId, email: ie.input.value })
            .then(function (r) {
              done();
              if (!r.ok) return say('err', failure(r));
              say('ok', T.saved);
              box.removeChild(sub);
            });
        } }, [el('h3', { text: p.isSelf ? T.inviteManager : T.inviteGuardian }), ie.row, ib]));
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
            confirmAction({ question: T.leaveConfirm, yes: T.leave }, function () {
              post(FAMILY, { action: 'leaveParticipant', participantId: p.participantId })
                .then(function (r) {
                  if (!r.ok) return say('err', failure(r));
                  boot();
                });
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
    var nw = field(T.newPassword, { type: 'password', minlength: MIN_PASSWORD,
                                   autocomplete: 'new-password' }, pwHint());
    var pgo = el('button', { type: 'submit', class: 'btn-primary', text: T.changePassword });

    where.appendChild(section(T.profileTitle, [
      el('form', { onsubmit: function (e) {
        e.preventDefault();
        var done = busy(go);
        post(AUTH, { action: 'updateProfile', profile: {
          firstName: f.input.value, lastName: l.input.value,
          phone: ph.input.value, preferredLanguage: langSel.value
        } }).then(function (res) {
          done();
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
        var done = busy(pgo);
        post(AUTH, { action: 'changePassword', currentPassword: cur.input.value,
                     newPassword: nw.input.value }).then(function (res) {
          done();
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
    payLinkNotice();

    // ⚠ REGISTERING HAPPENS HERE, not on the dashboard. This URL is the family
    // area's page ABOUT one activity, and ?register=<slug> is the state it is in
    // before there is a registration to show. The panel has to live behind a
    // sign-in — the public activity page is static and cannot ask WHO — and this
    // is the signed-in page that is already about an activity.
    //
    // The same URL becomes the registration page the moment the form succeeds,
    // which is why this is one view with two entry points rather than two views.
    var reg = param('register');
    if (!p && !a && reg) return renderRegister(body, reg);

    if (!p || !a) return body.appendChild(section(null,
      [el('p', { class: 'acc-notice is-err', text: T.regNotFound })]));

    body.appendChild(section(null, [skeleton('panel')]));
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

      body.appendChild(costBlock(r, act, res.data.balanceCents, renderActivity,
                                 res.data.perSession));

      // The sessions. A course lists the dates it meets on, which is the same
      // table the published page carries. A drop-in lists the evenings with what
      // each one is, what it cost, and whether it can still be booked or given
      // back — an activity paid for one evening at a time is the only place
      // "attended" means anything.
      if (r.type === 'dropin') {
        // Bundles BEFORE the evenings. What a family holds decides how they read
        // the list under it — an evening costing nothing makes sense once the
        // bundle above it has been seen, and reads as a bug otherwise.
        //
        // ⚠ SEEDED, not re-fetched. This screen was three round trips for one
        // page and each read the same activity file; the call above now carries
        // both payloads. The panels keep their own fetch for the REDRAW after a
        // booking or a move, which is one panel changing rather than the page.
        renderBundlePanel(body, r, act, res.data.perSession);
        renderEvenings(body, r, act, res.data.perSession, res.data.balanceCents);
      }
      else if (act && act.sessionRows && act.sessionRows.length) {
        body.appendChild(section(T.sessionsTitle, [courseSessions(act.sessionRows)]));
      }

      // A LINK FROM AN INBOX ARRIVES BEFORE THE PAGE EXISTS. The hash is
      // resolved by the browser at load, and every card on this screen is drawn
      // a fetch later — so the native anchor jump finds nothing and a family
      // sent to #pay lands at the top, which is the behaviour this was meant to
      // fix. Scrolling once the card is in the document is the whole mechanism.
      //
      // Guarded rather than assumed: scrollIntoView is a browser method and the
      // DOM this script is tested in implements only what it uses.
      if (window.location.hash === '#pay') {
        var card = document.getElementById('pay');
        if (card && card.scrollIntoView) card.scrollIntoView();
      }

      // AFTER the cards are drawn, so the acknowledgement is written into the
      // notice this render owns rather than one about to be replaced — the same
      // ordering rule the flash already follows. It does nothing at all unless
      // the reader has just come back from Checkout.
      paidWatch(res.data, renderActivity);

      // ⚠ THE TERMS, ON THE PAGE THE FAMILY COMES BACK TO. The register panel
      // said them once, to whoever was holding the laptop that evening; this is
      // where somebody looks six weeks later to find out whether it is still
      // possible and what it would be worth. They are the terms FROZEN on this
      // registration, not the activity's current ones, so an admin changing the
      // policy in March cannot re-quote it at a January family.
      //
      // Drawn for a live registration only. On one that is over the deadline is
      // no longer a thing anybody can act on, and a list of rules under a
      // cancelled row reads as an offer.
      if (r.status === 'pending' || r.status === 'approved') {
        var tn = termsNote(r.cancellationTerms, r.cancellationTermsTitle);
        if (tn) body.appendChild(tn);
      }

      // Offered only when the frozen terms allow it. The same creditFor() the
      // server will apply decided this, so what is shown is what happens.
      if ((r.status === 'pending' || r.status === 'approved') &&
          r.cancellation && r.cancellation.mayCancel !== false) {
        body.appendChild(actions([
          el('button', { type: 'button', class: 'acc-link is-danger', text: T.cancelReg,
            onclick: function () {
              confirmAction({ question: T.cancelRegConfirm, note: creditNote(r.cancellation),
                              yes: T.cancelReg }, function () {
                post(REGS, { action: 'cancel', participantId: r.participantId, activityId: r.activityId })
                  .then(function (c) {
                    if (!c.ok) return say('err', failure(c));
                    window.location.href = url('/account');
                  });
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
  function costBlock(r, act, balance, onDone, perSession) {
    // ⚠ A FAMILY IN THE QUEUE HAS NO COST CARD, because they have no place and
    // owe nothing. Priced rows, a paid line and a "still to pay" of zero would
    // be the screen describing a purchase nobody has made — the same failure the
    // drop-in card had when it arrived at "you owe nothing" for a family who
    // owed €7. What they came to this page for is the state and the way out of
    // it, so that is the whole card.
    if (r.status === 'waitlisted') {
      // ⚠ AND THERE WAS NO WAY TO TAKE THE PLACE FROM THIS SCREEN.
      //
      // The queue has always been claimable — `openRegistration()` reads a
      // waiting record and converts it, because "claiming is not an action" and
      // a family who was queueing and is now registering IS claiming. And the
      // place-open email's own comment said it pointed here "because that is
      // where the button that takes the place is". There was no such button.
      // The only control on this card was Leave the waiting list, so the one
      // thing the email invites somebody to do could not be done where it sent
      // them — reported as "it should be simply: I accept, I click, and I get
      // the payment button".
      //
      // A place free for THIS registration's group, never for the activity.
      // Under the equal-hours rule the other group having room is not this
      // family's place, and offering it would be a button that loses every time.
      var mine = null;
      if (act && act.groups && r.groupId) {
        mine = act.groups.filter(function (g) { return g.groupId === r.groupId; })[0] || null;
      }
      var openNow = !!act && (mine ? !mine.full : !act.full);

      return section(T.costTitle, [
        el('div', { class: 'acc-waiting' }, [
          el('p', { class: 'acc-waiting-lead' },
             [el('span', { text: openNow ? T.waitingOpenLead : T.waitingLead })]),
          el('p', { class: 'acc-waiting-body',
                    text: openNow ? T.waitingOpenWhy : T.waitingWhy })
        ]),
        actions([
          // The primary, and only while there is something to take. A dead
          // button under "a place has opened" would be worse than no button.
          openNow ? el('button', { type: 'button', class: 'btn-primary', text: T.takePlace,
            onclick: function (e) {
              var done = busy(e.currentTarget);
              // ⚠ `waitlist: false` ON PURPOSE. Everybody waiting was emailed at
              // the same moment, so losing the race is an ORDINARY outcome — and
              // with the flag true the server would quietly re-queue them and the
              // screen would look like the claim had worked. False means it is
              // refused and said out loud, and the redraw puts the button away.
              post(REGS, { action: 'submit', slug: act.slug,
                           participantId: r.participantId, groupId: r.groupId || null,
                           waitlist: false }).then(function (res) {
                done();
                // ⚠ REDRAW FIRST, SAY SECOND, ON BOTH PATHS. renderActivity()
                // replaces the notice node on its way in, so saying it first
                // writes into something discarded inside one repaint — the bug
                // this file already carries a warning about, two screens over.
                // Caught here by the suite rather than by a family who pressed a
                // button and was told nothing at all.
                var msg = res.ok ? T.takePlaceDone : failure(res);
                onDone();
                say(res.ok ? 'ok' : 'err', msg);
              });
            } }) : null,
          el('button', { type: 'button', class: 'btn-secondary', text: T.leaveWait,
            onclick: function () {
              confirmAction({ question: T.leaveWaitConfirm, yes: T.leaveWait }, function () {
                post(REGS, { action: 'leaveWaitlist', participantId: r.participantId,
                             activityId: r.activityId }).then(function (res) {
                  if (!res.ok) return say('err', failure(res));
                  // Carried ACROSS the page change, because the screen that
                  // would have shown it is the one being left.
                  flash(T.leaveWaitDone);
                  window.location.href = url('/account');
                });
              });
            } })
        ])
      ], 'pay');
    }
    // ⚠ A DROP-IN'S COST CARD IS ABOUT ITS EVENINGS, NOT ABOUT A TERM.
    //
    // owedCentsFor() bills the yearly fee and, for a COURSE, the term price — so
    // a drop-in registration owes nothing, correctly. The card then drew the
    // activity's price rows and the registration's own figures, and the result
    // read "Cost per session €7 · Paid €0.00 · Still to pay €0.00" while an
    // unpaid evening sat in the table directly below it. Every number was true
    // and the card was answering a question this activity does not have,
    // arriving at "you owe nothing" for a family who owed €7. Reported as "I see
    // 7 EUR and also that I don't need to pay anything — very confusing."
    //
    // It also put two currency formats on one card: the price rows are the
    // published page's builder and print "€ 7", the money lines print "€0.00".
    // Dropping the rate row here fixes that as a side effect and removes a
    // duplicate — the rate is already on the facts card above, from the same
    // builder that puts it on the public page.
    var rows = r.type === 'dropin' ? [] : ((act && act.priceRows) || []);
    var kids = rows.map(function (row) {
      return el('div', { class: 'acc-money' }, [
        el('span', {}, [
          el('span', { text: row.label }),
          row.note ? el('span', { class: 'acc-note', text: row.note }) : null
        ]),
        el('b', { text: row.value })
      ]);
    });
    // ⚠ ONLY THE WAIVER, AND ONLY WHEN THERE IS A FEE TO WAIVE.
    //
    // This line used to be unconditional, and both halves of it were wrong.
    // "Includes the yearly registration fee" restated a row that is already on
    // the card directly above it, labelled and priced — and on a drop-in with no
    // registration fee at all it was simply untrue: €7 for an evening, followed
    // by a sentence about an annual fee nobody is charging.
    //
    // The half worth keeping is the other one. "Already paid" is why this term
    // is 300 and not 350, and it is the one thing about the fee a family cannot
    // work out from the figures in front of them. With no fee on the activity
    // there is nothing to have been waived, so it says nothing at all.
    if (r.feeCharged === false && r.registrationFee) {
      kids.push(el('p', { class: 'acc-meta', text: T.feeAlready }));
    }
    // The figures. On a drop-in they come from the EVENINGS — summed on the
    // server, in sessionsPayload(), because a screen adding up money is a second
    // implementation and the one that drifts is the one a family reads out to an
    // admin. With nothing booked the card says so rather than printing three
    // zeroes that look like a settled bill.
    var t = r.type === 'dropin' ? ((perSession || {}).totals || null) : null;
    // ⚠ TWO FIGURES WITH TWO JOBS, DECLARED APART ON PURPOSE. `left` is what
    // THIS REGISTRATION owes, and it is what the pay button below acts on — zero
    // on a drop-in, because the money lives on the evenings and is settled from
    // the table under this card. The evenings' outstanding total is DISPLAY
    // only: opening Checkout for it here would charge a registration that owes
    // nothing. Before this they were one variable and the drop-in case worked by
    // `undefined > 0` being false, which is an accident rather than a rule.
    var left = r.owedCents == null ? null
      : Math.max(0, r.owedCents - (r.paidCents || 0) - (r.creditedCents || 0));
    if (r.type === 'dropin') {
      if (!t || !t.booked) {
        kids.push(el('p', { class: 'acc-meta', text: T.noEveningsYet }));
      } else {
        kids.push(el('div', { class: 'acc-money' }, [
          el('span', { text: T.eveningsBooked }), el('b', { text: String(t.booked) })
        ]));
        kids.push(el('div', { class: 'acc-money is-sum' }, [
          el('span', { text: T.paid }), el('b', { text: money(t.paidCents) })
        ]));
        if (t.creditedCents) {
          kids.push(el('div', { class: 'acc-money' }, [
            el('span', { text: T.credited }), el('b', { text: money(t.creditedCents) })
          ]));
        }
        kids.push(el('div', { class: 'acc-money is-sum' }, [
          el('span', { text: T.stillToPay }), el('b', { text: money(t.outstandingCents) })
        ]));
      }
    } else {
      kids.push(el('div', { class: 'acc-money is-sum' }, [
        el('span', { text: T.paid }), el('b', { text: money(r.paidCents) })
      ]));
      if (r.creditedCents) {
        kids.push(el('div', { class: 'acc-money' }, [
          el('span', { text: T.credited }), el('b', { text: money(r.creditedCents) })
        ]));
      }
      kids.push(el('div', { class: 'acc-money is-sum' }, [
        el('span', { text: T.stillToPay }), el('b', { text: money(left) })
      ]));
    }

    // THE PAY BUTTON, and what decides whether it is drawn.
    //
    // Cosmetic, like every permission check on this side: the server re-decides
    // both conditions, and the copy exists so a family is not offered an action
    // about to be refused.
    //
    // ⚠ A PENDING REGISTRATION IS NOT PAYABLE — it is EXPLAINED. It was made
    // payable for a release, to fix a card reading "Still to pay €500.00" with
    // no button under it; the bug was real and making it payable was the wrong
    // fix, because `pending` means a person still has something to decide, so
    // paying then buys a place nobody has agreed to give. See isPayable() in
    // _checkout.js for the full round trip. The branch below is the right fix.
    //
    // A settled balance draws nothing, since the figures above already say why.
    //
    // The third condition is a confirmed email address, and it is now asked of
    // everything: see verificationRefusal() in account-registrations.js, which
    // takes no type. It used to read `r.type !== 'dropin'` here, and a client
    // that hides a button the server would honour — or offers one it will
    // refuse — is a page that looks broken either way, so the two have to read
    // the same field. This one has no field left to read.
    var needsVerify = !(S.account && S.account.emailVerifiedAt);
    var payable = r.status === 'approved';

    // ⚠ THE WALLET SITS BEHIND THE SAME TWO GATES, and it did not.
    //
    // It was drawn ABOVE this block with no conditions at all, so on a card
    // where the pay button was correctly withheld — a registration still
    // waiting for an admin, or an address never confirmed — a "Use credit"
    // button sat in its place settling the very same debt. Reported from one
    // session, both ways round.
    //
    // Spending credit is paying: it settles the same figure on the same record
    // and writes the same payment status. The only difference is which pocket
    // it comes out of, and no gate here is about the pocket. The server refuses
    // it now whatever this draws — see useCredit in account-registrations.js —
    // and this is the cosmetic half, so a family is not offered an action that
    // is about to be refused.
    //
    // It is drawn BEFORE the pay button rather than after, because a family
    // holding credit should see what they already have before what they have to
    // find; and a full settlement removes the pay button on its own, since
    // `left` falls to zero on the redraw.
    var useIt = (left > 0 && payable && !needsVerify)
      ? creditBlock(left, balance, { participantId: r.participantId,
                                     activityId: r.activityId }, onDone)
      : null;
    if (useIt) kids.push(useIt);

    if (left > 0 && payable && !needsVerify) {
      var go = el('button', { type: 'submit', class: 'btn-primary', text: T.payNow });
      var payForm = el('form', { class: 'acc-pay', onsubmit: function (e) {
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
    } else if (left > 0 && payable) {
      // SHOWN RATHER THAN HIDDEN, because it is something the reader can fix:
      // the resend button is on the dashboard, and a missing button teaches
      // nobody that their address needs confirming.
      kids.push(el('p', { class: 'acc-note', text: T.payNeedsVerify }));
    } else if (left > 0 && r.status === 'pending') {
      // ⚠ THE WAITING STATE, WHICH IS NOT AN ERROR AND MUST NOT LOOK LIKE ONE.
      //
      // This used to be one grey line reading "We will send you a payment link
      // shortly", under a figure saying what was owed — which says as much
      // about a screen that is working as about one that is broken, and names a
      // link that only exists once an admin reaches the queue.
      //
      // It says what is TRUE at a glance and then explains: the registration
      // stands, the payment opens here, and we will write. No "pending", no
      // "awaiting approval", no "your request" — the family registered, and
      // being told a decision is pending reads as a decision that might go
      // either way over something they consider settled.
      // ⚠ AND IT SAYS NOTHING ABOUT WHY, WHICH IS A DECISION RATHER THAN A GAP.
      //
      // A version of this named the reason — "the age is outside the range this
      // activity states" — on the argument that an activity set to approve
      // automatically and then not doing so reads as a setting being ignored.
      // That argument is about the ADMIN's confusion, not the family's, and the
      // sentence it produced lands on a parent as a verdict on their child: at
      // best blunt, at worst insulting, and delivered by a screen at the moment
      // they have just signed up.
      //
      // The flag is advisory and the decision is a person's, so the reason is
      // not a fact about the family yet — it is a note about why somebody is
      // going to look. It belongs on the admin queue, where it already is, with
      // the numbers: "64 · outside 6-10", amber because it is a row to look at
      // rather than a row that was refused.
      //
      // This is the same rule `pending` and `approved` sharing one pill already
      // follows: our queue must not leak onto their screen. An unremarkable step
      // said plainly beats an explanation nobody asked for.
      kids.push(el('div', { class: 'acc-waiting' }, [
        el('p', { class: 'acc-waiting-lead' }, [lucide(CHECK, '15'), el('span', { text: T.waitLead })]),
        el('p', { class: 'acc-waiting-body',
                  text: T.waitBody.replace('{name}', r.participantName || '') })
      ]));
    }
    // ADDRESSABLE, because every message about money links straight to it. The
    // page is the activity, the facts, the price and the sessions; a family
    // opening an email about paying has one question and it was several screens
    // down.
    return section(T.costTitle, kids, 'pay');
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

  // ---- bundles: what was bought in advance ----
  //
  // ⚠ ONE PANEL, TWO QUESTIONS — what I hold, and what I could buy — and they
  // are drawn from one call because they are one decision. A family with two
  // entries left is deciding whether to buy another bundle or pay per session,
  // and splitting that across two screens makes them hold the first number in
  // their head while reading the second.
  //
  // Every figure comes from the server's bundleView(), the same builder the
  // admin roster reads. An admin and a family reading different numbers off the
  // same purchase is the failure that shape exists to prevent.
  function renderBundlePanel(where, r, act, seed) {
    var panel = el('div', {});
    where.appendChild(panel);
    if (!act) return;
    if (seed) paint(seed); else draw();
    return panel;

    function draw() {
      clear(panel);
      panel.appendChild(section(T.buyTitle, [skeleton('panel')]));
      post(REGS, { action: 'bundles', participantId: r.participantId, slug: act.slug })
        .then(function (res) {
          clear(panel);
          if (!res.ok) return;      // a bundle panel that cannot load is not an error a family can act on
          paint(res.data);
        });
    }

    function paint(data) {
      clear(panel);
      var held = data.held || [];
      var offers = data.offers || [];
      if (held.length) panel.appendChild(section(T.bundleTitle, [
        el('p', { class: 'acc-intro', text: T.bundleIntro })
      ].concat(held.map(function (b) { return heldCard(b); }))));
      panel.appendChild(section(T.buyTitle, offers.length
        ? [el('p', { class: 'acc-intro', text: T.buyIntro })]
            .concat(offers.map(function (o) { return offerRow(o); }))
        : [el('p', { class: 'acc-intro', text: T.buyNone })]));
    }

    function heldCard(b) {
      var rows = el('table', { class: 'acc-table' });
      b.rows.forEach(function (row) {
        rows.appendChild(el('tr', {}, [
          el('td', { text: dayMonth(row.date) }),
          el('td', { class: 'acc-meta', text: T.entryState[row.state] || row.state }),
          el('td', {}, [row.mayReschedule ? moveCell(b, row) : null])
        ]));
      });
      return el('div', { class: 'acc-bundle' }, [
        el('div', { class: 'acc-bundle-head' }, [
          // The number a family opens this for, and the largest thing on the
          // card. Derived on the server from the dates used — never a counter.
          el('b', { class: 'acc-bundle-count', text: b.remaining + ' ' + T.bundleOf + ' ' + b.entries }),
          el('span', { class: 'acc-meta', text: T.bundleLeft }),
          b.validUntil
            ? el('span', { class: 'acc-meta', text: T.bundleValid + ' ' + dayMonth(isoOf(b.validUntil)) })
            : null
        ]),
        el('div', { class: 'acc-scroll' }, [rows]),
        b.shortfallCreditedCents > 0
          ? el('p', { class: 'acc-note', text: T.bundleCredited + ' ' + money(b.shortfallCreditedCents) })
          : null
      ]);
    }

    // ⚠ THE DATES OFFERED ARE THE SERVER'S OWN LIST. rescheduleTargets() decided
    // it, and the same function decides the move — so a date on this menu is a
    // date that will be accepted. A client filtering the calendar itself would
    // offer a full evening, or one past the window that was sold.
    function moveCell(b, row) {
      var cell = el('span', {});
      var open = el('button', { type: 'button', class: 'acc-link', text: T.reschedule,
        onclick: function () {
          clear(cell);
          var pickDate = el('select', {});
          (row.targets || []).forEach(function (d) {
            pickDate.appendChild(el('option', { value: d, text: dayMonth(d) }));
          });
          var go = el('button', { type: 'button', class: 'acc-link', text: T.rescheduleGo,
            onclick: function () {
              var done = busy(go);
              post(REGS, { action: 'rescheduleSession', participantId: r.participantId,
                           slug: act.slug, fromDate: row.date, toDate: pickDate.value })
                .then(function (res) {
                  if (!res.ok) { done(); return say('err', failure(res)); }
                  say('ok', T.rescheduleDone);
                  // Both panels move: the entry left one date and landed on
                  // another, and the evenings table below is the other half of
                  // the same fact.
                  draw();
                  if (typeof S.redrawEvenings === 'function') S.redrawEvenings();
                });
            } });
          cell.appendChild(el('span', { class: 'acc-meta', text: T.rescheduleTo + ' ' }));
          cell.appendChild(pickDate);
          cell.appendChild(go);
        } });
      cell.appendChild(open);
      return cell;
    }

    function offerRow(o) {
      var go = el('button', { type: 'button', class: 'btn-primary', text: T.buyGo,
        onclick: function () {
          go.disabled = true;
          go.textContent = T.buyOpening;
          post(REGS, { action: 'buyBundle', participantId: r.participantId,
                       slug: act.slug, bundleId: o.bundleId }).then(function (res) {
            if (res.ok && res.data && res.data.url) { location.href = res.data.url; return; }
            go.disabled = false;
            go.textContent = T.buyGo;
            say(res.ok ? 'ok' : 'err', res.ok ? T.awaitingOk : failure(res));
          });
        } });
      return el('div', { class: 'acc-row' }, [
        el('div', {}, [
          el('b', { text: o.entries + ' ' + T.buySessions + ' · ' + money(o.totalCents) }),
          el('span', { class: 'acc-meta',
                       text: money(Math.round(Number(o.pricePerEntry) * 100)) + ' × ' + o.entries +
                             ' · ' + T.buyValid + ' ' + o.validityDays + ' ' + T.buyDays })
        ]),
        el('div', { class: 'acc-actions' }, [go])
      ]);
    }
  }

  // An instant back to the ISO date the rest of this screen speaks. The bundle's
  // deadline is stored as a number because a reschedule is bounded by an instant
  // rather than by a day.
  function isoOf(ms) {
    var d = new Date(Number(ms));
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }

  // ---- the evenings of a drop-in ----
  function renderEvenings(where, r, act, seed, balance) {
    var panel = el('div', {});
    where.appendChild(panel);
    if (!act) return;
    // A move changes both panels, so the bundle card can ask this one to redraw.
    S.redrawEvenings = draw;
    if (seed) paint(seed); else draw();

    function draw() {
      clear(panel);
      panel.appendChild(section(T.sessionsTitle, [skeleton('table')]));
      post(REGS, { action: 'sessions', participantId: r.participantId, slug: act.slug })
        .then(function (res) {
          clear(panel);
          if (!res.ok) return panel.appendChild(section(T.sessionsTitle,
            [el('p', { class: 'acc-notice is-err', text: failure(res) })]));
          paint(res.data);
        });
    }

    function paint(data) {
      clear(panel);
      var table = el('table', { class: 'acc-table' });
      table.appendChild(el('tr', {}, [
        el('th', { text: T.dateCol }), el('th', { text: T.statusCol }),
        el('th', { class: 'is-num', text: T.owes }), el('th', { class: 'is-num', text: T.paid }),
        el('th', {})
      ]));
      (data.sessions || []).forEach(function (s) {
        table.appendChild(el('tr', {}, [
          el('td', { text: dayMonth(s.date) }),
          el('td', {}, [s.status
            ? el('span', { class: 'acc-pill is-s-' + s.status,
                           text: T.sessionStatus[s.status] || s.status })
            : el('span', { class: 'acc-meta', text: '—' })]),
          // €0.00 on an evening a family paid for in advance reads as a
          // mistake. The reason it is nothing is the interesting part.
          //
          // ⚠ AND SO IS THE REASON IT IS MORE. The date picker has explained a
          // late price since late pricing was built — "late booking · usually
          // €7.00" — and this table, which is where the family comes back to
          // and where the bill actually sits, printed the higher figure alone.
          // Reported twice in one session: "it says cost 7 EUR and you need to
          // pay 10 EUR… very confusing." Both figures were true and neither
          // accounted for itself, and a family cannot tell which of the two is
          // the error.
          //
          // The same class the picker uses, deliberately: one sentence, one
          // treatment, so the two screens cannot drift into two looks for one
          // explanation. And only when the two figures actually DIFFER — an
          // activity whose late price equals its standard one has nothing to
          // explain, and a note on every row is a note nobody reads.
          el('td', { class: 'is-num' }, [
            el('span', { text: s.priceBasis === 'bundle' ? T.fromBundle : money(s.owedCents) }),
            (s.priceBasis === 'late' && s.standardPriceCents != null &&
             s.standardPriceCents !== s.owedCents)
              ? el('span', { class: 'acc-date-why',
                             text: T.lateWhy.replace('{price}', money(s.standardPriceCents)) })
              : null
          ]),
          el('td', { class: 'is-num', text: money(s.paidCents) }),
          el('td', {}, [eveningAction(s, data, r, act, draw, balance)])
        ]));
      });
      panel.appendChild(section(T.sessionsTitle, [el('div', { class: 'acc-scroll' }, [table])]));
    }
  }

  // Book, give back, or nothing. BOOKING NEEDS AN APPROVED REGISTRATION behind
  // it — the registration is the "may come" decision and an admin makes it once,
  // so this does not quietly become a second way in. Cancelling is offered past
  // the deadline too, because a family can always say they are not coming; what
  // changes past it is only what it earns, and creditForSession() on the server
  // decided that before this button was drawn.
  function eveningAction(s, data, r, act, redraw, balance) {
    if (s.status === 'booked') {
      // ⚠ AN EVENING THAT IS BOOKED AND UNPAID HAD NO WAY TO BE PAID.
      //
      // `pay` reads a registration, and a drop-in registration owes nothing —
      // all of the money on a pay-per-session activity sits on the evening. So a
      // family could book one, be shown what it costs, and find nothing to press.
      // Pay comes FIRST here: giving the place back is the destructive option
      // and should not be the only thing offered beside a debt.
      var owing = (s.owedCents || 0) - (s.paidCents || 0);
      var acts = [];
      if (owing > 0) {
        var payBtn = el('button', { type: 'button', class: 'acc-link', text: T.paySession,
          onclick: function () {
            payBtn.disabled = true;
            payBtn.textContent = T.payingSession;
            post(REGS, { action: 'paySession', participantId: r.participantId,
                         slug: act.slug, sessionDate: s.date }).then(function (res) {
              // Checkout is a redirect, not a fetch. On failure the control has
              // to come back, or a transient error leaves a dead button.
              if (res.ok && res.data && res.data.url) { location.href = res.data.url; return; }
              payBtn.disabled = false;
              payBtn.textContent = T.paySession;
              say('err', failure(res));
            });
          } });
        acts.push(payBtn);
      }
      // Credit first, because it is the cheaper of the two ways to settle the
      // same evening and a family holding a balance should not be sent to a card
      // to spend it.
      var useIt = creditButton(owing, balance, {
        participantId: r.participantId, activityId: r.activityId, sessionDate: s.date
      }, redraw);
      if (useIt) acts.unshift(useIt);
      acts.push(el('button', { type: 'button', class: 'acc-link is-danger', text: T.cancelSession,
        onclick: function () {
          confirmAction({ question: T.cancelSessionConfirm, note: creditNote(s.cancellation),
                          yes: T.cancelSession }, function () {
          post(REGS, { action: 'cancelSession', participantId: r.participantId,
                       activityId: r.activityId, sessionDate: s.date }).then(function (c) {
            if (!c.ok) return say('err', failure(c));
            redraw();
          });
          });
        } }));
      // ⚠ `actions()`, NOT A CLASS OF ITS OWN. This was a div carrying
      // `acc-evening-acts`, and shared.css has never had a rule for that name —
      // so three controls in one cell rendered with nothing between them and the
      // live Hebrew page read "תשלום על המפגשביטול מפגש", pay and cancel run
      // together into one word. A class nobody styled is a layout nobody
      // designed, and it is invisible in review precisely because the markup
      // looks deliberate.
      //
      // `.acc-actions` is the row-controls idiom the rest of this file uses —
      // flex and a gap, so the order follows the page direction and there is
      // nothing directional to get wrong. Same reason the admin's evening
      // register reuses `.acts` rather than inventing a second set of row
      // buttons.
      return actions(acts);
    }
    if (s.status === 'attended' || s.status === 'no-show') return null;
    // ⚠ AND NOT AN EVENING THAT HAS ALREADY HAPPENED. `past` has been in this
    // payload since the screen was built and nothing read it, so the table
    // offered "register for this session" beside dates three weeks gone. The
    // server refuses it now too; this is the cosmetic half, as every check on
    // this side is — the point is not to offer what is about to be refused.
    //
    // The register PANEL has always dropped them, which is why it took a report
    // to find: one list, filtered in one place and not the other.
    if (!data.mayBook || s.full || s.past) return null;
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

  // The dead-link answer, with the way out of it. A refusal that does not offer
  // the next step sends somebody back to an inbox to hunt for a link that will
  // not work either.
  function dead() {
    return el('div', {}, [
      el('p', { class: 'acc-notice is-err', text: T.linkDead }),
      el('p', { class: 'acc-alt' }, [
        el('a', { href: url('/account'), text: T.forgot })
      ])
    ]);
  }

  function renderReset() {
    clear(mount);
    notice = el('div', {});
    mount.appendChild(notice);
    var token = param('token');
    if (!token) return mount.appendChild(section(null, [dead()]));

    // ⚠ A DEAD LINK SAYS SO BEFORE ANYTHING IS TYPED. It used to draw the form
    // and refuse on submit, so somebody chose a password, entered it, and only
    // then learned the link had already been used. Reported from QA as exactly
    // that. `resetLive` peeks at the token without consuming it — opening the
    // page must not spend the link — and reveals nothing the holder could not
    // learn by submitting anyway.
    //
    // Drawn optimistically while the check is in flight: a working link is the
    // ordinary case, and a skeleton before every reset would make the common
    // path feel slower to save the rare one a wasted form.
    post(AUTH, { action: 'resetLive', token: token }).then(function (res) {
      if (res.ok && res.data && res.data.live === false) {
        clear(mount);
        notice = el('div', {});
        mount.appendChild(notice);
        mount.appendChild(section(null, [dead()]));
      }
    });

    var p1 = field(T.newPassword, { type: 'password', required: 'required',
                                   minlength: MIN_PASSWORD, autocomplete: 'new-password' }, pwHint());
    var go = el('button', { type: 'submit', class: 'btn-primary', text: T.resetSave });
    mount.appendChild(section(T.resetTitle, [
      el('form', { onsubmit: function (e) {
        e.preventDefault();
        var done = busy(go);
        // A reset ENDS EVERY OTHER SESSION: a reset exists because somebody may
        // have lost control of the account, and leaving the others alive would
        // lock out the owner while whoever took it stayed signed in.
        post(AUTH, { action: 'resetPassword', token: token, password: p1.input.value })
          .then(function (res) {
            done();
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

    if (view !== 'activity') payLinkNotice();
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
      if (view === 'details') renderDetails(S.account);
      else if (view === 'activity') renderActivity();
      else renderAccount(S.account);
      // AFTER the screen is drawn, or it is written into a node about to be
      // replaced — which is exactly the bug it exists to fix. And after WHICHEVER
      // screen: this used to sit past two early returns, so a message carried
      // towards /account/details or /account/activity was dropped in silence.
      if (S.flash) { var m = S.flash; S.flash = null; say('ok', m); }
    });
  }

  boot();
})();
