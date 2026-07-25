# LINUX_WAYLAND_BUILD_GUIDE.md
# GameIndex — Linux Wayland Build, Proton/Wine, Webview Fix & CPU Optimisations
# Generated: 2026-07-25 | Target: Tauri v2 + React 19 + Vite 7
# Repo: https://github.com/atxoxx/GameIndex

---

## Table of Contents

1. [Linux Wayland Build](#1-linux-wayland-build)
   - 1.1 System Dependencies
   - 1.2 Cargo.toml — Platform-Gate Windows-Only Crates
   - 1.3 main.rs — WebKitGTK + NVIDIA + Wayland Env Vars
   - 1.4 lib.rs — Wayland Focus Workaround
   - 1.5 game_watcher.rs — /proc Process Scanner (Linux)
   - 1.6 gpu_detector.rs — Linux GPU Detection via /sys/class/drm
   - 1.7 Steam Path Detection on Linux
   - 1.8 tauri.conf.json — Linux Bundle Config
   - 1.9 capabilities/default.json — Missing Permissions
2. [Proton / Wine Integration](#2-proton--wine-integration)
   - 2.1 proton.rs — Full Module
   - 2.2 Tauri Commands for Proton/Wine
   - 2.3 Frontend .exe Routing Through Proton
   - 2.4 Settings UI — Proton/Wine Selector
3. [Webview Fix — Drag Region & Resize](#3-webview-fix--drag-region--resize)
   - 3.1 TopNav.tsx — data-tauri-drag-region
   - 3.2 CSS — no-drag for Interactive Children
   - 3.3 ResizeHandles.tsx — Invisible Edge/Corner Handles
   - 3.4 App.tsx — Mount ResizeHandles
   - 3.5 CSS — Viewport Fill (dvh/dvw)
   - 3.6 WebKitGTK Resize Repaint Fix
   - 3.7 WindowControls.tsx — Linux-Aware Rendering
4. [CPU Optimisations](#4-cpu-optimisations)
   - 4.1 Pause CSS Animations on visibilitychange
   - 4.2 prefers-reduced-motion
   - 4.3 Adaptive Polling (5s → 30s When Idle)
   - 4.4 Debounced onResized
   - 4.5 Vite Build — Terser + drop_console
   - 4.6 spawn_blocking + nice(10)
5. [File Manifest](#5-file-manifest)
6. [Appendix A — Quick-Start Checklist](#appendix-a--quick-start-checklist)
7. [Appendix B — Environment Variable Reference](#appendix-b--environment-variable-reference)
8. [Appendix C — Sources & References](#appendix-c--sources--references)

---

## 1. Linux Wayland Build

### 1.1 System Dependencies

Install the required system packages **before** running `cargo build` or `npm run tauri dev`.

**Debian / Ubuntu:**
```bash
sudo apt update && sudo apt install -y \
  build-essential pkg-config \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libssl-dev \
  libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev \
  libglib2.0-dev \
  libgdk-pixbuf-2.0-dev \
  libpango1.0-dev \
  libatk1.0-dev \
  libcairo2-dev \
  libxdo-dev \
  libsecret-1-dev \
  procps \
  wget file
```

**Arch Linux:**
```bash
sudo pacman -S --needed --noconfirm \
  base-devel pkgconf \
  webkit2gtk-4.1 \
  gtk3 \
  libayatana-appindicator \
  librsvg \
  openssl \
  libsoup3 \
  javascriptcoregtk-4.1 \
  glib2 \
  gdk-pixbuf2 \
  pango \
  atk \
  cairo \
  libxdo \
  libsecret \
  procps-ng \
  wget file
```

**Fedora:**
```bash
sudo dnf install -y \
  gcc gcc-c++ make pkg-config \
  webkit2gtk4.1-devel \
  gtk3-devel \
  libayatana-appindicator-gtk3-devel \
  librsvg2-devel \
  openssl-devel \
  libsoup3-devel \
  javascriptcoregtk-4.1-devel \
  glib2-devel \
  gdk-pixbuf2-devel \
  pango-devel \
  atk-devel \
  cairo-devel \
  libxdo-devel \
  libsecret-devel \
  procps-ng \
  wget file
```

> **Source:** [Tauri v2 Linux Prerequisites](https://v2.tauri.app/start/prerequisites/#linux)

---

### 1.2 Cargo.toml — Platform-Gate Windows-Only Crates

**File:** `src-tauri/Cargo.toml`

The current `Cargo.toml` lists `windows`, `winreg`, and `wmi` under `[dependencies]` unconditionally. These crates **will not compile on Linux**. Move them to a platform-specific section.

**REMOVE** these three entries from `[dependencies]`:
```toml
# ❌ REMOVE from [dependencies]:
wmi = "0.14"
winreg = "0.52"
windows = { version = "0.58", features = ["Win32_System_Memory", "Win32_System_Threading", "Win32_Foundation", "Win32_UI_Shell", "Win32_UI_WindowsAndMessaging", "Win32_System_Registry", "Win32_System_Diagnostics_ToolHelp", "Win32_System_ProcessStatus", "Win32_Storage_FileSystem"] }
```

**ADD** a new platform-specific section at the end of `Cargo.toml`:
```toml
# ── Windows-only dependencies ──────────────────────────────────────
# These crates use Win32 APIs (WMI, Registry, ToolHelp32) and cannot
# compile on Linux/macOS. Cargo will not download them on non-Windows.
[target.'cfg(windows)'.dependencies]
wmi = "0.14"
winreg = "0.52"
windows = { version = "0.58", features = [
  "Win32_System_Memory",
  "Win32_System_Threading",
  "Win32_Foundation",
  "Win32_UI_Shell",
  "Win32_UI_WindowsAndMessaging",
  "Win32_System_Registry",
  "Win32_System_Diagnostics_ToolHelp",
  "Win32_System_ProcessStatus",
  "Win32_Storage_FileSystem",
] }

# ── Linux-only dependencies ────────────────────────────────────────
# procfs: read /proc/<pid>/cmdline + /proc/<pid>/exe for process
# detection (replaces WMI Win32_Process on Linux).
[target.'cfg(target_os = "linux")'.dependencies]
procfs = "0.17"
libc = "0.2"
```

> **Source:** [Cargo Book — Platform Specific Dependencies](https://doc.rust-lang.org/cargo/reference/specifying-dependencies.html#platform-specific-dependencies)

---

### 1.3 main.rs — WebKitGTK + NVIDIA + Wayland Env Vars

**File:** `src-tauri/src/main.rs`

WebKitGTK on Wayland (especially NVIDIA) crashes or renders black unless env vars are set **before** GTK init. Replace the entire file:

```rust
// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // ── Linux / Wayland / WebKitGTK workarounds ──────────────────
    // MUST be set before any GTK / WebKitGTK initialisation.
    // Tauri's run() calls gtk::init() internally.
    //
    // Source: https://github.com/tauri-apps/tauri/issues/9216
    // Source: https://gitlab.gnome.org/GNOME/webkit/-/issues/268
    #[cfg(target_os = "linux")]
    {
        // NVIDIA + Wayland + DMA-BUF → black/flickering webview.
        // Forces CPU-fallback compositing. No-op on AMD/Intel (Mesa).
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }

        // NVIDIA explicit-sync on Wayland → torn frames, black rects.
        // Source: https://forums.developer.nvidia.com/t/wayland-issues/286716
        if std::env::var("__NV_DISABLE_EXPLICIT_SYNC").is_err() {
            std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
        }

        // Force GDK to prefer Wayland, fallback to X11 (XWayland).
        if std::env::var("GDK_BACKEND").is_err() {
            std::env::set_var("GDK_BACKEND", "wayland,x11");
        }

        // WebKitGTK 2.44+ threaded GPU compositing can deadlock on
        // Wayland + NVIDIA. Disable → single-threaded path.
        // Source: https://gitlab.gnome.org/GNOME/webkit/-/issues/272
        if std::env::var("WEBKIT_DISABLE_COMPOSITING_MODE").is_err() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }

        // Disable NVIDIA GLX threading workaround (conflicts with GTK).
        if std::env::var("__GL_THREADED_OPTIMIZATIONS").is_err() {
            std::env::set_var("__GL_THREADED_OPTIMIZATIONS", "0");
        }
    }

    gameindex_lib::run()
}
```

> **Source:** [Tauri #9216 — Black screen Linux/Wayland/NVIDIA](https://github.com/tauri-apps/tauri/issues/9216)

---

### 1.4 lib.rs — Wayland Focus Workaround

**File:** `src-tauri/src/lib.rs`

On Wayland, WebKitGTK windows don't receive keyboard focus on show. Add inside `.setup()`, right after `tray::build_tray(...)`:

```rust
        // ── Wayland focus workaround ─────────────────────────────
        // Source: https://github.com/tauri-apps/tauri/issues/8104
        #[cfg(target_os = "linux")]
        {
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(300));
                if let Some(win) = handle.get_webview_window("main") {
                    let _ = win.set_focus();
                }
            });
        }
```

---

### 1.5 game_watcher.rs — /proc Process Scanner (Linux)

**File:** `src-tauri/src/game_watcher.rs`

The current implementation uses WMI (`Win32_Process`) — Windows-only. Add a Linux implementation using the `procfs` crate.

**Add import at top:**
```rust
#[cfg(target_os = "linux")]
use procfs::process::all_processes;
```

**Add Linux scanner function:**
```rust
/// Linux process scanner using /proc filesystem.
/// Replaces WMI Win32_Process query on Linux.
/// Source: https://docs.rs/procfs/0.17/procfs/process/fn.all_processes.html
#[cfg(target_os = "linux")]
pub fn scan_running_processes() -> Vec<(u32, String, String)> {
    let mut results: Vec<(u32, String, String)> = Vec::new();
    for proc in all_processes() {
        let Ok(proc) = proc else { continue };
        let pid = proc.pid() as u32;
        let cmdline = match proc.cmdline() {
            Ok(cl) if !cl.is_empty() => cl,
            _ => continue,
        };
        let exe_path = cmdline[0].clone();
        // Resolve via /proc/<pid>/exe symlink (handles Proton wrappers)
        let resolved_exe = proc.exe()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| exe_path.clone());
        results.push((pid, resolved_exe, exe_path));
    }
    results
}

/// Windows process scanner (existing WMI implementation).
#[cfg(windows)]
pub fn scan_running_processes() -> Vec<(u32, String, String)> {
    // ... keep existing WMI Win32_Process implementation unchanged ...
    todo!()
}
```

**Add Linux process matcher:**
```rust
/// On Linux, match by: exact path, install-dir prefix, or basename
/// in cmdline (covers Proton/Wine where .exe name appears in argv).
#[cfg(target_os = "linux")]
fn matches_game_process(
    resolved_exe: &str,
    cmdline_exe: &str,
    game: &GameRef,
) -> bool {
    if let Some(ref exe) = game.exe_path {
        if resolved_exe == *exe || cmdline_exe == *exe { return true; }
    }
    if let Some(ref dir) = game.install_dir {
        if resolved_exe.starts_with(dir.as_str())
            || cmdline_exe.starts_with(dir.as_str()) { return true; }
    }
    if let Some(ref exe) = game.exe_path {
        let bn = std::path::Path::new(exe)
            .file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if !bn.is_empty() && cmdline_exe.to_lowercase().contains(&bn) {
            return true;
        }
    }
    false
}
```

> **Source:** [procfs crate](https://docs.rs/procfs/0.17/procfs/) · [proc(5)](https://man7.org/linux/man-pages/man5/proc.5.html)

---

### 1.6 gpu_detector.rs — Linux GPU Detection via /sys/class/drm

**File:** `src-tauri/src/gpu_detector.rs`

Current implementation is WMI-only. Wrap existing `detect_gpus()` in `#[cfg(windows)]` and add:

```rust
#[cfg(target_os = "linux")]
use std::fs;
#[cfg(target_os = "linux")]
use std::path::Path;

/// Detect GPUs on Linux via /sys/class/drm/card*/device.
/// Source: https://www.kernel.org/doc/html/latest/gpu/drm-uapi.html
#[cfg(target_os = "linux")]
pub fn detect_gpus() -> Vec<GpuInfo> {
    let mut gpus = Vec::new();
    let drm = Path::new("/sys/class/drm");
    if !drm.exists() { return gpus; }
    let Ok(entries) = fs::read_dir(drm) else { return gpus; };
    let mut idx = 0u32;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with("card") || name.contains('-') { continue; }
        let dev = entry.path().join("device");
        if !dev.exists() { continue; }
        let vendor_id = fs::read_to_string(dev.join("vendor"))
            .map(|s| s.trim().to_string()).unwrap_or_default();
        let uevent = fs::read_to_string(dev.join("uevent")).unwrap_or_default();
        let driver = uevent.lines()
            .find(|l| l.starts_with("DRIVER="))
            .map(|l| l.trim_start_matches("DRIVER=").to_string())
            .unwrap_or_default();
        let pci_slot = uevent.lines()
            .find(|l| l.starts_with("PCI_SLOT_NAME="))
            .map(|l| l.trim_start_matches("PCI_SLOT_NAME=").to_string())
            .unwrap_or_default();
        let vendor = match vendor_id.as_str() {
            "0x10de" => "NVIDIA", "0x1002" => "AMD",
            "0x8086" => "Intel", _ => "Unknown",
        };
        let gpu_name = if vendor == "NVIDIA" {
            nvidia_name_linux(&pci_slot)
        } else {
            format!("{} GPU ({})", vendor, pci_slot)
        };
        let vram_mb = if vendor == "NVIDIA" {
            nvidia_vram_linux()
        } else {
            estimate_vram_from_name(&gpu_name)
        };
        gpus.push(GpuInfo {
            id: format!("gpu-{}", idx), name: gpu_name,
            vendor: vendor.to_string(), vram_mb,
        });
        idx += 1;
    }
    gpus
}

/// Read NVIDIA GPU name from /proc/driver/nvidia/gpus/*/information
#[cfg(target_os = "linux")]
fn nvidia_name_linux(_pci: &str) -> String {
    let base = Path::new("/proc/driver/nvidia/gpus");
    if let Ok(entries) = fs::read_dir(base) {
        for e in entries.flatten() {
            if let Ok(info) = fs::read_to_string(e.path().join("information")) {
                if let Some(line) = info.lines().find(|l| l.starts_with("Model:")) {
                    let m = line.trim_start_matches("Model:").trim().to_string();
                    if !m.is_empty() { return m; }
                }
            }
        }
    }
    "NVIDIA GPU".to_string()
}

/// Read NVIDIA VRAM from /proc/driver/nvidia/gpus/*/information
#[cfg(target_os = "linux")]
fn nvidia_vram_linux() -> u64 {
    let base = Path::new("/proc/driver/nvidia/gpus");
    if let Ok(entries) = fs::read_dir(base) {
        for e in entries.flatten() {
            if let Ok(info) = fs::read_to_string(e.path().join("information")) {
                if let Some(line) = info.lines().find(|l| l.contains("Total Memory:")) {
                    let digits: String = line.chars().filter(|c| c.is_ascii_digit()).collect();
                    if let Ok(mb) = digits.parse::<u64>() { return mb; }
                }
            }
        }
    }
    0
}
```

> **Source:** [NVIDIA proc interface](https://download.nvidia.com/XFree86/Linux-x86_64/560.35.03/README/procinterface.html)

---

### 1.7 Steam Path Detection on Linux

**File:** `src-tauri/src/steam/mod.rs` (or wherever Steam paths are resolved)

```rust
/// Returns the Steam installation directory for the current platform.
pub fn steam_install_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    { /* ... keep existing Windows registry-based detection ... */ }

    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").ok()?;
        let home = PathBuf::from(home);
        // Priority: native → Flatpak → Snap
        let candidates = [
            home.join(".steam/steam"),
            home.join(".local/share/Steam"),
            home.join(".var/app/com.valvesoftware.Steam/.steam/steam"),
            home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"),
            PathBuf::from("/snap/steam/common/.steam/steam"),
        ];
        for c in &candidates {
            if c.join("steamapps").exists() { return Some(c.clone()); }
        }
        None
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").ok()?;
        let p = PathBuf::from(home).join("Library/Application Support/Steam");
        p.exists().then_some(p)
    }
}

/// Parse libraryfolders.vdf for additional Steam library paths.
#[cfg(target_os = "linux")]
pub fn steam_library_folders() -> Vec<PathBuf> {
    let mut folders = Vec::new();
    if let Some(steam) = steam_install_dir() {
        let primary = steam.join("steamapps");
        if primary.exists() { folders.push(primary.clone()); }
        let vdf = primary.join("libraryfolders.vdf");
        if let Ok(content) = std::fs::read_to_string(&vdf) {
            for line in content.lines() {
                let t = line.trim();
                if t.starts_with("\"path\"") {
                    if let Some(p) = t.split('"').nth(3).map(|s| s.replace("\\\\", "/")) {
                        let lib = PathBuf::from(&p).join("steamapps");
                        if lib.exists() && !folders.contains(&lib) {
                            folders.push(lib);
                        }
                    }
                }
            }
        }
    }
    folders
}
```

> **Source:** [Arch Wiki — Steam](https://wiki.archlinux.org/title/Steam) · [Flatpak Steam](https://flathub.org/apps/com.valvesoftware.Steam)

---

### 1.8 tauri.conf.json — Linux Bundle Config

**File:** `src-tauri/tauri.conf.json`

Replace the `bundle` section:
```json
{
  "bundle": {
    "active": true,
    "targets": ["deb", "rpm", "appimage"],
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "category": "Game",
    "shortDescription": "Unified game library manager",
    "longDescription": "Unify Steam, GOG, Epic, Rockstar, Ubisoft, and DRM-free libraries.",
    "linux": {
      "deb": {
        "depends": [
          "libwebkit2gtk-4.1-0",
          "libgtk-3-0",
          "libayatana-appindicator3-1"
        ]
      }
    }
  }
}
```

> **Source:** [Tauri v2 BundleConfig](https://v2.tauri.app/reference/config/#bundleconfig)

---

### 1.9 capabilities/default.json — Missing Permissions

**File:** `src-tauri/capabilities/default.json`

The current file is **missing** permissions required for drag, resize, and focus. Add these to the `permissions` array:

```json
"core:window:allow-start-dragging",
"core:window:allow-start-resize-dragging",
"core:window:allow-set-focus",
"core:window:allow-set-size",
"core:window:allow-set-position",
"core:window:allow-outer-size",
"core:window:allow-inner-size",
"core:window:allow-scale-factor"
```

Full updated permissions array:
```json
"permissions": [
  "core:default",
  "opener:default",
  { "identifier": "opener:allow-open-url", "allow": [{ "url": "steam://**" }] },
  { "identifier": "opener:allow-open-path", "allow": [{ "path": "**" }] },
  "dialog:default",
  "core:webview:allow-create-webview",
  "core:webview:allow-create-webview-window",
  "core:webview:allow-webview-close",
  "core:webview:allow-set-webview-position",
  "core:webview:allow-set-webview-size",
  "core:webview:allow-webview-hide",
  "core:webview:allow-webview-show",
  "core:window:allow-minimize",
  "core:window:allow-maximize",
  "core:window:allow-unmaximize",
  "core:window:allow-close",
  "core:window:allow-is-maximized",
  "core:window:allow-toggle-maximize",
  "core:window:allow-start-dragging",
  "core:window:allow-start-resize-dragging",
  "core:window:allow-set-focus",
  "core:window:allow-set-size",
  "core:window:allow-set-position",
  "core:window:allow-outer-size",
  "core:window:allow-inner-size",
  "core:window:allow-scale-factor",
  "core:event:allow-emit",
  "core:tray:default",
  "core:menu:default"
]
```

> **Source:** [Tauri v2 Window Permissions](https://v2.tauri.app/reference/javascript/api/namespacewindow/)

---

## 2. Proton / Wine Integration

### 2.1 proton.rs — Full Module

**File:** `src-tauri/src/proton.rs` (NEW FILE)

Detection order: Steam Proton → GE-Proton → System Wine → Lutris → Bottles.

```rust
//! Proton / Wine integration for Linux.
//! Source: https://github.com/ValveSoftware/Proton#running-a-game

use serde::Serialize;
use std::path::PathBuf;
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtonInstall {
    pub name: String,
    pub path: String,
    /// "proton" | "ge-proton" | "wine" | "lutris" | "bottles"
    pub kind: String,
    pub version: Option<String>,
}

pub fn detect_proton_installs() -> Vec<ProtonInstall> {
    let mut installs = Vec::new();

    // 1. Steam Proton (steamapps/common/Proton *)
    if let Some(steam) = crate::steam::steam_install_dir() {
        let common = steam.join("steamapps/common");
        if let Ok(entries) = std::fs::read_dir(&common) {
            for e in entries.flatten() {
                let n = e.file_name().to_string_lossy().to_string();
                if n.starts_with("Proton") {
                    let script = e.path().join("proton");
                    if script.exists() {
                        installs.push(ProtonInstall {
                            name: n.clone(),
                            path: script.to_string_lossy().to_string(),
                            kind: "proton".into(),
                            version: Some(n.trim_start_matches("Proton ").trim_start_matches("Proton-").to_string()),
                        });
                    }
                }
            }
        }
        // 2. GE-Proton (compatibilitytools.d)
        let compat = steam.join("compatibilitytools.d");
        if let Ok(entries) = std::fs::read_dir(&compat) {
            for e in entries.flatten() {
                let n = e.file_name().to_string_lossy().to_string();
                if n.starts_with("GE-Proton") || n.starts_with("Proton-GE") {
                    let script = e.path().join("proton");
                    if script.exists() {
                        installs.push(ProtonInstall {
                            name: n.clone(), path: script.to_string_lossy().to_string(),
                            kind: "ge-proton".into(), version: Some(n),
                        });
                    }
                }
            }
        }
    }

    // 3. System Wine
    if let Ok(out) = Command::new("which").arg("wine").output() {
        if out.status.success() {
            let wp = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !wp.is_empty() {
                let ver = Command::new("wine").arg("--version").output().ok()
                    .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
                installs.push(ProtonInstall {
                    name: format!("System Wine ({})", ver.as_deref().unwrap_or("?")),
                    path: wp, kind: "wine".into(), version: ver,
                });
            }
        }
    }

    let home = std::env::var("HOME").unwrap_or_default();

    // 4. Lutris runners
    let lutris = PathBuf::from(&home).join(".local/share/lutris/runners/wine");
    if let Ok(entries) = std::fs::read_dir(&lutris) {
        for e in entries.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            let bin = e.path().join("bin/wine");
            if bin.exists() {
                installs.push(ProtonInstall {
                    name: format!("Lutris: {}", n), path: bin.to_string_lossy().to_string(),
                    kind: "lutris".into(), version: Some(n),
                });
            }
        }
    }

    // 5. Bottles runners
    let bottles = PathBuf::from(&home).join(".local/share/bottles/runners");
    if let Ok(entries) = std::fs::read_dir(&bottles) {
        for e in entries.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            let bin = e.path().join("bin/wine");
            if bin.exists() {
                installs.push(ProtonInstall {
                    name: format!("Bottles: {}", n), path: bin.to_string_lossy().to_string(),
                    kind: "bottles".into(), version: Some(n),
                });
            }
        }
    }

    installs.sort_by_key(|i| match i.kind.as_str() {
        "proton" => 0, "ge-proton" => 1, "wine" => 2, "lutris" => 3, _ => 4,
    });
    installs
}

/// Launch a Windows .exe through Proton/Wine.
/// Per-game WINEPREFIX: ~/.local/share/GameIndex/wineprefixes/<game_id>/
/// Source: https://wiki.winehq.org/Wine_User%27s_Guide#WINEPREFIX
pub fn launch_with_proton(
    proton_path: &str, exe_path: &str,
    game_id: &str, working_dir: Option<&str>,
) -> Result<u32, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME not set")?;
    let prefix = PathBuf::from(&home)
        .join(".local/share/GameIndex/wineprefixes").join(game_id);
    std::fs::create_dir_all(&prefix)
        .map_err(|e| format!("WINEPREFIX mkdir: {}", e))?;

    let is_proton = proton_path.contains("proton") && !proton_path.ends_with("wine");
    let child = if is_proton {
        let mut cmd = Command::new(proton_path);
        cmd.arg("run").arg(exe_path);
        cmd.env("WINEPREFIX", &prefix);
        cmd.env("STEAM_COMPAT_DATA_PATH", &prefix);
        cmd.env("STEAM_COMPAT_CLIENT_INSTALL_PATH",
            crate::steam::steam_install_dir()
                .map(|p| p.to_string_lossy().to_string()).unwrap_or_default());
        if let Some(wd) = working_dir { cmd.current_dir(wd); }
        cmd.spawn()
    } else {
        let mut cmd = Command::new(proton_path);
        cmd.arg(exe_path).env("WINEPREFIX", &prefix);
        if let Some(wd) = working_dir { cmd.current_dir(wd); }
        cmd.spawn()
    };
    child.map(|c| c.id()).map_err(|e| format!("launch: {}", e))
}

pub fn default_proton() -> Option<ProtonInstall> {
    detect_proton_installs().into_iter().next()
}
```

**Register in `lib.rs`:**
```rust
#[cfg(target_os = "linux")]
mod proton;
```

> **Source:** [ValveSoftware/Proton](https://github.com/ValveSoftware/Proton) · [GE-Proton](https://github.com/GloriousEggroll/proton-ge-custom) · [Wine WINEPREFIX](https://wiki.winehq.org/Wine_User%27s_Guide#WINEPREFIX)

---

### 2.2 Tauri Commands for Proton/Wine

**File:** `src-tauri/src/lib.rs` — add these commands:

```rust
#[tauri::command]
#[cfg(target_os = "linux")]
fn list_proton_installs() -> Vec<proton::ProtonInstall> {
    proton::detect_proton_installs()
}

#[tauri::command]
#[cfg(target_os = "linux")]
fn launch_with_proton(
    proton_path: String, exe_path: String,
    game_id: String, working_dir: Option<String>,
) -> Result<u32, String> {
    proton::launch_with_proton(&proton_path, &exe_path, &game_id, working_dir.as_deref())
}

#[tauri::command]
#[cfg(target_os = "linux")]
fn get_default_proton() -> Option<proton::ProtonInstall> {
    proton::default_proton()
}
```

**Register in `generate_handler!`:**
```rust
#[cfg(target_os = "linux")] list_proton_installs,
#[cfg(target_os = "linux")] launch_with_proton,
#[cfg(target_os = "linux")] get_default_proton,
```

---

### 2.3 Frontend .exe Routing Through Proton

**File:** `src/hooks/useGameLaunch.ts` (NEW FILE)

```typescript
import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";

interface ProtonInstall {
  name: string; path: string; kind: string; version: string | null;
}

/**
 * Launch a game, routing .exe files through Proton/Wine on Linux.
 * Windows: calls launch_game directly (existing behaviour).
 * Linux + .exe: detects best Proton/Wine, launches through it.
 */
export async function launchGameSmart(
  gameId: string, gamePath: string,
  gameName: string, launchArgs?: string,
): Promise<void> {
  const plat = await platform();

  if (plat === "linux" && gamePath.toLowerCase().endsWith(".exe")) {
    const proton = await invoke<ProtonInstall | null>("get_default_proton");
    if (!proton) {
      throw new Error(
        "No Proton or Wine found. Install Steam Proton, GE-Proton, or Wine."
      );
    }
    const wd = gamePath.substring(0, gamePath.lastIndexOf("/")) ||
               gamePath.substring(0, gamePath.lastIndexOf("\\"));
    const pid = await invoke<number>("launch_with_proton", {
      protonPath: proton.path, exePath: gamePath, gameId, workingDir: wd,
    });
    console.log(`[GameIndex] Launched "${gameName}" via ${proton.name} (PID ${pid})`);
    return;
  }

  // Windows / native Linux: existing path
  await invoke("launch_game", { gameId, path: gamePath, args: launchArgs || "" });
}
```

---

### 2.4 Settings UI — Proton/Wine Selector

**File:** `src/pages/SettingsPage.tsx` — add section (Linux-only):

```tsx
import { platform } from "@tauri-apps/plugin-os";

function ProtonSettings() {
  const [installs, setInstalls] = useState<ProtonInstall[]>([]);
  const [selected, setSelected] = useState("");
  const [isLinux, setIsLinux] = useState(false);

  useEffect(() => {
    platform().then((p) => {
      setIsLinux(p === "linux");
      if (p === "linux") {
        invoke<ProtonInstall[]>("list_proton_installs").then((list) => {
          setInstalls(list);
          if (list.length > 0) setSelected(list[0].path);
        });
      }
    });
  }, []);

  if (!isLinux) return null;

  return (
    <section className="settings-section">
      <h3>Proton / Wine (Linux)</h3>
      <p className="settings-description">
        Compatibility layer for Windows (.exe) games.
      </p>
      {installs.length === 0 ? (
        <p className="settings-warning">
          No Proton/Wine detected. Install Steam Proton or Wine.
        </p>
      ) : (
        <select value={selected} onChange={(e) => setSelected(e.target.value)}
                className="settings-select">
          {installs.map((p) => (
            <option key={p.path} value={p.path}>{p.name} ({p.kind})</option>
          ))}
        </select>
      )}
    </section>
  );
}
```

---

## 3. Webview Fix — Drag Region & Resize

### 3.1 TopNav.tsx — data-tauri-drag-region

**File:** `src/components/TopNav.tsx`

The `<nav>` element **must** have `data-tauri-drag-region` for frameless window dragging. Interactive children need `data-tauri-drag-region="false"`.

```tsx
// Find the <nav> element in the return JSX. Change:
//   <nav className="topnav">
// To:
<nav
  className="topnav"
  data-tauri-drag-region
  onDoubleClick={handleDoubleClick}
>

// For EVERY NavLink inside the nav, add the attribute:
<NavLink
  to={tab.path}
  className={({ isActive }) => `topnav-tab ${isActive ? "active" : ""}`}
  data-tauri-drag-region="false"
>

// For the download button:
<button
  ref={downloadBtnRef}
  className="topnav-icon-btn"
  data-tauri-drag-region="false"
  onClick={() => setDownloadsOpen((o) => !o)}
>

// Wrap WindowControls:
<div className="window-controls" data-tauri-drag-region="false">
  <WindowControls />
</div>
```

> **Source:** [Tauri v2 — Define a Drag Region](https://v2.tauri.app/learn/window-customization/#define-a-drag-region)

---

### 3.2 CSS — no-drag for Interactive Children

**File:** `src/App.css` — add:

```css
/* ── Drag region: interactive element opt-out ─────────────────── */
[data-tauri-drag-region] {
  -webkit-app-region: drag;
  app-region: drag;
}
[data-tauri-drag-region] button,
[data-tauri-drag-region] a,
[data-tauri-drag-region] input,
[data-tauri-drag-region] select,
[data-tauri-drag-region] textarea,
[data-tauri-drag-region] [role="button"],
[data-tauri-drag-region] [role="tab"],
[data-tauri-drag-region] [role="menuitem"],
[data-tauri-drag-region] .no-drag {
  -webkit-app-region: no-drag;
  app-region: no-drag;
}
```

---

### 3.3 ResizeHandles.tsx — Invisible Edge/Corner Handles

**File:** `src/components/ResizeHandles.tsx` (NEW FILE)

On Linux with `decorations: false`, the compositor provides NO resize borders. This component renders 8 invisible handles.

```tsx
import { useCallback, useEffect, useState } from "react";
import { getCurrentWindow, type ResizeDirection } from "@tauri-apps/api/window";
import { platform } from "@tauri-apps/plugin-os";

const H = 6;   // edge handle thickness (px)
const C = 12;  // corner handle size (px)

const HANDLES: { dir: ResizeDirection; style: React.CSSProperties }[] = [
  { dir: "North",     style: { top: 0, left: C, right: C, height: H, cursor: "n-resize" } },
  { dir: "South",     style: { bottom: 0, left: C, right: C, height: H, cursor: "s-resize" } },
  { dir: "West",      style: { left: 0, top: C, bottom: C, width: H, cursor: "w-resize" } },
  { dir: "East",      style: { right: 0, top: C, bottom: C, width: H, cursor: "e-resize" } },
  { dir: "NorthWest", style: { top: 0, left: 0, width: C, height: C, cursor: "nw-resize" } },
  { dir: "NorthEast", style: { top: 0, right: 0, width: C, height: C, cursor: "ne-resize" } },
  { dir: "SouthWest", style: { bottom: 0, left: 0, width: C, height: C, cursor: "sw-resize" } },
  { dir: "SouthEast", style: { bottom: 0, right: 0, width: C, height: C, cursor: "se-resize" } },
];

export default function ResizeHandles() {
  const [isLinux, setIsLinux] = useState(false);
  useEffect(() => { platform().then((p) => setIsLinux(p === "linux")); }, []);

  const onDown = useCallback(
    (dir: ResizeDirection) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      getCurrentWindow().startResizeDragging(dir).catch(console.warn);
    }, []
  );

  if (!isLinux) return null; // Windows has native resize borders

  return (
    <>
      {HANDLES.map((h) => (
        <div key={h.dir} className="resize-handle"
          style={{ position: "fixed", zIndex: 9999, ...h.style }}
          onMouseDown={onDown(h.dir)} />
      ))}
    </>
  );
}
```

**Also add to `capabilities/default.json`:**
```json
"core:window:allow-start-resize-dragging"
```

> **Source:** [Tauri #6762 — Resize frameless on Linux](https://github.com/tauri-apps/tauri/issues/6762) · [startResizeDragging](https://v2.tauri.app/reference/javascript/api/namespacewindow/#startresizedragging)

---

### 3.4 App.tsx — Mount ResizeHandles

**File:** `src/App.tsx`

```tsx
import ResizeHandles from "./components/ResizeHandles";

// In App() return, add as sibling to <HashRouter>:
function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        {/* ...existing providers... */}
        <HashRouter>
          <AppShell />
        </HashRouter>
        <Splashscreen />
        <ResizeHandles />
      </LanguageProvider>
    </ThemeProvider>
  );
}
```

---

### 3.5 CSS — Viewport Fill (dvh/dvw)

**File:** `src/App.css`

```css
/* ── Root viewport fill ───────────────────────────────────────── */
/* dvh/dvw account for compositor decorations on Wayland. */
:root { --app-h: 100vh; --app-w: 100vw; }
@supports (height: 100dvh) {
  :root { --app-h: 100dvh; --app-w: 100dvw; }
}
html, body, #root {
  margin: 0; padding: 0;
  width: var(--app-w); height: var(--app-h);
  overflow: hidden;
  overscroll-behavior: none; /* prevent bounce on Wayland */
}
.app-shell {
  width: 100%; height: 100%;
  display: grid;
  grid-template-rows: auto 1fr;
  grid-template-columns: auto 1fr;
  overflow: hidden;
}
```

> **Source:** [MDN — Dynamic viewport units](https://developer.mozilla.org/en-US/docs/Web/CSS/length#dynamic)

---

### 3.6 WebKitGTK Resize Repaint Fix

**File:** `src-tauri/src/lib.rs` — add inside `.on_window_event()`:

```rust
        // ── WebKitGTK resize repaint fix ─────────────────────────
        // On Wayland, WebKitGTK sometimes doesn't repaint after
        // resize (black borders). Force a layout recalc.
        // Source: https://github.com/tauri-apps/tauri/issues/8904
        #[cfg(target_os = "linux")]
        if let WindowEvent::Resized(_) = event {
            if window.label() == "main" {
                let win = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(100));
                    let _ = win.eval("window.dispatchEvent(new Event('resize'))");
                });
            }
        }
```

---

### 3.7 WindowControls.tsx — Linux-Aware Rendering

**File:** `src/components/WindowControls.tsx`

On tiling WMs (sway, i3, Hyprland), the maximize button is useless. Hide it:

```tsx
import { platform } from "@tauri-apps/plugin-os";

// Inside the component:
const [isTiling, setIsTiling] = useState(false);
useEffect(() => {
  platform().then((p) => {
    if (p === "linux") {
      // Heuristic: check XDG_CURRENT_DESKTOP for known tiling WMs
      const desktop = (window as any).__TAURI_INTERNALS__
        ? "" : navigator.userAgent; // fallback
      // Better: read env via Tauri command
      setIsTiling(false); // default; refine with env check
    }
  });
}, []);

// In JSX, conditionally render maximize:
{!isTiling && (
  <button onClick={handleToggleMaximize}
    title={isMaximized ? t("window.restore") : t("window.maximize")}>
    {/* existing icon */}
  </button>
)}
```

---

## 4. CPU Optimisations

### 4.1 Pause CSS Animations on visibilitychange

**File:** `src/App.tsx` — add at top level:

```tsx
useEffect(() => {
  const handler = () => {
    document.documentElement.classList.toggle("animations-paused", document.hidden);
  };
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
}, []);
```

**File:** `src/App.css`:
```css
/* Pause all animations when window is hidden/minimized */
.animations-paused *,
.animations-paused *::before,
.animations-paused *::after {
  animation-play-state: paused !important;
  transition: none !important;
}
```

> **Source:** [MDN — visibilitychange](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event)

---

### 4.2 prefers-reduced-motion

**File:** `src/App.css`:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

> **Source:** [MDN — prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)

---

### 4.3 Adaptive Polling (5s → 30s When Idle)

**File:** `src-tauri/src/game_watcher.rs`

Replace the fixed 5s poll interval:

```rust
pub fn start_background_poll(watcher: Arc<Mutex<GameWatcher>>, handle: AppHandle) {
    std::thread::spawn(move || {
        loop {
            let interval = {
                let w = watcher.lock().unwrap();
                let active = !w.active_sessions.is_empty();
                drop(w);
                if active {
                    Duration::from_secs(5)   // games running → fast poll
                } else {
                    let focused = handle.get_webview_window("main")
                        .and_then(|win| win.is_focused().ok())
                        .unwrap_or(false);
                    if focused {
                        Duration::from_secs(15)  // idle but visible
                    } else {
                        Duration::from_secs(30)  // background / minimized
                    }
                }
            };
            std::thread::sleep(interval);
            // ... existing poll logic ...
        }
    });
}
```

> **Source:** [Tauri #5170 — High CPU from polling](https://github.com/tauri-apps/tauri/issues/5170)

---

### 4.4 Debounced onResized

**File:** `src/components/WindowControls.tsx`

Replace the `onResized` subscription with a debounced version:

```tsx
useEffect(() => {
  let cancelled = false;
  let unlisten: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  (async () => {
    try {
      const win = getCurrentWindow();
      const initial = await win.isMaximized();
      if (!cancelled) setIsMaximized(initial);

      unlisten = await win.onResized(async () => {
        if (cancelled) return;
        // Debounce: 150ms after last resize event
        if (timer) clearTimeout(timer);
        timer = setTimeout(async () => {
          if (cancelled) return;
          try { setIsMaximized(await win.isMaximized()); } catch {}
        }, 150);
      });

      if (cancelled && unlisten) { unlisten(); unlisten = undefined; }
    } catch {}
  })();

  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
    if (unlisten) { try { unlisten(); } catch {} }
  };
}, []);
```

---

### 4.5 Vite Build — Terser + drop_console

**File:** `vite.config.ts`

```bash
npm install -D terser
```

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1500,
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: true,    // strip all console.* in prod
        drop_debugger: true,
        pure_getters: true,
        passes: 2,
      },
      mangle: { safari10: true },
      format: { comments: false },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("nostr-tools")) return "nostr";
            if (id.includes("html2canvas")) return "html2canvas";
            if (id.includes("qrcode")) return "qrcode";
            if (id.includes("@tauri-apps")) return "tauri";
            if (id.includes("react-dom") || id.includes("react-router")
              || id.includes("/react/") || id.includes("scheduler"))
              return "react-vendor";
            return "vendor";
          }
        },
      },
    },
  },
  clearScreen: false,
  server: {
    port: 1420, strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
```

> **Source:** [Vite build.minify](https://vite.dev/config/build-options.html#build-minify) · [Terser options](https://terser.org/docs/options/#compress-options)

---

### 4.6 spawn_blocking + nice(10)

**File:** `src-tauri/src/lib.rs` — add helper:

```rust
/// Run CPU-intensive work on Tokio's blocking pool at reduced priority.
/// Prevents UI jank during folder scans, size calc, process enum.
/// Source: https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html
pub async fn run_low_priority<F, R>(f: F) -> R
where F: FnOnce() -> R + Send + 'static, R: Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        #[cfg(target_os = "linux")]
        unsafe { libc::nice(10); }  // lower priority (range -20..19)

        #[cfg(windows)]
        {
            use windows::Win32::System::Threading::*;
            unsafe {
                let _ = SetThreadPriority(
                    GetCurrentThread(), THREAD_PRIORITY_BELOW_NORMAL);
            }
        }
        f()
    }).await.expect("spawn_blocking panicked")
}
```

**Usage example:**
```rust
#[tauri::command]
async fn detect_game_size(path: String) -> Result<u64, String> {
    run_low_priority(move || { /* existing size calc */ }).await
}
```

> **Source:** [Tokio spawn_blocking](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html) · [nice(2)](https://man7.org/linux/man-pages/man2/nice.2.html)

---

## 5. File Manifest

| # | File | Action | Section |
|---|------|--------|---------|
| 1 | `src-tauri/Cargo.toml` | MODIFY — move `windows`/`winreg`/`wmi` to `[target.'cfg(windows)']`, add `procfs`/`libc` to `[target.'cfg(target_os = "linux")']` | §1.2, §4.6 |
| 2 | `src-tauri/src/main.rs` | REPLACE — WebKitGTK/NVIDIA/Wayland env vars | §1.3 |
| 3 | `src-tauri/src/lib.rs` | MODIFY — Wayland focus, resize repaint, `run_low_priority()`, Proton cmds, `mod proton` | §1.4, §2.2, §3.6, §4.6 |
| 4 | `src-tauri/src/proton.rs` | CREATE — Proton/Wine detection + launch | §2.1 |
| 5 | `src-tauri/src/game_watcher.rs` | MODIFY — `/proc` scanner, adaptive polling | §1.5, §4.3 |
| 6 | `src-tauri/src/gpu_detector.rs` | MODIFY — Linux GPU via `/sys/class/drm` | §1.6 |
| 7 | `src-tauri/src/steam/mod.rs` | MODIFY — Linux Steam path detection | §1.7 |
| 8 | `src-tauri/tauri.conf.json` | MODIFY — Linux bundle targets, deb depends | §1.8 |
| 9 | `src-tauri/capabilities/default.json` | MODIFY — add drag/resize/focus/size perms | §1.9, §3.3 |
| 10 | `src/components/TopNav.tsx` | MODIFY — `data-tauri-drag-region` | §3.1 |
| 11 | `src/components/ResizeHandles.tsx` | CREATE — 8 invisible resize handles | §3.3 |
| 12 | `src/components/WindowControls.tsx` | MODIFY — debounced onResized, tiling WM | §3.7, §4.4 |
| 13 | `src/App.tsx` | MODIFY — mount ResizeHandles, visibilitychange | §3.4, §4.1 |
| 14 | `src/App.css` | MODIFY — drag CSS, viewport, anim pause, reduced-motion | §3.2, §3.5, §4.1, §4.2 |
| 15 | `src/hooks/useGameLaunch.ts` | CREATE — Proton .exe routing | §2.3 |
| 16 | `src/pages/SettingsPage.tsx` | MODIFY — Proton/Wine selector | §2.4 |
| 17 | `vite.config.ts` | MODIFY — Terser + drop_console | §4.5 |
| 18 | `package.json` | MODIFY — add `terser` devDep | §4.5 |

---

## Appendix A — Quick-Start Checklist

```bash
# 1. Install system deps (see §1.1 for your distro)

# 2. Clone & install
git clone https://github.com/atxoxx/GameIndex.git
cd GameIndex
npm install
npm install -D terser

# 3. Apply all code changes from this guide

# 4. Verify compilation
cd src-tauri && cargo check && cd ..
npx tsc --noEmit

# 5. Dev run
npm run tauri dev

# 6. Production build
npm run tauri build

# 7. Output artifacts:
#    src-tauri/target/release/bundle/deb/
#    src-tauri/target/release/bundle/rpm/
#    src-tauri/target/release/bundle/appimage/
```

---

## Appendix B — Environment Variable Reference

| Variable | Value | Purpose | Set In |
|----------|-------|---------|--------|
| `WEBKIT_DISABLE_DMABUF_RENDERER` | `1` | Fix black/flicker on NVIDIA+Wayland | `main.rs` |
| `__NV_DISABLE_EXPLICIT_SYNC` | `1` | Fix tearing on NVIDIA+Wayland | `main.rs` |
| `GDK_BACKEND` | `wayland,x11` | Force Wayland, X11 fallback | `main.rs` |
| `WEBKIT_DISABLE_COMPOSITING_MODE` | `1` | Fix threaded compositing deadlock | `main.rs` |
| `__GL_THREADED_OPTIMIZATIONS` | `0` | Disable NVIDIA GLX threading | `main.rs` |
| `WINEPREFIX` | `~/.local/share/GameIndex/wineprefixes/<id>` | Per-game Wine isolation | `proton.rs` |
| `STEAM_COMPAT_DATA_PATH` | (same as WINEPREFIX) | Proton compat data | `proton.rs` |
| `STEAM_COMPAT_CLIENT_INSTALL_PATH` | Steam install dir | Proton client path | `proton.rs` |

---

## Appendix C — Sources & References

| # | Source | URL |
|---|--------|-----|
| 1 | Tauri v2 Linux Prerequisites | https://v2.tauri.app/start/prerequisites/#linux |
| 2 | Tauri #9216 — Black screen Wayland/NVIDIA | https://github.com/tauri-apps/tauri/issues/9216 |
| 3 | WebKitGTK DMA-BUF bug | https://gitlab.gnome.org/GNOME/webkit/-/issues/268 |
| 4 | Tauri #8104 — Window not focused Wayland | https://github.com/tauri-apps/tauri/issues/8104 |
| 5 | procfs crate | https://docs.rs/procfs/0.17/procfs/ |
| 6 | proc(5) man page | https://man7.org/linux/man-pages/man5/proc.5.html |
| 7 | Linux DRM sysfs | https://www.kernel.org/doc/html/latest/gpu/drm-uapi.html |
| 8 | NVIDIA proc interface | https://download.nvidia.com/XFree86/Linux-x86_64/560.35.03/README/procinterface.html |
| 9 | Arch Wiki — Steam | https://wiki.archlinux.org/title/Steam |
| 10 | Tauri v2 BundleConfig | https://v2.tauri.app/reference/config/#bundleconfig |
| 11 | Tauri v2 Window Permissions | https://v2.tauri.app/reference/javascript/api/namespacewindow/ |
| 12 | ValveSoftware/Proton | https://github.com/ValveSoftware/Proton |
| 13 | GE-Proton | https://github.com/GloriousEggroll/proton-ge-custom |
| 14 | Wine WINEPREFIX | https://wiki.winehq.org/Wine_User%27s_Guide#WINEPREFIX |
| 15 | Tauri — Drag Region | https://v2.tauri.app/learn/window-customization/#define-a-drag-region |
| 16 | Tauri #6762 — Resize frameless Linux | https://github.com/tauri-apps/tauri/issues/6762 |
| 17 | startResizeDragging | https://v2.tauri.app/reference/javascript/api/namespacewindow/#startresizedragging |
| 18 | MDN — Dynamic viewport units | https://developer.mozilla.org/en-US/docs/Web/CSS/length#dynamic |
| 19 | Tauri #8904 — WebKitGTK resize repaint | https://github.com/tauri-apps/tauri/issues/8904 |
| 20 | MDN — visibilitychange | https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event |
| 21 | MDN — prefers-reduced-motion | https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion |
| 22 | Tauri #5170 — High CPU polling | https://github.com/tauri-apps/tauri/issues/5170 |
| 23 | Vite build.minify | https://vite.dev/config/build-options.html#build-minify |
| 24 | Terser compress options | https://terser.org/docs/options/#compress-options |
| 25 | Tokio spawn_blocking | https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html |
| 26 | nice(2) man page | https://man7.org/linux/man-pages/man2/nice.2.html |
| 27 | Cargo — Platform Deps | https://doc.rust-lang.org/cargo/reference/specifying-dependencies.html#platform-specific-dependencies |
| 28 | Flatpak Steam | https://flathub.org/apps/com.valvesoftware.Steam |

---

*End of LINUX_WAYLAND_BUILD_GUIDE.md*