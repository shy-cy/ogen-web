// window.AdminSession — the client half of auth.
//
// The token lives in sessionStorage, not localStorage: these sessions carry
// publish rights, so they should not outlive the tab.
//
// auth() is merged into EVERY request body, because auth travels in the body
// rather than a header (every endpoint is a POST with an action).
//
// The permission helpers here mirror the server's. They are COSMETIC — they
// exist so the UI can grey things out. The server re-checks every one of them
// on every action and assumes this client is hostile.

(function (window) {
  var KEY = 'ogenAdminSession';

  function get() {
    try {
      var raw = window.sessionStorage.getItem(KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || !s.token) return null;
      if (s.expiresAt && s.expiresAt < Date.now()) { clear(); return null; }
      return s;
    } catch (err) { return null; }
  }

  function set(session) {
    try { window.sessionStorage.setItem(KEY, JSON.stringify(session)); } catch (err) {}
    return session;
  }

  function clear() {
    try { window.sessionStorage.removeItem(KEY); } catch (err) {}
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

  window.AdminSession = {
    get: get, set: set, clear: clear, auth: auth, post: post,
    canAccess: canAccess, canPublish: canPublish,
    editLangs: editLangs, canEditLang: canEditLang,
    requireSession: requireSession, logout: logout
  };
})(window);
