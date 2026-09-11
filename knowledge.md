# Project knowledge

This file gives contributors and AI coding agents context about the project: goals, commands, conventions, and gotchas.

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
- **Router:** React Router v7 with `HashRouter` in `src/main.tsx` (required — Tauri ships `file://` in production). Routes are declared once in **`src/bigscreen/registry.tsx`** (`BIGSCREEN_ROUTE_PAIRS`) and rendered through `<ShellSwitch>` — every desktop page is a `React.lazy` chunk, and big-screen routes swap to controller-first variants when Big Screen is active. `App.tsx` remains the provider/layout composition root; do not add a second routing strategy.
- **Layout:** `App.tsx` wraps `ThemeProvider > LanguageProvider > ToastProvider > UpdateProvider > SplashProvider > GameProvider > ActivityProvider > AchievementProvider > DensityProvider > LibraryFilterProvider > WishlistProvider > SourceProvider > DownloadProvider > SettingsProvider > SessionNotesProvider > SteamGridDbProvider > CrackWatchProvider > PriceProvider > BigScreenProvider > PresenceProvider`. The shell renders `TopNav`, `Sidebar`, and `MainContent` via nested routes. `<Splashscreen />` is mounted inside `SplashProvider` at z-index 9500. `BigScreenLayout` is lazy-loaded (heavy controller shell). `AdaptiveThemeSync` + `GameAccentSync` mount inside `PresenceProvider`; `SidebarCollapseProvider` wraps the shell and `GamepadProvider` is enabled only while Big Screen is active.
- **Pages (`src/pages/`)** — desktop pages, each its own lazy chunk:
  - `HomePage` (`/home`) — dashboard landing with widgets + spotlight carousel.
  - `LibraryPage` (`/library`, `/library/:gameId` → `GamePage`) — main library grid + game detail.
  - `GamePage` — rich detail view with hero, metadata, reviews, achievements, screenshots, web links (native webview preview), live player count, force-close, and (on Linux) a Wine-log viewer plus a per-game Proton/Wine tab inside `EditGameModal`.
  - `StorePage` (`/store`) + `StoreGameDetail` (`/store/:gameSlug`) — IGDB-backed catalog with rails, search 2.0, ownership badges, detail news tab, and a side-by-side compare tray/modal (up to 4 games).
  - `WishlistPage` (`/wishlist`), `NewsPage` (`/news`), `DealsPage` (`/deals` → `src/pages/deals/DealsPage`) — discovery surfaces.
  - `ActivityPage` (`/activity`) — dashboard / Gantt / performance / sessions / sparkline sub-tabs in `src/pages/activity/`.
  - `AchievementsPage` (`/achievements`), `DownloadsPage` (`/downloads`), `StoragePage` (`/storage`).
  - `CommunityPage` (`/community`), `FriendsPage` (`/friends`).
  - `EmulatorsPage` (`/emulators`) — multi-system emulator catalog, ROM management, executable launcher, `EmulatorEditorModal`, downloadable emulator installs.
  - `ModsPage` (`/mods`) — dual-pane manager for Steam Workshop & Nexus Mods with bulk actions and stat cards.
  - `SettingsPage` (`/settings`, `/settings/:tab`) — catalog-driven tabs in order: **General, Appearance, Interface, Hardware, Integrations, Discord, Downloads, Plugins, Launcher, Privacy & Data, Backup, Proton/Wine** (the last is hidden unless `showFullLinuxUi`). `settingsCatalog.tsx` is the single source of truth for tab order, sidebar groups, jump bar and search index. `InterfaceTab` includes drag-and-drop top-nav tab ordering (`gamelib.navbar_tab_order` in localStorage) with per-item visibility; `BackupTab` drives the NDJSON backup/restore flow; `CompatibilityTab` is the global Proton/Wine settings surface. Integrations cover Steam, Epic, GOG, Humble, Rockstar, Uplay.
  - `DocsPage` (`/docs`) — in-app user guide, content fully in i18n `docs.*` keys.
  - Default redirect on `/` → `LandingRedirect` (`/library`).
- **Components (`src/components/`)** — grouped by area: `game/` (incl. `EditGameModal`, `WineLogsModal`, `SteamFeaturesCard`, `GameRelationsCard`, `BigScreenHeroBackground`), `library/`, `store/` (incl. `StoreCompareModal` / `StoreCompareTray` + `storeCompare.ts`, `BigScreenStore`), `downloads/`, `download-modal/`, `news/`, `activity/`, `reviews/` (BBCode parser + review rows), `filters/`, `sidebar/`, `charts/`, `bigscreen/`, `friends/`, `deals/`, `command-palette/`, `hero/`, `weblinks/`, `mods/`, `emulators/`, `achievements/`, `ui/` (`Card`, `Button`, `Badge`, `KpiTile`, `MultiSelectDropdown`, `Skeleton`, `Tooltip`, `ConfirmModal`, `PageHeader`, `UpdateModal`), plus top-level `SteamStatsPopoverShell` used by the player-count popovers.
- **Contexts (`src/context/`)** — providers per cross-cutting concern: `GameContext` (library CRUD / launch; split into `context/game/*` hooks: `useLaunch`, `usePersistence`, `useSessions`, `useWatcherIndex`, `useEnrich`), `ActivityContext`, `AchievementContext` (multi-source), `WishlistContext`, `DownloadContext` (concurrent downloads + seeding + speed limits), `SourceContext` (download sources), `SplashContext`, `ToastContext`, `ThemeContext` (light/dark + accent family), `LanguageContext` (i18n), `DensityContext`, `SettingsContext` (incl. navbar tab order + Linux support level), `SessionNotesContext`, `SidebarCollapseContext`, `LibraryFilterContext`, `SteamGridDbContext` (batched SGDB art lookups), `CrackWatchContext` / `PriceContext` (batched lookups), `PresenceContext`, `UpdateContext`, `BigScreenContext`. `GameSelectorsContext` exists but is currently unreferenced.
- **Hooks (`src/hooks/`)** — extracted filters/store-cache/player-count/steam helpers (`useLibraryFilters`, `useStoreGames`, `useStoreCatalogue`, `useStoreCache`, `useProgressiveImages`, `useSteamGameStats`, `useSteamPlayerCount`, `useSteamPlayerHistory`, `useSteamAppId`, `useNewsFeeds`, `useWishlist`, `useHiddenGames`, `useFilterPresets`, `useDiscordPresence`, `useTrayNavigation`, `useTrayStrings`, `useFriends*`, `useGameMods`, `useDownloadCoverArt`, `useBandwidthHistory`, `useSizeUnit` / `useSpeedUnit`, `useViewDensity`, `useGameAccent`, `useGameBackdropArt`, `useGameUpdateCheck`, `useGamepad` + `useFocusable` (Big Screen), `useLibraryIndex`, `useRecentlyViewed`, `useAppVersion`, `useSourceAvailabilityCache`, …).
- **Types (`src/types/`)** — hand-written TypeScript types mirroring the Rust serde models: `game.ts`, `steam.ts`, `gog.ts`, `epic.ts`, `humble.ts`, `rockstar.ts`, `uplay.ts`, `source.ts`, `download.ts`, `deals.ts`, `plugins.ts`, `mods.ts`, `emulator.ts`, `steamgriddb.ts`.
- **Styles (`src/styles/`, `src/*.css`)** — co-located CSS files. `App.css` is a thin barrel of `@import`s that wires up the per-feature stylesheets in cascade order. All theme colors go through CSS custom properties: the base `:root` dark palette lives in `styles/theme.css`, alternate palettes (`[data-theme="light"]`, nord, cyberpunk, aurora, …) live in `styles/themes.css`, and a global **accent family** (`--accent*`) drives the game palette. **Never hardcode hex/rgb values** — use `var(--…)`. Page-specific styles are scoped to their page/container to avoid cross-surface regressions.

### Backend (`src-tauri/src/`)
- **Entry point:** `lib.rs::run()` — the header, module decls, plugin registration, and `generate_handler!` command registry. `main.rs` simply calls `gameindex_lib::run()`. The old 4700-line monolithic lib.rs was split into domain modules (no behavior change): `games.rs`, `emulation.rs`, `launcher.rs`, `media.rs`, `store.rs`, `sessions.rs`, `steam_stats.rs`, `system.rs`, `webview.rs`, `friends.rs`.
- **Modules:** `game_scraper`, `game_watcher` (WMI process polling + session lifecycle; Wine/Proton-aware on Linux), `steam_game_watcher`, `gpu_detector` (nvidia-smi / sysfs VRAM + selected-GPU monitoring), `mahm_reader` / `rtss_reader` (MSI Afterburner / RivaTuner shared memory for in-game FPS/frametime overlays), `metrics_collector` (MangoHud CSV + GameScope stats FIFO readers on Linux), `source_manager` (local FTS5 download index), `store_checker` (ownership), `downloads/` (see below), `achievements` + `local_achievements` + `achievement_watcher` + `manual_links` + `retro` (multi-source achievements), `crackwatch`, `deals` (Game Pass / ITAD / giveaways / playtesters), `price`, `protondb`, `size`, `config`, `tray`, `updater`, `system_screenshots`, `emulator_install`, `roms` (ROM identify/scrape/saves/launch plans), `mods/` (`detect.rs` + `nexus.rs`), `plugins/` (sandboxed JS search plugins), `steamgriddb` (art assets), `compatibility` (Proton/Wine — see below), `game_versions` (installed version detection), `backup` + `backup_raw` (NDJSON backup/restore), `discord_presence`.
- **Side binary:** `src-tauri/src/bin/` is currently **empty** — do not assume anything about it; list the directory first.
- **Per-store integrations (`src-tauri/src/steam/`, `gog/`, `epic/`, `humble/`, `rockstar/`, `uplay/`)** — each has `auth.rs` + `sync.rs` + `types.rs`:
  - **Steam** uses a pasted **Web API key** + SteamID64 (Phase 5 model — the OpenID/WebView flow is gone). `steam/launch_options.rs` reads launch options from Steam config for the `steam://launch/<appid>/dialog` picker; `steam/launch_config.rs` reads/writes Wine/Proton flags into `localconfig.vdf` `LaunchOptions` (backup once to `<name>.gameindex.bak`, atomic replace, tracked via kv `steam.launchOptions.applied.<appid>`).
  - **GOG** uses **OAuth2 WebView login + token exchange** — `gog_start_login` opens a WebView at `login.gog.com/auth?client_id=46899977096215655&layout=galaxy`, captures the auth `code` via an `on_navigation` callback (no JS probe), exchanges it at `auth.gog.com/token`, and persists tokens in the SQLite `kv_store` (NOT the keychain — `keyring`'s Windows backend silently fails on service names containing `/`). Sync builds a Bearer-authenticated client.
  - **Epic** uses OAuth via stored refresh tokens.
  - **Humble** — WebView login + purchases sync (`humble_get_settings` / `humble_save_settings`).
  - **Rockstar** — registry scan of installed games; no cloud auth; `rockstar_launch_game` launches the client.
  - **Uplay** — registry + product-cache scan; `uplay_launch_game` via `uplay://` protocol.
- **Downloads (`src-tauri/src/downloads/`)** — `manager.rs` orchestrates **concurrent downloads (no single-active queue)** across direct HTTP, debrid, torrent, and browser-resolver paths:
  - `http.rs` — direct HTTP/chunk downloader with resume.
  - `debrid.rs` — Real-Debrid / AllDebrid / TorBox cache lookup + unrestrict.
  - `torrent.rs` — `librqbit` (pinned to `9`, no HTTP API feature) torrent engine with seeding.
  - `browser_resolver.rs` — captures downloads initiated in the embedded browser; `extract.rs` (post-download extraction), `persistence.rs` (state + history), `hosters.rs`, `types.rs`. Download history is durable and independent of active-download cleanup.
- **SQLite storage layer (`src-tauri/src/db/`)** — see "Storage" section below.

### Cross-cutting UI
- **Launch flow:** `GameContext.launch(...)` → `invoke("launch_game", {...})` from Rust. Rust:
  1. Runs optional pre-launch script (with admin flag, elevation-prompt-aware) then spawns the exe (Windows: `ShellExecuteExW` with `runas` if `ERROR_ELEVATION_REQUIRED`, else `std::process::Command`); supports launch args, run-as-admin, companion apps, and the Steam launch-option picker.
  2. Registers a session with the shared `Arc<Mutex<GameWatcher>>` (from `state()`).
  3. Starts a metrics collection channel (`metrics_collector::start_metrics_collection`) keyed to the new PID + GPU.
  4. Background poller (`game_watcher::start_background_poll`, every 5s) detects exit via WMI on Windows (process-tree tracking for Wine/Proton on Linux) and writes one row to the `sessions` table before emitting the `game-exited` event. `steam_game_watcher` handles Steam-only games.
- **Session record per exit:** last_played bump + activity dashboard roll-up. Use `update_game_last_played` IPC, not `save_games`, for the hot path.
- **Steam `open` flow:** when a Steam title has no local exe (e.g., synced only), Rust opens `steam://run/<appid>` via the opener plugin and registers a pending session that the poller activates when the matching process appears.
- **Discord Rich Presence:** `discord_presence.rs` owns a background IPC thread (reconnect w/ retry); frontend emits `discord-presence-update` events ("playing"/"browsing"/"stopped") via `useDiscordPresence`; per-option toggles in the Discord settings tab.

## Storage (SQLite)

The original single `gamelib.db` was **split into per-domain database files** under `<app_data_dir>` (one `<name>.db` per logical domain, each with its own `r2d2` pool, WAL, and checkpoint cadence). A one-time `split_migrate.rs` copies any legacy `gamelib.db` into the domain files and renames the original to `gamelib.db.pre-split-<timestamp>` (never deletes it). The `compatibility` domain has its own migration (`migrate_compatibility_domain`, flag `compatibility_split_migrated`): it moves kv `compatibility.global_settings` into `compatibility_settings` and legacy `games.compatibility_json` into `game_compatibility`.

- **Pool:** `src-tauri/src/db/pool.rs` — `Db` holds one `r2d2_sqlite` pool per domain (`sources`, `games`, `sessions`, `download_history`, `wishlist`, `store_cache`, `achievements`, `kv`, `news`, `emulators`, `mods`, `plugins`, `compatibility`). PRAGMAs on every connection: WAL, `synchronous = NORMAL`, `foreign_keys = ON`. Sync calls are deliberately NOT wrapped in `spawn_blocking` (sub-millisecond local queries; the overhead exceeds the work).
- **Schema registry:** `src-tauri/src/db/schema.rs` defines `DOMAIN_SCHEMAS: &[DomainSchema]` — each entry is a domain label + an ordered list of `("vN", &ddl)` migrations. DDL lives in per-domain files (`schema_sources.sql`, `schema_games.sql` + `schema_games_v2..v10.sql`, `schema_sessions.sql`, `schema_download_history.sql`, `schema_wishlist.sql`, `schema_store_cache.sql`, `schema_achievements.sql` + `_v2`, `schema_kv.sql`, `schema_news.sql`, `schema_emulators.sql` + `_v2`, `schema_mods.sql` + `_v2`, `schema_plugins.sql` + `_v2`, `schema_compatibility.sql`). **Add new migrations by appending a `("vN", &ddl)` entry to the domain's slice — never renumber existing tuples.** The runner in `db::migrate.rs` applies each version in its own transaction inside `.setup`.
- **Games columns are extensive** (`schema_games.sql` + v2–v10): metadata (cover/icon/banner/logo, description, developer, publisher, release date, IGDB ids + `collection_id`, reviews, language supports, time-to-beat, similar games, releases, alternative names), launch orchestration (launch args, run-as-admin, pre/post-launch scripts + admin flags, companion apps JSON, `show_steam_launch_selection`, `igdb_id`), store linkage (Steam appid/playtime, Epic namespace, GOG id/playtime), emulation (`emulator_id`, `rom_path` + v7 ROM columns: `rom_hash`, `rom_region`, `rom_language`, `rom_group`, `rom_disc`, `rom_archived`, `favorite`, `compat_notes`, `rom_profile`), mods (`mods_folder`, `mods_size_bytes`), `version` (v8, detected install version), and `cover_source_url` (for Discord presence). Per-game compatibility profiles are NOT here — they live in `compatibility.db` (`game_compatibility.config_json`).
- **DAO pattern:** one file per table under `src-tauri/src/db/` (`games.rs`, `sessions.rs`, `sources.rs`, `wishlist.rs`, `store_cache.rs`, `achievements.rs`, `achievement_links.rs`, `news.rs`, `kv.rs`, `emulators.rs`, `mods.rs`, `plugins.rs`, `compatibility.rs`, `download_history.rs`, `artwork.rs` (disk-backed `artwork/<game-id>/` assets), `secrets.rs`, `legacy.rs`, `atomic.rs`, `migrate.rs`, `split_migrate.rs`, `pool.rs`, `schema.rs`, `mod.rs`) exposing `upsert_*`, `list_*`, helpers. Commands extract the DB pool via `app.state::<db::Db>().inner().clone()` — never wrap in `Arc`, the inner pool is already shared.
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
- **Crackwatch** — `crackwatch::fetch_crackwatch_status(game_name, app_id?)` scrapes gamestatus.info (24h KV cache keyed by slug+appid, `CrackWatchStatus { isCracked, crackDate, crackGroup, protection }` or `null`), plus a `_batch` variant. Rendered by `CrackWatchCard`. Titles are de-accented and matched via loose slug candidates (edition words, roman↔arabic numerals, `&`→`and`); games found on the site but not yet cracked return `isCracked: false`, which the card renders as an UNCRACKED badge.
- **Torrents** — `downloads/torrent.rs` wraps `librqbit` (see Cargo.toml — `librqbit 9`, `default-tls`, **no** `http-api`). Download throttled via `Session::ratelimits`; per-download file selection. Cleanup hook (`cleanup_extractions`) registered on the Tauri `RunEvent::Exit`.
- **Search plugins** — `plugins/` (`PluginManager` + QuickJS sandbox in `runtime.rs`): user-installed `.js` files adding torrent-search sources. Every plugin runs in a fresh sandbox with a 64 MB memory cap, an instruction budget (~20M instructions), a 20 s wall-clock timeout, and a scheme-checked `httpGet`/`httpGetJson`/`httpGetXml`/`httpGetAll` API + `definePlugin` manifest. Raw results cached per `(plugin_id, query)` for 15 min. `search_downloads` / `search_downloads_stream` merge built-in source results with every enabled plugin's results (0.2 match floor, newest-first). Plugin files live at `<app_data_dir>/plugins/<id>.js`; bundled plugins ship in the repo `plugins/` dir.

### Linux & Steam Deck compatibility
- **`compatibility.rs`** owns the entire Proton/Wine stack (runners, prefixes, GameScope, GPU pinning, logs); config persists in its own **`compatibility.db`** domain (`db/compatibility.rs` + `schema_compatibility.sql`: `compatibility_settings`, `game_compatibility`, `compatibility_runners`) — per-game profiles are no longer stored in `games.db` (schema_games_v9 is a no-op; legacy rows are migrated by `split_migrate.rs`).
- **Runner manager:** `detect_compatibility_runners` scans Steam libraries (`libraryfolders.vdf`), `compatibilitytools.d`, CachyOS `.vdf` manifests, Heroic/Lutris/user runner dirs, and system `wine`. Kinds: `proton | ge-proton | cachyos | wine | custom`. `fetch_available_runners` pulls release lists from GE-Proton, CachyOS, Proton-EM, Wine-GE, Kron4ek and Soda (GitHub API, 15 min cache); `install_compatibility_runner` streams into `.temp_downloads` with `runner-install-progress` events + `cancel_runner_install`; `install_runner_from_archive`, `delete_compatibility_runner`.
- **Wine prefix manager:** `list_wine_prefixes`, `create_wine_prefix` (`wineboot -u`), `delete/clear/duplicate_wine_prefix`, `open_prefix_directory`, `register_custom_prefix` / `unregister_custom_prefix`, `install_winetricks_verb`, `run_wine_tool` (winecfg, regedit, control, taskmgr, cmd, winetricks, kill, custom). Prefix resolution precedence: per-game `customWinePrefix`/`winePrefix` → global `defaultPrefix` → `defaultPrefixBaseDir/<game_id>` → `~/.local/share/GameIndex/wineprefixes/<game_id>`. Steam titles default to `steamapps/compatdata/<appid>/pfx` unless a custom prefix is set.
- **Launch chain (`launcher.rs` + `launch_with_compatibility`):** `[gamescope args --] [gamemoderun] [mangohud] [umu-run | runner run] [explorer.exe /desktop=GameIndex,WxH] <exe>`. `umu-run` is used for Proton runners when `enableUmuLauncher` is on (`GAMEID`, `STORE=none`, `PROTONPATH`). Env flags cover DXVK/VKD3D, esync/fsync/ntsync, DXVK-NVAPI/async, Wayland, WoW64, large-address-aware, `WINEDEBUG`, audio driver, DXVK HUD, controller (`PROTON_PREFER_SDL`) and anti-cheat (`PROTON_EAC_RUNTIME` / `PROTON_BATTLEYE_RUNTIME`, installable via `install_anticheat_runtimes`), plus global/per-game env vars and DLL overrides (with per-game exclusion lists).
- **GPU pinning:** `GpuSelection` → `MESA_VK_DEVICE_SELECT`, `VK_LOADER_DEVICE_SELECT`, `DXVK_FILTER_DEVICE_UUID`, `ENABLE_DEVICE_CHOOSER_LAYER` / `VULKAN_DEVICE_INDEX`, `DRI_PRIME`, and NVIDIA PRIME-offload vars. Per-game `useSpecificGpu` tri-state overrides global `use_specific_gpu`; configured in `HardwareTab.tsx` and the per-game compatibility tab.
- **GameScope:** geometry (`-f/-b`, `-w/-h`, `-W/-H`), FSR sharpness, FPS limit, refresh rate, HDR, adaptive sync, stretch, force-windows-fullscreen, custom args, and a stats FIFO (`ensure_gamescope_stats_fifo`) that `metrics_collector::read_gamescope_stats_fps` tails for Linux FPS. MangoHud logs land in `$XDG_DATA_HOME/MangoHud` and are read by `read_mangohud_fps`.
- **Wine/Proton logs:** direct launches write `<app_data_dir>/wine_logs/<game_id>.log`; Steam-owned launches write `<game_id>/steam-<appid>.log` via `PROTON_LOG=1` + `PROTON_LOG_DIR` (folder wiped per launch). `get_game_wine_logs` / `clear_game_wine_logs` back `WineLogsModal.tsx` (verbose selector). Steam-launched Wine/Proton flags are merged into `localconfig.vdf` `LaunchOptions` by `steam/launch_config.rs` (skips while Steam runs, one-time `<name>.gameindex.bak`, atomic write, kv-tracked so disabling settings removes stale flags); `steam_launch_env()` only sets env-safe keys and never `WINEPREFIX`/`PROTONPATH`.
- **UI/gating:** global `CompatibilityTab.tsx` (subtabs runners, prefixes, graphics, sync engine, gamescope, tools, env/DLL, maintenance) and the per-game `EditGameModal` "compatibility" tab render only when `showFullLinuxUi`; `LinuxSupportLevel = disabled | deck_verified | full` lives in `SettingsContext` (localStorage `gamelib.linux_support_level`). Rust `#[cfg(target_os = "linux")]` blocks cover Steam-via-compat routing plus MangoHud/GameScope; umu resolution returns `None` off-Linux and the rest compiles cross-platform.

### Game versions & update detection
- `game_versions.rs` exposes `detect_game_version(GameVersionQuery)` and `get_exe_file_version(path)`. Detection order: GOG `goggame-*.info` → Windows PE version resource → Steam `appmanifest_*.acf` buildid → Epic `*.item` (`AppVersionString`, 60 s cache) → folder manifests (`version.txt`, `build.info`, `version.json`/`build.json`, `package.json`) → exe scan (bypassing launcher stubs). The result lands in the `games.version` column (schema_games_v8).
- Frontend: `useGameUpdateCheck.ts` + `utils/gameVersions.ts` derive update badges in `GameLaunchActions`, `DownloadButton` and the download modal.

### Backup & restore
- `backup.rs` exposes `backup_get_status`, `backup_inspect`, `backup_create`, `backup_restore` and emits `backup-progress`. The current archive is the raw **NDJSON v2 `.gibak`** format (`backup_raw.rs`, magic `gameindex-raw-backup`): one NDJSON file per domain plus `artwork/` and `plugins/`, with `replace` and `merge` restore modes. `BACKUP_DOMAINS` includes `compatibility` (settings, per-game profiles, installed runner records — config only; prefixes/logs on disk are not archived). Legacy v1 binary archives remain restorable. UI: `BackupTab.tsx` + `BackupProgressModal.tsx`.

### Emulators & ROMs Management
- `EmulatorsPage` (`src/pages/EmulatorsPage.tsx`) manages retro/multi-system emulator platforms, launcher executable paths, and ROM catalogues. Supports manual ROM creation, file size tracking, bulk ROM actions (rename, delete), real platform logo SVG rendering, and Storage page disk usage breakdown. Configured via `EmulatorEditorModal.tsx`; downloadable emulator catalog + install pipeline via `emulator_install.rs` + `DownloadEmulatorModal`.

### Mod Manager (Steam Workshop & Nexus Mods)
- `ModsPage` (`src/pages/mods/ModsPage.tsx`) provides a dual-pane interface with glassmorphism styling, stat cards, and status filtering. Engine-aware mod detection (`mods/detect.rs`), Steam Workshop fetching enriched with Steam Web API metadata, Nexus Mods integration (API key, domain mapping, update checks — `mods/nexus.rs`), load-order reorder, conflict detection. Bulk multi-select actions (enable, disable, delete) and mod storage footprint tracking.

### Internationalization (i18n)
- `LanguageContext` (`src/context/LanguageContext.tsx`) provides app-wide translation using structured JSON locale dictionaries: **en, de, fr, es, ru, zh-CN** (`src/i18n/*.ts`). Components consume `useTranslation()` / `t(key)` with fallback support; `npm run audit:i18n` checks key parity. Settings page language selector + OS-language auto-detect.

### Big Screen Mode
- **`BigScreenContext`** (`src/context/BigScreenContext.tsx`) toggles a 10-foot TV UI with rail-aware gamepad navigation (`GamepadProvider` + `useFocusable`). **Big Screen v3** (`src/bigscreen/registry.tsx`): `PRIMARY_SECTIONS` (home, library, store, wishlist, deals, news, friends, community) + `SYSTEM_SECTIONS` hub (downloads, storage, achievements, mods, emulators, settings, docs); `ShellSwitch` renders the controller-first variant per route when active. Each bigscreen view is its own lazy chunk (manualChunks keeps the desktop bundle free of bigscreen code). Persisted under `gamelib-bigscreen`.
- **Animated backdrops:** `useGameBackdropArt.ts` picks art in priority order (SteamGridDB hero → banner → Steam `library_hero.jpg` → cover) and exposes an optional animated APNG/WebP layer; `BigScreenDashboardBackdrop.tsx` cross-fades between consecutive dashboards while `BigScreenHeroBackground.tsx` walks video → animated → Ken-Burns cycle → single-shot → banner → cover.
- **Fluid navigation & focus memory:** `useGamepad.navigate()` is shared by the rAF gamepad loop and keyboard arrows; horizontal focus stays inside rail tracks (`[data-rail-id]`) which wrap end-to-start, grid rows wrap to adjacent rows, and hold-to-repeat is tuned in `gamepadUtils.ts`. `utils/focusMemory.ts` remembers the focused card per route (`data-focus-key` / `game:<id>@<rail>`) and restores it on return via a `bigscreen:focus-game` event so rails scroll the card back into view.
- **Fullscreen geometry:** entering Big Screen captures a window snapshot (maximized, inner size, outer position) and restores it on exit — including when the Web Fullscreen fallback was used. Requires the `core:window:allow-set-fullscreen` capability.

### Storefront Engine
- **Storefront Catalog**: Powered by **IGDB** for catalogue browsing, featured rails, tokenized fuzzy search with dedup, genre/platform filtering, and game detail metadata (`store.rs`, `store_checker.rs` for Steam/Epic ownership). Store game detail has a News tab and per-section show/hide toggles. Steam metadata enrichment (`fetch_steam_user_tags`, `fetch_steam_genres_and_tags`, `fetch_steam_features`) feeds `SteamFeaturesCard` and the genre/tag filters (`genreTags.ts`, `MultiSelectDropdown`), and `games.collection_id` powers `GameRelationsCard`.
- `CrackWatchContext`/`PriceContext` batch per-card lookups into single backend round-trips (`fetch_crackwatch_status_batch`, `fetch_price_batch`).
- **Compare mode:** `storeCompare.ts` is a framework-free store (max 4 games, sessionStorage `gamelib_store_compare_v1`) that computes best-value `bestIndexes` and shared `sharedValues`; `StoreCompareTray` + `StoreCompareModal` render it, with a `store-page--docked` class to work around the WebKitGTK `transform` containing-block quirk.
- **Hover performance:** `storeCardHover.ts` is a module-level external store read via `useSyncExternalStore` (150 ms release debounce to bridge grid gutters) so hovering a card pauses `StoreFeaturedHero` motion without re-rendering the whole store; cards also defer animated previews by 140 ms as hover intent.

### Friends & Community
- `FriendsPage` (`/friends`) + `CommunityPage` (`/community`) are social surfaces backed by a Rust friends module (`friends.rs` — nostr-based presence, sync, DMs with read receipts) + `useFriends*` hooks and `friendsStorage.ts` / `communityStorage.ts`. Not in the original roadmap — treat as experimental/self-contained.

### Virtualized library grid
- `LibraryPage` renders large lists via `src/components/library/LibraryVirtualGrid.tsx` (windowed rendering with a `ResizeObserver` on both the scroll container and its wrapper) rather than `react-window`. Long lists stay responsive without an external virtualization dep.

## Style & UI conventions

- **Dark-first** — `:root` declares the dark palette; `[data-theme="light"]` overrides. `ThemeProvider` toggles `data-theme` on `<html>`. A global accent family (`--accent*`) drives the game palette across all themes.
- **Iconography** — `lucide-react` (tree-shakable) for app chrome/navigation icons; inline SVG is still fine for brand marks and one-off glyphs (bigscreen section icons are inline). Components live next to their consumers in `src/components/<area>/`. Keep imports selective so unused icons are not bundled.
- **Modals & overlays** — `<Splashscreen />` overlays at z-index 9500; modal components use fixed positioning. Render nothing when idle (don't mount empty shells).
- **Cards / KPIs** — reuse `src/components/ui/Card.tsx`, `KpiTile.tsx`, `Badge.tsx`, `Skeleton.tsx`, `Tooltip.tsx`, `ConfirmModal.tsx` for consistency.
- **Responsive tiers** — `styles/theme.css` defines desktop, handheld/Deck (`max-width: 1280px, max-height: 800px`), short-viewport (`max-height: 720px` / `620px`), 2K and 4K/ultrawide tiers. Page grids use `repeat(auto-fit, minmax(…))`, toolbars wrap, fixed-height heroes use `clamp()`, and hover-only actions get `@media (hover: none)` fallbacks. Pages run full-width — there is no `--content-max-width` cap anymore. The sidebar auto-folds to the icon rail below 1100px via `SidebarCollapseContext`.

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

- **Windows-only paths:** `game_watcher` (WMI branch), `gpu_detector`, `metrics_collector` use `WMI` + `Win32` APIs (`wmi`, `windows 0.58` crate). On non-Windows the process scanner falls back to a Linux implementation that tracks Wine/Proton child processes; elevation (`runas`) is Windows-only, so `runAsAdmin: true` is a no-op error on macOS/Linux. Linux compatibility support **is implemented** now — `plans/Linux.md` is kept as a historical design doc, not a spec of future work.
- **Linux WebKitGTK rendering:** `__NV_DISABLE_EXPLICIT_SYNC=1` is auto-set unconditionally in `src-tauri/src/main.rs` (an NVIDIA-driver-only var — a no-op on AMD/Intel; fixes torn frames / black rects on NVIDIA+Wayland at the cost of serialized buffer sync). `WEBKIT_DISABLE_DMABUF_RENDERER` is NOT auto-set — it drops the DMA-BUF zero-copy path, and users who hit the NVIDIA black-webview bug on Wayland export it themselves (a user-exported env var always wins; `WEBKIT_DISABLE_COMPOSITING_MODE` / `__GL_THREADED_OPTIMIZATIONS` were already user-only). `GDK_BACKEND=wayland,x11` stays unconditional. The frontend mirrors this with `data-platform` on `<html>` (set by `SettingsContext`) + `styles/platform-linux.css`, which drops `backdrop-filter` from full-window/full-screen/sticky/large surfaces on Linux — WebKitGTK renders backdrop blur far slower than WebView2/Chromium (small pills/badges keep their blur).
- **Steam auth:** pasted **Web API key** + SteamID64, not OpenID. The WebView + RSA finalize flow is gone.
- **GOG auth:** OAuth2 WebView + token exchange; **tokens in `kv_store`, not the keychain** — `keyring`'s Windows backend (`CredWriteW`) silently fails to persist when the service name contains a slash (`gamelib/gamelib-app`).
- **`librqbit` major pin:** Don't bump `librqbit` to anything below `9` (8.x is EOL upstream; 9.x reworked `SessionOptions` — `listen`/`connect`/`dht` replace the old flat fields, and 7.0.1 has a broken dep graph that fails to compile). Feature flags: `default-tls` on, `http-api` **off** (avoids pulling axum + serde_html_form).
- **rustls vs openssl:** `keyring 3` defaults to `crypto-rust`, deliberately avoiding the openssl-sys transitive dep. The plugin HTTP client also opts into `rustls` explicitly (Cloudflare-fronted hosts fingerprint Schannel and 403 it).
- **Plugin sandbox:** a malicious plugin can at worst stall its own `spawn_blocking` thread until the 20 s timeout — it cannot hang the app, read files, or touch the network outside the scheme-checked `httpGet` proxy. The QuickJS `Function` values are `!Send`, so plugins are re-evaluated per search (source text is kept, not the JS function).
- **Player-count caching:** live cache 60s per-appid, history cap 1,440 samples, 5s multi-banner dedupe. Only the Steam game-stats cache (`SteamGameStatsCache`) carries a 5 min negative cache — the player-count cache itself does not.
- **Linux compatibility launch path:** `launcher.rs` routes Steam titles through `launch_with_compatibility` only under `#[cfg(target_os = "linux")]`; off-Linux the wrapped path still works for custom runners (`find_umu_run()` returns `None`, MangoHud/GameScope/anti-cheat helpers are inert). Compatibility is gated in the UI by `showFullLinuxUi` (`isLinuxHost || linuxSupportLevel === "full"`); the `compatibility` settings tab and per-game tab fall back to details when gated.
- **Steam `LaunchOptions` edits:** `steam/launch_config.rs` merges Wine/Proton flags into `localconfig.vdf` only while the Steam client is stopped, writes a one-time `<name>.gameindex.bak`, replaces atomically, and remembers what it applied via the kv key `steam.launchOptions.applied.<appid>` so disabling settings removes exactly the flags it added — never clobbering user-typed launch options. `steam_launch_env()` must never export `WINEPREFIX`/`PROTONPATH`/`STEAM_COMPAT_DATA_PATH` (Steam manages those itself).
- **Cross-window UI prefs:** sidebar rail/width (`SidebarCollapseContext`), navbar tab order (`SettingsContext`) and Big Screen state persist in `localStorage` and sync across windows via the `storage` event; new nav pages must be added to `DEFAULT_NAVBAR_TAB_ORDER` (and `normalizeNavbarTabOrder` appends unknown keys on read).
- **Store hover state:** `storeCardHover.ts` is a module-level external store (read with `useSyncExternalStore`) — mutate it via `setStoreCardHover`, never through React state in `StorePage`, or hovering a card re-renders the entire store. The leave is debounced 150 ms to bridge grid gutters.
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
  pages/settings/          Settings tabs + settingsCatalog.tsx + CompatibilityTab.tsx
  components/<area>/       Feature-area components
  context/                 Providers (Game, Activity, Source, ...) + context/game/* hooks
  hooks/                   Reusable stateful helpers
  types/                   Mirror the Rust serde models
  utils/                   focusMemory (Big Screen), gameVersions, genreTags, adaptiveTheme
  i18n/                    Locale dictionaries (en, de, fr, es, ru, zh-CN)
  styles/                  Per-feature themed CSS
  *.css                    Layout / store / library base styles

src-tauri/
  src/lib.rs               Tauri command registry + setup hook (slim after module split)
  src/main.rs              Trivial entry
  src/games|launcher|media|store|sessions|steam_stats|system|emulation|webview|friends.rs
                           Domain modules split out of the old monolithic lib.rs
  src/compatibility.rs     Proton/Wine runners, prefixes, GameScope, GPU pinning, logs
  src/game_versions.rs     Installed version detection (GOG/Epic/Steam/PE/manifests)
  src/backup.rs|backup_raw.rs
                           NDJSON v2 backup/restore (+ progress events)
  src/db/                  Per-domain SQLite pools + DOMAIN_SCHEMAS + DAOs (+ split_migrate.rs)
  src/steam|gog|epic|humble|rockstar|uplay/
                           Per-store auth + sync + types (steam/launch_config.rs edits localconfig.vdf)
  src/downloads/           manager.rs, http.rs, debrid.rs, torrent.rs, browser_resolver.rs, ...
  src/plugins/             Sandboxed JS search plugins (PluginManager + QuickJS runtime)
  src/roms.rs              ROM identify/scrape/saves/launch plans
  src/steamgriddb.rs       SteamGridDB art asset commands
  src/game_watcher.rs      WMI/Linux process polling + session lifecycle
  src/game_scraper.rs      IGDB + LaunchBox + Steam reviews metadata fetch
  src/achievements.rs      Multi-source achievement sync + cache
  src/tray.rs              System tray + menu + live status
  src/discord_presence.rs  Discord Rich Presence IPC thread
  tauri.conf.json          Frameless window + bundle config
  Cargo.toml               Pinned major versions for librqbit/keyring/rusqlite

plugins/                   Bundled sandboxed search plugins
plans/                     Design docs (past specs; Linux.md kept for history)
.github/workflows/         ci.yml (typecheck/lint/test/build) + release.yml (Win + Linux matrix)
flake.nix                  Nix dev shell (see README)
```
