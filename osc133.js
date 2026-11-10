// Streaming OSC 133 parser for the pty byte stream.
//
// The raw pty bytes pass through this module UNTOUCHED — it only observes.
// Feed raw chunks (Buffer or string); marker events are delivered to the
// callback as { kind, code?, command? }:
//   A — prompt start, B — prompt end / input start, C — command output start
//   D — command finished (code = exit code, null when unparseable)
//   E — the command line, as the shell knows it (escaped; see below)
//
// The E payload is escaped by the shell integration scripts: backslash
// first, then BEL (\a) and ESC (\e) — the bytes that would end or corrupt
// the sequence — plus newline (\n) and CR (\r) for bash/zsh. (fish emits
// raw newlines for multi-line commands; xterm.js consumes newlines inside
// an OSC sequence silently, and this parser reads to BEL/ST, so both are
// fine.) Non-ASCII in E arrives as raw UTF-8 bytes; the payload is
// decoded from latin1 back to UTF-8 before unescaping.
'use strict';

const ESC = '\x1b';
const MAX_PENDING = 65536;

function unescapeCommand(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) {
      const n = s[i + 1];
      if (n === '\\') { out += '\\'; i++; }
      else if (n === 'n') { out += '\n'; i++; }
      else if (n === 'r') { out += '\r'; i++; }
      else if (n === 'a') { out += '\x07'; i++; }
      else if (n === 'e') { out += '\x1b'; i++; }
      else { out += c; }
    } else {
      out += c;
    }
  }
  // A command line never meaningfully ends in whitespace (fish's preexec
  // line keeps the CR from the Enter keystroke; the escaping pipeline can
  // add a trailing LF). Trim it so Copy/Rerun don't paste a stray blank.
  return out.replace(/\s+$/, '');
}

function createOsc133Parser(onEvent) {
  let pending = '';
  function feed(chunk) {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('latin1') : String(chunk);
    pending += text;
    if (pending.length > MAX_PENDING) {
      // Unbounded garbage (e.g. a binary dump): drop everything up to the
      // last ESC ] so a later well-formed sequence can still be found.
      const cut = pending.lastIndexOf(ESC + ']');
      pending = cut >= 0 ? pending.slice(cut) : '';
      if (pending.length > MAX_PENDING) pending = '';
    }
    for (;;) {
      const start = pending.indexOf(ESC + ']');
      if (start < 0) {
        // No OSC start; keep only a trailing ESC (it may be the first half
        // of an ESC ] split across chunks).
        pending = pending.endsWith(ESC) ? ESC : '';
        return;
      }
      // Find the terminator: BEL or ST (ESC \).
      let end = -1;
      let endLen = 0;
      for (let i = start + 2; i < pending.length; i++) {
        if (pending[i] === '\x07') { end = i; endLen = 1; break; }
        if (pending[i] === ESC && pending[i + 1] === '\\') { end = i; endLen = 2; break; }
      }
      if (end < 0) {
        // Unterminated: keep from the ESC ] onward, wait for more data.
        pending = pending.slice(start);
        return;
      }
      const payload = pending.slice(start + 2, end);
      pending = pending.slice(end + endLen);
      if (payload.startsWith('133;')) {
        const parts = payload.split(';');
        const kind = parts[1];
        if (kind === 'A' || kind === 'B' || kind === 'C') {
          onEvent({ kind });
        } else if (kind === 'D') {
          const code = parseInt(parts[2], 10);
          onEvent({ kind: 'D', code: Number.isFinite(code) ? code : null });
        } else if (kind === 'E') {
          const raw = Buffer.from(parts.slice(2).join(';'), 'latin1').toString('utf8');
          onEvent({ kind: 'E', command: unescapeCommand(raw) });
        }
        // Unknown 133 kinds are ignored.
      }
      // Non-133 OSC sequences are skipped (boundaries still respected).
    }
  }
  return { feed };
}

module.exports = { createOsc133Parser, unescapeCommand };
