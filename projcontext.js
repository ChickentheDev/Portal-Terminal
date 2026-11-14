// Project-aware context: a small snapshot of the chat's working
// directory (name, stack hints, top-level tree, start of the README)
// attached to each agent turn's system context. Pure Node — no
// Electron deps — so it is unit-testable with plain
// `node tests/projcontext.test.js`. Only main.js requires this file;
// the renderer never needs it (main sends the summary + text over
// the 'context' event).
//
// Read-only: readdir + lstat + two small file reads (package.json
// name field, README). No shell, no writes, no network. Symlinked
// entries whose real path escapes the cwd are skipped, and dotfiles
// (including .env) are never listed or read.
'use strict';

const path = require('path');

const MAX_TREE_ENTRIES = 30;
const MAX_README_LINES = 40;
const MAX_README_BYTES = 4096;
const MAX_STACK_LABELS = 3;

// Directories that are never listed: build output, deps, VCS.
const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'target', 'dist', 'build', 'out',
  '.next', 'vendor', '__pycache__',
]);

// Marker file (exact name) -> stack label, in priority order.
const STACK_MARKERS = [
  ['package.json', 'Node'],
  ['Cargo.toml', 'Rust'],
  ['go.mod', 'Go'],
  ['pyproject.toml', 'Python'],
  ['setup.py', 'Python'],
  ['requirements.txt', 'Python'],
  ['Gemfile', 'Ruby'],
  ['composer.json', 'PHP'],
  ['pom.xml', 'Java'],
  ['build.gradle', 'Java'],
  ['build.gradle.kts', 'Java'],
];

// Suffix markers that are not exact names.
const STACK_SUFFIXES = [
  ['.csproj', '.NET'],
  ['.sln', '.NET'],
  ['.xcodeproj', 'Xcode'],
];

// Top-level file extension -> stack label (fallback when no marker).
const STACK_EXTS = {
  '.py': 'Python', '.rs': 'Rust', '.go': 'Go', '.js': 'Node',
  '.ts': 'Node', '.java': 'Java', '.rb': 'Ruby', '.php': 'PHP',
  '.cs': '.NET', '.c': 'C', '.cpp': 'C++', '.swift': 'Swift',
  '.kt': 'Kotlin',
};

const README_NAMES = ['README.md', 'README', 'README.txt'];

function isInside(base, target) {
  const rel = path.relative(base, target);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

// Stack hints from top-level entry names. Markers win over extension
// fallback; at most MAX_STACK_LABELS labels, in marker priority order.
// Returns [] when nothing matches.
function detectStack(names) {
  const labels = [];
  const add = (label) => {
    if (label && !labels.includes(label) && labels.length < MAX_STACK_LABELS) labels.push(label);
  };
  const set = new Set(names || []);
  for (const [file, label] of STACK_MARKERS) if (set.has(file)) add(label);
  for (const name of names || []) {
    for (const [suffix, label] of STACK_SUFFIXES) {
      if (name.endsWith(suffix)) add(label);
    }
  }
  if (!labels.length) {
    for (const name of names || []) {
      const label = STACK_EXTS[path.extname(name)];
      if (label) add(label);
    }
  }
  return labels;
}

// List the top level of `cwd`: folders first then files, alphabetical
// within each group, dotfiles and EXCLUDED_DIRS skipped, symlinks that
// escape the cwd skipped. Returns { entries, total, shown } where
// entries are names with a trailing '/' for directories; total is the
// count before the MAX_TREE_ENTRIES cap.
function listTree(cwd, fsys) {
  let names;
  try {
    names = fsys.readdirSync(cwd);
  } catch {
    return null;
  }
  let cwdReal;
  try {
    cwdReal = fsys.realpathSync(cwd);
  } catch {
    return null;
  }
  const dirs = [];
  const files = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    if (EXCLUDED_DIRS.has(name)) continue;
    const full = path.join(cwd, name);
    let st;
    try {
      st = fsys.lstatSync(full);
    } catch {
      continue;
    }
    let isDir = false;
    try {
      isDir = st.isDirectory();
      if (st.isSymbolicLink()) {
        const real = fsys.realpathSync(full);
        if (!isInside(cwdReal, real)) continue; // escapes the cwd: skip
        isDir = fsys.statSync(real).isDirectory();
      }
    } catch {
      continue;
    }
    (isDir ? dirs : files).push(name);
  }
  const byName = (a, b) => a.toLowerCase().localeCompare(b.toLowerCase());
  dirs.sort(byName);
  files.sort(byName);
  const all = dirs.map((d) => d + '/').concat(files);
  const shown = all.slice(0, MAX_TREE_ENTRIES);
  return { entries: shown, total: all.length, shown: shown.length };
}

// Read the README (first README_NAMES match, case-insensitive).
// Returns { found, lines, truncated } — lines are the first
// MAX_README_LINES lines of at most MAX_README_BYTES of the file.
function readReadme(cwd, names, fsys) {
  const lower = new Map((names || []).map((n) => [n.toLowerCase(), n]));
  let found = null;
  for (const candidate of README_NAMES) {
    if (lower.has(candidate.toLowerCase())) { found = lower.get(candidate.toLowerCase()); break; }
  }
  if (!found) return { found: false, lines: [], truncated: false };
  let cwdReal;
  try {
    cwdReal = fsys.realpathSync(cwd);
  } catch {
    return { found: false, lines: [], truncated: false };
  }
  const full = path.join(cwd, found);
  try {
    const real = fsys.realpathSync(full);
    if (!isInside(cwdReal, real)) return { found: false, lines: [], truncated: false };
    const buf = fsys.readFileSync(real);
    const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf));
    const truncatedBytes = bytes.length > MAX_README_BYTES;
    const text = bytes.toString('utf8', 0, Math.min(bytes.length, MAX_README_BYTES));
    const lines = text.split('\n');
    const truncatedLines = lines.length > MAX_README_LINES;
    return { found: true, lines: lines.slice(0, MAX_README_LINES), truncated: truncatedBytes || truncatedLines };
  } catch {
    return { found: false, lines: [], truncated: false };
  }
}

// Project name: package.json `name` when it parses, else null (the
// caller falls back to the folder name).
function readPackageName(cwd, fsys) {
  try {
    const raw = fsys.readFileSync(path.join(cwd, 'package.json'), 'utf8');
    const parsed = JSON.parse(String(raw));
    return typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : null;
  } catch {
    return null;
  }
}

// Format the snapshot text block attached to the turn's system message.
function formatSnapshot(data) {
  const stack = data.stack && data.stack.length ? data.stack.join(', ') : 'unknown';
  const lines = [];
  lines.push('Project: ' + data.name);
  lines.push('Stack: ' + stack);
  let treeLine = 'Files: ';
  treeLine += data.tree.entries.length ? data.tree.entries.join(', ') : '(empty)';
  if (data.tree.total > data.tree.shown) treeLine += ` (${data.tree.shown} shown, +${data.tree.total - data.tree.shown} more)`;
  lines.push(treeLine);
  if (data.readme.found) {
    lines.push('README (first ' + MAX_README_LINES + ' lines' + (data.readme.truncated ? ', truncated' : '') + '):');
    lines.push(...data.readme.lines);
  } else {
    lines.push('README: none');
  }
  return lines.join('\n');
}

// One-line summary for the collapsible context line in the chat UI.
function formatSummary(data) {
  const stack = data.stack && data.stack.length ? data.stack.join(', ') : 'unknown stack';
  const files = data.tree.total + (data.tree.total === 1 ? ' file' : ' files');
  const readme = data.readme.found ? 'README' : 'no README';
  return `${data.name} · ${stack} · ${files} · ${readme}`;
}

// Build the snapshot for a working directory. `fsys` is injectable
// for tests (defaults to Node's fs). Returns
// { ok, name, stack, tree, readme, text, summary } or
// { ok: false, reason } when the directory cannot be listed at all.
function buildSnapshot(cwd, fsys) {
  const fs = fsys || require('fs');
  if (typeof cwd !== 'string' || !cwd) return { ok: false, reason: 'No working directory.' };
  let names;
  try {
    names = fs.readdirSync(cwd);
  } catch {
    return { ok: false, reason: 'Working directory is not available.' };
  }
  const tree = listTree(cwd, fs);
  if (!tree) return { ok: false, reason: 'Working directory is not available.' };
  const name = readPackageName(cwd, fs) || path.basename(path.resolve(cwd)) || cwd;
  const stack = detectStack(names);
  const readme = readReadme(cwd, names, fs);
  const data = { name, stack, tree, readme };
  return { ok: true, ...data, text: formatSnapshot(data), summary: formatSummary(data) };
}

const ProjContext = {
  MAX_TREE_ENTRIES,
  MAX_README_LINES,
  MAX_README_BYTES,
  MAX_STACK_LABELS,
  detectStack,
  listTree,
  readReadme,
  readPackageName,
  formatSnapshot,
  formatSummary,
  buildSnapshot,
};
if (typeof module !== 'undefined' && module.exports) module.exports = ProjContext;
if (typeof window !== 'undefined') window.PortalProjContext = ProjContext;
