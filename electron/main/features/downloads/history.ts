/**
 * Append-only download-history ledger (`download_history_get/clear`).
 *
 * Port of `src-tauri/src/db/download_history.rs`: one row per `downloadId`
 * (upserted in place on re-record), newest first on read, cleared wholesale.
 * The Rust DAO wrote SQLite; this build keeps the same document contract in
 * `downloads-history.json` because the downloads workstream owns no tables.
 */
import {
  readHistoryDocument,
  writeHistoryDocument,
} from "./state";
import type { DownloadHistoryRow, DownloadRecord } from "./types";

function toRow(id: number, d: DownloadRecord): DownloadHistoryRow {
  return {
    id,
    downloadId: d.id,
    kind: d.kind,
    name: d.name,
    sourceName: d.sourceName ?? "",
    savePath: d.savePath ?? "",
    downloaded: d.downloaded ?? 0,
    totalSize: d.totalSize ?? null,
    status: d.status,
    debridCached: d.debridCached ?? null,
    autoExtract: d.autoExtract ?? null,
    extracted: d.extracted ?? null,
    addedAt: d.addedAt ?? 0,
    completedAt: d.completedAt ?? null,
    peakSpeed: d.peakSpeed ?? 0,
  };
}

/**
 * Insert or update the ledger row for `record`. Re-recording the same id
 * (a removal after a completion, or a repeated completion tick) updates in
 * place instead of duplicating the row.
 */
export function recordHistory(record: DownloadRecord): void {
  try {
    const doc = readHistoryDocument();
    const index = doc.rows.findIndex((row) => row.downloadId === record.id);
    if (index >= 0) {
      const existing = doc.rows[index];
      doc.rows[index] = toRow(existing.id, record);
    } else {
      doc.rows.push(toRow(doc.nextId, record));
      doc.nextId += 1;
    }
    writeHistoryDocument(doc);
  } catch (error) {
    // Best effort: history must never fail a download.
    console.error(`[downloads] failed to record history for ${record.id}:`, error);
  }
}

export function listHistory(): DownloadHistoryRow[] {
  const rows = [...readHistoryDocument().rows];
  rows.sort((a, b) => b.id - a.id);
  return rows;
}

/** Delete every ledger row. Returns the number of rows removed. */
export function clearHistory(): number {
  const doc = readHistoryDocument();
  const removed = doc.rows.length;
  writeHistoryDocument({ version: 1, nextId: doc.nextId, rows: [] });
  return removed;
}
