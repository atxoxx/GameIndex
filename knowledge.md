# Project knowledge

This file gives Codebuff context about your project: goals, commands, conventions, and gotchas.

## Quickstart
- **Stack:** Tauri v2 (Rust backend) + React 19 + TypeScript (Vite). Bundler: Vite 7. Dev port: `1420`.
- **Setup:** `npm install`
- **Dev:** `npm run tauri dev` — starts Vite at `localhost:1420` and the native window.
- **Build:** `npm run tauri build` — runs `tsc && vite build` then bundles via tauri.conf.json bundle targets.
- **Typecheck:** `npx tsc --noEmit` (the `npm run build` script does `tsc && vite build`, so a fresh build also typechecks).
- **Tests:** `npm test` (`vitest run`) — frontend unit tests (filters, Steam integration, units, color, game utils). Rust unit tests run via `cargo test` in `src-tauri` (some live-network tests are `#[ignore]`d).
- **Lint:** `npm run lint` (ESLint, `--max-warnings 0`). i18n key parity: `npm run audit:i18n`.
- **Frontend-only (no Tauri shell):** `npm run dev` — useful for UI iteration; Tauri-injected APIs will be stubbed.

## Architecture

### Tauri window
- Frameless window configured in `src-tauri/tauri.conf.json` — `decorations: false`, min 900×600. Custom in-app `WindowControls` (min / max / close) live under `src/components/WindowControls.tsx`. Title bar is the `TopNav`.
- **Tray icon** (`src-tauri/src/tray.rs`): right-click menu with a live status line, green-dot variant while a game is running; left-click re-shows the window. Close-to-tray / minimize-on-launch / restore-on-last-exit are launcher settings.
- **Autostart:** `tauri-plugin-autostart` (LaunchAgent on macOS, `HKCU\...\Run` on Windows, `.desktop` on Linux) — `set_autostart_enabled` / `is_autostart_enabled`.
- **Updater:** `tauri-plugin-updater` for release builds; `updater.rs` adds portable-mode update download/cancel/apply.

### Frontend (`src/`)
- **Router:** React Router v7 with `HashRouter` in `src/main.tsx` (required — Tauri ships `file://` in production). Routes are declared once in **`src/bigscreen/registry.tsx`** (`BIGSCREEN_ROUTE_PAIRS`) and rendered through `<ShellSwitch>` — every desktop page is a `React.lazy` chunk, and big-screen routes swap to controller-first variants when Big Screen is active.
- **Layout:** `App.tsx` wraps `ThemeProvider > LanguageProvider > ToastProvider > UpdateProvider > SplashProvider > GameProvider > ActivityProvider > AchievementProvider > DensityProvider > LibraryFilterProvider > WishlistProvider > SourceProvider > DownloadProvider > SettingsProvider > SessionNotesProvider > BigScreenProvider > PresenceProvider`. The shell renders `TopNav`, `Sidebar`, and `MainContent` via nested routes. `<Splashscreen />` is mounted inside `SplashProvider` at z-index 9500. `BigScreenLayout` is lazy-loaded (heavy controller shell).
- **Pages (`src/pages/`)** — desktop pages, each its own lazy chunk:
  - `HomePage` (`/home`) — dashboard landing with widgets + spotlight carousel.
  - `LibraryPage` (`/library`, `/library/:gameId` → `GamePage`) — main library grid + game detail.
  - `GamePage` — rich detail view with hero, metadata, reviews, achievements, screenshots, web links (native webview preview), live player count, force-close.
  - `StorePage` (`/store`) + `StoreGameDetail` (`/store/:gameSlug`) — IGDB-backed catalog with rails, search 2.0, ownership badges, detail news tab.
  - `WishlistPage` (`/wishlist`), `NewsPage` (`/news`), `DealsPage` (`/deals` → `src/pages/deals/DealsPage`) — discovery surfaces.
  - `ActivityPage` (`/activity`) — dashboard / Gantt / performance / sessions / sparkline sub-tabs in `src/pages/activity/`.
  - `AchievementsPage` (`/achievements`), `DownloadsPage` (`/downloads`), `StoragePage` (`/storage`).
  - `CommunityPage` (`/community`), `FriendsPage` (`/friends`).
  - `EmulatorsPage` (`/emulators`) — multi-system emulator catalog, ROM management, executable launcher, `EmulatorEditorModal`, downloadable emulator installs.
  - `ModsPage` (`/mods`) — dual-pane manager for Steam Workshop & Nexus Mods with bulk actions and stat cards.
  - `SettingsPage` (`/settings`, `/settings/:tab`) — catalog-driven tabs: **General, Appearance, Hardware, Integrations, Discord, Downloads, Plugins, Launcher, Privacy & Data**. `settingsCatalog.tsx` is the single source of truth for tab order, sidebar groups, jump bar and search index. Integrations cover Steam, Epic, GOG, Humble, Rockstar, Uplay.
  - `DocsPage` (`/docs`) — in-app user guide, content fully in i18n `docs.*` keys.
  - Default redirect on `/` → `LandingRedirect` (`/library`).
- **Components (`src/components/`)** — grouped by area: `game/`, `library/`, `store/`, `downloads/`, `download-modal/`, `news/`, `activity/`, `charts/`, `bigscreen/`, `friends/`, `deals/`, `command-palette/`, `hero/`, `weblinks/`, `mods/`, `emulators/`, `achievements/`, `ui/` (`Card`, `Button`, `Badge`, `KpiTile`, `Skeleton`, `Tooltip`, `ConfirmModal`, `PageHeader`, `UpdateModal`).
- **Contexts (`src/context/`)** — providers per cross-cutting concern: `GameContext` (library CRUD / launch; split into `context/game/*` hooks: `useLaunch`, `usePersistence`, `useSessions`, `useWatcherIndex`, `useEnrich`), `ActivityContext`, `AchievementContext` (multi-source), `WishlistContext`, `DownloadContext` (concurrent downloads + seeding + speed limits), `SourceContext` (download sources), `SplashContext`, `ToastContext`, `ThemeContext` (light/dark + accent family), `LanguageContext` (i18n), `DensityContext`, `SettingsContext`, `SessionNotesContext`, `SidebarCollapseContext`, `LibraryFilterContext`, `PresenceContext`, `UpdateContext`, `BigScreenContext`.
- **Hooks (`src/hooks/`)** — extracted filters/store-cache/player-count/steam helpers (`useLibraryFilters`, `useStoreGames`, `useStoreCatalogue`, `useStoreCache`, `useProgressiveImages`, `useSteamGameStats`, `useSteamPlayerCount`, `useSteamPlayerHistory`, `useSteamAppId`, `useNewsFeeds`, `useWishlist`, `useHiddenGames`, `useFilterPresets`, `useDiscordPresence`, `useTrayNavigation`, `useTrayStrings`, `useFriends*`, `useGameMods`, `useDownloadCoverArt`, `useBandwidthHistory`, `useSizeUnit` / `useSpeedUnit`, `useViewDensity`, `useGameAccent`, …).
- **Types (`src/types/`)** — hand-written TypeScript types mirroring the Rust serde models: `game.ts`, `steam.ts`, `gog.ts`, `epic.ts`, `humble.ts`, `rockstar.ts`, `uplay.ts`, `source.ts`, `download.ts`, `deals.ts`, `plugins.ts`, `retro.ts`, `mods.ts`, `friends.ts`.
- **Styles (`src/styles/`, `src/*.css`)** — co-located CSS files. `App.css` is a thin barrel of `@import`s that wires up the per-feature stylesheets in cascade order. All theme colors go through CSS custom properties: the base `:root` dark palette lives in `styles/theme.css`, alternate palettes (`[data-theme="light"]`, nord, cyberpunk, aurora, …) live in `styles/themes.css`, and a global **accent family** (`--accent*`) drives the game palette. **Never hardcode hex/rgb values** — use `var(--…)`.

### Backend (`src-tauri/src/`)
- **Entry point:** `lib.rs::run()` — the header, module decls, plugin registration, and `generate_handler!` command registry. `main.rs` simply calls `gameindex_lib::run()`. The old 4700-line monolithic lib.rs was split into domain modules (no behavior change): `games.rs`, `emulation.rs`, `launcher.rs`, `media.rs`, `store.rs`, `sessions.rs`, `steam_stats.rs`, `system.rs`, `webview.rs`, `friends.rs`.
- **Modules:** `game_scraper`, `game_watcher` (WMI process polling + session lifecycle), `steam_game_watcher`, `gpu_detector`, `mahm_reader` / `rtss_reader` (MSI Afterburner / RivaTuner shared memory for in-game FPS/frametime overlays), `metrics_collector`, `source_manager` (local FTS5 download index), `store_checker` (ownership), `downloads/` (see below), `achievements` + `local_achievements` + `achievement_watcher` + `manual_links` + `retro` (multi-source achievements), `crackwatch`, `deals` (Game Pass / ITAD / giveaways / playtesters), `price`, `protondb`, `size`, `config`, `tray`, `updater`, `system_screenshots`, `emulator_install`, `mods/` (`detect.rs` + `nexus.rs`), `plugins/` (sandboxed JS search plugins), `discord_presence`.
- **Side binary:** `src-tauri/src/bin/` is currently **empty** — do not assume anything about it; list the directory first.
- **Per-store integrations (`src-tauri/src/steam/`, `gog/`, `epic/`, `humble/`, `rockstar/`, `uplay/`)** — each has `auth.rs` + `sync.rs` + `types.rs`:
  - **Steam** uses a pasted **Web API key** + SteamID64 (Phase 5 model — the OpenID/WebView flow is gone). `steam/launch_options.rs` reads launch options from Steam config for the `steam://launch/<appid>/dialog` picker.
  - **GOG** uses **OAuth2 WebView login + token exchange** — `gog_start_login` opens a WebView at `login.gog.com/auth?client_id=46899977096215655&layout=galaxy`, captures the auth `code` via an `on_navigation` callback (no JS probe), exchanges it at `auth.gog.com/token`, and persists tokens in the SQLite `kv_store` (NOT the keychain — `keyring`'s Windows backend silently fails on service names containing `/`). Sync builds a Bearer-authenticated client.
  - **Epic** uses OAuth via stored refresh tokens.
  - **Humble** — WebView login + purchases sync (`humble_get_settings` / `humble_save_settings`).
  - **Rockstar** — registry scan of installed games; no cloud auth; `rockstar_launch_game` launches the client.
  - **Uplay** — registry + product-cache scan; `uplay_launch_game` via `uplay://` protocol.
- **Downloads (`src-tauri/src/downloads/`)** — `manager.rs` orchestrates **concurrent downloads (no queue)** across three paths:
  - `http.rs` — direct HTTP/chunk downloader with resume.
  - `debrid.rs` — Real-Debrid / AllDebrid / TorBox cache lookup + unrestrict.
  - `torrent.rs` — `librqbit` (pinned to `9`, no HTTP API feature) torrent engine with seeding.
  - `browser_resolver.rs` — captures downloads initiated in the embedded browser; `extract.rs` (post-download extraction), `persistence.rs` (state + history), `hosters.rs`, `types.rs`.
- **SQLite storage layer (`src-tauri/src/db/`)** — see "Storage" section below.

### Cross-cutting UI
- **Launch flow:** `GameContext.launch(...)` → `invoke("launch_game", {...})` from Rust. Rust:
  1. Runs optional pre-launch script (with admin flag, elevation-prompt-aware) then spawns the exe (Windows: `ShellExecuteExW` with `runas` if `ERROR_ELEVATION_REQUIRED`, else `std::process::Command`); supports launch args, run-as-admin, companion apps, and the Steam launch-option picker.
  2. Registers a session with the shared `Arc<Mutex<GameWatcher>>` (from `state()`).
  3. Starts a metrics collection channel (`metrics_collector::start_metrics_collection`) keyed to the new PID + GPU.
  4. Background poller (`game_watcher::start_background_poll`, every 5s) detects exit via WMI on Windows and writes one row to the `sessions` table before emitting the `game-exited` event. `steam_game_watcher` handles Steam-only games.
- **Session record per exit:** last_played bump + activity dashboard roll-up. Use `update_game_last_played` IPC, not `save_games`, for the hot path.
- **Steam `open` flow:** when a Steam title has no local exe (e.g., synced only), Rust opens `steam://run/<appid>` via the opener plugin and registers a pending session that the poller activates when the matching process appears.
- **Discord Rich Presence:** `discord_presence.rs` owns a background IPC thread (reconnect w/ retry); frontend emits `discord-presence-update` events ("playing"/"browsing"/"stopped") via `useDiscordPresence`; per-option toggles in the Discord settings tab.

## Storage (SQLite)

The original single `gamelib.db` was **split into per-domain database files** under `<app_data_dir>` (one `<name>.db` per logical domain, each with its own `r2d2` pool, WAL, and checkpoint cadence). A one-time `split_migrate.rs` copies any legacy `gamelib.db` into the domain files and renames the original to `gamelib.db.pre-split-<timestamp>` (never deletes it).

- **Pool:** `src-tauri/src/db/pool.rs` — `Db` holds one `r2d2_sqlite` pool per domain (`sources`, `games`, `sessions`, `download_history`, `wishlist`, `store_cache`, `achievements`, `kv`, `news`, `emulators`, `mods`, `plugins`). PRAGMAs on every connection: WAL, `synchronous = NORMAL`, `foreign_keys = ON`. Sync calls are deliberately NOT wrapped in `spawn_blocking` (sub-millisecond local queries; the overhead exceeds the work).
- **Schema registry:** `src-tauri/src/db/schema.rs` defines `DOMAIN_SCHEMAS: &[DomainSchema]` — each entry is a domain label + an ordered list of `("vN", &ddl)` migrations. DDL lives in per-domain files (`schema_sources.sql`, `schema_games.sql` + `schema_games_v2..v6.sql`, `schema_sessions.sql`, `schema_download_history.sql`, `schema_wishlist.sql`, `schema_store_cache.sql`, `schema_achievements.sql` + `_v2`, `schema_kv.sql`, `schema_news.sql`, `schema_emulators.sql`, `schema_mods.sql` + `_v2`, `schema_plugins.sql` + `_v2`). **Add new migrations by appending a `("vN", &ddl)` entry to the domain's slice — never renumber existing tuples.** The runner in `db::migrate.rs` applies each version in its own transaction inside `.setup`.
- **Games columns are extensive** (`schema_games.sql` + v2–v6): metadata (cover/icon/banner/logo, description, developer, publisher, release date, IGDB ids, reviews, language supports, time-to-beat, similar games, releases, alternative names), launch orchestration (launch args, run-as-admin, pre/post-launch scripts + admin flags, companion apps JSON, `show_steam_launch_selection`, `igdb_id`), store linkage (Steam appid/playtime, Epic namespace, GOG id/playtime), emulation (`emulator_id`, `rom_path`), mods (`mods_folder`, `mods_size_bytes`), and `cover_source_url` (for Discord presence).
- **DAO pattern:** one file per table under `src-tauri/src/db/` (`games.rs`, `sessions.rs`, `sources.rs`, `wishlist.rs`, `store_cache.rs`, `achievements.rs`, `achievement_links.rs`, `news.rs`, `kv.rs`, `emulators.rs`, `mods.rs`, `plugins.rs`, `download_history.rs`, `secrets.rs`, `legacy.rs`, `atomic.rs`, `migrate.rs`, `split_migrate.rs`, `pool.rs`, `schema.rs`, `mod.rs`) exposing `upsert_*`, `list_*`, helpers. Commands extract the DB pool via `app.state::<db::Db>().inner().clone()` — never wrap in `Arc`, the inner pool is already shared.
- **Compact JSON columns:** used for variform state (sources config payloads, a whole `GameData` row, store detail cache). Tradeoff: read-side deserialization vs. write-side schema flexibility.
- **Secrets:** `db::secrets.rs` wraps `keyring` for Steam API key / Epic OAuth tokens / Real-Debrid API keys. **GOG tokens live in `kv_store`, not the keychain** (keyring Windows backend fails on service names containing `/`). `sync-secret-service` is enabled for Linux keyring so Gnome Keyring + KWallet work without extra setup.

## Integrations

- **Steam** — `steam/sync.rs` reads `libraryfolders.vdf` + the manifests under `steamapps/`, then pulls metadata from the Web API (key stored in keychain). Games removed from the library on Steam uninstall. Live concurrent player count via `ISteamUserStats/GetNumberOfCurrentPlayers/v1/` (no key needed), cached 60s per-appid in `PlayerCountCache`; 24h ring buffer in `PlayerCountHistoryCache` (capped at 1440 samples / 5s dedupe). `steam/launch_options.rs` powers the `steam://launch/<appid>/dialog` picker.
- **GOG Galaxy** — OAuth2 WebView login + token exchange (client_id `46899977096215655`, tokens in `kv_store`). `gog/sync.rs` is pure Rust (no WebView) using a Bearer-authenticated client. GOG achievements via `gog_fetch_achievements`.
- **Epic Games Store** — OAuth via `epic::auth` (refresh tokens in keychain). Achievements via `epic::achievements::epic_fetch_achievements`.
- **Humble / Rockstar / Uplay** — see the per-store section above.
- **Achievements (multi-source)** — `achievements.rs` (Steam Web API), `gog::achievements`, `epic::achievements`, `retro.rs` (RetroAchievements: console mapping, game lookup, forced game-id override, sync), `manual_links.rs` (link any game to a public Steam appid + manual unlock editor), `local_achievements.rs` + `achievement_watcher.rs` (parse crack/emulator achievement files on disk, gated by `local_achievements_enabled` kv flag, default on). All sources merge into the `achievements_cache` table with a `source`/`provider_id` column (schema v2) + `achievement_links`.
- **News** — RSS reader. `fetch_url` IPC lets the frontend bypass browser CORS; `news.rs` DAO persists the most recent read per feed. Regional feeds + curated feed packs in the UI.
- **Deals** — `deals.rs` exposes `fetch_gamepass_catalog`, `fetch_isthereanydeal_deals`, `fetch_giveaways`, `fetch_playtester_games`, `open_deal_url` (opens external via opener plugin).
- **Crackwatch** — `crackwatch::fetch_crackwatch_status(game_name, app_id?)` scrapes gamestatus.info (24h KV cache keyed by slug+appid, `CrackWatchStatus { isCracked, crackDate, crackGroup, protection }` or `null`), plus a `_batch` variant. Rendered by `CrackWatchCard`.
- **Torrents** — `downloads/torrent.rs` wraps `librqbit` (see Cargo.toml — `librqbit 9`, `default-tls`, **no** `http-api`). Download throttled via `Session::ratelimits`; per-download file selection. Cleanup hook (`cleanup_extractions`) registered on the Tauri `RunEvent::Exit`.
- **Search plugins** — `plugins/` (`PluginManager` + QuickJS sandbox in `runtime.rs`): user-installed `.js` files adding torrent-search sources. Every plugin runs in a fresh sandbox with a 64 MB memory cap, an instruction budget (~20M instructions), a 20 s wall-clock timeout, and a scheme-checked `httpGet`/`httpGetJson`/`httpGetXml`/`httpGetAll` API + `definePlugin` manifest. Raw results cached per `(plugin_id, query)` for 15 min. `search_downloads` / `search_downloads_stream` merge built-in source results with every enabled plugin's results (0.2 match floor, newest-first). Plugin files live at `<app_data_dir>/plugins/<id>.js`; bundled plugins ship in the repo `plugins/` dir.

### Emulators & ROMs Management
- `EmulatorsPage` (`src/pages/EmulatorsPage.tsx`) manages retro/multi-system emulator platforms, launcher executable paths, and ROM catalogues. Supports manual ROM creation, file size tracking, bulk ROM actions (rename, delete), real platform logo SVG rendering, and Storage page disk usage breakdown. Configured via `EmulatorEditorModal.tsx`; downloadable emulator catalog + install pipeline via `emulator_install.rs` + `DownloadEmulatorModal`.

### Mod Manager (Steam Workshop & Nexus Mods)
- `ModsPage` (`src/pages/mods/ModsPage.tsx`) provides a dual-pane interface with glassmorphism styling, stat cards, and status filtering. Engine-aware mod detection (`mods/detect.rs`), Steam Workshop fetching enriched with Steam Web API metadata, Nexus Mods integration (API key, domain mapping, update checks — `mods/nexus.rs`), load-order reorder, conflict detection. Bulk multi-select actions (enable, disable, delete) and mod storage footprint tracking.

### Internationalization (i18n)
- `LanguageContext` (`src/context/LanguageContext.tsx`) provides app-wide translation using structured JSON locale dictionaries: **en, de, fr, es, ru, zh-CN** (`src/i18n/*.ts`). Components consume `useTranslation()` / `t(key)` with fallback support; `npm run audit:i18n` checks key parity. Settings page language selector + OS-language auto-detect.

### Big Screen Mode
- **`BigScreenContext`** (`src/context/BigScreenContext.tsx`) toggles a 10-foot TV UI with rail-aware gamepad navigation (`GamepadProvider` + `useFocusable`). **Big Screen v3** (`src/bigscreen/registry.tsx`): `PRIMARY_SECTIONS` (home, library, store, wishlist, deals, news, friends, community) + `SYSTEM_SECTIONS` hub (downloads, storage, achievements, mods, emulators, settings, docs); `ShellSwitch` renders the controller-first variant per route when active. Each bigscreen view is its own lazy chunk (manualChunks keeps the desktop bundle free of bigscreen code). Persisted under `gamelib-bigscreen`.

### Storefront Engine
- **Storefront Catalog**: Powered by **IGDB** for catalogue browsing, featured rails, tokenized fuzzy search with dedup, genre/platform filtering, and game detail metadata (`store.rs`, `store_checker.rs` for Steam/Epic ownership). Store game detail has a News tab and per-section show/hide toggles.
- `CrackWatchContext`/`PriceContext` batch per-card lookups into single backend round-trips (`fetch_crackwatch_status_batch`, `fetch_price_batch`).

### Friends & Community
- `FriendsPage` (`/friends`) + `CommunityPage` (`/community`) are social surfaces backed by a Rust friends module (`friends.rs` — nostr-based presence, sync, DMs with read receipts) + `useFriends*` hooks and `friendsStorage.ts` / `communityStorage.ts`. Not in the original roadmap — treat as experimental/self-contained.

### Virtualized library grid
- `LibraryPage` renders large lists via a local `VirtualGrid` (windowed rendering, co-located in `LibraryPage.tsx`) rather than `react-window`. Long lists stay responsive without an external virtualization dep.

## Style & UI conventions

- **Dark-first** — `:root` declares the dark palette; `[data-theme="light"]` overrides. `ThemeProvider` toggles `data-theme` on `<html>`. A global accent family (`--accent*`) drives the game palette across all themes.
- **Iconography** — `lucide-react` (tree-shakable) for app chrome/navigation icons; inline SVG is still fine for brand marks and one-off glyphs (bigscreen section icons are inline). Components live next to their consumers in `src/components/<area>/`.
- **Modals & overlays** — `<Splashscreen />` overlays at z-index 9500; modal components use fixed positioning. Render nothing when idle (don't mount empty shells).
- **Cards / KPIs** — reuse `src/components/ui/Card.tsx`, `KpiTile.tsx`, `Badge.tsx`, `Skeleton.tsx`, `Tooltip.tsx`, `ConfirmModal.tsx` for consistency.

## Conventions (do / don't)

- **Routing:** Always `HashRouter`. Never `BrowserRouter` — Tauri ships `file://` in production. Declare new routes in `src/bigscreen/registry.tsx` (`BIGSCREEN_ROUTE_PAIRS`) — don't hand-add `<Route>`s in `App.tsx`.
- **Theming:** Use CSS variable tokens (`var(--…)`) defined in `styles/theme.css` (base `:root`) with alternate palettes in `styles/themes.css` and the accent family. Never hardcode colors. Every dark-mode style sees its light counterpart in `[data-theme="light"]`.
- **Components:** One component per file under `src/components/<area>/`. Co-locate styles in the matching feature stylesheet under `src/styles/` (or `App.css`'s barrel order). Prefer CSS classes over CSS-modules so theme tokens apply.
- **Icons:** Use `lucide-react` for UI chrome icons (tree-shaken at build, so only imported icons ship). Prefer it over hand-rolled inline SVGs for consistency; keep brand marks (e.g. the TopNav logo) inline.
- **Tauri commands:** Round-trip JSON at the boundary (`serde_json::to_value` / `from_value`) — saves hand-rolling field-by-field converters. Use `#[serde(rename_all = "camelCase")]` on Rust structs and `#[serde(default)]` for new optional fields so deserialization of older payloads still works.
- **State registration:** Register pooled/shared state inside `.setup` and read it via `app.state::<T>()`. Do **not** wrap the existing `Db` in `Arc` (the pool is already shared); other shared state (GameWatcher, SourceManager, StoreChecker, PluginManager) uses `Arc<Mutex<…>>` or plain `Arc`.
- **Async + locks:** Hold `Mutex` guards across `.await` only when absolutely necessary — the codebase generally clones into local variables and drops the guard before awaiting.
- **Schema migrations:** Edit existing `CREATE TABLE` clauses? **No.** Append a new `("vN", &ddl)` entry to the domain's slice in `schema.rs` `DOMAIN_SCHEMAS` + add a `schema_<domain>_vN.sql` file + use `ALTER TABLE … ADD COLUMN` for new columns.
- **Bundle size:** Keep the desktop bundle lean. Code-splitting is already in place (per-page `React.lazy`, `manualChunks`, `modulePreload` deferral of bigscreen/html2canvas/hls/nostr/qrcode). **Do not** add heavyweight N-API/icon dependencies; prefer browser-native APIs. `html2canvas` (game-page capture) and `hls.js` (trailers) are the deliberate heavy exceptions; `lucide-react` is tree-shakable.

## Common dev gotchas

- **Windows-only paths:** `game_watcher`, `gpu_detector`, `metrics_collector` use `WMI` + `Win32` APIs (`wmi`, `windows 0.58` crate). On non-Windows the watcher still runs but `query_running_processes()` returns empty (the cross-platform smoke test path). Elevation (`runas`) is Windows-only; passing `runAsAdmin: true` on macOS/Linux is a no-op error. A Linux plan exists in `plans/Linux.md` but is **not implemented** (crates are not yet platform-gated).
- **Steam auth:** pasted **Web API key** + SteamID64, not OpenID. The WebView + RSA finalize flow is gone.
- **GOG auth:** OAuth2 WebView + token exchange; **tokens in `kv_store`, not the keychain** — `keyring`'s Windows backend (`CredWriteW`) silently fails to persist when the service name contains a slash (`gamelib/gamelib-app`).
- **`librqbit` major pin:** Don't bump `librqbit` to anything below `9` (8.x is EOL upstream; 9.x reworked `SessionOptions` — `listen`/`connect`/`dht` replace the old flat fields, and 7.0.1 has a broken dep graph that fails to compile). Feature flags: `default-tls` on, `http-api` **off** (avoids pulling axum + serde_html_form).
- **rustls vs openssl:** `keyring 3` defaults to `crypto-rust`, deliberately avoiding the openssl-sys transitive dep. The plugin HTTP client also opts into `rustls` explicitly (Cloudflare-fronted hosts fingerprint Schannel and 403 it).
- **Plugin sandbox:** a malicious plugin can at worst stall its own `spawn_blocking` thread until the 20 s timeout — it cannot hang the app, read files, or touch the network outside the scheme-checked `httpGet` proxy. The QuickJS `Function` values are `!Send`, so plugins are re-evaluated per search (source text is kept, not the JS function).
- **Player-count caching:** live cache 60s per-appid, history cap 1,440 samples, 5s multi-banner dedupe. Only the Steam game-stats cache (`SteamGameStatsCache`) carries a 5 min negative cache — the player-count cache itself does not.
- **`Cargo.lock` is committed** in this repo. Manually bumping version ranges in `Cargo.toml` is acceptable; after a bump, run `cargo update -p <crate>` and review the **lockfile diff** carefully — transitive changes (keyring, librqbit, rusqlite especially) are how subtle regressions sneak in.
- **React 19:** Uses `react-dom/client` + `createRoot`. No `ReactDOM.render`. Concurrent features are opt-in per component.
- **Tests:** vitest (`npm test`) covers frontend utilities; Rust unit tests live inline (`#[cfg(test)]` in `db/games.rs`, `db/migrate.rs`, `plugins/mod.rs`, `steam/launch_options.rs`, GOG/Epic achievement parsers, …). Live-network tests are `#[ignore]`d. When adding a feature, add at least one happy-path + one error-path test.

## Repo layout cheat-sheet

```
src/                       React/TS frontend
  App.tsx                  Provider nesting + shell (routes come from bigscreen/registry.tsx)
  main.tsx                 createRoot + global CSS imports
  bigscreen/registry.tsx   Route table (BIGSCREEN_ROUTE_PAIRS) + ShellSwitch + section model
  pages/                   One folder per top-level route (deals/ under pages/deals)
  components/<area>/       Feature-area components
  context/                 Providers (Game, Activity, Source, ...) + context/game/* hooks
  hooks/                   Reusable stateful helpers
  types/                   Mirror the Rust serde models
  i18n/                    Locale dictionaries (en, de, fr, es, ru, zh-CN)
  styles/                  Per-feature themed CSS
  *.css                    Layout / store / library base styles

src-tauri/
  src/lib.rs               Tauri command registry + setup hook (slim after module split)
  src/main.rs              Trivial entry
  src/games|launcher|media|store|sessions|steam_stats|system|emulation|webview|friends.rs
                           Domain modules split out of the old monolithic lib.rs
  src/db/                  Per-domain SQLite pools + DOMAIN_SCHEMAS + DAOs (+ split_migrate.rs)
  src/steam|gog|epic|humble|rockstar|uplay/
                           Per-store auth + sync + types
  src/downloads/           manager.rs, http.rs, debrid.rs, torrent.rs, browser_resolver.rs, ...
  src/plugins/             Sandboxed JS search plugins (PluginManager + QuickJS runtime)
  src/game_watcher.rs      WMI process polling + session lifecycle
  src/game_scraper.rs      IGDB + LaunchBox + Steam reviews metadata fetch
  src/achievements.rs      Multi-source achievement sync + cache
  src/tray.rs              System tray + menu + live status
  src/discord_presence.rs  Discord Rich Presence IPC thread
  tauri.conf.json          Frameless window + bundle config
  Cargo.toml               Pinned major versions for librqbit/keyring/rusqlite

plugins/                   Bundled sandboxed search plugins
plans/                     Design docs (Linux.md Wayland/Proton guide, past specs)
```
