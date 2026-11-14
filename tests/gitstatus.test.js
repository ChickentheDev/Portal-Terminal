// Unit tests for gitstatus.js — run: node tests/gitstatus.test.js
'use strict';
const gs = require('../gitstatus.js');

let pass = 0, fail = 0;
function check(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL ' + label); }
}

// --- countPorcelain ---
check(JSON.stringify(gs.countPorcelain('')) === JSON.stringify({ count: 0, capped: false }), 'empty porcelain is clean');
check(JSON.stringify(gs.countPorcelain(' M README.md\n?? new.txt\n')) === JSON.stringify({ count: 2, capped: false }), 'two entries count as 2');
check(JSON.stringify(gs.countPorcelain('M  a.js\nA  b.js\n D c.js\n')) === JSON.stringify({ count: 3, capped: false }), 'staged/unstaged/deleted all count');
check(JSON.stringify(gs.countPorcelain(' M a.js\r\n?? b.js\r\n')) === JSON.stringify({ count: 2, capped: false }), 'CRLF line endings count');
check(JSON.stringify(gs.countPorcelain('   \n\n')) === JSON.stringify({ count: 0, capped: false }), 'blank lines do not count');
const many = Array.from({ length: 150 }, (_, i) => ' M f' + i + '.js').join('\n');
check(JSON.stringify(gs.countPorcelain(many)) === JSON.stringify({ count: 100, capped: true }), '150 entries cap at 100 with capped true');
const exactly = Array.from({ length: 100 }, (_, i) => ' M f' + i + '.js').join('\n');
check(JSON.stringify(gs.countPorcelain(exactly)) === JSON.stringify({ count: 100, capped: false }), 'exactly 100 entries is not capped');
check(JSON.stringify(gs.countPorcelain(null)) === JSON.stringify({ count: 0, capped: false }), 'null porcelain is clean');

// --- formatGitLabel ---
const clean = { isRepo: true, branch: 'main', detached: false, dirty: 0, capped: false };
check(JSON.stringify(gs.formatGitLabel(clean)) === JSON.stringify({ text: 'main', title: 'On branch main \u2014 clean' }), 'clean repo shows branch only');
const dirty = { isRepo: true, branch: 'main', detached: false, dirty: 3, capped: false };
check(JSON.stringify(gs.formatGitLabel(dirty)) === JSON.stringify({ text: 'main \u25CF3', title: 'On branch main \u2014 3 changed files' }), 'dirty repo shows branch + count');
const one = { isRepo: true, branch: 'dev', detached: false, dirty: 1, capped: false };
check(JSON.stringify(gs.formatGitLabel(one)) === JSON.stringify({ text: 'dev \u25CF1', title: 'On branch dev \u2014 1 changed file' }), 'one changed file is singular');
const capped = { isRepo: true, branch: 'main', detached: false, dirty: 100, capped: true };
check(JSON.stringify(gs.formatGitLabel(capped)) === JSON.stringify({ text: 'main \u25CF99+', title: 'On branch main \u2014 100+ changed files' }), 'capped count shows 99+');
const detached = { isRepo: true, branch: 'a1b2c3d', detached: true, dirty: 0, capped: false };
check(JSON.stringify(gs.formatGitLabel(detached)) === JSON.stringify({ text: 'a1b2c3d', title: 'Detached HEAD at a1b2c3d \u2014 clean' }), 'detached HEAD shows the hash, title explains');
const detachedDirty = { isRepo: true, branch: 'a1b2c3d', detached: true, dirty: 2, capped: false };
check(JSON.stringify(gs.formatGitLabel(detachedDirty)) === JSON.stringify({ text: 'a1b2c3d \u25CF2', title: 'Detached HEAD at a1b2c3d \u2014 2 changed files' }), 'detached + dirty combines');
const bare = { isRepo: true, branch: 'main', detached: false, dirty: null, capped: false };
check(JSON.stringify(gs.formatGitLabel(bare)) === JSON.stringify({ text: 'main', title: 'On branch main (status unavailable)' }), 'bare repo shows branch, status unavailable');
check(JSON.stringify(gs.formatGitLabel({ isRepo: false })) === JSON.stringify({ text: '', title: '' }), 'not-a-repo is empty');
check(JSON.stringify(gs.formatGitLabel(null)) === JSON.stringify({ text: '', title: '' }), 'null reply is empty');
check(JSON.stringify(gs.formatGitLabel({ isRepo: true, branch: '' })) === JSON.stringify({ text: '', title: '' }), 'repo with no branch name is empty');
const slashBranch = { isRepo: true, branch: 'feature/x', detached: false, dirty: 0, capped: false };
check(JSON.stringify(gs.formatGitLabel(slashBranch)) === JSON.stringify({ text: 'feature/x', title: 'On branch feature/x \u2014 clean' }), 'branch with a slash formats');

console.log(`gitstatus.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
