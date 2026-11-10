# Portal Terminal — nano autocomplete: audit & implementation plan

Audit-only pass (improve-ui scope): read the code, wrote this plan, changed
nothing in product source. Implementation follows better-ui (exact polish
values) and interface-design (one focal point, token architecture).
Status: plan written 2026-11-09; implementation happens in the same round.

## Audit findings (verified in code, 2026-11-09)

1. **No completion anywhere in the terminal.** `terminal.js` sends every
   keystroke straight to the pty (`term.onData((d) => window.api
   .termWrite(tab.id, d))`, terminal.js:197) and only tracks the typed line
   for the Warp blocks (`trackInput`, terminal.js:300). There is no popup,
   no suggestion list, no word source. The command palette (renderer.js,
   Ctrl+K) is the only suggestion-style UI in the app and lives in the chat
   side, not the terminal.
2. **The interception point already exists.** `term.attachCustomKeyEventHandler
   ((e) => keyHandler(tab, e))` (terminal.js:182) runs before a key reaches
   the pty: return false swallows it. This is how Ctrl+` / Ctrl+Shift+T etc.
   are intercepted. Tab/Enter/arrows/Esc while a popup is open can be
   swallowed here; printable keys must never be touched.
3. **The screen is readable.** `tab.term.buffer.active` with
   `getLine(i).translateToString(true)`, `cursorX`, `cursorY` — the blocks
   code already reads the cursor line (`commandFromBuffer`, terminal.js:325).
   The active buffer is nano's alternate screen while nano runs, so the
   cursor line is the line being edited. No shell integration exists, so
   the typed word must come from the buffer, not from a prompt API.
4. **No file-read IPC exists.** preload.js exposes settings, chats, Ollama,
   clipboard, term create/write/resize/kill — nothing reads a file. The
   open file's words need a new narrow IPC (`file:readText`) in main.js +
   preload.js: path in, capped text out. It is only ever called with the
   file nano was opened with.
5. **The popup has a home and a style model.** `#term-body` is
   `position: relative` (styles.css) and the active `.term-pane` fills it,
   so a popup can be absolutely positioned over the terminal. The command
   palette styles (`.pal-item`, `.pal-item.active`, 150ms named transitions,
   press scale 0.96, hover inside `@media (hover: hover)`) are the model
   to copy. Theme tokens `--bg/--bg2/--bg3/--line/--line2/--fg/--fg2/
   --fg3/--neon-teal` exist per theme; the popup must use them, not
   hard-coded colors.
6. **Settings has a pattern for a toggle.** `DEFAULT_SETTINGS` + validation
   in `settings:set` (main.js) + modal fields + `saveSettings`/
   `openSettings` (renderer.js). A `nanoComplete` boolean (default on)
   follows the same path. terminal.js learns it through `TermUI.init(opts)`
   plus a live setter, the same way fonts do.
7. **nano detection has two independent signals.** The blocks tracker
   already records the submitted command (`tab.current.command`), so
   `nano <file>` is parseable — but a command string alone can't prove
   nano is still in the foreground (user may have exited, or typed `nano`
   in a string). The screen is the confirmation: nano's top bar reads
   "GNU nano" and its bottom lines show the `^G Get Help` help. Require
   both: command parses as nano AND the screen shows nano's UI.

## Implementation plan

### Phase 1 — Detection, word source, file IPC (main.js, preload.js, terminal.js)
- main.js: `DEFAULT_SETTINGS.nanoComplete = true`; `settings:set`
  validates `next.nanoComplete = next.nanoComplete !== false &&
  next.nanoComplete !== 'false'`.
- main.js + preload.js: `file:readText` IPC — takes a path, returns
  `{ ok, text }`; rejects directories, caps at 200 KB, returns
  `{ ok: false }` on any error. Only ever called with nano's target file.
- terminal.js: nano detection — `parseNanoCommand(cmd)` handles
  `nano`, `sudo nano`, flags (`-w`, `-l`, `--`); returns the file arg
  (last non-flag token) or null. `nanoActive(tab)` = parsed command
  exists AND the screen's first line matches `/GNU nano/` (or a bottom
  line contains `^G`). File path resolved against the tab's cwd
  (`T.opts.getCwd()`); unreadable/missing file = screen words only.
- terminal.js: word collection — `collectWords(tab)`: words from the file
  text (if read) + every visible buffer line, deduplicated, counted for
  frequency; keyword list per extension (js/py/c/h/html/css/sh/json/md/rs/
  go, ~20–40 each) tagged `keyword`, file/screen words tagged `word`.
  Ranking: prefix match on the typed word, frequency desc, then
  alphabetical; cap 8 items. `wordBeforeCursor(tab)` reads the cursor
  line up to `cursorX`, matches `/[\w$]+$/`.
- Limits, stated in code + CHANGELOG: suggestions come only from the open
  file + visible screen + keyword lists. No LSP, no whole-project symbols.
  Relative paths resolve against the chat cwd — if the user `cd`'d
  elsewhere, the file read may miss and screen words carry it.

### Phase 2 — Popup UI + keys (terminal.js, styles.css, index.html, renderer.js)
- Popup: a `div.nano-complete` appended to `#term-body`, absolutely
  positioned at the cursor: cell size from the `.xterm-screen` rect
  (`rect.width / term.cols`, `rect.height / term.rows`), left =
  screen-left + cursorX * cellW, top = below the cursor line, flipped
  above when it would overflow the pane, clamped horizontally. Rebuilt
  (not moved) on every refresh so the list always matches the word.
- Trigger: debounced refresh (~40 ms) after `term-data` writes while
  nano is active; word of 2+ chars shows matches; < 2 chars hides.
  Ctrl+Space forces it open even below 2 chars. Paste hides it
  (multi-char `onData` chunk) — the next keystroke re-triggers.
- Keys (in `keyHandler`, only while the popup is open): Tab/Enter accept
  the selected item (swallow; write only the remaining suffix via
  `termWrite` so nano receives it as typed text); Up/Down move selection
  (swallow); Esc closes the popup and IS swallowed while the popup is
  open. CORRECTION (found by the real-nano launch test, 2026-11-09): the
  first draft passed Esc through to nano, but a lone Escape makes nano
  redraw the cursor (the redraw re-triggers the popup, so Esc never
  stuck) AND arms nano's Meta prefix (the next key ran a Meta command —
  `s` toggled soft wrapping instead of typing). Swallowing Esc only
  while the popup is open fixes both; when the popup is closed, Esc
  passes through untouched and Meta shortcuts keep working.
  When closed, all keys pass through untouched — shell Tab completion is
  unaffected because the popup is nano-only. After accept, one refresh
  cycle is suppressed so the popup doesn't instantly reappear for the
  completed word.
- UI: VS Code-style list — word + small kind label (`word`/`keyword`),
  selected row highlighted with the theme accent surface; theme-aware
  tokens only; press 0.96 / 150ms named transitions / hover inside
  `@media (hover: hover)` per better-ui; `overscroll-behavior: contain`.
  Click an item to accept; hide on tab switch, tab close, terminal
  scroll/resize, and when nano exits.
- Settings: checkbox "Nano autocomplete" in the modal (index.html) with a
  one-line hint; wired in `openSettings`/`saveSettings` (renderer.js);
  `TermUI.setNanoComplete(v)` applies it live; off = no popup, no
  interception, no file reads.

### Phase 3 — CHANGELOG + verification
- CHANGELOG.md: new `## Unreleased` section describing the feature and
  its limits. No version bump, no packaging.
- `node --check` on changed JS files.
- Headless Chromium screenshots (stub `window.api` as the 0.2.1 round
  did): popup open over a nano screen, before/after accepting a
  suggestion. Zero page errors.
- Real Electron launch test under Xvfb: open the terminal, run `nano`
  on a real test file (JS, repeated identifiers), type a 2–3 char prefix,
  confirm the popup shows the right suggestions, accept with Tab and
  verify the completed word lands in the buffer (save the file and read
  it back from disk), test Esc dismiss and Ctrl+Space force-open, and
  confirm normal nano keys still work. Screenshots into previews-ui/.
