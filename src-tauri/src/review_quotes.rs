//! Review bookmarks & quotes.
//!
//! The Reviews tab lets a reader keep a whole review (a bookmark) or just
//! the sentence they highlighted (an excerpt). Both are small, user-authored
//! records, so they live as bounded JSON in the `kv` domain rather than a
//! dedicated table: they travel in app backups, survive webview storage
//! clearing, and never need a join.
//!
//! The store is capped at [`MAX_QUOTES`]; the oldest entries fall off first
//! so the blob can never grow without bound.

use tauri::Manager;

use crate::db;
use crate::db::kv;

const STORAGE_KEY: &str = "reviews.quotes.v1";
const MAX_QUOTES: usize = 500;
const MAX_EXCERPT_CHARS: usize = 4_000;

/// One saved review or excerpt. `kind` is `"review"` for a whole-review
/// bookmark and `"excerpt"` for a highlighted quote.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewQuote {
    #[serde(default)]
    pub id: String,
    pub game_id: String,
    #[serde(default)]
    pub game_name: String,
    #[serde(default)]
    pub kind: String,
    /// Stable identity of the source review (`source:author:timestamp`), so
    /// bookmarking the same review twice updates rather than duplicates.
    #[serde(default)]
    pub review_key: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub source_label: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub excerpt: String,
    #[serde(default)]
    pub rating: Option<f64>,
    #[serde(default)]
    pub review_url: Option<String>,
    #[serde(default)]
    pub created_at: u64,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn read_all(db: &db::Db) -> Result<Vec<ReviewQuote>, String> {
    let Some(raw) = kv::get(db, STORAGE_KEY).map_err(|e| format!("quotes read: {e}"))? else {
        return Ok(Vec::new());
    };
    Ok(serde_json::from_str::<Vec<ReviewQuote>>(&raw).unwrap_or_default())
}

fn write_all(db: &db::Db, quotes: &[ReviewQuote]) -> Result<(), String> {
    let serialized =
        serde_json::to_string(quotes).map_err(|e| format!("quotes encode: {e}"))?;
    kv::set(db, STORAGE_KEY, &serialized).map_err(|e| format!("quotes write: {e}"))
}

/// Normalize a posted quote: generate an id, stamp `createdAt`, trim text,
/// clamp the excerpt and default an unknown kind to a bookmark.
fn normalize(mut quote: ReviewQuote) -> ReviewQuote {
    let now = now_ms();
    if quote.id.trim().is_empty() {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        quote.id = format!("quote-{now}-{nanos:x}");
    }
    if quote.created_at == 0 {
        quote.created_at = now;
    }
    quote.kind = match quote.kind.as_str() {
        "excerpt" => "excerpt".to_string(),
        _ => "review".to_string(),
    };
    quote.game_id = quote.game_id.trim().to_string();
    quote.game_name = quote.game_name.trim().to_string();
    quote.review_key = quote.review_key.trim().to_string();
    quote.source = quote.source.trim().to_string();
    quote.source_label = quote.source_label.trim().to_string();
    quote.author = quote.author.trim().to_string();
    quote.title = quote.title.trim().to_string();
    quote.excerpt = quote.excerpt.trim().chars().take(MAX_EXCERPT_CHARS).collect();
    quote.review_url = quote
        .review_url
        .map(|url| url.trim().to_string())
        .filter(|url| !url.is_empty());
    quote
}

/// Merge a saved quote into the store: replace by id, or (for a whole-review
/// bookmark) by review key, then keep the newest [`MAX_QUOTES`] records.
fn apply_save(mut quotes: Vec<ReviewQuote>, quote: ReviewQuote) -> Vec<ReviewQuote> {
    let is_bookmark = quote.kind == "review";
    quotes.retain(|existing| {
        if existing.id == quote.id {
            return false;
        }
        if is_bookmark
            && !quote.review_key.is_empty()
            && existing.review_key == quote.review_key
            && existing.game_id == quote.game_id
        {
            return false;
        }
        true
    });
    quotes.insert(0, quote);
    quotes.truncate(MAX_QUOTES);
    quotes
}

fn apply_delete(quotes: Vec<ReviewQuote>, id: &str) -> (Vec<ReviewQuote>, u64) {
    let before = quotes.len();
    let kept: Vec<ReviewQuote> = quotes.into_iter().filter(|q| q.id != id).collect();
    let removed = before.saturating_sub(kept.len()) as u64;
    (kept, removed)
}

/// List saved quotes, newest first. Passing a game id scopes the result to
/// that game; the Reviews tab passes its own game, while a future library-wide
/// surface can ask for everything.
#[tauri::command]
pub fn review_quote_list(
    app: tauri::AppHandle,
    game_id: Option<String>,
) -> Result<Vec<ReviewQuote>, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let mut quotes = read_all(db_state.inner())?;
    if let Some(game_id) = game_id.filter(|id| !id.trim().is_empty()) {
        quotes.retain(|q| q.game_id == game_id);
    }
    quotes.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(quotes)
}

/// Save a bookmark or excerpt and return the normalized record.
#[tauri::command]
pub fn review_quote_save(
    app: tauri::AppHandle,
    quote: ReviewQuote,
) -> Result<ReviewQuote, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let db = db_state.inner();
    let quote = normalize(quote);
    if quote.game_id.is_empty() {
        return Err("review quote needs a game id".to_string());
    }
    if quote.excerpt.is_empty() {
        return Err("review quote needs an excerpt".to_string());
    }
    let quotes = apply_save(read_all(db)?, quote.clone());
    write_all(db, &quotes)?;
    Ok(quote)
}

/// Delete one saved quote. Idempotent: returns the number of rows removed.
#[tauri::command]
pub fn review_quote_delete(app: tauri::AppHandle, id: String) -> Result<u64, String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    let db = db_state.inner();
    let (quotes, removed) = apply_delete(read_all(db)?, &id);
    if removed > 0 {
        write_all(db, &quotes)?;
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quote(kind: &str, key: &str, excerpt: &str) -> ReviewQuote {
        ReviewQuote {
            id: String::new(),
            game_id: "game-a".to_string(),
            game_name: "Game A".to_string(),
            kind: kind.to_string(),
            review_key: key.to_string(),
            source: "steam".to_string(),
            source_label: "Steam".to_string(),
            author: "Player".to_string(),
            title: "A review".to_string(),
            excerpt: excerpt.to_string(),
            rating: Some(88.0),
            review_url: None,
            created_at: 0,
        }
    }

    #[test]
    fn save_normalizes_and_dedupes_bookmarks() {
        let first = normalize(quote("review", "steam:player:1", "  Great game  "));
        assert!(!first.id.is_empty());
        assert_eq!(first.excerpt, "Great game");
        assert!(first.created_at > 0);

        let saved = apply_save(Vec::new(), first.clone());
        assert_eq!(saved.len(), 1);

        let mut second = quote("review", "steam:player:1", "Updated quote");
        second.created_at = first.created_at + 1;
        let saved = apply_save(saved, normalize(second));
        assert_eq!(saved.len(), 1, "same review key replaces the bookmark");
        assert_eq!(saved[0].excerpt, "Updated quote");
    }

    #[test]
    fn excerpts_are_independent_and_delete_is_idempotent() {
        let one = normalize(quote("excerpt", "steam:player:1", "First quote"));
        let two = normalize(quote("excerpt", "steam:player:1", "Second quote"));
        let saved = apply_save(apply_save(Vec::new(), one.clone()), two.clone());
        assert_eq!(saved.len(), 2, "two excerpts from one review both persist");

        let (kept, removed) = apply_delete(saved, &one.id);
        assert_eq!(removed, 1);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].id, two.id);

        let (kept, removed) = apply_delete(kept, "missing");
        assert_eq!(removed, 0);
        assert_eq!(kept.len(), 1);
    }

    #[test]
    fn store_is_bounded() {
        let mut quotes = Vec::new();
        for index in 0..(MAX_QUOTES + 12) {
            let mut item = quote("excerpt", "key", "x");
            item.id = format!("q-{index}");
            item.created_at = index as u64;
            quotes = apply_save(quotes, item);
        }
        assert_eq!(quotes.len(), MAX_QUOTES);
        assert_eq!(quotes[0].id, format!("q-{}", MAX_QUOTES + 11));
    }
}
