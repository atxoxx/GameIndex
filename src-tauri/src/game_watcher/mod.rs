//! Unified game watcher — process detection, session tracking, and smarter exe
//! resolution.
//!
//! Replaces the old split between `launch_game` (child.wait() for local games),
//! `spawn_game_exe` + `watch_steam_game` (WMI polling for Steam), and the
//! "largest .exe" heuristic in `steam/sync.rs`.
//!
//! A single background thread polls running processes, matches them against
//! the library's process index, and tracks each session — whether it was
//! launched through the app or detected passively. Public items are re-exported
//! here so `crate::game_watcher::Foo` keeps resolving across the app.

mod force_close;
mod library;
mod paths;
mod poll;
mod process;
mod resolve;
mod session;
mod steam_install;
mod types;
mod watcher;

#[cfg(test)]
mod tests;

pub use self::force_close::*;
pub use self::library::*;
pub use self::poll::*;
pub use self::resolve::*;
pub use self::types::*;
pub use self::watcher::*;

pub(crate) use self::process::snapshot_processes;
