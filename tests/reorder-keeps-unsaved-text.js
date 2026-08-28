// The bug this defends against:
//
// Reordering a repeatable list re-renders it from the model. If the model has
// not first been refreshed from the inputs, everything the admin typed since
// the last render is destroyed the instant they click the up arrow. They watch
// their own sentence vanish and there is nothing to undo it with.
//
// This suite simulates exactly that: type into two items, reorder a THIRD one,
// and assert the typing survived. It drives the real js/repeatable-items.js
// through a fake host that stands in for the DOM.

const H = require('./_helpers');
const RepeatableList = require('../js/repeatable-items.js');

// A stand-in for the form: `inputs` is what the boxes currently hold,
// which is not in the model until readInto() copies it across.
function fakeHost(inputs) {
  const host = {
    renders: 0,
    reads: 0,
    readInto(items) {
      host.reads++;
      items.forEach((item) => {
        if (Object.prototype.hasOwnProperty.call(inputs, item.id)) {
          item.text = inputs[item.id];
        }
      });
    },
    render(items) {
      host.renders++;
      // Re-rendering wipes the boxes and repopulates them from the model —
      // this is the step that used to eat the text.
      Object.keys(inputs).forEach((k) => delete inputs[k]);
      items.forEach((item) => { inputs[item.id] = item.text; });
    },
    blank: () => ({ text: '' })
  };
  return host;
}

(async () => {
  console.log('\n[typing survives a reorder]');
  const inputs = {};
  const host = fakeHost(inputs);
  const list = RepeatableList({ prefix: 'inc', host, items: [] });

  const a = list.add({ text: 'first' });
  const b = list.add({ text: 'second' });
  const c = list.add({ text: 'third' });

  // The admin now edits two boxes. The model still holds the old values.
  inputs[a.id] = 'first, edited but not yet captured';
  inputs[b.id] = 'second, also edited';
  H.eq(list.all()[0].text, 'first', 'the model is deliberately stale before the reorder');

  list.up(c.id);   // reorder a different item entirely

  H.eq(list.all().find((i) => i.id === a.id).text, 'first, edited but not yet captured',
       "the first box's unsaved text survived the reorder");
  H.eq(list.all().find((i) => i.id === b.id).text, 'second, also edited',
       "the second box's unsaved text survived too");
  H.eq(list.all()[1].id, c.id, 'and the reorder actually happened');
  H.ok(host.reads >= 1, 'the form was read into the model before redrawing');

  console.log('\n[typing survives a removal]');
  inputs[a.id] = 'edited again';
  list.remove(b.id);
  H.eq(list.all().find((i) => i.id === a.id).text, 'edited again',
       'unsaved text survived removing a different item');
  H.eq(list.size(), 2, 'the item was removed');

  console.log('\n[typing survives adding a new item]');
  inputs[a.id] = 'edited a third time';
  const d = list.add({ text: '' });
  H.eq(list.all().find((i) => i.id === a.id).text, 'edited a third time',
       'unsaved text survived adding a row');
  H.eq(list.all()[list.size() - 1].id, d.id, 'the new row is last');

  console.log('\n[sync() captures without redrawing, for the save path]');
  inputs[a.id] = 'final text before saving';
  const before = host.renders;
  const synced = list.sync();
  H.eq(synced.find((i) => i.id === a.id).text, 'final text before saving',
       'sync picks up the last edit');
  H.eq(host.renders, before, 'sync did not redraw');

  console.log('\n[moving past either end is a no-op, not a corruption]');
  const order = list.all().map((i) => i.id).join(',');
  H.eq(list.up(list.all()[0].id), false, 'cannot move the first item up');
  H.eq(list.down(list.all()[list.size() - 1].id), false, 'cannot move the last item down');
  H.eq(list.all().map((i) => i.id).join(','), order, 'the order is unchanged');

  H.done();
})();
