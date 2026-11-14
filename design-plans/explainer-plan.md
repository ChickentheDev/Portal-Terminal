# Command explainer/fixer — design note

## Problem
`/explain` already explains the last terminal command — but only from
the chat input, and only for the last block. When a command fails in
the terminal, the failure is right there in the blocks rail; the user
should be able to click it and get a diagnosis plus a corrected
command, without retyping anything or hunting for the block.

## Goal
A failed command block in the blocks rail gets an "Explain" button
(next to Copy/Rerun). One click sends that block's command, exit code,
and output tail to the agent with a prompt to diagnose the error and
propose a corrected command. The corrected command comes back through
the agent's normal `run_command` tool call, so it lands in the
existing approval card (Run / Deny / Always run) — it must NEVER
auto-run, and no new approval path is invented.

## The button (terminal.js `renderBlocks`)
- Shown only on failed blocks: `b.status === 'done'` with a non-zero
  `b.exitCode` — exactly the condition that already gives the row the
  `failed` class. Running blocks, cancelled blocks (Ctrl+C, exit 130
  by the shell — the user stopped it, it did not fail), and
  tracker-fallback blocks with no exit code get no button.
- Reuses the `.tb-btn` style, `textContent` only. The click handler
  builds the payload from the block and the focused pane's buffer
  tail and calls a new `T.opts.onExplain` callback — the rail never
  sends a turn itself.
- `_blocks` gains a `render` test seam (`renderBlocks`) so the
  headless harness can re-render the rail after pushing a fake block
  into the active tab. The hook is a test seam, not UI surface
  (the existing `_blocks` comment).

## The turn (renderer.js `onExplain`)
The renderer passes `onExplain` into `TermUI.init`:
- If a turn is already running, refuse with the composer hint flash
  ("Wait for the current turn to finish.") — `sendMessage` would
  otherwise STOP the running turn, which is never what a click means.
- Otherwise build the message with `window.PortalExplainer` and call
  `sendMessage(text)`, then switch to the split view so the diagnosis
  streams visibly (the Ask-AI precedent — the user clicked in the
  terminal, the answer lands in the chat).
- No `S.cur` (should not happen after init) → do nothing.

## The message (`explainer.js`, UMD-lite)
`buildExplainMessage(block)` — block is `{ command, exitCode,
output, status }`. The message starts with `/explain` (same first
line as the slash command, so chat history and search stay
consistent), names the command and its exit code, and attaches the
output in a fenced block:

```
/explain

The terminal command `$ npm test` failed with exit code 1. The recent terminal output is below.

Diagnose the error first — what went wrong and why. Then, if there is a corrected command, propose it by calling the run_command tool with the corrected command, so I can approve it before it runs. You may also show the corrected command in your reply text. If there is no safe fix, say so and do not call run_command.

```
<output tail, capped at 4 KB>
```
```

The prompt is deliberately explicit about calling `run_command`:
the approval card only exists when the agent makes the tool call,
so a diagnosis that only pastes the command in prose would leave
the user copy-pasting. The "if there is no safe fix, say so" line
keeps the agent from inventing a fix for an environmental failure.

## The output (cap 4 KB)
`MAX_OUTPUT_CHARS = 4096`. The output is the focused pane's buffer
tail (`bufferTail(tab.term, 30)`, the `/explain` precedent) —
blocks store command + exit code + duration but no output text, so
there is no per-block output to attach. `truncateOutput` cuts
middle-out (first half + marker + last half, the files:read
precedent) and the message adds "Output truncated to the last
4 KB." when it cut. The message words it as "recent terminal
output", never "this command's output".

## The corrected command (existing flow, no new code)
The agent's `run_command` call goes through `handleCall` in main.js
exactly like any agent command: `askApproval` shows the approval
card with the exact command, the user clicks Run / Deny / Always
run, and only Run executes it (in the chat's working directory,
via `runShell`). Nothing in this feature touches that path — the
prompt is the only thing that makes the card appear.

## Scope / security
- Read-only context gathering (one buffer tail, no shell, no
  writes). The output is attached to the user message, so it is
  stored in the chat file like any message — capped at 4 KB.
- The button is per-block and per-tab: the rail only shows the
  active tab's blocks, so Explain always explains a block the user
  can see. A block in another tab has no button until that tab is
  active.
- No new IPC, no new settings, no new approval path.

## Verification
- Unit: truncation (short passthrough, long middle-out with marker,
  exactly-at-cap, empty), message builder (command + exit code +
  output present, truncated note only when cut, run_command
  instruction present, no-exit-code and cancelled-block shapes).
  (`node tests/explainer.test.js`)
- Headless harness: stubbed `window.api` + real TermUI — push a
  fake failed block into the active tab, re-render the rail through
  `_blocks.render`, the Explain button appears on the failed row
  only (not on a successful row, not on a running row), clicking
  it sends a turn carrying the command, exit code, and output;
  clicking while a turn is running sends nothing and flashes the
  hint; hostile command text renders as text. Zero page errors.
- Real Electron launch test under Xvfb with the fake Ollama: run a
  failing command, click Explain, verify the turn carries the
  command + exit code + output; a scripted scenario replies with a
  diagnosis plus a `run_command` tool call, and the approval card
  appears with the corrected command; Deny runs nothing, Run runs
  the corrected command and its output lands in the chat.
  Screenshots of the failed block with the Explain button and of
  the diagnosis + approval card. Zero page errors.
- Bug hunt after the build; CHANGELOG + screenshots before any
  version bump or packaging (release skill). The hunt ran a
  headless edge script (8/8) and a real-terminal launch script
  (12/12), both with zero page/console errors. It found one real
  bug in the app, in `terminal.js` `refine()` — an OSC 133 anchor
  race: the B handler captures the cursor lazily via
  `term.write('', cb)`, so a fast typist can move the cursor past
  the prompt end before it fires, and `commandFromAnchor` then
  slices off the start of the command (`ls /nope` recorded as
  `/nope`). The fix accepts the anchor text only when it CONTAINS
  the E command (E comes from the shell, so the true command always
  contains it); otherwise it keeps E. The hunt also confirmed the
  pre-existing 0.3.0 anchor window: the anchor lives only 200 ms
  after the prompt, so a slow-typed compound command keeps the
  first simple command (`echo a; echo b` recorded as `echo a`) —
  never a truncated fragment. Three test-script bugs, not app bugs:
  the headless bughunt's 30-line tail never reached the 4 KB cap
  at 1280 px (wrapped lines top out near 3,000 chars — widened the
  viewport to 2,400 px so the cap engages), the launch bughunt
  called a Node-side helper inside `page.evaluate` (now passed as
  the evaluated function), and `page.keyboard.press('Control+c')`
  is not a valid key name (now down/up Control around 'c'). The
  headless harness itself flaked 2-in-4 on the held-turn refusal
  until the cause was found: Enter while a turn is running is the
  STOP action, so pressing it before the stubbed 'done' fires
  silently stops the old turn instead of sending the held one —
  the harness now waits for the send button to return to Send
  before starting the held turn, and passes 14/14 six runs in a
  row.

## Honest limits
- The attached output is the focused pane's recent buffer tail,
  not the failed command's own output — if later commands already
  scrolled it, the tail may include newer output. The message says
  so ("recent terminal output").
- The corrected command runs in the chat's working directory, like
  every agent command — if the failed command ran in a different
  directory (a `cd` in the terminal tab), the agent's fix may need
  a `cd` prefix; the approval card shows the exact command, so the
  user can spot that before approving.
- The card only appears if the agent actually calls `run_command`.
  A model that answers in prose only leaves the user copy-pasting —
  the prompt instructs the tool call, but a model can ignore it.
- Clicking Explain while a turn is running does nothing (the hint
  says why) — the explanation waits for the current turn.
