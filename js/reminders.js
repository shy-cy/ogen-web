// The reminder switch for ONE class, reached from the foot of a reminder email.
//
// ⚠ NOTHING IS CHANGED BY ARRIVING HERE. Loading the page asks the server for
// state and nothing else; switching the reminders off or on takes a press. Mail
// scanners and link-preview bots fetch every URL in a message before a person
// has opened it, so a link that acted on sight would turn a corporate spam
// filter into an unsubscribe — the same trap one-time tokens already met here,
// where a link "followed twice, by a person and then by a mail scanner" had to
// keep working.
//
// ⚠ ONE PAGE, THREE LANGUAGES, and the toggle RE-RENDERS rather than navigating.
// The token is in the query string; a language control that dropped it would
// turn a valid link into a dead one, which is exactly the bug the account pages
// shipped once.

(function () {
  var T = {
    he: {
      lang: 'עברית',
      title: 'תזכורות למפגשים',
      onNow: 'אנחנו שולחים לכם תזכורת יום לפני כל מפגש של:',
      offNow: 'התזכורות לפעילות הזו כבויות:',
      only: 'ההגדרה הזו נוגעת לפעילות הזו בלבד. הודעות אחרות — אישור הרשמה, קבלות על תשלום — ופעילויות אחרות לא יושפעו.',
      stop: 'הפסקת התזכורות',
      start: 'הפעלת התזכורות מחדש',
      stopped: 'התזכורות הופסקו.',
      started: 'התזכורות הופעלו מחדש.',
      bad: 'הקישור הזה כבר לא פעיל. אפשר לשנות את ההגדרה גם מעמוד ההרשמה שלכם.',
      busy: 'רגע…',
      err: 'משהו השתבש. נסו שוב בעוד רגע.'
    },
    en: {
      lang: 'English',
      title: 'Session reminders',
      onNow: 'We email you a reminder the day before each session of:',
      offNow: 'Reminders are switched off for:',
      only: 'This setting covers this activity only. Other messages — registration confirmations, payment receipts — and other activities are not affected.',
      stop: 'Stop these reminders',
      start: 'Turn these reminders back on',
      stopped: 'Reminders stopped.',
      started: 'Reminders turned back on.',
      bad: 'This link is no longer valid. You can also change this from your own registration page.',
      busy: 'One moment…',
      err: 'Something went wrong. Please try again in a moment.'
    },
    ru: {
      lang: 'Русский',
      title: 'Напоминания о занятиях',
      onNow: 'Мы отправляем напоминание за день до каждого занятия:',
      offNow: 'Напоминания отключены для:',
      only: 'Эта настройка касается только этого занятия. Другие письма — подтверждения записи, квитанции об оплате — и другие занятия не затрагиваются.',
      stop: 'Отключить напоминания',
      start: 'Включить напоминания снова',
      stopped: 'Напоминания отключены.',
      started: 'Напоминания снова включены.',
      bad: 'Эта ссылка больше не действует. Изменить настройку можно также на странице вашей записи.',
      busy: 'Минуту…',
      err: 'Что-то пошло не так. Попробуйте ещё раз через минуту.'
    }
  };
  var LANGS = ['he', 'en', 'ru'];
  var DIR = { he: 'rtl', en: 'ltr', ru: 'ltr' };

  var qs = new URLSearchParams(location.search);
  var token = qs.get('t') || '';
  var lang = LANGS.indexOf(qs.get('l')) !== -1 ? qs.get('l') : 'he';
  var state = null;      // { title, off } once the server has answered
  var busy = false;
  var flash = '';

  var mount = document.getElementById('rem-mount');
  var langs = document.getElementById('rem-langs');
  var page = document.getElementById('page');

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function post(action, extra) {
    var body = { action: action, token: token };
    Object.keys(extra || {}).forEach(function (k) { body[k] = extra[k]; });
    return fetch('/api/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); });
  }

  function drawLangs() {
    langs.innerHTML = '';
    LANGS.forEach(function (l) {
      var b = el('button', {
        type: 'button', lang: l,
        class: 'rem-lang' + (l === lang ? ' is-on' : ''),
        text: T[l].lang
      });
      if (l === lang) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', function () {
        lang = l;
        // Re-render in place. The token is in location.search and navigating
        // away from it is how this link dies.
        draw();
      });
      langs.appendChild(b);
    });
  }

  function draw() {
    var t = T[lang];
    document.documentElement.lang = lang;
    page.setAttribute('dir', DIR[lang]);
    document.title = t.title + ' · Merkaz Ogen';
    drawLangs();
    mount.innerHTML = '';

    var card = el('div', { class: 'rem-card' });
    card.appendChild(el('h1', { class: 'rem-h', text: t.title }));

    if (!token || state === 'bad') {
      card.appendChild(el('p', { class: 'rem-err', text: t.bad }));
      mount.appendChild(card);
      return;
    }
    if (!state) {
      card.appendChild(el('p', { class: 'rem-note', text: t.busy }));
      mount.appendChild(card);
      return;
    }

    card.appendChild(el('p', { class: 'rem-note', text: state.off ? t.offNow : t.onNow }));
    card.appendChild(el('p', { class: 'rem-what', text: state.title || '' }));
    if (flash) card.appendChild(el('p', { class: 'rem-done', text: flash }));

    // ⚠ THE BUTTON SAYS WHICH OF THE TWO THINGS IT DOES, and it is the opposite
    // of the current state — so a family who pressed it by mistake, or whose
    // mail client followed the link, undoes it in one press from this same page.
    var act = el('button', {
      type: 'button',
      class: state.off ? 'btn-primary' : 'btn-secondary',
      text: busy ? t.busy : (state.off ? t.start : t.stop)
    });
    if (busy) act.setAttribute('disabled', 'disabled');
    act.addEventListener('click', function () {
      if (busy) return;
      busy = true; flash = ''; draw();
      post('set', { off: !state.off }).then(function (res) {
        busy = false;
        if (res && res.ok) {
          flash = res.off ? t.stopped : t.started;
          state = { title: res.title, off: res.off };
        } else {
          flash = t.err;
        }
        draw();
      }).catch(function () { busy = false; flash = t.err; draw(); });
    });
    card.appendChild(act);
    card.appendChild(el('p', { class: 'rem-note', text: t.only }));
    mount.appendChild(card);
  }

  draw();
  if (token) {
    post('status').then(function (res) {
      state = (res && res.ok) ? { title: res.title, off: res.off } : 'bad';
      // The email was written in a language; open in it unless the reader has
      // already chosen otherwise on this page.
      if (res && res.ok && res.lang && !qs.get('l') && LANGS.indexOf(res.lang) !== -1) lang = res.lang;
      draw();
    }).catch(function () { state = 'bad'; draw(); });
  }
})();
