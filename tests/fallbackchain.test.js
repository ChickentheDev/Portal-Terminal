// Unit tests for the model fallback chain helpers.
// Run: node tests/fallbackchain.test.js
'use strict';
const fb = require('../fallbackchain.js');

let pass = 0, fail = 0;
function check(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL ' + label); }
}
function eq(a, b, label) { check(JSON.stringify(a) === JSON.stringify(b), label + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); }

const INSTALLED = [
  { name: 'hermes3:8b', size: 5000000000 },
  { name: 'hermes3:3b', size: 2000000000 },
  { name: 'llama3.1:8b', size: 4900000000 },
  { name: 'qwen2.5-coder:14b', size: 9000000000 },
];

// --- isModelError: the model's failure, not the server's or the user's ---
check(fb.isModelError(new Error('Ollama returned 500. {"error":"an error was encountered while running the model: unexpected EOF"}')), '500 unexpected EOF is retryable');
check(fb.isModelError(new Error('Ollama returned 502. bad gateway')), '502 is retryable');
check(fb.isModelError(new Error('Ollama returned 503. service unavailable')), '503 is retryable');
check(fb.isModelError(new Error('Ollama returned 404. model not found')), '404 is retryable');
check(fb.isModelError(new Error("model 'hermes3:8b' not found")), 'stream model-not-found is retryable');
check(fb.isModelError("model 'x' not found"), 'string error model-not-found is retryable');
check(!fb.isModelError(new Error('Ollama returned 400. bad request')), '400 is NOT retryable');
check(!fb.isModelError(new Error('fetch failed')), 'fetch failed is NOT retryable');
check(!fb.isModelError(new Error('Could not reach Ollama at http://127.0.0.1:11434')), 'unreachable Ollama is NOT retryable');
check(!fb.isModelError(new Error('ECONNREFUSED')), 'ECONNREFUSED is NOT retryable');
check(!fb.isModelError(new Error('The operation was aborted')), 'abort is NOT retryable');
check(!fb.isModelError(new Error('something weird happened')), 'unknown error is NOT retryable');
check(!fb.isModelError(null), 'null error is NOT retryable');

// --- shortReason ---
eq(fb.shortReason(new Error('Ollama returned 500. boom')), 'Ollama returned 500. boom', 'short reason passes through');
check(fb.shortReason(new Error('x'.repeat(500))).length <= 120, 'long reason is capped at 120');
check(fb.shortReason(new Error('line one\nline two')).indexOf('\n') === -1, 'newlines become spaces');
eq(fb.shortReason(null), 'failed', 'empty error becomes "failed"');

// --- buildChain: auto mode ---
eq(fb.buildChain({ primary: 'hermes3:8b', installed: INSTALLED, explicit: null, enabled: true }),
  { chain: ['hermes3:3b', 'llama3.1:8b', 'qwen2.5-coder:14b'], skipped: [] }, 'auto: smallest first, primary excluded');
eq(fb.buildChain({ primary: 'hermes3:8b', installed: INSTALLED, explicit: undefined, enabled: true }).chain,
  ['hermes3:3b', 'llama3.1:8b', 'qwen2.5-coder:14b'], 'auto: undefined explicit is auto too');
eq(fb.buildChain({ primary: 'hermes3:8b', installed: [{ name: 'hermes3:8b', size: 5 }], explicit: null, enabled: true }),
  { chain: [], skipped: [] }, 'auto: only the primary installed means no chain');
eq(fb.buildChain({ primary: 'hermes3:8b', installed: [{ name: 'hermes3:3b', size: 0 }, { name: 'llama3.1:8b', size: 100 }], explicit: null, enabled: true }).chain,
  ['llama3.1:8b', 'hermes3:3b'], 'auto: unknown size sorts last');
eq(fb.buildChain({ primary: 'hermes3:8b', installed: INSTALLED, explicit: null, enabled: false }),
  { chain: [], skipped: [] }, 'toggle off means no chain');

// --- buildChain: explicit mode ---
eq(fb.buildChain({ primary: 'hermes3:8b', installed: INSTALLED, explicit: ['llama3.1:8b', 'hermes3:3b'], enabled: true }),
  { chain: ['llama3.1:8b', 'hermes3:3b'], skipped: [] }, 'explicit: order kept');
eq(fb.buildChain({ primary: 'hermes3:8b', installed: INSTALLED, explicit: ['llama3.1:8b', 'devstral:24b', 'hermes3:3b'], enabled: true }),
  { chain: ['llama3.1:8b', 'hermes3:3b'], skipped: ['devstral:24b'] }, 'explicit: missing model skipped and named');
eq(fb.buildChain({ primary: 'hermes3:8b', installed: INSTALLED, explicit: ['hermes3:8b', 'hermes3:3b'], enabled: true }).chain,
  ['hermes3:3b'], 'explicit: the primary is never in its own chain');
eq(fb.buildChain({ primary: 'hermes3:8b', installed: INSTALLED, explicit: ['Hermes3:3B', 'hermes3:3b'], enabled: true }).chain,
  ['hermes3:3b'], 'explicit: case-insensitive match uses the installed spelling, deduped');
eq(fb.buildChain({ primary: 'hermes3:8b', installed: INSTALLED, explicit: [], enabled: true }),
  { chain: [], skipped: [] }, 'explicit empty list means no fallbacks');
check(fb.buildChain({ primary: 'hermes3:8b', installed: Array.from({ length: 8 }, (_, i) => ({ name: 'm' + i, size: i + 1 })), explicit: null, enabled: true }).chain.length <= 5,
  'chain is capped at 5');

// --- sanitizeFallbackList ---
eq(fb.sanitizeFallbackList(null), null, 'sanitize: null stays null');
eq(fb.sanitizeFallbackList('hermes3:3b'), null, 'sanitize: non-array becomes null');
eq(fb.sanitizeFallbackList([' hermes3:3b ', 'hermes3:3b', '', 'a b', 'llama3.1:8b']), ['hermes3:3b', 'llama3.1:8b'], 'sanitize: trims, dedupes, drops blanks and names with spaces');

// --- materializeFallback ---
eq(fb.materializeFallback(
  [{ name: 'hermes3:3b', enabled: true }, { name: 'llama3.1:8b', enabled: true }, { name: 'qwen2.5-coder:14b', enabled: true }],
  ['hermes3:3b', 'llama3.1:8b', 'qwen2.5-coder:14b']), null, 'materialize: draft equal to auto stays null');
eq(fb.materializeFallback(
  [{ name: 'llama3.1:8b', enabled: true }, { name: 'hermes3:3b', enabled: true }],
  ['hermes3:3b', 'llama3.1:8b']), ['llama3.1:8b', 'hermes3:3b'], 'materialize: reordered draft stores the array');
eq(fb.materializeFallback(
  [{ name: 'hermes3:3b', enabled: false }, { name: 'llama3.1:8b', enabled: true }],
  ['hermes3:3b', 'llama3.1:8b']), ['llama3.1:8b'], 'materialize: unchecked rows are dropped');
eq(fb.materializeFallback(
  [{ name: 'hermes3:3b', enabled: false }],
  ['hermes3:3b']), [], 'materialize: everything unchecked stores []');
eq(fb.materializeFallback([], ['hermes3:3b']), [], 'materialize: empty draft stores []');

// --- formatTriedError ---
eq(fb.formatTriedError('Ollama returned 500. boom', ['hermes3:8b']), 'Ollama returned 500. boom', 'one tried model adds nothing');
eq(fb.formatTriedError('Ollama returned 500. boom', ['hermes3:8b', 'hermes3:3b']), 'Ollama returned 500. boom (tried: hermes3:8b, hermes3:3b)', 'several tried models are listed');

console.log(`fallbackchain.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
