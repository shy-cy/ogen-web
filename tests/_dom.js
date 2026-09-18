// A DOM small enough to run js/member-account.js in, and no smaller.
//
// The family area is over a thousand lines of client code and nothing has ever
// EXECUTED it — the suites read it as text. Text-reading catches a renamed
// string key; it does not catch `p.querySelector` on a node type that has none,
// an `undefined` two levels into a response, or a render path that throws on the
// third branch nobody clicks.
//
// There is no jsdom here on purpose: "no framework, nothing to install — a test
// that needs installing is a test that stops being run" is the rule this whole
// directory is built on, and the same rule that put fake Blobs and fake GitHub
// in _helpers.js rather than a container. This is the same trade. It implements
// what this one script actually uses and throws on anything else, so it cannot
// quietly diverge into a bad imitation of a browser: the day the script needs
// something new, this file says so rather than returning undefined.

function makeDom(opts) {
  opts = opts || {};
  const listeners = [];

  function node(tag) {
    const n = {
      tagName: String(tag).toUpperCase(),
      attributes: {}, childNodes: [], parentNode: null,
      _text: '', _handlers: {},
      get children() { return n.childNodes.filter((c) => c.tagName); },
      get firstChild() { return n.childNodes[0] || null; },
      get nextSibling() {
        if (!n.parentNode) return null;
        const i = n.parentNode.childNodes.indexOf(n);
        return n.parentNode.childNodes[i + 1] || null;
      },
      get className() { return n.attributes['class'] || ''; },
      set className(v) { n.attributes['class'] = v; },
      // Real code uses this — js/nav.js toggles the menu and the accordion with
      // it — so it is the genuine article rather than a stub that always
      // reports true.
      classList: {
        _set() { return (n.attributes['class'] || '').split(/\s+/).filter(Boolean); },
        _save(list) { n.attributes['class'] = list.join(' '); },
        contains(c) { return this._set().indexOf(c) !== -1; },
        add(c) { const l = this._set(); if (l.indexOf(c) === -1) l.push(c); this._save(l); },
        remove(c) { this._save(this._set().filter((x) => x !== c)); },
        toggle(c) {
          if (this.contains(c)) { this.remove(c); return false; }
          this.add(c); return true;
        }
      },
      // A SELECT'S VALUE IS ITS SELECTED OPTION, and with nothing selected that
      // is the first one — which is what a browser does and what every form
      // here relies on, since none of them touch `selected`. Returning '' for a
      // select nobody had clicked meant a test could submit a form and never
      // find out which person it named.
      get value() {
        if ('value' in n.attributes) return n.attributes.value;
        if (n.tagName === 'SELECT') {
          const opt = n.childNodes.filter((c) =>
            c.tagName === 'OPTION' && c.attributes.disabled == null)[0];
          return opt ? (opt.attributes.value || '') : '';
        }
        return '';
      },
      set value(v) { n.attributes.value = v; },
      // REFLECTED PROPERTIES. The real DOM mirrors these between the property
      // and the attribute, and real code uses whichever is shorter — js/nav.js
      // writes `link.href = …` and this shim used to file that as a plain JS
      // property, so getAttribute('href') came back null and a test asserting
      // where a link points passed against a link pointing nowhere.
      get href() { return n.attributes.href || ''; },
      set href(v) { n.attributes.href = String(v); },
      get id() { return n.attributes.id || ''; },
      set id(v) { n.attributes.id = String(v); },
      get type() { return n.attributes.type || ''; },
      set type(v) { n.attributes.type = String(v); },
      // A checkbox's state is a PROPERTY in the real DOM, not an attribute —
      // `box.checked = true` does not write `checked="true"` — so it is one
      // here too, or a test could read back its own setup and learn nothing.
      get checked() { return !!n._checked; },
      set checked(v) { n._checked = !!v; },
      // `disabled` IS reflected, and that difference is not pedantry: real code
      // writes `button.disabled = false` to bring a control back, and a shim
      // that filed it as a plain property left the attribute sitting there — so
      // a test asking whether a button is pressable would read `disabled` on a
      // button a browser shows as live.
      get disabled() { return n.attributes.disabled != null; },
      set disabled(v) {
        if (v) n.attributes.disabled = 'true';
        else delete n.attributes.disabled;
      },
      get textContent() {
        return n._text + n.childNodes.map((c) => c.textContent).join('');
      },
      set textContent(v) { n.childNodes.length = 0; n._text = String(v); },
      setAttribute(k, v) { n.attributes[k] = String(v); },
      getAttribute(k) { return k in n.attributes ? n.attributes[k] : null; },
      removeAttribute(k) { delete n.attributes[k]; },
      addEventListener(ev, fn) { (n._handlers[ev] = n._handlers[ev] || []).push(fn); },
      appendChild(c) {
        if (!c) throw new Error('appendChild(null) — el() is meant to filter those');
        if (c.parentNode) c.parentNode.removeChild(c);
        c.parentNode = n; n.childNodes.push(c); return c;
      },
      removeChild(c) {
        const i = n.childNodes.indexOf(c);
        if (i === -1) throw new Error('removeChild: not a child of this node');
        n.childNodes.splice(i, 1); c.parentNode = null; return c;
      },
      replaceChild(fresh, old) {
        const i = n.childNodes.indexOf(old);
        if (i === -1) throw new Error('replaceChild: the old node is not a child');
        n.childNodes[i] = fresh; fresh.parentNode = n; old.parentNode = null; return old;
      },
      // Class selectors only, which is all this script uses. Anything else
      // throws rather than returning null — a selector that silently matches
      // nothing is how a test passes against a screen that renders nothing.
      querySelector(sel) {
        if (sel.charAt(0) !== '.') throw new Error('this DOM does class selectors only: ' + sel);
        const want = sel.slice(1);
        let found = null;
        (function walk(x) {
          if (found) return;
          x.childNodes.forEach((c) => {
            if (found) return;
            if ((c.className || '').split(/\s+/).indexOf(want) !== -1) { found = c; return; }
            walk(c);
          });
        })(n);
        return found;
      },
      // What a test clicks. Missing handler is an error, not a no-op: a button
      // nothing is listening to looks identical to a working one on screen.
      click() {
        // A CHECKBOX IS NOT A BUTTON. Clicking one toggles it and fires
        // `change`, which is what the date picker listens for — so without this
        // a test could only assign `.checked` and would never run the handler
        // that reads it, which is the half that computes the total.
        if (n.tagName === 'INPUT' && n.attributes.type === 'checkbox') {
          if (n.attributes.disabled != null) return;
          n._checked = !n._checked;
          (n._handlers.change || []).forEach((f) => f({ target: n, currentTarget: n }));
          return;
        }
        const fns = n._handlers.click || [];
        if (!fns.length) throw new Error('clicked a ' + n.tagName + ' with no click handler');
        fns.forEach((f) => f({ preventDefault() {}, stopPropagation() {}, currentTarget: n, target: n }));
      },
      submit() {
        const fns = n._handlers.submit || [];
        if (!fns.length) throw new Error('submitted a form with no submit handler');
        fns.forEach((f) => f({ preventDefault() {}, stopPropagation() {}, currentTarget: n, target: n }));
      }
    };
    return n;
  }

  const root = node('div');
  root.setAttribute('id', 'account-mount');
  root.setAttribute('data-view', opts.view || 'account');

  const store = {};
  const window = {
    location: { search: opts.search || '', href: opts.href || '/', hash: '' },
    history: { replaceState(a, b, u) { window.location.href = u; } },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    },
    setTimeout: (fn, ms) => { listeners.push(fn); return 0; },
    confirm: () => true,
    fetch: opts.fetch,
    document: null
  };
  // A text node: no tagName, so `children` filters it out and `textContent`
  // concatenates it like the real thing. js/nav.js builds labels this way.
  function text(value) {
    const t = {
      tagName: null, childNodes: [], parentNode: null, attributes: {},
      get textContent() { return t._text; },
      set textContent(v) { t._text = String(v); },
      _text: String(value)
    };
    return t;
  }

  const document = {
    documentElement: { lang: opts.lang || 'he' },
    createElement: node,
    createTextNode: text,
    getElementById: (id) => (id === 'account-mount' ? root : null)
  };
  window.document = document;
  return { window: window, document: document, mount: root, node: node, _store: store };
}

// Every node in a subtree, so an assertion can ask what the screen says without
// caring how it is nested.
function textOf(n) { return n.textContent; }
function all(n, pred) {
  const out = [];
  (function walk(x) {
    (x.childNodes || []).forEach((c) => { if (pred(c)) out.push(c); walk(c); });
  })(n);
  return out;
}
const byClass = (n, cls) => all(n, (c) => (c.className || '').split(/\s+/).indexOf(cls) !== -1);
const byTag = (n, tag) => all(n, (c) => c.tagName === tag.toUpperCase());

module.exports = { makeDom, textOf, all, byClass, byTag };
