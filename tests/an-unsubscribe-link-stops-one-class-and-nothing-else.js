// What this defends against:
//
// A link at the foot of a reminder, in an inbox, with no sign-in behind it. Four
// ways that goes wrong, and none of them is visible from reading the handler:
//
//   A GET THAT ACTS. Mail scanners and link-preview bots fetch every URL in a
//   message before a person has opened it. A one-click GET here would switch a
//   family's reminders off because their employer's spam filter looked at the
//   email — and they would never know, because the only evidence is the absence
//   of messages. This project already has the scar one store over, where a link
//   "followed twice, by a person and then by a mail scanner" had to keep working.
//
//   A SCOPE THAT WIDENS. "It must not unsubscribe them from anything else" is a
//   promise, and a promise kept by a check is a promise one call site can forget.
//   Here the token names ONE activity and the handler derives the key it writes
//   from that record, never from the request — so there is no parameter that
//   could reach another class, another account, or another kind of email.
//
//   A TOKEN THAT READS BACK A FAMILY. The link is a bearer secret in an inbox
//   that gets forwarded. What it discloses is asserted here in full.
//
//   A CACHED ANSWER. /* carries s-maxage=60, and a shared cache holding this
//   response hands the next reader somebody else's state — the rule /pay states.

const H = require('./_helpers');

(async () => {
  const blobs = H.makeBlobs();
  const mods = H.loadWithStubs({ blobs,
    modules: ['reminders', '_reminder-link', '_reminder-store'] });
  const api = mods['reminders'];
  const links = mods['_reminder-link'];
  const prefs = mods['_reminder-store'];

  const ACC = 'acct-aaaa';
  const ACT = 'act-0000000000000111';
  const OTHER = 'act-0000000000000222';
  const link = await links.linkFor(ACC, ACT, 'Hebrew for kids', 'en');

  const call = (body, method) => api.handler({
    httpMethod: method || 'POST', body: JSON.stringify(body)
  }).then((r) => ({ status: r.statusCode, headers: r.headers,
                    body: JSON.parse(r.body || '{}') }));

  console.log('[⚠ a GET cannot change anything, whoever follows it]');
  const got = await api.handler({ httpMethod: 'GET', body: null });
  H.eq(got.statusCode, 405, 'a GET is refused outright');
  H.eq(await prefs.isOff(ACC, ACT), false,
    '⚠ and nothing moved — a mail scanner opening the link has unsubscribed nobody');

  console.log('\n[reading the link reports state and changes none]');
  let res = await call({ action: 'status', token: link.token });
  H.eq(res.status, 200, 'status answers');
  H.eq(res.body.off, false, 'reminders are on');
  H.eq(res.body.title, 'Hebrew for kids', 'and it names the class, so the page can say which');
  H.eq(res.body.lang, 'en', 'in the language the email was written in');
  H.eq(await prefs.isOff(ACC, ACT), false, 'and asking changed nothing');

  console.log('\n[⚠ what a token discloses, in full]');
  const text = JSON.stringify(res.body);
  ['@', 'acct-', ACC].forEach((leak) => H.ok(text.indexOf(leak) === -1,
    'no ' + leak + ' anywhere in the answer'));
  H.eq(Object.keys(res.body).sort().join(','), 'lang,off,ok,title',
    '⚠ four fields and no more: whether it is on, which class, which language. ' +
    'No address, no name, no date of birth, no balance, no other class');

  console.log('\n[a press stops it, and only it]');
  res = await call({ action: 'set', token: link.token, off: true });
  H.eq(res.status, 200, 'the POST is accepted');
  H.eq(res.body.off, true, 'and reports the new state');
  H.eq(await prefs.isOff(ACC, ACT), true, 'this class is off');
  H.eq(await prefs.isOff(ACC, OTHER), false,
    '⚠ and every OTHER class is untouched — by construction, not by a check');

  console.log('\n[and it is reversible from the same link]');
  res = await call({ action: 'set', token: link.token, off: false });
  H.eq(res.body.off, false, 'turning them back on works');
  H.eq(await prefs.isOff(ACC, ACT), false,
    'so a press by mistake, or by a mail client, costs one press to undo');

  console.log('\n[pressing twice is not an error]');
  await call({ action: 'set', token: link.token, off: true });
  res = await call({ action: 'set', token: link.token, off: true });
  H.eq(res.status, 200, 'the second press answers the same');
  H.eq(await prefs.isOff(ACC, ACT), true, 'and the state is the same');

  console.log('\n[⚠ the link is NOT single use and does not expire]');
  // A course runs for a year and every one of its reminders carries this link.
  // A single-use token would die on the first spam scanner and leave a family
  // with twenty-three dead links.
  const again = await links.linkFor(ACC, ACT, 'Hebrew for kids', 'en');
  H.eq(again.token, link.token,
    'and asking for one again returns the SAME token — one live secret per class, not one per message');

  console.log('\n[an unknown token says nothing about whether it ever existed]');
  const bad = await call({ action: 'status', token: 'nope-nope-nope' });
  const malformed = await call({ action: 'status', token: '' });
  H.eq(bad.status, 404, 'refused');
  H.eq(JSON.stringify(bad.body), JSON.stringify(malformed.body),
    'and an invented token answers identically to a malformed one');

  console.log('\n[a client that has not said what it wants is refused]');
  H.eq((await call({ action: 'set', token: link.token })).status, 400,
    '⚠ a missing `off` is NOT read as "unsubscribe" — the safe reading of silence');
  H.eq((await call({ action: 'set', token: link.token, off: 'yes' })).status, 400,
    'and neither is a truthy string');
  H.eq(await prefs.isOff(ACC, ACT), true, 'neither call changed the state');

  console.log('\n[never cached]');
  H.ok(/no-store/.test(res.headers['Cache-Control'] || ''),
    '⚠ no-store: /* carries s-maxage=60, and a shared cache here hands the next reader somebody else\'s answer');

  H.done();
})();
