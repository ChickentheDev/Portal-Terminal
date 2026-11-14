# Git helpers — design note

## Problem
The agent already knows git — `/commit-msg` writes a commit message
from the diff, `/review` reviews it — but two nearby jobs have no
home: drafting a CHANGELOG entry from the uncommitted diff, and
summarizing a pull request. Both are "ask the agent, with the right
context attached" jobs, exactly like the slash commands; they just
need their own context gatherers and a place to live.

## Goal
Two new deliberate helpers, both fired by the user, both expanding
into a normal agent turn with context attached. Nothing runs without
the user asking, and nothing writes a file: the changelog draft is
text to copy, the PR summary is text to read.

## Home (brief left the choice open — picked both, one primary)
- **Slash commands (primary)**: `/changelog` joins `/review`,
  `/commit-msg`, `/explain` in the popup. `/pr` joins them too, and
  is the one command that takes an argument — the PR number, typed
  inline (`/pr 12`). The Commands palette gets two matching
  actions ("Draft changelog entry from diff" and "Summarize a
  PR…", keywords `git`), so the helpers are findable from Ctrl+K
  as well. The palette's PR action prefills `/pr ` in the composer
  and focuses it — the number is typed there, where the popup
  already knows how to read it. `/commit-msg` stays exactly where
  it is; it is not rebuilt.
- The palette is a flat action list with no section headers, so
  there is no literal "Git" section — the `git` keyword makes both
  actions findable by typing `git`.

## /changelog (reuses git:diff — no new IPC)
Same gathering as `/commit-msg` (`fetchDiffForCommand`, same
empty/not-a-repo refusals with the hint flash). The message starts
with `/changelog` and asks for a Keep-a-Changelog-style entry —
Added / Changed / Fixed sections, one line per change, no version
header, no date — as text only:

```
/changelog

Draft a CHANGELOG entry for these uncommitted changes, in Keep a Changelog style: Added / Changed / Fixed sections, one line per change, no version header and no date. Reply with only the entry text so I can copy it into CHANGELOG.md.

```diff
<diff, capped at 30 KB>
```
```

The diff block is `PortalSlashCmds.formatDiffBlock` — one source of
truth for the 30 KB cap, the truncation marker, and the untracked
footer (githelpers resolves it from `window.PortalSlashCmds` in the
renderer and `require('./slashcmds.js')` in Node).

## /pr — the argument command
v1 slash commands take no arguments and a space closes the popup;
`/pr` is the exception, and it is handled as a small special case
rather than a rewrite of the popup. `parsePrCommand(text)` (pure,
in githelpers.js) matches `/^\/pr\s+(\d+)\s*$/` on the whole input
(leading spaces allowed, like `parseSlashPrefix`); anything else
is not a PR command. The renderer checks it first in
`slashOnInput`: while the input is `/pr 12`, the popup stays open
with a single item — `/pr`, description "Summarize pull request
#12". Accepting it fetches the PR and sends the turn. Accepting
bare `/pr` (no number) flashes the hint ("Type the PR number:
`/pr 12`.") and sends nothing. `/pr abc` is not a number, so the
popup closes on the space and Enter sends the literal text — same
as any other non-command.

## The PR fetch (main, `git:pr` IPC)
New IPC `git:pr(chatId, number)` → `{ ok, pr }` or `{ ok: false,
error }`. The chat id is the only input; main reads the cwd from
the chat record and the repo from that cwd, so the renderer can
never ask about a directory it does not own. All reads are
execFile/fetch, no shell, scoped to the chat's cwd.
- Number: integer 1–999999, else refused with the reason.
- Not a repo → refused with the reason (same as git:diff).
- **`gh` CLI if present**: `gh pr view <n> --json
  title,body,state,author,baseRefName,headRefName,additions,deletions`
  then `gh pr diff <n>`, both with `cwd` set to the chat's cwd so
  `gh` resolves the repo itself. A `gh` that exists but fails
  reports its own error (usually "not logged in" — the fix is
  `gh auth login`); the API is not silently tried behind it.
- **Else the GitHub API**: owner/repo parsed from `git remote
  get-url origin` (ssh `git@github.com:owner/repo.git` and https
  forms; anything else → "no GitHub remote"). Unauthenticated
  `GET https://api.github.com/repos/{owner}/{repo}/pulls/{n}`
  (JSON) and the same URL with `Accept:
  application/vnd.github.diff` (raw diff). No token is sent
  anywhere — the app holds no GitHub token, and none is invented.
  A 404 reads as "not found, or private" with the `gh` hint; a
  403 rate-limit says so. 15 s timeout each, diff capped at 30 KB
  in the message builder.
- The reply carries title, body (capped at 4 KB, head-truncated
  with a note), state, author login, base/head branch names,
  additions/deletions, and the diff. The message starts with
  `/pr 12` so chat history and search stay consistent with the
  other commands:

```
/pr 12

Summarize pull request #12 "Add split panes" by @ChickentheDev (open, main ← split-panes). The title, description, and diff are below.

Summarize what it changes and what to watch for in review — risky areas, missing tests, anything that looks wrong. Keep it tight.

Title: Add split panes
Description:
<body, capped at 4 KB>

```diff
<diff, capped at 30 KB>
```
```

## Scope / security
- Read-only context gathering (one `git diff` or one `gh`/
  API read; no shell, no writes). The changelog draft never
  touches CHANGELOG.md; the PR summary never posts, comments, or
  approves anything.
- The PR fetch sends no credentials anywhere. `gh` uses its own
  auth when present; the API fallback is unauthenticated, so it
  only works for public repos — private PRs say so and point at
  `gh auth login`.
- The diff/body caps are the same as the slash commands (30 KB /
  4 KB). A hostile PR title/body renders as text only, like every
  other message.
- Nothing in this feature runs a command or edits a file; the
  agent's approval flow is unchanged.

## Verification
- Unit: `parsePrCommand` (digits, no number, non-digits,
  leading spaces, mid-text slash, huge number), message builders
  (changelog prompt + fenced diff + untracked footer; PR message
  with title/body/state/author/branches, body truncation note,
  diff cap, missing-field shapes), remote URL parsing (ssh/https/
  non-GitHub/no-remote), `gh` JSON parsing (author object,
  missing fields).
  (`node tests/githelpers.test.js`)
- Headless harness: stubbed `window.api` + real renderer slash
  code — `/` lists `/changelog` and `/pr` among the built-ins,
  `/pr 12` keeps the popup open with "#12", accepting it sends a
  turn carrying the PR title/diff, accepting bare `/pr` flashes
  the hint and sends nothing, `/changelog` with an empty diff
  sends nothing, hostile PR title renders as text. Zero page
  errors.
- Real Electron launch test under Xvfb with the fake Ollama: a
  real git repo as the chat cwd with a dirty file — accept
  `/changelog`, verify the turn carries the diff and the
  "CHANGELOG entry" instruction; accept `/pr 12` with a fake
  `gh` on PATH returning scripted JSON + diff, verify the turn
  carries the PR title and diff (do NOT hit the real GitHub API
  from the test); screenshots of the changelog draft turn and the
  PR summary turn. Zero page errors.
- Bug hunt after the build; CHANGELOG + screenshots before any
  version bump or packaging (release skill). The headless hunt
  (16/16) and the real-app launch hunt (13/13) both passed with
  zero page/console errors. They found two real bugs in the app,
  both fixed and re-tested:
  (1) a top-level `let SlashCmds` in githelpers.js collided with
  the `const SlashCmds` in slashcmds.js — classic scripts share
  the global lexical scope, so the whole githelpers.js script
  failed to load with a SyntaxError and `/changelog` silently did
  nothing (found by the harness, not the hunt — the debug run
  showed `PortalGitHelpers: undefined`). Renamed to
  `SlashCmdsRef`. (2) a mid-fetch race in `slashAccept`: the
  expanders await a fetch, and a turn started in that window was
  STOPPED by `sendMessage` when the late turn landed — for `/pr`
  the window is seconds (network), not milliseconds (local git).
  `slashAccept` now re-checks `isRunning()` after the await and
  drops the text with the hint instead; the headless hunt proves
  it with a held turn. A third fix from the screenshots: the
  "Fetching pull request #…" hint outlived the fetch by up to 4 s,
  so a successful fetch now resets the hint to the default. The
  launch hunt also proved the three hostile-`gh` cases refuse
  cleanly (failing `pr diff`, garbage `pr view` JSON, no `gh` and
  no remote) and that a working `gh` still sends after them.

## Honest limits
- `/changelog` drafts text to copy — it never writes
  CHANGELOG.md, and the agent's entry still needs a human eye
  before pasting.
- `/pr` needs a number; bare `/pr` does nothing but flash the
  hint. The popup's space-closes rule still applies to every
  other command — `/pr` is the only one that keeps the popup
  open past a space, and only while digits follow.
- The API fallback is unauthenticated: public repos only, 60
  requests/hour. Private PRs need `gh auth login`.
- A PR fetch can take up to ~15 s on a slow network; the turn
  waits for the fetch before sending (the composer hint says the
  fetch is running).
- The PR body is head-truncated at 4 KB; a very long description
  is summarized from its first 4 KB only.
