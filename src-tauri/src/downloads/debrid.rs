use reqwest::Method;
use serde::{Deserialize, Serialize};

// ─── Shared response types (consumed by mod.rs) ──────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DebridStatusResult {
    pub id: String,
    pub progress: f32,
    pub status: String, // "ready", "downloading", "queued", "error"
    /// Per-file download entries in download order. The names come from
    /// the debrid service (which knows them even when the download URL
    /// is an opaque short link); `size` is 0 when unknown.
    pub files: Vec<DebridFile>,
    /// Magnet-level name (torrent/archive title) reported by the status
    /// endpoint. Used as the record display name for multi-file
    /// downloads. None when the provider doesn't report one.
    pub name: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DebridFile {
    pub name: String,
    pub size: u64,
    pub link: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DebridUserInfo {
    pub username: String,
    pub premium_until: Option<u64>,
}

/// Result of handing a magnet to a debrid provider.
#[derive(Debug, Clone)]
pub struct DebridUploadResult {
    /// Provider-side transfer id used to poll status.
    pub id: String,
    /// True when the provider already had the content cached on its
    /// servers (instant download — no server-side re-fetch).
    pub cached: bool,
}

/// Answer to "is this magnet already cached on the provider?".
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DebridCacheResult {
    pub cached: bool,
}

// ─── AllDebrid Client ────────────────────────────────────────────────────────
//
// AllDebrid migrated to `Authorization: Bearer <apikey>` headers and POST-form
// requests in late 2024 / early 2025 (the old `?agent=gamelib&apikey=…` query
// approach now returns `404 Endpoint doesn't exist`). Endpoints used here:
// - GET  /v4/user                 → user info
// - POST /v4/magnet/upload        → upload a magnet (id + whether already cached)
// - POST /v4.1/magnet/status      → progress / ready status
// - POST /v4/magnet/files         → per-file download links (moved out of status)
//
// Live docs: https://docs.alldebrid.com/

pub struct AllDebridClient;

#[derive(Deserialize, Debug)]
struct AllDebridResponse<T> {
    status: String,
    data: Option<T>,
    error: Option<AllDebridError>,
}

#[derive(Deserialize, Debug)]
struct AllDebridError {
    /// AllDebrid error code (e.g. `"AUTH_BAD_API_KEY"`). Reserved in
    /// the deserialised struct so future structured handling in
    /// `ad_err` keeps the discriminator around. Today only `message`
    /// is read.
    #[allow(dead_code)]
    code: String,
    message: String,
}

#[derive(Deserialize, Debug)]
struct AllDebridUserResponse {
    user: AllDebridUser,
}

#[derive(Deserialize, Debug)]
struct AllDebridUser {
    username: String,
    #[serde(default, rename = "isPremium")]
    is_premium: bool,
    #[serde(default, rename = "premiumUntil")]
    premium_until: u64,
}

#[derive(Deserialize, Debug)]
struct AllDebridUploadResponse {
    magnets: Vec<AllDebridMagnetUpload>,
}

#[derive(Deserialize, Debug)]
struct AllDebridMagnetUpload {
    id: u64,
    /// Whether the torrent is already cached on AllDebrid's servers.
    /// `true` means the files are served instantly and nothing is
    /// re-downloaded.
    #[serde(default)]
    ready: bool,
}

#[derive(Deserialize, Debug)]
struct AllDebridStatusResponse {
    #[serde(default, deserialize_with = "deserialize_magnets")]
    magnets: Vec<AllDebridMagnetStatus>,
}

/// `/v4.1/magnet/status` returns `magnets` as an array when querying all
/// (or several) ids, but as a single object when exactly one id is
/// passed. Accept both shapes and normalise to a vec.
fn deserialize_magnets<'de, D>(deserializer: D) -> Result<Vec<AllDebridMagnetStatus>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum OneOrMany {
        One(AllDebridMagnetStatus),
        Many(Vec<AllDebridMagnetStatus>),
    }
    Ok(match OneOrMany::deserialize(deserializer)? {
        OneOrMany::One(one) => vec![one],
        OneOrMany::Many(many) => many,
    })
}

#[derive(Deserialize, Debug)]
struct AllDebridMagnetStatus {
    /// Magnet filename, or "noname" if AllDebrid could not parse one.
    /// Optional because some states return `null` here.
    #[serde(default)]
    filename: Option<String>,
    #[serde(default)]
    size: u64,
    #[serde(default, rename = "statusCode")]
    status_code: u8,
    #[serde(default, rename = "statusCodeDescription")]
    status_code_description: String,
    #[serde(default)]
    downloaded: u64,
    /// `links` may be empty (or missing) under /v4.1/magnet/status — the API
    /// moved file-level information to the dedicated /v4/magnet/files endpoint.
    #[serde(default)]
    links: Vec<AllDebridLink>,
}

#[derive(Deserialize, Debug)]
struct AllDebridFilesResponse {
    magnets: Vec<AllDebridFilesEntry>,
}

#[derive(Deserialize, Debug)]
struct AllDebridFilesEntry {
    #[serde(default)]
    files: Vec<AllDebridFileNode>,
}

/// One node of the `/v4/magnet/files` folder tree. A leaf file carries
/// `n` (name), `s` (size) and `l` (download link); a folder carries `n`
/// and `e` (child nodes) instead.
#[derive(Deserialize, Debug)]
struct AllDebridFileNode {
    #[serde(default)]
    n: String,
    #[serde(default)]
    s: u64,
    #[serde(default)]
    l: Option<String>,
    #[serde(default)]
    e: Vec<AllDebridFileNode>,
}

#[derive(Deserialize, Debug)]
struct AllDebridLink {
    link: String,
}

/// Flatten a `/v4/magnet/files` node tree into per-file entries (DFS
/// pre-order). Folder nodes carry `n` + `e`; file nodes carry `n` + `s` +
/// `l`. The name keeps its folder path so same-named files in different
/// subfolders stay distinct (the manager later flattens `/` to `_`).
fn collect_files(nodes: &[AllDebridFileNode], parent: &str, out: &mut Vec<DebridFile>) {
    for node in nodes {
        let full = if parent.is_empty() {
            node.n.clone()
        } else {
            format!("{}/{}", parent, node.n)
        };
        if let Some(link) = node.l.as_deref() {
            if !link.is_empty() {
                out.push(DebridFile {
                    name: full.clone(),
                    size: node.s,
                    link: link.to_string(),
                });
            }
        }
        collect_files(&node.e, &full, out);
    }
}

/// Send a request to api.alldebrid.com with the standard Bearer auth header.
/// `form` selects POST form-encoded parameters (used by every magnet endpoint).
async fn ad_request(
    client: &reqwest::Client,
    method: Method,
    path: &str,
    apikey: &str,
    form: Option<&[(&str, &str)]>,
) -> Result<reqwest::Response, String> {
    let url = format!("https://api.alldebrid.com{}", path);
    let mut req = client
        .request(method, &url)
        .header("Authorization", format!("Bearer {}", apikey));
    if let Some(params) = form {
        req = req.form(params);
    }
    req.send()
        .await
        .map_err(|e| format!("Request failed: {}", e))
}

fn ad_err<T>(body: AllDebridResponse<T>) -> String {
    body.error
        .map(|e| e.message)
        .unwrap_or_else(|| "Unknown AllDebrid error".to_string())
}

impl AllDebridClient {
    pub async fn test_key(apikey: &str) -> Result<DebridUserInfo, String> {
        let client = reqwest::Client::new();
        let resp = ad_request(&client, Method::GET, "/v4/user", apikey, None).await?;
        let status = resp.status();
        let body: AllDebridResponse<AllDebridUserResponse> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse user info response: {}", e))?;

        if !status.is_success() || body.status != "success" {
            return Err(ad_err(body));
        }

        let data = body.data.ok_or_else(|| "Empty response data".to_string())?;
        // premiumUntil is documented as 0 for non-premium accounts. Treat 0 as
        // "no expiry" so the UI doesn't surface a meaningless epoch timestamp.
        let premium_until = if data.user.is_premium && data.user.premium_until > 0 {
            Some(data.user.premium_until)
        } else {
            None
        };
        Ok(DebridUserInfo {
            username: data.user.username,
            premium_until,
        })
    }

    pub async fn upload_magnet(apikey: &str, magnet: &str) -> Result<DebridUploadResult, String> {
        let client = reqwest::Client::new();
        let resp = ad_request(
            &client,
            Method::POST,
            "/v4/magnet/upload",
            apikey,
            Some(&[("magnets[]", magnet)]),
        )
        .await?;
        let status = resp.status();
        let body: AllDebridResponse<AllDebridUploadResponse> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse upload response: {}", e))?;

        if !status.is_success() || body.status != "success" {
            return Err(ad_err(body));
        }

        let data = body.data.ok_or_else(|| "Empty response data".to_string())?;
        let mag = data
            .magnets
            .first()
            .ok_or_else(|| "No magnet entry returned by AllDebrid".to_string())?;
        Ok(DebridUploadResult {
            id: mag.id.to_string(),
            cached: mag.ready,
        })
    }

    /// Check whether a magnet is already cached, without leaving it in
    /// the account. Uploading is the only remaining availability signal;
    /// a not-cached magnet is removed again so the probe doesn't start a
    /// server-side download.
    pub async fn check_cache(apikey: &str, magnet: &str) -> Result<DebridCacheResult, String> {
        let upload = Self::upload_magnet(apikey, magnet).await?;
        if !upload.cached {
            let _ = Self::delete_magnet(apikey, &upload.id).await;
        }
        Ok(DebridCacheResult {
            cached: upload.cached,
        })
    }

    pub async fn delete_magnet(apikey: &str, id: &str) -> Result<(), String> {
        let client = reqwest::Client::new();
        let id_str = id.to_string();
        let resp = ad_request(
            &client,
            Method::POST,
            "/v4/magnet/delete",
            apikey,
            Some(&[("id", id_str.as_str())]),
        )
        .await?;
        let status = resp.status();
        let body: AllDebridResponse<serde_json::Value> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse delete response: {}", e))?;
        if !status.is_success() || body.status != "success" {
            return Err(ad_err(body));
        }
        Ok(())
    }

    pub async fn get_status(apikey: &str, id: &str) -> Result<DebridStatusResult, String> {
        let client = reqwest::Client::new();
        let id_str = id.to_string();
        let resp = ad_request(
            &client,
            Method::POST,
            "/v4.1/magnet/status",
            apikey,
            Some(&[("id", id_str.as_str())]),
        )
        .await?;
        let status = resp.status();
        let body: AllDebridResponse<AllDebridStatusResponse> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse status response: {}", e))?;

        if !status.is_success() || body.status != "success" {
            return Err(ad_err(body));
        }

        let data = body.data.ok_or_else(|| "Empty response data".to_string())?;
        let mag = data
            .magnets
            .into_iter()
            .next()
            .ok_or_else(|| "Magnet not found in status response".to_string())?;

        let normalized_status = match mag.status_code {
            4 => "ready".to_string(),       // Ready/cache complete
            0..=3 => "downloading".to_string(), // Queued → downloading
            _ => "error".to_string(),
        };

        let progress = if mag.size > 0 {
            (mag.downloaded as f32 / mag.size as f32) * 100.0
        } else {
            0.0
        };

        // Legacy status `links` (empty under v4.1) kept as a fallback so
        // older account responses still yield downloadable entries.
        let mut files: Vec<DebridFile> = mag
            .links
            .into_iter()
            .map(|l| DebridFile {
                name: String::new(),
                size: 0,
                link: l.link,
            })
            .collect();
        let name: Option<String> = mag
            .filename
            .filter(|f| !f.is_empty() && f != "noname");

        // /v4.1/magnet/status no longer embeds the file list inline; fetch it
        // from the dedicated files endpoint once the transfer is ready.
        if normalized_status == "ready" && files.is_empty() {
            if let Ok(files_resp) = ad_request(
                &client,
                Method::POST,
                "/v4/magnet/files",
                apikey,
                Some(&[("id[]", id_str.as_str())]),
            )
            .await
            {
                if let Ok(parsed) = files_resp
                    .json::<AllDebridResponse<AllDebridFilesResponse>>()
                    .await
                {
                    if let Some(payload) = parsed.data {
                        for entry in payload.magnets {
                            collect_files(&entry.files, "", &mut files);
                        }
                    }
                }
            }
        }

        let error_message = if mag.status_code > 4 {
            Some(if mag.status_code_description.is_empty() {
                format!("AllDebrid error code {}", mag.status_code)
            } else {
                mag.status_code_description
            })
        } else {
            None
        };

        Ok(DebridStatusResult {
            id: id.to_string(),
            progress,
            status: normalized_status,
            files,
            name,
            error_message,
        })
    }

    pub async fn unrestrict_link(apikey: &str, url: &str) -> Result<String, String> {
        let client = reqwest::Client::new();
        let resp = ad_request(
            &client,
            Method::POST,
            "/v4/link/unlock",
            apikey,
            Some(&[("link", url)]),
        )
        .await?;
        
        let status = resp.status();
        let body: AllDebridResponse<AllDebridUnlockData> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse AllDebrid unlock response: {}", e))?;

        if !status.is_success() || body.status != "success" {
            return Err(ad_err(body));
        }

        let data = body.data.ok_or_else(|| "Empty response data".to_string())?;
        Ok(data.link)
    }
}

#[derive(Deserialize, Debug)]
struct AllDebridUnlockData {
    link: String,
}

// ─── TorBox Client ───────────────────────────────────────────────────────────

pub struct TorBoxClient;

#[derive(Deserialize, Debug)]
struct TorBoxResponse<T> {
    success: bool,
    detail: Option<String>,
    data: Option<T>,
}

#[derive(Deserialize, Debug)]
struct TorBoxUserResponse {
    user: TorBoxUser,
}

#[derive(Deserialize, Debug)]
struct TorBoxUser {
    email: String,
    is_premium: bool,
}

#[derive(Deserialize, Debug)]
struct TorBoxUploadResponse {
    torrent_id: Option<u64>,
}

#[derive(Deserialize, Debug)]
struct TorBoxTorrentList {
    id: u64,
    progress: f32,
    download_finished: bool,
    download_present: bool,
    active: bool,
}

/// Per-file detail for a TorBox torrent. Documented by the API
/// but unused today: `get_status` collapses downloads to the
/// `/zip` aggregate link, so neither the struct nor any of its
/// fields are read. Kept on stand-by for the per-file unlock
/// path that would supersede the zip fallback.
#[derive(Deserialize, Debug)]
#[allow(dead_code)]
struct TorBoxFile {
    id: u64,
    name: String,
    short_name: String,
    size: u64,
}

#[derive(Deserialize, Debug)]
struct TorBoxZipResponse {
    zip_link: String,
}

impl TorBoxClient {
    pub async fn test_key(apikey: &str) -> Result<DebridUserInfo, String> {
        let client = reqwest::Client::new();
        let resp = client
            .get("https://api.torbox.app/v1/api/user/me")
            .header("Authorization", format!("Bearer {}", apikey))
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        let body: TorBoxResponse<TorBoxUserResponse> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse TorBox user response: {}", e))?;

        if !body.success {
            return Err(body.detail.unwrap_or_else(|| "Invalid API key".to_string()));
        }

        let data = body.data.ok_or("Empty TorBox response data")?;
        Ok(DebridUserInfo {
            username: data.user.email,
            premium_until: if data.user.is_premium { Some(u64::MAX) } else { None },
        })
    }

    pub async fn upload_magnet(apikey: &str, magnet: &str) -> Result<DebridUploadResult, String> {
        let client = reqwest::Client::new();
        let payload = serde_json::json!({
            "magnet": magnet,
            "seed": "false",
            "allow_asymmetric": "true"
        });

        let resp = client
            .post("https://api.torbox.app/v1/api/torrents/createtorrent")
            .header("Authorization", format!("Bearer {}", apikey))
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        let body: TorBoxResponse<TorBoxUploadResponse> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse createtorrent response: {}", e))?;

        if !body.success {
            return Err(body.detail.unwrap_or_else(|| "Failed to upload torrent".to_string()));
        }

        let data = body.data.ok_or("Empty response data")?;
        let id = data
            .torrent_id
            .map(|i| i.to_string())
            .ok_or("No torrent ID returned")?;

        // TorBox does not report cache state at creation time.
        Ok(DebridUploadResult { id, cached: false })
    }

    pub async fn get_status(apikey: &str, id: &str) -> Result<DebridStatusResult, String> {
        let client = reqwest::Client::new();
        let resp = client
            .get("https://api.torbox.app/v1/api/torrents/mylist?bypass=true")
            .header("Authorization", format!("Bearer {}", apikey))
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        let body: TorBoxResponse<Vec<TorBoxTorrentList>> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse mylist response: {}", e))?;

        if !body.success {
            return Err(body.detail.unwrap_or_else(|| "Failed to fetch status list".to_string()));
        }

        let list = body.data.ok_or("Empty list returned")?;
        let numeric_id = id.parse::<u64>().map_err(|_| "Invalid TorBox ID")?;
        let item = list.iter().find(|t| t.id == numeric_id).ok_or("Torrent not found on TorBox")?;

        let status = if item.download_finished && item.download_present {
            "ready".to_string()
        } else if item.active {
            "downloading".to_string()
        } else {
            "queued".to_string()
        };

        // TorBox download link requires request to /zip
        let mut links = Vec::new();
        if status == "ready" {
            // Request direct zip link or list file links.
            // For simplicity, we can fetch the Zip Download URL:
            let zip_resp = client
                .get(format!("https://api.torbox.app/v1/api/torrents/requestdl?torrent_id={}&zip=true", numeric_id))
                .header("Authorization", format!("Bearer {}", apikey))
                .send()
                .await;
            if let Ok(zr) = zip_resp {
                if let Ok(b) = zr.json::<TorBoxResponse<TorBoxZipResponse>>().await {
                    if let Some(d) = b.data {
                        links.push(d.zip_link);
                    }
                }
            }
        }

        let files = links
            .into_iter()
            .map(|link| DebridFile {
                name: String::new(),
                size: 0,
                link,
            })
            .collect();
        Ok(DebridStatusResult {
            id: id.to_string(),
            progress: item.progress * 100.0,
            status,
            files,
            name: None,
            error_message: None,
        })
    }

    /// "Unrestrict" a web download link via TorBox.
    ///
    /// TorBox does not have an `/unrestrict/link` endpoint (that was a
    /// wrong assumption from the AllDebrid API shape). The correct flow
    /// for turning a hoster URL into a TorBox direct-download URL is:
    ///
    ///   1. `POST /v1/api/webdl/createwebdownload` — submit the link.
    ///      Returns a `webdl_id` (the TorBox-internal download job).
    ///   2. `GET  /v1/api/webdl/mylist` — poll until the job is ready.
    ///   3. `GET  /v1/api/webdl/requestdl?webid={id}` — get the direct
    ///      download URL.
    ///
    /// For the unrestrict use case (the frontend calls this right before
    /// handing the URL to the direct downloader), we need the *final*
    /// direct link. We create the web download, poll until it's ready,
    /// then request the direct link. This can take a few seconds if
    /// TorBox's servers need to fetch the file from the hoster.
    pub async fn unrestrict_link(apikey: &str, url: &str) -> Result<String, String> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

        // 1. Create the web download.
        let create_payload = serde_json::json!({
            "link": url,
        });
        let create_resp = client
            .post("https://api.torbox.app/v1/api/webdl/createwebdownload")
            .header("Authorization", format!("Bearer {}", apikey))
            .json(&create_payload)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?
            .json::<TorBoxResponse<TorBoxWebDlCreateData>>()
            .await
            .map_err(|e| format!("Failed to parse createwebdownload response: {}", e))?;
        if !create_resp.success {
            return Err(create_resp.detail.unwrap_or_else(|| {
                "Failed to create TorBox web download".to_string()
            }));
        }
        let webdl_id: u64 = create_resp
            .data
            .ok_or("No data returned from createwebdownload")?
            .webdl_id
            .ok_or("No webdl_id returned from createwebdownload")?;

        // 2. Poll until the web download is ready (up to 60s).
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(2));
        let mut ready = false;
        for _ in 0..30 {
            interval.tick().await;
            let list_resp = client
                .get("https://api.torbox.app/v1/api/webdl/mylist?bypass=true")
                .header("Authorization", format!("Bearer {}", apikey))
                .send()
                .await
                .map_err(|e| format!("Failed to poll webdl list: {}", e))?;
            let body: TorBoxResponse<Vec<TorBoxWebDlListEntry>> =
                list_resp.json().await.map_err(|e| {
                    format!("Failed to parse webdl mylist response: {}", e)
                })?;
            if let Some(entries) = body.data {
                if let Some(entry) = entries.iter().find(|e| e.id == webdl_id) {
                    if entry.download_finished && entry.download_present {
                        ready = true;
                        break;
                    }
                    if let Some(ref err) = entry.error {
                        return Err(format!("TorBox web download failed: {}", err));
                    }
                }
            }
        }
        if !ready {
            return Err("TorBox web download timed out (60s)".to_string());
        }

        // 3. Request the direct download link.
        //
        // TorBox's `requestdl` endpoint uses `web_id` (not `webid`) as
        // the query parameter. There is no `as_url` parameter — the
        // API returns a JSON object with the download link in the
        // `data` field. The `redirect=true` parameter would cause an
        // HTTP redirect instead of a JSON response, which we don't
        // want here (we need the URL as a string to pass to the
        // direct downloader).
        let dl_resp = client
            .get(format!(
                "https://api.torbox.app/v1/api/webdl/requestdl?web_id={}",
                webdl_id
            ))
            .header("Authorization", format!("Bearer {}", apikey))
            .send()
            .await
            .map_err(|e| format!("Failed to request webdl download link: {}", e))?;
        let dl_body: TorBoxResponse<TorBoxWebDlLinkData> = dl_resp.json().await.map_err(|e| {
            format!("Failed to parse webdl requestdl response: {}", e)
        })?;
        if !dl_body.success {
            return Err(dl_body.detail.unwrap_or_else(|| {
                "Failed to get direct download link from TorBox".to_string()
            }));
        }
        dl_body
            .data
            .and_then(|d| d.download_link)
            .ok_or_else(|| "No direct link returned by TorBox".to_string())
    }
}

/// Response from `POST /v1/api/webdl/createwebdownload`.
/// `webdl_id` is the primary field name, but we add `alias = "id"`
/// as a safety net in case TorBox returns the download ID under a
/// different key.
#[derive(Deserialize, Debug)]
struct TorBoxWebDlCreateData {
    #[serde(default, alias = "id")]
    webdl_id: Option<u64>,
}

/// Entry in the `GET /v1/api/webdl/mylist` response array.
/// `#[serde(default)]` on the bool fields guards against TorBox
/// returning a pending entry before those fields are populated —
/// without it the entire `mylist` response would fail to deserialize
/// and kill the poll loop.
#[derive(Deserialize, Debug)]
struct TorBoxWebDlListEntry {
    id: u64,
    #[serde(default)]
    download_finished: bool,
    #[serde(default)]
    download_present: bool,
    #[serde(default)]
    error: Option<String>,
}

/// Response from `GET /v1/api/webdl/requestdl`.
///
/// TorBox returns the direct-download link in the `data` field as an
/// object with a `download_link` key. We use `#[serde(alias)]` to
/// also accept `link` in case TorBox's response shape varies across
/// API versions.
#[derive(Deserialize, Debug)]
struct TorBoxWebDlLinkData {
    #[serde(default, alias = "link")]
    download_link: Option<String>,
}
