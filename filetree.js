// File tree helpers: entry sorting and relative-path handling for the
// sidebar tree. Pure Node — no Electron deps — so it is unit-testable
// with plain `node tests/filetree.test.js`. The renderer reaches these
// as window.PortalFileTree (loaded as a plain <script> in index.html);
// the preload cannot require() this file — in this Electron build the
// preload's require() resolves only the 'electron' module.
'use strict';

// Max entries shown per directory. Enforced in main by listDirScoped;
// kept here so the renderer and the cap agree (the truncated note).
const MAX_TREE_ENTRIES = 500;

// Directories first, then files, alphabetical within each group.
// Case-insensitive with a case-sensitive tiebreak, so 'Makefile' and
// 'makefile' sort deterministically. Links sort by their mapped type
// (main maps a symlink to its target type before sending entries).
function sortTreeEntries(entries) {
  const rank = (e) => (e && e.type === 'dir' ? 0 : 1);
  return [...(entries || [])].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r) return r;
    const an = String(a.name || '').toLowerCase();
    const bn = String(b.name || '').toLowerCase();
    if (an !== bn) return an < bn ? -1 : 1;
    const ao = String(a.name || '');
    const bo = String(b.name || '');
    return ao < bo ? -1 : ao > bo ? 1 : 0;
  });
}

// Join a parent relative path and a child name with '/'. The root's
// parent is '' — joining it gives just the name.
function joinRel(parent, name) {
  const p = String(parent || '');
  const n = String(name || '');
  return p ? p + '/' + n : n;
}

// Last component of a '/'-joined relative path.
function baseName(rel) {
  const r = String(rel || '');
  const i = r.lastIndexOf('/');
  return i < 0 ? r : r.slice(i + 1);
}

const FileTreeUtils = {
  MAX_TREE_ENTRIES,
  sortTreeEntries,
  joinRel,
  baseName,
};
if (typeof module !== 'undefined' && module.exports) module.exports = FileTreeUtils;
if (typeof window !== 'undefined') window.PortalFileTree = FileTreeUtils;
