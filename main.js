const { app, BrowserWindow, ipcMain, dialog, clipboard, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// Linux (including SteamOS) often can't use Chromium's SUID sandbox for a
// user-installed Electron. This app only loads its own local files.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('disable-dev-shm-usage'); // fixes /dev/shm errors on Deck
  app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor');
  // Helps black screen / Vulkan issues on Steam Deck
  app.commandLine.appendSwitch('use-gl', 'swiftshader');
  app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform');
  app.commandLine.appendSwitch('ozone-platform', 'x11');
}

app.setName('Portal Terminal');
if (process.platform === 'win32') app.setAppUserModelId('com.portalterminal.app');


const IS_WIN = process.platform === 'win32';

// Resolve resources that must live outside the asar (Python can't read inside .asar)
function resourcePath(...parts) {
  const candidates = [];
  if (app.isPackaged) {
    // extraResources location (preferred)
    candidates.push(path.join(process.resourcesPath, ...parts));
    // asarUnpack location (fallback)
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', ...parts));
  }
  // development
  candidates.push(path.join(__dirname, ...parts));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  // last resort – return the first candidate so the error message is useful
  return candidates[0];
}

const CWD_MARKER = '__CWD_MARKER__';
const MAX_OUTPUT_CHARS = 6000;

const DEFAULT_INSTRUCTIONS = `You are a friendly, careful assistant chatting with the user and working in their terminal.
- Talk naturally. Answer questions directly; only use the terminal when it helps.
- Use the run_command tool to execute shell commands, one step at a time, and read each result before deciding the next step.
- Prefer simple, non-destructive commands. Never delete, move, or overwrite files unless the user clearly asked for it.
- If a command fails, read the error and try a different approach.
- Commands cannot read keyboard input, so avoid anything interactive (use flags like -y).
- If the request is unclear, ask the user a short question instead of guessing.
- When you finish, reply in plain text with a short summary of what you did.`;

const DEFAULT_SETTINGS = {
  host: 'http://127.0.0.1:11434',
  model: 'gpt-oss:20b',
  ctx: 8192,
  maxSteps: 15,
  timeout: 120,
  theme: 'dark',
  startDir: os.homedir(),
  instructions: DEFAULT_INSTRUCTIONS,
  termFont: 13,
  shell: '',
  autoOllama: true,
};

const BLOCKED_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?(-[a-zA-Z]*f[a-zA-Z]*\s+)?(\/|~|\$HOME)\s*($|;|&)/i,
  /\bmkfs\b/i,
  /\bdd\b.*\bof=\/dev\//i,
  /:\(\)\s*\{.*\};\s*:/,
  /\b(shutdown|reboot|halt|poweroff)\b/i,
  />\s*\/dev\/sd[a-z]/i,
  /\bchmod\s+-R\s+777\s+\/\s*$/i,
  /\bformat\s+[a-zA-Z]:/i,
  /\bRemove-Item\b.*-Recurse.*[A-Za-z]:\\\s*$/i,
];

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: "Run a shell command in the user's terminal and return its output.",
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'The shell command to run.' } },
        required: ['command'],
      },
    },
  },
];

let win = null;
let chatsDir, settingsFile;
let settings = { ...DEFAULT_SETTINGS };
let autoRun = false; // never persisted: every launch starts in "ask first" mode
const live = new Map(); // chatId -> { abort, child, approval, exec, stopped }
const pendingApprovals = new Map(); // callId -> resolve(decision)
const terms = new Map(); // terminal id -> child process (pty bridge)
let termSeq = 0;
let pythonBin = undefined;
let ollamaChild = null; // set only if this app started `ollama serve`

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

/* ---------- storage ---------- */

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
function saveSettings() {
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}

const chatPath = (id) => path.join(chatsDir, String(id).replace(/[^a-z0-9]/gi, '') + '.json');
const readChat = (id) => JSON.parse(fs.readFileSync(chatPath(id), 'utf8'));
function writeChat(chat) {
  chat.updated = Date.now();
  fs.writeFileSync(chatPath(chat.id), JSON.stringify(chat));
}
function newChat() {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const chat = { id, title: 'New chat', created: Date.now(), updated: Date.now(), cwd: settings.startDir, messages: [] };
  writeChat(chat);
  return chat;
}
function purgeEmptyChats() {
  for (const f of fs.readdirSync(chatsDir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const c = JSON.parse(fs.readFileSync(path.join(chatsDir, f), 'utf8'));
      if (!c.messages || !c.messages.length) fs.unlinkSync(path.join(chatsDir, f));
    } catch {}
  }
}
function listChats(q) {
  const out = [];
  const ql = (q || '').trim().toLowerCase();
  for (const f of fs.readdirSync(chatsDir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const c = JSON.parse(fs.readFileSync(path.join(chatsDir, f), 'utf8'));
      if (!c.messages.length) continue;
      if (ql) {
        const hit =
          c.title.toLowerCase().includes(ql) ||
          c.messages.some(
            (m) =>
              (m.content || '').toLowerCase().includes(ql) ||
              ((m.meta && m.meta.command) || '').toLowerCase().includes(ql)
          );
        if (!hit) continue;
      }
      out.push({ id: c.id, title: c.title, updated: c.updated });
    } catch {}
  }
  return out.sort((a, b) => b.updated - a.updated);
}

function chatToMarkdown(chat) {
  const lines = [`# ${chat.title}`, ''];
  for (const m of chat.messages) {
    if (m.role === 'user') lines.push('**You**', '', m.content, '');
    else if (m.role === 'assistant' && m.content && m.content.trim()) lines.push('**AI**', '', m.content.trim(), '');
    else if (m.role === 'tool') {
      const meta = m.meta || {};
      lines.push('```bash', `$ ${meta.command || ''}`, '```');
      if (meta.status === 'ran') lines.push('```', m.content, '```');
      else lines.push(`_${meta.status || 'skipped'}_`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

/* ---------- model ---------- */

function systemPrompt(chat) {
  const osName = IS_WIN ? 'Windows (PowerShell)' : process.platform === 'darwin' ? 'macOS (bash/zsh)' : 'Linux (bash)';
  return `${settings.instructions}\n\nOS: ${osName}.\nCurrent directory: ${chat.cwd}\nHome directory: ${os.homedir()}`;
}

function toApi(chat) {
  const msgs = [{ role: 'system', content: systemPrompt(chat) }];
  for (const m of chat.messages) {
    if (m.role === 'user') msgs.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      const a = { role: 'assistant', content: m.content || '' };
      if (m.tool_calls && m.tool_calls.length) {
        a.tool_calls = m.tool_calls;
        if (m.thinking) a.thinking = m.thinking;
      }
      msgs.push(a);
    } else if (m.role === 'tool') {
      msgs.push({ role: 'tool', tool_name: m.tool_name || 'run_command', content: m.content });
    }
  }
  return msgs;
}

async function streamChat(chat, signal, out) {
  const res = await fetch(settings.host.replace(/\/$/, '') + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: settings.model,
      messages: toApi(chat),
      tools: TOOLS,
      stream: true,
      options: { num_ctx: Number(settings.ctx) || 8192 },
    }),
  });
  if (!res.ok) {
    let t = '';
    try { t = await res.text(); } catch {}
    throw new Error(`Ollama returned ${res.status}. ${t.slice(0, 300)}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const handle = (line) => {
    if (!line.trim()) return;
    let j;
    try { j = JSON.parse(line); } catch { return; }
    if (j.error) throw new Error(j.error);
    const m = j.message || {};
    if (m.thinking) { out.thinking += m.thinking; send('stream', { chatId: chat.id, thinking: m.thinking }); }
    if (m.content) { out.content += m.content; send('stream', { chatId: chat.id, content: m.content }); }
    if (m.tool_calls) out.tool_calls.push(...m.tool_calls);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      handle(buf.slice(0, idx));
      buf = buf.slice(idx + 1);
    }
  }
  handle(buf);
}

/* ---------- commands ---------- */

const isBlocked = (cmd) => BLOCKED_PATTERNS.some((re) => re.test(cmd));

function killTree(child) {
  if (!child || !child.pid) return;
  try {
    if (IS_WIN) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else process.kill(-child.pid, 'SIGKILL');
  } catch {}
}

function runShell(command, cwd, st) {
  return new Promise((resolve) => {
    if (!fs.existsSync(cwd)) cwd = os.homedir();
    let bin, argv;
    if (IS_WIN) {
      bin = 'powershell';
      argv = ['-NoProfile', '-Command', `${command}\nWrite-Output "${CWD_MARKER}$((Get-Location).Path)"`];
    } else {
      bin = 'bash';
      argv = ['-c', `${command}\n__rc=$?\necho "${CWD_MARKER}$(pwd)"\nexit $__rc`];
    }
    let child;
    try {
      child = spawn(bin, argv, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: !IS_WIN });
    } catch (e) {
      return resolve({ output: `[ERROR] ${e.message}`, cwd, code: -1 });
    }
    st.child = child;
    let out = '', err = '', timedOut = false;
    const CAP = 2_000_000;
    child.stdout.on('data', (d) => { if (out.length < CAP) out += d; });
    child.stderr.on('data', (d) => { if (err.length < CAP) err += d; });
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, (Number(settings.timeout) || 120) * 1000);
    child.on('error', (e) => {
      clearTimeout(timer);
      st.child = null;
      resolve({ output: `[ERROR] ${e.message}`, cwd, code: -1 });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      st.child = null;
      let newCwd = cwd;
      const lines = [];
      for (const line of out.split('\n')) {
        if (line.startsWith(CWD_MARKER)) newCwd = line.slice(CWD_MARKER.length).trim() || cwd;
        else lines.push(line);
      }
      let text = lines.join('\n').replace(/\s+$/, '');
      if (err.trim()) text += `\n[stderr]\n${err.trim()}`;
      if (timedOut) text += `\n[timed out after ${settings.timeout}s and was killed]`;
      if (st.stopped) text += '\n[stopped by user]';
      if (text.length > MAX_OUTPUT_CHARS) {
        const h = MAX_OUTPUT_CHARS / 2;
        text = text.slice(0, h) + '\n...[output truncated]...\n' + text.slice(-h);
      }
      resolve({ output: text.trim(), cwd: newCwd, code });
    });
  });
}

function askApproval(chatId, st, command) {
  return new Promise((resolve) => {
    const callId = Math.random().toString(36).slice(2);
    st.approval = { callId, command };
    pendingApprovals.set(callId, (d) => {
      st.approval = null;
      resolve(d);
    });
    send('approval', { chatId, callId, command });
  });
}

async function handleCall(chat, st, call, add) {
  const name = call.function && call.function.name;
  let args = (call.function && call.function.arguments) || {};
  if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
  const command = String(args.command || '').trim();
  const tool = (content, status, extra = {}) =>
    add({ role: 'tool', tool_name: name || 'run_command', content, meta: { command: command || String(name), status, ...extra } });

  if (name !== 'run_command') return tool(`Unknown tool: ${name}`, 'error');
  if (st.stopped) return tool('[STOPPED] The user stopped this task.', 'stopped');
  if (!command) return tool('[ERROR] Empty command.', 'error');
  if (isBlocked(command)) return tool('[BLOCKED] This command is not allowed by the safety filter.', 'blocked');

  let decision = 'y';
  if (!autoRun) decision = await askApproval(chat.id, st, command);
  if (decision === 'a') { autoRun = true; send('auto', { auto: true }); decision = 'y'; }
  if (st.stopped) return tool('[STOPPED] The user stopped this task.', 'stopped');
  if (decision !== 'y') {
    return tool('[DENIED] The user declined to run this command. Ask what they would like instead, or try another approach.', 'denied');
  }

  st.exec = command;
  send('running', { chatId: chat.id, command });
  const r = await runShell(command, chat.cwd, st);
  st.exec = null;
  chat.cwd = r.cwd;
  tool(r.output || '(no output)', 'ran', { code: r.code, cwd: r.cwd });
}

async function runTurn(chatId, text) {
  const chat = readChat(chatId);
  const st = { abort: new AbortController(), child: null, approval: null, exec: null, stopped: false };
  live.set(chatId, st);
  const add = (m) => {
    chat.messages.push(m);
    writeChat(chat);
    send('message', { chatId, message: m });
  };
  let partial = null;
  try {
    if (!chat.messages.length) chat.title = text.replace(/\s+/g, ' ').trim().slice(0, 48) || 'New chat';
    add({ role: 'user', content: text });
    send('chat-updated', { chatId });

    for (let step = 0; step < (Number(settings.maxSteps) || 15); step++) {
      partial = { role: 'assistant', content: '', thinking: '', tool_calls: [] };
      await streamChat(chat, st.abort.signal, partial);
      const msg = partial;
      partial = null;
      if (!msg.thinking) delete msg.thinking;
      if (!msg.tool_calls.length) delete msg.tool_calls;
      add(msg);
      if (!msg.tool_calls) break;
      for (const call of msg.tool_calls) await handleCall(chat, st, call, add);
      if (st.stopped) break;
      if (step === (Number(settings.maxSteps) || 15) - 1) {
        add({ role: 'assistant', content: '*Reached the step limit for one message. Say "continue" to keep going.*' });
      }
    }
  } catch (e) {
    if (st.stopped) {
      if (partial && partial.content.trim()) add({ role: 'assistant', content: partial.content });
    } else {
      const msg = String(e && e.message ? e.message : e);
      send('error', {
        chatId,
        error: /fetch failed|ECONNREFUSED/i.test(msg)
          ? `Could not reach Ollama at ${settings.host}. Start it with "ollama serve" and try again.`
          : msg,
      });
    }
  } finally {
    live.delete(chatId);
    send('done', { chatId });
  }
}

function stopChat(chatId) {
  const st = live.get(chatId);
  if (!st) return;
  st.stopped = true;
  st.abort.abort();
  killTree(st.child);
  if (st.approval) {
    const r = pendingApprovals.get(st.approval.callId);
    if (r) r('n');
    pendingApprovals.delete(st.approval.callId);
  }
}

/* ---------- terminal + ollama helpers ---------- */

function findPython() {
  if (pythonBin !== undefined) return pythonBin;
  pythonBin = null;
  for (const c of ['python3', 'python']) {
    try {
      require('child_process').execFileSync(c, ['--version'], { stdio: 'ignore' });
      pythonBin = c;
      break;
    } catch {}
  }
  return pythonBin;
}

function killTerm(id) {
  const c = terms.get(id);
  if (!c) return;
  try { c.stdin.end(); } catch {}
  try { c.kill('SIGHUP'); } catch {}
}

async function ensureOllama() {
  if (!settings.autoOllama) return;
  try {
    const u = new URL(settings.host);
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname)) return;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    try {
      await fetch(settings.host.replace(/\/$/, '') + '/api/tags', { signal: ctl.signal });
      clearTimeout(t);
      return; // already running
    } catch {
      clearTimeout(t);
    }
    ollamaChild = spawn('ollama', ['serve'], { stdio: 'ignore' });
    ollamaChild.on('error', () => { ollamaChild = null; });
    ollamaChild.on('close', () => { ollamaChild = null; });
  } catch {}
}

/* ---------- IPC ---------- */

function registerIpc() {
  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:set', (_e, patch) => {
    const next = { ...settings, ...patch };
    next.ctx = Math.max(1024, Number(next.ctx) || 8192);
    next.maxSteps = Math.max(1, Number(next.maxSteps) || 15);
    next.timeout = Math.max(5, Number(next.timeout) || 120);
    next.host = String(next.host || DEFAULT_SETTINGS.host).trim();
    next.model = String(next.model || DEFAULT_SETTINGS.model).trim();
    if (!next.instructions || !String(next.instructions).trim()) next.instructions = DEFAULT_INSTRUCTIONS;
    if (!next.startDir || !fs.existsSync(next.startDir)) next.startDir = os.homedir();
    next.termFont = Math.min(28, Math.max(9, Number(next.termFont) || 13));
    next.shell = String(next.shell || '').trim();
    next.autoOllama = next.autoOllama !== false && next.autoOllama !== 'false';
    settings = next;
    saveSettings();
    return settings;
  });
  ipcMain.handle('defaults:get', () => DEFAULT_INSTRUCTIONS);

  ipcMain.handle('chats:list', (_e, q) => listChats(q));
  ipcMain.handle('chats:new', () => newChat());
  ipcMain.handle('chats:get', (_e, id) => {
    const chat = readChat(id);
    const st = live.get(id);
    return {
      chat,
      live: st ? { running: true, approval: st.approval, exec: st.exec } : { running: false, approval: null, exec: null },
    };
  });
  ipcMain.handle('chats:delete', (_e, id) => {
    stopChat(id);
    try { fs.unlinkSync(chatPath(id)); } catch {}
    return true;
  });
  ipcMain.handle('chats:rename', (_e, id, title) => {
    const chat = readChat(id);
    chat.title = String(title || '').trim().slice(0, 120) || 'Untitled';
    const t = chat.updated;
    writeChat(chat);
    chat.updated = t;
    fs.writeFileSync(chatPath(id), JSON.stringify(chat));
    return chat.title;
  });
  ipcMain.handle('chats:markdown', (_e, id) => chatToMarkdown(readChat(id)));
  ipcMain.handle('chats:export', async (_e, id) => {
    const chat = readChat(id);
    const safe = chat.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'chat';
    const r = await dialog.showSaveDialog(win, {
      defaultPath: path.join(os.homedir(), `${safe}.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, chatToMarkdown(chat));
    return true;
  });
  ipcMain.handle('chat:pickCwd', async (_e, id) => {
    const chat = readChat(id);
    const r = await dialog.showOpenDialog(win, { defaultPath: chat.cwd, properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return chat.cwd;
    chat.cwd = r.filePaths[0];
    const t = chat.updated;
    writeChat(chat);
    chat.updated = t;
    fs.writeFileSync(chatPath(id), JSON.stringify(chat));
    return chat.cwd;
  });
  ipcMain.handle('chat:pickDir', async () => {
    const r = await dialog.showOpenDialog(win, { defaultPath: settings.startDir, properties: ['openDirectory'] });
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  });

  ipcMain.handle('chat:send', (_e, id, text) => {
    if (live.has(id)) return false;
    runTurn(id, String(text || ''));
    return true;
  });
  ipcMain.handle('chat:stop', (_e, id) => { stopChat(id); return true; });
  ipcMain.handle('tool:decide', (_e, callId, decision) => {
    const r = pendingApprovals.get(callId);
    if (r) { pendingApprovals.delete(callId); r(decision); }
    return true;
  });

  ipcMain.handle('auto:get', () => autoRun);
  ipcMain.handle('auto:set', (_e, v) => { autoRun = !!v; return autoRun; });

  ipcMain.handle('ollama:status', async () => {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 2500);
      const res = await fetch(settings.host.replace(/\/$/, '') + '/api/tags', { signal: ctl.signal });
      clearTimeout(t);
      const j = await res.json();
      return { ok: true, models: (j.models || []).map((m) => m.name) };
    } catch {
      return { ok: false, models: [] };
    }
  });

  /* built-in terminal */
  ipcMain.handle('term:create', (_e, opts) => {
    if (IS_WIN) return { error: 'The built-in terminal needs Linux or macOS.' };
    const py = findPython();
    if (!py) return { error: 'The built-in terminal needs Python 3 (python3) installed.' };
    const o = opts || {};
    const shell = settings.shell || process.env.SHELL || '/bin/bash';
    const dir = o.cwd && fs.existsSync(o.cwd) ? o.cwd : os.homedir();
    const env = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (/^npm_/i.test(k) || k === 'INIT_CWD' || k === 'NODE' || k.startsWith('ELECTRON_')) continue;
      env[k] = v;
    }
    env.TERM = 'xterm-256color';
    env.COLORTERM = 'truecolor';
    let child;
    try {
      child = spawn(
        py,
        [resourcePath('pty_bridge.py'), shell, dir, String(o.cols || 80), String(o.rows || 24)],
        { stdio: ['pipe', 'pipe', 'pipe', 'pipe'], env }
      );
    } catch (e) {
      return { error: `Could not start the terminal: ${e.message}` };
    }
    const id = String(++termSeq);
    terms.set(id, child);
    child.stdout.on('data', (d) => send('term-data', { id, data: d }));
    child.stderr.on('data', (d) => send('term-data', { id, data: d }));
    child.stdin.on('error', () => {});
    child.stdio[3].on('error', () => {});
    child.on('error', (e) => send('term-data', { id, data: Buffer.from(`\r\n[terminal error] ${e.message}\r\n`) }));
    child.on('close', (code) => {
      terms.delete(id);
      send('term-exit', { id, code });
    });
    return { id };
  });
  ipcMain.on('term:write', (_e, id, data) => {
    const c = terms.get(String(id));
    if (c && c.stdin.writable) c.stdin.write(data);
  });
  ipcMain.on('term:resize', (_e, id, cols, rows) => {
    const c = terms.get(String(id));
    const ctl = c && c.stdio[3];
    if (ctl && ctl.writable) ctl.write(`R ${cols | 0} ${rows | 0}\n`);
  });
  ipcMain.handle('term:kill', (_e, id) => { killTerm(String(id)); return true; });

  ipcMain.handle('clipboard:read', () => clipboard.readText());
  ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text)); return true; });
  ipcMain.handle('open:external', (_e, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return true;
  });
}

/* ---------- window ---------- */

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 640,
    minHeight: 460,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: 'Portal Terminal',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) e.preventDefault();
  });
}

app.whenReady().then(() => {
  chatsDir = path.join(app.getPath('userData'), 'chats');
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  fs.mkdirSync(chatsDir, { recursive: true });
  settings = loadSettings();
  purgeEmptyChats();
  registerIpc();
  ensureOllama();
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { role: 'editMenu' },
      { role: 'viewMenu' },
    ])
  );
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => {
  for (const id of live.keys()) stopChat(id);
  for (const id of [...terms.keys()]) killTerm(id);
  if (ollamaChild) { try { ollamaChild.kill(); } catch {} }
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
