use serde::{Deserialize, Serialize};

use super::igdb::{IgdbCover, IgdbName, IgdbWebsite};

// ─── Data Types ───────────────────────────────────────────────────────────────

/// Represents a collection of game images (URLs) from a metadata source.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GameImages {
    /// Small square icon (e.g., 32x32 or similar)
    pub icon: Option<String>,
    /// Vertical cover art / box art (e.g., 600x900)
    pub cover: Option<String>,
    /// Hero image / header (e.g., 460x215)
    pub hero: Option<String>,
    /// Wide banner (e.g., 1920x620)
    pub banner: Option<String>,
    /// Game logo / title image (transparent PNG)
    pub logo: Option<String>,
}

/// A unified metadata result from a single source.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GameMetadataResult {
    /// Display title of the game
    pub title: String,
    /// Short description or summary
    pub description: Option<String>,
    /// Developer name(s)
    pub developer: Option<String>,
    /// Publisher name(s)
    pub publisher: Option<String>,
    /// Human-readable release date (e.g., "Oct 20, 2020")
    pub release_date: Option<String>,
    /// Genre tags
    pub genres: Vec<String>,
    /// Image URLs discovered for this game
    pub images: GameImages,
    /// URL of the source page
    pub source_url: String,
    /// Human-readable source name (e.g., "Steam", "IGDB")
    pub source_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storyline: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub igdb_rating: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub critic_rating: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub themes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_modes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub player_perspectives: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screenshots: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub videos: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub websites: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_to_beat: Option<TimeToBeat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub similar_games: Option<Vec<SimilarGame>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub releases: Option<Vec<ReleaseDateInfo>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub igdb_reviews: Option<Vec<IgdbReview>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alternative_names: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collection: Option<String>,
    /// IGDB collection ID for the first collection this game belongs
    /// to. Used by the frontend Game Relations card to fetch
    /// "other games in this collection" via the dedicated
    /// `get_collection_games` Tauri command.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collection_id: Option<u64>,
    /// Numeric IGDB game id (`IgdbGame.id`). Persisted by the frontend
    /// as a stable identity key so deleted games can still be
    /// identified (e.g. in the Activity page). `None` for sources that
    /// cannot provide an IGDB id (Steam, LaunchBox).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub igdb_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub franchise: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub game_category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub language_supports: Option<Vec<LanguageSupportInfo>>,
    /// VR flag detected from the source metadata: a Steam category/tag
    /// that mentions VR, an IGDB platform that is a headset/runtime, or a
    /// standalone "VR" token in the title. `None` when the source can't
    /// tell — the frontend then falls back to its own heuristic.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_vr: Option<bool>,
}

/// Time-to-beat data now comes from HowLongToBeat (see `crate::hltb`).
/// Re-exported here so existing `game_scraper::TimeToBeat` imports keep
/// working.
pub use crate::hltb::TimeToBeat;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SimilarGame {
    pub id: u64,
    pub name: String,
    pub cover_url: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseDateInfo {
    pub platform: String,
    pub date_str: String,
    pub region: String,
}

/// A single Steam reaction (👍 / ❤️ / 😂 / …) with its count. Mirrors the
/// `SteamReaction` shape consumed by the frontend (`reactionType` + `count`).
#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SteamReaction {
    pub reaction_type: u32,
    pub count: u32,
}

/// Normalized reviewer hardware ("computer configuration"). Every field is
/// optional because Steam's `hardware` block is sparse and varies across
/// review vintages. Serialized as an object the frontend renders directly.
#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SteamHardware {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub os: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gpu_name: Option<String>,
    /// System RAM in megabytes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_ram_mb: Option<u64>,
    /// Video RAM in megabytes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vram_size_mb: Option<u64>,
}

impl SteamHardware {
    pub(crate) fn is_empty(&self) -> bool {
        self.os.is_none()
            && self.cpu_name.is_none()
            && self.gpu_name.is_none()
            && self.system_ram_mb.is_none()
            && self.vram_size_mb.is_none()
    }
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IgdbReview {
    pub title: Option<String>,
    pub content: Option<String>,
    pub rating: Option<f64>,
    pub username: Option<String>,
    /// ISO 639-1 language code (e.g. "english", "french") from Steam API.
    /// None for IGDB-sourced reviews (endpoint no longer available).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    /// Number of users who found this review helpful (Steam API).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub votes_up: Option<u32>,
    /// Number of users who found this review funny (Steam API).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub votes_funny: Option<u32>,
    /// Unix timestamp when this review was created (Steam API).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp_created: Option<u64>,

    // ── Author context (Steam) ──────────────────────────────────
    /// Reviewer's SteamID64 — used to deep-link to the review / profile.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_steam_id: Option<String>,
    /// Reviewer's total playtime (minutes) across all games.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_playtime_forever: Option<u64>,
    /// Reviewer's playtime (minutes) in THIS game at review time.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_playtime_at_review: Option<u64>,
    /// Reviewer's Steam Deck playtime (minutes) at review time.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_deck_playtime_at_review: Option<u64>,

    // ── Reviewer badges / context flags (Steam) ─────────────────
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primarily_steam_deck: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub received_for_free: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub written_during_early_access: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steam_purchase: Option<bool>,

    // ── Engagement (Steam) ───────────────────────────────────────
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comment_count: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reactions: Option<Vec<SteamReaction>>,
    /// Steam's recommendation confidence percentage (0-100), derived
    /// from `weighted_vote_score`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weight_vote_up_percentage: Option<f64>,

    // ── Reviewer hardware (Steam "computer configuration") ───────
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hw: Option<SteamHardware>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LanguageSupportInfo {
    pub language: String,
    pub support_type: String,
}

// ─── System Requirements (Steam `pc_requirements`) ──────────────────────────

/// Structured system requirements, parsed from Steam's variable
/// HTML `pc_requirements.minimum` / `pc_requirements.recommended`
/// payload. Steam's markup is wildly inconsistent across titles
/// (some use `<ul><li><strong>OS:</strong> Windows…</li>`, others
/// use plain text with `<br>` separators), so we extract a
/// canonical field set instead of round-tripping the raw HTML.
///
/// Every field is `Option<String>` — Steam frequently omits one
/// or more sections (e.g. Mac-only games have no Windows spec,
/// older indie titles skip VR Support, etc.). The frontend
/// silently drops empty rows so the card never has meaningless
/// `—` entries.
///
/// The known label set covers the entire Steam taxonomy:
///   - os                Windows / macOS / SteamOS + Linux
///   - processor         CPU requirement
///   - memory            RAM requirement
///   - graphics          GPU requirement
///   - directX           DirectX version
///   - network           online play requirement
///   - storage           disk footprint requirement
///   - soundCard         sound card / audio requirement
///   - vrSupport         VR headset + controller requirement
///   - additionalNotes   "Requires X controller", "64-bit only",
///                       "SSD recommended", etc.
#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RequirementsSpec {
    pub os: Option<String>,
    pub processor: Option<String>,
    pub memory: Option<String>,
    pub graphics: Option<String>,
    pub direct_x: Option<String>,
    pub network: Option<String>,
    pub storage: Option<String>,
    pub sound_card: Option<String>,
    pub vr_support: Option<String>,
    pub additional_notes: Option<String>,
}

impl RequirementsSpec {
    /// True when *no* field carries a value. The frontend uses
    /// this to decide whether to render the section at all (vs.
    /// hiding silently when Steam returned garbage).
    pub fn is_empty(&self) -> bool {
        self.os.is_none()
            && self.processor.is_none()
            && self.memory.is_none()
            && self.graphics.is_none()
            && self.direct_x.is_none()
            && self.network.is_none()
            && self.storage.is_none()
            && self.sound_card.is_none()
            && self.vr_support.is_none()
            && self.additional_notes.is_none()
    }
}

/// Combined system-requirements payload returned by the
/// `get_recommended_config` Tauri command. Mirrors the
/// `RichAboutPayload` shape so the frontend has a single
/// familiar contract to consume (source attribution + raw HTML
/// fallback + structured fields).
///
/// `minimum` and `recommended` are both `Option<…>` because Steam
/// occasionally omits the `recommended` block entirely (e.g.
/// older indie titles); when missing, the frontend falls back to
/// showing only the `minimum` column rather than rendering an
/// empty right-hand side.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PcRequirementsPayload {
    /// `"steam" | "none"`. We don't ship an IGDB fallback for
    /// system requirements — IGDB doesn't expose them at all,
    /// and Steam's coverage is essentially universal (every PC
    /// title on the store has `pc_requirements`). `none` means
    /// the section should hide entirely.
    pub source: String,
    /// Deep-link to the Steam app page so the "View on Steam"
    /// footer link in the card has a stable target.
    pub source_url: Option<String>,
    /// Human-readable source name ("Steam").
    pub source_name: Option<String>,
    /// Parsed minimum spec (the lower bar to launch the game).
    pub minimum: Option<RequirementsSpec>,
    /// Parsed recommended spec (the bar for a smooth experience).
    /// `None` when Steam didn't ship one — see the type-level
    /// doc comment for the fallback strategy.
    pub recommended: Option<RequirementsSpec>,
    /// Raw Steam `pc_requirements.minimum` HTML, preserved as a
    /// last-resort fallback for any spec the parser missed
    /// (unrecognised label → freeform paragraph). Frontend
    /// renders this through the same HTML sanitiser the
    /// AboutSection uses when `additional_notes` is empty after
    /// parsing.
    pub minimum_html: Option<String>,
    /// Raw Steam `pc_requirements.recommended` HTML fallback.
    pub recommended_html: Option<String>,
    /// Unix-seconds timestamp of the last successful fetch.
    /// Mirrors `RichAboutPayload.fetchedAt` for consistency.
    pub fetched_at: u64,
}

// ─── Steam Store Features Types (responsive_apppage_details_left) ───────────

/// Single feature / category item extracted from Steam store page specs block
/// (e.g. Single-player, Steam Achievements, Workshop, Cloud, Family Sharing).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SteamFeatureItem {
    pub id: Option<u32>,
    pub name: String,
    pub icon_url: Option<String>,
    pub search_url: Option<String>,
}

/// Controller support summary extracted from Steam store page.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SteamControllerSupport {
    pub full_support: bool,
    pub partial_support: bool,
    pub gamepad_preferred: bool,
    pub xbox: bool,
    pub ps4: bool,
    pub ps5: bool,
}

/// Notice item (DRM, anti-cheat, 3rd party account, EULA) in the details block.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SteamNoticeItem {
    pub text: String,
    pub link_url: Option<String>,
    pub link_text: Option<String>,
    pub is_anticheat: bool,
}

/// Payload returned by `get_steam_page_features`.
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SteamStoreFeaturesPayload {
    pub app_id: u32,
    pub features: Vec<SteamFeatureItem>,
    pub controller_support: Option<SteamControllerSupport>,
    pub notices: Vec<SteamNoticeItem>,
    pub fetched_at: u64,
}

// ─── Store Types (IGDB catalog browsing) ─────────────────────────────────────

/// Lightweight game summary for store listings (cards, grids).

/// Lightweight game summary for store listings (cards, grids).
/// Contains only what's needed for display — no full metadata.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StoreGameSummary {
    pub id: u64,
    pub name: String,
    pub slug: String,
    pub summary: Option<String>,
    pub rating: Option<f64>,
    pub aggregated_rating: Option<f64>,
    pub cover_url: Option<String>,
    /// Game logo URL from IGDB (transparent PNG, e.g. t_logo_med).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logo_url: Option<String>,
    pub genres: Vec<String>,
    pub platforms: Vec<String>,
    pub first_release_date: Option<String>,
    pub total_rating_count: u64,
    pub hypes: u64,
    /// Number of IGDB users following the game. Drives the "Most Followed"
    /// sort; defaults to `0` when IGDB has not reported a count.
    #[serde(default)]
    pub follows: u64,
    /// External URLs associated with the title on IGDB (Steam store page,
    /// Epic, official site, etc.). Populated for the store hero so it
    /// can render the live Steam concurrent-player badge on rotating
    /// IGDB listings without an extra round-trip per slide change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub websites: Option<Vec<String>>,
}

/// Internal IGDB deserialization type for store game listings.
#[derive(Debug, Deserialize)]
pub(crate) struct IgdbGameSummary {
    pub(crate) id: u64,
    pub(crate) name: String,
    pub(crate) slug: String,
    pub(crate) summary: Option<String>,
    pub(crate) rating: Option<f64>,
    pub(crate) aggregated_rating: Option<f64>,
    pub(crate) cover: Option<IgdbCover>,
    pub(crate) artworks: Option<Vec<IgdbCover>>,
    pub(crate) genres: Option<Vec<IgdbName>>,
    pub(crate) platforms: Option<Vec<IgdbName>>,
    pub(crate) first_release_date: Option<i64>,
    pub(crate) total_rating_count: Option<u64>,
    pub(crate) hypes: Option<u64>,
    #[serde(default)]
    pub(crate) follows: Option<u64>,
    /// IGDB `game_type` category (0 = main game, 1 = DLC, 5 = mod, …). Used
    /// by the search re-ranker to push add-on content below real titles.
    #[serde(default)]
    pub(crate) game_type: Option<u32>,
    /// `websites.url` field shipped from the IGDB Apicalypse body.
    /// We only care about the URL string (the `category` enum is
    /// discarded — Steam fronts are the only category we act on,
    /// and we identify them by URL pattern, not enum value).
    #[serde(default)]
    pub(crate) websites: Option<Vec<IgdbWebsite>>,
}
