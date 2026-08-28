// The bug this defends against:
//
// If an item's id is derived from its position — item-1, item-2, item-3 — then
// removing item-2 makes the old item-3 become item-2. Anything keyed by that
// id (an in-flight photo upload, per-item translation state, change history)
// now belongs to the wrong row. Two items' state silently merges. It looks
// fine in casual testing, because the text is right; only the state attached
// to the id is wrong.
//
// Ids are minted from the clock instead, and existing ids are NEVER renumbered.

const H = require('./_helpers');
const RepeatableList = require('../js/repeatable-items.js');

const host = { readInto() {}, render() {}, blank: () => ({}) };

(async () => {
  console.log('\n[ids are not derived from position]');
  const list = RepeatableList({ prefix: 'tch', host, items: [] });
  const a = list.add({ name: 'A' });
  const b = list.add({ name: 'B' });
  const c = list.add({ name: 'C' });

  H.ok(!/^tch-[123]$/.test(a.id), `first id is not positional (${a.id})`);
  H.ok(a.id !== b.id && b.id !== c.id, 'ids are distinct');
  H.ok(/^tch-[a-z0-9]+-[a-z0-9]+$/.test(a.id), 'ids look clock-minted');

  console.log('\n[removing an item does not reissue anybody else’s id]');
  const idsBefore = { a: a.id, b: b.id, c: c.id };
  list.remove(b.id);
  H.eq(list.all()[0].id, idsBefore.a, 'the first item kept its id');
  H.eq(list.all()[1].id, idsBefore.c, 'the surviving third item kept ITS id — not reissued as the second');
  H.ok(list.all().every((i) => i.id !== idsBefore.b), "the removed item's id is not reused");

  console.log('\n[per-item state keyed by id stays attached to the right item]');
  // This is the failure the rule exists to prevent, made concrete.
  const uploads = {};
  uploads[idsBefore.c] = 'photo-for-C.jpg';
  const cNow = list.all().find((i) => i.id === idsBefore.c);
  H.eq(cNow.name, 'C', 'the item at index 1 is still C');
  H.eq(uploads[cNow.id], 'photo-for-C.jpg', "C's upload is still C's, not inherited by another row");

  console.log('\n[reordering does not renumber either]');
  list.add({ name: 'D' });
  const beforeMove = list.all().map((i) => i.id);
  list.up(list.all()[2].id);
  const afterMove = list.all().map((i) => i.id);
  H.eq(afterMove.slice().sort().join(','), beforeMove.slice().sort().join(','),
       'the same set of ids exists after a move');
  H.ok(afterMove.join(',') !== beforeMove.join(','), 'but the order changed');

  console.log('\n[two mints in the same millisecond still differ]');
  const many = new Set();
  for (let i = 0; i < 500; i++) many.add(RepeatableList.mintId('inc'));
  H.eq(many.size, 500, '500 ids minted in a tight loop are all unique');

  console.log('\n[ids loaded from a saved record are preserved verbatim]');
  const reloaded = RepeatableList({
    prefix: 'tch', host,
    items: [{ id: 'tch-legacy-one', name: 'X' }, { id: 'tch-legacy-two', name: 'Y' }]
  });
  reloaded.add({ name: 'Z' });
  reloaded.up(reloaded.all()[2].id);
  H.ok(reloaded.all().some((i) => i.id === 'tch-legacy-one'), 'an existing id survives a reorder');
  H.ok(reloaded.all().some((i) => i.id === 'tch-legacy-two'), 'so does the other');

  H.done();
})();
