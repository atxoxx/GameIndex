//! Epic transfers, inferred from the launcher's install manifests.
//!
//! Epic writes `%PROGRAMDATA%\Epic\EpicGamesLauncher\Data\Manifests\*.item`
//! as soon as an install starts and keeps it until the install completes,
//! so the file's presence plus `bIsIncompleteInstall` is an exact "is this
//! running" signal. It carries no byte counter, though: the percentage has
//! to be measured off the disk the transfer is writing to. Epic stages
//! chunks under `<install>\.egstore\bps`, which is the closest thing to a
//! download total, so that folder is measured first and the install
//! directory only stands in when staging is empty.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::Deserialize;

use super::{FinishedInstall, InstallState, ScanOutcome, StoreInstall, StoreInstallTarget};

/// Upper bound on entries walked when measuring a folder. Over this the
/// size is not worth the stall and the bar goes indeterminate instead.
const MEASURE_BUDGET: u32 = 4_000;

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "PascalCase")]
struct EpicItem {
    #[serde(rename = "bIsIncompleteInstall", default)]
    incomplete: bool,
    #[serde(default)]
    install_size: u64,
    #[serde(default)]
    install_location: Option<String>,
    #[serde(default)]
    staging_location: Option<String>,
    #[serde(default)]
    catalog_namespace: Option<String>,
    #[serde(default)]
    catalog_item_id: Option<String>,
    #[serde(default)]
    app_name: Option<String>,
}

impl EpicItem {
    /// The library game id this manifest belongs to:
    /// `epic-<CatalogNamespace>-<CatalogItemId>`.
    fn game_id(&self) -> Option<String> {
        let ns = self.catalog_namespace.as_deref()?;
        let item = self.catalog_item_id.as_deref()?;
        Some(format!("epic-{ns}-{item}"))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ManifestStamp {
    modified: Option<std::time::SystemTime>,
    len: u64,
}

#[derive(Debug, Clone)]
struct CachedItem {
    stamp: ManifestStamp,
    incomplete: bool,
}

/// Last-seen state per manifest file, so an idle Epic library costs a
/// directory listing and a stat per game instead of a JSON parse of every
/// manifest on every pass.
#[derive(Debug, Default)]
pub struct EpicManifestCache {
    entries: HashMap<PathBuf, CachedItem>,
}

fn manifests_dir() -> Option<PathBuf> {
    let program_data = std::env::var("PROGRAMDATA").ok()?;
    Some(
        PathBuf::from(program_data)
            .join("Epic")
            .join("EpicGamesLauncher")
            .join("Data")
            .join("Manifests"),
    )
}

/// Total bytes under `root`, or `None` when the tree is too big to walk
/// cheaply (or unreadable). Symlinks are not followed: a junction loop in
/// an install directory must not turn a poll into a spin.
fn dir_size_capped(root: &Path) -> Option<u64> {
    let mut total: u64 = 0;
    let mut seen: u32 = 0;
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            seen += 1;
            if seen > MEASURE_BUDGET {
                return None;
            }
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                stack.push(entry.path());
            } else if let Ok(meta) = entry.metadata() {
                total = total.saturating_add(meta.len());
            }
        }
    }

    Some(total)
}

/// Bytes already staged for this install.
///
/// Only the staging folder counts: for an update, measuring the install
/// directory would compare a full, already-installed folder against the
/// install size and report a permanent 99%.
fn staged_bytes(item: &EpicItem) -> Option<u64> {
    let staging = item.staging_location.as_deref()?;
    dir_size_capped(Path::new(staging)).filter(|size| *size > 0)
}

fn install_dir_exists(item: &EpicItem) -> bool {
    item.install_location
        .as_deref()
        .map(|dir| Path::new(dir).exists())
        .unwrap_or(false)
}

fn percent(done: u64, total: u64) -> Option<f64> {
    if total == 0 {
        return None;
    }
    Some(((done as f64 / total as f64) * 100.0).clamp(0.0, 99.0))
}

#[cfg_attr(not(windows), allow(dead_code))]
pub fn collect(
    targets_by_game_id: &HashMap<String, &StoreInstallTarget>,
    previous_keys: &HashSet<String>,
    cache: &mut EpicManifestCache,
    out: &mut ScanOutcome,
) {
    let Some(dir) = manifests_dir() else {
        return;
    };
    let Ok(read) = std::fs::read_dir(&dir) else {
        return;
    };

    let mut seen: HashSet<PathBuf> = HashSet::new();

    for entry in read.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("item") {
            continue;
        }
        seen.insert(path.clone());

        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let stamp = ManifestStamp {
            modified: meta.modified().ok(),
            len: meta.len(),
        };

        // A settled manifest (completed install) never changes until the
        // next install, so its stamp is enough to skip the JSON parse.
        if cache
            .entries
            .get(&path)
            .is_some_and(|cached| cached.stamp == stamp && !cached.incomplete)
        {
            continue;
        }

        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(item) = serde_json::from_str::<EpicItem>(&raw) else {
            // Epic rewrites the file in place while it works; a torn read
            // simply waits for the next pass.
            continue;
        };
        cache.entries.insert(
            path,
            CachedItem {
                stamp,
                incomplete: item.incomplete,
            },
        );

        let Some(game_id) = item.game_id() else {
            continue;
        };
        let Some(target) = targets_by_game_id.get(&game_id) else {
            // Covers the launcher's own dependencies (Unreal Engine
            // components, redistributables) which are never library games.
            continue;
        };

        let key = format!("epic:{}", item.app_name.clone().unwrap_or_else(|| game_id.clone()));
        if !item.incomplete {
            if previous_keys.contains(&key) {
                out.finished.push(FinishedInstall {
                    game_id: target.id.clone(),
                    title: target.name.clone(),
                    source: "epic".to_string(),
                });
            }
            continue;
        }

        let total = item.install_size;
        let staged = staged_bytes(&item);
        let (state, percent_value, downloaded) = match staged {
            Some(bytes) => (InstallState::Downloading, percent(bytes, total), Some(bytes)),
            // Nothing staged yet and no folder on disk: Epic queued the
            // job but has not written a byte.
            None if !install_dir_exists(&item) => (InstallState::Pending, None, None),
            // An existing install with nothing staged is Epic verifying or
            // unpacking — real work, but not something the disk can size.
            None => (InstallState::Installing, None, None),
        };

        out.live.push(StoreInstall {
            key,
            game_id: target.id.clone(),
            source: "epic".to_string(),
            app_id: item.app_name.clone().unwrap_or_default(),
            title: target.name.clone(),
            state,
            percent: percent_value,
            downloaded,
            total: if total > 0 { Some(total) } else { None },
            speed: None,
            eta: None,
        });
    }

    // Drop cache entries for manifests Epic removed (game uninstalled).
    cache.entries.retain(|path, _| seen.contains(path));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(dir: &Path, name: &str, bytes: usize) {
        std::fs::write(dir.join(name), vec![b'x'; bytes]).unwrap();
    }

    #[test]
    fn manifest_maps_to_a_library_game_id() {
        let raw = r#"{
            "bIsIncompleteInstall": true,
            "InstallSize": 1000,
            "InstallLocation": "D:\\Games\\Hades",
            "CatalogNamespace": "018d937f",
            "CatalogItemId": "abc123",
            "AppName": "Hades",
            "DisplayName": "Hades"
        }"#;
        let item: EpicItem = serde_json::from_str(raw).unwrap();
        assert!(item.incomplete);
        assert_eq!(item.install_size, 1000);
        assert_eq!(item.game_id().unwrap(), "epic-018d937f-abc123");
        assert_eq!(item.app_name.as_deref(), Some("Hades"));
    }

    #[test]
    fn a_completed_manifest_is_not_a_transfer() {
        let item: EpicItem = serde_json::from_str(r#"{"bIsIncompleteInstall": false}"#).unwrap();
        assert!(!item.incomplete);
    }

    #[test]
    fn missing_install_fields_default_instead_of_failing() {
        let item: EpicItem = serde_json::from_str(r#"{"bIsIncompleteInstall": true}"#).unwrap();
        assert_eq!(item.install_size, 0);
        assert!(item.install_location.is_none());
        assert_eq!(item.game_id(), None);
    }

    #[test]
    fn size_walk_sums_a_small_tree() {
        let tmp = std::env::temp_dir().join(format!("gi-epic-size-{}", std::process::id()));
        let nested = tmp.join("sub");
        std::fs::create_dir_all(&nested).unwrap();
        write(&tmp, "a.bin", 128);
        write(&nested, "b.bin", 64);

        assert_eq!(dir_size_capped(&tmp), Some(192));

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn missing_folder_measures_zero_not_none() {
        let missing = std::env::temp_dir().join("gi-epic-does-not-exist");
        assert_eq!(dir_size_capped(&missing), Some(0));
    }

    #[test]
    fn percent_needs_a_known_total() {
        assert_eq!(percent(500, 0), None);
        assert_eq!(percent(500, 1000), Some(50.0));
        assert_eq!(percent(1000, 1000), Some(99.0));
    }
}
