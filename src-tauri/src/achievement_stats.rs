//! Derived, cross-game achievement views.
//!
//! The frontend no longer materialises the whole achievements cache (one
//! `GameAchievementData` per game, each carrying its full `Achievement[]`
//! array). Instead the backend computes a small [`AchievementOverview`] —
//! per-game summaries plus the bounded cross-game lists the UI actually
//! renders (recent unlocks, rarest showcase, perfect / near-completion,
//! monthly activity). Reading and parsing the payloads happens here, in
//! Rust, and never lands in the webview heap.
//!
//! The scoring rules mirror the frontend helpers one-for-one:
//! `getAchievementRarity` / `getAchievementPoints` in
//! `src/components/achievements/achievementUtils.ts` and
//! `getMonthlyUnlockActivity` in the same file. Keep them in sync.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tauri::{AppHandle, Manager};

use crate::achievements::Achievement;
use crate::db;

/// Number of unlocked entries shipped for the recent-unlocks feed. The
/// achievements page slices to 16; the home widget and friends feed use
/// their own (smaller) windows.
const RECENT_LIMIT: usize = 50;
/// Number of entries in the rarest-achievements showcase.
const RAREST_LIMIT: usize = 10;
/// Number of games in the near-completion list.
const NEAR_COMPLETION_LIMIT: usize = 8;
/// Monthly-activity window, in months.
const MONTHS: i32 = 6;

/// Per-rarity counts. Field names are deliberately snake_case (not
/// camelCased) because the frontend keys its `Record<AchievementRarity>`
/// maps by the literal `ultra_rare` tier string.
#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq, Eq)]
pub struct RarityCounts {
    pub common: u32,
    pub uncommon: u32,
    pub rare: u32,
    pub ultra_rare: u32,
}

impl RarityCounts {
    fn add(&mut self, tier: Rarity) {
        match tier {
            Rarity::Common => self.common += 1,
            Rarity::Uncommon => self.uncommon += 1,
            Rarity::Rare => self.rare += 1,
            Rarity::UltraRare => self.ultra_rare += 1,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Rarity {
    Common,
    Uncommon,
    Rare,
    UltraRare,
}

/// Rarity tier from a global unlock percentage — mirrors
/// `getAchievementRarity` in `types/game.ts`.
fn rarity_of(percent: f64) -> Rarity {
    if percent >= 50.0 {
        Rarity::Common
    } else if percent >= 20.0 {
        Rarity::Uncommon
    } else if percent >= 5.0 {
        Rarity::Rare
    } else {
        Rarity::UltraRare
    }
}

/// Gamerscore weight for a rarity tier — mirrors `RARITY_POINTS`.
fn achievement_points(percent: f64) -> u32 {
    match rarity_of(percent) {
        Rarity::Common => 10,
        Rarity::Uncommon => 25,
        Rarity::Rare => 50,
        Rarity::UltraRare => 100,
    }
}

/// Compact per-game summary — every count-only UI surface reads from here
/// instead of the full `GameAchievementData`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AchievementSummary {
    pub steam_app_id: u32,
    pub total: u32,
    pub unlocked: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_synced: Option<u64>,
    pub source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    pub points_earned: u32,
    pub points_total: u32,
    /// Per-rarity counts of *achieved* achievements (the achievements page
    /// per-game rarity chips).
    pub rarity: RarityCounts,
    /// Newest unlock timestamp for this game (seconds), 0 when none.
    pub last_unlock_time: u64,
}

/// Unlocked-achievement counts per provider source.
#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct SourceCounts {
    pub steam: u32,
    pub retro: u32,
    pub manual: u32,
    pub gog: u32,
    pub epic: u32,
}

impl SourceCounts {
    fn add(&mut self, source: &str) {
        match source {
            "retro" => self.retro += 1,
            "manual" => self.manual += 1,
            "gog" => self.gog += 1,
            "epic" => self.epic += 1,
            // Legacy / unknown payloads default to Steam, matching
            // `sourceOfPayload` on the frontend.
            _ => self.steam += 1,
        }
    }
}

/// Library-wide aggregates.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    pub total: u32,
    pub unlocked: u32,
    pub overall_pct: u32,
    pub perfect_games: u32,
    pub games_with_data: u32,
    pub avg_completion: u32,
    pub gamerscore_earned: u32,
    pub gamerscore_total: u32,
    pub by_source: SourceCounts,
    pub rarity_total: RarityCounts,
    pub rarity_unlocked: RarityCounts,
}

/// One month of unlock activity.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyPoint {
    pub month_key: String,
    pub count: u32,
    pub points: u32,
}

/// An unlocked achievement plus the game it belongs to.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnlockRecord {
    pub game_id: String,
    pub achievement: Achievement,
}

/// A game in the perfect / near-completion lists.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionEntry {
    pub game_id: String,
    pub total: u32,
    pub unlocked: u32,
    pub percentage: u32,
    pub last_unlock_time: u64,
}

/// Everything the frontend needs to render achievements without holding
/// the full per-game arrays.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AchievementOverview {
    pub summaries: BTreeMap<String, AchievementSummary>,
    pub stats: LibraryStats,
    pub monthly: Vec<MonthlyPoint>,
    pub recent_unlocks: Vec<UnlockRecord>,
    pub rarest_unlocks: Vec<UnlockRecord>,
    pub perfect_games: Vec<CompletionEntry>,
    pub near_completion: Vec<CompletionEntry>,
}

/// Permissive view of a stored payload — only the achievement array is
/// read (counts and points are recomputed from it so stale stored totals
/// can never disagree with the array).
#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RawPayload {
    #[serde(default)]
    achievements: Vec<Achievement>,
}

/// Bucket keys (`YYYY-MM`) for the trailing `months` months, oldest first.
fn month_buckets(months: i32) -> Vec<String> {
    use chrono::{Datelike, Local};
    let now = Local::now();
    let mut out = Vec::with_capacity(months.max(0) as usize);
    for i in (0..months).rev() {
        let total = now.year() * 12 + now.month0() as i32 - i;
        let year = total.div_euclid(12);
        let month = total.rem_euclid(12) + 1;
        out.push(format!("{year:04}-{month:02}"));
    }
    out
}

/// `YYYY-MM` key for a unix-seconds timestamp in local time.
fn month_key_of(secs: u64) -> Option<String> {
    use chrono::{Local, TimeZone};
    let dt = Local.timestamp_opt(secs as i64, 0).single()?;
    Some(dt.format("%Y-%m").to_string())
}

/// Build the cross-game overview from every cached row.
pub fn build_overview(db: &db::Db) -> Result<AchievementOverview, String> {
    let rows = db::achievements::list_rows_for_overview(db)?;

    let mut summaries: BTreeMap<String, AchievementSummary> = BTreeMap::new();
    let mut stats = LibraryStats::default();
    let mut monthly_counts: BTreeMap<String, (u32, u32)> = month_buckets(MONTHS)
        .into_iter()
        .map(|k| (k, (0u32, 0u32)))
        .collect();
    let mut recent: Vec<UnlockRecord> = Vec::new();
    let mut rarest: Vec<UnlockRecord> = Vec::new();
    let mut completion: Vec<CompletionEntry> = Vec::new();

    // Average completion accumulates as a float and is rounded once, to
    // match `Math.round(sum / gamesWithData)` on the frontend.
    let mut completion_sum: f64 = 0.0;

    for (game_id, steam_app_id, payload, last_synced, source, provider_id) in rows {
        let achievements = serde_json::from_str::<RawPayload>(&payload)
            .unwrap_or_default()
            .achievements;

        let mut summary = AchievementSummary {
            steam_app_id,
            total: achievements.len() as u32,
            unlocked: 0,
            last_synced,
            source: source.clone(),
            provider_id,
            points_earned: 0,
            points_total: 0,
            rarity: RarityCounts::default(),
            last_unlock_time: 0,
        };

        for ach in achievements {
            let points = achievement_points(ach.percent);
            summary.points_total += points;
            stats.gamerscore_total += points;
            stats.rarity_total.add(rarity_of(ach.percent));

            if ach.achieved {
                summary.unlocked += 1;
                summary.points_earned += points;
                summary.rarity.add(rarity_of(ach.percent));
                stats.gamerscore_earned += points;
                stats.rarity_unlocked.add(rarity_of(ach.percent));
                stats.by_source.add(&source);

                if ach.unlock_time > 0 {
                    if ach.unlock_time > summary.last_unlock_time {
                        summary.last_unlock_time = ach.unlock_time;
                    }
                    if let Some(key) = month_key_of(ach.unlock_time) {
                        if let Some(entry) = monthly_counts.get_mut(&key) {
                            entry.0 += 1;
                            entry.1 += points;
                        }
                    }
                    recent.push(UnlockRecord {
                        game_id: game_id.clone(),
                        achievement: ach.clone(),
                    });
                }

                rarest.push(UnlockRecord {
                    game_id: game_id.clone(),
                    achievement: ach,
                });
            }
        }

        if summary.total > 0 {
            stats.games_with_data += 1;
            stats.total += summary.total;
            stats.unlocked += summary.unlocked;
            completion_sum += (summary.unlocked as f64 / summary.total as f64) * 100.0;
            if summary.unlocked == summary.total {
                stats.perfect_games += 1;
            }
            let pct = ((summary.unlocked as f64 / summary.total as f64) * 100.0).round() as u32;
            completion.push(CompletionEntry {
                game_id: game_id.clone(),
                total: summary.total,
                unlocked: summary.unlocked,
                percentage: pct,
                last_unlock_time: summary.last_unlock_time,
            });
        }

        summaries.insert(game_id, summary);
    }

    stats.overall_pct = if stats.total > 0 {
        ((stats.unlocked as f64 / stats.total as f64) * 100.0).round() as u32
    } else {
        0
    };
    stats.avg_completion = if stats.games_with_data > 0 {
        (completion_sum / stats.games_with_data as f64).round() as u32
    } else {
        0
    };

    // Recent: newest unlocks first, capped.
    recent.sort_by(|a, b| b.achievement.unlock_time.cmp(&a.achievement.unlock_time));
    recent.truncate(RECENT_LIMIT);

    // Rarest: lowest global unlock percentage first. A missing/zero
    // percent sorts last (the frontend clamps it to 100), so it is never
    // shown ahead of a genuinely rare unlock.
    rarest.sort_by(|a, b| {
        let ra = if a.achievement.percent > 0.0 { a.achievement.percent } else { 100.0 };
        let rb = if b.achievement.percent > 0.0 { b.achievement.percent } else { 100.0 };
        ra.partial_cmp(&rb).unwrap_or(std::cmp::Ordering::Equal)
    });
    rarest.truncate(RAREST_LIMIT);

    // Perfect: most recently completed first.
    let mut perfect_games: Vec<CompletionEntry> = completion
        .iter()
        .filter(|c| c.total > 0 && c.unlocked == c.total)
        .cloned()
        .collect();
    perfect_games.sort_by(|a, b| b.last_unlock_time.cmp(&a.last_unlock_time));

    // Near completion: 50–99%, highest percentage first.
    let mut near_completion: Vec<CompletionEntry> = completion
        .into_iter()
        .filter(|c| c.total > 0 && c.unlocked < c.total && c.percentage >= 50)
        .collect();
    near_completion.sort_by(|a, b| b.percentage.cmp(&a.percentage));
    near_completion.truncate(NEAR_COMPLETION_LIMIT);

    let monthly = monthly_counts
        .into_iter()
        .map(|(month_key, (count, points))| MonthlyPoint { month_key, count, points })
        .collect();

    Ok(AchievementOverview {
        summaries,
        stats,
        monthly,
        recent_unlocks: recent,
        rarest_unlocks: rarest,
        perfect_games,
        near_completion,
    })
}

/// Read the full achievement payload for one game.
#[tauri::command]
pub async fn get_achievements_for_game(
    app: AppHandle,
    game_id: String,
) -> Result<Option<serde_json::Value>, String> {
    let db = app.state::<db::Db>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<Option<serde_json::Value>, String> {
        let Some((steam_app_id, payload, last_synced, source, provider_id)) =
            db::achievements::get(&db, &game_id)?
        else {
            return Ok(None);
        };
        let mut value: serde_json::Value =
            serde_json::from_str(&payload).map_err(|e| format!("parse payload: {e}"))?;
        if let Some(map) = value.as_object_mut() {
            map.insert("steamAppId".into(), serde_json::json!(steam_app_id));
            map.insert("source".into(), serde_json::json!(source));
            if let Some(ts) = last_synced {
                map.insert("lastSynced".into(), serde_json::json!(ts));
            }
            if let Some(pid) = provider_id {
                map.insert("providerId".into(), serde_json::json!(pid));
            }
        }
        Ok(Some(value))
    })
    .await
    .map_err(|e| format!("get_achievements_for_game task: {e}"))?
}

/// Persist one game's achievement payload.
#[tauri::command]
pub async fn save_achievement(
    app: AppHandle,
    game_id: String,
    data: String,
) -> Result<(), String> {
    let db = app.state::<db::Db>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let value: serde_json::Value =
            serde_json::from_str(&data).map_err(|e| format!("parse: {e}"))?;
        let steam_app_id = value
            .get("steamAppId")
            .and_then(|v| v.as_u64())
            .map(|n| n as u32)
            .unwrap_or(0);
        let source = value
            .get("source")
            .and_then(|v| v.as_str())
            .unwrap_or("steam");
        let last_synced = value.get("lastSynced").and_then(|v| v.as_u64());
        let provider_id = value.get("providerId").and_then(|v| v.as_str());
        db::achievements::upsert(
            &db,
            &game_id,
            steam_app_id,
            &data,
            last_synced.unwrap_or(0),
            source,
            provider_id,
        )
    })
    .await
    .map_err(|e| format!("save_achievement task: {e}"))?
}

/// Drop one game's cached achievements.
#[tauri::command]
pub async fn delete_achievement(app: AppHandle, game_id: String) -> Result<(), String> {
    let db = app.state::<db::Db>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || db::achievements::delete(&db, &game_id))
        .await
        .map_err(|e| format!("delete_achievement task: {e}"))?
}

/// Wipe the whole achievements cache.
#[tauri::command]
pub async fn clear_achievements_cache(app: AppHandle) -> Result<(), String> {
    let db = app.state::<db::Db>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || db::achievements::clear(&db))
        .await
        .map_err(|e| format!("clear_achievements_cache task: {e}"))?
}

/// Build the cross-game overview for the frontend.
#[tauri::command]
pub async fn get_achievement_overview(app: AppHandle) -> Result<AchievementOverview, String> {
    let db = app.state::<db::Db>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || build_overview(&db))
        .await
        .map_err(|e| format!("get_achievement_overview task: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ach(api: &str, achieved: bool, unlock: u64, percent: f64) -> Achievement {
        Achievement {
            api_name: api.to_string(),
            display_name: api.to_string(),
            description: String::new(),
            icon: String::new(),
            icon_gray: String::new(),
            achieved,
            unlock_time: unlock,
            percent,
        }
    }

    fn payload(achievements: Vec<Achievement>) -> String {
        serde_json::json!({
            "steamAppId": 1,
            "achievements": achievements,
            "total": 0,
            "unlocked": 0,
            "locked": 0,
        })
        .to_string()
    }

    #[test]
    fn rarity_and_points_match_frontend_rules() {
        assert_eq!(achievement_points(80.0), 10); // common
        assert_eq!(achievement_points(30.0), 25); // uncommon
        assert_eq!(achievement_points(10.0), 50); // rare
        assert_eq!(achievement_points(1.0), 100); // ultra rare
        assert_eq!(achievement_points(0.0), 100); // missing percent → ultra rare
    }

    #[test]
    fn overview_summarizes_and_aggregates() {
        let tmp = tempfile::tempdir().unwrap();
        let db = db::Db::open(tmp.path()).unwrap();
        crate::db::migrate::run_migrations(&db).unwrap();
        db::achievements::upsert(
            &db,
            "g1",
            101,
            &payload(vec![
                ach("A", true, 1_700_000_000, 80.0),
                ach("B", true, 1_700_000_100, 1.0),
                ach("C", false, 0, 30.0),
            ]),
            0,
            "steam",
            None,
        )
        .unwrap();
        db::achievements::upsert(
            &db,
            "g2",
            202,
            &payload(vec![ach("D", true, 1_700_000_200, 10.0)]),
            0,
            "gog",
            None,
        )
        .unwrap();

        let ov = build_overview(&db).unwrap();
        assert_eq!(ov.summaries.len(), 2);
        let s1 = &ov.summaries["g1"];
        assert_eq!(s1.total, 3);
        assert_eq!(s1.unlocked, 2);
        // 80% → common 10, 1% → ultra 100, 30% → uncommon 25 (locked, total only)
        assert_eq!(s1.points_total, 135);
        assert_eq!(s1.points_earned, 110);
        assert_eq!(s1.rarity.common, 1);
        assert_eq!(s1.rarity.ultra_rare, 1);
        assert_eq!(s1.last_unlock_time, 1_700_000_100);

        assert_eq!(ov.stats.total, 4);
        assert_eq!(ov.stats.unlocked, 3);
        assert_eq!(ov.stats.games_with_data, 2);
        assert_eq!(ov.stats.gamerscore_total, 135 + 50);
        assert_eq!(ov.stats.gamerscore_earned, 110 + 50);
        assert_eq!(ov.stats.rarity_total.common, 1);
        assert_eq!(ov.stats.rarity_total.uncommon, 1);
        assert_eq!(ov.stats.rarity_total.ultra_rare, 1);
        assert_eq!(ov.stats.by_source.steam, 2);
        assert_eq!(ov.stats.by_source.gog, 1);

        // Recent newest-first.
        assert_eq!(ov.recent_unlocks.len(), 3);
        assert_eq!(ov.recent_unlocks[0].achievement.unlock_time, 1_700_000_200);
        // Rarest: 1% first.
        assert_eq!(ov.rarest_unlocks[0].achievement.api_name, "B");
        // g2 is perfect (1/1), g1 is not.
        assert_eq!(ov.perfect_games.len(), 1);
        assert_eq!(ov.perfect_games[0].game_id, "g2");
        // Monthly buckets always present (6).
        assert_eq!(ov.monthly.len(), 6);
    }

    #[test]
    fn overview_is_empty_for_empty_db() {
        let tmp = tempfile::tempdir().unwrap();
        let db = db::Db::open(tmp.path()).unwrap();
        crate::db::migrate::run_migrations(&db).unwrap();
        let ov = build_overview(&db).unwrap();
        assert!(ov.summaries.is_empty());
        assert_eq!(ov.stats.total, 0);
        assert_eq!(ov.stats.overall_pct, 0);
        assert!(ov.recent_unlocks.is_empty());
        assert_eq!(ov.monthly.len(), 6);
    }
}
