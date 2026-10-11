//! Linux window traits for the in-game overlay.
//!
//! The overlay needs three things from the window system: never steal the
//! game's focus, stay above a fullscreen game, and be placed in a configured
//! corner. X11 and Wayland solve these differently:
//!
//! * **X11** — Tauri's `always_on_top` already maps to `_NET_WM_STATE_ABOVE`,
//!   and its `set_ignore_cursor_events` is a real GDK input shape, so the only
//!   extra work is suppressing focus with the GTK accept-focus hint.
//! * **Wayland** — `always_on_top` is a silent no-op and there is no
//!   input-pass-through protocol at all, so we use wlr-layer-shell
//!   (`Layer::Overlay`, `KeyboardMode::None`) for stacking and anchor the
//!   surface to the configured corner. Pointer clicks inside the small surface
//!   are still captured; the HUD stays small so the game remains clickable
//!   everywhere else.

use std::panic::{catch_unwind, AssertUnwindSafe};

use tauri::WebviewWindow;

/// Apply the Linux-only window traits once, right after the overlay window is
/// built and before its first show. Wayland needs layer-shell initialised
/// before the surface is mapped, so this must run before `show()`.
pub fn configure_window(window: &WebviewWindow) {
    if !crate::linux_desktop::is_wayland() {
        return;
    }
    let window = window.clone();
    let _ = window.run_on_main_thread(move || {
        // A panic here (already-realized window, or a compositor with no
        // layer-shell) must not take down the app.
        let _ = catch_unwind(AssertUnwindSafe(|| init_layer_shell(&window)));
    });
}

fn init_layer_shell(window: &WebviewWindow) {
    use gtk_layer_shell::{KeyboardMode, Layer, LayerShell};

    if !gtk_layer_shell::is_supported() {
        eprintln!(
            "[overlay] wlr-layer-shell unavailable on this compositor; the HUD \
             will not stay above a fullscreen game (GNOME/mutter has no layer-shell)"
        );
        return;
    }
    let Ok(gtk_window) = window.gtk_window() else {
        return;
    };
    gtk_window.init_layer_shell();
    gtk_window.set_namespace("gameindex-overlay");
    gtk_window.set_layer(Layer::Overlay);
    // Never take keyboard focus from the game: the portal global shortcuts are
    // how the HUD is driven on Wayland.
    gtk_window.set_keyboard_mode(KeyboardMode::None);
    // Don't reserve space or push other windows around.
    gtk_window.set_exclusive_zone(0);
}

/// Position and size the overlay on Wayland by anchoring the layer surface to
/// the configured corner. Called from `overlay::apply_geometry` in place of the
/// pixel-origin `set_position`/`set_size`, which layer-shell ignores.
pub fn set_geometry(window: &WebviewWindow, corner: &str, width: f64, height: f64, margin: f64) {
    if !crate::linux_desktop::is_wayland() {
        return;
    }
    let corner = corner.to_string();
    let window = window.clone();
    let _ = window.run_on_main_thread(move || {
        let _ = catch_unwind(AssertUnwindSafe(|| {
            use gtk::prelude::*;
            use gtk_layer_shell::{Edge, LayerShell};

            if !gtk_layer_shell::is_supported() {
                return;
            }
            let Ok(gtk_window) = window.gtk_window() else {
                return;
            };
            // Anchor to the configured corner. The two un-anchored edges let
            // the requested size win instead of stretching to the whole screen.
            let (top, bottom, left, right) = match corner.as_str() {
                "top-right" => (true, false, false, true),
                "bottom-left" => (false, true, true, false),
                "bottom-right" => (false, true, false, true),
                _ => (true, false, true, false),
            };
            let m = margin.round() as i32;
            gtk_window.set_anchor(Edge::Top, top);
            gtk_window.set_anchor(Edge::Bottom, bottom);
            gtk_window.set_anchor(Edge::Left, left);
            gtk_window.set_anchor(Edge::Right, right);
            gtk_window.set_layer_shell_margin(Edge::Top, if top { m } else { 0 });
            gtk_window.set_layer_shell_margin(Edge::Bottom, if bottom { m } else { 0 });
            gtk_window.set_layer_shell_margin(Edge::Left, if left { m } else { 0 });
            gtk_window.set_layer_shell_margin(Edge::Right, if right { m } else { 0 });
            gtk_window.resize(width.round() as i32, height.round() as i32);
        }));
    });
}

/// Keep the collapsed HUD from taking focus. On Wayland this is a no-op (the
/// layer-shell keyboard mode is in charge); on X11 it maps to the GTK
/// accept-focus / focus-on-map hints.
pub fn make_non_activating(window: &WebviewWindow) {
    set_accept_focus(window, false);
}

/// Toggle focus acceptance so the expanded panel can receive keyboard input
/// while the collapsed ticker never steals the game's foreground.
pub fn set_activation_style(window: &WebviewWindow, activating: bool) {
    set_accept_focus(window, activating);
    if crate::linux_desktop::is_wayland() {
        set_layer_keyboard_mode(window, activating);
    }
}

fn set_accept_focus(window: &WebviewWindow, accept: bool) {
    let window = window.clone();
    let _ = window.run_on_main_thread(move || {
        use gtk::prelude::*;
        if let Ok(gtk_window) = window.gtk_window() {
            gtk_window.set_accept_focus(accept);
            gtk_window.set_focus_on_map(accept);
        }
    });
}

/// Wayland keyboard focus is controlled by the layer-shell keyboard mode: the
/// collapsed ticker takes none (so the game keeps the keyboard), the expanded
/// panel takes it on demand (so Notes and the hotkey recorder can be typed in).
fn set_layer_keyboard_mode(window: &WebviewWindow, activating: bool) {
    let window = window.clone();
    let _ = window.run_on_main_thread(move || {
        let _ = catch_unwind(AssertUnwindSafe(|| {
            use gtk_layer_shell::{KeyboardMode, LayerShell};
            if !gtk_layer_shell::is_supported() {
                return;
            }
            let Ok(gtk_window) = window.gtk_window() else {
                return;
            };
            gtk_window.set_keyboard_mode(if activating {
                KeyboardMode::OnDemand
            } else {
                KeyboardMode::None
            });
        }));
    });
}

/// Native window backdrop (real behind-the-window blur). Tauri does not support
/// window effects on Linux, so this is a no-op and the frontend keeps its CSS
/// glass. Kept as a function so the overlay's call sites stay platform-uniform.
pub fn apply_native_effect(_window: &WebviewWindow, _color: Option<[u8; 4]>) {}
