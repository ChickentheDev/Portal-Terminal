// Model manager helpers: size/date formatting, Hugging Face tag
// detection and validation, preset/current-model matching. Pure Node —
// no Electron deps — so it is unit-testable with plain
// `node tests/models.test.js`. The renderer reaches these through
// preload (`window.api.modelUtils`) so there is one implementation.
'use strict';

const HF_DOMAINS = ['hf.co', 'huggingface.co'];

// Hugging Face tag: hf.co/<user>/<repo> or hf.co/<user>/<repo>:<quant>.
// Quant is case-insensitive; a full .gguf filename works as the quant.
// The domain may also be huggingface.co.
const HF_TAG_RE = /^(?:hf\.co|huggingface\.co)\/[^/\s]+\/[^/\s:]+(?::[^/\s]+)?$/i;
// Regular Ollama tag: name or name:tag, namespaces with / allowed,
// no whitespace anywhere.
const TAG_RE = /^[^:\s]+(?::[^:\s]+)?$/;

function formatSize(bytes) {
  // Decimal units, like Ollama's own display and the preset labels
  // ("Qwen 2.5 Coder 14B — 9.0 GB" is 9.0e9 bytes, not 9 GiB).
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '--';
  if (n < 1000) return `${Math.trunc(n)} B`;
  if (n < 1000 * 1000) return `${(n / 1000).toFixed(1)} KB`;
  if (n < 1000 * 1000 * 1000) return `${(n / (1000 * 1000)).toFixed(1)} MB`;
  return `${(n / (1000 * 1000 * 1000)).toFixed(1)} GB`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDate(iso) {
  if (iso === null || iso === undefined || String(iso).trim() === '') return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--';
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function isHfTag(name) {
  const s = String(name || '').trim().toLowerCase();
  return HF_DOMAINS.some((dom) => s.startsWith(dom + '/'));
}

// Validate a pull tag. Returns { ok: true, tag } with the trimmed tag,
// or { ok: false, error } with a message fit for an inline error line.
// The tag is never rewritten: no quant is auto-appended (see the design
// note — Ollama's docs say no quant defaults to Q4_K_M when present,
// one third-party doc claims it is required; the error path + UI hint
// cover the contradiction instead).
function validatePullTag(tag) {
  const t = String(tag || '').trim();
  if (!t) return { ok: false, error: 'Enter a model name or tag.' };
  if (/\s/.test(t)) return { ok: false, error: 'Model tags can\u2019t contain spaces.' };
  if (isHfTag(t)) {
    if (!HF_TAG_RE.test(t)) {
      return { ok: false, error: 'Hugging Face tags look like hf.co/user/repo or hf.co/user/repo:Q4_K_M.' };
    }
    return { ok: true, tag: t };
  }
  if (!TAG_RE.test(t)) return { ok: false, error: 'Model tags look like name or name:tag.' };
  return { ok: true, tag: t };
}

function normalizePullTag(tag) {
  return String(tag || '').trim();
}

// Match an installed name against the agent presets. Ollama may or may
// not lowercase tags in /api/tags, so match case-insensitively, and
// accept a ':latest' suffix on either side.
function matchPreset(name, agents) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  for (const a of agents || []) {
    const an = String(a.name || '').trim().toLowerCase();
    if (n === an || n === an + ':latest' || n + ':latest' === an) return a;
  }
  return null;
}

function isCurrentModel(name, current) {
  const n = String(name || '').trim().toLowerCase();
  const c = String(current || '').trim().toLowerCase();
  if (!n || !c) return false;
  return n === c || n === c + ':latest' || n + ':latest' === c;
}

// Exported two ways, one source of truth:
//  - Node (unit tests, main): require('./models.js')
//  - Browser (renderer, via <script src="models.js"> in index.html):
//    window.PortalModels. The preload cannot require() this file — in this
//    Electron build the preload's require() resolves only the 'electron'
//    module ("module not found: fs" for builtins, same for relative paths),
//    so the renderer loads it as a plain script instead.
const ModelUtils = {
  HF_DOMAINS,
  formatSize,
  formatDate,
  isHfTag,
  validatePullTag,
  normalizePullTag,
  matchPreset,
  isCurrentModel,
};
if (typeof module !== 'undefined' && module.exports) module.exports = ModelUtils;
if (typeof window !== 'undefined') window.PortalModels = ModelUtils;
