//! News store commands.
//!
//! Thin wrappers over [`crate::db::news`]. Fetching and XML parsing happen in
//! the frontend (`fetch_url` bypasses CORS, `parseRSS` runs on `DOMParser`);
//! the backend is the durable half: feeds, merged articles, read/saved state,
//! reading history and reader preferences that every surface shares.

use tauri::Manager;

use crate::db;
use crate::db::news::{self, FeedPayload, NewsArticleInput, NewsArticleRecord, NewsFeedRecord, NewsSnapshot};

fn db_state(app: &tauri::AppHandle) -> tauri::State<'_, db::Db> {
    app.state::<db::Db>()
}

/// Everything a news surface needs on mount, in one round-trip.
#[tauri::command]
pub fn news_snapshot(app: tauri::AppHandle) -> Result<NewsSnapshot, String> {
    news::snapshot(db_state(&app).inner())
}

/// Replace the stored feed list after any add / remove / mute.
#[tauri::command]
pub fn news_replace_feeds(app: tauri::AppHandle, feeds: Vec<NewsFeedRecord>) -> Result<(), String> {
    news::replace_feeds(db_state(&app).inner(), &feeds)
}

/// Merge freshly parsed payloads into the store; returns the merged articles.
#[tauri::command]
pub fn news_ingest(
    app: tauri::AppHandle,
    payloads: Vec<FeedPayload>,
) -> Result<Vec<NewsArticleRecord>, String> {
    news::ingest(db_state(&app).inner(), &payloads)
}

/// Full article body for the reader (list rows omit it).
#[tauri::command]
pub fn news_article(
    app: tauri::AppHandle,
    link: String,
) -> Result<Option<NewsArticleRecord>, String> {
    news::read_article(db_state(&app).inner(), &link)
}

/// Mark one article read or unread.
#[tauri::command]
pub fn news_set_read(app: tauri::AppHandle, link: String, read: bool) -> Result<(), String> {
    news::set_read(db_state(&app).inner(), &link, read)
}

/// Mark a batch of articles read.
#[tauri::command]
pub fn news_mark_all_read(app: tauri::AppHandle, links: Vec<String>) -> Result<(), String> {
    news::mark_all_read(db_state(&app).inner(), &links)
}

/// Flip an article's bookmark; returns the new saved state.
#[tauri::command]
pub fn news_toggle_saved(
    app: tauri::AppHandle,
    article: NewsArticleInput,
) -> Result<bool, String> {
    news::toggle_saved(db_state(&app).inner(), &article)
}

#[tauri::command]
pub fn news_add_history(app: tauri::AppHandle, article: NewsArticleInput) -> Result<(), String> {
    news::add_history(db_state(&app).inner(), &article)
}

#[tauri::command]
pub fn news_clear_history(app: tauri::AppHandle) -> Result<(), String> {
    news::clear_history(db_state(&app).inner())
}

#[tauri::command]
pub fn news_remove_history(app: tauri::AppHandle, link: String) -> Result<(), String> {
    news::remove_history(db_state(&app).inner(), &link)
}

/// Persist one reader preference (last visit, followed topics, view mode…).
#[tauri::command]
pub fn news_set_pref(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    news::set_pref(db_state(&app).inner(), &key, &value)
}

/// Drop cached stories but keep feeds, bookmarks and reading state.
#[tauri::command]
pub fn news_clear_articles(app: tauri::AppHandle) -> Result<(), String> {
    news::clear_articles(db_state(&app).inner())
}
