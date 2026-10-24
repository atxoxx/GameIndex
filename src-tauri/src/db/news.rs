//! News store DAO.
//!
//! The news surface is a reader, not a live feed: articles have to survive a
//! restart, keep the moment they were first seen, and share read/saved state
//! with the home rail, the per-game News tab and Big Screen. This DAO owns
//! that store in the `news` domain database.
//!
//! Fetching and XML parsing stay in the frontend (`fetch_url` bypasses CORS
//! and `parseRSS` runs on `DOMParser`); [`ingest`] merges the parsed payloads
//! and prunes the store to a bounded window so the database stays small.

use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::params;
use serde::{Deserialize, Serialize};

use super::pool::Db;

/// Stories older than this are dropped on every ingest.
const ARTICLE_TTL_SECS: u64 = 7 * 24 * 60 * 60;
/// Hard ceiling so a busy week cannot balloon the domain database.
const MAX_ARTICLES: i64 = 2000;
/// Some feeds embed whole articles. Bound what one row may store so 2,000
/// stories (and the reader's on-demand payload) stay small.
const MAX_DESCRIPTION_CHARS: usize = 2_000;
const MAX_CONTENT_CHARS: usize = 40_000;
/// Read links are a set; the cap only trims the oldest entries.
const MAX_READ_LINKS: i64 = 2000;
const MAX_HISTORY: i64 = 100;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsFeedRecord {
    pub url: String,
    pub name: String,
    #[serde(default = "default_category")]
    pub category: String,
    #[serde(default)]
    pub region: Option<String>,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsArticleRecord {
    pub link: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub pub_date: String,
    pub source_name: String,
    #[serde(default)]
    pub source_url: String,
    #[serde(default)]
    pub image_url: Option<String>,
    /// Unix seconds the story first arrived (not the feed's publish time).
    pub first_seen: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsArticleInput {
    pub link: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub pub_date: String,
    pub source_name: String,
    #[serde(default)]
    pub source_url: String,
    #[serde(default)]
    pub image_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsSavedRecord {
    pub link: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub source_name: String,
    #[serde(default)]
    pub source_url: String,
    #[serde(default)]
    pub pub_date: String,
    #[serde(default)]
    pub image_url: Option<String>,
    pub saved_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsHistoryRecord {
    pub link: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub source_name: String,
    #[serde(default)]
    pub source_url: String,
    #[serde(default)]
    pub pub_date: String,
    #[serde(default)]
    pub image_url: Option<String>,
    pub read_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedPayload {
    pub source_url: String,
    pub source_name: String,
    pub articles: Vec<NewsArticleInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsSnapshot {
    pub feeds: Vec<NewsFeedRecord>,
    pub articles: Vec<NewsArticleRecord>,
    pub read: Vec<String>,
    pub saved: Vec<NewsSavedRecord>,
    pub history: Vec<NewsHistoryRecord>,
    pub prefs: HashMap<String, String>,
}

/// One transaction-free read of everything a news surface needs on mount.
pub fn snapshot(db: &Db) -> Result<NewsSnapshot, String> {
    Ok(NewsSnapshot {
        feeds: list_feeds(db)?,
        articles: list_articles(db)?,
        read: list_read(db)?,
        saved: list_saved(db)?,
        history: list_history(db)?,
        prefs: list_prefs(db)?,
    })
}

pub fn list_feeds(db: &Db) -> Result<Vec<NewsFeedRecord>, String> {
    let conn = db.news().map_err(|e| format!("news conn: {e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT url, name, category, region, is_default, enabled
             FROM news_feeds
             ORDER BY position ASC, name ASC",
        )
        .map_err(|e| format!("news feeds prepare: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(NewsFeedRecord {
                url: row.get(0)?,
                name: row.get(1)?,
                category: row.get(2)?,
                region: row.get(3)?,
                is_default: row.get::<_, i64>(4)? != 0,
                enabled: row.get::<_, i64>(5)? != 0,
            })
        })
        .map_err(|e| format!("news feeds query: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("news feeds row: {e}"))
}

/// Replace the stored feed list wholesale. The frontend owns the merged
/// catalogue (defaults + regional + custom), so a single atomic write keeps
/// the table identical to what the user sees — no partial update can leave a
/// feed half-toggled.
pub fn replace_feeds(db: &Db, feeds: &[NewsFeedRecord]) -> Result<(), String> {
    let mut conn = db.news().map_err(|e| format!("news conn: {e}"))?;
    let tx = conn.transaction().map_err(|e| format!("news feeds tx: {e}"))?;
    tx.execute("DELETE FROM news_feeds", [])
        .map_err(|e| format!("news feeds clear: {e}"))?;
    for (position, feed) in feeds.iter().enumerate() {
        tx.execute(
            "INSERT INTO news_feeds(url, name, category, region, is_default, enabled, position)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                feed.url,
                feed.name,
                feed.category,
                feed.region,
                i64::from(feed.is_default),
                i64::from(feed.enabled),
                position as i64,
            ],
        )
        .map_err(|e| format!("news feed insert: {e}"))?;
    }
    tx.commit().map_err(|e| format!("news feeds commit: {e}"))
}

/// Merge freshly parsed feed payloads into the store, then prune it.
///
/// `first_seen` is only written on insert: re-fetching a story updates its
/// payload but never makes an old article look new. The returned list omits
/// article bodies (`read_article` fetches those on demand).
pub fn ingest(db: &Db, payloads: &[FeedPayload]) -> Result<Vec<NewsArticleRecord>, String> {
    let now = unix_now();
    {
        let mut conn = db.news().map_err(|e| format!("news conn: {e}"))?;
        let tx = conn.transaction().map_err(|e| format!("news ingest tx: {e}"))?;

        for payload in payloads {
            for article in &payload.articles {
                if article.link.trim().is_empty() || article.title.trim().is_empty() {
                    continue;
                }
                tx.execute(
                    "INSERT INTO news_articles
                        (link, title, description, content, pub_date, source_name,
                         source_url, image_url, first_seen, fetched_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
                     ON CONFLICT(link) DO UPDATE SET
                         title       = excluded.title,
                         description = excluded.description,
                         content     = excluded.content,
                         pub_date    = excluded.pub_date,
                         source_name = excluded.source_name,
                         source_url  = excluded.source_url,
                         image_url   = excluded.image_url,
                         fetched_at  = excluded.fetched_at",
                    params![
                        article.link.trim(),
                        article.title.trim(),
                        clip(&article.description, MAX_DESCRIPTION_CHARS),
                        clip(&article.content, MAX_CONTENT_CHARS),
                        article.pub_date,
                        article.source_name,
                        article.source_url,
                        article.image_url,
                        now,
                    ],
                )
                .map_err(|e| format!("news article upsert: {e}"))?;
            }
        }

        let oldest = now.saturating_sub(ARTICLE_TTL_SECS);
        tx.execute(
            "DELETE FROM news_articles WHERE fetched_at < ?1",
            params![oldest],
        )
        .map_err(|e| format!("news article ttl prune: {e}"))?;
        tx.execute(
            "DELETE FROM news_articles WHERE link NOT IN (
                 SELECT link FROM news_articles ORDER BY fetched_at DESC LIMIT ?1
             )",
            params![MAX_ARTICLES],
        )
        .map_err(|e| format!("news article cap prune: {e}"))?;

        tx.commit().map_err(|e| format!("news ingest commit: {e}"))?;
    }

    list_articles(db)
}

pub fn list_articles(db: &Db) -> Result<Vec<NewsArticleRecord>, String> {
    let conn = db.news().map_err(|e| format!("news conn: {e}"))?;
    let mut stmt = conn
        .prepare(
            // `content` is deliberately omitted: 2,000 full article bodies
            // would dominate the IPC payload on every app start. The reader
            // fetches the body for the one article it opens.
            "SELECT link, title, description, '', pub_date, source_name,
                    source_url, image_url, first_seen
             FROM news_articles
             ORDER BY fetched_at DESC
             LIMIT ?1",
        )
        .map_err(|e| format!("news articles prepare: {e}"))?;
    let rows = stmt
        .query_map(params![MAX_ARTICLES], |row| {
            Ok(NewsArticleRecord {
                link: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                content: row.get(3)?,
                pub_date: row.get(4)?,
                source_name: row.get(5)?,
                source_url: row.get(6)?,
                image_url: row.get(7)?,
                first_seen: row.get(8)?,
            })
        })
        .map_err(|e| format!("news articles query: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("news articles row: {e}"))
}

/// Full record (including the article body) for one story.
pub fn read_article(db: &Db, link: &str) -> Result<Option<NewsArticleRecord>, String> {
    let conn = db.news().map_err(|e| format!("news conn: {e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT link, title, description, content, pub_date, source_name,
                    source_url, image_url, first_seen
             FROM news_articles WHERE link = ?1",
        )
        .map_err(|e| format!("news article prepare: {e}"))?;
    let mut rows = stmt
        .query(params![link])
        .map_err(|e| format!("news article query: {e}"))?;
    let Some(row) = rows.next().map_err(|e| format!("news article row: {e}"))? else {
        return Ok(None);
    };
    Ok(Some(NewsArticleRecord {
        link: row.get(0).map_err(|e| format!("news article link: {e}"))?,
        title: row.get(1).map_err(|e| format!("news article title: {e}"))?,
        description: row.get(2).map_err(|e| format!("news article description: {e}"))?,
        content: row.get(3).map_err(|e| format!("news article content: {e}"))?,
        pub_date: row.get(4).map_err(|e| format!("news article date: {e}"))?,
        source_name: row.get(5).map_err(|e| format!("news article source: {e}"))?,
        source_url: row.get(6).map_err(|e| format!("news article source url: {e}"))?,
        image_url: row.get(7).map_err(|e| format!("news article image: {e}"))?,
        first_seen: row.get(8).map_err(|e| format!("news article first seen: {e}"))?,
    }))
}

pub fn set_read(db: &Db, link: &str, read: bool) -> Result<(), String> {
    let conn = db.news().map_err(|e| format!("news conn: {e}"))?;
    if read {
        conn.execute(
            "INSERT INTO news_read(link, read_at) VALUES (?1, ?2)
             ON CONFLICT(link) DO UPDATE SET read_at = excluded.read_at",
            params![link, unix_now()],
        )
        .map_err(|e| format!("news read insert: {e}"))?;
        conn.execute(
            "DELETE FROM news_read WHERE link NOT IN (
                 SELECT link FROM news_read ORDER BY read_at DESC LIMIT ?1
             )",
            params![MAX_READ_LINKS],
        )
        .map_err(|e| format!("news read cap prune: {e}"))?;
    } else {
        conn.execute("DELETE FROM news_read WHERE link = ?1", params![link])
            .map_err(|e| format!("news read delete: {e}"))?;
    }
    Ok(())
}

pub fn mark_all_read(db: &Db, links: &[String]) -> Result<(), String> {
    let now = unix_now();
    let mut conn = db.news().map_err(|e| format!("news conn: {e}"))?;
    let tx = conn.transaction().map_err(|e| format!("news read-all tx: {e}"))?;
    for link in links {
        tx.execute(
            "INSERT INTO news_read(link, read_at) VALUES (?1, ?2)
             ON CONFLICT(link) DO NOTHING",
            params![link, now],
        )
        .map_err(|e| format!("news read-all insert: {e}"))?;
    }
    tx.execute(
        "DELETE FROM news_read WHERE link NOT IN (
             SELECT link FROM news_read ORDER BY read_at DESC LIMIT ?1
         )",
        params![MAX_READ_LINKS],
    )
    .map_err(|e| format!("news read-all cap prune: {e}"))?;
    tx.commit().map_err(|e| format!("news read-all commit: {e}"))
}

pub fn list_read(db: &Db) -> Result<Vec<String>, String> {
    let conn = db.news().map_err(|e| format!("news conn: {e}"))?;
    let mut stmt = conn
        .prepare("SELECT link FROM news_read ORDER BY read_at ASC")
        .map_err(|e| format!("news read list prepare: {e}"))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("news read list query: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("news read list row: {e}"))
}

/// Flip the bookmark for one article. Returns the new saved state so the
/// caller can update optimistically without a second round-trip.
pub fn toggle_saved(db: &Db, article: &NewsArticleInput) -> Result<bool, String> {
    let conn = db.news().map_err(|e| format!("news conn: {e}"))?;
    let exists: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM news_saved WHERE link = ?1",
            params![article.link],
            |row| row.get(0),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(format!("news saved lookup: {other}")),
        })?;

    if exists.is_some() {
        conn.execute(
            "DELETE FROM news_saved WHERE link = ?1",
            params![article.link],
        )
        .map_err(|e| format!("news saved delete: {e}"))?;
        return Ok(false);
    }

    conn.execute(
        "INSERT INTO news_saved
            (link, saved_at, title, description, source_name, source_url, pub_date, image_url)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(link) DO UPDATE SET saved_at = excluded.saved_at",
        params![
            article.link,
            unix_now(),
            article.title,
            article.description,
            article.source_name,
            article.source_url,
            article.pub_date,
            article.image_url,
        ],
    )
    .map_err(|e| format!("news saved insert: {e}"))?;
    Ok(true)
}

pub fn list_saved(db: &Db) -> Result<Vec<NewsSavedRecord>, String> {
    let conn = db.news().map_err(|e| format!("news conn: {e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT link, title, description, source_name, source_url, pub_date, image_url, saved_at
             FROM news_saved
             ORDER BY saved_at DESC",
        )
        .map_err(|e| format!("news saved list prepare: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(NewsSavedRecord {
                link: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                source_name: row.get(3)?,
                source_url: row.get(4)?,
                pub_date: row.get(5)?,
                image_url: row.get(6)?,
                saved_at: row.get(7)?,
            })
        })
        .map_err(|e| format!("news saved list query: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("news saved list row: {e}"))
}

pub fn add_history(db: &Db, article: &NewsArticleInput) -> Result<(), String> {
    let conn = db.news().map_err(|e| format!("news conn: {e}"))?;
    conn.execute(
        "INSERT INTO news_history
            (link, read_at, title, description, source_name, source_url, pub_date, image_url)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(link) DO UPDATE SET read_at = excluded.read_at",
        params![
            article.link,
            unix_now(),
            article.title,
            article.description,
            article.source_name,
            article.source_url,
            article.pub_date,
            article.image_url,
        ],
    )
    .map_err(|e| format!("news history insert: {e}"))?;
    conn.execute(
        "DELETE FROM news_history WHERE link NOT IN (
             SELECT link FROM news_history ORDER BY read_at DESC LIMIT ?1
         )",
        params![MAX_HISTORY],
    )
    .map_err(|e| format!("news history cap prune: {e}"))?;
    Ok(())
}

pub fn list_history(db: &Db) -> Result<Vec<NewsHistoryRecord>, String> {
    let conn = db.news().map_err(|e| format!("news conn: {e}"))?;
    let mut stmt = conn
        .prepare(
            "SELECT link, title, description, source_name, source_url, pub_date, image_url, read_at
             FROM news_history
             ORDER BY read_at DESC",
        )
        .map_err(|e| format!("news history list prepare: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(NewsHistoryRecord {
                link: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                source_name: row.get(3)?,
                source_url: row.get(4)?,
                pub_date: row.get(5)?,
                image_url: row.get(6)?,
                read_at: row.get(7)?,
            })
        })
        .map_err(|e| format!("news history list query: {e}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("news history list row: {e}"))
}

pub fn clear_history(db: &Db) -> Result<(), String> {
    let conn = db.news().map_err(|e| format!("news conn: {e}"))?;
    conn.execute("DELETE FROM news_history", [])
        .map_err(|e| format!("news history clear: {e}"))?;
    Ok(())
}

pub fn remove_history(db: &Db, link: &str) -> Result<(), String> {
    let conn = db.news().map_err(|e| format!("news conn: {e}"))?;
    conn.execute("DELETE FROM news_history WHERE link = ?1", params![link])
        .map_err(|e| format!("news history remove: {e}"))?;
    Ok(())
}

pub fn set_pref(db: &Db, key: &str, value: &str) -> Result<(), String> {
    let conn = db.news().map_err(|e| format!("news conn: {e}"))?;
    conn.execute(
        "INSERT INTO news_prefs(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|e| format!("news pref upsert: {e}"))?;
    Ok(())
}

pub fn list_prefs(db: &Db) -> Result<HashMap<String, String>, String> {
    let conn = db.news().map_err(|e| format!("news conn: {e}"))?;
    let mut stmt = conn
        .prepare("SELECT key, value FROM news_prefs")
        .map_err(|e| format!("news prefs prepare: {e}"))?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| format!("news prefs query: {e}"))?;
    let mut prefs = HashMap::new();
    for row in rows {
        let (key, value) = row.map_err(|e| format!("news prefs row: {e}"))?;
        prefs.insert(key, value);
    }
    Ok(prefs)
}

/// Drop every cached story but keep feeds, saved items and reading state.
pub fn clear_articles(db: &Db) -> Result<(), String> {
    let conn = db.news().map_err(|e| format!("news conn: {e}"))?;
    conn.execute("DELETE FROM news_articles", [])
        .map_err(|e| format!("news articles clear: {e}"))?;
    Ok(())
}

fn default_category() -> String {
    "general".to_string()
}

fn default_enabled() -> bool {
    true
}

/// Trim on a character boundary (byte slicing would panic on multi-byte text).
fn clip(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        value.to_string()
    } else {
        value.chars().take(max_chars).collect()
    }
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn article(link: &str, title: &str) -> NewsArticleInput {
        NewsArticleInput {
            link: link.to_string(),
            title: title.to_string(),
            description: "A short summary".to_string(),
            content: "<p>Full body</p>".to_string(),
            pub_date: "2026-10-24T10:00:00Z".to_string(),
            source_name: "PC Gamer".to_string(),
            source_url: "https://www.pcgamer.com/rss/".to_string(),
            image_url: Some("https://example.com/a.jpg".to_string()),
        }
    }

    fn payload(article: NewsArticleInput) -> FeedPayload {
        FeedPayload {
            source_url: article.source_url.clone(),
            source_name: article.source_name.clone(),
            articles: vec![article],
        }
    }

    #[test]
    fn ingest_keeps_first_seen_and_dedupes_links() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        super::super::migrate::run_migrations(&db).unwrap();

        let first = ingest(&db, &[payload(article("https://a.test/1", "Half-Life 3"))]).unwrap();
        assert_eq!(first.len(), 1);
        let seen = first[0].first_seen;
        // List rows omit the body; the reader asks for it separately.
        assert!(first[0].content.is_empty());
        assert!(read_article(&db, "https://a.test/1")
            .unwrap()
            .is_some_and(|row| !row.content.is_empty()));

        // A later fetch updates the payload but keeps the original arrival time.
        let mut edit = article("https://a.test/1", "Half-Life 3 confirmed");
        edit.description = "Updated".to_string();
        let second = ingest(&db, &[payload(edit)]).unwrap();
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].title, "Half-Life 3 confirmed");
        assert_eq!(second[0].first_seen, seen);
    }

    #[test]
    fn read_saved_and_history_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        super::super::migrate::run_migrations(&db).unwrap();

        let input = article("https://a.test/2", "Silksong dated");
        ingest(&db, &[payload(input.clone())]).unwrap();

        set_read(&db, &input.link, true).unwrap();
        assert_eq!(list_read(&db).unwrap(), vec![input.link.clone()]);
        set_read(&db, &input.link, false).unwrap();
        assert!(list_read(&db).unwrap().is_empty());

        assert!(toggle_saved(&db, &input).unwrap());
        assert_eq!(list_saved(&db).unwrap().len(), 1);
        assert!(!toggle_saved(&db, &input).unwrap());
        assert!(list_saved(&db).unwrap().is_empty());

        add_history(&db, &input).unwrap();
        assert_eq!(list_history(&db).unwrap()[0].link, input.link);
        remove_history(&db, &input.link).unwrap();
        assert!(list_history(&db).unwrap().is_empty());
    }

    #[test]
    fn replace_feeds_is_a_whole_list_write() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        super::super::migrate::run_migrations(&db).unwrap();

        let feed = NewsFeedRecord {
            url: "https://feeds.test/rss".to_string(),
            name: "Test Feed".to_string(),
            category: "tech".to_string(),
            region: None,
            is_default: false,
            enabled: true,
        };
        replace_feeds(&db, &[feed]).unwrap();
        let listed = list_feeds(&db).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "Test Feed");

        replace_feeds(&db, &[]).unwrap();
        assert!(list_feeds(&db).unwrap().is_empty());
    }

    #[test]
    fn prefs_bag_upserts() {
        let dir = tempfile::tempdir().unwrap();
        let db = Db::open(dir.path()).unwrap();
        super::super::migrate::run_migrations(&db).unwrap();

        set_pref(&db, "lastVisit", "100").unwrap();
        set_pref(&db, "lastVisit", "200").unwrap();
        assert_eq!(list_prefs(&db).unwrap().get("lastVisit").unwrap(), "200");
    }
}
