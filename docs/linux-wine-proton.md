# Linux, Wine & Proton — Feature Guide

GameIndex treats Linux as a first-class platform: native Linux games launch directly, Windows titles
run through Wine or Proton, and the compatibility layer is fully configurable — globally and per game —
from inside the launcher.

This document lists every Linux / Wine / Proton feature in detail. For screenshots, see the
[Linux & Steam Deck section of the README](../README.md#-linux--steam-deck--proton--wine); for the
historical design notes and build prerequisites, see [`plans/Linux.md`](../plans/Linux.md).

---

## Table of contents

1. [At a glance](#at-a-glance)
2. [Enabling the Linux UI](#enabling-the-linux-ui)
3. [Runner management](#runner-management)
4. [Prefix management](#prefix-management)
5. [Launch pipeline](#launch-pipeline)
6. [Graphics translation (DXVK / VKD3D)](#graphics-translation-dxvk--vkd3d)
7. [Synchronization engine](#synchronization-engine)
8. [Gamescope compositor](#gamescope-compositor)
9. [Gaming tools & overlays](#gaming-tools--overlays)
10. [GPU pinning](#gpu-pinning)
11. [Environment variables & DLL overrides](#environment-variables--dll-overrides)
12. [Steam games under Proton](#steam-games-under-proton)
13. [Wine / Proton logs](#wine--proton-logs)
14. [Performance metrics on Linux](#performance-metrics-on-linux)
15. [Process tracking & force close](#process-tracking--force-close)
16. [System diagnostics & maintenance](#system-diagnostics--maintenance)
17. [Emulators & ROMs on Linux](#emulators--roms-on-linux)
18. [App updates & packaging on Linux](#app-updates--packaging-on-linux)
19. [Compatibility data, backup & file locations](#compatibility-data-backup--file-locations)
20. [App-level Linux / WebKitGTK notes](#app-level-linux--webkitgtk-notes)
21. [Troubleshooting](#troubleshooting)

---

## At a glance

| Area | What GameIndex provides |
|------|-------------------------|
| **Runners** | Auto-detects Steam Proton, CachyOS Proton, community Proton builds, Lutris/Heroic/system Wine; downloads GE-Proton, CachyOS, Proton-EM, Wine-GE, Kron4ek and Soda releases from GitHub; installs from local archives; uninstalls user-installed runners. |
| **Prefixes** | Shared default WINEPREFIX for all games or isolated per-game prefixes, prefix inspection (arch, validity, Wine version, disk size, linked games), create / duplicate / delete / reset / import, Wine tools and winetricks verbs, Steam `compatdata` reuse. |
| **Graphics** | DXVK (D3D9/10/11), VKD3D-Proton (D3D12), DXVK-NVAPI/DLSS, DXVK async shader compilation, DXVK HUD presets, Wine virtual desktop. |
| **Sync & CPU** | Esync, Fsync, NTsync/WineSync, native Wayland driver, new WoW64 mode, large-address-aware flag, WINEDEBUG level, audio backend. |
| **Display** | Gamescope micro-compositor with structured settings (modes, render/output resolutions, FSR/NIS/linear/nearest/integer upscaling, sharpness, FPS limit, refresh rate, adaptive sync, HDR, stretch, force Windows fullscreen), plus MangoHud and Feral GameMode. |
| **GPU** | Per-game or global GPU selection mapped to Mesa, Vulkan loader, DXVK and PRIME/NVIDIA offload variables. |
| **Steam integration** | Steam `compatdata` prefixes, reversible Wine/Proton launch options merged into `localconfig.vdf`, Steam client routes and the launch-options picker. |
| **Logs & diagnostics** | Per-game Wine/Proton log capture (including `PROTON_LOG` for Steam launches), live log viewer, Linux system diagnostics, runner maintenance. |
| **Packaging** | AppImage and `.deb` bundles with in-app auto-update support; Windows titles routed through Wine/Proton from either build. |

---

## Enabling the Linux UI

Linux compatibility is available on every platform but **gated by the Linux support level** so
Windows/macOS users don't see settings they can't use.

| Setting | Where | Behavior |
|---------|-------|----------|
| **Linux support level** | Settings → General → Linux | `disabled` — hides everything; `deck_verified` — shows Deck-oriented surfaces; `full` — exposes the complete Proton/Wine UI. Linux hosts default to `full`, other platforms to `disabled`. |
| **Full Linux UI** | Derived (`showFullLinuxUi`) | `isLinuxHost || linuxSupportLevel === "full"`. When off, the global **Proton / Wine** settings tab and the per-game **Proton / Wine** tab are hidden (the game tab falls back to Details), and the Wine Logs entry points disappear. |
| **Global settings** | Settings → System → Proton / Wine | Eight sub-tabs: Runner Management & Prefixes, Prefix Manager, Direct3D & Graphics Translation, Synchronization Engine, Gamescope Compositor, Gaming Tools & Overlays, Environment Variables & DLL Overrides, Linux System Diagnostics. |
| **Per-game overrides** | Game page → Edit → Proton / Wine | Five sub-tabs: Runner & Prefix, Graphics & Direct3D, Tools & Overlays, Environment & Overrides, Maintenance & Prefix Tools. Every boolean override is tri-state (**Global / On / Off**) with a `Settings: On/Off` hint showing the inherited global value. |

The per-game compatibility tab is **enabled by default for `.exe` files on Linux hosts**; on other
platforms it stays off until you turn it on. Saved per-game settings always win over the default.

---

## Runner management

A *runner* is a Wine or Proton build that executes Windows binaries. GameIndex never requires a
system-wide install — it can download and manage its own runners.

### Detection

Runners are discovered live from the usual Linux locations:

- **Steam:** `~/.steam/steam`, `~/.local/share/Steam`, Flatpak
  (`~/.var/app/com.valvesoftware.Steam/...`) and Snap roots, plus every secondary library listed in
  `steamapps/libraryfolders.vdf`.
- **Steam compatibility tools:** `steamapps/common/Proton*`, every `compatibilitytools.d` directory
  (including `/usr/share/steam/compatibilitytools.d`) and CachyOS `.vdf` manifests.
- **Community/manager installs:** Lutris, Heroic (Wine and Proton), and generic user runner folders
  such as `~/.local/share/runners/wine` and `~/.local/share/proton-runners`.
- **GameIndex-managed:** `~/.local/share/GameIndex/runners/{proton,wine}`.
- **System Wine:** `wine` from `PATH` (marked non-deletable because it's package-managed).

Each runner card shows its name, kind (`proton`, `ge-proton`, `cachyos`, `wine`), detected version,
install path and disk size.

### Kinds

| Kind | Meaning |
|------|---------|
| `proton` | Steam Proton builds (`steamapps/common/Proton*`). |
| `ge-proton` | Community builds from `compatibilitytools.d`. |
| `cachyos` | CachyOS Proton builds (version parsed from the folder name). |
| `wine` | Plain Wine builds (Lutris, Heroic, GameIndex, system Wine). |
| `custom` | Runner binaries referenced by an explicit path. |

### Downloadable runner sources

Settings → Proton / Wine → **Download Runners** lists GitHub releases for:

| Source | Repository | Installs as |
|--------|------------|-------------|
| GE-Proton | `GloriousEggroll/proton-ge-custom` | Steam compatibility tool (Proton) |
| CachyOS Proton | `CachyOS/proton-cachyos` | Proton |
| Proton-EM | `BananaWorks07/Proton` | Proton |
| Wine-GE | `GloriousEggroll/wine-ge-custom` | Wine |
| Kron4ek Wine-Builds | `Kron4ek/Wine-Builds` | Wine |
| Soda (Bottles) | `bottlesdevs/wine` | Wine |
| Custom Direct URL | any archive URL you paste | Proton or Wine (you choose) |

- Release lists are cached for 15 minutes; **Refresh Releases** forces a re-fetch.
- The correct architecture asset is selected automatically (`x86_64` vs `aarch64`), and checksum
  files are skipped.
- Installs stream to disk with a live progress bar (bytes, percent, speed) and can be **cancelled**
  mid-download. Extraction progress is reported separately.
- Already-installed releases show an **Installed** badge and offer **Reinstall**.
- **Install from Archive…** installs a local `.tar.gz`, `.tar.xz`, `.tar.zst` or `.zip` runner
  (useful for offline machines).

### Default runner

- **Default Compatibility Runner** (Prefix & Runner Paths view): pick any detected runner, a custom
  binary path, or leave it on **Auto-detect (System Wine / Steam Proton)**.
- **Rescan Runners** re-runs detection; **Set as Default** promotes any runner card.
- **Uninstall** removes user-installed runners only; system- and Steam-managed runners are protected.

---

## Prefix management

A Wine prefix is a self-contained Windows environment (`drive_c`, registry, `system.reg`). GameIndex
tracks all of them and can create, clone and repair them.

### Which prefix a game uses

Resolution precedence for a direct launch:

1. **Per-game `customWinePrefix`** (set in Edit → Proton / Wine → Runner & Prefix).
2. **Global shared default prefix** (`defaultPrefix`) — a single prefix shared by every game that
   doesn't override it.
3. **Configured base directory** (`defaultPrefixBaseDir`, defaults to
   `~/.local/share/GameIndex/wineprefixes`) joined with the game id — one isolated prefix per game.

Steam titles default to Steam's own `steamapps/compatdata/<appid>/pfx` prefix instead, unless you set
a custom per-game prefix or a global default.

### Prefix Manager

Settings → Proton / Wine → **Prefix Manager** lists every discoverable prefix with:

- health indicator (valid / invalid), architecture (`win64` / `win32`), Proton badge, Wine version,
  disk size, last-modified date;
- **Game-Linked / Standalone** filters, architecture filters, and sorting by name, size, date or
  linked-game count;
- linked-game chips (which library entries resolve to that prefix).

Actions per prefix:

| Action | What it does |
|--------|--------------|
| **Winecfg** | Opens the Wine configuration applet in that prefix. |
| **Winetricks** | Opens winetricks inside the prefix. |
| **Packages** | Quick-install panel with common winetricks verbs: `dxvk`, `vkd3d`, `vcrun2022`, `vcrun2019`, `vcrun2010`, `dotnet48`, `dotnet472`, `corefonts`, `allfonts`, `faudio`, `d3dcompiler_47`, `physx`. |
| **Open Folder** | Opens the prefix root, `drive_c`, AppData or Documents. |
| **Tools** | Registry Editor, Task Manager, Control Panel, Wine `cmd`. |
| **Set as Default** | Makes the prefix the shared default for all games. |
| **Duplicate** | Clones a prefix into an independent copy (useful as a backup or a modded variant). |
| **Reset / Wipe** | Clears the prefix contents and re-initializes it with `wineboot -u`. |
| **Delete** | Removes the prefix folder and unregisters it. |
| **Remove from List** | For imported prefixes: unregisters without touching files on disk. |

Toolbar actions: **Create Prefix** (name, `win64`/`win32`, optional custom path, runner),
**Import Existing Prefix** (register a prefix you already have), **Open Base Directory**,
**Refresh**, **Kill Wineserver** (`wineserver -k`).

> Deleting or resetting the shared default prefix warns you first; game-linked prefixes list their
> associated games in the confirmation dialog.

---

## Launch pipeline

When a game is launched through the compatibility layer, GameIndex composes a single command line
from the enabled layers:

```
[gamescope <args> --] [gamemoderun] [mangohud] (umu-run | <runner> [run]) \
    [explorer.exe /desktop=GameIndex,<resolution>] <game exe> [launch args]
```

- **Gamescope** wraps everything when enabled; `--` separates compositor args from the game.
- **gamemoderun** requests the performance CPU governor.
- **mangohud** is added only when it is on `PATH`; for Steam launches, `MANGOHUD=1` is passed through
  the environment instead of a wrapper.
- **umu-run** runs Proton outside Steam (see [Gaming tools](#gaming-tools--overlays)); otherwise the
  selected runner executes with `run` for Proton tools.
- **Virtual desktop** uses `explorer.exe /desktop=GameIndex,<WxH>` when enabled.
- Arguments are shell-split safely, and quoted arguments survive the trip into Wine.

After spawning, GameIndex registers the session with the process watcher and starts metrics
collection (see [Performance metrics](#performance-metrics-on-linux)).

---

## Graphics translation (DXVK / VKD3D)

Settings → Proton / Wine → **Direct3D & Graphics Translation** (and the per-game
**Graphics & Direct3D** tab):

| Setting | Default | Effect |
|---------|---------|--------|
| **DXVK** (D3D9/10/11 → Vulkan) | On | `d3d9`, `d3d10core`, `dxgi`, `d3d11` are added to `WINEDLLOVERRIDES` as native/builtin. |
| **VKD3D-Proton** (D3D12 → Vulkan) | On | `d3d12` native/builtin override. |
| **DXVK-NVAPI / DLSS** | Off | `DXVK_ENABLE_NVAPI=1` for DLSS/Reflex support on NVIDIA. |
| **DXVK Async** | Off | `DXVK_ASYNC=1` — compiles shaders asynchronously to reduce in-game stutter. |
| **DXVK HUD** | Disabled | Overlay preset written to `DXVK_HUD`: `fps`, `fps,devinfo,memory`, `full`, `compiler`. |
| **Virtual Desktop** | Off | Runs the game inside a Wine desktop window to avoid resolution-switching problems; resolution defaults to `1920x1080`. |

Per-game controls are tri-state: leave on **Global** to inherit, or force **On**/**Off**. The
inheritance pill (e.g. `Settings: On`) shows what the global value currently is.

---

## Synchronization engine

Settings → Proton / Wine → **Synchronization Engine**:

| Setting | Default | Env |
|---------|---------|-----|
| **Esync** (eventfd) | On | `WINEESYNC=1` |
| **Fsync** (futex) | On | `WINEFSYNC=1` |
| **NTsync / WineSync** (kernel driver) | Off | `WINESYNC=1`, `WINENTSYNC=1` |
| **Wineland** (native Wayland driver) | Off | `WINE_ENABLE_WAYLAND=1` (plus `PROTON_ENABLE_WAYLAND` for Proton) |
| **New WoW64 Mode** (pure 64-bit) | Off | `WINE_NEW_WOW64=1` (`PROTON_USE_WOW64` for Steam env) |
| **Large Address Aware** | Off | `WINE_LARGE_ADDRESS_AWARE=1` — lets 32-bit games address 4 GB. |
| **Wine Debug Channels** | Disabled (`-all`) | `WINEDEBUG` — presets for warnings, fixmes, DLL loads or full relay, plus a per-game free-form value. |
| **Audio Backend** | Auto | `WINEAUDIODRIVER` — `pulse`, `alsa`, `oss`. |

---

## Gamescope compositor

The **Gamescope Compositor** tab exposes a structured editor rather than raw flags. The whole
configuration appears once **Enable Gamescope Micro-Compositor** is on:

| Option | Choices |
|--------|---------|
| **Window mode** | Fullscreen (`-f`), Borderless (`-b`), Windowed |
| **Render resolution (`-w` `-h`)** | Width/height inputs + 720p / 1080p / 1440p / 4K presets |
| **Display output resolution (`-W` `-H`)** | Width/height inputs + 1080p / 1440p / 4K presets |
| **Upscaling filter** | AMD FSR, NVIDIA NIS, Linear, Nearest, Integer Scaling |
| **FSR sharpness** | 0–20 slider (shown for FSR) |
| **Frame rate limit (`-r`)** | Off / 30 / 40 / 60 / 120 / 144 FPS pills |
| **Display refresh rate (`-o`)** | Off / 60 / 120 / 144 / 165 / 240 Hz pills |
| **Adaptive sync** | `--adaptive-sync` (VRR / FreeSync / G-Sync) |
| **HDR output** | `--hdr-enabled` |
| **Stretch aspect ratio** | `-s` |
| **Force Windows fullscreen** | Per-game option (`--force-windows-fullscreen`) |
| **Additional arguments** | Free-form args (default `-w 1920 -h 1080 -F fsr -f`) |

Per-game, the same options are available as overrides with inherited global hints, including raw
arguments. When GameIndex manages gamescope it also creates a stats FIFO so FPS can be read back into
the Activity dashboard (see [Performance metrics](#performance-metrics-on-linux)).

---

## Gaming tools & overlays

Settings → Proton / Wine → **Gaming Tools & Overlays** (and per-game **Tools & Overlays**):

| Tool | What it enables |
|------|-----------------|
| **MangoHud** | In-game overlay for FPS, frametimes, temperatures, CPU/GPU/RAM usage. A **Hide MangoHud by Default** option sets `no_display` so logging still happens invisibly. GameIndex configures `MANGOHUD_CONFIG` for CSV logging automatically. |
| **UMU-Launcher** | Runs Proton titles inside Valve's Steam Runtime container *without* launching Steam. `GAMEID=umu-<game_id>`, `STORE=none`, `PROTONPATH=<proton folder>` are set automatically; GameIndex finds `umu-run` on `PATH` or in the usual `~/.local/share/umu` / `/usr/share/umu` locations. |
| **Controller Support** | Prefers Proton's SDL gamepad backend (`PROTON_PREFER_SDL=1`), which fixes controller detection for some titles. |
| **Anti-Cheat Support** | Adds the Easy Anti-Cheat (`PROTON_EAC_RUNTIME`) and BattlEye (`PROTON_BATTLEYE_RUNTIME`) runtime paths when found. A **Install Runtimes** button downloads missing runtimes from the Lutris runtime index into GameIndex's own folder. |
| **Feral GameMode** | Prefixes the launch with `gamemoderun`. |
| **Discrete GPU Offload (PRIME / NVIDIA)** | Sets `DRI_PRIME=1` and the NVIDIA PRIME offload variables. |

---

## GPU pinning

On multi-GPU systems (hybrid laptops, handhelds, eGPUs) GameIndex can pin a game to a specific GPU.

- **Global:** Settings → Hardware → choose the GPU; enable **Use Specific GPU**.
- **Per-game:** Graphics & Direct3D → **Use Specific GPU** tri-state (Global / On / Off) overrides
  the global choice for that title.

The selection is translated into all relevant selectors, because different stacks honor different
variables:

| Variable | Purpose |
|----------|---------|
| `DXVK_FILTER_DEVICE_UUID` | Precise DXVK filter by Vulkan device UUID (disambiguates identical GPUs). |
| `MESA_VK_DEVICE_SELECT`, `VK_LOADER_DEVICE_SELECT` | Mesa / Vulkan loader device selection. |
| `VULKAN_DEVICE_INDEX`, `ENABLE_DEVICE_CHOOSER_LAYER` | `vkdevicechooser`-style index selection. |
| `DRI_PRIME=pci-...` | Mesa PRIME render offload for the selected PCI slot. |
| `__NV_PRIME_RENDER_OFFLOAD`, `__GLX_VENDOR_LIBRARY_NAME`, `__NV_PRIME_RENDER_OFFLOAD_PROVIDER`, `__VK_LAYER_NV_optimus` | NVIDIA PRIME offload (works alongside X and Wayland). |

Pinning also enables the Wayland driver, since the offload variables propagate reliably under
Wayland. Native Linux games receive the same environment when a specific GPU is selected.

---

## Environment variables & DLL overrides

### Global (Settings → Environment Variables & DLL Overrides)

- **Environment variables** — arbitrary `KEY=value` pairs applied to every compatibility launch,
  e.g. `MANGOHUD_CONFIG=cpu_temp,gpu_temp`.
- **DLL overrides** — `WINEDLLOVERRIDES` entries with the standard Wine modes:
  `n,b` (native then builtin), `b,n` (builtin then native), `n` (native only), `b` (builtin only),
  `d` (disabled).

DXVK/VKD3D automatically add their default overrides (without overwriting your entries).

### Per-game (Edit → Proton / Wine → Environment & Overrides)

- **Inherited global variables / overrides** are listed with an **Exclude** toggle so a single game
  can opt out, plus **Remove from Global** to delete them everywhere.
- **Game-specific variables and DLL overrides** are merged on top of the globals.
- A **Pre-Launch Wrapper Command** field prefixes the launch with any command
  (e.g. `taskset -c 0-7` or `prime-run`).

Exclusion lists are persisted with the per-game profile: `excludedGlobalEnv` and
`excludedGlobalDlls`.

---

## Steam games under Proton

Steam is a special case, and GameIndex is careful not to fight the client.

### Prefixes

Steam-managed Proton prefixes (`steamapps/compatdata/<appid>/pfx`) are reused automatically — the
launcher points `STEAM_COMPAT_DATA_PATH` at the `compatdata/<appid>` directory when it exists. Set a
custom prefix or a shared default for a Steam title to override this.

### Launch options (`localconfig.vdf`)

When Wine/Proton settings need to reach a game that is launched **through Steam**, GameIndex can merge
managed flags into the game's `LaunchOptions` string:

- Flags include sync settings, DXVK/VKD3D, DLL overrides, Wayland/WoW64/LAA, controller and
  anti-cheat runtimes, GPU offload, MangoHud, `PROTON_LOG` and gamescope/gamemoderun wrappers.
- The merge is token-aware: only environment keys managed by GameIndex are replaced — your own
  wrappers, arguments and variables are preserved.
- The previous application is tracked (`steam.launchOptions.applied.<appid>`), so disabling a setting
  removes exactly the flags GameIndex added.
- A one-time backup (`localconfig.vdf.gameindex.bak`) is written before the first edit, and the file
  is replaced atomically.
- Edits are **skipped while Steam is running** (Steam holds the config in memory and would overwrite
  changes on exit). GameIndex offers a **launch-options picker**
  (`steam://launch/<appid>/dialog`) for manual selection too.

### Launch routes

| Route | When | What happens |
|-------|------|--------------|
| **Direct `.exe`** | Managed flags differ from Steam's defaults, the title resolves to a real `.exe`, and Steam is running. | GameIndex launches the executable through the compatibility layer with `SteamAppId`/`SteamGameId`/`SteamPath` set, so Steamworks and DRM still see a running client (and the log is captured). |
| **Steam CLI** | Steam must handle the launch itself. | GameIndex starts `steam -nobigpicture -nochatui -nofriendsui -silent` with the environment (`steam_launch_env`) and `-applaunch <id>`, or falls back to `steam://run/<id>`. |
| **Launch-options picker** | You requested manual selection. | Opens Steam's own launch dialog; managed flags are persisted for the next client start. |

`steam_launch_env()` deliberately **never** sets `WINEPREFIX`, `PROTONPATH` or
`STEAM_COMPAT_DATA_PATH` — Steam owns those for its own launches.

---

## Wine / Proton logs

GameIndex captures every compatibility launch:

- **Direct launches** write `<app_data>/wine_logs/<game_id>.log`, starting with a header that records
  the game, timestamp, exe, runner, prefix and the enabled features (sync, DXVK, Wayland, GPU, HUD,
  UMU, GameMode, Gamescope, controller / anti-cheat).
- **Steam launches** get a per-game folder `<app_data>/wine_logs/<game_id>/` and Proton's own log
  (`steam-<appid>.log`) via `PROTON_LOG=1` + `PROTON_LOG_DIR`. The folder is refreshed on each launch,
  and `steam-<appid>.log` is read when no direct log exists yet.

The **Wine / Proton Compatibility Logs** modal (game page → Wine Logs, or quick actions) provides:

- live tailing every 1.5 s with a **Live / Paused** toggle;
- a line filter (e.g. `err`, `dxvk`, `crash`) and colorized lines for errors, warnings, DXVK/VKD3D/
  gamescope/MangoHud messages and session headers;
- a **Verbose** selector (global default, `-all`, `warn+all`, `fixme-all`, `+loaddll`, `all`) that
  saves directly to the per-game profile and applies on the next launch;
- auto-scroll that only sticks while you're at the bottom;
- the full log path with a copy button, plus **Refresh**, **Copy Log**, **Export…** (save dialog or
  browser fallback) and **Clear**.

---

## Performance metrics on Linux

Session metrics (Activity page) are collected without any Windows-only tooling:

| Metric | Source |
|--------|--------|
| **FPS** | MangoHud CSV logs (`$XDG_DATA_HOME/MangoHud`, last 64 KiB of the newest file modified in the last 90 s) or the Gamescope stats FIFO that GameIndex creates (`$XDG_RUNTIME_DIR/gameindex-gamescope-stats.fifo`). |
| **CPU** | `/proc/stat` delta. |
| **RAM** | `/proc/meminfo` (`MemAvailable`). |
| **GPU usage / VRAM / temp** | AMD: `amdgpu` sysfs (`gpu_busy_percent`, `mem_info_vram_total`, hwmon). NVIDIA: `nvidia-smi` queried by PCI slot. |
| **CPU temp** | Highest `coretemp` / `k10temp` / `zenpower` hwmon reading. |

MangoHud logging is configured by GameIndex (`read_cfg,log_interval=1000,autostart_log=1`, plus
`no_display` when MangoHud is set to hidden), so the overlay doesn't have to be visible for FPS to be
recorded. Gamescope FPS is read from its stats FIFO and cached between writes.

---

## Process tracking & force close

- Linux session tracking reads `/proc`: it resolves each process's executable (handling the wrapper
  chain `gamescope → gamemoderun → mangohud → runner → game.exe`) and follows child processes via
  `ppid`, so a Wine/Proton game is detected even though the visible process is the runner.
- A session stays alive while the tracked executable (or a matching descendant) is running; path
  normalization is POSIX-aware and case-insensitive where needed.
- **Force close** sends `SIGTERM` to every matching process, waits briefly, then `SIGKILL`s survivors
  — with a guard against killing recycled PIDs, and a safety limit on install-folder sweeps.

---

## System diagnostics & maintenance

Settings → Proton / Wine → **Linux System Diagnostics** probes the machine and reports:

- OS & kernel, display server (Wayland / X11), Vulkan availability;
- GameMode, MangoHud, Gamescope, Winetricks, UMU-Launcher;
- Easy Anti-Cheat and BattlEye runtime availability.

**Runner Maintenance** can kill all running Wine/Proton processes and launch `winecfg`, `winetricks`,
`regedit` or `taskmgr` on demand.

---

## Emulators & ROMs on Linux

- GameIndex ships **native Linux builds** for many emulators used in the Emulators tab: RetroArch,
  PCSX2, PPSSPP, DuckStation, Cemu, Snes9x, mGBA, Flycast, Redream, shadPS4, Vita3K, melonDS,
  Mupen64Plus, xemu, FBNeo, BlastEm and Azahar (AppImages, tarballs or zips).
- Installation handles missing executable bits (common with AppImage extraction) and finds the
  executable inside nested archives, including AppImage name variants.
- **Flatpak, Snap, AppImage and system binaries are discovered** for emulator executables and ROM
  folders; symlinked Flatpak exports are followed.
- Emulators that only ship Windows builds run through the same Wine/Proton path as games.
- ROM archives (`.zip`/`.7z`) are passed directly to emulators that read them, or extracted on demand
  for those that don't.

---

## App updates & packaging on Linux

- Linux ships as an **AppImage** and a **`.deb`**.
- In Settings → General, GameIndex classifies how it was installed and only offers updates through
  the matching channel: AppImage updates replace the AppImage file, `.deb` updates install the new
  package — both handled by the Tauri updater plugin; other bundles (RPM, etc.) are treated as
  manual/unsupported and don't surface an update prompt.
- Update checks are quiet for unsupported installs, so no launch ever tries to install another
  platform's artifact.
- **Release History** (same settings section) opens a browsable changelog fetched straight from the
  project's GitHub releases, with installed/latest badges and links.

---

## Compatibility data, backup & file locations

Per-game compatibility profiles and global settings persist in their own `compatibility.db` domain
(`compatibility_settings`, `game_compatibility`, `compatibility_runners`). The **Backup** settings tab
includes the full compatibility domain (global settings, per-game profiles, installed runner records).
Prefixes and logs themselves are intentionally not archived.

| What | Default location |
|------|------------------|
| GameIndex runners | `~/.local/share/GameIndex/runners/<kind>` |
| Steam compatibility tools | `~/.local/share/Steam/compatibilitytools.d` (first existing Steam root) |
| Prefix base directory | `~/.local/share/GameIndex/wineprefixes/<game_id>` |
| Shared default prefix | wherever you point `defaultPrefix` |
| Anti-cheat runtimes | `~/.local/share/GameIndex/anticheat` |
| Wine logs | `<app_data_dir>/wine_logs/…` |
| MangoHud logs | `$XDG_DATA_HOME/MangoHud` (`~/.local/share/MangoHud`) |
| Gamescope stats FIFO | `$XDG_RUNTIME_DIR/gameindex-gamescope-stats.fifo` |

---

## App-level Linux / WebKitGTK notes

These are handled automatically and listed here for transparency:

- **NVIDIA explicit sync:** `__NV_DISABLE_EXPLICIT_SYNC=1` is set on startup to fix torn frames and
  black rectangles on NVIDIA + Wayland. The variable is a no-op on AMD/Intel.
- **Wayland backend:** `GDK_BACKEND=wayland,x11` is set when unset, so the app prefers Wayland but
  falls back to X11. AppImage launcher hooks that force `x11` are corrected when a Wayland session is
  detected.
- **AppImage Python env:** the AppImage's bundled `PYTHONHOME`/`PYTHONPATH`/`LD_LIBRARY_PATH` entries
  are stripped from child processes, so games and tools don't accidentally load the AppImage's Python.
- **Blur performance:** on Linux the frontend drops `backdrop-filter` from full-window, sticky and
  other large surfaces (small pills/badges keep their blur), because WebKitGTK renders large blurs far
  more slowly than WebView2/Chromium.
- **Native select popups, resize repaint and child-webview positioning** all have Linux-specific
  handling so the frameless window and in-app preview webviews behave.

---

## Troubleshooting

| Symptom | What to check |
|---------|---------------|
| Game doesn't start at all | Open **Wine Logs** and check the session header (runner, prefix, flags) plus the first error lines. Verify a runner is selected and the prefix is valid in Prefix Manager. |
| Prefix errors after a crash | Prefix Manager → **Reset / Wipe** (re-runs `wineboot -u`), or duplicate the prefix first to keep a copy. |
| Controllers not detected | Enable **Controller Support** (`PROTON_PREFER_SDL`) for the game. |
| Anti-cheat games fail | Enable **Anti-Cheat Support** and install the EAC/BattlEye runtimes from the same card; not every game is supported by the runtimes. |
| Stutter / shader compilation hitches | Enable **DXVK Async**, or pre-warm shaders. |
| No FPS in Activity | Make sure the game launches through GameIndex's compatibility layer (MangoHud logging and the Gamescope FIFO are configured at launch) and that the overlay/logging settings are on. |
| HDR / VRR not working | Enable them in **Gamescope Compositor**; Gamescope must be the active compositor and the display must support the mode. |
| Settings don't apply to a Steam-launched game | Steam must be closed while GameIndex writes `localconfig.vdf`; check the launch route and the **Wine Logs** header, or use the launch-options picker. |
| Wrong GPU used | Set the GPU in Settings → Hardware and enable **Use Specific GPU**, or override per game. |

---

For deeper implementation details, see the Linux & Steam Deck compatibility section in
[`knowledge.md`](../knowledge.md#linux--steam-deck-compatibility).
