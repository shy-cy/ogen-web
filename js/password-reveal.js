// Show/hide toggle for password fields.
//
// window.PasswordReveal.attach(input) wraps the field and drops a Lucide
// eye / eye-off button inside its trailing edge. Built once and shared,
// because the sign-in form and the account form both need it and two copies
// of a toggle that flips input.type would drift.
//
// Positioned with inset-inline-end rather than right, matching the rest of
// the codebase, so it stays correct if an RTL admin screen ever appears.

(function (window) {
  var EYE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/>' +
    '<circle cx="12" cy="12" r="3"/></svg>';

  var EYE_OFF =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/>' +
    '<path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/>' +
    '<path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/>' +
    '<path d="m2 2 20 20"/></svg>';

  function attach(input) {
    if (!input || input.dataset.revealReady) return null;
    input.dataset.revealReady = '1';

    var wrap = document.createElement('div');
    wrap.className = 'pw-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    var btn = document.createElement('button');
    btn.type = 'button';              // never submits the form it sits in
    btn.className = 'pw-toggle';
    btn.innerHTML = EYE;
    btn.setAttribute('aria-label', 'Show password');
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('tabindex', '-1');   // keep it out of the tab path to submit
    wrap.appendChild(btn);

    btn.addEventListener('click', function () {
      var showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      btn.innerHTML = showing ? EYE : EYE_OFF;
      btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
      btn.setAttribute('aria-pressed', showing ? 'false' : 'true');
      input.focus();
    });

    // Never leave a password on screen after the field is done with.
    input.addEventListener('blur', function () {
      if (input.type !== 'text') return;
      input.type = 'password';
      btn.innerHTML = EYE;
      btn.setAttribute('aria-label', 'Show password');
      btn.setAttribute('aria-pressed', 'false');
    });

    return btn;
  }

  // Convenience: wire every password field on the page.
  function attachAll(root) {
    var inputs = (root || document).querySelectorAll('input[type="password"]');
    Array.prototype.forEach.call(inputs, attach);
  }

  window.PasswordReveal = { attach: attach, attachAll: attachAll };
})(window);
