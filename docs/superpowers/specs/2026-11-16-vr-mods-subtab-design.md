# VR Mods Subtab — Design Spec

Date: 2026-11-16
Status: Approved (implementation started)

## Goal

Add a "VR Mods" subtab inside the Ports tab (`/ports`). It lists VR mods harvested from
vrportnews.com and pcvrcentral.com, deduplicated by game and by GitHub repository. Clicking a
game card opens a modal (mirroring the Ports / decomp-recomp modal) with: a short description,
full details, a dropdown of deduplicated GitHub links, and a second subtab showing the GitHub
project README.

## Decisions (from steering session)

- **Data freshness:** bundled snapshot generated at build time; GitHub metadata/README fetched
  lazily on demand (cached on disk + in memory, ETag, rate-limited).
- **Sources:** vrportnews.com + pcvrcentral.com only. unflatvr.com excluded because it carries an
  explicit no-scraping / no-republication notice.
- **Scope:** everything from the chosen sources, deduplicated. Includes UEVR conversions.
- **GitHub auth:** anonymous only (60 req/hr), with aggressive caching and graceful degradation.

## Architecture

1. Build-time generator `scripts/build-vr-mods-catalog.mjs` fetches vrportnews embedded RSC JSON
   (~1,537 records) and crawls pcvrcentral `/mods/{slug}` sitemap detail pages (~1,629), normalizes
   to `VrModEntry[]`, dedupes links and groups by game, and atomically writes
   `src/data/vr-mods.catalog.json`. Committed to git; never run by end users.
2. The renderer imports the bundled JSON directly in a lazy-loaded chunk (only fetched when the
   subtab opens) -> instant, offline-capable list. The snapshot stores `entries` only; the renderer
   regroups via `groupVrMods` so filtering can drop entries without re-reading the file.
3. GitHub enrichment in main process (`electron/main/features/vrMods/enrich.ts`) reuses the Ports
   feature's cached repo/README resolver. Exposed as IPC commands `get_vr_mod_repo` /
   `get_vr_mod_readme`. No token UI: anonymous access (60/hr) with on-disk caching, ETag support
   and lazy fetching.
4. UI: `PortsPage.tsx` gains a `SubTabs` strip (`Ports` | `VR Mods`). New `src/pages/ports/vrMods/`
   folder mirrors the Ports page: `VrModsTab.tsx`, `VrModCard.tsx`, `VrModDetailModal.tsx` + CSS.

## Data model

- `VrModLink { label, url, kind: github|gitlab|website|patreon|sheet, repoKey? }`
- `VrModEntry { id, gameKey, gameTitle, modName, description, details?, links[], image?, date?,
  kind: dedicated|uevr|conversion, platforms[], sources[], author?, compatibility? }`
- `VrModGameGroup { gameKey, title, entries: VrModEntry[], githubLinks: VrModLink[] }`

Dedup:
- Game: normalized name (lowercase, strip punctuation, "VR"/"(UEVR conversion)" suffixes) -> `gameKey`.
- GitHub: `github:owner/repo` (strip `.git`, `/releases...`); other links by URL.
- `githubLinks` is a deduped union of all links across a group's entries, shown in the modal dropdown.

## UI

- SubTabs strip on Ports page: `Ports` (existing) and `VR Mods`.
- Tab: PageHeader + StatBand + toolbar (search + kind/platform/source/sort) + virtualized card grid.
- Card: cover art, title, mod count, kind badge, platform badges (mirrors `PortCard`).
- Modal: portal, escape/scroll-lock/focus, header (cover/title/badges), GitHub-link dropdown,
  SubTabs `Overview` (short description + full details + repo metadata + "listed on" sources) and
  `README` (lazy fetch, Markdown renderer).
- i18n `ports.vrMods.*` in all six locale files; English authoritative, others fall back.

## Error handling

- Bundled catalog always available.
- GitHub failure/rate-limit -> cached data or inline message, never a broken UI.
- Generator writes atomically, keeps previous catalog on failure.

## Testing

- Unit tests for normalization/dedup/grouping helpers.
- Component tests: subtab switch, card -> modal, dropdown selection, tab switch.
- Network tested against saved fixtures, not live.

## Files

New: `scripts/build-vr-mods-catalog.mjs`, `src/data/vr-mods.catalog.json`, `src/types/vrMod.ts`,
`src/pages/ports/vrMods/*`, `electron/main/commands/vrMods.ts`, `electron/main/features/vrMods/*`,
tests.
Edited: `src/pages/ports/PortsPage.tsx` (+ CSS), `src/pages/ports/PortsVirtualGrid.tsx`
(generic keyed groups), `electron/main/commands/index.ts`, `electron/main/commands/commandCatalog.ts`,
`package.json` (`build:vr-catalog` script), `src/i18n/*.ts` (6 files).

## Performance work

- Heavy structured details (the ~1 MB of pcvrcentral "Full details" fields) live in a separate
  `vr-mods.details.json` chunk. Entries hold `d:` keys; the modal fetches the chunk once on first
  Overview open and caches the extracted lines per key. The initial VR chunk dropped from ~3.7 MB
  to ~2.75 MB.
- `VrModsTab` precomputes the grouped catalog, search haystacks, facet sets, stats and three
  pre-sorted orders once at module load using a single `Intl.Collator`. Filtering a result set is
  now a linear scan of a pre-sorted array (~1 ms) instead of regrouping 3,166 entries and sorting
  2,461 groups with `localeCompare` (~70 ms per keystroke).
- Cards are `memo`-ized with stable callbacks; the virtual grid, shared IntersectionObserver image
  loader and rAF-throttled scrolling are unchanged and continue to keep the DOM small.
- The lazy subtab boundary now shows a card-skeleton fallback, and the modal's detail section shows
  a shimmer while its chunk loads.

## Verification (2026-11-16)

- `npm run build:vr-catalog` -> 3,166 entries, 2,461 deduplicated games, 3.45 MB snapshot.
- `npm run typecheck`, `npm run audit:i18n`, `npm run build`, `npx vitest run` (330 files,
  2,410 tests) all pass.
- Visual check in the browser: subtab strip, card grid (Games/Mods/GitHub repos/Sources stats) and
  the two-tab modal with the deduped GitHub-link dropdown all render as intended.
