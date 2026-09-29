//! Download diagnostics: a single snapshot of engine health, per-download
//! peer detail, HTTP worker counters, disk pressure and recent errors.
//!
//! Intended for the Downloads → Diagnostics view. Everything is read-only
//! and best-effort: a missing file, a vanished torrent handle or an
//! unreadable crash log degrades to a zero/empty field rather than failing
//! the whole command.

use serde::Serialize;
use tauri::{AppHandle, Manager};

use super::types::{unix_now, DownloadStatus};
use super::{http, scheduler, torrent};

/// Aggregate counts across every live download record.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineHealth {
    pub total: u64,
    pub active: u64,
    pub paused: u64,
    pub completed: u64,
    pub errored: u64,
    pub seeding: u64,
    pub max_concurrent: u32,
    pub scheduler_enabled: bool,
    pub window_open: bool,
}

/// One download's status plus the torrent-level peer breakdown.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadHealth {
    pub id: String,
    pub name: String,
    pub kind: super::types::DownloadKind,
    pub status: DownloadStatus,
    pub peers: u32,
    pub seeds: u32,
    pub download_speed: u64,
    pub upload_speed: u64,
    pub live: u64,
    pub live_tcp: u64,
    pub live_utp: u64,
    pub queued: u64,
    pub connecting: u64,
    pub dead: u64,
    pub seen: u64,
    pub eta_secs: Option<u64>,
    pub average_piece_ms: Option<u64>,
    pub error: Option<String>,
}

/// Filesystem pressure for one download location.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsage {
    pub path: String,
    pub mount_point: String,
    pub total: u64,
    pub free: u64,
    pub available: u64,
    /// Bytes still sitting in `.gamelib_tmp` files under `path`.
    pub temp_bytes: u64,
    /// Bytes still owed by non-completed downloads on this path.
    pub queue_bytes: u64,
}

/// A single error surfaced from a live record, the history ledger or the
/// crash log.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticError {
    pub at: u64,
    pub source: String,
    pub download_id: Option<String>,
    pub name: Option<String>,
    pub message: String,
}

/// Full diagnostics payload returned to the frontend.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadDiagnostics {
    pub generated_at: u64,
    pub engine: EngineHealth,
    pub downloads: Vec<DownloadHealth>,
    pub http: http::HttpCounters,
    pub disk: Vec<DiskUsage>,
    pub errors: Vec<DiagnosticError>,
}

/// Sum the sizes of `.gamelib_tmp*` files directly inside `path` (or its
/// parent, for a direct download whose `save_path` is the target file).
fn temp_bytes_in(path: &str) -> u64 {
    let p = std::path::Path::new(path);
    let dir = if p.is_dir() { p } else { p.parent().unwrap_or(p) };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name();
            if name.to_string_lossy().contains(".gamelib_tmp") {
                entry.metadata().ok().map(|m| if m.is_file() { m.len() } else { 0 })
            } else {
                None
            }
        })
        .sum()
}

#[tauri::command]
pub async fn download_diagnostics(app: AppHandle) -> Result<DownloadDiagnostics, String> {
    let mgr = super::wait_for_manager().await?;
    let (session, downloads, cfg) = {
        let guard = mgr.read().await;
        (
            guard.session().cloned(),
            guard.list(),
            guard.scheduler.clone(),
        )
    };

    // ── Engine health ───────────────────────────────────────────────
    let mut active = 0u64;
    let mut paused = 0u64;
    let mut completed = 0u64;
    let mut errored = 0u64;
    let mut seeding = 0u64;
    for d in &downloads {
        match d.status {
            DownloadStatus::FetchingMetadata | DownloadStatus::Downloading => active += 1,
            DownloadStatus::Paused => paused += 1,
            DownloadStatus::Completed => completed += 1,
            DownloadStatus::Seeding => seeding += 1,
            DownloadStatus::Error(_) => errored += 1,
            _ => {}
        }
    }
    let (_, now_min, weekday) = super::current_time_parts();
    let window_open = !cfg.enabled
        || !cfg.window_enabled
        || scheduler::in_window(&cfg.window_start, &cfg.window_end, &cfg.days, now_min, weekday);
    let engine = EngineHealth {
        total: downloads.len() as u64,
        active,
        paused,
        completed,
        errored,
        seeding,
        max_concurrent: cfg.max_concurrent,
        scheduler_enabled: cfg.enabled,
        window_open,
    };

    // ── Per-download health ─────────────────────────────────────────
    let download_health: Vec<DownloadHealth> = downloads
        .iter()
        .map(|d| {
            let breakdown = match &session {
                Some(session) => torrent::find_handle(session, &d.id)
                    .map(|handle| torrent::peer_breakdown(&handle.stats()))
                    .unwrap_or_default(),
                None => torrent::PeerBreakdown::default(),
            };
            let error = match &d.status {
                DownloadStatus::Error(msg) => Some(msg.clone()),
                _ => None,
            };
            DownloadHealth {
                id: d.id.clone(),
                name: d.name.clone(),
                kind: d.kind,
                status: d.status.clone(),
                peers: d.peers,
                seeds: d.seeds,
                download_speed: d.download_speed,
                upload_speed: d.upload_speed,
                live: breakdown.live,
                live_tcp: breakdown.live_tcp,
                live_utp: breakdown.live_utp,
                queued: breakdown.queued,
                connecting: breakdown.connecting,
                dead: breakdown.dead,
                seen: breakdown.seen,
                eta_secs: breakdown.eta_secs,
                average_piece_ms: breakdown.average_piece_ms,
                error,
            }
        })
        .collect();

    // ── Disk pressure ───────────────────────────────────────────────
    let mut paths: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for d in &downloads {
        let relevant = matches!(
            d.status,
            DownloadStatus::Downloading
                | DownloadStatus::FetchingMetadata
                | DownloadStatus::Queued
                | DownloadStatus::Paused
        );
        if !relevant || d.save_path.trim().is_empty() {
            continue;
        }
        if seen.insert(d.save_path.clone()) {
            paths.push(d.save_path.clone());
        }
    }
    let disk: Vec<DiskUsage> = crate::size::resolve_mounts(paths.clone())
        .into_iter()
        .map(|m| {
            let queue_bytes: u64 = downloads
                .iter()
                .filter(|d| d.save_path == m.path)
                .filter(|d| {
                    !matches!(
                        d.status,
                        DownloadStatus::Completed | DownloadStatus::Seeding
                    )
                })
                .map(|d| d.total_size.unwrap_or(0).saturating_sub(d.downloaded))
                .sum();
            DiskUsage {
                temp_bytes: temp_bytes_in(&m.path),
                path: m.path,
                mount_point: m.mount_point,
                total: m.total,
                free: m.free,
                available: m.available,
                queue_bytes,
            }
        })
        .collect();

    // ── Errors: live records, history ledger, crash log ─────────────
    let mut errors: Vec<DiagnosticError> = Vec::new();
    for d in &downloads {
        if let DownloadStatus::Error(msg) = &d.status {
            errors.push(DiagnosticError {
                at: d.completed_at.unwrap_or(d.added_at),
                source: "live".to_string(),
                download_id: Some(d.id.clone()),
                name: Some(d.name.clone()),
                message: msg.clone(),
            });
        }
    }

    let db = app.state::<crate::db::pool::Db>().inner().clone();
    if let Ok(rows) = crate::db::download_history::list_all(&db) {
        for row in rows {
            if let DownloadStatus::Error(msg) = &row.status {
                errors.push(DiagnosticError {
                    at: row.completed_at.unwrap_or(row.added_at),
                    source: "history".to_string(),
                    download_id: Some(row.download_id.clone()),
                    name: Some(row.name.clone()),
                    message: msg.clone(),
                });
            }
        }
    }

    if let Ok(dir) = app.path().app_data_dir() {
        let log_path = dir.join("crash.log");
        if let Ok(content) = std::fs::read_to_string(&log_path) {
            let lines: Vec<&str> = content.lines().collect();
            let tail = &lines[lines.len().saturating_sub(50)..];
            let message = tail.join("\n");
            if !message.trim().is_empty() {
                errors.push(DiagnosticError {
                    at: unix_now(),
                    source: "crashlog".to_string(),
                    download_id: None,
                    name: None,
                    message,
                });
            }
        }
    }

    errors.sort_by(|a, b| b.at.cmp(&a.at));
    errors.truncate(100);

    Ok(DownloadDiagnostics {
        generated_at: unix_now(),
        engine,
        downloads: download_health,
        http: http::http_counters(),
        disk,
        errors,
    })
}

/// Reset the HTTP worker's lifetime counters.
#[tauri::command]
pub async fn download_diagnostics_reset() -> Result<(), String> {
    http::reset_http_counters();
    Ok(())
}
