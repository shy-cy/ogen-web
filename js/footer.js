// Shared footer for Ogen. Injects <footer> with partner logos into every page.
// Bilingual strings use .he-only / .en-only spans; CSS on <html lang> picks.

(function() {
  const isEn = location.pathname === '/en' || location.pathname.startsWith('/en/');
  const home = isEn ? '/en' : '/';
  const logo = isEn ? '/images/logo-en.svg' : '/images/logo-he.svg';
  const alt = isEn ? 'Ogen' : 'עוגן';

  const footerHTML = `
<footer>
  <svg class="accent-wave" viewBox="0 0 340 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <path d="M0 14 Q28 2 56 14 T112 14 T168 14 T224 14 T280 14 T340 14"/>
  </svg>
  <svg class="accent-book" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>
  </svg>
  <a class="foot-logo" href="${home}" aria-label="${alt}">
    <img src="${logo}" alt="${alt}">
  </a>
  <div class="foot-divider"></div>
  <div class="partners">
    <div class="partners-label">
      <span class="he-only">תודה לשותפינו</span><span class="en-only">Thanks to our partners</span>
    </div>
    <div class="partners-row">
      <div class="partner-slot"><img src="/images/partners/kkl.png" alt="KKL-JNF"></div>
      <div class="partner-slot"><img src="/images/partners/ministry.png" alt="Ministry of Diaspora Affairs"></div>
      <div class="partner-slot"><img src="/images/partners/wzo.png" alt="World Zionist Organization"></div>
      <div class="partner-slot"><img src="/images/partners/kehilot.png" alt="Kehilot Institute"></div>
    </div>
  </div>
  <div class="foot-line">
    <span class="he-only">© 2026 עוגן · חינוך · תרבות · קהילה</span>
    <span class="en-only">© 2026 Ogen · Education · Culture · Community</span>
  </div>
</footer>`;

  document.body.insertAdjacentHTML('beforeend', footerHTML);
})();
