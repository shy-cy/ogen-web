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
    // ⚠ THE GROUPS, held in the model rather than read back off the form.
    // Nothing about a group has an input on the main screen — a name, a
    // capacity, a teacher list, seven facts, a timetable and a calendar are all
    // edited on its own sub-page — so the save reads THIS. A read-back that
    // walked the DOM would find nothing and clear every one of them, which is
    // the undrawn-field trap this project keeps meeting. primeGroups() loads it.
    groups: [],
    ownerEdit: null,   // the sub-page's working copy, or null
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

      // ⚠ A COUNT, NOT A CEILING. `descriptor.counter` is a recommended length,
      // and the only field carrying one is the card summary, which CSS clamps to
      // three lines. Without this a writer finds the ellipsis after publishing;
      // with a refusal on save instead, they fight the form over one character.
      // Per language, because the same sentence is not the same length in three
      // of them — which is also why the clamp, not this, is what guarantees the
      // cards line up.
      var count = null;
      if (descriptor.counter) {
        count = el('div', { class: 'char-count' });
        var tick = function () {
          var n = input.value.length;
          count.textContent = n + ' / ' + descriptor.counter;
          count.className = 'char-count' + (n > descriptor.counter ? ' is-over' : '');
        };
        input.addEventListener('input', tick);
        tick();
      }

      return el('div', { class: 'lang-cell ' + lang, dir: lang === 'he' ? 'rtl' : 'ltr' }, [
        el('label', { for: id, text: LANG_NAME[lang] + (editable ? '' : ' (read-only for your role)') }),
        input,
        count
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
      // ⚠ MERGED, NEVER ASSIGNED — the undrawn-field trap, in the one place it
      // had not been closed.
      //
      // readFacts() and readRegistration() return ONLY WHAT IS DRAWN, on purpose:
      // a drop-in form has no "Full course price" box and no cutoff dates, so the
      // read-back carries no such keys, and the SERVER restores them from the
      // stored record (keepUndrawnFactKeys, mergeRegistration). The client did
      // not. This handler assigned the read-back straight over S.record, so the
      // instant the type select moved, the term price, the bundles and both
      // cutoffs were gone from the model. Switching back to Course then drew
      // empty boxes — and saving an empty box that the form DID draw is an admin
      // clearing it, which the server honours, correctly.
      //
      // So nothing was wrong on the server, nothing looked wrong on the screen,
      // and the values were destroyed in between the two. Reported from QA as
      // "the registration fee was kept, but the rest of the information was lost".
      S.record.facts = keepUndrawnFacts(S.record.facts, read.facts);
      S.record.factVisibility = read.factVisibility;
      S.record.registration = keepUndrawnRegistration(S.record.registration, readRegistration());
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
  // The calendar is a GROUP's now. Any group answers for the count, because the
  // totals are equal by the rule the server refuses a save over — and these two
  // sums feed the recompute BUTTON only, which is a suggestion an admin accepts
  // rather than a value anything is stored from.
  function firstGroupCalendar() {
    var g = ((S.record.groups) || [])[0] || {};
    return (((g.facts || {}).duration || {}).sessionDates) || [];
  }
  function scheduledCount() {
    return firstGroupCalendar()
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
    var rows = firstGroupCalendar()
      .filter(function (r) { return r && r.date && r.status !== 'excluded'; });
    if (!rows.length) return '';
    return rows[Math.min(Math.ceil(0.3 * rows.length), rows.length) - 1].date;
  }

  // Read back ONLY what was drawn. A field this type does not draw is left out
  // of the object entirely, and the server keeps the stored value for it — so
  // switching a course to a drop-in does not clear its cutoff dates.
  // A fact the form drew keeps whatever it sent AND whatever it did not send;
  // a fact it did not draw at all is untouched. `price` is the one that matters
  // — fullPrice on a drop-in form, perSessionPrice / lateDropIn / bundles on a
  // course form — and bundles matters most of the three, because a family's
  // purchase points at a bundle id rather than at a number an admin can retype.
  function keepUndrawnFacts(stored, drawn) {
    var out = {};
    Object.keys(drawn || {}).forEach(function (k) {
      out[k] = Object.assign({}, (stored || {})[k], drawn[k]);
    });
    Object.keys(stored || {}).forEach(function (k) { if (!(k in out)) out[k] = stored[k]; });
    return out;
  }

  // The same, one level deeper: a cutoff lives at cancellationPolicy.<key>, so a
  // form that does not draw it sends the parent object without that key in it.
  function keepUndrawnRegistration(stored, drawn) {
    var out = Object.assign({}, stored || {}, drawn || {});
    if ((stored || {}).cancellationPolicy || (drawn || {}).cancellationPolicy) {
      out.cancellationPolicy = Object.assign({}, (stored || {}).cancellationPolicy,
                                             (drawn || {}).cancellationPolicy);
    }
    return out;
  }

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
  function visibilityControl(key, label) {
    var current = (S.record.factVisibility || {})[key] ||
                  (S.schema.defaultVisibility || {})[key] || 'public';
    var box = el('input', { type: 'checkbox', id: 'fact-vis-' + key });
    box.checked = current === 'members';
    box.addEventListener('change', function () { S.dirty = true; });
    return el('label', {
      class: 'fact-vis',
      for: 'fact-vis-' + key,
      title: 'Members only: this fact is left out of the published page entirely.'
    }, [box, el('span', { text: label || 'Members only' })]);
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
    // The counts are gone: a group count is the length of the list and a size is
    // a field on one of its entries, so the override is all this fact holds.
    if (kind === 'groupSize') return anyLang(f.overrideText);
    if (kind === 'price') {
      return pos(f.registrationFee) || pos(f.fullPrice) || f.perHourOverride != null;
    }
    if (kind === 'location') return anyLang(f.text);
    if (kind === 'languages') return (f.codes || []).length > 0;
    if (kind === 'level') return !!f.level;
    return false;
  }

  // Show or hide each note against what is in the form RIGHT NOW, so it goes
  // the moment the fields are filled rather than waiting for a save and reload.
  // A note exists on exactly one screen at a time — the activity's two facts are
  // drawn here and a group's seven are drawn on its page — so the prefix follows
  // the fact rather than the screen, and there is never a pair of nodes with one
  // id between them.
  function refreshLegacyNotes() {
    if (!S.schema) return;
    S.schema.facts.forEach(function (d) {
      var note = $('legacy-' + d.key);
      if (!note) return;
      var p = (S.schema.groupFacts || []).indexOf(d.key) !== -1 ? GROUP_PREFIX : 'fact';
      note.hidden = hasStructuredValue(d.kind, readFactEditor(d, p, {}));
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

  // ⚠ A TEXT BOX, NOT `type="time"`, AND THAT IS THE ONLY WAY TO GET 24 HOURS.
  //
  // A native time input renders AM/PM or 24h from the BROWSER'S locale, and
  // there is no attribute that changes it — the admin is used in Cyprus and
  // Israel where 16:00 is how anybody writes an afternoon class, and it was
  // showing "04:00 PM". The stored value was always 24h `HH:MM`, so this was
  // never a data question; it was a display the page could not control.
  //
  // What is lost is the native picker, which on a desktop admin is a small
  // price: four digits is faster to type than a spinner is to click. What is
  // gained is one format in every browser and every locale.
  var TIME_PATTERN = '([01][0-9]|2[0-3]):[0-5][0-9]';

  // 1600, 930, 16, 9 and 16:00 all mean something obvious. Typed shorthand is
  // normalised on the way out of the field rather than refused, and anything
  // genuinely unreadable is handed back UNCHANGED so the pattern can mark it
  // rather than the box silently eating what somebody typed.
  function normaliseTime(raw) {
    var v = String(raw == null ? '' : raw).trim();
    if (!v) return '';
    var m = /^(\d{1,2})[:.\s]?(\d{2})?$/.exec(v);
    if (!m) return v;
    var h = Number(m[1]);
    var mi = m[2] == null ? 0 : Number(m[2]);
    if (h > 23 || mi > 59) return v;
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return pad(h) + ':' + pad(mi);
  }

  function timeField(id, value) {
    var input = el('input', {
      type: 'text', class: 'time24', id: id, inputmode: 'numeric', maxlength: '5',
      placeholder: '16:00', pattern: TIME_PATTERN, autocomplete: 'off',
      'aria-label': 'Time, 24 hour'
    });
    input.value = value || '';
    input.addEventListener('input', function () { S.dirty = true; refreshLegacyNotes(); });
    input.addEventListener('blur', function () {
      var t = normaliseTime(input.value);
      if (t !== input.value) { input.value = t; S.dirty = true; }
      refreshLegacyNotes();
    });
    return input;
  }

  // ⚠ ONE ROW BUILDER, TWO EDITORS. The activity has a schedule and so does each
  // named group, and two copies of this would be two places the derived weekday,
  // the 24-hour field or the custom date row can be forgotten. `prefix` is the
  // only thing that differs: it namespaces the ids so two editors can be open
  // without colliding.
  //
  // It reads and writes a plain array the caller owns, rather than a slot on S,
  // which is what lets the group sub-page keep its own.
  function scheduleRowBox(opts) {
    var prefix = opts.prefix;
    var freq = opts.freq;
    var sessions = opts.sessions;
    var onChange = opts.onChange || function () {};
    var box = el('div', { class: 'session-rows', id: prefix + '-rows' });

    sessions.forEach(function (sess, i) {
      var id = prefix + '-' + i;
      var daySel = el('select', { id: id + '-day' });
      daySel.appendChild(el('option', { value: '', text: '— day —' }));
      DAY_NAMES.forEach(function (name, d) {
        daySel.appendChild(el('option', { value: String(d), text: name, selected: sess.day === d || null }));
      });
      daySel.addEventListener('change', onChange);
      var time = timeField(id + '-time', sess.time);

      var dateInput = null;
      if (freq === 'custom') {
        dateInput = el('input', { type: 'date', id: id + '-date' });
        dateInput.value = sess.date || '';
        dateInput.addEventListener('input', function () { syncDay(); onChange(); });
      }

      function syncDay() {
        var d = dateInput && weekdayOf(dateInput.value);
        if (d == null) { daySel.disabled = false; daySel.removeAttribute('title'); return; }
        daySel.value = String(d);
        daySel.disabled = true;
        daySel.title = 'Taken from the date';
      }
      if (dateInput) syncDay();

      var row = el('div', { class: 'session-row' },
        dateInput ? [dateInput, daySel, time] : [daySel, time]);
      if (opts.onRemove) {
        row.appendChild(el('button', {
          type: 'button', class: 'del', text: 'Remove',
          onclick: function () { opts.onRemove(i); }
        }));
      }
      box.appendChild(row);
    });

    if (opts.onAdd) {
      box.appendChild(el('button', {
        type: 'button', class: 'add-btn',
        text: freq === 'custom' ? '+ Add another date' : '+ Add another day',
        onclick: opts.onAdd
      }));
    }
    return box;
  }

  // ⚠ ONE CALENDAR EDITOR, for the activity's own dates AND for a group's.
  //
  // There were two, written a release apart, and they had already drifted in
  // every way two copies drift: one labelled the checkbox "No class this date"
  // and the other " not meeting", one had a box for the reason and the other
  // silently dropped it, one struck the row through and the other did not. The
  // bug below was in both, worded differently in each — which is the whole
  // argument for there being one of these.
  //
  // ⚠ A TICK MEANS THE GROUP MEETS. It used to mean the opposite: `checked`
  // was `status === 'excluded'`, so the dates that were NOT happening were the
  // ticked ones. Read as a list — which is what a column of dates is — a tick
  // means "this one counts", and every other checkbox in this admin means
  // "yes, do this". The label carried the inversion ("No class this date") and
  // so the two halves were each defensible and the pair was not: an admin
  // scanning for what the term looks like saw the holidays highlighted and the
  // teaching invisible.
  //
  // What goes onto the record is unchanged — `excluded` is still the stored
  // status and an unticked date still keeps its place — so nothing downstream
  // moves. This is a display that was telling the truth backwards.
  //
  // opts: { prefix, dates, canEdit, onChange, generateLabel, onGenerate, lead }
  function sessionCalendarBox(opts) {
    var prefix = opts.prefix;
    var rows = opts.dates || [];
    var editable = opts.canEdit !== false;
    var live = rows.filter(function (r) { return r.status !== 'excluded'; }).length;
    var box = el('div', { class: 'session-cal' });

    box.appendChild(el('div', { class: 'hint', text: rows.length
      ? live + ' of ' + rows.length + ' dates are going ahead. ' + opts.lead
      : opts.empty }));

    var gen = el('button', { type: 'button', class: 'add-btn',
      text: rows.length ? opts.generateLabel.regenerate : opts.generateLabel.generate,
      disabled: !editable || null });
    gen.addEventListener('click', opts.onGenerate);
    box.appendChild(gen);

    // ⚠ CLEARING IS NOT THE SAME ACT AS UNTICKING, and the gap was real.
    //
    // Regenerating already REPLACES the list — mergeExclusions() returns the
    // newly enumerated dates and reads the old list only to carry exclusions
    // and their reasons forward — so an admin who picks the wrong frequency can
    // usually just regenerate. Usually. Switch to `custom` and regeneration
    // refuses outright, because a custom schedule is whatever was typed and
    // there is nothing to enumerate; the wrong dates then sit there with no way
    // to shift them, and unticking them all leaves eleven excluded dates on the
    // record rather than none. There was no way to get back to empty.
    if (rows.length) {
      var clear = el('button', { type: 'button', class: 'del',
        text: 'Clear all ' + rows.length + ' dates', disabled: !editable || null });
      clear.addEventListener('click', function () {
        opts.onChange([]);
      });
      box.appendChild(clear);
    }

    if (!rows.length) return box;

    box.appendChild(el('div', { class: 'field-label', style: 'margin-top:14px;',
      text: 'Tick the dates it meets on' }));

    var list = el('div', { class: 'session-rows' });
    rows.forEach(function (r, i) {
      var on = r.status !== 'excluded';
      var id = prefix + '-on-' + i;
      var cb = el('input', { type: 'checkbox', id: id, disabled: !editable || null });
      cb.checked = on;
      cb.addEventListener('change', function () {
        var next = rows.slice();
        next[i] = { date: r.date, status: cb.checked ? 'scheduled' : 'excluded',
                    reason: cb.checked ? '' : (r.reason || '') };
        opts.onChange(next);
      });

      // The reason is only askable about a date that is NOT happening, and it
      // travels through a regeneration — an admin writes "Hanukkah" once and
      // whoever asks next year can still find out why there was no class.
      var why = el('input', { type: 'text', id: prefix + '-why-' + i,
        placeholder: 'Why (admin only)', disabled: !editable || on || null });
      why.value = on ? '' : (r.reason || '');
      why.addEventListener('input', function () {
        var next = rows.slice();
        next[i] = { date: r.date, status: r.status, reason: why.value };
        // Not a redraw: retyping the whole box on every keystroke would move
        // the caret to the end of it.
        opts.onChange(next, { quiet: true });
      });

      var row = el('div', { class: 'session-row' + (on ? '' : ' is-off') }, [
        cb,
        el('label', { for: id, class: 'session-date', text: r.date }),
        el('span', { class: 'session-off-tag', text: on ? '' : 'not meeting' }),
        why
      ]);
      // ⚠ DELETE, which is a different act from unticking. An unticked date is
      // a date this activity was going to meet on and does not — it keeps its
      // place, it survives a regeneration, and it carries a reason. A deleted
      // one was never real: the wrong frequency produced it. Conflating the two
      // is how a record ends up carrying a list of exclusions describing a term
      // that never existed.
      row.appendChild(el('button', {
        type: 'button', class: 'del', text: 'Delete',
        disabled: !editable || null,
        onclick: function () {
          var next = rows.slice();
          next.splice(i, 1);
          opts.onChange(next);
        }
      }));
      list.appendChild(row);
    });
    box.appendChild(list);

    box.appendChild(el('div', { class: 'hint', text:
      'An unticked date keeps its place here so it can be put back, and it survives a ' +
      'regeneration along with its reason. It reaches the page in neither form — not the ' +
      'date and not the reason. Delete is for a date that should not be in the list at all.' }));
    return box;
  }

  // Read a schedule editor's inputs back into a plain array. Same prefix in,
  // same shape out — including the weekday derived from a date, so the form
  // never shows one answer and stores another.
  function readScheduleRows(prefix, count) {
    var out = [];
    for (var i = 0; i < count; i++) {
      var id = prefix + '-' + i;
      var d = $(id + '-day'), t = $(id + '-time'), dt = $(id + '-date');
      if (!d && !t && !dt) continue;
      var date = dt && dt.value ? dt.value : null;
      var row = {
        day: date ? weekdayOf(date) : (d && d.value !== '' ? Number(d.value) : null),
        time: t ? t.value : ''
      };
      if (date) row.date = date;
      out.push(row);
    }
    return out;
  }

  function weekdayOf(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
    if (!m) return null;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    var back = new Date(t);
    if (back.getUTCFullYear() !== +m[1] || back.getUTCMonth() !== +m[2] - 1 ||
        back.getUTCDate() !== +m[3]) return null;
    return back.getUTCDay();
  }

  // Same rule the repeatable lists live by: read the inputs into the model
  // BEFORE redrawing, or a redraw eats whatever was just typed.
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
    if (fee != null && fee > 0) parts.push('Registration fee ' + fee + ' €');
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
    var basis = priceBasisDuration();
    var count = basis.sessionCount;
    var mins = basis.sessionMinutes;
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
    var basis = priceBasisDuration();
    var count = basis.sessionCount;
    var mins = basis.sessionMinutes;
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

  // ⚠ ONE EDITOR PER FACT KIND, DRAWN WHEREVER THE FACT LIVES. Seven of the nine
  // facts are a group's now and two are the activity's, and they are edited on
  // two different screens — so the ids are built from a PREFIX rather than
  // hardcoded. Two copies of a fact editor is two places a checkbox can come to
  // mean opposite things, which is exactly how the calendar's tick did.
  //
  // `p` is 'fact' on the main form and GROUP_PREFIX on a group's sub-page. The
  // read-back below uses the same prefix, so a field the form draws and the
  // read-back misses cannot happen by one of them being edited alone.
  function factEditor(d, fact, p) {
    fact = fact || {};
    var body;

    if (d.kind === 'text') {
      body = fieldRow({ label: 'Text', textarea: true }, langObj(fact), p + '-' + d.key);
    } else if (d.kind === 'languages') {
      // Tick boxes rather than a multi-select: a class taught in two languages
      // is ordinary here, and a multi-select hides the options that were not
      // chosen behind a control most people do not know is multiple.
      var langBox = el('div', { class: 'fact-checks' });
      (S.schema.instructionLanguages || []).forEach(function (o) {
        var id = p + '-lang-' + o.key;
        var box = el('input', { type: 'checkbox', id: id, value: o.key });
        box.checked = (fact.codes || []).indexOf(o.key) !== -1;
        box.addEventListener('change', function () { S.dirty = true; refreshLegacyNotes(); });
        langBox.appendChild(el('label', { class: 'fact-check', for: id }, [box, el('span', { text: o.label })]));
      });
      body = el('div', {}, [
        langBox,
        // The free text is SECOND and optional. The list answers the question;
        // this adds to it, and it renders on its own line under the languages.
        fieldRow({ label: 'Anything else (optional)', textarea: true },
                 langObj(fact.text), p + '-' + d.key)
      ]);
    } else if (d.kind === 'level') {
      var levelSel = el('select', { id: p + '-level' });
      levelSel.appendChild(el('option', { value: '', text: '— not stated —' }));
      (S.schema.levels || []).forEach(function (o) {
        levelSel.appendChild(el('option', {
          value: o.key, text: o.label, selected: o.key === fact.level || null
        }));
      });
      levelSel.addEventListener('change', function () { S.dirty = true; refreshLegacyNotes(); });
      body = el('div', {}, [
        el('div', { class: 'fact-grid' }, [el('div', {}, [el('label', { text: 'Level' }), levelSel])]),
        fieldRow({ label: 'Anything else (optional)', textarea: true },
                 langObj(fact.text), p + '-' + d.key)
      ]);
    } else if (d.kind === 'location') {
      // Keyed by the fact, not by the kind. There are two facts of this kind now
      // — the general location and the exact address — and a hardcoded id gave
      // them the same inputs: duplicate DOM ids, and a read-back that took the
      // first match for both, so saving would copy the location over the address.
      body = fieldRow({ label: 'Text' }, langObj(fact.text), p + '-' + d.key);
    } else if (d.kind === 'ages') {
      body = el('div', { class: 'fact-grid' }, [
        numField(p + '-ages-min', 'Youngest', fact.min),
        numField(p + '-ages-max', 'Oldest', fact.max)
      ]);
    } else if (d.kind === 'schedule') {
      // ⚠ NOT DRAWN HERE AT ALL. A schedule belongs to a group, and a group's
      // sub-page draws its frequency, its day/time rows and the calendar they
      // generate together — one editor, in the one place a timetable is set.
      body = null;
    } else if (d.kind === 'duration') {
      body = el('div', {}, [
        el('div', { class: 'fact-grid' }, [
          dateField(p + '-duration-startDate', 'Starts', fact.startDate),
          dateField(p + '-duration-endDate', 'Ends', fact.endDate),
          numField(p + '-duration-sessionCount', 'Number of sessions', fact.sessionCount),
          numField(p + '-duration-sessionMinutes', 'Minutes per session', fact.sessionMinutes)
        ]),
        el('div', { class: 'hint', text:
          'The number of sessions is a CAP on generation; the calendar below is what the page ' +
          'prints and what a cancellation is divided by. Sessions \u00d7 minutes is what the ' +
          'price is sold against, and every group has to add up to the same total.' })
      ]);
    } else if (d.kind === 'groupSize') {
      // Three languages, through the same fieldRow the location fact uses, so
      // the override obeys the same per-language permissions: a Russian-only
      // role gets the Russian box and two read-only ones. A single input could
      // not express that, and whatever it held would have been published in all
      // three languages by whoever last typed in it.
      //
      // ⚠ THE NUMBERS ARE GONE. "Number of groups" is the length of the group
      // list and "max per group" is a field on one of them, so typing either
      // here was typing a second answer to a question the list already answers —
      // and the two could disagree about the same activity.
      // ⚠ THE LABEL NAMES THE LINE IT REPLACES. It read "Free-text override",
      // under a heading reading "Group size", in a panel of unrelated things —
      // and beit-midrash came back with "Dates will be announced soon" typed
      // into it, which published as "Group size: Dates will be announced soon".
      // A box whose label does not say what it overrides collects whatever the
      // person wanted to say next.
      var override = fieldRow({
        label: 'Instead of the group-size line',
        hint: 'Leave blank and the page describes the groups above. Filled in, it replaces that ' +
              'one line for that language \u2014 for a grouping that is not "N groups of up to M". ' +
              'It is not a general note: nothing else on the page changes.'
      }, langObj(fact.overrideText), p + '-groupSize-overrideText');
      Array.prototype.forEach.call(override.querySelectorAll('input, textarea'), function (n) {
        n.addEventListener('input', refreshLegacyNotes);
      });
      body = el('div', {}, [override]);
    } else if (d.kind === 'price') {
      // A course quotes the term, a drop-in quotes the session, and only one of
      // the two is drawn. The undrawn one is KEPT rather than cleared — see
      // keepUndrawnFactKeys on the server — so switching type and back does not
      // lose a price nobody touched.
      var isDropin = currentType() === 'dropin';
      body = el('div', {}, [
        el('div', { class: 'fact-grid' }, [
          numField('fact-price-registrationFee', 'Registration fee (€)', fact.registrationFee),
          isDropin
            ? numField('fact-price-perSessionPrice', 'Price per session (€)', fact.perSessionPrice)
            : numField('fact-price-fullPrice', 'Full course price (€)', fact.fullPrice),
          numField('fact-price-perHourOverride', 'Per hour — manual override (€)', fact.perHourOverride)
        ]),
        checkField('fact-price-showPerLesson', 'Show cost per lesson', fact.showPerLesson === true,
                   'Off by default. The other price lines are unaffected either way.'),
        el('div', { class: 'perhour is-ok', id: 'price-preview' }),
        el('div', { class: 'perhour is-idle', id: 'perhour-note' }),
        // Both of these are drop-in only, and both are KEPT when the form does
        // not draw them — see TYPE_SCOPED_FACT_KEYS. Switching an activity to a
        // course to fix something and back must not lose a bundle a family has
        // already bought an entry from.
        isDropin ? lateDropInEditor(fact) : null,
        isDropin ? bundlesEditor(fact) : null
      ]);
    } else {
      body = el('div', { class: 'hint', text: 'Unknown field kind "' + d.kind + '"' });
    }

    return body;
  }

  // The editor with its heading, its hint and its legacy note around it.
  //
  // ⚠ AND WITHOUT THE MEMBERS-ONLY TOGGLE, which used to sit in this head.
  // Whether a fact is published is ONE policy for the whole activity — the exact
  // address being private is not a per-group decision — and the fields it
  // governs are now edited once per group. Drawn beside the field it would be
  // the same setting on two groups' pages, where changing one silently changes
  // both: the "two places for one job" shape that gave this codebase a checkbox
  // meaning opposite things in two editors a release apart. It has one place
  // now, on the main panel — see visibilityBlock().
  // `bare` drops the block's own heading, for the one case where the editor
  // underneath already carries a label that says the same thing — the group-size
  // override under the group list, where "Group size" over "Instead of the
  // group-size line" is the label twice.
  function factBlock(d, fact, p, bare) {
    var body = factEditor(d, fact, p);
    if (!body) return null;
    return el('div', { class: 'fact-block' }, [
      bare ? null : el('div', { class: 'fact-head' }, [el('div', { class: 'field-label', text: d.label })]),
      !bare && d.hint ? el('div', { class: 'hint', text: d.hint }) : null,
      body,
      legacyNote(d, fact || {})
    ]);
  }

  // ⚠ EVERY MEMBERS-ONLY FLAG, IN ONE PLACE. One row per fact, whichever screen
  // the fact itself is edited on, because this is a statement about the
  // published page rather than about a value: "the exact address is not printed"
  // is true of the activity, not of one of its groups.
  function visibilityBlock() {
    // No heading of its own any more — the panel is headed "What is published",
    // and "Who can see these" underneath it was the same sentence twice.
    var box = el('div', { class: 'fact-block' });
    box.appendChild(el('div', { class: 'hint', text:
      'Every fact is published unless it is ticked here. A members-only fact is left out of ' +
      'the page ENTIRELY \u2014 never rendered and hidden, because the file is static and anyone ' +
      'can read its source. It applies to the whole activity, so a fact every group fills in ' +
      'is published, or none of them is.' }));
    var grid = el('div', { class: 'fact-checks' });
    S.schema.facts.forEach(function (d) { grid.appendChild(visibilityControl(d.key, d.label)); });
    box.appendChild(grid);
    return box;
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
  function mintBundleId() {
    return 'b-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // Late pricing: one price that replaces the standard one inside N hours of a
  // session starting. Off unless the box is ticked, and the two numbers SURVIVE
  // being switched off — an admin who turns it off for a term should not have to
  // retype it, the same instinct a cutoff an admin disabled follows.
  function lateDropInEditor(fact) {
    var late = fact.lateDropIn || {};
    var box = el('div', { style: 'margin-top:18px;' });
    box.appendChild(el('div', { class: 'field-label', text: 'Late booking price (optional)' }));
    box.appendChild(el('div', { class: 'hint', text:
      'A different price for somebody booking close to the start. Bundle entries are ' +
      'never charged it — a family who paid in advance has already settled that evening.' }));
    box.appendChild(checkField('fact-price-late-enabled', 'Charge a different price for late bookings',
                               late.enabled === true));
    box.appendChild(el('div', { class: 'fact-grid' }, [
      numField('fact-price-late-hoursBefore', 'Hours before the start', late.hoursBefore),
      numField('fact-price-late-price', 'Late price (€)', late.price)
    ]));
    return box;
  }

  // ⚠ A BUNDLE IS A PRODUCT, NOT A DISCOUNT FIELD. "5 entries" and "10 entries"
  // are two things a family chooses between, so this is a list — and the empty
  // list is the ordinary case rather than a special one.
  //
  // All three numbers are required, because a bundle missing any of them is a
  // half-filled form rather than a product: normaliseBundles() drops it, so it
  // would simply never be offered, with nothing on screen saying why. validate()
  // refuses it on save instead.
  function bundlesEditor(fact) {
    S.bundles = (fact.bundles || []).map(function (b) {
      return { bundleId: b.bundleId || mintBundleId(), entries: b.entries,
               pricePerEntry: b.pricePerEntry, validityDays: b.validityDays };
    });
    var box = el('div', { id: 'bundles', style: 'margin-top:18px;' });
    drawBundles(box);
    return box;
  }

  function drawBundles(box) {
    box.innerHTML = '';
    box.appendChild(el('div', { class: 'field-label', text: 'Bundles (optional)' }));
    box.appendChild(el('div', { class: 'hint', text:
      'A number of sessions bought in advance at a fixed rate. A bundle is only OFFERED ' +
      'when the calendar ahead can cover every entry inside its validity window — it is ' +
      'never quietly sold at a smaller size. If we later cancel a session it cannot replace, ' +
      'the difference is credited back at the rate that was paid.' }));

    S.bundles.forEach(function (b, i) {
      var id = b.bundleId;
      var row = el('div', { class: 'item', 'data-bundle-id': id });
      var entries = numField('bun-' + id + '-entries', 'Entries', b.entries);
      var price = numField('bun-' + id + '-price', 'Price per entry (€)', b.pricePerEntry);
      var days = numField('bun-' + id + '-days', 'Valid for (days)', b.validityDays);
      var remove = el('button', { type: 'button', class: 'add-btn', text: 'Remove this bundle',
                                  disabled: !canEditAll() || null });
      remove.addEventListener('click', function () {
        syncBundles();
        S.bundles.splice(i, 1);
        S.dirty = true;
        drawBundles(box);
      });
      row.appendChild(el('div', { class: 'fact-grid' }, [entries, price, days]));
      row.appendChild(el('div', { class: 'hint', id: 'bun-' + id + '-total' }));
      row.appendChild(remove);
      box.appendChild(row);
      // The number a family actually sees. Two figures that multiply are two
      // figures somebody has to multiply, and the one place that arithmetic
      // matters is the moment of choosing between a 5 and a 10.
      ['bun-' + id + '-entries', 'bun-' + id + '-price'].forEach(function (f) {
        var node = $(f);
        if (node) node.addEventListener('input', function () { bundleTotal(id); });
      });
      bundleTotal(id);
    });

    var add = el('button', { type: 'button', class: 'add-btn', text: '+ Add a bundle',
                             disabled: !canEditAll() || null });
    add.addEventListener('click', function () {
      // Read the form into the model BEFORE redrawing, or adding a row eats
      // whatever was typed into the row above it.
      syncBundles();
      S.bundles.push({ bundleId: mintBundleId(), entries: null, pricePerEntry: null, validityDays: null });
      S.dirty = true;
      drawBundles(box);
    });
    box.appendChild(add);
  }

  function bundleTotal(id) {
    var node = $('bun-' + id + '-total');
    if (!node) return;
    var n = readNum('bun-' + id + '-entries');
    var p = readNum('bun-' + id + '-price');
    node.textContent = (n > 0 && p != null)
      ? n + ' sessions · €' + (n * p).toFixed(2) + ' in total'
      : 'Entries, price per entry and a validity window are all required.';
  }

  function syncBundles() {
    S.bundles = (S.bundles || []).map(function (b) {
      return {
        bundleId: b.bundleId,
        entries: $('bun-' + b.bundleId + '-entries') ? readNum('bun-' + b.bundleId + '-entries') : b.entries,
        pricePerEntry: $('bun-' + b.bundleId + '-price') ? readNum('bun-' + b.bundleId + '-price') : b.pricePerEntry,
        validityDays: $('bun-' + b.bundleId + '-days') ? readNum('bun-' + b.bundleId + '-days') : b.validityDays
      };
    });
    return S.bundles;
  }

  function mintGroupId() {
    return 'g-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ---------- the groups ------------------------------------------------------
  //
  // ⚠ A GROUP IS THE UNIT, AND THERE IS ALWAYS AT LEAST ONE. This was a list of
  // "named groups" — opt-in, usually absent, differing from each other only in
  // size and later in when they met — sitting inside a fact called "group size".
  // Everything else about a class was one answer for the whole activity, so an
  // activity running a Hebrew group with Dorit on Thursdays and a Russian group
  // with Anat on Sundays could not say so: it published one age range, one
  // language, one teacher list and one room for two classes sharing none of them.
  //
  // So the list came first. A group carries its own ages, schedule, dates,
  // language, level, location, address, places and teachers. What stays on the
  // activity is what is genuinely one answer whichever group a family joins —
  // the price, the words, the pictures, the search metadata.
  //
  // ⚠ ONE GROUP IS NOT A CHOICE. The family is asked which group they want when,
  // and only when, there are TWO OR MORE. With one, the group is assigned, its
  // name is not published and the page renders exactly as it always did — which
  // is what keeps naming a group a promise to a family rather than a side effect
  // of the data model. That is also why the first row is a real, renamable group
  // now rather than a row called "Everyone": there is no implicit default left
  // to explain, because a group is a group from the start.
  //
  // ⚠ EQUAL TOTAL HOURS. Groups may meet a different number of times for a
  // different length — six two-hour meetings and twelve one-hour ones are both
  // twelve hours — and may not differ in how much of it there is, because there
  // is one price and it buys the same teaching. Refused on save, naming both
  // groups and both totals.
  //
  // Ids are minted from the clock, never from list position — the same rule the
  // repeatable lists learned when removing a row reissued an id and merged two
  // items' state. Here it would be worse: a group id is what a registration
  // points at, so a reused one attaches a child to the wrong group.
  function mintGroupId() {
    return 'g-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function groupById(groupId) {
    return (S.groups || []).filter(function (g) { return g.groupId === groupId; })[0] || null;
  }

  function groupLabel(g) {
    return ['en', 'he', 'ru'].map(function (l) { return ((g || {}).name || {})[l]; })
      .filter(Boolean)[0] || 'Unnamed group';
  }

  function liveDates(list) {
    return (list || []).filter(function (r) { return r && r.status !== 'excluded'; });
  }

  // "Wednesdays 16:00 · 11 dates · up to 20". A summary rather than the fields,
  // because the fields are one click away and a list of them is what this list
  // exists not to be.
  function groupSummary(g) {
    var f = g.facts || {};
    var sch = f.schedule || {};
    var bits = [];
    var said = (sch.sessions || []).map(function (x) {
      var day = x.day == null ? '' : DAY_NAMES[x.day];
      return [x.date || day, x.time].filter(Boolean).join(' ');
    }).filter(Boolean);
    bits.push(said.length ? said.join(' \u00b7 ') : 'No schedule yet');
    var dates = ((f.duration || {}).sessionDates) || [];
    bits.push(dates.length ? liveDates(dates).length + ' dates' : 'no dates');
    if (g.capacity != null && g.capacity !== '') bits.push('up to ' + g.capacity);
    return bits.join(' \u00b7 ');
  }

  // Sessions × minutes, for the price preview on the main form.
  //
  // The duration fields are a GROUP's now and are not on this screen, so the
  // preview reads the model. Any group answers, because the totals are equal by
  // the rule the server refuses a save over — and while a group's own page is
  // open its live edits answer instead, so the figure follows what is being
  // typed rather than what was last committed.
  function priceBasisDuration() {
    if (S.ownerEdit) {
      return {
        sessionCount: liveDates(S.ownerEdit.dates).length ||
                      readNum(GROUP_PREFIX + '-duration-sessionCount'),
        sessionMinutes: readNum(GROUP_PREFIX + '-duration-sessionMinutes')
      };
    }
    var d = (((S.groups || [])[0] || {}).facts || {}).duration || {};
    return {
      sessionCount: liveDates(d.sessionDates).length || d.sessionCount,
      sessionMinutes: d.sessionMinutes
    };
  }

  function blankGroupFacts() {
    var out = {};
    (S.schema.groupFacts || []).forEach(function (k) { out[k] = {}; });
    out.schedule = { frequency: 'weekly', weekOfMonth: 1, sessions: [] };
    out.duration = { startDate: '', endDate: '', sessionCount: null,
                     sessionMinutes: null, sessionDates: [] };
    return out;
  }

  function groupsEditor() {
    var box = el('div', { id: 'group-list' });
    drawGroups(box);
    return box;
  }

  function drawGroups(box) {
    box.innerHTML = '';
    var list = S.groups || [];
    box.appendChild(el('div', { class: 'hint', text: list.length > 1
      ? 'This activity has more than one group, so a family CHOOSES one when they register \u2014 ' +
        'the names are published, they go on the roster and on every receipt, and each group ' +
        'keeps its own ages, teachers, language, level, room and timetable. Every group has ' +
        'to add up to the same number of teaching hours, because there is one price.'
      : 'One group, so nobody is asked to choose: the name is not published and the family is ' +
        'assigned to it. Everything about the class \u2014 ages, teachers, language, level, room, ' +
        'timetable \u2014 is set on its page. Add a second group only when a family genuinely has ' +
        'to pick between them.' }));

    list.forEach(function (g) {
      var open = el('button', { type: 'button', class: 'add-btn', text: 'Open this group \u2192',
                                disabled: !canEditAll() || null });
      open.addEventListener('click', function () { openGroupPage(g.groupId); });
      // ⚠ DUPLICATE MINTS A FRESH ID. Reusing one would attach last term's
      // registrations to a group nobody registered for — which is also why
      // delete-and-recreate produces a new activityId.
      var copy = el('button', { type: 'button', class: 'add-btn', text: 'Duplicate',
                                disabled: !canEditAll() || null });
      copy.addEventListener('click', function () { duplicateGroup(g.groupId, box); });
      box.appendChild(el('div', { class: 'item' }, [
        el('div', { class: 'owner-row' }, [
          el('span', { class: 'owner-name', text: list.length > 1 ? groupLabel(g) : (groupLabel(g) === 'Unnamed group' ? 'The class' : groupLabel(g)) }),
          el('span', { class: 'owner-when', text: groupSummary(g) }),
          copy, open
        ])
      ]));
    });

    var add = el('button', { type: 'button', class: 'add-btn', text: '+ Add a group',
                             disabled: !canEditAll() || null });
    add.addEventListener('click', function () {
      S.groups.push({ groupId: mintGroupId(), name: { he: '', en: '', ru: '' },
                      capacity: null, teacherIds: [], facts: blankGroupFacts() });
      S.dirty = true;
      drawGroups(box);
    });
    box.appendChild(add);
  }

  // ⚠ A WHOLE GROUP, COPIED AS A STARTING POINT. Two groups of one activity
  // usually differ in one or two things and agree about the rest, so starting
  // from a copy and editing down is fewer fields than filling a blank one in —
  // and fewer fields is fewer forgotten. The name gains a suffix rather than
  // being blanked, because an unnamed second group is refused on save and a
  // silent blank would read as the copy having failed.
  function duplicateGroup(groupId, box) {
    var g = groupById(groupId);
    if (!g) return;
    var copy = JSON.parse(JSON.stringify(g));
    copy.groupId = mintGroupId();
    ['he', 'en', 'ru'].forEach(function (l) {
      var v = String((copy.name || {})[l] || '').trim();
      copy.name[l] = v ? v + ' (copy)' : '';
    });
    S.groups.push(copy);
    S.dirty = true;
    drawGroups(box);
  }

  // ⚠ A SUB-PAGE PER GROUP, not more fields on the list.
  //
  // A group is a name, a number of places, a teacher list, seven facts, a
  // timetable and a calendar of ten or more dates. Inlining that would put all
  // of it on the page once per group, inside a panel meant to answer "who meets
  // when" at a glance.
  //
  // It is a VIEW SWAP rather than a second HTML page on purpose: the record is
  // already loaded and already dirty-tracked here, the save path and the
  // optimistic lock are one, and a real second page would have to re-implement
  // all three to edit a slice of the same record.
  function openGroupPage(groupId) {
    var g = groupById(groupId);
    if (!g) return;

    // A working copy. Edits live here until the sub-page is left, so a group
    // half-edited and abandoned does not leave the record in that state.
    var f = JSON.parse(JSON.stringify(g.facts || blankGroupFacts()));
    (S.schema.groupFacts || []).forEach(function (k) { if (!f[k]) f[k] = {}; });
    var sch = f.schedule || {};
    S.ownerEdit = {
      groupId: groupId,
      name: langObj(g.name),
      capacity: g.capacity == null ? null : g.capacity,
      teacherIds: (g.teacherIds || []).slice(),
      facts: f,
      freq: sch.frequency || 'weekly',
      weekOfMonth: sch.weekOfMonth == null ? 1 : sch.weekOfMonth,
      sessions: (sch.sessions || []).map(function (x) {
        return { day: x.day == null ? null : Number(x.day), time: x.time || '', date: x.date || null };
      }),
      dates: (((f.duration || {}).sessionDates) || []).map(function (r) {
        return { date: r.date, status: r.status === 'excluded' ? 'excluded' : 'scheduled',
                 reason: r.reason || '' };
      })
    };

    // There is no single form wrapper to hide — the panels are direct children
    // of .main — so the swap is done by hiding them. Hidden rather than
    // detached, because every editor on them holds live nodes and ids that the
    // read-back walks on save; removing them would empty the record.
    var main = document.querySelector('.main');
    if (!main) return;
    var page = $('group-page');
    if (!page) {
      page = el('div', { id: 'group-page' });
      main.insertBefore(page, main.firstChild);
    }
    Array.prototype.forEach.call(main.children, function (n) {
      if (n !== page) n.hidden = true;
    });
    page.hidden = false;
    drawOwnerPage(page);
    if (page.scrollIntoView) page.scrollIntoView();
  }

  function closeOwnerPage() {
    var main = document.querySelector('.main');
    var page = $('group-page');
    if (page) { page.hidden = true; page.innerHTML = ''; }
    if (main) {
      Array.prototype.forEach.call(main.children, function (n) {
        if (n !== page) n.hidden = false;
      });
    }
    S.ownerEdit = null;
    // The list summarises each group's timetable and places, so it has to be
    // redrawn on the way back or it still says what was true before.
    var box = $('group-list');
    if (box) drawGroups(box);
    refreshPerHour();
    refreshLegacyNotes();
  }

  var GROUP_PREFIX = 'grp';

  function factDescriptor(key) {
    return (S.schema.facts || []).filter(function (d) { return d.key === key; })[0];
  }

  // ⚠ THE READ-BACK FOR ONE FACT, KEYED BY THE SAME PREFIX THE EDITOR DREW WITH.
  // One function for both screens: a field the form renders and the read-back
  // misses saves successfully and loses the value with nothing looking wrong,
  // and two copies of this is exactly how that happens.
  function readFactEditor(d, p, previous) {
    previous = previous || {};
    var out;
    if (d.kind === 'text') out = readLangField(p + '-' + d.key);
    else if (d.kind === 'location') out = { text: readLangField(p + '-' + d.key) };
    else if (d.kind === 'languages') {
      out = {
        codes: (S.schema.instructionLanguages || []).map(function (o) { return o.key; })
          .filter(function (k) {
            var box = document.getElementById(p + '-lang-' + k);
            return box && box.checked;
          }),
        text: readLangField(p + '-' + d.key)
      };
    } else if (d.kind === 'level') {
      var lvl = document.getElementById(p + '-level');
      out = { level: (lvl && lvl.value) || null, text: readLangField(p + '-' + d.key) };
    } else if (d.kind === 'ages') {
      out = { min: readNum(p + '-ages-min'), max: readNum(p + '-ages-max') };
    } else if (d.kind === 'duration') {
      out = {
        startDate: ($(p + '-duration-startDate') || {}).value || '',
        endDate: ($(p + '-duration-endDate') || {}).value || '',
        sessionCount: readNum(p + '-duration-sessionCount'),
        sessionMinutes: readNum(p + '-duration-sessionMinutes'),
        // The calendar is the source of truth for what the page prints and what
        // a refund is divided by, so it travels with every save. It was absent
        // from the canonical shape once and every save deleted it.
        sessionDates: previous.sessionDates || []
      };
    } else if (d.kind === 'groupSize') {
      out = { overrideText: readLangField(p + '-groupSize-overrideText') };
    } else if (d.kind === 'price') {
      out = {
        registrationFee: readNum(p + '-price-registrationFee'),
        perHourOverride: readNum(p + '-price-perHourOverride'),
        showPerLesson: readBool(p + '-price-showPerLesson')
      };
      // ⚠ ONLY WHAT WAS DRAWN. Sending the other as null is how a term price
      // gets cleared by an admin who only changed the type — and the same is
      // true of the bundle list, which is several products rather than one
      // number. A course draws none of these and sends none of them; the server
      // keeps what it already had.
      if (currentType() === 'dropin') {
        out.perSessionPrice = readNum(p + '-price-perSessionPrice');
        out.lateDropIn = {
          enabled: readBool(p + '-price-late-enabled'),
          hoursBefore: readNum(p + '-price-late-hoursBefore'),
          price: readNum(p + '-price-late-price')
        };
        out.bundles = syncBundles();
      } else out.fullPrice = readNum(p + '-price-fullPrice');
    } else out = {};

    // Carry the legacy sentence through untouched. It is what the page still
    // shows for anything not yet filled in, and a save must not drop it.
    if (d.kind !== 'text' && previous.legacyText) out.legacyText = previous.legacyText;
    return out;
  }

  // ⚠ ONLY THE SCHEDULE ROWS ARE READ BACK FROM THE DOM among the timetable
  // fields. The calendar is not: sessionCalendarBox() hands its list to onChange
  // on every edit, so e.dates is already current. It used to be walked by id
  // here, which put the meaning of a ticked box in a second place that had to
  // agree with where it was drawn — and they did agree, on the wrong answer.
  function readOwnerEdit() {
    var e = S.ownerEdit;
    if (!e) return null;
    e.sessions = readScheduleRows(GROUP_PREFIX, e.sessions.length);
    var freqNode = $(GROUP_PREFIX + '-frequency');
    if (freqNode) e.freq = freqNode.value;
    var wom = $(GROUP_PREFIX + '-weekOfMonth');
    if (wom) e.weekOfMonth = wom.value === 'last' ? 'last' : Number(wom.value);
    if ($(GROUP_PREFIX + '-name-he')) e.name = readLangField(GROUP_PREFIX + '-name');
    var cap = $(GROUP_PREFIX + '-cap');
    if (cap) e.capacity = cap.value !== '' ? Number(cap.value) : null;
    // Teachers by REFERENCE — the roster is the activity's and a group says
    // which of them it has, so one photograph is one file however many groups a
    // person teaches. An empty list means the whole roster rather than nobody.
    var picked = [];
    (S.lists.teachers ? S.lists.teachers.sync() : []).forEach(function (t) {
      var box = $(GROUP_PREFIX + '-teacher-' + t.id);
      if (box && box.checked) picked.push(t.id);
    });
    if ($(GROUP_PREFIX + '-teacher-all')) {
      e.teacherIds = $(GROUP_PREFIX + '-teacher-all').checked ? [] : picked;
    }
    (S.schema.groupFacts || []).forEach(function (key) {
      if (key === 'schedule') return;
      var d = factDescriptor(key);
      if (!d) return;
      e.facts[key] = readFactEditor(d, GROUP_PREFIX, e.facts[key]);
    });
    return e;
  }

  // Back into the model the save reads.
  function commitOwnerEdit() {
    var e = readOwnerEdit();
    if (!e) return;
    var rows = e.sessions.filter(function (x) { return x.day != null || x.time || x.date; });
    var facts = e.facts;
    facts.schedule = { frequency: e.freq, sessions: rows };
    if (e.freq === 'monthly') facts.schedule.weekOfMonth = e.weekOfMonth;
    facts.duration = Object.assign({}, facts.duration, { sessionDates: e.dates || [] });

    S.groups = (S.groups || []).map(function (g) {
      if (g.groupId !== e.groupId) return g;
      return { groupId: g.groupId, name: e.name, capacity: e.capacity,
               teacherIds: (e.teacherIds || []).slice(), facts: JSON.parse(JSON.stringify(facts)) };
    });
    S.dirty = true;
  }

  function drawOwnerPage(page) {
    page.innerHTML = '';
    var e = S.ownerEdit;
    var many = (S.groups || []).length > 1;

    // The back button is also the COMMIT. Edits live on a working copy until
    // this is pressed, so a group opened and abandoned leaves the record as it
    // was — and the label says so, because a button that quietly discards is
    // the same button as one that quietly keeps.
    var back = el('button', { type: 'button', class: 'add-btn',
                              text: '← Back to the activity · keeps these changes' });
    back.addEventListener('click', function () { commitOwnerEdit(); closeOwnerPage(); });

    page.appendChild(el('div', { class: 'panel' }, [
      back,
      el('h2', { text: many ? 'Group · ' + groupLabel({ name: e.name }) : 'The class' }),
      el('div', { class: 'hint', text: many
        ? 'Everything about this group. A family picks between the groups by NAME when they ' +
          'register, so it is required — and every group has to add up to the same number of ' +
          'teaching hours, because one price buys the activity whichever one they join.'
        : 'Everything about this class. With one group nobody is asked to choose: the name is ' +
          'not published and a family is simply assigned to it, so it can be left blank.' })
    ]));

    // --- who they are --------------------------------------------------------
    var who = el('div', { class: 'panel' });
    who.appendChild(el('h3', { text: 'Who they are' }));
    who.appendChild(fieldRow({
      label: 'Group name',
      hint: many
        ? 'What a family picks between when they register. Required once there is more than one.'
        : 'Not published while this is the only group, and not asked for. Name it when a second ' +
          'group arrives and the family has a choice to make.'
    }, e.name, GROUP_PREFIX + '-name'));

    var cap = el('input', { type: 'number', min: '1', step: '1', id: GROUP_PREFIX + '-cap',
                            disabled: !canEditAll() || null });
    cap.value = e.capacity == null ? '' : e.capacity;
    cap.addEventListener('input', function () { S.dirty = true; });
    var remove = el('button', { type: 'button', class: 'del', text: 'Remove this group',
                                disabled: !canEditAll() || !many || null,
                                title: many ? null : 'An activity needs at least one group.' });
    remove.addEventListener('click', function () {
      S.groups = (S.groups || []).filter(function (g) { return g.groupId !== e.groupId; });
      S.dirty = true;
      S.ownerEdit = null;
      closeOwnerPage();
    });
    who.appendChild(el('div', { class: 'fact-grid' }, [
      el('div', {}, [el('label', { for: GROUP_PREFIX + '-cap', text: 'Places in this group' }), cap]),
      el('div', {}, [el('label', { text: ' ' }), remove])
    ]));
    who.appendChild(teacherPicker(e));
    page.appendChild(who);

    // --- the facts this group answers for -----------------------------------
    var factsBox = el('div', { class: 'panel' });
    factsBox.appendChild(el('h3', { text: 'What it is' }));
    (S.schema.groupFacts || []).forEach(function (key) {
      if (key === 'schedule' || key === 'duration') return;
      var d = factDescriptor(key);
      var block = d && factBlock(d, e.facts[key], GROUP_PREFIX);
      if (block) factsBox.appendChild(block);
    });
    page.appendChild(factsBox);

    // --- when they meet ------------------------------------------------------
    var schedBox = el('div', { class: 'panel' });
    schedBox.appendChild(el('h3', { text: 'When they meet' }));
    var durD = factDescriptor('duration');
    if (durD) {
      var durBlock = factBlock(durD, e.facts.duration, GROUP_PREFIX);
      if (durBlock) schedBox.appendChild(durBlock);
    }
    var freqSel = el('select', { id: GROUP_PREFIX + '-frequency', disabled: !canEditAll() || null });
    (S.schema.frequencies || []).forEach(function (f) {
      freqSel.appendChild(el('option', { value: f.key, text: f.label, selected: f.key === e.freq || null }));
    });
    freqSel.addEventListener('change', function () {
      e.sessions = readScheduleRows(GROUP_PREFIX, e.sessions.length);
      e.freq = freqSel.value;
      S.dirty = true;
      drawOwnerPage(page);
    });

    // Which week of the month, for a monthly activity only. 'last' is a real
    // option rather than an error state: a month with only four of that weekday
    // uses the last one instead of inventing a fifth.
    var cells = [el('div', {}, [el('label', { for: GROUP_PREFIX + '-frequency', text: 'How often' }), freqSel])];
    if (e.freq === 'monthly') {
      var wsel = el('select', { id: GROUP_PREFIX + '-weekOfMonth', disabled: !canEditAll() || null });
      (S.schema.weeksOfMonth || []).forEach(function (w) {
        wsel.appendChild(el('option', { value: String(w.key), text: w.label,
          selected: String(w.key) === String(e.weekOfMonth) || null }));
      });
      wsel.addEventListener('change', function () {
        e.weekOfMonth = wsel.value === 'last' ? 'last' : Number(wsel.value);
        S.dirty = true;
      });
      cells.push(el('div', {}, [el('label', { for: GROUP_PREFIX + '-weekOfMonth', text: 'Which week' }), wsel]));
    }
    schedBox.appendChild(el('div', { class: 'fact-grid' }, cells));

    // ⚠ A FREQUENCY THAT NAMES A COUNT GETS EXACTLY THAT MANY ROWS. The
    // activity's own editor padded and trimmed to it and a group's did not, so a
    // group could be set to "twice weekly" and given one day — which enumerates
    // half a term with nothing erroring. One editor, one rule.
    var spec = (S.schema.frequencies || []).filter(function (f) { return f.key === e.freq; })[0];
    var wanted = spec && spec.sessions;
    if (wanted) {
      while (e.sessions.length < wanted) e.sessions.push({ day: null, time: '', date: null });
      e.sessions = e.sessions.slice(0, wanted);
    }
    if (!wanted && !e.sessions.length) e.sessions.push({ day: null, time: '', date: null });

    schedBox.appendChild(scheduleRowBox({
      prefix: GROUP_PREFIX, freq: e.freq, sessions: e.sessions,
      onChange: function () { S.dirty = true; },
      onAdd: wanted ? null : function () {
        e.sessions = readScheduleRows(GROUP_PREFIX, e.sessions.length);
        e.sessions.push({ day: null, time: '', date: null });
        S.dirty = true; drawOwnerPage(page);
      },
      onRemove: wanted ? null : function (i) {
        e.sessions = readScheduleRows(GROUP_PREFIX, e.sessions.length);
        e.sessions.splice(i, 1);
        S.dirty = true; drawOwnerPage(page);
      }
    }));
    page.appendChild(schedBox);

    // --- the dates -----------------------------------------------------------
    var calBox = el('div', { class: 'panel' });
    calBox.appendChild(el('h3', { text: 'The dates they meet on' }));
    calBox.appendChild(sessionCalendarBox({
      prefix: GROUP_PREFIX,
      dates: e.dates || [],
      canEdit: canEditAll(),
      lead: 'This list is what the page prints and what a cancellation is prorated against ' +
            'for this group, so the session count is taken from it rather than from the ' +
            'number typed above.',
      empty: 'None yet. Generate them from the schedule above and the start date. Without a ' +
             'calendar the page shows no session table and prorated cancellation cannot be used.',
      generateLabel: { generate: 'Generate the dates', regenerate: 'Regenerate from the schedule' },
      onGenerate: function () { generateOwnerSessions(page); },
      onChange: function (next, o) {
        e.dates = next;
        S.dirty = true;
        if (!(o && o.quiet)) drawOwnerPage(page);
      }
    }));
    page.appendChild(calBox);
  }

  // ⚠ TEACHERS BY REFERENCE, NOT BY COPY. The roster is the activity's — one
  // person, one row, one photograph — and a group names which of them it has.
  // A list per group would upload the same face twice and produce two files
  // under two names, and the whole image pipeline keys off the roster's ids.
  //
  // "All of them" is the default and is stored as an EMPTY list rather than as
  // every id: writing the roster out would freeze it, so a teacher added next
  // month would appear in the credits and in no group.
  function teacherPicker(e) {
    var box = el('div', { style: 'margin-top:14px;' });
    box.appendChild(el('div', { class: 'field-label', text: 'Teachers' }));
    var roster = S.lists.teachers ? S.lists.teachers.sync() : [];
    if (!roster.length) {
      box.appendChild(el('div', { class: 'hint', text:
        'Add them on the Teachers panel first, then choose which of them take this group.' }));
      return box;
    }
    var all = el('input', { type: 'checkbox', id: GROUP_PREFIX + '-teacher-all',
                            disabled: !canEditAll() || null });
    all.checked = !(e.teacherIds || []).length;
    var checks = el('div', { class: 'fact-checks' });
    roster.forEach(function (t) {
      var id = GROUP_PREFIX + '-teacher-' + t.id;
      var cb = el('input', { type: 'checkbox', id: id, disabled: !canEditAll() || all.checked || null });
      cb.checked = (e.teacherIds || []).indexOf(t.id) !== -1;
      cb.addEventListener('change', function () { S.dirty = true; });
      var name = ['en', 'he', 'ru'].map(function (l) { return (t.name || {})[l]; })
        .filter(Boolean)[0] || 'Unnamed';
      checks.appendChild(el('label', { class: 'fact-check', for: id }, [cb, el('span', { text: name })]));
    });
    all.addEventListener('change', function () {
      S.dirty = true;
      Array.prototype.forEach.call(checks.querySelectorAll('input'), function (n) {
        n.disabled = all.checked || !canEditAll();
      });
    });
    box.appendChild(el('label', { class: 'fact-check', for: GROUP_PREFIX + '-teacher-all' },
      [all, el('span', { text: 'Everyone on the activity’s roster' })]));
    box.appendChild(checks);
    return box;
  }

  function generateOwnerSessions(page) {
    var e = readOwnerEdit();
    send({
      action: 'sessions',
      schedule: { frequency: e.freq, sessions: e.sessions,
                  weekOfMonth: e.freq === 'monthly' ? e.weekOfMonth : '' },
      duration: {
        startDate: ($(GROUP_PREFIX + '-duration-startDate') || {}).value || '',
        endDate: ($(GROUP_PREFIX + '-duration-endDate') || {}).value || '',
        sessionCount: readNum(GROUP_PREFIX + '-duration-sessionCount'),
        sessionDates: e.dates
      }
    }).then(function (res) {
      if (!res.ok) { message('err', failure(res, 'generate the sessions')); return; }
      var rows = res.data.sessionDates || [];
      if (!rows.length) {
        message('err', 'Nothing to generate. A calendar needs a start date, a day of the week, ' +
          'and either an end date or a number of sessions — and a custom frequency cannot be ' +
          'generated at all, because it is whatever you typed. Clear the dates and type them ' +
          'on the schedule above instead.');
        return;
      }
      e.dates = rows.map(function (r) {
        return { date: r.date, status: r.status, reason: r.reason || '' };
      });
      S.dirty = true;
      drawOwnerPage(page);
      // The disagreement between a typed count and the span it is supposed to
      // cover, surfaced while an admin is here to settle it.
      message(res.data.note ? 'warn' : 'ok',
        res.data.note || (rows.length + ' dates generated. Nothing is saved until you save.'));
    });
  }

  function canEditAll() {
    return ['he', 'en', 'ru'].every(function (l) { return canEdit(l); });
  }

  // ⚠ THE MODEL IS PRIMED BEFORE ANY PANEL IS DRAWN, and it has to be: the
  // Activity facts panel draws the group list, and the price preview inside it
  // reads a group's session length.
  //
  // It is also what makes the sub-page safe. Nothing about a group has an input
  // on the main form, so the save reads THIS rather than walking the DOM — the
  // undrawn-field rule this project keeps meeting: absent from the screen must
  // never mean cleared on the record.
  function primeGroups() {
    S.groups = ((S.record.groups) || []).map(function (g) {
      var f = JSON.parse(JSON.stringify(g.facts || {}));
      (S.schema.groupFacts || []).forEach(function (k) { if (!f[k]) f[k] = {}; });
      return {
        groupId: g.groupId || mintGroupId(),
        name: langObj(g.name),
        capacity: g.capacity == null ? null : g.capacity,
        teacherIds: (g.teacherIds || []).slice(),
        facts: f
      };
    });
    // An activity with none is one being created. It gets a group here so the
    // form has something to draw, and the server mints one too for a record
    // that reaches it without — neither can be the only place, because a
    // preview goes through the server and a blank form does not.
    if (!S.groups.length) {
      S.groups = [{ groupId: mintGroupId(), name: { he: '', en: '', ru: '' },
                    capacity: null, teacherIds: [], facts: blankGroupFacts() }];
    }
    S.ownerEdit = null;
  }

  // ⚠ THREE PANELS, NOT ONE, and the split is by the question being answered
  // rather than by which record the value lives on. "Activity facts" held the
  // group list, the free-text override, four price fields, the late-booking
  // block, the bundle list and nine visibility checkboxes under one heading —
  // three unrelated jobs in one scroll.
  //
  // Seven of the nine facts are a GROUP's and are edited on its own page.
  // Drawing them here as well would be two screens answering one question,
  // which is the shape that gave this codebase a checkbox meaning opposite
  // things in two editors a release apart.
  //
  // The mount points are three and the ids on the inputs are unchanged, so
  // readFacts() is untouched: it reads by id, and an id does not care which
  // panel its input ended up in.
  function renderFacts() {
    primeGroups();
    var groupsBox = $('groups-fields');
    var priceBox = $('price-fields');
    var visBox = $('visibility-fields');
    groupsBox.innerHTML = '';
    priceBox.innerHTML = '';
    visBox.innerHTML = '';

    groupsBox.appendChild(el('div', { class: 'fact-block' }, [groupsEditor()]));

    // groupSize goes with the GROUPS, because what it overrides is the line the
    // list above it produces — not with the price, which is the other activity
    // fact and answers a different question entirely.
    (S.schema.activityFacts || []).forEach(function (key) {
      var d = factDescriptor(key);
      if (!d) return;
      var bare = key === 'groupSize';
      var block = factBlock(d, (S.record.facts || {})[key], 'fact', bare);
      if (block) (key === 'groupSize' ? groupsBox : priceBox).appendChild(block);
    });

    visBox.appendChild(visibilityBlock());
    refreshPerHour();
    refreshLegacyNotes();
  }

  function readFacts() {
    var facts = {};
    var visibility = {};
    // Every fact's flag, whichever screen its VALUE is edited on: visibility is
    // one policy for the activity, and it has one control, on this panel.
    S.schema.facts.forEach(function (d) {
      visibility[d.key] = readBool('fact-vis-' + d.key) ? 'members' : 'public';
    });
    (S.schema.activityFacts || []).forEach(function (key) {
      var d = factDescriptor(key);
      if (d) facts[key] = readFactEditor(d, 'fact', (S.record.facts || {})[key]);
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
    // ⚠ AN OWNER LEFT OPEN IS STILL SAVED. The sub-page holds its edits on a
    // working copy until the back button commits them, and somebody who opens
    // one, changes its schedule and presses Publish without going back would
    // otherwise publish the old one — with the new one on screen in front of
    // them. Committing here makes "what I can see" and "what is saved" the same
    // thing whichever screen is up. It is also why readFacts() does NOT commit:
    // it runs on every keystroke behind the legacy notes, and committing there
    // would mark a form dirty just for being read.
    commitOwnerEdit();
    var facts = readFacts();
    rec.facts = facts.facts;
    rec.factVisibility = facts.factVisibility;
    // ⚠ FROM THE MODEL, NOT FROM THE DOM. Nothing about a group has an input on
    // this screen — a name, a capacity, a teacher list, seven facts, a timetable
    // and a calendar are all on its own page — so a read-back that walked the
    // form would find nothing and save every group emptied.
    rec.groups = S.groups || [];
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
