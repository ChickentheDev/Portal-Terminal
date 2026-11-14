// Tab restore helpers: build, parse, and sanitize the saved session
// state ({ version, chatId, tabs: [{ cwd, shell }], activeTab }).
// Pure Node — no Electron deps, no DOM — so it is unit-testable with
// plain `node tests/tabrestore.test.js`. The renderer reaches these as
// window.PortalTabRestore (loaded as a plain <script> in index.html);
// the preload cannot require() this file — in this Electron build the
// preload's require() resolves only the 'electron' module.
'use strict';

const CURRENT_VERSION = 1;
// A corrupt session file must never spawn an unbounded number of
// terminals: cap the restored tabs, and cap absurd string lengths.
const MAX_TABS = 32;
const MAX_PATH_LEN = 4096;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function clampInt(n, min, max) {
  if (!Number.isInteger(n)) return min;
  return Math.max(min, Math.min(max, n));
}

// Validate one saved tab: { cwd: string, shell: string }. cwd must be
// a non-empty string; shell may be empty (means "default shell").
// Anything else returns null — the tab is dropped, not repaired.
function parseTab(t) {
  if (!isPlainObject(t)) return null;
  if (typeof t.cwd !== 'string' || t.cwd.length === 0 || t.cwd.length > MAX_PATH_LEN) return null;
  // A missing shell means "default shell"; a present but non-string
  // shell is malformed and drops the tab.
  const shell = t.shell === undefined ? '' : t.shell;
  if (typeof shell !== 'string' || shell.length > MAX_PATH_LEN) return null;
  return { cwd: t.cwd, shell };
}

// Build the state object the renderer persists. Inputs are copied
// defensively (the caller keeps mutating its tab list), invalid tabs
// are dropped, and activeTab is clamped into range. Never throws on
// bad input — an unusable chatId yields null, not a corrupt file.
function buildSession(chatId, tabs, activeTab) {
  if (typeof chatId !== 'string' || chatId.length === 0) return null;
  const list = (Array.isArray(tabs) ? tabs : [])
    .map(parseTab)
    .filter((t) => t !== null)
    .slice(0, MAX_TABS);
  return {
    version: CURRENT_VERSION,
    chatId,
    tabs: list,
    activeTab: list.length ? clampInt(activeTab, 0, list.length - 1) : 0,
    updated: Date.now(),
  };
}

// Parse a saved session (already-decoded JSON, or a raw JSON string).
// Returns the validated state, or null for anything missing,
// unparseable, wrong-version, or wrong-shaped. Unknown fields are
// ignored so a future version can add fields. A future version
// returns null (start clean) — migration is a later change, not a
// silent reinterpretation.
function parseSession(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isPlainObject(data)) return null;
  if (data.version !== CURRENT_VERSION) return null;
  if (typeof data.chatId !== 'string' || data.chatId.length === 0) return null;
  if (!Array.isArray(data.tabs)) return null;
  const tabs = data.tabs
    .map(parseTab)
    .filter((t) => t !== null)
    .slice(0, MAX_TABS);
  return {
    version: CURRENT_VERSION,
    chatId: data.chatId,
    tabs,
    activeTab: tabs.length ? clampInt(data.activeTab, 0, tabs.length - 1) : 0,
    updated: typeof data.updated === 'number' ? data.updated : 0,
  };
}

// Resolve tab cwds against the filesystem: a tab whose cwd no longer
// exists opens in defaultDir instead. `exists` is injected so tests
// can pass a fake predicate; main passes fs.existsSync.
function sanitizeSession(state, opts) {
  if (!state) return null;
  const o = opts || {};
  const exists = typeof o.exists === 'function' ? o.exists : () => true;
  const defaultDir = typeof o.defaultDir === 'string' && o.defaultDir ? o.defaultDir : '';
  return {
    ...state,
    tabs: state.tabs.map((t) => ({
      cwd: exists(t.cwd) ? t.cwd : defaultDir,
      shell: t.shell,
    })),
  };
}

// The tabs that belong in the tab bar: split partners are second
// panes, not tabs, and split state deliberately does not persist.
// `isPartner` is injected (terminal.js passes its partner check).
function barTabs(tabs, isPartner) {
  const pred = typeof isPartner === 'function' ? isPartner : () => false;
  return (Array.isArray(tabs) ? tabs : []).filter((t) => !pred(t));
}

// The active tab's index within the bar tabs, or -1 when there is no
// active tab. `barTab` maps a focused partner to its primary (the
// tab the bar highlights); terminal.js passes its barTab helper.
function activeBarIndex(tabs, active, isPartner, barTab) {
  if (!active) return -1;
  const bar = typeof barTab === 'function' ? barTab(active) : active;
  const list = barTabs(tabs, isPartner);
  const i = list.indexOf(bar);
  return i >= 0 ? i : -1;
}

const TabRestore = {
  CURRENT_VERSION,
  MAX_TABS,
  MAX_PATH_LEN,
  buildSession,
  parseSession,
  sanitizeSession,
  barTabs,
  activeBarIndex,
};
if (typeof module !== 'undefined' && module.exports) module.exports = TabRestore;
if (typeof window !== 'undefined') window.PortalTabRestore = TabRestore;
