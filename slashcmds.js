// Slash commands and snippets: parsing the `/` prefix in the chat
// input, filtering the command list, validating + sanitizing custom
// snippets, and building the expanded turn text (command + instruction
// + fenced context). Pure Node — no Electron deps — so it is
// unit-testable with plain `node tests/slashcmds.test.js`.
// The renderer reaches these as window.PortalSlashCmds (loaded as a
// plain <script> in index.html); the preload cannot require() this
// file — in this Electron build the preload's require() resolves only
// the 'electron' module.
'use strict';

// Diff attached to a review / commit-msg turn, in characters.
const MAX_DIFF_CHARS = 30720;
// Terminal output attached to an /explain turn, in characters.
const MAX_OUTPUT_CHARS = 6000;
const MAX_SNIPPETS = 50;
const MAX_SNIPPET_NAME = 32;
const MAX_SNIPPET_PROMPT = 4000;
const SNIPPET_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

// Built-ins. `prompt` is the instruction the agent sees above the
// fenced context block; `description` is the popup's second line.
const BUILTINS = [
  {
    name: 'review',
    description: 'Review the current uncommitted diff',
    prompt: 'Review the current uncommitted changes. Look for bugs, risky behavior, and style problems, then summarize what is safe and what needs a second look.',
  },
  {
    name: 'commit-msg',
    description: 'Write a commit message from the diff',
    prompt: 'Write a commit message for these changes. Reply with only the commit message — a short subject line, then a blank line and a brief body if the change needs one.',
  },
  {
    name: 'explain',
    description: 'Explain the last terminal command and its output',
    prompt: 'Explain what happened — what the command did, what the output means, and what to do next.',
  },
  // Git helpers (githelpers.js owns their expansion). `changelog`
  // reuses the diff gathering; `pr` takes its number inline
  // (`/pr 12`) and its message is built from the fetched PR, so its
  // prompt is unused — the entry exists so the popup lists it and
  // the snippet collision set covers the name.
  {
    name: 'changelog',
    description: 'Draft a CHANGELOG entry from the diff',
    prompt: 'Draft a CHANGELOG entry for these uncommitted changes, in Keep a Changelog style: Added / Changed / Fixed sections, one line per change, no version header and no date. Reply with only the entry text so I can copy it into CHANGELOG.md.',
  },
  {
    name: 'pr',
    description: 'Summarize a pull request — type /pr 12',
    prompt: '',
  },
];
const BUILTIN_NAMES = new Set(BUILTINS.map((b) => b.name));

// The `/` prefix of the chat input: the query after the slash when
// the slash is the first non-space character, else null. A slash
// mid-message ("run /bin/ls") is not a command, and a space after
// the name ends the query (v1 commands take no arguments).
function parseSlashPrefix(text) {
  const m = /^\/([^\s]*)$/.exec(String(text || '').replace(/^\s+/, ''));
  if (!m) return null;
  return m[1];
}

// Filter the popup list for a query: built-ins first, then custom
// snippets. A name match outranks a description-only match, so typing
// "com" lists /commit-msg before /review (whose description contains
// "uncommitted"). An empty query lists everything. Returns
// [{ name, description, builtin, snippet }] where snippet is the raw
// snippet or null.
function filterCommands(query, snippets) {
  const q = String(query || '').toLowerCase();
  const nameHit = (name) => !q || name.toLowerCase().includes(q);
  const descHit = (desc) => q && String(desc || '').toLowerCase().includes(q);
  const items = [];
  for (const b of BUILTINS) items.push({ name: b.name, description: b.description, builtin: true, snippet: null });
  for (const s of Array.isArray(snippets) ? snippets : []) {
    if (!s || typeof s.name !== 'string') continue;
    items.push({ name: s.name, description: String(s.prompt || '').slice(0, 80), builtin: false, snippet: s });
  }
  const nameMatches = items.filter((c) => nameHit(c.name));
  const descMatches = items.filter((c) => !nameHit(c.name) && descHit(c.description));
  return nameMatches.concat(descMatches);
}

// Validate one snippet as the Settings UI would save it. Returns
// { ok: true, snippet: { name, prompt } } with the name lowercased,
// or { ok: false, error }. `names` is the set of names already in the
// list (built-ins included) for the duplicate check.
function validateSnippet(name, prompt, names) {
  const n = String(name || '').trim().toLowerCase();
  const p = String(prompt || '').trim();
  if (!SNIPPET_NAME_RE.test(n)) return { ok: false, error: 'Name must start with a letter or digit and use only lowercase letters, digits, and hyphens.' };
  if (n.length > MAX_SNIPPET_NAME) return { ok: false, error: 'Name is too long (max 32 characters).' };
  if (BUILTIN_NAMES.has(n)) return { ok: false, error: '/' + n + ' is a built-in command — pick another name.' };
  if (names && names.has(n)) return { ok: false, error: 'There is already a command named /' + n + '.' };
  if (!p) return { ok: false, error: 'Prompt must not be empty.' };
  if (p.length > MAX_SNIPPET_PROMPT) return { ok: false, error: 'Prompt is too long (max 4000 characters).' };
  return { ok: true, snippet: { name: n, prompt: p } };
}

// Sanitize a snippets value from settings.json (load + set): anything
// malformed is dropped, never throws. Built-in collisions and
// duplicates keep the first; the list caps at MAX_SNIPPETS.
function sanitizeSnippets(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const s of list) {
    if (out.length >= MAX_SNIPPETS) break;
    if (!s || typeof s !== 'object') continue;
    const v = validateSnippet(s.name, s.prompt, seen);
    if (!v.ok) continue;
    seen.add(v.snippet.name);
    out.push(v.snippet);
  }
  return out;
}

// The fenced diff block for a turn. `diff` is the raw diff text,
// `truncated` says it was capped, `untracked` is the list of
// untracked file names (names only, never contents).
function formatDiffBlock(diff, opts) {
  let o = opts || {};
  let d = String(diff || '');
  if (d.length > MAX_DIFF_CHARS) {
    const h = Math.floor(MAX_DIFF_CHARS / 2);
    d = d.slice(0, h) + '\n...[diff truncated to 30 KB]...\n' + d.slice(-h);
    o = { ...o, truncated: true };
  }
  let block = '```diff\n' + d + '\n```';
  const notes = [];
  if (o.truncated) notes.push('Diff truncated to 30 KB.');
  if (Array.isArray(o.untracked) && o.untracked.length) {
    notes.push('Untracked files (not shown): ' + o.untracked.join(', ') + (o.untrackedTruncated ? ', …' : ''));
  }
  if (notes.length) block += '\n\n' + notes.join(' ');
  return block;
}

// Truncate terminal output middle-out, the files:read precedent.
function truncateOutput(text) {
  const t = String(text || '');
  if (t.length <= MAX_OUTPUT_CHARS) return t;
  const h = Math.floor(MAX_OUTPUT_CHARS / 2);
  return t.slice(0, h) + '\n...[output truncated]...\n' + t.slice(-h);
}

// Message builders. Each returns the full user message text for the
// turn: command line, instruction, fenced context.
function buildReviewMessage(diff, opts) {
  const b = BUILTINS[0];
  return '/' + b.name + '\n\n' + b.prompt + '\n\n' + formatDiffBlock(diff, opts);
}

function buildCommitMessage(diff, opts) {
  const b = BUILTINS[1];
  return '/' + b.name + '\n\n' + b.prompt + '\n\n' + formatDiffBlock(diff, opts);
}

function buildExplainMessage(block) {
  const b = BUILTINS[2];
  const cmd = block && block.command ? String(block.command) : '(unknown command)';
  const code = block && typeof block.exitCode === 'number' ? 'exit code ' + block.exitCode : 'no exit code recorded';
  const running = block && block.status === 'running' ? ' (still running)' : '';
  const out = truncateOutput(block && block.output ? block.output : '');
  return '/' + b.name + '\n\nThe last terminal command was `$ ' + cmd + '` (' + code + ')' + running + '. ' + b.prompt + '\n\n```\n' + out + '\n```';
}

// Expand a custom snippet template. `{diff}` is replaced with the
// fenced diff block wherever it appears. Returns null when the
// template needs a diff but none was supplied — the caller refuses
// the command instead of sending a turn with a hole in it.
function expandSnippet(template, diff, diffOpts) {
  const t = String(template || '');
  if (!t.includes('{diff}')) return t;
  if (diff == null) return null;
  return t.split('{diff}').join(formatDiffBlock(diff, diffOpts));
}

const SlashCmds = {
  MAX_DIFF_CHARS,
  MAX_OUTPUT_CHARS,
  MAX_SNIPPETS,
  MAX_SNIPPET_NAME,
  MAX_SNIPPET_PROMPT,
  BUILTINS,
  parseSlashPrefix,
  filterCommands,
  validateSnippet,
  sanitizeSnippets,
  formatDiffBlock,
  truncateOutput,
  buildReviewMessage,
  buildCommitMessage,
  buildExplainMessage,
  expandSnippet,
};
if (typeof module !== 'undefined' && module.exports) module.exports = SlashCmds;
if (typeof window !== 'undefined') window.PortalSlashCmds = SlashCmds;
