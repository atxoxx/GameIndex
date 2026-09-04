# GameIndex — Performance & Responsiveness Optimisation Plan

**Status:** In progress — P0 landed 2026-09-04 (see §8 Implementation status)
**Date:** 2026-09-04
**Scope:** Tauri v2 (Rust) + React 19 + Vite 7. Startup time, UI responsiveness (scrolling / input / navigation), IPC & data efficiency, memory, and build size.
**Related:** `todo.md` §25 (Performance Optimizations — partial), `plans/Linux.md` §4 (CPU Optimisations — partially overlaps; verify before duplicating).

---

## 0. How this plan is organised

Each item is a self-contained change with:

- **Why** — the concrete behaviour/bottleneck it addresses (with file references from today's code).
- **What** — exact files to touch.
- **Acceptance** — the measurable condition that means "done".

Items are tagged **[Quick win]** (small, low-risk, high value), **[Medium]** (bounded refactor), **[Large]** (architecture change — plan and land separately).

**Rule for every item:** land it with a before/after measurement from Phase 0's harness, `npx tsc --noEmit` + `cargo check` green, and — where behaviour changed — a happy-path + error-path test per repo convention.

---

## 1. Phase 0 — Measure first (prerequisite for everything else)

Nothing gets optimised blind. Build the harness before touching code.

### 1.1 Boot-timing markers
- **Why:** today, startup is a black box; `App.tsx` reveals the main window after a hard-coded `setTimeout(…, 750)` + `invoke("close_splashscreen")` (verified in `src/App.tsx`). We cannot know what to shorten until we can see each phase.
- **What:**
  - Add `performance.mark()` / `performance.measure()` spans in `src/main.tsx` → provider tree → first paint → `gamesHydrated` (defined in `src/context/GameContext.tsx`), and log a compact `[boot]` summary line to the console (`console.debug`, stripped in prod builds — see §5.6).
  - Rust side: `println!`-style timings (guarded behind an env var, e.g. `GAMEINDEX_PERF=1`) around `.setup` migration runs, pool creation, and first `load_games`.
- **Acceptance:** a fresh `npm run tauri dev` prints per-phase timings; we have a recorded cold-start baseline.

### 1.2 Render / frame profiling runbook
- Enable WebView2 DevTools in dev (right-click inspect when running `tauri dev`, or temporarily add the `devtools` capability only for debug builds — never ship it enabled).
- Record a 10 s Performance trace while: (a) cold boot, (b) scrolling a 500-game library, (c) typing in the library search box, (d) opening a game page, (e) an active download updating.
- Capture: main-thread long tasks (>50 ms), forced reflows (`Layout Shift` + `Recalculate Style`), JS heap snapshot deltas.
- Rust hotspots: `cargo flamegraph` or `cargo run --release` + Windows Performance Analyzer on the release binary during a big sync/scan.
- **Acceptance:** a one-page runbook lives in this repo (`docs/` or `knowledge.md`) so every future perf item starts from the same measurements.

### 1.3 Baseline numbers recorded (today's code, `dist/` from the 2026-09-03 build)
| Metric | Current | Target (stretch) |
|---|---|---|
| Entry chunk `dist/assets/index-*.js` | **835 KB** raw | ≤ 450 KB raw |
| Per-locale chunks (ru/fr/es/de/zh) | 312–444 KB each | ≤ 250 KB each |
| Cold start → interactive (main window revealed) | unmeasured (fixed 750 ms timer) | ≤ 2.5 s on mid hardware |
| Library scroll (500+ games, VirtualGrid) | unmeasured | ≤ 5 % dropped frames @ 60 fps |
| Library filter keystroke → grid update | unmeasured | ≤ 50 ms (excluding `useDeferredValue`) |
| `load_games` IPC payload (full 60-column rows) | unmeasured; every game carries description/screenshots/JSON columns | light list + on-demand detail |
| JS heap after opening 20 game pages | unmeasured | no growth > 10 MB/10 pages |

---

## 2. Phase 1 — Startup: faster time-to-interactive

The boot path is: native splash window (`tauri.conf.json`, `main` window `visible: false`) → Vite entry `dist/assets/index-*.js` (**835 KB — the single largest file in the app**) → 24 stacked providers, each issuing IPC on mount → `load_games` returns the **full** library → fixed 750 ms timer reveals the window.

### 1.1 Shrink the entry bundle **[Quick win / Medium]**
- **Why:** 835 KB of JS must download + parse before the first frame; it is larger than every page chunk and only slightly smaller than the lazy `hls` chunk (590 KB). WebView2 parses this on the main thread at boot.
- **What:** run `npx vite build` then audit `dist/assets` with a tool such as `source-map-explorer`/`rollup-plugin-visualizer`; move anything not needed for the first interactive frame out of the entry:
  - Providers whose data is page-scoped should hydrate lazily (see 1.2) — their code leaves the entry chunk when their imports do.
  - Confirm the English `en` dictionary is tree-shaken/minified with the entry and not duplicated into a locale chunk; keep non-`en` locales dynamic (they already are — see the per-locale chunks in `dist/`).
  - Check for accidental static imports of heavy modules in `src/App.tsx` / `src/main.tsx` / shared components (`src/components/TopNav.tsx`, `Sidebar.tsx`, `MainContent.tsx` are mounted at boot — they must not pull in page-scoped code).
- **Acceptance:** entry chunk ≤ 450 KB raw; cold-start-to-interactive improves measurably (1.1 harness); no regression in `npm run build`.

### 1.2 Defer non-critical provider work off the boot path **[Medium]**
- **Why:** every provider in `App.tsx` mounts at boot, and several immediately fetch whole datasets over IPC:
  - `ActivityProvider` (`src/context/ActivityContext.tsx`) calls `get_sessions` and `detect_gpus` on mount — full session history is only needed on `/activity`.
  - `AchievementProvider` (`src/context/AchievementContext.tsx`) loads the whole `achievements_cache` snapshot on mount — only the game page and `/achievements` need it.
  - `PriceContext`, `CrackWatchContext`, `SteamGridDbProvider` mount at boot but serve specific pages.
- **What:** convert the heaviest providers to (a) mount cheaply and hydrate on first consumer subscription, or (b) lazy-mount them beside the pages that need them (keeping provider nesting order documented in `App.tsx` intact for anything that wraps `AppShell`). `PresenceContext` must stay at boot — `useDiscordPresence()` runs in `AppShell` — but its data fetches can wait for idle (`requestIdleCallback`).
- **Acceptance:** boot-time IPC count drops by ≥ 40 % (count `invoke(` calls before first paint via a temporary counter); session history no longer loads unless the user opens Activity.

### 1.3 Light `load_games` + on-demand game detail **[Medium / Large]**
- **Why:** `load_games` (Rust: `src-tauri/src/games.rs` → `db::games::list_all`) selects **60 columns per row** including `description`, `screenshots_json`, `videos_json`, `steam_achievements_json`, `similar_games_json`, etc., serialises each row through two JSON passes (`to_value` → `GameData`), ships every game to the frontend, and GameContext keeps those full objects in React state forever. For a 500-game library this is a large IPC payload at boot plus a large retained heap, and every `setGames` rebuild re-maps it.
- **What:**
  1. Add a "list view" query returning only the columns the library grid actually renders (id, name, platform, installed, cover/icon/banner URLs, play time, last_played, size, play status, store ids, accent-relevant fields). Keep the full `GameData` shape for a new `load_game_detail(id)` command used by `GamePage`.
  2. Frontend: `GameContext` hydrates the light list; when a page needs the heavy row it merges the detail in. Downstream consumers that only read grid fields keep working unchanged because the `Game` type is unchanged — missing heavy fields are `undefined` until loaded (serde/`#[serde(default)]` parity already applies).
- **Acceptance:** `load_games` IPC payload shrinks ≥ 60 % on a 500-game library; opening the library is visibly faster; opening a game page triggers exactly one extra `load_game_detail`.

### 1.4 Reveal the main window on readiness, not a fixed timer **[Quick win]**
- **Why:** `App.tsx` waits a hard-coded 750 ms after first React render regardless of whether hydration finished (or finished early).
- **What:** reveal when `gamesHydrated` is true **and** the first frame has painted (`requestAnimationFrame` after mount), with a small minimum-hold (~250 ms) only to avoid a flash. Fall back to the current timer if hydration never resolves.
- **Acceptance:** on a warm cache, the window appears noticeably sooner; on slow disks the splash holds until the library is actually usable (no empty-library flash).

### 1.5 Coalesce boot-time settings IPC **[Medium]**
- **Why:** `SettingsContext` (`src/context/SettingsContext.tsx`) holds dozens of independent settings states and issues several per-setting `invoke` calls / `localStorage` reads during mount; the same is true of `ThemeContext`, `LanguageContext`, `UpdateContext`, `DensityContext`. Each is a serialized round-trip on the boot path.
- **What:** add one `get_app_settings` / `set_app_settings` KV round-trip in Rust (`src-tauri/src/db/kv.rs` already exists) for the settings family, hydrate `SettingsContext` from a single payload, and keep per-setting commands only for the writes that need backend side effects (autostart, tray, Discord, theme accent).
- **Acceptance:** boot-time IPC count reduced further (cumulative with 1.2); settings behaviour byte-identical (settings tests/lint pass).

### 1.6 Move artwork cleanup off `load_games` **[Quick win]**
- **Why:** `load_games` (Rust) calls `db::artwork::cleanup_unreferenced_artwork(&app_data_dir, &ids)` on **every** boot — a filesystem walk of the artwork cache that blocks the very command the UI waits on. (`save_game` also calls `cleanup_non_library_caches` per save.)
- **What:** schedule both cleanups on an idle/background task (e.g. after first paint via `tauri::async_runtime::spawn` with a small delay, or only when the game count / artwork dir mtime changed).
- **Acceptance:** `load_games` wall time no longer includes the cleanup walk; cleanup still runs once per session.

### 1.7 DB/startup miscellany
- **Why/What:** migration runner runs per domain at every boot (`src-tauri/src/db/migrate.rs`); verify it short-circuits when schema is current (it applies versions in transactions — confirm no stray work when at head). Confirm WAL checkpoint cadence isn't doing a large checkpoint on first connection of a busy session.
- **Acceptance:** cold boot with an up-to-date DB does zero DDL work; no fsync storm in the first seconds.

---

## 3. Phase 2 — Runtime responsiveness: rendering, scrolling, input

The app already has: per-page `React.lazy` code-splitting, `LibraryVirtualGrid` windowing (threshold 80, overscan 4 — `src/components/library/LibraryVirtualGrid.tsx`), debounced save pipeline, progressive image loading (`useProgressiveImages.tsx`), and Rust-side event dedup (download progress emits only when the snapshot hash changes — `src-tauri/src/downloads/manager.rs`). The remaining pain is **context churn** and **synchronous derivations**.

### 2.1 Stop whole-tree re-renders from high-churn contexts **[Large, biggest win]**
- **Why:** the provider tree in `src/App.tsx` nests 20+ contexts. Several provide a single object whose identity changes whenever *any* slice changes, so one busy slice re-renders every consumer:
  - `GameContext` value rebuilds on every `setGames` (every `updateGame`, import, sync, watcher exit) — and `updateGame` itself maps the entire array.
  - `DownloadContext` value includes the live `downloads` array updated by progress events.
  - `PresenceContext`, `SettingsContext`, `ActivityContext` have many independent setters feeding one memoised value.
- **What:** split each hot context into **state slice + actions**: a `GameSelectorsContext` already exists (`src/context/GameSelectorsContext.tsx`) — generalise that pattern. Consumers take exactly what they need via granular hooks (`useGames()`, `useDownloadActions()` …) that subscribe to narrow slices, so a download-progress tick no longer re-renders the library grid. Where full-slice subscriptions are unavoidable (grid), keep the component memoised and the data referentially stable between unrelated updates.
- **Acceptance:** with a download running in the background, scrolling the library shows zero frame drops attributable to React; DevTools "Highlight updates" shows only the downloading surface re-rendering per tick.

### 2.2 Defer filter/search work off the input handler **[Medium]**
- **Why:** library search + facets (`useLibraryFilters.ts` → `filterGames`/`sortGames`, genre/platform facet building over the full `games` array) and store search run synchronously per keystroke against potentially large arrays.
- **What:** wrap filter output in `useDeferredValue` (React 19) so keystrokes stay responsive and the heavy narrowing happens at idle priority; memoise `filteredGames` on `[deferredGames, filters]`; keep facet lists memoised (already `useMemo` — verify deps don't include transient objects). Same treatment for store search input (`StorePage`) and the command palette.
- **Acceptance:** typing in library search never drops keystrokes on a 1 000-game library (Phase 0 trace: no input-latency task > 50 ms); results update within ~1 frame of the deferred value settling.

### 2.3 Make game cards cheap to (re)render **[Quick win / Medium]**
- **Why:** the grid calls `renderItem` (a `renderCard` closure in `LibraryPage.tsx`) for every visible row; card components must be `React.memo`-able and their props stable, otherwise every `games` reference change re-renders all visible cards even when nothing about them changed.
- **What:** memoise the card component; pass `game.id` + only the fields the card renders (from a selector) rather than the whole object where cheap; verify per-card art hooks (`useGameCardArt` / progressive images) don't re-run observers on unrelated updates.
- **Acceptance:** scrolling + a concurrent unrelated `updateGame` re-renders only affected cards (verify via React Profiler).

### 2.4 Debounce and diff the watcher-index rebuild **[Medium]**
- **Why:** `GameContext.updateGame` / `addGame` / `removeGame` all call `scheduleWatcherIndexRebuild()`, which pushes `toWatcherRefs(games)` (a serialised ref of *every* game) over IPC to `rebuild_watcher_index` (see `src/context/game/useWatcherIndex.ts`). During a bulk import or a metadata-enrichment scroll (one `updateGame` per fetched image) this can fire repeatedly with the full library payload.
- **What:** coalesce rebuilds with a short trailing debounce inside `useWatcherIndex`; compute the ref set **diff** in Rust (add/remove ids only) when the change is a single game.
- **Acceptance:** scrolling the library while images enrich triggers ≤ 1 watcher rebuild per debounce window (was: per image); payload per rebuild is the diff, not the whole library.

### 2.5 Interval-driven re-renders: scope and batch **[Quick win]**
- **Why:** ~24 `setInterval` call sites exist (audited). Most are fine (scoped to visible widgets, 30–60 s tickers), but a few are wasteful or unscoped:
  - `SteamPlayerCountPopover.tsx` ticks every 1 s while mounted; `SessionCard.tsx`/`FriendsSessionsTab.tsx` tick 30–60 s; `useGamepads.ts` polls every 500 ms whenever `GamepadProvider` is enabled.
  - `Splashscreen.tsx` runs an animation interval — verify it stops when hidden.
- **What:** pause every interval when its element is off-screen (reuse an `IntersectionObserver` helper — `useProgressiveImages.tsx` already shows the pattern) or when the document is hidden (`visibilitychange`); drop the 1 s clock in the player-count popover to a minutes-scale update unless it displays seconds.
- **Acceptance:** with the app idle on `/library`, background timer wake-ups drop to near zero (Chrome/WebView2 "Timers throttled" in trace); behaviour unchanged when surfaces are visible.

### 2.6 Image pipeline: decode off the main thread, bound the cache **[Medium]**
- **Why:** artwork arrives via remote URLs → `download_image` IPC → cached to disk (`asset` protocol, `$APPDATA/**/*` scope in `tauri.conf.json`) → loaded as `<img src>`; `useProgressiveImages.tsx` triggers per-element IPC on intersection and stores result URLs. Risks: per-image IPC round-trips while scrolling fast; base64/data-URL blobs held in React state from store adds (`fetchAllImages` in `GameContext.addStoreGame` — heavy for many adds); unbounded disk cache growth (cleanup exists but runs on boot — see 1.6).
- **What:**
  1. Batch: give the art hook a small priority queue / debounce so a fast scroll coalesces requests (or fetch the *disk* URL via one `resolve_artwork(urls[])` call per batch).
  2. Use `img.decoding = "async"` + `img.decode()` before reveal; add `content-visibility: auto` + `contain-intrinsic-size` on grid tiles (check against `library.css` tile styles) so off-screen tiles skip layout/paint.
  3. Stop storing base64 in React state for store adds — write to the artwork cache and keep the URL (mirrors what sync imports do).
  4. Bound cache: keep the 30-day cleanup but run it off boot (1.6) and add a size cap (e.g. prune to ≤ 2 GB).
- **Acceptance:** a fast scroll to the bottom of a 1 000-game library triggers ≤ ~1 batch of IPC art requests beyond the visible window; no base64 blobs > 1 MB in React state; heap snapshot stable during sustained scrolling.

### 2.7 VirtualGrid robustness **[Medium]**
- **Why:** `LibraryVirtualGrid.tsx` relies on row-height math that must match real card heights exactly — `library.css` carries a comment to that effect (line ~19). Height drift silently breaks windowing (blank rows / jumpy scroll).
- **What:** measure actual card heights once per density change and cache them (or use a sentinel render + `getBoundingClientRect`) instead of trusting CSS constants; verify overscan/`rowStride` on density switch, grouped mode, and window resize; ensure scroll position is preserved when `resetKey` changes.
- **Acceptance:** scrolling stays stable across density changes and after a font/theme swap; no blank window or scroll jump in the Phase 0 scroll trace.

### 2.8 Big-screen parity **[Medium]**
- **Why:** `src/components/bigscreen/GameGrid.tsx` is a second windowing implementation with its own overscan logic and controller-scroll coupling.
- **What:** extract the shared windowing core from `LibraryVirtualGrid` into one hook/component both use (keeping the controller scroll integration), so fixes land once.
- **Acceptance:** identical scroll math in desktop and big-screen grids; big-screen library scrolls at 60 fps.

---

## 4. Phase 3 — Backend & IPC efficiency

### 3.1 Parallelise CPU-bound Rust work where it is still serial **[Medium]**
- **Why:** `todo.md` §25 lists it and it's still open; scraping/enrichment batches and large file-tree scans (size calculation `size.rs`, mod detection `mods/detect.rs`, ROM scans) are the main serial CPU/IO loops.
- **What:** parallelise with `rayon` (CPU-bound local work) or `tokio::spawn` + bounded concurrency (network-bound), keeping existing rate-limit discipline (IGDB 4 req/s cap, Steam retry policy in `steam/sync.rs`). Keep the DB layer synchronous per `knowledge.md` (sub-ms local queries — do **not** blanket-wrap in `spawn_blocking`).
- **Acceptance:** a Steam import of 500 games completes ≥ 2× faster on an 8-core machine without violating provider rate limits; `cargo check`/tests green.

### 3.2 Reduce per-row JSON double-pass and heavy command payloads **[Medium]**
- **Why:** verified in `src-tauri/src/games.rs::load_games`: every row goes `GameRow → serde_json::to_value → GameData` and heavy JSON text columns are decoded per row per load. Other list commands (`sessions::list_all`, `achievements::list_all`, `download_history::list_all`, store cache) ship whole tables to the frontend on mount.
- **What:** after 1.3's light-list lands, apply the same treatment to the other boot-loaded tables (sessions: only the last N months; achievements: load per game page; store cache: on demand). Where a full payload is unavoidable, stream/`serde_json` in one pass and measure.
- **Acceptance:** per-command serialisation time and payload bytes drop by ≥ 50 % for the top 5 boot commands (measured in the 1.1 harness).

### 3.3 Keep the watcher adaptive and idle-quiet **[Quick win]**
- **Why:** `game_watcher.rs` already adapts (1 s pending / 5 s steady — `POLL_INTERVAL_PENDING`/`POLL_INTERVAL_STEADY`). The poll loop **cannot** sleep completely when zero sessions are registered: it also performs passive detection of games launched outside GameIndex, which requires periodic process enumeration. It can, however, back off — WMI enumeration every 5 s with nothing running is wasted work.
- **What (landed):** added `POLL_INTERVAL_IDLE` (15 s) in `src-tauri/src/game_watcher.rs`; the loop relaxes to it whenever `active_sessions` is empty. App-launched sessions still wake the loop immediately (`request_immediate_poll`), so launch detection is unchanged. Trade-off: passive detection of an externally launched game starts ≤ 15 s later (session start is anchored at attach, so no playtime is lost).
- **Acceptance:** with no game running, WMI polls drop to 4/min (was 12/min); launching a game resumes 1 s polling immediately.

### 3.4 Long-running operation progress events **[Quick win]**
- **Why:** `download-progress` is already hash-deduped and fine. But `internet-sync-received` (`friends.rs`) emits a full DB snapshot, and `size.rs`/`mods` progress events can be chatty during scans.
- **What:** confirm frontend listeners (`src/context/DownloadContext.tsx`, `useFriendsData.ts`) throttle/ignore events when their page isn't mounted; add a small emission interval (e.g. ≥ 250 ms) for size/mod scan progress.
- **Acceptance:** background scan/downlo/uploads cause no measurable main-thread work on the library route (Phase 0 trace).

---

## 5. Phase 4 — Packaging, memory & sustained budgets

### 5.1 Bundle-size budget + CI gate **[Quick win]**
- **Why:** `dist/assets/index-*.js` at 835 KB is a standing invitation to regress; no CI currently fails on size.
- **What:** add a script (`scripts/check-bundle.mjs`) that asserts entry ≤ 450 KB and total JS ≤ ~3.5 MB, wired into CI (`.github/workflows/ci.yml`) after `npm run build`. Track chunk sizes in the repo (commit a `dist-sizes.json` snapshot alongside the script).
- **Acceptance:** CI fails when the entry chunk regresses past budget; PRs that grow bundles must justify it.

### 5.2 Memory hygiene **[Medium]**
- **Why:** the full library + session history + achievements snapshot live in React state simultaneously; store adds previously pulled base64 images into state (see 2.6.3); `html2canvas`/`hls` are lazy but hold large buffers while a game page is open.
- **What:**
  - Unload page-scoped data when leaving the route (or rely on 1.2's lazy hydration which fixes the load side; add explicit cleanup on unmount for game-page media).
  - Verify no `localStorage` mirror grows unbounded (watcher untracked set, session notes, friends storage — audit write frequency).
  - Cap `ActivityContext` sessions retained in memory to the same window shown in the UI (e.g. history-cap setting already exists — apply it to the in-memory array too).
- **Acceptance:** 30-minute session hopping between pages shows a flat heap (DevTools Memory timeline); restart memory (task manager private bytes) ≤ 1.5× steady-state.

### 5.3 WebView2 / window configuration **[Quick win, validate only]**
- **Why/What:** confirm the WebView2 data folder is on the same drive as the app data (cache warm boots), that the `splashscreen` window is destroyed (not merely hidden) after reveal, and that no per-frame work is triggered by the frameless window's custom controls. If GPU rasterisation is disabled on some machines, note it in the Hardware settings tab.
- **Acceptance:** documented in `knowledge.md`; no code change unless measurement shows a win.

### 5.4 Console/log noise and dev-only cost **[Quick win]**
- **Why:** prod builds keep console + error logs; high-frequency logging on hot paths (watcher, progress, art) adds serialisation cost in release.
- **What:** strip `console.*` in production Vite builds (esbuild `drop: ["console", "debugger"]` in `vite.config.ts` build config only) and gate Rust `eprintln!`/debug logs behind the `GAMEINDEX_PERF`/debug flag where they sit on hot paths.
- **Acceptance:** zero console writes on hot paths in the release bundle; dev experience unchanged.

### 5.5 CSS/paint cost **[Medium]**
- **Why:** heavy blur/glassmorphism surfaces (mods page glass, splash overlays, big-screen shells) and unthrottled CSS animations can burn GPU on low-end hardware.
- **What:** audit `will-change`/`backdrop-filter` usage; ensure animations pause under `prefers-reduced-motion` (partial support exists) and when the window is hidden; convert any per-frame JS-driven styles (hero parallax, backgrounds) to compositor-friendly transforms.
- **Acceptance:** GPU/`Rendering` main-thread time in the Phase 0 trace drops ≥ 30 % on the home + mods routes on a low-end iGPU.

### 5.6 Cross-cutting: definitions of done for all perf work
- Run `npx tsc --noEmit`, `cargo check`, `npm run lint`, and relevant `npm test` before landing.
- Update `knowledge.md` "gotchas" for any behaviour change (e.g. light vs detail game loading) so future agents don't reintroduce full-payload loads.
- Tick items off `todo.md` §25 as they land, and update this plan's appendix tables with new measurements.

---

## 6. Suggested sequencing

| Order | Items | Est. effort | Risk |
|---|---|---|---|
| **P0** | 1.1 harness, 1.4 fixed-timer reveal, 1.6 artwork cleanup off boot, 2.5 interval scoping, 3.3 watcher idle-silence, 5.1 CI bundle gate, 5.4 console stripping | 2–3 days | Low |
| **P1** | 1.5 settings coalescing, 1.2 lazy provider hydration, 2.4 watcher diff, 2.6 image pipeline, 2.7 VirtualGrid heights, 3.4 event throttling | 1–2 weeks | Low–Med |
| **P2** | 1.3 light `load_games` + detail command (frontend + Rust, one migration-free change), 2.1 context slicing, 2.2 deferred filters, 2.8 shared windowing core | 2–3 weeks | Med |
| **P3** | 3.1 rayon/tokio parallelisation, 3.2 payload streaming, 5.2 memory hygiene, 5.5 paint budget | 2–3 weeks | Med–High |

P0 delivers the most visible "app feels faster" wins with the least risk. P2 (light `load_games` + context slicing) is where the structural responsiveness gains are; schedule it as its own focused effort and re-baseline with the Phase 0 harness before starting.

---

## 8. Implementation status (2026-09-04)

Landed (P0):
- 1.1 (partial) — frontend boot markers `src/utils/bootPerf.ts` (`markBootStart`/`logBootReady`) wired through `main.tsx` + `WindowReveal`; Rust env-gated timings not yet added.
- 1.4 — `src/components/WindowReveal.tsx` reveals the main window on `gamesHydrated` + first paint + 250 ms hold (was a fixed 750 ms timer in `App.tsx`), with a 6 s fallback so a hung hydration can never strand the splash.
- 1.6 — artwork + stale-cache cleanup moved off `load_games`/`save_game` into a one-shot background thread (5 s after boot) in `src-tauri/src/games.rs`; the per-`save_game` cache prune is gone from the image-enrichment hot path.
- 2.5 (audit) — the 1 s popover clock and splash tip interval are already open/record-gated; `GamepadProvider` polls only in Big Screen. No further change needed.
- 3.3 — idle poll backoff (15 s) in `game_watcher.rs` (see amended §3.3).
- 5.1 — `scripts/check-bundle.mjs` + CI step; budgets carry headroom over today's bundle (entry ≤ 950 KB, locale ≤ 520 KB, total ≤ 9.5 MB) so the gate catches regressions; the 450 KB entry stretch target stays for P1/P2.
- 5.4 — production `console`/`debugger` stripping via Vite `esbuild.drop` (dev logging untouched).

P1 progress (2026-09-04, partial):
- 2.4 — debounce **already present** in `src/context/game/useWatcherIndex.ts` (500 ms coalescing rebuild). The Rust add/remove *diff* command is deferred: P2's light `load_games` shrinks the per-rebuild payload anyway.
- 3.4 — `game-move-progress` throttled in `src-tauri/src/size.rs::copy_dir_with_progress` (was: one IPC event **per file copied**; now ≤ 1 per 150 ms, final 100 % tick always emitted).
- 2.6 (partial) — `img.decoding = "async"` in `useProgressiveImages.tsx`; the request-batching queue + `content-visibility` CSS are deferred (need visual verification).
- 2.7 — **deferred deliberately**: the row-height constants in `LibraryVirtualGrid.tsx` and `library.css` must stay in lockstep, and validating measured heights requires the in-app Phase 0 trace (visual). Landing blind risks scroll regressions on the most-used surface.
- 1.2, 1.5 — not started (provider lazy-hydration + settings KV coalescing are P1's structural items; both change the boot IPC profile and deserve their own verified pass).

P2 progress (2026-09-04):
- 2.1 (partial) — landed the narrow-subscription core in `src/context/GameContext.tsx`: an id→game map diffed by object identity after every `games` change, notifying only subscribers whose game actually changed; `useGameById` now reads via `useSyncExternalStore` and `GamePage` (`src/pages/GamePage.tsx`) subscribes through it, so the whole game-detail subtree no longer re-renders when an unrelated title updates (watcher exit, enrichment, size probe). Wider call-site slicing (the ~80 `useGames()` consumers split into data/actions contexts) remains a mechanical follow-up; `GameSelectorsContext` scaffolding is still defined-but-unmounted.
- 2.2 (partial) — `useLibraryFilters.ts` now runs its expensive derivations (`filterGames`, relevance sort, `hasFilters`) against `useDeferredValue(filters)`: keystrokes stay on the urgent path while narrowing/sorting recompute at idle priority. Facet lists stay urgent. Store search + command palette not yet converted.
- 2.8 — **deferred**: extracting the shared windowing core between `LibraryVirtualGrid` and `bigscreen/GameGrid` changes scroll math on the two most-used surfaces and needs the in-app scroll trace to verify (same rationale as 2.7).
- 1.3 (light `load_games`) — **deferred deliberately, with a concrete blocker found today**: `usePersistence` mirrors the in-memory array wholesale to `save_games` (DELETE + re-insert of every row, 300 ms leading-window debounce). Trimming heavy columns from the boot payload would therefore WIPE those DB columns (screenshots, steam achievements, IGDB reviews, releases, …) on the first save after boot for any game never detail-loaded in-session. A save-side merge can't distinguish "not loaded" from "user cleared it" because several heavy columns ARE user-editable (`EditGameModal` edits `screenshots`/`similarGames`/`description`/`storyline`). Landing 1.3 requires a dedicated design pass (light-list + detail merge + explicit tombstone/merge semantics on save) verified at runtime.

P3 status (2026-09-04):
- 3.1 / 3.2 — not started. Parallelisation must be benchmark-chosen per loop (DB layer stays synchronous per `knowledge.md`; Steam/IGDB rate-limit discipline applies); 3.2's payload trimming overlaps 1.2/1.3 lazy hydration and inherits their deferral.
- 5.2 (audit) — `SettingsContext.historyCapDays` (1|7|30) exists; `ActivityProvider` loads the full `sessions` table into state on mount and re-reads it per `game-exited`. Capping the in-memory array to the setting needs the Activity page's display semantics verified (charts/rail read the same array), so it is documented, not landed.
- 5.5 (audit) — `src/styles/animations.css` already ships a complete `prefers-reduced-motion` block covering every `animate-*` utility + stagger delays; `backdrop-filter` has **zero** usage in `src` (glass surfaces are gradient/translucency based). No code change landed this pass.

Verified: `tsc --noEmit`, `eslint --max-warnings 0`, `cargo check`, `npm run build`, bundle gate (entry 837.8 KB ≤ 950 KB budget).

Remaining: P1 (2.6 batching/CSS, 2.7, 1.2, 1.5), P2 (1.3 light/detail with save-merge design, 2.1 call-site slicing, 2.2 store/palette, 2.8), P3 (3.1, 3.2, 5.2, 5.5-as-needed). Re-baseline with the §1 harness after P2.

## 7. Appendix — verified evidence from today's code

- `dist/assets` (build 2026-09-03): entry `index-*.js` = 835 528 B; `react-vendor` 192 520 B; `hls` 590 649 B (lazy); locales ru 443 978 / fr 350 351 / es 341 587 / de 341 331 / zh-CN 312 823 B (dynamic).
- `src/App.tsx`: 750 ms fixed `setTimeout` → `close_splashscreen`; provider nesting 20+ deep.
- `src-tauri/tauri.conf.json`: `main` window starts `visible: false`; separate `splashscreen` window.
- `src-tauri/src/games.rs::load_games`: full-row list + `cleanup_unreferenced_artwork` on every boot; `save_game` runs `cleanup_non_library_caches`.
- `src-tauri/src/db/games.rs::GAMES_SELECT_SQL`: 60-column select (incl. description, screenshots/videos/steam_achievements JSON columns).
- `src-tauri/src/db/pool.rs` (via `knowledge.md`): sync sub-ms queries intentionally un-wrapped in `spawn_blocking` — do not blanket-wrap.
- `src-tauri/src/game_watcher.rs`: `POLL_INTERVAL_PENDING` 1 s / `POLL_INTERVAL_STEADY` 5 s (adaptive polling exists).
- `src-tauri/src/downloads/manager.rs::emit_progress`: hash-deduped snapshots (already throttled by content change).
- `src/components/library/LibraryVirtualGrid.tsx`: windowing, `VIRTUALIZE_THRESHOLD = 80`, overscan 4; `src/components/bigscreen/GameGrid.tsx` is a second implementation.
- `src/hooks/useProgressiveImages.tsx`: per-element `IntersectionObserver` (200 px margin) → one `download_image` IPC per element.
- `src/context/GameSelectorsContext.tsx`: selector-splitting pattern exists for `games` — extend, don't invent.
- ~24 `setInterval` call sites audited in `src/` (worst offenders listed in §2.5).
- Existing plan overlap: `plans/Linux.md` §4 lists CPU-optimisation items (adaptive polling, reduced-motion, console stripping, debounced resize) — some already landed in `game_watcher.rs`; reconcile duplicates there before re-implementing.
