// What this defends against:
//
// A family on the HEBREW page, filling in a HEBREW form, under a HEBREW
// heading, typed a partial date of birth and was answered:
//
//     Please enter a valid value. The field is incomplete or has an invalid date.
//
// Every refusal this project writes has been trilingual since _family-errors.js
// landed — ~76 of them, and a suite that checks each one is complete in three
// languages and is actually reached. This one was not ours. It is the browser's
// own constraint-validation bubble, drawn in the browser's language from the
// `required`, `minlength` and type="email" attributes on our fields, and no
// amount of translating server strings reaches it.
//
// Same shape as the two this codebase has already met: the terms checkbox
// refusing in English on a Hebrew form, and the native <input type="time">
// printing "04:00 PM" at an admin in Cyprus. In every one of them the VALUE was
// never in question; the display was one the page could not control.
//
// The difference here is that this one has an API. setCustomValidity() puts our
// sentence in the browser's bubble and keeps everything the attributes were kept
// for — anchored to the field, scrolled to, and still blocking the submit — so
// nothing was removed and no second validation pass was added.
//
// ⚠ AND THE DATE IS THE ONE THAT COULD NOT HAVE BEEN FIXED IN A HANDLER.
// "31/mm/yyyy" reads as the EMPTY STRING from script, so a submit handler
// checking the value cannot tell an incomplete date from an untouched box. Only
// the widget knows, which is why the words have to go in the widget's bubble.
//
// It is done in field(), once, because there is one field() and a dozen callers
// — the same reason say() scrolls rather than each handler moving its own
// message. A per-form fix would have let the next form bring the English back.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const H = require('./_helpers');
const D = require('./_dom');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');
const memberSession = read('js/member-session.js');
const memberAccount = read('js/member-account.js');
const src = memberAccount;

// The signed-OUT screens, which is where every one of these fields lives: sign
// in, sign up, forgot, reset. No session, so nothing is fetched and the render
// is synchronous.
function signedOut(lang, view) {
  const dom = D.makeDom({ view: view || 'account', lang: lang, fetch: () => new Promise(function () {}) });
  const ctx = vm.createContext({
    window: dom.window, document: dom.document, console: console, location: dom.window.location,
    Intl: Intl, Date: Date, Math: Math, JSON: JSON, Object: Object, Array: Array,
    String: String, Number: Number, RegExp: RegExp, Promise: Promise, setTimeout: setTimeout,
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent
  });
  vm.runInContext(memberSession, ctx, { filename: 'js/member-session.js' });
  vm.runInContext(memberAccount, ctx, { filename: 'js/member-account.js' });
  return dom;
}

// Every <input> the screen drew, in document order.
function inputs(dom) {
  const out = [];
  (function walk(n) {
    n.childNodes.forEach((c) => { if (c.tagName === 'INPUT') out.push(c); walk(c); });
  })(dom.mount);
  return out;
}

// What the bubble WOULD say, given the rule the browser found broken.
function bubble(input, validity) {
  input.validity = validity;
  input.validationMessage = '';
  input.dispatch('invalid');
  return input.validationMessage;
}

const HEBREW = /[֐-׿]/;
const CYRILLIC = /[Ѐ-ӿ]/;

// ---------------------------------------------------------------------------
console.log('[the bubble speaks the language of the page it is drawn on]');

// Hebrew is the default tree and the language the bug was reported in.
{
  const dom = signedOut('he');
  const all = inputs(dom);
  H.ok(all.length >= 2, 'the signed-out screen drew its fields — ' + all.length + ' inputs');

  const email = all.filter((i) => i.getAttribute('type') === 'email')[0];
  H.ok(!!email, 'there is an email field on the sign-in screen');

  // ⚠ THE THREE RULES THAT CAN ACTUALLY FIRE on these forms, each asserted to
  // produce Hebrew. valueMissing comes from `required`, typeMismatch from
  // type="email", badInput from type="date", tooShort from minlength — and
  // that is the complete set of validation attributes in the file, checked
  // below so a fifth one cannot be added without a message.
  H.ok(HEBREW.test(bubble(email, { valueMissing: true })),
    'an empty required field refuses in Hebrew: ' + bubble(email, { valueMissing: true }));
  H.ok(HEBREW.test(bubble(email, { typeMismatch: true })),
    'a malformed address refuses in Hebrew: ' + bubble(email, { typeMismatch: true }));
  H.ok(HEBREW.test(bubble(email, { badInput: true })),
    'an incomplete date refuses in Hebrew: ' + bubble(email, { badInput: true }));
  H.ok(HEBREW.test(bubble(email, { tooShort: true })),
    'a short password refuses in Hebrew: ' + bubble(email, { tooShort: true }));

  // The four are not one sentence wearing four hats. A person who typed an
  // address into a date box and a person who left it blank have different
  // things to do next.
  const said = [
    bubble(email, { valueMissing: true }),
    bubble(email, { typeMismatch: true }),
    bubble(email, { badInput: true })
  ];
  H.eq(new Set(said).size, 3, 'and the three say three different things');

  // ⚠ CLEARED ON INPUT, or the field can never be submitted again. A custom
  // message IS the invalid state rather than a description of one, so a field
  // set once and never cleared is permanently refused whatever is typed into
  // it — which would be a worse bug than the one being fixed.
  H.ok(email.validationMessage.length > 0, 'the message is set');
  email._handlers.input.forEach((f) => f({ target: email }));
  H.eq(email.validationMessage, '', 'and cleared the moment anything is typed');
}

// Russian, because a key quietly left holding the Hebrew is invisible to a
// reviewer who does not read the language — the same check
// a-refusal-is-in-the-language-it-is-read-in.js makes of the server's table.
{
  const dom = signedOut('ru');
  const email = inputs(dom).filter((i) => i.getAttribute('type') === 'email')[0];
  H.ok(CYRILLIC.test(bubble(email, { valueMissing: true })), 'Russian refuses in Cyrillic');
  H.ok(CYRILLIC.test(bubble(email, { badInput: true })), 'including the incomplete date');
  H.ok(CYRILLIC.test(bubble(email, { typeMismatch: true })), 'and the malformed address');
}

// English, which is the one that was right by accident.
{
  const dom = signedOut('en');
  const email = inputs(dom).filter((i) => i.getAttribute('type') === 'email')[0];
  const msg = bubble(email, { badInput: true });
  H.ok(!HEBREW.test(msg) && !CYRILLIC.test(msg) && msg.length > 0, 'English says it in English');
}

// ---------------------------------------------------------------------------
console.log('[the field it was actually reported on]');

// ⚠ THE DATE OF BIRTH ITSELF, on the screen it was reported from. Every
// assertion above could pass against a screen that never draws a date input —
// and the date is the one failure a submit handler could not have caught,
// because "31/mm/yyyy" reads as the empty string from script.
{
  const FAMILY = [
    { participantId: 'p-1', firstName: 'Noa', lastName: 'Levi',
      dateOfBirth: '2017-04-02', age: 9, isSelf: false, isPrimary: true }
  ];
  const answers = {
    me: () => ({ ok: true, account: { accountId: 'a-1', email: 'michal@example.com',
      emailVerifiedAt: '2026-01-01T00:00:00Z',
      profile: { firstName: 'Michal', lastName: 'Shinitzky', preferredLanguage: 'he' } } }),
    listParticipants: () => ({ ok: true, participants: FAMILY })
  };
  const dom = D.makeDom({ view: 'details', lang: 'he', fetch: function (endpoint, init) {
    const body = JSON.parse(init.body);
    const fn = answers[body.action];
    if (!fn) return new Promise(function () {});
    return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(fn(body)) });
  } });
  dom.window.localStorage.setItem('ogenMemberSession', JSON.stringify({
    token: 't', firstName: 'Michal', email: 'michal@example.com', expiresAt: Date.now() + 1e7 }));
  const ctx = vm.createContext({
    window: dom.window, document: dom.document, console: console, location: dom.window.location,
    Intl: Intl, Date: Date, Math: Math, JSON: JSON, Object: Object, Array: Array,
    String: String, Number: Number, RegExp: RegExp, Promise: Promise, setTimeout: setTimeout,
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent
  });
  vm.runInContext(memberSession, ctx, { filename: 'js/member-session.js' });
  vm.runInContext(memberAccount, ctx, { filename: 'js/member-account.js' });

  return new Promise((r) => setTimeout(r, 30)).then(() => {
    const button = (re) => {
      let hit = null;
      (function walk(x) {
        x.childNodes.forEach((c) => {
          if (hit) return;
          if (c.tagName === 'BUTTON' && re.test(c.textContent)) { hit = c; return; }
          walk(c);
        });
      })(dom.mount);
      return hit;
    };
    // /account/details is two tabs: your own details, and the people on the
    // account. The date of birth lives on the second.
    const tab = button(/\u05d1\u05e0\u05d9 \u05d4\u05de\u05e9\u05e4\u05d7\u05d4/);
    H.ok(!!tab, 'the details screen has a tab for the people on the account');
    tab.click();
    return new Promise((r) => setTimeout(r, 30)).then(() => {
    // Open "add a participant", which is the form the report came from.
    const add = button(/^\u05d4\u05d5\u05e1\u05e4\u05ea /);
    H.ok(!!add, 'the family screen offers a way to add somebody');
    add.click();

    const dobs = inputs(dom).filter((i) => i.getAttribute('type') === 'date');
    H.eq(dobs.length, 1, 'and the form it opens draws exactly one date of birth');
    const said = bubble(dobs[0], { badInput: true });
    H.ok(HEBREW.test(said), 'an incomplete date of birth refuses in Hebrew: ' + said);
    H.ok(!/valid value|incomplete/i.test(said),
      'and not in the browser\'s own words, which is what was reported');
    rest();
    });
  });
}

function rest() {
// ---------------------------------------------------------------------------
console.log('[every field gets it, because there is one field()]');

// The fix is in the builder rather than in a form, so a field added tomorrow is
// covered without anybody remembering. Assert that: every input the screen drew
// through field() is listening.
{
  ['he', 'en', 'ru'].forEach((lang) => {
    const dom = signedOut(lang);
    const all = inputs(dom);
    const deaf = all.filter((i) => !(i._handlers.invalid && i._handlers.invalid.length));
    H.eq(deaf.length, 0,
      lang + ': every field the screen drew can answer in ' + lang + ' — ' + all.length + ' of them');
  });
}

// ---------------------------------------------------------------------------
console.log('[and the attributes stayed]');

// ⚠ THE BUG WAS NOT FIXED BY REMOVING `required`, AND IT COULD NOT HAVE BEEN.
// A date input with "31/mm/yyyy" in it is `badInput`, which blocks the submit
// whether or not the field is required — so dropping the attribute would have
// left the English bubble exactly where it was and taken the format checking,
// the focus and the scroll with it.
H.ok(/type: 'date', required: 'required'/.test(src),
  'the date of birth is still required — the bubble was the bug, not the rule');
H.ok(/minlength: MIN_PASSWORD/.test(src), 'and the password still states its minimum to the browser');
H.ok(/type: 'email'/.test(src), 'and an address is still checked as one');

// Nothing anywhere carries `novalidate`: the native pass is what is being
// filled in, not routed around. A second validation pass in a handler is a
// second place to disagree with the server about what is acceptable.
H.ok(!/novalidate/i.test(src), 'and no form opts out of validation to dodge the message');

// ⚠ THE COMPLETE SET OF VALIDATION ATTRIBUTES IN THE FILE. If a fifth one is
// added — pattern, max, step — it raises a validity flag guardNative() does not
// name, and the browser's English comes straight back through the default arm.
// This fails when that happens, which is the only moment anybody could know.
{
  const attrs = ['required', 'minlength', 'maxlength', 'pattern', 'min', 'max', 'step'];
  const used = attrs.filter((a) => new RegExp("[{,]\\s*" + a + ":").test(src));
  H.eq(used.sort().join(','), 'minlength,required',
    'only `required` and `minlength` constrain a field here, and guardNative names both');
  const types = (src.match(/type: '(\w+)'/g) || []).map((m) => m.slice(7, -1));
  const seen = Array.from(new Set(types)).sort();
  // `button`, `submit` and `tel` carry no format of their own, so the only rule
  // they can break is `required` — which guardNative names first.
  const known = ['button', 'checkbox', 'date', 'email', 'hidden', 'number',
                 'password', 'submit', 'tel', 'text'];
  H.eq(seen.filter((t) => known.indexOf(t) === -1).join(','), '',
    'and every input type here is one whose failures guardNative names: ' + seen.join(', '));
}

// The terms checkbox keeps its own handler-side check, which predates this and
// is still right: a checkbox has no format to check, so `required` on one buys
// the bubble and nothing else — and its refusal has to be the same sentence the
// server would have sent, which a validity flag cannot carry.
H.ok(/terms/i.test(src), 'the terms check is still its own thing');

H.done();
}
