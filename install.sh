#!/usr/bin/env bash
# One-step setup: moves the project to ~/Documents/Projects, installs
# dependencies, and adds Portal Terminal to your applications menu.
set -e

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECTS="$HOME/Documents/Projects"
DEST="$PROJECTS/portal-terminal"

mkdir -p "$PROJECTS"

if [ "$SRC" != "$DEST" ]; then
  if [ -e "$DEST" ]; then
    echo "Updating the existing copy in $DEST (your node_modules are kept)..."
    cp -a "$SRC"/. "$DEST"/
    echo "You can delete $SRC now."
  else
    echo "Moving the project to $DEST ..."
    mv "$SRC" "$DEST"
  fi
  exec bash "$DEST/install.sh"
fi

cd "$DEST"

# make sure node/npm are available (nvm lives in your home folder)
if ! command -v npm >/dev/null 2>&1; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Install Node first (see README.md), then run this again."
  exit 1
fi

echo "Installing dependencies (Electron is a big download, this can take a few minutes)..."
npm install

chmod +x launch.sh pty_bridge.py install.sh

APPS="$HOME/.local/share/applications"
mkdir -p "$APPS"
ENTRY="$APPS/portal-terminal.desktop"
cat > "$ENTRY" <<DESKTOP
[Desktop Entry]
Type=Application
Version=1.0
Name=Portal Terminal
Comment=Chat with a local AI that can use your terminal
Exec="$DEST/launch.sh"
Icon=$DEST/icon.png
Terminal=false
Categories=Utility;System;TerminalEmulator;
StartupWMClass=portal-terminal
DESKTOP
chmod +x "$ENTRY"

# desktop shortcut too, if there's a Desktop folder
if [ -d "$HOME/Desktop" ]; then
  cp "$ENTRY" "$HOME/Desktop/portal-terminal.desktop"
  chmod +x "$HOME/Desktop/portal-terminal.desktop"
fi

# refresh the menu cache (any of these may not exist, that's fine)
update-desktop-database "$APPS" >/dev/null 2>&1 || true
kbuildsycoca6 >/dev/null 2>&1 || kbuildsycoca5 >/dev/null 2>&1 || true

echo
echo "Done. Portal Terminal is now in $DEST"
echo "Open your applications menu and search for \"Portal Terminal\"."
