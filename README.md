<div align="center">

<picture>
  <img src="src-tauri/icons/128x128.png" alt="GameIndex logo" width="96" height="96" />
</picture>

<h1>GameIndex</h1>

<p><strong>A unified, cross-store game launcher and library manager.</strong></p>

Unify your Steam, GOG, Epic, Rockstar, Ubisoft, and DRM-free libraries into a single, fast, native experience — with discovery, sync, activity tracking, a social layer, and a controller-first 10-foot UI.

<br />

[![Status](https://img.shields.io/badge/status-active--development-yellow)](#status)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-informational)](#platforms)
[![Stack](https://img.shields.io/badge/stack-Tauri%20%7C%20Rust%20%7C%20React%20%7C%20TypeScript-orange)](#tech-stack)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](#license)

</div>

---

## 📑 Table of Contents

- [✨ Features](#-features)
- [📸 Screenshots](#-screenshots)
- [💡 Inspiration](#-inspiration)
- [🛠️ Tech Stack](#️-tech-stack)
- [🚀 Getting Started](#-getting-started)
- [📁 Project Structure](#-project-structure)
- [🗺️ Roadmap](#️-roadmap)
- [📌 Status](#-status)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)
- [🙏 Acknowledgments](#-acknowledgments)

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| **Unified Library** | Steam, GOG Galaxy, Epic Games Store, Rockstar, Ubisoft Connect, Humble Bundle, and manual imports in one cohesive grid. |
| **Rich Game Pages** | Hero, metadata, reviews, achievements, screenshots, videos, web links, HowLongToBeat, Crackwatch, ProtonDB, and live player counts. |
| **Emulators & ROMs** | Integrated emulator manager: launch emulator executables, catalog multi-system platforms, and manage ROMs with bulk actions. |
| **Mod Manager** | Dual-pane mod manager for Steam Workshop & Nexus Mods with bulk multi-select (enable/disable/delete), stat cards, and mod size tracking. |
| **IGDB & Hydra Storefront** | IGDB-powered catalog browsing (search, filters, rails, price badges, comparisons) enriched with ported Hydra community features. |
| **Ported Hydra Features** | Integrated Hydra public APIs: community reviews (replies, votes, sorting), community stats (player/download counts, star ratings), and Hydra-compatible public download source format. |
| **Activity Tracking** | FPS, frametime, and per-session metrics via MSI Afterburner / RTSS, with interactive timeline, Gantt, performance, and sparkline views. |
| **Downloads** | Unified download engine with single-active queueing, seeding, HTTP direct, debrid (Real-Debrid / AllDebrid), and torrents via `librqbit`. |
| **Storage Manager** | Visualize disk usage, move installs between drives, track emulator & mod footprints, and bulk-recalculate sizes. |
| **Community & Friends** | Local-first social layer: profiles, friend sync, shared recommendations, and a community feed. |
| **Discord Rich Presence** | Playing *and* browsing presence — platform/playtime context, dynamic game poster, and a launcher toggle. |
| **Big Picture Mode** | Full-screen, controller-first 10-foot UI with rail-aware gamepad navigation across Library, Store, News, Deals, Activity, Friends, and Community. |
| **Live Player Counts** | Combined Steam + Hydra counts with a hero banner, tabbed popover, and historical player-count graph with range toggle. |
| **i18n & Privacy** | Multi-language translation support (`LanguageContext`), theme gallery with custom accent picker, and a Privacy & Data tab to view/wipe local storage. |

> 🚧 **Planned / in progress:** Linux + Steam Deck support · Steam reviews & multi-source ratings · plugin system.

---

## 📸 Screenshots

<p align="center"><sub>Dark-first UI, captured on Windows at 1920×1080. The same interface adapts to light mode and desktop use.</sub></p>

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
  <img src="Screenshots/Store/Overview/1.png" width="32%" loading="lazy" alt="Store catalogue" />
  <img src="Screenshots/Store/Overview/2.png" width="32%" loading="lazy" alt="Store browsing with filters" />
  <img src="Screenshots/Store/Overview/3.png" width="32%" loading="lazy" alt="Store product page" />
</p>

<p>
  <img src="Screenshots/Store/Reviews/1.png" width="49%" loading="lazy" alt="Community reviews" />
  <img src="Screenshots/Store/Weblinks/1.png" width="49%" loading="lazy" alt="Web links panel" />
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

> 📁 Full sets live in [`Screenshots/`](./Screenshots) — including more Game page (10), Friends (10), Activity (5), and Store (9) shots.

---

## 💡 Inspiration

GameIndex is built *with* — not just inspired by — excellent projects in the launcher space:

- **[Hydra Launcher](https://hydralauncher.gg)** — the clean, modern approach to game distribution. GameIndex ports Hydra's public APIs for community reviews, community stats (active players, downloads, star ratings), and public download source specs (with primary storefront search & catalog powered by IGDB).
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

- [Node.js](https://nodejs.org) (≥ 18) + npm
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

### Typecheck

```bash
npx tsc --noEmit
```

---

## 📁 Project Structure

```
.
├── src/                 React + TypeScript frontend
│   ├── pages/           Top-level route components (Library, Store, News, Deals,
│   │                   Activity, Achievements, Downloads, Storage, Community,
│   │                   Friends, Wishlist, Emulators, Mods, Settings)
│   ├── components/      Feature-scoped UI (game/, library/, store/, downloads/,
│   │                   news/, activity/, charts/, bigscreen/, ui/)
│   ├── context/         Cross-cutting providers (Game, Activity, Theme, Language, ...)
│   ├── hooks/           Reusable stateful helpers
│   ├── types/           Mirrors of Rust serde models
│   └── styles/          Themed CSS
└── src-tauri/           Rust backend
    ├── src/             Tauri commands, DB DAOs, integrations
    │   ├── steam|gog|epic|rockstar|uplay|humble/   Per-store sync + auth
    │   ├── downloader/       Direct + debrid downloads & queue management
    │   ├── db/               SQLite pool + schema
    │   └── torrent_engine.rs librqbit wrapper
    └── tauri.conf.json  Frameless window + bundle config
```

For deeper architectural notes and conventions, see [`knowledge.md`](./knowledge.md).

---

## 🗺️ Roadmap

Track progress, ideas, and priorities in [`todo.md`](./todo.md). Highlights:

- ✅ Steam, GOG, Epic, Rockstar, Ubisoft, Humble library sync
- ✅ Steam achievements, HowLongToBeat, Crackwatch, live + historical player counts
- ✅ Activity dashboard with FPS + frametime charts
- ✅ Downloads engine rewrite (single-active queue, seeding, direct & debrid torrents)
- ✅ Storage manager + emulator & mod footprint breakdown
- ✅ News page with RSS feeds
- ✅ Hydra-backed storefront, community reviews & stats
- ✅ Community & Friends social layer
- ✅ Big Picture Mode (controller-first 10-foot UI with rail navigation)
- ✅ Emulators manager & ROM library tools
- ✅ Mod manager (Steam Workshop & Nexus Mods integration)
- ✅ Discord Rich Presence (playing + browsing presence, dynamic poster, launcher toggle)
- ✅ Internationalization (i18n) & language switcher
- ✅ Privacy & Data management in Settings
- ✅ Theme gallery + custom accent picker
- ✅ Steam reviews & multi-source ratings
- 🚧 Per-game launch options & compatibility profiles
- ⏳ Linux + Steam Deck support
- ⏳ Plugin system
- ⏳ Theme editor & community themes

---

## 📌 Status

> 🛠️ **Personal project, vibe-coded** — built in my free time as a learning exercise and a love-letter to PC gaming.
> Expect rough edges, breaking changes, and rapid iteration. Contributions and ideas are welcome.

---

## 🤝 Contributing

1. Read the conventions in [`knowledge.md`](./knowledge.md) (theme tokens, routing, schema migrations, etc.).
2. Fork the repo and create a feature branch.
3. Keep PRs focused and documented.
4. Run `npx tsc --noEmit` and `cargo check` before submitting.

Please open an issue before starting large changes so we can discuss direction.

---

## 📄 License

GameIndex is released under the **MIT License** — free to use, modify, and distribute, including for contributing back to the project. Attribution appreciated.

See the full text in the [`LICENSE`](./LICENSE) file.

---

## 🙏 Acknowledgments

- The Tauri, React, and Rust communities for the excellent tooling.
- IGDB, HowLongToBeat, Steam, GOG, Epic, and IsThereAnyDeal for the data.
- [Hydra Launcher](https://hydralauncher.gg) for the store catalogue, community reviews, and community stats APIs.
- Playnite and LaunchBox for the inspiration.

<div align="center">
<sub>Built with ☕ and a lot of music.</sub>
</div>
