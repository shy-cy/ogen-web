// Shared navigation for Ogen. Injects <nav> + mobile menu into #page.
// Three language trees: HE at /, EN at /en/, RU at /ru/. The language toggle
// navigates to the twin URL, preserving the current page and scroll hash.
// The lang buttons + hamburger stay pinned to the physical right in every
// language, in a fixed [עב][EN][RU] order (nav-right forces direction:ltr).

(function() {
  function currentLang() {
    const p = location.pathname;
    if (p === '/en' || p.startsWith('/en/')) return 'en';
    if (p === '/ru' || p.startsWith('/ru/')) return 'ru';
    return 'he';
  }
  // Path with any language prefix stripped, i.e. the Hebrew-tree equivalent.
  function barePath() {
    const p = location.pathname;
    if (p === '/en' || p === '/ru') return '/';
    if (p.startsWith('/en/') || p.startsWith('/ru/')) return p.slice(3);
    return p;
  }

  const lang = currentLang();
  const home = lang === 'he' ? '/' : '/' + lang;
  // The tree prefix on its own. `home` is '/' in Hebrew, which is right for a
  // link to the homepage and wrong as a prefix — `${home}/account` would be
  // '//account', a protocol-relative URL pointing at a host called "account".
  const base = lang === 'he' ? '' : '/' + lang;
  const logo = `/images/logos/logo-${lang}.svg`;

  // ACTIVITIES REPLACED "What We Offer". The homepage's four themed cards and
  // the activities listing were two entries pointing at the same thing — one
  // the promise, one the actual list — and the promise is what the reader
  // already scrolled past. The #offer section is untouched and still on the
  // homepage; it simply no longer has a menu entry of its own.
  //
  // `running` and `archived` MUST match LABELS[lang].indexRunning and
  // .indexArchived in _activity-template.js: each is a menu entry and the
  // heading it jumps to, and a link whose words change on arrival reads as the
  // wrong link. A test asserts they agree, character for character.
  const L = {
    he: { about:'אודות', activities:'פעילויות', contact:'צור קשר', menu:'תפריט', alt:'עוגן',
          account:'אזור המשפחה', signIn:'כניסה', signOut:'יציאה',
          seeAll:'לכל הפעילויות', running:'פעיל', archived:'ארכיון',
          soon:'בקרוב', waitlist:'רשימת המתנה' },
    en: { about:'About', activities:'Activities', contact:'Contact', menu:'Menu', alt:'Ogen',
          account:'My family', signIn:'Sign in', signOut:'Sign out',
          seeAll:'See all activities', running:'Currently Running', archived:'Archived',
          soon:'Coming soon', waitlist:'Waiting list' },
    ru: { about:'О нас', activities:'Занятия', contact:'Контакты', menu:'Меню', alt:'Оген',
          account:'Моя семья', signIn:'Войти', signOut:'Выйти',
          seeAll:'Все занятия', running:'Активные', archived:'Архив',
          soon:'Скоро', waitlist:'Лист ожидания' }
  }[lang];

  const navHTML = `
<nav>
  <a class="logo-mark" href="${home}" aria-label="${L.alt}">
    <img src="${logo}" alt="${L.alt}">
  </a>
  <div class="nav-right">
    <div class="nav-account" id="nav-account"></div>
    <div class="lang-toggle">
      <button class="${lang === 'he' ? 'active' : ''}" onclick="setLang('he')">עב</button>
      <button class="${lang === 'en' ? 'active' : ''}" onclick="setLang('en')">EN</button>
      <button class="${lang === 'ru' ? 'active' : ''}" onclick="setLang('ru')">RU</button>
    </div>
    <button class="hamburger" id="hamburger" onclick="toggleMenu()" aria-label="${L.menu}">
      <span></span><span></span><span></span>
    </button>
  </div>
</nav>
<div class="mobile-menu" id="mobile-menu">
  <a href="${home}#about" onclick="toggleMenu()">${L.about}</a>
  <div id="activities-slot"><a href="${base}/activities" onclick="toggleMenu()">${L.activities}</a></div>
  <a href="${home}#contact" onclick="toggleMenu()">${L.contact}</a>
  <a href="${base}/account" onclick="toggleMenu()" class="menu-account">${L.account}</a>
</div>`;

  const page = document.getElementById('page') || document.body;
  page.insertAdjacentHTML('afterbegin', navHTML);

  // ---- the account chip ----------------------------------------------------
  //
  // Signed out: a person icon and the word. Signed in: the guardian's initial in
  // an olive circle, the words, and a quiet way out beside it. Ported from the
  // sister project's nav, with two deliberate differences noted below.
  //
  // ⚠ IT READS localStorage DIRECTLY rather than going through MemberSession,
  // and that is not laziness. This file loads on EVERY page on the site;
  // js/member-session.js loads only under /account. A chip that needed the member
  // scripts present would be a chip that throws on the homepage.
  //
  // ⚠ IT DOES NOT MIRROR ACROSS THE BAR, and that is correct here rather than a
  // shortcut. `.nav-right` is pinned to the physical right and forced
  // direction:ltr on purpose: the language toggle has to sit in the same place
  // and the same [עב][EN][RU] order in all three languages, because the person
  // most likely to need it is the one who cannot read the language currently on
  // screen. The chip joins that group and inherits the rule. Mirroring it alone
  // would throw it to the far side of the bar in Hebrew, away from the controls
  // it belongs with.
  //
  // What DOES mirror is the inside of the chip — see the stylesheet. The avatar
  // sits at the reading start, so a Hebrew reader meets it first, and the exit
  // arrow points the way the language reads.
  const accountSlot = document.getElementById('nav-account');
  if (accountSlot) {
    let signedIn = false, initial = '';
    try {
      const s = JSON.parse(localStorage.getItem('ogenMemberSession') || 'null');
      if (s && s.token && (!s.expiresAt || s.expiresAt > Date.now())) {
        signedIn = true;
        // The stored session carries only a token and an expiry, so the letter
        // comes from a name cached beside it when the account area last loaded.
        // Absent, a neutral mark rather than a guess — this is somebody's name.
        const n = (s.firstName || s.email || '').trim();
        initial = n ? n.charAt(0).toUpperCase() : '\u2022';
      }
    } catch (err) { /* corrupt or unavailable storage reads as signed out */ }

    // ⚠ IT GOES TO THE FAMILY AREA, AND NOWHERE ELSE.
    //
    // This carried `?next=<the page you were on>`, so signing in from the
    // homepage signed you in and put you back on the homepage. That was built
    // as a courtesy and is the wrong one: this chip is labelled MY FAMILY, and
    // pressing it is a request to go there — not a request to stay where you
    // are. Somebody who has just typed a password is looking for the thing they
    // pressed, and being returned to the page they left reads as a sign-in that
    // did not take.
    //
    // The one case "come back to where you were" genuinely serves — pressing
    // Register on an activity page — never used this: it goes to
    // /account/activity?register=<slug>, which is already the right page, and
    // signing in there simply draws it. So the parameter was solving a problem
    // that was solved better elsewhere, while being wrong for the only path
    // that used it.
    //
    // Removing it also removes an open redirect: `next` arrived in a URL anyone
    // could write and was followed immediately after a password was typed, so
    // it needed a guard. A parameter nobody sets and nobody reads needs none.
    const signInHref = base + '/account';

    const esc = (v) => String(v).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    accountSlot.innerHTML = signedIn
      ? `<a class="nav-account-chip" href="${base}/account" title="${esc(L.account)}">` +
          `<span class="nav-account-initial" aria-hidden="true">${esc(initial)}</span>` +
          `<span class="nav-account-label">${esc(L.account)}</span></a>` +
        `<button type="button" class="nav-signout" onclick="ogenSignOut()" ` +
          `title="${esc(L.signOut)}" aria-label="${esc(L.signOut)}">` +
          `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ` +
          `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
          `<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/>` +
          `<path d="M21 12H9"/></svg></button>`
      : `<a class="nav-account-chip" href="${esc(signInHref)}" title="${esc(L.signIn)}">` +
          `<svg class="nav-account-icon" viewBox="0 0 24 24" stroke-linecap="round" ` +
          `stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/>` +
          `<path d="M4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1"/></svg>` +
          `<span class="nav-account-label">${esc(L.signIn)}</span></a>`;

    // The hamburger entry stays, and follows the chip. It is the one a phone
    // reader reaches for, and it now says which state they are in rather than
    // always offering the same words.
    const menuEntry = document.querySelector('.mobile-menu .menu-account');
    if (menuEntry && !signedIn) menuEntry.textContent = L.signIn;
  }

  // Signing out has to be reachable from anywhere rather than from inside the
  // account area, because shared and family devices are normal here.
  //
  // THE TOKEN IS DROPPED LOCALLY FIRST and the server told afterwards. If the
  // network call fails the person standing at the screen is still signed out,
  // which is the half that matters to them — the server-side session expires on
  // its own either way.
  window.ogenSignOut = function() {
    let token = null;
    try {
      const s = JSON.parse(localStorage.getItem('ogenMemberSession') || 'null');
      token = s && s.token;
      localStorage.removeItem('ogenMemberSession');
    } catch (err) { /* nothing to drop */ }

    // Stay where you are and reload, so the page redraws as a signed-out visitor
    // sees it. The exception is a page that needs a session to exist at all:
    // reloading one of those only asks you to sign back in, which is the
    // opposite of signing out.
    const done = () => {
      if (/^(?:\/(?:en|ru))?\/account/.test(location.pathname)) location.href = home;
      else location.reload();
    };
    if (!token) return done();
    try {
      fetch('/api/account-auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'signout', token: token })
      }).then(done, done);
    } catch (err) { done(); }
  };

  // Navigate to the equivalent page in the target language tree.
  window.setLang = function(target) {
    if (target === lang) return;
    const base = target === 'he' ? '' : '/' + target;
    const bp = barePath();
    const dest = bp === '/' ? (base || '/') : base + bp;
    // THE QUERY STRING TRAVELS TOO, and on three pages it is the entire point:
    // /account/verify, /account/reset and /account/guardian-invite carry their
    // token there. Dropping it meant that switching language on any of those —
    // which is exactly what a Russian-speaking parent does when a link opens in
    // Hebrew — silently turned a valid link into a dead one, and the page could
    // only say "that link has expired or has already been used".
    location.href = dest + location.search + location.hash;
  };

  window.toggleMenu = function() {
    document.getElementById('mobile-menu').classList.toggle('open');
    document.getElementById('hamburger').classList.toggle('open');
    loadActivities();
  };

  // ---- the Activities group ------------------------------------------------
  //
  // The menu ships with a plain link to /activities, and this REPLACES it with
  // an accordion naming what is on offer. Everything about it is decided at
  // runtime from the generated index, so publishing an activity puts it in the
  // menu of every page on the site with nobody editing this file.
  //
  // IT FAILS OPEN. If the fetch fails, the index is unreadable, or nothing is
  // live, the plain link is simply left alone — and the worst outcome is the
  // menu Ogen would have had anyway. There is no state in which this removes a
  // way to reach the activities.
  //
  // ⚠ FETCHED ON FIRST OPEN OF THE MENU, NOT ON LOAD. This script runs on every
  // page on the site and most visits never open the hamburger, so fetching at
  // load buys a request on every page view for a panel almost nobody sees. The
  // sister project pays exactly that; one flag avoids it.
  //
  // The three status lists are the SAME SPLIT the listing page groups by, and
  // OPEN is written in the order the menu lists them: what is open before what
  // is only announced before a waitlist. _activity-template.js owns the
  // canonical copy and a test asserts all three agree with it.
  //
  // `closed` is RUNNING and not ARCHIVED — it means registration is shut and the
  // activity is underway. Nothing here asks a clock about that; the nightly
  // sweep flips a finished activity to `completed` instead, so the status this
  // reads is kept true rather than second-guessed. See _activity-autocomplete.js.
  var OPEN = ['open', 'announcement', 'waitlist'];
  var RUNNING = ['closed'];
  var ARCHIVED = ['completed', 'cancelled'];
  var MAX_ROWS = 6;
  var FALLBACK = { he: ['he'], en: ['en', 'he'], ru: ['ru', 'en', 'he'] };
  var loaded = false;

  function pickLang(bag) {
    if (!bag) return '';
    var chain = FALLBACK[lang];
    for (var i = 0; i < chain.length; i++) if (bag[chain[i]]) return bag[chain[i]];
    return '';
  }

  function loadActivities() {
    if (loaded || !window.fetch) return;
    loaded = true;
    var slot = document.getElementById('activities-slot');
    if (!slot) return;
    // no-cache, so an activity published a minute ago is in the menu now. The
    // file is small and this is one request per visit at most.
    fetch('/activities/activities-index.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (list) {
        if (!Array.isArray(list)) return;
        // AN ACTIVITY IS ONLY LINKED IN A LANGUAGE IT HAS A PAGE IN. `langs` is
        // what the listing page filters on too; without it the Russian menu
        // would link to a Russian page that was never generated.
        var mine = list.filter(function (a) {
          return a && a.langs && a.langs.indexOf(lang) !== -1;
        });
        var open = mine.filter(function (a) { return OPEN.indexOf(a.status) !== -1; });
        if (!open.length) return;              // nothing to open an accordion onto
        open.sort(function (a, b) {
          var d = OPEN.indexOf(a.status) - OPEN.indexOf(b.status);
          return d || pickLang(a.title).localeCompare(pickLang(b.title), lang);
        });
        var has = function (list) {
          return mine.some(function (a) { return list.indexOf(a.status) !== -1; });
        };
        build(slot, open, { running: has(RUNNING), archived: has(ARCHIVED) });
      })
      .catch(function () { /* the plain link is already there */ });
  }

  function build(slot, open, sections) {
    var group = document.createElement('div');
    group.className = 'menu-group';

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'menu-group-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'activities-sub');
    toggle.appendChild(document.createTextNode(L.activities));
    var chev = document.createElement('span');
    chev.className = 'menu-chev';
    toggle.appendChild(chev);

    var sub = document.createElement('div');
    sub.className = 'menu-sub';
    sub.id = 'activities-sub';

    // CAPPED, AND THE CAP IS HONEST. The sister project lists every event and
    // bounds the panel with max-height + overflow:hidden, so past about eight
    // rows the rest are invisible while still being in the DOM — focusable by
    // keyboard, read by a screen reader, shown to nobody, with nothing saying
    // the list was cut. "See all activities" is always there, so stopping at six
    // costs a reader one tap and never hides a row it claims to be showing.
    open.slice(0, MAX_ROWS).forEach(function (a) {
      var link = document.createElement('a');
      link.href = base + '/activities/' + a.slug;
      link.setAttribute('onclick', 'toggleMenu()');
      link.appendChild(document.createTextNode(pickLang(a.title)));
      // A second line only when the status is NOT open, because open is what a
      // reader already assumes of something in this list. The summary is too
      // long for a menu row and is on the card they are one tap from.
      var note = a.status === 'announcement' ? L.soon : a.status === 'waitlist' ? L.waitlist : null;
      if (note) {
        var small = document.createElement('span');
        small.className = 'menu-note';
        small.textContent = note;
        link.appendChild(small);
      }
      sub.appendChild(link);
    });

    // The way through to the whole page, always, followed by a jump to each
    // section that EXISTS. The listing page renders no heading for an empty
    // group, so an unconditional link would jump to an anchor that is not there
    // — which does nothing at all and reads as a broken menu.
    var tail = function (label, hash) {
      var link = document.createElement('a');
      link.className = 'menu-sub-all';
      link.href = base + '/activities' + (hash || '');
      link.setAttribute('onclick', 'toggleMenu()');
      link.textContent = label;
      sub.appendChild(link);
    };
    tail(L.seeAll, '');
    if (sections.running) tail(L.running, '#running');
    if (sections.archived) tail(L.archived, '#archived');

    toggle.addEventListener('click', function (e) {
      // Stop the document click handler from reading this as a click outside
      // and closing the whole menu underneath the person opening a group.
      e.preventDefault();
      e.stopPropagation();
      var open = group.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    group.appendChild(toggle);
    group.appendChild(sub);
    slot.replaceChild(group, slot.firstChild);
  }

  document.addEventListener('click', function(e) {
    const menu = document.getElementById('mobile-menu');
    const btn = document.getElementById('hamburger');
    if (menu && !menu.contains(e.target) && !btn.contains(e.target)) {
      menu.classList.remove('open');
      btn.classList.remove('open');
    }
  });
})();
