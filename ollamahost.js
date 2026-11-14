// Remote Ollama host helpers: address normalization, local-vs-remote
// detection, and host-aware offline text. Pure Node — no Electron
// deps — so it is unit-testable with plain
// `node tests/ollamahost.test.js`. Main requires it directly; the
// renderer reaches it through the plain <script> in index.html
// (the preload cannot require() local modules in this Electron
// build — see models.js).
'use strict';

const DEFAULT_HOST = 'http://127.0.0.1:11434';
const DEFAULT_PORT = '11434';
const LOCAL_HOSTNAMES = ['127.0.0.1', 'localhost', '::1', '[::1]'];

// Normalize a user-typed Ollama address to a fetchable base URL.
// Returns { ok: true, host } or { ok: false, error } with a message
// fit for an inline error line. Rules:
//   - empty input means the default local host;
//   - no whitespace anywhere;
//   - no scheme means http:// (the 0.2.0 bare-host fix);
//   - a bare IPv6 literal (no brackets) is bracketed whole — it
//     takes the default port; use [::1]:11434 for a custom port;
//   - trailing slashes and any path/query/hash are dropped — only
//     the origin is kept;
//   - no port means :11434 (Ollama's port, whatever the scheme);
//   - only http/https are accepted.
// An explicit port is always kept, and nothing else is rewritten.
function normalizeHost(input) {
  const raw = String(input || '').trim();
  if (!raw) return { ok: true, host: DEFAULT_HOST };
  if (/\s/.test(raw)) {
    return { ok: false, error: 'Ollama addresses can\u2019t contain spaces.' };
  }
  const s = raw.replace(/\/+$/, '');
  if (!s || /^[a-z][a-z0-9+.-]*:$/i.test(s)) {
    return { ok: false, error: 'Enter an Ollama address, e.g. 192.168.1.10 or http://192.168.1.10:11434.' };
  }
  const schemeMatch = s.match(/^([a-z][a-z0-9+.-]*:\/\/)/i);
  const scheme = schemeMatch ? schemeMatch[1] : 'http://';
  // Only slice the scheme off when the input actually had one — a
  // bare "localhost:11434" must keep all of its characters.
  const rest = schemeMatch ? s.slice(scheme.length) : s;
  const authority0 = rest.split('/')[0];
  if (!authority0) {
    return { ok: false, error: 'Enter an Ollama address, e.g. 192.168.1.10 or http://192.168.1.10:11434.' };
  }
  // No login support in v1: a username/password in the address is
  // refused outright instead of being silently dropped or sent.
  if (authority0.includes('@')) {
    return { ok: false, error: 'Ollama addresses don\u2019t include a username or password \u2014 no login support yet.' };
  }
  // A bare IPv6 literal has more than one colon and no brackets.
  // Bracket the whole authority: ::1:11434 is an IPv6 address, not
  // host ::1 on port 11434, so a custom port needs [::1]:11434.
  let authority = authority0;
  if (!authority.startsWith('[') && (authority.match(/:/g) || []).length > 1) {
    authority = '[' + authority + ']';
  }
  let u;
  try {
    u = new URL(scheme + authority + rest.slice(authority0.length));
  } catch {
    return { ok: false, error: 'That doesn\u2019t look like an Ollama address. Try 192.168.1.10 or http://192.168.1.10:11434.' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, error: 'Ollama addresses use http:// or https://.' };
  }
  if (!u.hostname) {
    return { ok: false, error: 'Enter an Ollama address, e.g. 192.168.1.10 or http://192.168.1.10:11434.' };
  }
  // The URL parser drops a port that is the scheme's default
  // (u.port is '' for http://host:80 and https://host:443), so an
  // explicit port is read off the authority text instead — an
  // explicit port is always kept, whatever its value.
  const portMatch = authority.match(/^(?:\[.*\]|[^:]+):(\d+)$/);
  const port = portMatch ? portMatch[1] : DEFAULT_PORT;
  return { ok: true, host: `${u.protocol}//${u.hostname}:${port}` };
}

// True when the host is this machine. An unparseable host is not
// local — it cannot be auto-started anyway.
function isLocalHost(host) {
  const v = normalizeHost(host);
  if (!v.ok) return false;
  let hostname;
  try {
    hostname = new URL(v.host).hostname;
  } catch {
    return false;
  }
  return LOCAL_HOSTNAMES.includes(hostname);
}

// The offline line for the model manager. A remote host never gets
// "start it with ollama serve" — that is the wrong advice for a
// machine the user is not sitting at.
function offlineMessage(host) {
  if (isLocalHost(host)) return 'Ollama is offline \u2014 start it with ollama serve.';
  const v = normalizeHost(host);
  const shown = v.ok ? v.host : String(host || '').trim();
  return `Can\u2019t reach Ollama at ${shown} \u2014 check the address and that Ollama is running there.`;
}

// The sidebar status dot's tooltip.
function statusTooltip(ok, host) {
  if (ok) return 'Connected to Ollama';
  const v = normalizeHost(host);
  const shown = v.ok ? v.host : String(host || '').trim();
  return isLocalHost(host)
    ? `Cannot reach ${shown}. Run "ollama serve".`
    : `Can\u2019t reach ${shown}. Check the address.`;
}

// Exported two ways, one source of truth:
//  - Node (unit tests, main): require('./ollamahost.js')
//  - Browser (renderer, via <script src="ollamahost.js"> in index.html):
//    window.PortalOllamaHost. The preload cannot require() this file.
const OllamaHost = {
  DEFAULT_HOST,
  DEFAULT_PORT,
  LOCAL_HOSTNAMES,
  normalizeHost,
  isLocalHost,
  offlineMessage,
  statusTooltip,
};
if (typeof module !== 'undefined' && module.exports) module.exports = OllamaHost;
if (typeof window !== 'undefined') window.PortalOllamaHost = OllamaHost;
