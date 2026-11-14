// Unit tests for projcontext.js (project-aware context snapshot).
// Run: node tests/projcontext.test.js
'use strict';
const pc = require('../projcontext.js');

let pass = 0, fail = 0;
function check(cond, label) {
  if (cond) { pass++; console.log('PASS ' + label); }
  else { fail++; console.log('FAIL ' + label); }
}

// --- fake fs -------------------------------------------------------
// Fixture: map of absolute path -> node.
//   { dir: ['child', ...] } / { file: 'content' } / { link: '/target' }
// readFileSync calls are recorded so tests can prove a path was never read.
function makeFs(tree) {
  const reads = [];
  const node = (p) => tree[p] || null;
  const fs = {
    reads,
    readdirSync(p) {
      const n = node(p);
      if (!n || !n.dir) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return [...n.dir];
    },
    lstatSync(p) {
      const n = node(p);
      if (!n) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return { isDirectory: () => !!n.dir, isSymbolicLink: () => !!n.link, isFile: () => !!n.file };
    },
    realpathSync(p) {
      const n = node(p);
      if (!n) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return n.link || p;
    },
    statSync(p) {
      const real = fs.realpathSync(p);
      const n = node(real);
      if (!n) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return { isDirectory: () => !!n.dir, isFile: () => !!n.file };
    },
    readFileSync(p, enc) {
      reads.push(p);
      const n = node(p);
      if (!n || n.file === undefined) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }
      return enc ? n.file : Buffer.from(n.file);
    },
  };
  return fs;
}

function dir(children) { return { dir: children }; }
function file(content) { return { file: content }; }
function link(target) { return { link: target }; }

// --- detectStack ---------------------------------------------------
check(JSON.stringify(pc.detectStack(['package.json', 'index.js'])) === JSON.stringify(['Node']), 'detectStack: package.json -> Node');
check(JSON.stringify(pc.detectStack(['Cargo.toml', 'go.mod'])) === JSON.stringify(['Rust', 'Go']), 'detectStack: Cargo + go.mod in marker order');
check(JSON.stringify(pc.detectStack(['pyproject.toml'])) === JSON.stringify(['Python']), 'detectStack: pyproject.toml -> Python');
check(JSON.stringify(pc.detectStack(['app.csproj'])) === JSON.stringify(['.NET']), 'detectStack: .csproj -> .NET');
check(JSON.stringify(pc.detectStack(['main.py', 'util.py'])) === JSON.stringify(['Python']), 'detectStack: extension fallback .py -> Python');
check(JSON.stringify(pc.detectStack(['package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml'])) === JSON.stringify(['Node', 'Rust', 'Go']), 'detectStack: labels capped at 3 in marker priority order');
check(JSON.stringify(pc.detectStack(['notes.txt', 'photo.png'])) === JSON.stringify([]), 'detectStack: no marker or known extension -> []');
check(JSON.stringify(pc.detectStack([])) === JSON.stringify([]), 'detectStack: empty listing -> []');

// --- buildSnapshot: a Node project ---------------------------------
{
  const lines = Array.from({ length: 50 }, (_, i) => 'readme line ' + (i + 1));
  const fs = makeFs({
    '/w': dir(['package.json', 'README.md', 'src', 'main.js', '.env', 'node_modules', '.git']),
    '/w/package.json': file('{"name": "my-app", "version": "1.0.0"}'),
    '/w/README.md': file(lines.join('\n')),
    '/w/src': dir(['index.js']),
    '/w/main.js': file('console.log(1);\n'),
    '/w/.env': file('SECRET=abc123\n'),
    '/w/node_modules': dir(['x']),
    '/w/.git': dir(['config']),
  });
  const s = pc.buildSnapshot('/w', fs);
  check(s.ok === true, 'snapshot: builds for a Node project');
  check(s.name === 'my-app', 'snapshot: name comes from package.json');
  check(JSON.stringify(s.stack) === JSON.stringify(['Node']), 'snapshot: stack Node');
  check(JSON.stringify(s.tree.entries) === JSON.stringify(['src/', 'main.js', 'package.json', 'README.md']), 'snapshot: tree is dirs-first, alphabetical, dotfiles and node_modules/.git excluded');
  check(s.tree.total === 4, 'snapshot: tree total counts listed entries only');
  check(s.readme.found === true && s.readme.lines.length === 40 && s.readme.truncated === true, 'snapshot: README capped at 40 lines and marked truncated');
  check(s.readme.lines[0] === 'readme line 1' && s.readme.lines[39] === 'readme line 40', 'snapshot: README keeps the first 40 lines');
  check(s.text.includes('Project: my-app') && s.text.includes('Stack: Node') && s.text.includes('README (first 40 lines, truncated):'), 'snapshot: text block has project, stack, and truncated README header');
  check(s.summary === 'my-app · Node · 4 files · README', 'snapshot: summary line is name, stack, count, README');
  check(!fs.reads.some((p) => p.endsWith('.env')), 'snapshot: .env is never read');
  check(!s.text.includes('SECRET'), 'snapshot: no secret content leaks into the text');
}

// --- name fallbacks ------------------------------------------------
{
  const fs = makeFs({
    '/proj': dir(['main.py']),
    '/proj/main.py': file('print(1)\n'),
  });
  const s = pc.buildSnapshot('/proj', fs);
  check(s.ok && s.name === 'proj', 'name: falls back to the folder name without package.json');
  check(JSON.stringify(s.stack) === JSON.stringify(['Python']), 'name: stack still detected from extensions');
  check(s.readme.found === false && s.text.includes('README: none'), 'name: no README reports one line, nothing invented');
  check(s.summary === 'proj · Python · 1 file · no README', 'name: summary uses singular file and no README');
}
{
  const fs = makeFs({
    '/bad': dir(['package.json']),
    '/bad/package.json': file('{not json'),
  });
  const s = pc.buildSnapshot('/bad', fs);
  check(s.ok && s.name === 'bad', 'name: invalid package.json falls back to the folder name');
}

// --- tree cap ------------------------------------------------------
{
  const children = Array.from({ length: 35 }, (_, i) => 'f' + String(i).padStart(2, '0') + '.txt');
  const tree = { '/big': dir(children) };
  for (const c of children) tree['/big/' + c] = file('x\n');
  const s = pc.buildSnapshot('/big', makeFs(tree));
  check(s.tree.entries.length === 30 && s.tree.total === 35, 'tree: capped at 30 entries with the total kept');
  check(s.text.includes('(30 shown, +5 more)'), 'tree: text notes the overflow count');
}

// --- empty directory ------------------------------------------------
{
  const s = pc.buildSnapshot('/empty', makeFs({ '/empty': dir([]) }));
  check(s.ok && s.tree.total === 0 && s.text.includes('Files: (empty)'), 'tree: empty directory reports (empty)');
}

// --- missing / unreadable cwd --------------------------------------
{
  const s = pc.buildSnapshot('/gone', makeFs({ '/w': dir([]) }));
  check(s.ok === false, 'missing cwd: snapshot refuses with ok:false');
  check(pc.buildSnapshot('', makeFs({})).ok === false, 'empty cwd: snapshot refuses with ok:false');
}

// --- symlinks ------------------------------------------------------
{
  const fs = makeFs({
    '/w': dir(['inside', 'escape', 'real.txt']),
    '/w/inside': dir(['a.js']),
    '/w/escape': link('/etc'),
    '/w/real.txt': file('hi\n'),
    '/etc': dir(['passwd']),
  });
  const s = pc.buildSnapshot('/w', fs);
  check(s.ok && s.tree.entries.includes('inside/') && s.tree.entries.includes('real.txt'), 'symlink: a link staying inside the cwd is listed');
  check(!s.tree.entries.some((e) => e.startsWith('escape')), 'symlink: a link escaping the cwd is skipped');
}
{
  const fs = makeFs({
    '/w': dir(['README.md']),
    '/w/README.md': link('/etc/passwd'),
    '/etc/passwd': file('root:x:0:0\n'),
  });
  const s = pc.buildSnapshot('/w', fs);
  check(s.readme.found === false && s.text.includes('README: none'), 'symlink: an escaping README is refused, not read');
  check(!s.text.includes('root:x'), 'symlink: escaped README content never lands in the snapshot');
}

// --- README variants ------------------------------------------------
{
  const fs = makeFs({
    '/w': dir(['README.txt']),
    '/w/README.txt': file('plain readme\nsecond line\n'),
  });
  const s = pc.buildSnapshot('/w', fs);
  check(s.readme.found === true && s.readme.lines[0] === 'plain readme', 'readme: README.txt is used when there is no README.md');
}
{
  const big = 'x'.repeat(5000);
  const fs = makeFs({
    '/w': dir(['README.md']),
    '/w/README.md': file(big),
  });
  const s = pc.buildSnapshot('/w', fs);
  check(s.readme.found === true && s.readme.truncated === true, 'readme: a >4KB README is marked truncated');
  check(s.text.length < 5000 + 500, 'readme: the snapshot stays capped, the whole file is not inlined');
}

console.log(`projcontext.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
