//! Game metadata scraping and store-catalog integration.
//!
//! Aggregates metadata from Steam, IGDB, LaunchBox, Metacritic, OpenCritic and
//! RAWG, plus the IGDB-backed store browser, search re-ranking and the relation
//! graph. Public items are re-exported here so `crate::game_scraper::Foo` keeps
//! resolving across the app.

mod igdb;
mod launchbox;
mod metadata;
mod relations;
mod reviews;
mod steam_about;
mod steam_store;
mod store_search;
mod text_util;
mod title_match;
mod types;

pub use self::igdb::*;
pub use self::launchbox::*;
pub use self::metadata::*;
pub use self::relations::*;
pub use self::reviews::*;
pub use self::steam_about::*;
pub use self::steam_store::*;
pub use self::store_search::*;
pub use self::title_match::*;
pub use self::types::*;
