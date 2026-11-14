// Unit tests for slashcmds.js — run: node tests/slashcmds.test.js
'use strict';
const sc = require('../slashcmds.js');

let pass = 0, fail = 0;
function check(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL ' + label); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- parseSlashPrefix ---
check(sc.parseSlashPrefix('/') === '', 'bare slash is an empty query');
check(sc.parseSlashPrefix('/rev') === 'rev', 'partial command is the query');
check(sc.parseSlashPrefix('/review') === 'review', 'full command is the query');
check(sc.parseSlashPrefix('  /com') === 'com', 'leading spaces are skipped');
check(sc.parseSlashPrefix('/review ') === null, 'a space after the name ends the query');
check(sc.parseSlashPrefix('/review x') === null, 'arguments are not a slash query');
check(sc.parseSlashPrefix('run /bin/ls') === null, 'slash mid-message is not a command');
check(sc.parseSlashPrefix('hello') === null, 'plain text is not a command');
check(sc.parseSlashPrefix('') === null, 'empty input is not a command');
check(sc.parseSlashPrefix(null) === null, 'null input is not a command');
check(sc.parseSlashPrefix('/REVIEW') === 'REVIEW', 'query keeps its case (filtering lowercases)');

// --- filterCommands ---
const snippets = [{ name: 'deploy', prompt: 'Deploy the app to the staging server' }, { name: 'tests', prompt: 'Run the test suite and summarize failures' }];
const all = sc.filterCommands('', snippets);
check(all.length === 7, 'empty query lists 5 built-ins + 2 snippets');
check(all[0].name === 'review' && all[1].name === 'commit-msg' && all[2].name === 'explain' && all[3].name === 'changelog' && all[4].name === 'pr', 'built-ins come first, in order');
check(all[5].name === 'deploy' && all[6].name === 'tests', 'snippets follow the built-ins');
check(all[0].builtin === true && all[5].builtin === false, 'builtin flag marks built-ins vs snippets');
check(eq(sc.filterCommands('com', snippets).map((c) => c.name), ['commit-msg', 'review', 'explain']), 'name match outranks description matches');
check(eq(sc.filterCommands('DIFF', snippets).map((c) => c.name), ['review', 'commit-msg', 'changelog']), 'case-insensitive match on the description');
check(eq(sc.filterCommands('deploy', snippets).map((c) => c.name), ['deploy']), 'snippet matches by name');
check(eq(sc.filterCommands('staging', snippets).map((c) => c.name), ['deploy']), 'snippet matches by prompt text');
check(sc.filterCommands('zzz', snippets).length === 0, 'no match is an empty list');
check(sc.filterCommands('', null).length === 5, 'null snippets still lists the built-ins');

// --- validateSnippet ---
check(eq(sc.validateSnippet('deploy', 'Deploy it', new Set()), { ok: true, snippet: { name: 'deploy', prompt: 'Deploy it' } }), 'good snippet validates');
check(sc.validateSnippet('Deploy', 'x', new Set()).snippet.name === 'deploy', 'name is lowercased');
check(sc.validateSnippet('review', 'x', new Set()).ok === false, 'built-in name is rejected');
check(sc.validateSnippet('changelog', 'x', new Set()).ok === false, 'git-helper name is rejected');
check(sc.validateSnippet('pr', 'x', new Set()).ok === false, 'git-helper name is rejected');
check(sc.validateSnippet('my cmd', 'x', new Set()).ok === false, 'name with a space is rejected');
check(sc.validateSnippet('my_cmd', 'x', new Set()).ok === false, 'name with an underscore is rejected');
check(sc.validateSnippet('', 'x', new Set()).ok === false, 'empty name is rejected');
check(sc.validateSnippet('-x', 'x', new Set()).ok === false, 'name may not start with a hyphen');
check(sc.validateSnippet('ok', 'x', new Set(['ok'])).ok === false, 'duplicate name is rejected');
check(sc.validateSnippet('ok', '', new Set()).ok === false, 'empty prompt is rejected');
check(sc.validateSnippet('ok', 'x'.repeat(4001), new Set()).ok === false, 'over-long prompt is rejected');
check(sc.validateSnippet('a'.repeat(33), 'x', new Set()).ok === false, 'over-long name is rejected');

// --- sanitizeSnippets ---
check(eq(sc.sanitizeSnippets(null), []), 'null sanitizes to an empty list');
check(eq(sc.sanitizeSnippets('nope'), []), 'non-array sanitizes to an empty list');
check(eq(sc.sanitizeSnippets([{ name: 'a', prompt: 'A' }, { name: 'review', prompt: 'R' }, { name: 'a', prompt: 'dup' }, { name: 'bad name', prompt: 'B' }, { name: 'b', prompt: '' }, null, 'x']),
  [{ name: 'a', prompt: 'A' }]), 'bad shapes, built-in collision, duplicate, and empty prompt are dropped');
const many = Array.from({ length: 60 }, (_, i) => ({ name: 's' + i, prompt: 'P' }));
check(sc.sanitizeSnippets(many).length === 50, 'list caps at 50 snippets');

// --- formatDiffBlock ---
const small = sc.formatDiffBlock('diff --git a/f b/f\n+hi\n', {});
check(small === '```diff\ndiff --git a/f b/f\n+hi\n\n```', 'small diff is fenced as-is');
const big = sc.formatDiffBlock('x'.repeat(40000), {});
check(big.includes('...[diff truncated to 30 KB]...'), 'over-cap diff carries the truncation marker');
check(big.includes('Diff truncated to 30 KB.'), 'truncation is noted after the fence');
check(big.length < 40000, 'truncated block is shorter than the raw diff');
const untr = sc.formatDiffBlock('d', { untracked: ['new.txt', 'other.js'] });
check(untr.includes('Untracked files (not shown): new.txt, other.js'), 'untracked names are listed, never shown');
const untrCap = sc.formatDiffBlock('d', { untracked: ['a'], untrackedTruncated: true });
check(untrCap.includes('a, …'), 'capped untracked list ends with an ellipsis');

// --- truncateOutput ---
check(sc.truncateOutput('abc') === 'abc', 'short output is untouched');
check(sc.truncateOutput('x'.repeat(8000)).includes('...[output truncated]...'), 'over-cap output is truncated');

// --- buildReviewMessage / buildCommitMessage ---
const rev = sc.buildReviewMessage('diff --git a/x b/x\n+1\n', { untracked: [] });
check(rev.startsWith('/review\n\n'), 'review message starts with the command');
check(rev.includes('Review the current uncommitted changes'), 'review message carries the instruction');
check(rev.includes('```diff\ndiff --git a/x b/x'), 'review message carries the fenced diff');
const cm = sc.buildCommitMessage('d', {});
check(cm.startsWith('/commit-msg\n\n') && cm.includes('Write a commit message'), 'commit message builder');
check(cm.includes('```diff\nd\n```'), 'commit message carries the fenced diff');

// --- buildExplainMessage ---
const ex = sc.buildExplainMessage({ command: 'npm test', exitCode: 1, status: 'done', output: 'FAIL 2 tests\n' });
check(ex.startsWith('/explain\n\n'), 'explain message starts with the command');
check(ex.includes('`$ npm test` (exit code 1)'), 'explain names the command and exit code');
check(ex.includes('```\nFAIL 2 tests\n\n```'), 'explain carries the fenced output');
const exRun = sc.buildExplainMessage({ command: 'sleep 9', status: 'running', output: '' });
check(exRun.includes('(still running)'), 'running block is marked still running');
check(exRun.includes('no exit code recorded'), 'running block has no exit code');
const exNone = sc.buildExplainMessage(null);
check(exNone.includes('(unknown command)'), 'null block degrades to unknown command');

// --- expandSnippet ---
check(sc.expandSnippet('Just do it', 'd', {}) === 'Just do it', 'template without {diff} is sent as-is');
const exp = sc.expandSnippet('Review this: {diff} and again {diff}', 'd', {});
check((exp.match(/```diff/g) || []).length === 2, 'every {diff} is replaced');
check(sc.expandSnippet('Review this: {diff}', null, {}) === null, 'a {diff} template with no diff returns null');
check(sc.expandSnippet('What does {output} mean?', 'd', {}).includes('{output}'), '{output} is not substituted in v1');

console.log(`slashcmds.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
