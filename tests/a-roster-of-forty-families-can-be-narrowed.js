// What this defends against:
//
// "It would be convenient if we can filter the view according to group / status
// / payment status — what else?"
//
// The Roster is a TABLE where the rest of the admin is cards, and the reason
// written above it is that every other screen is opened to edit one thing and
// this one is opened to find the rows that need something doing. On an activity
// with forty families that job was scrolling: the screen answered "who is on
// this" and could not answer "who is waiting for me", "who still owes", or "who
// is in the Thursday group".
//
// ⚠ AND THE FIRST THING A FILTER CAN BREAK IS THE ONE SENTENCE THIS SCREEN MUST
// NOT GET WRONG. "Nobody has registered for this activity yet" is true of an
// empty activity and a lie about a narrowed table, and a stale filter carried
// across the picker would make it a lie on the next activity too. Both are
// covered here by running the thing.
//
// ⚠ AND IT IS THE TABLE THAT NARROWS, NEVER THE CAPACITY LINE. That line counts
// the room and every record against it. A filtered figure inside it would be a
// true number answering a different question — which is precisely the "4 of 3
// places · Over capacity" pairing this screen was already reported for once.
//
// ⚠ AND `payment.status` IS NOT THE PAYMENT FILTER. That field is stamped 'owed'
// when a registration is written and stays there on one that owes nothing at
// all, which is why the live roster shows "€0.00 / €0.00 OWED". Filtering on it
// would inherit that and file rows with nothing to pay under "owes money", so
// the bucket is derived from the figures.
//
// It carries two more things asked for in the same breath as the filters, and
// both are about the same table:
//
// ⚠ THE FOUR ROW BUTTONS ARE GLYPHS NOW, and the word is not gone — only off
// screen. Four labelled buttons wrapped to two lines on every row of a table
// whose whole job is scanning. But this admin has twice paid for a control
// nobody could read (the invite button labelled with a description; the (i) rule
// itself), so every one carries `aria-label`, a styled tooltip on hover AND on
// keyboard focus, and `title` for a touch device that has neither.
//
// ⚠ AND THE WAITING LIST HAS AN ACTION, which this project had written down as
// a thing it would not build: "a give this one a place button would be a second,
// quieter rule running beside the announced race". The reasoning is right; the
// conclusion was not. A place opens, everybody waiting is emailed, nobody
// claims it, and somebody phones instead — and with no control the only answer
// was to ask them to go and press a button. It is the SAME act rather than a
// second rule: it goes through the function a family claiming their own place
// goes through.
//
// Like the family area before it, this screen is over a thousand lines of client
// code that NOTHING HAD EVER EXECUTED — every suite touching it read it as text.
// Reading proves the source is self-consistent. It cannot prove that pressing a
// select shows fewer rows.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const D = require('./_dom');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const src = read('js/registrations-admin.js');

// The ids admin/registrations.html carries. Anything not listed comes back null,
// exactly as it would in a browser — which is what the admin's own id check
// exists to catch, so this list is deliberately the page's and not a catch-all.
const IDS = ['messages', 'picker', 'queue-panel', 'queue-title', 'capacity', 'dates', 'queue',
             'bundles-panel', 'bundles', 'codes-panel', 'codes', 'account-panel', 'account-title',
             'account-body', 'app', 'tool', 'no-access', 'who', 'logout',
             'btn-codes', 'btn-bundles', 'btn-sweep'];

const GROUPS = [
  { groupId: 'g-beg', name: { en: 'Beginners' }, capacity: 10, taken: 2, left: 8 },
  { groupId: 'g-adv', name: { en: 'Advanced' }, capacity: 10, taken: 2, left: 8 }
];

// Six registrations chosen so that every filter has something to take away and
// something to leave: two groups, four statuses, all three payment buckets, one
// age flag, and one row that predates the groups being named.
function reg(over) {
  return Object.assign({
    participantId: 'p', activityId: 'act-1', name: 'Someone', accountEmail: 'x@example.com',
    accountId: 'a-1', status: 'approved', groupId: 'g-beg', groupName: { en: 'Beginners' },
    stillExists: true, autoApproved: false, lapsed: false, history: [],
    submittedAt: '2026-09-01T09:00:00Z', expiresAt: '2026-10-16T09:00:00Z',
    feeCharged: true, feeYear: '2026/27',
    ageFlagAtSubmission: { age: 9, inRange: true, min: 6, max: 12 },
    payment: { owedCents: 35000, paidCents: 0, creditedCents: 0, status: 'owed' }
  }, over || {});
}
const REGS = [
  reg({ participantId: 'p-1', name: 'Noa Levi', accountEmail: 'noa@example.com',
        status: 'approved' }),
  reg({ participantId: 'p-2', name: 'Dana Katz', accountEmail: 'dana@example.com',
        status: 'pending', groupId: 'g-adv', groupName: { en: 'Advanced' },
        payment: { owedCents: 35000, paidCents: 35000, creditedCents: 0, status: 'paid' } }),
  reg({ participantId: 'p-3', name: 'Yuval Cohen', accountEmail: 'yuval@example.com',
        status: 'approved', groupId: 'g-adv', groupName: { en: 'Advanced' },
        ageFlagAtSubmission: { age: 51, inRange: false, min: 6, max: 12 } }),
  // ⚠ A DROP-IN-SHAPED ROW: the record says `owed` and owes nothing. On the live
  // roster this reads "€0.00 / €0.00 OWED", and it is why the bucket is derived.
  reg({ participantId: 'p-4', name: 'Ella Bar', accountEmail: 'ella@example.com',
        status: 'approved',
        payment: { owedCents: 0, paidCents: 0, creditedCents: 0, status: 'owed' } }),
  reg({ participantId: 'p-5', name: 'Omer Shaked', accountEmail: 'omer@example.com',
        status: 'cancelled',
        payment: { owedCents: 35000, paidCents: 0, creditedCents: 0, status: 'owed' } }),
  // Taken while the activity was still pooled: belongs to no group row, and says
  // so here exactly as it does in the capacity line.
  reg({ participantId: 'p-6', name: 'Tal Ziv', accountEmail: 'tal@example.com',
        status: 'approved', groupId: null, groupName: null })
];
const WAITING = [
  { participantId: 'p-7', activityId: 'act-1', name: 'Roni Adler',
    accountEmail: 'roni@example.com',
    accountId: 'a-7', stillExists: true, groupId: 'g-adv', groupName: { en: 'Advanced' },
    waitingSince: '2026-09-10T09:00:00Z',
    ageFlagAtSubmission: { age: 9, inRange: true, min: 6, max: 12 } }
];

const QUEUE = {
  activity: { slug: 'hebrew', title: { en: 'Hebrew for kids' }, type: 'course', status: 'open' },
  capacity: { capacity: 20, taken: 6, left: 14, over: false, perSession: false,
              unassigned: 1, named: GROUPS },
  registrations: REGS,
  waiting: WAITING
};
const SECOND = {
  activity: { slug: 'drama', title: { en: 'Drama club' }, type: 'course', status: 'open' },
  capacity: { capacity: 20, taken: 1, left: 19, over: false, perSession: false,
              unassigned: 0, named: [] },
  registrations: [reg({ participantId: 'p-9', name: 'Amit Gur', groupId: null, groupName: null })],
  waiting: []
};

const posted = [];
function boot(opts) {
  opts = opts || {};
  const dom = D.makeDom({ ids: IDS, lang: 'en' });
  const answers = {
    auth: () => ({ ok: true, data: { name: 'Michal', roleName: 'Super Admin',
                                     canApprove: true, canCancel: true } }),
    activities: () => ({ ok: true, data: { activities: [
      { slug: 'hebrew', title: { en: 'Hebrew for kids' }, status: 'open' },
      { slug: 'drama', title: { en: 'Drama club' }, status: 'open' }] } }),
    queue: (b) => ({ ok: true, data: b.slug === 'drama' ? SECOND : (opts.queue || QUEUE) }),
    givePlace: () => ({ ok: true, data: { ok: true, emailed: true } })
  };
  dom.window.AdminSession = {
    requireSession: () => true,
    logout: () => {},
    post: (url, body) => {
      posted.push(body);
      const fn = answers[body.action];
      if (!fn) throw new Error('no canned answer for admin action "' + body.action + '"');
      return Promise.resolve(fn(body));
    }
  };
  dom.window.AdminUrl = { remember: () => {}, read: () => opts.urlActivity || null };
  // The (i) is its own module and its own suite; here it only has to be a node.
  dom.window.AdminHelp = { badge: () => dom.node('span'), wire: () => {} };
  const ctx = vm.createContext({
    window: dom.window, document: dom.document, console: console,
    Date: Date, Math: Math, JSON: JSON, Object: Object, Array: Array,
    String: String, Number: Number, RegExp: RegExp, Promise: Promise, setTimeout: setTimeout,
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent
  });
  vm.runInContext(src, ctx, { filename: 'js/registrations-admin.js' });
  return dom;
}
const settle = () => new Promise((r) => setTimeout(r, 30));

// What the table is actually showing, read off the screen rather than off state.
// The registrations table and the waiting list are two tables and are read
// separately: the waiting list uses the same `who` cell, and a helper that
// swept both would have quietly counted a queue as a registration -- which is
// the pairing this whole screen keeps getting wrong.
function nth(dom, i) {
  const t = D.byTag(dom.byId('queue'), 'table')[i];
  if (!t) return [];
  return D.byClass(t, 'who').map((c) => (c.children[0] || { textContent: '' }).textContent)
    .filter(Boolean);
}
const names = (dom) => nth(dom, 0);
const control = (dom, label) => D.byTag(dom.byId('queue'), 'select')
  .filter((s) => s.getAttribute('aria-label') === label)[0];
const countLine = (dom) => (D.byClass(dom.byId('queue'), 'filter-count')[0] || {}).textContent;
function choose(sel, value) {
  sel.value = value;
  (sel._handlers.change || []).forEach((f) => f({ currentTarget: sel, target: sel }));
}

(async () => {
  const dom = boot();
  await settle();

  console.log('[the screen draws, and the bar draws with it]');
  H.eq(names(dom).join(', '),
    'Noa Levi, Dana Katz, Yuval Cohen, Ella Bar, Omer Shaked, Tal Ziv',
    'six registrations, in the order the server sent them');
  H.ok(D.byClass(dom.byId('queue'), 'filters').length === 1, 'one filter bar');
  H.eq(countLine(dom), 'Showing 6 of 6 registrations · 1 of 1 waiting',
    'and it says how many of how many — in the bar, never in the capacity line');

  // ⚠ THE CAPACITY LINE IS THE ROOM. It must go on counting every record
  // whatever the table is showing, or it becomes a true number answering a
  // different question.
  const roomBefore = dom.byId('capacity').textContent;
  H.ok(/6/.test(roomBefore) && /20 places/.test(roomBefore),
    'the capacity line reads the whole activity: ' + roomBefore.replace(/\s+/g, ' ').trim());

  console.log('\n[a group]');
  const group = control(dom, 'All groups');
  H.ok(group, 'there is a group select, because this activity has two groups');
  choose(group, 'g-adv');
  H.eq(names(dom).join(', '), 'Dana Katz, Yuval Cohen', 'only the Advanced rows');
  H.eq(countLine(dom), 'Showing 2 of 6 registrations · 1 of 1 waiting',
    'and the waiting family on that group is still listed — it is a fact about them too');
  H.eq(dom.byId('capacity').textContent, roomBefore,
    '⚠ and the capacity line has not moved: it counts the room, not the table');

  console.log('\n[including the rows that predate the groups]');
  choose(group, '-');
  H.eq(names(dom).join(', '), 'Tal Ziv',
    'a place taken while the activity was pooled belongs to no row, and says so');
  choose(group, '');

  console.log('\n[a status]');
  const status = control(dom, 'Any status');
  H.ok(/Pending \(1\)/.test(status.textContent) && /Approved \(4\)/.test(status.textContent),
    'the options carry their counts, so the control is also a summary: ' +
    status.textContent.replace(/\s+/g, ' '));
  choose(status, 'cancelled');
  H.eq(names(dom).join(', '), 'Omer Shaked', 'one cancelled row');

  console.log('\n[⚠ and a narrowed table never says nobody has registered]');
  choose(status, 'rejected');
  H.eq(D.byTag(dom.byId('queue'), 'table').length, 0, 'nothing matches');
  const said = dom.byId('queue').textContent;
  H.ok(said.indexOf('Nobody has registered') === -1,
    '⚠ NOT that sentence — it is true of an empty activity and a lie about a ' +
    'narrowed one, and it is the one thing this screen must not get wrong');
  H.ok(/Nothing matches these filters/.test(said),
    'it says what actually happened instead');
  choose(status, '');

  console.log('\n[the waiting list is a status, so asking for it asks for only it]');
  choose(status, 'waiting');
  H.eq(D.byTag(dom.byId('queue'), 'table').length, 1,
    'no registrations table at all — none of them is waiting');
  H.ok(/Roni Adler/.test(dom.byId('queue').textContent), 'and the queue is what is left');
  choose(status, '');

  console.log('\n[payment, derived from the figures and not from the stored word]');
  const pay = control(dom, 'Any payment');
  choose(pay, 'owes');
  H.eq(names(dom).join(', '), 'Noa Levi, Yuval Cohen, Omer Shaked, Tal Ziv',
    '⚠ Ella Bar is NOT here. Her record says payment.status "owed" and she owes ' +
    'nothing — the roster prints "€0.00 / €0.00 OWED" for exactly that reason, ' +
    'and a filter reading that field would have inherited it');
  choose(pay, 'settled');
  H.eq(names(dom).join(', '), 'Dana Katz', 'settled is billed and covered');
  choose(pay, 'none');
  H.eq(names(dom).join(', '), 'Ella Bar', 'and nothing to pay is its own answer');

  console.log('\n[and a money question stands the queue down rather than guessing]');
  H.ok(dom.byId('queue').textContent.indexOf('Roni Adler') === -1,
    'somebody waiting holds nothing and owes nothing, so they are neither owing ' +
    'nor settled — the list steps aside rather than being filed under one');
  choose(pay, '');

  console.log('\n[the age flag, which is what "waiting for me" actually means]');
  const box = D.byClass(dom.byId('queue'), 'filter-check')[0];
  H.ok(box && /Age flagged \(1\)/.test(box.textContent), 'the checkbox names its count');
  D.byTag(box, 'input')[0].click();
  H.eq(names(dom).join(', '), 'Yuval Cohen', 'the one row a person has to look at');
  D.byTag(box, 'input')[0].click();

  console.log('\n[a name or an email, which is how the phone call goes]');
  const q = D.byTag(dom.byId('queue'), 'input').filter((i) => i.type === 'search')[0];
  H.ok(q, 'there is a search box');
  q.value = 'dana@';
  (q._handlers.input || []).forEach((f) => f({ currentTarget: q, target: q }));
  H.eq(names(dom).join(', '), 'Dana Katz', 'an email finds the row');
  // ⚠ THE BOX SURVIVES THE REDRAW. Rebuilding the bar on every keystroke takes
  // the focus out of the input one character in, which is why only the rows
  // below it are redrawn.
  const again = D.byTag(dom.byId('queue'), 'input').filter((i) => i.type === 'search')[0];
  H.ok(again === q, '⚠ and it is the SAME node after the redraw, so what is being ' +
    'typed into keeps the focus and keeps its value');
  H.eq(again.value, 'dana@', 'with what was typed still in it');

  console.log('\n[Clear is there only while there is something to clear]');
  const clear = D.byClass(dom.byId('queue'), 'filter-clear')[0];
  H.eq(clear.hidden, false, 'shown while a filter is on');
  clear.click();
  await settle();
  H.eq(names(dom).length, 6, 'everything is back');
  H.eq(D.byClass(dom.byId('queue'), 'filter-clear')[0].hidden, true,
    'and the button puts itself away — a Clear on an unfiltered table does nothing');

  console.log('\n[⚠ and the filters do not follow you to the next activity]');
  choose(control(dom, 'All groups'), 'g-adv');
  H.eq(names(dom).join(', '), 'Dana Katz, Yuval Cohen', 'narrowed on this activity');
  D.byTag(dom.byId('picker'), 'button')[1].click();
  await settle();
  H.eq(names(dom).join(', '), 'Amit Gur',
    '⚠ the next activity draws in full. A group belongs to an activity, so a ' +
    'group filter carried across the picker matches nothing on the next one — ' +
    'and an empty table there reads as an activity nobody has registered for');

  console.log('\n[a control appears only when it can change what is shown]');
  H.ok(!control(dom, 'All groups'),
    'no group select on an activity with no named groups — "All" plus one thing ' +
    'is not a choice');
  H.ok(!control(dom, 'Any status'), 'and no status select over a single status');
  H.ok(!D.byClass(dom.byId('queue'), 'filter-check').length,
    'and no age checkbox where nothing is flagged');
  H.eq(D.byClass(dom.byId('queue'), 'filters').length, 0,
    'with nothing left to offer, the bar is not drawn at all — no threshold, no ' +
    'judgement about how long a list has to be');

  // =========================================================================
  console.log('\n[the row controls are glyphs, and every one still says what it is]');
  const back = boot();
  await settle();
  const acts = D.byClass(back.byId('queue'), 'acts')[0];
  const icons = D.byTag(acts, 'button');
  H.eq(icons.length, 4, 'four controls on a row, on one line rather than two');
  icons.forEach((b) => {
    H.ok(/\bicon\b/.test(b.className), 'drawn as a glyph: ' + b.getAttribute('aria-label'));
    H.eq(b.textContent, '', 'with no text node, which is what made the row two lines tall');
    // ⚠ THREE PLACES, and each covers a reader the others do not.
    const label = b.getAttribute('aria-label');
    H.ok(label && label.length > 3, 'an aria-label, so a screen reader says more than "button"');
    const tip = b.getAttribute('data-tip');
    H.ok(tip && tip.indexOf(label) === 0, 'a tooltip that opens with the same verb');
    H.eq(b.getAttribute('title'), tip,
      'and a title, which is all a touch device with no hover has');
  });
  H.eq(icons.map((b) => b.getAttribute('aria-label')).join(', '),
    'Approve, Reject, Cancel, Payments and credit', 'named in the order they were');
  // The glyph is drawn, not typed. ⚠ createElementNS: an <svg> made with
  // createElement is an HTMLUnknownElement and draws nothing at all.
  const svg = D.byTag(icons[0], 'svg')[0];
  H.ok(svg, 'there is a picture in it');
  H.eq(svg.namespaceURI, 'http://www.w3.org/2000/svg',
    '⚠ in the SVG namespace — createElement would have made a node that renders nothing');
  H.ok(D.byTag(icons[2], 'circle').length === 1,
    'and cancel is a slashed circle rather than a second cross: rejecting and ' +
    'cancelling are different acts, and two crosses would say they are one');

  // ⚠ AND THE TOOLTIP SAYS WHAT THAT DIFFERENCE IS. Asked plainly — "what is
  // the difference between cancel and reject?" — by the person who commissioned
  // this screen. If they cannot tell, an admin working a queue cannot either, and
  // one of the two writes an irreversible line in a ledger.
  const tipFor = (i) => icons[i].getAttribute('data-tip');
  H.ok(/nothing is owed and nothing is credited/.test(tipFor(1)),
    'reject says no money moves: ' + tipFor(1));
  H.ok(/credit/.test(tipFor(2)) && /cannot be undone/.test(tipFor(2)),
    'cancel says a credit is written and cannot be undone: ' + tipFor(2));
  H.ok(tipFor(1) !== tipFor(2), 'and the two do not read the same');

  console.log('\n[and the tooltip answers a keyboard, not only a mouse]');
  const css2 = read('admin/admin.css');
  const tip = css2.slice(css2.indexOf('.queue .acts button[data-tip]::after'),
                         css2.indexOf('@media (prefers-reduced-motion'));
  H.ok(/:hover::after/.test(tip), 'it opens on hover');
  H.ok(/:focus-visible::after/.test(tip),
    '⚠ and on focus — a control only a mouse can explain is unreadable to ' +
    'anybody tabbing through the queue');

  console.log('\n[⚠ the waiting list has a way to give somebody the place]');
  const wait = D.byTag(back.byId('queue'), 'table')[1];
  H.ok(wait, 'the waiting list is still its own table, not a sixth kind of queue row');
  const give = D.byTag(wait, 'button')[0];
  H.ok(give, '⚠ and it has a control at all, which it never had');
  H.eq(give.textContent, 'Give a place',
    '⚠ A WORD, not a glyph. Icons earn their place on four controls repeated ' +
    'down every row; this is one control on a table that has never had any, and ' +
    'it does something nobody expects to be possible');
  // Roni waits on g-adv, which has 8 left in the fixture.
  H.eq(give.disabled, false, 'live while that group has room');

  console.log('\n[and it is that GROUP\'s room, never the activity\'s]');
  // g-adv full, g-beg wide open: the activity has places and this family cannot
  // have one. Under the equal-hours rule the other group is a different day, a
  // different room and a different teacher.
  const tight = JSON.parse(JSON.stringify(QUEUE));
  tight.capacity.named[1].left = 0;
  tight.capacity.left = 8;
  const dom2 = boot({ queue: tight });
  await settle();
  const give2 = D.byTag(D.byTag(dom2.byId('queue'), 'table')[1], 'button')[0];
  H.eq(give2.disabled, true,
    '⚠ disabled, though the ACTIVITY has eight places — offering it would be the ' +
    'disabled full-group option\'s mistake from the other side, and it would put ' +
    'a family in a room with no chair');
  H.ok(/full/.test(give2.getAttribute('title') || ''), 'and says why: ' + give2.getAttribute('title'));

  console.log('\n[pressing it asks the server, naming the row and the activity]');
  posted.length = 0;
  give.click();
  await settle();
  const ask = posted.filter((b) => b.action === 'givePlace')[0];
  H.ok(ask, 'it posts givePlace');
  H.eq(ask.participantId, 'p-7', 'naming who');
  H.eq(ask.activityId, 'act-1', 'and which activity');
  H.eq(ask.slug, 'hebrew', 'by slug too, because the server reads the published record');

  console.log('\n[and every class the bar puts on the screen is styled]');
  const css = read('admin/admin.css');
  ['filters', 'filter-check', 'filter-count', 'filter-clear'].forEach((c) => {
    H.ok(css.indexOf('.' + c) !== -1, '.' + c + ' has a rule');
  });
  // `label` is uppercase olive everywhere else in this admin, because everywhere
  // else it names a field above it. Beside a checkbox it is a sentence.
  const check = css.slice(css.indexOf('.filters .filter-check{'),
                          css.indexOf('}', css.indexOf('.filters .filter-check{')));
  H.ok(/text-transform:\s*none/.test(check), 'and the checkbox label is not shouted at');

  H.done();
})();
