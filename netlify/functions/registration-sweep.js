// Scheduled: 06:00 UTC daily, from the [functions."registration-sweep"] block in
// netlify.toml. It rewrites pending registrations whose deadline has passed to
// `expired` and tells the family nobody answered.
//
// TWO THINGS ABOUT NETLIFY'S SCHEDULER THAT LOOK LIKE BUGS AND ARE NOT:
//
// 1. It invokes this as a POST carrying {"next_run":"…"}. A handler that read a
//    request body as evidence of a human would have it exactly backwards — the
//    scheduled call is the one WITH a body.
//
// 2. Netlify's edge answers 403 to every external HTTP request to a scheduled
//    function, so this cannot be triggered from a browser however the URL is
//    guessed. That is also why the admin's "run now" calls _registration-sweep's
//    run() directly instead of fetching this endpoint — hitting it would 403 and
//    look like a broken button.
//
// The work itself is in _registration-sweep.js so both callers share one copy.

const { run } = require('./_registration-sweep');

exports.handler = async () => {
  try {
    const result = await run();
    console.log('[registration-sweep] ' + JSON.stringify(result));
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    console.error('[registration-sweep] ' + (err && err.stack || err));
    // 500 so a failed run is visible in the function log rather than silently
    // counted as a success. Nothing depends on it having run — the derived rule
    // is already correct — so retrying tomorrow is a complete recovery.
    return { statusCode: 500, body: JSON.stringify({ error: 'sweep failed' }) };
  }
};
