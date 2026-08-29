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

  function readLangField(idPrefix) {
    var out = {};
    S.schema.langs.forEach(function (lang) {
      var node = $(idPrefix + '-' + lang);
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

    box.appendChild(select('f-status', 'Status', S.schema.statuses, rec.status || 'draft', STATUS_SELECT));
    box.appendChild(select('f-motif', 'Header motif', S.schema.motifs, rec.motif || 'ring'));
    box.appendChild(select('f-corner', 'Motif corner', S.schema.corners, rec.corner || 'tl', {
      tl: 'Top / start', tr: 'Top / end', bl: 'Bottom / start', br: 'Bottom / end'
    }));

    // Hero image
    var ctaBox = el('div', { style: 'grid-column:1/-1;' });
    ctaBox.appendChild(fieldRow({ label: 'Registration button link', hint: 'Where the CTA sends people, per language' },
      langObj(rec.ctaUrl), 'f-ctaUrl'));
    box.appendChild(ctaBox);
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
    $('fields').innerHTML = '';
    S.schema.simple.forEach(function (d) {
      $('fields').appendChild(fieldRow(d, langObj(rec[d.key]), 'f-' + d.key));
    });
    $('optional-fields').innerHTML = '';
    S.schema.optional.forEach(function (d) {
      $('optional-fields').appendChild(fieldRow(d, langObj(rec[d.key]), 'f-' + d.key));
    });
    renderFacts();
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

  // The visibility flag every fact carries. Nothing enforces it yet — there is
  // no registration system, so there is nobody who could be a member — but the
  // shape is here so switching it on later is a config change, not a rebuild.
  // The same "build the shape now, enforce later" move as draft status.
  function visibilityControl(key) {
    var current = (S.record.factVisibility || {})[key] ||
                  (S.schema.defaultVisibility || {})[key] || 'public';
    var sel = el('select', { id: 'fact-vis-' + key, class: 'vis-select' });
    (S.schema.visibilities || ['public', 'members']).forEach(function (v) {
      sel.appendChild(el('option', {
        value: v,
        text: v === 'public' ? 'Public' : 'Members only',
        selected: v === current || null
      }));
    });
    sel.addEventListener('change', function () { S.dirty = true; });
    return el('div', { class: 'fact-vis' }, [
      el('label', { for: 'fact-vis-' + key, text: 'Visibility' }),
      sel,
      el('div', { class: 'hint', text: 'Everything is published for now — there is no members area yet.' })
    ]);
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
    if (kind === 'ages') return f.min != null || f.max != null;
    if (kind === 'schedule') return (f.sessions || []).length > 0;
    if (kind === 'duration') {
      return !!f.startDate || !!f.endDate || pos(f.sessionCount) || pos(f.sessionMinutes);
    }
    if (kind === 'groupSize') return pos(f.groups) || pos(f.maxPerGroup);
    if (kind === 'price') {
      return pos(f.registrationFee) || pos(f.fullPrice) || f.perHourOverride != null;
    }
    if (kind === 'location') {
      return S.schema.langs.some(function (l) { return ((f.text || {})[l] || '').trim(); });
    }
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
  function refreshPerHour() {
    var note = $('perhour-note');
    if (!note) return;
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
      body = fieldRow({ label: 'Text' }, langObj(fact.text), 'fact-location');
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
      body = el('div', {}, [
        el('div', { class: 'fact-grid' }, [
          el('div', {}, [el('label', { for: 'fact-schedule-frequency', text: 'How often' }), freqSel])
        ]),
        scheduleRows(fact)
      ]);
    } else if (d.kind === 'duration') {
      body = el('div', { class: 'fact-grid' }, [
        dateField('fact-duration-startDate', 'Starts', fact.startDate),
        dateField('fact-duration-endDate', 'Ends', fact.endDate),
        numField('fact-duration-sessionCount', 'Number of sessions', fact.sessionCount),
        numField('fact-duration-sessionMinutes', 'Minutes per session', fact.sessionMinutes)
      ]);
    } else if (d.kind === 'groupSize') {
      body = el('div', { class: 'fact-grid' }, [
        numField('fact-groupSize-groups', 'Number of groups', fact.groups),
        numField('fact-groupSize-maxPerGroup', 'Max per group', fact.maxPerGroup)
      ]);
    } else if (d.kind === 'price') {
      body = el('div', {}, [
        el('div', { class: 'fact-grid' }, [
          numField('fact-price-registrationFee', 'Registration fee (€)', fact.registrationFee),
          numField('fact-price-fullPrice', 'Full course price (€)', fact.fullPrice),
          numField('fact-price-perHourOverride', 'Per hour — manual override (€)', fact.perHourOverride)
        ]),
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
      visibility[d.key] = (($('fact-vis-' + d.key) || {}).value) || 'public';
      var previous = (S.record.facts || {})[d.key] || {};
      var out;
      if (d.kind === 'text') out = readLangField('fact-' + d.key);
      else if (d.kind === 'location') out = { text: readLangField('fact-location') };
      else if (d.kind === 'ages') out = { min: readNum('fact-ages-min'), max: readNum('fact-ages-max') };
      else if (d.kind === 'schedule') {
        out = {
          frequency: ($('fact-schedule-frequency') || {}).value || 'weekly',
          sessions: syncSchedule().filter(function (x) { return x.day != null || x.time; })
        };
      } else if (d.kind === 'duration') {
        out = {
          startDate: ($('fact-duration-startDate') || {}).value || '',
          endDate: ($('fact-duration-endDate') || {}).value || '',
          sessionCount: readNum('fact-duration-sessionCount'),
          sessionMinutes: readNum('fact-duration-sessionMinutes')
        };
      } else if (d.kind === 'groupSize') {
        out = { groups: readNum('fact-groupSize-groups'), maxPerGroup: readNum('fact-groupSize-maxPerGroup') };
      } else if (d.kind === 'price') {
        out = {
          registrationFee: readNum('fact-price-registrationFee'),
          fullPrice: readNum('fact-price-fullPrice'),
          perHourOverride: readNum('fact-price-perHourOverride')
        };
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
            var img = el('img', { src: S.images[item.id] || item[spec.image] || null, alt: '' });
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
    rec.ctaUrl = readLangField('f-ctaUrl');

    S.schema.simple.concat(S.schema.optional).forEach(function (d) {
      rec[d.key] = readLangField('f-' + d.key);
    });
    var facts = readFacts();
    rec.facts = facts.facts;
    rec.factVisibility = facts.factVisibility;

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
    send({ action: 'publish', activity: activity, baseUpdatedAt: S.baseUpdatedAt, overwrite: !!overwrite })
      .then(function (res) {
        applyLocks();
        if (res.status === 409) return showConflict(res.data, doPublish);
        if (!res.ok) return message('err', failure(res, 'Publishing'));
        S.baseUpdatedAt = res.data.baseUpdatedAt;
        S.slug = res.data.slug;
        S.dirty = false;
        message('ok',
          'Published. <a href="' + res.data.commit.url + '" target="_blank" rel="noopener">View the commit</a>. ' +
          'Netlify takes about a minute to deploy, then: ' +
          res.data.liveUrls.map(function (u) { return '<a href="' + u + '" target="_blank" rel="noopener">' + u + '</a>'; }).join(' · '));
        load(S.slug);
      });
  }

  function doUnpublish() {
    if (!window.confirm('Take this activity off the site?\n\nThe pages are deleted and it goes back to being a draft you can keep editing. Nothing is lost.')) return;
    send({ action: 'unpublish', slug: S.slug, baseUpdatedAt: S.baseUpdatedAt }).then(function (res) {
      if (res.status === 409) return showConflict(res.data, function () { doUnpublish(); });
      if (!res.ok) return message('err', failure(res, 'Unpublishing'));
      message('ok', 'Unpublished — the pages are gone from the site and it is a draft again. ' +
        '<a href="' + res.data.commit.url + '" target="_blank" rel="noopener">View the commit</a>.');
      load(S.slug);
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
