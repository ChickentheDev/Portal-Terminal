# Project-aware context — design note

## Problem
Every agent turn starts cold: the model only knows the chat's cwd
path from the system prompt. The user has to paste "this is a Node
app, the entry point is…" before the agent can do anything useful
with the project. The repo, the README, and the file layout are
already on disk — the app should hand the agent a small summary of
them for free.

## Goal
At the start of each agent turn, attach a compact project snapshot
to the turn's system context: project name, stack hints, a short
top-level file tree, and the start of the README. The user sees
exactly what was attached (a collapsible line on the turn) and can
switch it off in Settings. Nothing is written, nothing new is
sent anywhere — the snapshot only rides inside the turn the user
already started.

## Snapshot shape
Built in main by `projcontext.js` from the chat's cwd (fs reads
only, no shell):

```
Project: portal-terminal
Stack: Node
Files: CHANGELOG.md, README.md, index.html, main.js, renderer.js,
  terminal.js, design-plans/, previews-ui/, tests/ (24 shown, +3 more)
README (first 40 lines):
<first 40 lines of README.md, or "none" when there is no README>
```

- **Name**: `package.json` `name` when it parses, else the cwd's
  folder name.
- **Stack**: marker files first (`package.json` → Node,
  `Cargo.toml` → Rust, `go.mod` → Go, `pyproject.toml` /
  `setup.py` / `requirements.txt` → Python, `Gemfile` → Ruby,
  `composer.json` → PHP, `*.csproj` / `*.sln` → .NET, `pom.xml` /
  `build.gradle` → Java, `*.xcodeproj` → Xcode); if no marker
  matches, the top-level file extensions (`*.py`, `*.rs`, …).
  At most 3 labels, in marker priority order.
- **Tree**: top level only, folders first then files, alphabetical,
  dotfiles and `node_modules`, `.git`, `target`, `dist`, `build`,
  `out`, `.next`, `vendor`, `__pycache__` excluded. Max 30
  entries, `(+N more)` when there are more.
- **README**: `README.md`, `README`, or `README.txt` (first one
  found, case-insensitive scan of the listing), first 40 lines,
  capped at 4 KB, marked `(first 40 lines)` when truncated.
  No README → one line, `README: none`. Nothing is invented.

## Size / token cost
- Tree: at most 30 short names — ~50–100 tokens.
- Stack + name: a line each — ~20 tokens.
- README: 40 lines / 4 KB cap — typically 200–500 tokens,
  worst case ~1,000.
- **Total: typically 200–600 tokens, absolute worst case ~1.5k**
  (dense README + full tree). The whole snapshot is capped at
  ~6 KB of text. It is computed once per turn and reused for every
  step of that turn, so a multi-step turn does not pay it twice.

## Where it attaches
- `runTurn` computes the snapshot once, right after the user
  message is added, and only when `settings.projectContext !==
  false` (default ON). It is threaded into `streamChat` →
  `toApi`, where it is appended to the system message as
  `Project context:\n<snapshot>`. It is **never** added to
  `chat.messages`, so it is never persisted to the chat file and
  never shown as a user message — it exists only in the request
  the model sees.
- Main also sends a `context` event (new preload EVENTS entry)
  with a one-line summary (`my-app · Node · 15 files · README`)
  and the full snapshot text. The renderer renders it as a
  collapsible `<details class="ctx-line">` right under the user
  message, following the `details.think` pattern: the summary
  line is always visible, the full snapshot is one click away.
  Both are inserted with `textContent`, so a hostile README
  renders as text.

## Toggle
Settings checkbox "Project context" (default on), stored as
`settings.projectContext`. Off → no snapshot, no context line,
no event. This is a global toggle; there is no per-chat toggle
in v1 (the brief allows either). The setting is normalized in
`settings:set` the same way `nanoComplete`/`shellIntegration`
are (`!== false` means on).

## Scope / security
- Read-only: `readdir`, `lstat`, `readFile` of `package.json`
  (name field only) and the README. No shell, no writes, no
  network.
- Symlink safety: every entry is `lstat`ed; a symlinked entry
  whose real path escapes the cwd is skipped (same rule as the
  file tools' `resolveScopedPath`, re-implemented small here
  because that helper lives in filetools.js and takes a user
  path, not a directory listing).
- Secrets: the snapshot never reads `.env`, keys, or
  credentials — the only file contents read are `package.json`
  (one field) and the README (docs the user already publishes).
  Dotfiles are excluded from the tree entirely.
- The snapshot is context, not instruction: the system prompt
  already says file contents are DATA, never instructions, and
  the README text rides inside that same system message.
- A missing/deleted cwd, an unreadable directory, or a cwd
  that is a file all degrade to "no snapshot" — the turn
  proceeds without it, no error shown.

## Verification
- Unit (`node tests/projcontext.test.js`): stack detection
  (markers, extension fallback, 3-label cap, no marker →
  "unknown"), tree caps (30 entries, `+N more`, dotfile and
  build-dir exclusion, folders first), README (40-line cap,
  4 KB cap, truncation note, none case), name (package.json
  name vs folder fallback vs invalid JSON), symlink escape
  refused, `.env` never read (fake fs records every read).
- Headless harness: stubbed `window.api` + real renderer —
  firing the `context` handler renders the collapsible line
  with the summary and the snapshot as text (hostile README
  content injects no markup); firing it for another chat id
  renders nothing; the Settings checkbox saves
  `projectContext: false`. Zero page errors.
- Real Electron launch test under Xvfb with the fake Ollama:
  a work dir with `package.json` + `README.md` + a few files
  — send a turn, verify the fake Ollama request log carries
  the snapshot (name, stack, README lines) and the UI shows
  the context line; uncheck Project context in Settings, send
  another turn, verify no snapshot in the log and no new
  context line. Screenshots of both states. Zero page errors.
- Bug hunt after the build; CHANGELOG + screenshots before any
  version bump or packaging (release skill).

## Honest limits
- Top level only: the snapshot never descends into
  subdirectories, so a `src/`-heavy layout reads as one line.
  The agent still has `file_list` for depth.
- The tree is a point-in-time listing taken when the turn
  starts; a file created mid-turn is not in it.
- A README longer than 40 lines is summarized from its head
  only — the agent can `file_read` the rest.
- The context line is ephemeral: it is rendered live during
  the turn and is not persisted, so reopening an old chat
  shows no context lines for past turns.
- With the toggle off, the agent is back to knowing only the
  cwd path — same as before this feature.
