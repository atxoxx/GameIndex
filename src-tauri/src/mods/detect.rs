//! Engine-aware mod detection.
//!
//! Given a game's executable path (and optional Steam app id) this
//! module figures out which modding "engines" the install uses and
//! enumerates the mods each one carries. Detection is purely
//! read-from-disk — nothing here mutates the install; write-backs
//! (plugins.txt rewrite, `.disabled` renames) live in the command
//! layer (`super`).
//!
//! Supported engines, mirroring what Vortex / Mod Organizer 2 manage:
//!
//! | Engine        | Signal                                   | Mods |
//! |---------------|------------------------------------------|------|
//! | `bethesda`    | `Data/*.esp\|.esm\|.esl`                 | plugin files, state from `plugins.txt` |
//! | `bepinex`     | `BepInEx/plugins/`                       | dlls / plugin folders |
//! | `melonloader` | `MelonLoader/` + `Mods/*.dll`            | dlls |
//! | `unreal`      | `<Project>/Content/Paks/~mods` (or `LogicMods`) | pak bundles |
//! | `workshop`    | `steamapps/workshop/content/<appid>/`    | Steam-managed items (read-only) |
//! | `generic`     | `Mods/` next to the exe                  | loose files / folders |

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use crate::db::mods::ModRow;

/// Everything one scan pass learned about a game install.
pub struct ScanOutcome {
    pub mods: Vec<ModRow>,
    pub files_examined: u64,
    pub truncated: bool,
    pub engines: Vec<String>,
    pub mods_root: Option<String>,
    pub plugins_txt: Option<String>,
    pub nexus_domain: Option<String>,
}

pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Stable, short, non-cryptographic hash — same recipe as the ROM
/// scanner's `hash_str` so mod ids are deterministic across re-scans.
fn hash_str(s: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    format!("{:x}", h.finish())
}

/// Canonical identity key for a mod artifact: game + lowercased path
/// with any `.disabled` suffix stripped, so enabling/disabling (a
/// rename) keeps the same row id and its Nexus linkage/notes.
pub fn mod_id_for(game_id: &str, path: &str) -> String {
    let lower = path.to_lowercase();
    let stem = lower.strip_suffix(".disabled").unwrap_or(&lower);
    format!("gm-{}", hash_str(&format!("{game_id}|{stem}")))
}

fn strip_disabled(name: &str) -> (&str, bool) {
    match name.strip_suffix(".disabled") {
        Some(s) => (s, true),
        None => (name, false),
    }
}

/// Recursive size + file-count with an entry cap so a huge workshop
/// item can't stall the scan.
fn dir_stats(path: &Path, cap: &mut u32) -> (u64, u64) {
    let mut bytes = 0u64;
    let mut files = 0u64;
    if *cap == 0 {
        return (0, 0);
    }
    let Ok(rd) = fs::read_dir(path) else {
        return (0, 0);
    };
    for entry in rd.flatten() {
        if *cap == 0 {
            break;
        }
        *cap -= 1;
        let p = entry.path();
        if p.is_dir() {
            let (b, f) = dir_stats(&p, cap);
            bytes += b;
            files += f;
        } else if let Ok(md) = entry.metadata() {
            bytes += md.len();
            files += 1;
        }
    }
    (bytes, files)
}

fn file_size(path: &Path) -> Option<i64> {
    fs::metadata(path).ok().map(|m| m.len() as i64)
}

fn base_row(game_id: &str, name: &str, engine: &str, kind: &str, path: &Path, enabled: bool) -> ModRow {
    let now = now_secs();
    let path_str = path.to_string_lossy().to_string();
    ModRow {
        id: mod_id_for(game_id, &path_str),
        game_id: game_id.to_string(),
        name: name.to_string(),
        version: None,
        author: None,
        engine: engine.to_string(),
        kind: kind.to_string(),
        path: path_str,
        enabled,
        load_order: 0,
        size_bytes: None,
        file_count: None,
        md5: None,
        nexus_mod_id: None,
        nexus_domain: None,
        latest_version: None,
        update_available: false,
        notes: None,
        detected_at: now,
        updated_at: now,
    }
}

// === Bethesda ==============================================================

/// Per-title profile keyed off the executable name: which
/// `%LOCALAPPDATA%` folder holds `plugins.txt`, whether the file uses
/// the `*`-prefix ("star") enabled markers (SSE/FO4/Starfield) or the
/// legacy presence-means-enabled format, and the Nexus Mods domain.
struct BethesdaProfile {
    local_folder: &'static str,
    nexus_domain: &'static str,
}

fn bethesda_profile_for_exe(exe_lower: &str) -> Option<BethesdaProfile> {
    let table: &[(&[&str], &str, &str)] = &[
        (&["skyrimse.exe", "skse64_loader.exe"], "Skyrim Special Edition", "skyrimspecialedition"),
        (&["skyrimvr.exe"], "Skyrim VR", "skyrimspecialedition"),
        (&["tesv.exe", "skse_loader.exe"], "Skyrim", "skyrim"),
        (&["fallout4.exe", "f4se_loader.exe"], "Fallout4", "fallout4"),
        (&["fallout4vr.exe"], "Fallout4VR", "fallout4"),
        (&["falloutnv.exe", "nvse_loader.exe"], "FalloutNV", "newvegas"),
        (&["fallout3.exe", "fose_loader.exe"], "Fallout3", "fallout3"),
        (&["oblivion.exe", "obse_loader.exe"], "Oblivion", "oblivion"),
        (&["starfield.exe", "sfse_loader.exe"], "Starfield", "starfield"),
    ];
    for (exes, folder, domain) in table {
        if exes.iter().any(|e| *e == exe_lower) {
            return Some(BethesdaProfile {
                local_folder: folder,
                nexus_domain: domain,
            });
        }
    }
    None
}

/// `plugins.txt` folders whose format is the legacy
/// presence-means-enabled one (no `*` marker).
pub fn plugins_txt_is_star_format(plugins_txt: &Path) -> bool {
    let legacy = ["Skyrim", "Oblivion", "Fallout3", "FalloutNV", "Morrowind"];
    let folder = plugins_txt
        .parent()
        .and_then(|p| p.file_name())
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    !legacy.iter().any(|l| l.eq_ignore_ascii_case(&folder))
}

/// Official/base-game plugins we never surface as "mods".
fn is_vanilla_plugin(file_lower: &str) -> bool {
    const VANILLA: &[&str] = &[
        // Skyrim / SSE
        "skyrim.esm", "update.esm", "dawnguard.esm", "hearthfires.esm", "dragonborn.esm",
        "_resourcepack.esl",
        // Fallout 4
        "fallout4.esm", "dlcrobot.esm", "dlcworkshop01.esm", "dlcworkshop02.esm",
        "dlcworkshop03.esm", "dlccoast.esm", "dlcnukaworld.esm", "dlcultrahighresolution.esm",
        // Fallout NV
        "falloutnv.esm", "deadmoney.esm", "honesthearts.esm", "oldworldblues.esm",
        "lonesomeroad.esm", "gunrunnersarsenal.esm", "caravanpack.esm", "classicpack.esm",
        "mercenarypack.esm", "tribalpack.esm",
        // Fallout 3
        "fallout3.esm", "anchorage.esm", "thepitt.esm", "brokensteel.esm",
        "pointlookout.esm", "zeta.esm",
        // Oblivion
        "oblivion.esm", "knights.esp", "dlcshiveringisles.esp", "dlcbattlehorncastle.esp",
        "dlcfrostcrag.esp", "dlchorsearmor.esp", "dlcmehrunesrazor.esp", "dlcorrery.esp",
        "dlcspelltomes.esp", "dlcthievesden.esp", "dlcvilelair.esp",
        // Starfield
        "starfield.esm", "constellation.esm", "oldmars.esm", "blueprintships-starfield.esm",
        "sfbgs003.esm", "sfbgs004.esm", "sfbgs006.esm", "sfbgs007.esm", "sfbgs008.esm",
    ];
    // Creation Club content ships as `cc<publisher>...` archives/plugins.
    file_lower.starts_with("cc") || VANILLA.contains(&file_lower)
}

/// Parse `plugins.txt` into `filename(lower) -> (enabled, position)`.
pub fn parse_plugins_txt(path: &Path) -> HashMap<String, (bool, usize)> {
    let mut out = HashMap::new();
    let Ok(content) = fs::read_to_string(path) else {
        return out;
    };
    let star_format = plugins_txt_is_star_format(path);
    let mut pos = 0usize;
    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (enabled, name) = if let Some(rest) = line.strip_prefix('*') {
            (true, rest.trim())
        } else {
            // Legacy format: listed == enabled. Star format: listed
            // without a star == installed but disabled.
            (!star_format, line)
        };
        out.insert(name.to_lowercase(), (enabled, pos));
        pos += 1;
    }
    out
}

fn scan_bethesda(game_id: &str, game_dir: &Path, exe_lower: &str, out: &mut ScanOutcome) {
    let data = game_dir.join("Data");
    if !data.is_dir() {
        return;
    }
    let Ok(rd) = fs::read_dir(&data) else {
        return;
    };
    let mut plugin_files: Vec<PathBuf> = Vec::new();
    for entry in rd.flatten() {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let ext = p
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if !matches!(ext.as_str(), "esp" | "esm" | "esl") {
            continue;
        }
        let fname = p
            .file_name()
            .map(|f| f.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if is_vanilla_plugin(&fname) {
            continue;
        }
        plugin_files.push(p);
    }
    if plugin_files.is_empty() {
        return;
    }

    let profile = bethesda_profile_for_exe(exe_lower);
    let plugins_txt: Option<PathBuf> = profile.as_ref().and_then(|pr| {
        std::env::var("LOCALAPPDATA").ok().map(|lad| {
            Path::new(&lad).join(pr.local_folder).join("Plugins.txt")
        })
    });
    let state = plugins_txt
        .as_ref()
        .filter(|p| p.is_file())
        .map(|p| parse_plugins_txt(p))
        .unwrap_or_default();
    let has_state = !state.is_empty();

    let mut rows: Vec<ModRow> = Vec::new();
    for p in plugin_files {
        let fname = p
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();
        let stem = p
            .file_stem()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_else(|| fname.clone());
        let (enabled, order) = match state.get(&fname.to_lowercase()) {
            Some((en, pos)) => (*en, *pos as i64),
            // No plugins.txt at all -> assume active; plugins.txt
            // present but plugin unlisted -> installed-but-inactive.
            None => (!has_state, i64::MAX),
        };
        let mut row = base_row(game_id, &stem, "bethesda", "plugin", &p, enabled);
        row.load_order = order;
        row.size_bytes = file_size(&p);
        row.file_count = Some(1);
        rows.push(row);
    }
    // plugins.txt order first, then unlisted plugins alphabetically.
    rows.sort_by(|a, b| {
        a.load_order
            .cmp(&b.load_order)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    out.engines.push("bethesda".into());
    if out.mods_root.is_none() {
        out.mods_root = Some(data.to_string_lossy().to_string());
    }
    out.plugins_txt = plugins_txt.map(|p| p.to_string_lossy().to_string());
    if out.nexus_domain.is_none() {
        out.nexus_domain = profile.map(|pr| pr.nexus_domain.to_string());
    }
    out.mods.extend(rows);
}

// === BepInEx / MelonLoader / generic loose-folder engines ==================

/// Enumerate the direct children of a mods folder as one mod each.
/// `dll_only` restricts file entries to `.dll` (BepInEx/MelonLoader);
/// folders always count. `.disabled` suffix == disabled.
fn scan_loose_folder(
    game_id: &str,
    dir: &Path,
    engine: &str,
    dll_only: bool,
    out_rows: &mut Vec<ModRow>,
) {
    let Ok(rd) = fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
    entries.sort_by_key(|p| p.file_name().map(|f| f.to_string_lossy().to_lowercase()));
    for p in entries {
        let raw_name = p
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();
        let (visible, disabled) = strip_disabled(&raw_name);
        if p.is_dir() {
            let name = Path::new(visible)
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_else(|| visible.to_string());
            let mut cap = 20_000u32;
            let (bytes, files) = dir_stats(&p, &mut cap);
            let mut row = base_row(game_id, &name, engine, "folder", &p, !disabled);
            row.size_bytes = Some(bytes as i64);
            row.file_count = Some(files as i64);
            out_rows.push(row);
        } else {
            let lower = visible.to_lowercase();
            let is_dll = lower.ends_with(".dll");
            if dll_only && !is_dll {
                continue;
            }
            if !dll_only && !is_dll && lower.ends_with(".txt") {
                continue; // readme noise in generic Mods folders
            }
            let stem = Path::new(visible)
                .file_stem()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_else(|| visible.to_string());
            let kind = if is_dll { "dll" } else { "file" };
            let mut row = base_row(game_id, &stem, engine, kind, &p, !disabled);
            row.size_bytes = file_size(&p);
            row.file_count = Some(1);
            out_rows.push(row);
        }
    }
}

fn scan_bepinex(game_id: &str, game_dir: &Path, out: &mut ScanOutcome) {
    let plugins = game_dir.join("BepInEx").join("plugins");
    if !plugins.is_dir() {
        return;
    }
    let mut rows = Vec::new();
    scan_loose_folder(game_id, &plugins, "bepinex", true, &mut rows);
    out.engines.push("bepinex".into());
    if out.mods_root.is_none() {
        out.mods_root = Some(plugins.to_string_lossy().to_string());
    }
    out.mods.extend(rows);
}

fn scan_melonloader(game_id: &str, game_dir: &Path, out: &mut ScanOutcome) {
    let mods = game_dir.join("Mods");
    if !game_dir.join("MelonLoader").is_dir() || !mods.is_dir() {
        return;
    }
    let mut rows = Vec::new();
    scan_loose_folder(game_id, &mods, "melonloader", true, &mut rows);
    out.engines.push("melonloader".into());
    if out.mods_root.is_none() {
        out.mods_root = Some(mods.to_string_lossy().to_string());
    }
    out.mods.extend(rows);
}

fn scan_generic(game_id: &str, game_dir: &Path, out: &mut ScanOutcome) {
    // MelonLoader owns `Mods/`; don't double-report it.
    if out.engines.iter().any(|e| e == "melonloader") {
        return;
    }
    for candidate in ["Mods", "mods"] {
        let dir = game_dir.join(candidate);
        if !dir.is_dir() {
            continue;
        }
        let mut rows = Vec::new();
        scan_loose_folder(game_id, &dir, "generic", false, &mut rows);
        if rows.is_empty() {
            continue;
        }
        out.engines.push("generic".into());
        if out.mods_root.is_none() {
            out.mods_root = Some(dir.to_string_lossy().to_string());
        }
        out.mods.extend(rows);
        break;
    }
}

// === Unreal Engine =========================================================

/// Find `<Project>/Content/Paks` starting from the exe's folder. UE
/// ships the exe either at the install root or under
/// `<Project>/Binaries/Win64`, so we walk up to 3 ancestors and probe
/// each ancestor's child dirs.
fn find_paks_dir(game_dir: &Path) -> Option<PathBuf> {
    let mut roots: Vec<PathBuf> = vec![game_dir.to_path_buf()];
    let mut cur = game_dir.to_path_buf();
    for _ in 0..3 {
        match cur.parent() {
            Some(p) => {
                roots.push(p.to_path_buf());
                cur = p.to_path_buf();
            }
            None => break,
        }
    }
    for root in roots {
        let direct = root.join("Content").join("Paks");
        if direct.is_dir() {
            return Some(direct);
        }
        let Ok(rd) = fs::read_dir(&root) else {
            continue;
        };
        for entry in rd.flatten() {
            let p = entry.path();
            if !p.is_dir() {
                continue;
            }
            let paks = p.join("Content").join("Paks");
            if paks.is_dir() {
                return Some(paks);
            }
        }
    }
    None
}

fn scan_unreal(game_id: &str, game_dir: &Path, out: &mut ScanOutcome) {
    let Some(paks) = find_paks_dir(game_dir) else {
        return;
    };
    let mut rows = Vec::new();
    let mut root: Option<PathBuf> = None;
    for sub in ["~mods", "LogicMods", "Mods"] {
        let dir = paks.join(sub);
        if !dir.is_dir() {
            continue;
        }
        let Ok(rd) = fs::read_dir(&dir) else {
            continue;
        };
        let mut entries: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
        entries.sort_by_key(|p| p.file_name().map(|f| f.to_string_lossy().to_lowercase()));
        for p in entries {
            if !p.is_file() {
                continue;
            }
            let raw = p
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_default();
            let (visible, disabled) = strip_disabled(&raw);
            if !visible.to_lowercase().ends_with(".pak") {
                continue; // .ucas/.utoc ride along with their .pak
            }
            let stem = Path::new(visible)
                .file_stem()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_else(|| visible.to_string());
            let mut row = base_row(game_id, &stem, "unreal", "pak", &p, !disabled);
            // Count the sibling .ucas/.utoc (IoStore) files into size.
            let mut bytes = file_size(&p).unwrap_or(0);
            let mut count = 1i64;
            for ext in ["ucas", "utoc"] {
                let sib = p.with_extension(ext);
                if let Some(sz) = file_size(&sib) {
                    bytes += sz;
                    count += 1;
                }
            }
            row.size_bytes = Some(bytes);
            row.file_count = Some(count);
            rows.push(row);
        }
        if root.is_none() {
            root = Some(dir);
        }
    }
    if rows.is_empty() {
        return;
    }
    out.engines.push("unreal".into());
    if out.mods_root.is_none() {
        out.mods_root = root.map(|p| p.to_string_lossy().to_string());
    }
    out.mods.extend(rows);
}

// === Steam Workshop ========================================================

/// Best-effort human name for a workshop item folder: probe the
/// metadata files the popular engines ship (`About/About.xml`,
/// Paradox `descriptor.mod`, various `*.json` manifests) before
/// falling back to the numeric folder name.
fn workshop_item_name(dir: &Path) -> Option<String> {
    // RimWorld-style About/About.xml
    let about = dir.join("About").join("About.xml");
    if let Ok(xml) = fs::read_to_string(&about) {
        if let Ok(re) = regex::Regex::new(r"(?is)<name>\s*(.*?)\s*</name>") {
            if let Some(c) = re.captures(&xml) {
                let name = c[1].trim().to_string();
                if !name.is_empty() {
                    return Some(name);
                }
            }
        }
    }
    // Paradox descriptor.mod / *.mod
    for cand in ["descriptor.mod", "mod.mod"] {
        if let Ok(text) = fs::read_to_string(dir.join(cand)) {
            if let Ok(re) = regex::Regex::new(r#"(?m)^\s*name\s*=\s*"(.*?)""#) {
                if let Some(c) = re.captures(&text) {
                    return Some(c[1].to_string());
                }
            }
        }
    }
    // JSON manifests: modinfo.json, mod.info, info.json, manifest.json
    for cand in ["modinfo.json", "mod.info", "info.json", "manifest.json", "mod.json"] {
        if let Ok(text) = fs::read_to_string(dir.join(cand)) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                for key in ["name", "Name", "title", "Title", "displayName"] {
                    if let Some(name) = v.get(key).and_then(|n| n.as_str()) {
                        if !name.trim().is_empty() {
                            return Some(name.trim().to_string());
                        }
                    }
                }
            }
        }
    }
    None
}

fn scan_workshop(game_id: &str, game_path: &Path, steam_app_id: Option<&str>, out: &mut ScanOutcome) {
    let Some(appid) = steam_app_id.filter(|s| !s.is_empty()) else {
        return;
    };
    
    let mut candidate_content_dirs: Vec<PathBuf> = Vec::new();

    // 1. Check parent path relative to game_path (.../steamapps/common/<Game>/... -> .../steamapps/workshop/content/<appid>)
    let mut cur = game_path.to_path_buf();
    while let Some(parent) = cur.parent() {
        if cur
            .file_name()
            .map(|f| f.to_string_lossy().eq_ignore_ascii_case("steamapps"))
            .unwrap_or(false)
        {
            candidate_content_dirs.push(cur.join("workshop").join("content").join(appid));
            break;
        }
        cur = parent.to_path_buf();
    }

    // 2. Check Steam install root & libraryfolders.vdf (secondary library drives)
    if let Some(primary_root) = crate::steam_game_watcher::find_steam_install_dir() {
        candidate_content_dirs.push(primary_root.join("steamapps").join("workshop").join("content").join(appid));

        let vdf_path = primary_root.join("steamapps").join("libraryfolders.vdf");
        if let Ok(raw) = fs::read_to_string(&vdf_path) {
            let secondary_roots = crate::steam_game_watcher::parse_library_folders(&raw);
            for sec in secondary_roots {
                candidate_content_dirs.push(sec.join("steamapps").join("workshop").join("content").join(appid));
            }
        }
    }

    // Deduplicate existing candidate directories
    let mut seen_dirs = std::collections::HashSet::new();
    candidate_content_dirs.retain(|p| p.is_dir() && seen_dirs.insert(p.clone()));

    if candidate_content_dirs.is_empty() {
        return;
    }

    let mut rows = Vec::new();
    let mut primary_mods_root: Option<String> = None;

    for content_dir in candidate_content_dirs {
        if primary_mods_root.is_none() {
            primary_mods_root = Some(content_dir.to_string_lossy().to_string());
        }

        let Ok(rd) = fs::read_dir(&content_dir) else {
            continue;
        };

        let mut entries: Vec<PathBuf> = rd.flatten().map(|e| e.path()).collect();
        entries.sort_by_key(|p| p.file_name().map(|f| f.to_string_lossy().to_string()));

        for p in entries {
            if !p.is_dir() {
                continue;
            }
            let raw_item_id = p
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_default();

            let (item_id, disabled) = strip_disabled(&raw_item_id);
            if item_id.is_empty() {
                continue;
            }

            let name = workshop_item_name(&p).unwrap_or_else(|| format!("Workshop #{item_id}"));
            let mut cap = 20_000u32;
            let (bytes, files) = dir_stats(&p, &mut cap);
            let mut row = base_row(game_id, &name, "workshop", "folder", &p, !disabled);
            row.size_bytes = Some(bytes as i64);
            row.file_count = Some(files as i64);
            row.notes = Some(format!("workshop:{item_id}"));
            rows.push(row);
        }
    }

    if rows.is_empty() {
        return;
    }

    if !out.engines.contains(&"workshop".to_string()) {
        out.engines.push("workshop".into());
    }
    if out.mods_root.is_none() {
        out.mods_root = primary_mods_root;
    }
    out.mods.extend(rows);
}

/// Query Steam Web API to enrich Workshop items with official titles, preview images, and author info.
pub async fn enrich_workshop_metadata(mods: &mut [ModRow]) {
    let workshop_indices: Vec<usize> = mods
        .iter()
        .enumerate()
        .filter(|(_, m)| m.engine == "workshop")
        .map(|(i, _)| i)
        .collect();

    if workshop_indices.is_empty() {
        return;
    }

    let mut item_ids: Vec<String> = Vec::new();
    let mut item_id_to_indices: HashMap<String, Vec<usize>> = HashMap::new();

    for &idx in &workshop_indices {
        let m = &mods[idx];
        let item_id = if let Some(notes) = &m.notes {
            notes
                .split('|')
                .find_map(|s| s.strip_prefix("workshop:"))
                .map(|s| s.to_string())
        } else {
            None
        };
        let item_id = item_id.unwrap_or_else(|| {
            let p = Path::new(&m.path);
            let name = p.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
            strip_disabled(&name).0.to_string()
        });

        if !item_id.is_empty() && item_id.chars().all(|c| c.is_ascii_digit()) {
            item_id_to_indices.entry(item_id.clone()).or_default().push(idx);
            if !item_ids.contains(&item_id) {
                item_ids.push(item_id);
            }
        }
    }

    if item_ids.is_empty() {
        return;
    }

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(6))
        .build()
    {
        Ok(c) => c,
        Err(_) => return,
    };

    for chunk in item_ids.chunks(50) {
        let mut params = HashMap::new();
        params.insert("itemcount".to_string(), chunk.len().to_string());
        for (i, id) in chunk.iter().enumerate() {
            params.insert(format!("publishedfileids[{i}]"), id.clone());
        }

        let res = match client
            .post("https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/")
            .form(&params)
            .send()
            .await
        {
            Ok(r) => r,
            Err(_) => continue,
        };

        let json: serde_json::Value = match res.json().await {
            Ok(v) => v,
            Err(_) => continue,
        };

        let Some(details) = json["response"]["publishedfiledetails"].as_array() else {
            continue;
        };

        for item in details {
            let Some(file_id) = item["publishedfileid"].as_str() else {
                continue;
            };

            let title = item["title"].as_str().unwrap_or("").trim();
            let preview_url = item["preview_url"].as_str().unwrap_or("").trim();
            let time_updated = item["time_updated"].as_u64();

            if let Some(indices) = item_id_to_indices.get(file_id) {
                for &idx in indices {
                    let m = &mut mods[idx];
                    if (!title.is_empty()) && (m.name.starts_with("Workshop #") || m.name.is_empty()) {
                        m.name = title.to_string();
                    }
                    if m.author.is_none() {
                        m.author = Some("Steam Workshop".to_string());
                    }
                    if let Some(updated) = time_updated {
                        if updated > 0 && m.version.is_none() {
                            m.version = Some(format!("{updated}"));
                        }
                    }
                    if !preview_url.is_empty() {
                        let base_notes = format!("workshop:{file_id}");
                        m.notes = Some(format!("{base_notes}|preview:{preview_url}"));
                    }
                }
            }
        }
    }
}


// === Entry point ===========================================================

/// Scan a user-picked folder as a `generic` mods root: every direct
/// child (file or folder) is one mod, `.disabled` suffix == disabled.
fn scan_custom_root(game_id: &str, root: &str, out: &mut ScanOutcome) {
    let dir = Path::new(root);
    if !dir.is_dir() {
        return;
    }
    let mut rows = Vec::new();
    scan_loose_folder(game_id, dir, "generic", false, &mut rows);
    if !out.engines.iter().any(|e| e == "generic") {
        out.engines.push("generic".into());
    }
    // The user's explicit pick wins the "Open mods folder" target.
    out.mods_root = Some(dir.to_string_lossy().to_string());
    out.mods.extend(rows);
}

/// Run every engine detector against the install and return the
/// merged, load-order-normalized result. `custom_root` is a
/// user-picked folder scanned on top of the automatic detection.
pub fn scan(
    game_id: &str,
    game_path: &str,
    steam_app_id: Option<&str>,
    custom_root: Option<&str>,
) -> Result<ScanOutcome, String> {
    scan_with_cancel(game_id, game_path, steam_app_id, custom_root, None)
}

pub fn scan_with_cancel(
    game_id: &str,
    game_path: &str,
    steam_app_id: Option<&str>,
    custom_root: Option<&str>,
    cancelled: Option<&AtomicBool>,
) -> Result<ScanOutcome, String> {
    let exe = Path::new(game_path);
    let game_dir = exe.parent().filter(|p| p.is_dir());
    if game_dir.is_none() && custom_root.is_none() {
        return Err(format!("game folder not found for '{game_path}'"));
    }
    let exe_lower = exe
        .file_name()
        .map(|f| f.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let mut out = ScanOutcome {
        mods: Vec::new(),
        files_examined: 0,
        truncated: false,
        engines: Vec::new(),
        mods_root: None,
        plugins_txt: None,
        nexus_domain: None,
    };

    if let Some(game_dir) = game_dir {
        if cancelled.is_some_and(|flag| flag.load(Ordering::Relaxed)) { return Err("scan_cancelled: scan was cancelled".into()); }
        scan_bethesda(game_id, game_dir, &exe_lower, &mut out);
        scan_bepinex(game_id, game_dir, &mut out);
        scan_melonloader(game_id, game_dir, &mut out);
        scan_unreal(game_id, game_dir, &mut out);
        scan_generic(game_id, game_dir, &mut out);
        scan_workshop(game_id, exe, steam_app_id, &mut out);
        if cancelled.is_some_and(|flag| flag.load(Ordering::Relaxed)) { return Err("scan_cancelled: scan was cancelled".into()); }
    }
    if let Some(root) = custom_root {
        scan_custom_root(game_id, root, &mut out);
    }

    // A custom root that overlaps an auto-detected folder would list
    // the same artifact twice — ids are path-stable, so dedupe on id.
    let mut seen = std::collections::HashSet::new();
    out.mods.retain(|m| seen.insert(m.id.clone()));

    out.files_examined = out.mods.iter().map(|m| m.file_count.unwrap_or(1).max(0) as u64).sum();
    out.truncated = out.files_examined >= 20_000;

    // Normalize load_order to a single 0..n sequence in scan order
    // (bethesda plugins keep their plugins.txt relative order).
    for (i, m) in out.mods.iter_mut().enumerate() {
        m.load_order = i as i64;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mod_id_survives_disabled_rename() {
        let a = mod_id_for("g1", "C:\\x\\Mods\\Cool.dll");
        let b = mod_id_for("g1", "C:\\x\\mods\\cool.dll.disabled");
        assert_eq!(a, b);
    }

    #[test]
    fn plugins_txt_star_format_detection() {
        assert!(plugins_txt_is_star_format(Path::new(
            "C:\\Users\\u\\AppData\\Local\\Skyrim Special Edition\\Plugins.txt"
        )));
        assert!(!plugins_txt_is_star_format(Path::new(
            "C:\\Users\\u\\AppData\\Local\\FalloutNV\\Plugins.txt"
        )));
    }

    #[test]
    fn scan_detects_bepinex_and_generic() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let exe = root.join("Game.exe");
        fs::write(&exe, b"x").unwrap();
        let plugins = root.join("BepInEx").join("plugins");
        fs::create_dir_all(&plugins).unwrap();
        fs::write(plugins.join("CoolMod.dll"), b"dll").unwrap();
        fs::write(plugins.join("OldMod.dll.disabled"), b"dll").unwrap();

        let out = scan("g1", &exe.to_string_lossy(), None, None).unwrap();
        assert!(out.engines.contains(&"bepinex".to_string()));
        assert_eq!(out.mods.len(), 2);
        let cool = out.mods.iter().find(|m| m.name == "CoolMod").unwrap();
        assert!(cool.enabled);
        let old = out.mods.iter().find(|m| m.name == "OldMod").unwrap();
        assert!(!old.enabled);
    }

    #[test]
    fn parse_plugins_txt_star_lines() {
        let dir = tempfile::tempdir().unwrap();
        // Use a star-format folder name.
        let folder = dir.path().join("Skyrim Special Edition");
        fs::create_dir_all(&folder).unwrap();
        let file = folder.join("Plugins.txt");
        fs::write(&file, "# comment\n*Enabled.esp\nDisabled.esp\n").unwrap();
        let map = parse_plugins_txt(&file);
        assert_eq!(map.get("enabled.esp").unwrap().0, true);
        assert_eq!(map.get("disabled.esp").unwrap().0, false);
    }
}
