// Copy last code block: pure helpers for copying the most recent
// fenced code block the agent produced. No Electron deps —
// unit-testable with plain `node tests/copycode.test.js`.
// The renderer reaches these through the plain <script> load in
// index.html (window.PortalCopyCode), like the other modules.
'use strict';

const PREVIEW_CAP = 40; // chars of the block shown in the copied hint

// The last fenced code block in the rendered agent messages, or null.
// root is the messages element; the query is scoped to agent messages
// (.msg.ai) so user messages (plain text, no markdown) and file/command
// cards (not .cb blocks) can never contribute. The DOM is the source of
// truth — the same text the per-block Copy button copies — so a block
// still streaming in is copied as it stands at that moment.
function findLastCodeBlock(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return null;
  const codes = root.querySelectorAll('.msg.ai .cb code');
  if (!codes || !codes.length) return null;
  const codeEl = codes[codes.length - 1];
  let lang = '';
  const cb = codeEl.closest ? codeEl.closest('.cb') : null;
  if (cb && typeof cb.querySelector === 'function') {
    const h = cb.querySelector('.cb-h span');
    if (h) lang = String(h.textContent || '').trim();
  }
  return { code: codeEl.textContent || '', lang };
}

// One line of the block for the confirmation hint: newlines become
// spaces, anything past the cap is cut with an ellipsis.
function previewOf(code) {
  const flat = String(code || '').replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return flat.length > PREVIEW_CAP ? flat.slice(0, PREVIEW_CAP).trimEnd() + '…' : flat;
}

// "Copied bash code block: ls -la ~/Downloads | sort -k5 -n…"
// An empty block has no preview; a missing language reads as text.
function copiedHint(block) {
  const lang = (block && block.lang) || 'text';
  const prev = previewOf(block && block.code);
  return prev ? 'Copied ' + lang + ' code block: ' + prev : 'Copied ' + lang + ' code block';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { findLastCodeBlock, previewOf, copiedHint, PREVIEW_CAP };
} else {
  window.PortalCopyCode = { findLastCodeBlock, previewOf, copiedHint, PREVIEW_CAP };
}
