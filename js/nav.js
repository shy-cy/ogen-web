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

  const L = {
    he: { about:'אודות', offer:'מה תמצאו בעוגן', contact:'צור קשר', menu:'תפריט', alt:'עוגן',
          account:'אזור המשפחה', signIn:'כניסה', signOut:'יציאה' },
    en: { about:'About', offer:'What We Offer', contact:'Contact', menu:'Menu', alt:'Ogen',
          account:'My family', signIn:'Sign in', signOut:'Sign out' },
    ru: { about:'О нас', offer:'Что мы предлагаем', contact:'Контакты', menu:'Меню', alt:'Оген',
          account:'Моя семья', signIn:'Войти', signOut:'Выйти' }
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
  <a href="${home}#offer" onclick="toggleMenu()">${L.offer}</a>
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

    // Where to come back to. An account page is excluded, or signing in would
    // send you back to the sign-in form you just used.
    const onAccount = /^(?:\/(?:en|ru))?\/account(?:\/|$|\.html)/.test(location.pathname);
    const here = location.pathname + location.search + location.hash;
    const signInHref = base + '/account' +
      (onAccount ? '' : '?next=' + encodeURIComponent(here));

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
  };

  document.addEventListener('click', function(e) {
    const menu = document.getElementById('mobile-menu');
    const btn = document.getElementById('hamburger');
    if (menu && !menu.contains(e.target) && !btn.contains(e.target)) {
      menu.classList.remove('open');
      btn.classList.remove('open');
    }
  });
})();
