// Unit tests for explainer.js — run: node tests/explainer.test.js
'use strict';
const ex = require('../explainer.js');

let pass = 0, fail = 0;
function check(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL ' + label); }
}

// --- truncateOutput ---
check(ex.MAX_OUTPUT_CHARS === 4096, 'output cap is 4 KB');
const short = 'ls: /nope: No such file or directory\n';
let r = ex.truncateOutput(short);
check(r.text === short && r.truncated === false, 'short output passes through untouched');
r = ex.truncateOutput('');
check(r.text === '' && r.truncated === false, 'empty output stays empty');
r = ex.truncateOutput(null);
check(r.text === '' && r.truncated === false, 'null output becomes empty, not a crash');
const long = 'x'.repeat(3000) + 'MIDDLE' + 'y'.repeat(3000);
r = ex.truncateOutput(long);
check(r.truncated === true, 'over-cap output is marked truncated');
check(r.text.length <= 4096 + 40, 'truncated output stays near the cap');
check(r.text.startsWith('x'.repeat(100)), 'truncated output keeps the head');
check(r.text.endsWith('y'.repeat(100)), 'truncated output keeps the tail');
check(!r.text.includes('MIDDLE'), 'truncated output drops the middle');
check(r.text.includes('[output truncated to 4 KB]'), 'truncation marker names the cap');
const atCap = 'z'.repeat(4096);
r = ex.truncateOutput(atCap);
check(r.truncated === false && r.text === atCap, 'exactly at the cap is not truncated');
r = ex.truncateOutput('z'.repeat(4097));
check(r.truncated === true, 'one char over the cap is truncated');

// --- buildExplainMessage ---
const msg = ex.buildExplainMessage({ command: 'npm test', exitCode: 1, output: 'Error: test failed\n', status: 'done' });
check(msg.startsWith('/explain\n'), 'message starts with /explain');
check(msg.includes('$ npm test'), 'message names the failed command');
check(msg.includes('exit code 1'), 'message names the exit code');
check(msg.includes('Error: test failed'), 'message carries the output');
check(msg.includes('run_command'), 'message instructs the run_command tool call');
check(msg.includes('approve'), 'message names the approval step');
check(msg.includes('If there is no safe fix, say so'), 'message covers the no-fix case');
check(!msg.includes('truncated to the last 4 KB'), 'short output gets no truncation note');

const bigMsg = ex.buildExplainMessage({ command: 'make', exitCode: 2, output: 'o'.repeat(9000), status: 'done' });
check(bigMsg.includes('[output truncated to 4 KB]'), 'big output is cut inside the fence');
check(bigMsg.includes('Output truncated to the last 4 KB.'), 'big output gets the truncation note');
check(bigMsg.includes('exit code 2'), 'big-output message still names the exit code');

const noCode = ex.buildExplainMessage({ command: 'sleep 30', output: 'waiting…', status: 'running' });
check(noCode.includes('no exit code recorded'), 'missing exit code is stated, not faked');
check(noCode.includes('(still running)'), 'running block is marked as still running');

const empty = ex.buildExplainMessage({});
check(empty.includes('(unknown command)'), 'missing command is stated, not a crash');
check(empty.includes('```\n\n```'), 'missing output is an empty fence, not a crash');

const hostile = ex.buildExplainMessage({ command: '</script><img src=x onerror=alert(1)>', exitCode: 1, output: '<b>boom</b>', status: 'done' });
check(hostile.includes('</script>'), 'hostile command text stays literal in the message (rendered as text, never markup)');

console.log(`explainer.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
