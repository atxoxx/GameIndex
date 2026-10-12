use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::steam_game_watcher;

use super::*;
use super::paths::get_game_root_dir;

/// Build GameRef entries from a list of game data structs.
///
/// Emulator ROMs are filtered out: every ROM of an emulator carries the
/// emulator's executable as its `exe_path`, so keeping them in the process
/// index would make one running emulator process match every ROM — fanning
/// out into N passive sessions (one per ROM) that all get recorded on exit.
/// ROM sessions are only ever tracked through the app-launch path, which
/// registers the exact game_id and never consults the process index.
pub fn build_game_refs_from_library(games: &[GameRefInput]) -> Vec<GameRef> {
    games
        .iter()
        .filter(|g| g.emulator_id.is_none())
        .map(|g| {
            let install_dir = if g.platform == "Steam" {
                g.steam_app_id
                    .and_then(|id| steam_game_watcher::game_install_path(id))
                    .or_else(|| {
                        if !g.exe_path.is_empty() {
                            get_game_root_dir(Path::new(&g.exe_path))
                        } else {
                            None
                        }
                    })
            } else if !g.exe_path.is_empty() {
                get_game_root_dir(Path::new(&g.exe_path))
            } else {
                None
            };

            GameRef {
                game_id: g.game_id.clone(),
                game_name: g.game_name.clone(),
                platform: g.platform.clone(),
                exe_path: if g.exe_path.is_empty() {
                    None
                } else {
                    Some(g.exe_path.clone())
                },
                install_dir,
                steam_app_id: g.steam_app_id,
                installed: g.installed,
            }
        })
        .collect()
}

// Inbound payload from the frontend `rebuild_watcher_index` Tauri
// command. The JS sender (GameContext.tsx) sends camelCase keys
// (`gameId`, `gameName`, `exePath`, `steamAppId`); without this
// attribute serde would reject the payload as missing `game_id`
// etc. Every other inbound Tauri struct in lib.rs already uses
// `rename_all = "camelCase"` — this one was the outlier and tripped
// the IPC deserializer on every startup of a populated library.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameRefInput {
    pub game_id: String,
    pub game_name: String,
    pub platform: String,
    pub exe_path: String,
    pub steam_app_id: Option<u32>,
    /// Library's current `installed` flag. Drives the Steam install
    /// scan's baseline so a game installed/uninstalled while the app was
    /// closed is reconciled on the next scan. `#[serde(default)]` keeps
    /// older frontend payloads (which omitted it) deserializing to
    /// `false`.
    #[serde(default)]
    pub installed: bool,
    /// Emulator linkage when the game is a scanned ROM. Every ROM of one
    /// emulator shares the emulator's executable as its exe path, so a
    /// single running emulator process would match every ROM in the
    /// process index. Emulator games are excluded from passive detection
    /// (see `build_game_refs_from_library`) — only app-launched sessions
    /// (which register the exact game_id via `register_launched_session`)
    /// record ROM sessions.
    pub emulator_id: Option<String>,
}

// ─── Tests ────────────────────────────────────────────────────────────────────
