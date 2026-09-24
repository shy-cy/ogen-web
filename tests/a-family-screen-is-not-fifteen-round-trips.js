// What this defends against:
//
// ⚠ THE FAMILY AREA READ ITS BLOBS ONE AT A TIME, IN SERIES.
//
// Reported as "the website is slow, especially the family section". Measured
// against the live site, an API call answered in about a second at the Netlify
// origin before it did any real work — and every screen behind it then queued
// its reads behind each other.
//
// The dashboard was the worst of them. It walked the account's participants in
// a `for` loop, awaiting the participant and then that participant's
// registrations, and then read the credit ledger after all of it:
//
//     for (const id of ids) {
//       const p    = await participants.getParticipant(id);   //  a round trip
//       const regs = await store.forParticipant(id);          //  and another
//     }
//     const entries = await ledger.entriesFor(me.accountId);  //  and another
//
// and `forParticipant` was itself a `for` loop opening one blob at a time. A
// family with three people and two registrations each paid about fifteen
// network round trips END TO END. None of them needed anything from the one
// before it — the ids were already in hand, and the BALANCE is a fact about the
// account that has nothing to do with the participants at all.
//
// Twelve store functions had the same shape. This is the lesson `_github.js`
// already carries on the publish path — "don't reintroduce a per-file await in
// a loop here" — arriving one service later, and the fix is the same: ask for
// several at once, with a cap.
//
// THE HALF THAT IS NOT SPEED, and the reason this is a suite rather than a
// commit message: the loops it replaces dropped a MISSING blob and let a BROKEN
// one take the request down. That is right, and the tempting rewrite —
// `Promise.all(keys.map(k => get(k).catch(() => null)))` — quietly turns a
// store having a bad minute into a family being shown a shorter list of their
// own registrations, with nothing erroring and nobody able to tell. So
// readMany() rejects, one caller opts out in writing, and a test holds both.

const H = require('./_helpers');
const F = require('./_fixtures');
const fs = require('fs');
const path = require('path');

const R = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(R, p), 'utf8');

process.env.RESEND_FROM = 'Merkaz Ogen <noreply@ogen.cy>';

(async () => {
  const B = require(H.fnPath('_blobs'));

  // ---------------------------------------------------------- the helper ----
  console.log('[readMany: order, gaps, and the cap]');
  const seen = [];
  let live = 0, peak = 0;
  const fake = {
    async get(key) {
      live++; if (live > peak) peak = live;
      seen.push(key);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      return key === 'gone' ? null : { key: key };
    }
  };
  const keys = ['a', 'gone', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'];
  const got = await B.readMany(fake, keys);
  H.eq(got.length, keys.length, 'one slot per key');
  H.eq(got[1], null, '⚠ INCLUDING THE EMPTY ONE — the ledger zips these back against its keys');
  H.eq(got[0].key, 'a', 'and the order is the order asked for');
  H.eq(got[11].key, 'k', 'all the way to the end');
  H.ok(peak > 1, 'reads OVERLAP rather than queueing (peak ' + peak + ')');
  H.ok(peak <= B.READ_CONCURRENCY,
    'and are capped at ' + B.READ_CONCURRENCY + ' — the cap is about sockets, not patience');

  console.log('\n[⚠ a read that FAILS is not a read that returned nothing]');
  const broken = {
    async get(key) {
      if (key === 'bad') throw Object.assign(new Error('store had a bad minute'), { code: 'x' });
      return { key: key };
    }
  };
  let threw = null;
  await B.readMany(broken, ['a', 'bad', 'c']).then(() => {}, (e) => { threw = e; });
  H.ok(threw, 'it throws rather than dropping the row');
  H.ok(/bad minute/.test(threw.message), 'with the store\'s own error, not one we invented');

  const lenient = await B.readMany(broken, ['a', 'bad', 'c'], { skipErrors: true });
  H.eq(lenient.length, 3, 'skipErrors keeps the slot');
  H.eq(lenient[1], null, 'as empty');
  // One caller, and it says why in the source. A second one is how the
  // dangerous default arrives by the back door.
  const users = fs.readdirSync(path.join(R, 'netlify/functions'))
    .filter((f) => /skipErrors/.test(read('netlify/functions/' + f)))
    .filter((f) => f !== '_blobs.js');
  H.eq(users.join(','), '_email-log.js',
    '⚠ and exactly ONE caller opts into it — the email log, which would rather ' +
    'lose one unreadable entry than lose the history');

  // ------------------------------------------------------ nothing left over --
  console.log('\n[no store opens its blobs one at a time any more]');
  const offenders = [];
  fs.readdirSync(path.join(R, 'netlify/functions'))
    .filter((f) => f.endsWith('.js') && f !== '_blobs.js')
    .forEach((f) => {
      const lines = read('netlify/functions/' + f).split('\n');
      let loop = -1;
      lines.forEach((l, i) => {
        if (/\bfor \(|\.forEach\(/.test(l)) loop = i;
        if (loop >= 0 && i - loop <= 8 && /await [\w.]*\.(get|delete)\(/.test(l) &&
            !/Many\(/.test(l)) {
          offenders.push(f + ':' + (i + 1));
          loop = -1;
        }
      });
    });
  H.eq(offenders.join(' '), '',
    'every list is read together — ' + (offenders.length ? 'found ' + offenders.join(' ') : 'none left'));

  // ------------------------------------------------------- the real screen ---
  // ⚠ EXECUTED, WITH A CLOCK. Reading the source proves the source no longer
  // says `for`; only running it with a cost per read proves the round trips
  // actually overlap. 12ms a read is arbitrary and the ASSERTION IS A RATIO,
  // not a millisecond count, so this cannot fail on a slow machine.
  console.log('\n[the dashboard, with a cost on every read]');
  const LATENCY = 12;
  const blobs = H.makeBlobs({ latencyMs: LATENCY });
  const autumn = F.course({ slug: 'autumn', activityId: 'act-0000000000000a01' });
  const spring = F.course({ slug: 'spring', activityId: 'act-0000000000000a02' });
  const github = H.makeGithub({
    'activities/autumn.json': JSON.stringify(autumn),
    'activities/spring.json': JSON.stringify(spring)
  });
  const mods = H.loadWithStubs({
    blobs, github,
    modules: ['_session-store', '_registration-store', '_credit-ledger',
              'account-auth', 'account-family', 'account-registrations']
  });
  const auth = mods['account-auth'];
  const family = mods['account-family'];
  const regs = mods['account-registrations'];

  const r = await H.signUp(auth, blobs, {
    action: 'signup', email: 'dana@example.com', password: 'password-123',
    termsAccepted: true, profile: { firstName: 'Dana', preferredLanguage: 'he' }
  });
  const dana = { token: r.body.token, accountId: r.body.account.accountId };
  await H.confirmAddress(blobs, dana.accountId);

  // Four people, two registrations each: a real family at this centre, and
  // sixteen-odd reads behind one screen.
  const kids = ['Noa', 'Yonatan', 'Maya', 'Eitan'];
  for (const name of kids) {
    const made = await H.call(family.handler, {
      action: 'createParticipant', token: dana.token,
      participant: { firstName: name, lastName: 'Levi', dateOfBirth: '2016-04-02' }
    });
    for (const slug of ['autumn', 'spring']) {
      await H.call(regs.handler, { action: 'submit', token: dana.token, slug: slug,
                                   participantId: made.body.participant.participantId });
    }
  }

  blobs._reset();
  const began = Date.now();
  const board = await H.call(regs.handler, { action: 'dashboard', token: dana.token });
  const took = Date.now() - began;
  const counts = blobs._counts();

  H.eq(board.status, 200, 'the dashboard answers');
  H.eq(board.body.participantCount, 4, 'with four people');
  H.eq(board.body.registrations.length, 8, 'and eight registrations');
  // Order is the property Promise.all buys over pushing as they land. A list
  // that reshuffles between two loads reads as a screen that cannot be trusted.
  const first = board.body.registrations.map((x) => x.participantName + '/' + x.slug).join(',');
  const again = await H.call(regs.handler, { action: 'dashboard', token: dana.token });
  H.eq(again.body.registrations.map((x) => x.participantName + '/' + x.slug).join(','), first,
    'in a stable order — Promise.all over a map, never pushed as they land');

  console.log('  ..   ' + counts.reads + ' reads, up to ' + counts.peak +
              ' at once, in ' + took + 'ms (serial would be ~' +
              (counts.reads * LATENCY) + 'ms)');
  H.ok(counts.peak > 1, '⚠ THE READS OVERLAP — this is the whole fix');
  H.ok(took < counts.reads * LATENCY * 0.7,
    'and the screen costs well under the serial total');

  // ------------------------------------------------------------ the people ---
  console.log('\n[and the people list]');
  blobs._reset();
  const people = await H.call(family.handler, { action: 'listParticipants', token: dana.token });
  H.eq(people.status, 200, 'it answers');
  H.eq(people.body.participants.length, 4, 'with everybody on the account');
  H.ok(blobs._counts().peak > 1, 'reading the participant and their link together');
  H.ok(people.body.participants.every((p) => p.age != null),
    'and the derived age survived the rewrite');

  H.done();
})();
