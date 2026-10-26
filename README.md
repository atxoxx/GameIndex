<div align="center">

<picture>
  <img src="src-tauri/icons/128x128.png" alt="GameIndex logo" width="96" height="96" />
</picture>

<h1>GameIndex</h1>

<p><strong>Every PC game you own, in one launcher.</strong></p>

GameIndex is a native desktop app that gathers your Steam, GOG, Epic, Rockstar, Ubisoft, Humble and DRM-free libraries into a single place. Launch from one grid, keep playtime, achievements, saves and storage in view, and switch to a controller-first Big Picture mode when you move to the couch.

[![Status](https://img.shields.io/badge/status-active--development-yellow)](#status)
[![Platforms](https://img.shields.io/badge/platforms-Windows%20%7C%20Linux-informational)](#download-and-install)
[![Latest release](https://img.shields.io/github/v/release/atxoxx/GameIndex?label=latest&color=green)](https://github.com/atxoxx/GameIndex/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](#license)
[![Demo](https://img.shields.io/badge/demo-watch%20on%20YouTube-red)](https://youtu.be/1PnELFTXH4g)

<p>
  <a href="https://github.com/atxoxx/GameIndex/releases/latest"><img src="https://img.shields.io/badge/Download-Windows%20%7C%20Linux-2f81f7?style=for-the-badge" alt="Download the latest release" /></a>
  <a href="https://youtu.be/1PnELFTXH4g"><img src="https://img.shields.io/badge/Watch-Demo-e11d48?style=for-the-badge" alt="Watch the demo" /></a>
</p>

</div>

---

## Why people use it

- **One library instead of six clients** — Steam, GOG, Epic and the rest are imported once, then browsed as a single collection with real filters and artwork
- **It remembers what happened** — playtime, FPS and frametime per session, achievements, screenshots, clips and save snapshots
- **Nothing is locked to a store** — DRM-free folders, emulated games and store titles sit next to each other, and every entry is editable
- **Linux gets real attention** — Proton/Wine runners, prefixes, GameScope, MangoHud and Steam Deck layouts are built in
- **It stays on your machine** — library, playtime and settings live in local SQLite; store tokens go to the OS keychain

---

## Download and install

Head to the [latest release](https://github.com/atxoxx/GameIndex/releases/latest) and pick the file for your system.

| Platform | File | Notes |
|----------|------|-------|
| **Windows** | `GameIndex_<version>_x64-setup.exe` | Installer. Adds Start Menu shortcuts and in-app updates. |
| **Windows** | `GameIndex_<version>_x64_portable.exe` | Single executable, nothing to install. Updates replace the file in place and restart the app. |
| **Linux** | `GameIndex_<version>_amd64.AppImage` | `chmod +x` the file and run it. Works on most distributions and the Steam Deck. |
| **Linux** | `GameIndex_<version>_amd64.deb` | For Debian/Ubuntu and derivatives: `sudo apt install ./GameIndex_<version>_amd64.deb`. |

**Requirements:** Windows 10/11 (x64) or a modern x64 Linux distribution. Windows uses the WebView2 runtime, which ships with Windows 11 and is installed by the setup if missing. On Linux the AppImage bundles what it needs; the `.deb` pulls its dependencies through apt. There is currently **no macOS build**, and Linux support is still being ironed out — see [Linux and Steam Deck](#linux-and-steam-deck).

### First run

1. Launch the app and walk through the short setup wizard (theme, language, downloads folder, overlay). Everything there can be changed later, and the wizard can be re-run from Settings.
2. Open **Settings → Integrations** and connect what you own:
   - **Steam** needs a free [Web API key](https://steamcommunity.com/dev/apikey).
   - **GOG, Epic, Humble** sign in through an in-app browser window.
   - **Battle.net, EA, Xbox, itch.io** are available but marked beta.
3. Sync. Your games appear with covers and metadata; install state is detected from disk.
4. Have a DRM-free game folder? Drag it onto the library and the import wizard picks the executable and matches it to IGDB.

---

## Screenshots

<sub>Dark-first UI, captured on Windows and Linux at 1920×1080. Light mode and the alternate themes are included.</sub>

**Library** — one grid for every store, with scopes, filters, sorting, grouping and smart shelves.

<p>
  <img src="Screenshots/Library/1.png" width="49%" loading="lazy" alt="Library grid view" />
  <img src="Screenshots/Library/2.png" width="49%" loading="lazy" alt="Library with filters" />
</p>

**Game page** — metadata, ratings, achievements, media, DLC, maps and notes in one workspace.

<p>
  <img src="Screenshots/Game%20page/1.png" width="49%" loading="lazy" alt="Game page hero" />
  <img src="Screenshots/Game%20page/2.png" width="49%" loading="lazy" alt="Game page details" />
</p>

**Store and deals** — browse a catalogue, compare prices, and catch free games and wishlist sales.

<p>
  <img src="Screenshots/Store/1.png" width="49%" loading="lazy" alt="Store catalogue" />
  <img src="Screenshots/Deals/1.png" width="49%" loading="lazy" alt="Deals overview" />
</p>

**Activity and stats** — sessions with FPS and frametime charts, plus a personal stats dashboard.

<p>
  <img src="Screenshots/Activity/1.png" width="49%" loading="lazy" alt="Activity timeline" />
  <img src="Screenshots/Stats/1.png" width="49%" loading="lazy" alt="Stats overview" />
</p>

**Mods, emulators and saves** — a mod workbench, a retro library, and per-game save protection.

<p>
  <img src="Screenshots/Mods/1.png" width="32%" loading="lazy" alt="Mod manager" />
  <img src="Screenshots/Emulators/1.png" width="32%" loading="lazy" alt="Emulator manager" />
  <img src="Screenshots/notes/3.png" width="32%" loading="lazy" alt="Markdown notes editor" />
</p>

**Linux and Steam Deck** — Proton/Wine runners, prefixes, graphics overrides and logs.

<p>
  <img src="Screenshots/linux/1.png" width="32%" loading="lazy" alt="Proton runner management" />
  <img src="Screenshots/linux/3.png" width="32%" loading="lazy" alt="Direct3D settings" />
  <img src="Screenshots/linux/10.png" width="32%" loading="lazy" alt="Per-game compatibility settings" />
</p>

> More in [`Screenshots/`](./Screenshots): Game page (13), Linux (15), Activity (10), Friends (9), Stats (8), Deals (4), News (4).

---

## Features

### Library

- **Store sync** — Steam, GOG Galaxy, Epic, Rockstar, Ubisoft Connect and Humble Bundle out of the box; Battle.net, EA, Xbox and itch.io in beta; manual and DRM-free imports for everything else.
- **Real filtering** — scopes for playing, backlog, completed and installed, plus facets for store, genre, year, playtime, modes, perspectives and VR, with live counts.
- **Smart shelves** — save any filter combination as a shelf, pin it to the sidebar or home screen, and it stays up to date as the library changes.
- **Install state** — detects what is actually installed and where, so a store entry you uninstalled is not treated as playable.
- **Emulators and ROMs** — manage emulator platforms, ROM folders, firmware and per-ROM notes, with a health scan for missing files and duplicates.

### Game pages

- **Metadata** — IGDB details, hero art, reviews, screenshots, trailers, franchises, similar games and developer catalogues in one place.
- **Ratings & community** — Metacritic critic and user scores, IGDB, Steam reviews and HowLongToBeat in one sheet.
- **Time to Beat** ranges, live Steam player counts with history, and release/version badges when a newer build exists.
- **DLC & Add-ons** — ownership progress, prices, sales and a watchlist for Steam titles.
- **Interactive maps** from MapGenie, GameMaps, GameMappers, Wand and Game-Maps.
- **Notes** — Markdown workspace with templates, tags, search, live preview and export.
- A built-in **web links browser** for wikis and guides without leaving the app.

### Playing and tracking

- **Launch options** — arguments, run as admin, pre/post-launch scripts, companion apps and multiple executables per game.
- **Performance telemetry** — FPS, frametime, 1% and 0.1% lows from MSI Afterburner/RTSS on Windows or MangoHud on Linux, stored per session with timelines and charts.
- **Achievements** — Steam, GOG, Epic and RetroAchievements sync alongside manual lists, with rarity, unlock activity and completion shelves.
- **In-game overlay** — an always-on-top HUD with session stats, performance, notes, guides, achievements and a quick-settings pane. Off by default.
- **Screenshots and clips** — one-key captures, a rolling replay buffer, and a gallery with albums and playback. Windows records natively; Linux uses `gpu-screen-recorder`.
- **Discord Rich Presence** — shows the game you are playing, what you are browsing, or a download in progress.
- **Stats and friends** — a personal dashboard of trends and milestones, plus a local-first social layer for friends, activity and messages.

### Discovery

- **Store** — browse an IGDB-powered catalogue with filters, rails and price badges; compare up to four games side by side.
- **Deals** — live prices from Steam, GOG, Epic, Humble, Fanatical and more: best discounts, free games, ending soon, wishlist sales, Xbox Game Pass titles and giveaways.
- **Wishlist** — release countdowns, per-game notes and shareable cards.
- **News** — an RSS briefing of what arrived since your last visit, per-game news, saved stories and reading history.

### Managing the install

- **Save backups** — detects save folders (curated list, Steam Cloud, PCGamingWiki, emulator saves), snapshots them into compressed `.gisave` archives on demand or on exit, and restores with a safety copy first.
- **Mods** — installed mods, load order, conflict checks, profiles and MO2 import, plus a Discover browser across Nexus, Thunderstore, GameBanana, ModDB, CurseForge, mod.io and Steam Workshop.
- **Storage** — per-drive usage, move installs between drives, emulator and mod footprints, leftover install folders, reclaim history, and a library health center for missing paths, duplicates and stale metadata.
- **Backup and restore** — export or restore the whole app (libraries, settings, artwork) in one archive, with merge or replace modes.
- **Downloads** — an optional transfer manager for direct HTTP, debrid services and torrents, with a scheduler, speed limits, pause-on-game and queue priorities.
- **Plugins** — sandboxed QuickJS plugins that add search and download sources, with resource limits and verified installs.

### Make it yours

- **Six UI styles** (Classic, Fluent, Steam Client, Cyberdeck, Material You 3, Liquid Glass), a theme creator, adaptive accents sampled from the active game's artwork, and light/dark variants.
- **Layout Studio** — reorder nav tabs, header buttons, sidebars, page widgets and detail tabs, with viewport previews and JSON import/export.
- **Command palette** — `Ctrl+K` for games, store, actions, settings and documentation, with a preview pane and pinned commands.
- **Big Picture** — a full couch shell with Home, Library, Store, Discover, Friends and System sections and five TV layout presets (Xbox, Steam, PlayStation, Switch, GameIndex Classic).
- **Small things** — six languages, right-click menus everywhere, a resizable sidebar that folds to icons, system tray, run at login, and Simple UI mode.

---

## Linux and Steam Deck

> 🚧 **Linux support is still a work in progress.** The core flow works — sync, launch through Proton/Wine, overlay and capture — but expect rough edges. Performance tuning, WebKitGTK quirks, peripheral handling and packaging polish will keep improving over time, and detailed bug reports help more than anything else.

GameIndex treats Linux as a target platform rather than an afterthought. The compatibility layer is configurable globally and per game:

- **Runners** — detects Steam/System Wine, CachyOS, Lutris and Heroic installs; downloads GE-Proton, CachyOS, Proton-EM, Wine-GE, Kron4ek and Soda releases in-app.
- **Prefixes** — a shared prefix or one per game, `compatdata` reuse for Steam titles, clone/reset/delete, Wine tools and winetricks packages.
- **Launch pipeline** — `[gamescope] [gamemoderun] [mangohud] [umu-run | runner] game.exe` with DXVK/VKD3D, esync/fsync/ntsync, Wayland, DLL overrides and per-game environment variables.
- **Display** — GameScope (FSR/NIS, HDR, VRR, resolution and FPS limits), MangoHud logging, GameMode, GPU pinning and FPS readback into Activity.
- **Steam integration** — reversible Wine/Proton launch-option merging and Steam launch routes.
- **Diagnostics** — per-game Wine logs with a live viewer, system checks and anti-cheat runtime installs.
- **Packaging** — AppImage and `.deb` builds with matching in-app updates.

> Read the [Linux, Wine & Proton guide](./docs/linux-wine-proton.md) for the full walkthrough.

---

## Good to know

- **Antivirus warnings.** Release builds are not code-signed, so machine-learning heuristics sometimes flag the executable (typically Trapmine or Acronis "ML" scores, never a malware signature). Rust binaries with high entropy and a self-contained WebView2 bootstrap trip that pattern. The code is open — read it or build it yourself.
- **Beta integrations.** Battle.net, EA, Xbox and itch.io can change their APIs at any time and are labelled beta in the UI.
- **Overlay and capture are off by default.** Turn them on in Settings when you want them. Linux video capture additionally needs [`gpu-screen-recorder`](https://github.com/dec05eba/gpu-screen-recorder) on your `PATH`.
- **Your data stays local.** Everything lives in a SQLite database under the app data folder, and store credentials are kept in the OS keychain. Settings → Privacy & Data can wipe it all.
- **This is one person's project.** Expect rough edges and frequent changes; the in-app Guide and the [issue tracker](https://github.com/atxoxx/GameIndex/issues) are the fastest ways to get oriented.

### Documentation

| Where | What |
|-------|------|
| In-app **Guide** | Searchable docs for every feature, also available in Big Picture |
| [`docs/linux-wine-proton.md`](./docs/linux-wine-proton.md) | Runners, prefixes, GameScope, GPU pinning, logs |
| [`docs/in-game-overlay.md`](./docs/in-game-overlay.md) | Overlay HUD, hotkeys, screenshots and recording |
| [`docs/mods-discover.md`](./docs/mods-discover.md) | Mod sources, installs, profiles and conflicts |
| [`docs/plugins/README.md`](./docs/plugins/README.md) | Plugin API, manifest schema and linter |
| [Release history](https://github.com/atxoxx/GameIndex/releases) | Changelogs, also browsable in-app |
| [`knowledge.md`](./knowledge.md) | Architecture notes and implementation details for contributors |

---

## Build from source

### Prerequisites

- [Node.js](https://nodejs.org) 20.19+ or 22.12+ with npm (Vite 7 requirement)
- [Rust](https://rustup.rs) stable
- Platform dependencies from the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

```bash
npm install
npm run tauri dev      # native window with hot reload
npm run tauri build    # production bundles
```

Frontend-only iteration, with Tauri APIs stubbed:

```bash
npm run dev            # http://localhost:1420
```

### Checks

| Command | What it does |
|---------|--------------|
| `npm run typecheck` | TypeScript check (`tsc --noEmit`) |
| `npm run lint` | ESLint over `src`, zero warnings allowed |
| `npm test` | Vitest suite |
| `npm run audit:i18n` | Verifies every UI string has all six translations |
| `cargo check` | Rust backend, run inside `src-tauri/` |

`package.json` also holds scripts for plugin linting, Tauri version auditing and the AppImage build.

### Nix and NixOS

A `flake.nix` provides the Tauri runtime libraries (WebKitGTK 4.1, GTK3, D-Bus, Clang) and toolchains:

```bash
nix develop            # or: direnv allow
npm install && npm run tauri dev
```

### Project structure

```
src/                       React + TypeScript frontend
  pages/                   One folder per route (Library, Game, Store, Deals, Activity, ...)
  components/<area>/       Feature-scoped UI (game/, library/, store/, mods/, bigscreen/, ui/, ...)
  context/                 Cross-cutting providers (Game, Theme, Language, Download, ...)
  hooks/  types/  styles/  Reusable logic, Rust model mirrors, themed CSS
  bigscreen/               Big Screen sections and the five TV layout presets

src-tauri/                 Rust backend
  src/lib.rs               Tauri command registry and state setup
  src/db/                  SQLite pools, schema migrations and one DAO per table
  src/steam|gog|epic|...   Per-store auth, sync and metadata
  src/beta_stores/         Battle.net, EA, Xbox and itch.io integrations
  src/downloads/           Direct, debrid, torrent and browser-resolver transfers
  src/saves/               Save detection and .gisave snapshot engine
  src/mods/                Mod manager and multi-source Discover
  src/compatibility/       Proton/Wine runners, prefixes, GameScope
  src/overlay.rs           In-game HUD window and telemetry bridge
  src/capture/             Native recorder and replay buffer
  src/game_watcher/        Process polling and session lifecycle
  src/game_scraper/        IGDB, LaunchBox and review metadata
  tauri.conf.json          Window and bundle configuration
```

For deeper architectural notes, see [`knowledge.md`](./knowledge.md); for the conventions this repo expects, see [`AGENTS.md`](./AGENTS.md).

---

## Roadmap

Progress and priorities live in [`todo.md`](./todo.md). Currently planned or in progress:

- 🚧 Per-game performance profiles and user tags
- 🚧 Community theme browser and scheduled theme switching
- 🚧 Flatpak packaging and further backend performance work
- ⏳ Broader plugin hooks and a plugin marketplace

Recent milestones: smart shelves, mods and emulator workbenches, save protection hub, Big Screen presets, Layout Studio, six UI styles, plugin system, and the deals, news and stats rebuilds.

---

## Status

> 🛠️ **Personal project, built in free time** as a learning exercise and a love-letter to PC gaming.
> Latest release: **v1.7.0**. Expect rough edges, breaking changes and fast iteration.
> Linux support works but is still under active development; optimisation and polish will come with time.

It is not affiliated with Valve, GOG, Epic, Ubisoft, Rockstar, Humble or any other store. Store names and logos belong to their owners.

## Contributing

1. Read [`AGENTS.md`](./AGENTS.md) and [`knowledge.md`](./knowledge.md) first — they cover theme tokens, routing, schema migrations and the command boundary.
2. Open an issue before large changes so the direction can be discussed.
3. Keep pull requests focused. Run `npm run typecheck`, `npm run lint` and `cargo check` before submitting, and add a happy-path and an error-path test for new behaviour.

## Disclaimer

- **If you like a game, buy it** from an official store so the money reaches the people who made it.
- Use GameIndex in accordance with the laws of your country.

## License

Released under the **MIT License** — free to use, modify and distribute. See [`LICENSE`](./LICENSE).

## Acknowledgments

- [Tauri](https://tauri.app), [React](https://react.dev) and [Rust](https://www.rust-lang.org) for the tooling.
- IGDB, HowLongToBeat, Steam, GOG, Epic, IsThereAnyDeal and PCGamingWiki for the data.
- [Hydra Launcher](https://hydralauncher.gg), [Playnite](https://playnite.com) and [LaunchBox](https://www.launchbox-app.com) for showing what a launcher can be.

<div align="center">
<sub>Built with ☕ and a lot of music.</sub>
</div>
