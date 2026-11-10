# Portal Terminal shell integration for fish.
# Sourced via --init-command AFTER the user's config. Emits OSC 133
# markers so the app can show real exit codes and durations in the
# command-blocks rail. Guarded against double-source.
# Note: fish emits the E payload (the command line) with raw newlines for
# multi-line commands — xterm.js consumes newlines inside an OSC sequence
# silently, and the app's parser reads to BEL/ST, so this is safe. The
# payload is never captured in a variable (fish command substitution
# splits on newlines), it is written straight to the terminal.

if not set -q __portal_loaded
    set -g __portal_loaded 1

    # Escape a command for the OSC 133;E payload: backslash first, then
    # BEL and ESC (the bytes that would end or corrupt the sequence).
    # A multi-line command arrives as a list (one element per line, from
    # fish's newline-splitting command substitution); each line is escaped
    # and the lines are joined with the literal two characters \n, which
    # the app converts back to newlines. Returns the joined string (one
    # element, no trailing newline) so the caller can print it with a
    # single printf — a fish builtin's trailing newline would otherwise
    # be turned into \r\n by the pty and ride along in the payload.
    function __portal_escape
        # NOTE: takes the lines in $argv (not --argument-names: that only
        # captures the FIRST argument, the rest land in $argv).
        set -l bel (printf '\a')
        set -l esc (printf '\e')
        set -l parts
        for line in $argv
            set -l e (string replace -a "\\" "\\\\" -- "$line" | string replace -a "$bel" '\a' | string replace -a "$esc" '\e')
            set -a parts $e
        end
        string join '\n' -- $parts
    end

    # Wrap fish_prompt so A is emitted before the prompt and B after it.
    # If no fish_prompt function exists (fish falls back to its builtin
    # prompt, e.g. a minimal install without share files), there is
    # nothing to copy — print a prompt that mimics the builtin default
    # (user@host cwd > ) instead of leaving the prompt blank.
    if functions -q fish_prompt
        functions -c fish_prompt __portal_fish_prompt_orig
    end

    function fish_prompt
        printf '\033]133;A\007'
        if functions -q __portal_fish_prompt_orig
            __portal_fish_prompt_orig
        else
            printf '%s@%s %s > ' $USER (hostname) (string replace $HOME '~' -- $PWD)
        end
        printf '\033]133;B\007'
    end

    function __portal_preexec --on-event fish_preexec
        # Trim trailing whitespace: fish's preexec line keeps the CR from
        # the Enter keystroke.
        set -l cmd (string trim --right -- $argv[1])
        # NOTE: $cmd is UNQUOTED here on purpose. In fish, "$list"
        # (double-quoted) joins a list's elements with spaces into ONE
        # argument; unquoted it passes one argument per line, which is
        # what __portal_escape needs to join them with \n.
        set -l esc (__portal_escape $cmd)
        printf '\033]133;E;%s\007' "$esc"
        printf '\033]133;C\007'
    end

    function __portal_postexec --on-event fish_postexec
        printf '\033]133;D;%s\007' $status
    end
end
