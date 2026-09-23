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
  // Written out rather than shown as a code: "ru" beside a draft is something an
  // admin has to decode, and this line is the whole warning.
  var LANG_NAME = { he: 'Hebrew', en: 'English', ru: 'Russian' };

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

  // ⚠ THE EARLIER ATTEMPT WAS IN THE PAYLOAD THE WHOLE TIME AND ON NO SCREEN.
  //
  // There is one record per participant per activity, so a family who cancels
  // and registers again lands back in the SAME blob -- and its history is
  // carried forward rather than overwritten, on purpose, "so an admin looking at
  // a second request can see the first". admin-registrations.js has been sending
  // `history` on every row since it was written. Nothing here read it, so from
  // the Roster the cancellation had simply never happened, and an admin went
  // looking for a row that does not exist and never did.
  //
  // It is a LINE UNDER THE STATUS, not a second row. Two rows for one place
  // would read as two places, and the capacity line above counts records: a
  // cancelled row beside a live one would say 2 / 20 for one child on one place.
  // One row, saying what it has been through.
  //
  // Only the endings are shown -- cancelled, rejected, expired. Every submission
  // and approval in between is the ordinary run of a registration and would bury
  // the one entry somebody is looking for.
  var ENDINGS = { cancelled: 1, rejected: 1, expired: 1 };
  function priorCell(r) {
    var h = r.history || [];
    // The LAST entry is what the pill beside this already says, so a currently
    // cancelled registration does not also report itself as previously
    // cancelled. Everything before it is a previous life of this record.
    var was = h.slice(0, -1).filter(function (e) { return ENDINGS[e.action]; });
    if (!was.length) return null;
    return el('div', {}, was.slice(-3).reverse().map(function (e) {
      return el('div', {}, [el('span', { class: 'why',
        text: 'was ' + e.action + ' ' + String(e.iso || '').slice(0, 10) })]);
    }));
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

  // ⚠ CORRECTING A GROUP MUST NOT MOVE MONEY, and until now it did.
  //
  // A child put in Beginners who belongs in Advanced is an ordinary thing to
  // happen at a community centre, and there was no control for it anywhere — so
  // the only route was to cancel the registration and register again. That
  // writes a credit, sends a cancellation email, re-freezes the terms at today's
  // price and re-decides the yearly fee. All of it real, none of it wanted, to
  // fix a dropdown somebody picked wrong.
  //
  // The server action existed the whole time with nothing calling it. The
  // select IS the control — a button opening a dialog to choose from two
  // options is a dialog for a select.
  //
  // Everything here is cosmetic and the server re-decides all of it: the same
  // `canApprove` gate, and a room check that EXCLUDES the registration being
  // moved, so moving within a full group is not refused by its own occupant.
  function groupCell(r) {
    var named = (S.queue && S.queue.capacity && S.queue.capacity.named) || [];
    var live = r.status === 'pending' || r.status === 'approved';

    // Pooled activity, a role that may not decide, or a registration that is
    // over: the frozen name, as before. Moving somebody whose place no longer
    // exists would rewrite a record about a group they are not in.
    if (!named.length || !S.canApprove || !live) {
      return el('span', { text: r.groupName ? titleOf(r.groupName, r.groupId) : '—' });
    }

    var sel = el('select', { class: 'group-move' });

    // A place taken while the activity was still pooled carries no group. It is
    // shown and cannot be chosen BACK — moveGroup requires a real group, and
    // there is deliberately no way to un-assign one.
    if (!r.groupId) {
      sel.appendChild(el('option', { value: '', selected: true, disabled: true, text: '— not in a group' }));
    }

    named.forEach(function (g) {
      var mine = g.groupId === r.groupId;
      // `left` already excludes nothing, so the group this row is IN reads one
      // lower than it will after a move out of it. That only matters for a
      // group somebody is leaving, which is never the one being disabled.
      var full = !mine && g.left != null && g.left <= 0;
      sel.appendChild(el('option', {
        value: g.groupId, selected: mine || null, disabled: full || null,
        text: titleOf(g.name, g.groupId) +
              (g.capacity == null ? '' : ' · ' + Math.max(0, g.left) + ' left') +
              (full ? ' · full' : '')
      }));
    });

    sel.addEventListener('change', function () {
      var to = sel.value;
      if (!to || to === r.groupId) return;
      sel.disabled = true;
      send({ action: 'moveGroup', slug: S.slug,
             participantId: r.participantId, groupId: to })
        .then(function (res) {
          if (!res.ok) {
            sel.disabled = false;
            // Put it back, or the screen claims a move the server refused.
            sel.value = r.groupId || '';
            return message('err', (res.data && res.data.error) || 'That did not work');
          }
          message('ok', 'Moved · ' + r.name);
          // The whole queue, not the one row: the capacity line above the table
          // counts both groups and would otherwise disagree with the select
          // that just changed.
          loadQueue(S.slug);
        });
    });
    return sel;
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
      onclick: function () { review('reject', r); }, text: 'Reject'
    }));
    // Cancel is its own axis because it moves money — it writes a credit a
    // family can spend and cannot be undone, only compensated.
    acts.push(el('button', {
      class: 'no', disabled: !S.canCancel || !live || null,
      onclick: function () { review('cancel', r); }, text: 'Cancel'
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
    // A course has no register, so it gets no button rather than a dead one.
    $('btn-codes').hidden = q.activity.type !== 'dropin';
    $('btn-bundles').hidden = q.activity.type !== 'dropin';
    if (q.activity.type !== 'dropin') {
      $('codes-panel').hidden = true;
      $('bundles-panel').hidden = true;
    }

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
        el('td', {}, [groupCell(r)]),
        el('td', {}, [
          el('span', { class: 'pill ' + r.status, text: r.status }),
          r.autoApproved ? el('div', {}, [el('span', { class: 'why', text: 'automatic' })]) : null,
          priorCell(r)
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

  // ---------- the codes on the wall ----------
  //
  // One QR per bookable evening, for a DROP-IN only: a course has no register to
  // mark, because it creates no per-session records at all. The button is absent
  // rather than disabled on a course, since there is nothing there to enable.
  //
  // ⚠ THE PICTURE IS MADE HERE AND THE URL IS PRINTED UNDER IT. A QR code is a
  // picture of a string, and a browser can draw one without the server doing
  // anything — so the handler returns the string. If the CDN that draws it is
  // unavailable the URL is still on screen, still correct, and still typeable,
  // which is the same trade the Quill fallback makes.
  function loadCodes() {
    send({ action: 'checkinCodes', slug: S.slug }).then(function (res) {
      if (!res.ok) return message('err', (res.data && res.data.error) || 'That did not work');
      renderCodes(res.data);
    });
  }

  function renderCodes(d) {
    var box = $('codes');
    box.innerHTML = '';
    $('codes-panel').hidden = false;
    if (!d.codes.length) {
      box.appendChild(el('p', { class: 'hint', text: 'This activity has no dates in its calendar yet.' }));
      return;
    }
    box.appendChild(el('p', { class: 'hint', text:
      'One code per evening. Print or show the one for the date — each works only ' +
      'on its own day, and stops working when that day ends. Anyone holding it can ' +
      'see the names booked for that evening and mark any of them present; nobody ' +
      'can book, cancel or see money with it.' }));

    d.codes.forEach(function (c) {
      var art = el('div', { class: 'qr-art' });
      var card = el('div', { class: 'qr-card' }, [
        el('h3', { text: c.sessionDate }),
        art,
        // Selectable, so it can be copied onto something else if the picture
        // cannot be. It is long; it wraps rather than being cut off, because a
        // truncated URL is worse than an ugly one.
        el('code', { class: 'qr-url', text: c.url })
      ]);
      box.appendChild(card);
      if (window.QRCode) {
        // eslint-disable-next-line no-new
        new window.QRCode(art, { text: c.url, width: 190, height: 190, correctLevel: window.QRCode.CorrectLevel.M });
      } else {
        art.appendChild(el('p', { class: 'hint', text: 'The code drawer did not load — use the address below.' }));
      }
    });
  }

  // ---------- what was bought in advance ----------
  //
  // ⚠ THE QUEUE CANNOT SHOW THIS, and that is why it is its own panel rather
  // than a column. A bundle is not a registration: it is a purchase against an
  // activity, one family can hold two of them, and the thing an admin needs to
  // see is a list of DATES with what happened to each. That does not fit in a
  // cell, and squeezing it into one would have meant the number that matters —
  // how many entries are left — being derived on screen from two others.
  //
  // The figures come from the server's bundleView(), the same builder the
  // family's own card uses. An admin reading a different number from the family
  // on the phone is the failure this avoids.
  function loadBundles() {
    send({ action: 'bundles', slug: S.slug }).then(function (res) {
      if (!res.ok) return message('err', (res.data && res.data.error) || 'That did not work');
      renderBundles(res.data.bundles || []);
    });
  }

  var ENTRY_STATE = {
    used: 'used', booked: 'booked', available: 'available',
    // Not "expired": the entry was theirs and the date simply went by. The
    // window doing its job is not the same event as a promise being broken, and
    // the word has to keep them apart — a shortfall we caused is credited back,
    // and this is not that.
    gone: 'not used'
  };

  function renderBundles(list) {
    var box = $('bundles');
    box.innerHTML = '';
    $('bundles-panel').hidden = false;
    if (!list.length) {
      box.appendChild(el('p', { class: 'hint', text: 'Nobody has bought a bundle for this activity.' }));
      return;
    }
    box.appendChild(el('p', { class: 'hint', text:
      'Sessions bought in advance. Entries left is derived from the dates used, never ' +
      'stored — and a date we cancel that cannot be replaced is credited back at the ' +
      'rate that was paid, by the nightly pass, once the activity is over.' }));

    list.forEach(function (b) {
      var head = el('div', { class: 'bundle-head' }, [
        el('b', { text: b.participantName }),
        el('span', { class: 'bundle-count', text: b.remaining + ' of ' + b.entries + ' left' }),
        el('span', { class: 'hint', text: money(b.totalCents) + ' · ' + b.status })
      ]);
      var table = el('table', { class: 'bundle-dates' });
      b.rows.forEach(function (r) {
        table.appendChild(el('tr', {}, [
          el('td', { text: r.date }),
          el('td', { text: ENTRY_STATE[r.state] || r.state })
        ]));
      });
      var kids = [head, table];
      if (b.shortfallCreditedCents > 0) {
        kids.push(el('p', { class: 'hint', text:
          'Credited back for sessions we could not offer: ' + money(b.shortfallCreditedCents) }));
      }
      box.appendChild(el('div', { class: 'bundle-card' }, kids));
    });
  }

  // ---------- rejecting: read it before it goes ----------
  //
  // The ONLY message on this site an admin may rewrite before it is sent, and
  // the reason is in _registration-email.js: approval is binary and carries no
  // reason code, so the generated refusal cannot explain itself. It opens a door
  // instead. An admin who already knows what to say should be able to say it
  // here, rather than in a second email the family has to connect to the first.
  //
  // ⚠ THE DRAFT IS IN THE FAMILY'S LANGUAGE. An admin rejecting a
  // Russian-reading family is handed Russian. That is not hidden and not worked
  // around — the panel names the language, and Send unchanged is the default.
  // Rewriting it in the admin's own language would send a family a message they
  // cannot read, which is worse than a formal one they can.
  //
  // Quill, the same editor and version the activity body uses, falling back to a
  // textarea when the CDN is unavailable. The server sanitises either way.
  // ONE PANEL, TWO DECISIONS. Rejecting and cancelling have different
  // permissions and different consequences, and the review is the same job in
  // both: read what the family will receive, in their own language, before
  // something irreversible happens. A second copy of this would be a second
  // place for the sanitise contract, the language warning and the
  // did-the-email-go reporting to drift out of step.
  var REVIEW = {
    reject: {
      preview: 'rejectPreview', action: 'reject', verb: 'Reject', go: 'Reject and send',
      said: 'Rejected', note: false,
      hint: 'The decision is recorded either way; a rejection is never resent, so this ' +
            'is the one time it can be worded.'
    },
    cancel: {
      preview: 'cancelPreview', action: 'cancel', verb: 'Cancel', go: 'Cancel and send',
      said: 'Cancelled', note: true,
      hint: 'This writes a credit into a ledger that cannot be edited afterwards — only ' +
            'corrected with another entry.'
    }
  };

  function review(kind, r) {
    var K = REVIEW[kind];
    send({ action: K.preview, participantId: r.participantId, activityId: r.activityId })
      .then(function (res) {
        if (!res.ok) return message('err', (res.data && res.data.error) || 'That did not work');
        openReviewPanel(K, r, res.data);
      });
  }

  function openReviewPanel(K, r, draft) {
    var back = el('div', { class: 'modal-back' });
    var close = function () { if (back.parentNode) back.parentNode.removeChild(back); };

    var subject = el('input', { type: 'text', class: 'modal-subject', value: draft.subject });
    subject.value = draft.subject;

    // The INTERNAL note, which the typed prompt this panel replaced used to
    // collect on a cancellation. It goes to the history and the audit trail and
    // never to the family — the paragraphs below are the family's copy, and
    // conflating the two would put "mother says they are moving abroad" into
    // somebody's inbox.
    var note = el('input', { type: 'text', class: 'modal-subject' });
    var host = el('div', { class: 'modal-editor' });
    var area = el('textarea', { class: 'modal-editor' });
    var quill = null;
    var go = el('button', { class: 'no', text: K.go });

    var panel = el('div', { class: 'modal' }, [
      el('h3', { text: K.verb + ' · ' + r.name }),
      el('p', { class: 'hint', text:
        'This is what ' + (draft.to || 'the family') + ' will receive, in ' +
        LANG_NAME[draft.lang] + ' — the language they read. Send it as it is, or ' +
        'add a reason. ' + K.hint }),
      // What the ledger will record, on its own line rather than left to be
      // spotted inside the prose. ABSENT when there is nothing to credit:
      // "credits €0.00" reads as a decision taken against the family rather
      // than as the arithmetic of an activity nobody has paid for, and today
      // that is every cancellation on the site.
      draft.creditCents > 0
        ? el('p', { class: 'modal-credit', text: 'Credits ' + money(draft.creditCents) })
        : null,
      K.note ? el('label', { class: 'modal-label', text: 'Why (recorded internally, not sent)' }) : null,
      K.note ? note : null,
      el('label', { class: 'modal-label', text: 'Subject' }), subject,
      el('label', { class: 'modal-label', text: 'Message' }),
      window.Quill ? host : area,
      el('div', { class: 'modal-acts' }, [
        el('button', { class: 'ghost', onclick: close, text: 'Cancel' }), go
      ])
    ]);
    back.appendChild(panel);
    // ⚠ Clicking the backdrop does NOT close it. Half a written message thrown
    // away by a stray click is the thing this panel exists to prevent.
    back.addEventListener('click', function (e) { if (e.target === back) e.stopPropagation(); });
    document.body.appendChild(back);

    // Quill attaches to a node already in the document, which is why this runs
    // after the append rather than while the panel is being built.
    if (window.Quill) {
      quill = new window.Quill(host, {
        theme: 'snow',
        modules: { toolbar: [['bold', 'italic', 'underline'], [{ list: 'bullet' }, { list: 'ordered' }],
                             ['link'], ['clean']] }
      });
      quill.root.innerHTML = draft.bodyHtml;
      // The editor writes the reader's direction, so a Hebrew or Russian draft
      // is edited the way it will be read rather than mirrored.
      quill.root.setAttribute('dir', draft.lang === 'he' ? 'rtl' : 'ltr');
    } else {
      area.value = draft.bodyHtml;
      area.setAttribute('dir', draft.lang === 'he' ? 'rtl' : 'ltr');
    }

    go.addEventListener('click', function () {
      var html = quill ? quill.root.innerHTML : area.value;
      // Quill's empty document. Sending it would be a blank refusal; the server
      // refuses it too, and this only saves the round trip.
      if (!html || html === '<p><br></p>' || !html.replace(/<[^>]*>/g, '').trim()) {
        return message('err', 'A rejection needs something to say.');
      }
      go.disabled = true;
      send({ action: K.action, participantId: r.participantId, activityId: r.activityId,
             note: K.note ? note.value : null,
             message: { subject: subject.value, bodyHtml: html,
                        // The figure this draft was written against. The server
                        // refuses the whole action if it has moved since, rather
                        // than telling a family a number nobody credited them.
                        basedOnCreditCents: draft.creditCents || 0 } })
        .then(function (res) {
          go.disabled = false;
          if (!res.ok) return message('err', (res.data && res.data.error) || 'That did not work');
          close();
          // WHETHER IT WENT, not just whether it was decided. An admin who has
          // written a message by hand must not be left believing a family was
          // told something nobody told them. The decision stands regardless —
          // an email failure has never blocked an action here.
          var credited = res.data.entry ? ' · credited ' + money(res.data.entry.amountCents) : '';
          message(res.data.emailed === false ? 'err' : 'ok',
            res.data.emailed === false
              ? K.said + ' · ' + r.name + credited + ' — BUT THE EMAIL DID NOT GO. Tell them another way.'
              : K.said + ' · ' + r.name + credited + ' · message sent');
          loadQueue(S.slug);
        });
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
  $('btn-codes').addEventListener('click', loadCodes);
  $('btn-bundles').addEventListener('click', loadBundles);
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
