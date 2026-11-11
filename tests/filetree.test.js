// Unit tests for filetree.js — run: node tests/filetree.test.js
'use strict';
const ft = require('../filetree.js');

let pass = 0, fail = 0;
function check(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL ' + label); }
}
const names = (es) => es.map((e) => e.name);

check(ft.MAX_TREE_ENTRIES === 500, 'cap is 500');

check(JSON.stringify(names(ft.sortTreeEntries([
  { name: 'z.txt', type: 'file' },
  { name: 'src', type: 'dir' },
  { name: 'a.txt', type: 'file' },
  { name: 'lib', type: 'dir' },
]))) === JSON.stringify(['lib', 'src', 'a.txt', 'z.txt']),
  'dirs first, then files, alphabetical within each group');

check(JSON.stringify(names(ft.sortTreeEntries([
  { name: 'banana', type: 'file' },
  { name: 'Apple', type: 'file' },
  { name: 'cherry', type: 'file' },
]))) === JSON.stringify(['Apple', 'banana', 'cherry']),
  'alphabetical is case-insensitive');

check(JSON.stringify(names(ft.sortTreeEntries([
  { name: 'b', type: 'file' },
  { name: 'B', type: 'file' },
]))) === JSON.stringify(['B', 'b']),
  'case-sensitive tiebreak is deterministic');

check(ft.sortTreeEntries(null).length === 0, 'null input sorts to empty');
check(ft.sortTreeEntries([]).length === 0, 'empty input sorts to empty');

check(JSON.stringify(names(ft.sortTreeEntries([
  { name: 'real.txt', type: 'file' },
  { name: 'linkdir', type: 'dir' }, // a symlink mapped to its target type
  { name: 'plain', type: 'dir' },
]))) === JSON.stringify(['linkdir', 'plain', 'real.txt']),
  'a link mapped to dir sorts with the dirs');

check(ft.joinRel('', 'src') === 'src', 'joinRel at root');
check(ft.joinRel('src', 'index.js') === 'src/index.js', 'joinRel below root');
check(ft.joinRel('a/b', 'c') === 'a/b/c', 'joinRel nested');
check(ft.baseName('src/index.js') === 'index.js', 'baseName nested');
check(ft.baseName('README.md') === 'README.md', 'baseName at root');
check(ft.baseName('') === '', 'baseName empty');

console.log(`filetree: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
