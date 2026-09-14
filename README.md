<div align="center">

<picture>
  <img src="src-tauri/icons/128x128.png" alt="GameIndex logo" width="96" height="96" />
</picture>

<h1>GameIndex</h1>

<p><strong>A unified, cross-store game launcher and library manager.</strong></p>

Unify your Steam, GOG, Epic, Rockstar, Ubisoft, and DRM-free libraries into a single, fast, native experience — with discovery, deals & news, activity tracking, achievements, Linux/Steam Deck Proton support, a deeply customizable interface (Layout Studio + six UI styles), a social layer, and a controller-first 10-foot UI.

<br />

[![Status](https://img.shields.io/badge/status-active--development-yellow)](#status)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-informational)](#platforms)
[![Stack](https://img.shields.io/badge/stack-Tauri%20%7C%20Rust%20%7C%20React%20%7C%20TypeScript-orange)](#tech-stack)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](#license)
[![Demo](https://img.shields.io/badge/demo-watch%20on%20YouTube-red)](https://youtu.be/1PnELFTXH4g)

</div>

---

## 🎬 Demo Video

A quick guided tour of GameIndex — the launcher, unified library, game pages, and more:

<p align="center">
  <a href="https://youtu.be/1PnELFTXH4g">
    <img src="https://img.youtube.com/vi/1PnELFTXH4g/hqdefault.jpg" width="75%" loading="lazy" alt="GameIndex demo video on YouTube" />
  </a>
</p>

<p align="center">▶️ <a href="https://youtu.be/1PnELFTXH4g">Watch the presentation on YouTube</a></p>

---

## 📑 Table of Contents

- [✨ Features](#-features)
- [🐧 Linux, Wine & Proton](#-linux-wine--proton)
- [📸 Screenshots](#-screenshots)
- [🎬 Demo Video](#demo-video)
- [💡 Inspiration](#-inspiration)
- [🛠️ Tech Stack](#️-tech-stack)
- [🚀 Getting Started](#-getting-started)
- [📁 Project Structure](#-project-structure)
- [🗺️ Roadmap](#️-roadmap)
- [📌 Status](#-status)
- [🤝 Contributing](#-contributing)
- [⚖️ Disclaimer](#-disclaimer)
- [📄 License](#-license)
- [🙏 Acknowledgments](#-acknowledgments)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **Unified Library** | Steam, GOG Galaxy, Epic Games Store, Rockstar, Ubisoft Connect, Humble Bundle, and manual imports in one cohesive grid — with a drag-and-drop executable import wizard that groups dropped folders, picks the primary executable and links IGDB metadata. |
| **Rich Game Pages** | Hero, metadata, reviews, achievements, screenshots, videos, HowLongToBeat stats, Crackwatch, ProtonDB, Steam community features, and live player counts — plus a built-in **Web Links** browser with address bar, zoom, pinning and a personal links manager. |
| **Game Notes** | Per-game Markdown workspace with multiple notes, 7 templates (walkthrough, checklist, boss strategy, build & loadout, quest log, progress journal), search & tag filters, pinning, live preview (write/split), word count, copy/export, and debounced auto-save. |
| **Game Versions** | Detects installed versions from GOG/Epic/Steam manifests or PE metadata and flags newer releases on game pages and in the download modal. |
| **Achievements Hub** | Cross-platform achievement tracking and analytics — sync Steam, GOG, Epic, RetroAchievements, and manual lists, with gamerscore totals, rarity & unlock-activity charts, and per-game completion shelves. |
| **Emulators & ROMs** | Integrated emulator manager: launch emulator executables, catalog multi-system platforms, and manage ROMs with bulk actions and save snapshots — with native Linux/AppImage emulator installs plus Flatpak/Snap binary discovery. |
| **Mod Manager** | Dual-pane mod manager for Steam Workshop & Nexus Mods with bulk multi-select (enable/disable/delete), stat cards, and mod size tracking — plus mod presets, a load-order conflict visualizer, export/import and a file inspector. |
| **IGDB Storefront** | IGDB-powered catalog browsing (search, filters, rails, price badges, comparisons). |
| **Store Compare** | Side-by-side comparison tray and modal for up to 4 games — best-value badges on numeric rows plus shared genre/platform/mode/theme chips. |
| **Deals Hub** | Real-time price deals across Steam, GOG, Epic, Humble, Fanatical, and more — plus an Xbox Game Pass catalog, giveaways with live countdowns, and playtester listings. |
| **Wishlist** | Dedicated wishlist tab with release-date countdowns, per-game notes, genre/platform filters, and share-with-friends cards. |
| **News Reader** | Built-in RSS reader on a dedicated News page — curated gaming feeds, regional feeds and feed packs, with article reading that stays in the app. |
| **Activity Tracking** | FPS, frametime, and per-session metrics via MSI Afterburner / RTSS on Windows (MangoHud / GameScope on Linux), with interactive timeline, Gantt, performance, and sparkline views. |
| **Downloads** | Unified concurrent download engine with seeding, HTTP direct, debrid (Real-Debrid / AllDebrid / TorBox), browser-resolver captures, and torrents via `librqbit`. |
| **Linux & Steam Deck** | First-class Proton/Wine compatibility: runner manager (GE-Proton, CachyOS, Proton-EM, Wine-GE, Soda, Kron4ek…), shared prefixes with per-game overrides, DXVK/VKD3D, esync/fsync/ntsync, MangoHud, GameMode, GameScope, per-game GPU pinning, controller & anti-cheat runtimes, captured logs with a live viewer, Wine tools and system diagnostics. → [Full guide](docs/linux-wine-proton.md) |
| **Storage Manager** | Visualize disk usage, move installs between drives, track emulator & mod footprints, and bulk-recalculate sizes. |
| **Backup & Restore** | Selectable, cancellable backups with live progress — raw NDJSON export plus merge/replace restore modes from the Settings backup tab, including Proton/Wine compatibility profiles. |
| **Stats, Community & Friends** | Local-first social layer — friend profiles, sync, recommendations, compare, chat and leaderboards — alongside a personal **Stats** dashboard with overview, trends, achievements, a captures gallery and milestones. |
| **Discord Rich Presence** | Playing *and* browsing presence — platform/playtime context, dynamic game poster, and a launcher toggle. |
| **Big Picture Mode** | Full-screen, controller-first 10-foot UI with rail-aware gamepad navigation across the whole app — Library, Store, Deals, News, Activity, Friends, and Community, plus system pages (Downloads, Storage, Achievements, Mods, Emulators, Settings, Docs) — with animated game backdrops, focus memory, and fluid rail wrapping. |
| **Live Player Counts** | Steam player counts with a hero banner, tabbed popover, and historical player-count graph with range toggle. |
| **Command Palette** | Global `Ctrl/Cmd+K` launcher for navigation, search, and system actions — recents, calculator, cheat sheet, random-game picker, and power filters — with synthesized UI sounds and a live now-playing chip. |
| **Themes & UI Styles** | **Six selectable UI styles** — Classic, Neo-Modern, Steam Client, Epic Launcher, Material You 3 and Liquid Glass — each a distinct token-driven architecture, on top of adaptive theming that samples the active game's artwork into chrome accents, dark/light + alternate color themes with a custom accent picker, and a full **theme creator** (live preview, presets, JSON import/export). |
| **Layout Studio** | Settings → Interface: a live layout editor for the whole shell — toggle and reorder navbar tabs, header buttons, sidebar dock and sections, per-page widgets, detail-page tabs, the detail top bar and individual side cards, plus a free-form 12-column hero grid. Viewport previews (16:9 / 16:10 / 21:9 / 4:3), inspect mode, built-in presets and JSON import/export. |
| **Customizable Interface** | Drag-and-drop top-nav ordering with per-item visibility, right-click context menus across library, downloads, store, mods, news, emulators and storage, a resizable sidebar that folds to an icon rail on narrow windows, a settings hub with category navigation and search, and fluid layouts tuned for handhelds and Steam Deck. |
| **i18n & Privacy** | Six-language support via `LanguageContext` (English, German, French, Spanish, Russian, Chinese) and a Privacy & Data tab to view and wipe local storage. |
| **App Updates** | In-app update checks per install type (NSIS installer, AppImage, `.deb`, portable) plus a browsable **Release History** fetched from [GitHub Releases](https://github.com/atxoxx/GameIndex/releases) — version timeline, latest/pre-release/installed badges and full release notes without leaving the app. |
| **Built-in Guide** | Searchable in-app documentation with grouped navigation, covering every major feature — plus a controller-friendly Big Screen variant. |
| **Plugin System** | Sandboxed QuickJS plugins for custom search and download sources — memory cap, instruction budget, 20-second timeout and SHA-256-verified installs, managed from Settings → Plugins. |
| **Launcher & Startup** | Configurable landing page, system tray with close-to-tray, run-at-login, minimize-on-launch, UAC-elevation bypass, Simple UI mode and an optional always-on-top launch splash. |

> 🚧 **Planned / in progress:** per-game performance profiles and user tags · community theme browser · scheduled theme switching · Flatpak packaging · broader plugin hooks and marketplace.

---

## 🐧 Linux, Wine & Proton

GameIndex is built for Linux gaming, not ported to it. The compatibility layer is configurable globally and per game, with no external helper scripts required:

- **Runners** — detect Steam/System Wine, CachyOS, Lutris, Heroic and community builds; download GE-Proton, CachyOS, Proton-EM, Wine-GE, Kron4ek and Soda releases in-app; install local archives; uninstall what GameIndex manages.
- **Prefixes** — shared default prefix or one per game, `compatdata` reuse for Steam titles, prefix inspection (arch, validity, version, size, linked games), clone/reset/delete, Wine tools and one-click winetricks packages.
- **Launch pipeline** — `[gamescope] [gamemoderun] [mangohud] [umu-run | runner] game.exe`, with DXVK/VKD3D, esync/fsync/ntsync, Wayland, WoW64, large-address-aware, DLL overrides, per-game env vars and exclusion lists.
- **Display & performance** — Gamescope (FSR/NIS, HDR, VRR, resolution/FPS/refresh controls), MangoHud logging, GameMode, PRIME/GPU pinning and FPS readback into Activity.
- **Steam integration** — reversible Wine/Proton launch-option merging in `localconfig.vdf` (skipped while Steam runs, one-time backup), Steam launch routes and the native launch-options picker.
- **Logs & diagnostics** — per-game Wine/Proton logs with a live viewer, Linux system diagnostics, anti-cheat runtime installs and runner maintenance.
- **Packaging** — AppImage and `.deb` builds with matching in-app updates.

> 📖 **Read the full feature guide:** [`docs/linux-wine-proton.md`](./docs/linux-wine-proton.md)

---

## 📸 Screenshots

<p align="center"><sub>Dark-first UI, captured on Windows and Linux at 1920×1080. The same interface adapts to light mode and desktop use.</sub></p>

<p align="center">
  <img src="Screenshots/Library/1.png" width="90%" loading="lazy" alt="GameIndex library grid" />
</p>

### 🏠 Library

<p>
  <img src="Screenshots/Library/1.png" width="49%" loading="lazy" alt="Library grid view" />
  <img src="Screenshots/Library/2.png" width="49%" loading="lazy" alt="Library with filters and detail rail" />
</p>

### 🎮 Game Page

<p>
  <img src="Screenshots/Game%20page/1.png" width="32%" loading="lazy" alt="Game page hero banner" />
  <img src="Screenshots/Game%20page/2.png" width="32%" loading="lazy" alt="Game page metadata" />
  <img src="Screenshots/Game%20page/3.png" width="32%" loading="lazy" alt="Game page details and media" />
</p>

### 🛒 Store

<p>
  <img src="Screenshots/Store/1.png" width="32%" loading="lazy" alt="Store catalogue" />
  <img src="Screenshots/Store/2.png" width="32%" loading="lazy" alt="Store browsing with filters" />
  <img src="Screenshots/Store/3.png" width="32%" loading="lazy" alt="Store product page" />
</p>

### 📰 News

<p>
  <img src="Screenshots/News/1.png" width="49%" loading="lazy" alt="News feed" />
  <img src="Screenshots/News/2.png" width="49%" loading="lazy" alt="News article" />
</p>

### 💰 Deals

<p>
  <img src="Screenshots/Deals/1.png" width="32%" loading="lazy" alt="Deals view 1" />
  <img src="Screenshots/Deals/2.png" width="32%" loading="lazy" alt="Deals view 2" />
  <img src="Screenshots/Deals/3.png" width="32%" loading="lazy" alt="Deals view 3" />
</p>

### 📊 Stats

<p>
  <img src="Screenshots/Stats/1.png" width="32%" loading="lazy" alt="Stats overview" />
  <img src="Screenshots/Stats/2.png" width="32%" loading="lazy" alt="Stats charts" />
  <img src="Screenshots/Stats/3.png" width="32%" loading="lazy" alt="Stats breakdown" />
</p>

### 🎯 Activity

<p>
  <img src="Screenshots/Activity/1.png" width="32%" loading="lazy" alt="Activity timeline" />
  <img src="Screenshots/Activity/2.png" width="32%" loading="lazy" alt="Activity charts" />
  <img src="Screenshots/Activity/3.png" width="32%" loading="lazy" alt="Session metrics" />
</p>

### 👥 Friends

<p>
  <img src="Screenshots/Friends/1.png" width="32%" loading="lazy" alt="Friends hub" />
  <img src="Screenshots/Friends/2.png" width="32%" loading="lazy" alt="Friend profile" />
  <img src="Screenshots/Friends/3.png" width="32%" loading="lazy" alt="Friends chat" />
</p>

### 🧩 Mods & 🕹️ Emulators

<p>
  <img src="Screenshots/Mods/1.png" width="32%" loading="lazy" alt="Mod manager" />
  <img src="Screenshots/Emulators/1.png" width="32%" loading="lazy" alt="Emulator manager" />
  <img src="Screenshots/Emulators/2.png" width="32%" loading="lazy" alt="Emulator library" />
</p>

### 📥 Downloads

<p>
  <img src="Screenshots/Downloads/1.png" width="49%" loading="lazy" alt="Downloads manager" />
</p>

### 💾 Storage

<p>
  <img src="Screenshots/Storage/1.png" width="32%" loading="lazy" alt="Storage manager" />
  <img src="Screenshots/Storage/2.png" width="32%" loading="lazy" alt="Storage breakdown" />
  <img src="Screenshots/Storage/3.png" width="32%" loading="lazy" alt="Storage actions" />
</p>

### 🏆 Achievements & 💜 Wishlist

<p>
  <img src="Screenshots/Achievements/1.png" width="49%" loading="lazy" alt="Achievements" />
  <img src="Screenshots/Wishlist/1.png" width="49%" loading="lazy" alt="Wishlist" />
</p>

### 📝 Game Notes

<p>
  <img src="Screenshots/notes/1.png" width="32%" loading="lazy" alt="Notes tab empty state with note templates" />
  <img src="Screenshots/notes/2.png" width="32%" loading="lazy" alt="New note template menu" />
  <img src="Screenshots/notes/3.png" width="32%" loading="lazy" alt="Markdown note editor with split preview" />
</p>

### 🐧 Linux & Steam Deck — Proton / Wine

<p align="center"><sub>The global Proton/Wine settings, per-game compatibility overrides, and the live Wine/Proton log viewer. Full walkthrough in the <a href="docs/linux-wine-proton.md">Linux, Wine &amp; Proton feature guide</a>.</sub></p>

<p>
  <img src="Screenshots/linux/1.png" width="32%" loading="lazy" alt="Proton/Wine runner management" />
  <img src="Screenshots/linux/2.png" width="32%" loading="lazy" alt="Wine prefix manager" />
  <img src="Screenshots/linux/3.png" width="32%" loading="lazy" alt="Direct3D and graphics translation settings" />
</p>

<p>
  <img src="Screenshots/linux/4.png" width="32%" loading="lazy" alt="Synchronization engine settings" />
  <img src="Screenshots/linux/5.png" width="32%" loading="lazy" alt="Gamescope compositor settings" />
  <img src="Screenshots/linux/6.png" width="32%" loading="lazy" alt="Gaming tools and overlays" />
</p>

<p>
  <img src="Screenshots/linux/7.png" width="32%" loading="lazy" alt="Environment variables and DLL overrides" />
  <img src="Screenshots/linux/8.png" width="32%" loading="lazy" alt="Linux system diagnostics and maintenance" />
  <img src="Screenshots/linux/9.png" width="32%" loading="lazy" alt="Wine/Proton compatibility log viewer" />
</p>

<p>
  <img src="Screenshots/linux/10.png" width="32%" loading="lazy" alt="Per-game compatibility layer and runner selection" />
  <img src="Screenshots/linux/11.png" width="32%" loading="lazy" alt="Per-game prefix, architecture and Wine debug options" />
  <img src="Screenshots/linux/12.png" width="32%" loading="lazy" alt="Per-game graphics and Direct3D overrides" />
</p>

<p>
  <img src="Screenshots/linux/13.png" width="32%" loading="lazy" alt="Per-game tools and overlay overrides" />
  <img src="Screenshots/linux/14.png" width="32%" loading="lazy" alt="Per-game environment and DLL override inheritance" />
  <img src="Screenshots/linux/15.png" width="32%" loading="lazy" alt="Per-game prefix maintenance tools" />
</p>

> 📁 Full sets live in [`Screenshots/`](./Screenshots) — including Game page (13), Linux & Proton/Wine (15), Activity (10), Friends (9), Stats (8), Deals (4), and Notes (3) shots.

---

## 💡 Inspiration

GameIndex is built *with* — not just inspired by — excellent projects in the launcher space:

- **[Hydra Launcher](https://hydralauncher.gg)** — the clean, modern approach to game distribution.
- **[Playnite](https://playnite.com)** — the extensible, library-aggregation philosophy and customization depth.
- **[LaunchBox](https://www.launchbox-app.com)** — rich metadata, media, and emulation-focused cataloging.
- **[Steam](https://store.steampowered.com)** + **[GOG Galaxy](https://www.gog.com/galaxy)** — unified-library UX patterns.

We borrow the best ideas from each and aim to combine them into a single, lightweight native app.

---

## 🛠️ Tech Stack

| Layer    | Technology |
|----------|------------|
| Shell    | [Tauri v2](https://tauri.app) (Rust) |
| Frontend | [React 19](https://react.dev) + [TypeScript](https://www.typescriptlang.org) |
| Bundler  | [Vite 7](https://vitejs.dev) |
| DB       | SQLite (`rusqlite` + `r2d2_sqlite`) |
| Secrets  | OS keychain via [`keyring`](https://crates.io/crates/keyring) |
| Torrents | [`librqbit`](https://github.com/ikatson/rqbit) |
| Charts   | Custom SVG (`src/components/charts/`) |
| Routing  | React Router v7 (`HashRouter` for Tauri `file://`) |

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) (≥ 20.19 or ≥ 22.12 — Vite 7 requirement) + npm
- [Rust](https://rustup.rs) (stable toolchain)
- Platform deps: see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

### Development

```bash
npm install
npm run tauri dev      # launches the native window with hot reload
```

Frontend-only iteration (no native shell):

```bash
npm run dev            # Vite at http://localhost:1420
```

### Build

```bash
npm run tauri build    # tsc + vite build + native bundles
```

### ✅ Checks & scripts

| Command | What it does |
|---------|--------------|
| `npm run typecheck` | TypeScript check (`tsc --noEmit`) |
| `npm run lint` | ESLint over `src` (zero-warning gate) |
| `npm test` | Vitest run — `npm run test:watch` to watch |
| `npm run audit:i18n` | Verifies every UI string has translations across locales |
| `npm run build` | Frontend build only (`tsc && vite build`) |
| `npm run preview` | Preview the production frontend build |
| `cargo check` | Rust backend — run inside `src-tauri/` |

### ❄️ Nix & NixOS

If you use Nix or NixOS, a `flake.nix` is included providing all Tauri v2 runtime libraries (WebKitGTK 4.1, GTK3, D-Bus, Clang for bindgen) and toolchains:

```bash
# Enter the isolated development shell
nix develop

# Or with direnv:
direnv allow
```

Inside the shell, run the standard `npm install` and `npm run tauri dev`.

### 🔎 VirusTotal scans

Independent antivirus scans of the latest release artifacts:

- **Standalone binary:** [virus total](https://www.virustotal.com/gui/file-analysis/OGIwZGVjYTk5NTVmNjZkNjkyZTZjMjVmZDExOTg0MjE6MTc4NjEzNzI0NQ==)
- **Installer:** [virus total](https://www.virustotal.com/gui/file-analysis/OGI2MjM4NzgzMzg2MWMyMTNmYTU0MzcyYWMyNGZlNGY6MTc4NjEzNzMwNQ==)

**Why does VirusTotal flag GameIndex?** The detections you may see (e.g. Trapmine's `Malicious.moderate.ml.score` or Acronis's Static ML) are **machine-learning heuristics, not malware signatures** — there is no malicious behavior being matched. GameIndex is a **Tauri (Rust) app**, and Rust-compiled binaries are routinely flagged for these characteristics:

- **Unsigned binaries.** Release builds are not code-signed, so antivirus engines have no publisher identity to anchor on and treat the file as an "unknown new binary."
- **Rust binary traits.** Static Rust executables have high entropy and an import table atypical of native apps — a classic ML trigger.
- **Self-contained packaging.** The standalone/portable build embeds its WebView2 bootstrap, which heuristic engines find suspicious.

This is a known false-positive pattern affecting many legitimate Tauri and Rust projects. Nothing in the source code matches malware behavior — it's fully open source, so you can verify the code yourself and build from source (`npm run tauri build`). The files are intentionally unsigned because code-signing certificates cost money; the ML flags typically disappear once a release is signed.

---

## 📁 Project Structure

```
.
├── src/                 React + TypeScript frontend
│   ├── pages/           Top-level route components (Home, Library, Game, Store,
│   │                   Store product detail, Deals, News, Wishlist, Emulators,
│   │                   Mods, Activity, Achievements, Stats, Friends, Storage,
│   │                   Downloads, Settings, Docs)
│   ├── components/      Feature-scoped UI — one folder per area (game/, library/,
│   │                   store/, downloads/, download-modal/, news/, activity/,
│   │                   achievements/, deals/, emulators/, mods/, friends/, docs/,
│   │                   weblinks/, command-palette/, charts/, sidebar/, settings/,
│   │                   ui/, bigscreen/, ...)
│   ├── context/         Cross-cutting providers (Game, Activity, Theme, Language, ...)
│   ├── hooks/           Reusable stateful helpers
│   ├── types/           Mirrors of Rust serde models
│   └── styles/          Themed CSS (incl. styles/ui-styles/ for the six UI styles)
└── src-tauri/           Rust backend
    ├── src/             Tauri commands, DB DAOs, integrations
    │   ├── steam|gog|epic|rockstar|uplay|humble/   Per-store sync + auth
    │   ├── downloads/        Concurrent direct, debrid, torrent & browser-resolver downloads
    │   ├── mods/             Steam Workshop & Nexus Mods detection + operations
    │   ├── plugins/          Sandboxed QuickJS plugin runtime
    │   ├── compatibility.rs  Proton/Wine runners, prefixes, GameScope, GPU pinning
    │   ├── db/               Per-domain SQLite pools + schema (incl. compatibility.db)
    │   └── ...
    └── tauri.conf.json  Frameless window + bundle config
```

For deeper architectural notes and conventions, see [`knowledge.md`](./knowledge.md).

---

## 🗺️ Roadmap

Track progress, ideas, and priorities in [`todo.md`](./todo.md). Highlights:

- ✅ Steam, GOG, Epic, Rockstar, Ubisoft, Humble library sync
- ✅ Steam achievements, HowLongToBeat, Crackwatch, live + historical player counts
- ✅ Activity dashboard with FPS + frametime charts
- ✅ Downloads engine rewrite (concurrent downloads, seeding, direct/debrid/torrent sources, browser resolver)
- ✅ Storage manager + emulator & mod footprint breakdown
- ✅ News page with RSS feeds
- ✅ IGDB-powered storefront (search, filters, rails, price badges, comparisons)
- ✅ Community & Friends social layer
- ✅ Big Picture Mode (controller-first 10-foot UI with rail navigation)
- ✅ Emulators manager & ROM library tools
- ✅ Mod manager (Steam Workshop & Nexus Mods integration)
- ✅ Discord Rich Presence (playing + browsing presence, dynamic poster, launcher toggle)
- ✅ Internationalization (i18n) & language switcher
- ✅ Privacy & Data management in Settings
- ✅ Theme gallery + custom accent picker
- ✅ Steam reviews & multi-source ratings
- ✅ Sandboxed plugin system for search/download sources
- ✅ Deals hub — real-time store deals, Xbox Game Pass catalog, giveaways, and playtester listings
- ✅ Multi-source Achievements dashboard with analytics
- ✅ Wishlist tab with release countdowns and notes
- ✅ Backup & restore with merge/replace NDJSON modes (incl. compatibility profiles)
- ✅ Command palette, adaptive game-art theming, and now-playing HUD
- ✅ Linux + Steam Deck support — Proton/Wine runner manager, shared prefixes, DXVK/VKD3D, MangoHud/GameMode/GameScope, GPU pinning, Wine logs, system diagnostics ([full guide](docs/linux-wine-proton.md))
- ✅ Per-game environment variables & compatibility profiles
- ✅ Per-game GPU selection, controller support, and anti-cheat runtime installs
- ✅ Store side-by-side compare mode
- ✅ Game version detection & newer-release badges
- ✅ Game notes workspace — Markdown notes, templates, tags, search & export
- ✅ Theme creator with live preview, presets and JSON import/export
- ✅ Release history + per-install update channels (NSIS, AppImage, `.deb`, portable)
- ✅ Right-click context menus across library, downloads, store, mods, news, emulators and storage
- ✅ Native Linux emulator installs (AppImage/tarball) & Flatpak/Snap discovery
- ✅ Standalone always-on-top launch splash window that survives minimize-on-launch
- ✅ Layout Studio — whole-app layout editor with per-page widgets, reorderable detail top bar, itemized side cards and a free-form hero grid, plus presets and JSON import/export
- ✅ Six token-driven UI styles (Classic, Neo-Modern, Steam Client, Epic Launcher, Material You 3, Liquid Glass)
- ✅ Settings hub with top-category navigation, search and collapsible subtabs
- ✅ In-app Web Links browser with address bar, zoom and a personal links manager
- ✅ Stats dashboard (overview, trends, achievements, captures gallery, milestones)
- ✅ System tray, run-at-login, close-to-tray, minimize-on-launch and Simple UI mode
- ✅ Reorderable nav tabs, collapsible icon-rail sidebar & handheld/Deck layout pass
- ✅ Animated Big Picture backdrops, focus memory & fluid rail navigation
- 🚧 Per-game performance profiles and user tags
- 🚧 Community theme browser & scheduled theme switching
- 🚧 Flatpak packaging and backend performance work (parallel library scanning, streamed file operations)
- ⏳ Broader plugin hooks and marketplace

---

## 📌 Status

> 🛠️ **Personal project, vibe-coded** — built in my free time as a learning exercise and a love-letter to PC gaming.
> Latest tagged release: **v1.3.0** ([GitHub Releases](https://github.com/atxoxx/GameIndex/releases)).
> Expect rough edges, breaking changes, and rapid iteration. Contributions and ideas are welcome.

---

## 🤝 Contributing

1. Read the conventions in [`knowledge.md`](./knowledge.md) (theme tokens, routing, schema migrations, etc.).
2. Fork the repo and create a feature branch.
3. Keep PRs focused and documented.
4. Run `npm run typecheck`, `npm run lint` and `cargo check` before submitting.

Please open an issue before starting large changes so we can discuss direction.

---

## ⚖️ Disclaimer

- **If you like a game, support its developers** — buy it from official stores (Steam, GOG, Epic, etc.) where the money actually reaches the people who made it.

We believe in the open-source community, the games we love, and the developers who make them. Please use GameIndex responsibly and in accordance with the laws of your country.

---

## 📄 License

GameIndex is released under the **MIT License** — free to use, modify, and distribute, including for contributing back to the project. Attribution appreciated.

See the full text in the [`LICENSE`](./LICENSE) file.

---

## 🙏 Acknowledgments

- The Tauri, React, and Rust communities for the excellent tooling.
- IGDB, HowLongToBeat, Steam, GOG, Epic, and IsThereAnyDeal for the data.
- [Hydra Launcher](https://hydralauncher.gg), Playnite, and LaunchBox for the inspiration.

<div align="center">
<sub>Built with ☕ and a lot of music.</sub>
</div>
