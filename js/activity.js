// Activity-page behaviour. Three jobs, all driven by markup the page author
// writes once:
//
//   1. STATUS. <article class="activity" data-status="open"> is the single
//      source of truth. That one value renders both the badge and the sidebar
//      CTA from the STATUS table below — the two can't drift apart because
//      neither is written in the page's HTML.
//   2. CREDITS. Teachers and sponsors are arrays in the page's
//      <script type="application/json" id="activity-credits"> block, so an
//      activity can have one teacher or five without touching the template.
//   3. OPTIONAL FIELDS. A [data-optional] block with no content is REMOVED
//      from the DOM, so an unused field leaves no empty heading behind.
//
// TRANSLATION REVIEW NEEDED: the Hebrew status copy below is approved; the
// English and Russian strings are first-pass translations and have not been
// checked by a native speaker. Same caveat as the Russian homepage copy.

(function() {
  const root = document.querySelector('.activity');
  if (!root) return;

  const lang = (document.documentElement.lang || 'he').toLowerCase().slice(0, 2);
  const pick = (obj) => obj[lang] || obj.he;

  // Each entry: badge text, plus either a `cta` (button + optional note) or a
  // `banner` (plain text, no action).
  const STATUS = {
    draft: {
      badge:  { he:'טיוטה - לא גלוי לציבור', en:'Draft — not publicly visible', ru:'Черновик — не виден публично' },
      banner: { he:'עמוד זה עדיין לא פורסם', en:'This page has not been published yet', ru:'Эта страница ещё не опубликована' }
    },
    // No button. Registration is not open yet, so there is nothing to click
    // through to — a "Register interest" link had to point somewhere, and what
    // it pointed at was the contact form pretending to be a registration.
    // It is a banner for the same reason draft, cancelled and completed are:
    // every status without an action says so the same way, rather than this one
    // being an action that happens to be missing. The wording is the note it
    // used to carry under the button.
    //
    // The `cta` strings are gone rather than kept unused, so nothing in this
    // table describes a button that is never drawn. They come back with the
    // registration system, which is also what would give them a real target.
    announcement: {
      badge:  { he:'בקרוב', en:'Coming soon', ru:'Скоро' },
      banner: { he:'נעדכן אתכם כשההרשמה תיפתח',
                en:"We'll let you know when registration opens",
                ru:'Мы сообщим вам, когда откроется запись' }
    },
    open: {
      badge: { he:'פתוח לרישום', en:'Open for registration', ru:'Открыта запись' },
      cta:   { he:'הרשמה לחוג', en:'Register', ru:'Записаться' }
      // No "places left" note. It was a number an admin typed and then had to
      // remember to decrement, so it was wrong the moment anyone registered.
      // It returns when registration exists to compute it: capacity minus
      // actual sign-ups, not a hand-maintained guess.
    },
    waitlist: {
      badge: { he:'מלא - רשימת המתנה', en:'Full — waiting list', ru:'Мест нет — лист ожидания' },
      cta:   { he:'הצטרפות לרשימת המתנה', en:'Join the waiting list', ru:'Записаться в лист ожидания' },
      note:  { he:'נעדכן אתכם אם יתפנה מקום', en:"We'll be in touch if a place opens up", ru:'Мы свяжемся с вами, если освободится место' }
    },
    closed: {
      badge:    { he:'ההרשמה נסגרה', en:'Registration closed', ru:'Запись закрыта' },
      cta:      { he:'ההרשמה נסגרה', en:'Registration closed', ru:'Запись закрыта' },
      disabled: true
    },
    cancelled: {
      badge:  { he:'בוטל', en:'Cancelled', ru:'Отменено' },
      banner: { he:'הפעילות בוטלה. נרשמים שכבר שילמו יקבלו החזר.',
                en:'This activity has been cancelled. Anyone who has already paid will be refunded.',
                ru:'Занятие отменено. Уже оплатившим участникам будет возвращена оплата.' }
    },
    completed: {
      badge:  { he:'הסתיים', en:'Completed', ru:'Завершено' },
      banner: { he:'הפעילות הסתיימה', en:'This activity has finished', ru:'Занятие завершено' }
    }
  };

  const CREDIT_LABELS = {
    teachers: { he:'צוות ההוראה', en:'Teaching team', ru:'Преподаватели' },
    sponsors: { he:'בחסות',      en:'Supported by',  ru:'При поддержке' }
  };

  const status = root.dataset.status || 'draft';
  const cfg = STATUS[status];
  if (!cfg) { console.warn('[activity] unknown status:', status); return; }

  // NOTE: `draft` is still in the STATUS table because the admin previews
  // drafts in an iframe. It can no longer appear on the live site: a draft
  // activity is never committed, so there is no page to serve. The redirect
  // that used to live here was a courtesy, not access control, and the admin
  // backend replaced it with the real thing.

  const esc = (str) => String(str).replace(/[&<>"]/g, (c) =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));

  // --- 1. badge + CTA, both from `status` -------------------------------
  // Searched from the document, not from `root`: the badge sits under the H1
  // in .page-header, which is OUTSIDE the .activity article. Status is still
  // declared exactly once, on the article — this only reads it from further up.
  const badgeSlot = document.querySelector('[data-status-badge]');
  if (badgeSlot) {
    badgeSlot.className = 'status-badge is-' + status;
    badgeSlot.textContent = pick(cfg.badge);
  }

  const ctaSlot = root.querySelector('[data-status-cta]');
  if (ctaSlot) {
    if (cfg.banner) {
      ctaSlot.innerHTML = `<p class="status-banner is-${status}">${esc(pick(cfg.banner))}</p>`;
    } else if (cfg.disabled) {
      ctaSlot.innerHTML = `<button type="button" class="sidebar-cta is-${status}" disabled>${esc(pick(cfg.cta))}</button>`;
    } else {
      const href = root.dataset.ctaUrl || '#register';
      const note = cfg.note ? `<p class="sidebar-note">${esc(pick(cfg.note))}</p>` : '';
      ctaSlot.innerHTML =
        `<a class="sidebar-cta is-${status}" href="${esc(href)}">${esc(pick(cfg.cta))}</a>${note}`;
    }
  }

  // --- 2. teachers + sponsors, from arrays ------------------------------
  const creditSlot = root.querySelector('[data-credits]');
  const creditData = document.getElementById('activity-credits');
  if (creditSlot) {
    let data = {};
    if (creditData) {
      try { data = JSON.parse(creditData.textContent) || {}; }
      catch (err) { console.warn('[activity] could not parse activity-credits:', err); }
    }
    const groups = ['teachers', 'sponsors'].map(function(key) {
      const list = Array.isArray(data[key]) ? data[key].filter(Boolean) : [];
      if (!list.length) return '';
      const items = list.map(function(entry) {
        const img = entry.photo || entry.logo;
        const face = img
          ? `<img class="credit-photo" src="${esc(img)}" alt="">`
          : `<span class="credit-photo" aria-hidden="true">${key === 'sponsors' ? '\u{1F3DB}' : '\u{1F464}'}</span>`;
        return `<div class="credit-item">${face}<span class="credit-name">${esc(entry.name || '')}</span></div>`;
      }).join('');
      return `<div class="credit-group">
          <span class="credit-group-label">${esc(pick(CREDIT_LABELS[key]))}</span>
          <div class="credit-items">${items}</div>
        </div>`;
    }).join('');

    if (groups) creditSlot.innerHTML = groups;
    else creditSlot.remove();   // no teachers and no sponsors: no empty block
  }

  // --- 3. drop optional blocks that were left empty ----------------------
  root.querySelectorAll('[data-optional]').forEach(function(block) {
    const clone = block.cloneNode(true);
    // A heading or label on its own is not content.
    clone.querySelectorAll('h1,h2,h3,h4,.credit-group-label,.sidebar-row .label').forEach((h) => h.remove());
    const hasMedia = clone.querySelector('img,svg,video');
    if (!hasMedia && !clone.textContent.trim()) block.remove();
  });
})();
