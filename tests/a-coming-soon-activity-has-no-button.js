// What this defends against:
//
// `announcement` is the status an activity carries before registration opens.
// It used to render a real, pressable button — "רישום עניין" / "Register
// interest" — and a button has to point somewhere. There is nothing to point
// at: registration is not built, so the link either fell back to the contact
// form dressed up as a registration, or it pointed at whatever an admin typed
// into the registration-link field. What an admin typed once was the button's
// own LABEL, which became <a href="Register Now"> and resolved, relative to the
// page, to a 404 — on the live site, in all three languages, while the button
// still SAID "Register interest". It looked right and only failed on click.
//
// So the status now says what it is and offers nothing to press. The point of
// this suite is that the change is exactly that and nothing more: the status
// KEY is untouched (`announcement` everywhere — record, article, CSS class),
// the badge still reads בקרוב / Coming soon / Скоро, and the other six statuses
// render precisely what they rendered before.
//
// It runs the real js/activity.js in a stub DOM rather than reading the STATUS
// table, because the bug was never in the table — it was in which branch of the
// render the table selected.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const activityJs = fs.readFileSync(path.join(R, 'js/activity.js'), 'utf8');
const css = fs.readFileSync(path.join(R, 'shared.css'), 'utf8');

// --- the smallest DOM that js/activity.js can run against ------------------
// Credits and optional fields are deliberately absent — both have their own
// suite — so only the badge and the CTA slot are wired up.
function render(status, lang, pathname) {
  const el = () => ({
    className: '', textContent: '', innerHTML: '',
    querySelector: () => null, querySelectorAll: () => [], remove() {}
  });
  const badge = el();
  const cta = el();
  // The real button, for the branch that builds one — the pinned copy is drawn
  // from it, and only from it.
  const realCta = Object.assign(el(), { tagName: 'A' });
  const root = Object.assign(el(), {
    dataset: { status },
    querySelector: (sel) => {
      if (sel === '[data-status-cta]') return cta;
      // ⚠ Only once the branch above has actually written one. A status that
      // renders a banner has no .sidebar-cta in the page, so the pinned bar has
      // nothing to observe and nothing to copy.
      if (sel === '.sidebar-cta') return /sidebar-cta/.test(cta.innerHTML) ? realCta : null;
      return null;
    },
    querySelectorAll: () => []
  });
  // ⚠ WHAT GETS PINNED TO THE BOTTOM OF THE VIEWPORT, captured. A bar is the
  // most pressable thing a screen can carry, so "this status offers nothing to
  // press" has to cover it too.
  const pinned = [];
  const pageEl = Object.assign(el(), { appendChild: (n) => { pinned.push(n); return n; } });
  const document = {
    documentElement: { lang },
    getElementById: (id) => (id === 'page' ? pageEl : null),
    createElement: (tag) => Object.assign(el(), {
      tagName: tag.toUpperCase(), children: [],
      appendChild(n) { this.children.push(n); return n; }
    }),
    querySelector: (sel) => {
      if (sel === '.activity') return root;
      if (sel === '[data-status-badge]') return badge;
      return null;
    }
  };
  const observed = [];
  const window = { IntersectionObserver: function (fn) {
    this.observe = (n) => observed.push({ node: n, fn: fn });
  } };
  // The CTA's fallback is built from the URL now — the activity's slug, and the
  // language tree it is being read in — so the fake DOM has to carry a location.
  const location = {
    pathname: pathname || (lang === 'he' ? '/activities/hebrew4kids' : '/' + lang + '/activities/hebrew4kids'),
    href: ''
  };
  vm.runInNewContext(activityJs, { document, console, location, window });
  return { badge: badge.textContent, badgeClass: badge.className, cta: cta.innerHTML,
           pinned: pinned, observed: observed };
}

const STATUSES = ['draft', 'announcement', 'open', 'waitlist', 'closed', 'cancelled', 'completed'];

// What each status is allowed to put in the CTA slot. This is the whole
// behaviour of the table, written out, so a change to any status shows up here
// as a failing assertion rather than as a surprise on the site.
const SHAPE = {
  draft:        'banner',
  announcement: 'banner',   // was 'link' — the change this suite exists for
  open:         'link',
  waitlist:     'link',
  closed:       'disabled',
  cancelled:    'banner',
  completed:    'banner'
};

const shapeOf = (html) => {
  if (!html) return 'nothing';
  if (/<p class="status-banner/.test(html)) return 'banner';
  if (/<button[^>]*disabled/.test(html)) return 'disabled';
  if (/<a class="sidebar-cta/.test(html)) return 'link';
  return 'unknown: ' + html.slice(0, 40);
};

console.log('[coming soon offers nothing to press]');
const soon = render('announcement', 'he');
H.eq(shapeOf(soon.cta), 'banner', 'announcement renders a banner, not a button');
H.ok(soon.cta.indexOf('sidebar-cta') === -1, 'there is no button element at all');
H.ok(soon.cta.indexOf('<a ') === -1, 'and nothing to click');
// The strongest form of the bug: the status alone decides, so there is no
// stored value anywhere that could resurrect the button.
H.ok(soon.cta.indexOf('href') === -1,
  'and no href of any kind — announcement leads nowhere by construction');
H.ok(/is-announcement/.test(soon.cta), 'the banner is keyed to the status like every other one');

// ⚠ AND NOTHING IS PINNED TO THE BOTTOM OF THE VIEWPORT EITHER.
//
// The register button is four screens down on a phone, so it now has a fixed
// copy that appears once the real one scrolls away. A bar is the most pressable
// thing a screen can carry — it cannot be scrolled past — so "this status offers
// nothing to press" has to cover it, and `closed` is the one that would slip
// through: it DOES render a button, and that button is disabled.
console.log('\n[and nothing is pinned to the bottom of the viewport]');
const BAR = { draft: false, announcement: false, cancelled: false, completed: false,
              closed: false, open: true, waitlist: true };
STATUSES.forEach((status) => {
  const out = render(status, 'en');
  H.eq(out.pinned.length, BAR[status] ? 1 : 0,
    status + (BAR[status] ? ' → a pinned bar' : ' → nothing pinned'));
  if (!BAR[status]) return;
  H.eq(out.pinned[0].className, 'activity-sticky', status + ': and it is the bar');
  H.eq(out.pinned[0].hidden, true,
    status + ': ⚠ which starts HIDDEN — the real button is on screen at the top of the page');
  H.eq(out.observed.length, 1, status + ': watching exactly one thing');
  H.eq(out.pinned[0].children.length, 1, status + ': holding one control');
  H.eq(out.pinned[0].children[0].href, '/en/account/activity?register=hebrew4kids',
    status + ': ⚠ the SAME target the real button was built from, not a second derivation');
});
// The words are the status's own, so the bar cannot say something the page does
// not. `waitlist` is the one where the two would be easy to let drift.
H.eq(render('waitlist', 'en').pinned[0].children[0].textContent, 'Join the waiting list',
  'the pinned copy says what the real button says');
H.eq(render('waitlist', 'he').pinned[0].children[0].textContent, 'הצטרפות לרשימת המתנה',
  'in Hebrew too');
H.eq(render('open', 'ru').pinned[0].children[0].textContent, 'Записаться', 'and in Russian');
// ⚠ IT SHOWS ONLY WHILE THE REAL BUTTON IS OFF SCREEN. Two solid terracotta
// pills at once is the pairing the credit block was rebuilt to avoid.
const live = render('open', 'en');
live.observed[0].fn([{ isIntersecting: false }]);
H.eq(live.pinned[0].hidden, false, '⚠ the real button scrolls away and the bar appears');
live.observed[0].fn([{ isIntersecting: true }]);
H.eq(live.pinned[0].hidden, true, 'and it goes again the moment the real one is back');

console.log('\n[the badge is untouched, in all three languages]');
H.eq(render('announcement', 'he').badge, 'בקרוב', 'Hebrew badge still reads בקרוב');
H.eq(render('announcement', 'en').badge, 'Coming soon', 'English badge still reads Coming soon');
H.eq(render('announcement', 'ru').badge, 'Скоро', 'Russian badge still reads Скоро');
H.eq(render('announcement', 'he').badgeClass, 'status-badge is-announcement',
  'and the status KEY is unchanged — this was a display change, not a data one');

console.log('\n[the banner says what happens next, in all three languages]');
H.ok(render('announcement', 'he').cta.indexOf('נעדכן אתכם כשההרשמה תיפתח') !== -1,
  'Hebrew: we will let you know when registration opens');
H.ok(render('announcement', 'en').cta.indexOf("We'll let you know when registration opens") !== -1,
  'English: the same, and it is the note the button used to carry');
H.ok(render('announcement', 'ru').cta.indexOf('Мы сообщим вам, когда откроется запись') !== -1,
  'Russian: the same');

console.log('\n[every other status renders exactly what it did before]');
STATUSES.forEach((status) => {
  H.eq(shapeOf(render(status, 'he').cta), SHAPE[status],
    `${status} → ${SHAPE[status]}`);
});
// THE TARGET IS DERIVED, NOT STORED. It used to be whatever an admin typed
// into a ctaUrl field, falling back to the contact section because
// registration did not exist. The field is gone — every value it ever held on
// this site was a mistake — so the link is built from the slug and there is
// nothing left for a status to disagree with.
H.ok(render('open', 'he').cta.indexOf('href="/account/activity?register=hebrew4kids"') !== -1,
  'open leads to the family area carrying the slug');
H.ok(render('waitlist', 'ru').cta.indexOf('href="/ru/account/activity?register=hebrew4kids"') !== -1,
  'in the READER\'S OWN TREE — a Russian-speaking parent must not land in the Hebrew default');
H.ok(render('open', 'en').cta.indexOf('href="/en/account/activity?register=hebrew4kids"') !== -1,
  'and in English too');

console.log('\n[the stylesheet describes only what is drawn]');
H.ok(/\.status-banner\.is-announcement\{/.test(css),
  'the banner has a tone of its own');
H.ok(!/\.sidebar-cta\.is-announcement\{/.test(css),
  'and the button rule is gone, because no such button is ever rendered');
// The other button rules must survive: this was not a change to the CTA system.
['open', 'waitlist', 'closed'].forEach((s) => {
  H.ok(new RegExp('\\.sidebar-cta\\.is-' + s + '\\{').test(css),
    `.sidebar-cta.is-${s} is untouched`);
});

console.log('\n[the status remains a published, listed status]');
// Nothing about "no button" makes it a draft. It still has pages, still appears
// on the listing, still enters the sitemap.
const { PUBLIC_STATUSES } = require('../netlify/functions/_activity-index');
const { STATUSES: TEMPLATE_STATUSES } = require('../netlify/functions/_activity-template');
H.ok(PUBLIC_STATUSES.indexOf('announcement') !== -1, 'it is still a public status');
H.ok(TEMPLATE_STATUSES.indexOf('announcement') !== -1, 'and still a selectable one');
const adminJs = fs.readFileSync(path.join(R, 'js/activities-admin.js'), 'utf8');
H.ok(/announcement: \{ label: 'Coming soon'/.test(adminJs),
  'and the admin still calls it Coming soon');

H.done();
