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
      get value() { return n.attributes.value || ''; },
      set value(v) { n.attributes.value = v; },
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
        const fns = n._handlers.click || [];
        if (!fns.length) throw new Error('clicked a ' + n.tagName + ' with no click handler');
        fns.forEach((f) => f({ preventDefault() {} }));
      },
      submit() {
        const fns = n._handlers.submit || [];
        if (!fns.length) throw new Error('submitted a form with no submit handler');
        fns.forEach((f) => f({ preventDefault() {} }));
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
  const document = {
    documentElement: { lang: opts.lang || 'he' },
    createElement: node,
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
    x.childNodes.forEach((c) => { if (pred(c)) out.push(c); walk(c); });
  })(n);
  return out;
}
const byClass = (n, cls) => all(n, (c) => (c.className || '').split(/\s+/).indexOf(cls) !== -1);
const byTag = (n, tag) => all(n, (c) => c.tagName === tag.toUpperCase());

module.exports = { makeDom, textOf, all, byClass, byTag };
