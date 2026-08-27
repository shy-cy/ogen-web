// Shared footer for Ogen. Injects <footer> with the tagline logo, partner
// logos, and copyright into #page. Language is detected from the URL tree.
//
// The wave and book accents are declared with data-motif and drawn by
// js/motifs.js, which pages load after this script.

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
  <span class="motif foot-wave" data-motif="wave"></span>
  <span class="motif foot-book" data-motif="book" data-corner="br"></span>
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
