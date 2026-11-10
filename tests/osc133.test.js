// Unit tests for the OSC 133 streaming parser (osc133.js).
// Run: node tests/osc133.test.js  — no Electron needed.
'use strict';
const { createOsc133Parser, unescapeCommand } = require('../osc133.js');

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.log(`FAIL ${label}\n  got      ${a}\n  expected ${e}`); }
}
function collect(chunks) {
  const events = [];
  const p = createOsc133Parser((ev) => events.push(ev));
  for (const c of chunks) p.feed(c);
  return events;
}

// --- basic markers ---
eq(collect(['\x1b]133;A\x07']), [{ kind: 'A' }], 'A marker');
eq(collect(['\x1b]133;B\x07']), [{ kind: 'B' }], 'B marker');
eq(collect(['\x1b]133;C\x07']), [{ kind: 'C' }], 'C marker');
eq(collect(['\x1b]133;D;0\x07']), [{ kind: 'D', code: 0 }], 'D;0');
eq(collect(['\x1b]133;D;1\x07']), [{ kind: 'D', code: 1 }], 'D;1');
eq(collect(['\x1b]133;D;127\x07']), [{ kind: 'D', code: 127 }], 'D;127');
eq(collect(['\x1b]133;D;130\x07']), [{ kind: 'D', code: 130 }], 'D;130 (Ctrl+C)');
eq(collect(['\x1b]133;D\x07']), [{ kind: 'D', code: null }], 'D with no code');
eq(collect(['\x1b]133;D;abc\x07']), [{ kind: 'D', code: null }], 'D with junk code');

// --- ST terminator instead of BEL ---
eq(collect(['\x1b]133;A\x1b\\']), [{ kind: 'A' }], 'A with ST terminator');
eq(collect(['\x1b]133;D;42\x1b\\']), [{ kind: 'D', code: 42 }], 'D with ST terminator');

// --- E payload: escaping round-trip ---
eq(collect(['\x1b]133;E;echo hi\x07']), [{ kind: 'E', command: 'echo hi' }], 'E simple');
eq(collect(['\x1b]133;E;echo a\\\\b\x07']), [{ kind: 'E', command: 'echo a\\b' }], 'E backslash');
eq(collect(['\x1b]133;E;echo one\\ntwo\x07']), [{ kind: 'E', command: 'echo one\ntwo' }], 'E newline');
eq(collect(['\x1b]133;E;echo a\\rb\x07']), [{ kind: 'E', command: 'echo a\rb' }], 'E carriage return');
eq(collect(['\x1b]133;E;echo a\\ab\x07']), [{ kind: 'E', command: 'echo a\x07b' }], 'E BEL');
eq(collect(['\x1b]133;E;echo a\\eb\x07']), [{ kind: 'E', command: 'echo a\x1bb' }], 'E ESC');
eq(collect(['\x1b]133;E;echo one; echo two\x07']), [{ kind: 'E', command: 'echo one; echo two' }], 'E with semicolons');
eq(collect(['\x1b]133;E;echo caf\xc3\xa9\x07']), [{ kind: 'E', command: 'echo café' }], 'E UTF-8');
eq(collect(['\x1b]133;E;echo hi\\r\\n\x07']), [{ kind: 'E', command: 'echo hi' }], 'E trailing CR/LF trimmed');
eq(collect(['\x1b]133;E;echo hi   \x07']), [{ kind: 'E', command: 'echo hi' }], 'E trailing spaces trimmed');

// --- unescapeCommand directly ---
eq(unescapeCommand('a\\\\b'), 'a\\b', 'unescape backslash');
eq(unescapeCommand('a\\nb'), 'a\nb', 'unescape newline');
eq(unescapeCommand('a\\zb'), 'a\\zb', 'unescape unknown escape stays literal');
eq(unescapeCommand('a\\'), 'a\\', 'unescape trailing lone backslash');

// --- split across chunks ---
eq(collect(['\x1b]133;', 'D;3\x07']), [{ kind: 'D', code: 3 }], 'sequence split across chunks');
eq(collect(['\x1b', ']133;A\x07']), [{ kind: 'A' }], 'ESC ] split across chunks');
eq(collect(['\x1b]133;E;echo ', 'hi\x07']), [{ kind: 'E', command: 'echo hi' }], 'E split across chunks');
eq(collect(['abc\x1b]133;A\x07def']), [{ kind: 'A' }], 'marker embedded in output');

// --- multiple sequences in one chunk, in order ---
eq(collect(['\x1b]133;A\x07prompt\x1b]133;B\x07\x1b]133;C\x07\x1b]133;D;0\x07']),
  [{ kind: 'A' }, { kind: 'B' }, { kind: 'C' }, { kind: 'D', code: 0 }],
  'A B C D in one chunk, in order');

// --- non-133 OSC ignored, unknown 133 kinds ignored ---
eq(collect(['\x1b]8;;https://example.com\x07link\x1b]8;;\x07']), [], 'OSC 8 hyperlink ignored');
eq(collect(['\x1b]133;Z;foo\x07']), [], 'unknown 133 kind ignored');
eq(collect(['\x1b]133;D;0\x07\x1b]52;c;Zm9v\x07']), [{ kind: 'D', code: 0 }], 'OSC 52 after D ignored');

// --- malformed / incomplete ---
eq(collect(['\x1b]133;A']), [], 'unterminated OSC: no event, no crash');
eq(collect(['\x1b]133;']), [], 'empty OSC payload: no event');
eq(collect(['hello world, no markers']), [], 'plain output: no events');
eq(collect(['\x1b]133;A\x07', '\x1b]133;']), [{ kind: 'A' }], 'unterminated tail after a good marker');
eq(collect([Buffer.from([0x1b, 0x5d, 0x31, 0x33, 0x33, 0x3b, 0x44, 0x3b, 0x39, 0x07])]),
  [{ kind: 'D', code: 9 }], 'Buffer input works');

// --- garbage / binary safety ---
{
  const events = [];
  const p = createOsc133Parser((ev) => events.push(ev));
  p.feed(Buffer.alloc(200000, 0x41)); // 200KB of 'A' (no markers)
  p.feed('\x1b]133;B\x07');
  eq(events, [{ kind: 'B' }], 'parser survives a huge garbage chunk then finds a marker');
}

console.log(`osc133: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
