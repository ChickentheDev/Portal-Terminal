// Command explainer/fixer: building the turn a failed block's
// "Explain" button sends to the agent. Pure Node — no Electron deps
// — so it is unit-testable with plain `node tests/explainer.test.js`.
// The renderer reaches these as window.PortalExplainer (loaded as a
// plain <script> in index.html); the preload cannot require() this
// file — in this Electron build the preload's require() resolves only
// the 'electron' module.
'use strict';

// Terminal output attached to an Explain turn, in characters.
// NOTE: top-level names in this file are prefixed EXPLAIN_ / explain
// because every plain <script> in index.html shares one global scope:
// slashcmds.js already declares MAX_OUTPUT_CHARS, truncateOutput, and
// buildExplainMessage, and a second `const MAX_OUTPUT_CHARS` throws a
// SyntaxError that aborts the whole page load (the function names
// would silently shadow instead). Keep the prefix.
const EXPLAIN_MAX_OUTPUT_CHARS = 4096;

// Truncate terminal output middle-out, the files:read precedent.
// Returns { text, truncated }: the marker inside the text says so
// too, so a reader of the stored message can see the cut.
function truncateExplainOutput(text) {
  const t = String(text || '');
  if (t.length <= EXPLAIN_MAX_OUTPUT_CHARS) return { text: t, truncated: false };
  const h = Math.floor(EXPLAIN_MAX_OUTPUT_CHARS / 2);
  return {
    text: t.slice(0, h) + '\n...[output truncated to 4 KB]...\n' + t.slice(-h),
    truncated: true,
  };
}

// The full user message for an Explain turn. `block` is
// { command, exitCode, output, status } — the failed block plus the
// focused pane's buffer tail as its output. The message starts with
// /explain (the slash command's first line, so chat history and
// search stay consistent), names the command and exit code, and
// instructs the agent to diagnose first and then propose the
// corrected command by calling run_command — the approval card only
// exists when the agent makes the tool call, so a diagnosis that
// only pastes the command in prose would leave the user
// copy-pasting.
function buildExplainerMessage(block) {
  const b = block || {};
  const cmd = b.command ? String(b.command) : '(unknown command)';
  const code = typeof b.exitCode === 'number' ? 'exit code ' + b.exitCode : 'no exit code recorded';
  const running = b.status === 'running' ? ' (still running)' : '';
  const out = truncateExplainOutput(b.output || '');
  let msg = '/explain\n\n'
    + 'The terminal command `$ ' + cmd + '` failed with ' + code + running + '. '
    + 'The recent terminal output is below.\n\n'
    + 'Diagnose the error first — what went wrong and why. Then, if there is a corrected command, propose it by calling the run_command tool with the corrected command, so I can approve it before it runs. You may also show the corrected command in your reply text. If there is no safe fix, say so and do not call run_command.\n\n'
    + '```\n' + out.text + '\n```';
  if (out.truncated) msg += '\n\nOutput truncated to the last 4 KB.';
  return msg;
}

const Explainer = {
  MAX_OUTPUT_CHARS: EXPLAIN_MAX_OUTPUT_CHARS,
  truncateOutput: truncateExplainOutput,
  buildExplainMessage: buildExplainerMessage,
};
if (typeof module !== 'undefined' && module.exports) module.exports = Explainer;
if (typeof window !== 'undefined') window.PortalExplainer = Explainer;
