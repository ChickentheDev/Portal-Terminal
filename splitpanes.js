// Split-pane bookkeeping: which tabs are visible, which tab the bar
// highlights, and which tab takes focus when one closes. Pure Node —
// no Electron deps, no DOM — so it is unit-testable with plain
// `node tests/splitpanes.test.js`. The renderer reaches these as
// `window.PortalSplitPanes` (plain <script> in index.html); the
// preload CANNOT require() local modules in this Electron build.
'use strict';

// A tab is split when it is linked to a partner tab (its second pane).
function isSplit(tab) {
  return !!(tab && tab.partner);
}

// The other side of a split, or null when the tab is standalone.
function partnerOf(tab) {
  return (tab && tab.partner) || null;
}

// True for the second pane: it is hidden from the tab bar, and its
// primary takes the bar highlight while it is focused.
function isPartnerTab(tab) {
  return !!(tab && tab.splitPartner);
}

// Tabs whose panes are visible: the active tab and its partner, if any.
// Every other tab's pane stays hidden.
function visibleTabs(tabs, active) {
  if (!active) return [];
  const out = [active];
  if (active.partner) out.push(active.partner);
  return out;
}

// The tab the tab bar highlights for the focused tab: a partner tab is
// hidden from the bar, so its primary takes the highlight.
function barTab(tab) {
  return (tab && tab.splitPartner && tab.partner) ? tab.partner : tab;
}

// Which tab takes focus after `closed` is closed. `tabs` is the list
// AFTER removal, in order, and `closedIndex` is where the closed tab
// sat. Closing one side of a split focuses the survivor; otherwise
// the neighbour the old tab-close logic picked (next tab, or the last
// one when the closed tab was at the end), or null when no tabs remain.
function focusAfterClose(tabs, closed, closedIndex) {
  if (closed && closed.partner) return closed.partner;
  if (!tabs || !tabs.length) return null;
  return tabs[Math.min(closedIndex, tabs.length - 1)];
}

// The primary side of a split: the tab in the tab bar. A partner tab
// resolves to its primary; a primary or standalone tab resolves to
// itself; null stays null. Unsplit always removes the partner pane,
// so it resolves through here first — closing tab.partner blindly
// would close the primary when the partner pane is focused.
function primaryOf(tab) {
  return (tab && tab.splitPartner && tab.partner) ? tab.partner : (tab || null);
}

const SplitPanes = { isSplit, partnerOf, isPartnerTab, primaryOf, visibleTabs, barTab, focusAfterClose };
if (typeof module !== 'undefined' && module.exports) module.exports = SplitPanes;
if (typeof window !== 'undefined') window.PortalSplitPanes = SplitPanes;
