# Split panes — design note

## Problem
One terminal tab shows one shell. Comparing output, running a server
in one pane while curling it in another, or watching logs beside a
shell all mean switching tabs and losing the other screen. Warp does
this with panes inside one tab; Portal has tabs only.

## Goal
A Split button in the terminal tab bar splits the terminal panel into
2 panes side by side (vertical split). Each pane is an independent
terminal with its own pty/shell. Focus follows the clicked pane; the
blocks rail shows the focused pane's blocks. Each pane has a close
button; closing the second pane returns to a single pane, closing the
focused pane moves focus to the remaining one. Max 2 panes in v1.

## Approach: the second pane is a full tab (chosen over a pane object)
The second pane is a **real tab object** — same `newTab()` creation,
own pty (`termCreate`), own xterm + FitAddon + SearchAddon, own nano
state, own blocks, own OSC marker stack — linked to the first tab by
`tab.partner` and hidden from the tab bar (`tab.splitPartner`). The
alternative (a pane object holding terminal fields, with the tab as
pane 1) was rejected: it would need every `tab.term` / `tab.blocks` /
`tab.nano` / `tab.search` call site to learn which pane it means, and
closing pane 1 would need a promotion that copies fields onto the tab
(primitives like `inputBuf` / `shellIntegrated` copy by value and
would silently diverge between the two aliases). The partner-tab
approach reuses the whole per-tab machinery with no changes to pty
routing (main routes `term-data` / `term-osc` / `term-exit` by pty id,
and both tabs are in `T.tabs`), shell integration, search, or nano.
Closing either side is symmetric: the survivor just loses its
`partner` link and becomes a normal tab — no field copying anywhere.

## Focus
xterm owns DOM focus, so a click on a pane focuses that pane's
terminal but would leave `T.active` stale — the rail would keep
showing the other pane's blocks. `newTab()` wires a `focusin`
listener on the pane (xterm 5.5 has **no `term.onFocus` API** — the
typings list only `onData` / `onResize` / `onScroll` /
`onTitleChange`, and a `try { term.onFocus(...) }` fails silently;
`focusin` bubbles from the helper textarea up to the pane), so
focus follows the clicked pane and the rail, search button, Ask AI,
and `sendText` all follow `T.active`. The guard stops re-entry:
`select()` focuses the tab's terminal in a rAF, and an already-focused
textarea does not re-fire `focusin`. Switching focus between panes
closes the shared search bar, exactly like switching tabs (the bar
belongs to one tab at a time); the query is not kept.

## Wiring (terminal.js)
- `renderTabs()`: skips `splitPartner` tabs; the primary gets the
  `active` class when it or its partner is focused
  (`barTab` in `splitpanes.js`).
- `select(tab)`: shows the active tab's pane AND its partner's
  (`visibleTabs`); fits both via `fitActive()`.
- `fitActive()`: fits the active tab and its partner, so a window
  resize re-fits both panes (the old version fit only the active one).
- `closeTab(tab)`: if the closed tab has a partner, the survivor is
  unlinked and focused when it was the focused side
  (`focusAfterClose`); the neighbour logic for standalone tabs is
  unchanged.
- `splitToggle()` / `splitTab(tab)` / `unsplitTab(tab)`: the Split
  button toggles. Splitting creates the partner with `newTab()` (which
  hides the primary and makes the partner active), then links the two,
  unhides the primary, syncs pane classes, and focuses the new pane.
  Unsplitting closes the partner — always the partner, never the
  primary: `unsplitTab` resolves through `primaryOf(tab)` first, so
  clicking Unsplit while the partner pane is focused still keeps the
  primary (the tab in the tab bar) and removes the second pane.
  Closing either pane with its own × keeps that pane's survivor
  instead. Split refuses a dead tab or an already-split tab (max 2).
  New tabs start unsplit; split state is per tab and does not persist
  across restarts (tab restore is a later feature).
- `syncPaneClasses()`: called from `renderTabs()` (which `select`,
  `closeTab`, `newTab`, and title changes all funnel through) — sets
  `split` / `split-left` / `split-right` / `focused` on each pane and
  the Split button's label (Split / Unsplit).
- Each pane gets a `.sp-close` × button, created in `newTab()` and
  shown only while split (CSS). It closes that pane's tab.
- Test hook: `window.TermUI._split` — `split`, `unsplit`,
  `isSplit`, `getState` (split / active tab number / partner number /
  visible pane count), `getActiveTab`, `getPartnerTab`.

## Layout (styles.css)
Panes are absolutely positioned (`inset: 0`) and stacked, so split
geometry is explicit classes, not flex: `.term-pane.split-left`
(`left: 0; width: 50%`) and `.term-pane.split-right`
(`left: 50%; right: 0`, with a `--line` divider on its left edge).
`box-sizing: border-box` is global, so the divider stays inside the
50%. The focused pane gets an inset 1px `--line2` frame — neutral
grey, not teal: teal is reserved for live agent state in this app.
The close button is absolute top-right of the pane, above the xterm
canvas, semi-transparent until hover.

## Pure module (`splitpanes.js`, unit-testable, no Electron deps)
UMD-lite like `termsearch.js` / `filetree.js`: `module.exports` for
Node tests + `window.PortalSplitPanes`, loaded as a plain `<script>`
in index.html before terminal.js. The preload CANNOT require() it.
- `isSplit(tab)`, `partnerOf(tab)`, `isPartnerTab(tab)`
- `visibleTabs(tabs, active)` — panes to show for the focused tab
- `barTab(tab)` — the tab the bar highlights (the primary, when the
  focused tab is a partner)
- `focusAfterClose(tabs, closed, closedIndex)` — survivor on a split
  close, neighbour (next, or last at the end) otherwise, null when
  no tabs remain

## Scope / security
No IPC, no main-process change, no new permissions. A split pane is
a second `termCreate` for the same cwd — the same pty the user could
open as a new tab. No file or chat access changes.

## Verification
- Unit: link/visibility/highlight/focus-after-close rules
  (`node tests/splitpanes.test.js`).
- Headless harness: Split button splits (2 visible panes, partner
  hidden from the bar, primary highlighted), focus follows a pane
  click (rail switches to that pane's blocks), each pane runs its own
  shell (blocks via `_blocks.onOsc` per tab id), search works on the
  focused pane, close second pane returns to one, close focused pane
  moves focus to the survivor, Unsplit button, third split refused.
  Zero page errors.
- Real Electron launch test under Xvfb with the fake Ollama: real
  bash ptys in both panes, different commands per pane, rail follows
  focus, Ctrl+F search on the focused pane, nano popup in a pane,
  screenshots of the split view. Zero page errors.
- Bug hunt after the build; CHANGELOG + screenshots before any
  version bump or packaging (release skill).

## Honest limits
- Max 2 panes, vertical split only — no horizontal split, no drag
  resizing between panes, no moving a pane to its own tab.
- Split state does not persist across restarts; reopening the app
  starts every tab unsplit (tab restore is a later feature).
- The blocks rail shows the focused pane's blocks only; the other
  pane's blocks are one click away, not visible at the same time.
- Switching focus between panes closes the search bar (same as
  switching tabs) and the query is not kept.
- The focused frame is a neutral grey, not the theme accent — teal
  stays reserved for live agent state.
