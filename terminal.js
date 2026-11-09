/* Built-in terminal (xterm.js + a pty bridge in the main process). */
(() => {
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  };

  const MONO = 'ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';
  const THEMES = {
    dark: {
      background: '#000000', foreground: '#f4f4f4', cursor: '#f4f4f4', cursorAccent: '#000000',
      selectionBackground: '#4a4a4a',
    },
    light: {
      background: '#ffffff', foreground: '#0a0a0a', cursor: '#0a0a0a', cursorAccent: '#ffffff',
      selectionBackground: '#c4c4c4', white: '#8c8c8c', brightWhite: '#555555', brightBlack: '#6e6e6e',
      yellow: '#8a6d00', brightYellow: '#6e5600', green: '#1a7f37', brightGreen: '#116329',
      cyan: '#0f766e', brightCyan: '#0b5f58',
    },
    'warp-dark': {
      background: '#191c20', foreground: '#eaeae8', cursor: '#ffc24b', cursorAccent: '#191c20',
      selectionBackground: '#3a4150', black: '#191c20', brightBlack: '#4b525c',
      red: '#ff6b6b', brightRed: '#ff8787', green: '#7ed491', brightGreen: '#9be3ab',
      yellow: '#ffc24b', brightYellow: '#ffd479', blue: '#6cb6ff', brightBlue: '#8ec8ff',
      magenta: '#d4a0ff', brightMagenta: '#e2b8ff', cyan: '#4dd0e1', brightCyan: '#7fe3ee',
      white: '#c8cdd4', brightWhite: '#eaeae8',
    },
    dracula: {
      background: '#282a36', foreground: '#f8f8f2', cursor: '#bd93f9', cursorAccent: '#282a36',
      selectionBackground: '#44475a', black: '#21222c', brightBlack: '#6272a4',
      red: '#ff5555', brightRed: '#ff6e6e', green: '#50fa7b', brightGreen: '#69ff94',
      yellow: '#f1fa8c', brightYellow: '#ffffa5', blue: '#bd93f9', brightBlue: '#d6acff',
      magenta: '#ff79c6', brightMagenta: '#ff92df', cyan: '#8be9fd', brightCyan: '#a4ffff',
      white: '#f8f8f2', brightWhite: '#ffffff',
    },
    nord: {
      background: '#2e3440', foreground: '#eceff4', cursor: '#88c0d0', cursorAccent: '#2e3440',
      selectionBackground: '#434c5e', black: '#3b4252', brightBlack: '#4c566a',
      red: '#bf616a', brightRed: '#bf616a', green: '#a3be8c', brightGreen: '#a3be8c',
      yellow: '#ebcb8b', brightYellow: '#ebcb8b', blue: '#81a1c1', brightBlue: '#81a1c1',
      magenta: '#b48ead', brightMagenta: '#b48ead', cyan: '#88c0d0', brightCyan: '#8fbcbb',
      white: '#e5e9f0', brightWhite: '#eceff4',
    },
    'solarized-dark': {
      background: '#002b36', foreground: '#839496', cursor: '#2aa198', cursorAccent: '#002b36',
      selectionBackground: '#073642', black: '#073642', brightBlack: '#002b36',
      red: '#dc322f', brightRed: '#cb4b16', green: '#859900', brightGreen: '#586e75',
      yellow: '#b58900', brightYellow: '#657b83', blue: '#268bd2', brightBlue: '#839496',
      magenta: '#d33682', brightMagenta: '#6c71c4', cyan: '#2aa198', brightCyan: '#93a1a1',
      white: '#eee8d5', brightWhite: '#fdf6e3',
    },
    'one-dark': {
      background: '#282c34', foreground: '#abb2bf', cursor: '#61afef', cursorAccent: '#282c34',
      selectionBackground: '#3a404d', black: '#282c34', brightBlack: '#5c6370',
      red: '#e06c75', brightRed: '#e06c75', green: '#98c379', brightGreen: '#98c379',
      yellow: '#e5c07b', brightYellow: '#e5c07b', blue: '#61afef', brightBlue: '#61afef',
      magenta: '#c678dd', brightMagenta: '#c678dd', cyan: '#56b6c2', brightCyan: '#56b6c2',
      white: '#abb2bf', brightWhite: '#ffffff',
    },
  };

  const T = {
    tabs: [],
    active: null,
    seq: 0,
    early: new Map(), // output that arrives before its tab knows its id
    opts: {},
    view: 'chat',
    fontSize: 13,
    blocksHidden: false, // user hid the blocks rail; new commands won't re-show it
  };

  const themeNow = () => THEMES[document.body.dataset.theme] || THEMES.dark;
  const save = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const load = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

  /* ---------- views ---------- */

  function applyView(v) {
    T.view = v;
    document.body.dataset.view = v;
    document.querySelectorAll('.seg button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    save('view', v);
  }

  function setView(v, opts) {
    applyView(v);
    const wantFocus = !opts || opts.focus !== false;
    if (v === 'chat') {
      const input = $('#input');
      if (input && wantFocus) input.focus();
      return;
    }
    if (!T.tabs.length) newTab();
    else requestAnimationFrame(() => { fitActive(); if (wantFocus) focus(); });
  }

  const toggle = () => setView(T.view === 'chat' ? 'split' : 'chat');

  /* ---------- tabs ---------- */

  function renderTabs() {
    const bar = $('#term-tabs');
    bar.innerHTML = '';
    for (const tab of T.tabs) {
      const b = el('div', 'ttab' + (tab === T.active ? ' active' : ''));
      b.setAttribute('role', 'tab');
      const t = el('span', 'tt-title');
      t.textContent = tab.title;
      t.title = tab.title;
      const x = el('button', 'tt-x');
      x.textContent = '×';
      x.title = 'Close terminal (Ctrl+Shift+W)';
      x.setAttribute('aria-label', 'Close terminal');
      x.onclick = (e) => { e.stopPropagation(); closeTab(tab); };
      b.append(t, x);
      b.onclick = () => select(tab);
      bar.append(b);
    }
  }

  function select(tab) {
    T.active = tab;
    for (const t of T.tabs) t.pane.hidden = t !== tab;
    renderTabs();
    renderBlocks();
    requestAnimationFrame(() => { safeFit(tab); if (T.view !== 'chat') tab.term.focus(); });
  }

  function safeFit(tab) {
    if (!tab || !tab.pane.offsetWidth || !tab.pane.offsetHeight) return;
    try { tab.fit.fit(); } catch {}
  }
  const fitActive = () => safeFit(T.active);
  const focus = () => { if (T.active) T.active.term.focus(); };

  async function newTab(cwd) {
    if (typeof Terminal === 'undefined' || typeof FitAddon === 'undefined') {
      alert('The terminal library is missing. Run "npm install" in the app folder.');
      return null;
    }
    if (T.view === 'chat') applyView('split');

    const n = ++T.seq;
    const pane = el('div', 'term-pane');
    $('#term-body').append(pane);

    const term = new Terminal({
      fontFamily: T.fontFamily || MONO,
      fontSize: T.fontSize,
      cursorBlink: true,
      scrollback: 5000,
      theme: themeNow(),
      macOptionIsMeta: true,
    });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);

    const tab = { n, pane, term, fit, id: null, title: 'Terminal ' + n, dead: false, blocks: [], current: null, inputBuf: '', inputStale: false };
    T.tabs.push(tab);
    T.active = tab;
    for (const t of T.tabs) t.pane.hidden = t !== tab;
    term.open(pane);
    renderTabs();
    safeFit(tab);

    term.onTitleChange((title) => {
      tab.title = (title || '').slice(0, 30) || 'Terminal ' + n;
      renderTabs();
    });
    term.attachCustomKeyEventHandler((e) => keyHandler(tab, e));
    pane.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (term.hasSelection()) { copySelection(tab); term.clearSelection(); }
      else pasteInto(tab);
    });

    const res = await window.api.termCreate({
      cols: term.cols,
      rows: term.rows,
      cwd: cwd || (T.opts.getCwd && T.opts.getCwd()),
    });
    // The tab may have been closed while creation was in flight — kill the
    // orphaned pty instead of attaching it to a dead tab.
    if (tab.dead || !T.tabs.includes(tab)) {
      if (res && res.id) { try { window.api.termKill(res.id); } catch {} }
      return tab;
    }
    if (res.error) {
      term.write('\r\n' + res.error + '\r\n');
      tab.dead = true;
      return tab;
    }
    tab.id = res.id;
    term.onData((d) => window.api.termWrite(tab.id, d));
    term.onData((d) => trackInput(tab, d));
    term.onResize(({ cols, rows }) => window.api.termResize(tab.id, cols, rows));
    const early = T.early.get(tab.id);
    if (early) { early.forEach((d) => term.write(d)); T.early.delete(tab.id); }
    // make sure the shell knows the final size
    window.api.termResize(tab.id, term.cols, term.rows);
    if (T.view !== 'chat') term.focus();
    return tab;
  }

  function closeTab(tab) {
    tab.dead = true;
    if (tab.id) window.api.termKill(tab.id);
    try { tab.term.dispose(); } catch {}
    tab.pane.remove();
    const i = T.tabs.indexOf(tab);
    if (i >= 0) T.tabs.splice(i, 1);
    if (T.active === tab) {
      T.active = null;
      if (T.tabs.length) select(T.tabs[Math.min(i, T.tabs.length - 1)]);
    }
    renderBlocks();
    updateBlocksToggle();
    renderTabs();
    if (!T.tabs.length) {
      if (T.view === 'term') newTab();
      else setView('chat');
    }
  }

  /* ---------- keys, clipboard ---------- */

  function copySelection(tab) {
    const text = tab.term.getSelection();
    if (text) window.api.copy(text);
  }
  async function pasteInto(tab) {
    const text = await window.api.paste();
    if (text) tab.term.paste(text);
  }

  function keyHandler(tab, e) {
    if (e.type !== 'keydown') return true;
    const mod = e.ctrlKey || e.metaKey;
    const k = (e.key || '').toLowerCase();
    const stop = () => { e.preventDefault(); return false; };
    if (mod && k === '`') { toggle(); return stop(); }
    if (mod && e.shiftKey && k === 't') { newTab(); return stop(); }
    if (mod && e.shiftKey && k === 'w') { closeTab(tab); return stop(); }
    if (mod && e.shiftKey && k === 'c') { copySelection(tab); return stop(); }
    if (mod && !e.shiftKey && k === 'c' && tab.term.hasSelection()) {
      copySelection(tab);
      tab.term.clearSelection();
      return stop();
    }
    if (mod && e.shiftKey && k === 'v') { pasteInto(tab); return stop(); }
    return true;
  }

  /* ---------- talking to the chat ---------- */

  async function sendText(text) {
    if (T.view === 'chat') applyView('split');
    let tab = T.active && !T.active.dead && T.active.id ? T.active : null;
    if (!tab) tab = await newTab();
    if (!tab || tab.dead) return;
    requestAnimationFrame(fitActive);
    tab.term.paste(text);
    tab.term.focus();
  }

  function bufferTail(term, n) {
    const b = term.buffer.active;
    const out = [];
    for (let i = Math.max(0, b.length - 200); i < b.length; i++) {
      const line = b.getLine(i);
      if (line) out.push(line.translateToString(true));
    }
    while (out.length && !out[out.length - 1].trim()) out.pop();
    return out.slice(-n).join('\n');
  }

  function askAi() {
    const tab = T.active;
    if (!tab) return;
    const text = tab.term.hasSelection() ? tab.term.getSelection() : bufferTail(tab.term, 30);
    if (text.trim() && T.opts.onAsk) T.opts.onAsk(text.trimEnd());
  }

  /* ---------- command blocks (Warp-style) ----------
   * xterm renders to canvas, so blocks live in a DOM rail above the
   * terminal instead of inline. Each submitted command becomes a block
   * with a header row: command, copy + rerun, status/duration.
   * Limits, stated plainly: there is no shell integration, so a block
   * is "running" until the next command is submitted (or Ctrl+C), and
   * its duration is wall time between submits — the exit code is not
   * observable and is never faked. */

  // Track the line being typed so the block records the real command.
  function trackInput(tab, d) {
    if (!d) return;
    for (let i = 0; i < d.length; i++) {
      const ch = d[i];
      if (ch === '\r' || ch === '\n') submitLine(tab);
      else if (ch === '\x7f') tab.inputBuf = tab.inputBuf.slice(0, -1);
      else if (ch === '\x15') tab.inputBuf = ''; // Ctrl+U clears the line
      else if (ch === '\x03') { // Ctrl+C cancels the running command
        if (tab.current) finishBlock(tab, 'cancelled');
        tab.inputBuf = '';
      } else if (ch === '\x1b' || ch === '\t') tab.inputStale = true; // arrows, completion: line changed behind our back
      else if (ch >= ' ' && ch !== '\x7f') tab.inputBuf += ch;
    }
  }

  function submitLine(tab) {
    let cmd = tab.inputBuf.trim();
    if (!cmd || tab.inputStale) cmd = commandFromBuffer(tab) || cmd; // fall back to the line on screen
    tab.inputBuf = '';
    tab.inputStale = false;
    if (!cmd) return;
    if (tab.current) finishBlock(tab, 'done'); // the previous command ended when the prompt returned
    tab.current = { command: cmd, startedAt: Date.now(), status: 'running' };
    tab.blocks.push(tab.current);
    if (tab.blocks.length > 30) tab.blocks.splice(0, tab.blocks.length - 30);
    if (!T.blocksHidden) $('#term-blocks').hidden = false;
    if (tab === T.active) renderBlocks();
    updateBlocksToggle();
  }

  // Read the command off the cursor line, stripping the prompt.
  function commandFromBuffer(tab) {
    try {
      const b = tab.term.buffer.active;
      const line = b.getLine(b.cursorY);
      if (!line) return '';
      const s = line.translateToString(true);
      const markers = ['$ ', '% ', '# ', '❯ ', '> '];
      let cut = -1;
      for (const m of markers) {
        const i = s.lastIndexOf(m);
        if (i >= 0 && i + m.length > cut) cut = i + m.length;
      }
      return (cut >= 0 ? s.slice(cut) : s).trim();
    } catch { return ''; }
  }

  function finishBlock(tab, status) {
    const b = tab.current;
    if (!b) return;
    b.status = status;
    b.durationMs = Date.now() - b.startedAt;
    tab.current = null;
    if (tab === T.active) renderBlocks();
  }

  function fmtDuration(ms) {
    if (ms == null) return '';
    if (ms < 1000) return (ms / 1000).toFixed(2) + 's';
    if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
    const m = Math.floor(ms / 60000), s = Math.round((ms % 60000) / 1000);
    return m + 'm ' + String(s).padStart(2, '0') + 's';
  }

  function renderBlocks() {
    const box = $('#term-blocks');
    const tab = T.active;
    box.innerHTML = '';
    if (!tab || !tab.blocks.length) {
      box.append(el('div', 'term-blocks-empty', 'No commands yet — run one and it shows up here.'));
      return;
    }
    for (const b of tab.blocks) {
      const row = el('div', 'term-block' + (b.status === 'running' ? ' running' : ''));
      const cmd = el('span', 'tb-cmd');
      cmd.textContent = b.command;
      cmd.title = b.command;
      const status = el('span', 'tb-status');
      status.textContent = b.status === 'running' ? 'Running…' : b.status === 'cancelled' ? 'Cancelled' : fmtDuration(b.durationMs);
      const copy = el('button', 'tb-btn');
      copy.textContent = 'Copy';
      copy.title = 'Copy command';
      copy.onclick = () => window.api.copy(b.command);
      const rerun = el('button', 'tb-btn');
      rerun.textContent = 'Rerun';
      rerun.title = 'Run this command again';
      rerun.onclick = () => { tab.term.focus(); tab.term.paste(b.command + '\r'); };
      row.append(cmd, status, copy, rerun);
      box.append(row);
    }
    box.scrollTop = box.scrollHeight;
  }

  function updateBlocksToggle() {
    const n = T.tabs.reduce((a, t) => a + t.blocks.length, 0);
    $('#term-blocks-toggle').textContent = n ? `Blocks (${n})` : 'Blocks';
  }

  /* ---------- appearance ---------- */

  function updateTheme() {
    for (const t of T.tabs) t.term.options.theme = themeNow();
  }
  function setFont(size) {
    T.fontSize = Number(size) || 13;
    for (const t of T.tabs) t.term.options.fontSize = T.fontSize;
    requestAnimationFrame(fitActive);
  }
  function setFontFamily(fam) {
    T.fontFamily = fam || MONO;
    for (const t of T.tabs) t.term.options.fontFamily = T.fontFamily;
    requestAnimationFrame(fitActive);
  }

  /* ---------- init ---------- */

  function init(opts) {
    T.opts = opts || {};
    T.fontSize = Number(T.opts.fontSize) || 13;
    T.fontFamily = T.opts.fontFamily || MONO;

    document.querySelectorAll('.seg button').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
    $('#term-new').onclick = () => newTab();
    $('#term-hide').onclick = () => setView('chat');
    $('#term-ask').onclick = askAi;
    $('#term-blocks-toggle').onclick = () => {
      T.blocksHidden = !T.blocksHidden;
      $('#term-blocks').hidden = T.blocksHidden;
      if (!T.blocksHidden) renderBlocks();
    };

    const h = load('termHeight');
    if (h) document.documentElement.style.setProperty('--term-h', h);

    let raf = 0;
    new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fitActive);
    }).observe($('#term-body'));

    // drag to resize the dock
    $('#term-resize').addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = $('#termpanel').offsetHeight;
      document.body.classList.add('dragging');
      const move = (ev) => {
        const hgt = Math.min(window.innerHeight * 0.78, Math.max(140, startH + (startY - ev.clientY)));
        document.documentElement.style.setProperty('--term-h', hgt + 'px');
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.classList.remove('dragging');
        save('termHeight', document.documentElement.style.getPropertyValue('--term-h'));
        fitActive();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });

    window.api.on('term-data', ({ id, data }) => {
      const tab = T.tabs.find((t) => t.id === id);
      if (tab) tab.term.write(data);
      else {
        if (!T.early.has(id)) T.early.set(id, []);
        T.early.get(id).push(data);
      }
    });
    window.api.on('term-exit', ({ id, code }) => {
      const tab = T.tabs.find((t) => t.id === id);
      if (!tab) return;
      if (!code) closeTab(tab);
      else {
        tab.dead = true;
        tab.term.write(`\r\n[process exited with code ${code}]\r\n`);
      }
    });

    // shortcuts while focus is outside the terminal
    document.addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('#termpanel')) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = (e.key || '').toLowerCase();
      if (mod && k === '`') { e.preventDefault(); toggle(); }
      else if (mod && e.shiftKey && k === 't') { e.preventDefault(); newTab(); }
    });

    const saved = load('view');
    setView(saved === 'split' || saved === 'term' ? saved : 'chat');
  }

  window.TermUI = { init, setView, toggle, newTab, sendText, updateTheme, setFont, setFontFamily, askAi, focus };
})();
