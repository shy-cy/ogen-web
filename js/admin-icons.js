// js/admin-icons.js — one glyph control for the whole admin.
//
// ⚠ WHY THIS IS A SHARED MODULE AND NOT A HELPER IN EACH SCREEN.
//
// The queue's row controls became glyphs first, with the whole argument written
// down beside them: four labelled buttons wrapped to two lines on every row, so
// a table opened to SCAN for the rows that need something doing was half as tall
// again as it had to be. The group list on the activities form arrived at the
// same place from the other side — "I would avoid buttons with long text, so
// here would change it to icons" — and copying forty lines across would have
// been two glyph builders, two tooltip contracts, and two places the rule below
// can quietly stop being true on one screen.
//
// A browser cannot `require`, so this is a script both admin pages load, exactly
// as js/admin-help.js and js/admin-url.js are.
//
// ⚠ THE WORD IS NOT GONE, ONLY OFF SCREEN. This admin has paid three times for a
// control nobody could read — the invite button labelled with a description, the
// (i) rule that exists because a hint nobody can reach is a hint nobody has, and
// a Remove control on a sub-page under a blank label. An icon with no word
// anywhere is that mistake in its purest form. So every button carries the word
// in three places, each covering a reader the others miss:
//
//   · `aria-label`, so a screen reader announces the action and not "button";
//   · `data-tip`, a styled tooltip on hover AND on keyboard focus — focus rather
//     than hover alone, because a control only a mouse can explain is unreadable
//     to somebody tabbing through it;
//   · `title`, which is what a touch device with neither falls back to.
//
// ⚠ AND THE GLYPHS ARE DRAWN, NEVER TYPED. Lucide paths, like every other icon
// on this site, built with createElementNS — an <svg> made with createElement is
// an HTMLUnknownElement and draws nothing at all.
(function () {
  var NS = 'http://www.w3.org/2000/svg';

  // `circle` rather than a name check inside the builder: a glyph that needs a
  // ring says so here, where the path does, instead of in a list somewhere else
  // that a seventh icon would have to be added to.
  var GLYPH = {
    // check
    approve: { d: 'M20 6 9 17l-5-5' },
    // x
    reject: { d: 'M18 6 6 18M6 6l12 12' },
    // ban — a slashed circle, not a second cross: rejecting and cancelling are
    // different acts and two crosses would say they are the same one.
    cancel: { d: 'M4.9 4.9l14.2 14.2', circle: 9 },
    // circle-dollar
    money: { d: 'M12 6v12M15 9.5a2.5 2.5 0 0 0-2.5-2h-1a2 2 0 1 0 0 4h1a2 2 0 1 1 0 4h-1A2.5 2.5 0 0 1 9 14.5',
             circle: 9.5 },
    // mail — an envelope, the rectangle plus its flap in one path, so it needs no
    // second element the way the two circled glyphs do.
    mail: { d: 'M3 6h18v12H3zM3 7l9 6 9-6' },
    // copy — two sheets, the front one overlapping the back.
    copy: { d: 'M9 9h10v10H9zM15 5H5v10' },
    // trash-2
    remove: { d: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6' },
    // arrow-right — the way in, and it is PHYSICAL on purpose: the admin is
    // English-only and ltr, and this arrow means "through to the next screen"
    // rather than "forwards in the reading direction".
    open: { d: 'M5 12h14M13 6l6 6-6 6' }
  };

  function glyph(name) {
    var spec = GLYPH[name];
    if (!spec) throw new Error('AdminIcons: no glyph called "' + name + '"');
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    if (spec.circle) {
      var c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', '12'); c.setAttribute('cy', '12');
      c.setAttribute('r', String(spec.circle));
      svg.appendChild(c);
    }
    var path = document.createElementNS(NS, 'path');
    path.setAttribute('d', spec.d);
    svg.appendChild(path);
    return svg;
  }

  // ⚠ THE TOOLTIP NAMES THE ACTION AND THEN SAYS WHAT SEPARATES IT.
  //
  // Asked plainly on the queue — "what is the difference between cancel and
  // reject?" — by the person who commissioned that screen. If they cannot tell,
  // an admin working it at eight in the morning cannot either, and one of the two
  // writes an irreversible line in a ledger. The same question is live on the
  // group list, where Duplicate mints a fresh id and Remove is refused while
  // anybody is registered.
  //
  // It lives on the control rather than behind an (i) because there is no (i) on
  // a row, and because it is exactly what would read the same on an empty
  // activity as on a full one — which is this admin's own rule for what a tooltip
  // is FOR. `aria-label` stays the bare verb: a screen reader announces what a
  // control DOES, and the sentence after it is an explanation rather than a name.
  function button(name, label, why, tone, off, onclick) {
    var tip = why ? label + ' · ' + why : label;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon' + (tone ? ' ' + tone : '');
    b.setAttribute('aria-label', label);
    b.setAttribute('data-tip', tip);
    b.setAttribute('title', tip);
    if (off) b.disabled = true;
    if (onclick) b.addEventListener('click', onclick);
    b.appendChild(glyph(name));
    return b;
  }

  window.AdminIcons = { glyph: glyph, button: button, GLYPH: GLYPH };
})();
