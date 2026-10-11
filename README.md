# Portal Terminal

A black and white desktop app with two ways to work: chat with a local Ollama model (default `gpt-oss:20b`) that can run commands for you, or use the built-in terminal yourself. Use both side by side.

![Portal Terminal icon](icon.png)

## Easy Install (recommended)

### Option 1 — One-liner (source install)

```bash
bash install.sh
```

Adds **Portal Terminal** to your applications menu. Requires Node.js + Python 3.

### Option 2 — AppImage (no install needed)

Download the `.AppImage` from [Releases](https://github.com/yourusername/portal-terminal/releases), then:

```bash
chmod +x Portal-Terminal-*.AppImage
./Portal-Terminal-*.AppImage
```

### Option 3 — Debian / Ubuntu / Pop!_OS / Mint

```bash
sudo dpkg -i portal-terminal_*.deb
# or
sudo apt install ./portal-terminal_*.deb
```

### Option 4 — Fedora / RHEL / openSUSE

```bash
sudo rpm -i portal-terminal-*.rpm
# or
sudo dnf install ./portal-terminal-*.rpm
```

### Option 5 — Flatpak

```bash
flatpak-builder --user --install --force-clean build-dir org.portalterminal.PortalTerminal.yml
flatpak run org.portalterminal.PortalTerminal
```

(You can also publish the Flatpak to a repository later.)

---

## Requirements

- **Python 3** (for the built-in terminal)
- **Ollama** (for AI chat features) — install from https://ollama.com
- Node.js only needed if you install from source

## Features

- Chat + Terminal side by side (or either full-screen)
- Local AI via Ollama that can run shell commands (with approval)
- Real terminal (colors, vim, htop, ssh) with tabs
- Streaming replies, thinking blocks, command cards
- Past chats saved on disk with search
- Works great on Steam Deck / SteamOS

## Views

- **Chat** — just the AI conversation
- **Split** — chat on top, terminal underneath (drag the divider)
- **Terminal** — full-screen terminal

## Shortcuts

| Shortcut              | Action                    |
|-----------------------|---------------------------|
| Ctrl+N                | New chat                  |
| Ctrl+K                | Search chats              |
| Ctrl+,                | Settings                  |
| Ctrl+`                | Show / hide terminal      |
| Ctrl+Shift+T / W      | New / close terminal tab  |
| Esc                   | Stop current AI task      |
| Ctrl +/-              | Zoom                      |

## Build packages yourself

```bash
npm install
npm run dist:linux     # builds AppImage + deb + rpm into ./dist/
```

Or individually:

```bash
npm run dist:appimage
npm run dist:deb
npm run dist:rpm
```

### Flatpak

```bash
flatpak-builder --user --install --force-clean build-dir org.portalterminal.PortalTerminal.yml
```

## Development

```bash
npm install
npm start
```

## Where data lives

Chats and settings: `~/.config/portal-terminal/` (Electron userData path).

## License

MIT
