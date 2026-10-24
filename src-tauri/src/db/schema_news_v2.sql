-- =====================================================================
-- Gamelib persistent storage — news domain, schema v2.
-- =====================================================================
-- v1 kept only the most-recent raw payload per feed URL. The reader
-- needs a real store instead: merged articles that survive a restart,
-- plus per-article state (read / saved) and a reading history that every
-- surface shares.
--
-- Feed rows hold only what the frontend cannot recompute: the user's
-- enabled/disabled decision for a default feed and every custom feed.
-- Default + regional catalogues stay in the frontend so translations and
-- new shipped feeds arrive without a migration.

CREATE TABLE IF NOT EXISTS news_feeds (
    url        TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    category   TEXT NOT NULL DEFAULT 'general',
    region     TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,
    enabled    INTEGER NOT NULL DEFAULT 1,
    position   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS news_articles (
    link        TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL DEFAULT '',
    pub_date    TEXT NOT NULL DEFAULT '',
    source_name TEXT NOT NULL,
    source_url  TEXT NOT NULL DEFAULT '',
    image_url   TEXT,
    -- Wall-clock seconds the story first arrived. Powers "since your last
    -- visit" and keeps a re-fetch from resetting the age of a story.
    first_seen  INTEGER NOT NULL,
    fetched_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_news_articles_fetched
    ON news_articles(fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_news_articles_source
    ON news_articles(source_name);

CREATE TABLE IF NOT EXISTS news_read (
    link    TEXT PRIMARY KEY,
    read_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_news_read_at ON news_read(read_at DESC);

CREATE TABLE IF NOT EXISTS news_saved (
    link        TEXT PRIMARY KEY,
    saved_at    INTEGER NOT NULL,
    title       TEXT NOT NULL,
    source_name TEXT NOT NULL,
    pub_date    TEXT NOT NULL DEFAULT '',
    image_url   TEXT
);

CREATE INDEX IF NOT EXISTS idx_news_saved_at ON news_saved(saved_at DESC);

CREATE TABLE IF NOT EXISTS news_history (
    link        TEXT PRIMARY KEY,
    read_at     INTEGER NOT NULL,
    title       TEXT NOT NULL,
    source_name TEXT NOT NULL,
    pub_date    TEXT NOT NULL DEFAULT '',
    image_url   TEXT
);

CREATE INDEX IF NOT EXISTS idx_news_history_at ON news_history(read_at DESC);

-- Small key/value bag for reader preferences that must survive a restart:
-- last visit timestamp, followed/muted topics and the per-surface view mode.
CREATE TABLE IF NOT EXISTS news_prefs (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
