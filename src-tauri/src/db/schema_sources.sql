-- =====================================================================
-- Gamelib persistent storage — sources domain (sources.db).
-- =====================================================================
-- Sources + cache + downloads. These four tables are FK/trigger
-- coupled and MUST live in the same physical file:
--   * `sources` is the parent; deleting a source cascades to its
--     cache and downloads (ON DELETE CASCADE).
--   * `downloads_fts` is an FTS5 mirror kept in sync by triggers on
--     `downloads`.

CREATE TABLE IF NOT EXISTS sources (
    id              TEXT PRIMARY KEY,        -- "src_<nanos>_<counter>"
    hydra_source_id TEXT NOT NULL DEFAULT '',
    url             TEXT NOT NULL,
    name            TEXT NOT NULL,
    enabled         INTEGER NOT NULL,        -- 0/1, compact SQL instead of bool
    last_fetched    INTEGER,                 -- unix seconds, NULL = never
    game_count      INTEGER NOT NULL DEFAULT 0,
    added_at        INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sources_url ON sources(url);

CREATE TABLE IF NOT EXISTS sources_cache (
    source_id       TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
    hydra_source_id TEXT NOT NULL DEFAULT '',
    fetched_at      INTEGER NOT NULL,
    payload_json    TEXT NOT NULL            -- compact JSON of GameSource
);

CREATE TABLE IF NOT EXISTS downloads (
    source_id    TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    row_id       INTEGER NOT NULL,
    title        TEXT NOT NULL,
    file_size    TEXT NOT NULL,
    upload_date  TEXT,
    uris_json    TEXT NOT NULL,              -- compact JSON array
    magnet       TEXT,
    PRIMARY KEY (source_id, row_id)
);
CREATE INDEX IF NOT EXISTS ix_downloads_source ON downloads(source_id);

-- FTS5 virtual table full-text-indexes the (title) column. The
-- `bm25(downloads_fts)` ranker powers the per-source `search` command.
-- UNINDEXED columns let us filter by source_id / lookup the URI in
-- post-processing without bloating the index.
CREATE VIRTUAL TABLE IF NOT EXISTS downloads_fts USING fts5(
    title,
    source_id UNINDEXED,
    download_uri UNINDEXED,
    file_size UNINDEXED,
    upload_date UNINDEXED,
    tokenize = 'unicode61 remove_diacritics 2'
);

-- Triggers keep downloads_fts in sync with downloads. We ROWID-align
-- fts rows to `downloads.row_id` so JOINs look natural; the actual
-- FTS5 rowid is whatever SQLite assigns — the `rowid` column in the
-- index records the documents' source row_id so we can join.
CREATE TRIGGER IF NOT EXISTS trg_downloads_ai AFTER INSERT ON downloads BEGIN
  INSERT INTO downloads_fts(rowid, title, source_id, download_uri, file_size, upload_date)
  VALUES (new.rowid, new.title, new.source_id,
          json_extract(new.uris_json, '$[0]'), new.file_size, new.upload_date);
END;

CREATE TRIGGER IF NOT EXISTS trg_downloads_au AFTER UPDATE ON downloads BEGIN
  DELETE FROM downloads_fts WHERE rowid = old.rowid;
  INSERT INTO downloads_fts(rowid, title, source_id, download_uri, file_size, upload_date)
  VALUES (new.rowid, new.title, new.source_id,
          json_extract(new.uris_json, '$[0]'), new.file_size, new.upload_date);
END;

CREATE TRIGGER IF NOT EXISTS trg_downloads_ad AFTER DELETE ON downloads BEGIN
  DELETE FROM downloads_fts WHERE rowid = old.rowid;
END;
