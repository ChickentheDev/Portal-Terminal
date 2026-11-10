// File tools for the Portal agent: path scoping, denylist, binary/size
// checks, line diff, and atomic writes. Pure Node — no Electron deps —
// so it is unit-testable with plain `node tests/filetools.test.js`.
//
// Security model: every path the agent touches is resolved against the
// chat's working directory and validated TWICE — once lexically, once
// after symlink resolution (realpath). File CONTENTS are data, never
// instructions; nothing in this module executes or interprets them.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const READ_MAX_BYTES = 200 * 1024; // same cap as the nano file:readText IPC
const WRITE_MAX_BYTES = 1024 * 1024;
const BINARY_PROBE_BYTES = 8192;

// Basenames denied for read AND write (case-insensitive match).
// Secrets and credential material: never let the agent read or write these.
const DENIED_BASENAMES = [
  '.env',
  'credentials.json',
  '.netrc',
];
const DENIED_BASENAME_PREFIXES = ['.env.', 'id_rsa'];
const DENIED_EXTENSIONS = ['.pem', '.key', '.p12', '.pfx'];
// Directory names denied at any depth, for read AND write.
const DENIED_DIRS = new Set(['.git', 'node_modules', 'dist']);

function isInside(dir, p) {
  const rel = path.relative(dir, p);
  return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}

function deniedComponent(name) {
  const lower = name.toLowerCase();
  if (DENIED_DIRS.has(lower)) return true;
  if (DENIED_BASENAMES.includes(lower)) return true;
  if (DENIED_BASENAME_PREFIXES.some((pre) => lower.startsWith(pre))) return true;
  if (lower === '.credentials' || lower.endsWith('.credentials')) return true;
  if (DENIED_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;
  return false;
}

// Resolve `userPath` against `cwd` and validate it. Returns
// { ok: true, path, realPath } or { ok: false, error }.
// `path` is the lexical resolved path; `realPath` is the symlink-free
// path (nearest existing ancestor + remainder for not-yet-existing
// files). All filesystem work should use `realPath`.
function resolveScopedPath(cwd, userPath) {
  if (typeof userPath !== 'string' || !userPath.trim()) {
    return { ok: false, error: 'Empty path.' };
  }
  let cwdReal;
  try {
    cwdReal = fs.realpathSync(cwd);
  } catch {
    return { ok: false, error: 'Working directory is not available.' };
  }
  const resolved = path.resolve(cwdReal, userPath);
  if (!isInside(cwdReal, resolved)) {
    return { ok: false, error: 'Path is outside the working directory.' };
  }
  // realpath the nearest existing ancestor (the file itself may not
  // exist yet for a create), then re-append the missing tail.
  let target = resolved;
  const tail = [];
  let realBase = null;
  for (;;) {
    try {
      realBase = fs.realpathSync(target);
      break;
    } catch {
      const parent = path.dirname(target);
      if (parent === target) return { ok: false, error: 'Path cannot be resolved.' };
      tail.unshift(path.basename(target));
      target = parent;
    }
  }
  const realPath = tail.length ? path.join(realBase, ...tail) : realBase;
  if (!isInside(cwdReal, realPath)) {
    return { ok: false, error: 'Path escapes the working directory (symlink).' };
  }
  // Denylist on every component of the real path below the cwd, so
  // `sub/.env`, `link-to-.env`, and `.git/objects/x` all fail.
  const rel = path.relative(cwdReal, realPath);
  if (rel) {
    for (const part of rel.split(path.sep)) {
      if (deniedComponent(part)) {
        return { ok: false, error: `Refused: "${part}" is not accessible to the agent.` };
      }
    }
  }
  return { ok: true, path: resolved, realPath };
}

function isBinaryBuffer(buf) {
  const n = Math.min(buf.length, BINARY_PROBE_BYTES);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

// Full scoped read: path validation + file + size + binary checks.
// Returns { ok: true, path, realPath, text } or { ok: false, error }.
function readFileScoped(cwd, userPath, maxBytes = READ_MAX_BYTES) {
  const r = resolveScopedPath(cwd, userPath);
  if (!r.ok) return r;
  let st;
  try {
    st = fs.statSync(r.realPath);
  } catch {
    return { ok: false, error: `File not found: ${userPath}` };
  }
  if (!st.isFile()) return { ok: false, error: `Not a file: ${userPath}` };
  if (st.size > maxBytes) {
    return { ok: false, error: `File is too large (${Math.round(st.size / 1024)} KB, limit ${Math.round(maxBytes / 1024)} KB).` };
  }
  let buf;
  try {
    buf = fs.readFileSync(r.realPath);
  } catch (e) {
    return { ok: false, error: `Could not read file: ${e.message}` };
  }
  if (isBinaryBuffer(buf)) return { ok: false, error: 'Binary file — not readable as text.' };
  return { ok: true, path: r.path, realPath: r.realPath, text: buf.toString('utf8') };
}

// Write via a temp file in the same directory + rename, so a crash
// mid-write never leaves a half-written target. On Windows rename over
// an existing file fails, so fall back to a direct write there.
function writeFileAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.portal-tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    if (process.platform === 'win32') fs.writeFileSync(filePath, content, 'utf8');
    else throw e;
  }
}

// Exactly-one-match search-and-replace. Returns { ok: true, content }
// or { ok: false, error }.
function applyEdit(content, oldText, newText) {
  if (typeof oldText !== 'string' || oldText === '') {
    return { ok: false, error: 'old_text must not be empty.' };
  }
  const parts = content.split(oldText);
  const count = parts.length - 1;
  if (count === 0) return { ok: false, error: 'old_text was not found in the file.' };
  if (count > 1) {
    return { ok: false, error: `old_text matches ${count} times — make it unique (add more surrounding lines).` };
  }
  return { ok: true, content: parts.join(newText === undefined ? '' : newText) };
}

/* ---------- line diff (Myers O(ND)) ---------- */

function diffOps(a, b) {
  const n = a.length, m = b.length;
  const max = n + m;
  if (max === 0) return [];
  let v = { 1: 0 };
  const trace = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    const cur = {};
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && v[k - 1] < v[k + 1])) x = v[k + 1];
      else x = v[k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      cur[k] = x;
      if (x >= n && y >= m) { trace.push(cur); found = true; break; }
    }
    if (!found) { trace.push(cur); v = cur; }
  }
  // Walk the trace backwards to recover the edit script.
  const ops = [];
  let x = n, y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const vv = trace[d - 1];
    const k = x - y;
    const prevK = (k === -d || (k !== d && vv[k - 1] < vv[k + 1])) ? k + 1 : k - 1;
    const prevX = vv[prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push({ type: ' ', text: a[x - 1] }); x--; y--; }
    if (x === prevX) { ops.push({ type: '+', text: b[y - 1] }); y--; }
    else { ops.push({ type: '-', text: a[x - 1] }); x--; }
  }
  while (x > 0 && y > 0) { ops.push({ type: ' ', text: a[x - 1] }); x--; y--; }
  ops.reverse();
  return ops;
}

const DIFF_CONTEXT = 3;
const DIFF_MAX_LINES = 60;

// Unified-style diff of two texts. Returns
// { diff, additions, deletions, truncated, changed } where `diff` is the
// display-capped text (hunks with @@ headers), and `changed` is true
// when the texts differ at all.
function splitLines(t) {
  if (t === '') return [];
  const ls = t.split('\n');
  // A trailing newline ends the last line; it is not an extra empty line.
  if (ls.length && ls[ls.length - 1] === '') ls.pop();
  return ls;
}

function makeDiff(oldText, newText) {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const ops = diffOps(a, b);
  let additions = 0, deletions = 0;
  for (const op of ops) {
    if (op.type === '+') additions++;
    else if (op.type === '-') deletions++;
  }
  if (additions === 0 && deletions === 0) {
    return { diff: '', additions: 0, deletions: 0, truncated: false, changed: false };
  }
  // Group into hunks with DIFF_CONTEXT lines of context.
  const hunks = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === ' ') { i++; continue; }
    let start = Math.max(0, i - DIFF_CONTEXT);
    let end = i;
    while (end < ops.length) {
      if (ops[end].type !== ' ') { end++; continue; }
      // Look ahead: keep going while another change is within context.
      let j = end, gap = 0;
      while (j < ops.length && ops[j].type === ' ') { j++; gap++; }
      if (j < ops.length && gap <= DIFF_CONTEXT * 2) { end = j; continue; }
      break;
    }
    end = Math.min(ops.length, end + DIFF_CONTEXT);
    hunks.push({ start, end });
    i = end;
  }
  const lines = [];
  let shown = 0;
  let truncated = false;
  for (const h of hunks) {
    let oldStart = 0, newStart = 0;
    for (let k = 0; k < h.start; k++) {
      if (ops[k].type !== '+') oldStart++;
      if (ops[k].type !== '-') newStart++;
    }
    let oldCount = 0, newCount = 0;
    for (let k = h.start; k < h.end; k++) {
      if (ops[k].type !== '+') oldCount++;
      if (ops[k].type !== '-') newCount++;
    }
    lines.push(`@@ -${oldStart + 1},${oldCount} +${newStart + 1},${newCount} @@`);
    for (let k = h.start; k < h.end; k++) {
      if (shown >= DIFF_MAX_LINES) { truncated = true; break; }
      lines.push(ops[k].type + ops[k].text);
      shown++;
    }
    if (truncated) break;
  }
  if (truncated) lines.push(`… ${additions + deletions - shown} more changed lines (showing first ${shown})`);
  return { diff: lines.join('\n'), additions, deletions, truncated, changed: true };
}

// Scoped directory listing. Returns { ok: true, path, entries, truncated }
// (entries: { name, type: 'file'|'dir'|'link', size? }, names relative to
// the listed dir) or { ok: false, error }.
function listDirScoped(cwd, userPath = '.', opts = {}) {
  const recursive = !!opts.recursive;
  const maxEntries = opts.maxEntries || 500;
  const maxDepth = opts.maxDepth || 3;
  const r = resolveScopedPath(cwd, userPath || '.');
  if (!r.ok) return r;
  let st;
  try {
    st = fs.statSync(r.realPath);
  } catch {
    return { ok: false, error: `Directory not found: ${userPath}` };
  }
  if (!st.isDirectory()) return { ok: false, error: `Not a directory: ${userPath}` };
  const entries = [];
  let truncated = false;
  const walk = (dirReal, relBase, depth) => {
    let names;
    try {
      names = fs.readdirSync(dirReal);
    } catch {
      return;
    }
    names.sort();
    for (const name of names) {
      if (entries.length >= maxEntries) { truncated = true; return; }
      if (deniedComponent(name)) continue;
      const full = path.join(dirReal, name);
      let lst;
      try {
        lst = fs.lstatSync(full);
      } catch {
        continue;
      }
      const rel = relBase ? relBase + '/' + name : name;
      if (lst.isSymbolicLink()) {
        entries.push({ name: rel, type: 'link' });
      } else if (lst.isDirectory()) {
        entries.push({ name: rel, type: 'dir' });
        if (recursive && depth < maxDepth) walk(full, rel, depth + 1);
      } else if (lst.isFile()) {
        entries.push({ name: rel, type: 'file', size: lst.size });
      }
      if (truncated) return;
    }
  };
  walk(r.realPath, '', 1);
  return { ok: true, path: r.path, entries, truncated };
}

module.exports = {
  READ_MAX_BYTES,
  WRITE_MAX_BYTES,
  resolveScopedPath,
  isBinaryBuffer,
  readFileScoped,
  writeFileAtomic,
  applyEdit,
  makeDiff,
  listDirScoped,
};
