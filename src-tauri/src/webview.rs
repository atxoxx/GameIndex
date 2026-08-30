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

/// Create the WebLinks preview child webview from Rust so we can attach an
/// initialization script (popup handling) and a new-window handler —
/// neither exists on the JS `new Webview()` API. The frontend then grabs a
/// handle via `Webview.getByLabel` for sizing/visibility. Must be `async`
/// so it runs off the main thread: `Window::add_child` internally marshals
/// to the main thread and blocks, which would deadlock a sync command.
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

    let builder = WebviewBuilder::new(label, WebviewUrl::External(parsed))
        .initialization_script(WEBLINKS_PREVIEW_INIT_SCRIPT)
        .on_new_window(|_url, _features| NewWindowResponse::Deny);

    main.add_child(
        builder,
        Position::Logical(LogicalPosition::new(x, y)),
        Size::Logical(LogicalSize::new(width, height)),
    )
    .map_err(|e| e.to_string())?;
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

