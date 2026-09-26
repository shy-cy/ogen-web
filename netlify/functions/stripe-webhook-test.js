// /api/stripe-webhook-test — the TEST configuration's endpoint.
//
// Three lines on purpose. The two Stripe configurations need two registered
// endpoints, because each has its own signing secret and the mode of an arriving
// event is decided by which secret verified it — that is the only statement about
// it nothing outside can forge. What they do NOT need is two implementations: the
// organisation check, the idempotency list, Stripe's figure being the authority
// and the rule that only a bad signature answers anything but 200 are identical,
// and a second copy is a second place the retry rule can drift.
//
// So the whole of it lives in stripe-webhook.js and this file only says which
// mode it is. Registering this URL in Stripe's TEST mode is the other half; see
// the environment table in CLAUDE.md.

exports.handler = require('./stripe-webhook').handlerFor('test');
