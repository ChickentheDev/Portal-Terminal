// Unit tests for termsearch.js — run: node tests/termsearch.test.js
'use strict';
const ts = require('../termsearch.js');

let pass = 0, fail = 0;
function check(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.log('FAIL ' + label); }
}

// --- formatSearchCount ---
check(ts.formatSearchCount(0, 0, false) === '', 'no query: blank');
check(ts.formatSearchCount(-1, 0, false) === '', 'no query wins over a stale count');
check(ts.formatSearchCount(0, 0, true) === 'No results', 'zero matches: No results');
check(ts.formatSearchCount(0, 1, true) === '1 of 1', 'single match: 1 of 1');
check(ts.formatSearchCount(2, 12, true) === '3 of 12', '0-based index displays 1-based');
check(ts.formatSearchCount(11, 12, true) === '12 of 12', 'last match: 12 of 12');
check(ts.formatSearchCount(-1, 1000, true) === '1000+ matches', 'over the highlight limit: M+ matches');
check(ts.formatSearchCount(null, 5, true) === '5+ matches', 'null index: M+ matches');
check(ts.formatSearchCount(undefined, 5, true) === '5+ matches', 'undefined index: M+ matches');

// --- searchDecorations ---
const HEX = /^#[0-9a-fA-F]{6}$/;
const themes = ['dark', 'light', 'warp-dark', 'dracula', 'nord', 'solarized-dark', 'one-dark'];
for (const theme of themes) {
  const d = ts.searchDecorations(theme);
  check(HEX.test(d.matchBackground) && HEX.test(d.matchBorder) && HEX.test(d.matchOverviewRuler)
    && HEX.test(d.activeMatchBackground) && HEX.test(d.activeMatchBorder) && HEX.test(d.activeMatchColorOverviewRuler),
    theme + ': every decoration color is #RRGGBB');
  check(d.matchOverviewRuler === d.matchBackground && d.activeMatchColorOverviewRuler === d.activeMatchBackground,
    theme + ': overview ruler colors equal the match colors');
}
check(JSON.stringify(ts.searchDecorations('no-such-theme')) === JSON.stringify(ts.searchDecorations('dark')),
  'unknown theme falls back to the dark set');
check(ts.searchDecorations('dark').activeMatchBackground === '#48e0c2', 'dark active match is the teal accent');
check(ts.searchDecorations('light').matchBackground === '#cfcfcf', 'light match is a light grey');
check(ts.searchDecorations('warp-dark').activeMatchBackground === '#ffc24b', 'warp-dark active match is amber');
check(ts.DECORATIONS && Object.keys(ts.DECORATIONS).length === 7, 'seven theme sets defined');

// --- searchOptions ---
const opts = ts.searchOptions('dark', true);
check(opts.regex === false && opts.wholeWord === false && opts.caseSensitive === false,
  'options: plain text, case-insensitive, no regex, no whole word');
check(opts.incremental === true, 'options: incremental passes through when true');
check(ts.searchOptions('dark', false).incremental === false, 'options: incremental passes through when false');
check(ts.searchOptions('dark').incremental === false, 'options: incremental defaults to false');
check(JSON.stringify(ts.searchOptions('dracula', false).decorations) === JSON.stringify(ts.searchDecorations('dracula')),
  'options: decorations match the theme helper');

console.log(`termsearch: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
