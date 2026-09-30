// /calendar — upgrades the generated month list into a month grid.
//
// ⚠ IT IS AN ENHANCEMENT, NOT THE PAGE. The server renders every session as a
// real, indexable list; this replaces it with a grid and month navigation. If
// anything here fails — no JSON block, bad JSON, no template support — the list
// is left exactly as it was, which is the page the site would have had anyway.
// Same fail-open rule the hamburger's Activities group follows, and the reason
// it is safe for the one page a family checks to see whether there is a class
// tonight.
//
// ⚠ AND THE BROWSER IS WHAT KNOWS THE DATE. The page is a build artifact and
// asks no clock, so "which month opens" cannot be baked in — it is decided here,
// where `new Date()` is honest.
(function () {
  'use strict';

  var host = document.getElementById('cal-static');
  var blob = document.getElementById('calendar-data');
  if (!host || !blob) return;

  var data;
  try { data = JSON.parse(blob.textContent || blob.innerHTML || 'null'); }
  catch (e) { return; }
  if (!data || !data.sessions || !data.sessions.length) return;

  var MONTHS = data.months || [];
  var DAYS = data.days || [];
  var T = data.labels || {};
  if (MONTHS.length !== 12 || DAYS.length !== 7) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // UTC throughout, because these are plain calendar dates with no instant on
  // them. Building them in local time moves the month for anybody west of
  // Greenwich and files a session under the wrong heading.
  function ymd(iso) {
    return { y: +iso.slice(0, 4), m: +iso.slice(5, 7) - 1, d: +iso.slice(8, 10) };
  }
  function keyOf(y, m) { return y + '-' + String(m + 1).padStart(2, '0'); }
  function iso(y, m, d) {
    return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  var byDate = {};
  data.sessions.forEach(function (s) { (byDate[s.date] = byDate[s.date] || []).push(s); });
  var monthKeys = Object.keys(data.sessions.reduce(function (m, s) {
    m[s.date.slice(0, 7)] = 1; return m;
  }, {})).sort();

  var now = new Date();
  var cur = { y: now.getFullYear(), m: now.getMonth() };

  // Open on this month when it has something, otherwise on the next month that
  // does — and on the last one when the whole programme is behind us. A grid
  // that opens empty reads as a page that failed to load.
  (function openOn() {
    var k = keyOf(cur.y, cur.m);
    if (monthKeys.indexOf(k) !== -1) return;
    var ahead = monthKeys.filter(function (x) { return x >= k; });
    var pick = ahead.length ? ahead[0] : monthKeys[monthKeys.length - 1];
    cur = { y: +pick.slice(0, 4), m: +pick.slice(5, 7) - 1 };
  })();

  var root = el('div', 'cal-grid-wrap');
  var bar = el('div', 'cal-nav');
  var prev = el('button', 'cal-step', T.prev || '‹');
  var title = el('h2', 'cal-title');
  var next = el('button', 'cal-step', T.next || '›');
  prev.type = 'button'; next.type = 'button';
  // The words rather than chevrons on purpose: a caret is directional, and this
  // page renders in three languages, two of them left-to-right and one right-to-
  // left. Words need no mirroring and no per-language override — rule 2, and the
  // trap the hamburger's own chevron fell into.
  bar.appendChild(prev); bar.appendChild(title); bar.appendChild(next);

  var grid = el('div', 'cal-grid');
  var dayPanel = el('div', 'cal-detail');

  function sessionsOn(date) { return byDate[date] || []; }

  function drawDay(date) {
    dayPanel.textContent = '';
    var rows = sessionsOn(date);
    if (!rows.length) return;
    var p = ymd(date);
    dayPanel.appendChild(el('h3', 'cal-detail-head',
      p.d + ' ' + MONTHS[p.m] + ' ' + p.y));
    var ul = el('ul', 'cal-detail-list');
    rows.forEach(function (s) {
      var li = document.createElement('li');
      li.appendChild(el('span', 'cal-at', s.time + (s.endsAt ? '–' + s.endsAt : '')));
      var a = el('a', null, s.title);
      a.href = s.href;
      li.appendChild(a);
      if (s.where) li.appendChild(el('span', 'cal-where', s.where));
      if (s.price) li.appendChild(el('span', 'cal-cost', s.price));
      ul.appendChild(li);
    });
    dayPanel.appendChild(ul);
  }

  var chosen = null;
  var cells = [];   // every drawn day cell, with the date it stands for

  function draw() {
    title.textContent = MONTHS[cur.m] + ' ' + cur.y;
    grid.textContent = '';
    cells = [];
    DAYS.forEach(function (d) { grid.appendChild(el('span', 'cal-dow', d)); });

    var first = new Date(Date.UTC(cur.y, cur.m, 1)).getUTCDay();
    var days = new Date(Date.UTC(cur.y, cur.m + 1, 0)).getUTCDate();
    for (var i = 0; i < first; i++) grid.appendChild(el('span', 'cal-pad'));

    var firstWithSessions = null;
    for (var d = 1; d <= days; d++) {
      var date = iso(cur.y, cur.m, d);
      var rows = sessionsOn(date);
      var cell = el('button', 'cal-cell' + (rows.length ? ' has-sessions' : ''));
      cell.type = 'button';
      cell.appendChild(el('span', 'cal-n', String(d)));
      if (rows.length) {
        if (!firstWithSessions) firstWithSessions = date;
        var dots = el('span', 'cal-dots');
        rows.slice(0, 4).forEach(function () { dots.appendChild(el('span', 'cal-dot')); });
        cell.appendChild(dots);
        cell.setAttribute('aria-label', d + ' ' + MONTHS[cur.m] + ' · ' +
          rows.length + ' ' + (T.sessions || ''));
        (function (dt) {
          cell.addEventListener('click', function () { chosen = dt; paintChosen(); drawDay(dt); });
        })(date);
      } else {
        cell.disabled = true;
      }
      cells.push({ node: cell, date: date });
      grid.appendChild(cell);
    }

    // Land on a day that has something rather than an empty panel.
    if (!chosen || chosen.slice(0, 7) !== keyOf(cur.y, cur.m)) chosen = firstWithSessions;
    paintChosen();
    if (chosen) drawDay(chosen); else dayPanel.textContent = '';
  }

  // ⚠ The cells are tracked as they are built, each carrying the date it stands
  // for, rather than re-queried and matched on their printed number. Matching on
  // the number is the sort of thing that works until a cell prints something
  // else, and re-querying needs a selector engine this page has no other reason
  // to depend on.
  function paintChosen() {
    cells.forEach(function (c) {
      if (chosen && c.date === chosen) c.node.classList.add('is-on');
      else c.node.classList.remove('is-on');
    });
  }

  function step(by) {
    var m = cur.m + by, y = cur.y;
    if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
    cur = { y: y, m: m };
    chosen = null;
    draw();
  }
  prev.addEventListener('click', function () { step(-1); });
  next.addEventListener('click', function () { step(1); });

  root.appendChild(bar);
  root.appendChild(grid);
  root.appendChild(dayPanel);

  // ⚠ DRAWN BEFORE THE STATIC LIST IS TOUCHED, and that ordering is the whole
  // fail-open promise rather than a detail. The first version built the grid,
  // replaced the list and never called draw() at all — so the page rendered an
  // empty month with a blank heading and the real content already destroyed.
  // Nothing errored; it was found by executing the client rather than reading
  // it. Drawing first also means a throw anywhere above leaves the served list
  // exactly as it was, which is what this file claims at the top.
  draw();
  host.textContent = '';
  host.appendChild(root);
})();
