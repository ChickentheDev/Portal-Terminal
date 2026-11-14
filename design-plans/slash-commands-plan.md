# Slash commands and snippets — design note

## Problem
The agent can already review a diff, write a commit message, or
explain a failed command — but only if the user types the whole
request and pastes the context by hand. The context (the diff, the
last terminal output) is right there in the app; the user should be
able to fire it with a slash instead of retyping it.

## Goal
Typing `/` at the start of the chat input opens a small popup
listing the available commands (same interaction as the nano
autocomplete: Up/Down to move, Enter/Tab to accept, Esc to dismiss).
Accepting a command expands it into a turn with its context
attached — the agent's normal approval flow still applies to any
command or file change it proposes, so nothing runs silently.

## Built-ins (v1)
- `/review` — review the current uncommitted diff. The prompt asks
  for bugs, risky behavior, and style problems, then a summary of
  what is safe and what needs a second look.
- `/commit-msg` — write a commit message from the diff. The reply
  is text the user can copy; nothing is ever committed automatically.
- `/explain` — explain the last terminal block's output.

## Expansion model
The expansion happens in the renderer before send, and the expanded
text is the user message the chat stores (same as the Ask-AI
precedent, which prefills a fenced block into the input). The message
is the command line, a short instruction, and the context in a
fenced block:

```
/review

Review the current uncommitted changes. Look for bugs, risky
behavior, and style problems, then summarize what is safe and what
needs a second look.

```diff
<diff, capped at 30 KB>
```
```

Expansion happens ONLY through the popup accept. Typing `/review`
and pressing Enter with the popup dismissed sends the literal text
— no silent expansion. A space after the command name closes the
popup (v1 commands take no arguments). Accepting while a turn is
running does nothing and says so in the composer hint.

## The diff (main, `git:diff` IPC)
New IPC `git:diff(chatId)` → `{ ok, isRepo, diff, truncated,
untracked, untrackedTruncated }`. The chat id is the only input;
main reads the cwd from the chat record, so the renderer can never
ask about a directory it does not own. Same `runGit` helper as
`git:status` (execFile, no shell, 5 s timeout, 1 MB output cap).
- `git diff HEAD -- .` — staged + unstaged vs HEAD, scoped to the
  chat's cwd (the repo root may be above it). An unborn HEAD (no
  commits yet) makes `diff HEAD` fail, so fall back to plain
  `git diff` (worktree vs index).
- Untracked files are never in a diff, so the reply also carries
  their names (from `git status --porcelain`, `??` lines only,
  capped at 20 names) and the message notes them as "not shown" —
  a review that silently misses new files is worse than no review.
- Diff capped at `MAX_DIFF_CHARS = 30720` (30 KB), truncated
  middle-out (first half + marker + last half, the files:read
  precedent) with `truncated: true` so the message says so.
- Not a repo → `{ ok: true, isRepo: false }`. A git failure on a
  real repo → `{ ok: false, error }` with a short error (the
  renderer flashes it instead of sending a review of nothing).
- Never attaches secrets or `.git` internals: the diff is the
  worktree diff only, and untracked names are names, never contents.

## No context? Say so, don't send
If the cwd is not a repo, or the diff is empty (and there are no
untracked files), the command does NOT fire a turn. The composer
hint line flashes the reason for ~4 s ("This chat's directory is
not a git repo." / "No uncommitted changes — nothing to review.")
instead. Same for `/explain` with no terminal block yet. No history
pollution, no empty review.

## /explain source (brief left the choice open)
The last terminal block of the FOCUSED pane — the same pane the
blocks rail follows — plus the last 30 lines of that pane's terminal
buffer as its output. Blocks store command + exit code + duration
but no output text, so the output is the buffer tail (the `askAi`
precedent: `bufferTail(tab.term, 30)`). The message names the
command and its exit code so the agent can anchor the tail:

```
/explain

The last terminal command was `$ npm test` (exit code 1). Explain
what happened — what the command did, what the output means, and
what to do next.

```
<last 30 lines of the buffer, capped at 6,000 chars>
```
```

A block still running is explained with "(still running)" and the
output so far. New TermUI hook `_blocks.lastBlockOutput()` returns
`{ command, exitCode, status, output }` or null (no tab / no blocks
yet). The chat input's selected text is NOT a source — the Ask-AI
button already covers selection, and a selection in the input is
usually text being edited, not text to explain.

## Custom snippets (Settings)
`settings.snippets` — an array of `{ name, prompt }` in
settings.json, edited in a "Slash commands" section of the
Settings modal (one row per snippet: name + prompt inputs, delete
per row, Add button; saved with the rest of Settings). Names are
lowercase letters, digits, hyphens (`/^[a-z0-9][a-z0-9-]+$/`,
max 32 chars); prompts are 1–4000 chars. A snippet's prompt may
contain `{diff}` — every occurrence is replaced with the fenced
diff block (same gathering, same cap); a template with `{diff}` and
no diff/not-a-repo is refused with the hint flash, exactly like the
built-ins. A template without `{diff}` is sent as-is. `{output}`
is NOT supported in v1 (documented, not silently ignored — the
literal text stays in the message if typed, so it is visible).
Names colliding with a built-in (`review`, `commit-msg`,
`explain`) are rejected in the UI and dropped by sanitization;
duplicates keep the first. Max 50 snippets.
Main sanitizes on load and on `settings:set` (the ollamahost
precedent): non-arrays, bad shapes, over-long fields, collisions,
and over-cap lists are dropped, never crash the app. The popup
reads `S.settings.snippets` (in-memory settings, refreshed on
Save); built-ins always list first, snippets after, both filtered
by the typed query (substring on name, then on description — a name
match outranks a description-only match, so "com" lists
/commit-msg before /review).

## Popup (renderer.js + styles.css)
One shared div, created in JS and appended to `.composer-box`
(the nanoPopupEl precedent), absolutely positioned above the
textarea (`.composer-box` gains `position: relative`). Rows reuse
the palette's look (`.pal-item` active state, same black-and-white,
same 150 ms press). Opens only when `/` is the first non-space
character of the input; re-filters on every input event; closes on
Esc, on a space after the command name, on send, on chat switch,
and when the input no longer starts with `/`. Up/Down move,
Enter/Tab accept, Esc dismisses, mousedown (not click) on a row
accepts without blurring the input first (nano precedent).
All labels are set with `textContent` — a hostile snippet name or
description can never inject markup.

## Scope / security
Read-only context gathering (one `git diff` + one `git status`,
cwd fixed to the chat's directory, no shell, no writes). The diff
is attached to the user message, so it is stored in the chat file
like any message — capped at 30 KB, never secrets or `.git`
internals. Snippet prompts are user text, stored in settings.json
and rendered as text only. Nothing in this feature runs a command
or edits a file; the agent's approval flow is unchanged.

## Verification
- Unit: prefix parsing (leading `/`, leading spaces, `/` mid-text
  is not a command, empty query lists all), filtering (built-ins
  first, snippets after, substring on name/description, no match),
  snippet validation (good, bad name, built-in collision,
  duplicate, over-long prompt), sanitization (non-array, bad
  shapes, collisions, 50 cap), diff-block formatting (truncation
  marker, untracked footer), message builders (review / commit-msg
  / explain contain the command, the instruction, and the fenced
  context). (`node tests/slashcmds.test.js`)
- Headless harness: stubbed `window.api` + stubbed
  `TermUI._blocks.lastBlockOutput` — `/` opens the popup with the
  3 built-ins + a snippet, typing filters, Enter accepts
  `/commit-msg` and the captured send carries the diff, `/review`
  with an empty diff sends nothing and flashes the hint, `/explain`
  with no block sends nothing, Esc dismisses, a space closes the
  popup, hostile snippet names render as text. Zero page errors.
- Real Electron launch test under Xvfb with the fake Ollama: a
  real git repo as the chat cwd with a dirty file — type `/`,
  screenshot the popup, accept `/commit-msg`, verify the fake
  Ollama request log carries the diff; run a failing command in
  the terminal, `/explain`, verify the turn carries the command
  and its output; a pre-seeded custom snippet round-trips through
  the popup. Screenshots of the popup and a /commit-msg turn.
  Zero page errors.
- Bug hunt after the build; CHANGELOG + screenshots before any
  version bump or packaging (release skill). The hunt found three
  real bugs in `gitDiffFor` (main), all fixed and re-tested:
  (1) on an unborn HEAD the fallback ran only `git diff`
  (unstaged), so a staged-only change was invisible — now the
  fallback runs both `git diff` and `git diff --cached` and joins
  them; (2) a chat whose directory was deleted was reported as
  "not a git repo" — now refused with `ok: false` and the reason;
  (3) the untracked list came from a repo-wide `git status`, so a
  subdir chat named files outside its directory — now scoped with
  `-- .`. Two test-script bugs, not app bugs: the launch test
  snapshotted the request log by byte offset, which misaligns on
  multi-byte characters (now a line count), and a bughunt
  expectation assumed the `/plain` snippet would rank first when
  'plain' is a substring of the name 'explain'.

## Honest limits
- Expansion only happens through the popup accept — typing the
  full command and pressing Enter with the popup dismissed sends
  it literally.
- v1 commands take no arguments; a space after the name closes
  the popup.
- The diff is the chat cwd's uncommitted changes vs HEAD, capped at 30 KB; untracked files
  are named, never shown. With no commits yet (unborn HEAD) the diff is the staged part
  plus the unstaged part — `git diff HEAD` has nothing to diff against, and either half
  alone would miss changes. A bare repository or a chat whose directory was deleted is
  refused with the reason in the hint, not reported as "not a repo". The untracked list
  is scoped to the chat's cwd with the same `-- .` pathspec as the diff, so a subdir chat
  never names files outside its directory.
- `/explain` explains the focused pane's last block and the
  terminal's recent output tail — if later commands have already
  scrolled it, the tail may include newer output.
- Snippets support `{diff}` only in v1; `{output}` and other
  placeholders are not substituted.
- No polling: the popup lists the snippets saved in Settings at
  the time the input was focused; a snippet added in another
  window appears after the next Save.
