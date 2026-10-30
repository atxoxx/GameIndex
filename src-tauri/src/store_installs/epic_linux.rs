//! Epic transfers on Linux, inferred from Heroic's log tail.
//!
//! There is no launcher manifest to read here: Legendary (and Heroic on
//! top of it) streams progress to stdout and only writes `installed.json`
//! once a game is done, so the log left behind by Heroic is the single
//! machine-readable trace. That makes this the most fragile source in the
//! module — it is reported only while a fresh line says a transfer is
//! running, and stays silent otherwise. The parse itself is pure so it can
//! be tested against captured log text on any platform.

use std::collections::HashSet;

use super::{FinishedInstall, InstallState, ScanOutcome, StoreInstall, StoreInstallTarget};

/// A progress line older than this no longer proves anything is running:
/// Legendary writes one every few seconds while it works.
const STALE_AFTER: std::time::Duration = std::time::Duration::from_secs(90);

#[derive(Debug, Clone, PartialEq)]
pub struct HeroicProgress {
    pub app_name: String,
    pub percent: f64,
    pub downloaded: u64,
    pub total: u64,
    pub eta_seconds: Option<u64>,
}

fn unit_multiplier(unit: &str) -> Option<f64> {
    match unit.trim().to_ascii_lowercase().as_str() {
        "b" | "" => Some(1.0),
        "kib" | "kb" => Some(1024.0),
        "mib" | "mb" => Some(1024.0 * 1024.0),
        "gib" | "gb" => Some(1024.0 * 1024.0 * 1024.0),
        "tib" | "tb" => Some(1024.0 * 1024.0 * 1024.0 * 1024.0),
        _ => None,
    }
}

/// Split `"7.27 GiB"` into its number and unit.
fn split_size(text: &str) -> Option<(f64, &str)> {
    let text = text.trim();
    let split = text
        .find(|c: char| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(text.len());
    let (num, unit) = text.split_at(split);
    let value = num.parse::<f64>().ok()?;
    Some((value, unit))
}

/// `"3.03/7.27 GiB"` → `(downloaded, total)` in bytes.
fn parse_size_pair(inner: &str) -> Option<(u64, u64)> {
    let (left, right) = inner.split_once('/')?;
    let (total_value, unit) = split_size(right)?;
    let multiplier = unit_multiplier(unit)?;
    let done_value = left.trim().parse::<f64>().ok()?;
    Some((
        (done_value * multiplier) as u64,
        (total_value * multiplier) as u64,
    ))
}

/// `"00:01:10"` → 70.
fn parse_eta(text: &str) -> Option<u64> {
    let mut parts = text.trim().split(':');
    let hours: u64 = parts.next()?.parse().ok()?;
    let minutes: u64 = parts.next()?.parse().ok()?;
    let seconds: u64 = parts.next()?.parse().ok()?;
    Some(hours * 3600 + minutes * 60 + seconds)
}

fn parse_progress_line(line: &str) -> Option<(f64, u64, u64, Option<u64>)> {
    let after = line.split_once("Progress: ")?.1;
    let pct_end = after.find('%')?;
    let percent = after[..pct_end].trim().parse::<f64>().ok()?;

    let open = after.find('(')?;
    let close = after[open..].find(')')? + open;
    let (downloaded, total) = parse_size_pair(&after[open + 1..close])?;

    let eta = after[close..]
        .split_once("ETA: ")
        .and_then(|(_, rest)| {
            let value = rest.trim();
            let end = value
                .find(|c: char| !(c.is_ascii_digit() || c == ':'))
                .unwrap_or(value.len());
            parse_eta(&value[..end])
        });

    Some((percent, downloaded, total, eta))
}

/// Name of the app the surrounding output is about. Legendary announces
/// the install before it starts reporting bytes.
fn app_name_before(lines: &[&str], upto: usize) -> Option<String> {
    for line in lines[..upto].iter().rev() {
        for marker in ["info for \"", "Installing \"", "Downloading \""] {
            if let Some((_, rest)) = line.split_once(marker) {
                if let Some(end) = rest.find('"') {
                    if end > 0 {
                        return Some(rest[..end].to_string());
                    }
                }
            }
        }
    }
    None
}

/// Last progress block in a log tail, with the app it belongs to.
pub fn parse_log_tail(text: &str) -> Option<HeroicProgress> {
    let lines: Vec<&str> = text.lines().collect();
    let (index, (percent, downloaded, total, eta)) = lines
        .iter()
        .enumerate()
        .filter_map(|(i, line)| parse_progress_line(line).map(|p| (i, p)))
        .next_back()?;

    let app_name = app_name_before(&lines, index)?;
    Some(HeroicProgress {
        app_name,
        percent,
        downloaded,
        total,
        eta_seconds: eta,
    })
}

fn normalize(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// Newest Heroic log on this machine, native or Flatpak install.
#[cfg(not(target_os = "linux"))]
fn newest_log() -> Option<(std::path::PathBuf, std::time::SystemTime)> {
    None
}

#[cfg(target_os = "linux")]
fn newest_log() -> Option<(std::path::PathBuf, std::time::SystemTime)> {
    let home = std::env::var("HOME").ok()?;
    let roots = [
        std::path::PathBuf::from(&home).join(".config/heroic/logs"),
        std::path::PathBuf::from(&home).join(".var/app/com.heroicgameslauncher.hgl/config/heroic/logs"),
    ];

    let mut newest: Option<(std::path::PathBuf, std::time::SystemTime)> = None;
    for root in roots {
        let Ok(entries) = std::fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("log") {
                continue;
            }
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            let Ok(modified) = meta.modified() else {
                continue;
            };
            if newest.as_ref().map(|(_, best)| modified > *best).unwrap_or(true) {
                newest = Some((path, modified));
            }
        }
    }
    newest
}

/// Read the tail of the newest log and turn it into a transfer entry when
/// it names one of the library's games.
pub fn collect(
    targets: &[&StoreInstallTarget],
    previous_keys: &HashSet<String>,
    out: &mut ScanOutcome,
) {
    let Some((path, modified)) = newest_log() else {
        return;
    };
    if modified.elapsed().map(|age| age > STALE_AFTER).unwrap_or(true) {
        return;
    }
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return;
    };
    // Only the tail matters, and Heroic's logs grow to several MB. Slide
    // forward to a character boundary so a title with accents in the tail
    // can't panic the slice.
    let mut start = raw.len().saturating_sub(64 * 1024);
    while start < raw.len() && !raw.is_char_boundary(start) {
        start += 1;
    }
    let tail = &raw[start..];

    let Some(progress) = parse_log_tail(tail) else {
        return;
    };
    let wanted = normalize(&progress.app_name);
    let Some(target) = targets
        .iter()
        .find(|t| normalize(&t.name) == wanted)
        .copied()
    else {
        return;
    };

    let key = format!("epic:{}", progress.app_name);
    if progress.percent >= 99.9 {
        if previous_keys.contains(&key) {
            out.finished.push(FinishedInstall {
                game_id: target.id.clone(),
                title: target.name.clone(),
                source: "epic".to_string(),
            });
        }
        return;
    }

    out.live.push(StoreInstall {
        key,
        game_id: target.id.clone(),
        source: "epic".to_string(),
        app_id: progress.app_name.clone(),
        title: target.name.clone(),
        state: InstallState::Downloading,
        percent: Some(progress.percent),
        downloaded: Some(progress.downloaded),
        total: Some(progress.total),
        speed: None,
        eta: progress.eta_seconds,
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const TAIL: &str = r#"
[Core] INFO: Getting install info for "Hades" from server
[DLManager] INFO: Install size: 7.27 GiB
[DLManager] INFO: = Progress: 12.34% (0.90/7.27 GiB), Running for 00:00:08, ETA: 00:00:52
[DLManager] INFO: = Progress: 41.68% (3.03/7.27 GiB), Running for 00:00:29, ETA: 00:01:10
"#;

    #[test]
    fn reads_the_last_progress_block() {
        let parsed = parse_log_tail(TAIL).unwrap();
        assert_eq!(parsed.app_name, "Hades");
        assert!((parsed.percent - 41.68).abs() < 0.001);
        assert_eq!(parsed.eta_seconds, Some(70));
        assert_eq!(parsed.total, (7.27 * 1024.0 * 1024.0 * 1024.0) as u64);
    }

    #[test]
    fn a_log_without_progress_reports_nothing() {
        assert!(parse_log_tail("[Core] INFO: Starting Heroic\n").is_none());
    }

    #[test]
    fn a_progress_line_without_an_app_name_reports_nothing() {
        assert!(parse_log_tail(
            "[DLManager] INFO: = Progress: 41.68% (3.03/7.27 GiB), Running for 00:00:29, ETA: 00:01:10"
        )
        .is_none());
    }

    #[test]
    fn unknown_eta_is_tolerated() {
        let parsed = parse_log_tail(
            "[Core] INFO: Getting install info for \"Celeste\"\n\
             [DLManager] INFO: = Progress: 5.00% (0.10/2.00 GiB), Running for 00:00:02, ETA: Unknown",
        )
        .unwrap();
        assert_eq!(parsed.app_name, "Celeste");
        assert_eq!(parsed.eta_seconds, None);
    }

    #[test]
    fn sizes_convert_to_bytes() {
        assert_eq!(
            parse_size_pair("1.00/2.00 GiB"),
            Some((1024 * 1024 * 1024, 2 * 1024 * 1024 * 1024))
        );
        assert_eq!(parse_size_pair("512/1024 KiB"), Some((512 * 1024, 1024 * 1024)));
    }

    #[test]
    fn titles_normalize_across_case_and_punctuation() {
        assert_eq!(normalize("Ori & the Blind Forest"), "oritheblindforest");
        assert_eq!(normalize("ORI & THE BLIND FOREST"), "oritheblindforest");
        assert_eq!(normalize("Hades"), "hades");
    }
}
