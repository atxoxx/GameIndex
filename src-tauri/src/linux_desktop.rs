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
}
