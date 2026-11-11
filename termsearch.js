// Terminal search helpers: match-count formatting and the per-theme
// decoration colors passed to @xterm/addon-search. Pure Node — no
// Electron deps — so it is unit-testable with plain
// `node tests/termsearch.test.js`. The renderer reaches these as
// `window.PortalTermSearch` (plain <script> in index.html); the preload
// CANNOT require() local modules in this Electron build.
'use strict';

// resultIndex is 0-based from the addon (-1 when the highlight limit
// is exceeded); resultCount is the total matches found.
function formatSearchCount(resultIndex, resultCount, hasQuery) {
  if (!hasQuery) return '';
  if (!resultCount) return 'No results';
  if (resultIndex == null || resultIndex < 0) return resultCount + '+ matches';
  return (resultIndex + 1) + ' of ' + resultCount;
}

// Decoration colors per theme — all #RRGGBB, as the addon requires.
// Muted grey for every match, the theme's accent for the active one.
// Overview-ruler colors equal the match/active backgrounds.
const DECORATIONS = {
  dark: { match: '#4d4d4d', matchBorder: '#6e6e6e', active: '#48e0c2', activeBorder: '#48e0c2' },
  light: { match: '#cfcfcf', matchBorder: '#8c8c8c', active: '#48e0c2', activeBorder: '#0f766e' },
  'warp-dark': { match: '#3a4150', matchBorder: '#6f747b', active: '#ffc24b', activeBorder: '#ffc24b' },
  dracula: { match: '#44475a', matchBorder: '#6272a4', active: '#bd93f9', activeBorder: '#bd93f9' },
  nord: { match: '#434c5e', matchBorder: '#7b8694', active: '#88c0d0', activeBorder: '#88c0d0' },
  'solarized-dark': { match: '#073642', matchBorder: '#586e75', active: '#2aa198', activeBorder: '#2aa198' },
  'one-dark': { match: '#3a404d', matchBorder: '#5c6370', active: '#61afef', activeBorder: '#61afef' },
};

function searchDecorations(theme) {
  const d = DECORATIONS[theme] || DECORATIONS.dark;
  return {
    matchBackground: d.match,
    matchBorder: d.matchBorder,
    matchOverviewRuler: d.match,
    activeMatchBackground: d.active,
    activeMatchBorder: d.activeBorder,
    activeMatchColorOverviewRuler: d.active,
  };
}

// The exact options passed to findNext / findPrevious. Plain text,
// case-insensitive, no regex, no whole word — a query containing regex
// characters is literal text and can never throw.
function searchOptions(theme, incremental) {
  return {
    regex: false,
    wholeWord: false,
    caseSensitive: false,
    incremental: !!incremental,
    decorations: searchDecorations(theme),
  };
}

const TermSearch = { formatSearchCount, searchDecorations, searchOptions, DECORATIONS };
if (typeof module !== 'undefined' && module.exports) module.exports = TermSearch;
if (typeof window !== 'undefined') window.PortalTermSearch = TermSearch;
