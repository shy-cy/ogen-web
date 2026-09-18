// What this defends against:
//
// The ask was "can the payment email log the family in and drop them on the
// payment page". The honest version of that — a magic link minting a session —
// hands whoever opens a forwarded message the entire family record: children's
// names, dates of birth, medical notes, the members-only address. Family
// inboxes get forwarded. This project already refuses that shape once, in the
// guardian invitation, which is bound to the address it was sent to precisely
// so a forwarded link cannot hand a stranger a child's record.
//
// So the link that was built hands them a BILL instead. It opens Stripe
// Checkout for one registration and can do nothing else. Everything below is a
// property of that sentence:
//
//   - it never returns a body, so trying tokens can never READ anything;
//   - it mints no session and touches no session store;
//   - it lives in its own Blobs store, because a token filed beside the
//     password-reset tokens is one forgotten `purpose` argument away from being
//     redeemable as one — and consumeToken() takes that argument OPTIONALLY;
//   - it re-reads the registration every time, so a link in an old email cannot
//     charge for a place that has since been cancelled or already paid for;
//   - the amount is computed from the record and is not a parameter, because
//     this is reachable with no session at all;
//   - and the 302 it answers with must never be cached, or a shared cache hands
//     the next family the previous family's one-time Checkout URL.

const fs = require('fs');
const path = require('path');
const H = require('./_helpers');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';
process.env.STRIPE_SECRET_KEY = 'sk_test_not_used_the_client_is_stubbed';

(async () => {
  console.log('[it is not a session, and it cannot become one]');
  // ⚠ COMMENT-STRIPPED. Both files EXPLAIN at length why they do not use the
  // session store, naming it — so a naive search finds the words in the prose
  // and passes whether or not the code is still clean. The same trap the
  // activity stylesheet's height:auto assertion had to learn about.
  const strip = (js) => js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const src = strip(read('netlify/functions/_pay-link.js'));
  const handler = strip(read('netlify/functions/pay-link.js'));

  H.ok(!/_member-session|createSession|msess-/.test(src + handler),
    'neither the store nor the endpoint touches a session store or mints a session');
  H.ok(/'pay-links'/.test(src), 'the tokens live in their own store');
  H.ok(!/member-tokens|createToken|consumeToken/.test(src + handler),
    'and NOT in the one holding password-reset tokens — consumeToken() takes its ' +
    'purpose optionally, so the call that forgets it is an account takeover');
  H.ok(/crypto\.randomBytes\(32\)/.test(src),
    'the token is 32 CSPRNG bytes, never derived from the registration it names');

  console.log('\n[every answer is a redirect — there is nothing to read]');
  H.ok(!/statusCode: 200/.test(handler), 'it never answers 200');
  H.eq((handler.match(/statusCode: 302/g) || []).length, 1,
    'there is exactly one response shape, and it is a 302');
  H.ok(!/JSON\.stringify/.test(handler), 'and nothing is ever serialised into a body');
  H.ok(/body: ''/.test(handler), 'the body is empty on every path');

  console.log('\n[the refusals do not describe what they are refusing]');
  H.ok(/\?pay=' \+ reason/.test(handler), 'a refusal carries a machine-readable reason');
  // An unknown token must not have a participant and an activity put into the
  // URL it is sent to — that would make a wrong guess informative.
  H.ok(/refuse\(lang, 'expired'\)(?![\s\S]{0,40}reg)/.test(handler),
    'an unknown token is sent to the account page, naming nobody');

  console.log('\n[the client turns each reason into a sentence, in three languages]');
  const ui = read('js/member-account.js');
  ['expired', 'not-approved', 'nothing-due', 'failed'].forEach((reason) => {
    H.eq((ui.match(new RegExp("'?" + reason + "'?:", 'g')) || []).length >= 3, true,
      reason + ' is in all three tables');
  });
  H.ok(/function payLinkNotice/.test(ui), 'and one function decides which is shown');

  // ------------------------------------------------------------- end to end
  console.log('\n[running it: a live token opens Stripe for exactly what is owed]');
  const blobs = H.makeBlobs();
  const mods = H.loadWithStubs({
    blobs,
    modules: ['_pay-link', '_registration-store', '_stripe', 'pay-link', '_account-store']
  });
  const links = mods['_pay-link'];
  const store = mods['_registration-store'];
  const pay = mods['pay-link'];

  const created = [];
  mods['_stripe']._internal.setClient({
    checkout: { sessions: { create: async (args) => {
      created.push(args);
      return { id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' };
    } } }
  });

  const reg = {
    participantId: 'p-1', activityId: 'act-1', accountId: 'a-1', status: 'approved',
    payment: { owedCents: 38000, paidCents: 0, creditedCents: 0 },
    frozen: { participantName: 'Noa Levi', activitySlugAtSubmission: 'hebrew4kids',
              activityTitle: { he: 'עברית לילדים', en: 'Hebrew for kids', ru: 'Иврит' } }
  };
  await store.saveRegistration(reg);

  const link = await links.createPayLink(reg, 'he');
  H.ok(link.token && link.token.length > 20, 'a token is minted');

  const run = (q) => pay.handler({ queryStringParameters: q });
  let res = await run({ t: link.token });
  H.eq(res.statusCode, 302, 'a live token redirects');
  H.eq(res.headers.Location, 'https://checkout.stripe.com/c/pay/cs_test_1', 'to Stripe');
  H.ok(/no-store/.test(res.headers['Cache-Control']),
    'and says no-store — the destination is a ONE-TIME session URL');
  H.eq(created[0].line_items[0].price_data.unit_amount, 38000,
    'for the amount outstanding, computed from the record');
  H.eq(created[0].metadata.organization, 'ogen',
    'tagged as ours, on an account shared with another organisation');
  H.eq(created[0].payment_intent_data.statement_descriptor_suffix, 'Ogen CTR',
    'and the charge will read as Ogen rather than as the other organisation');
  H.eq(created[0].metadata.participant_id, 'p-1', 'the webhook is told who');
  H.eq(created[0].metadata.activity_id, 'act-1', 'and what');

  console.log('\n[it is NOT single use — a debt can be looked at twice]');
  res = await run({ t: link.token });
  H.eq(res.statusCode, 302, 'the same link works again');
  H.eq(created.length, 2, 'and opens a fresh session rather than reusing a spent one');

  console.log('\n[but the REGISTRATION decides, every time, not the token]');
  // A part payment: the second session must be for what is left, not for the
  // figure that was outstanding when the message was sent.
  await store.saveRegistration(Object.assign({}, reg, {
    payment: { owedCents: 38000, paidCents: 20000, creditedCents: 0 } }));
  await run({ t: link.token });
  H.eq(created[2].line_items[0].price_data.unit_amount, 18000,
    'the amount follows the record, so an old email cannot charge an old figure');

  await store.saveRegistration(Object.assign({}, reg, {
    payment: { owedCents: 38000, paidCents: 38000, creditedCents: 0 } }));
  res = await run({ t: link.token });
  H.eq(created.length, 3, 'a settled registration opens no session at all');
  H.ok(/pay=nothing-due/.test(res.headers.Location), 'and says why');
  H.ok(/\/account\/activity\?p=p-1&a=act-1/.test(res.headers.Location),
    'on the page that shows the figures, since this reader is known to be theirs');

  await store.saveRegistration(Object.assign({}, reg, { status: 'cancelled' }));
  res = await run({ t: link.token });
  H.eq(created.length, 3, 'a cancelled registration opens no session either');
  H.ok(/pay=not-approved/.test(res.headers.Location), 'and says why');

  console.log('\n[an unknown or expired token names nobody]');
  res = await run({ t: 'not-a-token', l: 'ru' });
  H.eq(res.statusCode, 302, 'it still redirects rather than erroring');
  H.eq(res.headers.Location, 'https://www.ogen.cy/ru/account?pay=expired',
    'to the sign-in page, in the tree the link said, carrying no participant');
  H.eq(created.length, 3, 'and nothing was created for it');

  const stale = await links.createPayLink(reg, 'en');
  const raw = await blobs.requireStore('pay-links');
  await raw.setJSON('pay-' + stale.token,
    Object.assign(await raw.get('pay-' + stale.token, { type: 'json' }),
                  { expiresAt: Date.now() - 1000 }));
  H.eq(await links.readPayLink(stale.token), null, 'an expired token reads as nothing');
  res = await run({ t: stale.token, l: 'en' });
  H.eq(res.headers.Location, 'https://www.ogen.cy/en/account?pay=expired',
    'and is refused the same way an invented one is');

  // ------------------------------------------------------- the emails and toml
  console.log('\n[the link is in the two messages that carry a balance, and no others]');
  const mail = require(H.fnPath('_registration-email'));
  const acct = (l) => ({ email: 'd@example.com', profile: { preferredLanguage: l } });
  ['he', 'en', 'ru'].forEach((l) => {
    const url = 'https://www.ogen.cy/pay?t=TOK&l=' + l;
    // As it appears in an href inside HTML, which is where shell() puts it.
    const href = url.replace(/&/g, '&amp;');
    H.ok(mail.approvedMessage(reg, acct(l), url).html.indexOf(href) !== -1,
      l + ': the approval carries it — approval is when payment opens');
    H.ok(mail.approvedMessage(reg, acct(l)).html.indexOf('/pay?t=') === -1,
      l + ': and falls back to the registration page when minting failed');
    H.ok(mail.paidMessage(reg, acct(l), 15000, 20000, url).html.indexOf(href) !== -1,
      l + ': a part payment offers the balance');
    H.ok(mail.paidMessage(reg, acct(l), 38000, 0, url).html.indexOf(href) === -1,
      l + ': a SETTLED receipt does not — asking for money that is not owed');
    H.ok(mail.receivedMessage(reg, acct(l)).html.indexOf('/pay?t=') === -1,
      l + ': and a registration still awaiting approval has nothing to pay yet');
  });

  console.log('\n[nothing may cache the redirect]');
  const toml = read('netlify.toml');
  const block = toml.slice(toml.indexOf('for = "/pay"'), toml.indexOf('for = "/pay"') + 220);
  H.ok(/no-store/.test(block), '/pay is no-store at the edge as well as in the function');
  H.ok(!/s-maxage/.test(block),
    'and carries no s-maxage — sixty seconds of shared cache on a one-time ' +
    'Checkout URL hands the next family the previous one\'s session');
  H.ok(/from = "\/pay"[\s\S]{0,120}status = 200/.test(toml),
    'the route is a rewrite, so the function\'s own 302 is what the reader follows');

  H.done();
})();
