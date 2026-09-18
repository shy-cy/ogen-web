// What this defends against:
//
// Approval is binary and carries NO REASON CODE, by design — so the generated
// rejection message cannot explain itself. It opens a door instead: "reply to
// this message and we will talk it through." That is the right default and it
// is a poor answer when the admin pressing the button already knows the reason,
// because the alternative is a second email the family has to connect to the
// first.
//
// So this one message can be rewritten before it goes, in the same WYSIWYG the
// activity body uses. Three things had to be true for that to be safe, and each
// is a way it could have gone wrong:
//
//  1. THE UNEDITED DRAFT MUST BE THE GENERATED MESSAGE, byte for byte. The
//     editor strips inline styles and so does the sanitiser — correctly, since
//     `style` is one of the attributes an allowlist exists to remove — so a body
//     that came back from Quill carries bare <p> tags. Author the spacing into
//     the draft and every reviewed message arrives spaced differently from every
//     generated one. The shell applies it on the way out instead.
//
//  2. THE SERVER SANITISES, ALWAYS. The markup arrives in a request body like
//     any other field and is printed into an inbox unescaped. Same allowlist as
//     the About field, same module — lifted out of activities-admin.js precisely
//     so this handler need not drag GitHub, Blobs, the template and the image
//     pipeline in to clean one string.
//
//  3. A BLANK MESSAGE MUST BE REFUSED BEFORE THE DECISION IS TAKEN. Refusing
//     afterwards leaves a family rejected with nothing sent, and a rejection is
//     the one message this system will not resend.
//
// And the draft is in the FAMILY'S language, not the admin's. That is the
// awkward part of the feature and it is not hidden.

const H = require('./_helpers');
const F = require('./_fixtures');
const fs = require('fs');
const path = require('path');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');

(async () => {
  const blobs = H.makeBlobs();
  const activity = F.course({ slug: 'term', activityId: 'act-0000000000000r01' });
  const github = H.makeGithub({ 'activities/term.json': JSON.stringify(activity) });

  const mods = H.loadWithStubs({
    blobs, github,
    modules: ['_session-store', '_registration-store', 'account-auth', 'account-family',
              'account-registrations', 'admin-registrations', '_registration-email']
  });
  const store = mods['_registration-store'];
  const auth = mods['account-auth'];
  const family = mods['account-family'];
  const regs = mods['account-registrations'];
  const adminRegs = mods['admin-registrations'];
  const mail = mods['_registration-email'];

  let sent = [];
  let failNext = false;
  require(H.fnPath('_email'))._internal.setTransport({
    emails: { send: async (a) => {
      if (failNext) { failNext = false; throw new Error('Resend is down'); }
      sent.push(a);
      return { data: { id: 'id-' + sent.length } };
    } }
  });

  // A family that reads RUSSIAN, on purpose: the whole point of the draft
  // carrying a language is that it is not the admin's.
  const r = await H.call(auth.handler, {
    action: 'signup', email: 'dana@example.com', password: 'password-123', termsAccepted: true,
    profile: { firstName: 'Dana', preferredLanguage: 'ru' }
  });
  const dana = { token: r.body.token };
  const made = await H.call(family.handler, {
    action: 'createParticipant', token: dana.token,
    participant: { firstName: 'Noa', lastName: 'Levi', dateOfBirth: '2017-04-02' }
  });
  const noa = made.body.participant.participantId;
  const target = { participantId: noa, activityId: activity.activityId };

  const session = await H.installSession(blobs, H.superAdminSession({ token: 'adm', email: 'a@ogen.cy' }));
  const adm = (body) => H.call(adminRegs.handler, Object.assign({ token: session.token }, body));
  const submit = () => H.call(regs.handler,
    { action: 'submit', token: dana.token, slug: 'term', participantId: noa });

  await submit();

  console.log('[the draft is in the family\'s language, and says so]');
  // Signing up and registering each send a message of their own; what matters
  // here is that PREVIEWING adds none.
  const before = sent.length;
  let draft = await adm(Object.assign({ action: 'rejectPreview' }, target));
  H.eq(draft.status, 200, 'the preview is served');
  H.eq(draft.body.lang, 'ru', 'in RUSSIAN — the language the family reads, not the admin');
  H.eq(draft.body.to, 'dana@example.com', 'and names who will receive it');
  H.ok(draft.body.subject && draft.body.bodyHtml, 'with a subject and a body to edit');
  H.ok(/<p>/.test(draft.body.bodyHtml) && !/style=/.test(draft.body.bodyHtml),
    'the body is BARE markup — the editor strips styles, so authoring them here loses them');

  console.log('\n[the preview decides nothing — opening it and closing it changes nothing]');
  let reg = await store.getRegistration(noa, activity.activityId);
  H.eq(reg.status, 'pending', 'the registration is untouched');
  H.eq(sent.length, before, 'and nothing was sent by looking');

  console.log('\n[a blank message is refused BEFORE the decision is taken]');
  const blank = await adm(Object.assign({ action: 'reject',
    message: { subject: 'x', bodyHtml: '<p><br></p>' } }, target));
  H.eq(blank.status, 400, 'an empty body is a mistake, not an instruction to send a blank refusal');
  reg = await store.getRegistration(noa, activity.activityId);
  H.eq(reg.status, 'pending',
    'and the registration is STILL PENDING — a rejection is never resent, so a ' +
    'family must not be left rejected with nothing sent');
  const noSubject = await adm(Object.assign({ action: 'reject',
    message: { subject: '  ', bodyHtml: '<p>Something</p>' } }, target));
  H.eq(noSubject.status, 400, 'a blank subject is refused the same way');

  console.log('\n[the server sanitises what the browser sends]');
  const nasty = await adm(Object.assign({ action: 'reject', message: {
    subject: 'About the place',
    bodyHtml: '<p onclick="steal()">Sorry.</p><script>alert(1)</script>' +
              '<a href="javascript:alert(1)">click</a><p>Do call us.</p>'
  } }, target));
  H.eq(nasty.status, 200, 'the rejection goes through');
  const mailed = sent[sent.length - 1];
  H.ok(!/onclick|<script|javascript:/i.test(mailed.html),
    'and NOTHING dangerous reached the inbox — same allowlist as the About field');
  H.ok(/Sorry\./.test(mailed.html) && /Do call us\./.test(mailed.html),
    'while the words survive, including the second paragraph');
  H.ok(/<a[^>]*>click<\/a>/.test(mailed.html), 'a link with a refused href keeps its text');
  H.eq(mailed.subject, 'About the place', 'the edited subject is what is sent');
  H.ok(/style="margin:0 0 14px;"/.test(mailed.html),
    'and the SHELL put the spacing back, so a hand-written message looks like every other one');

  console.log('\n[an unedited draft sends the generated message, byte for byte]');
  // The property preview-matches-publish asserts about a page, asserted about a
  // message: opening the panel and pressing send without typing must not change
  // a single character of what would have gone.
  const acct = { email: 'dana@example.com', profile: { preferredLanguage: 'ru' } };
  const { sanitiseRich } = require(H.fnPath('_sanitise-rich'));
  ['he', 'en', 'ru'].forEach((l) => {
    const a = { email: 'd@e.com', profile: { preferredLanguage: l } };
    const d = mail.rejectedDraft(reg, a);
    const generated = mail.rejectedMessage(reg, a);
    const reviewed = mail.rejectedMessage(reg, a,
      { subject: d.subject, bodyHtml: sanitiseRich(d.bodyHtml) });
    H.eq(reviewed.html, generated.html, l + ': the html is identical after a sanitise round trip');
    H.eq(reviewed.subject, generated.subject, l + ': and so is the subject');
  });

  console.log('\n[the decision stands if the mail fails — but the admin is TOLD]');
  await submit();                                   // re-request after the refusal
  failNext = true;
  const broke = await adm(Object.assign({ action: 'reject',
    message: { subject: 'About the place', bodyHtml: '<p>Sorry.</p>' } }, target));
  H.eq(broke.status, 200, 'the decision is not blocked by an email failure — that rule is untouched');
  H.eq(broke.body.registration.status, 'rejected', 'the registration is rejected');
  H.eq(broke.body.emailed, false,
    'and the screen is told the message did NOT go, or an admin believes a ' +
    'family was told something nobody told them');

  console.log('\n[only a role that may decide may see or send it]');
  const reader = await H.installSession(blobs, H.superAdminSession({
    token: 'reader', email: 'r@ogen.cy',
    permissions: Object.assign({}, H.superAdminSession().permissions,
      { registrations: { access: true, approve: false, cancel: false } })
  }));
  const asReader = (body) => H.call(adminRegs.handler, Object.assign({ token: reader.token }, body));
  H.eq((await asReader(Object.assign({ action: 'rejectPreview' }, target))).status, 403,
    'reading the queue is not permission to draft a refusal');
  H.eq((await asReader(Object.assign({ action: 'reject' }, target))).status, 403,
    'nor to send one');

  console.log('\n[the screen and the sanitiser]');
  const ui = read('js/registrations-admin.js');
  H.ok(/action: 'rejectPreview'/.test(ui), 'the screen asks for the draft');
  H.ok(/window\.Quill/.test(ui), 'and edits it in Quill');
  H.ok(/quill \? quill\.root\.innerHTML : area\.value/.test(ui),
    'falling back to a textarea when the CDN is unavailable, exactly as the activity body does');
  H.ok(/LANG_NAME\[draft\.lang\]/.test(ui), 'the panel names the language the family reads');
  H.ok(/res\.data\.emailed === false/.test(ui), 'and reports a send that did not happen');
  H.ok(read('admin/registrations.html').indexOf('quill.min.js') !== -1,
    'the page loads the same editor and version the activities admin loads');

  // ONE sanitiser. Two callers now — a published page and an inbox — and both
  // print the markup unescaped, so a second implementation would be a second
  // allowlist to keep in step.
  const fnDir = path.join(R, 'netlify/functions');
  const impls = fs.readdirSync(fnDir).filter((f) => f.endsWith('.js')).filter((f) =>
    /function sanitiseRich/.test(fs.readFileSync(path.join(fnDir, f), 'utf8')));
  H.eq(impls.join(','), '_sanitise-rich.js', 'there is exactly one sanitiser, in its own module');
  H.ok(!/require\('\.\/activities-admin'\)/.test(read('netlify/functions/admin-registrations.js')),
    'and the queue handler does not pull in GitHub, Blobs and the image pipeline to clean a string');

  H.done();
})();
