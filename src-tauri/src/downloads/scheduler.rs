//! Download scheduler: pure, testable helpers plus the persisted config.
//!
//! The scheduler has three responsibilities:
//!   * gate *when* a queued/paused download may start (a fixed time-of-day
//!     window, optionally limited to certain weekdays),
//!   * honour a per-download one-shot `scheduled_start_at` timestamp,
//!   * pick an active bandwidth rule so the engine can retune its limits
//!     without the user touching anything.
//!
//! Everything in this file is synchronous and side-effect free so the
//! decision logic can be unit-tested without a running engine. The async
//! application lives in `mod.rs` (`initialize_engine` + the commands).

use serde::{Deserialize, Serialize};

/// One recurring bandwidth window. While a rule matches, its kbps values
/// override the user's base limits (0 kbps = unlimited for that direction).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BandwidthRule {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default = "default_true_days")]
    pub days: [bool; 7],
    #[serde(default = "default_window_start")]
    pub start: String,
    #[serde(default = "default_window_end")]
    pub end: String,
    #[serde(default)]
    pub download_kbps: u32,
    #[serde(default)]
    pub upload_kbps: u32,
    #[serde(default)]
    pub disable_upload: bool,
}

/// Persisted scheduler configuration (stored in the `kv_store` table under
/// the `download_scheduler` key).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub window_enabled: bool,
    #[serde(default = "default_window_start")]
    pub window_start: String,
    #[serde(default = "default_window_end")]
    pub window_end: String,
    #[serde(default = "default_true_days")]
    pub days: [bool; 7],
    #[serde(default)]
    pub max_concurrent: u32,
    #[serde(default = "default_true")]
    pub auto_start_queued: bool,
    /// Pause active downloads once the start window closes (only
    /// meaningful together with `enabled` + `window_enabled`).
    #[serde(default)]
    pub pause_outside_window: bool,
    /// Pause active downloads while a game is running, resuming them
    /// once the last game exits.
    #[serde(default)]
    pub pause_on_game: bool,
    #[serde(default)]
    pub bandwidth_rules: Vec<BandwidthRule>,
}

impl Default for SchedulerConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            window_enabled: false,
            window_start: "00:00".to_string(),
            window_end: "06:00".to_string(),
            days: [true; 7],
            max_concurrent: 0,
            auto_start_queued: true,
            pause_outside_window: false,
            pause_on_game: false,
            bandwidth_rules: Vec::new(),
        }
    }
}

fn default_true() -> bool {
    true
}

fn default_true_days() -> [bool; 7] {
    [true; 7]
}

fn default_window_start() -> String {
    "00:00".to_string()
}

fn default_window_end() -> String {
    "06:00".to_string()
}

/// Parse an `HH:MM` (24-hour) string into minutes since midnight.
/// Accepts single-digit hours (`6:00`); rejects out-of-range values.
pub fn parse_hhmm(s: &str) -> Option<u32> {
    let (h, m) = s.trim().split_once(':')?;
    let h: u32 = h.trim().parse().ok()?;
    let m: u32 = m.trim().parse().ok()?;
    if h > 23 || m > 59 {
        return None;
    }
    Some(h * 60 + m)
}

/// Is `now_min` inside the `[start, end)` window on `weekday`?
///
/// `days[weekday]` gates the *start* day of the window, so a window that
/// wraps past midnight (e.g. 22:00 → 02:00 on Friday) is "open" on
/// Saturday morning when Friday was selected. `start == end` means an
/// all-day window on the selected days. Unparseable times are treated as
/// outside the window (fail closed).
pub fn in_window(
    start: &str,
    end: &str,
    days: &[bool; 7],
    now_min: u32,
    weekday: usize,
) -> bool {
    let weekday = weekday % 7;
    let (Some(s), Some(e)) = (parse_hhmm(start), parse_hhmm(end)) else {
        return false;
    };
    if s == e {
        return days[weekday];
    }
    if s < e {
        return days[weekday] && now_min >= s && now_min < e;
    }
    // Wraps past midnight: the tail before `end` belongs to the
    // previous day's window.
    if now_min >= s {
        days[weekday]
    } else if now_min < e {
        days[(weekday + 6) % 7]
    } else {
        false
    }
}

/// Whether the scheduler permits a start right now.
///
/// Disabled scheduler = everything allowed (the feature is opt-in). A
/// future `scheduled_start_at` always blocks. An enabled window blocks
/// outside its hours.
pub fn config_allows_start(
    cfg: &SchedulerConfig,
    scheduled_start_at: Option<u64>,
    now: u64,
    now_min: u32,
    weekday: usize,
) -> bool {
    if !cfg.enabled {
        return true;
    }
    if let Some(t) = scheduled_start_at {
        if t > now {
            return false;
        }
    }
    if cfg.window_enabled
        && !in_window(&cfg.window_start, &cfg.window_end, &cfg.days, now_min, weekday)
    {
        return false;
    }
    true
}

/// The first bandwidth rule whose day + time matches now.
pub fn active_bandwidth_rule(
    cfg: &SchedulerConfig,
    now_min: u32,
    weekday: usize,
) -> Option<&BandwidthRule> {
    cfg.bandwidth_rules
        .iter()
        .find(|r| in_window(&r.start, &r.end, &r.days, now_min, weekday))
}

/// Weekday for a Unix timestamp, 0 = Monday … 6 = Sunday (UTC). Kept for
/// the unit tests / any UTC-based caller; the live scheduler now derives
/// the weekday from local time.
#[allow(dead_code)]
pub fn weekday_from_unix(secs: u64) -> usize {
    ((secs / 86_400 + 3) % 7) as usize
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(id: &str, start: &str, end: &str, days: [bool; 7]) -> BandwidthRule {
        BandwidthRule {
            id: id.to_string(),
            label: id.to_string(),
            days,
            start: start.to_string(),
            end: end.to_string(),
            download_kbps: 0,
            upload_kbps: 0,
            disable_upload: false,
        }
    }

    #[test]
    fn parse_hhmm_accepts_valid_and_rejects_garbage() {
        assert_eq!(parse_hhmm("00:00"), Some(0));
        assert_eq!(parse_hhmm("06:30"), Some(390));
        assert_eq!(parse_hhmm("6:00"), Some(360));
        assert_eq!(parse_hhmm("23:59"), Some(1439));
        assert_eq!(parse_hhmm("24:00"), None);
        assert_eq!(parse_hhmm("12:60"), None);
        assert_eq!(parse_hhmm("nope"), None);
        assert_eq!(parse_hhmm(""), None);
    }

    #[test]
    fn in_window_normal_day() {
        // Mon–Fri, 09:00–17:00. Wednesday (2).
        let days = [true, true, true, true, true, false, false];
        assert!(in_window("09:00", "17:00", &days, 9 * 60, 2));
        assert!(in_window("09:00", "17:00", &days, 16 * 60 + 59, 2));
        // End is exclusive.
        assert!(!in_window("09:00", "17:00", &days, 17 * 60, 2));
        assert!(!in_window("09:00", "17:00", &days, 8 * 60 + 59, 2));
    }

    #[test]
    fn in_window_day_gating() {
        let days = [true, false, false, false, false, false, false];
        assert!(in_window("10:00", "12:00", &days, 11 * 60, 0)); // Monday
        assert!(!in_window("10:00", "12:00", &days, 11 * 60, 1)); // Tuesday
    }

    #[test]
    fn in_window_wraps_past_midnight() {
        // Friday (4) only, 22:00 → 02:00.
        let days = [false, false, false, false, true, false, false];
        assert!(in_window("22:00", "02:00", &days, 23 * 60, 4));
        // Saturday 01:00 still belongs to Friday's window.
        assert!(in_window("22:00", "02:00", &days, 60, 5));
        // Saturday 03:00 is outside.
        assert!(!in_window("22:00", "02:00", &days, 3 * 60, 5));
        // Monday 01:00 is outside (Sunday was not selected).
        assert!(!in_window("22:00", "02:00", &days, 60, 0));
    }

    #[test]
    fn in_window_start_equals_end_is_all_day() {
        let days = [true, false, false, false, false, false, false];
        assert!(in_window("00:00", "00:00", &days, 0, 0));
        assert!(in_window("00:00", "00:00", &days, 23 * 60 + 59, 0));
        assert!(!in_window("00:00", "00:00", &days, 12 * 60, 1));
    }

    #[test]
    fn config_allows_start_disabled_always_allows() {
        let cfg = SchedulerConfig::default();
        assert!(config_allows_start(&cfg, Some(u64::MAX), 0, 0, 0));
    }

    #[test]
    fn config_allows_start_blocks_future_schedule() {
        let mut cfg = SchedulerConfig::default();
        cfg.enabled = true;
        // Future scheduled start blocks.
        assert!(!config_allows_start(&cfg, Some(200), 100, 0, 0));
        // Past/now schedule allows.
        assert!(config_allows_start(&cfg, Some(100), 100, 0, 0));
        // No schedule + no window opens = allowed.
        assert!(config_allows_start(&cfg, None, 100, 0, 0));
    }

    #[test]
    fn config_allows_start_respects_closed_window() {
        let mut cfg = SchedulerConfig::default();
        cfg.enabled = true;
        cfg.window_enabled = true;
        cfg.window_start = "02:00".to_string();
        cfg.window_end = "04:00".to_string();
        cfg.days = [true; 7];
        assert!(config_allows_start(&cfg, None, 0, 3 * 60, 0));
        assert!(!config_allows_start(&cfg, None, 0, 5 * 60, 0));
    }

    #[test]
    fn active_bandwidth_rule_picks_first_match() {
        let mut cfg = SchedulerConfig::default();
        cfg.bandwidth_rules = vec![
            rule("night", "00:00", "06:00", [true; 7]),
            rule("day", "06:00", "18:00", [true; 7]),
        ];
        assert_eq!(
            active_bandwidth_rule(&cfg, 2 * 60, 0).map(|r| r.id.as_str()),
            Some("night")
        );
        assert_eq!(
            active_bandwidth_rule(&cfg, 12 * 60, 0).map(|r| r.id.as_str()),
            Some("day")
        );
        assert!(active_bandwidth_rule(&cfg, 20 * 60, 0).is_none());
    }

    #[test]
    fn active_bandwidth_rule_honours_days() {
        let mut cfg = SchedulerConfig::default();
        cfg.bandwidth_rules = vec![rule(
            "weekend",
            "00:00",
            "00:00",
            [false, false, false, false, false, true, true],
        )];
        assert!(active_bandwidth_rule(&cfg, 0, 0).is_none()); // Monday
        assert!(active_bandwidth_rule(&cfg, 0, 5).is_some()); // Saturday
    }

    #[test]
    fn weekday_from_unix_is_monday_based() {
        // 1970-01-01 was a Thursday.
        assert_eq!(weekday_from_unix(0), 3);
        // 1970-01-05 was a Monday.
        assert_eq!(weekday_from_unix(4 * 86_400), 0);
        // 1970-01-04 was a Sunday.
        assert_eq!(weekday_from_unix(3 * 86_400), 6);
    }

    #[test]
    fn config_pause_flags_default_to_false_and_round_trip() {
        let cfg: SchedulerConfig = serde_json::from_str("{}").unwrap();
        assert!(!cfg.pause_outside_window);
        assert!(!cfg.pause_on_game);

        let cfg: SchedulerConfig =
            serde_json::from_str(r#"{"pauseOutsideWindow": true, "pauseOnGame": true}"#).unwrap();
        assert!(cfg.pause_outside_window);
        assert!(cfg.pause_on_game);
    }
}
