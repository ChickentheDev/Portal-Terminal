#!/usr/bin/env bash
# Starts Portal Terminal. Used by the app launcher entry; safe to run by hand too.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ELECTRON="$DIR/node_modules/electron/dist/electron"
if [ ! -x "$ELECTRON" ]; then
  # fall back to node via nvm if the binary isn't where we expect
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1
  cd "$DIR" && exec npm start
fi

cd "$DIR"
exec "$ELECTRON" "$DIR" --no-sandbox --class=portal-terminal "$@"
