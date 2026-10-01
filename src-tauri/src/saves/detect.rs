//! Save-location detection.
//!
//! Three complementary strategies, all best-effort and safe to re-run:
//!
//!   1. **Curated registry** — exact templates for known titles
//!      ([`super::registry`]).
//!   2. **Heuristic scan** — look for folders named after the game under
//!      the standard save roots (`Documents`, `My Games`, `Saved Games`,
//!      `%APPDATA%`, `%LOCALAPPDATA%`/`LocalLow`, `~/.config`, …).
//!   3. **Store / emulator hints** — Steam Cloud `userdata/<id>/<appid>`
//!      folders, and an emulator's configured saves folder.
//!
//! Detection never deletes anything: results are merged into the stored
//! locations (case-insensitively de-duped) by the command layer.

use std::path::{Path, PathBuf};

use crate::db::games::GameRow;
use crate::db::Db;

use super::registry;

/// A candidate location found by the scanner, before it is persisted.
#[derive(Debug, Clone)]
pub struct DetectedLocation {
    pub path: String,
    pub label: String,
    /// `"dir"` or `"file"`.
    pub kind: String,
    /// `curated | heuristic | steam | emulator`.
    pub source: String,
}

/// Known save roots for the host. Every field is optional so the same
/// struct works on Windows, macOS and Linux.
pub struct Roots {
    pub home: Option<PathBuf>,
    pub appdata: Option<PathBuf>,
    pub local_appdata: Option<PathBuf>,
    pub local_low: Option<PathBuf>,
    pub documents: Option<PathBuf>,
    pub saved_games: Option<PathBuf>,
    pub program_data: Option<PathBuf>,
}

impl Roots {
    /// Resolve the host's standard folders from the environment.
    pub fn resolve() -> Roots {
        let home = env_path("HOME")
            .or_else(|| env_path("USERPROFILE"))
            .or_else(|| dirs_home());
        let appdata = env_path("APPDATA").or_else(|| home.as_ref().map(|h| h.join(".config")));
        let local_appdata =
            env_path("LOCALAPPDATA").or_else(|| home.as_ref().map(|h| h.join(".local/share")));
        // On Windows LocalLow is `%LOCALAPPDATA%\..\LocalLow`; elsewhere
        // it doesn't exist and the field stays None.
        let local_low = local_appdata
            .as_ref()
            .and_then(|l| l.parent())
            .map(|p| p.join("LocalLow"))
            .filter(|p| p.is_dir());
        let documents = env_path("USERPROFILE")
            .map(|u| u.join("Documents"))
            .or_else(|| home.as_ref().map(|h| h.join("Documents")));
        let saved_games = env_path("USERPROFILE")
            .map(|u| u.join("Saved Games"))
            .or_else(|| home.as_ref().map(|h| h.join("Saved Games")));
        let program_data = env_path("PROGRAMDATA").or_else(|| {
            #[cfg(target_os = "windows")]
            {
                Some(PathBuf::from("C:/ProgramData"))
            }
            #[cfg(not(target_os = "windows"))]
            {
                None
            }
        });
        Roots {
            home,
            appdata,
            local_appdata,
            local_low,
            documents,
            saved_games,
            program_data,
        }
    }
}

fn env_path(key: &str) -> Option<PathBuf> {
    std::env::var_os(key)
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
}

fn dirs_home() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        None
    }
    #[cfg(not(target_os = "windows"))]
    {
        // `HOME` is normally set on Unix; this is a last resort.
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

/// Context used to expand registry templates.
pub struct TemplateCtx<'a> {
    pub roots: &'a Roots,
    pub app_id: Option<u32>,
    pub install_dir: Option<PathBuf>,
}

/// Expand a `<token>/…` template into an absolute path, or `None` when a
/// token has no meaning on this host.
pub fn resolve_template(template: &str, ctx: &TemplateCtx<'_>) -> Option<PathBuf> {
    let mut segments = template.split('/');
    let head = segments.next()?;
    let mut base: PathBuf = match head {
        "<winAppData>" => ctx.roots.appdata.clone()?,
        "<winLocalAppData>" => ctx.roots.local_appdata.clone()?,
        "<winLocalLow>" => ctx.roots.local_low.clone()?,
        "<winDocuments>" => ctx.roots.documents.clone()?,
        "<winSavedGames>" => ctx.roots.saved_games.clone()?,
        "<winProgramData>" => ctx.roots.program_data.clone()?,
        "<home>" => ctx.roots.home.clone()?,
        "<base>" => ctx.install_dir.clone()?,
        _ => return None,
    };
    for seg in segments {
        if seg.is_empty() || seg == "." {
            continue;
        }
        let replaced = match seg {
            "<storeAppId>" => ctx.app_id.map(|a| a.to_string()),
            "<osUserName>" => std::env::var("USERNAME")
                .ok()
                .or_else(|| std::env::var("USER").ok()),
            _ => Some(seg.to_string()),
        };
        let Some(replaced) = replaced else {
            return None;
        };
        base.push(replaced);
    }
    Some(base)
}

/// Return the install directory hint for a game (the folder holding its exe).
fn install_dir(game: &GameRow) -> Option<PathBuf> {
    if game.path.trim().is_empty() {
        return None;
    }
    Path::new(&game.path).parent().map(|p| p.to_path_buf())
}

/// Steam install root inferred from a game's install path (`…/steamapps/common/<game>`).
fn steam_root_from_install(game: &GameRow) -> Option<PathBuf> {
    let path = Path::new(&game.path);
    for ancestor in path.ancestors() {
        if ancestor
            .file_name()
            .map(|n| n.eq_ignore_ascii_case("steamapps"))
            .unwrap_or(false)
        {
            return ancestor.parent().map(|p| p.to_path_buf());
        }
    }
    None
}

/// Build the ordered list of normalized name variants to match against
/// folder names.
fn name_variants(game: &GameRow) -> Vec<String> {
    let mut out = Vec::new();
    for raw in [Some(game.name.as_str()), game.display_name.as_deref()] {
        if let Some(raw) = raw {
            let n = registry::normalize_name(raw);
            if !n.is_empty() {
                out.push(n);
            }
        }
    }
    if let Some(stem) = Path::new(&game.path)
        .file_stem()
        .and_then(|s| s.to_str())
    {
        let n = registry::normalize_name(stem);
        if !n.is_empty() {
            out.push(n);
        }
    }
    out.sort();
    out.dedup();
    out
}

/// Detect save locations for one game.
pub fn detect_for_game(
    db: &Db,
    game: &GameRow,
    include_emulator_saves: bool,
) -> Vec<DetectedLocation> {
    let roots = Roots::resolve();
    let ctx = TemplateCtx {
        roots: &roots,
        app_id: game.steam_app_id,
        install_dir: install_dir(game),
    };

    let mut found: Vec<DetectedLocation> = Vec::new();
    let push = |found: &mut Vec<DetectedLocation>, path: PathBuf, label: String, kind: &str, source: &str| {
        if !path.exists() {
            return;
        }
        let key = path.to_string_lossy().to_lowercase();
        if found.iter().any(|l| l.path.to_lowercase() == key) {
            return;
        }
        found.push(DetectedLocation {
            path: path.to_string_lossy().replace('\\', "/"),
            label,
            kind: kind.to_string(),
            source: source.to_string(),
        });
    };

    // 1. Curated registry.
    if let Some(entry) = registry::lookup(game.steam_app_id, &game.name) {
        for template in entry.paths {
            if let Some(path) = resolve_template(template, &ctx) {
                let label = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Saves")
                    .to_string();
                push(&mut found, path, label, "dir", "curated");
            }
        }
    }

    // 2. Steam Cloud userdata.
    if let (Some(root), Some(app_id)) = (steam_root_from_install(game), game.steam_app_id) {
        if let Ok(entries) = std::fs::read_dir(root.join("userdata")) {
            for user in entries.flatten() {
                let candidate = user.path().join(app_id.to_string());
                if candidate.is_dir() {
                    push(
                        &mut found,
                        candidate,
                        "Steam Cloud".to_string(),
                        "dir",
                        "steam",
                    );
                }
            }
        }
    }

    // 3. Heuristic name-match across the standard roots.
    let variants = name_variants(game);
    if !variants.is_empty() {
        let mut scan_roots: Vec<PathBuf> = Vec::new();
        if let Some(d) = &roots.documents {
            scan_roots.push(d.clone());
            scan_roots.push(d.join("My Games"));
        }
        for r in [
            &roots.saved_games,
            &roots.appdata,
            &roots.local_appdata,
            &roots.local_low,
        ] {
            if let Some(r) = r {
                scan_roots.push(r.clone());
            }
        }
        for root in scan_roots {
            scan_children_for_names(&root, &variants, 2, &mut found);
        }
    }

    // 4. Emulator saves (per-ROM file matching).
    if include_emulator_saves {
        if let Some(emu_id) = game.emulator_id.as_deref() {
            if let Ok(Some(emu)) = crate::db::emulators::get(db, emu_id) {
                if let Some(folder) = emu.saves_folder.filter(|f| !f.trim().is_empty()) {
                    detect_emulator_saves(&folder, game, &mut found);
                }
            }
        }
    }

    found
}

/// Walk `dir` up to `max_depth`, adding children whose normalized name
/// exactly matches a game name variant.
fn scan_children_for_names(
    dir: &Path,
    variants: &[String],
    max_depth: usize,
    out: &mut Vec<DetectedLocation>,
) {
    fn walk(dir: &Path, variants: &[String], depth: usize, max_depth: usize, out: &mut Vec<DetectedLocation>) {
        if depth > max_depth {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else { continue };
            if file_type.is_symlink() {
                continue;
            }
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if file_type.is_dir() {
                let normalized = registry::normalize_name(name);
                if variants.iter().any(|v| *v == normalized) {
                    let key = path.to_string_lossy().to_lowercase();
                    if !out.iter().any(|l| l.path.to_lowercase() == key) {
                        out.push(DetectedLocation {
                            path: path.to_string_lossy().replace('\\', "/"),
                            label: name.to_string(),
                            kind: "dir".to_string(),
                            source: "heuristic".to_string(),
                        });
                    }
                    continue;
                }
                // Only descend one extra level — `My Games/<Game>` and
                // `LocalLow/<Company>/<Game>` are the useful shapes.
                walk(&path, variants, depth + 1, max_depth, out);
            }
        }
    }
    walk(dir, variants, 1, max_depth, out);
}

/// Find an emulator's save files for a ROM (matched by file stem).
fn detect_emulator_saves(folder: &str, game: &GameRow, out: &mut Vec<DetectedLocation>) {
    let root = Path::new(folder);
    if !root.is_dir() {
        return;
    }
    let stem = game
        .rom_path
        .as_deref()
        .and_then(|p| Path::new(p).file_stem())
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_else(|| game.name.to_lowercase());

    let mut matched = Vec::new();
    collect_by_stem(root, &stem, 0, out, &mut matched);

    // No per-ROM file matched (fresh install / unusual layout): fall back
    // to backing up the whole saves folder so nothing is silently missed.
    if matched.is_empty() {
        let key = root.to_string_lossy().to_lowercase();
        if !out.iter().any(|l| l.path.to_lowercase() == key) {
            out.push(DetectedLocation {
                path: root.to_string_lossy().replace('\\', "/"),
                label: "Emulator saves".to_string(),
                kind: "dir".to_string(),
                source: "emulator".to_string(),
            });
        }
    }
}

fn collect_by_stem(
    dir: &Path,
    stem: &str,
    depth: usize,
    out: &mut Vec<DetectedLocation>,
    matched: &mut Vec<()>,
) {
    if depth > 3 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_by_stem(&path, stem, depth + 1, out, matched);
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let lower = name.to_lowercase();
        let file_stem = Path::new(name)
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s.to_lowercase())
            .unwrap_or_default();
        if file_stem != stem && !lower.starts_with(stem) {
            continue;
        }
        let key = path.to_string_lossy().to_lowercase();
        if out.iter().any(|l| l.path.to_lowercase() == key) {
            continue;
        }
        out.push(DetectedLocation {
            path: path.to_string_lossy().replace('\\', "/"),
            label: name.to_string(),
            kind: "file".to_string(),
            source: "emulator".to_string(),
        });
        matched.push(());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roots_with(home: &Path) -> Roots {
        Roots {
            home: Some(home.to_path_buf()),
            appdata: Some(home.join("AppData/Roaming")),
            local_appdata: Some(home.join("AppData/Local")),
            local_low: Some(home.join("AppData/LocalLow")),
            documents: Some(home.join("Documents")),
            saved_games: Some(home.join("Saved Games")),
            program_data: None,
        }
    }

    #[test]
    fn template_expands_tokens() {
        let dir = tempfile::tempdir().unwrap();
        let roots = roots_with(dir.path());
        let ctx = TemplateCtx {
            roots: &roots,
            app_id: Some(123),
            install_dir: None,
        };
        let p = resolve_template("<winAppData>/Game/saves", &ctx).unwrap();
        assert!(p.ends_with("AppData/Roaming/Game/saves") || p.ends_with("AppData\\Roaming\\Game\\saves"));

        let steam = resolve_template("<home>/.steam/<storeAppId>", &ctx).unwrap();
        assert_eq!(steam.file_name().unwrap(), "123");
    }

    #[test]
    fn template_returns_none_for_unknown_token() {
        let dir = tempfile::tempdir().unwrap();
        let roots = roots_with(dir.path());
        let ctx = TemplateCtx {
            roots: &roots,
            app_id: None,
            install_dir: None,
        };
        assert!(resolve_template("<nope>/x", &ctx).is_none());
        // `<storeAppId>` with no app id cannot resolve.
        assert!(resolve_template("<home>/<storeAppId>", &ctx).is_none());
    }

    #[test]
    fn heuristic_finds_name_matched_folder() {
        let dir = tempfile::tempdir().unwrap();
        let docs = dir.path().join("Documents/My Games");
        std::fs::create_dir_all(docs.join("Skyrim Special Edition/Saves")).unwrap();
        let variants = vec![registry::normalize_name("Skyrim Special Edition")];
        let mut out = Vec::new();
        scan_children_for_names(&docs, &variants, 2, &mut out);
        assert_eq!(out.len(), 1);
        assert!(out[0].path.ends_with("Skyrim Special Edition"));
        assert_eq!(out[0].source, "heuristic");
    }
}
