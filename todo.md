# GameIndex — Project Roadmap & TODO

---

## 🏗️ Project Foundations

### 1. Find a Good Name — ✅ Resolved: **GameIndex**
- The project codename "GameLib" has been replaced with **GameIndex**.
- `package.json` name, Tauri `productName` / `identifier`, and the window title are all updated to `GameIndex` / `com.gameindex.app`.
- Remaining internal identifiers (SQLite DB files, `localStorage` key prefixes like `gamelib-*`) are intentionally kept for backward compatibility.

### 2. Write a Complete README — ✅ Done
- Comprehensive `README.md` covering:
  - **App name + tagline** (once #1 is done).
  - **Screenshots** (dark + light mode, key pages: library, game page, activity, store).
  - **Features** list with badges (platforms, tech stack: Tauri + React + Rust + TypeScript).
  - **Installation**: Windows installer, macOS `.dmg`, Linux AppImage/Flatpak.
  - **Development setup**: prerequisites (Rust, Node.js), `npm install`, `npm run tauri dev`.
  - **Project structure** overview (frontend `src/`, backend `src-tauri/`).
  - **Contributing guide**: coding conventions (from `knowledge.md`), PR process.
  - **License** (MIT recommended).
  - **Acknowledgments**: libraries used (Tauri, React, Recharts, etc.).

---

## 🔧 Immediate / Fixes

### 3. Fix Game Icon Fetching — ✅ Done
- Game icons for imported executables/batch files and store/metadata imports now resolve through the IGDB metadata pipeline (`icon_url`, `banner_url`, `logo_url` columns on the `games` table).
- Frontend surfaces have consistent letter / gradient placeholder fallbacks (`GameFallbackIcon`, `GameThumbnail`, cover placeholders) when a URL is missing or fails to load.
- No separate icon cache dir needed — icons are persisted as URLs in SQLite.

### 4. Fix Activity Page UI Inconsistencies — ✅ Done
- The Activity sub-components (Dashboard, Gantt, Performance, Sessions, Sparkline) may have styling mismatches — check for:
  - Hardcoded colors instead of CSS custom properties (theme breakage in light mode).
  - Spacing/padding drift between tabs.
  - Chart labels overflowing on narrow sidebar states.
  - Scroll behavior inside the activity panel not matching the rest of the app.
- Ensure all activity charts (`BarChart`, `DonutChart`, `LineChart`) inherit theme variables consistently.

### 5. Import Modal: Rename, Metadata & Image Fetch — ✅ Done
- When adding a single `.exe` or `.bat` file, show a **new modal** after file selection that lets the user:
  - **Rename** the game (title field, editable, pre-filled with file stem).
  - **Search & fetch metadata** from LaunchBox Games DB / IGDB / SteamGridDB:
    - Cover art / banner.
    - Developer, publisher, release date, genre tags.
    - Description / summary.
  - Show a **preview card** with the fetched data before confirming the import.
  - Show a progress indicator while scraping runs.
- The existing `ImportModal.tsx` handles batch imports — this new single-game modal complements it.

---

## 📰 News & Discovery

### 6. News Tab: Xbox Game Pass + IsThereAnyDeal — ✅ Done
- Add a **News tab** to the main navigation (TopNav).
- Integrate two sub-sections:
  - **Xbox Game Pass**: latest additions, leaving-soon titles, upcoming day-one releases. Scrape or use an unofficial RSS/API.
  - **IsThereAnyDeal**: current deals across stores (Steam, GOG, Epic, Humble, Fanatical, Green Man Gaming). Show price, discount %, store, and a link.
- Each section should have its own card grid with filtering (platform, discount threshold).

### 7. RSS News Page — ✅ Done
- Add an RSS reader page (or tab within News) where users can subscribe to gaming news feeds.
- Store feed URLs locally (IndexedDB or a JSON config file).
- Provide default curated feeds: PC Gamer, Rock Paper Shotgun, Eurogamer, Gematsu, GamingOnLinux.
- Display articles in a scrollable card layout with title, date, source, and expandable summary.
- Open full article in the user's default browser (Tauri shell open).
- **Extended:** regional feeds + curated feed packs (`b7f1472`).

---

## 🎮 Game Page Enhancements

### 8. Game Page Media (Screenshots, Trailers, Videos) — ✅ Done
- Add a **Media** section/tab to the game page:
  - **Screenshots gallery**: grid of thumbnails, click to open lightbox/fullscreen viewer with navigation arrows.
  - **Trailers / gameplay videos**: embedded HTML5 video player with play/pause/volume/seek controls (`hls.js` for HLS streams).
  - Pull media from IGDB, SteamGridDB, or YouTube API (search for official trailers).
  - Lazy-load thumbnails for performance.
  - Support drag-and-drop to add custom screenshots (store locally in game folder).

### 9. Game Descriptions / Summary — ✅ Done
- Add a rich **Description** section to the game page Overview tab:
  - Pull description/summary text from IGDB, Steam, or LaunchBox DB.
  - Support Markdown or basic HTML rendering (bold, italics, bullet lists).
  - Truncated view with "Read more" expand/collapse.
  - Show source attribution (e.g. "via Steam" or "via IGDB").

### 10. Steam Reviews + Multi-Site Review Aggregation — ✅ Done
- In the game page's **Reviews** tab, add:
  - **Steam reviews** summary card: overall rating (Very Positive / Mixed / etc.), review count, recent review trend.
  - **Multi-site aggregation**: pull scores from Metacritic, OpenCritic, IGDB, HowLongToBeat.
  - Display each source with its logo/icon, numeric score, and a color-coded badge.
- Backend: add a Rust scraper/API caller that fetches review metadata for a given game title.

### 11. Overview Tab — Additional Info Cards — ✅ Done
- Add compact, glanceable cards to the game page **Overview** tab:
  - **Crackwatch** status (cracked / uncracked / denuvo) — scrape gamestatus.info (24h KV cache, batch endpoint).
  - **Ratings panel**: Metacritic critic + user scores, OpenCritic score, IGDB rating.
  - **Languages supported**: audio + subtitles, pulled from Steam / IGDB metadata.
  - **ProtonDB** badge: native / platinum / gold / silver / bronze / borked, with a link to the ProtonDB page (`protondb.rs`).
  - **System requirements**: minimum & recommended (CPU, GPU, RAM, storage).
  - **Release date + developer + publisher** card.

### 12. Achievements Tab — ✅ Done (multi-source)
- Add an **Achievements** tab to the game page, now backed by **five sources**:
  - **Steam** — Web API (requires user API key in settings).
  - **GOG** — `gog_fetch_achievements` via the OAuth client.
  - **Epic** — `epic_fetch_achievements` GraphQL.
  - **RetroAchievements** — console mapping + per-game link override (`retro.rs`).
  - **Manual links** — link any game to a public Steam appid and track unlocks by hand (`manual_links.rs`).
  - **Local files** — crack/emulator achievement files watched on disk (`achievement_watcher.rs` + `local_achievements.rs`).
- Show a progress bar (% completion), rarity indicators, source badges, and last-unlocked date.

### 13. HowLongToBeat Card — ✅ Done
- In the game page **Overview** tab, add a detailed **HowLongToBeat** card showing:
  - Main story time.
  - Main + extras time.
  - Completionist time.
  - All playstyles combined average.
- Display as horizontal bar chart with human-readable labels.
- Pull data from HowLongToBeat scraping or community-maintained dataset.

### 14. Hero Image: Live Steam Player Count — ✅ Done
- In the game page's hero/banner area, overlay a **live Steam player count** badge.
- Fetch from Steam Web API (`GetNumberOfCurrentPlayers`, no key needed), cached 60s per-appid.
- Show current players, 24h peak, and a tiny sparkline (steamcharts.com feed, 6h TTL).
- Update every 60 seconds when the game page is active.

### 15. Web Links with Page Preview — ✅ Done
- In the game page, add a **Web Links** section (or tab):
  - Show curated links: official website, wiki, subreddit, PCGamingWiki, Steam Community, Discord.
  - On hover/click, show an **in-app native WebView preview** (`webview.rs`: `create_preview_webview`, `webview_eval`, history navigation).
  - Users can add custom links with a label and URL; Steam-sourced section links are auto-populated.
  - Store links per game in the game's metadata (SQLite).

---

## 🛍️ Store & Library Management

### 16. Store Page — Browse & Download — ✅ Done
- Build a full **Store** page that lets users browse a large game catalog (IGDB-backed).
- Features:
  - Search with tokenized fuzzy matching + dedup, autocomplete, URL sync.
  - Filters: genre, platform, release year, rating, price range.
  - Sort: popularity, rating, release date, title.
  - Game detail cards with cover art, rating, platforms, and a "Download"/"Get" button (links to store pages).
  - Wishlist / watchlist integration; ownership badges via `store_checker` (Steam / Epic owned).
  - Store game detail page includes a **News tab** (`b2b6872`) and per-section show/hide toggles.
- Note: "download" means opening the store link in the user's browser unless an official DRM-free source is available.

### 17. Multi-Store Import & Sync — ✅ Done
- Import game libraries from external platforms:
  - **Steam**: `steamapps/common` folder + `libraryfolders.vdf` + Web API metadata; removes games from the library on Steam uninstall.
  - **Epic Games**: OAuth (refresh tokens in keychain) + catalog manifest sync.
  - **GOG**: OAuth2 WebView login + token exchange (`auth.gog.com/token`), Bearer client sync.
  - **Humble Bundle**: WebView login + purchases sync (`humble/`).
  - **Rockstar Games Launcher**: registry scan of installed games, no cloud auth (`rockstar/`).
  - **Ubisoft Connect (Uplay)**: registry + product-cache scan, `uplay://` client launch (`uplay/`).
- **Sync**: periodically re-scan for new games installed via these launchers.
- Deduplicate games that appear in multiple launchers (link them under one entry).
- Show launcher badge icons next to each game in the library.

### 18. Per-Game Options / Context Menu — ⚠️ Partial (launch options done)
- Right-click context menu (or settings gear) on any game in the sidebar/game page:
  - **Game-specific launch options** — ✅ done: command-line arguments, run-as-admin, **pre-launch / post-exit scripts** (`pre_launch_script`, `post_exit_script`, admin variants), **companion apps** (launch alongside, with args + delay), and a **Steam launch-option picker** (`steam://launch/<appid>/dialog` via `steam/launch_options.rs`).
  - **Override metadata**: manually set cover art, title, genre, rating — ✅ done (`EditGameModal`).
  - **Hide / archive game**: soft-delete from library without removing files — ✅ done (hidden games).
  - **Compatibility settings**: force Proton/Wine version (for future Linux support), DXVK toggle, FSR toggle — ❌ (Linux plan only, see `plans/Linux.md`).
  - **Environment variables** per game — ❌ not yet.
  - **Performance profile** (Windows power plan, RTSS OSD preset) — ❌ not yet.
  - **Tags & collections** — ❌ (library filter presets exist, but no per-game user tags).

### 19. Game Manager Tab — ✅ Done
- New **Game Manager** tab in the main layout (alongside Library, Store, etc.).
- Features:
  - **Storage overview**: total space used, per-drive breakdown, largest games.
  - **Move game**: relocate install folder to another drive, with progress bar.
  - **Verify / repair**: checksum-based integrity check against known manifests (Steam, GOG).
  - **Uninstall**: full cleanup including leftover folders, registry entries (Windows), and shortcuts.
  - **Backup**: compress and archive game folder to external drive / NAS.
  - **Batch operations**: select multiple games for move/uninstall/backup.

---

## 📊 Tabs & Panels

### 20. Deals Tab — ✅ Done
- A dedicated **Deals** tab in the main navigation (`src/pages/deals/DealsPage`).
- Shows real-time deals from IsThereAnyDeal, Steam sales, GOG sales, Epic freebies.
- Filters: store, discount %, price, DRM-free only.
- "Price history" mini-chart per game (from ITAD data).
- Notification option: alert when a wishlisted game drops below a configurable price threshold.
- **Extended:** Game Pass catalog panel, giveaways panel, playtester games panel.

### 21. Downloads Tab — ✅ Done
- A **Downloads** tab showing:
  - Active downloads with progress bars, speed (MB/s), ETA — **downloads run concurrently** (no queue; the old single-active-slot engine was replaced).
  - Download history (completed, failed, cancelled) — persisted in a dedicated `download_history` table that survives record deletion.
  - Source: torrent (`librqbit`), HTTP direct, debrid (Real-Debrid / AllDebrid / TorBox), browser-resolver captures.
  - Pause / resume / cancel controls, file-selection for multi-file torrents.
  - Bandwidth limiter (global setting) + seed config (seed-after-complete, disable upload).
  - Download modal supporting direct links, torrents and magnets (`c218dfa`).
  - Cover-art resolution for download rows.

### 22. Statistics Tab — ✅ Done
- A **Statistics** tab with personal gaming analytics:
  - **Playtime**: total hours, per-game breakdown, per-week trend, daily average.
  - **Genre distribution**: donut chart of playtime by genre.
  - **Platform distribution**: pie chart of games by platform.
  - **Achievements**: total unlocked, rarest achievements, completion rate.
  - **Session history**: longest session, average session length, most active time of day.
  - **Year in review**: annual summary card (Spotify Wrapped style).
  - Export stats as JSON/CSV.

### 23. Watchlist Tab — ✅ Done
- A **Watchlist** tab where users can save games they're interested in but don't own yet.
- Add games from the Store page, news articles, or deals.
- Show current lowest price, price alert threshold (configurable).
- Sort by: added date, price, release date, title.
- Quick actions: "View in Store", "Set price alert", "Remove".

---

## 🌍 Cross-Cutting

### 24. Translations / i18n — ✅ Done
- Full internationalization (i18n) support built into the app via `LanguageContext`.
- Locales: **en, de, fr, es, ru, zh-CN** (structured JSON dictionaries under `src/i18n/`).
- Auto-detect OS language on launch with runtime language selector in Settings.
- Replaced hardcoded UI strings with dynamic `t()` lookups across pages (audited by `npm run audit:i18n`).

### 25. Performance Optimizations — ⚠️ Partial (code-splitting + virtualization done)
- **Frontend:**
  - ✅ **Code splitting**: every page is `React.lazy` in `src/bigscreen/registry.tsx`; Vite `manualChunks` splits vendor / react / tauri / router / hls / nostr / qrcode / html2canvas; `modulePreload` defers the heavy on-demand chunks.
  - ✅ Virtualized library grid (local `VirtualGrid` in `LibraryPage.tsx`) + lazy bigscreen chunks.
  - ✅ Memoized components, debounced search/filter inputs.
  - ⏳ No `react-window` elsewhere (custom `VirtualGrid` covers the library).
  - ⏳ Recharts re-render tuning on Activity page not fully revisited.
- **Backend (Rust):**
  - ⏳ Parallelize game scanning with `rayon` or `tokio::spawn`.
  - ✅ Scraped metadata cached in SQLite (store cache, player-count caches, Crackwatch KV, plugin result cache).
  - ⏳ Stream large file operations instead of loading into memory.
- Measure: use Lighthouse, Chrome DevTools Performance tab, and Rust `perf`/`flamegraph`.

---

## 🕹️ Additional Features & Overhauls (Completed)

### 29. Emulators & ROM Management Page — ✅ Done
- Dedicated **Emulators tab** positioned in the main navigation.
- Multi-system platform catalog with real emulator logos & GitHub repository links.
- Direct executable launch for configured emulators; **downloadable emulator catalog + install pipeline** (`emulator_install.rs`).
- Complete ROM management: manual add, rename, delete, file size metadata, and bulk ROM operations.
- Per-emulator detail view and Storage page integration for emulator disk footprint tracking.

### 30. Mod Manager (Steam Workshop & Nexus Mods) — ✅ Done
- Dedicated **Mods tab** with glassmorphism UI, stat cards, and status filters.
- Engine-aware mod detection and dual-pane manager for installed mods (`mods/detect.rs`).
- Steam Workshop integration enriched with Steam Web API metadata; **Nexus Mods integration** (API key, domain mapping, update checks — `mods/nexus.rs`).
- Bulk multi-select actions: enable, disable, delete mods in batch; load-order reorder; conflict detection.
- Storage page integration: track total mod footprint and sort mods by disk usage.

### 31. Downloads Engine Rewrite — ✅ Done
- Rewritten download manager: **concurrent downloads (no queue)** — every download runs independently (`downloads/manager.rs`).
- Torrents on `librqbit` 9 (pinned) with seeding support and per-download file selection.
- Unified pipeline supporting direct HTTP downloads, debrid services (Real-Debrid / AllDebrid / TorBox), torrents, and a **browser resolver** that captures in-browser downloads (`downloads/browser_resolver.rs`).
- Download history persisted across restarts (`download_history` table).

### 32. Settings — Privacy, Launcher, Discord, Plugins, Hardware — ✅ Done
- Settings page is a catalog-driven multi-tab surface (`settingsCatalog.tsx` is the single source of truth for tabs, sidebar groups, jump bar and search):
  - **General** — language, updates, gamepad.
  - **Appearance** — themes, accent family, interface (Simple/Complete + density), detail-section show/hide toggles, motion, UI sound.
  - **Hardware** — detected GPU/CPU/RAM, telemetry sampling, display units.
  - **Integrations** — Steam, Epic, GOG, Humble, Rockstar, Uplay + data-sync + RetroAchievements.
  - **Discord** — Rich Presence master toggle + per-option (cover art, playtime, browsing status) toggles.
  - **Downloads** — save path, notifications, bandwidth, blocked domains, debrid config.
  - **Plugins** — import/install/toggle sandboxed JS search plugins (bulk import modal).
  - **Launcher** — landing page, close-to-tray, minimize-on-launch, restore-on-exit, autostart, UAC elevation prompts.
  - **Privacy & Data** — friends notifications/read receipts, wipe local storage safely.

### 33. Big Screen Mode & Navigation Polish — ✅ Done
- Controller-first TV interface with rail-aware gamepad navigation (`BigScreenContext`, `GamepadProvider`, `useFocusable`).
- **Big Screen v3**: registry-driven sections (`src/bigscreen/registry.tsx` — `PRIMARY_SECTIONS` + `SYSTEM_SECTIONS` hub, `ShellSwitch` swaps desktop ↔ bigscreen per route; each bigscreen view is its own lazy chunk).
- Dedicated Deals view in Big Screen mode; system pages for Downloads/Storage/Achievements/Mods/Emulators/Settings/Docs.

### 34. System Tray, Launcher Behavior & Autostart — ✅ Done
- System tray icon with live status line + right-click menu (`tray.rs`), green-dot variant while a game is running.
- Close-to-tray, minimize-on-launch, restore-on-last-exit, disable-UAC-elevation, and OS autostart (`tauri-plugin-autostart`) — all togglable in the Launcher settings tab.

### 35. Discord Rich Presence — ✅ Done
- Dedicated Discord settings tab; backend IPC thread with reconnect/retry (`discord_presence.rs`).
- "Playing" payloads (cover art, playtime, website button) on game start/exit + "browsing" payloads while idle (`useDiscordPresence`).

### 36. Command Palette & UI Sounds — ✅ Done
- Command palette with scopes, inspector and system actions (`src/components/command-palette/`), plus synthesized UI sounds and a now-playing chip.

### 37. Simple UI Mode & New-User Onboarding — ✅ Done
- Simple UI mode rolled out across all pages; new users are onboarded into it (`30b9b66`, `3e34bc0`).

### 38. Docs Page — ✅ Done
- In-app user guide at `/docs` (`DocsPage.tsx`), content fully in i18n `docs.*` keys, with a Big Screen variant.

### 39. Updater — ✅ Done
- `tauri-plugin-updater` for release-channel updates + portable-mode update download/cancel/apply (`updater.rs`), surfaced via `UpdateModal` / `UpdateNotification`.

### 40. Tests — ✅ Done (first pass)
- Frontend: **vitest** test suite (`npm test`) covering filters, Steam integration, units, color, game utils.
- Backend: Rust unit tests across `db/games`, `db/migrate`, `plugins` (live smoke, ignored), `steam/launch_options`, GOG/Epic achievements, etc.

---

## 🔮 Future / Later

### 26. Linux Support — ⚠️ Plan written (`plans/Linux.md`), not implemented
- A full Wayland build guide + Proton/Wine integration spec exists at `plans/Linux.md` (system deps, platform-gated Cargo deps, `/proc` process scanner, `/sys/class/drm` GPU detection, Steam path detection, ProtonDB badge already shipped).
- Not merged: platform-gating of Windows-only crates, the `proton.rs` launch module, Wayland env vars, Linux bundle config.
- Remaining work: integrate with Wine/Proton prefix management (create/manage prefixes, select Proton version, Winetricks/Protontricks), detect Steam Deck and switch to gamepad-friendly UI, Flatpak/AppImage packaging.

### 27. Theming System (Phase 2) — ⚠️ Partial
- The CSS custom-property engine is mature: base `:root` dark palette, light/nord/cyberpunk/aurora overrides, and a **global accent family** driving the full game palette (`f9a0c88`, `73327a9` theme consistency polish).
- Still missing: theme editor UI in Settings with live preview, import/export `.json` theme files, community theme browser, scheduled theme switching.

### 28. Plugin System — ✅ Done (as sandboxed search plugins)
- **Shipped:** sandboxed JS search plugins — QuickJS runtime with memory + instruction budgets (`plugins/runtime.rs`), `PluginManager` (`plugins/mod.rs`), install/import/toggle/remove/bulk commands, 15-minute raw-result cache, merged `search_downloads` / `search_downloads_stream` pipeline, Plugins settings tab + bulk import modal.
- **Not built (future):** the broader Phase-2 API from the original spec — `registerTab` / `registerGameContextMenu` / `registerMetadataScraper` / `registerSettingsSection` hooks, per-plugin permissions beyond the sandbox, and a plugin marketplace.

---

## 📋 Task Priority Summary

| Priority | # | Task | Status |
|----------|---|------|--------|
| 🔴 High | 3 | Fix game icon fetching | ✅ Done (metadata icons + placeholder fallbacks) |
| 🔴 High | 4 | Fix activity page UI inconsistencies | ✅ Done |
| 🔴 High | 5 | Import modal with rename & metadata fetch | ✅ Done |
| ✅ Done | 1 | Find a good name for the project (→ GameIndex) | ✅ Done |
| ✅ Done | 2 | Write a complete README | ✅ Done |
| 🟡 Medium | 6 | News tab: Xbox Game Pass + ITAD | ✅ Done |
| 🟡 Medium | 7 | RSS news page (+ regional feeds & curated packs) | ✅ Done |
| 🟡 Medium | 8 | Game page media (screenshots, trailers) | ✅ Done |
| 🟡 Medium | 9 | Game descriptions / summary | ✅ Done |
| 🟡 Medium | 10 | Steam reviews + multi-site aggregation | ✅ Done |
| 🟡 Medium | 11 | Overview info cards (Crackwatch, ProtonDB, etc.) | ✅ Done |
| 🟡 Medium | 12 | Achievements tab (multi-source) | ✅ Done |
| 🟡 Medium | 13 | HowLongToBeat card | ✅ Done |
| 🟡 Medium | 14 | Live Steam player count | ✅ Done |
| 🟡 Medium | 15 | Web links with page preview | ✅ Done |
| 🟢 Normal | 16 | Store page — browse & download | ✅ Done |
| 🟢 Normal | 17 | Multi-store import & sync (Steam/Epic/GOG/Humble/Rockstar/Uplay) | ✅ Done |
| 🟢 Normal | 18 | Per-game options / context menu | ⚠️ Partial (launch args, admin, pre/post scripts, companion apps, Steam picker, metadata override, hide done; no env vars / compat / perf profiles / tags) |
| 🟢 Normal | 19 | Game manager tab | ✅ Done |
| 🟢 Normal | 20 | Deals tab | ✅ Done |
| 🟢 Normal | 21 | Downloads tab | ✅ Done |
| 🟢 Normal | 22 | Statistics tab | ✅ Done |
| 🟢 Normal | 23 | Watchlist tab | ✅ Done |
| 🟢 Normal | 24 | Translations / i18n (6 locales) | ✅ Done |
| 🟢 Normal | 25 | Performance optimizations | ⚠️ Partial (code-splitting + VirtualGrid done; no react-window elsewhere, no rayon) |
| 🟢 Normal | 29 | Emulators & ROM management (+ install pipeline) | ✅ Done |
| 🟢 Normal | 30 | Mod manager (Steam Workshop & Nexus) | ✅ Done |
| 🟢 Normal | 31 | Concurrent downloads engine | ✅ Done |
| 🟢 Normal | 32 | Settings overhaul (Discord/Plugins/Launcher/Hardware/Privacy) | ✅ Done |
| 🟢 Normal | 33 | Big Screen rail navigation & deals (v3) | ✅ Done |
| 🟢 Normal | 34 | System tray + launcher behavior + autostart | ✅ Done |
| 🟢 Normal | 35 | Discord Rich Presence | ✅ Done |
| 🟢 Normal | 36 | Command palette & UI sounds | ✅ Done |
| 🟢 Normal | 37 | Simple UI mode & onboarding | ✅ Done |
| 🟢 Normal | 38 | Docs page | ✅ Done |
| 🟢 Normal | 39 | Updater (release + portable) | ✅ Done |
| 🟢 Normal | 40 | Test suite (vitest + Rust unit tests) | ✅ Done |
| ⚪ Later | 26 | Linux support | ⚠️ Plan written (`plans/Linux.md`), not implemented |
| ⚪ Later | 27 | Theming system v2 | ⚠️ Partial (accent family + consistency polish done; no theme editor/import-export yet) |
| ⚪ Later | 28 | Plugin system | ✅ Done (sandboxed search plugins); broader hook/marketplace API future |

> Note: All major ad-hoc surfaces (**Big Screen Mode**, **Emulators**, **Mods**, **Friends**, **Community**, **i18n**, **Tray**, **Discord**, **Docs**, **Updater**) are now tracked above.
