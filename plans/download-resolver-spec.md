# In-App Browser Download Resolver — Specification

> Feature: add an explicit **"Open in GameIndex Browser"** action to the download modal for
> direct/hoster download links. The user completes the hoster flow (captcha, countdown, login,
> filecrypt interstitial) inside an in-app webview, and GameIndex intercepts the actual file
> download and runs it through its own download engine — flawlessly, with multi-part support,
> correct interception for vikingfiles / datanodes / gofile / etc.
>
> Status: **Specification** (not yet implemented). Supersedes the partial resolver flow.

---

## 1. Overview

GameIndex downloads come from multiple sources. Many "direct" links are actually hoster
portal pages (vikingfiles.com, datanodes.to, gofile.io, filecrypt.cc containers, …) that require
the user to solve a Cloudflare Turnstile captcha, wait out a countdown, or complete an
interstitial before the real file URL is exposed. These flows are deliberately hard to
automate, so GameIndex already ships an in-app browser resolver (`src-tauri/src/downloads/browser_resolver.rs`)
that opens a `WebviewWindow` and intercepts the resulting download.

Today the resolver is a **fallback** action (only surfaced for web-only results or via the
"Open in GameIndex browser" button in the fallback actions block), it **blocks the modal**
for up to 10 minutes while waiting for a single capture, it **closes after the first file**
(breaking multi-part releases), and the frontend **does not consume** the `download-intercepted`
event it emits. This spec turns the resolver into a first-class, discoverable option for
direct/hoster links with a non-blocking, multi-part-correct interception pipeline.

Goals:

- **Discoverable:** every direct/hoster result in the download modal offers "Open in GameIndex Browser".
- **Flowless:** the user clicks through the hoster page inside the app; when the file download
  starts, GameIndex silently takes over — no modal freeze, no native browser save dialog, no
  re-typing URLs.
- **Correct:** interception catches the *final* file response for vikingfiles, datanodes,
  gofile, and unknown hosters; multi-part releases queue one download per part; magnets and
  `.torrent` links captured in the webview route to the torrent engine.
- **Recoverable:** every failure path has a visible outcome (toast + inline status), never a hang.

---

## 2. Current State Audit

### 2.1 What exists today (working)

| Piece | Location | Notes |
|---|---|---|
| Resolver window + interceptor | `src-tauri/src/downloads/browser_resolver.rs` (534 lines) | `open_download_resolver` command (`:289-534`) |
| `on_download` capture | `browser_resolver.rs:327-344` | `DownloadEvent::Requested { url, destination }`; returns `false` → cancels native webview download |
| `on_navigation` + `gi-capture://` scheme | `browser_resolver.rs:345-401` | JS hooks navigate to `gi-capture://<url>?filename=…&cookie=…&referer=…`; also catches direct downloadable URLs |
| JS injection layer | `browser_resolver.rs:103-287` | Banner + hooks for `window.open`, `HTMLAnchorElement.click`, capture-phase click, `fetch` JSON scan |
| Cookie snapshot | `browser_resolver.rs:409-415` | Reads `webview.cookies()` before closing |
| Download hand-off | `browser_resolver.rs:438-505` | `torrent_add` for magnet/`.torrent`, else `direct_download_start` with replayed Chrome headers + cookies |
| "Download intercepted" event | `browser_resolver.rs:508-516` | `download-intercepted` emit (gameName, url, filename, downloadId) — **no frontend listener exists** |
| Fallback UI button | `src/components/download-modal/DetailPanel.tsx:196-210` | Only in `dl-detail-fallback-actions` (web-only / non-downloadable branch) |
| Modal wiring | `src/components/download-modal/DownloadModal.tsx:538-587` | `handleOpenBrowserResolver` → `invoke("open_download_resolver", …)`; closes modal on `intercepted` |
| Hoster fast-path | `src-tauri/src/downloads/hosters.rs:46-100` | `resolve()` for datanodes, fuckingfast, mediafire, pixeldrain, rootz, vikingfile `/f/`, buzzheavier; gofile → `Passthrough` (`:92-96`, needs `wt.obf.js` JS) |
| Fast-path wiring | `src-tauri/src/downloads/http.rs:115` | `hosters::resolve()` runs before streaming every direct download |
| Window permissions | `src-tauri/capabilities/default.json:10` | `download-resolver-*` labels already whitelisted |

### 2.2 Gaps that break the requirements

| # | Gap | Why it breaks the feature |
|---|---|---|
| G1 | **Blocking wait** — `rx.recv_timeout(600)` (`browser_resolver.rs:406-407`) blocks the invoke for up to 10 min; window close does **not** abort it (channel senders live in webview closures) | Modal freezes; "flowless" is violated; a cancelled session still holds the command for 10 min |
| G2 | **Single capture** — the command returns on the first payload and closes the window | Multi-part releases (`part1.rar`/`.r00`, datanodes 3 GB free cap, ~4–5 GB scene parts) lose everything after part 1 |
| G3 | **No frontend event consumer** — `download-intercepted` is emitted but unsubscribed (`src/` grep: no matches) | Non-blocking architecture is impossible without it; today only the invoke return value informs the UI |
| G4 | **`on_download` referer is `None`** (`browser_resolver.rs:340`) and cookies are snapshotted after the wait | Hoster CDNs that check `Referer`/session tokens (gofile storage nodes, datanodes `s*.to`) can reject the replay |
| G5 | **No `on_new_window` handler** | Magnet/`.torrent` links opened via `target="_blank"`/`window.open` never hit `on_navigation` (tauri#14090) — wry silently denies the window |
| G6 | **Resolver CTA is buried** in the fallback branch (`DetailPanel.tsx:180-213`) | Direct/hoster results show no resolver option; user has to Start (which may hard-fail on Turnstile) and gets no path forward |
| G7 | **Single-window UX** — modal closes on first capture (`DownloadModal.tsx:566-569`) | User loses context; multi-part continuation is invisible |
| G8 | **Filename trust** — `extract_filename` (`browser_resolver.rs:78-101`) prefers the URL tail; no Windows-invalid-char sanitization | gofile serves `/download/{fileId}/{fileName}` (URL tail OK) but some hosters serve generic tails; extraction breaks on `?`/`:` chars |
| G9 | **No escalation UX** — when `hosters::resolve()` fails (e.g. Turnstile on datanodes/vikingfile), the direct download errors with no guided next step | User has to discover the resolver button manually |

---

## 3. Requirements

### 3.1 Functional

- **FR-1 (Resolver CTA):** Every result whose resolved URI is a direct HTTP(S) hoster link
  shows a primary **"Open in GameIndex Browser"** action in the detail panel (alongside Start).
  Web-only and non-http results keep their existing actions. The action must also be available
  per-mirror when multiple mirrors exist.
- **FR-2 (In-app browsing):** Clicking the action opens a dedicated `WebviewWindow`
  (`download-resolver-<rand>`) pre-loaded with the hoster URL; the injected banner explains the
  flow; all navigation stays inside the window (popups, `target="_blank"`, `window.open`).
- **FR-3 (Interception):** When the hoster starts the real file download, GameIndex cancels the
  webview's native download and queues it through `direct_download_start` with replayed browser
  session (cookies + referer + UA), so it appears in the Downloads page with progress, pause and
  resume. Magnet and `.torrent` links route through `torrent_add`.
- **FR-4 (Multi-part):** The resolver stays open after the first capture. Every subsequent
  file response from the same session is queued as its own download. The banner shows part
  progress; the user closes the window (or clicks "Done") to end the session.
- **FR-5 (Non-blocking):** `open_download_resolver` returns immediately with a session id.
  Progress and results stream to the modal via events. Closing the window ends the session
  cleanly and unblocks all state.
- **FR-6 (Failure visibility):** No-capture close, replay rejection, and download-start errors
  each surface a toast/inline status with a retry affordance. Blob/`data:` URLs (un-replayable)
  fall back to native webview save into the game save folder.
- **FR-7 (Single active session):** Opening a second resolver while one is active is a no-op
  (toast "already open") or focuses the existing window.

### 3.2 Non-functional

- **NFR-1:** No new heavy dependencies (bundle < 10 MB target; existing deps only).
- **NFR-2:** Windows primary; macOS/Linux builds must not break (guard `#[cfg(windows)]` where needed).
- **NFR-3:** All new UI strings in all 6 locales (`en/de/es/fr/ru/zh-CN`); `npm run audit:i18n` passes.
- **NFR-4:** Resolver webview loads arbitrary external content → no IPC surface in that window;
  keep `gi-capture://` app-internal; window labels stay under the `download-resolver-*` capability scope.
- **NFR-5:** New Rust struct fields use `#[serde(rename_all = "camelCase")]` + `#[serde(default)]`.
- **NFR-6:** Typecheck (`npx tsc --noEmit`), `npm run build`, `cargo check` all pass.

---

## 4. Design

### 4.1 Per-hoster strategy table

Interception is hoster-agnostic, but the *entry path* differs. The router lives in a new
`hoster_strategy(uri) -> HosterStrategy` in `hosters.rs`:

| Hoster | Pattern (host) | Fast path (`hosters::resolve`) | Resolver role |
|---|---|---|---|
| gofile.io | `gofile.io`, `gofilecdn` | Passthrough (needs `wt.obf.js` JS) | **Primary** — webview required |
| datanodes.to | `datanodes.to`, `s*.datanodes.to` | `resolve()` (`hosters.rs:52-56`) | **Fallback** on fast-path error (Turnstile) |
| vikingfiles | `vikingfile.com`, `vik1ngfile.site` (`/f/` path) | `resolve()` (`hosters.rs:77-86`) | **Fallback** on fast-path error (Turnstile) |
| fuckingfast / mediafire / pixeldrain / rootz / buzzheavier | host match | `resolve()` | **Fallback** on fast-path error |
| filecrypt.cc | `filecrypt.cc`, `filecrypt.co` | none | **Primary** — interstitial + password then hoster |
| anything else | — | Passthrough | **Universal fallback** |

**Routing rule (flowless):** on Start of a direct hoster link, the engine already runs
`hosters::resolve()` (`http.rs:115`). When it returns `Error`/`Passthrough` and the hoster is
known to need a browser, the modal transitions to an inline "needs browser" state and highlights
the resolver CTA instead of failing the download. Auto-opening is not performed — the user
chooses, keeping behavior predictable (FR-6).

### 4.2 Interception architecture

The `on_download` handler is the **authoritative** interception point: it fires exactly when the
hoster's page triggers a real file download (`Content-Disposition: attachment`, unknown-MIME
navigation, `<a download>`) — i.e. precisely the gofile storage GET
(`{server}.gofile.io/download/{fileId}/{fileName}`), the datanodes
(`s{N}.datanodes.to/d/{token}/{filename}`) GET, and the vikingfile CDN GET. The JS hooks
(`gi-capture://`) remain as a fast path for links the page exposes before any native download,
and `on_new_window` is added for `target="_blank"` magnets/torrents.

```
Hoster page in webview
        │  user solves captcha / countdown / interstitial
        ▼
Real file download starts
   ├─► on_download(DownloadEvent::Requested { url, destination })
   │     ├─ url        = final post-redirect URL (DownloadOperation.Uri)
   │     ├─ destination= WebView2 suggested path (Content-Disposition-aware)
   │     ├─ cancel native download (return false)  → WebView2 UI never shows
   │     ├─ snapshot cookies (webview.cookies()) + referer (webview.url()) NOW
   │     ├─ sanitize filename; queue direct_download_start / torrent_add
   │     └─ emit "download-intercepted" { sessionId, partIndex, downloadId, filename }
   ▼
Webview stays open for next part (FR-4) until user closes / clicks Done
```

Magnet routing — three intercept points (all must be handled):

| Path | Event | Handling |
|---|---|---|
| Same-frame `<a href="magnet:…">` | `on_navigation` | capture → `torrent_add`, return `false` |
| `target="_blank"` / `window.open("magnet:…")` | `on_new_window` | **new** — capture → `torrent_add`, `NewWindowResponse::Deny` |
| Clicked link with `download` attr / JS `location` | `gi-capture://` (init script) | capture → `torrent_add` |

### 4.3 Frontend UX

**Detail panel (`DetailPanel.tsx`):** a new `.dl-resolver-card` section shown when
`classifyUri(...).isDirect` (or `webUrl`), containing:

- Title: "Need a browser to unlock this link?" + hoster label (reuse `hostLabelForUri`, `helpers.ts:78-98`).
- Primary button **"Open in GameIndex Browser"** (`onOpenBrowserResolver`) — the existing
  `dl-detail-open-page--resolver` affordance is promoted from fallback-only to direct results.
- Secondary ghost button "Open in external browser" (existing `onOpenPage`).
- Status line driven by resolver-session state (idle → opening → capturing → done/error).

**Modal orchestrator (`DownloadModal.tsx`):**

- `handleOpenBrowserResolver` (`:538-587`) rewritten to a **fire-and-forget** invoke that returns
  `{ sessionId }` immediately; the modal stays open.
- New session state: `{ sessionId, partsCaptured, status }`; a `useEffect` subscribes to the
  `download-intercepted` event (new listener — G3) and updates part count + toasts
  "Part 2 of 5 captured: `filename`".
- "Done / Close browser" button in the modal footer while a session is active →
  `invoke("close_download_resolver", { sessionId })`.
- On fast-path failure of a direct Start (G9): inline hint "This hoster needs a browser —
  open it in GameIndex Browser", with the CTA emphasized.

### 4.4 Rust changes

**`browser_resolver.rs` rework:**

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolverSessionStarted {
    pub session_id: String,        // window label, "download-resolver-<rand>"
    pub ok: bool,
    pub message: Option<String>,
}

// Non-blocking entry point — returns immediately (FR-5).
#[tauri::command]
pub async fn open_download_resolver(
    app: AppHandle,
    url: String,
    game_name: String,
    game_id: Option<String>,
    save_path: Option<String>,
    auto_extract: Option<bool>,
    source_name: Option<String>,
) -> Result<ResolverSessionStarted, String>;

// Idempotent close (FR-5): closes window, ends session, emits "resolver-session-ended".
#[tauri::command]
pub fn close_download_resolver(app: AppHandle, session_id: String) -> Result<(), String>;
```

Key deltas inside `open_download_resolver`:

1. **Session registry** — `static SESSIONS: OnceLock<Mutex<HashMap<String, SessionState>>>`
   registered in `.setup`; `SessionState` holds `tx: mpsc::Sender<InterceptedPayload>`,
   `part_count`, `dedup: HashSet<String>`.
2. **No blocking wait** — drop `rx.recv_timeout` (`:406-407`); spawn an async worker that owns
   the receiver and processes payloads until the channel closes (window destroyed).
3. **`on_download`** (`:327-344`) — keep cancel (`false`), but **capture referer from
   `webview.url()`** at event time (G4) and send `part_count` bookkeeping through the session.
4. **`on_new_window`** (new) — `magnet:`/`.torrent` → payload to session, `NewWindowResponse::Deny`;
   everything else `Deny` too (interstitial hosters stay in-window; init script already rewrites
   `target="_blank"` to `_self`).
5. **Window-close cleanup** — use `on_close_requested` to emit `resolver-session-ended`
   `{ sessionId, partsCaptured }` so the modal clears state even when the user closes the X.
6. **Download dispatch** — per payload: dedup by URL (G2/G3 safety), `torrent_add` for
   magnet/`.torrent`, else `direct_download_start` (existing header replay at `:459-505`,
   referer now real), emit `download-intercepted` with `partIndex` + `sessionId`, increment
   part count, update the banner via `webview.eval` ("Part N captured").
7. **Blob/`data:` fallback (FR-6)** — `url.scheme()` is `blob`/`data`: instead of cancel +
   replay (impossible), return `true` from `on_download` and set `*destination` to
   `save_path.join(sanitized_filename)` so the webview saves natively into the game folder;
   emit an event so the UI notes the file location.
8. **Filename sanitization** (G8) — new `sanitize_filename(&str) -> String`: strip
   `[<>:"/\|?*]`, trim dots/spaces, cap length (~160 chars), preserve multi-part suffixes
   (`.part1.rar`, `.r00`, `.001`) — extraction depends on them.

**`hosters.rs`:** add `hoster_strategy(uri) -> HosterStrategy` per §4.1 (`FastPath`,
`WebviewRequired`, `Fallback`, `Unknown`).

**Registration:** add `close_download_resolver` to `generate_handler!` (`lib.rs`). Capabilities
need no change (`download-resolver-*` already whitelisted, `core:webview:allow-create-webview-window`
present).

### 4.5 Event contract

| Event | Payload | Emitted by | Consumed by |
|---|---|---|---|
| `download-intercepted` (extended) | `{ sessionId, gameName, url, filename, downloadId, partIndex, partsCaptured }` | Rust | Modal session state, toast |
| `resolver-session-ended` (new) | `{ sessionId, partsCaptured, cancelled }` | Rust (on close) | Modal session state |
| `download-progress` (existing) | full snapshot | manager tick | `DownloadContext` (existing listener `:351-362`) |

All payloads `#[serde(rename_all = "camelCase")]`, new fields optional (`#[serde(default)]`).

---

## 5. i18n

New keys under the existing `downloadModal.*` namespace, added to **all 6 locales**
(`src/i18n/{en,de,es,fr,ru,zh-CN}.ts`), validated by `npm run audit:i18n`:

| Key | en value (reference) |
|---|---|
| `downloadModal.resolverTitle` | "Need a browser to unlock this link?" |
| `downloadModal.resolverDesc` | "Open the hoster page in GameIndex to solve captchas and grab the file automatically." |
| `downloadModal.resolverOpen` | "Open in GameIndex Browser" |
| `downloadModal.resolverOpened` | "Browser opened — complete the download there" |
| `downloadModal.resolverCaptured` | "Captured: {filename}" |
| `downloadModal.resolverPartCaptured` | "Part {part} captured ({count} total)" |
| `downloadModal.resolverDone` | "Done" |
| `downloadModal.resolverClose` | "Close browser" |
| `downloadModal.resolverNoCapture` | "Browser closed without a download" |
| `downloadModal.resolverError` | "Download could not be started: {error}" |
| `downloadModal.resolverAlreadyOpen` | "A browser window is already open for this game" |
| `downloadModal.resolverNeedsBrowser` | "This hoster needs a browser — open it in GameIndex" |

---

## 6. Styling

New classes in `src/styles/download.css` (tokens via `var(--…)` only, `theme.css`):

- `.dl-resolver-card` — panel matching `.dl-protected-card` rhythm.
- `.dl-resolver-status` + `.dl-resolver-status--ok/--error` — status line states.
- `.dl-resolver-progress` — small "Part 2 of 5" chip (reuse `.dl-section-count-badge` tokens).
- Button reuse: `Button` primitives (primary / ghost) from `src/components/ui/`.

---

## 7. Testing

### 7.1 Rust unit tests (new, alongside `browser_resolver.rs` / `hosters.rs`)

1. `sanitize_filename`: strips `:?*"<>|`, keeps `part1.rar` / `.r00` / `.001` suffixes.
2. `is_downloadable_url`: datanodes `s1.datanodes.to/d/xuf4jz…/game.part1.rar` → true;
   gofile storage URL → true; filecrypt.cc container page → **false**; API JSON endpoints → false.
3. `extract_filename`: gofile `/download/{id}/{name}` → `{name}`; magnet `dn` param; generic-tail fallback.
4. `hoster_strategy`: gofile → `WebviewRequired`; datanodes → `Fallback`; vikingfile `/f/` → `Fallback`;
   unknown → `Unknown`.
5. Session registry: open → second open returns existing/`AlreadyOpen`; close → `session-ended`.

### 7.2 Manual verification checklist (per hoster, Windows)

| Hoster | Scenario | Expected |
|---|---|---|
| gofile.io | open resolver → click Download | file appears in Downloads page, correct filename, no native dialog |
| vikingfiles | Turnstile auto-solves in webview → click | intercept fires on CDN GET; referer + cookies replayed |
| datanodes | Turnstile → download start | `s*.datanodes.to/d/{token}/{file}` replayed successfully |
| multi-part | split rar release (≥2 parts) | each part queued; banner counts; window stays open |
| filecrypt | container → password → hoster | stays in-window; final hoster download intercepted |
| magnet (same frame) | click magnet link | `torrent_add`, no external dialog |
| magnet (`target="_blank"`) | window.open magnet | `on_new_window` path (G5), `torrent_add` |
| no capture | close window without downloading | `resolver-session-ended`, modal returns to idle |
| fast-path fail | direct Start on datanodes with Turnstile | inline "needs browser" hint, no silent error |

### 7.3 Gates

`npx tsc --noEmit` · `npm run build` · `npm run audit:i18n` · `cargo check`.

---

## 8. Acceptance Criteria

- [ ] Direct/hoster results show the resolver CTA; opening it never freezes the modal (FR-1, FR-5).
- [ ] gofile, vikingfiles and datanodes downloads are intercepted with correct filename and
      session replay (FR-3) — verified via §7.2 checklist.
- [ ] Multi-part releases queue every part without closing the window (FR-4).
- [ ] Magnets captured from both same-frame and `target="_blank"` route to the torrent engine (FR-3, G5).
- [ ] Closing the resolver at any point leaves the app in a clean state (FR-5, FR-6).
- [ ] All new strings exist in all 6 locales; i18n audit passes (NFR-3).
- [ ] All gates in §7.3 pass (NFR-6).

---

## 9. Out of Scope (v1)

- Server-side hoster unlock endpoints (Hydra-style `/hosters/vikingfile/unlock`) — the webview
  resolver replaces this for v1; `hosters.rs` fast path remains for non-captcha hosters.
- gofile `wt.obf.js` token derivation in Rust (needs a JS runtime) — webview handles gofile natively.
- Automatic Turnstile solving beyond "real browser context auto-passes" (no automation flags).
- Debrid / premium API-key integrations.

---

## 10. Risks & Open Questions

| Risk | Mitigation |
|---|---|
| Hoster replay rejection (token single-use / IP-bound, e.g. gofile storage) | Replay cookies+referer+UA (Hydra-proven); blob/data fallback native save (§4.4.7); if a specific hoster consistently fails, mark it `WebviewRequired` and add native-save default |
| WebView2 auto-updates change `DownloadStarting` semantics | `on_download` is stable since Tauri 2.0 (PR #9922) and wry sets `Handled=true` automatically; no raw COM needed |
| `webview.cookies()` availability across Tauri minors | Verify against pinned version during implementation; if removed, use `tauri-plugin-http` cookie store or `with_webview` + WebView2 cookie manager (pin Tauri minor, §4 note) |
| macOS `Finished.path = None` | Success tracking via `success` flag, not path; keep resolver Windows-first, non-blocking elsewhere |
| Filecrypt/JS-heavy pages redirect to new windows | `on_new_window` denies + init script rewrites `target="_blank"`; banner offers "Capture Current Link" manual fallback (already shipped) |
| Duplicate capture (JS hook + `on_download`) | Session-level dedup set by URL (§4.4.6) |

**Open questions to confirm during implementation:** (1) exact pinned Tauri minor for
`webview.cookies()`; (2) whether `on_close_requested` on a `WebviewWindowBuilder` from the Rust
command scope can safely emit events (vs. wiring a `WebviewWindow::on_window_event` listener in
`.setup`); (3) vikingfile final-domain list (`vik1ngfile.site` vs `vikingfile.com`) for the
strategy table.

---

## 11. Reference

- Existing implementation: `src-tauri/src/downloads/browser_resolver.rs` (rework), `DetailPanel.tsx:153-213`,
  `DownloadModal.tsx:538-587`, `hosters.rs:46-100`, `http.rs:115`.
- Tauri API: `WebviewWindowBuilder::on_download` (stable, v2.0+), `DownloadEvent::{Requested, Finished}`,
  `on_new_window` / `NewWindowResponse::Deny` (magnets, tauri#14090), `Webview::with_webview` (raw, optional).
- Hoster flows (verified 2026-08): gofile storage `{server}.gofile.io/download/{fileId}/{fileName}`,
  web-only since Mar 2026 API change; datanodes `s{N}.datanodes.to/d/{token}/{filename}`, 3 GB free cap;
  vikingfile Turnstile + countdown, CDN-served final file; multi-part rar/zip/7z splits are the norm.
