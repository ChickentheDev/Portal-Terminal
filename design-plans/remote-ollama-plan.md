# Remote Ollama host — design note

## Problem
Portal only really works against a local Ollama. The Settings modal
already has an "Ollama address" field and every main-process Ollama
call reads `settings.host`, but two things make a remote host fail in
practice:

1. A bare host (`192.168.1.10`) is normalized to `http://192.168.1.10`
   — port 80, not Ollama's 11434 — so it silently never connects.
2. Nothing validates the address, and every offline message tells the
   user to run `ollama serve`, which is the wrong advice for a machine
   they are not sitting at. Changing the host also never refreshes
   the model list shown below the field, so the Models section keeps
   showing the old host's models until Settings is reopened.

## Goal
Type an address like `192.168.1.10` (or a hostname, or a full URL)
into the Ollama address field and have status, the model list, pull,
delete, and the agent's chat requests all talk to that host. Local
behavior must not change for existing users: the default stays
`http://127.0.0.1:11434`.

## Pure module (`ollamahost.js`, unit-testable, no Electron deps)
UMD-lite like `models.js` / `gitstatus.js`: `module.exports` for Node
tests and main, `window.PortalOllamaHost` from a plain `<script>` in
index.html before renderer.js. The preload CANNOT require() it.
- `normalizeHost(input)` → `{ ok: true, host }` or `{ ok: false,
  error }`. Trims; empty input means the default host. Rejects
  whitespace anywhere. Adds `http://` when there is no scheme. A
  bare IPv6 literal (`::1`, `fe80::1`) is bracketed; a bracketed
  literal is left alone. Strips trailing slashes and any
  path/query/hash — only the origin is kept. When no port is given,
  appends `:11434` (Ollama's port, whatever the scheme). Only
  http/https are accepted; a bad port, a missing hostname, or an
  unparseable address returns an error string fit for an inline
  error line. A username/password in the address (`user:pass@host`)
  is refused with its own error — no login support in v1, so it is
  never silently dropped or sent. The tag is never rewritten beyond
  this: an explicit port is always kept, and the host is lowercased
  only where the URL parser does it.
- `isLocalHost(host)` — true for `127.0.0.1`, `localhost`, `::1`,
  `[::1]`; false for anything else and for unparseable input
  (an unparseable host cannot be auto-started anyway).
- `offlineMessage(host)` — local: the existing line, "Ollama is
  offline — start it with ollama serve." Remote: "Can't reach
  Ollama at <host> — check the address and that Ollama is running
  there." No `ollama serve` advice for a remote host.
- `statusTooltip(ok, host)` — online: "Connected to Ollama". Local
  offline: the existing `Cannot reach <host>. Run "ollama serve".`
  Remote offline: `Can't reach <host>. Check the address.`

## Main (`main.js`)
- `require('./ollamahost.js')` (main can require local modules; only
  the preload cannot). The inline `normHost` is replaced by
  `normalizeHost` in `loadSettings` and in `settings:set` — an
  invalid saved host falls back to the previous host on set and to
  the default on load, so a bad value can never be persisted.
- `ensureOllama` uses `isLocalHost(settings.host)` instead of its
  inline hostname list; a remote host never triggers a local
  `ollama serve` spawn.
- No other main change is needed: `ollama:status`, `ollama:models`,
  `ollama:pull`, `ollama:delete`, and the agent's `/api/chat` request
  already build their URLs from `settings.host`. Their existing
  "Could not reach Ollama at <host>" errors are already host-aware.

## Renderer UI (index.html + renderer.js + styles.css)
- The Ollama address field gets a one-line hint: a remote address
  works, the port defaults to 11434, no login support yet.
- The host field applies live on `change` (blur after editing):
  valid + different → save just the host via `setSettings`, rewrite
  the field to the normalized form, refresh the sidebar status and
  the model list in place, and note the new host in the Models
  status line. Invalid → the error in the Models status line and
  the field reverts to the saved host. If the helpers fail to load,
  the handler does nothing and the Save path below still applies.
- `saveSettings` validates the host first and refuses to save (modal
  stays open, error in the Models status line) when it is invalid —
  the backstop for a host typed and saved without blurring.
- `refreshModels` uses `offlineMessage` for its offline line, so a
  remote host that does not answer says so and names the host; the
  Pull button stays disabled, exactly as today.
- `pollStatus` uses `statusTooltip` for the sidebar dot's tooltip.
- "Start Ollama automatically" is disabled (with a title explaining
  why) while the field holds a remote host, and re-enabled for a
  local one — it is a no-op for remote hosts in main, and the UI
  now says so instead of silently ignoring it. The saved
  `autoOllama` value is untouched; it applies again if the host
  comes back to local.
- `saveSettings` awaits `pollStatus()` and refreshes the model
  datalist after a save, so a host change is visible in the sidebar
  immediately.

## Scope / security
No auth or token support in v1 — a remote host must be reachable
without credentials (same as `OLLAMA_HOST` on the command line).
The host string is only ever used as a fetch base URL; it is never
passed to a shell. A hostile host value can at most make the app
fetch from a server the user typed in themselves. No new IPC
channel; the existing `settings:set` / `ollama:*` surface is
unchanged.

## Verification
- Unit: normalization (bare host/IP/hostname, scheme, explicit
  port, trailing slash, path stripping, IPv6 bare + bracketed,
  https, uppercase, empty → default) and rejection (whitespace,
  `http://`, bad port, ftp scheme); `isLocalHost`; both offline
  messages; both tooltip forms (`node tests/ollamahost.test.js`).
- Headless harness: stubbed `window.api` with two fake hosts —
  change the field to the remote host and the list swaps to that
  host's models, change to a dead host and the offline line names
  it with Pull disabled, invalid host is refused and the field
  reverts, bare host normalizes to `:11434` in the field, auto-start
  disables for remote and re-enables for local, sidebar tooltip is
  host-aware. Zero page errors.
- Real Electron launch test under Xvfb with two fake Ollama servers
  on non-default loopback ports (the sandbox network only permits
  127.0.0.1 — no non-loopback address is connectable, so the
  remote-specific strings are proven by the harness instead):
  status online against the configured host, model list shows that
  host's models, a pull against the host lands in its list, switching
  to the second fake swaps the list, switching to a dead port shows
  the offline state, and an agent chat turn goes to the configured
  host. Screenshots of the Settings host field and the model list.
  Zero page errors.
- Bug hunt after the build; CHANGELOG + screenshots before any
  version bump or packaging (release skill).

## Honest limits
- No auth/token support: the remote Ollama must allow unauthenticated
  requests (Ollama's default on a LAN). A host behind a proxy that
  needs credentials will just read as offline.
- A pull's progress streams from the host the pull started against;
  changing the host mid-pull does not retarget the in-flight pull.
- The model list shows the host at refresh time; a model pulled or
  deleted elsewhere only appears after a refresh.
- HTTPS to a host with a self-signed certificate will fail the fetch
  (Node's default TLS verification) and read as offline.
- `localhost` stays local even if it resolves elsewhere; a LAN IP
  that happens to be this machine is treated as remote.
