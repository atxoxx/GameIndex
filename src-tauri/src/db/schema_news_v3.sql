-- =====================================================================
-- Gamelib persistent storage — news domain, schema v3.
-- =====================================================================
-- v2 shipped the saved/history tables without the snippet and source URL,
-- so cards restored from the database had no summary. Append the columns
-- here instead of editing v2: installs that already ran v2 must migrate too.

ALTER TABLE news_saved ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE news_saved ADD COLUMN source_url  TEXT NOT NULL DEFAULT '';

ALTER TABLE news_history ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE news_history ADD COLUMN source_url  TEXT NOT NULL DEFAULT '';
