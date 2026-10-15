#[cfg(target_os = "linux")]
use std::path::{Path, PathBuf};
#[cfg(target_os = "linux")]
use std::process::Command;

/// Remove AppImage `AppRun` paths from a child command's environment.
///
/// `AppRun` exports `PYTHONHOME`/`PYTHONPATH` pointing at the ephemeral mount
/// and prepends the mount to `LD_LIBRARY_PATH`. Spawning a system tool with
/// those still set breaks it — `umu-run` and Proton's Python launcher abort
/// with "Failed to import encodings module" because the system Python reads a
/// foreign stdlib. Only entries under `APPDIR` are dropped; paths the user set
/// themselves survive.
#[cfg(target_os = "linux")]
pub(crate) fn strip_appimage_env(cmd: &mut Command) {
    let Some(app_dir) = std::env::var_os("APPDIR") else {
        return;
    };
    let vars = utf8_env_vars();
    let keys = ["PYTHONHOME", "PYTHONPATH", "LD_LIBRARY_PATH"];
    for (key, value) in appimage_env_overrides(&PathBuf::from(app_dir), &vars, &keys) {
        match value {
            Some(value) => {
                cmd.env(key, value);
            }
            None => {
                cmd.env_remove(key);
            }
        }
    }
}

/// Scrub the AppImage Python overrides from our own environment at startup, so
/// every later child (prefix `wineboot`, winetricks, Proton's Python launcher)
/// sees the system Python. `LD_LIBRARY_PATH` is deliberately left alone:
/// WebKit's helper processes rely on the bundled libraries.
#[cfg(target_os = "linux")]
pub fn scrub_appimage_python_env() {
    let Some(app_dir) = std::env::var_os("APPDIR") else {
        return;
    };
    let vars = utf8_env_vars();
    let keys = ["PYTHONHOME", "PYTHONPATH"];
    for (key, value) in appimage_env_overrides(&PathBuf::from(app_dir), &vars, &keys) {
        match value {
            Some(value) => std::env::set_var(&key, value),
            None => std::env::remove_var(&key),
        }
    }
}

#[cfg(target_os = "linux")]
fn utf8_env_vars() -> Vec<(String, String)> {
    std::env::vars_os()
        .filter_map(|(key, value)| Some((key.into_string().ok()?, value.into_string().ok()?)))
        .collect()
}

/// Pure core of the AppImage scrubbers: `(key, Some(replacement))` means the
/// variable keeps only its non-AppImage entries, `(key, None)` means it is
/// removed entirely. Variables with nothing to strip are left untouched.
#[cfg(target_os = "linux")]
pub(crate) fn appimage_env_overrides(
    app_dir: &Path,
    vars: &[(String, String)],
    keys: &[&str],
) -> Vec<(String, Option<String>)> {
    let mut overrides = Vec::new();
    for key in keys {
        let Some((_, value)) = vars.iter().find(|(name, _)| name == key) else {
            continue;
        };
        let entries: Vec<&str> = value.split(':').collect();
        if !entries
            .iter()
            .any(|entry| Path::new(entry).starts_with(app_dir))
        {
            continue;
        }
        let kept: Vec<&str> = entries
            .into_iter()
            .filter(|entry| !entry.is_empty() && !Path::new(entry).starts_with(app_dir))
            .collect();
        overrides.push((
            key.to_string(),
            (!kept.is_empty()).then(|| kept.join(":")),
        ));
    }
    overrides
}
