// The families screen — every account somebody has opened on the site.
//
// ⚠ IT DID NOT EXIST, AND THE REASON IT STAYED MISSING IS A WORD.
//
// The admin had `findAccount`, which answers "is there an account at this
// address" — useful when somebody has read you their address over the phone, and
// no use at all for "who has signed up". The page called `Accounts` was admin
// LOGINS, so the bar already appeared to have a screen for this and did not.
// Renaming it to `Admins` closed the ambiguity and left the gap behind it.
//
// SEE, mostly. The destructive things a family record supports — unlinking a
// guardian, deleting a participant — already live in the flows that own them,
// with their own refusals and their own debt questions, and a second door to
// them from a list would be a second place those refusals have to be remembered.
// What is here is the view nobody had: who exists, who they guard, what those
// people are registered to, and what the account is holding.
//
// Permission checks here are COSMETIC, as everywhere in this admin. The server
// re-checks the `family` tool on every action and assumes this client is
// hostile — and `family` is Super Admin only, because opening a family record
// means reading who somebody's children are.
(function () {
  var API = '/api/admin-family';
  var S = { accounts: [], accountId: null, filter: '' };

  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] === null || attrs[k] === undefined) return;
      if (k === 'text') n.textContent = attrs[k];
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function money(cents) { return cents == null ? '—' : '€' + (cents / 100).toFixed(2); }
  function day(iso) { return String(iso || '').slice(0, 10) || '—'; }

  function send(body) {
    return window.AdminSession.post(API, body).catch(function (err) {
      return { ok: false, data: { error: 'The request never came back (' + err.message + ').' } };
    });
  }

  function message(kind, text) {
    var box = $('messages');
    box.innerHTML = '';
    box.appendChild(el('div', { class: 'msg ' + kind, text: text }));
  }

  function titleOf(a) { return a.name || a.email; }

  function renderPicker() {
    var box = $('picker');
    box.innerHTML = '';
    var q = S.filter.trim().toLowerCase();
    var list = S.accounts.filter(function (a) {
      if (!q) return true;
      return (a.email || '').toLowerCase().indexOf(q) !== -1 ||
             (a.name || '').toLowerCase().indexOf(q) !== -1;
    });
    if (!list.length) {
      box.appendChild(el('p', { class: 'hint', text: S.accounts.length
        ? 'No account matches that.' : 'Nobody has opened an account yet.' }));
      return;
    }
    list.forEach(function (a) {
      var btn = el('button', {
        type: 'button',
        class: a.accountId === S.accountId ? 'active' : '',
        onclick: function () { load(a.accountId); }
      }, [
        el('b', { text: titleOf(a) }),
        el('span', { text: a.email }),
        // The count is the thing an admin scans this list for, and the verified
        // flag is the one fact about an account that changes what to do about it.
        el('span', { text: a.participantCount + (a.participantCount === 1 ? ' person' : ' people') +
                           (a.emailVerifiedAt ? '' : ' · unconfirmed address') })
      ]);
      box.appendChild(btn);
    });
  }

  function load(accountId) {
    S.accountId = accountId;
    renderPicker();
    $('empty-panel').hidden = true;
    send({ action: 'account', accountId: accountId }).then(function (res) {
      if (!res.ok) return message('err', (res.data && res.data.error) || 'That did not work');
      render(res.data);
    });
  }

  function render(d) {
    $('account-panel').hidden = false;
    $('account-title').textContent = titleOf(d.account);
    var body = $('account-body');
    body.innerHTML = '';

    body.appendChild(el('p', { class: 'hint', text:
      d.account.email + ' · opened ' + day(d.account.createdAt) +
      (d.account.emailVerifiedAt ? ' · address confirmed' : ' · address NOT confirmed') +
      (d.account.profile && d.account.profile.phone ? ' · ' + d.account.profile.phone : '') }));

    // The people. A NAME and a link, and no date of birth: an admin opening one
    // child's record is doing the job the age flag exists for, and a list of
    // everybody on the site is a different thing that does not need one.
    body.appendChild(el('h3', { text: 'People on this account' }));
    if (!d.participants.length) {
      body.appendChild(el('p', { class: 'hint', text: 'Nobody yet — the account exists and has added no one.' }));
    } else {
      var people = el('table', { class: 'bundle-dates' });
      d.participants.forEach(function (p) {
        people.appendChild(el('tr', {}, [
          el('td', { text: p.name }),
          el('td', { text: p.isPrimary ? 'primary guardian' : 'guardian' })
        ]));
      });
      body.appendChild(people);
    }

    body.appendChild(el('h3', { text: 'Registrations', style: 'margin-top:20px;' }));
    if (!d.registrations.length) {
      body.appendChild(el('p', { class: 'hint', text: 'None.' }));
    } else {
      var regs = el('table', { class: 'bundle-dates' });
      d.registrations.forEach(function (r) {
        var owing = (r.owedCents || 0) - (r.paidCents || 0);
        regs.appendChild(el('tr', {}, [
          el('td', { text: r.participantName }),
          el('td', { text: (r.title && (r.title.he || r.title.en || r.title.ru)) || r.slug }),
          el('td', { text: r.status }),
          // What is outstanding, which is the question this screen gets opened
          // with. Settled says so rather than showing a zero to be read twice.
          el('td', { text: owing > 0 ? money(owing) + ' outstanding' : 'settled' })
        ]));
      });
      body.appendChild(regs);
    }

    // The ledger, because "what am I owed" is the other question a family rings
    // about, and every line carries the basis it was written with.
    body.appendChild(el('h3', { text: 'Credit', style: 'margin-top:20px;' }));
    body.appendChild(el('p', { class: 'hint', text: 'Balance: ' + money(d.balanceCents) +
      '. Summed from the entries every time — there is no stored total to disagree with them.' }));
    if (d.entries.length) {
      var led = el('table', { class: 'bundle-dates' });
      d.entries.forEach(function (e) {
        led.appendChild(el('tr', {}, [
          el('td', { text: day(e.createdAt) }),
          el('td', { text: (e.type === 'debit' ? '−' : '+') + money(e.amountCents) }),
          el('td', { text: e.reason })
        ]));
      });
      body.appendChild(led);
    }

    body.appendChild(el('p', { class: 'hint', style: 'margin-top:20px;', text:
      'Changing a family record — linking or removing a guardian, deleting a ' +
      'participant — happens where the refusals live: a participant cannot be left ' +
      'with no guardian, and an unpaid registration has to be reassigned or ' +
      'written off before an unlink completes.' }));
  }

  // ---------- boot ----------
  if (!window.AdminSession.requireSession()) return;
  $('logout').addEventListener('click', function () { window.AdminSession.logout(); });
  $('q').addEventListener('input', function (e) {
    S.filter = e.target.value || '';
    renderPicker();
  });

  send({ action: 'accounts' }).then(function (res) {
    $('app').hidden = false;
    if (!res.ok) {
      $('tool').hidden = true;
      $('no-access').hidden = false;
      $('no-access').textContent = (res.data && res.data.error) ||
        'Your role does not have access to family records.';
      return;
    }
    S.accounts = res.data.accounts || [];
    var me = res.data.admin || {};
    $('who').textContent = me.name ? (me.name + ' · ' + (me.roleName || '')) : '';
    renderPicker();
  });
})();
