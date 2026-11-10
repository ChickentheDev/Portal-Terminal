# Portal Terminal shell integration for zsh.
# Sourced AFTER ~/.zshrc by the generated ZDOTDIR .zshrc. Emits OSC 133
# markers so the app can show real exit codes and durations in the
# command-blocks rail. Guarded against double-source.
# Note: no B marker — zsh has no clean post-prompt hook (a PS1 append
# would need PROMPT_SUBST, which would change how the user's prompt is
# evaluated). The E sequence carries the full command line, so it is the
# command source for zsh instead.
# Caveat: precmd hooks run in registration order and ours is registered
# after the user's .zshrc, so if the user's own precmd runs commands
# without preserving $?, the D exit code can be wrong. Most prompt setups
# preserve $?; the duration is always correct.

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
  print -rn -- "$s"
}

__portal_emit() { printf '\033]133;%s\007' "$1"; }

__portal_precmd() {
  local __code=$?
  __portal_emit "D;$__code"
  __portal_emit "A"
}

__portal_preexec() {
  __portal_emit "E;$(__portal_escape "$1")"
  __portal_emit "C"
}

autoload -Uz add-zsh-hook
add-zsh-hook precmd __portal_precmd
add-zsh-hook preexec __portal_preexec
