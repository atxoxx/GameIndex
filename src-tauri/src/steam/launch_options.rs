//! Best-effort Steam launch-action detection.
//!
//! Steam's local `appcache/appinfo.vdf` declares every launch action a
//! game exposes (each entry under `config → launch` in the app's
//! section). We count them so the edit modal can hint about the
//! "show Steam launch picker" option, which routes launches through
//! `steam://launch/<appid>/dialog` (Steam's choose-executable/action
//! window) instead of the plain `steam://run/<appid>`.
//!
//! Everything here is a hint: no Steam install, an unreadable or
//! missing `appinfo.vdf`, a parse failure, or an unknown app all
//! degrade to an empty vec — never an error surfaced to the user.

use std::borrow::Cow;

use serde::Serialize;
use steam_vdf_parser::{Obj, Value};

/// One launch action Steam exposes for a game (an entry under the
/// app's `config → launch` object in appinfo.vdf).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamLaunchOption {
    pub index: i64,
    pub description: String,
    pub executable: String,
}

/// Steam client launch URL for an app.
///
/// With `show_selection` the `steam://launch/<appid>/dialog` form is
/// used — Steam pops its choose-executable/action window for games with
/// multiple launch actions and launches the default action directly
/// otherwise. Without it we use the plain `steam://run/<appid>`.
pub fn steam_launch_url(app_id: u32, show_selection: bool) -> String {
    if show_selection {
        format!("steam://launch/{}/dialog", app_id)
    } else {
        format!("steam://run/{}", app_id)
    }
}

/// Enumerate the launch actions Steam's local `appcache/appinfo.vdf`
/// declares for `steam_app_id`, ordered by launch index.
pub fn steam_launch_options(steam_app_id: u32) -> Vec<SteamLaunchOption> {
    let Some(steam_root) = crate::steam_game_watcher::find_steam_install_dir() else {
        return Vec::new();
    };
    let bytes = match std::fs::read(steam_root.join("appcache").join("appinfo.vdf")) {
        Ok(bytes) => bytes,
        Err(_) => return Vec::new(),
    };
    // `Vdf` borrows from `bytes`, so all navigation happens while it
    // lives — the owned `SteamLaunchOption`s we build don't outlive it.
    let vdf = match steam_vdf_parser::parse_appinfo(&bytes) {
        Ok(vdf) => vdf,
        Err(_) => return Vec::new(),
    };
    let Some(app_entry) = vdf
        .as_obj()
        .and_then(|apps| apps.get(&steam_app_id.to_string()))
        .and_then(|value| value.as_obj())
    else {
        return Vec::new();
    };
    launch_options_from_app_entry(app_entry)
}

/// Extract the launch options from an app entry's `config → launch`
/// object.
///
/// Real appinfo.vdf files nest `config` (and `common`) under an
/// `appinfo` key — `app_entry → appinfo → config → launch`. We also
/// tolerate a simplified flat layout (`app_entry → config → launch`)
/// in case a future/third-party appinfo shape drops the wrapper.
fn launch_options_from_app_entry<'a>(app_entry: &Obj<'a>) -> Vec<SteamLaunchOption> {
    let Some(launch) = nested_launch_obj(app_entry) else {
        return Vec::new();
    };
    let mut options: Vec<SteamLaunchOption> = launch
        .iter()
        .filter_map(|(index_key, entry)| launch_option_from_entry(index_key, entry))
        .collect();
    options.sort_by_key(|option| option.index);
    options
}

/// Locate the `config → launch` object for an app entry, trying the
/// canonical `appinfo`-wrapped layout first and a flat layout second.
fn nested_launch_obj<'a, 'text>(app_entry: &'a Obj<'text>) -> Option<&'a Obj<'text>> {
    let config = app_entry
        .get("appinfo")
        .and_then(|value| value.as_obj())
        .and_then(|appinfo| appinfo.get("config"))
        .or_else(|| app_entry.get("config"))
        .and_then(|value| value.as_obj())?;
    config.get("launch").and_then(|value| value.as_obj())
}

/// Build one `SteamLaunchOption` from a single `config → launch` entry
/// (`"0" { "description" "...", "executable" "..." }`). The entry key
/// is the launch index. Entries with a non-numeric key (or a
/// non-object value) are skipped.
fn launch_option_from_entry<'a>(
    index_key: &Cow<'a, str>,
    entry: &Value<'a>,
) -> Option<SteamLaunchOption> {
    let index = index_key.parse::<i64>().ok()?;
    let entry_obj = entry.as_obj()?;
    let description = entry_obj
        .get("description")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    let executable = entry_obj
        .get("executable")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    Some(SteamLaunchOption {
        index,
        description,
        executable,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build an app entry with the canonical `appinfo → config →
    /// launch` nesting around the given launch object.
    fn app_entry_with_launch(launch: Obj<'static>) -> Obj<'static> {
        let mut config = Obj::new();
        config.insert("launch", Value::from(launch));
        let mut appinfo = Obj::new();
        appinfo.insert("config", Value::from(config));
        let mut app_entry = Obj::new();
        app_entry.insert("appinfo", Value::from(appinfo));
        app_entry
    }

    fn launch_entry(description: &'static str, executable: &'static str) -> Obj<'static> {
        let mut entry = Obj::new();
        entry.insert("description", Value::from(description));
        entry.insert("executable", Value::from(executable));
        entry
    }

    #[test]
    fn steam_launch_url_picker_vs_plain() {
        assert_eq!(steam_launch_url(730, true), "steam://launch/730/dialog");
        assert_eq!(steam_launch_url(730, false), "steam://run/730");
        assert_eq!(steam_launch_url(440, true), "steam://launch/440/dialog");
        assert_eq!(steam_launch_url(440, false), "steam://run/440");
    }

    #[test]
    fn launch_options_ordered_by_index() {
        let mut launch = Obj::new();
        launch.insert("1", Value::from(launch_entry("Launch with mods", "mod_launcher.exe")));
        launch.insert("0", Value::from(launch_entry("Play", "game.exe")));
        let app_entry = app_entry_with_launch(launch);

        let options = launch_options_from_app_entry(&app_entry);
        assert_eq!(options.len(), 2);
        assert_eq!(options[0].index, 0);
        assert_eq!(options[0].description, "Play");
        assert_eq!(options[0].executable, "game.exe");
        assert_eq!(options[1].index, 1);
        assert_eq!(options[1].description, "Launch with mods");
        assert_eq!(options[1].executable, "mod_launcher.exe");
    }

    #[test]
    fn launch_options_skip_non_numeric_entries() {
        let mut launch = Obj::new();
        launch.insert("0", Value::from(launch_entry("Play", "game.exe")));
        launch.insert("beta", Value::from(launch_entry("Beta", "beta.exe")));
        launch.insert("abc", Value::from(launch_entry("Ignored", "ignored.exe")));
        let app_entry = app_entry_with_launch(launch);

        let options = launch_options_from_app_entry(&app_entry);
        assert_eq!(options.len(), 1);
        assert_eq!(options[0].index, 0);
    }

    #[test]
    fn launch_options_tolerate_flat_config_layout() {
        // No `appinfo` wrapper: `config → launch` sits directly on the
        // app entry. The fallback path must still find it.
        let mut launch = Obj::new();
        launch.insert("0", Value::from(launch_entry("Play", "game.exe")));
        let mut config = Obj::new();
        config.insert("launch", Value::from(launch));
        let mut app_entry = Obj::new();
        app_entry.insert("config", Value::from(config));

        let options = launch_options_from_app_entry(&app_entry);
        assert_eq!(options.len(), 1);
        assert_eq!(options[0].executable, "game.exe");
    }

    #[test]
    fn launch_options_empty_without_launch_section() {
        let app_entry = Obj::new();
        assert!(launch_options_from_app_entry(&app_entry).is_empty());
    }
}
