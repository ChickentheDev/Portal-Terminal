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

  function applyTheme() {
    document.body.dataset.theme = S.settings.theme === 'light' ? 'light' : 'dark';
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
    else if (m.role === 'tool') node = cmdCard(m);
    if (node && node.children.length) messagesEl.append(node);
  }

  function renderEmpty() {
    const box = el('div', 'empty');
    box.append(el('h1', null, 'What should we do?'));
    box.append(el('p', null, 'I can run commands on this computer. I ask before each one.'));
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

  function showApproval(callId, command) {
    setWorking(false);
    clearStream();
    clearTransient();
    S.transient = approvalCard(callId, command);
    messagesEl.append(S.transient);
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
    if (live.approval) showApproval(live.approval.callId, live.approval.command);
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
  }
  function renderAuto() {
    const a = $('#auto');
    a.textContent = S.auto ? 'Auto-run' : 'Ask first';
    a.classList.toggle('on', S.auto);
  }

  async function openChat(id) {
    const r = await window.api.getChat(id);
    S.cur = r.chat;
    renderHeader();
    renderAll();
    applyLive(r.live);
    updateComposer();
    refreshList();
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
      if (m.meta && m.meta.cwd) { S.cur.cwd = m.meta.cwd; renderHeader(); }
      setWorking(false);
      clearStream();
      clearTransient();
      removeEmpty();
      appendMessage(m);
      if (S.running.has(S.cur.id)) setWorking(true);
      scrollDown();
    });

    on('approval', (p) => {
      if (!S.cur || p.chatId !== S.cur.id) return;
      showApproval(p.callId, p.command);
    });

    on('running', (p) => {
      if (!S.cur || p.chatId !== S.cur.id) return;
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
        window.api.getChat(p.chatId).then((r) => { S.cur.title = r.chat.title; titleEl.value = r.chat.title; });
      }
      refreshList();
    });

    on('auto', (p) => { S.auto = !!p.auto; renderAuto(); });
  }

  /* ---------- settings ---------- */

  async function openSettings() {
    const s = S.settings;
    $('#s-model').value = s.model;
    $('#s-host').value = s.host;
    $('#s-ctx').value = s.ctx;
    $('#s-steps').value = s.maxSteps;
    $('#s-timeout').value = s.timeout;
    $('#s-theme').value = s.theme;
    $('#s-dir').value = s.startDir;
    $('#s-instr').value = s.instructions;
    $('#s-termfont').value = s.termFont;
    $('#s-shell').value = s.shell || '';
    $('#s-autoollama').value = s.autoOllama === false ? 'no' : 'yes';
    const dl = $('#model-list');
    dl.innerHTML = '';
    for (const m of S.status.models) { const o = document.createElement('option'); o.value = m; dl.append(o); }
    $('#modal').hidden = false;
    $('#s-model').focus();
  }
  const closeSettings = () => ($('#modal').hidden = true);

  async function saveSettings() {
    S.settings = await window.api.setSettings({
      model: $('#s-model').value,
      host: $('#s-host').value,
      ctx: $('#s-ctx').value,
      maxSteps: $('#s-steps').value,
      timeout: $('#s-timeout').value,
      theme: $('#s-theme').value,
      startDir: $('#s-dir').value,
      instructions: $('#s-instr').value,
      termFont: $('#s-termfont').value,
      shell: $('#s-shell').value,
      autoOllama: $('#s-autoollama').value === 'yes',
    });
    applyTheme();
    window.TermUI.updateTheme();
    window.TermUI.setFont(S.settings.termFont);
    closeSettings();
    pollStatus();
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
    $('#toggle-side').onclick = () => $('#sidebar').classList.toggle('hidden');
    $('#open-settings').onclick = openSettings;
    $('#s-cancel').onclick = closeSettings;
    $('#s-save').onclick = saveSettings;
    $('#s-reset').onclick = async () => { $('#s-instr').value = await window.api.defaultInstructions(); };
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
      else if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#sidebar').classList.remove('hidden'); $('#search').focus(); $('#search').select(); }
      else if (mod && e.key === ',') { e.preventDefault(); openSettings(); }
      else if (e.key === 'Escape') {
        if (!$('#modal').hidden) closeSettings();
        else if (isRunning()) window.api.stop(S.cur.id);
      }
    });
  }

  async function init() {
    S.settings = await window.api.getSettings();
    applyTheme();
    S.auto = await window.api.getAuto();
    renderAuto();
    bindUi();
    bindEvents();
    if (window.innerWidth <= 820) $('#sidebar').classList.add('hidden');
    await startNewChat(true);
    window.TermUI.init({
      fontSize: S.settings.termFont,
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
