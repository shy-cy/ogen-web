// Runs every suite in this directory. Plain Node, no framework, nothing to
// install — a test that needs installing is a test that stops being run.
//
//   node tests/run.js            everything
//   node tests/<suite>.js        one suite
//
// Each suite is named for the bug or the property it defends, and opens with a
// comment explaining what went wrong. That comment is the point.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = __dirname;
const suites = fs.readdirSync(dir)
  .filter((f) => f.endsWith('.js') && f !== 'run.js' && !f.startsWith('_'))
  .sort();

let failed = 0;
const started = Date.now();
const results = [];

for (const suite of suites) {
  const res = spawnSync(process.execPath, [path.join(dir, suite)], { encoding: 'utf8' });
  const out = (res.stdout || '') + (res.stderr || '');
  const summary = (out.match(/(\d+)\/(\d+) assertions passed/) || [])[0] || 'no assertions reported';
  const bad = res.status !== 0;
  if (bad) failed++;
  results.push({ suite, bad, summary, out });
  console.log(`${bad ? 'FAIL' : 'ok  '}  ${suite.padEnd(44)} ${summary}`);
  if (bad) {
    console.log(out.split('\n').filter((l) => /FAIL|Error|at /.test(l)).slice(0, 12).map((l) => '        ' + l).join('\n'));
  }
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${suites.length - failed}/${suites.length} suites passed in ${secs}s`);
process.exit(failed ? 1 : 0);
