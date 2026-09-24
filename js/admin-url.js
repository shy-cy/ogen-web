// The admin remembers what you were looking at, in the URL.
//
// Reported from QA: reload the Roster while you are on one activity and you are
// handed back the first one in the list; reload Activities and you are handed
// back an empty "new activity" form. Every other piece of state on those two
// screens is cheap to re-reach — a panel scrolls back, a filter is retyped —
// and this one is not, because it is the thing you were working on, and on the
// Roster it is the thing you had just got the right row of.
//
// The URL is the right place for it rather than localStorage: it is per TAB, so
// two activities can be open side by side, and it is a link, so an admin can
// send another admin the screen they are looking at rather than the name of it.
//
// ⚠ replaceState, NEVER pushState, and that is the rule this module exists to
// hold in one place. Pressing a row in the picker is not a navigation — it is
// the same screen showing a different record — and a history entry per press
// would put the browser's Back button in charge of swapping the record
// underneath an admin. Worse, it would do it WITHOUT the beforeunload guard the
// activities form relies on to protect unsaved edits: that fires on a real
// unload and never on a history move, so Back would silently discard whatever
// had been typed. So the URL tracks the selection and adds nothing to the
// history.
//
// It fails open in both directions. A browser with no history API, or a URL
// that will not parse, costs the memory and nothing else — the screen works
// exactly as it did before any of this existed.
(function () {
  'use strict';

  function here() {
    return new URL(window.location.href);
  }

  function read(key) {
    try {
      var v = here().searchParams.get(key);
      return v ? String(v) : null;
    } catch (e) {
      return null;
    }
  }

  // A null, empty or undefined value REMOVES the parameter rather than writing
  // an empty one. "No activity is open" is a real state — a blank new-activity
  // form is one — and `?activity=` reloading into it would be a URL that looks
  // like it names something.
  function remember(key, value) {
    try {
      if (!window.history || !window.history.replaceState) return;
      var url = here();
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
      window.history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch (e) {
      /* the screen works without it; it just forgets. */
    }
  }

  window.AdminUrl = { read: read, remember: remember };
})();
