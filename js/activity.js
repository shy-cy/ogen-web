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
//   4. SESSION TABS. An activity whose groups keep DIFFERENT timetables serves
//      one table per group, stacked. This turns them into tabs — and only ever
//      enhances what was served, so a failure leaves every group's dates on the
//      page rather than hiding one.
//
// The `open` CTA now points at the family area carrying this activity's slug,
// rather than at the contact section. That fallback existed because there was
// nowhere to send anybody; there is now.
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
      // WHERE THE BUTTON GOES, and there is only one answer.
      //
      // It used to fall back to '#register', the contact section, because
      // registration did not exist and a dead end was worse than a form. It is
      // built from the slug now, in the reader's own language tree — so a
      // Russian-speaking parent lands on the Russian page rather than in the
      // Hebrew default with a language switch to find.
      //
      // THE OVERRIDE IS GONE. `data-cta-url` was an escape hatch from before
      // registration existed, and every value it ever carried on this site was
      // a mistake: once the button's own LABEL ("Register Now", which shipped
      // as <a href="Register Now"> and 404'd in three languages), and once the
      // site homepage, which sent parents away from the form they had come to
      // find. Both passed validation, because an allowlist can tell a link from
      // prose but cannot tell a right URL from a wrong one. There is nothing to
      // get wrong now.
      const slug = (location.pathname.replace(/\/$/, '').split('/').pop() || '')
        .replace(/\.html$/, '');
      const base = lang === 'he' ? '' : '/' + lang;
      const href = slug
        ? base + '/account/activity?register=' + encodeURIComponent(slug)
        : base + '/account';
      const note = cfg.note ? `<p class="sidebar-note">${esc(pick(cfg.note))}</p>` : '';
      ctaSlot.innerHTML =
        `<a class="sidebar-cta is-${status}" href="${esc(href)}">${esc(pick(cfg.cta))}</a>${note}`;
      stickyCta(href, pick(cfg.cta), status);
    }
  }

  // --- 1b. the same button, pinned, once it has scrolled away ------------
  //
  // ⚠ THE ONE CONTROL THIS PAGE EXISTS FOR IS FOUR SCREENS DOWN ON A PHONE.
  // Measured rather than guessed: on hebrew4kids at 375px the register button
  // sits 2651px into a 4342px page — 61% down, four viewports of scrolling — and
  // 3 screens down at 768px. That is the stacked order working exactly as
  // designed (picture, facts, article, price, BUTTON, staff), and the order is
  // right: a family reads what it is, when it is and what it costs before they
  // are asked to act. What is wrong is that having decided, they have to go and
  // find the control again.
  //
  // Asked for as "in activity page - to have a lower sticky button for
  // registration".
  //
  // ⚠ IT IS SHOWN ONLY WHILE THE REAL ONE IS OFF SCREEN. Two solid terracotta
  // pills at once is the pairing the credit block was rebuilt to avoid — and a
  // duplicate of the primary CTA sitting over the primary CTA reads as two
  // choices rather than one. An IntersectionObserver on the real button decides
  // it, so the bar is a shortcut back to a control that has scrolled away rather
  // than a second control.
  //
  // ⚠ AND ONLY WHEN THERE IS SOMETHING TO PRESS. The four banner statuses have
  // no button at all, and `closed` has a DISABLED one — pinning a dead button to
  // the bottom of the viewport, where it cannot be scrolled away from, is worse
  // than leaving it in the flow. This is reached from the one branch that builds
  // a real link, so a status that offers nothing cannot acquire a bar.
  //
  // The href and the words are the SAME two values the real button was just
  // built from, passed in rather than read back out of the DOM: a second
  // derivation of the target is a second thing that can be wrong, and the
  // target is the thing `data-cta-url` got wrong twice.
  function stickyCta(href, label, status) {
    if (!window.IntersectionObserver) return;   // fails open: no bar, page intact
    const real = root.querySelector('.sidebar-cta');
    if (!real) return;
    const bar = document.createElement('div');
    bar.className = 'activity-sticky';
    bar.hidden = true;
    const a = document.createElement('a');
    a.className = 'sidebar-cta is-' + status;
    a.href = href;
    a.textContent = label;
    bar.appendChild(a);
    (document.getElementById('page') || document.body).appendChild(bar);
    // ⚠ INSIDE #page, which is where direction lives. Putting it on <body> would
    // pin it to a wrapper with no `dir`, and rule 2 says direction is set only
    // on #page. Nothing in the bar is positioned against a side anyway.
    new window.IntersectionObserver((entries) => {
      entries.forEach((e) => { bar.hidden = e.isIntersecting; });
    }, { rootMargin: '0px 0px -24px 0px' }).observe(real);
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
        // A sponsor mark is a logo, not a face: contained in a tile at its own
        // aspect ratio rather than cropped into a circle, which was cutting the
        // edges off marks that are not square.
        const cls = key === 'sponsors' ? 'credit-logo' : 'credit-photo';
        const face = img
          ? `<img class="${cls}" src="${esc(img)}" alt="">`
          : `<span class="${cls}" aria-hidden="true">${key === 'sponsors' ? '\u{1F3DB}' : '\u{1F464}'}</span>`;
        return `<div class="credit-item">${face}<span class="credit-name">${esc(entry.name || '')}</span></div>`;
      }).join('');
      return `<div class="credit-group">
          <span class="credit-group-label">${esc(pick(CREDIT_LABELS[key]))}</span>
          <div class="credit-items">${items}</div>
        </div>`;
    }).join('');

    if (groups) creditSlot.innerHTML = groups;
    // No teachers and no sponsors: take the whole CARD, not just the slot inside
    // it, or a gold icon and a heading are left labelling nothing. The template
    // already declines to render the shell in that case; this is the safety net
    // for a record whose credits are empty in this language only.
    else (creditSlot.closest('.fact-card') || creditSlot).remove();
  }

  // --- 3. drop optional blocks that were left empty ----------------------
  root.querySelectorAll('[data-optional]').forEach(function(block) {
    const clone = block.cloneNode(true);
    // A heading or label on its own is not content.
    clone.querySelectorAll('h1,h2,h3,h4,.credit-group-label,.sidebar-row .label').forEach((h) => h.remove());
    const hasMedia = clone.querySelector('img,svg,video');
    if (!hasMedia && !clone.textContent.trim()) block.remove();
  });

  // --- 4. one table per group becomes one tab per group ------------------
  //
  // ⚠ IT REARRANGES WHAT WAS SERVED AND BUILDS NO CONTENT OF ITS OWN.
  //
  // Every group's table is already in the HTML, captioned with that group's
  // name, under one "Session dates" heading — which is exactly how this page
  // rendered before tabs existed. So the whole of the fail-open promise is that
  // a throw anywhere in here leaves that rendering untouched: nothing is hidden
  // until the strip that reveals it again has been built and attached. The
  // alternative — a server-rendered tab strip — is a row of dead buttons when
  // this script does not run, and rendering only the selected panel hides one
  // group's dates from a reader with no JavaScript and from a crawler.
  //
  // The same discipline js/calendar.js follows, and for the same reason: the
  // served markup is the product, and this is an improvement on it.
  try {
    const split = root.querySelector('[data-session-tabs]');
    const panels = split
      ? Array.prototype.slice.call(split.querySelectorAll('.session-panel'))
      : [];
    // One panel is one group, which is not a choice — the same rule the register
    // panel applies to the group select.
    if (panels.length > 1) {
      const heading = root.querySelector('.session-heading');
      const strip = document.createElement('div');
      strip.className = 'session-tabs';
      strip.setAttribute('role', 'tablist');
      // Labelled by the band's own heading rather than a string this file would
      // have to carry in three languages.
      if (heading) {
        if (!heading.id) heading.id = 'session-heading';
        strip.setAttribute('aria-labelledby', heading.id);
      }

      const tabs = panels.map(function(panel, i) {
        const tab = document.createElement('button');
        tab.type = 'button';            // ⚠ or it submits any form it lands in
        tab.id = 'session-tab-' + i;
        tab.setAttribute('role', 'tab');
        tab.textContent = panel.getAttribute('data-session-title') || '';
        panel.id = panel.id || 'session-panel-' + i;
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', tab.id);
        // Focusable, because a panel holding a long table is something a
        // keyboard user scrolls.
        panel.setAttribute('tabindex', '0');
        tab.setAttribute('aria-controls', panel.id);
        strip.appendChild(tab);
        return tab;
      });

      const select = function(i, focus) {
        tabs.forEach(function(tab, n) {
          const on = n === i;
          tab.setAttribute('aria-selected', on ? 'true' : 'false');
          // Roving tabindex: one stop for the whole strip, arrows move within
          // it. Every tab in the tab order would make a two-group activity two
          // extra stops between the article and the table.
          tab.tabIndex = on ? 0 : -1;
          if (on && focus) tab.focus();
          panels[n].hidden = !on;
        });
      };

      strip.addEventListener('click', function(e) {
        const i = tabs.indexOf(e.target);
        if (i !== -1) select(i, false);
      });

      strip.addEventListener('keydown', function(e) {
        const i = tabs.indexOf(e.target);
        if (i === -1) return;
        // ⚠ ARROWS FOLLOW WHAT IS ON SCREEN, NOT THE ARRAY. A browser does not
        // flip ArrowLeft in a right-to-left page, so in Hebrew the LEFT arrow has
        // to move FORWARD through the tabs or the strip works backwards — the one
        // place in this site's RTL handling that a stylesheet cannot answer.
        const rtl = getComputedStyle(strip).direction === 'rtl';
        let next = null;
        if (e.key === 'ArrowRight') next = i + (rtl ? -1 : 1);
        else if (e.key === 'ArrowLeft') next = i + (rtl ? 1 : -1);
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = tabs.length - 1;
        else return;
        e.preventDefault();
        select((next + tabs.length) % tabs.length, true);
      });

      // Attached BEFORE anything is hidden, so the only state this can leave
      // behind is every panel visible.
      split.parentNode.insertBefore(strip, split);
      split.classList.add('has-tabs');
      select(0, false);
    }
  } catch (err) {
    console.warn('[activity] session tabs not built:', err);
  }
})();
