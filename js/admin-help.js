// The (i) beside a label, and the one sentence behind it.
//
// ⚠ EVERY EXPLANATION IN THE ADMIN GOES THROUGH HERE. Reported as clutter, and
// it was: the Settings panel put a four-line paragraph under a checkbox and
// another under a select, so a screen an admin opens to change one thing was
// mostly prose about things they were not changing. The words are worth keeping
// — most of them exist because somebody got something wrong once — but a
// sentence that is always on screen is a sentence nobody reads twice and
// everybody scrolls past.
//
// So a hint becomes a CONTROL: a small (i) beside the thing it is about, and
// the text on demand. One builder, in one file, loaded by every admin page,
// because the alternative is each screen growing its own tooltip and the third
// one behaving differently from the first two — which is how this codebase came
// to have a checkbox meaning opposite things in two editors a release apart.
//
// ⚠ AND NOT EVERY `.hint` IS AN EXPLANATION, WHICH IS THE RULE THAT KEEPS THIS
// HONEST. "Nobody has registered for this activity yet", "3 of 11 dates are
// going ahead", a bundle's computed total, "the code drawer did not load" — that
// is the screen telling you what is TRUE RIGHT NOW, and hiding it behind a
// click would be hiding the answer rather than the manual. Those stay visible.
// What moves behind an (i) is the part that would read the same on an empty
// activity as on a full one.
(function () {
  'use strict';

  var open = null;   // { btn, pop }
  var seq = 0;

  // Positioned against the viewport rather than inside the label, because the
  // panels scroll and several of them clip their overflow — a popover in the
  // flow gets cut off by whichever card it happens to be in.
  function place(btn, pop) {
    var r = btn.getBoundingClientRect();
    pop.style.left = '0px';
    pop.style.top = '0px';
    var w = pop.offsetWidth || 300;
    var h = pop.offsetHeight || 80;
    var left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    var top = r.bottom + 8;
    // Flip above when there is no room below and there is room above.
    if (top + h > window.innerHeight - 8 && r.top - h - 8 > 8) top = r.top - h - 8;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function close() {
    if (!open) return;
    open.btn.setAttribute('aria-expanded', 'false');
    if (open.pop.parentNode) open.pop.parentNode.removeChild(open.pop);
    open = null;
  }

  // ONE AT A TIME. Two open popovers on one screen is two answers to the
  // question "what is this", and the second one is about something else.
  function show(btn) {
    var again = open && open.btn === btn;
    close();
    if (again) return;
    var pop = document.createElement('div');
    pop.className = 'help-pop';
    pop.id = btn.getAttribute('aria-controls');
    pop.setAttribute('role', 'note');
    pop.textContent = btn._helpText || '';
    document.body.appendChild(pop);
    btn.setAttribute('aria-expanded', 'true');
    open = { btn: btn, pop: pop };
    place(btn, pop);
  }

  // The one builder. Returns a real <button>, not a span with a click handler:
  // it is reachable by keyboard, it says whether it is open, and a screen reader
  // is told there is something to press.
  function badge(text, label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'help';
    b.setAttribute('aria-expanded', 'false');
    b.setAttribute('aria-controls', 'help-pop-' + (++seq));
    b.setAttribute('aria-label', label || 'What this means');
    b.title = label || 'What this means';
    b.textContent = 'i';
    b._helpText = String(text == null ? '' : text);
    b.addEventListener('click', function (e) {
      // ⚠ preventDefault BECAUSE A BADGE CAN SIT BESIDE A CHECKBOX'S OWN LABEL.
      // Without it, asking what a setting means would change the setting.
      if (e && e.preventDefault) e.preventDefault();
      if (e && e.stopPropagation) e.stopPropagation();
      show(b);
    });
    return b;
  }

  // For a hint whose words change with the screen — the Role select's
  // description is the one that does. Updating the open popover too, or the
  // sentence on screen goes on describing the previous choice.
  function setText(b, text) {
    if (!b) return;
    b._helpText = String(text == null ? '' : text);
    if (open && open.btn === b) open.pop.textContent = b._helpText;
  }

  // The authored-markup half: `<h2 data-hint="…">Registration</h2>` gets its
  // badge here rather than in five copies of the same line. Same builder, so a
  // hint written in HTML and one built in JS cannot behave differently.
  function wire(root) {
    var nodes = (root || document).querySelectorAll('[data-hint]');
    Array.prototype.forEach.call(nodes, function (node) {
      if (node.getAttribute('data-hint-wired')) return;
      node.setAttribute('data-hint-wired', '1');
      node.appendChild(badge(node.getAttribute('data-hint')));
    });
  }

  document.addEventListener('click', function (e) {
    if (!open) return;
    if (e.target === open.pop || (open.pop.contains && open.pop.contains(e.target))) return;
    close();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' || e.keyCode === 27) close();
  });
  window.addEventListener('resize', function () { if (open) place(open.btn, open.pop); });
  // Capture, so it also follows a scrolling panel rather than only the window.
  window.addEventListener('scroll', function () { if (open) place(open.btn, open.pop); }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { wire(document); });
  } else {
    wire(document);
  }

  window.AdminHelp = { badge: badge, wire: wire, close: close, setText: setText };
})();
