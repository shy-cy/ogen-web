// window.MemberSession — the client half of a guardian's session.
//
// ⚠ THE STORAGE IS localStorage, UNDER A DIFFERENT KEY FROM THE ADMIN'S. Both
// clients use localStorage now — the admin's used to use sessionStorage under a
// comment calling it a security property, which it was not: sessionStorage is
// scoped to a browsing context, so the rule it enforced was "how long is this
// tab open", and that is unrelated to how long a session should last. The real
// limits are server-side and differ on purpose: a guardian gets seven days on a
// sliding window, sized for a parent who visits once a month; an admin gets four
// hours idle with a twelve-hour cap, because publish rights must not be
// indefinite.
//
// It is also a completely separate key from the admin's, against a completely
// separate store server-side: ogen-member-sessions keyed `msess-`, against
// ogen-admin-sessions keyed `sess-`. A guardian token handed to an admin
// function is not found, because it is not there. That arrangement IS the
// security boundary — a role check can be forgotten at one call site out of
// thirty, and the one that forgets would be an approval endpoint authenticated
// by a parent's cookie.
(function (window) {
  var KEY = 'ogenMemberSession';

  function get() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || !s.token) return null;
      // The server slides this forward on each validated read; the copy here is
      // only so an obviously dead token does not cost a round trip.
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

  function token() {
    var s = get();
    return s ? s.token : null;
  }

  // Auth travels in the BODY, because every endpoint here is a POST with an
  // action — the same shape the admin uses, for the same reason.
  //
  // `token` is the session and nothing else is ever called that. An invitation
  // is `inviteToken`: an invite action reading body.token would hand the session
  // token to acceptInvite(), which then reports a perfectly valid link as
  // invalid. One name, one meaning.
  function post(endpoint, body) {
    var payload = {};
    for (var k in (body || {})) {
      if (Object.prototype.hasOwnProperty.call(body, k)) payload[k] = body[k];
    }
    var t = token();
    if (t && payload.token === undefined) payload.token = t;
    // ⚠ WHICH LANGUAGE THE READER IS READING IN, on every request.
    //
    // The server used to render every display string — group names, the facts
    // card, the price rows, the session table — in the language stored on the
    // ACCOUNT. That is the right language for an email, which arrives later and
    // out of context, and the wrong one for a screen: a family on the Hebrew
    // page was being handed English group names to choose between, because
    // somebody had once picked English as their preference.
    //
    // The page knows, so the page says. Sent from every call rather than added
    // per action, because the next action added would forget.
    if (payload.lang === undefined) {
      payload.lang = (window.document.documentElement.lang || 'he');
    }

    return window.fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        // A dead session is cleared here rather than at thirty call sites. The
        // caller is told and decides what to show — this never navigates on its
        // own, because a family halfway through a form should not lose it to a
        // redirect they did not ask for.
        if (res.status === 401 && t) clear();
        return { status: res.status, ok: res.ok, data: data };
      });
    }, function (err) {
      return { status: 0, ok: false, data: { error: 'network:' + err.message } };
    });
  }

  window.MemberSession = { get: get, set: set, clear: clear, token: token, post: post };
})(window);
