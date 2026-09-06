//! Installed-game version detection.
//!
//! Multi-source version detection for installed games:
//! 1. Store manifests on disk:
//!    - GOG `goggame-<id>.info` (JSON containing exact `"version"`)
//!    - Epic `%PROGRAMDATA%/Epic/EpicGamesLauncher/Data/Manifests/*.item` (`AppVersionString`)
//!    - Steam `appmanifest_<appid>.acf` (`buildid`)
//! 2. Generic folder manifests: `version.txt`, `build.info`, `version.json`, `package.json`
//! 3. Smart executable PE version reader:
//!    - Bypasses launcher/crash-handler executables to check real game binaries
//!    - Enhanced PE reader handling comma-separated version components, prefixes, and comments
//!
//! Preserves backwards compatibility with `get_exe_file_version`.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameVersionQuery {
    pub game_id: Option<String>,
    pub path: Option<String>,
    pub detected_exe: Option<String>,
    pub install_dir: Option<String>,
    pub platform: Option<String>,
    pub steam_app_id: Option<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GameVersionInfo {
    pub version: String,
    pub source: String,
}

/// Trim a raw version string from the resource to something displayable:
/// strip surrounding whitespace, trailing parentheses (e.g. Witcher 3's
/// `4.0.0.87877(Build Machine)`), semver build-metadata tails after a
/// `+` hex hash (`1.0.0+c1eba6e0...`), convert commas to dots (`1, 0, 4, 12` -> `1.0.4.12`),
/// and strip standard prefixes like `Release` / `Version` / `v`.
pub fn normalize_version(raw: &str) -> Option<String> {
    let mut trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.chars().any(|c| c.is_control()) {
        return None;
    }

    // Strip common leading version labels: "Release", "Version", "Ver.", "Ver", "Build", "v."
    let lower = trimmed.to_ascii_lowercase();
    for prefix in &["release", "version", "ver.", "ver", "build", "v."] {
        if lower.starts_with(prefix) {
            let rest = &trimmed[prefix.len()..];
            let rest_trimmed = rest.trim_start();
            if !rest_trimmed.is_empty()
                && (rest_trimmed.starts_with(|c: char| c.is_ascii_digit() || c == 'v' || c == 'V'))
            {
                trimmed = rest_trimmed;
                break;
            }
        }
    }

    // Also strip single leading 'v' or 'V' if followed by a digit
    if (trimmed.starts_with('v') || trimmed.starts_with('V')) && trimmed.len() > 1 {
        let after_v = &trimmed[1..].trim_start();
        if after_v.starts_with(|c: char| c.is_ascii_digit()) {
            trimmed = after_v;
        }
    }

    // Check for comma separation: e.g. "1, 0, 4, 12" -> "1.0.4.12"
    let cleaned_str = if trimmed.contains(',') {
        let parts: Vec<&str> = trimmed.split(',').map(|s| s.trim()).collect();
        if parts
            .iter()
            .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_alphanumeric()))
        {
            parts.join(".")
        } else {
            trimmed.replace(',', ".")
        }
    } else {
        trimmed.to_string()
    };

    let cleaned_trimmed = cleaned_str.trim();
    if cleaned_trimmed.is_empty() {
        return None;
    }

    // Cut trailing parenthetical or bracketed notes: e.g. "(Build Machine)" or "[DODI]"
    let end = cleaned_trimmed
        .char_indices()
        .find(|(_, c)| c.is_whitespace() || *c == '(' || *c == '[')
        .map(|(i, _)| i)
        .unwrap_or(cleaned_trimmed.len());
    let mut cut = cleaned_trimmed[..end].trim();

    // Semver build metadata: cut a `+` suffix that looks like a hash
    // (`1.0.0+c1eba6e0d7...`) but keep legit `+` in version strings.
    if let Some(plus) = cut.find('+') {
        let hash = &cut[plus + 1..];
        if hash.len() >= 6 && hash.chars().all(|c| c.is_ascii_hexdigit()) {
            cut = cut[..plus].trim();
        }
    }

    let cut = cut.trim();
    if cut.is_empty() {
        None
    } else {
        Some(cut.to_string())
    }
}

/// Read the Windows file version (e.g. `2.57.1.125`) embedded in an
/// executable's version resource.
///
/// Returns `None` when the path doesn't exist, isn't a PE file, carries
/// no version resource, or the platform isn't Windows.
#[cfg(windows)]
#[tauri::command]
pub fn get_exe_file_version(path: String) -> Option<String> {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::null_mut;
    use std::slice;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW, VS_FIXEDFILEINFO,
    };

    let exe = Path::new(&path);
    if !exe.is_file() {
        return None;
    }

    // Null-terminated UTF-16 path for the Win32 calls.
    let wide: Vec<u16> = exe
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let size = GetFileVersionInfoSizeW(PCWSTR(wide.as_ptr()), None);
        if size == 0 {
            return None;
        }
        let mut buf = vec![0u8; size as usize];
        if GetFileVersionInfoW(PCWSTR(wide.as_ptr()), 0, size, buf.as_mut_ptr().cast()).is_err() {
            return None;
        }

        /// Query a sub-block and, when it holds a UTF-16 string, return it.
        fn query_string(buf: &[u8], sub_block: &str) -> Option<String> {
            let wide: Vec<u16> = sub_block.encode_utf16().chain(std::iter::once(0)).collect();
            unsafe {
                let mut out: *mut c_void = null_mut();
                let mut len: u32 = 0;
                if !VerQueryValueW(
                    buf.as_ptr().cast(),
                    PCWSTR(wide.as_ptr()),
                    &mut out,
                    &mut len,
                )
                .as_bool()
                {
                    return None;
                }
                if out.is_null() {
                    return None;
                }
                let words = len as usize / 2;
                let p = out.cast::<u16>();
                // The value is null-terminated; cap the scan at the reported length.
                let mut count = 0usize;
                while count < words && *p.add(count) != 0 {
                    count += 1;
                }
                let s = String::from_utf16_lossy(slice::from_raw_parts(p, count));
                if s.trim().is_empty() {
                    None
                } else {
                    Some(s)
                }
            }
        }

        // The string table is split per (language, codepage). Enumerate
        // the translation pairs, then read ProductVersion / FileVersion
        // from the first translation that carries them.
        let mut tr_ptr: *mut c_void = null_mut();
        let mut tr_len: u32 = 0;
        let var_info: Vec<u16> = r"\VarFileInfo\Translation"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        if VerQueryValueW(
            buf.as_ptr().cast(),
            PCWSTR(var_info.as_ptr()),
            &mut tr_ptr,
            &mut tr_len,
        )
        .as_bool()
        {
            let word_count = (tr_len as usize) / 2;
            let words = slice::from_raw_parts(tr_ptr.cast::<u16>(), word_count);
            for pair in words.chunks(2) {
                if pair.len() < 2 {
                    break;
                }
                let (lang, codepage) = (pair[0], pair[1]);
                // ProductVersion is the human-facing game version; most
                // repacks/games tag marketing patches there.
                let pv = format!(r"\StringFileInfo\{lang:04x}{codepage:04x}\ProductVersion");
                if let Some(raw) = query_string(&buf, &pv) {
                    if let Some(v) = normalize_version(&raw) {
                        return Some(v);
                    }
                }
                let fv = format!(r"\StringFileInfo\{lang:04x}{codepage:04x}\FileVersion");
                if let Some(raw) = query_string(&buf, &fv) {
                    if let Some(v) = normalize_version(&raw) {
                        return Some(v);
                    }
                }
            }
        }

        // No usable string version — fall back to the fixed block, but
        // refuse to fabricate "0.0" from a resource whose version numbers
        // were all left at zero.
        let mut info_ptr: *mut c_void = null_mut();
        let mut len: u32 = 0;
        let root_block: [u16; 2] = [b'\\' as u16, 0];
        if !VerQueryValueW(
            buf.as_ptr().cast(),
            PCWSTR(root_block.as_ptr()),
            &mut info_ptr,
            &mut len,
        )
        .as_bool()
        {
            return None;
        }
        let info = &*(info_ptr.cast::<VS_FIXEDFILEINFO>());
        if info.dwSignature != 0xFEEF04BD {
            return None;
        }

        let major = (info.dwFileVersionMS >> 16) & 0xFFFF;
        let minor = info.dwFileVersionMS & 0xFFFF;
        let build = (info.dwFileVersionLS >> 16) & 0xFFFF;
        let revision = info.dwFileVersionLS & 0xFFFF;
        if major == 0 && minor == 0 && build == 0 && revision == 0 {
            return None;
        }

        // Trim trailing zero components (1.2.0.0 -> "1.2"): download
        // titles rarely tag beyond three components, so this keeps the
        // comparison apples-to-apples (1.2 == 1.2.0.0).
        if revision != 0 {
            Some(format!("{major}.{minor}.{build}.{revision}"))
        } else if build != 0 {
            Some(format!("{major}.{minor}.{build}"))
        } else {
            Some(format!("{major}.{minor}"))
        }
    }
}

/// Non-Windows builds have no PE version resource to read.
#[cfg(not(windows))]
#[tauri::command]
pub fn get_exe_file_version(_path: String) -> Option<String> {
    None
}

/// Helper identifying launchers, crash handlers, and setup helpers that
/// should not be treated as the main game binary.
fn is_launcher_or_helper(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.contains("launcher")
        || lower.contains("crashreport")
        || lower.contains("crashhandler")
        || lower.starts_with("unins")
        || lower.starts_with("uninstall")
        || lower.contains("easyanticheat")
        || lower.contains("beservice")
        || lower.contains("start_protected_game")
        || lower.contains("installer")
        || lower.contains("downloader")
        || lower.contains("setup")
        || lower.ends_with("prelauncher.exe")
}

/// Scan a directory and common subdirectories for candidate game binaries.
fn find_candidate_game_exes(root: &Path) -> Vec<PathBuf> {
    let mut exes = Vec::new();
    let mut dirs_to_check = vec![root.to_path_buf()];
    for sub in &[
        "bin", "binaries", "bin/x64", "bin/win64", "x64", "x86_64", "bin/x86_64", "game",
    ] {
        let p = root.join(sub);
        if p.is_dir() {
            dirs_to_check.push(p);
        }
    }
    for dir in dirs_to_check {
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_file()
                    && p.extension()
                        .and_then(|e| e.to_str())
                        .map(|e| e.eq_ignore_ascii_case("exe"))
                        .unwrap_or(false)
                {
                    if let Some(file_name) = p.file_name().and_then(|n| n.to_str()) {
                        if !is_launcher_or_helper(file_name) {
                            exes.push(p);
                        }
                    }
                }
            }
        }
    }
    // Sort descending by file size (the actual game binary is almost always the largest PE file)
    exes.sort_by(|a, b| {
        let size_a = a.metadata().map(|m| m.len()).unwrap_or(0);
        let size_b = b.metadata().map(|m| m.len()).unwrap_or(0);
        size_b.cmp(&size_a)
    });
    exes
}

/// Check for GOG `goggame-*.info` manifests in candidate directories.
fn check_gog_manifest(candidate_dirs: &[PathBuf]) -> Option<String> {
    for dir in candidate_dirs {
        if !dir.is_dir() {
            continue;
        }
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                let file_name = p
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or_default()
                    .to_ascii_lowercase();
                if file_name.starts_with("goggame-") && file_name.ends_with(".info") {
                    if let Ok(content) = fs::read_to_string(&p) {
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                            if let Some(ver) = json.get("version").and_then(|v| v.as_str()) {
                                if let Some(norm) = normalize_version(ver) {
                                    if norm != "0.0.0.0" {
                                        return Some(norm);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

/// Check for Epic Games launcher manifests in ProgramData.
fn check_epic_manifest(candidate_dirs: &[PathBuf], candidate_ids: &[&str]) -> Option<String> {
    let program_data =
        std::env::var("PROGRAMDATA").unwrap_or_else(|_| "C:\\ProgramData".to_string());
    let manifests_dir = PathBuf::from(program_data)
        .join("Epic")
        .join("EpicGamesLauncher")
        .join("Data")
        .join("Manifests");

    if !manifests_dir.is_dir() {
        return None;
    }

    if let Ok(entries) = fs::read_dir(&manifests_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) == Some("item") {
                if let Ok(content) = fs::read_to_string(&p) {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                        let matches_dir = json
                            .get("InstallLocation")
                            .and_then(|s| s.as_str())
                            .map(|inst| {
                                let inst_path = PathBuf::from(inst);
                                candidate_dirs.iter().any(|d| {
                                    d == &inst_path
                                        || d.starts_with(&inst_path)
                                        || inst_path.starts_with(d)
                                })
                            })
                            .unwrap_or(false);

                        let matches_id = candidate_ids.iter().any(|&cid| {
                            json.get("CatalogItemId").and_then(|s| s.as_str()) == Some(cid)
                                || json.get("AppName").and_then(|s| s.as_str()) == Some(cid)
                        });

                        if matches_dir || matches_id {
                            if let Some(v) = json.get("AppVersionString").and_then(|s| s.as_str()) {
                                if let Some(norm) = normalize_version(v) {
                                    return Some(norm);
                                }
                            }
                            if let Some(v) = json.get("BuildVersion").and_then(|s| s.as_str()) {
                                if let Some(norm) = normalize_version(v) {
                                    return Some(norm);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

/// Check generic folder manifests: `version.txt`, `build.info`, `version.json`, `package.json`.
fn check_folder_manifests(candidate_dirs: &[PathBuf]) -> Option<String> {
    for dir in candidate_dirs {
        if !dir.is_dir() {
            continue;
        }
        // 1. version.txt
        let ver_txt = dir.join("version.txt");
        if ver_txt.is_file() {
            if let Ok(content) = fs::read_to_string(&ver_txt) {
                let first_line = content.lines().next().unwrap_or("").trim();
                if let Some(norm) = normalize_version(first_line) {
                    return Some(norm);
                }
            }
        }
        // 2. build.info
        let build_info = dir.join("build.info");
        if build_info.is_file() {
            if let Ok(content) = fs::read_to_string(&build_info) {
                let first_line = content.lines().next().unwrap_or("").trim();
                if let Some(norm) = normalize_version(first_line) {
                    return Some(norm);
                }
            }
        }
        // 3. version.json or build.json
        for json_name in &["version.json", "build.json"] {
            let json_path = dir.join(json_name);
            if json_path.is_file() {
                if let Ok(content) = fs::read_to_string(&json_path) {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                        for key in &["version", "build_version", "app_version"] {
                            if let Some(v) = json.get(*key).and_then(|s| s.as_str()) {
                                if let Some(norm) = normalize_version(v) {
                                    return Some(norm);
                                }
                            }
                        }
                    }
                }
            }
        }
        // 4. package.json
        let pkg_json = dir.join("package.json");
        if pkg_json.is_file() {
            if let Ok(content) = fs::read_to_string(&pkg_json) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(v) = json.get("version").and_then(|s| s.as_str()) {
                        if let Some(norm) = normalize_version(v) {
                            return Some(norm);
                        }
                    }
                }
            }
        }
    }
    None
}

/// Detect the installed version of a game using multi-source inspection:
/// 1. GOG manifest (`goggame-*.info`)
/// 2. Epic manifest (`*.item`)
/// 3. Folder manifests (`version.txt`, `build.info`, `version.json`, `package.json`)
/// 4. Executable PE resource inspection (with launcher bypass)
/// 5. Steam app manifest (`appmanifest_<appid>.acf` `buildid`)
#[tauri::command]
pub fn detect_game_version(query: GameVersionQuery) -> Option<GameVersionInfo> {
    let mut candidate_dirs = Vec::new();
    if let Some(ref inst) = query.install_dir {
        let p = PathBuf::from(inst);
        if p.is_dir() {
            candidate_dirs.push(p);
        }
    }
    if let Some(ref exe) = query.detected_exe {
        let p = PathBuf::from(exe);
        if let Some(parent) = p.parent() {
            if parent.is_dir() && !candidate_dirs.contains(&parent.to_path_buf()) {
                candidate_dirs.push(parent.to_path_buf());
            }
            if let Some(grandparent) = parent.parent() {
                if grandparent.is_dir() && !candidate_dirs.contains(&grandparent.to_path_buf()) {
                    candidate_dirs.push(grandparent.to_path_buf());
                }
            }
        }
    }
    if let Some(ref path) = query.path {
        let p = PathBuf::from(path);
        if p.is_dir() && !candidate_dirs.contains(&p) {
            candidate_dirs.push(p.clone());
        } else if let Some(parent) = p.parent() {
            if parent.is_dir() && !candidate_dirs.contains(&parent.to_path_buf()) {
                candidate_dirs.push(parent.to_path_buf());
            }
            if let Some(grandparent) = parent.parent() {
                if grandparent.is_dir() && !candidate_dirs.contains(&grandparent.to_path_buf()) {
                    candidate_dirs.push(grandparent.to_path_buf());
                }
            }
        }
    }

    // 1. GOG manifest check
    if let Some(v) = check_gog_manifest(&candidate_dirs) {
        return Some(GameVersionInfo {
            version: v,
            source: "gog_manifest".to_string(),
        });
    }

    // 2. Epic manifest check
    let is_epic = query
        .platform
        .as_deref()
        .map(|p| p.eq_ignore_ascii_case("epic"))
        .unwrap_or(false);

    let mut epic_ids = Vec::new();
    if let Some(ref gid) = query.game_id {
        if let Some(stripped) = gid.strip_prefix("epic-") {
            epic_ids.push(stripped);
        }
        epic_ids.push(gid.as_str());
    }
    if is_epic || !epic_ids.is_empty() {
        if let Some(v) = check_epic_manifest(&candidate_dirs, &epic_ids) {
            return Some(GameVersionInfo {
                version: v,
                source: "epic_manifest".to_string(),
            });
        }
    }

    // 3. Generic folder manifests
    if let Some(v) = check_folder_manifests(&candidate_dirs) {
        return Some(GameVersionInfo {
            version: v,
            source: "folder_manifest".to_string(),
        });
    }

    // 4. Executable version check with launcher bypass
    let mut exes_to_try = Vec::new();
    if let Some(ref de) = query.detected_exe {
        let p = PathBuf::from(de);
        if p.is_file() {
            let is_helper = p
                .file_name()
                .and_then(|n| n.to_str())
                .map(is_launcher_or_helper)
                .unwrap_or(false);
            if !is_helper {
                exes_to_try.push(p);
            }
        }
    }
    if let Some(ref path) = query.path {
        let p = PathBuf::from(path);
        if p.is_file() {
            let is_helper = p
                .file_name()
                .and_then(|n| n.to_str())
                .map(is_launcher_or_helper)
                .unwrap_or(false);
            if !is_helper && !exes_to_try.contains(&p) {
                exes_to_try.push(p);
            }
        }
    }

    // If no non-launcher exe found yet, scan candidate directories for real game binaries
    if exes_to_try.is_empty() {
        for dir in &candidate_dirs {
            let candidates = find_candidate_game_exes(dir);
            for c in candidates {
                if !exes_to_try.contains(&c) {
                    exes_to_try.push(c);
                }
            }
        }
    }

    // Fallback: if still empty, try the original path
    if exes_to_try.is_empty() {
        if let Some(ref path) = query.path {
            let p = PathBuf::from(path);
            if p.is_file() {
                exes_to_try.push(p);
            }
        }
    }

    for exe in exes_to_try {
        if let Some(v) = get_exe_file_version(exe.to_string_lossy().to_string()) {
            if v != "0.0.0.0" {
                return Some(GameVersionInfo {
                    version: v,
                    source: "exe".to_string(),
                });
            }
        }
    }

    // 5. Steam manifest buildid check
    if let Some(app_id) = query.steam_app_id {
        if let Some(manifest) = crate::steam_game_watcher::find_app_install_dir(app_id) {
            if let Some(build_id) = manifest.build_id {
                return Some(GameVersionInfo {
                    version: build_id,
                    source: "steam_manifest".to_string(),
                });
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_returns_none() {
        assert_eq!(
            get_exe_file_version("Z:/definitely/not/a/real/game.exe".to_string()),
            None
        );
    }

    #[test]
    fn normalize_trims_surrounding_whitespace() {
        assert_eq!(
            normalize_version("  2.57.1.125  "),
            Some("2.57.1.125".to_string())
        );
        assert_eq!(normalize_version("\t1.0\n"), Some("1.0".to_string()));
    }

    #[test]
    fn normalize_strips_build_metadata_and_parenthetical_suffixes() {
        // Witcher 3 style "(Build Machine)" suffix attached without a space.
        assert_eq!(
            normalize_version("4.0.0.87877(Build Machine)"),
            Some("4.0.0.87877".to_string())
        );
        // Semver build metadata (The Crew / Ravenfield style).
        assert_eq!(
            normalize_version("1.0.0+c1eba6e0d720e2e1336e3ca6219e86abe0ae2311"),
            Some("1.0.0".to_string())
        );
        // A trailing note after whitespace.
        assert_eq!(
            normalize_version("2020.3.49f1 (18249dd5551b)"),
            Some("2020.3.49f1".to_string())
        );
        // Bracketed note.
        assert_eq!(
            normalize_version("1.0.4 [DODI Repack]"),
            Some("1.0.4".to_string())
        );
    }

    #[test]
    fn normalize_keeps_unusual_version_strings() {
        // Unreal shipping builds tag odd but meaningful version strings.
        assert_eq!(normalize_version("UE5-CL-0"), Some("UE5-CL-0".to_string()));
        assert_eq!(
            normalize_version("discovery_11.06.x_ue57-CL-1355454"),
            Some("discovery_11.06.x_ue57-CL-1355454".to_string())
        );
        // A `+` suffix that isn't a hex hash stays intact.
        assert_eq!(
            normalize_version("++Wardogs+Live-CL-496598"),
            Some("++Wardogs+Live-CL-496598".to_string())
        );
    }

    #[test]
    fn normalize_handles_comma_separated_versions() {
        assert_eq!(
            normalize_version("1, 0, 4, 12"),
            Some("1.0.4.12".to_string())
        );
        assert_eq!(normalize_version("2,57,1,0"), Some("2.57.1.0".to_string()));
    }

    #[test]
    fn normalize_strips_common_prefixes() {
        assert_eq!(normalize_version("Release 1.2.3"), Some("1.2.3".to_string()));
        assert_eq!(normalize_version("Version 2.0.1"), Some("2.0.1".to_string()));
        assert_eq!(normalize_version("Ver. 3.4.0"), Some("3.4.0".to_string()));
        assert_eq!(normalize_version("v1.5.0"), Some("1.5.0".to_string()));
        assert_eq!(normalize_version("V2.1"), Some("2.1".to_string()));
    }

    #[test]
    fn normalize_rejects_empty_values() {
        assert_eq!(normalize_version(""), None);
        assert_eq!(normalize_version("   "), None);
        assert_eq!(normalize_version("(Build Machine)"), None);
    }

    #[test]
    fn normalize_rejects_control_characters() {
        assert_eq!(normalize_version("\u{0005}"), None);
        assert_eq!(normalize_version("1.0\u{0000}"), None);
    }

    #[test]
    fn check_folder_manifest_reads_version_txt() {
        let temp_dir = std::env::temp_dir().join(format!("gamelib_test_ver_{}", std::process::id()));
        let _ = fs::create_dir_all(&temp_dir);
        let ver_file = temp_dir.join("version.txt");
        let _ = fs::write(&ver_file, "v1.4.2\nBuild info here");

        let result = check_folder_manifests(&[temp_dir.clone()]);
        assert_eq!(result, Some("1.4.2".to_string()));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn check_gog_manifest_reads_info_json() {
        let temp_dir = std::env::temp_dir().join(format!("gamelib_test_gog_{}", std::process::id()));
        let _ = fs::create_dir_all(&temp_dir);
        let info_file = temp_dir.join("goggame-12345.info");
        let _ = fs::write(
            &info_file,
            r#"{"gameId":"12345","version":"2.1.0","buildId":"500"}"#,
        );

        let result = check_gog_manifest(&[temp_dir.clone()]);
        assert_eq!(result, Some("2.1.0".to_string()));

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
