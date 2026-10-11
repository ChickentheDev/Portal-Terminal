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
  };

  const T = {
    tabs: [],
    active: null,
    seq: 0,
    early: new Map(), // output that arrives before its tab knows its id
    opts: {},
    view: 'chat',
    fontSize: 13,
  };

  const themeNow = () => (document.body.dataset.theme === 'light' ? THEMES.light : THEMES.dark);
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
      fontFamily: MONO,
      fontSize: T.fontSize,
      cursorBlink: true,
      scrollback: 5000,
      theme: themeNow(),
      macOptionIsMeta: true,
    });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);

    const tab = { n, pane, term, fit, id: null, title: 'Terminal ' + n, dead: false };
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
    if (res.error) {
      term.write('\r\n' + res.error + '\r\n');
      tab.dead = true;
      return tab;
    }
    tab.id = res.id;
    term.onData((d) => window.api.termWrite(tab.id, d));
    term.onResize(({ cols, rows }) => window.api.termResize(tab.id, cols, rows));
    const early = T.early.get(tab.id);
    if (early) { early.forEach((d) => term.write(d)); T.early.delete(tab.id); }
    // make sure the shell knows the final size
    window.api.termResize(tab.id, term.cols, term.rows);
    if (T.view !== 'chat') term.focus();
    return tab;
  }

  function closeTab(tab) {
    if (tab.id) window.api.termKill(tab.id);
    try { tab.term.dispose(); } catch {}
    tab.pane.remove();
    const i = T.tabs.indexOf(tab);
    if (i >= 0) T.tabs.splice(i, 1);
    if (T.active === tab) {
      T.active = null;
      if (T.tabs.length) select(T.tabs[Math.min(i, T.tabs.length - 1)]);
    }
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

  /* ---------- appearance ---------- */

  function updateTheme() {
    for (const t of T.tabs) t.term.options.theme = themeNow();
  }
  function setFont(size) {
    T.fontSize = Number(size) || 13;
    for (const t of T.tabs) t.term.options.fontSize = T.fontSize;
    requestAnimationFrame(fitActive);
  }

  /* ---------- init ---------- */

  function init(opts) {
    T.opts = opts || {};
    T.fontSize = Number(T.opts.fontSize) || 13;

    document.querySelectorAll('.seg button').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
    $('#term-new').onclick = () => newTab();
    $('#term-hide').onclick = () => setView('chat');
    $('#term-ask').onclick = askAi;

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

  window.TermUI = { init, setView, toggle, newTab, sendText, updateTheme, setFont, focus };
})();
