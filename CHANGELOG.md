# Changelog

## [0.3.9] - 2026-11-13

### Copy last code block
Ctrl+Shift+C (Cmd+Shift+C on Mac) now copies the last fenced code block the agent produced in the current chat — raw contents, no fences — so you can paste it into the terminal without selecting it by hand. The composer hint confirms what was copied ("Copied python code block: print("hello")"), and with no block yet it flashes "No code block to copy." instead of copying nothing. The same action is in the Commands palette (Ctrl+K) as "Copy last code block". The shortcut fires in the chat and split views only, never while you are typing in the composer, the search box, the palette, or a Settings field, and never in terminal view or with the terminal focused — the terminal's own Ctrl+Shift+C is untouched. Only agent messages count: a fenced block you pasted into the composer can never be copied by mistake.
Limits, stated plainly: it copies the last block in the current chat only, so switching chats switches the pool; a block still streaming in is copied as it stands at that moment, so the tail may be incomplete if the reply is still generating; the hint shows the first 40 characters, truncated in the confirmation but not in the clipboard; there is no per-block choice — if the block you want is not the last one, use that block's own Copy button.

### Model fallback chain
When the agent's model fails a turn, the app now retries with the next model in a fallback chain instead of dying on the error. The chain lives in Settings → Models ("Fall back to another model if the agent model fails", on by default): by default it is every other installed model, smallest first — when a big model fails it is usually out of memory, so a smaller model is the most likely to load — and you can check, uncheck, and reorder the list there. A failure that is worth retrying is a model error: the model crashing mid-generation (Ollama 500, like the "unexpected EOF" that killed hermes3:8b in the sandbox), a 404 for a missing model, or a 502/503. Ollama being unreachable, a user stop, or a denied tool call never trigger a fallback. When it happens you see a line in the chat — "hermes3:8b failed (Ollama returned 500) — retrying with hermes3:3b" — and the sidebar shows which model actually answered ("hermes3:3b (fallback)") until the configured model answers a turn again or you change it. The retry continues the turn from the last step, never from scratch: if a tool already ran, its result is in the history and the fallback model does not re-run it. If every model in the chain fails, the error names every model that was tried. The configured agent model never changes.
Limits, stated plainly: with one model installed, or the toggle off, a failure behaves exactly as before; the chain is tried in order with no timing budget, so a slow model that eventually fails costs its full generation time before the next model is tried; a turn that died mid-sentence restarts that step's wording from scratch on the fallback model; the sidebar chip shows the model that answered the most recent turn and does not reset until the next turn completes; a model pulled while Settings is open does not appear in the fallback list until the modal is reopened.

### Project-aware context
At the start of every agent turn, the app now tells the model about the project it is working in: the project name (from `package.json`, else the folder name), stack hints (Node, Rust, Go, Python, … from marker files or file extensions), a top-level file list (folders first, max 30 entries), and the first 40 lines of the README when there is one. The snapshot rides in the turn's system message — never persisted to the chat file — and the user sees exactly what was attached as a collapsible "Project context" line under their message. A Settings checkbox ("Project context", on by default) turns it off entirely; off means no snapshot and no line. The snapshot is read-only and cwd-scoped: symlinked entries that escape the working directory are skipped, dotfiles and build directories are never listed, and only `package.json` (the name field) and the README are ever read — secrets are never included.
Limits, stated plainly: the tree is top level only, so a `src/`-heavy layout reads as one line (the agent still has `file_list` for depth); the snapshot is a point-in-time listing taken when the turn starts, so a file created mid-turn is not in it; a README longer than 40 lines is summarized from its head only; the context line is ephemeral and is not shown again when an old chat is reopened; typically 200–600 tokens per turn, worst case ~1.5k with a dense README.

### Git helpers
Two new deliberate helpers that turn the agent's git knowledge into one-click actions, both firing a normal agent turn with context attached — nothing runs or writes without the user asking. `/changelog` drafts a Keep-a-Changelog-style entry (Added / Changed / Fixed, one line per change, no version header or date) from the current uncommitted diff, as text to copy — it never writes CHANGELOG.md. `/pr 12` fetches a pull request (title, description, diff) and asks the agent to summarize what it changes and what to watch for in review; the number is typed inline, and the popup stays open while digits follow. The PR fetch uses the `gh` CLI when it is installed (its own auth), else the public GitHub API with no token — so the API path only works for public repos, and private PRs say so and point at `gh auth login`. Both also live in the Commands palette (Ctrl+K, type `git`): "Draft changelog entry from diff" and "Summarize a PR…" (which prefills `/pr ` in the composer). `/commit-msg` is unchanged.
Limits, stated plainly: `/changelog` drafts text to copy and still needs a human eye before pasting; `/pr` needs a number — bare `/pr` does nothing but flash the hint; the popup's space-closes rule still applies to every other command — `/pr` is the only one that keeps the popup open past a space, and only while digits follow; the API fallback is unauthenticated (public repos only, 60 requests/hour); a PR fetch can take up to ~15 s on a slow network and the turn waits for it; the PR body is head-truncated at 4 KB.

### Command explainer/fixer
A failed command block in the blocks rail now has an Explain button next to Copy and Rerun. One click sends that block's command, its exit code, and the last ~4 KB of its terminal output to the agent, asking it to diagnose the error first and then propose a corrected command by calling `run_command` — so the fix lands in the existing approval card (Run / Deny / Always run) and never runs on its own. The message starts with `/explain`, the same first line the `/explain` slash command sends, and it says so when the output was cut. Clicking Explain while a turn is running is refused with the composer hint instead of interrupting the turn, and after sending the app switches to split view so the diagnosis streams visibly next to the terminal.
Limits, stated plainly: the button appears only on blocks with a non-zero exit code — tracker-fallback blocks (no exit code) and cancelled blocks get none; the output tail is the last 30 lines of the focused pane's buffer, capped at 4 KB; if the agent replies with a diagnosis and no `run_command` call, no approval card appears and nothing is offered to run; the recorded command for a compound command typed slowly is the first simple command (the 0.3.0 anchor that refines it to the full line lives only 200 ms after the prompt), but it is never a truncated fragment.

### Slash commands and snippets
Type `/` in the chat box and a small popup lists the commands you can fire: `/review` asks the agent to review the current uncommitted diff, `/commit-msg` asks it to write a commit message from the diff (the message comes back as text — nothing is committed for you), and `/explain` asks it to explain the last terminal command and its output. You can also add your own commands in Settings — a name plus a prompt template, stored in settings.json — and they show up in the same popup; a template can include `{diff}` to attach the current diff. A command expands into a normal turn with its context attached; nothing runs or changes without the agent's usual approval. The diff is gathered in the main process, scoped to the chat's working directory, capped at 30 KB (the message says so when it is cut), and untracked files are named, never shown. When there is nothing to attach — a clean repo, a directory that is not a repo, no terminal command yet — the command does not fire and the reason flashes under the input instead.
Limits, stated plainly: expansion happens only through the popup accept — typing the full command and pressing Enter with the popup dismissed sends it literally; v1 commands take no arguments, so a space after the name closes the popup; `/explain` uses the focused pane's last block plus the last 30 lines of that pane's terminal buffer; snippets support `{diff}` only in v1; a bare repository or a deleted working directory is refused with a reason instead of sending an empty review.

### Tab restore
Restarting Portal now puts you back where you were: the last active
chat reopens, and its terminal tabs come back, each with the same
working directory and shell it had (fresh shells, not resurrected
processes). The state is written on every change that matters — tab
open/close, tab switch, chat switch — not only on quit, so the app
survives a crash and still restores. A missing or corrupt session
file starts clean with a new chat, never a crash or a blank window;
a tab whose directory was deleted opens in the start directory
instead, and a tab whose shell is gone starts with the default
shell. Split panes are deliberately not restored, and neither are
scrollback, command blocks, or an in-flight agent turn — tabs start
fresh.
Limits, stated plainly: a tab restores to the directory its shell
started in, not to a directory reached by `cd` inside the tab; the
saved shell is restored only if it still exists on disk; if the
saved chat was deleted, the app starts clean and the tabs are not
restored without their chat.

### Remote Ollama host
The Ollama address field in Settings now really works for a server
on another machine: enter a bare host or IP (`192.168.1.10`), a
hostname, or a full URL, and status, the model list, pulls, deletes,
and the agent's chat requests all go to that host. A bare address
gains `http://` and the default port 11434, so `192.168.1.10` means
`http://192.168.1.10:11434`; an explicit port is always kept, and a
path on the address is dropped. The field applies live when you
leave it — the model list below refreshes to the new host's models
in place — and an invalid address is refused with an inline error
instead of being saved. A host that doesn't answer says so by name
("Can't reach Ollama at http://192.168.1.10:11434 — check the
address and that Ollama is running there") instead of telling you
to run `ollama serve`, which is the wrong advice for another
machine; the sidebar status tooltip is host-aware the same way.
"Start Ollama automatically" is disabled while the address is
remote (it only ever worked locally) and re-enables for a local
host. The default stays `http://127.0.0.1:11434`, and an existing
local setup behaves exactly as before.
Limits, stated plainly: no auth or token support — the remote
Ollama must allow unauthenticated requests; a pull already in
flight keeps streaming from the host it started against if you
change hosts mid-pull; the model list shows the host at refresh
time; HTTPS to a host with a self-signed certificate fails and
reads as offline; a LAN IP that happens to be this machine still
counts as remote.

### Git status in the cwd chip
When the current chat's working directory is inside a git repo, the
cwd chip in the top bar shows the branch name after the path, plus a
filled dot with the count of changed files when dirty (`…/my-app ·
main ●3`). A clean repo shows the branch alone, and a directory that
isn't a repo shows no indicator at all — the chip stays exactly as it
was. Detached HEAD shows the short commit hash instead of a branch
name, and the tooltip always carries the full sentence ("On branch
main — 3 changed files", "Detached HEAD at …", "… — clean"). Status
refreshes when the working directory changes, when you switch chats,
when an agent file write or edit applies, and from the Files Refresh
button. The chip is inline-flex with the path truncating first, so at
narrower widths the git label stays visible while the path gives way.
Limits, stated plainly: the chip shows the status at refresh time —
an external change (a terminal `git commit`, a `git pull`) only
appears after a refresh trigger, there is no watcher or polling; the
dirty count is a file count, not a line count, and caps at `99+`; a
repo with no commits yet shows its unborn branch name with untracked
files as dirty; `git` must be installed, without it the chip
silently shows no git label; a `git status` taking longer than 5 s
shows no indicator until the next refresh.

### Split panes
The terminal tab bar has a Split button that splits the current tab
into two panes side by side. Each pane is an independent terminal
with its own shell — run a server in one while curling it in the
other, or watch logs beside a shell. Focus follows the clicked pane
(the focused pane gets a frame), and the blocks rail, terminal
search, nano autocomplete, and Ask AI all follow the focused pane.
Each pane has a × button to close it; Unsplit always removes the
second pane and keeps the primary tab, whichever side is focused.
A pane whose shell exits cleanly auto-unsplits; a pane whose shell
exits with an error stays put with the exit message until you close
it, and a dead tab refuses to split. New tabs start unsplit.
Limits, stated plainly: max 2 panes, vertical split only — no
horizontal split, no drag resizing between panes, no moving a pane
to its own tab; split state does not persist across restarts;
the blocks rail shows the focused pane's blocks only; switching
focus between panes closes the search bar (same as switching tabs)
and the query is not kept.

## 0.3.2

### File tree sidebar
The sidebar has a Chats / Files toggle. Files shows the current
chat's working directory as a tree — folders first, then files,
alphabetical — with expand/collapse, and dotfiles shown. Clicking a
file shows its contents in the chat as a read card, the same card the
agent's file_read produces (200 KB cap, same truncation), and the card
is saved in the chat like an agent read. The tree refreshes when the
working directory changes, when an agent file write or edit applies,
and from a manual Refresh button. It follows exactly the file-tools
scope rules: cwd only, no `..` traversal, no symlink escapes, and
`.git` / `node_modules` / `dist` / secrets are hidden. A directory
with more than 500 entries shows the first 500 and a note.
Limits, stated plainly: browse + view only — no create, delete,
rename, drag-and-drop, or in-tree editing (the agent tools cover
writes); a read clicked while a turn is running shows in the chat but
is not saved to the chat file, because the running turn would
overwrite it; an external change only appears after a refresh.

### Terminal search
Ctrl+F (Cmd+F on Mac) while the terminal is focused, or the
magnifier button in the terminal tab bar, opens a search bar over the
top-right of the terminal. Type to find as you go; Enter steps to the
next match, Shift+Enter to the previous, Esc closes the bar and puts
focus back in the terminal. All matches are highlighted (the active
one in the theme accent) and the bar shows a count like "3 of 12",
or "No results" in red. Search covers the full scrollback buffer of
the active tab, not just the visible lines, and is case-insensitive
plain text — regex characters are matched literally. Each tab has
its own search; switching tabs, opening a new tab, or closing the
tab the search belongs to closes the bar and the query is not kept.
Opening the bar pre-fills it from the current selection. The
highlight colors follow the active theme.
Limits, stated plainly: the count is capped at the addon's 1,000
highlight limit — past that it reads "N of 1000" (stepping still
works); the count can go stale while new output arrives and refreshes
on the next search action, not on output; no regex, whole-word, or
case-sensitive toggle yet; the bar covers the terminal buffer only,
not the chat or command blocks.

## 0.3.1

### Agent file tools
The agent can now read, write, and patch files in the chat's working
directory with four new tools (`file_read`, `file_write`, `file_edit`,
`file_list`) instead of going through shell heredocs. Every write or
edit shows the exact diff in an approval card first — Apply, Deny, or
Always run — and the applied edit appears as a file card in the chat
with the diff and a +/− line count. Reads and listings never ask for
approval. Paths are scoped to the chat's working directory: `..`
traversal, absolute paths outside it, and symlinks escaping it are
refused, as are `.git`, `node_modules`, `dist`, and secrets (`.env`,
keys, credentials). Writes are atomic (temp file + rename), and at
apply time the file is re-read and re-verified — an edit whose target
text still matches exactly once is re-based onto the fresh content
(an unrelated change elsewhere in the file is preserved, never
clobbered); anything else aborts with an error instead of overwriting.
File contents are treated as data, never instructions: the agent is
told not to follow instructions found inside a file, and the approval
card is the enforcement point.
Limits, stated plainly: no delete tool and no undo — an applied edit
can only be undone by another edit (or the shell); scope is the chat's
working directory only; reads are capped at 200 KB, writes at 1 MB,
edits require the file to be ≤ 200 KB; a model can still be tricked
into PROPOSING a bad edit — nothing writes without approval while
Ask-first is on. Live model behavior with the new tools is unverified
in the sandbox (fake Ollama only); hermes3:8b is verified through the
harness, the other 7 presets are tools-capable but untested live with
these tools.

### Model manager (with Hugging Face)
Settings now has a Models section that lists every model actually
installed in Ollama — name, size, and modified date — with Use and
Delete on each row, a "current agent" marker on the active model, and
a label where a row matches one of the 8 agent presets. Use and
Delete apply immediately (no Save needed, and a later Save can't
revert them). Delete asks for confirmation first; deleting the agent's
own model falls back to hermes3:8b with an inline note and never
auto-pulls the fallback. The pull row takes a preset or a custom tag
with live progress (per-layer %, not whole download) and inline
errors. Hugging Face tags work as `hf.co/{user}/{repo}` or
`hf.co/{user}/{repo}:{quant}` (also `huggingface.co` as the domain);
a full `.gguf` filename works as the quant, and no quant defaults to
Q4_K_M when present. Pulled HF models show up under their full
`hf.co/…` name with an HF badge. If Ollama is down, the section says
so and disables its actions instead of crashing.
Limits, stated plainly: pull % is per-layer, not whole-download;
deleting an idle loaded model unloads it first, but a model actively
serving a request is refused; deleting the agent's model mid-turn
fails that turn; Ollama has no tools-capability check, so any
installed model can be switched to as the agent (the 8 presets are
the ones verified tools-capable); no rename/alias, no bulk delete,
and no disk-space check before pulling; gated HF repos need
credentials configured on the machine (the app doesn't set that up);
GGUF only — safetensors-only repos fail, and there are no Hugging
Face Inference API cloud calls. Live HF pulls are unverified in the
sandbox (fake Ollama only) — whether Ollama lowercases the tag in
`/api/tags` is still an open question for a real pull.

## 0.3.0

### Real shell integration for command blocks
Command blocks now show the real exit code of each command (0 in green,
non-zero in red with the code, Ctrl+C as Cancelled) and the true
per-command duration, instead of "running until the next command" and
wall time between submits. The shells emit OSC 133 markers (A prompt,
B command, C output, E command line, D finished with exit code) and
the app parses them from the raw pty stream; the command text is read
off the terminal buffer between the prompt and the Enter echo, falling
back to the shell's own command line. Covered shells: bash, zsh, and
fish — the integration is injected without touching your dotfiles
(bash `--rcfile`, a temp ZDOTDIR that symlinks your real zsh files,
fish `--init-command`). There is a "Shell integration" checkbox in
Settings (on by default, applies to new terminal tabs).
Limits, stated plainly: only bash, zsh, and fish are covered — `sh`,
`ssh`, `tmux`/`screen`, and `sudo -i` sessions emit no markers, so
the outer command's block stays running and inner commands get no
blocks (the keystroke tracker is the fallback there, exactly as
before, and it still shows no exit code). If you `exec` into a
non-integrated shell, blocks stop until you open a new tab. Command
output that literally contains OSC 133 bytes can fake a marker — the
only effect is a wrong block status, never a crash. A block's command
text comes from the shell's command line for zsh (exact) and from the
buffer for bash/fish; for bash, a compound command shows its first
simple command until the buffer read refines it to the full line.

### Fixed
- The first command in a new tab no longer files two blocks (the
  keystroke tracker fired at Enter before the first marker arrived,
  then the marker filed a second one). Any marker now marks the tab
  integrated, and a marker block supersedes a just-filed tracker
  block for the same command.
- Fish on a minimal install (no `fish_prompt` function, so the prompt
  is a builtin) no longer shows a blank prompt: the integration falls
  back to a prompt mimicking the builtin default (`user@host cwd > `).

## 0.2.2

### Nano autocomplete
While editing a file inside nano in the built-in terminal, a VS Code-style
suggestion popup appears at the cursor as you type a word (2+ characters):
Tab or Enter accepts the selected suggestion, Up/Down move, Esc closes it,
Ctrl+Space forces it open. Suggestions come from the open file, the visible
screen (so unsaved edits count), and small keyword lists per file type.
There is a "Nano autocomplete" checkbox in Settings (on by default).
Limits, stated plainly: no LSP and no whole-project symbols — only the
open file, the visible screen, and keywords. Relative file paths resolve
against the chat's working directory, so if you `cd`'d elsewhere in the
shell the file read may miss and screen words carry the suggestions.

### Fixed
- Pressing Enter inside a fullscreen app (nano, vim, less) no longer
  files a bogus command block for the line on screen. The input tracker
  now ignores keystrokes while the terminal is on the alternate screen;
  that also keeps the nano command recorded, so detection stays correct.
- Esc while the autocomplete popup is open now actually dismisses it:
  passing Esc through to nano made nano redraw the cursor (reopening
  the popup) and armed its Meta prefix, so the next key ran a Meta
  command. Esc is swallowed only while the popup is open; with the
  popup closed it reaches nano as usual and Meta shortcuts work.
- Accepting a suggestion now re-checks the word on screen first, so a
  fast keystroke typed between the popup rendering and Tab can't
  produce a garbled word (e.g. `con` + `f` + Tab no longer yields
  `conffig`).

## 0.2.1

### New models

The agent can now run on four more Ollama models, each verified as an
existing tools-capable tag on ollama.com/library: Qwen 2.5 Coder 14B
(~9 GB), Llama 3.1 8B (~4.9 GB), Mistral Nemo 12B (~7.1 GB), and
Devstral 24B (~14 GB). Hermes 3 8B stays the default. The command
palette can switch to any of the eight presets without opening
settings.

### Customization

- Themes: Warp Dark, Dracula, Nord, Solarized Dark, and One Dark join
  Black (still the default) and White. Each theme is a full token set
  for the app and the terminal.
- Custom accent color: pick any color to override the theme accent,
  or reset to the theme's own accent.
- Fonts: family (System Mono, JetBrains Mono, Fira Code, IBM Plex
  Mono) and size, separately for the terminal and the chat.
- Command palette (Ctrl+K): fuzzy search over every action — new
  chat, switch views, new terminal tab, toggle sidebar, settings,
  copy/export chat, ask AI about the terminal selection, pull the
  current model, toggle auto-run, switch agent model, focus chat
  input or search. Arrow keys + Enter + Esc + click.

### Warp-style terminal

Commands are grouped into blocks in a rail above the terminal: each
block shows the command, Copy and Rerun buttons, and status/duration
(running blocks in the theme accent, finished blocks with wall time,
Ctrl+C marks a block Cancelled). A Blocks button in the terminal
header shows the count and hides the rail. Note: without shell
integration, a block is running until the next command is submitted
and duration is wall time between submits — exit codes are not shown.

## 0.2.0

### Security

Includes the hardening pass from PR #2 (merged): random per-invocation
CWD marker plus directory validation against marker injection; recursive
`rm` blocked against absolute paths, `~`, `$HOME`, bare `.`/`..` and
globs, plus `find -delete` / `-exec rm`; PowerShell `-EncodedCommand`
blocked; markdown link hrefs escaped against quote break-out; IPC
handlers guard against missing chats; interpreter denylist bypasses
(`shutil.rmtree`, `.rmSync()`, `os.remove`/`unlink`/`rmdir`) closed;
PTY leak on tab-close-during-create fixed; stuck Working spinner on a
missing chat fixed; `taskkill` spawn errors handled.

### Fixed

- Deleting a chat while its agent run was in flight no longer lets the
  run recreate the deleted chat.
- An Ollama address without a scheme (e.g. `localhost:11434`) is now
  normalized to `http://` instead of failing every request.
- An agent run on a chat that no longer exists now always reports
  `done`, so the Working spinner can't strand; the renderer no longer
  crashes opening a null chat.

### Hermes agent

The terminal agent now runs on Nous Hermes 3 via Ollama by default
(`hermes3:8b`, 128K context, built for tool calling). The model field
in Settings is now "Agent model" with a Pull model button that
downloads the selected model into Ollama with progress, and the agent
model list offers Hermes 3 8B / 70B / 3B alongside the previous
`gpt-oss:20b` default. Existing installs keep their saved model.

### UI

- Removed the unused neon card/button styles; the app is black and
  white, with teal reserved for live agent state: the Ollama status
  dot, the waiting approval card's border, and its Run button.
- Buttons, chips, the send button, the view switcher, terminal tabs
  and suggestion cards now press to 0.96 scale over 150ms (disabled
  buttons never scale; reduced-motion users get no scale).
- Hover-only controls are now touch-safe: hover styles only apply on
  devices with a pointer, and on touch the chat delete button and
  message actions stay visible; the delete target is bigger (~28px).

### Packaging

Linux AppImage and .deb built with electron-builder. Both were
launch-tested in this sandbox: the AppImage's payload opens and
renders (direct mount needs libfuse2, which this sandbox lacks, so it
was run via `--appimage-extract-and-run`); the .deb installs cleanly
with `dpkg -i` and its installed binary opens and renders. The .rpm
target is configured but did not build here — it needs `rpmbuild`,
which isn't installed in this sandbox.
