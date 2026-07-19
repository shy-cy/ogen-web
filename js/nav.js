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
  const logo = `/images/logos/logo-${lang}.svg`;

  const L = {
    he: { about:'אודות', offer:'מה תמצאו בעוגן', contact:'צור קשר', menu:'תפריט', alt:'עוגן' },
    en: { about:'About', offer:'What We Offer', contact:'Contact', menu:'Menu', alt:'Ogen' },
    ru: { about:'О нас', offer:'Что мы предлагаем', contact:'Контакты', menu:'Меню', alt:'Оген' }
  }[lang];

  const navHTML = `
<nav>
  <a class="logo-mark" href="${home}" aria-label="${L.alt}">
    <img src="${logo}" alt="${L.alt}">
  </a>
  <div class="nav-right">
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
</div>`;

  const page = document.getElementById('page') || document.body;
  page.insertAdjacentHTML('afterbegin', navHTML);

  // Navigate to the equivalent page in the target language tree.
  window.setLang = function(target) {
    if (target === lang) return;
    const base = target === 'he' ? '' : '/' + target;
    const bp = barePath();
    const dest = bp === '/' ? (base || '/') : base + bp;
    location.href = dest + location.hash;
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
