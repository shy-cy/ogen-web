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
function render(status, lang, ctaUrl) {
  const el = () => ({
    className: '', textContent: '', innerHTML: '',
    querySelector: () => null, querySelectorAll: () => [], remove() {}
  });
  const badge = el();
  const cta = el();
  const root = Object.assign(el(), {
    dataset: ctaUrl ? { status, ctaUrl } : { status },
    querySelector: (sel) => (sel === '[data-status-cta]' ? cta : null),
    querySelectorAll: () => []
  });
  const document = {
    documentElement: { lang },
    getElementById: () => null,
    querySelector: (sel) => {
      if (sel === '.activity') return root;
      if (sel === '[data-status-badge]') return badge;
      return null;
    }
  };
  vm.runInNewContext(activityJs, { document, console });
  return { badge: badge.textContent, badgeClass: badge.className, cta: cta.innerHTML };
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
const soon = render('announcement', 'he', '/#contact');
H.eq(shapeOf(soon.cta), 'banner', 'announcement renders a banner, not a button');
H.ok(soon.cta.indexOf('sidebar-cta') === -1, 'there is no button element at all');
H.ok(soon.cta.indexOf('<a ') === -1, 'and nothing to click');
// The strongest form of the bug: even WITH a link stored, no button appears.
H.ok(soon.cta.indexOf('/#contact') === -1,
  'a stored registration link does not resurrect the button');
H.ok(/is-announcement/.test(soon.cta), 'the banner is keyed to the status like every other one');

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
  H.eq(shapeOf(render(status, 'he', '/#contact').cta), SHAPE[status],
    `${status} → ${SHAPE[status]}`);
});
// The two that still lead somewhere must still lead there.
H.ok(render('open', 'he', '/#contact').cta.indexOf('href="/#contact"') !== -1,
  'open still links to the registration target');
H.ok(render('waitlist', 'he', '/#contact').cta.indexOf('href="/#contact"') !== -1,
  'waitlist still links to it too');
H.ok(render('open', 'he').cta.indexOf('href="#register"') !== -1,
  'and with no target they fall back to the contact section');

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
