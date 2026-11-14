# Tab restore — design note

## Problem
Every launch starts from scratch: `init()` calls `startNewChat(true)`,
so the user gets a brand-new empty chat and no terminal tabs, even
though the chat list itself persists as files on disk. The open-tab
state and which chat was active are lost. A crash is no different
from a clean quit — there is nothing to restore from at all.

## Goal
On startup, put the user back where they were: reopen the last
active chat and restore that chat's terminal tabs, each with the same
working directory and shell it had (fresh shells, not resurrected
processes). The state must survive a crash, so it is written on
every change that matters, not only on quit.

## What a tab's cwd is (v1)
A tab's cwd is the directory its shell started in. The app cannot
see a live `cd` inside a tab: the shell integration emits no OSC 7
cwd sequence and the pty stream carries no cwd, so tracking the
shell's current directory would mean instrumenting all three shell
scripts plus the OSC parser. v1 stores the creation cwd per tab. A
tab that `cd`'d elsewhere restores to the directory it started in —
named as a limit below, OSC 7 tracking is the follow-up if Sam
wants it.

## Pure module (`tabrestore.js`, unit-testable, no Electron deps)
UMD-lite like `gitstatus.js` / `splitpanes.js`: `module.exports`
for Node tests and main, `window.PortalTabRestore` from a plain
`<script>` in index.html before renderer.js. The preload CANNOT
require() it.
- `CURRENT_VERSION = 1`.
- `buildSession(chatId, tabs, activeTab)` → `{ version: 1, chatId,
  tabs: [{ cwd, shell }], activeTab, updated }`. Tabs are copied
  defensively; `activeTab` is clamped into range.
- `parseSession(raw)` → the validated state, or `null` for anything
  missing, unparseable, wrong-version, or wrong-shaped. Strict:
  `chatId` must be a non-empty string, `tabs` an array (capped at
  `MAX_TABS = 32`, extra tabs dropped), each tab an object with
  string `cwd`/`shell` (capped at 4096 chars, empty shell allowed
  and means "default"), `activeTab` an integer clamped into range.
  Unknown fields are ignored, so a future version can add fields.
  A future `version > 1` returns null (start clean); migration is
  a later change, not a silent reinterpretation.
- `sanitizeSession(state, { exists, defaultDir })` → a copy of a
  parsed state whose tab cwds exist per `exists(dir)`; a missing
  cwd is replaced with `defaultDir`. Pure apart from the injected
  predicate, so tests pass a fake `exists`.
- `barTabs(tabs, isPartner)` → the tabs that belong in the tab bar
  (split partners excluded — split state deliberately does not
  persist) and `activeBarIndex(tabs, active, isPartner, barTab)`
  → the active tab's index within the bar tabs, or -1.

## Main (`main.js`)
- `sessionFile = path.join(app.getPath('userData'), 'session.json')`,
  next to `settings.json` — NOT in a chat file and NOT in the repo.
- `require('./tabrestore.js')` (main can require local modules).
- `session:get` → read the file, `parseSession`, then
  `sanitizeSession` with `fs.existsSync` and `settings.startDir`
  as the fallback dir. Any failure (missing file, corrupt JSON,
  bad shape) returns `null` — never throws to the renderer.
- `session:set` → `parseSession` the incoming object (rejects
  anything malformed), then write atomically (temp file + rename,
  the filetools precedent) so a crash mid-write cannot leave a
  half-written file.
- `term:create` accepts an optional `opts.shell` (restore passes
  the shell the tab had); it is used only if the file exists, else
  the existing `settings.shell || process.env.SHELL || '/bin/bash'`
  resolution applies. The reply becomes `{ id, shell }` so the
  renderer can record the shell that actually spawned.
- `purgeEmptyChats()` skips the chat named in the session file, so
  startup cannot delete the very chat it is about to restore (an
  empty chat that was active when the app quit).

## Renderer (renderer.js + terminal.js + preload.js)
- Preload adds `getSession: () => inv('session:get')` and
  `saveSession: (s) => inv('session:set', s)`.
- `saveSessionNow()` (renderer) builds the state with
  `PortalTabRestore.buildSession(S.cur.id,
  window.TermUI._session.getTabs(),
  window.TermUI._session.getActiveIndex())` and saves it. Guarded:
  if `window.api.saveSession` is missing (old harness stubs) it
  does nothing, and it skips until `TermUI._session.isReady()` is
  true — `_session` exists from script load, so the flag (set at
  the top of `TermUI.init`) is what stops the startup `openChat`
  from overwriting the saved tabs with an empty list. Called from
  `openChat` (chat switch / new chat) and from a `TermUI.init`
  option `onSessionChange`, which terminal.js calls at the end of
  `newTab`, `closeTab`, `select`, and `splitTab` (a split's
  `newTab` save runs before the partner link exists, so `splitTab`
  saves again once linked). Nothing is saved only on quit: every
  mutation already persisted, so a kill -9 restores exactly.
- `init()` restore flow: after settings load, `session = await
  window.api.getSession()` (guarded like the save). If the session
  is valid AND `window.api.getChat(session.chatId)` returns a chat,
  `openChat(session.chatId)` instead of `startNewChat(true)`; the
  tabs are passed to `TermUI.init` as `initialTabs` /
  `initialActiveTab` and restored INSIDE init, before the saved
  view is applied — `setView` creates a tab when the view is
  term/split and no tabs exist, so restoring after it would leave
  an extra tab behind (and save it). The user lands in the view
  they left (restored from localStorage, pre-existing behavior),
  with their chat open and their tabs back. Otherwise the existing
  `startNewChat(true)` path runs unchanged. A missing/corrupt
  session, a deleted chat, or a failed `getChat` all fall through
  to a clean start — never a crash or a blank window.
- `newTab(cwd, shell, opts)` gains a shell argument and a
  `{ silent }` option. Silent restore tabs skip the
  `applyView('split')` call (the user lands in chat view with
  their chat open; the tabs are there when they switch to the
  terminal) and are not focused. Each tab records `tab.cwd` (the
  cwd requested) and `tab.shell` (from the `term:create` reply).
  A restored tab whose pty fails to spawn is closed immediately
  instead of leaving a dead tab in the bar.
- `window.TermUI._session` (test hook, same precedent as
  `_search` / `_split`): `getTabs()` (bar tabs as
  `[{ cwd, shell }]`), `getActiveIndex()`, `getState()`
  (`{ tabs, activeTab }`), `restoreTabs(tabs, activeIndex)`, and
  `isReady()` (true once `TermUI.init` has started).

## Scope / security
No scrollback, command blocks, split state, or in-flight agent
turn is restored — tabs start fresh, exactly as the brief says.
The session file holds only a chat id, directory paths, and shell
paths; it is written by this app only, validated on every read,
and never executed. A hostile `session.json` can at most make the
app open tabs in directories the user can already open (missing
ones fall back to the start directory) with shells that must exist
on disk.

## Verification
- Unit: `parseSession` (valid, missing, garbage JSON, wrong
  version, wrong shapes, tab cap, activeTab clamping, string caps),
  `buildSession` (defensive copy, clamping), `sanitizeSession`
  (missing cwd → default, existing kept), `barTabs` /
  `activeBarIndex` (partners excluded). (`node tests/tabrestore.test.js`)
- Headless harness: stubbed `window.api` — restore opens the
  saved chat and recreates its tabs silently in chat view with
  the right cwds/shells; corrupt/missing session starts clean;
  a tab close/open/select writes the session via `saveSession`;
  partners are never saved. Zero page errors.
- Real Electron launch test under Xvfb with the fake Ollama:
  open a chat, send one message (so the chat survives the empty
  purge), open two terminal tabs in different cwds, kill -9 the
  app (crash, not clean quit), relaunch with the same profile,
  verify the same chat is active with both tabs back in their
  cwds; then corrupt `session.json` and verify a clean start;
  then a session with a deleted cwd and verify the tab falls back
  to the start directory. Screenshot of the restored session.
  Zero page errors.
- Bug hunt after the build; CHANGELOG + screenshots before any
  version bump or packaging (release skill).

## Honest limits
- A tab restores to the directory its shell started in, not to a
  directory reached by `cd` inside the tab. Live-cwd tracking
  (OSC 7 from the shell integration scripts) is the follow-up.
- Scrollback, command blocks, split panes, and in-flight agent
  turns are not restored; tabs start with a fresh shell.
- The saved shell is restored only if it still exists on disk;
  otherwise the tab starts with the configured default shell.
- If the saved chat was deleted (or its file is gone), the app
  starts clean with a new chat; the tabs are not restored without
  their chat.
