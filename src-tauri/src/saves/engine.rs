//! Save-backup engine.
//!
//! Snapshots are **single `.gisave` archives** (a Deflated zip), one per
//! backup:
//!
//! ```text
//! <backup_dir>/<game-id>/<created_at>-<kind>.gisave
//!   manifest.json          # locations + per-file index (forward-slash rel paths)
//!   files/<location-index>/<relative path…>
//! ```
//!
//! `manifest.json` is the source of truth for restore, so a backup remains
//! self-describing even if the SQLite index is lost. Legacy directory-layout
//! snapshots (written before archives) are still read, restored and pruned;
//! only newly created snapshots are archives.

use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use zip::{ZipArchive, ZipWriter};

use crate::db::game_notes::unix_now_ms;
use crate::db::saves::{self, SaveBackup, SaveLocation};
use crate::db::Db;

use super::SaveProgress;

pub const MANIFEST_FORMAT: &str = "gameindex-save-backup";
pub const MANIFEST_VERSION: u32 = 1;

/// Extension of the single-file snapshot archive (a Deflated zip). Legacy
/// snapshots are directories and are detected by their lack of this suffix.
const ARCHIVE_EXT: &str = "gisave";

/// Name of the manifest entry inside the archive / legacy snapshot directory.
const MANIFEST_JSON: &str = "manifest.json";

/// Emit file-level backup progress every N files (plus the final file).
/// Backups routinely touch tens of thousands of files, so the UI needs a
/// heartbeat without flooding the event channel.
const PROGRESS_STEP: u64 = 250;

/// Deflate options shared by every entry written to a snapshot archive.
fn zip_opts() -> zip::write::SimpleFileOptions {
    zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated)
}

/// True when a snapshot path points at an archive (vs. a legacy directory).
fn is_archive_path(path: &Path) -> bool {
    path.extension()
        .map(|e| e.eq_ignore_ascii_case(ARCHIVE_EXT))
        .unwrap_or(false)
}

/// True when the snapshot row describes an archive rather than a directory.
fn is_archive(backup: &SaveBackup) -> bool {
    is_archive_path(Path::new(&backup.root_path))
}

/// Pick a non-colliding archive path for a new snapshot.
fn unique_archive_path(game_dir: &Path, created_at: u64, kind: &str) -> PathBuf {
    let kind = safe_component(kind);
    let mut candidate = game_dir.join(format!("{created_at}-{kind}.{ARCHIVE_EXT}"));
    let mut n = 0u32;
    while candidate.exists() {
        n += 1;
        candidate = game_dir.join(format!("{created_at}-{kind}-{n}.{ARCHIVE_EXT}"));
    }
    candidate
}

/// Stream one source file into the archive as
/// `files/<location-index>/<entry-rel>`. Returns bytes written.
/// `rel` is the source path relative to `src_root` (empty for single-file
/// locations, where `src_root` is the file itself).
fn add_file_to_zip(
    zip: &mut ZipWriter<File>,
    location_index: u32,
    rel: &str,
    entry_rel: &str,
    src_root: &Path,
) -> Result<u64, String> {
    let src_path = if rel.is_empty() {
        src_root.to_path_buf()
    } else {
        src_root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR))
    };
    zip.start_file(format!("files/{location_index}/{entry_rel}"), zip_opts())
        .map_err(|e| format!("zip entry: {e}"))?;
    let mut input = File::open(&src_path).map_err(|e| e.to_string())?;
    std::io::copy(&mut input, zip).map_err(|e| e.to_string())
}

/// Last-modified timestamp of a path in unix ms (0 when unavailable).
fn modified_ms_of(path: &Path) -> u64 {
    std::fs::metadata(path)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// One location recorded in a snapshot's manifest.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestLocation {
    pub index: u32,
    /// Original absolute path this location was captured from.
    pub path: String,
    pub kind: String,
    pub label: String,
    pub source: String,
    pub file_count: u64,
    pub total_bytes: u64,
}

/// One captured file within a location.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestFile {
    pub location_index: u32,
    /// Path relative to the location root, forward-slash separated.
    pub rel: String,
    #[allow(dead_code)]
    pub size: u64,
    pub modified_ms: u64,
}

/// A snapshot manifest. Also returned to the frontend for the backup
/// browser (`saves_get_backup_manifest`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub format: String,
    pub version: u32,
    pub game_id: String,
    pub game_name: String,
    pub created_at: u64,
    pub kind: String,
    pub note: String,
    pub locations: Vec<ManifestLocation>,
    pub files: Vec<ManifestFile>,
}

/// Outcome of a restore, surfaced to the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub backup_id: String,
    pub game_id: String,
    pub restored_files: u64,
    pub total_bytes: u64,
    /// Backup created automatically before overwriting, when enabled.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub safety_backup_id: Option<String>,
    pub warnings: Vec<String>,
}

fn default_ignore_patterns() -> Vec<String> {
    vec![
        "*.tmp".into(),
        "*.temp".into(),
        "*.log".into(),
        "*.dmp".into(),
        "*.cache".into(),
        "*.pid".into(),
        "thumbs.db".into(),
        ".ds_store".into(),
    ]
}

/// Default ignore patterns (used when creating a fresh settings payload).
pub fn default_ignore() -> Vec<String> {
    default_ignore_patterns()
}

/// Simple wildcard match supporting `*` and `?`. Case-insensitive.
pub fn glob_match(pattern: &str, text: &str) -> bool {
    let p: Vec<char> = pattern.to_lowercase().chars().collect();
    let t: Vec<char> = text.to_lowercase().chars().collect();
    // Iterative backtracking glob (avoids exponential recursion).
    let (mut pi, mut ti) = (0usize, 0usize);
    let (mut star_p, mut star_t) = (usize::MAX, usize::MAX);
    while ti < t.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == t[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star_p = pi;
            star_t = ti;
            pi += 1;
        } else if star_p != usize::MAX {
            pi = star_p + 1;
            star_t += 1;
            ti = star_t;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

/// True when a file should be skipped: matches an ignore pattern against
/// its name or its `/`-separated relative path.
pub fn is_ignored(patterns: &[String], name: &str, rel: &str) -> bool {
    patterns
        .iter()
        .any(|pat| glob_match(pat, name) || glob_match(pat, rel))
}

/// Make a path-safe component for the backup directory tree.
pub fn safe_component(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let cleaned = cleaned.trim_matches('_').to_string();
    if cleaned.is_empty() {
        "game".to_string()
    } else {
        cleaned.chars().take(80).collect()
    }
}

fn rel_forward(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| {
            path.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default()
        })
}

struct CollectedFile {
    rel: String,
    modified_ms: u64,
}

/// True when `path` is a Windows reparse point (junction or symlink) that
/// must not be descended into. `FileType::is_symlink` already covers
/// symlinks; this additionally catches directory junctions, whose targets
/// can point back up the tree and spin the walk forever.
fn is_reparse_dir(path: &Path) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        return std::fs::symlink_metadata(path)
            .map(|m| m.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0)
            .unwrap_or(false);
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        false
    }
}

/// Walk a directory collecting regular files (no symlink following).
fn walk_files(root: &Path, dir: &Path, patterns: &[String], out: &mut Vec<CollectedFile>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }
        if ft.is_dir() {
            if is_reparse_dir(&path) {
                continue;
            }
            walk_files(root, &path, patterns, out);
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let rel = rel_forward(root, &path);
        if is_ignored(patterns, name, &rel) {
            continue;
        }
        let meta = std::fs::metadata(&path).ok();
        let modified_ms = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        out.push(CollectedFile {
            rel,
            modified_ms,
        });
    }
}

fn emit(app: Option<&AppHandle>, phase: &str, game_id: &str, game_name: &str, current: u64, total: u64, message: &str) {
    let Some(app) = app else {
        return;
    };
    let percent = if total == 0 {
        0
    } else {
        ((current * 100) / total).min(100) as u8
    };
    let _ = app.emit(
        "saves-progress",
        SaveProgress {
            phase: phase.to_string(),
            game_id: game_id.to_string(),
            game_name: game_name.to_string(),
            current,
            total,
            percent,
            message: message.to_string(),
        },
    );
}

/// Create a snapshot of `locations` for a game. `locations` should already
/// be filtered to the ones the user wants included.
///
/// `app` is optional only so unit tests can exercise the file logic without a
/// live Tauri handle; every production caller passes one.
pub fn create_backup(
    app: Option<&AppHandle>,
    db: &Db,
    game_id: &str,
    game_name: &str,
    locations: &[SaveLocation],
    kind: &str,
    note: &str,
    backup_dir: &Path,
    ignore: &[String],
) -> Result<SaveBackup, String> {
    let created_at = unix_now_ms();
    let game_dir = backup_dir.join(safe_component(game_id));
    std::fs::create_dir_all(&game_dir).map_err(|e| format!("create backup dir: {e}"))?;
    let root = unique_archive_path(&game_dir, created_at, kind);

    // Discover every file up front so the progress bar can report an honest
    // file total and the UI never looks stalled on a single huge folder.
    // Walking is cheap metadata I/O; zipping is the expensive pass.
    let mut discovered: Vec<Vec<CollectedFile>> = Vec::with_capacity(locations.len());
    let mut total_files = 0u64;
    for loc in locations {
        let src = Path::new(&loc.path);
        let files = if loc.kind == "file" {
            match src.file_name().and_then(|n| n.to_str()) {
                Some(name) if src.is_file() && !is_ignored(ignore, name, name) => {
                    vec![CollectedFile {
                        rel: name.to_string(),
                        modified_ms: modified_ms_of(src),
                    }]
                }
                _ => Vec::new(),
            }
        } else if src.is_dir() {
            let mut collected = Vec::new();
            walk_files(src, src, ignore, &mut collected);
            collected
        } else {
            Vec::new()
        };
        total_files += files.len() as u64;
        discovered.push(files);
    }

    let file = File::create(&root).map_err(|e| format!("create snapshot archive: {e}"))?;
    let mut zip = ZipWriter::new(file);

    let mut manifest_locations: Vec<ManifestLocation> = Vec::new();
    let mut manifest_files: Vec<ManifestFile> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    let mut copied_locations = 0u32;
    let mut done_files = 0u64;

    for (i, loc) in locations.iter().enumerate() {
        let src = Path::new(&loc.path);
        let mut file_count = 0u64;
        let mut total_bytes = 0u64;

        emit(
            app,
            "backup",
            game_id,
            game_name,
            done_files,
            total_files,
            &format!("Backing up {}", loc.label),
        );

        for f in &discovered[i] {
            let rel_arg = if loc.kind == "file" { "" } else { f.rel.as_str() };
            match add_file_to_zip(&mut zip, i as u32, rel_arg, &f.rel, src) {
                Ok(bytes) => {
                    file_count += 1;
                    total_bytes += bytes;
                    manifest_files.push(ManifestFile {
                        location_index: i as u32,
                        rel: f.rel.clone(),
                        size: bytes,
                        modified_ms: f.modified_ms,
                    });
                }
                Err(e) => errors.push(format!("{}: {e}", f.rel)),
            }
            done_files += 1;
            if total_files > PROGRESS_STEP
                && (done_files % PROGRESS_STEP == 0 || done_files == total_files)
            {
                emit(
                    app,
                    "backup",
                    game_id,
                    game_name,
                    done_files,
                    total_files,
                    &format!("Backing up {} ({done_files} files)", loc.label),
                );
            }
        }

        // A folder location that no longer exists is recorded as an error;
        // a single-file location that vanished is simply skipped.
        if !src.exists() && loc.kind != "file" {
            errors.push(format!("missing: {}", loc.path));
        }
        if file_count > 0 || src.exists() {
            copied_locations += 1;
        }
        manifest_locations.push(ManifestLocation {
            index: i as u32,
            path: loc.path.clone(),
            kind: loc.kind.clone(),
            label: loc.label.clone(),
            source: loc.source.clone(),
            file_count,
            total_bytes,
        });
    }

    let status = if errors.is_empty() {
        "complete"
    } else if manifest_files.is_empty() {
        "failed"
    } else {
        "partial"
    };

    let manifest = BackupManifest {
        format: MANIFEST_FORMAT.to_string(),
        version: MANIFEST_VERSION,
        game_id: game_id.to_string(),
        game_name: game_name.to_string(),
        created_at,
        kind: kind.to_string(),
        note: note.to_string(),
        locations: manifest_locations,
        files: manifest_files,
    };
    let json = serde_json::to_vec_pretty(&manifest).map_err(|e| format!("manifest encode: {e}"))?;
    zip.start_file(MANIFEST_JSON, zip_opts())
        .map_err(|e| format!("zip manifest entry: {e}"))?;
    zip.write_all(&json)
        .map_err(|e| format!("write manifest: {e}"))?;
    zip.finish().map_err(|e| format!("finish snapshot archive: {e}"))?;

    let total_bytes: u64 = manifest.files.iter().map(|f| f.size).sum();
    let backup = saves::insert_backup(
        db,
        SaveBackup {
            id: String::new(),
            game_id: game_id.to_string(),
            game_name: game_name.to_string(),
            created_at,
            kind: kind.to_string(),
            note: note.to_string(),
            location_count: copied_locations,
            file_count: manifest.files.len() as u64,
            total_bytes,
            status: status.to_string(),
            error: if errors.is_empty() {
                None
            } else {
                Some(errors.join("; "))
            },
            root_path: root.to_string_lossy().to_string(),
            // The manifest lives inside the archive, not at a standalone path.
            manifest_path: String::new(),
        },
    )?;

    for loc in locations {
        let _ = saves::touch_location_backup(db, &loc.id, created_at);
    }

    emit(
        app,
        "backup",
        game_id,
        game_name,
        total_files.max(1),
        total_files.max(1),
        "Backup complete",
    );
    Ok(backup)
}

/// Read a snapshot's manifest. Handles both archive and legacy-directory
/// snapshots, and tolerates a missing/invalid payload → `None`.
pub fn read_manifest(backup: &SaveBackup) -> Option<BackupManifest> {
    if is_archive(backup) {
        let file = File::open(&backup.root_path).ok()?;
        let mut archive = ZipArchive::new(file).ok()?;
        let mut entry = archive.by_name(MANIFEST_JSON).ok()?;
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).ok()?;
        return serde_json::from_slice(&bytes).ok();
    }
    let path = if backup.manifest_path.is_empty() {
        Path::new(&backup.root_path).join(MANIFEST_JSON)
    } else {
        PathBuf::from(&backup.manifest_path)
    };
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Destination path for a captured file, honouring single-file locations
/// (where the location path *is* the file) vs. folder locations.
fn restore_dest(mloc: &ManifestLocation, rel: &str) -> PathBuf {
    let dest_root = Path::new(&mloc.path);
    if mloc.kind == "file" {
        dest_root.to_path_buf()
    } else {
        dest_root.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR))
    }
}

/// Restore every location from a snapshot into its original place.
pub fn restore_backup(
    app: Option<&AppHandle>,
    db: &Db,
    backup: &SaveBackup,
    safety_snapshot: bool,
    backup_dir: &Path,
    ignore: &[String],
) -> Result<RestoreResult, String> {
    let manifest = read_manifest(backup)
        .ok_or_else(|| "Backup manifest is missing or unreadable".to_string())?;

    // Safety snapshot of the *current* saves before we overwrite them.
    let mut safety_backup_id = None;
    if safety_snapshot {
        let current = saves::list_locations(db, &backup.game_id)?
            .into_iter()
            .filter(|l| l.include)
            .collect::<Vec<_>>();
        if !current.is_empty() {
            if let Ok(snapshot) = create_backup(
                app,
                db,
                &backup.game_id,
                &backup.game_name,
                &current,
                "pre-restore",
                "Automatic snapshot before restore",
                backup_dir,
                ignore,
            ) {
                safety_backup_id = Some(snapshot.id);
            }
        }
    }

    let mut restored_files = 0u64;
    let mut total_bytes = 0u64;
    let mut warnings: Vec<String> = Vec::new();

    if is_archive(backup) {
        let file = File::open(&backup.root_path)
            .map_err(|e| format!("open snapshot archive: {e}"))?;
        let mut archive = ZipArchive::new(file)
            .map_err(|e| format!("read snapshot archive: {e}"))?;
        for mloc in &manifest.locations {
            for f in manifest
                .files
                .iter()
                .filter(|f| f.location_index == mloc.index)
            {
                let dest = restore_dest(mloc, &f.rel);
                let entry_name = format!("files/{}/{}", mloc.index, f.rel);
                let mut entry = match archive.by_name(&entry_name) {
                    Ok(entry) => entry,
                    Err(_) => {
                        warnings.push(format!("Missing backup file: {}", f.rel));
                        continue;
                    }
                };
                if let Some(parent) = dest.parent() {
                    if let Err(e) = std::fs::create_dir_all(parent) {
                        warnings.push(format!("{}: {e}", dest.display()));
                        continue;
                    }
                }
                match File::create(&dest) {
                    Ok(mut out) => match std::io::copy(&mut entry, &mut out) {
                        Ok(bytes) => {
                            restored_files += 1;
                            total_bytes += bytes;
                        }
                        Err(e) => warnings.push(format!("{}: {e}", dest.display())),
                    },
                    Err(e) => warnings.push(format!("{}: {e}", dest.display())),
                }
            }
        }
    } else {
        let files_dir = Path::new(&backup.root_path).join("files");
        for mloc in &manifest.locations {
            for file in manifest
                .files
                .iter()
                .filter(|f| f.location_index == mloc.index)
            {
                let src = files_dir
                    .join(mloc.index.to_string())
                    .join(file.rel.replace('/', std::path::MAIN_SEPARATOR_STR));
                if !src.is_file() {
                    warnings.push(format!("Missing backup file: {}", file.rel));
                    continue;
                }
                let dest = restore_dest(mloc, &file.rel);
                if let Some(parent) = dest.parent() {
                    if let Err(e) = std::fs::create_dir_all(parent) {
                        warnings.push(format!("{}: {e}", dest.display()));
                        continue;
                    }
                }
                match std::fs::copy(&src, &dest) {
                    Ok(bytes) => {
                        restored_files += 1;
                        total_bytes += bytes;
                    }
                    Err(e) => warnings.push(format!("{}: {e}", dest.display())),
                }
            }
        }
    }

    // Refresh the per-location restore stamps so the UI shows activity.
    for loc in saves::list_locations(db, &backup.game_id)? {
        let _ = saves::touch_location_restore(db, &loc.id, unix_now_ms());
    }

    Ok(RestoreResult {
        backup_id: backup.id.clone(),
        game_id: backup.game_id.clone(),
        restored_files,
        total_bytes,
        safety_backup_id,
        warnings,
    })
}

/// Delete a snapshot from disk (archive file or legacy directory, best
/// effort). Refuses to touch paths outside `backup_dir`.
pub fn delete_snapshot(backup: &SaveBackup, backup_dir: &Path) {
    if backup.root_path.is_empty() {
        return;
    }
    let root = Path::new(&backup.root_path);
    let Ok(canon_root) = backup_dir.canonicalize() else {
        return;
    };
    let Ok(canon_target) = root.canonicalize() else {
        return;
    };
    if canon_target.starts_with(&canon_root) {
        if is_archive_path(&canon_target) {
            let _ = std::fs::remove_file(canon_target);
        } else {
            let _ = std::fs::remove_dir_all(canon_target);
        }
    }
}

/// Prune old snapshots for a game beyond `retention` (0 = keep all).
/// Manual backups are pruned last so an auto-backup flood never evicts a
/// snapshot the user asked for.
pub fn prune_backups(db: &Db, backup_dir: &Path, game_id: &str, retention: u32) {
    if retention == 0 {
        return;
    }
    let Ok(mut list) = saves::list_backups(db, Some(game_id)) else {
        return;
    };
    if list.len() <= retention as usize {
        return;
    }
    // Newest first: keep the first `retention`, evict the rest.
    let mut doomed = list.split_off(retention as usize);
    // Evict non-manual first, then manual, oldest-first within each group.
    doomed.sort_by_key(|b| (b.kind == "manual", b.created_at));
    for backup in doomed {
        delete_snapshot(&backup, backup_dir);
        let _ = saves::delete_backup(db, &backup.id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glob_matches_names_and_paths() {
        assert!(glob_match("*.tmp", "save.tmp"));
        assert!(glob_match("*.tmp", "SAVE.TMP"));
        assert!(!glob_match("*.tmp", "save.sav"));
        assert!(glob_match("cache/*", "cache/data.bin"));
        assert!(glob_match("?ave", "save"));
        assert!(!glob_match("?ave", "ssave"));
    }

    #[test]
    fn ignore_rules_apply_to_name_or_path() {
        let patterns = vec!["*.log".to_string(), "temp/*".to_string()];
        assert!(is_ignored(&patterns, "run.log", "sub/run.log"));
        assert!(is_ignored(&patterns, "file.bin", "temp/file.bin"));
        assert!(!is_ignored(&patterns, "save.sav", "sub/save.sav"));
    }

    #[test]
    fn safe_component_strips_path_separators() {
        assert_eq!(safe_component("D:/Games/Cool Game!"), "D__Games_Cool_Game");
        assert_eq!(safe_component(""), "game");
    }

    fn location(game_id: &str, path: &std::path::Path, kind: &str) -> SaveLocation {
        SaveLocation {
            id: format!("loc-{kind}"),
            game_id: game_id.into(),
            path: path.to_string_lossy().to_string(),
            label: "Saves".into(),
            kind: kind.into(),
            source: "manual".into(),
            include: true,
            created_at: 0,
            updated_at: 0,
            last_backup_at: None,
            last_restore_at: None,
        }
    }

    #[test]
    fn archive_backup_and_restore_round_trip() {
        let tmp = tempfile::tempdir().unwrap();
        let db = Db::open(tmp.path()).unwrap();
        super::super::super::db::migrate::run_migrations(&db).unwrap();

        // Source save folder with a nested file plus an ignored file.
        let save_src = tmp.path().join("saves");
        std::fs::create_dir_all(save_src.join("nested")).unwrap();
        std::fs::write(save_src.join("slot1.sav"), b"hello").unwrap();
        std::fs::write(save_src.join("nested/slot2.sav"), b"world!").unwrap();
        std::fs::write(save_src.join("debug.log"), b"noise").unwrap();

        let loc = location("g1", &save_src, "dir");
        saves::upsert_location(&db, loc.clone()).unwrap();

        let backup_dir = tmp.path().join("backups");
        let ignore = default_ignore_patterns();
        let backup = create_backup(
            None,
            &db,
            "g1",
            "Game One",
            &[loc],
            "manual",
            "test",
            &backup_dir,
            &ignore,
        )
        .unwrap();

        // One archive file on disk, not a directory tree.
        assert!(backup.root_path.ends_with(".gisave"));
        assert!(Path::new(&backup.root_path).is_file());
        assert!(backup.manifest_path.is_empty());
        assert_eq!(backup.status, "complete");
        assert_eq!(backup.file_count, 2, "debug.log should be ignored");

        let manifest = read_manifest(&backup).expect("manifest lives inside the archive");
        assert_eq!(manifest.format, MANIFEST_FORMAT);
        assert_eq!(manifest.files.len(), 2);

        // Wipe the source, then restore straight from the archive.
        std::fs::remove_dir_all(&save_src).unwrap();
        let result = restore_backup(None, &db, &backup, false, &backup_dir, &ignore).unwrap();
        assert_eq!(result.restored_files, 2);
        assert!(result.warnings.is_empty());
        assert_eq!(std::fs::read(save_src.join("slot1.sav")).unwrap(), b"hello");
        assert_eq!(
            std::fs::read(save_src.join("nested").join("slot2.sav")).unwrap(),
            b"world!"
        );
        assert!(!save_src.join("debug.log").exists());

        // Deleting removes the archive file itself.
        delete_snapshot(&backup, &backup_dir);
        assert!(!Path::new(&backup.root_path).exists());
    }

    #[test]
    fn backup_with_no_capturable_files_is_failed() {
        let tmp = tempfile::tempdir().unwrap();
        let db = Db::open(tmp.path()).unwrap();
        super::super::super::db::migrate::run_migrations(&db).unwrap();

        let missing = location("g1", &tmp.path().join("does-not-exist"), "dir");
        saves::upsert_location(&db, missing.clone()).unwrap();

        let backup_dir = tmp.path().join("backups");
        let backup = create_backup(
            None,
            &db,
            "g1",
            "Game One",
            &[missing],
            "manual",
            "",
            &backup_dir,
            &default_ignore_patterns(),
        )
        .unwrap();

        assert_eq!(backup.status, "failed");
        assert_eq!(backup.file_count, 0);
        assert!(backup
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("missing"));

        // The archive stays self-describing even when it captured nothing.
        assert!(read_manifest(&backup).is_some());
    }

    #[test]
    fn restore_rejects_corrupt_archive() {
        let tmp = tempfile::tempdir().unwrap();
        let db = Db::open(tmp.path()).unwrap();
        super::super::super::db::migrate::run_migrations(&db).unwrap();

        let save_src = tmp.path().join("saves");
        std::fs::create_dir_all(&save_src).unwrap();
        std::fs::write(save_src.join("slot1.sav"), b"hello").unwrap();
        let loc = location("g1", &save_src, "dir");
        saves::upsert_location(&db, loc.clone()).unwrap();

        let backup_dir = tmp.path().join("backups");
        let backup = create_backup(
            None,
            &db,
            "g1",
            "Game One",
            &[loc],
            "manual",
            "",
            &backup_dir,
            &default_ignore_patterns(),
        )
        .unwrap();

        // Truncate the archive so it is no longer a readable zip.
        std::fs::write(&backup.root_path, b"not a zip archive").unwrap();
        assert!(read_manifest(&backup).is_none());

        let err =
            restore_backup(None, &db, &backup, false, &backup_dir, &default_ignore_patterns())
                .unwrap_err();
        assert!(err.contains("manifest"), "unexpected error: {err}");
    }
}
