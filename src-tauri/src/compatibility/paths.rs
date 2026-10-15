use std::collections::HashMap;
use std::fs::{self};
use std::path::{Path, PathBuf};
#[cfg(not(windows))]
use std::process::Command;


/// Recursively compute the disk size of a directory in bytes (ignoring symlinks to prevent cycles).
pub fn dir_size_bytes(path: &Path) -> Option<u64> {
    if !path.exists() {
        return None;
    }
    if path.is_file() {
        return fs::metadata(path).ok().map(|m| m.len());
    }
    let mut total: u64 = 0;
    let mut stack = vec![path.to_path_buf()];
    let mut visited_dirs = 0;
    while let Some(current) = stack.pop() {
        visited_dirs += 1;
        if visited_dirs > 25_000 {
            break;
        }
        if let Ok(entries) = fs::read_dir(&current) {
            for entry in entries.flatten() {
                if let Ok(ft) = entry.file_type() {
                    if ft.is_symlink() {
                        continue;
                    }
                    if ft.is_dir() {
                        stack.push(entry.path());
                    } else if ft.is_file() {
                        if let Ok(meta) = entry.metadata() {
                            total = total.saturating_add(meta.len());
                        }
                    }
                }
            }
        }
    }
    Some(total)
}

/// Locate or resolve the preferred Steam compatibility tools directory (`compatibilitytools.d`).
pub fn steam_compat_tools_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    if !home.is_empty() {
        let h = PathBuf::from(&home);
        let candidates = [
            h.join(".steam/root/compatibilitytools.d"),
            h.join(".local/share/Steam/compatibilitytools.d"),
            h.join(".steam/steam/compatibilitytools.d"),
            h.join(".var/app/com.valvesoftware.Steam/.local/share/Steam/compatibilitytools.d"),
        ];
        for c in &candidates {
            if c.exists() || c.parent().map(|p| p.exists()).unwrap_or(false) {
                return c.clone();
            }
        }
        return h.join(".local/share/Steam/compatibilitytools.d");
    }

    if let Ok(app_data) = std::env::var("APPDATA") {
        return PathBuf::from(app_data).join("GameIndex").join("compatibilitytools.d");
    }
    PathBuf::from("compatibilitytools.d")
}

/// Locate or resolve GameIndex's custom runner directory.
pub fn gameindex_runners_dir(kind: &str) -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    if !home.is_empty() {
        let h = PathBuf::from(&home);
        if kind == "wine" {
            let lutris = h.join(".local/share/lutris/runners/wine");
            if lutris.exists() {
                return lutris;
            }
        }
        return h.join(".local/share/GameIndex/runners").join(kind);
    }

    if let Ok(app_data) = std::env::var("APPDATA") {
        return PathBuf::from(app_data).join("GameIndex").join("runners").join(kind);
    }
    PathBuf::from("runners").join(kind)
}

/// Directory for the anti-cheat runtimes GameIndex manages itself.
pub fn gameindex_anticheat_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    if !home.is_empty() {
        return PathBuf::from(&home).join(".local/share/GameIndex/anticheat");
    }
    if let Ok(app_data) = std::env::var("APPDATA") {
        return PathBuf::from(app_data).join("GameIndex").join("anticheat");
    }
    PathBuf::from("anticheat")
}

static COMMAND_CACHE: std::sync::Mutex<Option<HashMap<String, bool>>> = std::sync::Mutex::new(None);

/// Helper: check if a command executable is available in PATH (cached & fast on Windows).
pub fn is_command_available(cmd: &str) -> bool {
    if let Ok(mut lock) = COMMAND_CACHE.lock() {
        if lock.is_none() {
            *lock = Some(HashMap::new());
        }
        if let Some(map) = lock.as_mut() {
            if let Some(&cached) = map.get(cmd) {
                return cached;
            }
            #[cfg(windows)]
            let avail = {
                let path_var = std::env::var("PATH").unwrap_or_default();
                let has_ext = cmd.ends_with(".exe") || cmd.ends_with(".cmd") || cmd.ends_with(".bat");
                let exts = [".exe", ".cmd", ".bat"];
                std::env::split_paths(&path_var).any(|dir| {
                    if has_ext {
                        dir.join(cmd).is_file()
                    } else {
                        exts.iter().any(|ext| dir.join(format!("{}{}", cmd, ext)).is_file())
                    }
                })
            };
            #[cfg(not(windows))]
            let avail = Command::new("which").arg(cmd).output().map(|o| o.status.success()).unwrap_or(false);

            map.insert(cmd.to_string(), avail);
            return avail;
        }
    }
    false
}

/// Locate system and user Steam installation folders.
pub fn steam_candidate_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let home = std::env::var("HOME").unwrap_or_default();
    if !home.is_empty() {
        let h = PathBuf::from(&home);
        roots.push(h.join(".steam/steam"));
        roots.push(h.join(".local/share/Steam"));
        roots.push(h.join(".var/app/com.valvesoftware.Steam/.steam/steam"));
        roots.push(h.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"));
        roots.push(PathBuf::from("/snap/steam/common/.steam/steam"));
    }
    roots.retain(|p| p.exists());
    roots
}

/// Pull the values for `wanted_key` out of a simple VDF file (a flat
/// list of `"key" "value"` pairs). Used to resolve `install_path` in
/// system-package compatibility tool manifests.
pub(crate) fn vdf_key_values(raw: &str, wanted_key: &str) -> Vec<String> {
    let parts: Vec<&str> = raw.split('"').collect();
    let mut out = Vec::new();
    let mut i = 1;
    while i + 2 < parts.len() {
        if parts[i] == wanted_key {
            let val = parts[i + 2].trim();
            if !val.is_empty() {
                out.push(val.to_string());
            }
        }
        i += 2;
    }
    out
}

/// Parse the contents of `steamapps/libraryfolders.vdf` and return every
/// library root it declares (both the modern numeric-key format and the
/// legacy nested `"path"` format). Accepts `/`-prefixed Linux paths as
/// well as Windows drive / UNC paths.
pub(crate) fn parse_library_folders_vdf(raw: &str) -> Vec<PathBuf> {
    let parts: Vec<&str> = raw.split('"').collect();
    let mut out = Vec::new();
    let mut i = 1;
    while i + 2 < parts.len() {
        let key = parts[i];
        if key == "path" || (!key.is_empty() && key.chars().all(|c| c.is_ascii_digit())) {
            let val = parts[i + 2].trim();
            if !val.is_empty() {
                let p = PathBuf::from(val);
                let is_abs = p.is_absolute() || val.starts_with('/') || val.starts_with('\\');
                if is_abs && !out.contains(&p) {
                    out.push(p);
                }
            }
        }
        i += 2;
    }
    out
}

/// Read `steamapps/libraryfolders.vdf` and return every library root it
/// declares.
fn steam_library_folders(steam_root: &Path) -> Vec<PathBuf> {
    let vdf = steam_root.join("steamapps/libraryfolders.vdf");
    let Ok(raw) = fs::read_to_string(&vdf) else { return Vec::new() };
    parse_library_folders_vdf(&raw)
}

/// Steam install roots: the standard candidate folders plus every
/// secondary library declared in `libraryfolders.vdf`.
pub(crate) fn steam_library_roots() -> Vec<PathBuf> {
    let mut roots = steam_candidate_roots();
    let mut seen: std::collections::HashSet<PathBuf> = roots.iter().cloned().collect();
    for root in steam_candidate_roots() {
        for lib in steam_library_folders(&root) {
            if seen.insert(lib.clone()) {
                roots.push(lib);
            }
        }
    }
    roots
}

/// MangoHud CSV log folder used by GameIndex-launched sessions.
///
/// GameIndex forces logging here (via `MANGOHUD_CONFIG`) so
/// `metrics_collector` can find the frame log; it is also where MangoHud
/// drops logs by default when the user configures `output_folder`
/// themselves, so a log written here never surprises anyone.
#[cfg(target_os = "linux")]
pub fn linux_mangohud_log_dir() -> Option<PathBuf> {
    let base = std::env::var("XDG_DATA_HOME")
        .ok()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            let home = std::env::var("HOME").ok()?;
            Some(PathBuf::from(home).join(".local/share"))
        })?;
    Some(base.join("MangoHud"))
}

/// Path of the gamescope `--stats-path` FIFO that the metrics collector
/// tails for real-time FPS. Lives under `$XDG_RUNTIME_DIR` (per-user,
/// cleaned up on logout) with `/tmp` as fallback for sessions without it
/// (bare-bones desktops, some containers).
#[cfg(target_os = "linux")]
pub fn linux_gamescope_stats_fifo() -> Option<PathBuf> {
    let base = std::env::var("XDG_RUNTIME_DIR")
        .ok()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var("TMPDIR")
                .ok()
                .filter(|s| !s.is_empty())
                .map(PathBuf::from)
        })
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    Some(base.join("gameindex-gamescope-stats.fifo"))
}

/// Create (or repair) the gamescope stats FIFO. Returns `false` when the
/// path cannot be made a FIFO — e.g. it exists as a regular file left
/// over from a crash and unlinking it fails.
#[cfg(target_os = "linux")]
pub(crate) fn ensure_gamescope_stats_fifo(path: &Path) -> bool {
    use std::os::unix::fs::FileTypeExt;
    match fs::metadata(path) {
        Ok(meta) if meta.file_type().is_fifo() => return true,
        Ok(_) => {
            // Stale non-FIFO leftover; replace it.
            let _ = fs::remove_file(path);
        }
        Err(_) => {}
    }
    match std::ffi::CString::new(path.to_string_lossy().as_bytes()) {
        Ok(c_path) => unsafe { libc::mkfifo(c_path.as_ptr(), 0o600) == 0 },
        Err(_) => false,
    }
}

/// Quote a token for display in a POSIX shell command line.
pub(crate) fn shell_quote(s: &str) -> String {
    if s.is_empty() {
        return "''".to_string();
    }
    if s.bytes()
        .all(|b| b.is_ascii_alphanumeric() || b"_-./:@%+=,".contains(&b))
    {
        return s.to_string();
    }
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Render an environment value for the session log, lossy for non-UTF-8 paths.
pub(crate) fn os_str_to_display<S: AsRef<std::ffi::OsStr>>(value: S) -> String {
    value.as_ref().to_string_lossy().into_owned()
}
