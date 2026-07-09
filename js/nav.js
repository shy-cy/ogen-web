// Shared navigation for Ogen. Injects <nav> + mobile menu into every page.
// Language is detected from the URL: anything under /en or /en/* is the EN tree.
// The language toggle navigates to the twin URL (/about <-> /en/about, etc.).

(function() {
  const isEn = location.pathname === '/en' || location.pathname.startsWith('/en/');
  const prefix = isEn ? '/en' : '';
  const home = isEn ? '/en' : '/';
  const logo = isEn ? '/images/logo-en.svg' : '/images/logo-he.svg';

  const labels = isEn
    ? { about: 'About', offer: 'What We Offer', contact: 'Contact', menu: 'Menu', alt: 'Ogen' }
    : { about: 'אודות', offer: 'מה תמצאו בעוגן', contact: 'צור קשר', menu: 'תפריט', alt: 'עוגן' };

  const navHTML = `
<nav>
  <a class="logo-mark" href="${home}" aria-label="${labels.alt}">
    <img src="${logo}" alt="${labels.alt}">
  </a>
  <div class="nav-right">
    <div class="lang-toggle">
      <button class="${isEn ? '' : 'active'}" onclick="setLang('he')">עב</button>
      <button class="${isEn ? 'active' : ''}" onclick="setLang('en')">EN</button>
    </div>
    <button class="hamburger" id="hamburger" onclick="toggleMenu()" aria-label="${labels.menu}">
      <span></span><span></span><span></span>
    </button>
  </div>
</nav>
<div class="mobile-menu" id="mobile-menu">
  <a href="${home}#about" onclick="toggleMenu()">${labels.about}</a>
  <a href="${home}#offer" onclick="toggleMenu()">${labels.offer}</a>
  <a href="${home}#contact" onclick="toggleMenu()">${labels.contact}</a>
</div>`;

  document.body.insertAdjacentHTML('afterbegin', navHTML);

  // Navigate to the equivalent page in the other language tree.
  // / <-> /en, /confirmation <-> /en/confirmation, etc.
  window.setLang = function(targetLang) {
    const path = location.pathname;
    const currentlyEn = path === '/en' || path.startsWith('/en/');
    if (targetLang === 'en' && !currentlyEn) {
      location.href = (path === '/' ? '/en' : '/en' + path) + location.hash;
    } else if (targetLang === 'he' && currentlyEn) {
      const stripped = path === '/en' ? '/' : path.replace(/^\/en/, '');
      location.href = (stripped || '/') + location.hash;
    }
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
