// Shared footer for Ogen. Injects <footer> with the tagline logo, partner
// logos, the legal links and copyright into #page. Language is detected from
// the URL tree.
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

  // The legal links were held back while /privacy and /terms were placeholders —
  // a footer link to a page reading "[content needed]" is worse than no link.
  // They carry real reviewed text now, so the links go in: a policy nobody can
  // reach from the site is not published in any sense that matters, and
  // registration is about to ask people to agree to them.
  //
  // Paths are per-language, built from the same tree the rest of this file uses,
  // so a Hebrew reader lands on the Hebrew policy rather than on a language
  // switch.
  const L = {
    he: { alt:'עוגן - חינוך, תרבות וקהילה', partners:'תודה לשותפינו',
          privacy:'מדיניות פרטיות', terms:'תנאי שימוש',
          copy:'© 2026 עוגן · חינוך · תרבות · קהילה' },
    en: { alt:'Ogen - Education, Culture and Community', partners:'Thanks to our partners',
          privacy:'Privacy Policy', terms:'Terms of Use',
          copy:'© 2026 Ogen · Education · Culture · Community' },
    ru: { alt:'Оген - Образование, Культура и Община', partners:'Благодарим наших партнёров',
          privacy:'Политика конфиденциальности', terms:'Условия использования',
          copy:'© 2026 Оген · Образование · Культура · Община' }
  }[lang];

  const base = lang === 'he' ? '' : '/' + lang;

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
  <nav class="foot-legal" aria-label="${L.privacy} / ${L.terms}">
    <a href="${base}/privacy">${L.privacy}</a>
    <span class="sep" aria-hidden="true">·</span>
    <a href="${base}/terms">${L.terms}</a>
  </nav>
  <div class="foot-line">${L.copy}</div>
</footer>`;

  const page = document.getElementById('page') || document.body;
  page.insertAdjacentHTML('beforeend', footerHTML);
})();
