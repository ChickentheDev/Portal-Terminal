(() => {
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  const esc = window.escHtml;

  const messagesEl = $('#messages');
  const scrollEl = $('#scroll');
  const inputEl = $('#input');
  const sendBtn = $('#send');
  const titleEl = $('#title');

  const S = {
    settings: null,
    cur: null, // current chat
    running: new Set(), // chat ids with a task in progress
    auto: false,
    stream: null, // { wrap, md, think, thinkText, text }
    transient: null, // approval / running card
    working: null,
    stick: true,
    status: { ok: false, models: [] },
    agents: [], // known agent models (Hermes first) from main
  };

  const suggestions = [
    'What is using the most disk space in my home folder?',
    'Show me my system info: OS, CPU, memory, and free disk space',
    'Find the 10 largest files in my Downloads folder',
  ];

  /* ---------- helpers ---------- */

  const isRunning = () => S.cur && S.running.has(S.cur.id);

  async function copyText(text, btn) {
    await window.api.copy(text);
    if (btn) {
      const old = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => (btn.textContent = old), 1200);
    }
  }

  function shortPath(p) {
    if (!p) return '~';
    const parts = p.split(/[\\/]/).filter(Boolean);
    if (parts.length <= 2) return p;
    return '…/' + parts.slice(-2).join('/');
  }

  function scrollDown(force) {
    if (force || S.stick) scrollEl.scrollTop = scrollEl.scrollHeight;
  }
  scrollEl.addEventListener('scroll', () => {
    S.stick = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 80;
  });

  // Font family keys (settings) -> CSS stacks. 'system' is the platform
  // default: sans for chat, mono for the terminal.
  const MONO_STACKS = {
    system: 'ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace',
    jetbrains: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    fira: '"Fira Code", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    plex: '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace',
  };
  const SANS_STACK = '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
  const monoStack = (key) => MONO_STACKS[key] || MONO_STACKS.system;
  const chatStack = (key) => (key === 'system' ? SANS_STACK : monoStack(key));
  // Each theme's own accent, for the color input when no custom accent is set.
  const THEME_ACCENTS = { dark: '#48e0c2', light: '#48e0c2', 'warp-dark': '#ffc24b', dracula: '#bd93f9', nord: '#88c0d0', 'solarized-dark': '#2aa198', 'one-dark': '#61afef' };
  let accentCustom = false; // true once the user picks a custom accent color

  function applyTheme() {
    document.body.dataset.theme = S.settings.theme || 'dark';
    // custom accent overrides the theme accent; empty = the theme's own
    if (S.settings.accent) document.body.style.setProperty('--neon-teal', S.settings.accent);
    else document.body.style.removeProperty('--neon-teal');
    applyFonts();
    window.TermUI.updateTheme();
  }

  function applyFonts() {
    document.body.style.setProperty('--chat-size', (S.settings.chatFont || 15) + 'px');
    document.body.style.setProperty('--chat-font', chatStack(S.settings.chatFontFamily));
    document.body.style.setProperty('--mono', monoStack(S.settings.termFontFamily));
    window.TermUI.setFont(S.settings.termFont);
    window.TermUI.setFontFamily(monoStack(S.settings.termFontFamily));
  }

  /* ---------- sidebar ---------- */

  function groupLabel(ts) {
    const d = new Date(ts);
    const now = new Date();
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(now) - day(d)) / 86400000);
    if (diff <= 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return 'Previous 7 days';
    return 'Older';
  }

  async function refreshList() {
    const q = $('#search').value;
    const chats = await window.api.listChats(q);
    const list = $('#chat-list');
    list.innerHTML = '';
    if (!chats.length) {
      list.append(el('div', 'empty-list', q ? 'Nothing matches that search.' : 'Past chats will show up here.'));
      return;
    }
    let last = null;
    for (const c of chats) {
      const g = groupLabel(c.updated);
      if (g !== last) { list.append(el('div', 'group', g)); last = g; }
      const item = el('div', 'item' + (S.cur && S.cur.id === c.id ? ' active' : ''));
      const t = el('span', 't');
      t.textContent = c.title;
      t.title = c.title;
      const x = el('button', 'x', '×');
      x.title = 'Delete chat';
      x.setAttribute('aria-label', 'Delete chat');
      x.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete "${c.title}"? This can't be undone.`)) return;
        await window.api.deleteChat(c.id);
        if (S.cur && S.cur.id === c.id) await startNewChat(true);
        else refreshList();
      };
      item.append(t, x);
      item.onclick = () => openChat(c.id);
      list.append(item);
    }
  }

  /* ---------- file tree ---------- */

  const TREE = {
    mode: 'chats', // 'chats' | 'files'
    loaded: false,
    stale: true,
    cwd: null, // cwd the tree was last loaded for
    expanded: new Set(), // rel paths of expanded dirs
    children: new Map(), // rel path -> sorted entries
    truncated: new Set(), // rel paths whose listing hit the 500 cap
    errors: new Map(), // rel path -> error text for a failed listing
    refreshing: false,
  };

  function setSideMode(mode) {
    TREE.mode = mode;
    document.querySelectorAll('.side-seg button').forEach((b) => b.classList.toggle('on', b.dataset.side === mode));
    $('#chat-list').hidden = mode !== 'chats';
    $('#search').hidden = mode !== 'chats';
    $('#file-tree-wrap').hidden = mode !== 'files';
    if (mode === 'files') { renderTree(); refreshFileTree(); }
  }

  function treeReset() {
    TREE.loaded = false;
    TREE.stale = true;
    TREE.cwd = null;
    TREE.expanded.clear();
    TREE.children.clear();
    TREE.truncated.clear();
    TREE.errors.clear();
  }

  async function loadTreeDir(rel) {
    const u = window.PortalFileTree;
    let r;
    try { r = await window.api.listFiles(S.cur.id, rel); } catch { r = { ok: false, error: 'Could not list files.' }; }
    if (!r || !r.ok) {
      TREE.errors.set(rel, (r && r.error) || 'Could not list files.');
      TREE.children.delete(rel);
      TREE.truncated.delete(rel);
      return false;
    }
    TREE.errors.delete(rel);
    TREE.children.set(rel, u.sortTreeEntries(r.entries || []));
    if (r.truncated) TREE.truncated.add(rel);
    else TREE.truncated.delete(rel);
    return true;
  }

  function treeNote(text, cls) {
    const d = el('div', 'tree-note' + (cls ? ' ' + cls : ''));
    d.textContent = text;
    return d;
  }

  function treeRow(rel, entry, depth) {
    const row = el('div', 'tree-row' + (entry.type === 'dir' ? ' dir' : ' file'));
    row.style.setProperty('--depth', depth);
    row.tabIndex = 0;
    row.setAttribute('role', 'treeitem');
    const caret = el('span', 'tree-caret');
    caret.textContent = entry.type === 'dir' ? (TREE.expanded.has(rel) ? '▾' : '▸') : '';
    const name = el('span', 'tree-name');
    name.textContent = entry.name;
    name.title = rel;
    row.append(caret, name);
    const activate = () => {
      if (entry.type === 'dir') toggleTreeDir(rel);
      else openTreeFile(rel);
    };
    row.onclick = activate;
    row.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
    };
    return row;
  }

  function renderTreeDir(rel, depth, out) {
    if (TREE.errors.has(rel)) {
      const note = treeNote(TREE.errors.get(rel), 'tree-err');
      note.style.setProperty('--depth', depth);
      out.append(note);
      return;
    }
    const kids = TREE.children.get(rel);
    if (!kids) return;
    if (!kids.length) {
      const note = treeNote('Empty folder');
      note.style.setProperty('--depth', depth);
      out.append(note);
      return;
    }
    for (const entry of kids) {
      const childRel = window.PortalFileTree.joinRel(rel, entry.name);
      out.append(treeRow(childRel, entry, depth));
      if (entry.type === 'dir' && TREE.expanded.has(childRel)) renderTreeDir(childRel, depth + 1, out);
    }
    if (TREE.truncated.has(rel)) {
      const note = treeNote(`… ${window.PortalFileTree.MAX_TREE_ENTRIES} entries shown`);
      note.style.setProperty('--depth', depth);
      out.append(note);
    }
  }

  function renderTree() {
    const box = $('#file-tree');
    box.innerHTML = '';
    if (!window.PortalFileTree) {
      box.append(treeNote('File tree helpers failed to load — restart the app.', 'tree-err'));
      return;
    }
    if (!S.cur) return;
    if (!TREE.loaded) {
      box.append(treeNote('Loading…'));
      return;
    }
    const frag = document.createDocumentFragment();
    renderTreeDir('', 0, frag);
    box.append(frag);
  }

  async function refreshFileTree() {
    if (TREE.mode !== 'files' || !S.cur) { TREE.stale = true; return; }
    if (TREE.refreshing) { TREE.stale = true; return; }
    if (TREE.cwd !== S.cur.cwd) treeReset();
    TREE.refreshing = true;
    try {
      if (!window.PortalFileTree) { renderTree(); return; }
      await loadTreeDir('');
      // Drop expanded dirs that no longer exist (e.g. deleted
      // externally), shallow first so a pruned parent also prunes its
      // children. A deleted dir would otherwise be re-fetched (and
      // fail) on every refresh, and its stale entry would linger.
      const u = window.PortalFileTree;
      const byDepth = [...TREE.expanded].sort((a, b) => a.split('/').length - b.split('/').length);
      for (const rel of byDepth) {
        const slash = rel.lastIndexOf('/');
        const parent = slash < 0 ? '' : rel.slice(0, slash);
        const kids = TREE.children.get(parent);
        if (!kids || !kids.some((e) => e.name === u.baseName(rel) && e.type === 'dir')) {
          TREE.expanded.delete(rel);
          TREE.children.delete(rel);
          TREE.errors.delete(rel);
          TREE.truncated.delete(rel);
          continue;
        }
        await loadTreeDir(rel);
      }
      TREE.loaded = true;
      TREE.cwd = S.cur.cwd;
      TREE.stale = false;
      renderTree();
    } finally {
      TREE.refreshing = false;
      if (TREE.stale && TREE.mode === 'files') refreshFileTree();
    }
  }

  async function toggleTreeDir(rel) {
    if (TREE.expanded.has(rel)) {
      TREE.expanded.delete(rel);
      renderTree();
      return;
    }
    await loadTreeDir(rel);
    TREE.expanded.add(rel);
    renderTree();
  }

  async function openTreeFile(rel) {
    if (!S.cur) return;
    let r;
    try { r = await window.api.readFile(S.cur.id, rel); } catch { r = { ok: false, error: 'Could not read file.' }; }
    removeEmpty();
    if (r && r.ok && r.message) {
      S.cur.messages.push(r.message);
      appendMessage(r.message);
    } else {
      // A refused read (oversize, binary, outside cwd) is still shown,
      // as an error file card — never a silent no-op.
      appendMessage({
        role: 'tool', tool_name: 'file_read',
        content: (r && r.error) || 'Could not read file.',
        meta: { kind: 'file', op: 'read', path: rel, command: 'read ' + rel, status: 'error' },
      });
    }
    scrollDown();
  }

  /* ---------- rendering messages ---------- */

  function userMsg(m) {
    const wrap = el('div', 'msg user');
    const b = el('div', 'bubble');
    b.textContent = m.content;
    const actions = el('div', 'actions');
    const copy = el('button', 'link-btn', 'Copy');
    copy.onclick = () => copyText(m.content, copy);
    actions.append(copy);
    wrap.append(b, actions);
    return wrap;
  }

  function thinkBlock(text, open) {
    const d = el('details', 'think');
    if (open) d.open = true;
    const s = el('summary', null, 'Thinking');
    const t = el('div', 'tt');
    t.textContent = text;
    d.append(s, t);
    return d;
  }

  function aiMsg(m) {
    const wrap = el('div', 'msg ai');
    if (m.thinking) wrap.append(thinkBlock(m.thinking, false));
    if (m.content && m.content.trim()) {
      wrap.append(el('div', 'md', window.md(m.content)));
      const actions = el('div', 'actions');
      const copy = el('button', 'link-btn', 'Copy');
      copy.onclick = () => copyText(m.content, copy);
      actions.append(copy);
      wrap.append(actions);
    }
    return wrap;
  }

  function cmdCard(m) {
    const meta = m.meta || {};
    const status = meta.status || 'ran';
    const card = el('div', 'cmd ' + status);
    const head = el('div', 'cmd-h');
    head.append(el('span', 'prompt', '$'));
    const code = el('code', 'cmd-t');
    code.textContent = meta.command || '';
    head.append(code);

    let tagText = '';
    if (status === 'ran') tagText = 'exit ' + (meta.code == null ? '?' : meta.code);
    else tagText = status;
    const tag = el('span', 'tag');
    tag.textContent = tagText;
    head.append(tag);

    const btns = el('div', 'cmd-b');
    const cc = el('button', 'link-btn', 'Copy command');
    cc.onclick = () => copyText(meta.command || '', cc);
    const tt = el('button', 'link-btn', 'Send to terminal');
    tt.title = 'Paste into the terminal without running it';
    tt.onclick = () => window.TermUI.sendText(meta.command || '');
    btns.append(cc, tt);
    if (status === 'ran') {
      const co = el('button', 'link-btn', 'Copy output');
      co.onclick = () => copyText(m.content || '', co);
      btns.append(co);
    }
    head.append(btns);
    card.append(head);

    if (status === 'ran' && m.content) {
      const out = el('pre', 'cmd-o');
      out.textContent = m.content;
      card.append(out);
      if (m.content.split('\n').length > 14) {
        const more = el('button', 'link-btn', 'Show all');
        more.onclick = () => {
          const open = out.classList.toggle('open');
          more.textContent = open ? 'Show less' : 'Show all';
        };
        btns.prepend(more);
      }
    }
    return card;
  }

  function appendMessage(m) {
    let node = null;
    if (m.role === 'user') node = userMsg(m);
    else if (m.role === 'assistant') node = aiMsg(m);
    else if (m.role === 'tool') node = (m.meta && m.meta.kind === 'file') ? fileCard(m) : cmdCard(m);
    if (node && node.children.length) messagesEl.append(node);
  }

  // Diff as a <pre> with one span per line — file contents are never
  // inserted as HTML, so a diff of a malicious file can't inject markup.
  function diffPre(diff) {
    const pre = el('pre', 'cmd-o diff');
    for (const line of String(diff).split('\n')) {
      const span = document.createElement('span');
      span.textContent = line + '\n';
      if (line.startsWith('+')) span.className = 'diff-add';
      else if (line.startsWith('-')) span.className = 'diff-del';
      else if (line.startsWith('@@')) span.className = 'diff-hunk';
      pre.append(span);
    }
    return pre;
  }

  // Long bodies get the same Show all / Show less collapse as command output.
  function addCollapse(pre, btns) {
    if (pre.textContent.split('\n').length > 14) {
      const more = el('button', 'link-btn', 'Show all');
      more.onclick = () => {
        const open = pre.classList.toggle('open');
        more.textContent = open ? 'Show less' : 'Show all';
      };
      btns.prepend(more);
    }
  }

  function fileCard(m) {
    const meta = m.meta || {};
    const op = meta.op || 'file';
    const status = meta.status || 'ran';
    const card = el('div', 'cmd file ' + status);
    const head = el('div', 'cmd-h');
    head.append(el('span', 'prompt', op));
    const code = el('code', 'cmd-t');
    code.textContent = meta.path || '';
    head.append(code);
    let tagText = status;
    if (status === 'applied' && meta.additions != null) tagText = `+${meta.additions} −${meta.deletions}`;
    const tag = el('span', 'tag');
    tag.textContent = tagText;
    head.append(tag);
    const btns = el('div', 'cmd-b');
    if (meta.diff) {
      const cc = el('button', 'link-btn', 'Copy diff');
      cc.onclick = () => copyText(meta.diff, cc);
      btns.append(cc);
    }
    head.append(btns);
    card.append(head);
    if (meta.diff) {
      const pre = diffPre(meta.diff);
      card.append(pre);
      addCollapse(pre, btns);
    }
    if (m.content) {
      if (meta.diff && (status === 'error' || status === 'denied' || status === 'stopped')) {
        // The diff shows what was proposed; the note says why it did not apply.
        const note = el('div', 'file-note');
        note.textContent = m.content;
        card.append(note);
      } else if (!meta.diff) {
        // read / list results, or a short error / no-change note
        const out = el('pre', 'cmd-o');
        out.textContent = m.content;
        card.append(out);
        addCollapse(out, btns);
      }
    }
    return card;
  }

  function renderEmpty() {
    const box = el('div', 'empty');
    box.append(el('h1', null, 'What should we do?'));
    box.append(el('p', null, 'I can run commands and edit files in your working directory. I ask before each change.'));
    const wrap = el('div', 'suggest');
    for (const s of suggestions) {
      const b = el('button');
      b.textContent = s;
      b.onclick = () => { inputEl.value = s; autosize(); inputEl.focus(); };
      wrap.append(b);
    }
    box.append(wrap);
    messagesEl.append(box);
  }

  function renderAll() {
    messagesEl.innerHTML = '';
    S.stream = S.transient = S.working = null;
    if (!S.cur.messages.length) renderEmpty();
    else S.cur.messages.forEach(appendMessage);
    S.stick = true;
    scrollDown(true);
  }

  function removeEmpty() {
    const e = messagesEl.querySelector('.empty');
    if (e) e.remove();
  }

  /* ---------- live state ---------- */

  function setWorking(on) {
    if (S.working) { S.working.remove(); S.working = null; }
    if (on) {
      S.working = el('div', 'working', '<i></i><i></i><i></i>');
      messagesEl.append(S.working);
      scrollDown();
    }
  }
  function clearTransient() {
    if (S.transient) { S.transient.remove(); S.transient = null; }
  }
  function clearStream() {
    if (S.stream) { S.stream.wrap.remove(); S.stream = null; }
  }

  function approvalCard(callId, command) {
    const card = el('div', 'cmd waiting');
    const head = el('div', 'cmd-h');
    head.append(el('span', 'prompt', '$'));
    const code = el('code', 'cmd-t');
    code.textContent = command;
    head.append(code);
    const tag = el('span', 'tag', 'waiting for you');
    head.append(tag);
    const btns = el('div', 'cmd-b');
    const cc = el('button', 'link-btn', 'Copy command');
    cc.onclick = () => copyText(command, cc);
    btns.append(cc);
    head.append(btns);
    card.append(head);

    const row = el('div', 'approve');
    const mk = (label, decision, cls) => {
      const b = el('button', 'btn small ' + (cls || ''));
      b.textContent = label;
      b.onclick = () => {
        window.api.decide(callId, decision);
        if (decision === 'y' || decision === 'a') showRunning(command);
        else { clearTransient(); setWorking(true); }
      };
      return b;
    };
    row.append(mk('Run', 'y', 'solid'), mk('Deny', 'n'), mk('Always run', 'a'));
    card.append(row);
    return card;
  }

  // Approval card for a file write/edit: op + path + the exact diff.
  // Buttons mirror the command card (Apply / Deny / Always run).
  function fileApprovalCard(payload) {
    const card = el('div', 'cmd waiting');
    const head = el('div', 'cmd-h');
    head.append(el('span', 'prompt', payload.op || 'file'));
    const code = el('code', 'cmd-t');
    code.textContent = payload.path || '';
    head.append(code);
    head.append(el('span', 'tag', 'waiting for you'));
    card.append(head);
    if (payload.diff) card.append(diffPre(payload.diff));

    const row = el('div', 'approve');
    const mk = (label, decision, cls) => {
      const b = el('button', 'btn small ' + (cls || ''));
      b.textContent = label;
      b.onclick = () => {
        window.api.decide(payload.callId, decision);
        if (decision === 'y' || decision === 'a') showApplying(payload.op, payload.path);
        else { clearTransient(); setWorking(true); }
      };
      return b;
    };
    row.append(mk('Apply', 'y', 'solid'), mk('Deny', 'n'), mk('Always run', 'a'));
    card.append(row);
    return card;
  }

  function showApproval(payload) {
    setWorking(false);
    clearStream();
    clearTransient();
    S.transient = payload.kind === 'file' ? fileApprovalCard(payload) : approvalCard(payload.callId, payload.command);
    messagesEl.append(S.transient);
    scrollDown();
  }

  function showApplying(op, pathArg) {
    setWorking(false);
    clearStream();
    clearTransient();
    const card = el('div', 'cmd');
    const head = el('div', 'cmd-h');
    head.append(el('span', 'prompt', op || 'file'));
    const code = el('code', 'cmd-t');
    code.textContent = pathArg || '';
    head.append(code, el('span', 'tag', 'applying'));
    card.append(head, el('div', 'running-line', 'Applying…'));
    S.transient = card;
    messagesEl.append(card);
    scrollDown();
  }

  function showRunning(command) {
    setWorking(false);
    clearStream();
    clearTransient();
    const card = el('div', 'cmd');
    const head = el('div', 'cmd-h');
    head.append(el('span', 'prompt', '$'));
    const code = el('code', 'cmd-t');
    code.textContent = command;
    head.append(code, el('span', 'tag', 'running'));
    card.append(head, el('div', 'running-line', 'Running…'));
    S.transient = card;
    messagesEl.append(card);
    scrollDown();
  }

  function applyLive(live) {
    if (!live || !live.running) return;
    S.running.add(S.cur.id);
    if (live.approval) showApproval(live.approval);
    else if (live.exec) showRunning(live.exec);
    else setWorking(true);
  }

  function ensureStream() {
    if (S.stream) return S.stream;
    setWorking(false);
    clearTransient();
    removeEmpty();
    const wrap = el('div', 'msg ai');
    const think = el('details', 'think');
    think.hidden = true;
    think.append(el('summary', null, 'Thinking'), el('div', 'tt'));
    const body = el('div', 'md');
    wrap.append(think, body);
    messagesEl.append(wrap);
    S.stream = { wrap, think, tt: think.querySelector('.tt'), md: body, text: '', thinkText: '', raf: 0 };
    return S.stream;
  }

  function paintStream() {
    const st = S.stream;
    if (!st) return;
    st.raf = 0;
    st.md.innerHTML = window.md(st.text);
    if (st.thinkText) { st.think.hidden = false; st.tt.textContent = st.thinkText; st.tt.scrollTop = st.tt.scrollHeight; }
    scrollDown();
  }

  /* ---------- composer ---------- */

  function autosize() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
  }

  function updateComposer() {
    const running = isRunning();
    sendBtn.classList.toggle('stop', running);
    sendBtn.title = running ? 'Stop' : 'Send';
    sendBtn.setAttribute('aria-label', running ? 'Stop' : 'Send');
    inputEl.placeholder = running ? 'Working… press Stop to interrupt' : 'Ask for something to be done';
  }

  async function sendMessage() {
    if (!S.cur) return;
    if (isRunning()) { await window.api.stop(S.cur.id); return; }
    const text = inputEl.value.trim();
    if (!text) return;
    inputEl.value = '';
    autosize();
    S.running.add(S.cur.id);
    updateComposer();
    S.stick = true;
    setWorking(true);
    const ok = await window.api.send(S.cur.id, text);
    if (!ok) { S.running.delete(S.cur.id); updateComposer(); setWorking(false); }
  }

  /* ---------- chats ---------- */

  function renderHeader() {
    titleEl.value = S.cur.title;
    const cwd = $('#cwd');
    cwd.textContent = shortPath(S.cur.cwd);
    cwd.title = (S.cur.cwd || '') + '\nClick to change the working directory';
    const fc = $('#files-cwd');
    fc.textContent = shortPath(S.cur.cwd);
    fc.title = S.cur.cwd || '';
  }
  function renderAuto() {
    const a = $('#auto');
    a.textContent = S.auto ? 'Auto-run' : 'Ask first';
    a.classList.toggle('on', S.auto);
  }

  async function openChat(id) {
    const r = await window.api.getChat(id);
    if (!r || !r.chat) { await startNewChat(true); return; }
    S.cur = r.chat;
    renderHeader();
    renderAll();
    applyLive(r.live);
    updateComposer();
    refreshList();
    refreshFileTree();
    if (window.innerWidth <= 820) $('#sidebar').classList.add('hidden');
    inputEl.focus();
  }

  async function startNewChat(force) {
    if (!force && S.cur && !S.cur.messages.length && !isRunning()) { inputEl.focus(); return; }
    const c = await window.api.newChat();
    await openChat(c.id);
  }

  /* ---------- events from main ---------- */

  function bindEvents() {
    const on = window.api.on;

    on('stream', (p) => {
      if (!S.cur || p.chatId !== S.cur.id) return;
      const st = ensureStream();
      if (p.content) st.text += p.content;
      if (p.thinking) st.thinkText += p.thinking;
      if (!st.raf) st.raf = requestAnimationFrame(paintStream);
    });

    on('message', (p) => {
      if (!S.cur || p.chatId !== S.cur.id) return;
      const m = p.message;
      S.cur.messages.push(m);
      if (m.meta && m.meta.cwd && m.meta.cwd !== S.cur.cwd) { S.cur.cwd = m.meta.cwd; renderHeader(); refreshFileTree(); }
      setWorking(false);
      clearStream();
      clearTransient();
      removeEmpty();
      appendMessage(m);
      // An agent write/edit that applied changes the cwd contents.
      if (m.meta && m.meta.kind === 'file' && m.meta.status === 'applied') refreshFileTree();
      if (S.running.has(S.cur.id)) setWorking(true);
      scrollDown();
    });

    on('approval', (p) => {
      if (!S.cur || p.chatId !== S.cur.id) return;
      showApproval(p);
    });

    on('running', (p) => {
      if (!S.cur || p.chatId !== S.cur.id) return;
      if (p.kind === 'file') {
        if (!S.transient || !S.transient.querySelector('.running-line')) showApplying(p.op, p.path);
        return;
      }
      if (!S.transient || !S.transient.querySelector('.running-line')) showRunning(p.command);
    });

    on('error', (p) => {
      if (!S.cur || p.chatId !== S.cur.id) return;
      setWorking(false);
      clearStream();
      clearTransient();
      const e = el('div', 'err');
      e.textContent = p.error;
      messagesEl.append(e);
      scrollDown();
    });

    on('done', (p) => {
      S.running.delete(p.chatId);
      if (S.cur && p.chatId === S.cur.id) {
        setWorking(false);
        clearStream();
        clearTransient();
        updateComposer();
        inputEl.focus();
      }
      refreshList();
    });

    on('chat-updated', (p) => {
      if (S.cur && p.chatId === S.cur.id) {
        window.api.getChat(p.chatId).then((r) => {
          if (!r || !r.chat || !S.cur) return;
          S.cur.title = r.chat.title; titleEl.value = r.chat.title;
        });
      }
      refreshList();
    });

    on('auto', (p) => { S.auto = !!p.auto; renderAuto(); });
  }

  /* ---------- settings ---------- */

  function refreshModelList() {
    const dl = $('#model-list');
    dl.innerHTML = '';
    const seen = new Set();
    for (const m of S.status.models) { seen.add(m); const o = document.createElement('option'); o.value = m; dl.append(o); }
    // Agent presets (Hermes first) so the model is pickable before it's pulled.
    for (const a of S.agents) {
      if (seen.has(a.name)) continue;
      seen.add(a.name);
      const o = document.createElement('option');
      o.value = a.name;
      o.label = a.label;
      dl.append(o);
    }
  }

  async function openSettings() {
    const s = S.settings;
    $('#s-model').value = s.model;
    $('#s-host').value = s.host;
    $('#s-ctx').value = s.ctx;
    $('#s-steps').value = s.maxSteps;
    $('#s-timeout').value = s.timeout;
    $('#s-theme').value = s.theme;
    accentCustom = !!s.accent;
    $('#s-accent').value = s.accent || THEME_ACCENTS[s.theme] || '#48e0c2';
    $('#s-termfontfam').value = s.termFontFamily || 'system';
    $('#s-chatfontfam').value = s.chatFontFamily || 'system';
    $('#s-chatfont').value = s.chatFont || 15;
    $('#s-dir').value = s.startDir;
    $('#s-instr').value = s.instructions;
    $('#s-termfont').value = s.termFont;
    $('#s-shell').value = s.shell || '';
    $('#s-nano').checked = s.nanoComplete !== false;
    $('#s-shellint').checked = s.shellIntegration !== false;
    $('#s-autoollama').value = s.autoOllama === false ? 'no' : 'yes';
    refreshModelList();
    refreshModels();
    $('#modal').hidden = false;
    $('#s-model').focus();
  }
  const closeSettings = () => ($('#modal').hidden = true);

  /* ---------- model manager ---------- */

  let modelsCache = null; // last ollama:models result, or null while unloaded

  function modelRow(m) {
    const u = window.PortalModels;
    const row = document.createElement('div');
    row.className = 'model-row';
    const info = document.createElement('div');
    info.className = 'model-info';
    const name = document.createElement('span');
    name.className = 'model-name';
    name.textContent = m.name;
    if (u.isHfTag(m.name)) {
      const b = document.createElement('span');
      b.className = 'model-badge';
      b.textContent = 'HF';
      b.title = 'Hugging Face model';
      name.append(' ', b);
    }
    const preset = u.matchPreset(m.name, S.agents || []);
    if (preset) {
      const p = document.createElement('span');
      p.className = 'model-preset';
      p.textContent = preset.label;
      name.append(' ', p);
    }
    if (u.isCurrentModel(m.name, S.settings.model)) {
      const c = document.createElement('span');
      c.className = 'model-current';
      c.textContent = 'current agent';
      name.append(' ', c);
    }
    const meta = document.createElement('span');
    meta.className = 'model-meta';
    meta.textContent = `${u.formatSize(m.size)} · ${u.formatDate(m.modified_at)}`;
    info.append(name, meta);
    const btns = document.createElement('div');
    btns.className = 'model-btns';
    const use = document.createElement('button');
    use.className = 'btn small';
    use.type = 'button';
    use.textContent = 'Use';
    use.disabled = u.isCurrentModel(m.name, S.settings.model);
    use.onclick = () => useModel(m.name);
    const del = document.createElement('button');
    del.className = 'btn small';
    del.type = 'button';
    del.textContent = 'Delete';
    del.onclick = () => deleteModel(m.name);
    btns.append(use, del);
    row.append(info, btns);
    return row;
  }

  async function refreshModels() {
    const list = $('#s-models-list');
    const status = $('#s-models-status');
    const pullBtn = $('#s-models-pull');
    const preset = $('#s-models-preset');
    // models.js loads as a plain <script> in index.html; if it ever fails
    // to load, say so instead of hanging on "Loading models…".
    if (!window.PortalModels) {
      status.textContent = 'Model helpers failed to load — restart the app.';
      pullBtn.disabled = true;
      return;
    }
    // Populate the pull preset select once, from the agent presets.
    if (!preset.options.length) {
      for (const a of S.agents || []) {
        const o = document.createElement('option');
        o.value = a.name;
        o.textContent = a.label;
        preset.append(o);
      }
    }
    list.innerHTML = '';
    status.textContent = 'Loading models…';
    let r;
    try { r = await window.api.listModels(); } catch { r = { ok: false }; }
    if (!r || !r.ok) {
      modelsCache = null;
      status.textContent = 'Ollama is offline — start it with ollama serve.';
      pullBtn.disabled = true;
      return;
    }
    modelsCache = r.models || [];
    pullBtn.disabled = false;
    if (!modelsCache.length) {
      status.textContent = 'No models installed yet — pull one below.';
      return;
    }
    status.textContent = '';
    for (const m of modelsCache) list.append(modelRow(m));
  }

  async function useModel(name) {
    S.settings = await window.api.setSettings({ model: name });
    $('#s-model').value = S.settings.model;
    await pollStatus();
    refreshModelList();
    await refreshModels();
    $('#s-models-status').textContent = `Agent model is now ${S.settings.model}.`;
  }

  async function deleteModel(name) {
    if (!confirm(`Delete ${name} from Ollama?\nThis frees its disk space and can't be undone.`)) return;
    const r = await window.api.deleteModel(name);
    if (!r || !r.ok) {
      $('#s-models-status').textContent = `Could not delete ${name}: ${(r && r.error) || 'unknown error'}`;
      return;
    }
    let note = `Deleted ${name}.`;
    if (window.PortalModels.isCurrentModel(name, S.settings.model)) {
      S.settings = await window.api.setSettings({ model: 'hermes3:8b' });
      $('#s-model').value = S.settings.model;
      note += ' Agent model fell back to hermes3:8b.';
    }
    await pollStatus();
    refreshModelList();
    await refreshModels();
    $('#s-models-status').textContent = note;
  }

  async function pullManagerModel() {
    const btn = $('#s-models-pull');
    const status = $('#s-models-status');
    if (btn.disabled) return;
    const custom = $('#s-models-custom').value.trim();
    const v = window.PortalModels.validatePullTag(custom || $('#s-models-preset').value);
    if (!v.ok) { status.textContent = v.error; return; }
    const name = v.tag;
    btn.disabled = true;
    btn.textContent = 'Pulling…';
    const off = window.api.on('ollama:pull-progress', (p) => {
      if (p.model !== name) return;
      const pct = p.total > 0 ? `${Math.round((p.completed / p.total) * 100)}%` : p.status;
      btn.textContent = `Pulling… ${pct}`;
      status.textContent = `Pulling ${name}… ${pct} (progress is per layer)`;
    });
    const r = await window.api.pullModel(name);
    off();
    btn.disabled = false;
    btn.textContent = 'Pull';
    if (r.ok) {
      $('#s-models-custom').value = '';
      await pollStatus();
      refreshModelList();
      await refreshModels();
      status.textContent = `Pulled ${name}.`;
    } else {
      let err = `Could not pull ${name}: ${r.error || 'unknown error'}`;
      if (window.PortalModels.isHfTag(name)) err += ' If this is a Hugging Face model, try adding :Q4_K_M.';
      status.textContent = err;
    }
  }

  async function pullModel() {
    const btn = $('#s-model-pull');
    const name = $('#s-model').value.trim();
    if (!name || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = 'Pulling…';
    const off = window.api.on('ollama:pull-progress', (p) => {
      if (p.model !== name) return;
      btn.textContent = p.total > 0 ? `Pulling… ${Math.round((p.completed / p.total) * 100)}%` : `Pulling… ${p.status}`;
    });
    const r = await window.api.pullModel(name);
    off();
    btn.disabled = false;
    if (r.ok) {
      btn.textContent = 'Pulled';
      setTimeout(() => (btn.textContent = 'Pull model'), 2500);
      await pollStatus();
      refreshModelList();
    } else {
      btn.textContent = 'Pull failed';
      setTimeout(() => (btn.textContent = 'Pull model'), 3000);
      alert('Could not pull ' + name + ':\n' + (r.error || 'unknown error'));
    }
  }

  async function saveSettings() {
    S.settings = await window.api.setSettings({
      model: $('#s-model').value,
      host: $('#s-host').value,
      ctx: $('#s-ctx').value,
      maxSteps: $('#s-steps').value,
      timeout: $('#s-timeout').value,
      theme: $('#s-theme').value,
      accent: accentCustom ? $('#s-accent').value : '',
      termFontFamily: $('#s-termfontfam').value,
      chatFontFamily: $('#s-chatfontfam').value,
      chatFont: $('#s-chatfont').value,
      startDir: $('#s-dir').value,
      instructions: $('#s-instr').value,
      termFont: $('#s-termfont').value,
      shell: $('#s-shell').value,
      nanoComplete: $('#s-nano').checked,
      shellIntegration: $('#s-shellint').checked,
      autoOllama: $('#s-autoollama').value === 'yes',
    });
    applyTheme();
    window.TermUI.setNanoComplete(S.settings.nanoComplete);
    closeSettings();
    pollStatus();
  }

  /* ---------- command palette (Ctrl+K) ---------- */

  function paletteActions() {
    const acts = [
      { label: 'New chat', keys: 'Ctrl+N', run: () => startNewChat(false) },
      { label: 'Switch to Chat view', run: () => window.TermUI.setView('chat') },
      { label: 'Switch to Split view', run: () => window.TermUI.setView('split') },
      { label: 'Switch to Terminal view', run: () => window.TermUI.setView('term') },
      { label: 'New terminal tab', keys: 'Ctrl+Shift+T', run: () => window.TermUI.newTab() },
      { label: 'Toggle sidebar', run: () => $('#sidebar').classList.toggle('hidden') },
      { label: 'Open settings', keys: 'Ctrl+,', run: () => openSettings() },
      { label: 'Copy chat', run: async () => { if (S.cur) copyText(await window.api.chatMarkdown(S.cur.id)); } },
      { label: 'Export chat', run: () => { if (S.cur && S.cur.messages.length) window.api.exportChat(S.cur.id); } },
      { label: 'Ask AI about terminal selection', run: () => { window.TermUI.setView('split', { focus: false }); window.TermUI.askAi(); } },
      { label: 'Pull current agent model', run: () => { openSettings(); pullModel(); } },
      { label: 'Toggle auto-run', run: async () => { S.auto = await window.api.setAuto(!S.auto); renderAuto(); } },
      { label: 'Focus chat input', run: () => $('#input').focus() },
      { label: 'Focus search', run: () => { $('#sidebar').classList.remove('hidden'); $('#search').focus(); } },
    ];
    for (const a of S.agents || []) {
      acts.push({
        label: `Switch agent model to ${a.label}`,
        keywords: a.name,
        run: async () => { S.settings = await window.api.setSettings({ model: a.name }); pollStatus(); },
      });
    }
    return acts;
  }

  // Subsequence fuzzy match; tighter runs and prefix matches score higher.
  function fuzzyScore(q, text) {
    q = q.toLowerCase(); text = text.toLowerCase();
    let qi = 0, score = 0, last = -2;
    for (let i = 0; i < text.length && qi < q.length; i++) {
      if (text[i] === q[qi]) { score += last === i - 1 ? 2 : 1; last = i; qi++; }
    }
    if (qi < q.length) return -1;
    return score + (text.startsWith(q) ? 5 : 0);
  }

  const PAL = { items: [], shown: [], active: 0 };
  function openPalette() {
    PAL.items = paletteActions();
    PAL.active = 0;
    $('#palette').hidden = false;
    const input = $('#palette-input');
    input.value = '';
    renderPalette('');
    input.focus();
  }
  const closePalette = () => { $('#palette').hidden = true; };
  const paletteOpen = () => !$('#palette').hidden;

  function renderPalette(q) {
    const list = $('#palette-list');
    PAL.shown = PAL.items
      .map((a) => ({ a, s: q ? fuzzyScore(q, a.label + ' ' + (a.keywords || '')) : 1 }))
      .filter((x) => x.s >= 0)
      .sort((x, y) => y.s - x.s)
      .map((x) => x.a);
    if (PAL.active >= PAL.shown.length) PAL.active = Math.max(0, PAL.shown.length - 1);
    list.innerHTML = '';
    if (!PAL.shown.length) { list.append(el('div', 'pal-empty', 'No matching command.')); return; }
    PAL.shown.forEach((a, i) => {
      const b = el('button', 'pal-item' + (i === PAL.active ? ' active' : ''));
      b.setAttribute('role', 'option');
      const t = el('span'); t.textContent = a.label; b.append(t);
      if (a.keys) { const k = el('span', 'pal-keys'); k.textContent = a.keys; b.append(k); }
      b.onclick = () => { closePalette(); a.run(); };
      list.append(b);
    });
  }

  function paletteKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); PAL.active = Math.min((PAL.shown.length || 1) - 1, PAL.active + 1); renderPalette($('#palette-input').value); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); PAL.active = Math.max(0, PAL.active - 1); renderPalette($('#palette-input').value); }
    else if (e.key === 'Enter') { e.preventDefault(); const a = PAL.shown && PAL.shown[PAL.active]; if (a) { closePalette(); a.run(); } }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  }

  async function pollStatus() {
    S.status = await window.api.status();
    const node = $('#status');
    node.classList.toggle('ok', S.status.ok);
    let text = 'Ollama offline';
    if (S.status.ok) {
      const has = S.status.models.some((m) => m === S.settings.model || m === S.settings.model + ':latest');
      text = has ? S.settings.model : `${S.settings.model} not pulled`;
    }
    node.querySelector('span').textContent = text;
    node.title = S.status.ok ? 'Connected to Ollama' : `Cannot reach ${S.settings.host}. Run "ollama serve".`;
  }

  /* ---------- wiring ---------- */

  function bindUi() {
    $('#new-chat').onclick = () => startNewChat(false);
    document.querySelectorAll('.side-seg button').forEach((b) => { b.onclick = () => setSideMode(b.dataset.side); });
    $('#files-refresh').onclick = () => refreshFileTree();
    $('#toggle-side').onclick = () => $('#sidebar').classList.toggle('hidden');
    $('#open-settings').onclick = openSettings;
    $('#open-palette').onclick = () => openPalette();
    $('#s-cancel').onclick = closeSettings;
    $('#s-save').onclick = saveSettings;
    $('#s-models-refresh').onclick = refreshModels;
    $('#s-models-pull').onclick = pullManagerModel;
    $('#s-model-pull').onclick = pullModel;
    $('#s-reset').onclick = async () => { $('#s-instr').value = await window.api.defaultInstructions(); };
    $('#s-accent').addEventListener('input', () => { accentCustom = true; });
    $('#s-accent-reset').onclick = () => {
      accentCustom = false;
      $('#s-accent').value = THEME_ACCENTS[$('#s-theme').value] || '#48e0c2';
    };
    $('#s-theme').addEventListener('change', () => {
      if (!accentCustom) $('#s-accent').value = THEME_ACCENTS[$('#s-theme').value] || '#48e0c2';
    });
    $('#palette-input').addEventListener('input', (e) => { PAL.active = 0; renderPalette(e.target.value); });
    $('#palette-input').addEventListener('keydown', paletteKey);
    $('#palette').addEventListener('mousedown', (e) => { if (e.target.id === 'palette') closePalette(); });
    $('#s-dir-pick').onclick = async () => { const d = await window.api.pickDir(); if (d) $('#s-dir').value = d; };
    $('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeSettings(); });

    let searchTimer;
    $('#search').addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(refreshList, 180);
    });

    titleEl.addEventListener('change', async () => {
      if (!S.cur || !S.cur.messages.length) { titleEl.value = S.cur ? S.cur.title : ''; return; }
      S.cur.title = await window.api.renameChat(S.cur.id, titleEl.value);
      titleEl.value = S.cur.title;
      refreshList();
    });
    titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') titleEl.blur(); });

    $('#cwd').onclick = async () => {
      if (!S.cur || isRunning()) return;
      S.cur.cwd = await window.api.pickCwd(S.cur.id);
      renderHeader();
      refreshFileTree();
    };
    $('#auto').onclick = async () => {
      S.auto = !S.auto;
      await window.api.setAuto(S.auto);
      renderAuto();
    };
    $('#copy-chat').onclick = async (e) => {
      if (!S.cur || !S.cur.messages.length) return;
      copyText(await window.api.chatMarkdown(S.cur.id), e.currentTarget);
    };
    $('#export-chat').onclick = () => { if (S.cur && S.cur.messages.length) window.api.exportChat(S.cur.id); };

    sendBtn.onclick = sendMessage;
    inputEl.addEventListener('input', autosize);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); }
    });

    // delegated clicks inside messages: code copy and external links
    messagesEl.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-ext]');
      if (a) { e.preventDefault(); window.api.openExternal(a.href); return; }
      const b = e.target.closest('[data-act="copy-code"]');
      if (b) {
        const code = b.closest('.cb').querySelector('code').textContent;
        copyText(code, b);
        return;
      }
      const t = e.target.closest('[data-act="to-term"]');
      if (t) {
        let code = t.closest('.cb').querySelector('code').textContent.replace(/\n+$/, '');
        const lines = code.split('\n');
        if (lines.every((l) => /^\s*\$ /.test(l))) code = lines.map((l) => l.replace(/^\s*\$ /, '')).join('\n');
        window.TermUI.sendText(code);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('#termpanel')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); startNewChat(false); }
      else if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
      else if (mod && e.key === ',') { e.preventDefault(); openSettings(); }
      else if (e.key === 'Escape') {
        if (paletteOpen()) closePalette();
        else if (!$('#modal').hidden) closeSettings();
        else if (isRunning()) window.api.stop(S.cur.id);
      }
    });
  }

  async function init() {
    S.settings = await window.api.getSettings();
    S.agents = await window.api.agentModels();
    applyTheme();
    S.auto = await window.api.getAuto();
    renderAuto();
    bindUi();
    bindEvents();
    if (window.innerWidth <= 820) $('#sidebar').classList.add('hidden');
    await startNewChat(true);
    window.TermUI.init({
      fontSize: S.settings.termFont,
      fontFamily: monoStack(S.settings.termFontFamily),
      nanoComplete: S.settings.nanoComplete,
      getCwd: () => (S.cur && S.cur.cwd) || S.settings.startDir,
      onAsk: (text) => {
        const block = '```\n' + text + '\n```\n';
        inputEl.value = (inputEl.value ? inputEl.value + '\n\n' : 'What happened here, and what should I do next?\n\n') + block;
        autosize();
        window.TermUI.setView('split', { focus: false });
        inputEl.focus();
      },
    });
    pollStatus();
    setInterval(pollStatus, 10000);
  }

  init();
})();
