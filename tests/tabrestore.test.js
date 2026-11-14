// Unit tests for tabrestore.js — run: node tests/tabrestore.test.js
'use strict';
const tr = require('../tabrestore.js');

let pass = 0, fail = 0;
function check(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL ' + label); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- buildSession ---
{
  const s = tr.buildSession('chat1', [{ cwd: '/a', shell: '/bin/bash' }, { cwd: '/b', shell: '' }], 1);
  check(s !== null && s.version === 1 && s.chatId === 'chat1', 'buildSession keeps version and chatId');
  check(eq(s.tabs, [{ cwd: '/a', shell: '/bin/bash' }, { cwd: '/b', shell: '' }]), 'buildSession copies tabs');
  check(s.activeTab === 1, 'buildSession keeps a valid activeTab');
  check(typeof s.updated === 'number' && s.updated > 0, 'buildSession stamps updated');
}
check(tr.buildSession('', [], 0) === null, 'buildSession rejects an empty chatId');
check(tr.buildSession(null, [], 0) === null, 'buildSession rejects a null chatId');
check(tr.buildSession('c', [{ cwd: '/a', shell: '/bin/x' }], 5).activeTab === 0, 'buildSession clamps activeTab past the end');
check(tr.buildSession('c', [{ cwd: '/a', shell: '/bin/x' }], -3).activeTab === 0, 'buildSession clamps a negative activeTab');
check(tr.buildSession('c', [], 0).activeTab === 0, 'buildSession with no tabs has activeTab 0');
{
  const many = Array.from({ length: 40 }, (_, i) => ({ cwd: '/d' + i, shell: '/bin/bash' }));
  check(tr.buildSession('c', many, 0).tabs.length === tr.MAX_TABS, 'buildSession caps tabs at MAX_TABS');
}
{
  const tabs = [{ cwd: '/a', shell: '/bin/bash' }, { cwd: '', shell: '' }, { cwd: '/b' }, null, 'x', { cwd: '/c', shell: 42 }];
  const s = tr.buildSession('c', tabs, 0);
  check(eq(s.tabs, [{ cwd: '/a', shell: '/bin/bash' }, { cwd: '/b', shell: '' }]), 'buildSession drops malformed tabs (empty cwd, non-object, wrong shell type) and defaults a missing shell');
}
{
  const src = [{ cwd: '/a', shell: '/bin/bash' }];
  const s = tr.buildSession('c', src, 0);
  src[0].cwd = '/mutated';
  check(s.tabs[0].cwd === '/a', 'buildSession copies tabs defensively');
}
check(tr.buildSession('c', 'not-an-array', 0).tabs.length === 0, 'buildSession treats a non-array tab list as empty');

// --- parseSession ---
{
  const s = tr.parseSession({ version: 1, chatId: 'c1', tabs: [{ cwd: '/a', shell: '/bin/zsh' }], activeTab: 0, updated: 123 });
  check(s !== null && s.chatId === 'c1' && s.updated === 123, 'parseSession accepts a valid object');
  check(eq(s.tabs, [{ cwd: '/a', shell: '/bin/zsh' }]), 'parseSession keeps tabs');
}
{
  const s = tr.parseSession('{"version":1,"chatId":"c2","tabs":[{"cwd":"/x","shell":""}],"activeTab":0,"updated":5}');
  check(s !== null && s.chatId === 'c2' && s.updated === 5, 'parseSession accepts a JSON string');
}
check(tr.parseSession(null) === null, 'parseSession rejects null');
check(tr.parseSession('') === null, 'parseSession rejects an empty string');
check(tr.parseSession('{not json') === null, 'parseSession rejects garbage JSON');
check(tr.parseSession('[]') === null, 'parseSession rejects a JSON array');
check(tr.parseSession(42) === null, 'parseSession rejects a number');
check(tr.parseSession({ version: 2, chatId: 'c', tabs: [], activeTab: 0 }) === null, 'parseSession rejects a future version');
check(tr.parseSession({ version: 0, chatId: 'c', tabs: [], activeTab: 0 }) === null, 'parseSession rejects version 0');
check(tr.parseSession({ chatId: 'c', tabs: [], activeTab: 0 }) === null, 'parseSession rejects a missing version');
check(tr.parseSession({ version: 1, tabs: [], activeTab: 0 }) === null, 'parseSession rejects a missing chatId');
check(tr.parseSession({ version: 1, chatId: '', tabs: [], activeTab: 0 }) === null, 'parseSession rejects an empty chatId');
check(tr.parseSession({ version: 1, chatId: 'c', activeTab: 0 }) === null, 'parseSession rejects a missing tabs array');
check(tr.parseSession({ version: 1, chatId: 'c', tabs: 'x', activeTab: 0 }) === null, 'parseSession rejects a non-array tabs');
{
  const s = tr.parseSession({ version: 1, chatId: 'c', tabs: [{ cwd: '/a', shell: '/bin/bash' }], activeTab: 9, updated: 'nope', extra: 'ignored' });
  check(s !== null && s.activeTab === 0, 'parseSession clamps activeTab and ignores unknown fields');
  check(s.updated === 0, 'parseSession defaults a non-numeric updated to 0');
}
{
  const many = Array.from({ length: 50 }, (_, i) => ({ cwd: '/d' + i, shell: '' }));
  check(tr.parseSession({ version: 1, chatId: 'c', tabs: many, activeTab: 0 }).tabs.length === tr.MAX_TABS, 'parseSession caps tabs at MAX_TABS');
}
{
  const long = 'x'.repeat(tr.MAX_PATH_LEN + 1);
  check(tr.parseSession({ version: 1, chatId: 'c', tabs: [{ cwd: long, shell: '' }], activeTab: 0 }).tabs.length === 0, 'parseSession drops an over-long cwd');
  check(tr.parseSession({ version: 1, chatId: 'c', tabs: [{ cwd: '/a', shell: long }], activeTab: 0 }).tabs.length === 0, 'parseSession drops an over-long shell');
}

// --- sanitizeSession ---
{
  const s = { version: 1, chatId: 'c', tabs: [{ cwd: '/gone', shell: '/bin/bash' }, { cwd: '/here', shell: '' }], activeTab: 1, updated: 1 };
  const out = tr.sanitizeSession(s, { exists: (d) => d === '/here', defaultDir: '/home/test' });
  check(out.tabs[0].cwd === '/home/test', 'sanitizeSession replaces a missing cwd with the default dir');
  check(out.tabs[1].cwd === '/here', 'sanitizeSession keeps an existing cwd');
  check(out.tabs[0].shell === '/bin/bash' && out.activeTab === 1, 'sanitizeSession keeps shells and activeTab');
  check(s.tabs[0].cwd === '/gone', 'sanitizeSession does not mutate the input');
}
check(tr.sanitizeSession(null, {}) === null, 'sanitizeSession passes null through');
{
  const s = { version: 1, chatId: 'c', tabs: [{ cwd: '/a', shell: '' }], activeTab: 0, updated: 0 };
  check(tr.sanitizeSession(s, {}).tabs[0].cwd === '/a', 'sanitizeSession with no exists predicate keeps cwds');
}

// --- barTabs / activeBarIndex ---
{
  const a = { n: 1 }, b = { n: 2, partner: true }, c = { n: 3 };
  const isPartner = (t) => !!t.partner;
  check(eq(tr.barTabs([a, b, c], isPartner).map((t) => t.n), [1, 3]), 'barTabs excludes split partners');
  check(tr.barTabs([a, b, c]).length === 3, 'barTabs with no predicate keeps all tabs');
  check(tr.barTabs(null, isPartner).length === 0, 'barTabs handles null');
  const barTab = (t) => (t.partner ? a : t);
  check(tr.activeBarIndex([a, b, c], c, isPartner, barTab) === 1, 'activeBarIndex finds the active bar tab');
  check(tr.activeBarIndex([a, b, c], b, isPartner, barTab) === 0, 'activeBarIndex maps a focused partner to its primary');
  check(tr.activeBarIndex([a, b, c], null, isPartner, barTab) === -1, 'activeBarIndex returns -1 with no active tab');
  check(tr.activeBarIndex([a, b, c], { n: 99 }, isPartner, barTab) === -1, 'activeBarIndex returns -1 for an unknown tab');
}

console.log(`tabrestore.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
