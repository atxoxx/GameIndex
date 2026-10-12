//! WebKitGTK memory tuning (Linux only).
//!
//! WebKitGTK memoizes decoded images and whole pages far more aggressively
//! than the Chromium/WebView2 engine, and its default cache model is tuned for
//! a browser that navigates between many sites — not a single-page desktop app
//! that mounts and unmounts hundreds of full-resolution cover images. Left at
//! the default, the render process (`WebKitWebProcess`) grows into gigabytes as
//! artwork is browsed. These settings shrink those caches and drop subsystems
//! GameIndex never uses, so evicted images are actually released.

/// Apply memory-reducing WebKit settings to an app-shell webview (main window,
/// overlay, launch splash). No-op on non-Linux targets.
pub fn tune_webview(webview: &tauri::webview::Webview) {
    #[cfg(target_os = "linux")]
    {
        use webkit2gtk::{SettingsExt, WebContextExt, WebViewExt};

        let _ = webview.with_webview(|platform| {
            let view = platform.inner();
            if let Some(settings) = view.settings() {
                // The back/forward page cache keeps whole pages — and their
                // decoded images — alive; this app never navigates its root.
                settings.set_enable_page_cache(false);
                // No WebGL is used anywhere in the UI shell; releasing it frees
                // the GPU context and its texture budget.
                settings.set_enable_webgl(false);
                // No camera/microphone capture.
                settings.set_enable_media_stream(false);
                settings.set_enable_dns_prefetching(false);
            }
            // The memory cache is what retains decoded image resources across
            // the session. `DocumentViewer` is WebKit's minimal-cache model, so
            // evicted images are released instead of being held for a
            // hypothetical future navigation.
            if let Some(context) = view.context() {
                context.set_cache_model(webkit2gtk::CacheModel::DocumentViewer);
            }
        });
    }
    #[cfg(not(target_os = "linux"))]
    let _ = webview;
}

/// Apply the cache-model/page-cache tuning to an embedded webview that renders
/// third-party sites (WebLinks / News / Map / Guides previews). WebGL and
/// media stream are left untouched here because those sites may rely on them.
pub fn tune_embedded_webview(webview: &tauri::webview::Webview) {
    #[cfg(target_os = "linux")]
    {
        use webkit2gtk::{SettingsExt, WebContextExt, WebViewExt};

        let _ = webview.with_webview(|platform| {
            let view = platform.inner();
            if let Some(settings) = view.settings() {
                settings.set_enable_page_cache(false);
                settings.set_enable_dns_prefetching(false);
            }
            if let Some(context) = view.context() {
                context.set_cache_model(webkit2gtk::CacheModel::DocumentViewer);
            }
        });
    }
    #[cfg(not(target_os = "linux"))]
    let _ = webview;
}
