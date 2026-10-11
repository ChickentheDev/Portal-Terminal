const { contextBridge, ipcRenderer } = require('electron');

const inv = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const EVENTS = ['stream', 'message', 'approval', 'running', 'done', 'error', 'chat-updated', 'auto', 'term-data', 'term-exit'];

contextBridge.exposeInMainWorld('api', {
  getSettings: () => inv('settings:get'),
  setSettings: (patch) => inv('settings:set', patch),
  defaultInstructions: () => inv('defaults:get'),

  listChats: (q) => inv('chats:list', q),
  newChat: () => inv('chats:new'),
  getChat: (id) => inv('chats:get', id),
  deleteChat: (id) => inv('chats:delete', id),
  renameChat: (id, title) => inv('chats:rename', id, title),
  chatMarkdown: (id) => inv('chats:markdown', id),
  exportChat: (id) => inv('chats:export', id),
  pickCwd: (id) => inv('chat:pickCwd', id),
  pickDir: () => inv('chat:pickDir'),

  send: (id, text) => inv('chat:send', id, text),
  stop: (id) => inv('chat:stop', id),
  decide: (callId, decision) => inv('tool:decide', callId, decision),

  getAuto: () => inv('auto:get'),
  setAuto: (v) => inv('auto:set', v),
  status: () => inv('ollama:status'),
  copy: (text) => inv('clipboard:write', text),
  paste: () => inv('clipboard:read'),

  termCreate: (opts) => inv('term:create', opts),
  termWrite: (id, data) => ipcRenderer.send('term:write', id, data),
  termResize: (id, cols, rows) => ipcRenderer.send('term:resize', id, cols, rows),
  termKill: (id) => inv('term:kill', id),
  openExternal: (url) => inv('open:external', url),

  on: (channel, fn) => {
    if (!EVENTS.includes(channel)) return () => {};
    const listener = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
