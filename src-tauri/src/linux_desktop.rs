//! Linux display-server detection.
//!
//! The overlay's Linux behaviour forks hard on the display server. X11 gives us
//! `x11rb` screen capture, EWMH always-on-top and real per-window click-through;
//! Wayland needs the XDG Desktop Portal (capture, global hotkeys) plus
//! wlr-layer-shell (always-on-top) and cannot do input pass-through at all.
//! Knowing which one we are on lets each subsystem take the path that can
//! actually work instead of silently no-op'ing.

/// The display server the app is running against.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DisplayServer {
    X11,
    Wayland,
    /// Headless / unknown — callers should degrade to best-effort.
    Unknown,
}

/// Pure classifier so the env-var plumbing stays testable. `GDK_BACKEND` wins
/// when it names a concrete backend: it decides which backend GTK will actually
/// use, so a Wayland session forced onto `x11` is really XWayland and should be
/// treated as X11.
pub fn classify(
    gdk_backend: Option<&str>,
    has_wayland_display: bool,
    session_type: Option<&str>,
    has_display: bool,
) -> DisplayServer {
    if let Some(backend) = gdk_backend {
        match backend
            .split(',')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "x11" => return DisplayServer::X11,
            "wayland" => return DisplayServer::Wayland,
            _ => {}
        }
    }
    if has_wayland_display {
        return DisplayServer::Wayland;
    }
    match session_type.map(|s| s.to_ascii_lowercase()).as_deref() {
        Some("wayland") => return DisplayServer::Wayland,
        Some("x11") => return DisplayServer::X11,
        _ => {}
    }
    if has_display {
        return DisplayServer::X11;
    }
    DisplayServer::Unknown
}

/// Detect the display server from the environment. Reads `GDK_BACKEND`,
/// `WAYLAND_DISPLAY`, `XDG_SESSION_TYPE` and `DISPLAY`, in that precedence.
pub fn detect() -> DisplayServer {
    classify(
        std::env::var("GDK_BACKEND").ok().as_deref(),
        std::env::var_os("WAYLAND_DISPLAY").is_some(),
        std::env::var("XDG_SESSION_TYPE").ok().as_deref(),
        std::env::var_os("DISPLAY").is_some(),
    )
}

pub fn is_wayland() -> bool {
    detect() == DisplayServer::Wayland
}

pub fn is_x11() -> bool {
    detect() == DisplayServer::X11
}

/// Short label for logs and settings notices.
pub fn describe() -> &'static str {
    match detect() {
        DisplayServer::X11 => "X11",
        DisplayServer::Wayland => "Wayland",
        DisplayServer::Unknown => "unknown display server",
    }
}

/// Machine-readable display-server token for the frontend, which forks its
/// window drag/resize handling on Wayland (layer surfaces cannot use the native
/// move/resize path).
pub fn server() -> &'static str {
    match detect() {
        DisplayServer::X11 => "x11",
        DisplayServer::Wayland => "wayland",
        DisplayServer::Unknown => "other",
    }
}

/// Application id registered with the XDG Desktop Portal.
///
/// Modern `xdg-desktop-portal` refuses to open a `GlobalShortcuts` session for
/// a process without an id ("An app id is required"), and resolves the id
/// against an installed `<app-id>.desktop` entry. The id must contain a dot and
/// match the desktop entry's basename.
pub const PORTAL_APP_ID: &str = "com.gameindex.app";

/// Ensure the desktop entry the portal validates [`PORTAL_APP_ID`] against
/// exists and points at this executable.
///
/// The portal requires `…/applications/<app-id>.desktop` to exist and its
/// `Exec` to resolve to a real binary. An AppImage runs from a per-launch mount
/// that is not on the user's `PATH` (and the `$APPIMAGE` variable cannot be
/// trusted: a launcher that is itself an AppImage leaks its own path into our
/// environment), so the entry points at the running executable and is
/// (re)written on each start. `NoDisplay` keeps it out of application menus —
/// the bundled `GameIndex.desktop` stays the user-facing entry.
pub fn ensure_portal_desktop_entry() {
    let Ok(exec) = std::env::current_exe() else {
        return;
    };
    let Some(dir) = portal_applications_dir() else {
        return;
    };

    let path = dir.join(format!("{PORTAL_APP_ID}.desktop"));
    let contents = portal_desktop_entry(&exec);
    if std::fs::read_to_string(&path).ok().as_deref() == Some(contents.as_str()) {
        return;
    }
    if std::fs::create_dir_all(&dir).is_ok() {
        let _ = std::fs::write(&path, contents);
    }
}

/// The desktop entry body written by [`ensure_portal_desktop_entry`]. Pure so
/// it can be unit-tested.
fn portal_desktop_entry(exec: &std::path::Path) -> String {
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=GameIndex\n\
         Comment=Unified game library manager\n\
         Exec=\"{}\"\n\
         Icon=gameindex\n\
         Categories=Game;\n\
         NoDisplay=true\n",
        exec.display()
    )
}

/// The per-user `applications` directory the portal searches first:
/// `$XDG_DATA_HOME/applications`, falling back to `~/.local/share/applications`.
fn portal_applications_dir() -> Option<std::path::PathBuf> {
    if let Some(data_home) = std::env::var_os("XDG_DATA_HOME").filter(|value| !value.is_empty()) {
        return Some(std::path::PathBuf::from(data_home).join("applications"));
    }
    let home = std::env::var_os("HOME")?;
    Some(
        std::path::PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("applications"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_x11_backend_wins_over_a_wayland_session() {
        // XWayland: a Wayland session with GDK forced to x11 must behave as X11.
        assert_eq!(
            classify(Some("x11"), true, Some("wayland"), true),
            DisplayServer::X11
        );
    }

    #[test]
    fn the_comma_list_backend_uses_its_first_entry() {
        // `main.rs` sets `GDK_BACKEND=wayland,x11`, i.e. prefer Wayland.
        assert_eq!(
            classify(Some("wayland,x11"), false, None, true),
            DisplayServer::Wayland
        );
        assert_eq!(
            classify(Some("x11,wayland"), false, None, true),
            DisplayServer::X11
        );
    }

    #[test]
    fn falls_back_through_wayland_display_then_session_then_display() {
        assert_eq!(classify(None, true, None, false), DisplayServer::Wayland);
        assert_eq!(
            classify(None, false, Some("wayland"), false),
            DisplayServer::Wayland
        );
        assert_eq!(classify(None, false, Some("x11"), true), DisplayServer::X11);
        assert_eq!(classify(None, false, None, true), DisplayServer::X11);
    }

    #[test]
    fn headless_environment_is_unknown() {
        assert_eq!(classify(None, false, None, false), DisplayServer::Unknown);
    }

    #[test]
    fn portal_desktop_entry_names_the_app_id_and_quotes_exec() {
        let entry = portal_desktop_entry(std::path::Path::new("/tmp/mount with space/gameindex"));
        assert!(entry.starts_with("[Desktop Entry]\n"));
        assert!(entry.contains("Icon=gameindex\n"));
        // The portal validates the exec binary, and the AppImage mount can
        // contain spaces, so it must be quoted.
        assert!(entry.contains("Exec=\"/tmp/mount with space/gameindex\"\n"));
        assert!(entry.contains("NoDisplay=true\n"));
    }
}
