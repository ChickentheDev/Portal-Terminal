/* Minimal, dependency-free markdown renderer. All input is HTML-escaped first. */
(function () {
  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`\n]+)`/g, (m, c) => {
      codes.push(c);
      return '\x00' + (codes.length - 1) + '\x00';
    });
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\s][^*\n]*?)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" data-ext="1">$1</a>');
    s = s.replace(/\x00(\d+)\x00/g, (m, i) => '<code class="inl">' + codes[i] + '</code>');
    return s;
  }

  const SHELL_LANGS = /^(|bash|sh|shell|zsh|fish|console|terminal|cmd|powershell|ps1)$/i;

  function codeBlock(b) {
    const toTerm = SHELL_LANGS.test(b.lang || '')
      ? '<button class="link-btn" data-act="to-term" title="Paste into the terminal without running it">Send to terminal</button>'
      : '';
    return (
      '<div class="cb"><div class="cb-h"><span>' +
      esc(b.lang || 'text') +
      '</span><span class="cb-b">' + toTerm + '<button class="link-btn" data-act="copy-code">Copy</button></span></div><pre><code>' +
      esc(b.code) +
      '</code></pre></div>'
    );
  }

  const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
  const HEAD_RE = /^(#{1,6})\s+(.*)$/;
  const HR_RE = /^\s*([-*_])(\s*\1){2,}\s*$/;
  const PLACE_RE = /^\x01(\d+)\x01$/;

  function isTableStart(lines, i) {
    return lines[i].includes('|') && i + 1 < lines.length && lines[i + 1].includes('-') && SEP_RE.test(lines[i + 1]);
  }
  function startsBlock(lines, i) {
    const l = lines[i];
    return (
      !l.trim() ||
      PLACE_RE.test(l) ||
      HEAD_RE.test(l) ||
      HR_RE.test(l) ||
      /^>\s?/.test(l) ||
      LIST_RE.test(l) ||
      isTableStart(lines, i)
    );
  }

  function md(src) {
    const blocks = [];
    let text = String(src || '').replace(/\r\n/g, '\n');
    // Fenced code blocks (an unclosed fence is fine while streaming).
    text = text.replace(/```([^\n`]*)\n([\s\S]*?)(```|$)/g, (m, lang, code) => {
      blocks.push({ lang: lang.trim(), code: code.replace(/\n$/, '') });
      return '\n\x01' + (blocks.length - 1) + '\x01\n';
    });

    const lines = text.split('\n');
    let out = '';
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      let m;
      if (!line.trim()) { i++; continue; }

      if ((m = line.match(PLACE_RE))) { out += codeBlock(blocks[+m[1]]); i++; continue; }

      if ((m = line.match(HEAD_RE))) {
        const n = m[1].length;
        out += `<h${n}>${inline(esc(m[2]))}</h${n}>`;
        i++;
        continue;
      }

      if (HR_RE.test(line)) { out += '<hr>'; i++; continue; }

      if (/^>\s?/.test(line)) {
        const q = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i++; }
        out += '<blockquote>' + md(q.join('\n')) + '</blockquote>';
        continue;
      }

      if (isTableStart(lines, i)) {
        const cells = (l) => {
          let t = l.trim();
          if (t.startsWith('|')) t = t.slice(1);
          if (t.endsWith('|')) t = t.slice(0, -1);
          return t.split('|').map((c) => c.trim());
        };
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) { rows.push(cells(lines[i])); i++; }
        out +=
          '<div class="tbl"><table><thead><tr>' +
          head.map((c) => `<th>${inline(esc(c))}</th>`).join('') +
          '</tr></thead><tbody>' +
          rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(esc(c))}</td>`).join('') + '</tr>').join('') +
          '</tbody></table></div>';
        continue;
      }

      if ((m = line.match(LIST_RE))) {
        const ordered = /\d/.test(m[2][0]);
        const start = ordered ? parseInt(m[2], 10) : 1;
        let html = '';
        let lm;
        while (i < lines.length && (lm = lines[i].match(LIST_RE))) {
          const indent = Math.min(Math.floor(lm[1].replace(/\t/g, '  ').length / 2), 4);
          html += `<li style="margin-left:${indent * 1.2}rem">${inline(esc(lm[3]))}</li>`;
          i++;
        }
        out += ordered ? `<ol start="${start}">${html}</ol>` : `<ul>${html}</ul>`;
        continue;
      }

      // paragraph
      const para = [];
      while (i < lines.length && (para.length === 0 || !startsBlock(lines, i))) {
        para.push(inline(esc(lines[i])));
        i++;
      }
      out += '<p>' + para.join('<br>') + '</p>';
    }
    return out;
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { md, esc };
  else { window.md = md; window.escHtml = esc; }
})();
