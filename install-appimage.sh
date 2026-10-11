#!/usr/bin/env bash
# Install the Portal Terminal AppImage into the system applications menu
set -e

# Find the AppImage (prefer Downloads, then current dir / dist)
APPIMAGE=""
for candidate in \
  "$HOME/Downloads/Portal-Terminal-"*.AppImage \
  "$(pwd)/dist/Portal-Terminal-"*.AppImage \
  "$(pwd)/Portal-Terminal-"*.AppImage
do
  if [ -f "$candidate" ]; then
    APPIMAGE="$candidate"
    break
  fi
done

if [ -z "$APPIMAGE" ]; then
  echo "Could not find Portal-Terminal-*.AppImage"
  echo "Put it in ~/Downloads or run this from the project folder after building."
  exit 1
fi

APPIMAGE="$(realpath "$APPIMAGE")"
echo "Using AppImage: $APPIMAGE"

# Make sure it’s executable
chmod +x "$APPIMAGE"

# Install icon
ICON_DIR="$HOME/.local/share/icons/hicolor/512x512/apps"
mkdir -p "$ICON_DIR"
ICON_SRC="$(dirname "$0")/icon.png"
if [ -f "$ICON_SRC" ]; then
  cp "$ICON_SRC" "$ICON_DIR/portal-terminal.png"
  ICON="portal-terminal"
else
  ICON="utilities-terminal"
fi

# Create desktop entry
APPS="$HOME/.local/share/applications"
mkdir -p "$APPS"
DESKTOP="$APPS/portal-terminal.desktop"

cat > "$DESKTOP" << DESKTOPEOF
[Desktop Entry]
Type=Application
Version=1.0
Name=Portal Terminal
Comment=Chat with a local AI that can use your terminal
Exec=$APPIMAGE --no-sandbox --disable-dev-shm-usage --disable-gpu --use-gl=swiftshader
Icon=$ICON
Terminal=false
Categories=Utility;System;TerminalEmulator;
StartupWMClass=portal-terminal
DESKTOPEOF

chmod +x "$DESKTOP"

# Also put a copy on the Desktop if it exists
if [ -d "$HOME/Desktop" ]; then
  cp "$DESKTOP" "$HOME/Desktop/portal-terminal.desktop"
  chmod +x "$HOME/Desktop/portal-terminal.desktop"
fi

# Refresh the menu
update-desktop-database "$APPS" 2>/dev/null || true
kbuildsycoca6 2>/dev/null || kbuildsycoca5 2>/dev/null || true

echo
echo "Done! Portal Terminal is now in your applications menu."
echo "You can also find it on the Desktop."
echo
echo "AppImage location: $APPIMAGE"
