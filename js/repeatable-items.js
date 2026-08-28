// Add / remove / reorder for the repeatable lists in the Activities admin —
// what's included, FAQ pairs, teachers, sponsors.
//
// The two rules below were bugs before they were rules, on the project this
// pattern comes from. Both are enforced here rather than left to each caller,
// which is the whole reason this is a module and not four copies of a loop.
//
//   RULE 1  Read the form into the model before EVERY redraw.
//           Reordering re-renders the list, which destroys the inputs. Anything
//           not captured first is text the admin watches disappear as they
//           click the up arrow. Every mutator here calls host.readInto() first.
//
//   RULE 2  Mint item ids from the clock, never from list position.
//           Per-item state (an in-flight photo upload, translation status) is
//           keyed by id. A positional id like item-3 gets reissued after a
//           removal and silently merges two items' state — and it looks like it
//           worked right up until it matters.
//
// The host is a bag of callbacks rather than a closure over one editor's
// internals, so the same implementation serves every list.
//
//   host.readInto(items)  copy what the inputs currently hold into the model
//   host.render(items)    rebuild the DOM from the model
//   host.blank()          a new empty item (optional)
//
// Loaded in the browser as window.RepeatableList; also require()-able so the
// test suites can drive it without a DOM.

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.RepeatableList = api;
})(typeof window !== 'undefined' ? window : null, function () {
  let counter = 0;

  // Clock-based, with a counter so two mints in the same millisecond differ.
  function mintId(prefix) {
    counter += 1;
    return (prefix || 'item') + '-' + Date.now().toString(36) + '-' + counter.toString(36);
  }

  function RepeatableList(options) {
    const opts = options || {};
    const host = opts.host || {};
    const prefix = opts.prefix || 'item';
    let items = Array.isArray(opts.items) ? opts.items.slice() : [];

    // RULE 1 lives here, in one place, so no caller can forget it.
    function capture() {
      if (typeof host.readInto === 'function') host.readInto(items);
    }
    function redraw() {
      if (typeof host.render === 'function') host.render(items);
    }

    return {
      all: () => items,
      size: () => items.length,
      indexOf: (id) => items.findIndex((it) => it && it.id === id),

      set(next) {
        items = Array.isArray(next) ? next.slice() : [];
        redraw();
        return items;
      },

      add(seed) {
        capture();
        const blank = typeof host.blank === 'function' ? host.blank() : {};
        // RULE 2: never derived from items.length.
        const item = Object.assign({}, blank, seed || {});
        if (!item.id) item.id = mintId(prefix);
        items.push(item);
        redraw();
        return item;
      },

      remove(id) {
        capture();
        const i = items.findIndex((it) => it && it.id === id);
        if (i === -1) return null;
        const [gone] = items.splice(i, 1);
        // RULE 2 corollary: surviving items keep the ids they already had.
        // Renumbering here would throw away per-item state and look like it worked.
        redraw();
        return gone;
      },

      move(id, delta) {
        capture();
        const i = items.findIndex((it) => it && it.id === id);
        if (i === -1) return false;
        const j = i + delta;
        if (j < 0 || j >= items.length) return false;
        const [moved] = items.splice(i, 1);
        items.splice(j, 0, moved);
        redraw();
        return true;
      },

      up: function (id) { return this.move(id, -1); },
      down: function (id) { return this.move(id, 1); },

      // For the save path: capture pending input without redrawing.
      sync() { capture(); return items; }
    };
  }

  RepeatableList.mintId = mintId;
  return RepeatableList;
});
