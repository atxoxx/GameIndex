-- Download history: append-only ledger of every download that ever
-- completed or was removed, so statistics survive deletion.
CREATE TABLE IF NOT EXISTS download_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    download_id TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    source_name TEXT NOT NULL DEFAULT '',
    save_path TEXT NOT NULL DEFAULT '',
    downloaded INTEGER NOT NULL DEFAULT 0,
    total_size INTEGER,
    status TEXT NOT NULL,
    debrid_cached INTEGER,
    auto_extract INTEGER,
    extracted INTEGER,
    added_at INTEGER NOT NULL,
    completed_at INTEGER,
    peak_speed INTEGER NOT NULL DEFAULT 0
);
