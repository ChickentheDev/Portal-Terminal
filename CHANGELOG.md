# Changelog

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
