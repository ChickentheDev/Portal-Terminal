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
    inited: false, // set by init(): session saves are skipped before this
    early: new Map(), // output that arrives before its tab knows its id
    opts: {},
    view: 'chat',
    fontSize: 13,
    blocksHidden: false, // user hid the blocks rail; new commands won't re-show it
    search: { tab: null, query: '', resultIndex: -1, resultCount: 0 }, // the shared search bar belongs to one tab at a time
  };

  // Thin wrappers over the split-panes module (window.PortalSplitPanes,
  // loaded before this file). The fallbacks keep a lone tab working if
  // the script tag is ever missing.
  const spIsPartner = (t) => !!(window.PortalSplitPanes && window.PortalSplitPanes.isPartnerTab(t));
  const spBarTab = (t) => (window.PortalSplitPanes ? window.PortalSplitPanes.barTab(t) : t);
  const spVisible = (t) => (window.PortalSplitPanes ? window.PortalSplitPanes.visibleTabs(T.tabs, t) : [t]);
  const spPrimary = (t) => (window.PortalSplitPanes ? window.PortalSplitPanes.primaryOf(t) : t);
  const spFocusAfter = (tabs, closed, i) => (window.PortalSplitPanes
    ? window.PortalSplitPanes.focusAfterClose(tabs, closed, i)
    : (tabs.length ? tabs[Math.min(i, tabs.length - 1)] : null));

  const themeNow = () => THEMES[document.body.dataset.theme] || THEMES.dark;
  const save = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
  const load = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

  /* ---------- views ---------- */

  function applyView(v) {
    T.view = v;
    document.body.dataset.view = v;
    // Scoped to the top-bar view switcher: the sidebar Chats/Files
    // toggle reuses .seg, and a global selector would strip its 'on'
    // class and steal its clicks.
    document.querySelectorAll('#top .seg button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    save('view', v);
  }

  function setView(v, opts) {
    nanoHide();
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
    // A split partner is a second pane, not a tab: it stays out of the
    // bar, and its primary takes the highlight while it is focused.
    const activeTab = spBarTab(T.active);
    for (const tab of T.tabs) {
      if (spIsPartner(tab)) continue;
      const b = el('div', 'ttab' + (tab === activeTab ? ' active' : ''));
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
    syncPaneClasses();
  }

  // Pane geometry + focus frame + Split button label. Called from
  // renderTabs, which select / closeTab / newTab / title changes all
  // funnel through, so the classes can never go stale.
  function syncPaneClasses() {
    const split = !!(T.active && T.active.partner);
    for (const t of T.tabs) {
      t.pane.classList.toggle('split', !!t.partner);
      t.pane.classList.toggle('split-left', !!t.partner && !t.splitPartner);
      t.pane.classList.toggle('split-right', !!t.splitPartner);
      t.pane.classList.toggle('focused', t === T.active);
    }
    const btn = $('#term-split');
    if (btn) btn.textContent = split ? 'Unsplit' : 'Split';
  }

  // Bar tabs only (split partners excluded) with the cwd/shell each
  // tab started with, and the active tab's index among them — the
  // state the session file persists. Tabs whose cwd was never
  // recorded are left out rather than saved as empty strings.
  const sessionTabs = () => {
    const bar = window.PortalTabRestore
      ? window.PortalTabRestore.barTabs(T.tabs, spIsPartner)
      : T.tabs.filter((t) => !spIsPartner(t));
    return bar.filter((t) => t.cwd).map((t) => ({ cwd: t.cwd, shell: t.shell || '' }));
  };
  const sessionActiveIndex = () => (window.PortalTabRestore
    ? window.PortalTabRestore.activeBarIndex(T.tabs, T.active, spIsPartner, spBarTab)
    : T.tabs.filter((t) => !spIsPartner(t)).indexOf(spBarTab(T.active)));
  // The renderer persists the session on every tab change (open,
  // close, select) so a crash still restores — nothing is saved
  // only on quit.
  const sessionChanged = () => {
    try { if (T.opts.onSessionChange) T.opts.onSessionChange(); } catch {}
  };

  function select(tab) {
    nanoHide();
    // The search bar is shared: switching tabs closes it (and clears the
    // old tab's decorations) instead of showing a stale query/count.
    if (T.search.tab && T.search.tab !== tab) searchClose({ focus: false });
    T.active = tab;
    // A split tab's partner pane stays visible alongside it; every
    // other tab's pane stays hidden.
    const visible = spVisible(tab);
    for (const t of T.tabs) t.pane.hidden = !visible.includes(t);
    renderTabs();
    renderBlocks();
    requestAnimationFrame(() => { fitActive(); if (T.view !== 'chat') tab.term.focus(); });
    sessionChanged();
  }

  function safeFit(tab) {
    if (!tab || !tab.pane.offsetWidth || !tab.pane.offsetHeight) return;
    try { tab.fit.fit(); } catch {}
  }
  // A split tab's partner is visible too: a window resize re-fits both
  // panes, not just the focused one.
  const fitActive = () => {
    if (!T.active) return;
    safeFit(T.active);
    if (T.active.partner) safeFit(T.active.partner);
  };
  const focus = () => { if (T.active) T.active.term.focus(); };

  // cwd: the directory the shell starts in (chat cwd by default).
  // shell: the shell to spawn — empty means the configured default;
  // a restore passes the shell the tab had. opts.silent keeps the
  // current view (used by session restore: the user lands in chat
  // view with their chat open, tabs waiting in the terminal).
  async function newTab(cwd, shell, opts) {
    if (typeof Terminal === 'undefined' || typeof FitAddon === 'undefined' || typeof SearchAddon === 'undefined') {
      alert('The terminal library is missing. Run "npm install" in the app folder.');
      return null;
    }
    if (T.view === 'chat' && !(opts && opts.silent)) applyView('split');

    // A new tab is a tab switch too: the shared bar closes rather than
    // searching a tab that is no longer active.
    if (T.search.tab) searchClose({ focus: false });

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
      // Required by @xterm/addon-search: match decorations and the
      // onDidChangeResults count are proposed APIs, and findNext with
      // decorations throws without this flag.
      allowProposedApi: true,
    });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    const search = new SearchAddon.SearchAddon();
    term.loadAddon(search);

    const tab = { n, pane, term, fit, search, id: null, title: 'Terminal ' + n, dead: false, partner: null, splitPartner: false, blocks: [], current: null, inputBuf: '', inputStale: false, nanoFile: null, nano: { open: false, items: [], active: 0, prefix: '', force: false, justAccepted: false, pasteHide: false, timer: 0 }, shellIntegrated: false, markerAnchor: null, markerAnchorTimer: 0, markerStack: [], pendingCmd: '', cwd: cwd || (T.opts.getCwd && T.opts.getCwd()) || '', shell: '' };
    T.tabs.push(tab);
    // Per-pane close button (shown only while the tab is split) and
    // focus tracking: clicking a pane makes it the active tab, so the
    // blocks rail, search, and Ask AI all follow the focused pane.
    const spx = el('button', 'sp-close');
    spx.textContent = '×';
    spx.title = 'Close this pane';
    spx.setAttribute('aria-label', 'Close this pane');
    spx.onclick = (e) => { e.stopPropagation(); closeTab(tab); };
    pane.append(spx);
    T.active = tab;
    // The count label follows this tab's addon, but only while the bar
    // belongs to this tab — another tab's search never rewrites it.
    try {
      search.onDidChangeResults((ev) => {
        if (T.search.tab === tab) setSearchCount(ev.resultIndex, ev.resultCount, true);
      });
    } catch {}
    for (const t of T.tabs) t.pane.hidden = t !== tab;
    term.open(pane);
    renderTabs();
    safeFit(tab);

    term.onTitleChange((title) => {
      tab.title = (title || '').slice(0, 30) || 'Terminal ' + n;
      renderTabs();
    });
    term.attachCustomKeyEventHandler((e) => keyHandler(tab, e));
    // Focus follows the clicked pane. xterm 5.5 has no term.onFocus
    // API (and no onBlur either — the pre-existing onBlur call below
    // is dead code for the same reason), so this listens for focusin,
    // which bubbles from the helper textarea up to the pane. The guard
    // stops re-entry: select() focuses the tab's terminal, and an
    // already-focused textarea does not re-fire focusin.
    pane.addEventListener('focusin', () => { if (T.active !== tab) select(tab); });
    pane.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (term.hasSelection()) { copySelection(tab); term.clearSelection(); }
      else pasteInto(tab);
    });

    const res = await window.api.termCreate({
      cols: term.cols,
      rows: term.rows,
      cwd: tab.cwd || (T.opts.getCwd && T.opts.getCwd()),
      shell: shell || '',
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
      sessionChanged();
      return tab;
    }
    tab.id = res.id;
    tab.shell = (res && res.shell) || '';
    term.onData((d) => window.api.termWrite(tab.id, d));
    term.onData((d) => trackInput(tab, d));
    term.onResize(({ cols, rows }) => { window.api.termResize(tab.id, cols, rows); nanoHide(tab); });
    try { term.onScroll(() => nanoHide(tab)); } catch {}
    try { term.onBlur(() => nanoHide(tab)); } catch {}
    const early = T.early.get(tab.id);
    if (early) { early.forEach((d) => term.write(d)); T.early.delete(tab.id); }
    // make sure the shell knows the final size
    window.api.termResize(tab.id, term.cols, term.rows);
    if (T.view !== 'chat') term.focus();
    sessionChanged();
    return tab;
  }

  // Recreate the saved session's tabs after a restart, silently: the
  // user stays in chat view and the tabs are waiting in the terminal.
  // Split state is not restored (partners were never saved). A tab
  // whose shell fails to spawn is closed instead of left dead in the
  // bar. Returns the tabs that came back.
  async function restoreTabs(tabs, activeIndex) {
    if (!Array.isArray(tabs) || !tabs.length) return [];
    const created = [];
    for (const t of tabs) {
      if (!t || typeof t.cwd !== 'string') continue;
      const tab = await newTab(t.cwd, t.shell || '', { silent: true });
      if (!tab) continue;
      if (tab.dead) { closeTab(tab); continue; }
      created.push(tab);
    }
    if (created.length) {
      const i = Math.max(0, Math.min(Number.isInteger(activeIndex) ? activeIndex : 0, created.length - 1));
      select(created[i]);
    }
    sessionChanged();
    return created;
  }

  function closeTab(tab) {
    nanoHide(tab);
    if (T.search.tab === tab) searchClose({ focus: false });
    tab.dead = true;
    if (tab.id) window.api.termKill(tab.id);
    try { tab.term.dispose(); } catch {}
    tab.pane.remove();
    const i = T.tabs.indexOf(tab);
    if (i >= 0) T.tabs.splice(i, 1);
    // Closing one side of a split leaves the survivor as a normal
    // standalone tab (no field copying — the survivor keeps its own
    // pty, blocks, and search state untouched).
    const partner = tab.partner || null;
    if (partner) {
      partner.partner = null;
      partner.splitPartner = false;
    }
    if (T.active === tab) {
      T.active = null;
      // A split close focuses the survivor; otherwise the neighbour
      // the old logic picked (next tab, or the last one at the end).
      const next = spFocusAfter(T.tabs, tab, i);
      if (next) select(next);
    }
    renderBlocks();
    updateBlocksToggle();
    renderTabs();
    if (!T.tabs.length) {
      if (T.view === 'term') newTab();
      else setView('chat');
    }
    sessionChanged();
  }

  /* ---------- split panes ----------
   * The second pane is a full tab (own pty, own search addon, own
   * blocks), linked by tab.partner and hidden from the tab bar. See
   * design-plans/split-panes-plan.md for why a partner tab beats a
   * pane object. */

  async function splitTab(tab) {
    tab = tab || T.active;
    // A double-click fires splitTab twice: the first call is still
    // awaiting newTab when the second lands, and tab.partner is not
    // set yet — without this flag the second call would spawn a second
    // partner and orphan the first (invisible, unreachable, pty alive).
    if (!tab || tab.partner || tab.dead || tab._splitting) return null;
    tab._splitting = true;
    try {
      const partner = await newTab();
      if (!partner) return null;
      // A pty that failed to spawn leaves a dead tab behind; clean it up
      // instead of showing a dead second pane.
      if (partner.dead) { closeTab(partner); return null; }
      tab.partner = partner;
      partner.partner = tab;
      partner.splitPartner = true;
      // newTab hid the primary pane and made the partner active; show both.
      // renderTabs re-runs here (not just syncPaneClasses): newTab's
      // renderTabs ran before the link existed, so the bar still lists
      // the partner as a normal tab until this refreshes it.
      tab.pane.hidden = false;
      partner.pane.hidden = false;
      renderTabs();
      renderBlocks();
      requestAnimationFrame(() => { fitActive(); partner.term.focus(); });
      // newTab's session save ran before the link existed, so it saved
      // the partner as a normal tab — save again now that the partner
      // is marked and the bar-tab list is correct.
      sessionChanged();
      return partner;
    } finally {
      tab._splitting = false;
    }
  }

  function unsplitTab(tab) {
    tab = tab || T.active;
    if (!tab) return;
    // Unsplit always removes the partner pane: the primary (the tab
    // in the tab bar) is the survivor, whichever side is focused.
    // Closing tab.partner blindly would close the primary when the
    // partner pane is focused, silently swapping which tab survives.
    const primary = spPrimary(tab);
    if (!primary || !primary.partner) return;
    closeTab(primary.partner);
  }

  function splitToggle() {
    // A split is still in flight (the partner tab is being created):
    // ignore the toggle until it lands. Without this, a double-click
    // splits twice — the second click reads T.active after newTab
    // already made the half-created partner active, so it splits the
    // partner as well and leaves three panes with crossed links.
    if (T.tabs.some((t) => t._splitting)) return;
    const tab = T.active;
    if (!tab) { newTab().then(() => splitToggle()); return; }
    if (tab.partner) unsplitTab(tab);
    else splitTab(tab);
  }

  function isSplit() {
    return !!(T.active && T.active.partner);
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
    // Ctrl+F / Cmd+F opens terminal search. The key never reaches the
    // pty — the shell's forward-char is the price of having search.
    if (mod && k === 'f') { searchOpen(tab); return stop(); }
    // Esc with the search bar open for this tab closes the bar instead
    // of reaching the shell (the bar's input handles Esc while focused).
    if (k === 'escape' && T.search.tab === tab) { searchClose(); return stop(); }
    // Nano autocomplete owns Tab/Enter/arrows/Esc while its popup is open.
    // Esc is SWALLOWED while the popup is open (unlike the first draft,
    // which passed it through): a lone Escape reaching nano makes nano
    // redraw the cursor (which re-triggers the popup) AND arms nano's
    // Meta prefix, so the next key would run a Meta command instead of
    // typing. When the popup is closed, Esc passes through untouched and
    // Meta shortcuts keep working.
    if (tab.nano && tab.nano.open) {
      if (k === 'tab' || k === 'enter') { nanoAccept(tab, tab.nano.active); return stop(); }
      if (k === 'arrowdown') { tab.nano.active = Math.min(tab.nano.items.length - 1, tab.nano.active + 1); nanoRender(tab); return stop(); }
      if (k === 'arrowup') { tab.nano.active = Math.max(0, tab.nano.active - 1); nanoRender(tab); return stop(); }
      if (k === 'escape') { nanoHide(tab); return stop(); }
    }
    // Ctrl+Space forces the popup open while nano is active (also below
    // the 2-char threshold). Anywhere else it passes through untouched —
    // in the shell it is readline's set-mark.
    if (mod && k === ' ' && T.opts.nanoComplete !== false && nanoActive(tab)) {
      nanoRefresh(tab, true);
      return stop();
    }
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

  /* ---------- terminal search ----------
   * One shared bar (#term-search) owned by the tab it was opened on.
   * The @xterm/addon-search instance per tab owns highlighting and the
   * match count (onDidChangeResults); this section only wires keys, the
   * bar, and the count label. Plain text, case-insensitive — the addon
   * is never put in regex mode, so a query with regex characters is
   * literal and can never throw. */

  function setSearchCount(resultIndex, resultCount, hasQuery) {
    T.search.resultIndex = resultIndex;
    T.search.resultCount = resultCount;
    const label = $('#term-search-count');
    if (!label) return;
    const text = window.PortalTermSearch
      ? window.PortalTermSearch.formatSearchCount(resultIndex, resultCount, hasQuery)
      : (hasQuery && !resultCount ? 'No results' : '');
    label.textContent = text;
    label.classList.toggle('no-match', text === 'No results');
  }

  function searchOptions(incremental) {
    const theme = document.body.dataset.theme || 'dark';
    if (window.PortalTermSearch) return window.PortalTermSearch.searchOptions(theme, incremental);
    return { regex: false, wholeWord: false, caseSensitive: false, incremental: !!incremental };
  }

  function searchOpen(tab) {
    tab = tab || T.active;
    if (!tab || !tab.search || tab.dead) return;
    nanoHide(tab);
    T.search.tab = tab;
    const input = $('#term-search-input');
    // Pre-fill with the current selection, like most terminals do —
    // first line only, trimmed, so a multi-line selection stays sane.
    if (!input.value) {
      try {
        const sel = tab.term.getSelection();
        if (sel) {
          const first = sel.split(/\r?\n/)[0].trim().slice(0, 200);
          if (first) input.value = first;
        }
      } catch {}
    }
    $('#term-search').hidden = false;
    if (input.value) searchRun('next', true);
    input.focus();
    input.select();
  }

  function searchClose(opts) {
    const st = T.search;
    const tab = st.tab;
    st.tab = null;
    st.query = '';
    st.resultIndex = -1;
    st.resultCount = 0;
    const bar = $('#term-search');
    if (bar) bar.hidden = true;
    const label = $('#term-search-count');
    if (label) { label.textContent = ''; label.classList.remove('no-match'); }
    if (tab) {
      try { tab.search.clearDecorations(); } catch {}
      try { tab.term.clearSelection(); } catch {}
      if ((!opts || opts.focus !== false) && !tab.dead) tab.term.focus();
    }
  }

  // dir: 'next' | 'prev'. incremental: true while typing (the current
  // match holds while it still matches the longer query); false on
  // Enter, which must advance to the next match.
  function searchRun(dir, incremental) {
    const st = T.search;
    if (!st.tab || !st.tab.search || st.tab.dead) return;
    const input = $('#term-search-input');
    const q = (input.value || '');
    st.query = q;
    if (!q) {
      try { st.tab.search.clearDecorations(); } catch {}
      setSearchCount(-1, 0, false);
      return;
    }
    let found = false;
    try {
      found = dir === 'prev'
        ? st.tab.search.findPrevious(q, searchOptions(false))
        : st.tab.search.findNext(q, searchOptions(incremental));
    } catch { found = false; }
    if (!found) {
      // No match at all: clear the previous query's decorations so a
      // stale highlight never pretends to be a result.
      try { st.tab.search.clearDecorations(); } catch {}
      setSearchCount(-1, 0, true);
    }
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

  // The last terminal block of the focused pane + the recent buffer
  // tail as its output, for /explain. Blocks store command + exit
  // code + duration but no output text, so the output is the tail of
  // the buffer (the askAi precedent). Null when there is no tab or
  // no block yet — the caller says so instead of sending an empty
  // explanation.
  function lastBlockOutput() {
    const tab = T.active;
    if (!tab || !tab.blocks.length) return null;
    const b = tab.blocks[tab.blocks.length - 1];
    return {
      command: b.command,
      exitCode: typeof b.exitCode === 'number' ? b.exitCode : null,
      status: b.status,
      output: bufferTail(tab.term, 30),
    };
  }

  /* ---------- command blocks (Warp-style) ----------
   * xterm renders to canvas, so blocks live in a DOM rail above the
   * terminal instead of inline. Each submitted command becomes a block
   * with a header row: command, copy + rerun, status/duration.
   * With shell integration (OSC 133 markers from bash/zsh/fish), a block
   * is created at C (output start) and finished at D with the REAL exit
   * code and true duration; Ctrl+C is reported by the shell as 130.
   * Without markers (integration off, sh, ssh, tmux) the keystroke
   * tracker below is the fallback: a block is "running" until the next
   * command is submitted, duration is wall time between submits, and no
   * exit code is shown. Marker blocks use a stack (not a single current)
   * so nested integrated shells report correctly. */

  // Track the line being typed so the block records the real command.
  function trackInput(tab, d) {
    if (!d) return;
    // A multi-char chunk is a paste (or an escape sequence): hide the
    // popup so a pasted word never leaves a stale one behind. The next
    // keystroke re-triggers it from the fresh buffer.
    if (d.length > 1 && tab.nano) { tab.nano.pasteHide = true; nanoHide(tab); }
    // Inside a fullscreen app (nano, vim, less...) the terminal uses the
    // alternate screen: Enter is not a command submission and typed text
    // is not a shell line. Ignore input there entirely — otherwise every
    // Enter inside nano would file a bogus block for the line on screen
    // and overwrite tab.current, breaking nano detection.
    try {
      if (tab.term.buffer.active === tab.term.buffer.alternate) return;
    } catch {}
    for (let i = 0; i < d.length; i++) {
      const ch = d[i];
      if (ch === '\r' || ch === '\n') submitLine(tab);
      else if (ch === '\x7f') tab.inputBuf = tab.inputBuf.slice(0, -1);
      else if (ch === '\x15') tab.inputBuf = ''; // Ctrl+U clears the line
      else if (ch === '\x03') { // Ctrl+C cancels the running command
        // Marker mode: the shell reports it as D;130 — finishing here
        // would mark the block cancelled before the real exit code lands.
        if (!tab.shellIntegrated && tab.current) finishBlock(tab, 'cancelled');
        tab.inputBuf = '';
      } else if (ch === '\x1b' || ch === '\t') tab.inputStale = true; // arrows, completion: line changed behind our back
      else if (ch >= ' ' && ch !== '\x7f') tab.inputBuf += ch;
    }
  }

  function submitLine(tab) {
    // Marker mode: the shell owns the blocks (C creates, D finishes).
    // Stay silent so Enter never files a second block — and so Enter
    // inside nano (no markers there) files none either. inputBuf is
    // cleared so it can't grow unboundedly while the tracker is off.
    if (tab.shellIntegrated) { tab.inputBuf = ''; tab.inputStale = false; return; }
    let cmd = tab.inputBuf.trim();
    if (!cmd || tab.inputStale) cmd = commandFromBuffer(tab) || cmd; // fall back to the line on screen
    tab.inputBuf = '';
    tab.inputStale = false;
    if (!cmd) return;
    if (tab.current) finishBlock(tab, 'done'); // the previous command ended when the prompt returned
    tab.current = { command: cmd, startedAt: Date.now(), status: 'running', source: 'tracker' };
    tab.blocks.push(tab.current);
    if (tab.blocks.length > 30) tab.blocks.splice(0, tab.blocks.length - 30);
    if (!T.blocksHidden) $('#term-blocks').hidden = false;
    if (tab === T.active) renderBlocks();
    updateBlocksToggle();
    nanoOnCommand(tab);
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

  // Read the command off the buffer between the B anchor (end of the
  // prompt) and the line above the cursor (the Enter echo moved the
  // cursor past the command). A wrapped line joins without a newline;
  // any other line break is a real newline. Continuation prompts
  // ('> ') are stripped. Returns '' when there is no usable anchor.
  function commandFromAnchor(tab) {
    try {
      const a = tab.markerAnchor;
      if (!a) return '';
      const b = tab.term.buffer.active;
      const endY = b.cursorY - 1;
      if (endY < a.y) return '';
      let out = '';
      for (let y = a.y; y <= endY; y++) {
        const line = b.getLine(y);
        if (!line) continue;
        let s = line.translateToString(true);
        if (y === a.y) s = s.slice(a.x);
        else s = s.replace(/^\s*>\s?/, '');
        if (y > a.y && !s.trim()) continue;
        if (y > a.y && !line.isWrapped) out += '\n';
        out += s;
      }
      return out.trim();
    } catch { return ''; }
  }

  // ---------- OSC 133 shell integration ----------
  // Markers arrive from the main process (parsed from the raw pty stream;
  // xterm.js consumes OSC sequences, so they never reach the buffer).
  // A = prompt started (clear pending command + anchor), B = command
  // started (record the cursor as the anchor, after queued writes flush),
  // E = the command line as the shell knows it, C = output started (push
  // a block), D = command finished (pop it, set the real exit code and
  // duration). The block is created synchronously at C so a fast D finds
  // it on the stack; only the command text is refined later from the
  // anchor, once the Enter echo has landed in the buffer.
  function onOsc(tab, ev) {
    if (!tab || tab.dead || !ev || !ev.kind) return;
    // Any marker proves the shell is integrated — the startup A/B arrive
    // at the first prompt, before the first command is typed, so the
    // keystroke tracker is suppressed from the very first Enter.
    tab.shellIntegrated = true;
    if (ev.kind === 'A') {
      tab.pendingCmd = '';
      tab.markerAnchor = null;
      return;
    }
    if (ev.kind === 'B') {
      // term.write is async: capture the cursor after the queued prompt
      // writes have flushed, so the anchor is the end of the prompt.
      try {
        tab.term.write('', () => {
          try {
            const b = tab.term.buffer.active;
            tab.markerAnchor = { x: b.cursorX, y: b.cursorY };
          } catch {}
        });
        clearTimeout(tab.markerAnchorTimer);
        tab.markerAnchorTimer = setTimeout(() => { tab.markerAnchor = null; }, 200);
      } catch { tab.markerAnchor = null; }
      return;
    }
    if (ev.kind === 'E') {
      tab.pendingCmd = ev.command || '';
      return;
    }
    if (ev.kind === 'C') {
      // Belt-and-braces for the type-ahead race (Enter pressed before the
      // startup markers arrived): the tracker may have filed a block for
      // this very command. It is the last block, still running, and the
      // marker block supersedes it — drop it so the command is not doubled.
      const last = tab.blocks[tab.blocks.length - 1];
      if (last && last.source !== 'marker' && last.status === 'running') {
        tab.blocks.pop();
        if (tab.current === last) tab.current = null;
      }
      // E is exact for zsh/fish and the first simple command for bash;
      // the anchor refines it to the full line below.
      const block = { command: tab.pendingCmd || '(command)', startedAt: Date.now(), status: 'running', source: 'marker' };
      tab.blocks.push(block);
      if (tab.blocks.length > 30) tab.blocks.splice(0, tab.blocks.length - 30);
      tab.markerStack.push(block);
      tab.current = block;
      tab.pendingCmd = '';
      if (!T.blocksHidden) $('#term-blocks').hidden = false;
      if (tab === T.active) renderBlocks();
      updateBlocksToggle();
      nanoOnCommand(tab);
      let refined = false;
      const refine = () => {
        if (refined) return; refined = true;
        if (!tab.markerStack.includes(block)) return; // already finished
        const text = commandFromAnchor(tab);
        // The anchor is captured lazily after the prompt flushes, so a
        // fast typist can move the cursor past the prompt end before it
        // fires — the slice then starts inside the command (a typed
        // `ls /nope` records as `/nope`). The E marker comes from the
        // shell, so the true command always contains it: only accept
        // an anchor reading that contains the E command, otherwise
        // keep E. No E yet (block.command is '(command)') → accept.
        const e = block.command;
        if (text && text !== e && (e === '(command)' || text.includes(e))) {
          block.command = text;
          if (tab === T.active) renderBlocks();
        }
        tab.markerAnchor = null;
      };
      try { tab.term.write('', refine); } catch { refine(); }
      setTimeout(() => { if (!refined) refine(); }, 200);
      return;
    }
    if (ev.kind === 'D') {
      const block = tab.markerStack.pop();
      if (!block) return; // startup D, or Ctrl+C at an empty prompt
      const code = ev.code;
      block.status = code === 130 ? 'cancelled' : 'done';
      if (code != null) block.exitCode = code;
      block.durationMs = Date.now() - block.startedAt;
      // A nested shell finishing returns to the outer command's block.
      tab.current = tab.markerStack.length ? tab.markerStack[tab.markerStack.length - 1] : null;
      if (tab === T.active) renderBlocks();
      return;
    }
  }

  function finishBlock(tab, status, code) {
    const b = tab.current;
    if (!b) return;
    b.status = status;
    if (code != null) b.exitCode = code;
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
      const row = el('div', 'term-block' + (b.status === 'running' ? ' running' : '') + (b.status === 'done' && b.exitCode ? ' failed' : ''));
      const cmd = el('span', 'tb-cmd');
      cmd.textContent = b.command;
      cmd.title = b.command;
      const status = el('span', 'tb-status');
      if (b.status === 'running') status.textContent = 'Running…';
      else if (b.status === 'cancelled') status.textContent = 'Cancelled' + (b.durationMs != null ? ' · ' + fmtDuration(b.durationMs) : '');
      else if (b.exitCode != null) {
        status.textContent = 'exit ' + b.exitCode + ' · ' + fmtDuration(b.durationMs);
        status.className = 'tb-status' + (b.exitCode === 0 ? ' tb-ok' : ' tb-err');
      } else status.textContent = fmtDuration(b.durationMs);
      const copy = el('button', 'tb-btn');
      copy.textContent = 'Copy';
      copy.title = 'Copy command';
      copy.onclick = () => window.api.copy(b.command);
      const rerun = el('button', 'tb-btn');
      rerun.textContent = 'Rerun';
      rerun.title = 'Run this command again';
      rerun.onclick = () => { tab.term.focus(); tab.term.paste(b.command + '\r'); };
      row.append(cmd, status, copy, rerun);
      // Failed blocks only (done, non-zero exit): one click asks the
      // agent to explain the failure and propose a fix. Running,
      // cancelled, and tracker blocks without an exit code get none.
      if (b.status === 'done' && b.exitCode) {
        const explain = el('button', 'tb-btn');
        explain.textContent = 'Explain';
        explain.title = 'Ask the agent to explain this failure and propose a fix';
        explain.onclick = () => {
          if (T.opts.onExplain) T.opts.onExplain({ command: b.command, exitCode: b.exitCode, status: b.status, output: bufferTail(tab.term, 30) });
        };
        row.append(explain);
      }
      box.append(row);
    }
    box.scrollTop = box.scrollHeight;
  }

  function updateBlocksToggle() {
    const n = T.tabs.reduce((a, t) => a + t.blocks.length, 0);
    $('#term-blocks-toggle').textContent = n ? `Blocks (${n})` : 'Blocks';
  }

  /* ---------- nano autocomplete: detection + word source ----------
   * VS Code-style completions while editing inside nano. Suggestions come
   * only from the open file + the visible screen + small keyword lists —
   * no LSP, no whole-project symbols. The popup itself lives in Phase 2;
   * this phase is detection, words, and loading the open file. */

  const NANO_KEYWORDS = {
    js: ['function', 'const', 'let', 'var', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'class', 'extends', 'new', 'this', 'typeof', 'instanceof', 'try', 'catch', 'finally', 'throw', 'async', 'await', 'import', 'export', 'from', 'default', 'null', 'undefined', 'true', 'false', 'console', 'require', 'module', 'exports', 'document', 'window', 'Array', 'Object', 'String', 'Number', 'Promise'],
    py: ['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'break', 'continue', 'pass', 'import', 'from', 'as', 'with', 'try', 'except', 'finally', 'raise', 'lambda', 'None', 'True', 'False', 'self', 'print', 'len', 'range', 'str', 'int', 'list', 'dict', 'set', 'tuple', 'open'],
    c: ['int', 'char', 'void', 'float', 'double', 'long', 'short', 'unsigned', 'signed', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'struct', 'enum', 'typedef', 'const', 'static', 'extern', 'include', 'define', 'sizeof', 'NULL'],
    html: ['div', 'span', 'html', 'head', 'body', 'title', 'script', 'style', 'link', 'meta', 'class', 'href', 'src', 'input', 'button', 'form', 'label', 'table', 'ul', 'li', 'p'],
    css: ['color', 'background', 'margin', 'padding', 'border', 'display', 'flex', 'grid', 'font-size', 'width', 'height', 'position', 'absolute', 'relative', 'block', 'none', 'solid'],
    sh: ['echo', 'cd', 'ls', 'cat', 'grep', 'sed', 'awk', 'if', 'then', 'else', 'fi', 'for', 'do', 'done', 'while', 'function', 'return', 'exit', 'export', 'source', 'test'],
    json: ['true', 'false', 'null'],
    md: [],
    rs: ['fn', 'let', 'mut', 'const', 'struct', 'enum', 'impl', 'trait', 'pub', 'use', 'mod', 'return', 'if', 'else', 'for', 'while', 'loop', 'match', 'break', 'continue', 'Some', 'None', 'Ok', 'Err', 'Result', 'Vec', 'String', 'println'],
    go: ['func', 'var', 'const', 'type', 'struct', 'interface', 'package', 'import', 'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'break', 'continue', 'defer', 'go', 'chan', 'map', 'string', 'int', 'bool', 'nil', 'fmt'],
  };
  const NANO_EXTS = { js: 'js', mjs: 'js', jsx: 'js', ts: 'js', tsx: 'js', py: 'py', c: 'c', h: 'c', cpp: 'c', hpp: 'c', html: 'html', htm: 'html', css: 'css', scss: 'css', sh: 'sh', bash: 'sh', json: 'json', md: 'md', rs: 'rs', go: 'go' };
  const extOf = (file) => {
    const m = /\.([A-Za-z0-9]+)$/.exec(file || '');
    return (m && NANO_EXTS[m[1].toLowerCase()]) || '';
  };

  // `nano file`, `sudo nano file`, `nano -w file`, `nano +12 file` →
  // { file } (file may be null when nano opens an empty buffer).
  function parseNanoCommand(cmd) {
    if (!cmd) return null;
    const parts = cmd.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    let i = 0;
    if (parts[0] === 'sudo') i = 1;
    if (parts[i] !== 'nano') return null;
    i++;
    let file = null;
    for (; i < parts.length; i++) {
      const p = parts[i];
      if (p === '--') continue;
      if (/^-\S/.test(p)) continue; // flags: -w, -l, -c, -T4
      if (/^\+\d/.test(p)) continue; // +line flag
      if (/^\d+$/.test(p)) continue; // a flag's numeric argument (e.g. -l 10)
      file = p.replace(/^["']|["']$/g, '');
    }
    return { file };
  }

  // nano is the foreground app when the submitted command parses as nano
  // AND the screen shows nano's UI (title bar, or the ^G help footer).
  // The command alone can't prove it — the user may have exited already.
  function nanoActive(tab) {
    const parsed = parseNanoCommand(tab.current && tab.current.command);
    if (!parsed) return null;
    try {
      const b = tab.term.buffer.active;
      const top = b.getLine(0);
      if (top && /GNU nano/.test(top.translateToString(true))) return parsed;
      for (let i = Math.max(0, b.length - 2); i < b.length; i++) {
        const line = b.getLine(i);
        if (line && /\^G Get Help/.test(line.translateToString(true))) return parsed;
      }
      return null;
    } catch { return null; }
  }

  // The word being typed, read off the cursor line (nano's screen is the
  // source of truth — the pty echo lags a keystroke behind onData).
  function wordBeforeCursor(tab) {
    try {
      const b = tab.term.buffer.active;
      const line = b.getLine(b.cursorY);
      if (!line) return '';
      const s = line.translateToString(true).slice(0, b.cursorX);
      const m = s.match(/[\w$]+$/);
      return m ? m[0] : '';
    } catch { return ''; }
  }

  // Every word in the open file (if readable) plus every word visible on
  // screen — the screen copy covers unsaved edits. Returns word → count.
  function collectWords(tab, fileText) {
    const counts = new Map();
    const add = (text) => {
      if (!text) return;
      for (const m of text.matchAll(/[A-Za-z_$][\w$]*/g)) {
        const w = m[0];
        if (w.length < 2) continue;
        counts.set(w, (counts.get(w) || 0) + 1);
      }
    };
    add(fileText);
    try {
      const b = tab.term.buffer.active;
      for (let i = 0; i < b.length; i++) {
        const line = b.getLine(i);
        if (line) add(line.translateToString(true));
      }
    } catch {}
    return counts;
  }

  // Prefix match (case-insensitive), most frequent first, then A–Z, max 8.
  // The exact word itself is never offered — it is already typed.
  function rankSuggestions(prefix, counts, ext) {
    const q = prefix.toLowerCase();
    const out = [];
    for (const [word, n] of counts) {
      if (word.toLowerCase() === q) continue;
      if (word.toLowerCase().startsWith(q)) out.push({ word, kind: 'word', freq: n });
    }
    for (const kw of NANO_KEYWORDS[ext] || []) {
      if (kw.toLowerCase().startsWith(q) && kw.toLowerCase() !== q && !counts.has(kw)) {
        out.push({ word: kw, kind: 'keyword', freq: 0 });
      }
    }
    out.sort((a, b) => b.freq - a.freq || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
    return out.slice(0, 8);
  }

  // Load the file nano was opened with (once per path). Relative paths
  // resolve against the chat cwd — if the user cd'd elsewhere in the
  // shell, the read misses and screen words carry the suggestions.
  async function refreshNanoFile(tab, parsed) {
    const file = parsed && parsed.file;
    if (!file) { tab.nanoFile = null; return; }
    let abs = file;
    if (!abs.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(abs)) {
      const cwd = (T.opts.getCwd && T.opts.getCwd()) || '';
      abs = cwd ? cwd.replace(/\/$/, '') + '/' + file : file;
    }
    if (tab.nanoFile && tab.nanoFile.path === abs) return;
    tab.nanoFile = { path: abs, text: '', ext: extOf(abs) };
    try {
      const r = await window.api.readFileText(abs);
      if (r && r.ok && tab.nanoFile && tab.nanoFile.path === abs) tab.nanoFile.text = r.text || '';
    } catch {}
  }

  // Called when a command is submitted: nano may have just started (load
  // its file) or just exited (drop the cached file).
  function nanoOnCommand(tab) {
    const parsed = parseNanoCommand(tab.current && tab.current.command);
    if (parsed) refreshNanoFile(tab, parsed);
    else tab.nanoFile = null;
  }

  /* ---------- nano autocomplete: popup ----------
   * One shared DOM popup, absolutely positioned over #term-body at the
   * cursor. Printable keys are never intercepted — they flow to the pty
   * and the popup re-filters from the buffer after the echo arrives. */

  let nanoEl = null;
  function nanoPopupEl() {
    if (!nanoEl) {
      nanoEl = el('div', 'nano-complete');
      nanoEl.hidden = true;
      $('#term-body').append(nanoEl);
    }
    return nanoEl;
  }

  function nanoHide(tab) {
    if (tab && tab.nano) { tab.nano.open = false; tab.nano.items = []; }
    if (nanoEl) nanoEl.hidden = true;
  }

  // Recompute after output arrives (debounced): the buffer lags onData by
  // one echo, so the word is read from the screen, not from keystrokes.
  function nanoSchedule(tab) {
    if (!tab.nano || T.opts.nanoComplete === false) return;
    clearTimeout(tab.nano.timer);
    tab.nano.timer = setTimeout(() => nanoRefresh(tab, false), 40);
  }

  function nanoRefresh(tab, force) {
    if (!tab.nano || T.opts.nanoComplete === false) { nanoHide(tab); return; }
    if (tab !== T.active) return;
    // A paste hides the popup for one cycle; the next keystroke brings it
    // back from the fresh buffer.
    if (tab.nano.pasteHide) { tab.nano.pasteHide = false; nanoHide(tab); return; }
    const parsed = nanoActive(tab);
    if (!parsed) { nanoHide(tab); return; }
    const prefix = wordBeforeCursor(tab);
    // Accepting a suggestion writes its suffix to the pty; the echo would
    // otherwise re-show the popup for the just-completed word.
    if (tab.nano.justAccepted) { tab.nano.justAccepted = false; nanoHide(tab); return; }
    if (!force && prefix.length < 2) { nanoHide(tab); return; }
    const counts = collectWords(tab, tab.nanoFile ? tab.nanoFile.text : '');
    const ext = tab.nanoFile ? tab.nanoFile.ext : extOf(parsed.file || '');
    const items = rankSuggestions(prefix, counts, ext);
    if (!items.length) { nanoHide(tab); return; }
    tab.nano.items = items;
    tab.nano.prefix = prefix;
    tab.nano.active = 0;
    tab.nano.open = true;
    nanoRender(tab);
  }

  function nanoRender(tab) {
    const box = nanoPopupEl();
    box.innerHTML = '';
    tab.nano.items.forEach((it, i) => {
      const row = el('button', 'nano-item' + (i === tab.nano.active ? ' active' : ''));
      row.type = 'button';
      const w = el('span', 'nano-word');
      w.textContent = it.word;
      const k = el('span', 'nano-kind');
      k.textContent = it.kind;
      row.append(w, k);
      // mousedown (not click) + preventDefault: clicking must not blur the
      // terminal before the accept lands.
      row.onmousedown = (e) => { e.preventDefault(); nanoAccept(tab, i); };
      box.append(row);
    });
    box.hidden = false;
    if (!nanoPosition(tab)) nanoHide(tab);
  }

  // Cursor cell → pixels, from the rendered screen rect. Flips above the
  // cursor line when it would overflow the bottom of the pane.
  // Returns false when the screen rect is unavailable (nothing to anchor
  // to — the caller hides the popup instead of showing it unanchored).
  function nanoPosition(tab) {
    const box = nanoPopupEl();
    const body = $('#term-body');
    const screen = tab.pane.querySelector('.xterm-screen');
    if (!screen || !body) return false;
    const sr = screen.getBoundingClientRect();
    const br = body.getBoundingClientRect();
    const cellW = sr.width / tab.term.cols;
    const cellH = sr.height / tab.term.rows;
    const b = tab.term.buffer.active;
    let left = sr.left - br.left + b.cursorX * cellW;
    let top = sr.top - br.top + (b.cursorY + 1) * cellH;
    const maxLeft = body.clientWidth - box.offsetWidth - 4;
    if (left > maxLeft) left = Math.max(4, maxLeft);
    if (top + box.offsetHeight > body.clientHeight - 4) {
      top = sr.top - br.top + b.cursorY * cellH - box.offsetHeight;
      if (top < 0) top = 4;
    }
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    return true;
  }

  // Accept: write only the not-yet-typed suffix, so nano receives it as
  // typed text. Nothing else is sent — no fake keystrokes, no buffer edits.
  // The popup can be a keystroke stale (40ms debounce) and nano may have
  // exited since it rendered: only complete when the word on screen still
  // extends the rendered prefix, the item still completes it, and nano is
  // still the foreground app. Otherwise just close the popup.
  function nanoAccept(tab, idx) {
    const st = tab.nano;
    if (!st || !st.open || !st.items[idx]) return;
    const item = st.items[idx];
    const cur = wordBeforeCursor(tab);
    if (!nanoActive(tab) || !cur.toLowerCase().startsWith(st.prefix.toLowerCase()) || !item.word.toLowerCase().startsWith(cur.toLowerCase())) {
      nanoHide(tab);
      return;
    }
    const suffix = item.word.slice(cur.length);
    st.justAccepted = true;
    nanoHide(tab);
    if (suffix) window.api.termWrite(tab.id, suffix);
    tab.term.focus();
  }

  function setNanoComplete(v) {
    T.opts.nanoComplete = v !== false;
    if (!T.opts.nanoComplete) for (const t of T.tabs) nanoHide(t);
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

  async function init(opts) {
    T.opts = opts || {};
    T.opts.nanoComplete = T.opts.nanoComplete !== false;
    T.inited = true;
    T.fontSize = Number(T.opts.fontSize) || 13;
    T.fontFamily = T.opts.fontFamily || MONO;

    document.querySelectorAll('#top .seg button').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
    $('#term-new').onclick = () => newTab();
    $('#term-split').onclick = () => splitToggle();
    $('#term-search-btn').onclick = () => { if (T.active) searchOpen(T.active); };
    const sInput = $('#term-search-input');
    sInput.addEventListener('input', () => searchRun('next', true));
    sInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); searchRun(e.shiftKey ? 'prev' : 'next', false); }
      else if (e.key === 'Escape') { e.preventDefault(); searchClose(); }
    });
    sInput.addEventListener('blur', () => {
      // The addon's own pattern: the active decoration sits on top of
      // the selection, so clearing it on blur reveals the match.
      const st = T.search;
      if (st.tab && st.tab.search) { try { st.tab.search.clearActiveDecoration(); } catch {} }
    });
    const bindSearchBtn = (id, fn) => {
      // mousedown + preventDefault: clicking must not blur the input.
      $(id).addEventListener('mousedown', (e) => { e.preventDefault(); fn(); });
    };
    bindSearchBtn('#term-search-prev', () => searchRun('prev', false));
    bindSearchBtn('#term-search-next', () => searchRun('next', false));
    bindSearchBtn('#term-search-close', () => searchClose());
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
      if (tab) { tab.term.write(data); nanoSchedule(tab); }
      else {
        if (!T.early.has(id)) T.early.set(id, []);
        T.early.get(id).push(data);
      }
    });
    // OSC 133 markers (startup D/A can arrive before the tab has its id;
    // they are no-ops — an empty stack and a cleared pending command —
    // so unknown ids are simply ignored, unlike term-data).
    window.api.on('term-osc', (ev) => {
      const tab = ev && T.tabs.find((t) => t.id === ev.id);
      if (tab) onOsc(tab, ev);
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

    // Restore saved tabs BEFORE the saved view is applied: setView
    // creates a tab when the view is term/split and no tabs exist, so
    // restoring after it would leave an extra tab behind (and save it).
    if (opts.initialTabs && opts.initialTabs.length) {
      await restoreTabs(opts.initialTabs, opts.initialActiveTab);
    }
    const saved = load('view');
    setView(saved === 'split' || saved === 'term' ? saved : 'chat');
  }

  // _nano is a test hook (headless harness + launch test drive the popup
  // through it); it is not part of the app's UI surface. _blocks is the
  // same for the shell-integration marker path. _search is the same for
  // the terminal search bar. _split is the same for split panes.
  window.TermUI = { init, setView, toggle, newTab, sendText, updateTheme, setFont, setFontFamily, askAi, focus, setNanoComplete, _session: { getTabs: sessionTabs, getActiveIndex: sessionActiveIndex, getState: () => ({ tabs: sessionTabs(), activeTab: sessionActiveIndex() }), restoreTabs, isReady: () => !!T.inited }, _nano: { parseNanoCommand, rankSuggestions, wordBeforeCursor, nanoActive, extOf, getActiveTab: () => T.active, refresh: nanoRefresh, accept: nanoAccept, hide: nanoHide, schedule: nanoSchedule }, _blocks: { onOsc, commandFromAnchor, getActiveTab: () => T.active, lastBlockOutput, render: renderBlocks }, _search: { open: searchOpen, close: searchClose, run: searchRun, getState: () => ({ open: !!T.search.tab, tab: T.search.tab ? T.search.tab.n : null, query: T.search.query, resultIndex: T.search.resultIndex, resultCount: T.search.resultCount }), getActiveTab: () => T.active }, _split: { split: splitToggle, splitTab, unsplit: unsplitTab, isSplit, getState: () => ({ split: isSplit(), active: T.active ? T.active.n : null, partner: T.active && T.active.partner ? T.active.partner.n : null, panes: T.active ? spVisible(T.active).length : 0 }), getActiveTab: () => T.active, getPartnerTab: () => (T.active && T.active.partner) || null } };
})();
