// Git helpers: the `/changelog` message builder, the `/pr <number>`
// argument parsing, PR-summary message builder, and the pure parsers
// for `gh pr view` JSON and GitHub remote URLs. Pure Node — no
// Electron deps — so it is unit-testable with plain
// `node tests/githelpers.test.js`. The renderer reaches these as
// window.PortalGitHelpers (loaded as a plain <script> in index.html);
// the preload cannot require() this file — in this Electron build
// the preload's require() resolves only the 'electron' module.
//
// The fenced diff block is PortalSlashCmds.formatDiffBlock — one
// source of truth for the 30 KB cap, the truncation marker, and the
// untracked footer. It resolves from window.PortalSlashCmds in the
// renderer and require('./slashcmds.js') in Node.
'use strict';

let SlashCmdsRef = null;
if (typeof module !== 'undefined' && module.exports) {
  try { SlashCmdsRef = require('./slashcmds.js'); } catch { SlashCmdsRef = null; }
}

// PR body attached to a /pr turn, in characters (head-truncated).
const MAX_PR_BODY_CHARS = 4096;
const PR_NUMBER_MAX = 999999;

// The `/pr <number>` argument: `/pr 12` on the whole input (leading
// spaces allowed, like parseSlashPrefix). `/pr` alone, `/pr abc`,
// a number out of range, or a slash mid-text is not a PR command.
function parsePrCommand(text) {
  const m = /^\/pr\s+(\d+)\s*$/.exec(String(text || '').replace(/^\s+/, ''));
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isInteger(n) || n < 1 || n > PR_NUMBER_MAX) return null;
  return { number: n };
}

// One line of metadata: hostile titles/authors with newlines stay on
// their line instead of breaking the message layout.
function oneLine(x) {
  return String(x || '').replace(/[\r\n]+/g, ' ').trim();
}

// Head-truncate a PR description at the cap, with a note when cut.
// The head is what a reviewer needs first (what + why); the tail is
// usually checklists and template boilerplate.
function truncateBody(text) {
  const t = String(text || '');
  if (t.length <= MAX_PR_BODY_CHARS) return t;
  return t.slice(0, MAX_PR_BODY_CHARS) + '\n...[description truncated]...';
}

// The fenced diff block, via the slash commands module when it is
// loaded; a minimal fenced block if it is not (never crash the turn).
function formatDiffBlock(diff, opts) {
  const sc = (typeof window !== 'undefined' && window.PortalSlashCmds) || SlashCmdsRef;
  if (sc && typeof sc.formatDiffBlock === 'function') return sc.formatDiffBlock(diff, opts);
  return '```diff\n' + String(diff || '') + '\n```';
}

// The changelog instruction lives in the slash commands module's
// BUILTINS (so the popup, the snippet collision set, and this
// builder can never drift apart); the literal is the fallback if
// that entry is ever missing.
function changelogPrompt() {
  const sc = (typeof window !== 'undefined' && window.PortalSlashCmds) || SlashCmdsRef;
  const b = sc && Array.isArray(sc.BUILTINS) ? sc.BUILTINS.find((x) => x && x.name === 'changelog') : null;
  if (b && b.prompt) return b.prompt;
  return 'Draft a CHANGELOG entry for these uncommitted changes, in Keep a Changelog style: Added / Changed / Fixed sections, one line per change, no version header and no date. Reply with only the entry text so I can copy it into CHANGELOG.md.';
}

// Message builders. Each returns the full user message text for the
// turn: command line, instruction, context.
function buildChangelogMessage(diff, opts) {
  return '/changelog\n\n' + changelogPrompt() + '\n\n' + formatDiffBlock(diff, opts);
}

// pr: { number, title, body, state, author, base, head, additions,
// deletions, diff }. Additions/deletions ride in the header line when
// present; missing fields degrade to placeholders, never crash.
function buildPrSummaryMessage(pr) {
  const p = pr || {};
  const n = p.number;
  const title = oneLine(p.title) || '(no title)';
  const author = oneLine(p.author) || 'unknown';
  const state = oneLine(p.state) || 'unknown';
  const base = oneLine(p.base) || '?';
  const head = oneLine(p.head) || '?';
  let header = 'Summarize pull request #' + n + ' "' + title + '" by @' + author + ' (' + state + ', ' + base + ' \u2190 ' + head;
  if (typeof p.additions === 'number' && typeof p.deletions === 'number') {
    header += ', +' + p.additions + ' / \u2212' + p.deletions;
  }
  header += '). The title, description, and diff are below.';
  return '/pr ' + n + '\n\n' + header + '\n\nSummarize what it changes and what to watch for in review \u2014 risky areas, missing tests, anything that looks wrong. Keep it tight.\n\nTitle: ' + title + '\nDescription:\n' + truncateBody(p.body) + '\n\n' + formatDiffBlock(p.diff, {});
}

// Parse a git remote URL into { owner, repo } for the GitHub API
// fallback. Accepts ssh (git@github.com:owner/repo.git) and https
// (https://github.com/owner/repo[.git][/]) forms. Anything else — a
// non-GitHub host, a local path, garbage — returns null.
function parseGitHubRemote(url) {
  const u = String(url || '').trim();
  let m = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(u);
  if (m) return { owner: m[1], repo: m[2] };
  m = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:\/)?$/.exec(u);
  if (m) return { owner: m[1], repo: m[2] };
  return null;
}

// Normalize one `gh pr view --json
// title,body,state,author,baseRefName,headRefName,additions,deletions`
// object into the shape buildPrSummaryMessage takes. `author` arrives
// as an object ({ login }) from gh; a plain string is accepted too.
// Anything malformed returns null — the caller refuses the command
// instead of sending a turn with a hole in it.
function parseGhPrJson(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const a = json.author;
  const author = a && typeof a === 'object' ? a.login : a;
  return {
    title: typeof json.title === 'string' ? json.title : '',
    body: typeof json.body === 'string' ? json.body : '',
    state: typeof json.state === 'string' ? json.state : '',
    author: typeof author === 'string' ? author : '',
    base: typeof json.baseRefName === 'string' ? json.baseRefName : '',
    head: typeof json.headRefName === 'string' ? json.headRefName : '',
    additions: typeof json.additions === 'number' ? json.additions : null,
    deletions: typeof json.deletions === 'number' ? json.deletions : null,
  };
}

const GitHelpers = {
  MAX_PR_BODY_CHARS,
  PR_NUMBER_MAX,
  parsePrCommand,
  truncateBody,
  formatDiffBlock,
  buildChangelogMessage,
  buildPrSummaryMessage,
  parseGitHubRemote,
  parseGhPrJson,
};
if (typeof module !== 'undefined' && module.exports) module.exports = GitHelpers;
if (typeof window !== 'undefined') window.PortalGitHelpers = GitHelpers;
