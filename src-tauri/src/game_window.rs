//! Reusable "game detail" window.
//!
//! Middle-click and the *Open in New Window* context-menu entry both land
//! here. The window is a single reusable webview (`game-detail`): asking for
//! another game focuses the existing window and pushes a
//! `game-detail:navigate` event instead of stacking a window per card. The
//! frontend entry is `src/components/GameDetailWindow.tsx`, selected by the
//! `window=detail` discriminator in `src/main.tsx`.
//!
//! The command MUST stay `async` (same reason as `launch_splash`): building a
//! webview on the IPC thread re-enters WebView2 on Windows and deadlocks the
//! message queue.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const GAME_DETAIL_WINDOW_LABEL: &str = "game-detail";
pub const GAME_DETAIL_NAVIGATE_EVENT: &str = "game-detail:navigate";

const DEFAULT_WINDOW_WIDTH: f64 = 1180.0;
const DEFAULT_WINDOW_HEIGHT: f64 = 820.0;
const MIN_WINDOW_WIDTH: f64 = 720.0;
const MIN_WINDOW_HEIGHT: f64 = 540.0;

#[derive(Clone, serde::Serialize)]
struct NavigatePayload {
    route: String,
}

/// Accept only the two detail routes the popout knows how to render. The
/// payload comes from the frontend, so a malformed or unexpected value must
/// never be able to steer the window somewhere else in the app.
fn normalize_route(route: &str) -> Result<String, String> {
    let route = route.trim();
    let has_id = |prefix: &str| {
        route.starts_with(prefix) && route.len() > prefix.len()
    };
    if !has_id("/library/") && !has_id("/store/") {
        return Err(format!("unsupported detail route: {route}"));
    }
    if route
        .chars()
        .any(|c| c.is_control() || c.is_whitespace() || c == '#')
    {
        return Err("detail route contains unsupported characters".to_string());
    }
    Ok(route.to_string())
}

/// Open the detail window for `route`, or re-target the one that is already
/// open. `title` is the native window/taskbar title (the in-window bar is
/// deliberately generic).
#[tauri::command]
pub async fn open_game_detail_window(
    app: AppHandle,
    route: String,
    title: Option<String>,
) -> Result<(), String> {
    let route = normalize_route(&route)?;
    let title = title
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if let Some(window) = app.get_webview_window(GAME_DETAIL_WINDOW_LABEL) {
        if let Some(title) = &title {
            let _ = window.set_title(title);
        }
        let _ = window.unminimize();
        window
            .show()
            .map_err(|e| format!("failed to show the detail window: {e}"))?;
        window
            .set_focus()
            .map_err(|e| format!("failed to focus the detail window: {e}"))?;
        app.emit_to(
            GAME_DETAIL_WINDOW_LABEL,
            GAME_DETAIL_NAVIGATE_EVENT,
            NavigatePayload { route },
        )
        .map_err(|e| format!("failed to navigate the detail window: {e}"))?;
        return Ok(());
    }

    let encoded_route = urlencoding::encode(&route);
    let url = format!("index.html?window=detail&route={encoded_route}");
    let window = WebviewWindowBuilder::new(
        &app,
        GAME_DETAIL_WINDOW_LABEL,
        WebviewUrl::App(url.into()),
    )
    .title(title.unwrap_or_else(|| "GameIndex".to_string()))
    .inner_size(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT)
    .min_inner_size(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
    // Frameless like the main window; the popout draws its own slim title bar.
    .decorations(false)
    .center()
    .build()
    .map_err(|e| format!("failed to create the detail window: {e}"))?;

    if let Some(webview) = app.get_webview(GAME_DETAIL_WINDOW_LABEL) {
        crate::webkit_memory::tune_webview(&webview);
    }
    let _ = window.set_focus();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::normalize_route;

    #[test]
    fn accepts_detail_routes() {
        assert_eq!(
            normalize_route(" /library/abc ").unwrap(),
            "/library/abc",
            "library routes are trimmed and kept"
        );
        assert_eq!(
            normalize_route("/store/hades?tab=reviews").unwrap(),
            "/store/hades?tab=reviews",
            "query strings survive for deep-linked tabs"
        );
    }

    #[test]
    fn rejects_routes_outside_the_detail_window() {
        assert!(normalize_route("/library").is_err());
        assert!(normalize_route("/store/").is_err());
        assert!(normalize_route("/settings").is_err());
        assert!(normalize_route("/library/abc def").is_err());
        assert!(normalize_route("/store/hades#reviews").is_err());
    }
}
