//! Downloadable emulator catalog + install pipeline.
//!
//! `list_emulator_downloads` exposes a static catalog of emulator
//! archives (direct URL, expected executable name, extraction hints).
//! Installs reuse the existing download engine: `start_emulator_install`
//! kicks off a direct download with auto-extraction under an
//! `emu_<key>_<ts>` id, and `finish_emulator_install` (defined in
//! lib.rs, where `EmulatorData` lives) completes it by locating the
//! extracted executable, ensuring the ROM folder exists and persisting
//! the emulator configuration.
//!
//! The install-spec registry is in-memory only; the finish path can
//! still resolve the install directory after an app restart by deriving
//! it from the persisted download record (the archive's `save_path`).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::downloads::types::{unix_now, Download};

/// One downloadable emulator archive in the catalog (wire format is
/// camelCase: `key`, `url`, `exeName`, `archiveRoot?`, `sizeHint?`,
/// `notes?`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmulatorDownload {
    /// Matches the frontend `KnownEmulator.key`.
    pub key: &'static str,
    /// Direct archive URL (zip / 7z).
    pub url: &'static str,
    /// Expected executable file name inside the archive (best-effort
    /// for some builds; the installer falls back to any shallow `.exe`).
    pub exe_name: &'static str,
    /// Hint: subfolder inside the archive that holds the exe (when the
    /// archive is not flat).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archive_root: Option<&'static str>,
    /// Display string like "~18 MiB".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_hint: Option<&'static str>,
    /// Caveats (build flavour, stability, ...).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<&'static str>,
}

/// The downloadable emulator catalog. rpcs3 is deliberately excluded:
/// rpcs3.net bot-blocks automated downloads (urlVerified:false).
static EMULATOR_DOWNLOADS: &[EmulatorDownload] = &[
    EmulatorDownload {
        key: "retroarch",
        url: "https://buildbot.libretro.com/stable/1.22.2/windows/x86_64/RetroArch.7z",
        exe_name: "retroarch.exe",
        archive_root: Some("RetroArch-Win64/"),
        size_hint: Some("~193 MiB"),
        notes: Some("7z, libretro buildbot stable"),
    },
    EmulatorDownload {
        key: "dolphin",
        url: "https://dl.dolphin-emu.org/releases/2606/dolphin-2606-x64.7z",
        exe_name: "Dolphin.exe",
        archive_root: Some("Dolphin-x64/"),
        size_hint: Some("~18 MiB"),
        notes: Some("official site, no GitHub releases"),
    },
    EmulatorDownload {
        key: "dolphin-wii",
        url: "https://dl.dolphin-emu.org/releases/2606/dolphin-2606-x64.7z",
        exe_name: "Dolphin.exe",
        archive_root: Some("Dolphin-x64/"),
        size_hint: Some("~18 MiB"),
        notes: Some("same build as dolphin, Wii profile"),
    },
    EmulatorDownload {
        key: "pcsx2",
        url: "https://github.com/PCSX2/pcsx2/releases/download/v2.6.3/pcsx2-v2.6.3-windows-x64-Qt.7z",
        exe_name: "pcsx2-qt.exe",
        archive_root: Some("pcsx2-v2.6.3-windows-x64-Qt/"),
        size_hint: Some("~26 MiB"),
        notes: Some("Qt build"),
    },
    EmulatorDownload {
        key: "ppsspp",
        url: "https://github.com/hrydgard/ppsspp/releases/download/v1.20.4/PPSSPP-v1.20.4-Windows-x64.zip",
        exe_name: "PPSSPPWindows64.exe",
        archive_root: None,
        size_hint: Some("~19 MiB"),
        notes: Some("flat zip"),
    },
    EmulatorDownload {
        key: "duckstation",
        url: "https://github.com/stenzek/duckstation/releases/latest/download/duckstation-windows-x64-release.zip",
        exe_name: "duckstation-qt-x64-ReleaseLTCG.exe",
        archive_root: None,
        size_hint: Some("~67 MiB"),
        notes: Some("rolling latest tag"),
    },
    EmulatorDownload {
        key: "cemu",
        url: "https://github.com/cemu-project/Cemu/releases/download/v2.6/cemu-2.6-windows-x64.zip",
        exe_name: "Cemu.exe",
        archive_root: Some("Cemu_2.6/"),
        size_hint: Some("~25 MiB"),
        notes: None,
    },
    EmulatorDownload {
        key: "snes9x",
        url: "https://github.com/snes9xgit/snes9x/releases/download/1.63/snes9x-1.63-win32-x64.zip",
        exe_name: "snes9x-x64.exe",
        archive_root: None,
        size_hint: Some("~5 MiB"),
        notes: Some("flat zip"),
    },
    EmulatorDownload {
        key: "mesen",
        url: "https://github.com/SourMesen/Mesen/releases/download/0.9.9/Mesen.0.9.9.zip",
        exe_name: "Mesen.exe",
        archive_root: None,
        size_hint: Some("~10 MiB"),
        notes: Some("flat zip"),
    },
    EmulatorDownload {
        key: "mgba",
        url: "https://github.com/mgba-emu/mgba/releases/download/0.10.5/mGBA-0.10.5-win64.7z",
        exe_name: "mGBA.exe",
        archive_root: Some("mGBA-0.10.5-win64/"),
        size_hint: Some("~14 MiB"),
        notes: Some("7z"),
    },
    EmulatorDownload {
        key: "desmume",
        url: "https://github.com/TASEmulators/desmume/releases/download/release_0_9_13/desmume-0.9.13-win64.zip",
        exe_name: "DeSmuME_0.9.13_x64.exe",
        archive_root: None,
        size_hint: Some("~6 MiB"),
        notes: Some("flat zip"),
    },
    EmulatorDownload {
        key: "flycast",
        url: "https://github.com/flyinghead/flycast/releases/download/v2.6/flycast-win64-2.6.zip",
        exe_name: "flycast.exe",
        archive_root: None,
        size_hint: Some("~9 MiB"),
        notes: Some("flat zip"),
    },
    EmulatorDownload {
        key: "redream",
        url: "https://redream.io/download/redream.x86_64-windows-v1.5.0.zip",
        exe_name: "redream.exe",
        archive_root: None,
        size_hint: Some("~3 MiB"),
        notes: Some("stable since 2019"),
    },
    EmulatorDownload {
        key: "shadps4",
        url: "https://github.com/shadps4-emu/shadPS4/releases/download/v.0.17.0/shadps4-win64-sdl-0.17.0.zip",
        exe_name: "shadps4.exe",
        archive_root: None,
        size_hint: Some("~31 MiB"),
        notes: Some("SDL build only"),
    },
    EmulatorDownload {
        key: "vita3k",
        url: "https://github.com/Vita3K/Vita3K/releases/latest/download/windows-latest.zip",
        exe_name: "Vita3K.exe",
        archive_root: None,
        size_hint: Some("~36 MiB"),
        notes: Some("rolling latest tag"),
    },
    EmulatorDownload {
        key: "lime3ds",
        url: "https://github.com/azahar-emu/azahar/releases/download/2126.0/azahar-windows-msvc-2126.0.zip",
        exe_name: "azahar.exe",
        archive_root: None,
        size_hint: Some("~42 MiB"),
        notes: Some("merged into Azahar, exe is azahar.exe"),
    },
    EmulatorDownload {
        key: "melonds",
        url: "https://github.com/melonDS-emu/melonDS/releases/download/1.1/melonDS-1.1-windows-x86_64.zip",
        exe_name: "melonDS.exe",
        archive_root: None,
        size_hint: Some("~19 MiB"),
        notes: Some("flat zip"),
    },
    EmulatorDownload {
        key: "mupen64plus",
        url: "https://github.com/mupen64plus/mupen64plus-core/releases/download/2.6.0/mupen64plus-bundle-win64-2.6.0.zip",
        exe_name: "mupen64plus-ui-console.exe",
        archive_root: Some("Release/"),
        size_hint: Some("~3 MiB"),
        notes: Some("CLI bundle, exe under Release/"),
    },
    EmulatorDownload {
        key: "bsnes",
        url: "https://github.com/bsnes-emu/bsnes/releases/download/v115/bsnes_v115-windows.zip",
        exe_name: "bsnes.exe",
        archive_root: Some("bsnes_v115-windows/"),
        size_hint: Some("~4 MiB"),
        notes: None,
    },
    EmulatorDownload {
        key: "fceux",
        url: "https://github.com/TASEmulators/fceux/releases/download/v2.6.6/fceux-2.6.6-win64.zip",
        exe_name: "fceux64.exe",
        archive_root: None,
        size_hint: Some("~5 MiB"),
        notes: Some("QtSDL build = bin/qfceux.exe"),
    },
    EmulatorDownload {
        key: "sameboy",
        url: "https://github.com/LIJI32/SameBoy/releases/download/v1.0.3/sameboy_winsdl_v1.0.3.zip",
        exe_name: "sameboy.exe",
        archive_root: None,
        size_hint: Some("~2 MiB"),
        notes: Some("flat zip"),
    },
    EmulatorDownload {
        key: "xemu",
        url: "https://github.com/xemu-project/xemu/releases/latest/download/xemu-win-x86_64-release.zip",
        exe_name: "xemu.exe",
        archive_root: None,
        size_hint: Some("~9 MiB"),
        notes: Some("rolling latest tag"),
    },
    EmulatorDownload {
        key: "xenia",
        url: "https://github.com/xenia-project/release-builds-windows/releases/latest/download/xenia_master.zip",
        exe_name: "xenia.exe",
        archive_root: None,
        size_hint: Some("~17 MiB"),
        notes: Some("rolling master build"),
    },
    EmulatorDownload {
        key: "bizhawk",
        url: "https://github.com/TASEmulators/BizHawk/releases/download/2.11.1/BizHawk-2.11.1-win-x64.zip",
        exe_name: "EmuHawk.exe",
        archive_root: None,
        size_hint: Some("~93 MiB"),
        notes: Some("flat zip"),
    },
    EmulatorDownload {
        key: "fbneo",
        url: "https://github.com/finalburnneo/FBNeo/releases/latest/download/windows-x86_64.zip",
        exe_name: "fbneo64.exe",
        archive_root: None,
        size_hint: Some("~16 MiB"),
        notes: Some("rolling latest tag"),
    },
    EmulatorDownload {
        key: "blastem",
        url: "https://www.retrodev.com/blastem/blastem-win32-0.6.2.zip",
        exe_name: "blastem.exe",
        archive_root: Some("blastem-win32-0.6.2/"),
        size_hint: Some("~2 MiB"),
        notes: Some("stable since 2019"),
    },
    EmulatorDownload {
        key: "mednafen",
        url: "https://mednafen.github.io/releases/files/mednafen-1.32.1-win64.zip",
        exe_name: "mednafen.exe",
        archive_root: None,
        size_hint: Some("~7 MiB"),
        notes: Some("CLI only"),
    },
    EmulatorDownload {
        key: "ares",
        url: "https://github.com/ares-emulator/ares/releases/download/v148/ares-windows-x64.zip",
        exe_name: "ares.exe",
        archive_root: Some("ares-v148/"),
        size_hint: Some("~62 MiB"),
        notes: None,
    },
    EmulatorDownload {
        key: "stella",
        url: "https://github.com/stella-emu/stella/releases/download/7.0/Stella-7.0c-windows.zip",
        exe_name: "Stella.exe",
        archive_root: Some("Stella-7.0c/"),
        size_hint: Some("~4 MiB"),
        notes: None,
    },
];

/// Look up a catalog entry by its `key` (e.g. `"dolphin"`).
pub fn catalog_entry(key: &str) -> Option<&'static EmulatorDownload> {
    EMULATOR_DOWNLOADS.iter().find(|e| e.key == key)
}

/// Return the full downloadable catalog (cloned, so the static entries
/// are never exposed mutably).
#[tauri::command]
pub fn list_emulator_downloads() -> Result<Vec<EmulatorDownload>, String> {
    Ok(EMULATOR_DOWNLOADS.to_vec())
}

// ─── Install-spec registry ──────────────────────────────────────────────────

/// In-memory mapping from an emulator download id to where its archive
/// was written. Not persisted — after an app restart the finish path
/// derives the same information from the persisted download record.
struct InstallSpec {
    emulator_key: String,
    install_dir: PathBuf,
}

static INSTALL_SPECS: OnceLock<Arc<StdMutex<HashMap<String, InstallSpec>>>> = OnceLock::new();

fn install_specs() -> Arc<StdMutex<HashMap<String, InstallSpec>>> {
    INSTALL_SPECS
        .get_or_init(|| Arc::new(StdMutex::new(HashMap::new())))
        .clone()
}

/// Best-effort synchronous read of a download record from the manager.
/// Uses `try_read` with a short retry so a transient write-lock hold by
/// the 1 s status loop doesn't sink the restart-recovery path.
fn download_record(download_id: &str) -> Option<Download> {
    let mgr = crate::downloads::manager_handle()?;
    for _ in 0..5 {
        if let Ok(guard) = mgr.try_read() {
            return guard.downloads_map().get(download_id).cloned();
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    None
}

/// Resolve the install directory for an emulator download id.
///
/// 1. In-memory install spec (normal flow).
/// 2. Fallback: the persisted download record — `save_path` is the
///    archive's full file path, so its parent is the install directory.
///    This makes `finish_emulator_install` work even after an app
///    restart mid-download.
pub fn resolve_install_dir(download_id: &str) -> Option<PathBuf> {
    {
        let map = install_specs();
        let guard = map.lock().unwrap();
        if let Some(spec) = guard.get(download_id) {
            return Some(spec.install_dir.clone());
        }
    }
    let record = download_record(download_id)?;
    Path::new(&record.save_path)
        .parent()
        .map(|p| p.to_path_buf())
}

/// Recover the catalog executable name for an emulator install. Tries
/// the in-memory install spec first, then the `emu_<key>_<ts>` download
/// id prefix (keeps working after a restart, since the spec map is
/// in-memory only), then the persisted record's archive filename stem.
pub fn exe_name_for_download(download_id: &str) -> Option<String> {
    {
        let map = install_specs();
        let guard = map.lock().unwrap();
        if let Some(spec) = guard.get(download_id) {
            if let Some(entry) = catalog_entry(&spec.emulator_key) {
                return Some(entry.exe_name.to_string());
            }
        }
    }
    if let Some(rest) = download_id.strip_prefix("emu_") {
        if let Some(key) = rest.rsplit_once('_').map(|(k, _)| k) {
            if let Some(entry) = catalog_entry(key) {
                return Some(entry.exe_name.to_string());
            }
        }
    }
    let record = download_record(download_id)?;
    Path::new(&record.save_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string())
}

// ─── Executable discovery ────────────────────────────────────────────────────

/// Recursively find an executable under `install_dir`.
///
/// Walk is depth-first, bounded to 6 levels, visiting directory entries
/// in sorted order (stable, deterministic). Directories whose name
/// starts with `__MACOSX` or `.` are skipped. A candidate file matches
/// when its lowercased name is `==` the target, OR ends with the target
/// (covers versioned names like `snes9x-x64.exe`); only `.exe` files
/// are considered. When no named match exists, the first `.exe` found
/// at depth <= 2 is returned (some catalog exe names are best-effort).
pub fn find_executable(install_dir: &Path, exe_name: &str) -> Option<PathBuf> {
    let exe_name_lower = exe_name.trim().to_lowercase();

    fn walk(
        dir: &Path,
        exe_name_lower: &str,
        depth: usize,
        fallback: &mut Option<PathBuf>,
    ) -> Option<PathBuf> {
        if depth > 6 {
            return None;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return None;
        };
        let mut entries: Vec<_> = entries.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            let name = entry.file_name();
            let name_lower = name.to_string_lossy().to_lowercase();
            let path = entry.path();
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            if ft.is_dir() {
                if name_lower.starts_with("__macosx") || name_lower.starts_with('.') {
                    continue;
                }
                if let Some(found) = walk(&path, exe_name_lower, depth + 1, fallback) {
                    return Some(found);
                }
            } else if ft.is_file() {
                if !name_lower.ends_with(".exe") {
                    continue;
                }
                if name_lower == exe_name_lower
                    || (!exe_name_lower.is_empty() && name_lower.ends_with(exe_name_lower))
                {
                    return Some(path);
                }
                if depth <= 2 && fallback.is_none() {
                    *fallback = Some(path);
                }
            }
        }
        None
    }

    let mut fallback = None;
    if let Some(found) = walk(install_dir, &exe_name_lower, 0, &mut fallback) {
        return Some(found);
    }
    fallback
}

// ─── Command: start an install ──────────────────────────────────────────────

/// Kick off an emulator install: download the catalog archive into
/// `install_dir` (auto-extract on completion) and return the new
/// `Download` record (its id starts with `emu_`).
#[tauri::command]
pub async fn start_emulator_install(
    emulator_key: String,
    install_dir: String,
) -> Result<Download, String> {
    let entry = catalog_entry(&emulator_key)
        .ok_or_else(|| format!("No downloadable build for '{emulator_key}'"))?;

    let install_dir_path = Path::new(&install_dir);
    std::fs::create_dir_all(install_dir_path)
        .map_err(|e| format!("Failed to create install directory: {e}"))?;
    std::fs::create_dir_all(install_dir_path.join("roms"))
        .map_err(|e| format!("Failed to create ROM directory: {e}"))?;

    // Filename = the URL's last path segment; when it has no file
    // extension, fall back to `<key>.archive`.
    let filename = entry
        .url
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("{emulator_key}.archive"));
    let filename = if Path::new(&filename).extension().is_some() {
        filename
    } else {
        format!("{emulator_key}.archive")
    };

    let save_path = install_dir_path.join(&filename);
    let download_id = format!("emu_{emulator_key}_{}", unix_now());

    {
        let map = install_specs();
        let mut guard = map.lock().unwrap();
        guard.insert(
            download_id.clone(),
            InstallSpec {
                emulator_key: emulator_key.clone(),
                install_dir: install_dir_path.to_path_buf(),
            },
        );
    }

    crate::downloads::direct_download_start(
        download_id,
        entry.url.to_string(),
        save_path.to_string_lossy().into_owned(),
        None,
        "Emulator".to_string(),
        Some(true),
        None,
        None,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_lookup_finds_and_misses() {
        assert!(catalog_entry("dolphin").is_some());
        assert!(catalog_entry("nope").is_none());
    }

    #[test]
    fn find_executable_happy_path() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("Dolphin-x64");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("Dolphin.exe"), b"").unwrap();
        std::fs::write(root.join("readme.txt"), b"hi").unwrap();

        let found = find_executable(dir.path(), "Dolphin.exe");
        assert_eq!(found, Some(root.join("Dolphin.exe")));
    }

    #[test]
    fn find_executable_error_path() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("notes.txt"), b"hi").unwrap();

        assert_eq!(find_executable(dir.path(), "Dolphin.exe"), None);
    }

    #[test]
    fn find_executable_versioned_suffix() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("game.exe"), b"").unwrap();
        std::fs::write(dir.path().join("snes9x-x64.exe"), b"").unwrap();

        // The exact-named file wins (deterministic sorted order), not
        // the earlier-listed `game.exe` sibling.
        let found = find_executable(dir.path(), "snes9x-x64.exe");
        assert_eq!(found, Some(dir.path().join("snes9x-x64.exe")));
    }
}
