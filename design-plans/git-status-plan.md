# Git status in the cwd chip — design note

## Problem
The top-bar cwd chip shows where the current chat works, but not
whether that directory is a git repo, which branch it is on, or
whether it has uncommitted changes. Sam has to open a terminal (or
ask the agent) to find out, and an agent edit can leave the tree
dirty without any visible sign.

## Goal
When the chat's cwd is inside a git repo, the chip shows the branch
name plus a dirty indicator; when it is not a repo, the chip stays
exactly as it is today. No new button, no new panel — the chip is
the display.

## Display decision (brief left the form open)
`…/portal-terminal · main ●3` — path, branch, then a filled dot
with the count of changed files when dirty. Clean repo: the branch
alone (`…/portal-terminal · main`) — the branch name itself is the
clean signal, and a clean repo needs no dot. Not a repo: path only,
no separator, no indicator, no error. Detached HEAD: the short
commit hash stands in for the branch (`…/portal-terminal ·
a1b2c3d`), with the full "Detached HEAD at …" in the chip tooltip.
Count caps at `●99+` (100 or more changed files). The tooltip
carries the full sentence: branch, clean, or "N changed files".

Picked over a separate status chip because the top bar is already
crowded (title, cwd, auto, copy, export, commands, view switcher)
and the git state belongs to the directory the chip names.

## IPC surface (main.js, preload.js)
- `git:status(chatId)` → `{ ok: true, isRepo, branch, detached,
  dirty, capped }` or `{ ok: true, isRepo: false }` or
  `{ ok: false, error }` (chat not found only — every git failure
  degrades to "not a repo", silent, never an error card).
  The chat id is the only input; main reads the cwd from the chat
  record, so the renderer can never ask about a directory it does
  not own.
- Main runs `git` with `execFile` (no shell — the cwd is an argv
  element, never interpolated): `symbolic-ref -q --short HEAD` for
  the branch, then `status --porcelain=v1
  --untracked-files=normal` for the changed-file count.
  `symbolic-ref` fails exactly when HEAD is detached, so a failure
  there means detached — main first checks `rev-parse --git-dir`
  to tell a detached HEAD apart from a non-repo (both fail
  `symbolic-ref`), then takes the short hash from `rev-parse
  --short HEAD`. `symbolic-ref` also reports an unborn branch
  (no commits yet) by name, where `rev-parse --abbrev-ref HEAD`
  prints `HEAD` for unborn and detached alike — the bug hunt
  caught that confusion, so the branch never comes from rev-parse.
  `--untracked-files=normal` reports an untracked directory as one
  entry, so an untracked `node_modules` never enumerates thousands
  of files. Each call has a 5 s timeout and a 1 MB output cap; a
  timeout or an over-cap result is a silent no-indicator, not an
  error. A bare repo reports its branch with `dirty: null` (no
  worktree to be dirty in) — the chip shows the branch only.
- A repo with submodules needs no special handling: `git status`
  reports a changed submodule as one porcelain line and does not
  recurse into its contents.

## Pure module (`gitstatus.js`, unit-testable, no Electron deps)
UMD-lite like `models.js` / `filetree.js` / `termsearch.js`:
`module.exports` for Node tests + `window.PortalGitStatus`, loaded
as a plain `<script>` in index.html before renderer.js. The preload
CANNOT require() it (see the model manager note — preload
`require()` resolves only `electron`).
- `countPorcelain(out)` — `{ count, capped }`: counts non-blank
  lines, caps the count at `MAX_DIRTY_COUNT = 100` (`capped` true
  past it). Handles `\n` and `\r\n`.
- `formatGitLabel(status)` — `{ text, title }` for the chip:
  not-a-repo → both empty; clean → branch only, title "On branch X
  — clean"; dirty → `branch ●N` (`●99+` when capped), title "On
  branch X — N changed files"; detached → the hash as the branch
  text, title "Detached HEAD at X …"; `dirty: null` (bare repo) →
  branch only, title "… (status unavailable)".

## Renderer UI (index.html + renderer.js + styles.css)
- Markup: the `#cwd` button gains two spans —
  `<span id="cwd-path">` (the short path, as today) and
  `<span id="cwd-git">` (the git label, empty when not a repo).
  The button is `inline-flex`: the path span truncates with an
  ellipsis (`min-width: 0`) while the git span is `flex: none`,
  so when the top bar squeezes the chip at narrower widths the
  path gives way first and the git label stays fully visible —
  the bug hunt caught the plain-text version clipping the label
  off at 1280px. The button's `max-width` / tooltip behavior is
  unchanged; the tooltip carries the full path plus the git
  sentence.
- `renderHeader()` sets `#cwd-path` as before and calls
  `refreshGitStatus()`, so every existing header render (openChat,
  cwd change via pickCwd or an agent `cd`, title change) refreshes
  the git label for free.
- `refreshGitStatus()` calls `window.api.gitStatus(S.cur.id)` and
  fills `#cwd-git` from `formatGitLabel`. A monotonically
  increasing sequence number discards stale replies: switching
  chats while a slow `git status` is in flight cannot paint the
  old chat's branch onto the new chat's chip. A failed IPC call
  leaves the previous label in place.
- Refresh triggers: `renderHeader` (covers openChat, pickCwd, and
  the agent-cd `meta.cwd` branch), an agent file write/edit
  applying (the `meta.kind === 'file' && meta.status ===
  'applied'` branch, next to `refreshFileTree()`), and the Files
  Refresh button (it refreshes cwd-derived UI; no new button was
  added for this).
- The label is set with `textContent` only — a hostile branch name
  (a branch can contain almost anything except a few characters)
  can never inject markup.

## Scope / security
Read-only: two `git rev-parse` / `git status` invocations, cwd
fixed to the chat's directory, no shell, no writes, no network.
A `git` binary is required; if it is missing, `git status` fails
and the chip shows no indicator. Nothing about the repo (paths,
branch names, file counts) leaves the machine — the label is
rendered locally from main's reply.

## Verification
- Unit: porcelain
  counting (empty, lines, CRLF, over the 100 cap), label
  formatting (clean / dirty / capped / detached / bare /
  not-a-repo) (`node tests/gitstatus.test.js`).
- Headless harness: stubbed `gitStatus` — chip shows branch +
  count on a dirty repo, branch only on a clean repo, nothing on a
  non-repo, detached hash, stale reply after a chat switch is
  discarded, file-applied message refreshes the label, hostile
  branch name escaped. Zero page errors.
- Real Electron launch test under Xvfb with the fake Ollama: three
  real repos on disk (dirty, clean, plain dir) as the chat cwd —
  chip shows `●2` on the dirty one, branch only on the clean one,
  path only on the plain dir; editing a file on disk then hitting
  the Files Refresh button updates a clean chip to dirty.
  Screenshots of the dirty and clean chips. Zero page errors.
- Bug hunt after the build; CHANGELOG + screenshots before any
  version bump or packaging (release skill).

## Honest limits
- The chip shows the status at refresh time — an external change
  (a terminal `git commit`, a `git pull`) only appears after a
  refresh trigger; there is no filesystem watcher and no polling.
- The dirty count is a file count, not a line count, and caps at
  `99+`.
- A repo with no commits yet shows its unborn branch name and the
  untracked files as dirty — correct, if slightly odd-looking.
- `git` must be installed; without it the chip silently shows no
  git label.
- A `git status` that takes longer than 5 s (a very large repo on
  a slow disk) shows no indicator until the next refresh.
