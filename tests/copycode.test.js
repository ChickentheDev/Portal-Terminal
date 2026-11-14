// Unit tests for copycode.js — run: node tests/copycode.test.js
'use strict';
const cc = require('../copycode.js');

let pass = 0, fail = 0;
function check(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL ' + label); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- fake DOM: a root whose querySelectorAll returns canned blocks ---
function fakeCode(text, lang) {
  const cb = {
    querySelector: (sel) => (sel === '.cb-h span' ? { textContent: lang } : null),
  };
  return { textContent: text, closest: (sel) => (sel === '.cb' ? cb : null) };
}
function fakeRoot(blocks) {
  return { querySelectorAll: (sel) => (sel === '.msg.ai .cb code' ? blocks : []) };
}

// --- findLastCodeBlock ---
check(eq(cc.findLastCodeBlock(fakeRoot([fakeCode('ls -la', 'bash')])), { code: 'ls -la', lang: 'bash' }), 'single block returns its code and lang');
check(eq(cc.findLastCodeBlock(fakeRoot([fakeCode('first', 'bash'), fakeCode('second', 'python'), fakeCode('third', '')])), { code: 'third', lang: '' }), 'last of several wins');
check(cc.findLastCodeBlock(fakeRoot([])) === null, 'no blocks returns null');
check(cc.findLastCodeBlock(null) === null, 'null root returns null');
check(cc.findLastCodeBlock({}) === null, 'root without querySelectorAll returns null');
check(eq(cc.findLastCodeBlock(fakeRoot([fakeCode('', 'bash')])), { code: '', lang: 'bash' }), 'empty code still returns the block');
const noHeader = { textContent: 'x', closest: () => null };
check(eq(cc.findLastCodeBlock(fakeRoot([noHeader])), { code: 'x', lang: '' }), 'missing .cb ancestor reads an empty lang');
const noLangSpan = {
  textContent: 'y',
  closest: () => ({ querySelector: () => null }),
};
check(eq(cc.findLastCodeBlock(fakeRoot([noLangSpan])), { code: 'y', lang: '' }), 'missing header span reads an empty lang');

// --- previewOf ---
check(cc.previewOf('ls -la') === 'ls -la', 'short code previews in full');
check(cc.previewOf('echo a\necho b\necho c') === 'echo a echo b echo c', 'newlines flatten to spaces');
check(cc.previewOf('   spaced   out   ') === 'spaced out', 'whitespace collapses and trims');
check(cc.previewOf('x'.repeat(41)) === 'x'.repeat(40) + '…', 'past 40 chars is cut with an ellipsis');
check(cc.previewOf('x'.repeat(40)) === 'x'.repeat(40), 'exactly 40 chars is not cut');
check(cc.previewOf('') === '', 'empty code previews empty');
check(cc.previewOf(null) === '', 'null previews empty');
check(cc.previewOf('   \n\t  ') === '', 'whitespace-only previews empty');

// --- copiedHint ---
check(cc.copiedHint({ code: 'ls -la', lang: 'bash' }) === 'Copied bash code block: ls -la', 'hint names the lang and previews the code');
check(cc.copiedHint({ code: 'x'.repeat(50), lang: 'python' }) === 'Copied python code block: ' + 'x'.repeat(40) + '…', 'hint preview is capped');
check(cc.copiedHint({ code: '', lang: 'bash' }) === 'Copied bash code block', 'empty block has no preview in the hint');
check(cc.copiedHint({ code: 'echo hi', lang: '' }) === 'Copied text code block: echo hi', 'missing lang reads as text');
check(cc.copiedHint(null) === 'Copied text code block', 'null block reads as an empty text block');

console.log(`copycode.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
