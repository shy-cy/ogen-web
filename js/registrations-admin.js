// The approval queue — the admin half of registration, and the screen that makes
// "an admin can run a term" true rather than true in principle.
//
// THIS IS THE ADMIN, NOT THE FAMILY AREA. The family-facing area is Phase 6 and
// is held behind ogen-legal-review until the Russian legal text has been read by
// a native speaker. This screen is deliberately outside that gate, in the gate's
// own words: it is staff-only, noindex, and building the admin side of
// registration is exactly what the gate is meant to allow.
//
// It is a TABLE, where the rest of the admin is cards. The difference is the
// job: every other screen is opened to edit one thing, and this one is opened to
// find the rows that need something doing. Columns line up so the eye runs down
// them.
//
// Permission checks here are COSMETIC, like everywhere else in this admin. They
// grey a button out; the server re-checks canAccess / canApprove / canCancel on
// every action and assumes this client is hostile.
(function () {
  var API = '/api/admin-registrations';
  var S = { activities: [], slug: null, queue: null, canApprove: false, canCancel: false };

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

  // Integer cents in, euros out. The arithmetic never leaves cents — this is the
  // only place a figure becomes a string, which is the whole reason the stores
  // hold cents in the first place.
  function money(cents) {
    if (cents == null) return '—';
    return '€' + (cents / 100).toFixed(2);
  }

  function titleOf(t, slug) {
    return (t && (t.he || t.en || t.ru)) || slug || '';
  }

  function message(kind, text) {
    $('messages').innerHTML = '';
    $('messages').appendChild(el('div', { class: 'msg ' + kind, text: text }));
    if (kind === 'ok') window.setTimeout(function () { $('messages').innerHTML = ''; }, 4000);
  }

  function send(body) {
    return window.AdminSession.post(API, body).catch(function (err) {
      return { ok: false, data: { error: 'The request never came back (' + err.message + ').' } };
    });
  }

  // ---------- the capacity line ----------
  //
  // It says "23 / 20 — over capacity" plainly rather than pretending that cannot
  // happen. Two submissions arriving together both read "one place left" and
  // both write; there is no atomic increment to close that window, and an extra
  // visible record an admin can reject is a smaller problem than a counter that
  // silently lost an update.
  function renderCapacity(cap) {
    var box = $('capacity');
    box.innerHTML = '';
    var taken = el('span', {}, [
      el('b', { class: cap.over ? 'over' : '', text: String(cap.taken) }),
      el('span', { text: cap.capacity == null ? ' registered · no limit set'
                                              : ' of ' + cap.capacity + ' places' })
    ]);
    box.appendChild(taken);
    if (cap.over) box.appendChild(el('span', { class: 'over', text: 'Over capacity' }));
    // Uncapped is not a warning. A missing group size means nobody finished
    // filling the activity in, and reading a blank as zero would refuse
    // everybody — so it says so quietly and carries on.
    (cap.named || []).forEach(function (g) {
      box.appendChild(el('span', { class: 'group' }, [
        el('b', { class: g.over ? 'over' : '', text: String(g.taken) }),
        el('span', { text: ' / ' + (g.capacity == null ? '∞' : g.capacity) + ' ' + titleOf(g.name, g.groupId) })
      ]));
    });
    if (cap.unassigned) {
      box.appendChild(el('span', { class: 'group', text:
        cap.unassigned + ' registered before the groups were named' }));
    }
  }

  // ---------- one row ----------
  function ageCell(r) {
    var f = r.ageFlagAtSubmission || {};
    if (f.inRange === false) {
      // ADVISORY, NEVER A GATE. It says "look at this one", not "this was
      // refused" — auto-approve stood aside and left the decision to a person,
      // and the person may well say yes. Amber rather than red, on purpose.
      return el('span', { class: 'flag', text: f.age + ' · outside ' +
        (f.min == null ? '' : f.min) + '-' + (f.max == null ? '' : f.max) });
    }
    if (f.age == null) return el('span', { class: 'flag unknown', text: 'age unknown' });
    return el('span', { class: 'flag ok', text: f.age });
  }

  function moneyCell(r) {
    var p = r.payment || {};
    var bits = [el('span', { class: 'num', text: money(p.paidCents) + ' / ' + money(p.owedCents) })];
    // Whether the yearly fee was billed on THIS term. An admin looking at a 300
    // beside a 350 should not have to open the other term to find out why.
    bits.push(el('div', {}, [el('span', {
      class: 'flag ok',
      text: r.feeCharged ? 'inc. yearly fee' : 'fee already paid ' + (r.feeYear || '')
    })]));
    if (p.status) bits.push(el('span', { class: 'pill ' + p.status, text: p.status }));
    return el('div', {}, bits);
  }

  function when(r) {
    var out = [el('span', { class: 'num', text: (r.submittedAt || '').slice(0, 10) })];
    // The DERIVED answer, not the stored one. A pending request whose deadline
    // passed an hour ago is already holding nothing, whether or not the nightly
    // sweep has run — so the row says "lapsed" before anything has rewritten it.
    if (r.lapsed) out.push(el('div', {}, [el('span', { class: 'pill lapsed', text: 'lapsed' })]));
    else if (r.status === 'pending') {
      out.push(el('div', {}, [el('span', { class: 'why', text: 'expires ' + (r.expiresAt || '').slice(0, 10) })]));
    }
    return el('div', {}, out);
  }

  function actions(r) {
    var live = r.status === 'pending' || r.status === 'approved';
    var decidable = ['pending', 'approved', 'rejected', 'expired'].indexOf(r.status) !== -1;
    var acts = [];

    acts.push(el('button', {
      class: 'go', disabled: !S.canApprove || !decidable || r.status === 'approved' || null,
      onclick: function () { act('approve', r, 'Approved'); }, text: 'Approve'
    }));
    acts.push(el('button', {
      disabled: !S.canApprove || !decidable || r.status === 'rejected' || null,
      onclick: function () { act('reject', r, 'Rejected'); }, text: 'Reject'
    }));
    // Cancel is its own axis because it moves money — it writes a credit a
    // family can spend and cannot be undone, only compensated.
    acts.push(el('button', {
      class: 'no', disabled: !S.canCancel || !live || null,
      onclick: function () { cancel(r); }, text: 'Cancel'
    }));
    acts.push(el('button', {
      onclick: function () { openAccount(r); }, text: 'Money'
    }));
    return el('div', { class: 'acts' }, acts);
  }

  function renderQueue() {
    var q = S.queue;
    $('queue-panel').hidden = false;
    $('queue-title').textContent = titleOf(q.activity.title, q.activity.slug) +
      ' · ' + q.registrations.length + ' registration' + (q.registrations.length === 1 ? '' : 's');
    renderCapacity(q.capacity);

    var box = $('queue');
    box.innerHTML = '';
    if (!q.registrations.length) {
      box.appendChild(el('p', { class: 'hint', text: 'Nobody has registered for this activity yet.' }));
      return;
    }
    var head = el('tr', {}, ['Participant', 'Age', 'Group', 'Status', 'Requested', 'Paid / owed', '']
      .map(function (h) { return el('th', { text: h }); }));
    var rows = q.registrations.map(function (r) {
      return el('tr', {}, [
        el('td', { class: 'who' }, [
          el('b', { text: r.name }),
          el('span', { text: r.accountEmail || r.accountId }),
          r.stillExists ? null : el('span', { class: 'flag', text: 'participant deleted' })
        ]),
        el('td', {}, [ageCell(r)]),
        el('td', { text: r.groupName ? titleOf(r.groupName, r.groupId) : '—' }),
        el('td', {}, [
          el('span', { class: 'pill ' + r.status, text: r.status }),
          r.autoApproved ? el('div', {}, [el('span', { class: 'why', text: 'automatic' })]) : null
        ]),
        el('td', {}, [when(r)]),
        el('td', {}, [moneyCell(r)]),
        el('td', {}, [actions(r)])
      ]);
    });
    box.appendChild(el('table', { class: 'queue' }, [
      el('thead', {}, [head]), el('tbody', {}, rows)
    ]));
  }

  // ---------- acting on a row ----------
  function act(action, r, said) {
    send({ action: action, participantId: r.participantId, activityId: r.activityId })
      .then(function (res) {
        if (!res.ok) return message('err', (res.data && res.data.error) || 'That did not work');
        message('ok', said + ' · ' + r.name);
        loadQueue(S.slug);
      });
  }

  function cancel(r) {
    // Typed confirmation rather than a plain OK, because this one writes money
    // into a ledger that cannot be edited afterwards.
    var note = window.prompt(
      'Cancelling ' + r.name + '. This credits whatever they are owed under the terms ' +
      'frozen on their registration, and the credit cannot be edited afterwards — only ' +
      'corrected with another entry.\n\nWhy? (recorded in the history)');
    if (note === null) return;
    send({ action: 'cancel', participantId: r.participantId, activityId: r.activityId, note: note })
      .then(function (res) {
        if (!res.ok) return message('err', (res.data && res.data.error) || 'That did not work');
        var c = res.data.entry;
        message('ok', 'Cancelled · ' + r.name + (c ? ' · credited ' + money(c.amountCents) : ' · nothing credited'));
        loadQueue(S.slug);
      });
  }

  // ---------- the money panel ----------
  //
  // Every money control is HERE rather than on the row, because money is its own
  // permission axis and because the ledger is the context all three need: what a
  // family is owed is the first thing to know before recording a payment against
  // it or spending it.
  function openAccount(r) {
    send({ action: 'ledger', accountId: r.accountId }).then(function (res) {
      if (!res.ok) return message('err', (res.data && res.data.error) || 'Could not read the ledger');
      var d = res.data;
      $('account-panel').hidden = false;
      $('account-title').textContent = 'Money · ' + (d.email || d.accountId);
      var box = $('account-body');
      box.innerHTML = '';

      box.appendChild(el('div', {}, [
        el('span', { class: 'balance', text: money(d.balanceCents) }),
        el('span', { class: 'why', text: ' credit held · ' + r.name + ' owes ' +
          money((r.payment || {}).owedCents) + ', paid ' + money((r.payment || {}).paidCents) })
      ]));

      box.appendChild(amountForm('Record a payment',
        'Money received from outside — a transfer, or cash at the desk. It adds, so two part payments are two entries.',
        S.canCancel, function (cents, note) {
          return { action: 'recordPayment', participantId: r.participantId,
                   activityId: r.activityId, amountCents: cents, note: note };
        }, r));

      box.appendChild(amountForm('Spend credit on this registration',
        'Writes a debit on the ledger and the same amount onto the registration, in one action — separately they would disagree about the same euros.',
        S.canCancel && d.balanceCents > 0, function (cents, note) {
          return { action: 'applyCredit', participantId: r.participantId,
                   activityId: r.activityId, amountCents: cents, note: note };
        }, r));

      box.appendChild(amountForm('Adjust the credit',
        'A correction is an entry, never an edit: the ledger is append-only, so the opposite line is written and both stay in the record. A note is required.',
        S.canCancel, function (cents, note) {
          return { action: 'adjustCredit', accountId: r.accountId, amountCents: cents,
                   note: note, type: cents < 0 ? 'debit' : 'credit' };
        }, r, true));

      if (d.entries.length) {
        var rows = d.entries.map(function (e) {
          return el('tr', {}, [
            el('td', { class: 'num', text: (e.createdAt || '').slice(0, 10) }),
            el('td', {}, [
              el('div', { text: e.reason.replace(/-/g, ' ') }),
              e.note ? el('div', { class: 'why', text: e.note }) : null,
              // WHY THIS AMOUNT AND NOT ANOTHER. A family credited 150 out of
              // 350 will ask, and the answer is in the entry rather than in
              // somebody's memory of what the policy used to be.
              e.basis ? el('div', { class: 'why', text:
                e.basis.mode + ' · ' + e.basis.sessionsRemaining + ' of ' + e.basis.sessionsTotal +
                ' sessions left · fee ' + money(e.basis.feeCredit) +
                ' + course ' + money(e.basis.courseCredit) }) : null
            ]),
            el('td', { class: 'amt ' + e.type,
                       text: (e.type === 'debit' ? '−' : '+') + money(e.amountCents) })
          ]);
        });
        box.appendChild(el('table', { class: 'ledger' }, [el('tbody', {}, rows)]));
      } else {
        box.appendChild(el('p', { class: 'hint', text: 'No credit entries on this account.' }));
      }
      $('account-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  // Euros in the box, cents on the wire. Typing 12.50 and sending 12.5 somewhere
  // that expects cents is the kind of mistake that is found by a family.
  function amountForm(title, hint, enabled, build, r, allowNegative) {
    var amount = el('input', { type: 'text', placeholder: '0.00', style: 'max-width:110px;', disabled: !enabled || null });
    var note = el('input', { type: 'text', placeholder: 'Note', disabled: !enabled || null });
    var btn = el('button', { type: 'button', class: 'btn btn-draft', disabled: !enabled || null, text: title });
    btn.addEventListener('click', function () {
      var euros = Number(String(amount.value).replace(',', '.'));
      if (!isFinite(euros) || euros === 0) return message('err', 'Type an amount.');
      if (euros < 0 && !allowNegative) return message('err', 'That has to be a positive amount.');
      var cents = Math.round(euros * 100);
      var body = build(cents, note.value);
      if (body.amountCents < 0) body.amountCents = Math.abs(body.amountCents);
      send(body).then(function (res) {
        if (!res.ok) return message('err', (res.data && res.data.error) || 'That did not work');
        message('ok', title + ' · ' + money(Math.abs(cents)));
        amount.value = ''; note.value = '';
        loadQueue(S.slug);
        openAccount(r);
      });
    });
    return el('div', { style: 'margin-top:16px;padding-top:14px;border-top:1px solid #f0ece1;' }, [
      el('div', { class: 'hint', text: hint }),
      el('div', { style: 'display:flex;gap:8px;margin-top:8px;align-items:center;' },
        [amount, note, btn])
    ]);
  }

  // ---------- loading ----------
  function renderPicker() {
    var box = $('picker');
    box.innerHTML = '';
    S.activities.forEach(function (a) {
      box.appendChild(el('button', {
        type: 'button', class: a.slug === S.slug ? 'active' : '',
        onclick: function () { loadQueue(a.slug); }
      }, [
        el('span', { class: 'slug', text: titleOf(a.title, a.slug) }),
        el('span', { class: 'pill ' + a.status, text: a.status })
      ]));
    });
    if (!S.activities.length) {
      box.appendChild(el('p', { class: 'hint', text: 'No published activities yet.' }));
    }
  }

  function loadQueue(slug) {
    S.slug = slug;
    renderPicker();
    return send({ action: 'queue', slug: slug }).then(function (res) {
      if (!res.ok) return message('err', (res.data && res.data.error) || 'Could not load the queue');
      S.queue = res.data;
      renderQueue();
    });
  }

  if (!window.AdminSession.requireSession()) return;
  $('logout').addEventListener('click', function () { window.AdminSession.logout(); });

  // The scheduled function cannot be triggered from a browser — Netlify's edge
  // answers 403 to every external request to one — so this calls the same run()
  // through the admin API instead of fetching the endpoint.
  $('btn-sweep').addEventListener('click', function () {
    send({ action: 'sweep' }).then(function (res) {
      if (!res.ok) return message('err', (res.data && res.data.error) || 'That did not work');
      message('ok', res.data.expired
        ? res.data.expired + ' request(s) marked expired, and the families told.'
        : 'Nothing had lapsed — the queue was already up to date.');
      if (S.slug) loadQueue(S.slug);
    });
  });

  send({ action: 'auth' }).then(function (res) {
    $('app').hidden = false;
    if (!res.ok) {
      $('tool').hidden = true;
      $('no-access').hidden = false;
      $('no-access').textContent = (res.data && res.data.error) ||
        'Your role does not have access to registrations.';
      return;
    }
    S.canApprove = !!res.data.canApprove;
    S.canCancel = !!res.data.canCancel;
    $('who').textContent = res.data.name + ' · ' + res.data.roleName;
    if (!S.canCancel) {
      $('btn-sweep').title = 'Your role may open the queue but not decide on it';
    }
    send({ action: 'activities' }).then(function (list) {
      if (!list.ok) return message('err', (list.data && list.data.error) || 'Could not list activities');
      S.activities = list.data.activities || [];
      if (S.activities.length) loadQueue(S.activities[0].slug);
      else renderPicker();
    });
  });
})();
