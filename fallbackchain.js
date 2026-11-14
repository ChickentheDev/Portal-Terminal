// Model fallback chain: pure helpers for retrying a failed agent
// turn with the next installed model. No Electron deps —
// unit-testable with plain `node tests/fallbackchain.test.js`.
// The renderer reaches these through preload (`window.api` exposes
// nothing here; the module loads as a plain <script> in index.html,
// like models.js) so there is one implementation.
'use strict';

const MAX_CHAIN = 5; // models tried per turn, not counting the primary
const MAX_STORED = 8; // names kept in settings.fallback
const REASON_CAP = 120; // chars of the failure reason shown in the chat

// Which turn failures are worth retrying with another model?
// Retryable: the MODEL failed — it crashed mid-generation (the
// sandbox hermes3:8b 500 "unexpected EOF"), or it isn't installed.
// Not retryable: Ollama itself is unreachable (every model lives on
// the same server, so another model fails the same way), the user
// stopped the turn, or the error is unrecognized (fail as today).
function isModelError(err) {
  const msg = String((err && err.message) || err || '');
  if (/Ollama returned (404|500|502|503)\b/.test(msg)) return true;
  if (/model\s+['"][^'"]+['"]\s+not found/i.test(msg)) return true;
  if (/not found/i.test(msg) && /model/i.test(msg)) return true;
  return false;
}

// One short line for the fallback notice in the chat. Newlines become
// spaces, anything past the cap is cut with an ellipsis.
function shortReason(err) {
  const msg = String((err && err.message) || err || '').replace(/\s+/g, ' ').trim();
  if (!msg) return 'failed';
  return msg.length > REASON_CAP ? msg.slice(0, REASON_CAP - 1).trimEnd() + '…' : msg;
}

function cleanName(name) {
  const n = String(name || '').trim();
  return n && !/\s/.test(n) ? n : '';
}

// Find an installed model by name, tolerating case and a ':latest'
// suffix on either side (same rule as models.js matchPreset).
// Returns the installed spelling, or null.
function findInstalled(name, installed) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  for (const m of installed || []) {
    const iname = String((m && m.name) || m || '').trim();
    if (!iname) continue;
    const lower = iname.toLowerCase();
    if (lower === n || lower === n + ':latest' || lower + ':latest' === n) return iname;
  }
  return null;
}

// Build the fallback chain for one turn. Returns { chain, skipped }:
//   chain   — model names to try after the primary, in order.
//   skipped — explicit names that are not installed (shown in the
//             fallback line so the user knows they were dropped).
// `installed` is [{ name, size }] from /api/tags (size may be 0 when
// unknown). `explicit` is settings.fallback: null/undefined means
// auto mode; an array (even []) is the user's explicit list.
// `enabled` false means the toggle is off.
function buildChain({ primary, installed, explicit, enabled }) {
  if (enabled === false) return { chain: [], skipped: [] };
  const list = Array.isArray(installed) ? installed : [];
  const prim = cleanName(primary);
  if (Array.isArray(explicit)) {
    const chain = [];
    const skipped = [];
    const seen = new Set();
    for (const raw of explicit) {
      const name = cleanName(raw);
      if (!name) continue;
      const lower = name.toLowerCase();
      if (lower === prim.toLowerCase() || seen.has(lower)) continue;
      seen.add(lower);
      const hit = findInstalled(name, list);
      if (hit) chain.push(hit);
      else skipped.push(name);
      if (chain.length >= MAX_CHAIN) break;
    }
    return { chain, skipped };
  }
  // Auto mode: every other installed model, smallest first — when a
  // big model fails it is usually resource-related, so a smaller
  // model is the most likely to load. Unknown size (0) sorts last.
  const others = list
    .map((m) => ({ name: String((m && m.name) || m || '').trim(), size: Number((m && m.size) || 0) || 0 }))
    .filter((m) => m.name && m.name.toLowerCase() !== prim.toLowerCase());
  others.sort((a, b) => {
    const sa = a.size > 0 ? a.size : Infinity;
    const sb = b.size > 0 ? b.size : Infinity;
    return sa - sb;
  });
  const seen = new Set();
  const chain = [];
  for (const m of others) {
    const lower = m.name.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    chain.push(m.name);
    if (chain.length >= MAX_CHAIN) break;
  }
  return { chain, skipped: [] };
}

// Validate a settings.fallback value (e.g. from a hand-edited
// settings.json). null stays null (auto mode); an array is cleaned
// to trimmed, deduped, non-empty names; anything else becomes null.
function sanitizeFallbackList(value) {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return null;
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    const name = cleanName(raw);
    if (!name) continue;
    const lower = name.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(name);
    if (out.length >= MAX_STORED) break;
  }
  return out;
}

// Decide what to store when the user saves Settings. `draft` is the
// fallback list as shown in the modal ([{ name, enabled }] in chain
// order); `autoList` is the auto chain for the current primary and
// installed models. Returns null when the draft is exactly the auto
// list with everything checked (stay in auto mode), otherwise the
// enabled names in draft order (possibly [] — explicitly none).
function materializeFallback(draft, autoList) {
  const enabled = (Array.isArray(draft) ? draft : [])
    .filter((d) => d && d.enabled !== false)
    .map((d) => cleanName(d.name))
    .filter(Boolean);
  const auto = (Array.isArray(autoList) ? autoList : []).map(cleanName).filter(Boolean);
  if (enabled.length === auto.length && enabled.every((n, i) => n.toLowerCase() === String(auto[i]).toLowerCase())) return null;
  return enabled;
}

// Append the tried models to a final error message.
function formatTriedError(message, tried) {
  const msg = String(message || 'Unknown error').trim() || 'Unknown error';
  const names = (Array.isArray(tried) ? tried : []).map(cleanName).filter(Boolean);
  if (names.length <= 1) return msg;
  return `${msg} (tried: ${names.join(', ')})`;
}

// Exported two ways, one source of truth:
//  - Node (unit tests, main): require('./fallbackchain.js')
//  - Browser (renderer, via <script src="fallbackchain.js"> in
//    index.html): window.PortalFallback. The preload cannot
//    require() this file — in this Electron build the preload's
//    require() resolves only the 'electron' module, so the renderer
//    loads it as a plain script instead (models.js precedent).
const FallbackChain = {
  MAX_CHAIN,
  MAX_STORED,
  isModelError,
  shortReason,
  findInstalled,
  buildChain,
  sanitizeFallbackList,
  materializeFallback,
  formatTriedError,
};
if (typeof module !== 'undefined' && module.exports) module.exports = FallbackChain;
if (typeof window !== 'undefined') window.PortalFallback = FallbackChain;
