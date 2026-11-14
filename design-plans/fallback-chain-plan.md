# Model fallback chain — design note

## Problem
Tonight the agent ran against the real hermes3:8b in this sandbox
and died twice on the same error:

```
Ollama returned 500. {"error":"an error was encountered while
running the model: unexpected EOF"}
```

The llama-server runner died silently mid-generation — once after
70 s on a 699-token prompt, once after 9 minutes on a one-word
probe. The VM has 7.9 GB RAM and was swapping, so the runner was
most likely OOM-killed under concurrent load. The app handled the
500 correctly (showed the error, the composer still worked
afterward), but the turn was dead. A smaller installed model would
have answered. The same failure mode exists on Sam's machine
whenever a big model is slow, missing, or crashes: the turn should
fall back to the next installed model instead of dying.

## Goal
When the agent's model fails a turn with a model error, retry the
turn with the next model in a user-configured chain — once per
model, one pass through the chain, then show the error with the
models that were tried. The user always sees that a fallback
happened, and the configured agent model never changes.

## The chain (Settings → Models → "Fallback chain")
- Master toggle "Fall back to another model if the agent model
  fails" — `settings.fallbackEnabled`, default ON.
- List of installed models (excluding the primary) with a
  checkbox and ↑/↓ buttons, in chain order. Stored as
  `settings.fallback`, an ordered array of model names.
- **Default (never configured): `fallback` is null — auto mode.**
  The chain is all other installed models, smallest first (size
  ascending from `/api/tags`). When a big model fails it is
  usually resource-related, so a smaller model is the most likely
  to load. Auto mode picks up newly installed models.
- Editing the list in Settings materializes the explicit array.
  Saving a list that matches the auto order with everything
  checked stores null again (stays auto). Unchecking everything
  stores `[]` — explicitly no fallbacks. A name in an explicit
  list that is no longer installed is skipped (named in the
  fallback line if a fallback happens); nothing is ever
  auto-pulled.
- Chain is capped at 5 models per turn. The primary is always the
  first attempt and never appears in the chain.

## When it triggers (`isModelError`, in fallbackchain.js)
Retryable — a model error, not a server or user problem:
- `Ollama returned 404` — model not found.
- `Ollama returned 500 / 502 / 503` — the runner/server died
  (tonight's exact failure).
- A stream error naming a missing model (`model 'x' not found`).
NOT retryable — another model would fail the same way, or the
user ended the turn:
- `fetch failed` / `ECONNREFUSED` / `ENOTFOUND` — Ollama itself
  is unreachable; every model lives on the same server.
- Abort / user stop (`st.stopped`) — the turn is over by choice.
- HTTP 400 and anything unrecognized — fail exactly as today.

## Retry mechanics (main, `runTurn` / `streamChat`)
- `streamChat` gains a `model` parameter (defaults to
  `settings.model`). The step loop calls a `streamChatWithFallback`
  helper instead: it tries the primary, then each chain model in
  order, with a fresh `partial` per attempt — a failed mid-stream
  fragment never lands in the assistant message.
- On a retryable error with models left, main sends a `fallback`
  event `{ chatId, from, to, reason, skipped }` and tries the
  next model. On a non-retryable error, or when the chain is
  exhausted, the last error is rethrown with the tried models
  appended: `… (tried: hermes3:8b, hermes3:3b)`.
- **Tool calls and approvals — the retry rule:** the retry
  re-runs `streamChat` with the same `chat.messages` history, so
  it continues from the last assistant step, never from scratch.
  If the primary failed before any tool call (step 0), the history
  is just the user message and the fallback starts the turn fresh.
  If a tool already ran, its result is already in the history, so
  the fallback model sees it and does NOT re-run the tool. A tool
  call that was only partially streamed when the primary died was
  never added to the history, so it never ran — the fallback may
  propose it again, and the normal approval card still applies.
  A user denial is a `[DENIED]` tool result, not an error, so it
  never triggers a fallback.
- The chain is computed lazily, only after the first retryable
  error — successful turns pay no extra `/api/tags` call. It is
  per-turn state, never persisted as the "current model".
- `runTurn` tracks the model that answered the last successful
  step (`answeredModel`) and includes it in the `done` event, so
  the sidebar can show which model actually answered.

## Visibility (renderer)
- `fallback` event → a `.fb-line` div in the chat (text only, so
  a hostile model name renders as text):
  `hermes3:8b failed (Ollama returned 500) — retrying with
  hermes3:3b`, plus `(skipped llama3.1:8b — not installed)` when
  names were skipped. The handler also `clearStream()`s, so the
  failed attempt's partial bubble is gone before the fallback's
  reply streams in.
- Sidebar model chip: `done` carries the answering model; the
  renderer keeps `S.lastAnswerModel` and `pollStatus` shows
  `hermes3:3b (fallback)` when it differs from the configured
  model. A later turn answered by the primary, or a model change
  in Settings, clears it back to the configured model text.
- The final error, when every model fails, names every model
  tried — the user is never left guessing which models were
  attempted.

## Scope / security
- No new network destinations: the chain comes from `/api/tags`
  on the already-configured Ollama host; no credentials, no pulls.
- The fallback list is validated in `settings:set` (strings only,
  trimmed, deduped, capped at 8) — a hand-edited settings.json
  cannot inject anything but model names, and a name is only ever
  sent to Ollama as the `model` field of a chat request.
- The retry never bypasses approval: a fallback-proposed tool
  still shows the approval card, and "Always run" state is
  unchanged by the retry.

## Verification
- Unit (`node tests/fallbackchain.test.js`): `isModelError`
  (500/502/503/404 and "model not found" retryable; 400, fetch
  failed, ECONNREFUSED, abort, unknown errors not), `shortReason`
  cap, `buildChain` (auto smallest-first with the primary
  excluded and unknown-size last, explicit order kept with
  missing names skipped, case-insensitive match uses the
  installed spelling, dedupe, 5-model cap, disabled → empty),
  `sanitizeFallbackList` (null, non-array, blanks, dupes, cap),
  `materializeFallback` (equals auto → null, reordered → array,
  all unchecked → []), `formatTriedError`.
- Headless harness: stubbed `window.api` + real renderer —
  firing `fallback` renders the line (hostile model name injects
  no markup), clears a live stream bubble, wrong-chat id renders
  nothing; `done` with a fallback model updates the sidebar chip
  and `done` with the primary clears it; the Settings fallback
  section renders from `listModels`, unchecking + moving rows and
  saving stores the materialized array, toggle off stores
  `fallbackEnabled: false`. Zero page errors.
- Real Electron launch test under Xvfb with the fake Ollama
  (extended: a scenario may fail `/api/chat` for named models
  with a status, and may set the `/api/tags` list): primary 500s,
  fallback answers, the request log shows hermes3:8b then
  hermes3:3b, the chat shows the fallback line, the sidebar shows
  the fallback model, settings.json still names hermes3:8b; a
  denied tool call triggers no fallback (all requests use the
  primary); with the toggle off, the same 500 ends the turn with
  one request and an error. Screenshots of the fallback line and
  the Settings section. Zero page errors.
- Bug hunt after the build; CHANGELOG + screenshots before any
  version bump or packaging (release skill).

## Honest limits
- A fallback is only as good as the next installed model: with
  one model installed, or the toggle off, a failure behaves
  exactly as today.
- The chain is tried in order with no timing budget — a slow
  model that eventually 500s costs its full generation time
  before the next model is tried.
- The fallback model sees the same history, including the primary
  model's tool results, but it has no memory of the primary's
  partial reply — a turn that died mid-sentence restarts that
  step's wording from scratch.
- The sidebar chip shows the model that answered the most recent
  turn; opening another chat does not reset it until that chat's
  next turn completes.
- A model pulled while Settings is open does not appear in the
  fallback list until the modal is reopened (the draft is built
  once per open so in-progress checkbox/reorder edits are not
  lost by a refresh).
- Live-model behavior is unverified in the sandbox (fake Ollama
  only) — the 500 that motivated this feature was seen against
  the real hermes3:8b, but the fallback path itself needs Sam's
  machine to prove end to end.

## Bug hunt record
- Headless hunt (18/18, zero page errors): missing fallback
  fields render a generic line; a fallback fired while the
  Settings modal is open leaves the modal and its list intact;
  unchecking every row stores an explicit empty chain and
  reopening shows every row unchecked; the toggle disables the
  row checkboxes and the reorder buttons (and re-enables them);
  the ↑/↓ bounds are disabled; saving with no models installed
  keeps auto mode (`fallback: null`) across two saves; a
  model-less `done` leaves the sidebar chip alone.
- Real-app launch hunt (22/22, zero page/console errors): both
  models failing shows the error with `(tried: hermes3:8b,
  hermes3:3b)`; a 404 retries like a 500; a failure after a tool
  ran retries with the tool result in the history and runs the
  tool exactly once (requests 8b, 8b, 3b); saving Settings
  untouched converts an explicit chain equal to auto back to
  null; auto mode retries with the smaller installed model; an
  explicit chain naming a missing model skips it and names it in
  the fallback line.
- No app bugs found. Two hunt-script issues were fixed in the
  scripts, not the app: the after-tool assertions read the
  request log before the turn finished (the first reply's text
  matched the wait too early — now waits for the second
  occurrence), and the two-launch hunt reused one CDP port so
  the second launch connected to the first launch's orphaned
  Electron (now a distinct port per launch plus a profile-based
  process sweep in `killApp`).
- Not covered live: stopping mid-fallback-attempt (the fake
  answers too fast to stop mid-stream). The code path is the
  existing stop path — `st.stopped` is checked before any
  fallback and the in-progress partial is preserved via the
  holder — but it is unproven in the running app.
