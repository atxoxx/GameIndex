//! Emulator configuration + ROM scanning commands.

use std::collections::HashMap;
use std::time::SystemTime;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use crate::db;
use crate::emulator_install;
use crate::games::GameData;

/// Serializable emulator configuration, mirroring the frontend
/// `Emulator` type. One instance per configured emulator; each is
/// linked to exactly one ROM folder.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EmulatorData {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) platform: String,
    pub(crate) executable_path: String,
    /// Launch-argument template; the literal `%ROM%` is replaced with
    /// the ROM file path at launch time. Defaults to `"%ROM%"`.
    pub(crate) arguments_template: String,
    pub(crate) rom_folder: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) icon_url: Option<String>,
    /// Folder scanned for required BIOS/firmware files (v2 migration).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) bios_folder: Option<String>,
    /// Folder scanned for per-ROM save files / backups (v2 migration).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) saves_folder: Option<String>,
    /// When true, the ROM-folder watcher re-scans this emulator's ROM
    /// folder automatically when a change is detected.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) auto_scan: Option<bool>,
    pub(crate) created_at: u64,
    pub(crate) updated_at: u64,
}

/// Stable, short, non-cryptographic hash of a ROM's absolute path. Used
/// to build a deterministic `Game.id` (`emu-<emulatorId>-<hash>`) so a
/// re-scan updates the same row instead of duplicating it.
fn hash_str(s: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    format!("{:x}", h.finish())
}

/// Platforms whose emulators consume zip/7z archives directly (MAME
/// ROM sets, Neo Geo zips, RetroArch cores) — such archives are passed
/// to the emulator as-is instead of being extracted to the cache.
fn platform_reads_archives_directly(platform: &str) -> bool {
    ["Arcade", "Neo Geo", "RetroArch", "Multi-system"]
        .iter()
        .any(|p| p.eq_ignore_ascii_case(platform))
}

/// ROM file extensions recognised per console platform. Keys MUST match
/// the `platform` strings used by the frontend emulator catalog so the
/// backend and UI agree on what a "GameCube" ROM looks like.
fn rom_extensions_for_platform(platform: &str) -> Vec<String> {
    let table: &[(&str, &[&str])] = &[
        ("NES", &["nes", "fds"]),
        ("Super Nintendo", &["smc", "sfc", "swc", "fig"]),
        ("Nintendo 64", &["n64", "z64", "v64"]),
        ("GameCube", &["iso", "gcm", "rvz", "gcz"]),
        ("Wii", &["iso", "wbfs", "rvz", "gcz"]),
        ("Wii U", &["wud", "wux", "rpx"]),
        ("Nintendo DS", &["nds"]),
        ("Nintendo 3DS", &["3ds", "cia", "cxi", "app"]),
        ("Nintendo Switch", &["xci", "nsp", "nca"]),
        ("Game Boy", &["gb"]),
        ("Game Boy Color", &["gbc"]),
        ("Game Boy Advance", &["gba"]),
        ("PlayStation", &["iso", "bin", "cue", "img", "pbp", "chd"]),
        ("PlayStation 2", &["iso", "bin", "cue", "chd", "img", "gz"]),
        ("PlayStation Portable", &["iso", "cso", "pbp"]),
        ("PlayStation 3", &["iso", "pkg", "rap"]),
        ("PlayStation 4", &["pkg", "elf"]),
        ("PlayStation Vita", &["vpk", "zip", "bin"]),
        ("Sega Genesis", &["md", "gen", "smd", "bin"]),
        ("Sega Saturn", &["iso", "bin", "cue", "chd", "toc"]),
        ("Sega Dreamcast", &["cdi", "gdi", "chd"]),
        ("Xbox", &["iso", "xbe"]),
        ("Xbox 360", &["iso", "xex"]),
        ("Atari 2600", &["a26", "bin"]),
        ("PC Engine", &["pce", "cue", "iso"]),
        ("Neo Geo", &["neo", "zip"]),
        ("Arcade", &["zip", "7z", "chd"]),
        ("Multi-system", &["iso", "bin", "cue", "rom", "zip", "7z", "sfc", "nes", "n64", "md", "gba"]),
    ];
    for (name, exts) in table {
        if name.eq_ignore_ascii_case(platform) {
            return exts.iter().map(|s| s.to_string()).collect();
        }
    }
    // Unknown platform: fall back to a permissive set so a custom
    // emulator still scans something rather than nothing.
    vec!["iso".into(), "bin".into(), "cue".into(), "rom".into(), "zip".into()]
}

/// List all configured emulators.
#[tauri::command]
pub fn list_emulators(app: tauri::AppHandle) -> Result<Vec<EmulatorData>, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let rows = db::emulators::list_all(db_state.inner()).map_err(|e| e.to_string())?;        Ok(rows
        .into_iter()
        .map(|r| EmulatorData {
            id: r.id,
            name: r.name,
            platform: r.platform,
            executable_path: r.executable_path,
            arguments_template: r.arguments_template,
            rom_folder: r.rom_folder,
            notes: r.notes,
            icon_url: r.icon_url,
            bios_folder: r.bios_folder,
            saves_folder: r.saves_folder,
            auto_scan: r.auto_scan,
            created_at: r.created_at,
            updated_at: r.updated_at,
        })
        .collect())
}

/// Upsert a single emulator configuration.
#[tauri::command]
pub fn save_emulator(app: tauri::AppHandle, emulator: EmulatorData) -> Result<(), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let row = db::emulators::EmulatorRow {
        id: emulator.id,
        name: emulator.name,
        platform: emulator.platform,
        executable_path: emulator.executable_path,
        arguments_template: emulator.arguments_template,
        rom_folder: emulator.rom_folder,
        notes: emulator.notes,
        icon_url: emulator.icon_url,
        bios_folder: emulator.bios_folder,
        saves_folder: emulator.saves_folder,
        auto_scan: emulator.auto_scan,
        created_at: emulator.created_at,
        updated_at: emulator.updated_at,
    };
    db::emulators::upsert_one(db_state.inner(), &row)
}

/// Delete an emulator and cascade-delete all of its scanned ROMs.
#[tauri::command]
pub fn delete_emulator(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::games::delete_by_emulator(db_state.inner(), &id)?;
    db::emulators::delete(db_state.inner(), &id)
}

/// Read every `achievement_links` row across all games, grouped by
/// game id (`{ "<gameId>": [<AchievementLink>, ...] }`).
#[tauri::command]
pub fn achievement_links_list(
    app: tauri::AppHandle,
) -> Result<HashMap<String, Vec<db::achievement_links::AchievementLink>>, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let mut out: HashMap<String, Vec<db::achievement_links::AchievementLink>> = HashMap::new();
    for link in db::achievement_links::list_all_links(db_state.inner())? {
        out.entry(link.game_id.clone()).or_default().push(link);
    }
    Ok(out)
}

/// Complete an emulator install started by `start_emulator_install`:
/// resolve the install directory, locate the extracted executable,
/// ensure the ROM folder exists, persist the configuration via the
/// emulators DB, and return the finished `EmulatorData` with
/// `executable_path` filled in.
#[tauri::command]
pub async fn finish_emulator_install(
    app: tauri::AppHandle,
    download_id: String,
    emulator: EmulatorData,
) -> Result<EmulatorData, String> {
    let install_dir = emulator_install::resolve_install_dir(&download_id)
        .ok_or_else(|| format!("No install in progress for download '{download_id}'"))?;

    let exe_name = emulator_install::exe_name_for_download(&download_id)
        .unwrap_or_else(|| "emulator.exe".to_string());

    let exe = emulator_install::find_executable(&install_dir, &exe_name).ok_or_else(|| {
        "Emulator executable not found after extraction (extraction may have failed — 7-Zip is required for .7z archives)"
            .to_string()
    })?;

    std::fs::create_dir_all(&emulator.rom_folder)
        .map_err(|e| format!("Failed to create ROM folder: {e}"))?;

    let mut emulator = emulator;
    emulator.executable_path = exe.to_string_lossy().into_owned();

    let db_state: tauri::State<'_, db::Db> = app.state();
    let row = db::emulators::EmulatorRow {
        id: emulator.id.clone(),
        name: emulator.name.clone(),
        platform: emulator.platform.clone(),
        executable_path: emulator.executable_path.clone(),
        arguments_template: emulator.arguments_template.clone(),
        rom_folder: emulator.rom_folder.clone(),
        notes: emulator.notes.clone(),
        icon_url: emulator.icon_url.clone(),
        bios_folder: emulator.bios_folder.clone(),
        saves_folder: emulator.saves_folder.clone(),
        auto_scan: emulator.auto_scan,
        created_at: emulator.created_at,
        updated_at: emulator.updated_at,
    };
    db::emulators::upsert_one(db_state.inner(), &row)?;
    Ok(emulator)
}

/// Scan an emulator's ROM folder (flat — top-level files only) and
/// upsert a `Game` row per recognised ROM. Returns the full list of
/// scanned games (including any existing rows that were preserved).
///
/// Existing rows are merged so playtime / metadata / covers survive a
/// re-scan; only the emulator linkage + launch arguments are refreshed.
#[tauri::command]
pub fn scan_emulator_roms(
    app: tauri::AppHandle,
    emulator_id: String,
) -> Result<Vec<GameData>, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let emu = db::emulators::get(db_state.inner(), &emulator_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Emulator not found: {emulator_id}"))?;

    if emu.rom_folder.trim().is_empty() {
        return Err("Emulator has no ROM folder configured".into());
    }
    let folder = std::path::Path::new(&emu.rom_folder);
    if !folder.exists() {
        return Err(format!("ROM folder does not exist: {}", emu.rom_folder));
    }

    let exts = rom_extensions_for_platform(&emu.platform);
    let now_ms = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let mut out: Vec<GameData> = Vec::new();
    let entries = std::fs::read_dir(folder).map_err(|e| format!("read ROM folder: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("read ROM entry: {e}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = match path.extension().and_then(|e| e.to_str()) {
            Some(e) => e.to_lowercase(),
            None => continue,
        };
        if !exts.iter().any(|x| x.eq_ignore_ascii_case(&ext)) {
            continue;
        }
        let rom_path = path.to_string_lossy().to_string();
        let mut game = build_rom_game(&emu, &rom_path, now_ms);

        // Archive support: zip/7z ROMs stay as-is in the folder; the
        // launch path extracts them into the managed cache on demand.
        // Emulators that consume archives natively (MAME sets, Neo Geo
        // zips, RetroArch) are excluded — extracting those would break
        // the launch.
        if (ext == "zip" || ext == "7z") && !platform_reads_archives_directly(&emu.platform) {
            game.rom_archived = Some(true);
        }

        // Preserve progress / metadata if this ROM was scanned before.
        if let Some(existing) = db::games::get(db_state.inner(), &game.id).map_err(|e| e.to_string())? {
            let value = serde_json::to_value(&existing).map_err(|e| format!("to_value: {e}"))?;
            if let Ok(prev) = serde_json::from_value::<GameData>(value) {
                apply_existing_rom(&prev, &mut game);
            }
        }

        let value = serde_json::to_value(&game).map_err(|e| format!("to_value: {e}"))?;
        let row: db::games::GameRow = serde_json::from_value(value)
            .map_err(|e| format!("to GameRow: {e}"))?;
        db::games::upsert_one(db_state.inner(), &row)?;
        out.push(game);
    }

    Ok(out)
}

/// Build a fresh `GameData` for a ROM file, measuring its on-disk size.
/// All library/progress/metadata fields are left at their defaults
/// (None) so callers can layer any preserved values on top.
fn build_rom_game(emu: &db::emulators::EmulatorRow, rom_path: &str, now_ms: u64) -> GameData {
    let p = std::path::Path::new(rom_path);
    let raw_stem = p
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown")
        .to_string();
    // No-Intro-style parsing: region / language / disc tags come out of
    // the filename so the library gets region+language filters and
    // multi-disc grouping for free, and the display name is cleaned.
    let parsed = crate::roms::parse_rom_filename(&raw_stem);
    let name = if parsed.clean_title.trim().is_empty() {
        raw_stem.clone()
    } else {
        parsed.clean_title.clone()
    };
    let args = emu.arguments_template.replace("%ROM%", rom_path);
    let size = std::fs::metadata(p).ok().map(|m| m.len());
    let value = serde_json::json!({
        "id": format!("emu-{}-{}", emu.id, hash_str(rom_path)),
        "name": name,
        "path": emu.executable_path,
        "platform": emu.platform,
        "installed": true,
        "playTime": "0h",
        "addedAt": now_ms,
        "sizeBytes": size,
        "sizeDetectedAt": size.map(|_| now_ms.to_string()),
        "sizeRootPath": rom_path,
        "launchArguments": args,
        "emulatorId": emu.id,
        "romPath": rom_path,
        "romRegion": parsed.region,
        "romLanguage": parsed.language,
        "romGroup": parsed.group,
        "romDisc": parsed.disc,
    });
    serde_json::from_value(value).expect("build_rom_game: constructed GameData must be valid")
}

/// Copy progress / metadata from a previously-scanned ROM onto a freshly
/// built one, while keeping the refreshed emulator linkage (path /
/// platform / launch arguments) from the current emulator config.
fn apply_existing_rom(prev: &GameData, game: &mut GameData) {
    game.play_time = prev.play_time.clone();
    game.added_at = prev.added_at;
    game.last_played = prev.last_played;
    game.cover_art_url = prev.cover_art_url.clone();
    game.cover_source_url = prev.cover_source_url.clone();
    game.icon_url = prev.icon_url.clone();
    game.banner_url = prev.banner_url.clone();
    game.logo_url = prev.logo_url.clone();
    game.description = prev.description.clone();
    game.developer = prev.developer.clone();
    game.publisher = prev.publisher.clone();
    game.release_date = prev.release_date.clone();
    game.genres = prev.genres.clone();
    game.metadata_source = prev.metadata_source.clone();
    game.metadata_url = prev.metadata_url.clone();
    game.screenshots = prev.screenshots.clone();
    game.videos = prev.videos.clone();
    game.igdb_rating = prev.igdb_rating;
    game.critic_rating = prev.critic_rating;
    game.igdb_id = prev.igdb_id;
    game.play_status = prev.play_status.clone();
    game.notes = prev.notes.clone();
    game.size_bytes = prev.size_bytes;
    game.size_detected_at = prev.size_detected_at.clone();
    game.size_root_path = prev.size_root_path.clone();
    game.steam_app_id = prev.steam_app_id;
    // v7 ROM-management fields — user-owned state survives re-scans.
    game.rom_hash = prev.rom_hash.clone();
    game.favorite = prev.favorite;
    game.compat_notes = prev.compat_notes.clone();
    game.rom_profile = prev.rom_profile.clone();
    // Manual corrections win over re-parsed values until the next
    // explicit re-parse (rows whose metadata was manually corrected
    // carry `metadata_source == "manual"`).
    if prev.metadata_source.as_deref() == Some("manual") {
        game.name = prev.name.clone();
        game.rom_region = prev.rom_region.clone();
        game.rom_language = prev.rom_language.clone();
        game.rom_group = prev.rom_group.clone();
        game.rom_disc = prev.rom_disc;
    }
}

/// Manually register a single ROM file under an emulator (the
/// "Add ROM" action). Validates the extension against the platform's
/// recognised set, then upserts a `GameData` row identical to a scan.
#[tauri::command]
pub fn add_rom_file(
    app: tauri::AppHandle,
    emulator_id: String,
    path: String,
) -> Result<GameData, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let emu = db::emulators::get(db_state.inner(), &emulator_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Emulator not found: {emulator_id}"))?;
    let p = std::path::Path::new(&path);
    if !p.is_file() {
        return Err(format!("File does not exist: {path}"));
    }
    let ext = match p.extension().and_then(|e| e.to_str()) {
        Some(e) => e.to_lowercase(),
        None => return Err("File has no extension".into()),
    };
    let exts = rom_extensions_for_platform(&emu.platform);
    if !exts.iter().any(|x| x.eq_ignore_ascii_case(&ext)) {
        return Err(format!(
            "File type .{ext} is not a recognised ROM for {}",
            emu.platform
        ));
    }
    let now_ms = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let mut game = build_rom_game(&emu, &path, now_ms);
    // Preserve any prior entry (e.g. re-adding a previously removed ROM).
    if let Some(existing) = db::games::get(db_state.inner(), &game.id).map_err(|e| e.to_string())? {
        let value = serde_json::to_value(&existing).map_err(|e| format!("to_value: {e}"))?;
        if let Ok(prev) = serde_json::from_value::<GameData>(value) {
            apply_existing_rom(&prev, &mut game);
        }
    }
    let row_value = serde_json::to_value(&game).map_err(|e| format!("to_value: {e}"))?;
    let row: db::games::GameRow = serde_json::from_value(row_value)
        .map_err(|e| format!("to GameRow: {e}"))?;
    db::games::upsert_one(db_state.inner(), &row)?;
    Ok(game)
}

/// Rename a ROM's file on disk and update its library entry. `new_name`
/// is a base name (the existing extension is preserved). The game id is
/// regenerated from the new path so future re-scans stay idempotent.
#[tauri::command]
pub fn rename_rom_file(
    app: tauri::AppHandle,
    game_id: String,
    new_name: String,
) -> Result<GameData, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let existing = db::games::get(db_state.inner(), &game_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("ROM not found: {game_id}"))?;
    let rom_path = existing
        .rom_path
        .clone()
        .ok_or_else(|| "ROM has no file path".to_string())?;
    let old_path = std::path::Path::new(&rom_path);
    if !old_path.is_file() {
        return Err(format!("ROM file does not exist: {rom_path}"));
    }
    let trimmed = new_name.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || trimmed.contains('\\')
    {
        return Err("New name contains invalid characters".into());
    }
    let ext = old_path.extension().and_then(|e| e.to_str()).unwrap_or("");
    let mut file_name = String::from(trimmed);
    if !ext.is_empty() {
        file_name.push('.');
        file_name.push_str(ext);
    }
    let parent = old_path.parent().unwrap_or_else(|| std::path::Path::new(""));
    let new_path = parent.join(&file_name);
    if new_path.exists() {
        return Err(format!("A file named {file_name} already exists"));
    }
    std::fs::rename(old_path, &new_path).map_err(|e| format!("rename failed: {e}"))?;
    let new_rom_path = new_path.to_string_lossy().to_string();
    let emu_id = existing.emulator_id.clone().unwrap_or_default();
    let new_id = format!("emu-{}-{}", emu_id, hash_str(&new_rom_path));
    let value = serde_json::to_value(&existing).map_err(|e| format!("to_value: {e}"))?;
    let mut game: GameData = serde_json::from_value(value)
        .map_err(|e| format!("from_value: {e}"))?;
    game.id = new_id.clone();
    game.name = trimmed.to_string();
    game.rom_path = Some(new_rom_path.clone());
    if let Some(args) = game.launch_arguments.clone() {
        game.launch_arguments = Some(args.replace(&rom_path, &new_rom_path));
    }
    if game.size_root_path.as_deref() == Some(rom_path.as_str()) {
        game.size_root_path = Some(new_rom_path.clone());
    }
    let row_value = serde_json::to_value(&game).map_err(|e| format!("to_value: {e}"))?;
    let row: db::games::GameRow = serde_json::from_value(row_value)
        .map_err(|e| format!("to GameRow: {e}"))?;
    db::games::upsert_one(db_state.inner(), &row)?;
    if new_id != game_id {
        let _ = db::games::delete(db_state.inner(), &game_id);
    }
    Ok(game)
}

/// Delete a ROM's file from disk and remove its library entry. Returns
/// the number of bytes freed so the frontend can show a meaningful toast.
#[tauri::command]
pub fn delete_rom_file(app: tauri::AppHandle, game_id: String) -> Result<u64, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let existing = db::games::get(db_state.inner(), &game_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("ROM not found: {game_id}"))?;
    let mut freed: u64 = 0;
    if let Some(rom_path) = existing.rom_path.clone() {
        if let Ok(meta) = std::fs::metadata(&rom_path) {
            freed = meta.len();
        }
        let _ = std::fs::remove_file(&rom_path);
    }
    db::games::delete(db_state.inner(), &game_id)?;
    Ok(freed)
}

/// Lightweight ROM-folder watcher. Polls every configured emulator's
/// ROM folder every 25 s; when a folder's file signature (name, size,
/// mtime of top-level entries) changes it emits a `rom-folder-changed`
/// event with the emulator id. The frontend auto-rescans when the
/// emulator has `autoScan` on, or offers a "rescan now" toast
/// otherwise — so users never have to manually rescan after dropping a
/// file in.
pub fn start_rom_watcher(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut last_signatures: std::collections::HashMap<String, Vec<(String, u64, u64)>> =
            std::collections::HashMap::new();
        loop {
            std::thread::sleep(std::time::Duration::from_secs(25));
            let Some(db_state) = app.try_state::<db::Db>() else {
                continue;
            };
            let rows = match db::emulators::list_all(db_state.inner()) {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("[rom_watcher] list failed: {e}");
                    continue;
                }
            };
            for emu in rows {
                let folder = emu.rom_folder.trim().to_string();
                if folder.is_empty() {
                    continue;
                }
                let sig = crate::roms::folder_signature(std::path::Path::new(&folder));
                match (last_signatures.get(&emu.id), sig) {
                    (Some(prev), Some(cur)) => {
                        if prev != &cur {
                            last_signatures.insert(emu.id.clone(), cur);
                            let _ = app.emit(
                                "rom-folder-changed",
                                serde_json::json!({
                                    "emulatorId": emu.id,
                                    "folder": folder,
                                    "autoScan": emu.auto_scan.unwrap_or(false),
                                }),
                            );
                        }
                    }
                    (None, Some(cur)) => {
                        last_signatures.insert(emu.id.clone(), cur);
                    }
                    _ => {}
                }
            }
        }
    });
}

/// Re-measure the on-disk size of every ROM belonging to an emulator and
/// persist it. Used by the "Re-calc sizes" action; a ROM's size is its
/// own file length.
#[tauri::command]
pub fn recalc_rom_sizes(
    app: tauri::AppHandle,
    emulator_id: String,
) -> Result<Vec<GameData>, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let now_ms = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let rows = db::games::list_all(db_state.inner()).map_err(|e| e.to_string())?;
    let mut out: Vec<GameData> = Vec::new();
    for row in rows {
        if row.emulator_id.as_deref() != Some(emulator_id.as_str()) {
            continue;
        }
        let rom_path = match row.rom_path.clone() {
            Some(p) => p,
            None => continue,
        };
        let value = serde_json::to_value(&row).map_err(|e| format!("to_value: {e}"))?;
        let mut game: GameData = serde_json::from_value(value)
            .map_err(|e| format!("from_value: {e}"))?;
        let size = std::fs::metadata(&rom_path).ok().map(|m| m.len());
        game.size_bytes = size;
        game.size_detected_at = size.map(|_| now_ms.to_string());
        game.size_root_path = Some(rom_path);
        let row_value = serde_json::to_value(&game).map_err(|e| format!("to_value: {e}"))?;
        let game_row: db::games::GameRow = serde_json::from_value(row_value)
            .map_err(|e| format!("to GameRow: {e}"))?;
        db::games::upsert_one(db_state.inner(), &game_row)?;
        out.push(game);
    }
    Ok(out)
}



