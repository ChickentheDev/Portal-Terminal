# Copy last code block — design note

## Problem
The agent's replies are full of commands meant to be run, but
getting one into the terminal means selecting it by hand — drag
across the block, miss the first or last line, re-select. Each
block already has its own Copy button, but that needs the mouse
on the right row. One keybinding should copy the most recent
block the agent produced, from anywhere in the chat view.

## Goal
Ctrl+Shift+C (Cmd+Shift+C on Mac) copies the last fenced code
block the agent produced in the current chat — raw contents, no
fences — and says so in the composer hint. The same action is in
the Commands palette (Ctrl+K) as "Copy last code block", so it is
discoverable without remembering the shortcut.

## The shortcut (renderer, existing document keydown handler)
- `mod && shiftKey && key === 'c'`, where mod is Ctrl or Cmd —
  the same `mod` convention as Ctrl+N / Ctrl+K / Ctrl+,.
- **Why Ctrl+Shift+C:** it is free in the app (nothing binds
  it), it matches the terminal-copy convention, and the handler
  already returns early for events inside `#termpanel`, so the
  terminal's own copy behavior is untouched.
- **Where it fires — chat view only, never while typing:**
  - not inside `#termpanel` (existing guard),
  - not when the event target is an editable — `input, textarea,
    select, [contenteditable]` — so it never fires while the
    user is typing in the composer, the search box, the palette
    input, or a Settings field,
  - not while the palette is open or the Settings modal is open,
  - not when the view is `term` (`document.body.dataset.view`,
    which `applyView` maintains) — the chat is hidden there.
  - Chat and split views both count: in split the messages are
    visible next to the terminal, which is exactly where a paste
    is headed.
- The branch lives in the existing `document` keydown handler in
  renderer.js, after Ctrl+,, and does not touch the existing
  branches. The terminal's own document handler (Ctrl+`, Ctrl+
  Shift+T) is a separate listener and is unaffected.

## What it copies (`copycode.js`, UMD-lite, `window.PortalCopyCode`)
- `findLastCodeBlock(messagesEl)` — `querySelectorAll('.msg.ai
  .cb code')` on the messages element, last one wins, returns
  `{ code, lang }` or null. The language comes from the block's
  `.cb-h span` (the header the markdown renderer writes).
- **Agent messages only.** User messages render as plain text
  (no markdown), so they never contain `.cb` blocks — a fenced
  block the user pasted into the composer, or that `/explain`
  attached, can never be copied by mistake. File-read cards and
  command cards are not `.cb` blocks either. The DOM is the
  source of truth, the same text the per-block Copy button
  copies (`code.textContent`), so what is copied is exactly what
  is on screen — including a block still streaming in (an
  unclosed fence renders as a block while the reply streams).
- The raw contents, fences stripped by the renderer already.
  A block the user edited is out of scope: copy the rendered
  text as-is.

## Feedback (renderer, `copyLastCodeBlock`)
- Success: `copyText(block.code)` (the existing clipboard path,
  `window.api.copy`) then the composer hint flashes
  `Copied <lang> code block: <first 40 chars>` — e.g.
  `Copied bash code block: ls -la ~/Downloads | sort -k5 -n…`.
  The preview is the block flattened to one line, capped at 40
  characters; an empty block says just `Copied <lang> code
  block`.
- No block yet: nothing is copied and the hint flashes
  `No code block to copy.`
- The palette action calls the same function, bypassing the
  keydown guards (the palette input is an editable, so the
  shortcut itself could never fire from there).

## Discoverability
- Palette entry: "Copy last code block", keys label
  `Ctrl+Shift+C`, keywords `code copy clipboard`.
- There is no Settings → Shortcuts listing in the app (only
  per-button `title` attributes like "Settings (Ctrl+,)"), so
  no settings entry was added. The palette label and the
  CHANGELOG entry cover it.

## Scope / security
- No new IPC, no new network: the clipboard path is the
  existing `window.api.copy`, and the query is a read of the
  already-rendered DOM. A hostile code block is copied as text
  only — it is never executed by this feature (pasting it into
  the terminal is the user's own action, and the terminal's
  bracketed paste keeps it from running on its own).
- No settings, no persistence: nothing to configure, nothing
  stored.

## Verification
- Unit (`node tests/copycode.test.js`): `findLastCodeBlock`
  (last of several wins, single block, none → null, missing
  header → empty lang, empty code still returns the block),
  `previewOf` (flattens newlines, 40-char cap with ellipsis,
  empty → ''), `copiedHint` (lang + preview, empty block,
  missing lang → 'text').
- Headless harness: stubbed `window.api` + real renderer —
  a fired `message` event renders a real AI reply with two
  fenced blocks, the shortcut copies the LAST one (stubbed
  clipboard records it), no-block chat flashes the hint,
  the shortcut is refused while the composer is focused and
  while the view is term, the palette lists the action and
  running it copies. Zero page errors.
- Real Electron launch test under Xvfb with the fake Ollama
  (scenario reply with two fenced blocks): the turn renders,
  the shortcut copies the last block (read back via
  `window.api.paste()`), the hint confirms it, the palette
  action copies too. Screenshots of the hint and the palette
  entry. Zero page errors.
- Bug hunt after the build; CHANGELOG + screenshots before any
  version bump or packaging (release skill).

## Honest limits
- Chat and split views only — in terminal view the shortcut
  does nothing, by design.
- It copies the last block in the CURRENT chat only; switching
  chats switches the pool.
- A block still streaming in is copied as it stands at that
  moment — the tail may be incomplete if the reply is still
  generating.
- The hint shows the first 40 characters; a long one-liner is
  truncated in the confirmation, not in the clipboard.
- No per-block choice: if the block you want is not the last
  one, use that block's own Copy button.

## Bug hunt record
- Headless hunt (21/21, zero page errors): no copy while
  Settings is open, while the palette is open, or while the
  search box is focused; Cmd+Shift+C copies; pressing twice
  copies the same block twice; a streaming partial block copies
  as it stands; a user message carrying fences adds no code
  block; switching chats switches the pool (each chat copies
  its own last block).
- Real-app launch hunt (14/14, zero page/console errors):
  split view copies after clicking the messages; terminal view
  copies nothing; Ctrl+Shift+C with the terminal focused does
  not fire the chat copy; the per-block Copy button still works;
  two chats keep their own last blocks across a switch.
- One hunt-script issue was fixed in the script, not the app:
  the first headless run expected a streaming partial block to
  survive an incoming user message, but the incoming message
  clears the transient stream bubble (the normal turn-finalize
  path) — the expectations were corrected to the cleared state.
  No app bugs found.
