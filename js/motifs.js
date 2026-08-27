// Decorative motif injector. Holds the ONE canonical copy of each motif's
// inline SVG; shapes/colours live in the MOTIFS block of shared.css.
//
// Two ways to place one:
//
//   1. <span class="motif offer-corner" data-motif="scatter" data-corner="tl"></span>
//      The element itself becomes the motif.
//   2. <div class="page-header" data-motif="leaf" data-corner="tl"> … </div>
//      A motif slot is created as the header's first child. This is the form
//      the page templates use, so a page only declares motif + corner once.
//
// data-corner is one of tl / tr / bl / br, meaning top|bottom + inline
// start|end — logical, so the corner mirrors between Hebrew and EN/RU.
// Motifs are purely decorative and therefore aria-hidden.

(function() {
  // ring and hatch are drawn in CSS alone and need no SVG.
  const SVG = {
    ring: '',
    hatch: '',
    scatter: `<svg viewBox="0 0 150 130" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
      <circle cx="12" cy="14" r="4"/><circle cx="34" cy="8" r="3"/><circle cx="52" cy="24" r="5"/>
      <circle cx="20" cy="40" r="3"/><circle cx="46" cy="48" r="4"/><circle cx="8" cy="62" r="3"/>
      <circle cx="60" cy="10" r="2.5"/><circle cx="30" cy="60" r="2.5"/><circle cx="66" cy="52" r="3"/>
      <circle cx="14" cy="90" r="3"/><circle cx="40" cy="86" r="4"/><circle cx="58" cy="78" r="2.5"/></svg>`,
    leaf: `<svg viewBox="0 0 90 150" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
      <path d="M45 10 L40 140"/>
      <path d="M40 30 Q25 20 15 28 Q25 38 40 40"/>
      <path d="M41 55 Q56 45 66 53 Q56 63 41 65"/>
      <path d="M39 80 Q24 70 14 78 Q24 88 39 90"/>
      <path d="M40 105 Q55 95 65 103 Q55 113 40 115"/></svg>`,
    wave: `<svg viewBox="0 0 340 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M0 14 Q28 2 56 14 T112 14 T168 14 T224 14 T280 14 T340 14"/></svg>`,
    book: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/></svg>`
  };

  function dress(el, name, corner) {
    el.classList.add('motif', 'motif-' + name);
    if (corner) el.classList.add('pos-' + corner);
    el.setAttribute('aria-hidden', 'true');
    if (SVG[name]) el.innerHTML = SVG[name];
  }

  window.renderMotifs = function(root) {
    (root || document).querySelectorAll('[data-motif]').forEach(function(el) {
      const name = el.dataset.motif;
      if (!name || name === 'none' || !(name in SVG)) return;
      if (el.dataset.motifDone) return;
      el.dataset.motifDone = '1';

      if (el.classList.contains('motif')) {
        dress(el, name, el.dataset.corner);       // form 1: element is the motif
      } else {
        const slot = document.createElement('span');
        dress(slot, name, el.dataset.corner);     // form 2: build a slot inside
        el.insertAdjacentElement('afterbegin', slot);
      }
    });
  };

  renderMotifs();
})();
