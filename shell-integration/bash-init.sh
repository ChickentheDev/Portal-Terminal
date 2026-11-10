# Portal Terminal --rcfile for bash.
# Sources the user's ~/.bashrc first, then the Portal shell integration.
# The user's dotfiles are never modified.
if [[ -f "$HOME/.bashrc" ]]; then
  . "$HOME/.bashrc"
fi
__portal_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$__portal_dir/bash.sh"
unset __portal_dir
