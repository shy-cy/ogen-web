// The rule this defends:
//
// A permission enforced only in the UI is not enforced. The Russian Reviewer
// role exists to let someone fix Russian copy without being able to publish or
// to restructure the page — and the client greying out those controls proves
// nothing, because the client is hostile by assumption.
//
// The role is defined but not granted today. These assertions are what makes
// granting it later a one-line change rather than a security review.

const H = require('./_helpers');

(async () => {
  const seed = H.seedRepo();
  const github = H.makeGithub(seed.files);
  const blobs = H.makeBlobs();
  const { 'activities-admin': admin } = H.loadWithStubs({
    github, blobs, modules: ['activities-admin']
  });

  const boss = await H.installSession(blobs, H.superAdminSession());
  const ru = await H.installSession(blobs, H.ruReviewerSession());
  const asRu = { token: ru.token };

  console.log('\n[the reviewer can open the tool]');
  const auth = await H.call(admin.handler, Object.assign({ action: 'auth' }, asRu));
  H.eq(auth.status, 200, 'auth succeeds');
  H.eq(JSON.stringify(auth.body.editLangs), '["ru"]', 'the server reports Russian only');
  H.eq(auth.body.canPublish, false, 'and reports no publish right');

  console.log('\n[but cannot publish, however they ask]');
  const pub = await H.call(admin.handler, Object.assign({
    action: 'publish', baseUpdatedAt: seed.record.isoUpdated,
    activity: Object.assign({}, seed.record, { status: 'open' })
  }, asRu));
  H.eq(pub.status, 403, 'publish is refused with 403');
  H.eq(github._commits.length, 0, 'nothing was committed');

  const un = await H.call(admin.handler,
    Object.assign({ action: 'unpublish', slug: 'hebrew-for-kids' }, asRu));
  H.eq(un.status, 403, 'unpublish is refused too');
  const del = await H.call(admin.handler,
    Object.assign({ action: 'delete', slug: 'hebrew-for-kids', confirmSlug: 'hebrew-for-kids' }, asRu));
  H.eq(del.status, 403, 'so is delete');

  console.log('\n[their Hebrew and English edits are discarded, not trusted]');
  const tampered = JSON.parse(JSON.stringify(seed.record));
  tampered.about = { he: 'HEBREW TAMPERED', en: 'ENGLISH TAMPERED', ru: 'русский исправлен' };
  tampered.title = { he: 'TITLE TAMPERED', en: 'TITLE TAMPERED', ru: 'Иврит для детей' };

  const saved = await H.call(admin.handler, Object.assign({
    action: 'saveDraft', baseUpdatedAt: seed.record.isoUpdated, activity: tampered
  }, asRu));
  H.eq(saved.status, 200, 'the draft saves');

  const stored = saved.body.activity;
  H.eq(stored.about.he, seed.record.about.he, 'the Hebrew is exactly as it was — their edit was dropped');
  H.eq(stored.about.en, seed.record.about.en, 'so is the English');
  H.eq(stored.about.ru, 'русский исправлен', 'their Russian edit WAS applied');
  H.eq(stored.title.he, seed.record.title.he, 'the Hebrew title is untouched');

  console.log('\n[they get the words and not the structure]');
  const restructured = JSON.parse(JSON.stringify(stored));
  restructured.status = 'cancelled';
  restructured.motif = 'book';
  restructured.faq = [restructured.faq[0]];                       // try to delete an FAQ entry
  restructured.teachers = [];                                    // try to remove every teacher
  restructured.faq[0].a.ru = 'изменённый ответ';

  const second = await H.call(admin.handler, Object.assign({
    action: 'saveDraft', baseUpdatedAt: stored.isoUpdated, activity: restructured
  }, asRu));
  H.eq(second.status, 200, 'the second draft saves');
  const after = second.body.activity;

  H.eq(after.faq.length, seed.record.faq.length,
       'the FAQ still has every entry — they cannot delete rows');
  H.eq(after.teachers.length, seed.record.teachers.length,
       'the teachers are all still there');
  H.eq(after.motif, seed.record.motif, 'the motif is unchanged');
  H.eq(after.faq[0].a.ru, 'изменённый ответ',
       'but their Russian wording on the surviving row did apply');

  console.log('\n[the words INSIDE a structured fact merge the same way]');
  // A fact is part numbers and part sentences, and the sentences are still
  // words. The group-size override and the exact address are both translatable
  // text living beside integers — `address` was reachable only by a full-access
  // session for a while, not by decision but because the merge tested for one
  // fact by name and the second one was added later.
  const factEdit = JSON.parse(JSON.stringify(after));
  factEdit.facts.groupSize = {
    overrideText: { he: 'HEBREW TAMPERED', en: 'ENGLISH TAMPERED', ru: 'Одна смешанная группа' }
  };
  // The address is a GROUP's fact now, and so is every other word inside one —
  // which is the thing mergeGroups() had to be written for, because LANG_SUBKEYS
  // merges a sub-key of one fact and cannot reach a sub-key of one ITEM.
  factEdit.groups[0].facts.address = {
    text: { he: 'HEBREW TAMPERED', en: 'ENGLISH TAMPERED', ru: 'улица Ленина, 1' } };
  // A name they may translate, sitting beside a capacity they may not touch.
  factEdit.groups[0].name = { he: 'HEBREW TAMPERED', en: 'ENGLISH TAMPERED', ru: 'Смешанная группа' };
  factEdit.groups[0].capacity = 999;
  factEdit.groups.push({ groupId: 'g-smuggled', name: { he: 'x', en: 'x', ru: 'x' } });

  const third = await H.call(admin.handler, Object.assign({
    action: 'saveDraft', baseUpdatedAt: after.isoUpdated, activity: factEdit
  }, asRu));
  H.eq(third.status, 200, 'the third draft saves');
  const facts = third.body.activity.facts;

  H.eq(facts.groupSize.overrideText.ru, 'Одна смешанная группа',
       'their Russian override applied');
  H.eq(facts.groupSize.overrideText.he, '',
       'the Hebrew override is as it was — empty here, and their edit was dropped');
  H.eq(facts.groupSize.overrideText.en, '', 'so is the English');

  const grp = third.body.activity.groups;
  H.eq(grp.length, 1, 'they cannot ADD a group — membership is structure');
  H.eq(grp[0].capacity, after.groups[0].capacity,
       'and the capacity beside the name did not move, because a count is structure');
  H.eq(grp[0].name.ru, 'Смешанная группа', 'but the group NAME translates');
  H.eq(grp[0].name.he, after.groups[0].name.he, 'without letting them touch the Hebrew');

  H.eq(grp[0].facts.address.text.ru, 'улица Ленина, 1',
       'the address translates too — words are words even in a members-only fact');
  H.eq(grp[0].facts.address.text.he, '', 'without letting them touch the Hebrew');

  console.log('\n[a session with no access at all is refused outright]');
  const nobody = await H.installSession(blobs, H.superAdminSession({
    token: 'nobody', email: 'nobody@ogen.cy', name: 'Nobody',
    role: 'content-editor',
    permissions: { activities: { access: false, edit: [], publish: false } }
  }));
  const denied = await H.call(admin.handler, { action: 'list', token: nobody.token });
  H.eq(denied.status, 403, 'list is refused');

  console.log('\n[an unknown or expired token is refused]');
  H.eq((await H.call(admin.handler, { action: 'list', token: 'made-up' })).status, 401,
       'an invented token gets 401');
  const expired = await H.installSession(blobs, H.superAdminSession({
    token: 'expired', expiresAt: Date.now() - 1000
  }));
  H.eq((await H.call(admin.handler, { action: 'list', token: expired.token })).status, 401,
       'an expired session gets 401');
  const sessions = blobs._stores.get('admin-sessions');
  H.ok(!sessions.has('sess-expired'), 'and the expired session was deleted on read');

  H.done();
})();
