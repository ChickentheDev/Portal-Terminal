// Unit tests for the agent file tools (filetools.js).
// Run: node filetools.test.js — no Electron needed.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  READ_MAX_BYTES,
  resolveScopedPath,
  isBinaryBuffer,
  readFileScoped,
  writeFileAtomic,
  applyEdit,
  makeDiff,
  listDirScoped,
} = require('../filetools.js');

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

// --- fixture tree ---
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-test-'));
fs.mkdirSync(path.join(root, 'sub'));
fs.mkdirSync(path.join(root, '.git'));
fs.mkdirSync(path.join(root, 'node_modules'));
fs.mkdirSync(path.join(root, 'dist'));
fs.writeFileSync(path.join(root, 'hello.txt'), 'line one\nline two\nline three\n');
fs.writeFileSync(path.join(root, 'sub', 'code.js'), 'const a = 1;\n');
fs.writeFileSync(path.join(root, '.env'), 'SECRET=x\n');
fs.writeFileSync(path.join(root, 'sub', '.env.local'), 'SECRET=y\n');
fs.writeFileSync(path.join(root, 'key.pem'), '-----BEGIN-----\n');
fs.writeFileSync(path.join(root, '.git', 'config'), '[core]\n');
fs.writeFileSync(path.join(root, 'node_modules', 'x.js'), 'x\n');
fs.writeFileSync(path.join(root, 'dist', 'out.js'), 'o\n');
fs.writeFileSync(path.join(root, 'bin.dat'), Buffer.concat([Buffer.from('PNG'), Buffer.from([0, 1, 2])]));
fs.writeFileSync(path.join(root, 'big.txt'), 'x'.repeat(READ_MAX_BYTES + 1));
fs.symlinkSync(path.join(root, 'hello.txt'), path.join(root, 'link-inside'));
fs.symlinkSync('/etc/hostname', path.join(root, 'link-outside'));
fs.symlinkSync(root, path.join(root, 'sub', 'up-link'));
fs.symlinkSync('/etc', path.join(root, 'sub', 'etc-link'));
fs.symlinkSync(path.join(root, '.env'), path.join(root, 'link-to-env'));

// --- resolveScopedPath: containment ---
ok(resolveScopedPath(root, 'hello.txt').ok, 'relative file inside');
ok(resolveScopedPath(root, 'sub/code.js').ok, 'nested file inside');
ok(resolveScopedPath(root, 'new-file.txt').ok, 'not-yet-existing file inside');
ok(resolveScopedPath(root, 'sub/../hello.txt').ok, '.. that stays inside');
ok(resolveScopedPath(root, './hello.txt').ok, './ prefix inside');
ok(!resolveScopedPath(root, '../escape.txt').ok, 'parent traversal rejected');
ok(!resolveScopedPath(root, 'sub/../../escape.txt').ok, 'deep traversal rejected');
ok(!resolveScopedPath(root, '/etc/passwd').ok, 'absolute outside rejected');
ok(resolveScopedPath(root, path.join(root, 'hello.txt')).ok, 'absolute inside allowed');
ok(!resolveScopedPath(root, '').ok, 'empty path rejected');

// --- resolveScopedPath: denylist ---
ok(!resolveScopedPath(root, '.env').ok, '.env denied');
ok(!resolveScopedPath(root, 'sub/.env.local').ok, '.env.local denied');
ok(!resolveScopedPath(root, '.ENV').ok || true, '.ENV case (may not exist, denylist is lexical)');
{
  fs.writeFileSync(path.join(root, '.ENV'), 'x\n');
  ok(!resolveScopedPath(root, '.ENV').ok, '.ENV denied case-insensitively');
}
ok(!resolveScopedPath(root, 'key.pem').ok, '*.pem denied');
ok(!resolveScopedPath(root, '.git/config').ok, '.git internals denied');
ok(!resolveScopedPath(root, 'node_modules/x.js').ok, 'node_modules denied');
ok(!resolveScopedPath(root, 'dist/out.js').ok, 'dist denied');
ok(!resolveScopedPath(root, 'sub/.git').ok, '.git as a component denied');

// --- resolveScopedPath: symlinks ---
ok(resolveScopedPath(root, 'link-inside').ok, 'symlink to inside file allowed');
ok(!resolveScopedPath(root, 'link-outside').ok, 'symlink to outside rejected');
ok(!resolveScopedPath(root, 'sub/etc-link/passwd').ok, 'symlink dir to outside rejected (realpath check)');
ok(resolveScopedPath(root, 'sub/up-link/hello.txt').ok, 'symlink dir resolving back inside allowed');
ok(resolveScopedPath(root, 'sub/up-link/sub/code.js').ok, 'symlink dir resolving back inside allowed');
ok(!resolveScopedPath(root, 'link-to-env').ok, 'symlink to a denylisted file rejected (real-path components)');

// --- isBinaryBuffer ---
ok(isBinaryBuffer(Buffer.from([0, 1, 2])), 'NUL byte = binary');
ok(!isBinaryBuffer(Buffer.from('hello\nworld\n')), 'plain text not binary');
ok(!isBinaryBuffer(Buffer.from('café — ünïcode\n')), 'utf-8 text not binary');

// --- readFileScoped ---
{
  const r = readFileScoped(root, 'hello.txt');
  ok(r.ok && r.text === 'line one\nline two\nline three\n', 'read ok');
  ok(!readFileScoped(root, 'missing.txt').ok, 'missing file errors');
  ok(!readFileScoped(root, 'sub').ok, 'directory read errors');
  ok(!readFileScoped(root, 'big.txt').ok, 'oversize read rejected');
  ok(!readFileScoped(root, 'bin.dat').ok, 'binary read rejected');
  ok(!readFileScoped(root, '.env').ok, 'denied read rejected');
  ok(!readFileScoped(root, '../escape.txt').ok, 'traversal read rejected');
}

// --- writeFileAtomic ---
{
  const p = path.join(root, 'written.txt');
  writeFileAtomic(p, 'first\n');
  eq(fs.readFileSync(p, 'utf8'), 'first\n', 'atomic write creates');
  writeFileAtomic(p, 'second\n');
  eq(fs.readFileSync(p, 'utf8'), 'second\n', 'atomic write overwrites');
  ok(!fs.readdirSync(root).some((n) => n.startsWith('.portal-tmp-')), 'no temp file left behind');
}

// --- applyEdit ---
eq(applyEdit('a\nb\nc\n', 'b\n', 'B!\n'), { ok: true, content: 'a\nB!\nc\n' }, 'edit replaces once');
ok(!applyEdit('a\nb\n', 'z\n', 'Z\n').ok, 'edit with no match errors');
ok(!applyEdit('x\nx\n', 'x\n', 'y\n').ok, 'edit with two matches errors');
ok(!applyEdit('a\n', '', 'b\n').ok, 'edit with empty old_text errors');

// --- makeDiff ---
{
  const d = makeDiff('a\nb\nc\n', 'a\nb\nc\n');
  eq(d, { diff: '', additions: 0, deletions: 0, truncated: false, changed: false }, 'identical diff empty');
  const ins = makeDiff('a\nc\n', 'a\nb\nc\n');
  ok(ins.changed && ins.additions === 1 && ins.deletions === 0 && ins.diff.includes('+b'), 'insert diff');
  const del = makeDiff('a\nb\nc\n', 'a\nc\n');
  ok(del.changed && del.additions === 0 && del.deletions === 1 && del.diff.includes('-b'), 'delete diff');
  const rep = makeDiff('a\nb\nc\n', 'a\nB\nc\n');
  ok(rep.additions === 1 && rep.deletions === 1 && rep.diff.includes('-b') && rep.diff.includes('+B'), 'replace diff');
  const nf = makeDiff('', 'x\ny\n');
  ok(nf.additions === 2 && nf.diff.includes('+x') && nf.diff.includes('+y'), 'new file diff all additions');
  const df = makeDiff('x\ny\n', '');
  ok(df.deletions === 2, 'deleted file diff');
  // truncation: 200 changed lines -> capped display, correct counts
  const oldL = Array.from({ length: 200 }, (_, i) => 'old' + i).join('\n');
  const newL = Array.from({ length: 200 }, (_, i) => 'new' + i).join('\n');
  const big = makeDiff(oldL, newL);
  ok(big.truncated && big.additions === 200 && big.deletions === 200 && big.diff.includes('more changed lines'), 'big diff truncates with counts');
  // hunk header present for multi-region changes
  const multi = makeDiff(
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].join('\n'),
    ['1', 'X', '3', '4', '5', '6', '7', '8', '9', 'Y'].join('\n'));
  ok(multi.diff.includes('@@'), 'multi-hunk diff has headers');
}

// --- listDirScoped ---
{
  const r = listDirScoped(root, '.');
  ok(r.ok, 'list root ok');
  const names = r.entries.map((e) => e.name);
  ok(names.includes('hello.txt') && names.includes('sub'), 'list has files and dirs');
  ok(!names.some((n) => n.startsWith('.git') || n.startsWith('node_modules') || n.startsWith('dist') || n === '.env'), 'list skips denylisted');
  ok(r.entries.find((e) => e.name === 'hello.txt').type === 'file', 'file entry typed');
  ok(r.entries.find((e) => e.name === 'sub').type === 'dir', 'dir entry typed');
  const rec = listDirScoped(root, '.', { recursive: true });
  ok(rec.entries.some((e) => e.name === 'sub/code.js'), 'recursive list descends');
  ok(!rec.entries.some((e) => e.name.startsWith('.git/')), 'recursive list never descends into .git');
  ok(!listDirScoped(root, 'hello.txt').ok, 'list of a file errors');
  ok(!listDirScoped(root, '../').ok, 'list outside errors');
  const empty = listDirScoped(root, 'sub');
  ok(empty.ok && empty.entries.length === 3, 'list subdir'); // code.js + up-link + etc-link
}

// --- cleanup ---
fs.rmSync(root, { recursive: true, force: true });

console.log(`filetools: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
