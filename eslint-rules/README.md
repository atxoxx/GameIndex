# Color enforcement (`no-hardcoded-colors`)

GameIndex defines every palette colour exactly once in
`src/styles/theme.css` (base `:root`) and `src/styles/themes.css` (per-theme
overrides). Components must reference those tokens with `var(--…)`.

Literal colours in component CSS/TSX are what silently break non-default
themes — the exact issue tracked under *"Fix Activity Page UI Inconsistencies
→ hardcoded colors instead of CSS custom properties (theme breakage in light
mode)"* in `todo.md`.

## What the rule flags

`no-hardcoded-colors` reports colour **literals**:

- `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`
- `rgb()`, `rgba()`, `hsl()`, `hsla()` with literal components

…everywhere **except** where a token is being *defined* or where the value is
deliberately theme-invariant:

- the value of a custom-property declaration — `--color-accent: #635bff;`
- any declaration inside an `@property` block — `@property --x { initial-value: #fff; }`
- JS/TS object properties keyed by a custom property — `{ "--color-accent": "#635bff" }`
- neutral black/white scrims — `rgba(0, 0, 0, .5)`, `rgba(255, 255, 255, .1)`,
  and the `black`/`white` keywords (a drop-shadow is correct in every theme)
- `var(--token, #hex)` fallbacks — the token is the primary value; the literal
  is only a safety net
- runtime colours built from variables — `` `rgb(${r}, ${g}, ${b})` ``

CSS is linted through `@eslint/css` (rule `gameindex-css/no-hardcoded-colors`);
TS/TSX through the local `gameindex` plugin (rule `gameindex/no-hardcoded-colors`).

## Allowlisted "colour data" files

Some modules hold colours as *data* — token generators, per-theme palette
tables, brand/flag artwork, standalone export documents and the pre-CSS
bootstrap fallback. They are exempt in `eslint.config.js` (`COLOR_DATA_FILES`)
because a `var()` indirection there would be wrong, not because the colours
are accidental. Keep that list short and justified.

## How to fix a violation

1. **Prefer an existing token.** Reach for the semantic token, not a
   near-miss literal.
2. **Translucent overlays** → `color-mix(in srgb, var(--token) X%, transparent)`
   or an existing scrim/elevation token.
3. **Genuinely new semantic colour** → add it to the `:root` block in
   `src/styles/theme.css` (and a light-mode override in `themes.css` when the
   value must differ in light mode), then reference it.
4. **Do not** add a throwaway `--some-local: #hex` inside a component file to
   silence the rule. That defeats the point.

### Common mappings

| Literal            | Token                                   |
| ------------------ | --------------------------------------- |
| `#fff`/`#ffffff`   | `var(--color-text-primary)` (or `--color-accent-contrast` on accent) |
| `#000`/`#000000`   | `var(--color-text-inverse)` for text; `var(--color-scrim)` / `var(--scrim-dark-mid)` for overlays |
| `#f59e0b`          | `var(--color-warning)`                  |
| `#10b981`          | `var(--color-success)`                  |
| `#f43f5e`/`#ef4444`| `var(--color-danger)`                   |
| `#38bdf8`/`#0284c7`| `var(--color-info)`                     |
| `#a855f7`          | `var(--color-ingame)`                   |
| dark card shadows  | `var(--elevation-2/3/4)`                |
| modal/lightbox backdrop | `var(--color-scrim)` / `var(--color-scrim-strong)` |
| text over artwork  | `var(--scrim-text)` / `var(--scrim-text-muted)` |

Web/Steam/etc. brand colours already have tokens (`--brand-1…4`,
`--brand-twitch`, `--brand-nvidia`, `--brand-amd`, `--brand-debrid`); add a
`--brand-*` token for any other store mark instead of inlining its hex.
