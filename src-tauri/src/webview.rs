//! URL fetch + child-webview navigation commands.

use tauri::Manager;

/// Fetch the contents of a URL and return it as text.
/// Used by the News page to fetch RSS feeds without browser CORS restrictions.
#[tauri::command]
pub async fn fetch_url(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent("GameIndex/0.1 (RSS Reader)")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch URL: {}", e))?;

    resp.text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))
}

/// Drive native session-history navigation (back/forward) in a child
/// webview (the WebLinks preview). The JS `Webview` API in this Tauri
/// version doesn't expose goBack/goForward, so we eval
/// `window.history.back()` / `window.history.forward()` inside the
/// webview's own context — that walks the webview's NATIVE session
/// history stack, exactly like a browser's back/forward buttons.
#[tauri::command]
pub fn webview_history_navigate(
    app: tauri::AppHandle,
    label: String,
    direction: String,
) -> Result<(), String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview not found: {label}"))?;
    let js = match direction.as_str() {
        "back" => "window.history.back()",
        "forward" => "window.history.forward()",
        other => return Err(format!("invalid direction: {other}")),
    };
    webview.eval(js).map_err(|e| e.to_string())
}

/// Read the current URL of a child webview. The frontend polls this to
/// track whether back/forward history is available (Tauri's JS API has
/// no canGoBack/canGoForward, so we compare against a local stack).
#[tauri::command]
pub fn webview_current_url(app: tauri::AppHandle, label: String) -> Result<String, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview not found: {label}"))?;
    webview.url().map(|u| u.to_string()).map_err(|e| e.to_string())
}

/// Popup-prevention script injected into the WebLinks preview webview on
/// every page load. Sites like Steam and Reddit use `target="_blank"` /
/// `window.open()` for links; without a handler wry cancels them or spawns
/// blank native windows — the "about:blank" symptom.
const WEBLINKS_PREVIEW_INIT_SCRIPT: &str = r#"(function () {
  var _origOpen = window.open;
  window.open = function (url, target, features) {
    if (url && typeof url === 'string' && /^https?:\/\//i.test(url)) {
      window.location.assign(url);
      return null;
    }
    return _origOpen ? _origOpen.apply(this, arguments) : null;
  };
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('a[target="_blank"]') : null;
    if (el && el.href && /^https?:\/\//i.test(el.href)) {
      el.target = '_self';
    }
  }, true);
})();"#;

// Create the WebLinks preview child webview from Rust so we can attach an
// initialization script (popup handling) and a new-window handler —
// neither exists on the JS `new Webview()` API. The frontend then grabs a
// handle via `Webview.getByLabel` for sizing/visibility. Must be `async`
// so it runs off the main thread: `Window::add_child` internally marshals
// to the main thread and blocks, which would deadlock a sync command.
#[cfg(target_os = "linux")]
thread_local! {
    static OVERLAY_STATE: std::cell::RefCell<Option<LinuxOverlayState>> = const { std::cell::RefCell::new(None) };
}

#[cfg(target_os = "linux")]
struct LinuxOverlayState {
    fixed: gtk::Fixed,
    widgets: std::collections::HashMap<String, gtk::Widget>,
}

/// Create the WebLinks / News preview child webview from Rust.
/// On Windows/macOS, creates an embedded child webview with LogicalPosition/LogicalSize.
/// On Linux (WebKitGTK), moves the child webview from default_vbox into a GtkOverlay
/// GtkFixed container so it positions accurately over the DOM placeholder.
#[tauri::command]
pub async fn create_preview_webview(
    app: tauri::AppHandle,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    use tauri::webview::{NewWindowResponse, WebviewBuilder};
    use tauri::{LogicalPosition, LogicalSize, Position, Size, WebviewUrl};

    let parsed: tauri::Url = url.parse().map_err(|e| format!("invalid webview url '{url}': {e}"))?;
    let main = app
        .get_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    let builder = WebviewBuilder::new(&label, WebviewUrl::External(parsed))
        .initialization_script(WEBLINKS_PREVIEW_INIT_SCRIPT)
        .on_new_window(|_url, _features| NewWindowResponse::Deny);

    #[cfg(not(target_os = "linux"))]
    {
        main.add_child(
            builder,
            Position::Logical(LogicalPosition::new(x, y)),
            Size::Logical(LogicalSize::new(width, height)),
        )
        .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::*;

        main.add_child(
            builder,
            Position::Logical(LogicalPosition::new(x, y)),
            Size::Logical(LogicalSize::new(width, height)),
        )
        .map_err(|e| e.to_string())?;

        let label_clone = label.clone();
        let app_handle = app.clone();
        app.run_on_main_thread(move || {
            let Some(main_win) = app_handle.get_window("main") else {
                return;
            };
            let Ok(gtk_win) = main_win.gtk_window() else {
                return;
            };

            OVERLAY_STATE.with(|state_cell| {
                let mut state_opt = state_cell.borrow_mut();
                if state_opt.is_none() {
                    if let Some(child) = gtk_win.child() {
                        if let Ok(vbox) = child.downcast::<gtk::Box>() {
                            gtk_win.remove(&vbox);
                            let overlay = gtk::Overlay::new();
                            let fixed = gtk::Fixed::new();
                            fixed.show();
                            overlay.add(&vbox);
                            overlay.add_overlay(&fixed);
                            overlay.show();
                            gtk_win.add(&overlay);

                            *state_opt = Some(LinuxOverlayState {
                                fixed,
                                widgets: std::collections::HashMap::new(),
                            });
                        }
                    }
                }

                if let Some(state) = state_opt.as_mut() {
                    if let Some(overlay_widget) = gtk_win.child() {
                        if let Ok(overlay) = overlay_widget.downcast::<gtk::Overlay>() {
                            if let Some(vbox_widget) = overlay.child() {
                                if let Ok(vbox) = vbox_widget.downcast::<gtk::Box>() {
                                    let children = vbox.children();
                                    if children.len() > 1 {
                                        if let Some(preview_widget) = children.last() {
                                            let widget = preview_widget.clone();
                                            vbox.remove(&widget);
                                            state.fixed.put(&widget, x as i32, y as i32);
                                            widget.set_size_request(width as i32, height as i32);
                                            widget.show_all();
                                            state.widgets.insert(label_clone, widget);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            });
        })
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Reposition and resize an active preview webview to track DOM frame geometry.
#[tauri::command]
pub fn reposition_preview_webview(
    app: tauri::AppHandle,
    label: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    #[cfg(not(target_os = "linux"))]
    {
        use tauri::{LogicalPosition, LogicalSize, Position, Size};
        if let Some(webview) = app.get_webview(&label) {
            let _ = webview.set_position(Position::Logical(LogicalPosition::new(x, y)));
            let _ = webview.set_size(Size::Logical(LogicalSize::new(width, height)));
        }
        Ok(())
    }

    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::*;

        app.run_on_main_thread(move || {
            OVERLAY_STATE.with(|state_cell| {
                if let Some(state) = state_cell.borrow_mut().as_mut() {
                    if let Some(widget) = state.widgets.get(&label) {
                        state.fixed.move_(widget, x as i32, y as i32);
                        widget.set_size_request(width as i32, height as i32);
                        widget.queue_resize();
                    }
                }
            });
        })
        .map_err(|e| e.to_string())
    }
}

/// Show or hide a preview webview (e.g. when category menus or DOM modals pop over).
#[tauri::command]
pub fn set_preview_webview_visible(
    app: tauri::AppHandle,
    label: String,
    visible: bool,
) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&label) {
        if visible {
            let _ = webview.show();
        } else {
            let _ = webview.hide();
        }
    }

    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::*;

        app.run_on_main_thread(move || {
            OVERLAY_STATE.with(|state_cell| {
                if let Some(state) = state_cell.borrow_mut().as_mut() {
                    if let Some(widget) = state.widgets.get(&label) {
                        if visible {
                            widget.show();
                        } else {
                            widget.hide();
                        }
                    }
                }
            });
        })
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Close and destroy an active preview webview, removing it from GTK overlay.
#[tauri::command]
pub fn close_preview_webview(app: tauri::AppHandle, label: String) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::*;

        let label_clone = label.clone();
        let _ = app.run_on_main_thread(move || {
            OVERLAY_STATE.with(|state_cell| {
                if let Some(state) = state_cell.borrow_mut().as_mut() {
                    if let Some(widget) = state.widgets.remove(&label_clone) {
                        state.fixed.remove(&widget);
                    }
                }
            });
        });
    }

    if let Some(webview) = app.get_webview(&label) {
        let _ = webview.close();
    }
    Ok(())
}

/// Execute a JS snippet inside a child webview (e.g. for dynamic zoom level scaling).
#[tauri::command]
pub fn webview_eval(app: tauri::AppHandle, label: String, js: String) -> Result<(), String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview not found: {label}"))?;
    webview.eval(&js).map_err(|e| e.to_string())
}


