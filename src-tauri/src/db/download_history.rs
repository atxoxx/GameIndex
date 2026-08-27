//! Download-history DAO.
//!
//! Append-only ledger recording every download that ever completed or
//! was removed (including partials), so download-page statistics
//! survive deletion of the live record. One row per `download_id`
//! (upserted in place on re-record), newest first on read.

use rusqlite::params;

use super::pool::Db;
use crate::downloads::types::{Download, DownloadKind, DownloadStatus};

/// Insert or update the ledger row for `d`. `download_id` is the
/// unique key, so re-recording (a removal after a completion, or a
/// completion re-emitted by a later tick) updates in place instead of
/// duplicating the row.
pub fn upsert(db: &Db, d: &Download) -> Result<(), String> {
    let conn = db
        .download_history()
        .map_err(|e| format!("download_history conn: {e}"))?;
    let status_json = serde_json::to_string(&d.status)
        .map_err(|e| format!("download_history status json: {e}"))?;
    conn.execute(
        "INSERT INTO download_history(
            download_id, kind, name, source_name, save_path, downloaded,
            total_size, status, debrid_cached, auto_extract, extracted,
            added_at, completed_at, peak_speed
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
         ON CONFLICT(download_id) DO UPDATE SET
            kind = excluded.kind,
            name = excluded.name,
            source_name = excluded.source_name,
            save_path = excluded.save_path,
            downloaded = excluded.downloaded,
            total_size = excluded.total_size,
            status = excluded.status,
            debrid_cached = excluded.debrid_cached,
            auto_extract = excluded.auto_extract,
            extracted = excluded.extracted,
            added_at = excluded.added_at,
            completed_at = excluded.completed_at,
            peak_speed = excluded.peak_speed",
        params![
            d.id,
            kind_to_text(d.kind),
            d.name,
            d.source_name,
            d.save_path,
            d.downloaded as i64,
            d.total_size.map(|n| n as i64),
            status_json,
            bool_to_opt_i64(d.debrid_cached),
            bool_to_opt_i64(d.auto_extract),
            bool_to_opt_i64(d.extracted),
            d.added_at as i64,
            d.completed_at.map(|n| n as i64),
            d.peak_speed.unwrap_or(0) as i64,
        ],
    )
    .map_err(|e| format!("download_history upsert: {e}"))?;
    Ok(())
}

/// Return every ledger row, newest first.
pub fn list_all(db: &Db) -> Result<Vec<DownloadHistoryRecord>, String> {
    let conn = db
        .download_history()
        .map_err(|e| format!("download_history conn: {e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT id, download_id, kind, name, source_name, save_path, downloaded,
                    total_size, status, debrid_cached, auto_extract, extracted,
                    added_at, completed_at, peak_speed
               FROM download_history
              ORDER BY id DESC",
        )
        .map_err(|e| format!("download_history list prepare: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, Option<i64>>(7)?,
                r.get::<_, String>(8)?,
                r.get::<_, Option<i64>>(9)?,
                r.get::<_, Option<i64>>(10)?,
                r.get::<_, Option<i64>>(11)?,
                r.get::<_, i64>(12)?,
                r.get::<_, Option<i64>>(13)?,
                r.get::<_, i64>(14)?,
            ))
        })
        .map_err(|e| format!("download_history list query: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        let (
            id,
            download_id,
            kind,
            name,
            source_name,
            save_path,
            downloaded,
            total_size,
            status_json,
            debrid_cached,
            auto_extract,
            extracted,
            added_at,
            completed_at,
            peak_speed,
        ) = row.map_err(|e| format!("download_history row: {e}"))?;
        let status: DownloadStatus = serde_json::from_str(&status_json)
            .map_err(|e| format!("download_history status json: {e}"))?;
        out.push(DownloadHistoryRecord {
            id,
            download_id,
            kind: text_to_kind(&kind),
            name,
            source_name,
            save_path,
            downloaded: downloaded as u64,
            total_size: total_size.map(|n| n as u64),
            status,
            debrid_cached: bool_from_opt_i64(debrid_cached),
            auto_extract: bool_from_opt_i64(auto_extract),
            extracted: bool_from_opt_i64(extracted),
            added_at: added_at as u64,
            completed_at: completed_at.map(|n| n as u64),
            peak_speed: peak_speed as u64,
        });
    }
    Ok(out)
}

/// Delete every ledger row. Returns the number of rows removed.
pub fn clear(db: &Db) -> Result<u64, String> {
    let conn = db
        .download_history()
        .map_err(|e| format!("download_history conn: {e}"))?;
    let n = conn
        .execute("DELETE FROM download_history", [])
        .map_err(|e| format!("download_history clear: {e}"))?;
    Ok(n as u64)
}

/// One immutable ledger row, camelCase on the wire (matches the
/// frontend `DownloadHistoryRecord` contract).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadHistoryRecord {
    pub id: i64,
    pub download_id: String,
    pub kind: DownloadKind,
    pub name: String,
    pub source_name: String,
    pub save_path: String,
    pub downloaded: u64,
    pub total_size: Option<u64>,
    /// Adjacently tagged `{kind, message}` — same wire shape as
    /// `Download.status`.
    pub status: DownloadStatus,
    pub debrid_cached: Option<bool>,
    pub auto_extract: Option<bool>,
    pub extracted: Option<bool>,
    pub added_at: u64,
    pub completed_at: Option<u64>,
    pub peak_speed: u64,
}

fn kind_to_text(kind: DownloadKind) -> &'static str {
    match kind {
        DownloadKind::Torrent => "torrent",
        DownloadKind::Direct => "direct",
        DownloadKind::Debrid => "debrid",
    }
}

fn text_to_kind(s: &str) -> DownloadKind {
    match s {
        "direct" => DownloadKind::Direct,
        "debrid" => DownloadKind::Debrid,
        _ => DownloadKind::Torrent,
    }
}

fn bool_to_opt_i64(b: Option<bool>) -> Option<i64> {
    b.map(|v| if v { 1 } else { 0 })
}

fn bool_from_opt_i64(n: Option<i64>) -> Option<bool> {
    n.map(|v| v != 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_download(id: &str, status: DownloadStatus) -> Download {
        let mut d = Download::new(
            id.to_string(),
            DownloadKind::Torrent,
            format!("Game {}", id),
            "magnet:?xt=urn:btih:deadbeef".to_string(),
            "C:\\Downloads".to_string(),
            None,
            "GOG".to_string(),
            false,
        );
        d.status = status;
        d
    }

    #[test]
    fn upsert_twice_same_download_id_updates_one_row() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        super::super::migrate::run_migrations(&db).unwrap();

        let mut d = test_download("dl_1", DownloadStatus::Completed);
        d.downloaded = 100;
        d.total_size = Some(1000);
        d.peak_speed = Some(5_000_000);
        d.completed_at = Some(1234);
        upsert(&db, &d).unwrap();

        let mut d2 = d.clone();
        d2.downloaded = 250;
        d2.peak_speed = Some(9_000_000);
        upsert(&db, &d2).unwrap();

        let rows = list_all(&db).unwrap();
        assert_eq!(rows.len(), 1, "second upsert must update, not duplicate");
        assert_eq!(rows[0].download_id, "dl_1");
        assert_eq!(rows[0].downloaded, 250);
        assert_eq!(rows[0].peak_speed, 9_000_000);
        assert_eq!(rows[0].total_size, Some(1000));
        assert_eq!(rows[0].completed_at, Some(1234));
    }

    #[test]
    fn list_all_returns_newest_first() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        super::super::migrate::run_migrations(&db).unwrap();

        upsert(&db, &test_download("dl_a", DownloadStatus::Completed)).unwrap();
        upsert(&db, &test_download("dl_b", DownloadStatus::Completed)).unwrap();
        upsert(&db, &test_download("dl_c", DownloadStatus::Completed)).unwrap();

        let rows = list_all(&db).unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].download_id, "dl_c");
        assert_eq!(rows[1].download_id, "dl_b");
        assert_eq!(rows[2].download_id, "dl_a");
    }

    #[test]
    fn status_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        super::super::migrate::run_migrations(&db).unwrap();

        let mut done = test_download("dl_done", DownloadStatus::Completed);
        done.debrid_cached = Some(true);
        done.auto_extract = Some(true);
        done.extracted = Some(true);
        upsert(&db, &done).unwrap();

        let mut removed = test_download("dl_removed", DownloadStatus::Removed);
        removed.auto_extract = Some(false);
        upsert(&db, &removed).unwrap();

        let errored = test_download("dl_err", DownloadStatus::Error("boom".to_string()));
        upsert(&db, &errored).unwrap();

        let rows = list_all(&db).unwrap();
        assert_eq!(rows.len(), 3);

        let done_row = rows.iter().find(|r| r.download_id == "dl_done").unwrap();
        assert!(matches!(done_row.status, DownloadStatus::Completed));
        assert_eq!(done_row.debrid_cached, Some(true));
        assert_eq!(done_row.auto_extract, Some(true));
        assert_eq!(done_row.extracted, Some(true));

        let removed_row = rows.iter().find(|r| r.download_id == "dl_removed").unwrap();
        assert!(matches!(removed_row.status, DownloadStatus::Removed));

        let err_row = rows.iter().find(|r| r.download_id == "dl_err").unwrap();
        assert!(matches!(err_row.status, DownloadStatus::Error(ref m) if m == "boom"));
    }

    #[test]
    fn clear_removes_all_rows() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        super::super::migrate::run_migrations(&db).unwrap();

        upsert(&db, &test_download("dl_a", DownloadStatus::Completed)).unwrap();
        upsert(&db, &test_download("dl_b", DownloadStatus::Removed)).unwrap();
        assert_eq!(list_all(&db).unwrap().len(), 2);

        let removed = clear(&db).unwrap();
        assert_eq!(removed, 2);
        assert!(list_all(&db).unwrap().is_empty());

        // Idempotent: clearing an empty ledger removes nothing.
        assert_eq!(clear(&db).unwrap(), 0);
    }
}