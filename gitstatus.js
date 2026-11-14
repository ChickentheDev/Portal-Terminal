// Git status helpers: parsing `git rev-parse` / `git status --porcelain`
// output and formatting the cwd-chip label. Pure Node — no Electron
// deps — so it is unit-testable with plain `node tests/gitstatus.test.js`.
// The renderer reaches these as window.PortalGitStatus (loaded as a plain
// <script> in index.html); the preload cannot require() this file — in this
// Electron build the preload's require() resolves only the 'electron' module.
'use strict';

// Entries counted before the count is capped (display caps at 99+).
const MAX_DIRTY_COUNT = 100;
const DISPLAY_DIRTY_CAP = 99;

// Count changed files in `git status --porcelain=v1` output: one
// non-blank line per entry. Caps at MAX_DIRTY_COUNT so a huge repo never
// produces a giant number. Handles \n and \r\n line endings.
function countPorcelain(out) {
  const lines = String(out || '').split('\n').filter((l) => l.trim() !== '');
  const capped = lines.length > MAX_DIRTY_COUNT;
  return { count: capped ? MAX_DIRTY_COUNT : lines.length, capped };
}

// Format the cwd-chip git label from a git:status reply.
// status: { isRepo, branch, detached, dirty, capped }
//   dirty is a number (0 = clean), or null when main could not read the
//   worktree status (e.g. a bare repo). Returns { text, title } — text
//   goes in the #cwd-git span, title into the chip tooltip. Not-a-repo
//   (or a null/invalid reply) returns both empty: the chip stays path-only.
function formatGitLabel(status) {
  if (!status || !status.isRepo || !status.branch) return { text: '', title: '' };
  const branch = String(status.branch);
  const detached = !!status.detached;
  const dirty = typeof status.dirty === 'number' ? status.dirty : null;
  let text = branch;
  let title = detached ? 'Detached HEAD at ' + branch : 'On branch ' + branch;
  if (dirty === null) {
    title += ' (status unavailable)';
  } else if (dirty > 0) {
    const n = status.capped ? DISPLAY_DIRTY_CAP + '+' : String(dirty);
    text += ' \u25CF' + n;
    title += ' \u2014 ' + (status.capped ? '100+ changed files' : dirty + (dirty === 1 ? ' changed file' : ' changed files'));
  } else {
    title += ' \u2014 clean';
  }
  return { text, title };
}

const GitStatusUtils = {
  MAX_DIRTY_COUNT,
  DISPLAY_DIRTY_CAP,
  countPorcelain,
  formatGitLabel,
};
if (typeof module !== 'undefined' && module.exports) module.exports = GitStatusUtils;
if (typeof window !== 'undefined') window.PortalGitStatus = GitStatusUtils;
