// Shared footer for Ogen. Injects <footer> with the tagline logo, partner
// logos, and copyright into #page. Language is detected from the URL tree.

(function() {
  function currentLang() {
    const p = location.pathname;
    if (p === '/en' || p.startsWith('/en/')) return 'en';
    if (p === '/ru' || p.startsWith('/ru/')) return 'ru';
    return 'he';
  }

  const lang = currentLang();
  const home = lang === 'he' ? '/' : '/' + lang;
  const logo = `/images/logos/logo-${lang}.svg`;

  const L = {
    he: { alt:'עוגן - חינוך, תרבות וקהילה', partners:'תודה לשותפינו', copy:'© 2026 עוגן · חינוך · תרבות · קהילה' },
    en: { alt:'Ogen - Education, Culture and Community', partners:'Thanks to our partners', copy:'© 2026 Ogen · Education · Culture · Community' },
    ru: { alt:'Оген - Образование, Культура и Община', partners:'Благодарим наших партнёров', copy:'© 2026 Оген · Образование · Культура · Община' }
  }[lang];

  const footerHTML = `
<footer>
  <svg class="accent-wave" viewBox="0 0 340 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <path d="M0 14 Q28 2 56 14 T112 14 T168 14 T224 14 T280 14 T340 14"/>
  </svg>
  <svg class="accent-book" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>
  </svg>
  <a class="foot-logo" href="${home}" aria-label="${L.alt}">
    <img src="${logo}" alt="${L.alt}">
  </a>
  <div class="foot-divider"></div>
  <div class="partners">
    <div class="partners-label">${L.partners}</div>
    <div class="partners-row">
      <div class="partner-slot"><img src="/images/partners/kkl.png" alt="KKL-JNF"></div>
      <div class="partner-slot"><img src="/images/partners/ministry.png" alt="Ministry of Diaspora Affairs"></div>
      <div class="partner-slot"><img src="/images/partners/wzo.png" alt="World Zionist Organization"></div>
      <div class="partner-slot"><img src="/images/partners/kehilot.png" alt="Kehilot Institute"></div>
    </div>
  </div>
  <div class="foot-line">${L.copy}</div>
</footer>`;

  const page = document.getElementById('page') || document.body;
  page.insertAdjacentHTML('beforeend', footerHTML);
})();
