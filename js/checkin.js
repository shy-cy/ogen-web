// The check-in screen: scan a code, find your name, tap it.
//
// Opened in a doorway, on a phone, by somebody who did not plan to use a
// website. Everything below follows from that: no sign-in, no nav, no fields to
// fill in, one tap, and a confirmation big enough to read without stopping.
//
// ⚠ ONE PAGE, THREE LANGUAGES, SWITCHED IN PLACE. Every other trilingual screen
// here has a file per language because the reader arrives from a link that knows
// which one they read. Nobody arrives here from a link — they arrive from a code
// on a wall, and one poster cannot be three posters. So the toggle re-renders
// rather than navigating, which also means it cannot drop the token out of the
// query string: that exact bug shipped once on the account pages, where
// switching language turned a valid invitation into a dead one.
//
// The strings live in one {he, en, ru} table, the same discipline the nav, the
// footer, the contact form and the family area each follow.
(function () {
  var API = '/api/checkin';
  var LANGS = ['he', 'en', 'ru'];

  var T = {
    he: {
      dir: 'rtl', label: 'עב', font: 'he',
      title: 'רישום נוכחות',
      who: 'מי הגיע/ה? בחרו את השם שלכם.',
      here: 'נרשמת/ה. נתראה בפנים!',
      alreadyHere: 'כבר נרשמת. הכול בסדר.',
      present: 'נוכח/ת',
      tooEarly: 'הקוד הזה מיועד למפגש בתאריך',
      comeBack: 'אפשר לסרוק אותו שוב ביום המפגש.',
      expired: 'הקוד הזה כבר לא בתוקף.',
      expiredMore: 'כל קוד תקף ליום המפגש שלו בלבד. פנו לצוות.',
      nobody: 'אף אחד לא רשום למפגש הזה עדיין.',
      notListed: 'לא מופיעים ברשימה? פנו לאחד המורים.',
      problem: 'משהו השתבש. נסו שוב.',
      offline: 'אין חיבור. נסו שוב בעוד רגע.',
      loading: 'טוען…'
    },
    en: {
      dir: 'ltr', label: 'EN', font: 'latin',
      title: 'Check in',
      who: 'Who has arrived? Tap your name.',
      here: 'You are checked in. See you inside!',
      alreadyHere: 'You were already checked in. All good.',
      present: 'Here',
      tooEarly: 'This code is for the session on',
      comeBack: 'Scan it again on the day.',
      expired: 'This code is no longer valid.',
      expiredMore: 'Each code works only on the day of its own session. Please ask a member of staff.',
      nobody: 'Nobody is booked for this session yet.',
      notListed: 'Not on the list? Please speak to a teacher.',
      problem: 'Something went wrong. Please try again.',
      offline: 'No connection. Please try again in a moment.',
      loading: 'Loading…'
    },
    ru: {
      dir: 'ltr', label: 'RU', font: 'latin',
      title: 'Отметка о приходе',
      who: 'Кто пришёл? Нажмите на своё имя.',
      here: 'Вы отмечены. До встречи внутри!',
      alreadyHere: 'Вы уже отмечены. Всё в порядке.',
      present: 'На месте',
      tooEarly: 'Этот код — для занятия',
      comeBack: 'Отсканируйте его в день занятия.',
      expired: 'Этот код больше не действует.',
      expiredMore: 'Каждый код действует только в день своего занятия. Обратитесь к сотруднику.',
      nobody: 'На это занятие пока никто не записан.',
      notListed: 'Вас нет в списке? Обратитесь к преподавателю.',
      problem: 'Что-то пошло не так. Попробуйте ещё раз.',
      offline: 'Нет связи. Попробуйте через минуту.',
      loading: 'Загрузка…'
    }
  };

  var mount = document.getElementById('checkin-mount');
  var langBox = document.getElementById('checkin-langs');
  var page = document.getElementById('page');
  var token = (/[?&]t=([^&#]*)/.exec(window.location.search) || [])[1] || '';
  var data = null;
  // The browser's own language if it is one we speak, Hebrew otherwise — which
  // is the site's default and the language most of the families here read.
  var lang = pickLang();

  function pickLang() {
    var want = String(window.navigator.language || '').slice(0, 2).toLowerCase();
    return LANGS.indexOf(want) !== -1 ? want : 'he';
  }

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
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  // The same fallback chain the rest of the site uses, so an activity with no
  // Russian title shows its English rather than an empty heading.
  function pick(bag) {
    if (!bag) return '';
    if (typeof bag === 'string') return bag;
    var chain = { he: ['he'], en: ['en', 'he'], ru: ['ru', 'en', 'he'] }[lang];
    for (var i = 0; i < chain.length; i++) if (bag[chain[i]]) return bag[chain[i]];
    return '';
  }

  function longDate(iso) {
    var parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!parts) return iso || '';
    var d = new Date(Date.UTC(+parts[1], +parts[2] - 1, +parts[3]));
    try {
      return d.toLocaleDateString(lang === 'he' ? 'he-IL' : lang === 'ru' ? 'ru-RU' : 'en-GB',
        { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    } catch (e) { return iso; }
  }

  function post(payload) {
    return fetch(API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ token: token }, payload))
    }).then(function (res) {
      return res.json().catch(function () { return {}; })
        .then(function (d) { return { ok: res.ok && d.ok !== false, status: res.status, data: d }; });
    }).catch(function () { return { ok: false, status: 0, data: {} }; });
  }

  function failure(res) {
    if (res.status === 0) return T[lang].offline;
    return (res.data && res.data.error) || T[lang].problem;
  }

  // Direction and typeface follow the chosen language, on #page and never on
  // <html> or <body> — the rule the whole site is held to.
  function applyLang() {
    document.documentElement.setAttribute('lang', lang);
    page.setAttribute('dir', T[lang].dir);
    document.title = T[lang].title + ' · Ogen';
    clear(langBox);
    LANGS.forEach(function (l) {
      langBox.appendChild(el('button', {
        type: 'button', class: 'checkin-lang' + (l === lang ? ' is-on' : ''),
        text: T[l].label,
        onclick: function () { lang = l; applyLang(); render(); }
      }));
    });
  }

  function render() {
    var t = T[lang];
    clear(mount);
    if (!data) return mount.appendChild(el('p', { class: 'checkin-note', text: t.loading }));

    if (data.state === 'expired') {
      return mount.appendChild(el('div', { class: 'checkin-card' }, [
        el('h1', { class: 'checkin-h', text: t.expired }),
        el('p', { class: 'checkin-note', text: t.expiredMore })
      ]));
    }
    if (data.state === 'too-early') {
      return mount.appendChild(el('div', { class: 'checkin-card' }, [
        el('h1', { class: 'checkin-h', text: pick(data.activity && data.activity.title) }),
        el('p', { class: 'checkin-note', text: t.tooEarly + ' ' + longDate(data.sessionDate) }),
        el('p', { class: 'checkin-note', text: t.comeBack })
      ]));
    }

    // Done: the whole screen is the confirmation. A person in a doorway should
    // not have to find a line of text among a list they no longer need.
    if (data.state === 'done') {
      return mount.appendChild(el('div', { class: 'checkin-card is-done' }, [
        el('div', { class: 'checkin-tick', 'aria-hidden': 'true', text: '✓' }),
        el('h1', { class: 'checkin-h', text: data.already ? t.alreadyHere : t.here }),
        el('p', { class: 'checkin-note', text: data.name })
      ]));
    }

    var head = el('div', { class: 'checkin-card' }, [
      el('h1', { class: 'checkin-h', text: pick(data.activity && data.activity.title) }),
      el('p', { class: 'checkin-note', text: longDate(data.sessionDate) })
    ]);
    mount.appendChild(head);

    if (!data.people.length) {
      mount.appendChild(el('p', { class: 'checkin-note', text: t.nobody }));
    } else {
      mount.appendChild(el('p', { class: 'checkin-who', text: t.who }));
      var list = el('div', { class: 'checkin-list' });
      data.people.forEach(function (p) {
        // Somebody already marked present is shown as done rather than hidden:
        // a name that vanishes after a tap looks like the tap went wrong, and
        // the person standing there needs to see that it did not.
        var done = p.status === 'attended';
        list.appendChild(el('button', {
          type: 'button', class: 'checkin-person' + (done ? ' is-done' : ''),
          onclick: done ? null : function () { tap(p); }
        }, [
          el('span', { class: 'checkin-name', text: p.name }),
          done ? el('span', { class: 'checkin-badge', text: t.present }) : null
        ]));
      });
      mount.appendChild(list);
    }

    // The walk-in answer, and it is a person rather than a form. Creating a
    // participant here would mean an unauthenticated stranger writing a child's
    // record, which is the one thing this project is most careful about.
    mount.appendChild(el('p', { class: 'checkin-note checkin-foot', text: t.notListed }));
  }

  function tap(person) {
    post({ action: 'checkIn', participantId: person.participantId }).then(function (res) {
      if (!res.ok) {
        var note = el('p', { class: 'checkin-err', text: failure(res) });
        return mount.appendChild(note);
      }
      data = { state: 'done', already: !!res.data.already, name: person.name };
      render();
    });
  }

  function load() {
    post({ action: 'session' }).then(function (res) {
      if (!res.ok) { data = { state: 'expired' }; return render(); }
      var d = res.data;
      data = d.open === false
        ? { state: 'too-early', sessionDate: d.sessionDate, activity: d.activity }
        : { state: 'list', sessionDate: d.sessionDate, activity: d.activity, people: d.people || [] };
      render();
    });
  }

  applyLang();
  render();
  if (!token) { data = { state: 'expired' }; render(); } else { load(); }
})();
