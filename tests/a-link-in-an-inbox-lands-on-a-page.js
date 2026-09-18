// What this defends against:
//
// The account emails have been sending links since Phase 2 — verify your
// address, reset your password, join a child's record — and until Phase 6 there
// was nothing at the other end of any of them. Those URLs are already written
// into `_account-email.js`, in three languages, and once a message is sent the
// link lives in somebody's inbox where it cannot be corrected. A typo in a path,
// or a language tree with a missing page, is a 404 that a person meets while
// trying to accept an invitation to their own child's record.
//
// So the emails and the pages are checked against each other mechanically: every
// href any message can produce, in every language, must resolve to a file that
// exists. Neither side gets to be the source of truth on its own.
//
// The rest is the "copy lives in triplicate" rule, which this area could break
// more easily than anything else on the site because it has more words than
// everything else put together. They live in ONE table in js/member-account.js,
// so the check is that the three languages have exactly the same keys — a
// missing Russian key is not a missing translation, it is `undefined` rendered
// into a label.
//
// And one bug found while building it: the language toggle preserved the hash
// and dropped the QUERY STRING. Three of these pages carry their token there, so
// a Russian-speaking parent switching a Hebrew-looking link to Russian — exactly
// what that toggle is for — silently turned a valid invitation into a dead one,
// and the page could only say "that link has expired or has already been used".

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const SITE = 'https://www.ogen.cy';
const LANGS = ['he', 'en', 'ru'];

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

console.log('[every link an account email can send lands on a page]');
const mail = require(H.fnPath('_account-email'));
const account = (l) => ({ email: 'dana@example.com', accountId: 'a-1',
                          profile: { firstName: 'Dana', preferredLanguage: l } });

const hrefsIn = (msg) => {
  const out = [];
  const re = /href="([^"]+)"/g;
  let m;
  while ((m = re.exec(msg.html))) out.push(m[1]);
  return out;
};

// A URL on this site, turned into the file that has to exist for it to work.
// Netlify's pretty URLs serve /en/account/verify from en/account/verify.html.
function fileFor(url) {
  if (url.indexOf(SITE) !== 0) return null;
  const p = url.slice(SITE.length).split('?')[0].split('#')[0].replace(/^\//, '');
  if (!p) return 'index.html';
  // Netlify serves /activities from either activities.html or
  // activities/index.html, and the listing pages are the second shape — so a
  // link to a directory is not a broken link. Whichever exists is the answer;
  // the caller only asks whether ONE of them does.
  return fs.existsSync(path.join(R, p + '.html')) ? p + '.html' : p + '/index.html';
}

let checked = 0;
LANGS.forEach((l) => {
  const messages = [
    ['verify', mail.verifyMessage(account(l), 'tok')],
    ['reset', mail.resetMessage(account(l), 'tok')],
    ['changed', mail.changedMessage(account(l))],
    ['invite', mail.inviteMessage({ token: 'inv', invitedEmail: 'x@y.z' }, 'Dana', 'Noa', l)]
  ];
  messages.forEach(([name, msg]) => {
    hrefsIn(msg).forEach((href) => {
      const file = fileFor(href);
      if (!file) return;                       // mailto:, or an outside link
      checked++;
      H.ok(fs.existsSync(path.join(R, file)),
        l + ' ' + name + ': ' + href.replace(SITE, '') + ' → ' + file);
    });
  });
});
H.ok(checked >= 9, 'and there were real links to check (' + checked + ')');

// ---------------------------------------------------------------------------
console.log('\n[and so does every link a REGISTRATION email can send]');
//
// ⚠ THIS HALF WAS NOT CHECKED, AND EVERY LINK IN IT WAS BROKEN.
//
// The three messages that follow a live registration — registered, approved,
// and the payment receipt — point at the family's own registration page, which
// is addressed by a pair of query parameters rather than by a path. The file
// existing is therefore not enough: `/account/activity` with the wrong
// parameter names is a page that loads perfectly and says "that registration
// was not found", which is the worst sentence in the system to meet after
// paying.
//
// They were spelled `participantId` and `activityId` — the API's names, and
// self-describing, and matching nothing. `js/member-account.js` reads
// `param('p')` and `param('a')`. A test in another suite pinned the long
// spelling as correct, because it read the email and never asked the page.
//
// So the two halves are compared here: every parameter an emailed link carries
// must be one the screen actually reads.
const regMail = require(H.fnPath('_registration-email'));
const screenSrc = read('js/member-account.js');
const reg = { participantId: 'p-1', activityId: 'act-1', expiryDays: 14,
  frozen: { participantName: 'Noa', activityTitle: { he: 'עברית', en: 'Hebrew', ru: 'Иврит' } } };

let pairs = 0;
LANGS.forEach((l) => {
  const acct = account(l);
  const messages = [
    ['registered', regMail.receivedMessage(reg, acct)],
    ['approved', regMail.approvedMessage(reg, acct)],
    ['rejected', regMail.rejectedMessage(reg, acct)],
    ['expired', regMail.expiredMessage(reg, acct)],
    ['paid', regMail.paidMessage(reg, acct, 15000, 20000)]
  ];
  messages.forEach(([name, msg]) => {
    hrefsIn(msg).forEach((href) => {
      const file = fileFor(href);
      if (!file) return;
      H.ok(fs.existsSync(path.join(R, file)),
        l + ' ' + name + ': ' + href.replace(SITE, '') + ' → ' + file);
      // The query, which is where the last one failed. `&amp;` because this is
      // an href inside HTML, not a URL on its own.
      const q = (href.split('?')[1] || '').split('#')[0];
      if (!q) return;
      q.split(/&amp;|&/).filter(Boolean).forEach((bit) => {
        const key = bit.split('=')[0];
        pairs++;
        H.ok(screenSrc.indexOf("param('" + key + "')") !== -1,
          l + ' ' + name + ': the page reads ?' + key + ' — the email is not inventing a name');
      });
    });
  });
});
H.ok(pairs >= 18, 'and there were parameters to check (' + pairs + ')');

// The same link, built a second time in a second file: where Stripe sends a
// family back when Checkout is done. It is the one URL on the site a person
// reaches at the exact moment they have parted with money.
const payHandler = read('netlify/functions/_checkout.js');
const back = /\/account\/activity'\s*\n?\s*\+ '\?([a-z]+)=[\s\S]{0,120}?\+ '&([a-z]+)=/.exec(payHandler);
H.ok(back, "Stripe's return URL is built where it is expected to be");
if (back) {
  H.ok(screenSrc.indexOf("param('" + back[1] + "')") !== -1,
    'and its first parameter is one the page reads (?' + back[1] + ')');
  H.ok(screenSrc.indexOf("param('" + back[2] + "')") !== -1,
    'and so is its second (&' + back[2] + ')');
}

// #pay, and a card with that id to land on. The page is the activity, the
// facts, the price and the sessions; a family opening a message about money has
// one question, and it was several screens down.
H.ok(/registrationHref[\s\S]{0,400}#pay/.test(read('netlify/functions/_registration-email.js')),
  'the money messages point at the cost card, not at the top of the page');
H.ok(/section\(T\.costTitle, kids, 'pay'\)/.test(screenSrc), 'and that card carries the id');
H.ok(/location\.hash === '#pay'[\s\S]{0,260}scrollIntoView/.test(screenSrc),
  'and the page scrolls to it ITSELF — the hash is resolved before any card exists');
H.ok(/\.acc-card\[id\]\{[^}]*scroll-margin-block-start/.test(read('shared.css')),
  'clearing the 96px fixed nav when it does');

console.log('\n[the eighteen shells exist, one per view per language]');
const VIEWS = { account: 'account.html', details: 'account/details.html',
                activity: 'account/activity.html', verify: 'account/verify.html',
                reset: 'account/reset.html', invite: 'account/guardian-invite.html' };
LANGS.forEach((l) => {
  Object.keys(VIEWS).forEach((view) => {
    const file = (l === 'he' ? '' : l + '/') + VIEWS[view];
    H.ok(fs.existsSync(path.join(R, file)), file + ' exists');
    const src = read(file);
    H.ok(src.indexOf('data-view="' + view + '"') !== -1, file + ' declares its view');
    H.ok(src.indexOf('<html lang="' + l + '">') !== -1, file + ' is in the right language');
    // Direction is set ONLY on #page, never on html or body. That was fixed the
    // hard way once and must not come back.
    H.ok(src.indexOf('<div id="page" dir="' + (l === 'he' ? 'rtl' : 'ltr') + '">') !== -1,
      file + ' sets direction on #page and nowhere else');
    H.ok(!/<html[^>]+dir=|<body[^>]+dir=/.test(src), file + ' puts dir on neither html nor body');
    // Private, so noindex — and deliberately absent from the sitemap.
    H.ok(/<meta name="robots" content="noindex/.test(src), file + ' is noindex');
  });
});

const sitemap = read('sitemap.xml');
H.ok(sitemap.indexOf('/account') === -1, 'and no account page is in sitemap.xml');

console.log('\n[the copy is in one table, and the three languages agree]');
const screen = read('js/member-account.js');
const start = screen.indexOf('var T = {');
const end = screen.indexOf('}[lang];', start);
H.ok(start !== -1 && end !== -1, 'the string table is where it says it is');
const tableSrc = screen.slice(start, end + '}[lang];'.length);

const tableFor = (l) => {
  const ctx = { lang: l };
  vm.runInNewContext(tableSrc + '\nresult = T;', ctx);
  return ctx.result;
};
const he = tableFor('he');
const keys = Object.keys(he).sort();
H.ok(keys.length > 50, 'it carries the whole area (' + keys.length + ' keys)');
['en', 'ru'].forEach((l) => {
  const other = tableFor(l);
  H.eq(Object.keys(other).sort().join(','), keys.join(','),
    l + ' has exactly the same keys as Hebrew — a missing one renders "undefined" into a label');
  keys.forEach((k) => {
    if (typeof he[k] === 'object') {
      H.eq(Object.keys(other[k]).sort().join(','), Object.keys(he[k]).sort().join(','),
        l + '.' + k + ' agrees too');
    }
  });
  H.ok(Object.keys(other).every((k) => typeof other[k] === typeof he[k]),
    l + ' has nothing of the wrong shape');
});
// EVERY KEY IS ACTUALLY USED. An unreferenced one is dead copy that three
// languages still have to carry, and it is indistinguishable from a key whose
// only caller was renamed — which is a real bug wearing a harmless costume,
// because the screen that used to say it now says nothing.
const body = screen.slice(0, start) + screen.slice(end);
const used = new Set((body.match(/T\.([A-Za-z]+)/g) || []).map((s) => s.slice(2)));
const orphans = keys.filter((k) => !used.has(k));
H.eq(orphans.length, 0, 'no key is left unreferenced' + (orphans.length ? ': ' + orphans.join(', ') : ''));

// Every value is actually filled in. An empty string is a key somebody added and
// never translated, which renders as a blank label rather than as an error.
['he', 'en', 'ru'].forEach((l) => {
  const t = tableFor(l);
  const blank = Object.keys(t).filter((k) => typeof t[k] === 'string' && !t[k].trim());
  H.eq(blank.length, 0, l + ' has no blank strings' + (blank.length ? ': ' + blank.join(', ') : ''));
});

console.log('\n[the pages carry no copy of their own, so they cannot drift]');
LANGS.forEach((l) => {
  Object.keys(VIEWS).forEach((view) => {
    const file = (l === 'he' ? '' : l + '/') + VIEWS[view];
    const body = read(file).split('<div class="inner-body">')[1].split('</div>')[0];
    H.ok(body.indexOf('account-mount') !== -1 && body.replace(/\s|<[^>]+>/g, '') === '',
      file + ': the body is a mount point and nothing else');
  });
});

console.log('\n[the language toggle keeps the token]');
const nav = read('js/nav.js');
H.ok(/location\.href = dest \+ location\.search \+ location\.hash/.test(nav),
  'setLang carries the query string as well as the hash');
H.ok(/const base = lang === 'he' \? '' : '\/' \+ lang/.test(nav),
  "and the family-area link is built from a prefix, not from `home` — '/' + '/account' is a host called \"account\"");

console.log('\n[nothing in the family area is pushed to a physical edge]');
const css = read('shared.css');
const block = css.slice(css.indexOf('THE FAMILY AREA'));
H.ok(block.length > 1000, 'the block is there');
H.eq((block.match(/(^|[^-])(left|right)\s*:/g) || []).length, 0,
  'not one directional property — the same markup flips on its own in all three languages');
H.ok(/border-inline-start/.test(block), 'and the insets that do exist are logical');

console.log('\n[two buttons side by side have a gap between them]');
// Nothing in the family area is built from HTML source — it is all
// createElement — so adjacent siblings have NO whitespace text node between
// them and sit flush against each other. "Save" and "Cancel" were touching on
// the participant form, and the invite row's two links were too. A margin per
// button would have to be remembered every time; one wrapper cannot be.
H.ok(/\.acc-actions\{[^}]*display:flex/.test(block.replace(/\s+/g, ' ')),
  '.acc-actions is a flex row');
H.ok(/\.acc-actions\{[^}]*gap:\s*\d+px/.test(block.replace(/\s+/g, ' ')),
  'with a real gap — flex + gap so the order follows the page direction');
H.ok(/\.acc-row \.acc-actions\{ margin-block-start:0; \}/.test(block.replace(/\s+/g, ' ')),
  'and no top margin inside a row, which aligns on the baseline');
const acct = read('js/member-account.js');
H.ok(/function actions\(kids\)/.test(acct), 'there is one helper rather than a margin per button');
H.ok((acct.match(/actions\(\[/g) || []).length >= 2,
  'and every place that puts two buttons together uses it (' +
  (acct.match(/actions\(\[/g) || []).length + ')');
// The failure mode is a button appended straight into a form beside another.
H.ok(!/\[f\.row, l\.row, d\.row, n\.row, go,/.test(acct),
  'the participant form no longer appends Cancel as a bare sibling of Save');

H.done();
