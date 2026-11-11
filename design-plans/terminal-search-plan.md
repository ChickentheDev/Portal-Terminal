# Terminal search — design note

## Problem
The terminal has 5,000 lines of scrollback and no way to find anything
in it. The user has to eyeball output or re-run a command piped to
grep. Every real terminal has Ctrl+F.

## Goal
Ctrl+F (Cmd+F on Mac) when the terminal is focused opens a search bar
in the terminal panel; typing finds matches across the full scrollback
of the active tab, with highlight-all, next/previous, and a match
count. A search button in the terminal tab bar does the same thing for
discoverability. Esc closes the bar and returns focus to the terminal.

## Addon choice
`@xterm/addon-search` 0.16.0 — the standard xterm.js search addon, the
same major line as the installed `@xterm/xterm` 5.5.0. Loaded as a
plain `<script>` in index.html after addon-fit, global
`SearchAddon.SearchAddon` (same UMD pattern as FitAddon). One
SearchAddon instance per tab, created in `newTab()`; the missing-library
guard already in `newTab()` now also requires `SearchAddon`.

Why the addon instead of hand-rolling: it owns the hard parts —
wrapped-line matches, decorations on the canvas, and the
`onDidChangeResults` event that reports `{ resultIndex, resultCount }`
(the match count, with no buffer scanning of our own). The renderer
only wires keys, the bar, and the count label. Note: decorations and
`onDidChangeResults` are proposed APIs — the `Terminal` constructor in
`newTab()` sets `allowProposedApi: true`, and `findNext` with
decorations throws without it (found in the headless harness).

## Search behavior
- Plain text, case-insensitive (`caseSensitive: false`, `regex: false`,
  `wholeWord: false`). A query containing regex characters (`(`, `[`,
  `*`…) is literal text and never throws — the addon is never put in
  regex mode, so there is nothing to escape.
- Typing runs `findNext` with `incremental: true`: the current match
  stays put while it still matches the longer query, otherwise the
  search continues from the current position and wraps. Enter goes to
  the next match (`incremental: false`), Shift+Enter to the previous.
- Highlight-all via `decorations` passed on every find call, so the
  colors follow the current theme (see `termsearch.js`).
- Count label comes from `onDidChangeResults` on the tab's addon:
  `N of M` (resultIndex is 0-based), `No results` when the count is
  0. The addon caps its highlight results at 1,000, so past that the
  count reads `N of 1000` (verified: 1,201 matches -> "1 of 1000").
  `formatSearchCount` also maps resultIndex -1 (the addon's signal
  that the active match is beyond the highlight limit) to
  `M+ matches`; that path is unit-tested, but normal stepping within
  the first 1,000 matches reports a plain index. A find call that
  returns false sets `No results` directly and clears decorations,
  in case the event does not fire for a zero-match search.
- Empty query clears decorations and blanks the count; it never runs
  a search.

## UI (index.html + terminal.js + styles.css)
- Markup: a `#term-search-btn` in `#term-head` (after `#term-new`,
  magnifier glyph, `title` "Search terminal (Ctrl+F)"), and a
  `#term-search` bar inside `#term-body` — absolutely positioned
  top-right, following the `.nano-complete` overlay style (bg2,
  line2 border, radius 10, shadow). Input + count span + prev/next
  buttons (↑/↓) + close (×).
- The bar is ONE shared element (like the nano popup), owned by the
  tab it was opened on (`T.search.tab`). Buttons use mousedown +
  preventDefault so clicking them never blurs the input.
- Input keydown: Enter → next, Shift+Enter → previous, Esc → close.
  Input blur → `clearActiveDecoration()` (the addon's own pattern:
  the active decoration sits on top of the selection, and clearing it
  on blur reveals the match selection underneath).
- `searchClose()`: hides the bar, `clearDecorations()` on the owning
  tab, focuses that tab's terminal (unless the tab is dead).
- Ctrl+F is intercepted in `keyHandler` (return false so the key never
  reaches the pty — the shell's forward-char never fires while the bar
  is the point). Opening search also hides the nano popup, so the two
  overlays never stack.

## Per-tab (brief left the details open — simplest correct behavior)
- Each tab has its own SearchAddon, so matches/decorations never leak
  across tabs.
- The bar itself is shared: switching tabs closes it and clears the
  old tab's decorations (`select()` calls `searchClose()` when the bar
  is open). The query is not preserved across a tab switch — the user
  reopens search in the new tab. Closing a tab closes the bar if it
  belonged to that tab. This is the reset-on-switch behavior the brief
  allows, and it is stated here so it is a decision, not an accident.

## Pure module (`termsearch.js`, unit-testable, no Electron deps)
UMD-lite like `models.js` / `filetree.js`: `module.exports` for Node
tests + `window.PortalTermSearch`, loaded as a plain `<script>` in
index.html before terminal.js. The preload CANNOT require() it (see
the model manager note — preload `require()` resolves only
`electron`).
- `formatSearchCount(resultIndex, resultCount, hasQuery)` — `''`
  with no query, `No results` at 0, `M+ matches` when the index is
  -1, otherwise `N of M` (1-based).
- `searchDecorations(theme)` — decoration colors per theme, all
  `#RRGGBB` as the addon requires: a muted match background and the
  theme's accent for the active match (teal on dark/light, amber on
  warp-dark, purple on dracula, frost on nord, cyan on
  solarized-dark, blue on one-dark). Unknown theme falls back to the
  dark set. Overview-ruler colors equal the match/active backgrounds.
- `searchOptions(theme, incremental)` — the exact options object
  passed to `findNext`/`findPrevious`: case-insensitive, no regex,
  no whole word, decorations for the theme.

## Test hook
`window.TermUI._search` (same pattern as `_nano` / `_blocks`):
`open`, `close`, `run`, `getState` (open tab + query + last
resultIndex/resultCount), `decorationsFor`, `formatSearchCount`.
The headless harness and launch test drive the bar through it and the
DOM.

## Scope / security
No IPC, no main-process change, no new permissions. Search is
read-only on the terminal buffer: it never writes to the pty and
never touches the chat or the file tools. The query is plain text —
no regex injection, no markup (the count label is set with
textContent).

## Verification
- Unit: count formatting (empty / 0 / N of M / over-limit), decoration
  colors valid hex for every theme + unknown-theme fallback, options
  object shape (`node tests/termsearch.test.js`).
- Headless harness: open via button and via Ctrl+F, type to find,
  count label, Enter next / Shift+Enter previous, no-match state,
  regex characters literal, empty query clears, Esc closes and
  refocuses the terminal, tab switch closes the bar, second tab's
  search is independent. Zero page errors.
- Real Electron launch test under Xvfb with the fake Ollama: real
  shell output in the buffer, search finds across scrollback (not
  just the visible screen), next/previous wrap, screenshots of the
  bar with matches and the no-match state. Zero page errors.
- Bug hunt after the build; CHANGELOG + screenshots before any
  version bump or packaging (release skill).

## Honest limits
- The count comes from the addon and is capped at its 1,000
  highlight limit — past that the label reads `N of 1000` (verified:
  1,201 matches -> "1 of 1000"); `M+ matches` appears only if the
  active match steps beyond the highlight limit (resultIndex -1).
  Next/previous still step through matches past the limit.
- The count can go stale while new output arrives: it refreshes on
  the next search action, not on output. Re-running the search on
  every line of output would steal the selection while typing.
- Case-insensitive, plain-text only in v1 — no regex, no whole-word,
  no case-sensitive toggle.
- The bar closes on tab switch and the query is not kept.
- Search covers the terminal buffer (5,000 lines of scrollback); it
  does not search the chat or command blocks.
