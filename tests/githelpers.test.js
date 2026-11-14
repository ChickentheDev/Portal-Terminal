// Unit tests for githelpers.js — run: node tests/githelpers.test.js
'use strict';
const gh = require('../githelpers.js');

let pass = 0, fail = 0;
function check(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL ' + label); }
}

// --- parsePrCommand ---
check(JSON.stringify(gh.parsePrCommand('/pr 12')) === JSON.stringify({ number: 12 }), '/pr 12 parses');
check(JSON.stringify(gh.parsePrCommand('/pr 1')) === JSON.stringify({ number: 1 }), '/pr 1 parses');
check(JSON.stringify(gh.parsePrCommand('  /pr 999999')) === JSON.stringify({ number: 999999 }), 'leading spaces allowed, max number parses');
check(JSON.stringify(gh.parsePrCommand('/pr 012')) === JSON.stringify({ number: 12 }), 'leading zeros normalize');
check(JSON.stringify(gh.parsePrCommand('/pr 12 ')) === JSON.stringify({ number: 12 }), 'trailing space allowed');
check(gh.parsePrCommand('/pr') === null, 'bare /pr has no number');
check(gh.parsePrCommand('/pr ') === null, '/pr with only a space has no number');
check(gh.parsePrCommand('/pr abc') === null, 'non-numeric PR is not a command');
check(gh.parsePrCommand('/pr 12abc') === null, 'trailing letters are not a command');
check(gh.parsePrCommand('/pr 0') === null, 'PR 0 is out of range');
check(gh.parsePrCommand('/pr 1000000') === null, 'PR over the cap is out of range');
check(gh.parsePrCommand('/pr -3') === null, 'negative PR is not a command');
check(gh.parsePrCommand('run /pr 12') === null, 'slash mid-text is not a command');
check(gh.parsePrCommand('/preview 12') === null, '/preview is not /pr');
check(gh.parsePrCommand('') === null, 'empty text is not a command');
check(gh.parsePrCommand(null) === null, 'null text is not a command');

// --- truncateBody ---
check(gh.truncateBody('short') === 'short', 'short body passes through');
check(gh.truncateBody('') === '', 'empty body passes through');
const longBody = 'x'.repeat(5000);
const cut = gh.truncateBody(longBody);
check(cut.length === gh.MAX_PR_BODY_CHARS + '\n...[description truncated]...'.length && cut.endsWith('...[description truncated]...'), 'long body head-truncates with a note');
check(gh.truncateBody('y'.repeat(gh.MAX_PR_BODY_CHARS)).length === gh.MAX_PR_BODY_CHARS, 'body exactly at the cap is not cut');

// --- buildChangelogMessage ---
const diff = 'diff --git a/app.js b/app.js\n+console.log(1);\n';
const cm = gh.buildChangelogMessage(diff, {});
check(cm.startsWith('/changelog\n\n'), 'changelog message starts with the command line');
check(cm.includes('CHANGELOG entry') && cm.includes('Added / Changed / Fixed'), 'changelog message asks for a Keep a Changelog entry');
check(cm.includes('Reply with only the entry text'), 'changelog message says reply with only the entry');
check(cm.includes('```diff\n' + diff), 'changelog message carries the fenced diff');
check(cm.includes('never writes') === false, 'changelog message does not claim to write anything');
const cmUntracked = gh.buildChangelogMessage(diff, { untracked: ['new.txt'], untrackedTruncated: false });
check(cmUntracked.includes('Untracked files (not shown): new.txt'), 'changelog message names untracked files');
const bigDiff = 'z'.repeat(40000);
check(gh.buildChangelogMessage(bigDiff, {}).includes('...[diff truncated to 30 KB]...'), 'changelog message caps a huge diff at 30 KB');

// --- buildPrSummaryMessage ---
const pr = {
  number: 12, title: 'Add split panes', body: 'Splits the terminal tab in two.',
  state: 'open', author: 'ChickentheDev', base: 'main', head: 'split-panes',
  additions: 442, deletions: 8, diff,
};
const pm = gh.buildPrSummaryMessage(pr);
check(pm.startsWith('/pr 12\n\n'), 'PR message starts with the command line and number');
check(pm.includes('(open, main \u2190 split-panes, +442 / \u22128)'), 'PR message header carries title, author, state, branches, and +/- counts');
check(pm.includes('Title: Add split panes\nDescription:\nSplits the terminal tab in two.'), 'PR message carries title and body');
check(pm.includes('what to watch for in review'), 'PR message asks for review watch-outs');
check(pm.includes('```diff\n' + diff), 'PR message carries the fenced diff');
const prMinimal = { number: 3, title: '', body: '', state: '', author: '', base: '', head: '', additions: null, deletions: null, diff: '' };
const pmMin = gh.buildPrSummaryMessage(prMinimal);
check(pmMin.includes('#3 "(no title)" by @unknown (unknown, ? \u2190 ?)'), 'PR message degrades missing fields to placeholders');
check(!pmMin.includes('+'), 'PR message omits +/- counts when absent');
const prHostile = { number: 7, title: 'Fix\n<script>alert(1)</script>', body: 'ok', state: 'open', author: 'eve\nadmin', base: 'main', head: 'x', diff: '' };
const pmHos = gh.buildPrSummaryMessage(prHostile);
check(!pmHos.includes('Fix\n<script>'), 'hostile title newlines are flattened to one line');
check(pmHos.includes('@eve admin'), 'hostile author newlines are flattened');
const prLongBody = { number: 5, title: 'Big', body: 'b'.repeat(6000), state: 'open', author: 'a', base: 'main', head: 'h', diff: '' };
check(gh.buildPrSummaryMessage(prLongBody).includes('...[description truncated]...'), 'long PR body truncates with a note');

// --- parseGitHubRemote ---
check(JSON.stringify(gh.parseGitHubRemote('git@github.com:ChickentheDev/Pressure-Point.git')) === JSON.stringify({ owner: 'ChickentheDev', repo: 'Pressure-Point' }), 'ssh remote parses');
check(JSON.stringify(gh.parseGitHubRemote('https://github.com/ChickentheDev/Portal-Terminal.git')) === JSON.stringify({ owner: 'ChickentheDev', repo: 'Portal-Terminal' }), 'https remote with .git parses');
check(JSON.stringify(gh.parseGitHubRemote('https://github.com/ChickentheDev/Portal-Terminal')) === JSON.stringify({ owner: 'ChickentheDev', repo: 'Portal-Terminal' }), 'https remote without .git parses');
check(JSON.stringify(gh.parseGitHubRemote('https://github.com/o/r/')) === JSON.stringify({ owner: 'o', repo: 'r' }), 'https remote with trailing slash parses');
check(JSON.stringify(gh.parseGitHubRemote('git@github.com:o/my.repo.git')) === JSON.stringify({ owner: 'o', repo: 'my.repo' }), 'repo name with a dot parses');
check(gh.parseGitHubRemote('git@gitlab.com:o/r.git') === null, 'non-GitHub host is refused');
check(gh.parseGitHubRemote('/home/sam/repo') === null, 'local path is refused');
check(gh.parseGitHubRemote('https://github.com/onlyowner') === null, 'owner without repo is refused');
check(gh.parseGitHubRemote('') === null, 'empty remote is refused');
check(gh.parseGitHubRemote(null) === null, 'null remote is refused');

// --- parseGhPrJson ---
const ghJson = { title: 'Add split panes', body: 'Body.', state: 'OPEN', author: { login: 'ChickentheDev', id: 1 }, baseRefName: 'main', headRefName: 'split-panes', additions: 442, deletions: 8 };
const parsed = gh.parseGhPrJson(ghJson);
check(parsed && parsed.title === 'Add split panes' && parsed.author === 'ChickentheDev' && parsed.base === 'main' && parsed.head === 'split-panes' && parsed.additions === 442 && parsed.deletions === 8, 'gh JSON normalizes to the PR shape');
check(gh.parseGhPrJson({ title: 'T', author: 'plain-string' }).author === 'plain-string', 'plain-string author is accepted');
check(gh.parseGhPrJson({}).title === '' && gh.parseGhPrJson({}).author === '' && gh.parseGhPrJson({}).additions === null, 'missing fields degrade to empty/null');
check(gh.parseGhPrJson(null) === null, 'null JSON is refused');
check(gh.parseGhPrJson('nope') === null, 'string JSON is refused');
check(gh.parseGhPrJson([1, 2]) === null, 'array JSON is refused');

console.log(`githelpers.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
