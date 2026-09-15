// window.AdminSession — the client half of auth.
//
// THE TOKEN LIVES IN localStorage, AND IT USED TO LIVE IN sessionStorage.
//
// The old comment here said publish rights "should not outlive the tab", which
// sounded like a security decision and was not one. sessionStorage is scoped to
// a browsing context: it survives reloads and same-tab navigation, it is NOT
// affected by switching tabs, it dies when the tab closes, and — the part that
// actually bit — it is not shared BETWEEN tabs, so opening the admin in a second
// tab meant signing in again with an eight-hour session sitting live on the
// server. The rule being enforced was "how long is this tab open", which has
// nothing to do with how long a session should last: an admin who closed a tab
// was signed out, and an admin who left one open for a week was not.
//
// So the limit moved to where it can be enforced — the server, which now runs a
// 4-hour IDLE window with a 12-hour ABSOLUTE cap (see _session-store.js). The
// browser keeps the token across tabs and across closing them, and the session
// ends when the session ends.
//
// ⚠ ONE PROPERTY IS GENUINELY WEAKER and it is worth naming rather than
// glossing: on a shared machine the token now survives closing the browser.
// The idle window is the compensating control, and so is the cross-tab sign-out
// below — signing out anywhere clears it everywhere, immediately.
//
// The 4-hour window is deliberately NOT the guardian's 7 days. Different store,
// different key prefix, different lifetime; a test asserts the admin's is the
// shorter of the two so the two numbers cannot be quietly unified.
//
// auth() is merged into EVERY request body, because auth travels in the body
// rather than a header (every endpoint is a POST with an action).
//
// The permission helpers here mirror the server's. They are COSMETIC — they
// exist so the UI can grey things out. The server re-checks every one of them
// on every action and assumes this client is hostile.

(function (window) {
  var KEY = 'ogenAdminSession';
  // Its own key, on the same origin as the guardian's `ogenMemberSession`. They
  // cannot collide — and if one were pasted into the other it would still be
  // refused, because the two tokens live in different Blobs stores server-side
  // and neither authenticate() can find the other's. That arrangement is the
  // security boundary; client storage was never part of it, which is why moving
  // this one does not touch it.
  var IDLE_MS = 4 * 60 * 60 * 1000;

  function get() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || !s.token) return null;
      // A cheap pre-check so an obviously dead token does not cost a round trip.
      // The SERVER is the authority on both limits and this copy only mirrors
      // the idle one — see touch().
      if (s.expiresAt && s.expiresAt < Date.now()) { clear(); return null; }
      return s;
    } catch (err) { return null; }
  }

  function set(session) {
    try { window.localStorage.setItem(KEY, JSON.stringify(session)); } catch (err) {}
    return session;
  }

  function clear() {
    try { window.localStorage.removeItem(KEY); } catch (err) {}
  }

  // Mirror the server's idle slide locally after a successful call, so the UI
  // does not sign somebody out at a stale timestamp while the server is still
  // perfectly happy with the token.
  //
  // It cannot extend anything: the server enforces its own 12-hour cap and
  // answers 401 past it, and post() clears on a 401. This only stops the client
  // being WRONGLY pessimistic.
  function touch() {
    var s = get();
    if (!s) return;
    s.expiresAt = Date.now() + IDLE_MS;
    set(s);
  }

  function auth() {
    var s = get();
    return s ? { token: s.token } : {};
  }

  function perm(tool) {
    var s = get();
    return (s && s.permissions && s.permissions[tool]) || null;
  }

  function canAccess(tool) { var p = perm(tool); return !!(p && p.access); }
  function canPublish(tool) { var p = perm(tool); return !!(p && p.access && p.publish); }
  function editLangs(tool) { var p = perm(tool); return (p && p.edit) ? p.edit.slice() : []; }
  function canEditLang(tool, lang) { return editLangs(tool).indexOf(lang) !== -1; }

  // Every call goes through here so a 401 always lands the user back at login
  // instead of showing a half-broken screen.
  function post(endpoint, body) {
    var payload = {};
    var k;
    for (k in (body || {})) if (Object.prototype.hasOwnProperty.call(body, k)) payload[k] = body[k];
    var a = auth();
    for (k in a) payload[k] = a[k];

    return window.fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.ok) touch();
        if (res.status === 401) {
          clear();
          if (window.location.pathname.indexOf('/admin/index') === -1 &&
              window.location.pathname !== '/admin/' && window.location.pathname !== '/admin') {
            window.location.href = '/admin/';
          }
        }
        return { status: res.status, ok: res.ok, data: data };
      });
    });
  }

  function requireSession() {
    if (!get()) { window.location.href = '/admin/'; return false; }
    return true;
  }

  function logout() {
    var s = get();
    var done = function () { clear(); window.location.href = '/admin/'; };
    if (!s) return done();
    post('/api/admin-login', { action: 'logout', token: s.token }).then(done, done);
  }

  // CROSS-TAB SIGN-OUT. localStorage is shared between tabs, so signing out in
  // one now has to end the others — otherwise a second tab left open on a shared
  // machine keeps working against a token the person believes they revoked, and
  // "I signed out" would be false in a way nothing on screen showed. The storage
  // event fires in every OTHER tab on the origin, which is exactly the set that
  // needs telling.
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY || e.newValue) return;
    if (window.location.pathname.indexOf('/admin') !== 0) return;
    window.location.href = '/admin/';
  });

  window.AdminSession = {
    get: get, set: set, clear: clear, auth: auth, post: post, touch: touch,
    IDLE_MS: IDLE_MS,
    canAccess: canAccess, canPublish: canPublish,
    editLangs: editLangs, canEditLang: canEditLang,
    requireSession: requireSession, logout: logout
  };
})(window);
