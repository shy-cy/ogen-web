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
  var S = { activities: [], slug: null, queue: null, register: null, date: null,
            canApprove: false, canCancel: false, filter: null, eveFilter: null };
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
  // ⚠ AND ON A DROP-IN IT SAYS SOMETHING ELSE, because it is answering a
  // different question. Registering for a drop-in is uncapped on purpose —
  // forty families can hold a registration and eight turn up — so pairing that
  // count with the size of the room produced "4 of 3 places · Over capacity" on
  // an activity where nothing was over anything and no rule had been broken.
  //
  // The room is real and is enforced per evening, in capacityForDate(). So the
  // line says the count with no limit beside it and points at where the limit
  // lives, and the strip under it carries the actual numbers.
  //
  // `perSession` comes from the report rather than from the activity type, so a
  // screen cannot decide this differently from the function that counted.
  function renderCapacity(cap) {
    var box = $('capacity');
    box.innerHTML = '';
    if (cap.perSession) {
      box.appendChild(el('span', {}, [
        el('b', { text: String(cap.taken) }),
        el('span', { text: ' registered · a registration holds no place on any evening' })
      ]));
      box.appendChild(el('span', { class: 'group', text: 'The room is counted per evening, below' }));
      return;
    }
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
    // ⚠ DERIVED, NOT `payment.status`. That field is stamped 'owed' when the
    // record is written and stays there on a row that owes nothing at all —
    // which is how the live roster came to print "€0.00 / €0.00 OWED", and how
    // an evening's WAITING row, which owes nothing by definition, was marked as
    // owing. The filters already read payBucket() for exactly this reason; the
    // cell beside them was still reading the stored field, so the same table
    // could file a row under "nothing to pay" and label it OWED.
    var bucket = payBucket(r);
    if (bucket !== 'none') {
      bits.push(el('span', { class: 'pill ' + (bucket === 'owes' ? 'owed' : 'paid'),
                             text: bucket === 'owes' ? 'owed' : 'paid' }));
    }
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
          // WHETHER THE FAMILY WAS TOLD, not just whether the row moved. A
          // move changes which room a child walks into, so an admin left
          // believing a message went when it did not would let a family arrive
          // at the old group. The move stands either way.
          message(res.data.emailed === false ? 'err' : 'ok',
            res.data.emailed === false
              ? 'Moved \u00B7 ' + r.name + ' \u2014 BUT THE EMAIL DID NOT GO. Tell them another way.'
              : 'Moved \u00B7 ' + r.name + ' \u00B7 the family has been emailed');
          // The whole queue, not the one row: the capacity line above the table
          // counts both groups and would otherwise disagree with the select
          // that just changed.
          loadQueue(S.slug);
        });
    });
    return sel;
  }

  // ⚠ THE ROW'S CONTROLS ARE GLYPHS, AND THE WORD IS NOT OPTIONAL.
  //
  // Four labelled buttons wrapped to two lines on every row, so a table opened to
  // scan for the rows that need something doing was half as tall again as it had
  // to be, and the labels were the same four words repeated down the page.
  //
  // ⚠ BUT THIS ADMIN HAS LEARNED TWICE WHAT AN UNREADABLE CONTROL COSTS — the
  // invite button labelled with a description, and the (i) rule that exists
  // because a hint nobody can reach is a hint nobody has. An icon with no word
  // anywhere is that mistake in its purest form. So the word is always present
  // in three places and only the ON-SCREEN one is traded away:
  //
  //   · `aria-label`, so a screen reader announces the action and not "button";
  //   · `data-tip`, a styled tooltip on hover AND on keyboard focus — focus
  //     rather than hover alone, because a control only a mouse can explain is
  //     unreadable to somebody tabbing through it;
  //   · `title`, which is what a touch device with no hover falls back to.
  //
  // The glyphs are drawn rather than typed: a check, a cross, a slashed circle
  // and a coin. Lucide paths, like everything else on this site, and built with
  // createElementNS — an <svg> made with createElement is an HTMLUnknownElement
  // and draws nothing at all.
  var GLYPH = {
    // check
    approve: 'M20 6 9 17l-5-5',
    // x
    reject: 'M18 6 6 18M6 6l12 12',
    // ban — a slashed circle, not a second cross: rejecting and cancelling are
    // different acts and two crosses would say they are the same one.
    cancel: 'M4.9 4.9l14.2 14.2',
    // circle-dollar
    money: 'M12 6v12M15 9.5a2.5 2.5 0 0 0-2.5-2h-1a2 2 0 1 0 0 4h1a2 2 0 1 1 0 4h-1A2.5 2.5 0 0 1 9 14.5'
  };
  function glyph(name) {
    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    if (name === 'cancel' || name === 'money') {
      var c = document.createElementNS(NS, 'circle');
      c.setAttribute('cx', '12'); c.setAttribute('cy', '12');
      c.setAttribute('r', name === 'cancel' ? '9' : '9.5');
      svg.appendChild(c);
    }
    var path = document.createElementNS(NS, 'path');
    path.setAttribute('d', GLYPH[name]);
    svg.appendChild(path);
    return svg;
  }
  // ⚠ THE TOOLTIP NAMES THE ACTION AND THEN SAYS WHAT SEPARATES IT.
  //
  // Asked plainly: "what is the difference between cancel and reject?" If the
  // person who commissioned this screen cannot tell, an admin working a queue at
  // eight in the morning cannot either — and the two are a decision about a
  // place and a decision about money. Rejecting says we could not take them and
  // moves nothing; cancelling ends a place that existed, writes a credit through
  // a ledger that cannot be edited, and emails a figure.
  //
  // The distinction lives here rather than in the label because a label has to
  // fit on a row; it lives on the control rather than behind an (i) because
  // there is no (i) on a table row and this is what would read the same on an
  // empty activity as on a full one, which is exactly the rule for what a
  // tooltip is FOR.
  //
  // `aria-label` stays the bare verb: a screen reader announces what a control
  // DOES, and the sentence after it is an explanation rather than a name.
  function iconButton(name, label, why, tone, off, onclick) {
    var tip = why ? label + ' \u00b7 ' + why : label;
    return el('button', {
      type: 'button', class: 'icon' + (tone ? ' ' + tone : ''),
      'aria-label': label, 'data-tip': tip, title: tip,
      disabled: off || null, onclick: onclick
    }, [glyph(name)]);
  }

  function actions(r) {
    var live = r.status === 'pending' || r.status === 'approved';
    var decidable = ['pending', 'approved', 'rejected', 'expired'].indexOf(r.status) !== -1;
    return el('div', { class: 'acts' }, [
      iconButton('approve', 'Approve', 'they have the place', 'go',
        !S.canApprove || !decidable || r.status === 'approved',
        function () { act('approve', r, 'Approved'); }),
      iconButton('reject', 'Reject', 'we could not take them. No place was ever held, ' +
        'so nothing is owed and nothing is credited', null,
        !S.canApprove || !decidable || r.status === 'rejected',
        function () { review('reject', r); }),
      // Cancel is its own axis because it moves money — it writes a credit a
      // family can spend and cannot be undone, only compensated.
      iconButton('cancel', 'Cancel', 'a place they had ends. Any credit is written ' +
        'to their account and cannot be undone', 'no', !S.canCancel || !live,
        function () { review('cancel', r); }),
      iconButton('money', 'Payments and credit', null, null, false,
        function () { openAccount(r); })
    ]);
  }

  // ---------- narrowing the table ----------
  //
  // Asked for as "it would be convenient if we can filter the view according to
  // group / status / payment status -- what else?".
  //
  // This screen is opened to FIND THE ROWS THAT NEED SOMETHING DOING, which is
  // the reason it is a table rather than cards, and on an activity with forty
  // families that job is scrolling. The three asked for are here; two more earn
  // their place, and both are about the same job:
  //
  //  - a NAME OR EMAIL box, which is the filter an admin actually reaches for,
  //    because the commonest way this screen is opened is a parent on the phone;
  //  - AGE FLAGGED, because that amber marker is the only advisory thing on the
  //    row and it is the reason an auto-approving activity left somebody
  //    pending. It is the one filter that answers "what is waiting for me".
  //
  // Three rules hold it together:
  //
  // ⚠ IT IS THE TABLE THAT NARROWS, NEVER THE CAPACITY LINE. The line above
  // counts the room and every record in it, and a filtered count sitting in it
  // would be a true number answering a different question -- which is exactly the
  // "4 of 3 places · Over capacity" bug this screen already learned once. So the
  // bar sits BELOW the capacity line, and it says how many of how many it is
  // showing, in its own words, where the filters are.
  //
  // ⚠ A CONTROL APPEARS ONLY WHEN IT CAN CHANGE WHAT IS SHOWN. The options are
  // built from the rows in hand -- with their counts, so the select is also a
  // summary -- and a select offering "All" plus one thing is not offered at all.
  // That needs no threshold and no judgement about how big a list has to be
  // before filtering it is worth a row of controls.
  //
  // ⚠ AND THEY RESET WHEN THE ACTIVITY CHANGES. A group filter from one
  // activity means nothing on the next, and a stale one carried across the
  // picker would draw an empty table on an activity that is full -- which reads
  // as "nobody has registered", the one sentence this screen must not say when
  // it is not true. See loadQueue.
  //
  // Everything here is in the browser, over rows that are already in hand: a
  // round trip per keystroke would be a second implementation of every rule
  // below, server-side, for a list a community centre can hold in one response.
  function newFilter() { return { q: '', group: '', status: '', pay: '', flagged: false }; }

  function searchable(r) {
    return ((r.name || '') + ' ' + (r.accountEmail || '') + ' ' + (r.accountId || '')).toLowerCase();
  }
  function isFlagged(r) { return ((r.ageFlagAtSubmission || {}).inRange) === false; }

  // ⚠ DERIVED, NOT `payment.status`. That field is stamped 'owed' when the
  // record is written and stays there on a registration that owes nothing at all
  // -- which is why the roster can show "€0.00 / €0.00 OWED". Filtering on it
  // would inherit that, and put rows with nothing to pay under "owes money".
  function payBucket(r) {
    var p = r.payment || {};
    if (!(p.owedCents > 0)) return 'none';
    return (p.owedCents - (p.paidCents || 0)) > 0 ? 'owes' : 'settled';
  }
  var PAY_LABEL = { owes: 'Owes money', settled: 'Settled', none: 'Nothing to pay' };
  // The order the queue is worked in, not alphabetical.
  var STATUS_ORDER = ['pending', 'approved', 'waiting', 'rejected', 'expired', 'cancelled'];

  function inGroup(r, want) {
    if (!want) return true;
    return want === '-' ? !r.groupId : r.groupId === want;
  }
  function passes(r) {
    var f = S.filter;
    if (f.q && searchable(r).indexOf(f.q) === -1) return false;
    if (!inGroup(r, f.group)) return false;
    if (f.flagged && !isFlagged(r)) return false;
    if (f.status && f.status !== r.status) return false;
    if (f.pay && payBucket(r) !== f.pay) return false;
    return true;
  }
  // The waiting list answers three of the five questions and not the other two.
  // Somebody waiting holds nothing and owes nothing, so a PAYMENT filter is a
  // question about money this list has no answer to -- it stands the list down
  // rather than guessing one. `waiting` is an option in the status select for
  // the same reason it is a status on the record: filtering to it is how you ask
  // to see only the queue.
  function passesWaiting(r) {
    var f = S.filter;
    if (f.pay) return false;
    if (f.status && f.status !== 'waiting') return false;
    if (f.q && searchable(r).indexOf(f.q) === -1) return false;
    if (!inGroup(r, f.group)) return false;
    if (f.flagged && !isFlagged(r)) return false;
    return true;
  }

  function tally(list, of) {
    var out = {};
    list.forEach(function (r) { var k = of(r); out[k] = (out[k] || 0) + 1; });
    return out;
  }
  // "All" plus the options actually present, each carrying its count -- so the
  // control is a summary of the activity as well as a way to narrow it.
  function pick(label, value, opts, onPick) {
    if (opts.length < 2) return null;
    var sel = el('select', { 'aria-label': label,
      onchange: function (e) { onPick(e.currentTarget.value); } });
    [{ v: '', t: label }].concat(opts).forEach(function (o) {
      var op = el('option', { value: o.v, text: o.t });
      if (o.v === value) op.setAttribute('selected', 'selected');
      sel.appendChild(op);
    });
    sel.value = value;
    return sel;
  }

  function filterBar(regs, waiting, repaint) {
    var f = S.filter;
    var everyone = regs.concat(waiting);
    var controls = [];

    // Group: only where there is a choice to make. A pooled activity, or one
    // with a single group, has nothing to pick between.
    var named = (S.queue && S.queue.capacity && S.queue.capacity.named) || [];
    if (named.length > 1) {
      var byGroup = tally(everyone, function (r) { return r.groupId || '-'; });
      var gopts = named.map(function (g) {
        return { v: g.groupId, t: titleOf(g.name, g.groupId) + ' (' + (byGroup[g.groupId] || 0) + ')' };
      });
      // Registrations taken before the groups were named belong to no row and
      // say so, here as in the capacity line above.
      if (byGroup['-']) gopts.push({ v: '-', t: 'Not assigned (' + byGroup['-'] + ')' });
      controls.push(pick('All groups', f.group, gopts, function (v) { f.group = v; repaint(); }));
    }

    var byStatus = tally(regs, function (r) { return r.status; });
    if (waiting.length) byStatus.waiting = waiting.length;
    var sopts = STATUS_ORDER.filter(function (k) { return byStatus[k]; })
      .map(function (k) { return { v: k, t: k.charAt(0).toUpperCase() + k.slice(1) + ' (' + byStatus[k] + ')' }; });
    controls.push(pick('Any status', f.status, sopts, function (v) { f.status = v; repaint(); }));

    var byPay = tally(regs, payBucket);
    var popts = ['owes', 'settled', 'none'].filter(function (k) { return byPay[k]; })
      .map(function (k) { return { v: k, t: PAY_LABEL[k] + ' (' + byPay[k] + ')' }; });
    controls.push(pick('Any payment', f.pay, popts, function (v) { f.pay = v; repaint(); }));

    var flaggedCount = everyone.filter(isFlagged).length;
    if (flaggedCount) {
      var box = el('input', { type: 'checkbox', id: 'filter-flagged',
        onchange: function (e) { f.flagged = !!e.currentTarget.checked; repaint(); } });
      box.checked = f.flagged;
      controls.push(el('label', { class: 'filter-check', for: 'filter-flagged' },
        [box, el('span', { text: 'Age flagged (' + flaggedCount + ')' })]));
    }

    // ⚠ THE BOX IS BUILT ONCE AND KEPT. Only the rows below are redrawn on a
    // keystroke -- rebuilding the bar would take the focus out of the input
    // somebody is typing into, one character in.
    var q = null;
    if (everyone.length > 1) {
      q = el('input', { type: 'search', 'aria-label': 'Find a name or email',
        placeholder: 'Name or email',
        oninput: function (e) { f.q = String(e.currentTarget.value || '').trim().toLowerCase(); repaint(); } });
      q.value = f.q;
    }

    controls = controls.filter(Boolean);
    if (!q && !controls.length) return null;

    var count = el('span', { class: 'filter-count' });
    var clear = el('button', { type: 'button', class: 'filter-clear', text: 'Clear',
      onclick: function () { S.filter = newFilter(); renderQueue(); } });
    var bar = el('div', { class: 'filters' },
      [q].concat(controls).concat([count, clear]));
    bar._count = count;
    bar._clear = clear;
    return bar;
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
      $('dates').hidden = true;
    }

    var box = $('queue');
    box.innerHTML = '';

    // ⚠ ONE TABLE, TWO SUBJECTS. With an evening picked the table is that
    // evening's register; with "All" it is the registrations. A second table
    // below the first would put a count of registrations above a count of a
    // room, which is the pairing that made this screen wrong in the first place.
    if (q.activity.type === 'dropin' && S.date) return renderEvening(box);

    var regs = q.registrations || [];
    var waiting = q.waiting || [];
    if (!regs.length && !waiting.length) {
      box.appendChild(el('p', { class: 'hint', text: 'Nobody has registered for this activity yet.' }));
      return;
    }
    // The bar is drawn ONCE and the rows below it are what gets redrawn. Rebuild
    // the bar on a keystroke and the search box loses the focus it is being
    // typed into.
    var rowsBox = el('div', {});
    var bar = filterBar(regs, waiting, function () { paintRows(bar, rowsBox, regs, waiting); });
    if (bar) box.appendChild(bar);
    box.appendChild(rowsBox);
    paintRows(bar, rowsBox, regs, waiting);
  }

  function paintRows(bar, box, regs, waiting) {
    box.innerHTML = '';
    var f = S.filter;
    var on = !!(f.q || f.group || f.status || f.pay || f.flagged);
    var show = regs.filter(passes);
    var wait = waiting.filter(passesWaiting);

    if (bar) {
      // ⚠ SAID HERE AND NOT IN THE CAPACITY LINE. That line counts the room
      // and every record against it; a filtered figure in it would be a true
      // number answering a different question, which is the pairing this screen
      // was already reported for once.
      var parts = [show.length + ' of ' + regs.length +
                   ' registration' + (regs.length === 1 ? '' : 's')];
      if (waiting.length) parts.push(wait.length + ' of ' + waiting.length + ' waiting');
      bar._count.textContent = 'Showing ' + parts.join(' · ');
      bar._clear.hidden = !on;
    }

    if (!show.length) {
      // ⚠ NEVER "nobody has registered" WHILE A FILTER IS ON. It is the one
      // sentence this screen must not say when it is not true, and a narrowed
      // table is the easiest way to make it a lie.
      box.appendChild(el('p', { class: 'hint', text: on
        ? (wait.length ? 'No registrations match — only the waiting list below.'
                       : 'Nothing matches these filters.')
        : 'Nobody has registered for this activity yet.' }));
      return renderWaiting(box, wait);
    }

    var head = el('tr', {}, ['Participant', 'Age', 'Group', 'Status', 'Requested', 'Paid / owed', '']
      .map(function (h) { return el('th', { text: h }); }));
    var rows = show.map(function (r) {
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
    renderWaiting(box, wait);
  }

  // ⚠ A LIST, NOT A SECOND QUEUE, and it is drawn below the table rather than
  // mixed into it.
  //
  // Nothing in a queue row applies to somebody waiting: there is no place to
  // approve, nothing to reject, no money owed and no deadline running. Mixed in,
  // every one of those columns would be blank and the two decision buttons would
  // be offering to decide something nobody has asked.
  //
  // There are no controls on it on purpose. A freed place is announced to
  // everybody waiting at once and goes to whoever takes it first — that is the
  // rule that was chosen — so a "give this one a place" button here would be a
  // second, quieter rule running beside it, and the two would disagree the first
  // time somebody used it.
  // Whether there is a place to give THIS row — its own group's, never the
  // activity's. Cosmetic, like every check on this side: the server asks
  // openRegistration() again and refuses if the room has gone in between.
  function roomFor(r) {
    var cap = (S.queue && S.queue.capacity) || {};
    var g = (cap.named || []).filter(function (x) { return x.groupId === r.groupId; })[0];
    if (r.groupId && g) return g.capacity == null || g.left > 0;
    return cap.capacity == null || cap.left > 0;
  }

  function givePlace(r) {
    send({ action: 'givePlace', slug: S.slug,
           participantId: r.participantId, activityId: r.activityId })
      .then(function (res) {
        if (!res.ok) return message('err', (res.data && res.data.error) || 'That did not work');
        message(res.data.emailed === false ? 'err' : 'ok',
          res.data.emailed === false
            ? r.name + ' has the place — BUT THE EMAIL DID NOT GO. Tell them another way.'
            : r.name + ' has the place, and the family has been emailed.');
        loadQueue(S.slug);
      });
  }

  function renderWaiting(box, list) {
    list = list || [];
    if (!list.length) return;
    var head = el('tr', {}, ['Waiting', 'Age', 'Group', 'Since', ''].map(function (h) {
      return el('th', { text: h });
    }));
    var rows = list.map(function (r) {
      var room = roomFor(r);
      return el('tr', {}, [
        el('td', { class: 'who' }, [
          el('b', { text: r.name }),
          el('span', { text: r.accountEmail || r.accountId }),
          r.stillExists ? null : el('span', { class: 'flag', text: 'participant deleted' })
        ]),
        el('td', {}, [ageCell(r)]),
        el('td', {}, [el('span', { text: r.groupName ? titleOf(r.groupName, r.groupId) : '—' })]),
        el('td', {}, [el('span', { text: shortDate((r.waitingSince || '').slice(0, 10)) })]),
        // ⚠ A WORD, NOT A GLYPH, and that is not an inconsistency with the table
        // above. Icons earn their place on four controls repeated down every row
        // of a queue; this is one control on a table that has never had any, and
        // it does something nobody expects to be possible. A capability nobody
        // can find is a capability nobody has — learned twice on this admin.
        el('td', {}, [el('div', { class: 'acts' }, [
          el('button', {
            class: 'go', disabled: !S.canApprove || !r.stillExists || !room || null,
            title: !S.canApprove ? 'Your role may open the queue but not decide on it'
                 : !r.stillExists ? 'That participant no longer exists'
                 : !room ? 'That group is full — there is no place to give'
                 : 'Opens the registration, re-freezes the terms at today\'s price and '
                   + 'emails the family. The hold is hours, not weeks.',
            onclick: function () { givePlace(r); }, text: 'Give a place'
          })
        ])])
      ]);
    });
    box.appendChild(el('div', { class: 'label-row', style: 'margin-top:26px;' }, [
      el('h3', { class: 'field-label', style: 'margin:0;',
                 text: list.length + ' waiting' }),
      window.AdminHelp.badge('Families who asked for a place that was already taken. They hold ' +
        'nothing and owe nothing. When a place opens \u2014 somebody cancels, is rejected, or an ' +
        'unpaid request lapses \u2014 every one of them is emailed at once, and it goes to whoever ' +
        'takes it first. Paying is what secures it: a place claimed off this list is held for ' +
        'hours rather than weeks, and goes back to the list if it is not paid for.')
    ]));
    box.appendChild(el('table', { class: 'queue' }, [
      el('thead', {}, [head]), el('tbody', {}, rows)
    ]));
  }

  // ---------- the evenings ----------
  //
  // ⚠ AN EVENING IS THE UNIT ON A DROP-IN, the way a group is the unit on a
  // course, and this screen did not know it. The Roster counted REGISTRATIONS
  // against the size of the room and called the result "over capacity" — two
  // numbers that answer different questions, printed as one sentence. Reported
  // as: "as each session is on its own, the count shouldn't be for the activity
  // but per session."
  //
  // The count that matters is per date, and it has existed the whole time:
  // capacityForDate() counts `booked` and `attended` on one evening, the family's
  // own picker has shown it since Phase 7, and the `register` action returned it
  // to nobody, because there was no screen. That gap was named in UNREACHED and
  // closed here.
  //
  // ⚠ A STRIP RATHER THAN A SECOND TAB. The two questions an admin opens this
  // for on the night — is tonight full, and who is coming — are one glance apart
  // if the dates carry their own counts, and two clicks apart behind a tab. It
  // keeps ONE table: picking an evening swaps what the table is about, and the
  // "All" chip is the registrations list with an honest uncapped line.
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function shortDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    return String(+m[3]) + ' ' + MONTHS[+m[2] - 1];
  }

  // The next evening on or after today, because that is the register somebody
  // standing in the room wants. Falls back to the LAST one when the activity is
  // over — an empty strip selection would draw a table about nothing.
  function defaultDate(dates) {
    if (!dates || !dates.length) return null;
    var today = new Date().toISOString().slice(0, 10);
    for (var i = 0; i < dates.length; i++) {
      if (dates[i].sessionDate >= today) return dates[i].sessionDate;
    }
    return dates[dates.length - 1].sessionDate;
  }

  function renderStrip() {
    var box = $('dates');
    box.innerHTML = '';
    var d = S.register;
    if (!d || !(d.dates || []).length) { box.hidden = true; return; }
    box.hidden = false;

    box.appendChild(el('button', {
      type: 'button',
      class: 'date-chip' + (S.date == null ? ' on' : ''),
      'aria-pressed': S.date == null ? 'true' : 'false',
      onclick: function () { S.date = null; renderStrip(); renderQueue(); }
    }, [
      el('b', { text: 'All' }),
      el('span', { text: d.registered + ' registered' })
    ]));

    d.dates.forEach(function (c) {
      // Uncapped is not "full" and must not be styled as a warning: a blank
      // group size means nobody finished filling the activity in, and reading it
      // as zero would make every evening look shut.
      var full = c.capacity != null && c.left <= 0;
      box.appendChild(el('button', {
        type: 'button',
        class: 'date-chip' + (S.date === c.sessionDate ? ' on' : '') + (full ? ' full' : ''),
        'aria-pressed': S.date === c.sessionDate ? 'true' : 'false',
        onclick: function () { loadRegister(c.sessionDate); }
      }, [
        el('b', { text: shortDate(c.sessionDate) }),
        el('span', { text: c.capacity == null
          ? c.taken + ' booked'
          : c.taken + ' / ' + c.capacity + (full ? ' · full' : '') })
      ]));
    });
  }

  // ⚠ `waiting` WAS MISSING, so the pill fell through to `|| r.status` and the
  // register printed the raw status. The same gap the family area had, where it
  // reached a Hebrew page as the English word "waiting" — and the tell that this
  // table had never been designed for a row that holds no seat. A test asserts
  // every status the server can send has a word here.
  var SEAT = { booked: 'Booked', attended: 'Attended', 'no-show': 'No-show',
               cancelled: 'Cancelled', waiting: 'Waiting' };

  // ⚠ THE EVENING REGISTER FOLLOWS THE QUEUE: the waiting list is its own table,
  // and the rows narrow.
  //
  // Asked for as "the drop-in dashboard should follow the course dashboard —
  // separate the waiting list and add filters", and both halves were already
  // decided one screen up. Nothing in a register row applies to somebody
  // waiting: no seat, nothing owed, no attendance to mark, and not in the room
  // the count above the table is about. Mixed in, the one row with nothing to do
  // about it sat between two that had — and was offered Present and No-show
  // against a seat it does not hold.
  //
  // The filters are the queue's, minus the two an evening cannot answer. There
  // is no GROUP select, because the strip above has already narrowed to one
  // date and a drop-in's room is the evening's; and no AGE FLAGGED box, because
  // that flag lives on the registration rather than on a booking. What is left
  // is what an admin standing in a doorway actually asks: who is this, what
  // state are they in, and have they paid.
  // ⚠ KEPT ACROSS DATES, RESET ACROSS ACTIVITIES, and the difference is what the
  // values MEAN. The queue's group filter is an id belonging to one activity, so
  // carried across the picker it matches nothing and the empty table reads as an
  // activity nobody registered for. `booked` and `owes` are true of every
  // evening, and an admin sweeping a term for who still owes wants them to
  // survive a chip press. Neither filter survives the picker.
  function newEveFilter() { return { q: '', status: '', pay: '' }; }
  var EVE_ORDER = ['booked', 'attended', 'no-show', 'cancelled'];

  function evePasses(r) {
    var f = S.eveFilter;
    if (f.q && searchable(r).indexOf(f.q) === -1) return false;
    if (f.status && f.status !== r.status) return false;
    if (f.pay && payBucket(r) !== f.pay) return false;
    return true;
  }
  // Somebody waiting holds nothing and owes nothing, so a PAYMENT filter is a
  // question this list has no answer to — it stands the list down rather than
  // guessing one, exactly as the course's waiting table does.
  function evePassesWaiting(r) {
    var f = S.eveFilter;
    if (f.pay) return false;
    if (f.status && f.status !== 'waiting') return false;
    if (f.q && searchable(r).indexOf(f.q) === -1) return false;
    return true;
  }

  function eveningBar(rows, waiting, repaint) {
    var f = S.eveFilter;
    var everyone = rows.concat(waiting);
    var controls = [];

    var byStatus = tally(rows, function (r) { return r.status; });
    if (waiting.length) byStatus.waiting = waiting.length;
    var sopts = EVE_ORDER.concat(['waiting']).filter(function (k) { return byStatus[k]; })
      .map(function (k) {
        return { v: k, t: (SEAT[k] || k) + ' (' + byStatus[k] + ')' };
      });
    controls.push(pick('Any status', f.status, sopts, function (v) { f.status = v; repaint(); }));

    var byPay = tally(rows, payBucket);
    var popts = ['owes', 'settled', 'none'].filter(function (k) { return byPay[k]; })
      .map(function (k) { return { v: k, t: PAY_LABEL[k] + ' (' + byPay[k] + ')' }; });
    controls.push(pick('Any payment', f.pay, popts, function (v) { f.pay = v; repaint(); }));

    // ⚠ BUILT ONCE AND KEPT, like the queue's: rebuilding the bar on a keystroke
    // takes the focus out of the box somebody is typing into, one character in.
    var q = null;
    if (everyone.length > 1) {
      q = el('input', { type: 'search', 'aria-label': 'Find a name or email',
        placeholder: 'Name or email',
        oninput: function (e) { f.q = String(e.currentTarget.value || '').trim().toLowerCase(); repaint(); } });
      q.value = f.q;
    }

    controls = controls.filter(Boolean);
    if (!q && !controls.length) return null;

    var count = el('span', { class: 'filter-count' });
    var clear = el('button', { type: 'button', class: 'filter-clear', text: 'Clear',
      onclick: function () { S.eveFilter = newEveFilter(); renderQueue(); } });
    var bar = el('div', { class: 'filters' }, [q].concat(controls).concat([count, clear]));
    bar._count = count;
    bar._clear = clear;
    return bar;
  }

  function renderEvening(box) {
    var d = S.register;
    var cap = d.capacity;
    var byName = function (a, b) { return String(a.name).localeCompare(String(b.name)); };
    var rows = (d.register || []).slice().sort(byName);
    // Join order, not alphabetical: a queue has one order and it is the order
    // people joined it in. The server already sorted; this keeps the copy.
    var waiting = (d.waiting || []).slice();

    // ⚠ THE ROOM, ON THIS EVENING, AND IT DOES NOT NARROW. The line counts the
    // room and every booking against it; a filtered figure inside it would be a
    // true number answering a different question, which is the pairing this
    // screen was already reported for once.
    box.appendChild(el('div', { class: 'capacity-line' }, [
      el('span', {}, [
        el('b', { class: cap && cap.over ? 'over' : '', text: String(cap ? cap.taken : 0) }),
        el('span', { text: cap && cap.capacity != null
          ? ' of ' + cap.capacity + ' places · ' + shortDate(d.sessionDate)
          : ' booked · no room size set · ' + shortDate(d.sessionDate) })
      ]),
      cap && cap.over ? el('span', { class: 'over', text: 'Over capacity' }) : null
    ]));

    if (!rows.length && !waiting.length) {
      box.appendChild(el('div', { class: 'label-row' }, [
        el('p', { class: 'hint', style: 'margin-top:0;', text: 'Nobody has booked this evening yet.' }),
        window.AdminHelp.badge('A registration holds no place on a date \u2014 a family books each '
          + 'evening they are coming, and the capacity you set governs the room on one night.')
      ]));
      return;
    }

    var rowBox = el('div', {});
    var bar = eveningBar(rows, waiting, function () { paintEvening(bar, rowBox, rows, waiting); });
    if (bar) box.appendChild(bar);
    box.appendChild(rowBox);
    paintEvening(bar, rowBox, rows, waiting);
  }

  function paintEvening(bar, box, rows, waiting) {
    box.innerHTML = '';
    var show = rows.filter(evePasses);
    var showWaiting = waiting.filter(evePassesWaiting);

    if (bar) {
      var total = rows.length + waiting.length;
      var shown = show.length + showWaiting.length;
      bar._count.textContent = shown === total
        ? total + (total === 1 ? ' booking' : ' bookings')
        : shown + ' of ' + total + ' shown';
      bar._clear.hidden = shown === total;
    }

    if (show.length) {
      var head = el('tr', {}, ['Participant', 'Status', 'Paid / owed', '']
        .map(function (h) { return el('th', { text: h }); }));
      box.appendChild(el('table', { class: 'queue' }, [
        el('thead', {}, [head]),
        el('tbody', {}, show.map(function (r) {
          return el('tr', {}, [
            el('td', { class: 'who' }, [
              el('b', { text: r.name }),
              el('span', { text: r.accountEmail || r.accountId })
            ]),
            el('td', {}, [el('span', { class: 'pill ' + r.status, text: SEAT[r.status] || r.status })]),
            el('td', {}, [moneyCell(r)]),
            el('td', {}, [markCell(r)])
          ]);
        }))
      ]));
    } else if (rows.length) {
      // ⚠ NEVER "nobody has booked this evening yet" WHILE A FILTER IS ON. It is
      // true of an empty evening and a lie about a narrowed one — the one
      // sentence this screen must not get wrong, and the rule the queue above
      // already follows.
      box.appendChild(el('p', { class: 'hint', text: 'No bookings match these filters.' }));
    }

    eveningWaiting(box, showWaiting, waiting.length);
  }

  // The queue for ONE evening. Its own table, in join order, with no controls on
  // it at all — and that is the honest state rather than an omission. A place on
  // an evening opens when somebody cancels it, and every family waiting is
  // emailed at once; there is no admin action for handing one out, so there is
  // no button here pretending otherwise. (The course's "Give a place" goes
  // through openRegistration(), which is about a TERM and has no per-evening
  // equivalent built.)
  function eveningWaiting(box, list, total) {
    if (!total) return;
    box.appendChild(el('div', { class: 'label-row', style: 'margin-top:26px;' }, [
      el('h3', { class: 'field-label', style: 'margin:0;',
                 text: total + ' waiting for this evening' }),
      window.AdminHelp.badge('Families who asked for a seat on this evening when it was full. '
        + 'They hold nothing and owe nothing, and they are not counted in the room above. When '
        + 'a seat opens \u2014 somebody cancels it \u2014 every one of them is emailed at once and it '
        + 'goes to whoever takes it first, which on an evening is a window of minutes rather '
        + 'than weeks.')
    ]));
    if (!list.length) {
      box.appendChild(el('p', { class: 'hint', text: 'None of them match these filters.' }));
      return;
    }
    box.appendChild(el('table', { class: 'queue' }, [
      el('thead', {}, [el('tr', {}, ['Waiting', 'Since'].map(function (h) {
        return el('th', { text: h });
      }))]),
      el('tbody', {}, list.map(function (r) {
        return el('tr', {}, [
          el('td', { class: 'who' }, [
            el('b', { text: r.name }),
            el('span', { text: r.accountEmail || r.accountId })
          ]),
          el('td', {}, [el('span', { text: shortDate((r.waitingSince || '').slice(0, 10)) })])
        ]);
      }))
    ]));
  }

  // ⚠ MARKING THE REGISTER, WHICH UNTIL NOW ONLY A QR CODE COULD DO.
  //
  // markAttendance has existed server-side since Phase 7 with nothing calling
  // it, so the QR page was the only thing that wrote attendance — and a teacher
  // with no signal in the room could not take the register at all. It writes
  // into the same att- blob through the same transition(), so the money, the
  // ledger and the family's own page see one thing; what differs is `by`, which
  // is this admin's address rather than 'self'.
  //
  // A cancelled booking is not markable: the evening was given back, and marking
  // somebody present for a place they do not hold would put them in a room they
  // are not counted in.
  // ⚠ ASKED THE OTHER WAY ROUND. This listed the one status that is not
  // markable, and a status added later inherited "markable" by saying nothing —
  // which is what happened to `waiting`: the evening register offered Present
  // and No-show against a seat the family does not hold, and marking them would
  // have put somebody in a room nothing counts them in. The queue leaves this
  // table now, and the rule is a list of what DOES hold a seat, so the next
  // status added is refused until somebody says otherwise.
  var MARKABLE = ['booked', 'attended', 'no-show'];
  function markCell(r) {
    if (MARKABLE.indexOf(r.status) === -1) return el('span', { class: 'why', text: '\u2014' });
    if (!S.canApprove) {
      return el('span', { class: 'why', title: 'Your role may open the register but not mark it',
                          text: '\u2014' });
    }
    // The same `.acts` idiom the queue rows use, rather than a second set of
    // row buttons with their own styling — one table, one shape for the controls
    // in it.
    return el('div', { class: 'acts' }, [
      mark(r, 'attended', 'Present'),
      mark(r, 'no-show', 'No-show')
    ]);
  }

  function mark(r, status, label) {
    return el('button', {
      type: 'button',
      class: status === 'attended' ? 'go' : '',
      // Pressing the state it is already in is a no-op rather than a round trip
      // that changes nothing and rewrites a history entry saying so.
      disabled: r.status === status || null,
      onclick: function () {
        send({ action: 'markAttendance', participantId: r.participantId,
               activityId: S.queue.activity.activityId, sessionDate: r.sessionDate,
               status: status }).then(function (res) {
          if (!res.ok) return message('err', (res.data && res.data.error) || 'That did not work');
          message('ok', label + ' \u00b7 ' + r.name);
          // The strip follows, because a no-show frees a place on that evening
          // and the chip above the table says how many are in the room.
          loadRegister(S.date);
        });
      }
    }, [document.createTextNode(label)]);
  }

  function loadRegister(date) {
    if (!S.slug) return Promise.resolve();
    return send({ action: 'register', slug: S.slug, sessionDate: date || undefined })
      .then(function (res) {
        if (!res.ok) return message('err', (res.data && res.data.error) || 'Could not open the register');
        S.register = res.data;
        S.date = res.data.sessionDate || (date === null ? null : defaultDate(res.data.dates));
        // First load asks with no date, so the default has to be fetched once it
        // is known. Asking for every date up front would be one call per evening.
        if (!res.data.sessionDate && S.date) return loadRegister(S.date);
        renderStrip();
        renderQueue();
      });
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
    box.appendChild(el('div', { class: 'label-row' }, [
      el('div', { class: 'field-label', text: 'One code per evening' }),
      window.AdminHelp.badge('Print or show the one for the date \u2014 each works only on its own ' +
        'day, and stops working when that day ends. Anyone holding it can see the names booked for ' +
        'that evening and mark any of them present; nobody can book, cancel or see money with it.')
    ]));

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
    box.appendChild(el('div', { class: 'label-row' }, [
      el('div', { class: 'field-label', text: 'Sessions bought in advance' }),
      window.AdminHelp.badge('Entries left is derived from the dates used, never stored \u2014 and a ' +
        'date we cancel that cannot be replaced is credited back at the rate that was paid, by the ' +
        'nightly pass, once the activity is over.')
    ]));

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
      // The recipient and the language are what is true of THIS message and
      // stay on screen; the rule behind the feature is an (i).
      el('div', { class: 'label-row' }, [
        el('p', { class: 'hint', style: 'margin-top:0;', text:
          'This is what ' + (draft.to || 'the family') + ' will receive, in ' +
          LANG_NAME[draft.lang] + ' \u2014 the language they read.' }),
        window.AdminHelp.badge('Send it as it is, or add a reason. ' + K.hint)
      ]),
      // What the ledger will record, on its own line rather than left to be
      // spotted inside the prose. ABSENT when there is nothing to credit:
      // "credits €0.00" reads as a decision taken against the family rather
      // than as the arithmetic of an activity nobody has paid for, and today
      // that is every cancellation on the site.
      draft.creditCents > 0
        ? el('p', { class: 'modal-credit', text: 'Credits ' + money(draft.creditCents) })
        : null,
      // ⚠ WHY THE FIGURE IS SMALLER THAN WHAT WAS PAID, on the one screen where
      // somebody is about to send it to a family. The yearly fee is charged once
      // a year for an activity, so cancelling one term does not hand it back
      // while another term of that year is still standing on it — and an admin
      // reading "credits €300.00" against a €350.00 payment, with no account of
      // the difference, is an admin who cannot answer the email that follows.
      // It is state rather than a manual, so it stays on screen.
      draft.feeHeldElsewhere
        ? el('p', { class: 'hint', style: 'margin-top:6px;', text:
            'The registration fee is not in that figure: it is charged once a year for this ' +
            'activity, and this participant is still registered for another term of it.' })
        : null,
      K.note ? el('label', { class: 'modal-label', text: 'Why (recorded internally, not sent)' }) : null,
      K.note ? note : null,
      el('label', { class: 'modal-label', text: 'Subject' }), subject,
      el('label', { class: 'modal-label', text: 'Message' }),
      window.Quill ? host : area,
      el('div', { class: 'modal-acts' }, [
        // No class: `.modal-acts button` IS the quiet treatment, and `.no` is the
        // loud one. `ghost` was a name for a variant that does not exist and that
        // admin.css has never had a rule for — a label claiming a style is worse
        // than no label, because the next reader trusts it.
        el('button', { onclick: close, text: 'Cancel' }), go
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
    // ⚠ AN EXPLANATION IS A CONTROL — see js/admin-help.js. The heading names
    // the action; what it does to the ledger is behind the (i).
    return el('div', { style: 'margin-top:16px;padding-top:14px;border-top:1px solid #f0ece1;' }, [
      el('div', { class: 'label-row' },
        [el('div', { class: 'field-label', text: title }), window.AdminHelp.badge(hint)]),
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
    // Switching activity forgets which evening was open — the dates belong to
    // the activity, so carrying one across would ask for a date the new one does
    // not meet on.
    // ⚠ AND IT FORGETS THE FILTERS, for a sharper version of the same reason.
    // A group belongs to an activity, so a group filter carried across the
    // picker matches nothing on the next one \u2014 and an empty table reads as an
    // activity nobody has registered for. The one thing this screen must never
    // say wrongly is the thing a stale filter would make it say.
    if (slug !== S.slug) {
      S.date = null; S.register = null;
      S.filter = newFilter(); S.eveFilter = newEveFilter();
    }
    if (!S.filter) S.filter = newFilter();
    if (!S.eveFilter) S.eveFilter = newEveFilter();
    S.slug = slug;
    // So a reload comes back to the activity you were on rather than to the
    // first row of the list. See js/admin-url.js for why it replaces the
    // history entry rather than adding one.
    window.AdminUrl.remember('activity', slug);
    renderPicker();
    return send({ action: 'queue', slug: slug }).then(function (res) {
      if (!res.ok) return message('err', (res.data && res.data.error) || 'Could not load the queue');
      S.queue = res.data;
      renderQueue();
      // The strip is a second call and deliberately after the first paint: the
      // registrations table is the thing that is already in hand, and a screen
      // that waits for both to draw either is a screen that looks slower than it
      // is. On a course there are no evenings and nothing is asked for.
      // `undefined` the first time, so it lands on the next evening; S.date
      // afterwards, so a refresh keeps whichever chip is open — including
      // "All", which is a real choice and not an absent one.
      if (res.data.activity.type === 'dropin') return loadRegister(S.register ? S.date : undefined);
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
      if (!S.activities.length) return renderPicker();
      // The activity named in the URL wins over the first row — but it is
      // CHECKED against the list rather than trusted. A tab left open across a
      // delete or an unpublish holds a slug the queue action would refuse, and
      // an admin who pressed reload would land on an error rather than on a
      // screen. Falling back to the first row also rewrites the stale URL.
      var want = window.AdminUrl.read('activity');
      var known = S.activities.some(function (a) { return a.slug === want; });
      loadQueue(known ? want : S.activities[0].slug);
    });
  });
})();
