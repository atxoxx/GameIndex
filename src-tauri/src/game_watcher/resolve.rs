use serde::Serialize;
use std::path::Path;

use crate::steam_game_watcher;


/// Serializable info about a candidate exe found during resolution.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExeCandidate {
    pub path: String,
    pub size_bytes: u64,
    pub name_score: f32,
    pub depth: u32,
}

pub(crate) const SKIP_KEYWORDS: &[&str] = &[
    // Redistributables & runtimes
    "redist", "vcredist", "dotnet", "dxsetup", "directx",
    "ue4prereq", "ue4-prereq", "ue5prereq", "ue5-prereq",
    "physx", "openal",
    // Launchers & patchers
    "launcher", "patcher", "updater", "bootstrapper",
    // Crash handlers & telemetry
    "crash", "crashpad", "crashreport", "crashhandler",
    "errorreport", "bugreport", "debug",
    // Uninstallers
    "unin", "unins", "uninstall", "unwise",
    // Setup/Install
    "setup", "install", "register",
    // Utilities
    "helper", "autorun", "plugin", "manual", "readme", "7za",
    "config", "configuration", "settings",
    // Steam-specific
    "steamclient", "steamerror",
    // Unity
    "unitycrashhandler", "unitycrashhandler64",
    "videoplayer",
    // Unreal
    "ue4_game", "ue5_game",
    // Known non-game processes
    "gamingservices", "gamingservice",
    "eadesktop", "origin", "ubisoftconnect", "upc",
    "epicgameslauncher", "galaxyclient",
    // Wallpaper Engine — always-running background app that must never be
    // tracked as a game (covers wallpaper64.exe / wallpaper32.exe).
    "wallpaper",
];

/// Resolve the main game executable for a given install directory.
///
/// Multi-strategy approach:
/// 1. Name match scoring against the provided game_name (+200 exact, +10 per word)
/// 2. Directory depth: prefer shallower exes (-5 per level below root)
/// 3. Keyword exclusion (handled during scan)
/// 4. Size: largest as tiebreaker
pub fn resolve_game_exe(install_dir: &Path, game_name: &str) -> Option<String> {
    let candidates = scan_for_exe_candidates(install_dir);
    if candidates.is_empty() {
        return None;
    }

    let game_name_lower = game_name.to_lowercase();
    let game_words: Vec<&str> = game_name_lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .filter(|w| w.len() > 1)
        .collect();

    let mut scored: Vec<(&ExeCandidate, u32)> = candidates
        .iter()
        .map(|c| {
            let stem = Path::new(&c.path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();

            let mut score: u32 = 0;

            // Name match scoring
            if stem == game_name_lower {
                score += 200;
            }
            let stem_words: Vec<&str> = stem
                .split(|c: char| !c.is_alphanumeric())
                .filter(|w| !w.is_empty())
                .collect();
            for gw in &game_words {
                for sw in &stem_words {
                    if sw.contains(gw) || gw.contains(sw) {
                        score += 10;
                    }
                }
            }

            // Directory depth penalty
            let depth_penalty = (c.depth.saturating_sub(1) * 5) as u32;
            score = score.saturating_sub(depth_penalty);

            (c, score)
        })
        .collect();

    scored.sort_by(|(a, a_score), (b, b_score)| {
        b_score
            .cmp(a_score)
            .then_with(|| b.size_bytes.cmp(&a.size_bytes))
    });

    scored.first().map(|(c, _)| c.path.clone())
}

pub(crate) fn scan_for_exe_candidates(dir: &Path) -> Vec<ExeCandidate> {
    // The walk fans one install tree across rayon's pool; results are
    // collected under a mutex (the caller re-sorts them by score anyway).
    let candidates = std::sync::Mutex::new(Vec::new());

    let visit = |_dir: &Path, entry: &Path, depth: u32, meta: &std::fs::Metadata| {
        if !meta.is_file() {
            return;
        }
        let Some(ext) = entry.extension().and_then(|e| e.to_str()) else {
            return;
        };
        if !ext.eq_ignore_ascii_case("exe") {
            return;
        }
        if let Some(stem) = entry.file_stem().and_then(|s| s.to_str()) {
            let lower = stem.to_lowercase();
            if SKIP_KEYWORDS.iter().any(|kw| lower.contains(kw)) {
                return;
            }
        }
        if let Ok(mut guard) = candidates.lock() {
            guard.push(ExeCandidate {
                path: entry.to_string_lossy().to_string(),
                size_bytes: meta.len(),
                name_score: 0.0,
                depth,
            });
        }
    };

    let descend = |_dir: &Path, name: &str, _depth: u32| -> bool {
        let lower = name.to_lowercase();
        !(lower.starts_with('.')
            || lower.starts_with('_')
            || lower == "redist"
            || lower == "redistributables"
            || lower == "__installer"
            || lower == "support"
            || lower == "directx"
            || lower == "dotnet"
            || lower == "vcredist")
    };

    crate::scan::walk_parallel(dir, 4, None, &visit, &descend);

    candidates.into_inner().unwrap_or_default()
}

/// Convenience wrapper: resolve the exe for a Steam AppID.
pub fn resolve_steam_game_exe(steam_app_id: u32, game_name: &str) -> Option<String> {
    let install_dir = steam_game_watcher::game_install_path(steam_app_id)?;
    if !install_dir.exists() {
        return None;
    }
    resolve_game_exe(&install_dir, game_name)
}
