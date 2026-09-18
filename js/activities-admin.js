// The Activities editor.
//
// The form is a projection of the server's field schema (returned by `auth`),
// so adding a field is a one-line change on the server rather than an edit in
// two places that drift.
//
// Every list mutation goes through js/repeatable-items.js, which reads the form
// into the model before redrawing. Nothing here may rebuild a list's DOM
// without going through it.
//
// Client-side permission checks below are cosmetic. The server re-checks all
// of them; this only greys things out.

(function () {
  if (!window.AdminSession.requireSession()) return;

  var API = '/api/activities-admin';
  var LANG_NAME = { he: 'Hebrew', en: 'English', ru: 'Russian' };

  // What an admin READS for each status. The keys are the status values and
  // never change — `announcement` is still `announcement` in the record, on the
  // article and in every CSS class; only the wording here moved to "Coming
  // soon", matching the badge visitors see and the homepage's own vocabulary.
  //
  // Two forms because they sit in different room: `label` is the dropdown,
  // which can afford to explain itself, and `pill` is the 10px badge in the
  // activity picker, which CSS uppercases. The picker used to print the raw key
  // instead, so it was the one admin surface the label change would have
  // missed.
  var STATUS_LABELS = {
    draft:        { label: 'Draft (not published)', pill: 'Draft' },
    announcement: { label: 'Coming soon',           pill: 'Coming soon' },
    open:         { label: 'Open for registration', pill: 'Open' },
    waitlist:     { label: 'Waitlist',              pill: 'Waitlist' },
    closed:       { label: 'Registration closed',   pill: 'Closed' },
    cancelled:    { label: 'Cancelled',             pill: 'Cancelled' },
    completed:    { label: 'Completed',             pill: 'Completed' }
  };
  var STATUS_SELECT = {};
  Object.keys(STATUS_LABELS).forEach(function (k) { STATUS_SELECT[k] = STATUS_LABELS[k].label; });
  var statusPill = function (status) {
    return (STATUS_LABELS[status] && STATUS_LABELS[status].pill) || status;
  };
  var S = {
    schema: null,
    editLangs: [],
    canPublish: false,
    slug: null,
    record: null,
    baseUpdatedAt: null,
    lists: {},
    images: {},        // per-item pending uploads, keyed by ITEM ID (never index)
    cardImage: undefined,  // pending square upload: undefined = untouched, null = removed
    shareImage: undefined, // pending 1200x630 upload, same three states
    // Committed path -> the bytes we already hold for it. See adoptDeployed().
    freshBytes: {},
    freshTimer: null,
    editors: {},        // field id -> Quill instance, for the rich fields
    pendingEditors: [], // built during a render, mounted once they are in the DOM
    previewLang: 'he',
    scheduleSessions: [],
    dirty: false
  };

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k === 'class') node.className = attrs[k];
      else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }
  var langObj = function (v) {
    v = v || {};
    return { he: v.he || '', en: v.en || '', ru: v.en === undefined && typeof v === 'string' ? '' : (v.ru || '') };
  };
  var canEdit = function (lang) { return S.editLangs.indexOf(lang) !== -1; };

  // ---------- messages ----------
  function message(kind, html) {
    var box = $('messages');
    box.innerHTML = '';
    if (html) box.appendChild(el('div', { class: 'msg ' + kind, html: html }));
  }
  function clearConflict() { $('conflict-box').innerHTML = ''; }

  // ---------- field rendering ----------
  // One row per field, three columns side by side. Translating is a comparison
  // task; tabs would hide two thirds of it.
  function fieldRow(descriptor, values, idPrefix) {
    var cells = S.schema.langs.map(function (lang) {
      var id = idPrefix + '-' + lang;
      var editable = canEdit(lang);
      var input = descriptor.textarea
        ? el('textarea', { id: id, dir: lang === 'he' ? 'rtl' : 'ltr', disabled: !editable || null })
        : el('input', { type: 'text', id: id, dir: lang === 'he' ? 'rtl' : 'ltr', disabled: !editable || null });
      input.value = (values && values[lang]) || '';
      input.addEventListener('input', function () { S.dirty = true; });
      return el('div', { class: 'lang-cell ' + lang, dir: lang === 'he' ? 'rtl' : 'ltr' }, [
        el('label', { for: id, text: LANG_NAME[lang] + (editable ? '' : ' (read-only for your role)') }),
        input
      ]);
    });
    return el('div', { class: 'field-row' }, [
      el('div', { class: 'field-label', text: descriptor.label + (descriptor.required ? ' *' : '') }),
      descriptor.hint ? el('div', { class: 'hint', text: descriptor.hint }) : null,
      el('div', { class: 'lang-grid' }, cells)
    ]);
  }

  // ---------- rich text ------------------------------------------------------
  // Body copy is written in Quill — the same editor and version the Shirat HaYam
  // admin uses — and the three languages are STACKED rather than side by side.
  // The short fields are a comparison task and belong in columns; a paragraph of
  // prose in a third of the width is not.
  //
  // The stored value is HTML. The page prints it as markup, which is safe only
  // because the server sanitises it to a fixed tag allowlist on every save.
  var RICH_TOOLBAR = [
    ['bold', 'italic', 'underline'],
    [{ header: 2 }],
    [{ list: 'bullet' }, { list: 'ordered' }],
    ['link'],
    ['clean']
  ];
  var PLACEHOLDER = { he: 'כתבו כאן…', en: 'Write here…', ru: 'Напишите здесь…' };
  var RICH_START = /^\s*<(?:p|h[1-6]|ul|ol|li|blockquote|strong|em|u|s|b|i|a|br)[\s>/]/i;

  // Records written before the editor existed hold plain text with blank lines
  // between paragraphs. Nothing was migrated — they are converted on the way IN
  // to the editor, and only become HTML if someone actually edits and saves.
  function toEditorHtml(value) {
    var text = String(value || '').trim();
    if (!text) return '';
    if (RICH_START.test(text)) return text;
    return text.split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean)
      .map(function (p) {
        return '<p>' + p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>') + '</p>';
      }).join('');
  }

  // Quill writes '<p><br></p>' for an empty editor. Storing that would publish
  // an empty paragraph instead of nothing at all.
  function editorHtml(q) {
    if (!q) return '';
    var html = q.root.innerHTML;
    return (html === '<p><br></p>' || html === '<p><br/></p>') ? '' : html;
  }

  function richRow(descriptor, values, idPrefix) {
    var blocks = S.schema.langs.map(function (lang) {
      var id = idPrefix + '-' + lang;
      var editable = canEdit(lang);
      var host = el('div', {});
      S.pendingEditors.push({
        id: id, host: host, lang: lang, editable: editable,
        html: toEditorHtml((values && values[lang]) || '')
      });
      return el('div', { class: 'rich-lang ' + lang }, [
        el('label', { text: LANG_NAME[lang] + (editable ? '' : ' (read-only for your role)') }),
        el('div', { class: 'quill-wrap' + (editable ? '' : ' lang-locked') }, [host])
      ]);
    });
    return el('div', { class: 'field-row' }, [
      el('div', { class: 'field-label', text: descriptor.label + (descriptor.required ? ' *' : '') }),
      descriptor.hint ? el('div', { class: 'hint', text: descriptor.hint }) : null,
      el('div', { class: 'rich-stack' }, blocks)
    ]);
  }

  // A rich field where Quill is unavailable stays a plain textarea, so a CDN
  // that fails to load costs formatting rather than the ability to edit at all.
  function contentRow(descriptor, values, idPrefix) {
    return (descriptor.rich && window.Quill)
      ? richRow(descriptor, values, idPrefix)
      : fieldRow(descriptor, values, idPrefix);
  }

  // Quill has to attach to a node that is already in the document, so the
  // editors are collected while the form is built and mounted after it lands.
  function mountEditors() {
    var waiting = S.pendingEditors;
    S.pendingEditors = [];
    waiting.forEach(function (spec) {
      var q = new window.Quill(spec.host, {
        theme: 'snow',
        readOnly: !spec.editable,
        placeholder: PLACEHOLDER[spec.lang] || '',
        modules: { toolbar: RICH_TOOLBAR }
      });
      q.root.setAttribute('dir', spec.lang === 'he' ? 'rtl' : 'ltr');
      q.root.style.textAlign = spec.lang === 'he' ? 'right' : 'left';
      if (spec.html) q.root.innerHTML = spec.html;
      q.on('text-change', function () { S.dirty = true; });
      S.editors[spec.id] = q;
    });
  }

  function readLangField(idPrefix) {
    var out = {};
    S.schema.langs.forEach(function (lang) {
      var id = idPrefix + '-' + lang;
      // A rich field lives in Quill, not in an input with that id.
      if (S.editors[id]) { out[lang] = editorHtml(S.editors[id]); return; }
      var node = $(id);
      out[lang] = node ? node.value : '';
    });
    return out;
  }

  // ---------- settings ----------
  function renderSettings() {
    var box = $('settings');
    box.innerHTML = '';
    var rec = S.record;
    var isNew = !S.slug;

    function select(id, label, options, value, labels) {
      var sel = el('select', { id: id });
      options.forEach(function (o) {
        sel.appendChild(el('option', { value: o, text: (labels && labels[o]) || o, selected: o === value || null }));
      });
      sel.addEventListener('change', function () { S.dirty = true; });
      return el('div', {}, [el('label', { for: id, text: label }), sel]);
    }

    var slugInput = el('input', { type: 'text', id: 'f-slug', value: rec.slug || '', disabled: !isNew || null });
    box.appendChild(el('div', {}, [
      el('label', { for: 'f-slug', text: 'Slug (URL)' }), slugInput,
      el('div', { class: 'hint', text: isNew ? 'lower-case-words-with-hyphens' : 'Fixed once published' })
    ]));

    // What KIND of activity. It decides which price field is drawn, which
    // registration settings appear, and nothing else — the page, the listing and
    // the share card never ask.
    //
    // Changing it REDRAWS three panels, and the form is read into the model
    // first: a redraw that has not captured what the admin just typed eats it,
    // which is the same rule the repeatable lists learned the hard way.
    var typeSel = select('f-type', 'Kind of activity', S.schema.types || ['course'],
      rec.type || 'course', { course: 'Course (paid per term)', dropin: 'Drop-in (paid per session)' });
    typeSel.querySelector('select').addEventListener('change', function (e) {
      var read = readFacts();
      S.record.facts = read.facts;
      S.record.factVisibility = read.factVisibility;
      S.record.registration = readRegistration();
      S.record.type = e.target.value;
      S.dirty = true;
      renderFacts();
      renderRegistration();
    });
    box.appendChild(typeSel);
    box.appendChild(select('f-status', 'Status', S.schema.statuses, rec.status || 'draft', STATUS_SELECT));
    box.appendChild(select('f-motif', 'Header motif', S.schema.motifs, rec.motif || 'ring'));
    box.appendChild(select('f-corner', 'Motif corner', S.schema.corners, rec.corner || 'tl', {
      tl: 'Top / start', tr: 'Top / end', bl: 'Bottom / start', br: 'Bottom / end'
    }));

    box.appendChild(seriesPicker(rec));
  }

  // ---------- which activity this is a term of ----------
  //
  // One slug is one semester, so the spring term of a course is a second record
  // with its own dates, its own calendar and its own page. Everything the site
  // publishes wants that. One thing does not: the registration fee is charged
  // once a year per participant PER ACTIVITY, so the two records have to be able
  // to say they are the same activity, or a child returning in the spring is
  // charged it twice.
  //
  // The default is "its own activity", which is what every existing record
  // already means, so nothing changes until an admin says otherwise.
  //
  // The VALUE of each option is the candidate's seriesId, not its activityId.
  // Choosing a term that already belongs to a series joins that series rather
  // than starting a third one — otherwise a third term pointed at the second
  // would produce two series for one course and the waiver would match neither.
  function seriesPicker(rec) {
    var own = rec.activityId || null;
    var sel = el('select', { id: 'f-series', disabled: !S.schema.langs.every(canEdit) || null });
    sel.appendChild(el('option', {
      value: '', text: 'Its own activity (default)',
      selected: !rec.seriesId || rec.seriesId === own || null
    }));
    (S.activities || []).forEach(function (a) {
      // Not itself, and not a record with no id yet — an unsaved activity has
      // nothing to point at.
      if (!a.activityId || a.activityId === own) return;
      var title = (a.title && (a.title.he || a.title.en || a.title.ru)) || a.slug;
      var series = a.seriesId || a.activityId;
      sel.appendChild(el('option', {
        value: series, text: 'Another term of: ' + title,
        selected: rec.seriesId && rec.seriesId === series || null
      }));
    });
    sel.addEventListener('change', function () { S.dirty = true; });
    return el('div', {}, [
      el('label', { for: 'f-series', text: 'Part of' }), sel,
      el('div', { class: 'hint', text: 'Link an autumn and a spring term of the same course. It changes nothing on the page — it is what stops a returning child being charged the yearly registration fee twice.' })
    ]);
  }


  // ---------- the Registration panel -----------------------------------------
  //
  // Drawn from S.schema.registration, which is the SAME list the server merges
  // by. One list: the form and the merge have to agree about which fields a type
  // draws, and two copies of that is one copy falling out of step in a way that
  // silently clears a value nobody touched.
  //
  // Nothing here is per-language. These are structure, like the robots flag —
  // one answer for all three — so a restricted role sees them disabled rather
  // than translated three times.
  function currentType() {
    var node = $('f-type');
    return (node && node.value) || S.record.type || 'course';
  }
  function drawsField(d, type) {
    return !d.types || d.types.indexOf(type) !== -1;
  }
  function regId(key) { return 'reg-' + String(key).replace(/\./g, '-'); }
  function regGet(reg, key) {
    return String(key).split('.').reduce(function (o, k) {
      return o == null ? undefined : o[k];
    }, reg || {});
  }
  function regSet(obj, key, value) {
    var parts = String(key).split('.');
    var node = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (!node[parts[i]] || typeof node[parts[i]] !== 'object') node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = value;
  }

  // A cutoff is one field with three states: a date, "none", or never set. The
  // checkbox writes "none" — so a switched-off cutoff is a VALUE and the server
  // does not refill it on the next save, which is the whole reason the field is
  // shaped this way rather than as a date beside a disabled flag.
  function cutoffField(d, value) {
    var offValue = S.schema.cutoffOff || 'none';
    var isOff = value === offValue;
    var date = el('input', { type: 'date', id: regId(d.key), disabled: isOff || null });
    date.value = isOff ? '' : (value || '');
    date.addEventListener('input', function () { S.dirty = true; });

    var box = el('input', { type: 'checkbox', id: regId(d.key) + '-off' });
    box.checked = isOff;
    box.addEventListener('change', function () {
      date.disabled = box.checked;
      S.dirty = true;
    });
    return el('div', {}, [
      el('label', { for: regId(d.key), text: d.label }),
      date,
      el('label', { for: regId(d.key) + '-off', class: 'check-row' },
        [box, el('span', { text: 'No cutoff — always creditable' })]),
      d.hint ? el('div', { class: 'hint', text: d.hint }) : null
    ]);
  }

  function regField(d, reg) {
    var value = regGet(reg, d.key);
    if (d.kind === 'cutoff') return cutoffField(d, value);
    if (d.kind === 'check') {
      var cb = el('input', { type: 'checkbox', id: regId(d.key) });
      cb.checked = value === true;
      cb.addEventListener('change', function () { S.dirty = true; });
      return el('div', {}, [
        el('label', { for: regId(d.key), class: 'check-row' }, [cb, el('span', { text: d.label })]),
        d.hint ? el('div', { class: 'hint', text: d.hint }) : null
      ]);
    }
    if (d.kind === 'mode') {
      var sel = el('select', { id: regId(d.key) });
      (S.schema.cancellationModes || []).forEach(function (m) {
        sel.appendChild(el('option', { value: m, selected: m === value || null,
          text: m === 'flat' ? 'Flat — a fixed share' : 'Prorated — by sessions remaining' }));
      });
      sel.addEventListener('change', function () { S.dirty = true; });
      return el('div', {}, [el('label', { for: regId(d.key), text: d.label }), sel,
        d.hint ? el('div', { class: 'hint', text: d.hint }) : null]);
    }
    // 'days' — a number and a unit. The label ends in "after" and the unit
    // follows the box, which is what keeps it from being read as the fee
    // cutoff: pendingExpiryDays counts from each family's own submission, the
    // fee cutoff is one date shared by everyone.
    var input = el('input', { type: 'number', min: '1', step: '1', id: regId(d.key),
                              placeholder: d.key === 'pendingExpiryDays'
                                ? String(S.schema.defaultExpiryDays || 45) : '' });
    input.value = value == null ? '' : value;
    input.addEventListener('input', function () { S.dirty = true; });
    return el('div', {}, [
      el('label', { for: regId(d.key), text: d.label + (d.unit ? ' … ' + d.unit : '') }),
      input,
      d.hint ? el('div', { class: 'hint', text: d.hint }) : null
    ]);
  }

  function renderRegistration() {
    var box = $('registration-fields');
    if (!box || !S.schema.registration) return;
    box.innerHTML = '';
    var type = currentType();
    var reg = S.record.registration || {};
    var grid = el('div', { class: 'fact-grid' });
    S.schema.registration.forEach(function (d) {
      if (drawsField(d, type)) grid.appendChild(regField(d, reg));
    });
    box.appendChild(grid);

    // Detect it, offer it, never apply it. An activity postponed by a month
    // keeps two cutoff dates computed from where it used to be, and both are
    // then wrong in the direction that costs families money — but a formula
    // that quietly re-evaluates would rewrite terms after they were agreed.
    var basis = reg.defaultBasis;
    if (basis && type === 'course') {
      var nowStart = ((S.record.facts || {}).duration || {}).startDate || '';
      var nowCount = scheduledCount();
      if (String(basis.startDate || '') !== String(nowStart) ||
          Number(basis.sessionCount || 0) !== Number(nowCount)) {
        var btn = el('button', { type: 'button', class: 'add-btn',
          text: 'Recompute both dates from the current schedule' });
        btn.addEventListener('click', function () {
          var d = ((S.record.facts || {}).duration || {});
          regSetInput('registrationFeeCutoffDate', minusDaysLocal(d.startDate, 14));
          regSetInput('cancellationPolicy.cancellationCutoffDate', thirtyPercentLocal());
          S.dirty = true;
          message('ok', 'Both dates recomputed. Nothing is saved until you save.');
        });
        box.appendChild(el('div', { class: 'legacy-note' }, [
          el('b', { text: 'The dates these were computed from have changed' }),
          el('div', { text: 'Computed from a start of ' + (basis.startDate || '—') + ' and ' +
                            basis.sessionCount + ' sessions. It is now ' + (nowStart || '—') +
                            ' and ' + nowCount + '.' }),
          el('div', { class: 'hint', text: 'Nothing has changed on its own. Recomputing is a decision, ' +
                      'because a family who has already registered keeps the terms they were given.' }),
          btn
        ]));
      }
    }
  }

  function regSetInput(key, value) {
    var node = $(regId(key));
    if (node && value) { node.value = value; node.disabled = false; }
    var off = $(regId(key) + '-off');
    if (off && value) off.checked = false;
  }
  function scheduledCount() {
    return ((((S.record.facts || {}).duration || {}).sessionDates) || [])
      .filter(function (r) { return r && r.date && r.status !== 'excluded'; }).length;
  }
  // Local copies of two date sums, for the recompute BUTTON only. The stored
  // values still come from the server on save; this is what the admin sees
  // before deciding, so it has to answer without a round trip.
  function minusDaysLocal(iso, days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return '';
    var t = Date.parse(iso + 'T00:00:00Z') - days * 86400000;
    return new Date(t).toISOString().slice(0, 10);
  }
  function thirtyPercentLocal() {
    var rows = ((((S.record.facts || {}).duration || {}).sessionDates) || [])
      .filter(function (r) { return r && r.date && r.status !== 'excluded'; });
    if (!rows.length) return '';
    return rows[Math.min(Math.ceil(0.3 * rows.length), rows.length) - 1].date;
  }

  // Read back ONLY what was drawn. A field this type does not draw is left out
  // of the object entirely, and the server keeps the stored value for it — so
  // switching a course to a drop-in does not clear its cutoff dates.
  function readRegistration() {
    var type = currentType();
    var out = {};
    var offValue = S.schema.cutoffOff || 'none';
    (S.schema.registration || []).forEach(function (d) {
      if (!drawsField(d, type)) return;
      var node = $(regId(d.key));
      if (d.kind === 'check') { regSet(out, d.key, !!(node && node.checked)); return; }
      if (d.kind === 'cutoff') {
        var off = $(regId(d.key) + '-off');
        regSet(out, d.key, off && off.checked ? offValue : ((node && node.value) || null));
        return;
      }
      if (d.kind === 'mode') { regSet(out, d.key, (node && node.value) || 'flat'); return; }
      regSet(out, d.key, node && node.value !== '' ? Number(node.value) : null);
    });
    return out;
  }

  // Every upload is resized and re-encoded in the browser first — see
  // js/image-optimize.js. Nobody should have to remember to shrink a photo
  // before choosing it, and the three things that went wrong when nobody did
  // (a 3.5MB request body, a function that ran out of time, a 2.6MB page) all
  // start at the moment the bytes leave this input.
  //
  // The 3MB cap is now a floor-through case rather than the usual one: it stops
  // a file too large to even decode. The server keeps its own limit regardless,
  // because a check that only runs in the browser is not a check.
  // ---------- surviving the minute between a commit and a deploy -------------
  // Publishing writes the picture to git and rewrites the record to the path it
  // will have. Netlify then takes about a minute to deploy. In between, the
  // admin reloaded the record and swapped the bytes it was showing for a path
  // that was not being served yet — so every freshly uploaded picture went to a
  // broken image icon for a minute, and the 404 it collected then sat in the
  // browser cache for another five.
  //
  // The bytes are already in hand, so they are kept and shown until the real URL
  // answers. This is display only: the record holds the path, and a save sends
  // the path, exactly as before.
  function rememberFreshBytes(saved, pending) {
    if (!saved || !pending) return;
    var keep = function (path, dataUrl) {
      if (path && dataUrl && String(dataUrl).indexOf('data:') === 0) S.freshBytes[path] = dataUrl;
    };
    keep(saved.cardImage, pending.cardImage);
    keep(saved.shareImage, pending.shareImage);
    // Teachers and sponsors, from the schema rather than by name, so a new list
    // with an image field is covered without touching this.
    (S.schema.lists || []).forEach(function (spec) {
      if (!spec.image) return;
      (saved[spec.key] || []).forEach(function (item) {
        if (item) keep(item[spec.image], pending.items[item.id]);
      });
    });
    confirmFreshBytes();
  }

  // Swap in the real file the moment it answers. Done by patching the element
  // rather than redrawing: a redraw here would discard whatever the admin has
  // typed since the publish.
  function adoptDeployed(path) {
    delete S.freshBytes[path];
    var live = document.querySelectorAll('[data-fresh-path="' + path + '"]');
    Array.prototype.forEach.call(live, function (img) {
      img.removeAttribute('data-fresh-path');
      img.src = path;
    });
  }

  function confirmFreshBytes() {
    if (S.freshTimer || !Object.keys(S.freshBytes).length) return;
    var started = Date.now();
    var tick = function () {
      S.freshTimer = null;
      var paths = Object.keys(S.freshBytes);
      if (!paths.length) return;
      // cache:'reload' so a 404 collected a moment ago cannot answer for the file.
      Promise.all(paths.map(function (path) {
        return window.fetch(path, { method: 'GET', cache: 'reload' })
          .then(function (r) { if (r.ok) adoptDeployed(path); })
          .catch(function () {});
      })).then(function () {
        // Give up after five minutes rather than polling for ever. The bytes on
        // screen stay correct either way; only the swap to the real URL is lost.
        if (Object.keys(S.freshBytes).length && Date.now() - started < 300000) {
          S.freshTimer = window.setTimeout(tick, 5000);
        }
      });
    };
    S.freshTimer = window.setTimeout(tick, 3000);
  }

  function readImage(input, slot, cb) {
    var file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) {
      message('err', 'That image is ' + (file.size / 1048576).toFixed(1) +
                     'MB, which is too big to process in the browser. Please save a smaller copy first.');
      input.value = '';
      return;
    }
    input.disabled = true;
    window.ImageOptimize.optimize(file, slot).then(function (result) {
      input.disabled = false;
      message('ok', 'Image ready: <b>' + window.ImageOptimize.describe(result) + '</b>');
      cb(result.dataUrl);
    }).catch(function (err) {
      input.disabled = false;
      input.value = '';
      message('err', 'That image could not be processed: ' + err.message);
    });
  }

  // ---------- content fields ----------
  function renderFields() {
    var rec = S.record;
    // The registry is rebuilt with the form. Keeping instances from a previous
    // render would leave readForm reading editors that are no longer on screen.
    S.editors = {};
    S.pendingEditors = [];
    $('fields').innerHTML = '';
    S.schema.simple.forEach(function (d) {
      $('fields').appendChild(contentRow(d, langObj(rec[d.key]), 'f-' + d.key));
    });
    // Its own panel at the foot of the form. Read from the schema like every
    // other group, so adding an SEO field stays a one line change on the server.
    $('seo-fields').innerHTML = '';
    (S.schema.seo || []).forEach(function (d) {
      $('seo-fields').appendChild(fieldRow(d, langObj(rec[d.key]), 'f-' + d.key));
    });
    renderCardImage();
    renderSeoOptions();
    renderShareImage();
    renderFacts();
    renderRegistration();
    // Last: Quill attaches to nodes that must already be in the document.
    mountEditors();
  }

  // ---------- search & sharing, the parts that are not words -------------
  // One instruction for the page in all three languages, so it is a single
  // control rather than the three column grid a translatable field gets.
  function renderSeoOptions() {
    var box = $('seo-options');
    if (!box) return;
    box.innerHTML = '';

    var mayEdit = S.schema.langs.every(canEdit);
    var sel = el('select', { id: 'f-robots', disabled: !mayEdit || null });
    var LABELS = {
      index: 'Indexed — normal, appears in search results',
      noindex: 'Not indexed — hidden from search and left out of sitemap.xml'
    };
    (S.schema.robotsOptions || ['index', 'noindex']).forEach(function (o) {
      sel.appendChild(el('option', {
        value: o, text: LABELS[o] || o,
        selected: o === (S.record.robots || 'index') || null
      }));
    });
    sel.addEventListener('change', function () { S.dirty = true; });

    box.appendChild(el('div', {}, [
      el('label', { for: 'f-robots', text: 'Search engines' }), sel,
      el('div', { class: 'hint', text: 'Choose "not indexed" for a page that is live but should not be found in search — a private group, or a draft you are sharing by link.' })
    ]));
  }

  // ---------- card image ----------
  // One picture per activity, not per language, so it is drawn once rather than
  // in the three column grid every translatable field uses.
  //
  // S.cardImage holds a pending upload the same way S.images holds pending
  // list-item uploads: the data URL never goes into S.record, because the record
  // is what the server merges against and a data URL is not a path. collect()
  // puts it on the outgoing copy at save time.
  // The card and the share card are the same control with a different frame and
  // a different crop, so the widget is written once. Each caller keeps its own
  // slot name at its own call site, because that string is what decides the
  // ratio an upload is cropped to and it should be readable where it is chosen.
  function imageSlotRow(cfg) {
    var box = $(cfg.boxId);
    if (!box) return;
    box.innerHTML = '';

    // A picture shown in every language is structure, not words. The server
    // enforces this; disabling the input here just avoids offering an action
    // that would be discarded.
    var mayEdit = S.schema.langs.every(canEdit);
    var stored = cfg.stored || '';
    // Bytes we still hold for a path that was committed but may not be deployed
    // yet — see rememberFreshBytes().
    var fresh = !cfg.pending && stored ? S.freshBytes[stored] : null;
    var current = cfg.pending || fresh || stored;

    var frame = el('div', { class: cfg.frameClass });
    if (current) {
      var img = el('img', { src: current, alt: cfg.alt });
      if (fresh) img.setAttribute('data-fresh-path', stored);
      frame.appendChild(img);
    } else {
      frame.appendChild(el('span', { class: 'card-image-empty', text: 'No image' }));
    }

    var input = el('input', {
      type: 'file', id: cfg.inputId, accept: 'image/*', disabled: !mayEdit || null
    });
    input.addEventListener('change', function () { cfg.onPick(input); });

    var controls = el('div', { class: 'card-image-controls' }, [
      el('label', { for: cfg.inputId, text: current ? 'Replace image' : 'Choose an image' }),
      input,
      current && mayEdit
        ? el('button', { type: 'button', class: 'link-btn', text: 'Remove', onclick: cfg.onRemove })
        : null,
      !mayEdit ? el('div', { class: 'hint', text: cfg.readOnly }) : null
    ]);

    box.appendChild(el('div', { class: 'card-image-row' }, [frame, controls]));
  }

  function renderCardImage() {
    imageSlotRow({
      boxId: 'card-image', frameClass: 'card-image-frame', inputId: 'f-cardImage',
      alt: 'Card image preview',
      readOnly: 'Read-only for your role: the card image is shown in every language.',
      pending: S.cardImage, stored: S.record.cardImage || '',
      onPick: function (input) {
        readImage(input, 'card', function (dataUrl) {
          S.cardImage = dataUrl;
          S.dirty = true;
          renderCardImage();
        });
      },
      onRemove: function () {
        // null, not undefined: the server reads `incoming.cardImage !==
        // undefined` to tell "cleared" from "not sent by a role that may not
        // touch it", and publish then deletes the orphaned file.
        S.cardImage = null;
        S.record.cardImage = null;
        S.dirty = true;
        renderCardImage();
      }
    });
  }

  function renderShareImage() {
    imageSlotRow({
      boxId: 'share-image', frameClass: 'share-image-frame', inputId: 'f-shareImage',
      alt: 'Share image preview',
      readOnly: 'Read-only for your role: the share image is shown in every language.',
      pending: S.shareImage, stored: S.record.shareImage || '',
      onPick: function (input) {
        readImage(input, 'share', function (dataUrl) {
          S.shareImage = dataUrl;
          S.dirty = true;
          renderShareImage();
        });
      },
      onRemove: function () {
        S.shareImage = null;
        S.record.shareImage = null;
        S.dirty = true;
        renderShareImage();
      }
    });
  }

  // ---------- sidebar facts ----------
  // These were three free-text boxes per fact. Typing "שתי קבוצות של 7 תלמידים"
  // meant every activity phrased the same fact differently, the translations
  // drifted, and nothing could be computed from any of it. They are numbers and
  // dates now, and the server builds the sentence per language.

  var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function numField(id, label, value, extra) {
    var input = el('input', Object.assign({ type: 'number', id: id, min: '0' }, extra || {}));
    input.value = (value === 0 || value) ? value : '';
    input.addEventListener('input', function () {
      S.dirty = true; refreshPerHour(); refreshLegacyNotes();
    });
    return el('div', {}, [el('label', { for: id, text: label }), input]);
  }

  function checkField(id, label, value, hint) {
    var input = el('input', { type: 'checkbox', id: id });
    input.checked = value === true;
    input.addEventListener('change', function () { S.dirty = true; refreshPerHour(); });
    var row = el('label', { for: id, class: 'check-row' }, [input, el('span', { text: label })]);
    return el('div', {}, hint ? [row, el('div', { class: 'hint', text: hint })] : [row]);
  }

  function readBool(id) { var n = $(id); return !!(n && n.checked); }

  function dateField(id, label, value) {
    var input = el('input', { type: 'date', id: id });
    input.value = value || '';
    input.addEventListener('input', function () { S.dirty = true; refreshLegacyNotes(); });
    return el('div', {}, [el('label', { for: id, text: label }), input]);
  }

  function readNum(id) {
    var node = $(id);
    if (!node || node.value === '') return null;
    var n = Number(node.value);
    return isFinite(n) ? n : null;
  }

  // The visibility flag every fact carries. Public is the default and by far the
  // common case, so it is the UNCHECKED state of one checkbox rather than one of
  // two options in a dropdown: a select needs a label, a box and a hint, and it
  // was costing a 170px column on every fact to express a boolean that is almost
  // always false.
  //
  // This IS enforced. A members-only fact is omitted from the generated HTML
  // altogether, not hidden with CSS, because the file is public and anyone can
  // read its source. The hint here used to say the opposite -- "everything is
  // published for now" -- which was true when the flag was inert and became
  // wrong the day isPubliclyVisible() started acting on it. An admin reading it
  // would have believed ticking this box did nothing.
  function visibilityControl(key) {
    var current = (S.record.factVisibility || {})[key] ||
                  (S.schema.defaultVisibility || {})[key] || 'public';
    var box = el('input', { type: 'checkbox', id: 'fact-vis-' + key });
    box.checked = current === 'members';
    box.addEventListener('change', function () { S.dirty = true; });
    return el('label', {
      class: 'fact-vis',
      for: 'fact-vis-' + key,
      title: 'Members only: this fact is left out of the published page entirely.'
    }, [box, el('span', { text: 'Members only' })]);
  }

  // Words an admin typed before this fact was structured. They are still what
  // the public page shows, so they are displayed rather than quietly dropped.
  // Does this fact have enough structured data to build a sentence from?
  //
  // The box below says "currently published as free text", and that is only
  // true while this returns false — _activity-facts.js builds the sentence from
  // the structured values and falls back to legacyText ONLY when it comes out
  // empty. The thresholds here mirror that file's formatters, which is the
  // authority; a count or a length of zero is not a value it will print.
  function hasStructuredValue(kind, f) {
    var pos = function (v) { return v != null && v !== '' && Number(v) > 0; };
    var anyLang = function (v) {
      return S.schema.langs.some(function (l) { return String((v || {})[l] || '').trim(); });
    };
    if (kind === 'ages') return f.min != null || f.max != null;
    if (kind === 'schedule') return (f.sessions || []).length > 0;
    if (kind === 'duration') {
      return !!f.startDate || !!f.endDate || pos(f.sessionCount) || pos(f.sessionMinutes);
    }
    if (kind === 'groupSize') {
      return pos(f.groups) || pos(f.maxPerGroup) || anyLang(f.overrideText);
    }
    if (kind === 'price') {
      return pos(f.registrationFee) || pos(f.fullPrice) || f.perHourOverride != null;
    }
    if (kind === 'location') return anyLang(f.text);
    return false;
  }

  // Show or hide each note against what is in the form RIGHT NOW, so it goes
  // the moment the fields are filled rather than waiting for a save and reload.
  function refreshLegacyNotes() {
    if (!S.schema) return;
    var facts = readFacts().facts;
    S.schema.facts.forEach(function (d) {
      var note = $('legacy-' + d.key);
      if (note) note.hidden = hasStructuredValue(d.kind, facts[d.key] || {});
    });
  }

  function legacyNote(d, fact) {
    var legacy = fact && fact.legacyText;
    if (!legacy) return null;
    var lines = ['he', 'en', 'ru']
      .filter(function (l) { return (legacy[l] || '').trim(); })
      .map(function (l) { return LANG_NAME[l] + ': ' + legacy[l]; });
    if (!lines.length) return null;
    // Visibility is set by refreshLegacyNotes() once the form is drawn. The bug
    // this replaces was showing the box whenever a fact HAD legacy text stored,
    // which is a different question and stays true forever — hebrew4kids had
    // all four fields filled in and all four boxes still showing.
    return el('div', { class: 'legacy-note', id: 'legacy-' + d.key }, [
      el('b', { text: 'Currently published as free text' }),
      el('div', { text: lines.join('  ·  ') }),
      el('div', { class: 'hint', text: 'This is what the public page shows. It disappears as soon as the fields above have values.' })
    ]);
  }

  function scheduleRows(fact) {
    var box = el('div', { class: 'session-rows', id: 'schedule-rows' });
    var freq = ($('fact-schedule-frequency') || {}).value || fact.frequency || 'weekly';
    var spec = (S.schema.frequencies || []).filter(function (f) { return f.key === freq; })[0];
    var wanted = spec && spec.sessions;
    var sessions = S.scheduleSessions.slice();
    if (wanted) {
      while (sessions.length < wanted) sessions.push({ day: null, time: '' });
      sessions = sessions.slice(0, wanted);
    }
    if (!wanted && !sessions.length) sessions.push({ day: null, time: '' });
    S.scheduleSessions = sessions;

    sessions.forEach(function (sess, i) {
      var daySel = el('select', { id: 'fact-schedule-' + i + '-day' });
      daySel.appendChild(el('option', { value: '', text: '— day —' }));
      DAY_NAMES.forEach(function (name, d) {
        daySel.appendChild(el('option', { value: String(d), text: name, selected: sess.day === d || null }));
      });
      daySel.addEventListener('change', function () { S.dirty = true; refreshLegacyNotes(); });
      var time = el('input', { type: 'time', id: 'fact-schedule-' + i + '-time' });
      time.value = sess.time || '';
      time.addEventListener('input', function () { S.dirty = true; refreshLegacyNotes(); });

      var row = el('div', { class: 'session-row' }, [daySel, time]);
      if (!wanted) {
        row.appendChild(el('button', {
          type: 'button', class: 'del', text: 'Remove',
          onclick: function () { syncSchedule(); S.scheduleSessions.splice(i, 1); S.dirty = true; redrawSchedule(); }
        }));
      }
      box.appendChild(row);
    });

    if (!wanted) {
      box.appendChild(el('button', {
        type: 'button', class: 'add-btn', text: '+ Add another day',
        onclick: function () { syncSchedule(); S.scheduleSessions.push({ day: null, time: '' }); S.dirty = true; redrawSchedule(); }
      }));
    }
    return box;
  }

  // Same rule the repeatable lists live by: read the inputs into the model
  // BEFORE redrawing, or a redraw eats whatever was just typed.
  function syncSchedule() {
    S.scheduleSessions = S.scheduleSessions.map(function (sess, i) {
      var d = $('fact-schedule-' + i + '-day');
      var t = $('fact-schedule-' + i + '-time');
      if (!d && !t) return sess;
      return { day: d && d.value !== '' ? Number(d.value) : null, time: t ? t.value : '' };
    });
    return S.scheduleSessions;
  }

  function redrawSchedule() {
    var old = $('schedule-rows');
    if (old && old.parentNode) old.parentNode.replaceChild(scheduleRows(currentSchedule()), old);
  }

  function currentSchedule() {
    return ((S.record.facts || {}).schedule) || {};
  }

  // Price per academic hour, recomputed as you type. Same arithmetic as the
  // server, with the 45-minute basis taken FROM the server so there is one
  // source of truth for it rather than a copy that can drift.
  // What the price card will actually contain, without publishing to find out.
  // It mirrors priceRows() on the server, including what that function does NOT
  // emit: there is no total, because the yearly fee and the semester fee are
  // charged on different cycles and their sum is a number nobody is billed.
  function priceCardPreview() {
    var fee = readNum('fact-price-registrationFee');
    var full = readNum('fact-price-fullPrice');
    var parts = [];
    if (fee != null && fee > 0) parts.push('Yearly registration fee ' + fee + ' €');
    if (readBool('fact-price-showPerLesson')) {
      var per = perLessonValue();
      if (per != null) parts.push('Cost per lesson ' + per + ' €');
    }
    if (full != null && full > 0) parts.push('Cost per semester ' + full + ' €');
    return parts;
  }

  function perLessonValue() {
    var override = readNum('fact-price-perHourOverride');
    if (override != null) return override;
    var full = readNum('fact-price-fullPrice');
    var count = readNum('fact-duration-sessionCount');
    var mins = readNum('fact-duration-sessionMinutes');
    var basis = (S.schema && S.schema.academicMinutes) || 45;
    if (full == null || count == null || mins == null || full <= 0 || count <= 0 || mins <= 0) return null;
    var hours = count * mins / basis;
    return hours > 0 ? Math.round((full / hours) * 100) / 100 : null;
  }

  function refreshPerHour() {
    var note = $('perhour-note');
    if (!note) return;

    var rows = priceCardPreview();
    var card = $('price-preview');
    if (card) {
      card.textContent = rows.length
        ? 'The page will show: ' + rows.join('  ·  ')
        : 'No price is published until a registration fee or a full price is set.';
      card.className = rows.length ? 'perhour is-ok' : 'perhour is-idle';
    }

    // Per-lesson is off by default, so the per-hour working below is only worth
    // showing when the row it explains is actually going to be published.
    if (!readBool('fact-price-showPerLesson')) {
      note.className = 'perhour is-idle';
      note.textContent = 'Cost per lesson is off, so no per-lesson figure is published. Tick the box above to show it.';
      return;
    }
    var override = readNum('fact-price-perHourOverride');
    if (override != null) {
      note.className = 'perhour is-override';
      note.textContent = 'Override in use: ' + override + ' € per hour. Clear the box to go back to the calculated price.';
      return;
    }
    var full = readNum('fact-price-fullPrice');
    var count = readNum('fact-duration-sessionCount');
    var mins = readNum('fact-duration-sessionMinutes');
    var basis = (S.schema && S.schema.academicMinutes) || 45;
    if (full == null || count == null || mins == null || full <= 0 || count <= 0 || mins <= 0) {
      note.className = 'perhour is-idle';
      note.textContent = 'Calculated automatically once Duration has a session count and length, and a full price is set. ' +
                         'Nothing is shown on the page until then.';
      return;
    }
    var hours = (count * mins) / basis;
    var per = Math.round((full / hours) * 100) / 100;
    note.className = 'perhour is-auto';
    note.textContent = 'Calculated: ' + per + ' € per hour  (' + full + ' € ÷ ' + hours +
                       ' academic hours — ' + count + ' × ' + mins + ' min at ' + basis + ' min/hour)';
  }

  function factBlock(d) {
    var fact = (S.record.facts || {})[d.key] || {};
    var body;

    if (d.kind === 'text') {
      body = fieldRow({ label: 'Text', textarea: true }, langObj(fact), 'fact-' + d.key);
    } else if (d.kind === 'location') {
      // Keyed by the fact, not by the kind. There are two facts of this kind now
      // — the general location and the exact address — and a hardcoded id gave
      // them the same inputs: duplicate DOM ids, and a read-back that took the
      // first match for both, so saving would copy the location over the address.
      body = fieldRow({ label: 'Text' }, langObj(fact.text), 'fact-' + d.key);
    } else if (d.kind === 'ages') {
      body = el('div', { class: 'fact-grid' }, [
        numField('fact-ages-min', 'Youngest', fact.min),
        numField('fact-ages-max', 'Oldest', fact.max)
      ]);
    } else if (d.kind === 'schedule') {
      S.scheduleSessions = (fact.sessions || []).map(function (x) {
        return { day: x.day == null ? null : Number(x.day), time: x.time || '' };
      });
      var freqSel = el('select', { id: 'fact-schedule-frequency' });
      (S.schema.frequencies || []).forEach(function (f) {
        freqSel.appendChild(el('option', {
          value: f.key, text: f.label, selected: f.key === (fact.frequency || 'weekly') || null
        }));
      });
      freqSel.addEventListener('change', function () {
        syncSchedule(); S.dirty = true; redrawSchedule(); refreshLegacyNotes();
      });
      // Which week of the month, for a monthly activity only. 'last' is a real
      // option rather than an error state: a month with only four of that
      // weekday uses the last one instead of inventing a fifth.
      var weekCell = el('div', { id: 'week-of-month-cell' });
      var drawWeek = function () {
        weekCell.innerHTML = '';
        if (((freqSel && freqSel.value) || fact.frequency) !== 'monthly') return;
        var wsel = el('select', { id: 'fact-schedule-weekOfMonth' });
        (S.schema.weeksOfMonth || []).forEach(function (w) {
          wsel.appendChild(el('option', { value: String(w.key), text: w.label,
            selected: String(w.key) === String(fact.weekOfMonth == null ? 1 : fact.weekOfMonth) || null }));
        });
        wsel.addEventListener('change', function () { S.dirty = true; refreshLegacyNotes(); });
        weekCell.appendChild(el('label', { for: 'fact-schedule-weekOfMonth', text: 'Which week' }));
        weekCell.appendChild(wsel);
      };
      drawWeek();
      freqSel.addEventListener('change', drawWeek);
      body = el('div', {}, [
        el('div', { class: 'fact-grid' }, [
          el('div', {}, [el('label', { for: 'fact-schedule-frequency', text: 'How often' }), freqSel]),
          weekCell
        ]),
        scheduleRows(fact)
      ]);
    } else if (d.kind === 'duration') {
      body = el('div', {}, [
        el('div', { class: 'fact-grid' }, [
          dateField('fact-duration-startDate', 'Starts', fact.startDate),
          dateField('fact-duration-endDate', 'Ends', fact.endDate),
          numField('fact-duration-sessionCount', 'Number of sessions', fact.sessionCount),
          numField('fact-duration-sessionMinutes', 'Minutes per session', fact.sessionMinutes)
        ]),
        sessionCalendar(fact)
      ]);
    } else if (d.kind === 'groupSize') {
      // Three languages, through the same fieldRow the location fact uses, so
      // the override obeys the same per-language permissions: a Russian-only
      // role gets the Russian box and two read-only ones. A single input could
      // not express that, and whatever it held would have been published in all
      // three languages by whoever last typed in it.
      var override = fieldRow({
        label: 'Free-text override',
        hint: 'Leave blank to use the numbers above. Filled in, it replaces the whole line for that language.'
      }, langObj(fact.overrideText), 'fact-groupSize-overrideText');
      // fieldRow marks the form dirty but knows nothing about the legacy note,
      // which keys off whether this fact has a value yet.
      Array.prototype.forEach.call(override.querySelectorAll('input, textarea'), function (n) {
        n.addEventListener('input', refreshLegacyNotes);
      });
      body = el('div', {}, [
        el('div', { class: 'fact-grid' }, [
          numField('fact-groupSize-groups', 'Number of groups', fact.groups),
          numField('fact-groupSize-maxPerGroup', 'Max per group', fact.maxPerGroup)
        ]),
        override,
        namedGroupsEditor(fact)
      ]);
    } else if (d.kind === 'price') {
      // A course quotes the term, a drop-in quotes the session, and only one of
      // the two is drawn. The undrawn one is KEPT rather than cleared — see
      // keepUndrawnFactKeys on the server — so switching type and back does not
      // lose a price nobody touched.
      var isDropin = currentType() === 'dropin';
      body = el('div', {}, [
        el('div', { class: 'fact-grid' }, [
          numField('fact-price-registrationFee', 'Yearly registration fee (€)', fact.registrationFee),
          isDropin
            ? numField('fact-price-perSessionPrice', 'Price per session (€)', fact.perSessionPrice)
            : numField('fact-price-fullPrice', 'Full course price (€)', fact.fullPrice),
          numField('fact-price-perHourOverride', 'Per hour — manual override (€)', fact.perHourOverride)
        ]),
        checkField('fact-price-showPerLesson', 'Show cost per lesson', fact.showPerLesson === true,
                   'Off by default. The other price lines are unaffected either way.'),
        el('div', { class: 'perhour is-ok', id: 'price-preview' }),
        el('div', { class: 'perhour is-idle', id: 'perhour-note' })
      ]);
    } else {
      body = el('div', { class: 'hint', text: 'Unknown field kind "' + d.kind + '"' });
    }

    return el('div', { class: 'fact-block' }, [
      el('div', { class: 'fact-head' }, [
        el('div', { class: 'field-label', text: d.label }),
        visibilityControl(d.key)
      ]),
      d.hint ? el('div', { class: 'hint', text: d.hint }) : null,
      body,
      legacyNote(d, fact)
    ]);
  }

  // ---------- the session calendar ---------------------------------------------
  //
  // GENERATE ONCE, THEN EDIT. The dates are a real stored field, not a formula
  // re-evaluated on read: generating fills the list from the frequency and the
  // dates, and after that it is edited by hand like any other value. That is
  // what lets an admin drop a holiday and have it stay dropped.
  //
  // The enumeration happens on the SERVER, through the same module the page and
  // the credit arithmetic use. Writing it again here would be a second
  // implementation of the one list that decides both what a family reads and
  // what they are refunded, and the two would eventually disagree.
  //
  // An excluded date keeps its place in the list rather than being deleted, so
  // it can be put back, it survives a regeneration, and the reason is there for
  // whoever asks next year. None of that reaches the page: the published table
  // lists the sessions that are happening and nothing else.
  function sessionCalendar(fact) {
    S.sessionDates = (fact.sessionDates || []).map(function (r) {
      return { date: r.date, status: r.status === 'excluded' ? 'excluded' : 'scheduled',
               reason: r.reason || '' };
    });
    var box = el('div', { id: 'session-calendar', style: 'margin-top:18px;' });
    drawSessionCalendar(box);
    return box;
  }

  function drawSessionCalendar(box) {
    box.innerHTML = '';
    var rows = S.sessionDates || [];
    var live = rows.filter(function (r) { return r.status !== 'excluded'; }).length;

    box.appendChild(el('div', { class: 'field-label', text: 'Session dates' }));
    box.appendChild(el('div', { class: 'hint', text: rows.length
      ? live + ' of ' + rows.length + ' dates are going ahead. This list is what the page prints ' +
        'and what a cancellation is priced against, so the session count is taken from it rather ' +
        'than from the number typed above.'
      : 'Generate the dates from the schedule and the start date, then edit them by hand. ' +
        'Without a calendar the page shows no session table and prorated cancellation cannot be used.' }));

    var gen = el('button', { type: 'button', class: 'add-btn',
      text: rows.length ? 'Regenerate from the schedule' : 'Generate sessions',
      disabled: !canEditAll() || null });
    gen.addEventListener('click', function () { generateSessions(box); });
    box.appendChild(gen);

    if (!rows.length) return;

    var list = el('div', { class: 'items', style: 'margin-top:12px;' });
    rows.forEach(function (r, i) {
      var off = r.status === 'excluded';
      var cb = el('input', { type: 'checkbox', id: 'sess-' + i + '-off', disabled: !canEditAll() || null });
      cb.checked = off;
      var why = el('input', { type: 'text', id: 'sess-' + i + '-why', placeholder: 'Why (admin only)',
                              disabled: !canEditAll() || !off || null });
      why.value = r.reason || '';
      why.addEventListener('input', function () { S.dirty = true; });
      cb.addEventListener('change', function () {
        syncSessionCalendar();
        S.sessionDates[i].status = cb.checked ? 'excluded' : 'scheduled';
        S.dirty = true;
        drawSessionCalendar(box);
      });
      list.appendChild(el('div', { class: 'item' + (off ? ' is-off' : '') }, [
        el('div', { class: 'fact-grid' }, [
          el('div', {}, [el('label', { text: 'Date' }),
            el('div', { class: 'session-date', text: r.date })]),
          el('div', {}, [el('label', { for: 'sess-' + i + '-off', class: 'check-row' },
            [cb, el('span', { text: 'No class this date' })]), why])
        ])
      ]));
    });
    box.appendChild(list);
    box.appendChild(el('div', { class: 'hint', text:
      'A date switched off keeps its place here so it can be switched back, and it survives a ' +
      'regeneration. It does not appear on the page at all — neither the date nor the reason.' }));
  }

  function syncSessionCalendar() {
    S.sessionDates = (S.sessionDates || []).map(function (r, i) {
      var cb = $('sess-' + i + '-off');
      var why = $('sess-' + i + '-why');
      return {
        date: r.date,
        status: cb ? (cb.checked ? 'excluded' : 'scheduled') : r.status,
        reason: why ? why.value : (r.reason || '')
      };
    });
    return S.sessionDates;
  }

  function generateSessions(box) {
    syncSessionCalendar();
    syncSchedule();
    var freqNode = $('fact-schedule-frequency');
    send({
      action: 'sessions',
      schedule: {
        frequency: (freqNode && freqNode.value) || 'weekly',
        sessions: S.scheduleSessions || [],
        weekOfMonth: ($('fact-schedule-weekOfMonth') || {}).value
      },
      duration: {
        startDate: ($('fact-duration-startDate') || {}).value || '',
        endDate: ($('fact-duration-endDate') || {}).value || '',
        sessionCount: readNum('fact-duration-sessionCount'),
        sessionDates: S.sessionDates
      }
    }).then(function (res) {
      if (!res.ok) { message('err', failure(res, 'generate the sessions')); return; }
      var rows = res.data.sessionDates || [];
      if (!rows.length) {
        message('err', 'Nothing to generate. A calendar needs a start date, a day of the week, ' +
          'and either an end date or a number of sessions — and a custom frequency cannot be ' +
          'generated at all, because it is whatever you typed.');
        return;
      }
      S.sessionDates = rows.map(function (r) {
        return { date: r.date, status: r.status, reason: r.reason || '' };
      });
      S.dirty = true;
      drawSessionCalendar(box);
      // The disagreement between a typed count and the span it is supposed to
      // cover, surfaced while an admin is here to settle it. hebrew4kids has
      // had it since before any of this was built.
      message(res.data.note ? 'warn' : 'ok',
        res.data.note || (rows.length + ' dates generated. Nothing is saved until you save.'));
    });
  }

  // ---------- named groups ----------------------------------------------------
  //
  // OPT-IN. Absent, an activity behaves exactly as it always has: one pool of
  // groups × maxPerGroup, and which group a child lands in is the teacher's
  // business. Named groups are for the case where the FAMILY has to choose —
  // Beginners and Advanced — and then the choice has to be recorded and counted.
  //
  // The names are per-language because they are words a family reads. The
  // capacities are not. That split is drawn by where the field sits rather than
  // by a rule anyone has to remember: a Russian-only role gets three name boxes
  // it may edit and a capacity it may not.
  //
  // Ids are minted from the clock, never from list position — the same rule the
  // repeatable lists learned when removing a row reissued an id and merged two
  // items' state. Here it would be worse: a group id is what a registration
  // points at, so a reused one attaches a child to the wrong group.
  function mintGroupId() {
    return 'g-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function namedGroupsEditor(fact) {
    S.namedGroups = (fact.named || []).map(function (g) {
      return { groupId: g.groupId || mintGroupId(), name: langObj(g.name), capacity: g.capacity };
    });
    var box = el('div', { id: 'named-groups', style: 'margin-top:18px;' });
    drawNamedGroups(box);
    return box;
  }

  function drawNamedGroups(box) {
    box.innerHTML = '';
    box.appendChild(el('div', { class: 'field-label', text: 'Named groups (optional)' }));
    box.appendChild(el('div', { class: 'hint', text: S.namedGroups.length
      ? 'The numbers above are ignored while this list has entries: the group count is the ' +
        'length of the list and the capacity is the sum of these. A family chooses one when they register.'
      : 'Leave empty unless a family has to CHOOSE which group — Beginners or Advanced. ' +
        'Two groups meeting at the same hour do not need this.' }));

    S.namedGroups.forEach(function (g, i) {
      var row = el('div', { class: 'item', 'data-group-id': g.groupId });
      row.appendChild(fieldRow({ label: 'Group name' }, g.name, 'grp-' + g.groupId + '-name'));
      var cap = el('input', { type: 'number', min: '1', step: '1', id: 'grp-' + g.groupId + '-cap',
                              disabled: !canEditAll() || null });
      cap.value = g.capacity == null ? '' : g.capacity;
      cap.addEventListener('input', function () { S.dirty = true; });
      var remove = el('button', { type: 'button', class: 'add-btn', text: 'Remove this group',
                                  disabled: !canEditAll() || null });
      remove.addEventListener('click', function () {
        syncNamedGroups();
        S.namedGroups.splice(i, 1);
        S.dirty = true;
        drawNamedGroups(box);
      });
      row.appendChild(el('div', { class: 'fact-grid' }, [
        el('div', {}, [el('label', { for: 'grp-' + g.groupId + '-cap', text: 'Places in this group' }), cap]),
        el('div', {}, [el('label', { text: '\u00a0' }), remove])
      ]));
      box.appendChild(row);
    });

    var add = el('button', { type: 'button', class: 'add-btn', text: '+ Add a named group',
                             disabled: !canEditAll() || null });
    add.addEventListener('click', function () {
      // Read the form into the model BEFORE redrawing, or adding a row eats
      // whatever was typed into the row above it.
      syncNamedGroups();
      S.namedGroups.push({ groupId: mintGroupId(), name: { he: '', en: '', ru: '' }, capacity: null });
      S.dirty = true;
      drawNamedGroups(box);
    });
    box.appendChild(add);
  }

  // A restricted role gets the words and not the structure, here as everywhere.
  function canEditAll() {
    return ['he', 'en', 'ru'].every(function (l) { return canEdit(l); });
  }

  function syncNamedGroups() {
    S.namedGroups = (S.namedGroups || []).map(function (g) {
      var capNode = $('grp-' + g.groupId + '-cap');
      return {
        groupId: g.groupId,
        name: readLangField('grp-' + g.groupId + '-name'),
        capacity: capNode && capNode.value !== '' ? Number(capNode.value) : null
      };
    });
    return S.namedGroups;
  }

  // A group with no name in any language is dropped rather than saved as a
  // nameless choice a family would be asked to make.
  function readNamedGroups() {
    return syncNamedGroups().filter(function (g) {
      return ['he', 'en', 'ru'].some(function (l) { return String(g.name[l] || '').trim(); });
    });
  }

  function renderFacts() {
    $('facts').innerHTML = '';
    S.schema.facts.forEach(function (d) { $('facts').appendChild(factBlock(d)); });
    refreshPerHour();
    refreshLegacyNotes();
  }

  function readFacts() {
    var facts = {};
    var visibility = {};
    S.schema.facts.forEach(function (d) {
      visibility[d.key] = readBool('fact-vis-' + d.key) ? 'members' : 'public';
      var previous = (S.record.facts || {})[d.key] || {};
      var out;
      if (d.kind === 'text') out = readLangField('fact-' + d.key);
      else if (d.kind === 'location') out = { text: readLangField('fact-' + d.key) };
      else if (d.kind === 'ages') out = { min: readNum('fact-ages-min'), max: readNum('fact-ages-max') };
      else if (d.kind === 'schedule') {
        out = {
          frequency: ($('fact-schedule-frequency') || {}).value || 'weekly',
          sessions: syncSchedule().filter(function (x) { return x.day != null || x.time; })
        };
        var wom = $('fact-schedule-weekOfMonth');
        if (out.frequency === 'monthly' && wom) {
          out.weekOfMonth = wom.value === 'last' ? 'last' : Number(wom.value);
        }
      } else if (d.kind === 'duration') {
        out = {
          startDate: ($('fact-duration-startDate') || {}).value || '',
          endDate: ($('fact-duration-endDate') || {}).value || '',
          sessionCount: readNum('fact-duration-sessionCount'),
          sessionMinutes: readNum('fact-duration-sessionMinutes'),
          // The calendar is the source of truth for what the page prints and
          // what a refund is divided by, so it travels with every save. It was
          // absent from the canonical shape once and every save deleted it.
          sessionDates: S.sessionDates || previous.sessionDates || []
        };
      } else if (d.kind === 'groupSize') {
        out = { groups: readNum('fact-groupSize-groups'), maxPerGroup: readNum('fact-groupSize-maxPerGroup'),
                overrideText: readLangField('fact-groupSize-overrideText') };
        var named = readNamedGroups();
        if (named.length) out.named = named;
      } else if (d.kind === 'price') {
        out = {
          registrationFee: readNum('fact-price-registrationFee'),
          perHourOverride: readNum('fact-price-perHourOverride'),
          showPerLesson: readBool('fact-price-showPerLesson')
        };
        // Only the one that was drawn. Sending the other as null is how a term
        // price gets cleared by an admin who only changed the type.
        if (currentType() === 'dropin') out.perSessionPrice = readNum('fact-price-perSessionPrice');
        else out.fullPrice = readNum('fact-price-fullPrice');
      } else out = {};

      // Carry the legacy sentence through untouched. It is what the page still
      // shows for anything not yet filled in, and a save must not drop it.
      if (d.kind !== 'text' && previous.legacyText) out.legacyText = previous.legacyText;
      facts[d.key] = out;
    });
    return { facts: facts, factVisibility: visibility };
  }

  // ---------- repeatable lists ----------
  function listSpec(key) {
    return S.schema.lists.filter(function (l) { return l.key === key; })[0];
  }

  function makeList(key) {
    var spec = listSpec(key);
    var container = $('list-' + key);
    var structureLocked = S.schema.langs.some(function (l) { return !canEdit(l); });

    var host = {
      // RULE 1: called by RepeatableList before every redraw.
      readInto: function (items) {
        items.forEach(function (item) {
          spec.itemFields.forEach(function (f) {
            var prefix = 'it-' + key + '-' + item.id + '-' + f.key;
            if ($(prefix + '-' + S.schema.langs[0])) item[f.key] = readLangField(prefix);
          });
        });
      },
      render: function (items) {
        container.innerHTML = '';
        items.forEach(function (item, i) {
          var head = el('div', { class: 'item-head' }, [
            el('b', { text: spec.label + ' ' + (i + 1) }),
            el('span', { class: 'item-ctrls' }, [
              el('button', { type: 'button', text: '↑', title: 'Move up',
                disabled: (i === 0 || structureLocked) || null,
                onclick: function () { S.dirty = true; L.up(item.id); } }),
              el('button', { type: 'button', text: '↓', title: 'Move down',
                disabled: (i === items.length - 1 || structureLocked) || null,
                onclick: function () { S.dirty = true; L.down(item.id); } }),
              el('button', { type: 'button', class: 'del', text: 'Remove',
                disabled: structureLocked || null,
                onclick: function () { S.dirty = true; delete S.images[item.id]; L.remove(item.id); } })
            ])
          ]);
          var box = el('div', { class: 'item' }, [head]);
          spec.itemFields.forEach(function (f) {
            box.appendChild(fieldRow(f, langObj(item[f.key]), 'it-' + key + '-' + item.id + '-' + f.key));
          });
          if (spec.image) {
            // Per-item state is keyed by the item's own id, which is why those
            // ids must never be positional.
            // No src rather than an empty one — see the note on the hero preview.
            var storedSrc = item[spec.image] || '';
            var freshSrc = !S.images[item.id] && storedSrc ? S.freshBytes[storedSrc] : null;
            var img = el('img', { src: S.images[item.id] || freshSrc || storedSrc || null, alt: '' });
            if (freshSrc) img.setAttribute('data-fresh-path', storedSrc);
            var file = el('input', { type: 'file', accept: 'image/*', style: 'font-size:12px;',
              disabled: structureLocked || null });
            file.addEventListener('change', function () {
              readImage(file, 'credit', function (dataUrl) { S.images[item.id] = dataUrl; img.src = dataUrl; S.dirty = true; });
            });
            box.appendChild(el('div', { class: 'item-image' }, [
              img, el('div', {}, [el('label', { text: spec.image === 'logo' ? 'Logo' : 'Photo' }), file])
            ]));
          }
          container.appendChild(box);
        });
      },
      blank: function () { return {}; }
    };

    var L = window.RepeatableList({ prefix: key.slice(0, 3), host: host, items: (S.record[key] || []).slice() });
    L.set(L.all());
    return L;
  }

  function renderLists() {
    S.schema.lists.forEach(function (spec) { S.lists[spec.key] = makeList(spec.key); });
  }

  // ---------- read the whole form ----------
  function readForm() {
    var rec = { slug: (($('f-slug') || {}).value || S.slug || '').trim() };
    rec.status = $('f-status').value;
    rec.motif = $('f-motif').value;
    rec.corner = $('f-corner').value;

    // Every translatable scalar, in whichever panel it was drawn. Missing the
    // SEO group here would read the form back without it and silently blank a
    // meta description on the next save.
    S.schema.simple.concat(S.schema.seo || []).forEach(function (d) {
      rec[d.key] = readLangField('f-' + d.key);
    });

    // A pending upload is a data URL and wins; otherwise send back the stored
    // path. S.cardImage is explicitly null after a Remove, and null must travel
    // so the server can tell "cleared" from "absent".
    rec.cardImage = S.cardImage !== undefined ? S.cardImage : (S.record.cardImage || null);
    rec.shareImage = S.shareImage !== undefined ? S.shareImage : (S.record.shareImage || null);
    rec.robots = ($('f-robots') && $('f-robots').value) || S.record.robots || 'index';
    // Blank means "its own activity", and the server turns that into this
    // record's own id. Sent as null rather than omitted, so "the admin unlinked
    // it" and "this form did not draw it" stay different requests.
    rec.seriesId = ($('f-series') && $('f-series').value) || null;
    var facts = readFacts();
    rec.facts = facts.facts;
    rec.factVisibility = facts.factVisibility;
    // Structure, like robots: one answer for all three languages. Only the
    // fields THIS type drew are in here; the server keeps the rest.
    rec.type = ($('f-type') && $('f-type').value) || S.record.type || 'course';
    rec.registration = readRegistration();

    S.schema.lists.forEach(function (spec) {
      // sync() captures pending input without redrawing.
      rec[spec.key] = S.lists[spec.key].sync().map(function (item) {
        var out = { id: item.id };
        spec.itemFields.forEach(function (f) { out[f.key] = item[f.key] || { he: '', en: '', ru: '' }; });
        if (spec.image) out[spec.image] = S.images[item.id] || item[spec.image] || null;
        return out;
      });
    });
    return rec;
  }

  // ---------- server calls ----------
  function send(body) {
    return window.AdminSession.post(API, body).catch(function (err) {
      // A rejected fetch — a dropped connection, or a function killed at its
      // time limit — used to land in no .then at all. No message, no re-enabled
      // button, no clue: the click looked like it had done nothing.
      return { status: 0, ok: false, data: { error:
        'The request never came back (' + err.message + '). It may still have ' +
        'completed on the server — reload and check before trying again.' } };
    });
  }

  // Never returns an empty string. A function killed at its time limit answers
  // 502 with no JSON body, so res.data.error was undefined and
  // (validation || [undefined]).join(' · ') produced '' — and message() renders
  // nothing at all for ''. That is how a publish that HAD committed looked
  // exactly like a dead button.
  function failure(res, what) {
    if (res.data && res.data.validation && res.data.validation.length) {
      return res.data.validation.join(' · ');
    }
    if (res.data && res.data.error) return res.data.error;
    if (res.status === 502 || res.status === 504) {
      return what + ' timed out. Large images make this slow, and the work may ' +
             'have finished anyway — <b>reload the page and check</b> before retrying, ' +
             'so you do not publish twice.';
    }
    return what + ' failed (HTTP ' + res.status + ') and the server gave no reason.';
  }

  // A new activity has no slug until you type one, and the server can only
  // answer "Bad slug" to that. Catch it here where we can say what to do and
  // put the cursor in the right box.
  function requireSlug() {
    var field = $('f-slug');
    var slug = ((field && field.value) || S.slug || '').trim();
    if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return true;
    message('err', slug
      ? '<b>' + slug + '</b> is not a usable slug. Use lower-case words joined by single hyphens, e.g. <b>hebrew-for-kids</b>.'
      : 'Give the activity a slug first — it becomes its web address, e.g. <b>hebrew-for-kids</b>.');
    if (field && !field.disabled) {
      field.scrollIntoView({ behavior: 'smooth', block: 'center' });
      field.focus();
    }
    return false;
  }


  function showConflict(payload, retry) {
    var c = payload.conflict || {};
    var box = $('conflict-box');
    box.innerHTML = '';
    box.appendChild(el('div', { class: 'conflict' }, [
      el('h3', { text: 'Someone else changed this activity' }),
      el('p', { html: (payload.message || '') +
        (c.lastEditedBy ? ' Last edited by <b>' + c.lastEditedBy + '</b>.' : '') +
        '<br>You loaded it at ' + (c.yourBase || 'never') + '; it now says ' + (c.currentUpdatedAt || 'deleted') + '.' }),
      el('div', { class: 'conflict-actions' }, [
        el('button', { type: 'button', class: 'primary', text: 'Reload theirs (discard my changes)',
          onclick: function () { clearConflict(); load(S.slug); } }),
        el('button', { type: 'button', text: 'Overwrite with mine',
          onclick: function () { clearConflict(); retry(true); } })
      ])
    ]));
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function refreshList(selectSlug) {
    return send({ action: 'list' }).then(function (res) {
      if (!res.ok) return message('err', failure(res, 'Loading the activity list'));
      // Kept for the series picker, which needs every other activity's id. The
      // list arrives after the form is first drawn, so the settings panel is
      // redrawn once it does — without touching anything else, since nothing
      // above it has been typed into yet at that point.
      var hadNone = !S.activities;
      S.activities = res.data.activities || [];
      if (hadNone && $('settings').children.length) renderSettings();
      var picker = $('picker');
      picker.innerHTML = '';
      res.data.activities.forEach(function (a) {
        var title = (a.title && (a.title.he || a.title.en || a.title.ru)) || a.slug;
        picker.appendChild(el('button', {
          type: 'button',
          class: a.slug === (selectSlug || S.slug) ? 'active' : '',
          onclick: function () { load(a.slug); }
        }, [
          el('span', { class: 'slug', text: title }),
          el('span', { class: 'pill ' + a.status, text: statusPill(a.status) })
        ]));
      });
    });
  }

  function fillForm(record, baseUpdatedAt) {
    S.record = record;
    S.slug = record.slug || null;
    S.baseUpdatedAt = baseUpdatedAt || null;
    S.images = {};
    // undefined, not null: null means "the admin pressed Remove". Loading a
    // different activity must forget a pending upload, not carry it across and
    // publish one activity's photograph onto another.
    S.cardImage = undefined;
    S.shareImage = undefined;
    S.dirty = false;
    renderSettings();
    renderFields();
    renderLists();
    applyLocks();
  }

  function applyLocks() {
    var isPublished = S.record && S.record.status && S.record.status !== 'draft' && S.slug;
    $('btn-publish').disabled = !S.canPublish;
    $('btn-unpublish').disabled = !S.canPublish || !isPublished;
    $('btn-delete').disabled = !S.canPublish || !S.slug;
    if (!S.canPublish) {
      $('btn-publish').title = 'Your role can edit but not publish';
    }
  }

  function load(slug) {
    // Held bytes belong to the activity they were uploaded for. The reload after
    // a publish asks for the SAME slug, so they survive that; opening a
    // different activity drops them.
    if (slug !== S.slug) S.freshBytes = {};
    clearConflict();
    message('');
    return send({ action: 'load', slug: slug }).then(function (res) {
      if (!res.ok) return message('err', failure(res, 'Loading that activity'));
      fillForm(res.data.activity, res.data.baseUpdatedAt);
      if (res.data.source === 'draft') {
        message('warn', 'You are editing a <b>draft</b>. It has no page on the site until you publish it.');
      }
      refreshList(slug);
    });
  }

  function blankRecord() {
    var rec = { slug: '', status: 'draft', motif: 'ring', corner: 'tl',
                facts: {}, faq: [], teachers: [], sponsors: [] };
    return rec;
  }

  // ---------- actions ----------
  function doPreview() {
    message('');
    if (!requireSlug()) return;
    var activity = readForm();
    send({ action: 'preview', activity: activity }).then(function (res) {
      if (!res.ok) return message('err', failure(res, 'Preview'));
      var d = res.data;
      $('preview-panel').hidden = false;
      var tabs = $('preview-tabs');
      tabs.innerHTML = '';
      Object.keys(d.html).forEach(function (lang) {
        var published = d.langs.indexOf(lang) !== -1;
        tabs.appendChild(el('button', {
          type: 'button',
          class: lang === S.previewLang ? 'active' : '',
          text: LANG_NAME[lang] + (published ? '' : ' (not published — no title)'),
          onclick: function () { S.previewLang = lang; showPreview(d); }
        }));
      });
      var files = $('preview-files');
      files.innerHTML = '';
      d.files.forEach(function (f) { files.appendChild(el('li', { text: f.path })); });
      d.deletes.forEach(function (p) { files.appendChild(el('li', { text: 'remove ' + p, style: 'color:#8a3220' })); });
      showPreview(d);
      $('preview-panel').scrollIntoView({ behavior: 'smooth' });
    });
  }

  function showPreview(d) {
    var frame = $('preview-frame');
    // An image the admin has just chosen has been rewritten to the path it WILL
    // have — but preview does not commit, so that file does not exist yet and
    // every new picture previewed as a broken image. The data URLs come back
    // alongside the HTML and are put back here, in the iframe's DOM, AFTER it
    // has loaded: the HTML itself stays byte-for-byte what publish commits, and
    // by load time js/activity.js has already drawn the teacher and sponsor
    // photos, so those get swapped too.
    frame.onload = function () {
      var map = d.imagePreview;
      if (!map) return;
      var doc = frame.contentDocument;
      if (!doc) return;
      Array.prototype.forEach.call(doc.images, function (img) {
        var src = img.getAttribute('src');
        if (src && map[src]) img.src = map[src];
      });
    };
    // srcdoc: no preview server, no draft URL, nothing to clean up.
    frame.srcdoc = d.html[S.previewLang] || '';
    Array.prototype.forEach.call($('preview-tabs').children, function (b) {
      b.className = b.textContent.indexOf(LANG_NAME[S.previewLang]) === 0 ? 'active' : '';
    });
  }

  function doSaveDraft(overwrite) {
    message('');
    if (!requireSlug()) return;
    var activity = readForm();
    activity.status = 'draft';
    send({ action: 'saveDraft', activity: activity, baseUpdatedAt: S.baseUpdatedAt, overwrite: !!overwrite })
      .then(function (res) {
        if (res.status === 409) return showConflict(res.data, doSaveDraft);
        if (!res.ok) return message('err', failure(res, 'Saving the draft'));
        S.baseUpdatedAt = res.data.baseUpdatedAt;
        S.slug = res.data.slug;
        S.record = res.data.activity;
        S.dirty = false;
        message('ok', 'Draft saved. It is not on the site — there is no page for it until you publish.');
        refreshList(S.slug);
      });
  }

  function doPublish(overwrite) {
    message('');
    if (!requireSlug()) return;
    var activity = readForm();
    if (activity.status === 'draft') {
      return message('err', 'Set a status other than Draft to publish. A draft is never committed.');
    }
    $('btn-publish').disabled = true;
    // What we uploaded in this session, before load() forgets it.
    var pending = {
      cardImage: S.cardImage, shareImage: S.shareImage,
      items: Object.assign({}, S.images)
    };
    send({ action: 'publish', activity: activity, baseUpdatedAt: S.baseUpdatedAt, overwrite: !!overwrite })
      .then(function (res) {
        applyLocks();
        if (res.status === 409) return showConflict(res.data, doPublish);
        if (!res.ok) return message('err', failure(res, 'Publishing'));
        // Before load(): fillForm redraws from the record, and by then the
        // pictures must already know they still have their own bytes.
        rememberFreshBytes(res.data.activity, pending);
        S.baseUpdatedAt = res.data.baseUpdatedAt;
        S.slug = res.data.slug;
        S.dirty = false;
        // AFTER the reload, not before. load() clears the message box on its way
        // in, so a confirmation written here and then reloaded over is a
        // confirmation nobody ever sees — which is how publishing went silent
        // once already, and looked like a dead button.
        var done = 'Published. <a href="' + res.data.commit.url + '" target="_blank" rel="noopener">View the commit</a>. ' +
          'Netlify takes about a minute to deploy, then: ' +
          res.data.liveUrls.map(function (u) { return '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>'; }).join(' · ');
        load(S.slug).then(function () { message('ok', done); });
      });
  }

  function doUnpublish() {
    if (!window.confirm('Take this activity off the site?\n\nThe pages are deleted and it goes back to being a draft you can keep editing. Nothing is lost.')) return;
    send({ action: 'unpublish', slug: S.slug, baseUpdatedAt: S.baseUpdatedAt }).then(function (res) {
      if (res.status === 409) return showConflict(res.data, function () { doUnpublish(); });
      if (!res.ok) return message('err', failure(res, 'Unpublishing'));
      var done = 'Unpublished — the pages are gone from the site and it is a draft again. ' +
        '<a href="' + res.data.commit.url + '" target="_blank" rel="noopener">View the commit</a>.';
      // After the reload, for the same reason as doPublish.
      load(S.slug).then(function () { message('ok', done); });
    });
  }

  function doDelete() {
    var typed = window.prompt('This deletes the activity permanently — pages, source and draft.\n\nType the slug to confirm:\n' + S.slug);
    if (typed !== S.slug) return message('warn', 'Deletion cancelled.');
    send({ action: 'delete', slug: S.slug, confirmSlug: typed }).then(function (res) {
      if (!res.ok) return message('err', failure(res, 'Deleting'));
      message('ok', 'Deleted.');
      fillForm(blankRecord(), null);
      refreshList(null);
    });
  }

  // ---------- boot ----------
  $('logout').addEventListener('click', window.AdminSession.logout);
  $('new-activity').addEventListener('click', function () {
    clearConflict(); message('');
    S.freshBytes = {};
    fillForm(blankRecord(), null);
    refreshList(null);
  });
  $('btn-draft').addEventListener('click', function () { doSaveDraft(false); });
  $('btn-preview').addEventListener('click', doPreview);
  $('btn-publish').addEventListener('click', function () { doPublish(false); });
  $('btn-unpublish').addEventListener('click', doUnpublish);
  $('btn-delete').addEventListener('click', doDelete);
  document.querySelectorAll('[data-add]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      S.dirty = true;
      S.lists[btn.getAttribute('data-add')].add({});
    });
  });
  window.addEventListener('beforeunload', function (e) {
    if (S.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  send({ action: 'auth' }).then(function (res) {
    $('app').hidden = false;
    if (!res.ok) {
      $('tool').hidden = true;
      $('no-access').hidden = false;
      $('no-access').textContent = res.data.error || 'Your role does not have access to Activities.';
      return;
    }
    S.schema = res.data.schema;
    S.editLangs = res.data.editLangs || [];
    S.canPublish = !!res.data.canPublish;
    $('who').textContent = res.data.name + ' · ' + res.data.roleName;
    fillForm(blankRecord(), null);
    refreshList(null);
  });
})();
