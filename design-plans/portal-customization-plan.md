# Portal Terminal — customization + Warp look: audit & implementation plan

Audit-only pass (improve-ui scope): read the code, wrote this plan, changed nothing.
Implementation follows better-ui (exact polish values) and interface-design
(one focal point, token architecture). Status: plan written 2026-11-09;
implementation happens in the same round, phases 2 then 3.

## Audit findings (verified in code, 2026-11-09)

1. **Theme is binary.** Settings has a dark/light `<select>` (`#s-theme`,
   index.html:118). `applyTheme()` (renderer.js:63) maps anything non-'light'
   to 'dark'. styles.css has exactly two token blocks
   (`body[data-theme="dark"]` / `"light"`) with tokens --bg/--bg2/--bg3/
   --line/--line2/--fg/--fg2/--fg3/--inv-bg/--inv-fg. The single accent is
   `--neon-teal: #48e0c2` in `:root`, hard-coded, no override path. Terminal
   has its own parallel `THEMES` dark/light map in terminal.js:11, keyed off
   `document.body.dataset.theme`. Any new theme must touch all three places
   (CSS tokens, xterm theme, settings validation) or the app will look split.
2. **Fonts: one knob.** Only `termFont` (number 9–28, settings) exists.
   Chat type is fixed: `body { font: 15px/1.5 var(--sans) }`. The mono stack
   is hard-coded twice: `:root --mono` (styles.css) and `MONO` (terminal.js:10).
   No font-family choice anywhere.
3. **No palette.** Ctrl+K currently focuses the sidebar search
   (renderer.js:647). Actions are scattered across buttons and shortcuts:
   new chat (Ctrl+N), toggle sidebar, settings (Ctrl+,), new terminal tab
   (Ctrl+Shift+T in terminal), copy/export chat (top bar), pull model
   (settings only), ask-AI-about-selection (`askAi`, terminal.js:235, wired
   to `#term-ask` only — not exported on `window.TermUI`).
4. **Terminal output is a raw stream.** No per-command grouping in
   terminal.js; blocks (Phase 3) need a command boundary — the pty bridge
   already echoes input, so a block starts when the user submits a line.
   (Phase 3 detail; not solved here.)
5. **Polish baseline is already good.** 0.2 round: press scale 0.96,
   150ms ease-out named transitions, hover wrapped in `@media (hover: hover)`,
   teal reserved for live state. New UI must match those values, not invent
   new ones.

## Implementation plan — Phase 2 (customization)

### Settings model (main.js)
- `DEFAULT_SETTINGS`: keep `theme: 'dark'` (black/white stays the default).
  Add `accent: ''` (empty = theme accent), `termFontFamily: 'system'`,
  `chatFontFamily: 'system'`, `chatFont: 15`.
- `settings:set` validation (same style as existing clamps): theme allowlist
  `['dark','light','warp-dark','dracula','nord','solarized-dark','one-dark']`
  (unknown → 'dark'); accent must match `/^#[0-9a-fA-F]{6}$/` or '' (else '');
  font-family keys allowlist `['system','jetbrains','fira','plex']`
  (unknown → 'system'); `chatFont` clamp 12–20 (default 15).

### Themes (styles.css + terminal.js + renderer.js)
- styles.css: one token block per new theme, same token names as dark/light
  plus a `--neon-teal` override per theme (the accent). Existing rules that
  use `var(--neon-teal)` for live state pick the theme accent up for free.
  - Warp Dark: bg #191c20, surface #20242a/#2a2f36, text #eaeae8, accent #ffc24b
  - Dracula: bg #282a36, surface #343746/#44475a, text #f8f8f2, accent #bd93f9
  - Nord: bg #2e3440, surface #3b4252/#434c5e, text #eceff4, accent #88c0d0
  - Solarized Dark: bg #002b36, surface #073642/#0a4a5a, text #839496, accent #2aa198
  - One Dark: bg #282c34, surface #2c313a/#3a404d, text #abb2bf, accent #61afef
- terminal.js: add matching xterm themes (background/foreground/cursor/
  selectionBackground + ANSI set) to `THEMES`; `themeNow()` maps
  `dataset.theme` → `THEMES[name] || THEMES.dark`.
- renderer.js `applyTheme()`: set `dataset.theme`; if `settings.accent` is
  set, inline `body.style.setProperty('--neon-teal', accent)`, else remove
  the inline override; set `--chat-size` / `--chat-font` / `--mono` inline
  vars from the font settings; call `TermUI.updateTheme()`,
  `TermUI.setFont()`, `TermUI.setFontFamily()`.
- Custom accent picker: `<input type="color">` + a "Theme accent" reset
  button (color inputs can't be empty; reset writes '').

### Fonts
- Family keys → stacks (renderer.js map, shared with terminal via
  `TermUI.setFontFamily(stack)`):
  system → `ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace`;
  jetbrains → `"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
  fira → `"Fira Code", ...`; plex → `"IBM Plex Mono", ...`.
  Chat family uses the same map, except `system` → the `--sans` stack.
- terminal.js: `setFontFamily(fam)` sets `T.fontFamily`, updates every open
  tab's `term.options.fontFamily`; `init(opts)` accepts `fontFamily`.
- Chat size: `body { font: var(--chat-size, 15px)/1.5 var(--chat-font, var(--sans)) }`.

### Command palette (renderer.js + index.html + styles.css)
- Markup: `#palette` overlay (hidden) + `.palette-panel` + `#palette-input`
  + `#palette-list` + hint row. Styles per better-ui: press 0.96 on items,
  150ms ease-out named transitions, hover only inside `@media (hover: hover)`.
- Ctrl+K opens it (replaces the old search-focus binding); Esc closes;
  ArrowUp/Down move, Enter runs, click runs, input re-filters.
- Fuzzy match: subsequence match on label (+ optional keywords), score by
  match tightness; list shows label + shortcut hint on the right.
- Actions (each calls existing code paths, no new IPC): New chat, Switch to
  Chat/Split/Terminal view, New terminal tab, Toggle sidebar, Open settings,
  Copy chat, Export chat, Ask AI about terminal selection (export `askAi`
  from TermUI — one-line addition), Pull current agent model, Toggle
  auto-run, Switch agent model to <each of the 8 presets>, Focus chat input,
  Focus search. Palette closes after running an action.
- Search input placeholder becomes "Search chats" (Ctrl+K is now the palette).

### Verification (Phase 2)
- `node --check` main.js / renderer.js / terminal.js.
- Fake-Ollama harness re-run + new checks: invalid theme rejected,
  bad accent sanitized, font keys validated, settings round-trip.
- Headless Chromium screenshots: settings modal with new controls, each
  theme applied, palette open with a query typed. Zero page errors.

## Implementation plan — Phase 3 (Warp look)
- Block-style terminal output in terminal.js: group each submitted command
  + its output into a block with a header row (command text, copy + rerun,
  status/duration), subtle borders/spacing from theme tokens. Command
  boundary = user submits a line (pty echo); block closes on next prompt.
- Polish per better-ui values on any new chrome; keep chat-first layout —
  chat stays the one focal point (interface-design), terminal is the
  secondary pane.
- Before/after screenshots in previews-ui/ with headless Chromium
  (stub window.api as the 0.2 round did), zero page errors.
