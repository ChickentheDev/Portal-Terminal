# Portal Terminal shell integration for bash.
# Sourced AFTER ~/.bashrc by bash-init.sh (invoked via --rcfile).
# Emits OSC 133 markers so the app can show real exit codes and durations
# in the command-blocks rail. Safe to source twice: guarded by
# __portal_loaded. The user's dotfiles are never modified.

if [[ -n "${__portal_loaded:-}" ]]; then return 0; fi
__portal_loaded=1

# Escape a string for the OSC 133;E payload. Backslash first, then the
# bytes that would end or corrupt the sequence (newline, CR, BEL, ESC).
__portal_escape() {
  local s="$1"
  s=${s//\\/\\\\}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//$'\a'/\\a}
  s=${s//$'\e'/\\e}
  printf '%s' "$s"
}

__portal_emit() { printf '\033]133;%s\007' "$1"; }

# Restores $? to a saved value, so the user's PROMPT_COMMAND sees the real
# exit code of the last command instead of our own printf's.
__portal_restore_status() { return "$1"; }

# Runs before every prompt: first the user's old PROMPT_COMMAND (with the
# real $? restored), then D (exit code of the finished command) and A.
# The at-prompt flag is armed last, so the DEBUG trap only fires for the
# top-level interactive command — not for PROMPT_COMMAND's own commands.
__portal_prompt_command() {
  local __code=$?
  if [[ -n "${__portal_old_pc_str:-}" ]]; then
    __portal_restore_status "$__code"
    eval "$__portal_old_pc_str"
  elif [[ -n "${__portal_old_pc_arr+x}" ]]; then
    local __c
    __portal_restore_status "$__code"
    for __c in "${__portal_old_pc_arr[@]}"; do eval "$__c"; done
  fi
  __portal_emit "D;$__code"
  __portal_emit "A"
  __portal_at_prompt=1
}

# DEBUG trap: only the top-level interactive command. The flag is set by
# PROMPT_COMMAND and cleared here, so later parts of `cmd1; cmd2` and
# commands inside functions don't re-fire. Chains any pre-existing
# DEBUG trap.
__portal_debug_trap() {
  if [[ -n "${__portal_at_prompt:-}" ]]; then
    __portal_at_prompt=
    __portal_emit "E;$(__portal_escape "$BASH_COMMAND")"
    __portal_emit "C"
  fi
  if [[ -n "${__portal_old_debug:-}" ]]; then
    eval "$__portal_old_debug"
  fi
}

# --- install ---
# Save the user's PROMPT_COMMAND (string, or array on bash 5.1+).
if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
  __portal_old_pc_arr=("${PROMPT_COMMAND[@]}")
else
  __portal_old_pc_str="${PROMPT_COMMAND:-}"
fi
PROMPT_COMMAND=__portal_prompt_command

# Save any existing DEBUG trap (trap -p prints: trap -- 'cmd' DEBUG).
__portal_old_debug="$(trap -p DEBUG 2>/dev/null)"
if [[ -n "$__portal_old_debug" ]]; then
  __portal_old_debug="${__portal_old_debug#trap -- \'}"
  __portal_old_debug="${__portal_old_debug%\' DEBUG}"
fi
trap '__portal_debug_trap' DEBUG

# B marker: appended to PS1 as a zero-width sequence so readline's line
# wrapping is unaffected. If PS1 is unset, use bash's default first.
if [[ -z "${PS1-}" ]]; then PS1='\s-\v\$ '; fi
case "$PS1" in
  *'133;B'*) ;;
  *) PS1="$PS1"'\[\e]133;B\a\]' ;;
esac
