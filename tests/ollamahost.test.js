// Unit tests for ollamahost.js — run: node tests/ollamahost.test.js
'use strict';
const oh = require('../ollamahost.js');

let pass = 0, fail = 0;
function check(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL ' + label); }
}
const norm = (s) => oh.normalizeHost(s);

// --- normalizeHost: the default and the already-good forms ---
check(JSON.stringify(norm('')) === JSON.stringify({ ok: true, host: 'http://127.0.0.1:11434' }), 'empty input means the default host');
check(JSON.stringify(norm('   ')) === JSON.stringify({ ok: true, host: 'http://127.0.0.1:11434' }), 'blank input means the default host');
check(norm('http://127.0.0.1:11434').host === 'http://127.0.0.1:11434', 'default host passes through unchanged');
check(norm('localhost:11434').host === 'http://localhost:11434', 'localhost with port gains http://');
check(norm('localhost').host === 'http://localhost:11434', 'bare localhost gains scheme and default port');

// --- normalizeHost: remote forms ---
check(norm('192.168.1.10').host === 'http://192.168.1.10:11434', 'bare LAN IP gains scheme and default port');
check(norm('192.168.1.10:11434').host === 'http://192.168.1.10:11434', 'LAN IP with port gains scheme only');
check(norm('192.168.1.10:8080').host === 'http://192.168.1.10:8080', 'explicit non-default port is kept');
check(norm('my-server').host === 'http://my-server:11434', 'bare hostname gains scheme and default port');
check(norm('my-server.local:8080').host === 'http://my-server.local:8080', 'hostname with explicit port is kept');
check(norm('http://192.168.1.10:11434').host === 'http://192.168.1.10:11434', 'full remote URL passes through');
check(norm('https://ollama.example.com').host === 'https://ollama.example.com:11434', 'https without a port still defaults to 11434');
check(norm('https://ollama.example.com:443').host === 'https://ollama.example.com:443', 'https with an explicit port keeps it');

// --- normalizeHost: cleanup ---
check(norm('http://192.168.1.10:11434/').host === 'http://192.168.1.10:11434', 'trailing slash is stripped');
check(norm('http://192.168.1.10:11434///').host === 'http://192.168.1.10:11434', 'several trailing slashes are stripped');
check(norm('http://192.168.1.10:11434/ollama').host === 'http://192.168.1.10:11434', 'a path is dropped, origin only');
check(norm('http://192.168.1.10:11434/?x=1').host === 'http://192.168.1.10:11434', 'query and path are dropped');
check(norm('HTTP://192.168.1.10:11434').host === 'http://192.168.1.10:11434', 'uppercase scheme is lowercased');
check(norm('  192.168.1.10  ').host === 'http://192.168.1.10:11434', 'surrounding whitespace is trimmed');

// --- normalizeHost: IPv6 ---
check(norm('::1').host === 'http://[::1]:11434', 'bare ::1 is bracketed and takes the default port');
check(norm('[::1]').host === 'http://[::1]:11434', 'bracketed ::1 takes the default port');
check(norm('[::1]:11434').host === 'http://[::1]:11434', 'bracketed ::1 with port passes through');
check(norm('fe80::1').host === 'http://[fe80::1]:11434', 'bare fe80::1 is bracketed whole');
check(norm('[fe80::1]:8080').host === 'http://[fe80::1]:8080', 'bracketed IPv6 with a custom port keeps it');

// --- normalizeHost: rejection ---
check(norm('foo bar').ok === false, 'spaces inside the address are rejected');
check(norm('http://').ok === false, 'scheme with no host is rejected');
check(norm('http://:11434').ok === false, 'empty hostname is rejected');
check(norm('ftp://192.168.1.10').ok === false, 'ftp scheme is rejected');
check(norm('http://user:pass@192.168.1.10:11434').ok === false, 'userinfo in the address is rejected');
check(norm('http://user:pass@192.168.1.10:11434').error.includes('username'), 'userinfo rejection names the problem');
check(norm('http://192.168.1.10:11434/@x').host === 'http://192.168.1.10:11434', 'an @ in the path is dropped with the path');
check(norm('http://192.168.1.10:99999').ok === false, 'out-of-range port is rejected');
check(norm('http://192.168.1.10:abc').ok === false, 'non-numeric port is rejected');
check(typeof norm('foo bar').error === 'string' && norm('foo bar').error.length > 0, 'rejection carries an error message');

// --- isLocalHost ---
check(oh.isLocalHost('') === true, 'empty (default) is local');
check(oh.isLocalHost('http://127.0.0.1:11434') === true, '127.0.0.1 is local');
check(oh.isLocalHost('localhost') === true, 'bare localhost is local');
check(oh.isLocalHost('localhost:11434') === true, 'localhost with port is local');
check(oh.isLocalHost('::1') === true, 'bare ::1 is local');
check(oh.isLocalHost('[::1]:11434') === true, 'bracketed ::1 is local');
check(oh.isLocalHost('192.168.1.10') === false, 'LAN IP is not local');
check(oh.isLocalHost('http://192.168.1.10:11434') === false, 'LAN IP with port is not local');
check(oh.isLocalHost('ollama.example.com') === false, 'remote hostname is not local');
check(oh.isLocalHost('foo bar') === false, 'unparseable input is not local');
check(oh.isLocalHost('198.19.0.2') === false, 'this machine\u2019s own LAN IP still counts as remote');

// --- offlineMessage ---
check(oh.offlineMessage('http://127.0.0.1:11434') === 'Ollama is offline \u2014 start it with ollama serve.', 'local offline line keeps the ollama serve advice');
check(oh.offlineMessage('192.168.1.10') === 'Can\u2019t reach Ollama at http://192.168.1.10:11434 \u2014 check the address and that Ollama is running there.', 'remote offline line names the normalized host and gives no serve advice');
check(oh.offlineMessage('192.168.1.10').includes('ollama serve') === false, 'remote offline line never mentions ollama serve');

// --- statusTooltip ---
check(oh.statusTooltip(true, '192.168.1.10') === 'Connected to Ollama', 'online tooltip is the same for any host');
check(oh.statusTooltip(false, 'http://127.0.0.1:11434') === 'Cannot reach http://127.0.0.1:11434. Run "ollama serve".', 'local offline tooltip keeps the serve advice');
check(oh.statusTooltip(false, '192.168.1.10') === 'Can\u2019t reach http://192.168.1.10:11434. Check the address.', 'remote offline tooltip names the host with no serve advice');

console.log(`ollamahost.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
