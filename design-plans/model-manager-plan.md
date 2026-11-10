# Model manager — design note

## Problem
Settings today has an "Agent model" text field and a "Pull model"
button, plus 8 hardcoded presets. Sam can't see what's actually
installed in Ollama, can't delete a model, and can't pull a Hugging
Face model without the terminal. The manager fixes that inside
Settings — no new window, no terminal.

## Goal
A Models section in the Settings modal, below the Agent-model row:
- Installed rows: name, size, modified date, Use / Delete buttons,
  a "current agent" marker on the active model, a preset label where
  the name matches an agent preset, and an HF badge on Hugging Face
  models.
- A pull row: preset select + custom-tag input + Pull, with progress
  and inline errors.
- An HF hint line explaining the tag format.
- Settings-only: none of this goes to the agent's tool list.

## IPC surface (main.js, preload.js)
- `ollama:models` → `{ ok: true, models: [{ name, size, modified_at }] }`
  or `{ ok: false, error }`. GETs `/api/tags` on `settings.host`
  (trailing slash stripped, same as `ollama:status`). `ollama:status`
  is left untouched (names only).
- `ollama:delete` → `{ ok: true }` or `{ ok: false, error }`.
  DELETEs `/api/delete` with `{ name }`. Ollama unloads an idle loaded
  model first; a model actively serving a request is refused and the
  error text is surfaced.
- `ollama:pull` reused as-is (streams `ollama:pull-progress`).
- Preload adds `listModels()` / `deleteModel()`. No new EVENTS entry
  is needed (pull progress already flows).

## Pure module (`models.js`, unit-testable, no Electron deps)
- `formatSize(bytes)` — `0 B`, `1.5 KB`, `9.0 GB` (one decimal at
  KB and up, `--` for non-finite/negative).
- `formatDate(iso)` — `Nov 10, 2026` (UTC, `--` for invalid input).
- `isHfTag(name)` — case-insensitive prefix match on `hf.co/` or
  `huggingface.co/`.
- `validatePullTag(tag)` — `{ ok: true, tag }` or `{ ok: false, error }`.
  Trims; rejects empty and any whitespace. Hugging Face tags must
  match `^(hf.co|huggingface.co)/<user>/<repo>(:<quant>)?$`
  (case-insensitive; a full `.gguf` filename works as the quant).
  Regular tags must match `^<name>(:<tag>)?$` (namespaces with `/`
  allowed, no whitespace).
- `normalizePullTag(tag)` — trim only. No quant is auto-appended:
  Ollama's own docs say no quant defaults to Q4_K_M when present,
  while one third-party doc claims the quant is required (404 without
  it). The contradiction is covered by the error path + a UI hint to
  add `:Q4_K_M`, not by rewriting what the user typed.
- `matchPreset(name, agents)` — agent whose name matches
  case-insensitively, or `name + ':latest'`; null otherwise.
- `isCurrentModel(name, current)` — same matching, for the marker.

## Renderer UI (index.html + renderer.js + styles.css)
- Markup: a `<div id="s-models" class="models">` block after the
  Agent-model label, with a header ("Models" + Refresh button), a
  `<div id="s-models-list">` for rows, a pull row (preset `<select
  id="s-models-preset">`, custom `<input id="s-models-custom">`,
  `<button id="s-models-pull">`), a status line
  (`<div id="s-models-status" class="field-hint">`), and the HF hint.
- `refreshModels()` (called from `openSettings()`): lists via
  `window.api.listModels()`, renders rows, shows the offline message
  and disables Use/Delete/Pull when Ollama is unreachable.
  Rows show name + HF badge, size + date, preset label, current
  marker, Use / Delete.
- Use: `setSettings({ model: name })` immediately, sync `#s-model`,
  `pollStatus()`, re-render rows. No Save needed, and a later Save
  can't revert it (it reads `#s-model`).
- Delete: `confirm()` first. After a successful delete, re-render;
  if the deleted model was the agent model, `setSettings({ model:
  'hermes3:8b' })`, sync `#s-model`, and show an inline note that the
  agent model fell back to hermes3:8b. Never auto-pull the fallback.
- Pull: custom input wins if non-empty, else the preset select.
  Validates with `validatePullTag` (the renderer reads the helpers as
  `window.PortalModels` — see the preload note below — single source of
  truth with the unit tests).
  Progress reuses the `ollama:pull-progress` listener pattern from
  `pullModel()` and updates the status line (per-layer %, not whole
  download). On success: status "Pulled <name>", `pollStatus()`,
  `refreshModelList()`, re-render rows. On failure: inline error; if
  the tag is HF, append "If this is a Hugging Face model, try adding
  :Q4_K_M."
- Helpers reach the renderer as `window.PortalModels`, NOT via preload:
  `models.js` is UMD-lite (Node `module.exports` + `window.PortalModels`)
  and loads in index.html as a plain `<script src="models.js">` before
  renderer.js, so the renderer and the unit tests share one
  implementation. The preload route was tried first and is impossible
  in this build: the preload's `require()` resolves only the `electron`
  module — `require('fs')` and `require('./models.js')` both throw
  "module not found" and kill the whole preload (verified with a
  minimal Electron app, same webPreferences — environmental, not
  app-specific). Preload exposes only `listModels()` / `deleteModel()`.
  `refreshModels()` guards the missing-helper case with an inline
  error instead of hanging on "Loading models…".

## Active-model delete, mid-turn
Deleting the agent's model while a turn is running fails that turn
(the next `/api/chat` gets a 404 from Ollama). The manager does not
block it — the fallback + note still apply — but this is a stated
limit, not a silent success.

## Offline behavior
`ollama:models` returns `ok: false` → the section shows "Ollama is
offline — start it with ollama serve", Use/Delete/Pull disabled, no
crash. Pull with Ollama down returns the same connection error the
existing pull path already produces.

## Hugging Face details
- Tag format: `hf.co/{user}/{repo}` or `hf.co/{user}/{repo}:{quant}`;
  `huggingface.co` works as the domain. Quant is case-insensitive
  and a full `.gguf` filename works as the tag.
- Pulled HF models appear in `/api/tags` under their full `hf.co/…`
  name, so they show in the list with sizes; rows get an HF badge
  (case-insensitive prefix match).
- Open question for live verification: whether Ollama lowercases the
  tag in `/api/tags` (preset/current matching is case-insensitive to
  be safe; the displayed name is exactly what Ollama returns).
- Gated HF repos need credentials configured on the machine — v1
  doesn't set that up. GGUF only: safetensors-only repos fail, and
  there are no HF Inference API cloud calls.

## Fake-Ollama harness extension
`/tmp/pptest/fake-ollama.js` currently serves only `/api/tags` with
one hardcoded model and scripted `/api/chat` — no `/api/pull` or
`/api/delete`. Extend it: stateful installed list (seeded with
several models including HF-tagged ones), `POST /api/pull` streaming
NDJSON progress events, `DELETE /api/delete` (404 if not installed),
and a `/__control/models` endpoint to set the installed list.
Headless harness tests then cover list/pull/delete/switch/HF/offline
against it; the real Electron launch test drives the same fake
server under Xvfb.

## Honest limits
- Pull % is per-layer, not whole-download.
- Delete of an idle loaded model unloads first; a model actively
  serving a request is refused.
- Deleting the agent's model mid-turn fails that turn.
- No tools-capability check exists in Ollama's API — any installed
  model can be switched to, including ones that can't call tools.
- No rename/alias, no bulk delete, no disk-space check before pull.
- Gated HF repos need machine credentials; GGUF only.
- Live model pulls against real Ollama are unverified in the sandbox
  (fake Ollama only); the HF tag format is verified against Ollama's
  docs, not a live pull.

## Verification
- Unit tests: size/date formatting, HF detection, tag validation,
  preset/current matching (`node tests/models.test.js`).
- Headless harness: list/pull/delete/switch/HF-tag pull/offline.
- Real Electron launch test under Xvfb with the fake Ollama: list
  installed models with sizes, pull a model, delete one, switch the
  agent model, HF tag pull, offline behavior. Zero page errors.
- Bug hunt after the build; CHANGELOG + screenshots before any
  version bump or packaging (release skill).
