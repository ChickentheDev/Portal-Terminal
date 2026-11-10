# Shell integration for Warp blocks — design note

## Problem
Today a block is created by the keystroke input tracker (`trackInput` in
`terminal.js`): it reads "running" until the next command is submitted,
duration is wall time between submits, and the exit code is never shown.
CHANGELOG 0.2.1 states this honestly as a limit.

## Goal
Blocks show the real exit code of each command (0 green, non-zero red with
the code, 130 = Cancelled) and the true per-command duration.

## Byte flow (unchanged)
```
shell -> pty master (pty_bridge.py reads fd) -> bridge stdout
  -> main.js child.stdout 'data' -> IPC 'term-data' -> renderer term.write()
```
xterm.js consumes OSC sequences silently, so the markers must be read from
the RAW pty stream in the main process — never from the terminal buffer.

## OSC 133 markers (FinalTerm / iTerm2 standard)
- `OSC 133;A` — prompt start (emitted before the prompt is printed)
- `OSC 133;B` — prompt end / input start (emitted after the prompt)
- `OSC 133;C` — command output start (emitted by preexec, just before run)
- `OSC 133;D;<exit>` — command finished, with the exit code
- `OSC 133;E;<escaped command>` — Portal addition (see below): the command
  line as the shell knows it, emitted by preexec just before C. The
  command is escaped (`\` -> `\\`, BEL -> `\a`, ESC -> `\e`) so a BEL/ESC
  inside a command can't terminate the sequence early.

## Parser (main.js, new module `osc133.js`)
A streaming parser per tab, fed the raw chunk buffers from the bridge:
- Scans for `ESC ]`, reads to BEL (`\x07`) or ST (`ESC \`). Partial
  sequences at a chunk boundary are held in a pending buffer; the pending
  buffer is capped (64 KB) and dropped if it never terminates.
- Non-133 OSC sequences are skipped (boundaries still respected).
- The raw bytes are forwarded to the renderer UNCHANGED — xterm consumes
  the sequences; the parser only observes.
- Emits `term-osc` IPC events `{ id, kind, code?, command? }`.
- Known cosmetic risk, accepted (same as VS Code): command OUTPUT can
  contain literal OSC 133 bytes (e.g. `cat` of a crafted file) and fake a
  marker. Impact is block display only; the block list is UI-only state.

## Shell injection (no dotfile changes)
`main.js` term:create passes `PORTAL_SHELL_INTEGRATION=1` and
`PORTAL_INTEGRATION_DIR=<resourcePath('shell-integration')>` in the bridge
env when `settings.shellIntegration` is on (default). The bridge picks by
the shell basename; anything else launches exactly as today.

- **bash**: `bash --rcfile <dir>/bash-init.sh -i`. `bash-init.sh` sources
  `~/.bashrc` (if present), then `bash.sh`. `bash.sh`:
  - `PROMPT_COMMAND` wrapper: captures `$?` FIRST, emits `D;<code>`,
    then `A`, then runs the user's old PROMPT_COMMAND (string or array —
    both chained, never clobbered), then sets the at-prompt flag.
  - `PS1` append `\[\e]133;B\a\]` (zero-width, so readline wrapping is
    unaffected). If PS1 is unset, set bash's default first.
  - DEBUG trap: fires preexec only when the at-prompt flag is set
    (top-level command only — not PROMPT_COMMAND's own commands, not the
    second half of `cmd1; cmd2`), emits `E` (`$BASH_COMMAND`, first simple
    command) then `C`. Chains any pre-existing DEBUG trap.
- **zsh**: `ZDOTDIR=<temp dir> zsh -i`. The bridge creates a temp dir with
  symlinks to the user's real `.zshenv/.zprofile/.zlogin/.zlogout` (so no
  startup file is skipped) plus a generated `.zshrc` that sources
  `~/.zshrc` then `zsh.sh`. `zsh.sh`:
  - `precmd` (via `add-zsh-hook`): emits `D;<$?>` then `A`.
  - `preexec` (via `add-zsh-hook`): emits `E` (`$1`, the full line) then `C`.
  - No `B`: zsh has no clean post-prompt hook (PS1 append needs
    PROMPT_SUBST, which would change how the user's prompt is evaluated).
    zsh's `E` is the full command line, so it is the command source there.
  - Caveat: if the user's own precmd runs commands without preserving
    `$?`, the D code can be wrong — precmd hooks run in registration
    order and ours is registered after the user's `.zshrc`.
- **fish**: `fish -i --init-command 'source <dir>/fish.fish'`
  (config loads normally, then the integration). `fish.fish`:
  - Wraps `fish_prompt`: emits `A`, calls the original, emits `B`.
    If no `fish_prompt` function exists (fish falls back to its builtin
    prompt, e.g. a minimal install without share files), `functions -c`
    has nothing to copy — the wrapper prints a prompt mimicking the
    builtin default (`user@host cwd > `) instead of leaving it blank.
    (Found in the launch test: the sandbox's extracted fish has no
    `fish_prompt` function.)
  - `fish_preexec`: emits `E` (`$argv`, full line) then `C`.
  - `fish_postexec`: emits `D;<$status>`.
- Temp ZDOTDIR is removed by the bridge when the shell exits.
- If the integration dir or a script is missing, the bridge launches the
  shell plainly (no crash, no markers -> tracker fallback).

## Block model change (renderer, terminal.js)
Per-tab marker state: `shellIntegrated` (any marker seen), `markerAnchor`
(cursor pos at B), `markerStack` (blocks pushed on C, popped on D),
`pendingCmd` (last E text, cleared on A).

- **C**: create the block synchronously (so a fast D finds it on the
  stack) with the command text from E, `startedAt = now`,
  `source: 'marker'`; then refine the command text from the anchor
  capture (see below) once the Enter echo has landed. Also calls
  `nanoOnCommand` so nano detection keeps working.
- **First-command double block (found in the launch test, fixed):**
  the tracker fired at the first Enter (before any C had arrived) and
  C filed a second block for the same command. Fixed two ways: ANY
  marker sets `shellIntegrated` (the startup A/B arrive at the first
  prompt, before the first Enter, so the tracker is suppressed from
  the start), and C drops a trailing still-running tracker block —
  the type-ahead race where Enter lands before the startup markers.
  Tracker blocks carry `source: 'tracker'` explicitly.
- **D**: pop the stack top, set `exitCode`, `status` (`done`, or
  `cancelled` when the code is 130), `durationMs = now - startedAt`.
  A D with an empty stack is ignored (startup D, Ctrl+C at an empty
  prompt). The stack (not a single `current`) is what makes nested
  integrated shells (`bash` inside `bash`) report correctly.
- **A**: clears `pendingCmd` (stale E). **B**: records the anchor.
- **Ctrl+C** during a command: the shell reports it as exit 130 via D —
  no keystroke handling needed on the marker path.
- `tab.current` is synced to the marker stack top so `nanoActive` (which
  reads `tab.current.command`) keeps working in marker mode.

## Command text: anchor capture, then E, then heuristic
1. **Anchor capture (primary for bash/fish)**: at B, the renderer records
   the cursor (`term.write('', cb)` — the callback fires after queued
   writes flush, so the prompt is on screen). At C, it reads buffer lines
   from the anchor to the line above the cursor (the Enter echo `\r\n`
   moved the cursor past the command), strips the prompt on the first
   line and `> ` continuation prefixes, and joins lines — `isWrapped`
   lines join with no newline, real newlines join with `\n`. A 200 ms
   safety timer clears a pending anchor if the write callback never fires.
2. **E text** (primary for zsh, fallback for bash/fish): the shell's own
   command line. Exact for zsh/fish (full line); for bash it is only the
   first simple command (`$BASH_COMMAND`), so it is used only when the
   anchor is missing.
3. **Heuristic** (`commandFromBuffer`, as today): last resort.

## Fallback rule (the tracker stays)
- `trackInput` still maintains `inputBuf` and the nano popup, but
  `submitLine` creates NO block once `tab.shellIntegrated` is true.
- If no marker ever arrives for a tab (integration off, shell is `sh`,
  integration failed to load), the tracker works exactly as today.
- Inside `ssh` / `tmux` / `sh` / `sudo -i` under an integrated shell:
  the outer command's block stays running and inner commands get no
  blocks (the remote/inner shell emits no markers). This is the correct
  behaviour for blocks — the app can't know remote exit codes — and it
  also fixes the tracker filing bogus blocks for remote commands.
- If the user replaces PS1 (bash) the B marker stops; blocks still get
  real exit codes/durations via C/D, with the command text from E/heuristic.

## Settings
`shellIntegration` (default on) in `DEFAULT_SETTINGS`, validated in
`settings:set`, checkbox in Settings ("Shell integration — real exit
codes and durations in command blocks. Applies to new terminal tabs.").
Main reads it at `term:create` time. No renderer change needed beyond
the checkbox: block sourcing is marker-driven, not setting-driven.

## Files
- New: `shell-integration/bash.sh`, `bash-init.sh`, `zsh.sh`,
  `fish.fish`; `osc133.js` (parser + unescape, unit-testable);
  `design-plans/shell-integration-plan.md` (this file).
- Changed: `pty_bridge.py` (launch per shell + ZDOTDIR temp dir),
  `main.js` (parser wiring, `term-osc` IPC, `shellIntegration`
  setting), `preload.js` (`term-osc` event), `terminal.js` (marker
  blocks, tracker gating, exit-code display), `index.html` + `renderer.js`
  (checkbox), `styles.css` (exit-code badges), `package.json`
  (extraResources for `shell-integration/`), `CHANGELOG.md`.

## Verification
- Unit tests: parser (exit 0/1/127, D;130, split sequences, malformed /
  unterminated OSC, non-133 OSC, E round-trip) + shell-script syntax
  (`bash -n`, `zsh -n`; fish has no checker in the sandbox).
- Headless harness: marker handling in terminal.js with a stubbed
  `window.api` (anchor capture, C/D flow, fallback, nano regression).
- Real Electron launch test under Xvfb with real bash, zsh AND fish
  (fish 3.7.0 from the Ubuntu .deb, extracted to /tmp — it is NOT
  installed system-wide and apt has no lists): exit codes and true
  durations end to end, integration off (fallback), nano
  no-bogus-block, Ctrl+C -> Cancelled, multi-line, `clear`,
  long-running command, nested `sh` (no markers -> outer block stays
  running, no inner blocks). Bug hunt covered huge output, agent
  direct pty writes, UI paste, `read`, multi-line PS1, fake OSC 133
  bytes in output, tmux, rapid-fire commands.
- Bug hunt after the build; retest each fix in the running app.
- Zero page errors throughout. No version bump, no packaging, no push —
  Sam names the version.

## Results (2026-11-10)
- Parser unit tests: 39/39. Headless harness (real xterm.js): 22/22.
  Real Electron launch test: 49/49 (bash, zsh, fish, integration-off).
  Bug hunt: 12/12. Zero page errors in every run.
- Bugs found and fixed: (1) first-command double block (tracker +
  marker); (2) fish blank prompt on minimal installs (no
  `fish_prompt` function to wrap).
