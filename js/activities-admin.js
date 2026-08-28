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

    box.appendChild(select('f-status', 'Status', S.schema.statuses, rec.status || 'draft', {
      draft: 'Draft (not published)', announcement: 'Announcement', open: 'Open for registration',
      waitlist: 'Waitlist', closed: 'Registration closed', cancelled: 'Cancelled', completed: 'Completed'
    }));
    box.appendChild(select('f-motif', 'Header motif', S.schema.motifs, rec.motif || 'ring'));
    box.appendChild(select('f-corner', 'Motif corner', S.schema.corners, rec.corner || 'tl', {
      tl: 'Top / start', tr: 'Top / end', bl: 'Bottom / start', br: 'Bottom / end'
    }));

    var spots = el('input', { type: 'number', id: 'f-spots', min: '0', value: rec.spots == null ? '' : rec.spots });
    box.appendChild(el('div', {}, [
      el('label', { for: 'f-spots', text: 'Places left' }), spots,
      el('div', { class: 'hint', text: 'Shown only when status is Open' })
    ]));

    // Hero image
    var heroPreview = el('img', {
      src: S.images.hero || rec.heroImage || '',
      alt: '', style: 'width:60px;height:40px;object-fit:cover;border-radius:5px;background:#EEE7D8;'
    });
    var heroInput = el('input', { type: 'file', accept: 'image/*', id: 'f-hero', style: 'font-size:12px;' });
    heroInput.addEventListener('change', function () {
      readImage(heroInput, function (dataUrl) { S.images.hero = dataUrl; heroPreview.src = dataUrl; S.dirty = true; });
    });
    box.appendChild(el('div', {}, [
      el('label', { text: 'Hero image' }),
      el('div', { style: 'display:flex;gap:8px;align-items:center;' }, [heroPreview, heroInput])
    ]));

    var ctaBox = el('div', { style: 'grid-column:1/-1;' });
    ctaBox.appendChild(fieldRow({ label: 'Registration button link', hint: 'Where the CTA sends people, per language' },
      langObj(rec.ctaUrl), 'f-ctaUrl'));
    box.appendChild(ctaBox);
  }

  function readImage(input, cb) {
    var file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      message('err', 'That image is ' + (file.size / 1048576).toFixed(1) + 'MB. The limit is 3MB.');
      input.value = '';
      return;
    }
    var reader = new FileReader();
    reader.onload = function () { cb(reader.result); };
    reader.readAsDataURL(file);
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
    $('facts').innerHTML = '';
    S.schema.facts.forEach(function (d) {
      $('facts').appendChild(fieldRow(d, langObj((rec.facts || {})[d.key]), 'fact-' + d.key));
    });
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
            var img = el('img', { src: S.images[item.id] || item[spec.image] || '', alt: '' });
            var file = el('input', { type: 'file', accept: 'image/*', style: 'font-size:12px;',
              disabled: structureLocked || null });
            file.addEventListener('change', function () {
              readImage(file, function (dataUrl) { S.images[item.id] = dataUrl; img.src = dataUrl; S.dirty = true; });
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
    var spots = $('f-spots').value;
    rec.spots = spots === '' ? null : Number(spots);
    rec.ctaUrl = readLangField('f-ctaUrl');
    if (S.images.hero) rec.heroImage = S.images.hero;
    else if (S.record.heroImage) rec.heroImage = S.record.heroImage;

    S.schema.simple.concat(S.schema.optional).forEach(function (d) {
      rec[d.key] = readLangField('f-' + d.key);
    });
    rec.facts = {};
    S.schema.facts.forEach(function (d) { rec.facts[d.key] = readLangField('fact-' + d.key); });

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
  function send(body) { return window.AdminSession.post(API, body); }

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
      if (!res.ok) return message('err', res.data.error || 'Could not load the list');
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
          el('span', { class: 'pill ' + a.status, text: a.status })
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
      if (!res.ok) return message('err', res.data.error || 'Could not load that activity');
      fillForm(res.data.activity, res.data.baseUpdatedAt);
      if (res.data.source === 'draft') {
        message('warn', 'You are editing a <b>draft</b>. It has no page on the site until you publish it.');
      }
      refreshList(slug);
    });
  }

  function blankRecord() {
    var rec = { slug: '', status: 'draft', motif: 'ring', corner: 'tl', spots: null,
                facts: {}, included: [], faq: [], teachers: [], sponsors: [] };
    return rec;
  }

  // ---------- actions ----------
  function doPreview() {
    message('');
    if (!requireSlug()) return;
    var activity = readForm();
    send({ action: 'preview', activity: activity }).then(function (res) {
      if (!res.ok) return message('err', (res.data.validation || [res.data.error]).join(' · '));
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
    // srcdoc: no preview server, no draft URL, nothing to clean up.
    $('preview-frame').srcdoc = d.html[S.previewLang] || '';
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
        if (!res.ok) return message('err', (res.data.validation || [res.data.error]).join(' · '));
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
        if (!res.ok) return message('err', (res.data.validation || [res.data.error]).join(' · '));
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
      if (!res.ok) return message('err', res.data.error || 'Could not unpublish');
      message('ok', 'Unpublished — the pages are gone from the site and it is a draft again. ' +
        '<a href="' + res.data.commit.url + '" target="_blank" rel="noopener">View the commit</a>.');
      load(S.slug);
    });
  }

  function doDelete() {
    var typed = window.prompt('This deletes the activity permanently — pages, source and draft.\n\nType the slug to confirm:\n' + S.slug);
    if (typed !== S.slug) return message('warn', 'Deletion cancelled.');
    send({ action: 'delete', slug: S.slug, confirmSlug: typed }).then(function (res) {
      if (!res.ok) return message('err', res.data.error || 'Could not delete');
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
