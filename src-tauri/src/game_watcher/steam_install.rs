use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

use crate::steam_game_watcher;

use super::*;
use super::types::SteamLibraryGame;

/// Payload for the "steam-install-changed" event emitted when a Steam
/// AppID installation status changes (game downloaded / installed / uninstalled).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamInstallChangedPayload {
    pub app_id: u32,
    pub installed: bool,
    pub exe_path: Option<String>,
}

/// Owned inputs for one Steam-install scan, captured under the watcher
/// lock so the scan's registry + library-folder I/O can run unlocked.
pub(crate) struct SteamScanInputs {
    /// AppID → fully-installed state observed at the previous scan,
    /// seeded from the library's declared install state on the first
    /// scan after an index rebuild (see `reconciled_baseline`).
    pub(crate) previous: HashMap<u32, bool>,
    /// AppIDs already reported as uninstalled. Suppresses a repeat event
    /// while the library index hasn't caught up and dropped the entry.
    pub(crate) missing_reported: HashSet<u32>,
    /// Every Steam game the library knows about (installed or not).
    pub(crate) library: HashMap<u32, SteamLibraryGame>,
}

/// Merge the library's declared install state into the scan baseline.
///
/// On a reconcile scan (first scan, or right after the library index is
/// rebuilt), a game the library believes is installed but whose manifest
/// has since vanished is otherwise invisible: the previous-scan map has
/// no entry to diff against. Seeding the baseline with the library's own
/// `installed` flags makes a closed-app install/uninstall look like an
/// ordinary transition.
///
/// The mirror case matters too: if the library says a game is *not*
/// installed, any observed entry is dropped. Otherwise a first scan that
/// ran before the library loaded (and therefore saw an install the
/// library doesn't know about yet) would suppress the very install event
/// this reconciliation exists to produce. The library is authoritative
/// for the direction it points; observed disk state wins only for games
/// the library hasn't seen.
pub(crate) fn reconciled_baseline(
    observed: &HashMap<u32, bool>,
    library: &HashMap<u32, SteamLibraryGame>,
) -> HashMap<u32, bool> {
    let mut baseline = observed.clone();
    for (appid, game) in library {
        if game.installed {
            // Keep an observed value (e.g. mid-update `false`) rather
            // than clobbering it with `true`.
            baseline.entry(*appid).or_insert(true);
        } else {
            baseline.remove(appid);
        }
    }
    baseline
}

/// Pure install/uninstall transition diff for one Steam scan.
///
/// Returns `(newly_installed, uninstalled)` AppIDs. Only games the
/// library knows about are ever reported — the scan sees every manifest
/// on disk, but an AppID with no library entry has nothing to update.
pub(crate) fn diff_steam_install_transitions(
    current: &HashMap<u32, bool>,
    previous: &HashMap<u32, bool>,
    library: &HashMap<u32, SteamLibraryGame>,
    missing_reported: &HashSet<u32>,
) -> (Vec<u32>, Vec<u32>) {
    // Newly installed: fully installed now, was not fully installed at
    // the baseline. A library game that was already installed is in
    // `previous` (seeded from the library), so it never re-announces.
    // Present-but-not-fully-installed manifests (mid-download) never
    // emit: the game isn't playable yet.
    let newly_installed: Vec<u32> = current
        .iter()
        .filter(|(appid, fully)| {
            **fully
                && library.contains_key(*appid)
                && !matches!(previous.get(*appid), Some(true))
        })
        .map(|(appid, _)| *appid)
        .collect();

    // A game is uninstalled only when its appmanifest disappears from
    // disk entirely. Steam deletes the manifest on uninstall; an update
    // keeps it and merely flips `StateFlags`, so a present-but-not-
    // installed manifest must never count as an uninstall. `previous`
    // carries both the library-seeded baseline and last scan's observed
    // manifests, covering the case where the library flag lags behind.
    let mut uninstalled: Vec<u32> = Vec::new();
    let candidates = library
        .iter()
        .filter(|(_, game)| game.installed)
        .map(|(appid, _)| *appid)
        .chain(previous.keys().copied());
    for appid in candidates {
        if current.contains_key(&appid) {
            continue;
        }
        if !library.contains_key(&appid) {
            continue;
        }
        if missing_reported.contains(&appid) || uninstalled.contains(&appid) {
            continue;
        }
        uninstalled.push(appid);
    }

    (newly_installed, uninstalled)
}

/// Whether the contents of a present manifest must be read to learn its
/// fully-installed state.
///
/// Only a manifest that wasn't already known fully installed can carry a
/// *new* `StateFlags` value worth reading: a known-installed app stays
/// installed while its manifest exists (Steam deleting the manifest is
/// the uninstall signal, handled by presence), and an update's transient
/// not-fully-installed state must not be re-announced as an install when
/// it completes. Everything else — newly appeared manifests, and ones
/// last seen mid-download — is read. This is what keeps a steady poll in
/// a large library free of manifest reads.
pub(crate) fn manifest_state_needs_read(previous: &HashMap<u32, bool>, appid: u32) -> bool {
    !matches!(previous.get(&appid), Some(true))
}

/// Resolve the fully-installed state of every present manifest, reading
/// only the manifests [`manifest_state_needs_read`] flags. Uninstall
/// detection is purely presence-based, so a warmed-up poll performs one
/// directory listing per library and no file reads at all.
pub(crate) fn resolve_manifest_states(
    paths: &HashMap<u32, PathBuf>,
    previous: &HashMap<u32, bool>,
) -> HashMap<u32, bool> {
    let mut current = HashMap::with_capacity(paths.len());
    for (appid, manifest_path) in paths {
        let fully_installed = if manifest_state_needs_read(previous, *appid) {
            match std::fs::read_to_string(manifest_path) {
                Ok(raw) => steam_game_watcher::parse_appmanifest(&raw, *appid)
                    .map(|parsed| parsed.is_fully_installed())
                    .unwrap_or(true), // unparseable → assume installed
                Err(_) => true, // unreadable → assume installed
            }
        } else {
            true
        };
        current.insert(*appid, fully_installed);
    }
    current
}

/// Run one Steam manifest scan and emit `steam-install-changed` for every
/// install-state transition. Disk I/O and `resolve_steam_game_exe` are
/// slow, so this runs with the watcher lock released; the caller applies
/// the returned manifest state afterwards via
/// `apply_steam_install_scan`.
pub(crate) fn run_steam_install_scan(
    inputs: SteamScanInputs,
    app_handle: &AppHandle,
) -> (HashMap<u32, bool>, HashSet<u32>) {
    // `None` means a local Steam install can't be located (never
    // installed, uninstalled, or its drive unmounted). The manifest scan
    // would come back empty, but that is not evidence of uninstall — keep
    // the previous state and emit nothing. `Some(empty)` (Steam installed
    // with zero manifests) is a real, empty observation and is diffed
    // normally.
    let Some(paths) = crate::steam::sync::scan_steam_manifest_paths() else {
        return (inputs.previous, inputs.missing_reported);
    };

    let current = resolve_manifest_states(&paths, &inputs.previous);

    // A game whose manifest reappeared is no longer "missing", so a later
    // uninstall is announced again.
    let mut missing_reported = inputs.missing_reported;
    missing_reported.retain(|appid| !current.contains_key(appid));

    let (newly_installed, uninstalled) = diff_steam_install_transitions(
        &current,
        &inputs.previous,
        &inputs.library,
        &missing_reported,
    );

    for appid in newly_installed {
        let name = inputs
            .library
            .get(&appid)
            .map(|g| g.name.clone())
            .unwrap_or_default();
        let exe_path = resolve_steam_game_exe(appid, &name);

        let _ = app_handle.emit(
            "steam-install-changed",
            SteamInstallChangedPayload {
                app_id: appid,
                installed: true,
                exe_path,
            },
        );
    }

    for appid in uninstalled {
        missing_reported.insert(appid);
        let _ = app_handle.emit(
            "steam-install-changed",
            SteamInstallChangedPayload {
                app_id: appid,
                installed: false,
                exe_path: None,
            },
        );
    }

    (current, missing_reported)
}

// ─── GameWatcher ──────────────────────────────────────────────────────────────
