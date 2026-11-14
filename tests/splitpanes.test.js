// Unit tests for splitpanes.js — run: node tests/splitpanes.test.js
'use strict';
const sp = require('../splitpanes.js');

let pass = 0, fail = 0;
function check(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL ' + label); }
}
const tab = (n, partner, splitPartner) => ({ n, partner: partner || null, splitPartner: !!splitPartner });

// --- isSplit / partnerOf / isPartnerTab ---
const a = tab(1), b = tab(2);
check(sp.isSplit(a) === false, 'standalone tab is not split');
check(sp.partnerOf(a) === null, 'standalone tab has no partner');
check(sp.isPartnerTab(a) === false, 'standalone tab is not a partner tab');
a.partner = b; b.partner = a; b.splitPartner = true;
check(sp.isSplit(a) === true, 'linked tab is split');
check(sp.partnerOf(a) === b, 'partnerOf returns the linked tab');
check(sp.partnerOf(b) === a, 'partnerOf is symmetric');
check(sp.isPartnerTab(b) === true, 'second pane is a partner tab');
check(sp.isPartnerTab(a) === false, 'primary is not a partner tab');
check(sp.isSplit(null) === false, 'null tab is not split');
check(sp.partnerOf(null) === null, 'null tab has no partner');
check(sp.isPartnerTab(null) === false, 'null tab is not a partner tab');
const half = tab(3, tab(4));
check(sp.isSplit(half) === true, 'one-sided link still counts as split');

// --- visibleTabs ---
check(JSON.stringify(sp.visibleTabs([a, b], null)) === '[]', 'no active tab: nothing visible');
check(JSON.stringify(sp.visibleTabs([a, b], a).map((t) => t.n)) === '[1,2]', 'split active primary: both panes visible');
check(JSON.stringify(sp.visibleTabs([a, b], b).map((t) => t.n)) === '[2,1]', 'split active partner: both panes visible, partner first');
const c = tab(3);
check(JSON.stringify(sp.visibleTabs([a, b, c], c).map((t) => t.n)) === '[3]', 'standalone active tab: only it is visible');
check(JSON.stringify(sp.visibleTabs([a, b, c], a).map((t) => t.n)) === '[1,2]', 'split active tab: the unrelated tab stays hidden');

// --- barTab ---
check(sp.barTab(a) === a, 'primary highlights itself');
check(sp.barTab(b) === a, 'partner tab highlights its primary');
check(sp.barTab(c) === c, 'standalone tab highlights itself');
check(sp.barTab(null) === null, 'null bar tab stays null');
const orphan = tab(5, null, true);
check(sp.barTab(orphan) === orphan, 'partner flag without a link highlights itself');

// --- primaryOf ---
check(sp.primaryOf(a) === a, 'primary resolves to itself');
check(sp.primaryOf(b) === a, 'partner resolves to its primary');
check(sp.primaryOf(c) === c, 'standalone tab resolves to itself');
check(sp.primaryOf(null) === null, 'null tab stays null');
check(sp.primaryOf(orphan) === orphan, 'partner flag without a link resolves to itself');

// --- focusAfterClose ---
// Closing one side of a split focuses the survivor.
check(sp.focusAfterClose([b], a, 0) === b, 'closing the primary focuses the partner');
check(sp.focusAfterClose([a], b, 1) === a, 'closing the partner focuses the primary');
// Closing a standalone tab picks the neighbour (next, or last at the end).
const t1 = tab(1), t2 = tab(2), t3 = tab(3);
check(sp.focusAfterClose([t2, t3], t1, 0) === t2, 'closing the first tab focuses the next one');
check(sp.focusAfterClose([t1, t2], t3, 2) === t2, 'closing the last tab focuses the previous one');
check(sp.focusAfterClose([t1, t3], t2, 1) === t3, 'closing a middle tab focuses the next one');
check(sp.focusAfterClose([], t1, 0) === null, 'closing the only tab focuses nothing');
check(sp.focusAfterClose(null, t1, 0) === null, 'no remaining tabs focuses nothing');

console.log(`splitpanes: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
