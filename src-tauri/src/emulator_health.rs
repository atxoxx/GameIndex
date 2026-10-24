//! Emulator library health scan.
//!
//! One pass over the configured emulators and their ROM rows that answers
//! "what is broken in my emulation library?" — missing executables, missing
//! ROM folders, ROM files that disappeared, empty ROMs, unconfigured or
//! incomplete firmware folders, sizes that were never measured and duplicate
//! copies of the same dump.
//!
//! The scan is read-only. The frontend decides which fix to apply (unlink a
//! stale row, recalculate sizes, open the editor) using the existing commands,
//! so a health pass can never delete something on its own.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::db;
use crate::games::GameData;

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// One problem found by the health scan. `kind` is stable and drives the
/// localized label; `message` is an English fallback for logs/toasts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmulatorHealthFinding {
    pub id: String,
    /// `missing_executable` | `missing_rom_folder` | `missing_rom` |
    /// `empty_rom` | `missing_bios` | `bios_unconfigured` |
    /// `unknown_size` | `duplicate_rom`
    pub kind: String,
    /// `error` | `warning` | `info`
    pub severity: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emulator_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emulator_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_name: Option<String>,
    /// Affected game rows (duplicate groups can span several systems).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub game_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Missing file names for firmware findings.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub missing_files: Vec<String>,
    pub message: String,
    /// Suggested action: `edit_emulator` | `unlink_rom` | `recalc_sizes`
    /// `review_duplicates`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fix: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EmulatorHealthReport {
    pub findings: Vec<EmulatorHealthFinding>,
    pub systems: u32,
    pub roms: u32,
    pub errors: u32,
    pub warnings: u32,
    pub missing_roms: u32,
    pub missing_bios: u32,
    pub duplicate_groups: u32,
    pub reclaimable_bytes: u64,
    pub deep: bool,
    pub checked_at_ms: u64,
}

fn finding(
    id: impl Into<String>,
    kind: &str,
    severity: &str,
    message: impl Into<String>,
) -> EmulatorHealthFinding {
    EmulatorHealthFinding {
        id: id.into(),
        kind: kind.to_string(),
        severity: severity.to_string(),
        emulator_id: None,
        emulator_name: None,
        game_id: None,
        game_name: None,
        game_ids: Vec::new(),
        paths: Vec::new(),
        path: None,
        missing_files: Vec::new(),
        message: message.into(),
        fix: None,
        bytes: None,
    }
}

impl EmulatorHealthFinding {
    fn for_emulator(mut self, id: &str, name: &str) -> Self {
        self.emulator_id = Some(id.to_string());
        self.emulator_name = Some(name.to_string());
        self.id = format!("{id}:{}", self.id);
        self
    }

    fn with_fix(mut self, fix: &str) -> Self {
        self.fix = Some(fix.to_string());
        self
    }
}

/// Aggregate the per-finding verdicts into the report header.
fn summarize(mut report: EmulatorHealthReport) -> EmulatorHealthReport {
    for f in &report.findings {
        match f.severity.as_str() {
            "error" => report.errors += 1,
            "warning" => report.warnings += 1,
            _ => {}
        }
        match f.kind.as_str() {
            "missing_rom" | "empty_rom" => report.missing_roms += 1,
            "missing_bios" => report.missing_bios += 1,
            "duplicate_rom" => {
                report.duplicate_groups += 1;
                report.reclaimable_bytes += f.bytes.unwrap_or(0);
            }
            _ => {}
        }
    }
    report
}

/// Scan every emulator and its ROM rows.
///
/// `deep` additionally hashes ROMs that were never hashed, which makes
/// duplicate detection reliable but reads every file once. The quick scan
/// only uses hashes already stored by a previous duplicate/recalc pass.
#[tauri::command]
pub async fn emulator_health_scan(
    app: tauri::AppHandle,
    deep: Option<bool>,
) -> Result<EmulatorHealthReport, String> {
    let db = app.state::<db::Db>().inner().clone();
    let deep = deep.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || health_scan_blocking(&db, deep))
        .await
        .map_err(|e| format!("emulator_health_scan task: {e}"))?
}

fn health_scan_blocking(db: &db::Db, deep: bool) -> Result<EmulatorHealthReport, String> {
    let emulators = db::emulators::list_all(db)?;
    let all_games: Vec<GameData> = db::games::list_all(db)?
        .into_iter()
        .filter(|g| g.emulator_id.is_some())
        .map(GameData::from)
        .collect();

    let mut report = EmulatorHealthReport {
        systems: emulators.len() as u32,
        roms: all_games.len() as u32,
        deep,
        checked_at_ms: now_ms(),
        ..Default::default()
    };

    let mut by_emulator: HashMap<String, Vec<GameData>> = HashMap::new();
    for g in all_games {
        if let Some(id) = g.emulator_id.clone() {
            by_emulator.entry(id).or_default().push(g);
        }
    }

    for emu in &emulators {
        let games = by_emulator.get(&emu.id).cloned().unwrap_or_default();

        // ── Executable ───────────────────────────────────────────────
        let exe = emu.executable_path.trim();
        if exe.is_empty() {
            report.findings.push(
                finding(
                    "missing-executable",
                    "missing_executable",
                    "error",
                    format!("{} has no emulator executable configured", emu.name),
                )
                .for_emulator(&emu.id, &emu.name)
                .with_fix("edit_emulator"),
            );
        } else if !std::path::Path::new(exe).is_file() {
            report.findings.push(
                finding(
                    "missing-executable",
                    "missing_executable",
                    "error",
                    format!("Emulator executable not found: {exe}"),
                )
                .for_emulator(&emu.id, &emu.name)
                .with_fix("edit_emulator"),
            );
        }

        // ── ROM folder ───────────────────────────────────────────────
        let folder = emu.rom_folder.trim();
        if folder.is_empty() {
            report.findings.push(
                finding(
                    "missing-rom-folder",
                    "missing_rom_folder",
                    "error",
                    format!("{} has no ROM folder configured", emu.name),
                )
                .for_emulator(&emu.id, &emu.name)
                .with_fix("edit_emulator"),
            );
        } else if !std::path::Path::new(folder).is_dir() {
            report.findings.push(
                finding(
                    "missing-rom-folder",
                    "missing_rom_folder",
                    "error",
                    format!("ROM folder not found: {folder}"),
                )
                .for_emulator(&emu.id, &emu.name)
                .with_fix("edit_emulator"),
            );
        }

        // ── Firmware / BIOS ──────────────────────────────────────────
        let bios = crate::roms::bios_check_blocking(emu);
        let mandatory_missing: Vec<String> = bios
            .requirements
            .iter()
            .filter(|r| r.mandatory && !r.found)
            .map(|r| r.name.clone())
            .collect();
        if !bios.requirements.is_empty() && !bios.configured {
            let mut f = finding(
                "bios-unconfigured",
                "bios_unconfigured",
                "info",
                format!("{} has firmware requirements but no BIOS folder set", emu.name),
            )
            .for_emulator(&emu.id, &emu.name)
            .with_fix("edit_emulator");
            f.missing_files = mandatory_missing;
            report.findings.push(f);
        } else if !mandatory_missing.is_empty() {
            let mut f = finding(
                "missing-bios",
                "missing_bios",
                "warning",
                format!(
                    "{} is missing mandatory firmware: {}",
                    emu.name,
                    mandatory_missing.join(", ")
                ),
            )
            .for_emulator(&emu.id, &emu.name)
            .with_fix("edit_emulator");
            f.missing_files = mandatory_missing;
            report.findings.push(f);
        }

        // ── ROM rows ─────────────────────────────────────────────────
        for game in &games {
            let Some(path) = game.rom_path.clone() else {
                continue;
            };
            let file = std::path::Path::new(&path);
            if !file.is_file() {
                report.findings.push(
                    finding(
                        format!("missing-rom:{}", game.id),
                        "missing_rom",
                        "error",
                        format!("ROM file is missing: {path}"),
                    )
                    .for_emulator(&emu.id, &emu.name)
                    .tap_game(game)
                    .tap_path(&path)
                    .with_fix("unlink_rom"),
                );
                continue;
            }
            let len = std::fs::metadata(file).map(|m| m.len()).unwrap_or(0);
            if len == 0 {
                report.findings.push(
                    finding(
                        format!("empty-rom:{}", game.id),
                        "empty_rom",
                        "warning",
                        format!("ROM file is empty: {path}"),
                    )
                    .for_emulator(&emu.id, &emu.name)
                    .tap_game(game)
                    .tap_path(&path)
                    .with_fix("unlink_rom"),
                );
            }
            if game.size_bytes.unwrap_or(0) == 0 && len > 0 {
                report.findings.push(
                    finding(
                        format!("unknown-size:{}", game.id),
                        "unknown_size",
                        "info",
                        format!("Size was never measured: {path}"),
                    )
                    .for_emulator(&emu.id, &emu.name)
                    .tap_game(game)
                    .tap_path(&path)
                    .with_fix("recalc_sizes"),
                );
            }
        }
    }

    // ── Duplicates ───────────────────────────────────────────────────
    let mut hashed: Vec<GameData> = by_emulator.values().flatten().cloned().collect();
    if deep {
        for g in &mut hashed {
            if g.rom_hash.is_none() {
                if let Ok(Some(hash)) = crate::roms::ensure_rom_hash(db, g) {
                    g.rom_hash = Some(hash);
                }
            }
        }
    }
    let mut by_hash: HashMap<String, Vec<GameData>> = HashMap::new();
    for g in hashed {
        if let Some(hash) = &g.rom_hash {
            by_hash.entry(hash.clone()).or_default().push(g);
        }
    }
    for (hash, group) in by_hash {
        if group.len() < 2 {
            continue;
        }
        let size = group.iter().filter_map(|g| g.size_bytes).max().unwrap_or(0);
        let ids: Vec<String> = group.iter().map(|g| g.id.clone()).collect();
        let paths: Vec<String> = group.iter().filter_map(|g| g.rom_path.clone()).collect();
        let names: Vec<String> = group.iter().map(|g| g.name.clone()).collect();
        report.findings.push(EmulatorHealthFinding {
            id: format!("duplicate:{hash}"),
            kind: "duplicate_rom".to_string(),
            severity: "warning".to_string(),
            emulator_id: None,
            emulator_name: None,
            game_id: None,
            game_name: None,
            game_ids: ids,
            paths,
            path: None,
            missing_files: Vec::new(),
            message: format!("Duplicate ROMs: {}", names.join(", ")),
            fix: Some("review_duplicates".to_string()),
            bytes: Some(size.saturating_mul(group.len() as u64 - 1)),
        });
    }

    // Errors first, then warnings, then info; stable within a severity.
    report.findings.sort_by_key(|f| match f.severity.as_str() {
        "error" => 0,
        "warning" => 1,
        _ => 2,
    });
    Ok(summarize(report))
}

/// Small builder helpers kept next to the struct so the scan above stays
/// readable.
trait FindingGameExt {
    fn tap_game(self, game: &GameData) -> Self;
    fn tap_path(self, path: &str) -> Self;
}

impl FindingGameExt for EmulatorHealthFinding {
    fn tap_game(mut self, game: &GameData) -> Self {
        self.game_id = Some(game.id.clone());
        self.game_name = Some(game.name.clone());
        self
    }

    fn tap_path(mut self, path: &str) -> Self {
        self.path = Some(path.to_string());
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(kind: &str, severity: &str, bytes: Option<u64>) -> EmulatorHealthFinding {
        let mut f = finding("x", kind, severity, "msg");
        f.bytes = bytes;
        f
    }

    #[test]
    fn summarize_counts_severity_and_kind() {
        let report = summarize(EmulatorHealthReport {
            findings: vec![
                sample("missing_rom", "error", None),
                sample("missing_bios", "warning", None),
                sample("duplicate_rom", "warning", Some(2048)),
                sample("unknown_size", "info", None),
            ],
            systems: 2,
            roms: 10,
            ..Default::default()
        });
        assert_eq!(report.errors, 1);
        assert_eq!(report.warnings, 2);
        assert_eq!(report.missing_roms, 1);
        assert_eq!(report.missing_bios, 1);
        assert_eq!(report.duplicate_groups, 1);
        assert_eq!(report.reclaimable_bytes, 2048);
    }
}
