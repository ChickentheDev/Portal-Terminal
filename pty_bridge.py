#!/usr/bin/env python3
"""
Tiny pty bridge used by the built-in terminal.

usage: pty_bridge.py SHELL CWD COLS ROWS

- stdin  -> keystrokes for the shell
- stdout <- everything the shell prints
- fd 3   -> control lines, e.g. "R <cols> <rows>" to resize

It exists so the app can offer a real terminal (colors, vim, htop, ...)
without compiling a native Node module, which is painful on SteamOS.
"""
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios


def set_size(fd, cols, rows):
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    except OSError:
        pass


def write_all(fd, data):
    while data:
        n = os.write(fd, data)
        data = data[n:]


def main():
    shell, cwd = sys.argv[1], sys.argv[2]
    cols, rows = int(sys.argv[3]), int(sys.argv[4])

    pid, fd = pty.fork()
    if pid == 0:
        try:
            os.chdir(cwd)
        except OSError:
            pass
        os.environ["TERM"] = "xterm-256color"
        os.environ["COLORTERM"] = "truecolor"
        try:
            os.execvp(shell, [shell, "-i"])
        except OSError:
            os.execvp("/bin/sh", ["/bin/sh", "-i"])

    set_size(fd, cols, rows)

    def hangup(*_):
        try:
            os.kill(pid, signal.SIGHUP)
        except OSError:
            pass

    signal.signal(signal.SIGTERM, lambda *_: (hangup(), sys.exit(0)))
    signal.signal(signal.SIGHUP, lambda *_: (hangup(), sys.exit(0)))

    watching = [fd, 0, 3]
    ctrl_buf = b""

    try:
        while True:
            try:
                ready, _, _ = select.select(watching, [], [])
            except InterruptedError:
                continue

            if fd in ready:
                try:
                    data = os.read(fd, 65536)
                except OSError:
                    data = b""
                if not data:
                    break
                write_all(1, data)

            if 0 in ready:
                data = os.read(0, 65536)
                if data:
                    write_all(fd, data)
                else:
                    # the app closed our stdin: hang up the shell, keep draining output
                    watching.remove(0)
                    hangup()

            if 3 in ready:
                chunk = os.read(3, 4096)
                if chunk:
                    ctrl_buf += chunk
                    while b"\n" in ctrl_buf:
                        line, ctrl_buf = ctrl_buf.split(b"\n", 1)
                        parts = line.split()
                        if len(parts) == 3 and parts[0] == b"R":
                            try:
                                set_size(fd, int(parts[1]), int(parts[2]))
                            except ValueError:
                                pass
                else:
                    watching.remove(3)
    except (BrokenPipeError, KeyboardInterrupt):
        hangup()

    code = 0
    try:
        _, status = os.waitpid(pid, 0)
        code = os.waitstatus_to_exitcode(status)
    except (ChildProcessError, AttributeError):
        pass
    sys.exit(code if code >= 0 else 1)


if __name__ == "__main__":
    main()
