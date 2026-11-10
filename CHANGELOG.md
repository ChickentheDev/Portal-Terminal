# Changelog

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
