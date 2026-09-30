// The term calendar: every live activity's sessions on one screen, and which of
// them collide.
//
// ⚠ IT DERIVES NOTHING. The clash rule lives in _activity-calendar.js and is
// applied on the server; this file draws what it is handed. A second copy of
// "these two overlap" in the browser is a second rule free to disagree with the
// first, and the one that disagreed would be the one an admin was reading —
// which is the trap this project has met with capacity counted two ways, with
// the payment pill derived twice, and with the tick that meant opposite things
// in two editors.
(function () {
  'use strict';

  // Same first line every admin client opens with: no session means the sign-in
  // page, before anything is drawn or asked for.
  if (!window.AdminSession.requireSession()) return;

  var API = '/api/activities-admin';
  var $ = function (id) { return document.getElementById(id); };
  var S = { sessions: [], clashes: [], counts: null };

  // The admin reads English. A title is a {he,en,ru} bag, so pick in the order
  // this screen can actually read, and fall through rather than printing an
  // empty cell for an activity that simply has no English name yet.
  function pick(bag) {
    if (bag == null) return '';
    if (typeof bag === 'string') return bag;
    return bag.en || bag.he || bag.ru || '';
  }

  function el(tag, opts) {
    var n = document.createElement(tag);
    opts = opts || {};
    if (opts.className) n.className = opts.className;
    if (opts.text != null) n.textContent = opts.text;
    return n;
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Parsed as UTC deliberately. These are plain calendar dates with no instant
  // attached, and new Date('2026-12-09') is already UTC midnight — building one
  // in local time instead would shift the weekday for anybody west of Greenwich
  // and print the wrong day name against a correct date.
  function parts(iso) {
    var d = new Date(iso + 'T00:00:00Z');
    return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay() };
  }
  function monthKey(iso) { var p = parts(iso); return p.y + '-' + p.m; }
  function monthLabel(iso) { var p = parts(iso); return MONTHS[p.m] + ' ' + p.y; }
  function dayLabel(iso) { var p = parts(iso); return DAYS[p.wd] + ' ' + p.d; }

  function todayISO() {
    var n = new Date();
    return n.getFullYear() + '-' +
      String(n.getMonth() + 1).padStart(2, '0') + '-' +
      String(n.getDate()).padStart(2, '0');
  }

  // ⚠ "No time set" is said out loud rather than left blank. A blank cell in a
  // column of times reads as a session at midnight, and it is also exactly the
  // row that can never be reported as clashing — so the one row an admin might
  // wrongly trust is the one that has to explain itself.
  function timeText(s) {
    if (!s.time) return 'no time set';
    if (!s.endsAt) return s.time + ' · length not set';
    return s.time + '–' + s.endsAt;
  }

  function sessionLine(s) {
    var what = el('span', { className: 'cal-what' });
    what.appendChild(el('b', { text: pick(s.title) || s.slug }));
    // The group's name only where there is a choice to name. A single unnamed
    // group has nothing to add and would print an empty bullet on every row.
    if (s.named && pick(s.groupName)) {
      what.appendChild(document.createTextNode(' '));
      what.appendChild(el('span', { className: 'cal-group', text: '· ' + pick(s.groupName) }));
    }
    return what;
  }

  function key(s) { return s.slug + '__' + s.groupId + '__' + s.date; }

  function renderClashes() {
    var panel = $('clash-panel');
    var mount = $('clashes');
    mount.textContent = '';
    if (!S.clashes.length) { panel.hidden = true; return; }
    panel.hidden = false;
    S.clashes.forEach(function (c) {
      var box = el('div', { className: 'cal-clash' });
      var why = c.kind === 'same-start' ? 'both start at the same time'
        : c.kind === 'overlap' ? 'overlap by ' + c.minutes + ' minutes'
          : 'cannot be ruled out — the earlier session has no length set';
      box.appendChild(el('div', {
        className: 'cal-clash-head',
        text: dayLabel(c.date) + ' ' + monthLabel(c.date) + ' · ' + why
      }));
      [c.a, c.b].forEach(function (s) {
        var row = el('div', { className: 'cal-clash-side' });
        var t = el('span', { className: 'cal-time' + (s.time ? '' : ' is-vague'), text: timeText(s) });
        row.appendChild(t);
        row.appendChild(document.createTextNode('  '));
        row.appendChild(sessionLine(s));
        box.appendChild(row);
      });
      mount.appendChild(box);
    });
  }

  function renderCalendar() {
    var mount = $('calendar');
    mount.textContent = '';
    var hidePast = $('hide-past').checked;
    var today = todayISO();

    // Which individual rows are in a clash, so a day holding three sessions of
    // which two collide marks the two rather than all three.
    var clashed = {};
    var clashedDate = {};
    S.clashes.forEach(function (c) {
      clashed[key(c.a)] = true; clashed[key(c.b)] = true; clashedDate[c.date] = true;
    });

    var shown = S.sessions.filter(function (s) { return !hidePast || s.date >= today; });
    if (!shown.length) {
      mount.appendChild(el('p', {
        className: 'cal-none',
        text: hidePast
          ? 'No sessions ahead. Untick the box above to see the ones that have passed.'
          : 'No live activity has a session calendar yet.'
      }));
      return;
    }

    var byDate = {};
    var order = [];
    shown.forEach(function (s) {
      if (!byDate[s.date]) { byDate[s.date] = []; order.push(s.date); }
      byDate[s.date].push(s);
    });

    var month = null;
    order.forEach(function (date) {
      var mk = monthKey(date);
      if (mk !== month) {
        month = mk;
        mount.appendChild(el('div', { className: 'cal-month', text: monthLabel(date) }));
      }
      var day = el('div', {
        className: 'cal-day' + (clashedDate[date] ? ' is-clash' : '') + (date < today ? ' is-past' : '')
      });
      var when = el('div', { className: 'cal-date' });
      when.appendChild(document.createTextNode(dayLabel(date)));
      when.appendChild(el('small', { text: byDate[date].length + (byDate[date].length === 1 ? ' session' : ' sessions') }));
      day.appendChild(when);

      var rows = el('div', { className: 'cal-rows' });
      byDate[date].forEach(function (s) {
        var row = el('div', { className: 'cal-row' + (clashed[key(s)] ? ' is-clash' : '') });
        row.appendChild(el('span', { className: 'cal-time' + (s.time ? '' : ' is-vague'), text: timeText(s) }));
        row.appendChild(sessionLine(s));
        if (pick(s.location)) row.appendChild(el('span', { className: 'cal-where', text: pick(s.location) }));
        rows.appendChild(row);
      });
      day.appendChild(rows);
      mount.appendChild(day);
    });
  }

  function renderCounts() {
    var c = S.counts || {};
    var bits = [
      c.activities + (c.activities === 1 ? ' live activity' : ' live activities'),
      c.sessions + (c.sessions === 1 ? ' session' : ' sessions'),
      c.dates + (c.dates === 1 ? ' date' : ' dates')
    ];
    if (c.undated) bits.push(c.undated + ' with no time set');
    $('counts').textContent = bits.join(' · ');
  }

  function draw() { renderCounts(); renderClashes(); renderCalendar(); }

  function load() {
    return window.AdminSession.post(API, { action: 'calendar' }).then(function (res) {
      $('app').hidden = false;
      if (!res.ok) {
        $('tool').hidden = true;
        $('no-access').hidden = false;
        $('no-access').textContent = (res.data && res.data.error) || 'No access';
        return;
      }
      S.sessions = res.data.sessions || [];
      S.clashes = res.data.clashes || [];
      S.counts = res.data.counts || null;
      var s = window.AdminSession.get();
      $('who').textContent = s ? s.name + ' · ' + s.roleName : '';
      if (window.AdminHelp) window.AdminHelp.wire();
      draw();
    });
  }

  // Only the calendar is redrawn, never the whole screen: the checkbox lives in
  // the block being rebuilt, and a redraw that replaced it would take the focus
  // out from under the click that moved it.
  $('hide-past').addEventListener('change', renderCalendar);
  $('logout').addEventListener('click', window.AdminSession.logout);

  load();
})();
