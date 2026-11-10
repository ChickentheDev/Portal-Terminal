// Unit tests for the model manager helpers (models.js).
// Run: node tests/models.test.js — no Electron needed.
'use strict';
const {
  formatSize,
  formatDate,
  isHfTag,
  validatePullTag,
  normalizePullTag,
  matchPreset,
  isCurrentModel,
} = require('../models.js');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${label}`); }
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; console.log(`FAIL ${label}\n  got      ${a}\n  expected ${e}`); }
}

// --- formatSize ---
eq(formatSize(0), '0 B', 'size 0');
eq(formatSize(512), '512 B', 'size bytes');
eq(formatSize(999), '999 B', 'size just under 1 KB');
eq(formatSize(1000), '1.0 KB', 'size 1 KB');
eq(formatSize(1536), '1.5 KB', 'size 1.5 KB');
eq(formatSize(9e9), '9.0 GB', 'size 9 GB');
eq(formatSize(4.9e9), '4.9 GB', 'size 4.9 GB');
eq(formatSize(7.1e9), '7.1 GB', 'size 7.1 GB');
eq(formatSize(14e9), '14.0 GB', 'size 14 GB');
eq(formatSize(1.5e6), '1.5 MB', 'size 1.5 MB');
eq(formatSize(NaN), '--', 'size NaN');
eq(formatSize(-5), '--', 'size negative');
eq(formatSize(undefined), '--', 'size undefined');

// --- formatDate ---
eq(formatDate('2026-11-10T22:26:13Z'), 'Nov 10, 2026', 'date ISO Z');
eq(formatDate('2026-01-01T00:00:00Z'), 'Jan 1, 2026', 'date Jan 1');
eq(formatDate('garbage'), '--', 'date invalid');
eq(formatDate(''), '--', 'date empty');
eq(formatDate(null), '--', 'date null');

// --- isHfTag ---
ok(isHfTag('hf.co/user/repo'), 'hf lowercase');
ok(isHfTag('HF.CO/user/repo:Q4_K_M'), 'hf uppercase domain');
ok(isHfTag('huggingface.co/user/repo'), 'huggingface.co domain');
ok(isHfTag('HuggingFace.co/user/repo'), 'huggingface.co mixed case');
ok(!isHfTag('hermes3:8b'), 'not hf: plain tag');
ok(!isHfTag('hf.co'), 'not hf: bare domain, no path');
ok(!isHfTag('xhf.co/user/repo'), 'not hf: prefix must be exact');
ok(!isHfTag(''), 'not hf: empty');
ok(!isHfTag(null), 'not hf: null');

// --- validatePullTag ---
eq(validatePullTag('hermes3:8b'), { ok: true, tag: 'hermes3:8b' }, 'tag plain preset');
eq(validatePullTag('  llama3.1:8b  '), { ok: true, tag: 'llama3.1:8b' }, 'tag trimmed');
eq(validatePullTag('qwen2.5-coder:14b'), { ok: true, tag: 'qwen2.5-coder:14b' }, 'tag with dots/dash');
eq(validatePullTag('user/model:tag'), { ok: true, tag: 'user/model:tag' }, 'tag namespace');
eq(validatePullTag('model'), { ok: true, tag: 'model' }, 'tag bare name');
eq(validatePullTag('hf.co/NousResearch/Hermes-3-Llama-3.1-8B'), { ok: true, tag: 'hf.co/NousResearch/Hermes-3-Llama-3.1-8B' }, 'hf no quant');
eq(validatePullTag('hf.co/user/repo:Q4_K_M'), { ok: true, tag: 'hf.co/user/repo:Q4_K_M' }, 'hf with quant');
eq(validatePullTag('hf.co/user/repo:q4_k_m'), { ok: true, tag: 'hf.co/user/repo:q4_k_m' }, 'hf quant lowercase kept');
eq(validatePullTag('hf.co/user/repo:Qwen2.5-7B-Instruct-Q4_K_M.gguf'), { ok: true, tag: 'hf.co/user/repo:Qwen2.5-7B-Instruct-Q4_K_M.gguf' }, 'hf full gguf filename as quant');
eq(validatePullTag('huggingface.co/user/repo'), { ok: true, tag: 'huggingface.co/user/repo' }, 'hf huggingface.co domain');
eq(validatePullTag('HF.CO/user/repo'), { ok: true, tag: 'HF.CO/user/repo' }, 'hf uppercase domain kept');
ok(!validatePullTag('').ok, 'tag empty rejected');
ok(!validatePullTag('   ').ok, 'tag blank rejected');
ok(!validatePullTag('my model').ok, 'tag with space rejected');
ok(!validatePullTag('hf.co/user').ok, 'hf missing repo rejected');
ok(!validatePullTag('hf.co/').ok, 'hf bare domain rejected');
ok(!validatePullTag('hf.co//repo').ok, 'hf empty user rejected');
ok(!validatePullTag('hf.co/user/repo:').ok, 'hf empty quant rejected');
ok(!validatePullTag('hf.co/user/repo:Q4 K_M').ok, 'hf quant with space rejected');

// --- normalizePullTag ---
eq(normalizePullTag('  hermes3:8b '), 'hermes3:8b', 'normalize trims');
eq(normalizePullTag('hf.co/user/repo'), 'hf.co/user/repo', 'normalize leaves hf tag alone (no quant appended)');

// --- matchPreset / isCurrentModel ---
const agents = [
  { name: 'hermes3:8b', label: 'Hermes 3 8B' },
  { name: 'llama3.1:8b', label: 'Llama 3.1 8B' },
];
eq(matchPreset('hermes3:8b', agents).label, 'Hermes 3 8B', 'preset exact');
eq(matchPreset('HERMES3:8B', agents).label, 'Hermes 3 8B', 'preset case-insensitive');
eq(matchPreset('hermes3:8b:latest', agents).label, 'Hermes 3 8B', 'preset :latest suffix');
eq(matchPreset('hermes3:latest', agents), null, 'preset wrong tag no match');
eq(matchPreset('qwen2.5-coder:14b', agents), null, 'preset unknown no match');
eq(matchPreset('', agents), null, 'preset empty no match');
ok(isCurrentModel('hermes3:8b', 'hermes3:8b'), 'current exact');
ok(isCurrentModel('HERMES3:8B', 'hermes3:8b'), 'current case-insensitive');
ok(isCurrentModel('hermes3:8b', 'hermes3:8b:latest'), 'current :latest on current');
ok(isCurrentModel('hermes3:8b:latest', 'hermes3:8b'), 'current :latest on installed');
ok(!isCurrentModel('llama3.1:8b', 'hermes3:8b'), 'current different model');
ok(!isCurrentModel('', 'hermes3:8b'), 'current empty name');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
