# File tree sidebar — design note

## Problem
The agent can read, write, and patch files in the chat's working
directory (v0.3.1), but Sam can't see what's in that directory without
asking the agent or switching to a terminal. The tree pairs with the
file tools: browse the cwd, click a file to see it as a read card.

## Goal
A file tree in the existing sidebar showing the current chat's cwd.
Browse + view only in v1 — no create/delete/rename, no drag-and-drop,
no in-tree editor. The agent tools cover writes.

## Layout decision (brief left it open)
A **Chats / Files toggle** in `.side-top`, reusing the `.seg`
segmented-control styles from the top-bar view switcher. It swaps the
middle area between `#chat-list` and the tree. Default is Chats.
Picked over a second stacked section because the chat list and the
tree both want the full sidebar height, and the toggle matches the
existing Chat/Split/Terminal switcher. The chat search input is hidden
while Files is active (it only searches chats).

## IPC surface (main.js, preload.js)
- `files:list(chatId, relPath)` → `{ ok: true, entries, truncated }`
  or `{ ok: false, error }`. Calls
  `ft.listDirScoped(chat.cwd, relPath || '.', { recursive: false,
  maxEntries: 500 })` — one directory per call, lazy expansion.
  Symlink entries are mapped to their target type (a link to a dir
  expands, a link to a file reads); a broken link stays type `link`
  and clicking it produces the read error. The mapping happens in
  main so `filetools.js` (shared with the agent's `file_list`) is
  untouched.
- `files:read(chatId, relPath)` → `{ ok: true, message }` or
  `{ ok: false, error }`. `ft.readFileScoped` with the same 200 KB
  cap, the same 6 000-char display truncation as the agent's
  `handleFileRead`, and the same `fileMeta('read', …)` shape, so the
  card renders identically to an agent read card (and chat search /
  markdown export see it the same way). The message is appended to
  the chat and persisted with `writeChat` — EXCEPT while a turn is
  running on that chat (`live.has(chatId)`), when persistence is
  skipped: the running turn holds its own in-memory copy of the chat
  and its next write would clobber the tree-read message. The card
  still renders in-session either way.

## Pure module (`filetree.js`, unit-testable, no Electron deps)
UMD-lite like `models.js`: `module.exports` for Node tests +
`window.PortalFileTree`, loaded as a plain `<script>` in index.html
before renderer.js. The preload CANNOT require() it (see the model
manager note — preload `require()` resolves only `electron`).
- `sortTreeEntries(entries)` — dirs first, then files, alphabetical
  (case-insensitive, case-sensitive tiebreak). Links sort by their
  mapped type.
- `joinRel(parent, name)` / `baseName(rel)` — `/`-joined relative
  paths, the same shape `listDirScoped` returns.
- `MAX_TREE_ENTRIES = 500` — the per-directory cap (enforced in main
  by `listDirScoped`; the constant lives here so the renderer and
  the cap agree).

## Renderer UI (index.html + renderer.js + styles.css)
- Markup: a `.seg.side-seg` toggle in `.side-top` (Chats / Files),
  and `<div id="file-tree-wrap" hidden>` after `#chat-list` with a
  header (the cwd short path + a Refresh button) and
  `<div id="file-tree">`.
- Tree state: `expanded` (Set of rel paths), `children` (Map rel →
  entries), `loaded`, `stale`. Root is listed on first switch to
  Files; a folder expands on click and lists its children on demand;
  an expanded folder's children re-fetch on refresh.
- Rows: `▸`/`▾` for collapsed/expanded folders, name in text
  (textContent only — a hostile filename can never inject markup).
  Dotfiles are shown; `.git` / `node_modules` / `dist` / secrets
  never arrive from main (filetools denylist). A truncated directory
  shows a dim "… 500 entries shown" row; an empty folder shows a dim
  "Empty folder" row.
- Click a file: `window.api.readFile(S.cur.id, rel)`; on ok, push the
  returned message to `S.cur.messages` and `appendMessage` it (the
  existing `fileCard`); on error, render an error file card with the
  same shape so the failure is visible, not silent.
- Refresh triggers: switching to Files (if stale / never loaded),
  the Refresh button, cwd change (cwd chip, or an agent command
  changing cwd — the `on('message')` handler's `meta.cwd` branch),
  an agent file write/edit applying (`meta.kind === 'file'` with
  `status === 'applied'`), and `openChat` when Files is visible.
  A tree read itself is `op: 'read'`, never `applied`, so it cannot
  trigger a refresh loop. A refresh also prunes expanded dirs that no
  longer exist (deleted externally), shallow first, so a deleted
  folder is not re-fetched and failed on every refresh.

## Scope / security
Exactly the filetools rules, because both IPC handlers go through
`resolveScopedPath` / `readFileScoped` / `listDirScoped`: cwd-scoped
only, `..` traversal / absolute paths outside cwd / symlink escapes
refused, `.git` / `node_modules` / `dist` / secrets hidden. The tree
never sends a path it did not get back from `files:list` (or the
root), so a hostile filename cannot smuggle a `..` into a read —
and even if it did, main would refuse it.

## Verification
- Unit: sorting (dirs first, case-insensitive, links by mapped
  type), path helpers, cap constant (`node tests/filetree.test.js`).
- Headless harness: toggle, sorted root render, expand loads
  children, file click shows the read card, hostile name escaped,
  refresh after an applied file message, cwd change re-lists,
  truncated + empty states. Zero page errors.
- Real Electron launch test under Xvfb with the fake Ollama: toggle
  to Files, expand a folder, click a file (card + content), click an
  oversize file (error card), agent edit applies and the tree picks
  up the new file, manual refresh. Zero page errors.
- Bug hunt after the build; CHANGELOG + screenshots before any
  version bump or packaging (release skill).

## Honest limits
- Read cards from the tree persist in the chat, except when clicked
  while a turn is running (then they show in-session only).
- One directory is fetched per listing call; a directory with more
  than 500 entries shows the first 500 (alphabetical) and a note.
- Symlinks to directories inside the cwd expand; symlinks escaping
  the cwd are refused by the same scope check as the agent tools.
- No create/delete/rename/drag-and-drop/in-tree editing in v1.
- The tree shows the cwd at refresh time — an external change (e.g.
  a terminal `git pull`) only appears after a refresh trigger.
