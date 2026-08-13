//! In-App Browser Resolver & Download Interceptor
//!
//! Spawns a dedicated WebviewWindow so users can solve CAPTCHAs,
//! countdown timers, Cloudflare checks, or login on file hosters / locker sites.
//! Intercepts navigation to file downloads and magnet links, captures session
//! headers/cookies, and automatically starts the download inside GameIndex.

use serde::{Deserialize, Serialize};
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

const RESOLVER_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResolverResult {
    pub intercepted: bool,
    pub url: Option<String>,
    pub filename: Option<String>,
    pub download_id: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone)]
struct InterceptedPayload {
    url: String,
    filename: String,
    referer: Option<String>,
}

/// Determine if a URL targets a downloadable archive, disk image, binary,
/// torrent metadata, or magnet URI.
pub fn is_downloadable_url(url_str: &str) -> bool {
    let trimmed = url_str.trim();
    if trimmed.starts_with("magnet:") {
        return true;
    }

    let Ok(parsed) = url::Url::parse(trimmed) else {
        return false;
    };

    // Ignore non-HTTP(S) schemes
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return false;
    }

    let exts = [
        ".torrent", ".zip", ".rar", ".7z", ".iso", ".exe", ".bin", ".pkg",
        ".tar", ".gz", ".xz", ".zst", ".tar.gz", ".tar.xz", ".tar.zst",
        ".dmg", ".apk", ".nsp", ".xci", ".cia", ".wua", ".rvz", ".chd",
        ".cso", ".gdi", ".cdi", ".vpk", ".msi", ".appimage", ".rpm", ".deb",
    ];

    let path = parsed.path().to_lowercase();
    for ext in &exts {
        if path.ends_with(ext) {
            return true;
        }
    }

    // Check if query parameter explicitly ends with or specifies a file extension
    if let Some(query) = parsed.query() {
        let q_lower = query.to_lowercase();
        for ext in &exts {
            if q_lower.ends_with(ext) || q_lower.contains(&format!("{ext}&")) {
                return true;
            }
        }
    }

    false
}

/// Extract clean filename from URL or fall back to game name.
pub fn extract_filename(url_str: &str, fallback_game_name: &str) -> String {
    if url_str.starts_with("magnet:") {
        if let Ok(parsed) = url::Url::parse(url_str) {
            for (k, v) in parsed.query_pairs() {
                if k == "dn" && !v.is_empty() {
                    return v.to_string();
                }
            }
        }
        return format!("{}.torrent", fallback_game_name);
    }

    if let Ok(parsed) = url::Url::parse(url_str) {
        let path = parsed.path();
        if let Some(segment) = path.split('/').filter(|s| !s.is_empty()).last() {
            let unencoded = urlencoding::decode(segment).unwrap_or(std::borrow::Cow::Borrowed(segment));
            if !unencoded.is_empty() && unencoded.contains('.') {
                return unencoded.to_string();
            }
        }
    }

    format!("{}.zip", fallback_game_name)
}

fn generate_init_script(game_name: &str) -> String {
    let safe_game_name = serde_json::to_string(game_name).unwrap_or_else(|_| "\"Game\"".to_string());
    format!(
        r#"
(function() {{
  if (window.__gi_resolver_injected) return;
  window.__gi_resolver_injected = true;

  function sendToGameIndex(url, filename) {{
    if (!url) return;
    let cleanUrl = String(url).trim();
    if (!cleanUrl || cleanUrl.startsWith('javascript:') || cleanUrl === '#') return;
    try {{
      cleanUrl = new URL(cleanUrl, window.location.href).href;
    }} catch (_) {{}}
    console.log('[GI-Resolver] Capturing download:', cleanUrl);
    updateBannerStatus('Capturing download…', true);
    window.location.href = 'gi-capture://' + encodeURIComponent(cleanUrl) + (filename ? ('?filename=' + encodeURIComponent(filename)) : '');
  }}

  function isDownloadUrl(url) {{
    if (!url || typeof url !== 'string') return false;
    const clean = url.trim().toLowerCase();
    if (clean.startsWith('magnet:')) return true;
    const exts = ['.torrent', '.zip', '.rar', '.7z', '.iso', '.exe', '.bin', '.pkg', '.tar', '.gz', '.xz', '.zst', '.dmg', '.apk', '.nsp', '.xci', '.cia', '.rvz', '.chd', '.wua', '.cso'];
    for (const ext of exts) {{
      if (clean.endsWith(ext) || clean.includes(ext + '?') || clean.includes(ext + '&')) {{
        return true;
      }}
    }}
    return false;
  }}

  function updateBannerStatus(msg, isHighlight) {{
    const el = document.getElementById('__gi_resolver_status');
    if (el) {{
      el.textContent = msg;
      if (isHighlight) {{
        el.style.background = '#22c55e';
        el.style.color = '#ffffff';
        el.style.borderColor = '#16a34a';
      }}
    }}
  }}

  function showDetectedButton(url, name) {{
    if (!isDownloadUrl(url)) return;
    const btn = document.getElementById('__gi_resolver_capture_btn');
    if (btn) {{
      btn.style.display = 'inline-flex';
      let cleanUrl = url;
      try {{
        cleanUrl = new URL(url, window.location.href).href;
      }} catch (_) {{}}
      const label = (name ? String(name).trim() : 'Download');
      btn.innerHTML = '⚡ Download Ready — Click to Start (' + (label.length > 20 ? label.substring(0, 20) + '…' : label) + ')';
      btn.onclick = function() {{
        sendToGameIndex(cleanUrl, name);
      }};
    }}
  }}

  function injectBanner() {{
    if (document.getElementById('__gi_resolver_banner')) return;
    const banner = document.createElement('div');
    banner.id = '__gi_resolver_banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;height:46px;background:linear-gradient(135deg,#0f172a 0%,#1e1b4b 100%);color:#f8fafc;font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:13px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;z-index:2147483647;box-shadow:0 4px 14px rgba(0,0,0,0.45);border-bottom:1px solid rgba(255,255,255,0.12);user-select:none;line-height:1;box-sizing:border-box;';
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;font-weight:600;min-width:0;overflow:hidden;">
        <span style="display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:6px;background:#6366f1;color:#fff;font-size:14px;flex-shrink:0;">📥</span>
        <span style="color:#ffffff;font-weight:700;letter-spacing:0.2px;white-space:nowrap;">GameIndex Resolver</span>
        <span style="color:#94a3b8;font-size:12px;font-weight:400;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;">
          Solving for <strong>${{{safe_game_name}}}</strong> — navigate to hoster and start download
        </span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
        <button id="__gi_resolver_capture_btn" style="display:none;align-items:center;gap:6px;background:#22c55e;color:#ffffff;border:1px solid #16a34a;padding:5px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">
          ⚡ Download Ready
        </button>
        <button id="__gi_resolver_manual_btn" style="display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,0.1);color:#f1f5f9;border:1px solid rgba(255,255,255,0.2);padding:5px 10px;border-radius:6px;font-size:11px;font-weight:500;cursor:pointer;">
          Capture Current Link
        </button>
        <span id="__gi_resolver_status" style="font-size:11px;color:#a5b4fc;background:rgba(99,102,241,0.2);padding:4px 8px;border-radius:4px;border:1px solid rgba(99,102,241,0.4);">
          Auto-intercept active
        </span>
      </div>
    `;
    if (document.body) {{
      document.body.prepend(banner);
      try {{
        const curMargin = parseInt(window.getComputedStyle(document.body).marginTop || '0', 10) || 0;
        document.body.style.marginTop = (curMargin + 46) + 'px';
      }} catch (_) {{}}
    }}
    const manualBtn = document.getElementById('__gi_resolver_manual_btn');
    if (manualBtn) {{
      manualBtn.onclick = function() {{
        sendToGameIndex(window.location.href, document.title);
      }};
    }}
  }}

  if (document.readyState === 'loading') {{
    document.addEventListener('DOMContentLoaded', injectBanner);
  }} else {{
    injectBanner();
  }}

  // 1. Hook window.open to prevent popup blocking and stay in this window
  const _origOpen = window.open;
  window.open = function(url) {{
    if (url && typeof url === 'string') {{
      if (isDownloadUrl(url)) {{
        sendToGameIndex(url);
        return null;
      }}
      window.location.href = url;
      return null;
    }}
    return _origOpen ? _origOpen.apply(this, arguments) : null;
  }};

  // 2. Hook HTMLAnchorElement.prototype.click
  const _origAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function() {{
    const href = this.href;
    if (href && (isDownloadUrl(href) || this.hasAttribute('download'))) {{
      sendToGameIndex(href, this.getAttribute('download') || this.innerText);
      return;
    }}
    return _origAnchorClick.apply(this, arguments);
  }};

  // 3. Global click interceptor (capturing phase)
  document.addEventListener('click', function(e) {{
    const target = e.target;
    if (!target) return;
    
    // Ignore clicks on our banner
    if (target.closest && target.closest('#__gi_resolver_banner')) return;

    const el = target.closest('a, button, [role="button"], input[type="submit"], input[type="button"], .btn');
    if (!el) return;

    // Convert target=_blank to _self so popups stay inside this window
    if (el.tagName === 'A' && el.target === '_blank') {{
      el.target = '_self';
    }}

    const href = el.href || el.getAttribute('data-url') || el.getAttribute('data-href') || el.getAttribute('data-download');
    if (href && typeof href === 'string') {{
      if (isDownloadUrl(href) || el.hasAttribute('download')) {{
        e.preventDefault();
        e.stopPropagation();
        sendToGameIndex(href, el.getAttribute('download') || el.innerText);
        return;
      }}
    }}
  }}, true);

  // 4. Hook fetch to detect direct file URLs from background API responses
  const _origFetch = window.fetch;
  window.fetch = async function() {{
    const res = await _origFetch.apply(this, arguments);
    try {{
      const clone = res.clone();
      clone.json().then(data => {{
        if (data && typeof data === 'object') {{
          const possible = data.url || data.downloadUrl || data.download_url || data.directUrl || data.direct_url || data.link || data.download || data.file_url || data.fileUrl;
          if (possible && typeof possible === 'string' && isDownloadUrl(possible)) {{
            showDetectedButton(possible, data.filename || data.name || data.file_name);
          }}
        }}
      }}).catch(() => {{}});
    }} catch (_) {{}}
    return res;
  }};
}})();
"#
    )
}

#[tauri::command]
pub async fn open_download_resolver(
    app: AppHandle,
    url: String,
    game_name: String,
    game_id: Option<String>,
    save_path: Option<String>,
    auto_extract: Option<bool>,
    source_name: Option<String>,
) -> Result<DownloadResolverResult, String> {
    let parsed_url: url::Url = url
        .parse()
        .map_err(|e| format!("Invalid initial URL '{url}': {e}"))?;

    let window_id = format!("download-resolver-{}", rand::random::<u32>());
    let window_title = format!("GameIndex Browser — {}", game_name);

    let (tx, rx) = mpsc::channel::<InterceptedPayload>();
    let init_script = generate_init_script(&game_name);

    let fallback_game = game_name.clone();

    let tx_dl = tx.clone();
    let fallback_game_dl = fallback_game.clone();
    let tx_nav = tx.clone();
    let fallback_game_nav = fallback_game.clone();

    let webview = WebviewWindowBuilder::new(
        &app,
        &window_id,
        WebviewUrl::External(parsed_url),
    )
    .title(&window_title)
    .inner_size(1080.0, 740.0)
    .center()
    .resizable(true)
    .user_agent(RESOLVER_UA)
    .initialization_script(&init_script)
    .on_download(move |_webview, event| {
        match event {
            tauri::webview::DownloadEvent::Requested { url, destination } => {
                let url_str = url.as_str().to_string();
                let filename = destination
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| extract_filename(&url_str, &fallback_game_dl));
                let _ = tx_dl.send(InterceptedPayload {
                    url: url_str,
                    filename,
                    referer: None,
                });
                false
            }
            _ => true,
        }
    })
    .on_navigation(move |nav_url| {
        let nav_str = nav_url.as_str();

        // 1. Custom scheme from injected script
        if nav_str.starts_with("gi-capture://") {
            let encoded_part = &nav_str["gi-capture://".len()..];
            let (url_part, filename_part) = if let Some(idx) = encoded_part.find("?filename=") {
                let u = &encoded_part[..idx];
                let f = &encoded_part[idx + "?filename=".len()..];
                (u, Some(f))
            } else {
                (encoded_part, None)
            };

            let decoded_url = urlencoding::decode(url_part)
                .map(|s| s.into_owned())
                .unwrap_or_else(|_| url_part.to_string());

            let filename = filename_part
                .and_then(|f| urlencoding::decode(f).ok().map(|s| s.into_owned()))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| extract_filename(&decoded_url, &fallback_game_nav));

            let _ = tx_nav.send(InterceptedPayload {
                url: decoded_url,
                filename,
                referer: None,
            });
            return false;
        }

        // 2. Direct downloadable URL
        if is_downloadable_url(nav_str) {
            let filename = extract_filename(nav_str, &fallback_game_nav);
            let _ = tx_nav.send(InterceptedPayload {
                url: nav_str.to_string(),
                filename,
                referer: None,
            });
            // Stop webview from downloading file into OS temp folder
            return false;
        }
        true
    })
    .build()
    .map_err(|e| format!("Failed to open browser resolver window: {e}"))?;

    // Await either download interception or user closing the window
    let timeout = Duration::from_secs(600); // 10 minute user resolution window
    let wait_res = tokio::task::spawn_blocking(move || rx.recv_timeout(timeout)).await;

    // Snapshot cookies and session tokens BEFORE closing the webview window
    let cookies_list = webview.cookies().unwrap_or_default();
    let cookie_header = cookies_list
        .iter()
        .map(|c| format!("{}={}", c.name(), c.value()))
        .collect::<Vec<_>>()
        .join("; ");

    let intercepted_item = match wait_res {
        Ok(Ok(payload)) => Some(payload),
        _ => None,
    };

    // Close the resolver webview window if still open
    let _ = webview.close();

    if let Some(payload) = intercepted_item {
        let is_magnet_or_torrent =
            payload.url.starts_with("magnet:") || payload.url.to_lowercase().ends_with(".torrent");

        let resolved_save_path = save_path.unwrap_or_else(|| {
            app.path()
                .download_dir()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| std::env::temp_dir().to_string_lossy().to_string())
        });

        let source = source_name.unwrap_or_else(|| "Web Resolver".to_string());

        let download_id = if is_magnet_or_torrent {
            // Queue via torrent engine
            match crate::downloads::torrent_add(
                payload.url.clone(),
                resolved_save_path,
                game_id.clone(),
                source.clone(),
                auto_extract,
                None,
                payload.referer.clone(),
            )
            .await
            {
                Ok(dl) => Some(dl.id),
                Err(err) => {
                    eprintln!("[browser_resolver] failed to queue torrent download: {err}");
                    None
                }
            }
        } else {
            // Queue via direct HTTP download engine with captured browser session headers
            let id = format!("dl_{}_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0), rand::random::<u16>());
            
            let mut extra_headers = Vec::new();
            extra_headers.push(("User-Agent".to_string(), RESOLVER_UA.to_string()));
            if !cookie_header.is_empty() {
                extra_headers.push(("Cookie".to_string(), cookie_header));
            }
            let referer_val = payload.referer.clone().unwrap_or_else(|| url.clone());
            extra_headers.push(("Referer".to_string(), referer_val.clone()));

            match crate::downloads::direct_download_start(
                id.clone(),
                payload.url.clone(),
                resolved_save_path,
                game_id.clone(),
                source.clone(),
                auto_extract,
                None,
                Some(referer_val),
                Some(extra_headers),
            )
            .await
            {
                Ok(dl) => Some(dl.id),
                Err(err) => {
                    eprintln!("[browser_resolver] failed to queue direct download: {err}");
                    None
                }
            }
        };

        // Notify frontend main window
        let _ = app.emit(
            "download-intercepted",
            serde_json::json!({
                "gameName": game_name,
                "url": payload.url,
                "filename": payload.filename,
                "downloadId": download_id,
            }),
        );

        Ok(DownloadResolverResult {
            intercepted: true,
            url: Some(payload.url),
            filename: Some(payload.filename),
            download_id,
            message: Some("Download captured successfully".to_string()),
        })
    } else {
        Ok(DownloadResolverResult {
            intercepted: false,
            url: None,
            filename: None,
            download_id: None,
            message: Some("Resolver window was closed without capturing a download".to_string()),
        })
    }
}
