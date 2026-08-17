//! In-App Browser Resolver & Download Interceptor
//!
//! Spawns a dedicated WebviewWindow so users can solve CAPTCHAs,
//! countdown timers, Cloudflare checks, or login on file hosters / locker sites.
//! Intercepts navigation to file downloads and magnet links, captures session
//! headers/cookies, and automatically starts the download inside GameIndex.
//!
//! The resolver is **non-blocking**: `open_download_resolver` returns a session
//! id immediately, then streams each captured file back to the frontend over
//! the `download-intercepted` event. The window stays open so multi-part
//! releases queue one download per part, and the session ends only when the
//! window is closed (or `close_download_resolver` is called).

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use tauri::webview::{DownloadEvent, NewWindowResponse};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tokio::sync::mpsc;

const RESOLVER_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/// Result returned immediately by `open_download_resolver`. The session runs
/// in the background; progress streams back over events.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolverSessionStarted {
    pub session_id: String,
    pub ok: bool,
    pub message: Option<String>,
}

/// A single intercepted download (or magnet/torrent) captured in the webview.
#[derive(Debug, Clone)]
struct InterceptedPayload {
    url: String,
    filename: String,
    referer: Option<String>,
    cookies: Option<String>,
}

/// Per-session bookkeeping held in the global registry.
struct SessionState {
    /// Sender kept alive for the lifetime of the session so the worker's
    /// receiver only sees `None` once the session is torn down. Never read —
    /// its Drop side effect is what ends the worker's `recv` loop.
    _tx: mpsc::Sender<InterceptedPayload>,
    part_count: usize,
    /// Dedup set so a JS hook + `on_download` firing for the same URL queues
    /// the file exactly once.
    dedup: HashSet<String>,
    /// True when `close_download_resolver` (the "Done" action) ended the
    /// session rather than the user closing the window with the X.
    closed_by_user: bool,
}

/// Global session registry, keyed by the resolver window label.
static SESSIONS: OnceLock<Mutex<HashMap<String, SessionState>>> = OnceLock::new();

fn sessions() -> &'static Mutex<HashMap<String, SessionState>> {
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
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
        ".dmg", ".apk", ".nsp", ".nsz", ".xci", ".xcz", ".cia", ".wua",
        ".rvz", ".chd", ".cso", ".gdi", ".cdi", ".vpk", ".wbfs", ".wad",
        ".3ds", ".nds", ".gba", ".gbc", ".gb", ".sfc", ".smc", ".nes",
        ".z64", ".n64", ".v64", ".pbp", ".001", ".002", ".r00", ".r01",
        ".msi", ".appimage", ".rpm", ".deb",
    ];

    let path = parsed.path().to_lowercase();
    for ext in &exts {
        if path.ends_with(ext) {
            return true;
        }
    }

    // Check if query parameter explicitly ends with or specifies a file extension or download action
    if let Some(query) = parsed.query() {
        let q_lower = query.to_lowercase();
        if q_lower == "download" || q_lower.starts_with("download&") || q_lower.ends_with("&download") || q_lower.contains("&download&") {
            return true;
        }
        for ext in &exts {
            if q_lower.ends_with(ext) || q_lower.contains(&format!("{ext}&")) {
                return true;
            }
        }
    }

    let host = parsed.host_str().unwrap_or_default().to_lowercase();
    if (host.contains("gofile.io") || host.contains("gofilecdn")) && path.contains("/download/") {
        return true;
    }
    if host.contains("pixeldrain.com") && path.starts_with("/api/file/") {
        return true;
    }
    if host.contains("buzzheavier.com") && (path.starts_with("/d/") || host.starts_with("ts.")) {
        return true;
    }
    if host.contains("datanodes.to") && path.starts_with("/dl/") {
        return true;
    }
    if host.contains("krakenfiles.com") && path.starts_with("/dl/") {
        return true;
    }
    if host.contains("mediafire.com") && host.starts_with("download") {
        return true;
    }
    if host.contains("1fichier.com") && !path.is_empty() && path != "/" && !host.starts_with("www.") && host != "1fichier.com" {
        return true;
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

/// Sanitize a filename for Windows: strip the characters that are illegal in
/// a path component, trim leading/trailing dots and whitespace, and cap the
/// length while preserving the final extension (multi-part suffixes like
/// `.part1.rar`, `.r00` and `.001` depend on it).
pub fn sanitize_filename(raw: &str) -> String {
    const MAX_LEN: usize = 160;

    let cleaned: String = raw
        .chars()
        .filter(|c| !matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'))
        .collect();
    let mut trimmed = cleaned
        .trim_matches(|c: char| c == '.' || c == ' ' || c == '\t')
        .to_string();
    if trimmed.is_empty() {
        trimmed = "download".to_string();
    }
    if trimmed.chars().count() <= MAX_LEN {
        return trimmed;
    }

    // Preserve the final extension (`.rar`, `.r00`, `.001`, …) when capping.
    let ext = trimmed
        .rsplit_once('.')
        .map(|(_, e)| format!(".{e}"))
        .unwrap_or_default();
    let stem = trimmed
        .strip_suffix(&ext)
        .unwrap_or(&trimmed)
        .to_string();
    let stem_cap = MAX_LEN.saturating_sub(ext.chars().count());
    let truncated: String = stem.chars().take(stem_cap).collect();
    let truncated = truncated.trim_end_matches(|c: char| c == '.' || c == ' ');
    format!("{truncated}{ext}")
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
    let cookieStr = '';
    try {{ cookieStr = document.cookie || ''; }} catch (_) {{}}
    let payloadStr = 'gi-capture://' + encodeURIComponent(cleanUrl) + 
      (filename ? ('?filename=' + encodeURIComponent(filename)) : '') +
      (cookieStr ? ('&cookie=' + encodeURIComponent(cookieStr)) : '') +
      ('&referer=' + encodeURIComponent(window.location.href));
    window.location.href = payloadStr;
  }}

  function isDownloadUrl(url) {{
    if (!url || typeof url !== 'string') return false;
    const clean = url.trim().toLowerCase();
    if (clean.startsWith('magnet:')) return true;
    const exts = [
      '.torrent', '.zip', '.rar', '.7z', '.iso', '.exe', '.bin', '.pkg',
      '.tar', '.gz', '.xz', '.zst', '.tar.gz', '.tar.xz', '.tar.zst',
      '.dmg', '.apk', '.nsp', '.nsz', '.xci', '.xcz', '.cia', '.wua',
      '.rvz', '.chd', '.cso', '.gdi', '.cdi', '.vpk', '.wbfs', '.wad',
      '.3ds', '.nds', '.gba', '.gbc', '.gb', '.sfc', '.smc', '.nes',
      '.z64', '.n64', '.v64', '.pbp', '.001', '.002', '.r00', '.r01',
      '.msi', '.appimage', '.rpm', '.deb'
    ];
    for (const ext of exts) {{
      if (clean.endsWith(ext) || clean.includes(ext + '?') || clean.includes(ext + '&')) {{
        return true;
      }}
    }}
    if (clean.includes('?download') || clean.includes('&download') || clean.includes('/api/file/')) {{
      return true;
    }}
    if (/(?:download\d*\.mediafire\.com|srv-[^/]+\.gofile\.io\/download|pixeldrain\.com\/api\/file\/|ts\.buzzheavier\.com\/d\/|datanodes\.to\/dl\/|krakenfiles\.com\/dl\/)/i.test(clean)) {{
      return true;
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
    if (href && isDownloadUrl(href)) {{
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
    if (href && typeof href === 'string' && isDownloadUrl(href)) {{
      e.preventDefault();
      e.stopPropagation();
      sendToGameIndex(href, el.getAttribute('download') || el.innerText);
      return;
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
) -> Result<ResolverSessionStarted, String> {
    let parsed_url: url::Url = url
        .parse()
        .map_err(|e| format!("Invalid initial URL '{url}': {e}"))?;

    // FR-7: single active session. A second open focuses the existing window.
    let existing = {
        let sessions = sessions().lock().unwrap();
        sessions.keys().next().cloned()
    };
    if let Some(existing_id) = existing {
        if let Some(window) = app.get_webview_window(&existing_id) {
            let _ = window.set_focus();
        }
        return Ok(ResolverSessionStarted {
            session_id: existing_id,
            ok: false,
            message: Some("A browser window is already open".to_string()),
        });
    }

    let window_id = format!("download-resolver-{}", rand::random::<u32>());
    let window_title = format!("GameIndex Browser — {}", game_name);
    let auto_extract = auto_extract.unwrap_or(false);
    let source_name = source_name.unwrap_or_else(|| "Web Resolver".to_string());
    let save_dir = save_path.unwrap_or_else(|| {
        app.path()
            .download_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| std::env::temp_dir().to_string_lossy().to_string())
    });

    let (tx, mut rx) = mpsc::channel::<InterceptedPayload>(64);
    let init_script = generate_init_script(&game_name);

    // Clones for each webview closure + the session registry.
    let tx_dl = tx.clone();
    let tx_nav = tx.clone();
    let tx_nw = tx.clone();

    let fallback_game = game_name.clone();
    let fallback_game_dl = fallback_game.clone();
    let fallback_game_nav = fallback_game.clone();
    let fallback_game_nw = fallback_game.clone();

    let save_dir_dl = save_dir.clone();
    let session_id_dl = window_id.clone();

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
    .on_download(move |webview, event| {
        match event {
            DownloadEvent::Requested { url, destination } => {
                let url_str = url.as_str().to_string();
                let scheme = url.scheme().to_string();

                // FR-6: blob/data: URLs can't be replayed by our HTTP engine.
                // Fall back to a native webview save into the game folder.
                if scheme == "blob" || scheme == "data" {
                    let filename = destination
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| sanitize_filename(&extract_filename(&url_str, &fallback_game_dl)));
                    let target = std::path::Path::new(&save_dir_dl).join(sanitize_filename(&filename));
                    eprintln!(
                        "[browser_resolver] blob/data fallback for {} -> {}",
                        session_id_dl,
                        target.to_string_lossy()
                    );
                    *destination = target;
                    return true;
                }

                // Capture the session NOW (G4): referer from the current page
                // and cookies from the live webview, not after a wait.
                let referer = webview.url().ok().map(|u| u.as_str().to_string());
                let cookies = webview
                    .cookies()
                    .unwrap_or_default()
                    .iter()
                    .map(|c| format!("{}={}", c.name(), c.value()))
                    .collect::<Vec<_>>()
                    .join("; ");
                let filename = destination
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| extract_filename(&url_str, &fallback_game_dl));
                let _ = tx_dl.try_send(InterceptedPayload {
                    url: url_str,
                    filename,
                    referer,
                    cookies: if cookies.is_empty() { None } else { Some(cookies) },
                });
                // Cancel the native webview download — GameIndex takes over.
                false
            }
            _ => true,
        }
    })
    .on_navigation(move |nav_url| {
        let nav_str = nav_url.as_str();

        // 1. Custom scheme from injected script
        if nav_str.starts_with("gi-capture://") {
            let full_url_str = &nav_str["gi-capture://".len()..];
            let (url_part, query_part) = if let Some(idx) = full_url_str.find('?') {
                (&full_url_str[..idx], Some(&full_url_str[idx + 1..]))
            } else {
                (full_url_str, None)
            };

            let decoded_url = urlencoding::decode(url_part)
                .map(|s| s.into_owned())
                .unwrap_or_else(|_| url_part.to_string());

            let mut filename = None;
            let mut js_referer = None;
            let mut js_cookie = None;

            if let Some(q) = query_part {
                for pair in q.split('&') {
                    if let Some((k, v)) = pair.split_once('=') {
                        let decoded_v = urlencoding::decode(v).ok().map(|s| s.into_owned());
                        match k {
                            "filename" => filename = decoded_v,
                            "referer" => js_referer = decoded_v,
                            "cookie" => js_cookie = decoded_v,
                            _ => {}
                        }
                    }
                }
            }

            let final_filename = filename
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| extract_filename(&decoded_url, &fallback_game_nav));

            let _ = tx_nav.try_send(InterceptedPayload {
                url: decoded_url,
                filename: final_filename,
                referer: js_referer,
                cookies: js_cookie,
            });
            return false;
        }

        // 2. Direct downloadable URL
        if is_downloadable_url(nav_str) {
            let filename = extract_filename(nav_str, &fallback_game_nav);
            let _ = tx_nav.try_send(InterceptedPayload {
                url: nav_str.to_string(),
                filename,
                referer: None,
                cookies: None,
            });
            // Stop webview from downloading file into OS temp folder
            return false;
        }
        true
    })
    .on_new_window(move |url, _features| {
        let url_str = url.as_str().to_string();
        // Magnets / torrents / direct downloadable URLs opened via target="_blank" / window.open
        if url_str.starts_with("magnet:") || is_downloadable_url(&url_str) {
            let filename = extract_filename(&url_str, &fallback_game_nw);
            let _ = tx_nw.try_send(InterceptedPayload {
                url: url_str,
                filename,
                referer: None,
                cookies: None,
            });
        }
        NewWindowResponse::Deny
    })
    .build()
    .map_err(|e| format!("Failed to open browser resolver window: {e}"))?;

    // Register the session (holding a tx clone so the channel only closes
    // when the session is explicitly torn down).
    {
        let mut sessions = sessions().lock().unwrap();
        sessions.insert(
            window_id.clone(),
            SessionState {
                _tx: tx,
                part_count: 0,
                dedup: HashSet::new(),
                closed_by_user: false,
            },
        );
    }

    // Spawn the session worker: process payloads until the channel closes
    // (i.e. every sender dropped once the window is destroyed + session removed).
    let worker_app = app.clone();
    let worker_session_id = window_id.clone();
    let worker_game_name = game_name.clone();
    let worker_game_id = game_id.clone();
    let worker_save_dir = save_dir.clone();
    let worker_source_name = source_name.clone();
    let worker_auto_extract = auto_extract;
    tokio::spawn(async move {
        while let Some(payload) = rx.recv().await {
            let part = {
                let mut sessions = sessions().lock().unwrap();
                let Some(session) = sessions.get_mut(&worker_session_id) else {
                    break;
                };
                if !session.dedup.insert(payload.url.clone()) {
                    continue; // duplicate capture (JS hook + on_download)
                }
                session.part_count += 1;
                session.part_count
            };

            dispatch_intercepted(
                &worker_app,
                &worker_session_id,
                &worker_game_name,
                &worker_game_id,
                &worker_save_dir,
                worker_source_name.clone(),
                worker_auto_extract,
                part,
                &payload,
            )
            .await;
        }
    });

    // Clean up + notify the frontend when the window is closed, whichever way
    // it happened (X button, or `close_download_resolver`).
    let close_app = app.clone();
    let close_session_id = window_id.clone();
    webview.on_window_event(move |event| {
        if !matches!(event, WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed) {
            return;
        }
        let (parts, cancelled) = {
            let mut sessions = sessions().lock().unwrap();
            match sessions.remove(&close_session_id) {
                Some(s) => (s.part_count, !s.closed_by_user),
                None => return, // already cleaned up (idempotent)
            }
        };
        let _ = close_app.emit(
            "resolver-session-ended",
            serde_json::json!({
                "sessionId": close_session_id,
                "partsCaptured": parts,
                "cancelled": cancelled,
            }),
        );
    });

    Ok(ResolverSessionStarted {
        session_id: window_id,
        ok: true,
        message: None,
    })
}

/// Idempotent close (FR-5): mark the session user-initiated and close the
/// window. The window's close handler tears down the session and emits
/// `resolver-session-ended` with `cancelled: false`.
#[tauri::command]
pub fn close_download_resolver(app: AppHandle, session_id: String) -> Result<(), String> {
    if let Ok(mut sessions) = sessions().lock() {
        if let Some(s) = sessions.get_mut(&session_id) {
            s.closed_by_user = true;
        }
    }

    if let Some(window) = app.get_webview_window(&session_id) {
        return window.close().map_err(|e| e.to_string());
    }

    // Window already gone — clean up any lingering session so the frontend
    // still transitions out of the "open" state (idempotent).
    let (parts, _) = {
        let mut sessions = sessions().lock().unwrap();
        match sessions.remove(&session_id) {
            Some(s) => (s.part_count, s.closed_by_user),
            None => return Ok(()),
        }
    };
    let _ = app.emit(
        "resolver-session-ended",
        serde_json::json!({
            "sessionId": session_id,
            "partsCaptured": parts,
            "cancelled": false,
        }),
    );
    Ok(())
}

/// Queue one intercepted payload through the download engine and notify the
/// frontend. Returns the resulting download id, if one was created.
async fn dispatch_intercepted(
    app: &AppHandle,
    session_id: &str,
    game_name: &str,
    game_id: &Option<String>,
    save_dir: &str,
    source_name: String,
    auto_extract: bool,
    part: usize,
    payload: &InterceptedPayload,
) -> Option<String> {
    let is_magnet_or_torrent =
        payload.url.starts_with("magnet:") || payload.url.to_lowercase().ends_with(".torrent");

    let download_id = if is_magnet_or_torrent {
        match crate::downloads::torrent_add(
            payload.url.clone(),
            save_dir.to_string(),
            game_id.clone(),
            source_name.clone(),
            Some(auto_extract),
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
        // Queue via direct HTTP download engine with captured browser session.
        let file_name = sanitize_filename(&payload.filename);
        let file_path = std::path::Path::new(save_dir)
            .join(&file_name)
            .to_string_lossy()
            .into_owned();
        let id = format!(
            "dl_{}_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
            rand::random::<u16>()
        );

        let mut extra_headers: Vec<(String, String)> = Vec::new();
        extra_headers.push(("User-Agent".to_string(), RESOLVER_UA.to_string()));
        extra_headers.push((
            "Accept".to_string(),
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7".to_string(),
        ));
        extra_headers.push(("Accept-Language".to_string(), "en-US,en;q=0.9".to_string()));
        extra_headers.push((
            "Sec-Ch-Ua".to_string(),
            "\"Google Chrome\";v=\"131\", \"Chromium\";v=\"131\", \"Not_A Brand\";v=\"24\"".to_string(),
        ));
        extra_headers.push(("Sec-Ch-Ua-Mobile".to_string(), "?0".to_string()));
        extra_headers.push(("Sec-Ch-Ua-Platform".to_string(), "\"Windows\"".to_string()));
        extra_headers.push(("Sec-Fetch-Dest".to_string(), "document".to_string()));
        extra_headers.push(("Sec-Fetch-Mode".to_string(), "navigate".to_string()));
        extra_headers.push(("Sec-Fetch-Site".to_string(), "same-origin".to_string()));
        extra_headers.push(("Sec-Fetch-User".to_string(), "?1".to_string()));
        extra_headers.push(("Upgrade-Insecure-Requests".to_string(), "1".to_string()));

        if let Some(cookies) = &payload.cookies {
            if !cookies.is_empty() {
                extra_headers.push(("Cookie".to_string(), cookies.clone()));
            }
        }
        let referer = payload.referer.clone().unwrap_or_else(|| payload.url.clone());
        extra_headers.push(("Referer".to_string(), referer.clone()));

        match crate::downloads::direct_download_start(
            id,
            payload.url.clone(),
            file_path,
            game_id.clone(),
            source_name.clone(),
            Some(auto_extract),
            None,
            Some(referer),
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

    let _ = app.emit(
        "download-intercepted",
        serde_json::json!({
            "sessionId": session_id,
            "gameName": game_name,
            "url": payload.url,
            "filename": payload.filename,
            "downloadId": download_id,
            "partIndex": part,
            "partsCaptured": part,
        }),
    );

    // Update the in-webview banner with the part count (best-effort).
    if let Some(webview) = app.get_webview(session_id) {
        let _ = webview.eval(&format!(
            "(function(){{var el=document.getElementById('__gi_resolver_status');if(el){{el.textContent='Part {part} captured';el.style.background='#22c55e';el.style.color='#ffffff';el.style.borderColor='#16a34a';}}}})())"
        ));
    }

    download_id
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_filename_strips_invalid_chars() {
        assert_eq!(sanitize_filename("Game: Part 1?.rar"), "Game Part 1.rar");
        assert_eq!(sanitize_filename("a|b\\c<d>e\"f*g.7z"), "abcdefg.7z");
    }

    #[test]
    fn sanitize_filename_preserves_multipart_suffixes() {
        assert_eq!(sanitize_filename("game.part1.rar"), "game.part1.rar");
        assert_eq!(sanitize_filename("game.r00"), "game.r00");
        assert_eq!(sanitize_filename("game.001"), "game.001");
    }

    #[test]
    fn sanitize_filename_trims_dots_and_spaces() {
        assert_eq!(sanitize_filename("  game.zip. "), "game.zip");
        assert_eq!(sanitize_filename("..."), "download");
    }

    #[test]
    fn is_downloadable_url_classifies_hosters() {
        assert!(is_downloadable_url(
            "https://s1.datanodes.to/d/xuf4jz/game.part1.rar"
        ));
        assert!(is_downloadable_url(
            "https://srv.gofile.io/download/abc123/game.zip"
        ));
        assert!(!is_downloadable_url(
            "https://filecrypt.cc/Container/ABC123.html"
        ));
        assert!(!is_downloadable_url("https://api.example.com/v1/files/123"));
        assert!(!is_downloadable_url(
            "https://api.example.com/v1/files.json"
        ));
    }

    #[test]
    fn extract_filename_handles_gofile_magnet_and_fallback() {
        assert_eq!(
            extract_filename("https://srv.gofile.io/download/abc123/My%20Game.zip", "Game"),
            "My Game.zip"
        );
        assert_eq!(
            extract_filename("magnet:?xt=urn:btih:abc&dn=My+Game", "Game"),
            "My Game"
        );
        assert_eq!(
            extract_filename("https://example.com/download", "MyGame"),
            "MyGame.zip"
        );
    }
}
