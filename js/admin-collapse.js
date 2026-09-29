// js/admin-collapse.js — a panel opens and closes, and closing hides nothing the
// save reads.
//
// Reported from the screen it is about: "the whole activity area is becoming
// very long — I think it would be good if we have +/- to open/close sections, so
// areas we completed or don't need, we can hide them." Eleven panels on the
// activities form, most of them written once and left alone, and the one being
// worked on several screens below the fold.
//
// ⚠ IT HIDES WITH A CLASS AND NOTHING ELSE, WHICH IS THE WHOLE SAFETY ARGUMENT.
// A closed panel's fields are still in the document — still built, still holding
// the ids readForm() walks on save. Collapsing by emptying a container, or by
// detaching one, is the undrawn-field trap this project keeps meeting, and here
// it would mean closing a section and then publishing it away. The group
// sub-page settled the same question for the same reason ("hidden rather than
// detached, because every editor on them holds live nodes and ids that the
// read-back walks on save"); this does not even hide, it paints.
//
// ⚠ THE HEADING NEVER CLOSES WITH THE PANEL. That is what makes a closed form
// readable rather than merely shorter: eleven titles in a column is a table of
// contents, and a publish refused for something in a panel that is shut is still
// one click from it. Nothing here expands anything on its own — a control that
// undoes what somebody just did is worse than a scroll.
//
// ⚠ AND THE (i) IS A SIBLING OF THE TOGGLE, NEVER INSIDE IT. A button inside a
// button is not markup a browser keeps, and asking what a panel means must not
// close the panel — the same pairing js/admin-help.js already preventDefaults
// beside a checkbox's own label, answered here structurally instead.
//
// A browser cannot `require`, so this is a script the admin loads, exactly as
// js/admin-help.js, js/admin-url.js and js/admin-icons.js are.
(function () {
  'use strict';

  // One flat map, keyed by page and panel: which sections THIS person has shut.
  // It is a view preference rather than a piece of work, so it lives in
  // localStorage rather than in the URL — the URL on these screens carries the
  // activity you are editing, which is a thing to send somebody, and nobody
  // wants to be sent somebody else's folded-up form.
  var KEY = 'ogen-admin-collapsed';
  var mem = null;

  function load() {
    if (mem) return mem;
    mem = {};
    try {
      var raw = window.localStorage.getItem(KEY);
      var got = raw ? JSON.parse(raw) : null;
      if (got && typeof got === 'object') mem = got;
    } catch (e) { /* fails open: this session only, and every panel is open */ }
    return mem;
  }

  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(mem || {})); }
    catch (e) { /* the panel still closes; it just will not still be closed tomorrow */ }
  }

  // The id when a panel has one, and the words otherwise. A reworded heading
  // forgets that panel's state, which fails the right way: it opens.
  function keyFor(panel, words) {
    var path = (window.location && window.location.pathname) || '';
    var id = panel.getAttribute('id');
    return path + '|' + (id || String(words).toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  }

  function hasClass(n, c) {
    return (' ' + (n.className || '') + ' ').indexOf(' ' + c + ' ') !== -1;
  }

  function paint(panel, btn, closed) {
    if (closed) panel.classList.add('is-collapsed');
    else panel.classList.remove('is-collapsed');
    btn.setAttribute('aria-expanded', closed ? 'false' : 'true');
  }

  function toggle(panel, btn, key) {
    var closed = !panel.classList.contains('is-collapsed');
    paint(panel, btn, closed);
    var s = load();
    if (closed) s[key] = true; else delete s[key];
    save();
  }

  function wire(root) {
    var scope = root || (typeof document !== 'undefined' ? document : null);
    var main = scope && scope.querySelector ? scope.querySelector('.main') : null;
    if (!main) return;
    Array.prototype.slice.call(main.children).forEach(function (panel) {
      if (!hasClass(panel, 'panel')) return;
      // The one opt-out, and it is on the preview: that panel is shown by its own
      // button, and a preview that opened folded would read as a preview that
      // failed.
      if (panel.getAttribute('data-no-collapse') != null) return;
      if (panel.getAttribute('data-collapse-wired')) return;
      var h2 = panel.children[0];
      if (!h2 || h2.tagName !== 'H2') return;
      panel.setAttribute('data-collapse-wired', '1');

      var badge = h2.querySelector('.help');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'panel-toggle';
      var words = document.createElement('span');
      words.className = 'panel-toggle-text';
      Array.prototype.slice.call(h2.childNodes).forEach(function (n) {
        words.appendChild(n);
      });
      btn.appendChild(words);
      h2.appendChild(btn);
      // ⚠ THE ONE LINE THAT PUTS THE (i) BACK OUTSIDE. appendChild MOVES a node
      // it already holds, so this both lifts the badge out of the toggle and
      // lands it after it — whichever of the two scripts wired first, and
      // without a second rule in the loop above that would have to agree with
      // this one.
      if (badge) h2.appendChild(badge);

      var key = keyFor(panel, words.textContent || '');
      paint(panel, btn, !!load()[key]);
      btn.addEventListener('click', function () { toggle(panel, btn, key); });
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { wire(document); });
    } else {
      wire(document);
    }
  }

  window.AdminCollapse = { wire: wire };
})();
