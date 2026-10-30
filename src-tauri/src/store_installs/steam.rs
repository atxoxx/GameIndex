//! Steam transfers, read from the app manifest Steam keeps rewriting.
//!
//! `appmanifest_<appid>.acf` carries a live byte counter plus Steam's
//! packing state, so an outside process can follow an install, an update
//! or a repair without talking to Steam at all. The catch is cost: a large
//! library holds hundreds of manifests, and reading every one of them
//! every couple of seconds keeps an idle disk awake for nothing. A
//! manifest is therefore re-read only when its file stamp changed, or
//! while that app is known to be mid-transfer.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::time::SystemTime;

use crate::steam_game_watcher::{self, AppManifestFields};

use super::{FinishedInstall, InstallState, ScanOutcome, StoreInstall, StoreInstallTarget};

/// `StateFlags` bit Steam sets once an app is fully installed.
const STATE_FULLY_INSTALLED: u32 = 4;
/// `StateFlags` bit set when the user paused the update.
const STATE_UPDATE_PAUSED: u32 = 512;

#[derive(Debug, Clone, PartialEq, Eq)]
struct FileStamp {
    modified: Option<SystemTime>,
    len: u64,
}

#[derive(Debug, Clone)]
struct CachedManifest {
    stamp: FileStamp,
    phase: Phase,
}

#[derive(Debug, Default)]
pub struct SteamManifestCache {
    entries: HashMap<u32, CachedManifest>,
}

/// Where one manifest currently sits in Steam's install pipeline.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Downloading { done: u64, total: u64 },
    Installing { done: u64, total: u64 },
    /// Not installed and nothing moving: an install was just queued.
    Waiting,
    /// Steam accounts for every byte and the app is fully installed.
    Completed,
    /// The user paused the update, so there is nothing to report.
    Idle,
}

fn phase_of(m: &AppManifestFields) -> Phase {
    let flags = m.state_flags.unwrap_or(0);
    let to_download = m.bytes_to_download.unwrap_or(0);
    let downloaded = m.bytes_downloaded.unwrap_or(0);
    let to_stage = m.bytes_to_stage.unwrap_or(0);
    let staged = m.bytes_staged.unwrap_or(0);

    if flags & STATE_UPDATE_PAUSED != 0 {
        return Phase::Idle;
    }

    // A transfer is only real once bytes have actually moved. Steam keeps
    // `BytesToDownload` on a manifest whose update is merely *queued* —
    // hundreds of bytes' worth sitting at zero pulled while the game is
    // perfectly playable — so `to > done` alone would paint a permanent
    // 0% bar on every title with a pending update.
    let downloading = to_download > downloaded && downloaded > 0;
    let staging = to_stage > staged && staged > 0;

    if downloading {
        return Phase::Downloading {
            done: downloaded,
            total: to_download,
        };
    }
    if staging {
        return Phase::Installing {
            done: staged,
            total: to_stage,
        };
    }

    // The installed flag alone is not enough to call it complete: a
    // cancelled update keeps the old counters, and Steam sets the flag
    // while it is still unpacking. Only a manifest whose counters are
    // fully caught up describes a settled install.
    if flags & STATE_FULLY_INSTALLED != 0
        && to_download == downloaded
        && to_stage == staged
    {
        return Phase::Completed;
    }

    Phase::Waiting
}

fn percent(done: u64, total: u64) -> Option<f64> {
    if total == 0 {
        return None;
    }
    Some(((done as f64 / total as f64) * 100.0).clamp(0.0, 99.0))
}

/// Every `<library>\steamapps` directory, primary install included.
fn library_dirs() -> Vec<PathBuf> {
    let Some(root) = steam_game_watcher::find_steam_install_dir() else {
        return Vec::new();
    };
    let mut dirs = vec![root.join("steamapps")];
    let vdf = root.join("steamapps").join("libraryfolders.vdf");
    if let Ok(raw) = std::fs::read_to_string(&vdf) {
        for lib in steam_game_watcher::parse_library_folders(&raw) {
            let dir = lib.join("steamapps");
            if !dirs.contains(&dir) {
                dirs.push(dir);
            }
        }
    }
    dirs
}

/// Pull `appid` out of an `appmanifest_<appid>.acf` file name.
fn app_id_from_name(name: &str) -> Option<u32> {
    name.strip_prefix("appmanifest_")?
        .strip_suffix(".acf")?
        .parse()
        .ok()
}

/// What one cached manifest should produce on this pass.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Decision {
    Live {
        state: InstallState,
        percent: Option<f64>,
        done: Option<u64>,
        total: Option<u64>,
    },
    Finished,
    Nothing,
}

fn decide(phase: Phase, was_live: bool, installed: bool) -> Decision {
    match phase {
        Phase::Completed => {
            if was_live {
                Decision::Finished
            } else {
                Decision::Nothing
            }
        }
        // A paused or cancelled update is not news the card should carry.
        Phase::Idle => Decision::Nothing,
        Phase::Downloading { done, total } => Decision::Live {
            state: InstallState::Downloading,
            percent: percent(done, total),
            done: Some(done),
            total: Some(total),
        },
        Phase::Installing { done, total } => Decision::Live {
            state: InstallState::Installing,
            percent: percent(done, total),
            done: Some(done),
            total: Some(total),
        },
        // Steam writes the manifest the moment a download is queued, so a
        // game the library still lists as absent is genuinely starting. An
        // installed title whose update has not begun must stay silent,
        // otherwise every pending update would sit on the card forever.
        Phase::Waiting if installed => Decision::Nothing,
        Phase::Waiting => Decision::Live {
            state: InstallState::Pending,
            percent: None,
            done: None,
            total: None,
        },
    }
}

/// One pass over every library for the apps the library actually knows.
pub fn collect(
    targets: &HashMap<u32, &StoreInstallTarget>,
    previous_keys: &HashSet<String>,
    cache: &mut SteamManifestCache,
    out: &mut ScanOutcome,
) {
    let mut seen: HashSet<u32> = HashSet::new();

    for dir in library_dirs() {
        let Ok(read) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in read.flatten() {
            let file_name = entry.file_name();
            let Some(app_id) = file_name.to_str().and_then(app_id_from_name) else {
                continue;
            };
            let Some(target) = targets.get(&app_id) else {
                continue;
            };
            let Ok(meta) = entry.metadata() else {
                continue;
            };
            let stamp = FileStamp {
                modified: meta.modified().ok(),
                len: meta.len(),
            };

            let cached = cache.entries.get(&app_id);
            let needs_read = match cached {
                // A settled manifest is cheap to leave alone; anything else
                // may be advancing between rewrites.
                Some(c) => c.stamp != stamp || c.phase != Phase::Completed,
                None => true,
            };

            if needs_read {
                // A half-written manifest is normal while Steam updates it;
                // keep the previous parse and try again on the next pass.
                let Ok(raw) = std::fs::read_to_string(entry.path()) else {
                    continue;
                };
                let Some(parsed) = steam_game_watcher::parse_appmanifest(&raw, app_id) else {
                    continue;
                };
                let phase = phase_of(&parsed);
                cache
                    .entries
                    .insert(app_id, CachedManifest { stamp, phase });
            }

            let Some(cached) = cache.entries.get(&app_id) else {
                continue;
            };
            seen.insert(app_id);

            let key = format!("steam:{app_id}");
            match decide(cached.phase, previous_keys.contains(&key), target.installed) {
                Decision::Nothing => {}
                Decision::Finished => out.finished.push(FinishedInstall {
                    game_id: target.id.clone(),
                    title: target.name.clone(),
                    source: "steam".to_string(),
                }),
                Decision::Live {
                    state,
                    percent,
                    done,
                    total,
                } => out.live.push(StoreInstall {
                    key,
                    game_id: target.id.clone(),
                    source: "steam".to_string(),
                    app_id: app_id.to_string(),
                    title: target.name.clone(),
                    state,
                    percent,
                    downloaded: done,
                    total,
                    speed: None,
                    eta: None,
                }),
            }
        }
    }

    // Manifests that vanished (uninstalled, or the game left the library)
    // take their cached parse with them, so a later reinstall starts from
    // a clean stamp instead of resurrecting stale byte counts.
    cache.entries.retain(|id, _| seen.contains(id));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(flags: u32, to_dl: u64, dl: u64, to_stage: u64, staged: u64) -> AppManifestFields {
        AppManifestFields {
            app_id: 440,
            name: "Team Fortress 2".to_string(),
            install_dir: "Team Fortress 2".to_string(),
            state_flags: Some(flags),
            build_id: None,
            last_owner: None,
            installed_dlcs: Vec::new(),
            bytes_to_download: Some(to_dl),
            bytes_downloaded: Some(dl),
            bytes_to_stage: Some(to_stage),
            bytes_staged: Some(staged),
        }
    }

    #[test]
    fn downloading_wins_while_bytes_are_outstanding() {
        assert_eq!(
            phase_of(&manifest(1026, 1000, 250, 0, 0)),
            Phase::Downloading {
                done: 250,
                total: 1000
            }
        );
    }

    #[test]
    fn queued_update_with_zero_pulled_bytes_is_not_a_download() {
        // Straight off a real machine: `StateFlags 6` (update required +
        // fully installed) with `BytesToDownload` set and nothing pulled.
        // Five titles sat like this at once, and every one of them is
        // playable — Steam parks the byte total until it starts.
        assert_eq!(phase_of(&manifest(6, 201_704_522, 0, 0, 0)), Phase::Waiting);
        assert_eq!(decide(Phase::Waiting, false, true), Decision::Nothing);
    }

    #[test]
    fn paused_update_reports_nothing() {
        // `512` is UpdatePaused, as seen on paused Linux runtime updates.
        assert_eq!(phase_of(&manifest(550, 0, 0, 0, 0)), Phase::Idle);
        assert_eq!(decide(Phase::Idle, true, true), Decision::Nothing);
    }

    #[test]
    fn staging_reports_as_installing() {
        assert_eq!(
            phase_of(&manifest(1026, 1000, 1000, 4000, 1000)),
            Phase::Installing {
                done: 1000,
                total: 4000
            }
        );
    }

    #[test]
    fn installed_only_when_flag_and_counters_agree() {
        assert_eq!(phase_of(&manifest(4, 1000, 1000, 4000, 4000)), Phase::Completed);
        // Steam can hold the installed flag while it is still unpacking, so
        // a moving staging counter wins over the flag.
        assert_eq!(
            phase_of(&manifest(4, 1000, 1000, 4000, 10)),
            Phase::Installing {
                done: 10,
                total: 4000
            }
        );
        // A flag that says installed with the counters still short is an
        // unfinished transfer, not a finished one — it must never fire the
        // "installation complete" path.
        assert_ne!(phase_of(&manifest(6, 1000, 400, 0, 0)), Phase::Completed);
    }

    #[test]
    fn fresh_manifest_with_no_bytes_is_waiting() {
        assert_eq!(phase_of(&manifest(1026, 0, 0, 0, 0)), Phase::Waiting);
    }

    #[test]
    fn percent_is_capped_below_100_while_transferring() {
        assert_eq!(percent(0, 0), None);
        assert_eq!(percent(1000, 1000), Some(99.0));
        assert_eq!(percent(500, 1000), Some(50.0));
    }

    #[test]
    fn app_id_is_read_from_the_manifest_name() {
        assert_eq!(app_id_from_name("appmanifest_440.acf"), Some(440));
        assert_eq!(app_id_from_name("appmanifest_440.acf.bak"), None);
        assert_eq!(app_id_from_name("libraryfolders.vdf"), None);
    }

    #[test]
    fn completion_is_only_reported_for_a_transfer_that_was_live() {
        assert_eq!(decide(Phase::Completed, true, false), Decision::Finished);
        assert_eq!(decide(Phase::Completed, false, false), Decision::Nothing);
    }

    #[test]
    fn queued_update_on_an_installed_game_stays_silent() {
        assert_eq!(decide(Phase::Waiting, false, true), Decision::Nothing);
        assert_eq!(
            decide(Phase::Waiting, false, false),
            Decision::Live {
                state: InstallState::Pending,
                percent: None,
                done: None,
                total: None,
            }
        );
    }
}
