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
    /// Magnet-level total size reported by the provider. Fallback when
    /// the per-file entries carry no sizes (sum == 0) so the record
    /// never degrades to "first file only" sizing.
    pub magnet_size: Option<u64>,
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

/// API calls have no business hanging forever — a wedged connection
/// would otherwise hold the download's active slot indefinitely.
fn ad_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_default()
}

pub struct AllDebridClient;

#[derive(Deserialize, Debug)]
struct AllDebridResponse<T> {
    status: String,
    data: Option<T>,
    error: Option<AllDebridError>,
}

#[derive(Deserialize, Debug, Clone)]
struct AllDebridError {
    #[allow(dead_code)]
    #[serde(default)]
    code: String,
    #[serde(default)]
    message: String,
}

#[derive(Deserialize, Debug)]
struct AllDebridUserResponse {
    user: AllDebridUser,
}

#[derive(Deserialize, Debug)]
struct AllDebridUser {
    username: String,
    #[serde(default, rename = "isPremium", alias = "is_premium")]
    is_premium: bool,
    #[serde(default, rename = "premiumUntil", alias = "premium_until")]
    premium_until: u64,
}

#[derive(Deserialize, Debug)]
struct AllDebridUploadResponse {
    #[serde(default, deserialize_with = "deserialize_upload_magnets")]
    magnets: Vec<AllDebridMagnetUpload>,
}

fn deserialize_upload_magnets<'de, D>(deserializer: D) -> Result<Vec<AllDebridMagnetUpload>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum OneOrMany {
        One(AllDebridMagnetUpload),
        Many(Vec<AllDebridMagnetUpload>),
    }
    Ok(match OneOrMany::deserialize(deserializer)? {
        OneOrMany::One(one) => vec![one],
        OneOrMany::Many(many) => many,
    })
}

#[derive(Deserialize, Debug)]
struct AllDebridMagnetUpload {
    #[serde(default)]
    id: Option<u64>,
    /// Whether the torrent is already cached on AllDebrid's servers.
    /// `true` means the files are served instantly and nothing is
    /// re-downloaded.
    #[serde(default)]
    ready: bool,
    #[serde(default)]
    error: Option<AllDebridError>,
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
    #[serde(default, rename = "statusCode", alias = "status_code")]
    status_code: u8,
    #[serde(default, rename = "statusCodeDescription", alias = "status_code_description")]
    status_code_description: String,
    #[serde(default)]
    downloaded: u64,
    /// `links` may be empty (or missing) under /v4.1/magnet/status — the API
    /// moved file-level information to the dedicated /v4/magnet/files endpoint.
    #[serde(default)]
    links: Vec<AllDebridLink>,
}

#[derive(Deserialize, Debug, Clone)]
struct AllDebridFileNode {
    #[serde(default, alias = "name")]
    n: String,
    #[serde(default, alias = "size")]
    s: u64,
    #[serde(default, alias = "link", alias = "downloadUrl")]
    l: Option<String>,
    #[serde(default, alias = "entries")]
    e: Vec<AllDebridFileNode>,
}

#[derive(Deserialize, Debug)]
struct AllDebridLink {
    link: String,
}

/// Parse the arbitrary JSON shapes of `/v4/magnet/files` (array of entries, single object,
/// or dictionary keyed by magnet ID) and collect all file nodes.
fn parse_files_from_json(val: &serde_json::Value, out: &mut Vec<DebridFile>) {
    if let Some(obj) = val.as_object() {
        if let Some(magnets_val) = obj.get("magnets") {
            if let Some(arr) = magnets_val.as_array() {
                for item in arr {
                    if let Some(files) = item.get("files") {
                        if let Ok(nodes) = serde_json::from_value::<Vec<AllDebridFileNode>>(files.clone()) {
                            collect_files(&nodes, "", out);
                        }
                    }
                }
            } else if let Some(mag_obj) = magnets_val.as_object() {
                if let Some(files) = mag_obj.get("files") {
                    if let Ok(nodes) = serde_json::from_value::<Vec<AllDebridFileNode>>(files.clone()) {
                        collect_files(&nodes, "", out);
                    }
                } else {
                    for (_k, v) in mag_obj {
                        if let Some(files) = v.get("files") {
                            if let Ok(nodes) = serde_json::from_value::<Vec<AllDebridFileNode>>(files.clone()) {
                                collect_files(&nodes, "", out);
                            }
                        }
                    }
                }
            }
        } else if let Some(files) = obj.get("files") {
            if let Ok(nodes) = serde_json::from_value::<Vec<AllDebridFileNode>>(files.clone()) {
                collect_files(&nodes, "", out);
            }
        }
    } else if let Some(arr) = val.as_array() {
        for item in arr {
            if let Some(files) = item.get("files") {
                if let Ok(nodes) = serde_json::from_value::<Vec<AllDebridFileNode>>(files.clone()) {
                    collect_files(&nodes, "", out);
                }
            }
        }
    }
}

/// Flatten a `/v4/magnet/files` node tree into per-file entries (DFS
/// pre-order). Folder nodes carry `n` + `e`; file nodes carry `n` + `s` +
/// `l`. The name keeps its folder path so same-named files in different
/// subfolders stay distinct (the manager later flattens `/` to `_`).
fn collect_files(nodes: &[AllDebridFileNode], parent: &str, out: &mut Vec<DebridFile>) {
    for node in nodes {
        let full = if parent.is_empty() {
            node.n.clone()
        } else if node.n.is_empty() {
            parent.to_string()
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
        .header("Authorization", format!("Bearer {}", apikey.trim()));
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
        let client = ad_client();
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
        let client = ad_client();
        let trimmed_mag = magnet.trim();
        let resp = ad_request(
            &client,
            Method::POST,
            "/v4/magnet/upload",
            apikey,
            Some(&[("magnets[]", trimmed_mag)]),
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
        if let Some(err) = &mag.error {
            if !err.message.is_empty() {
                return Err(err.message.clone());
            }
        }
        let id = mag
            .id
            .ok_or_else(|| "No magnet id returned by AllDebrid".to_string())?;
        Ok(DebridUploadResult {
            id: id.to_string(),
            cached: mag.ready,
        })
    }

    /// Check whether a magnet is already cached, without leaving it in
    /// the account. Uploading is the only remaining availability signal;
    /// the probe magnet is always removed after checking so searches do not
    /// exhaust the user's active account torrent slots.
    pub async fn check_cache(apikey: &str, magnet: &str) -> Result<DebridCacheResult, String> {
        let upload = Self::upload_magnet(apikey, magnet).await?;
        // Always clean up the temporary probe magnet from the account.
        let _ = Self::delete_magnet(apikey, &upload.id).await;
        Ok(DebridCacheResult {
            cached: upload.cached,
        })
    }

    pub async fn delete_magnet(apikey: &str, id: &str) -> Result<(), String> {
        let client = ad_client();
        let id_str = id.trim().to_string();
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
        let client = ad_client();
        let id_str = id.trim().to_string();
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
            4 => "ready".to_string(),           // Ready/cache complete
            0..=3 => "downloading".to_string(), // Queued → downloading
            _ => "error".to_string(),
        };

        let progress = if mag.size > 0 {
            (mag.downloaded as f32 / mag.size as f32) * 100.0
        } else {
            0.0
        };

        // /v4.1/magnet/status no longer embeds the file list inline; the
        // dedicated files endpoint is authoritative. Try it FIRST once the
        // transfer is ready — legacy status `links` are only a fallback for
        // older account responses where the fetch yields nothing.
        let mut files: Vec<DebridFile> = Vec::new();
        if normalized_status == "ready" {
            if let Ok(files_resp) = ad_request(
                &client,
                Method::POST,
                "/v4/magnet/files",
                apikey,
                Some(&[("id[]", id_str.as_str())]),
            )
            .await
            {
                if let Ok(parsed_json) = files_resp.json::<serde_json::Value>().await {
                    if let Some(payload) = parsed_json.get("data") {
                        parse_files_from_json(payload, &mut files);
                    }
                }
            }
        }
        if files.is_empty() {
            files.extend(mag.links.into_iter().map(|l| DebridFile {
                name: String::new(),
                size: 0,
                link: l.link,
            }));
        }

        let name: Option<String> = mag
            .filename
            .filter(|f| !f.is_empty() && f != "noname");

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
            magnet_size: if mag.size > 0 { Some(mag.size) } else { None },
            error_message,
        })
    }

    pub async fn unrestrict_link(apikey: &str, url: &str) -> Result<String, String> {
        let client = ad_client();
        let trimmed_url = url.trim();
        let resp = ad_request(
            &client,
            Method::POST,
            "/v4/link/unlock",
            apikey,
            Some(&[("link", trimmed_url)]),
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
        if !data.link.is_empty() {
            return Ok(data.link);
        }

        // Delayed unlock: the hoster needs time to generate the file.
        // Poll the delayed endpoint every 5 s (12 attempts ≈ 60 s) until
        // the direct link appears, so callers never fall back to the raw
        // /f/ page link (which is HTML, not a download).
        let Some(delayed_id) = data.delayed.as_ref().and_then(delayed_id_as_string) else {
            return Err("AllDebrid returned an empty direct download link".to_string());
        };
        const DELAYED_POLL_ATTEMPTS: u32 = 12;
        for _ in 0..DELAYED_POLL_ATTEMPTS {
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            let resp = ad_request(
                &client,
                Method::POST,
                "/v4/link/delayed",
                apikey,
                Some(&[("id", delayed_id.as_str())]),
            )
            .await?;
            let status = resp.status();
            let body: AllDebridResponse<AllDebridUnlockData> = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse AllDebrid delayed response: {}", e))?;
            if !status.is_success() || body.status != "success" {
                return Err(ad_err(body));
            }
            if let Some(data) = body.data {
                if !data.link.is_empty() {
                    return Ok(data.link);
                }
            }
        }
        Err("AllDebrid link generation timed out".to_string())
    }
}

#[derive(Deserialize, Debug)]
struct AllDebridUnlockData {
    #[serde(default, alias = "downloadUrl", alias = "directUrl")]
    link: String,
    /// Hosters that throttle link generation answer with a `delayed`
    /// job id instead of an immediate `link`; poll `/v4/link/delayed`
    /// until the direct link appears.
    #[serde(default)]
    delayed: Option<serde_json::Value>,
}

/// Normalise the `delayed` field to the string id expected by
/// `/v4/link/delayed` (the API has returned both strings and numbers).
fn delayed_id_as_string(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::String(s) => {
            let t = s.trim();
            (!t.is_empty()).then(|| t.to_string())
        }
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
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
            magnet_size: None,
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

// ─── Real-Debrid Client ──────────────────────────────────────────────────────

pub struct RealDebridClient;

#[derive(Deserialize, Debug)]
struct RealDebridUser {
    username: String,
    #[serde(default)]
    premium: u64,
    #[serde(default)]
    expiration: Option<String>,
}

#[derive(Deserialize, Debug)]
struct RealDebridUnrestrictResponse {
    download: Option<String>,
    link: Option<String>,
}

#[derive(Deserialize, Debug)]
struct RealDebridAddMagnetResponse {
    id: String,
}

#[derive(Deserialize, Debug)]
#[allow(dead_code)]
struct RealDebridTorrentInfo {
    id: String,
    filename: String,
    status: String,
    progress: f32,
    #[serde(default)]
    links: Vec<String>,
}

impl RealDebridClient {
    pub async fn test_key(apikey: &str) -> Result<DebridUserInfo, String> {
        let client = reqwest::Client::new();
        let resp = client
            .get("https://api.real-debrid.com/rest/1.0/user")
            .header("Authorization", format!("Bearer {}", apikey))
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?;

        if !resp.status().is_success() {
            return Err("Invalid Real-Debrid API token or unauthorized".to_string());
        }

        let user: RealDebridUser = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse Real-Debrid user response: {e}"))?;

        let is_premium = user.premium > 0 || user.expiration.is_some();
        let premium_until = if is_premium {
            Some(u64::MAX)
        } else {
            None
        };

        Ok(DebridUserInfo {
            username: user.username,
            premium_until,
        })
    }

    pub async fn unrestrict_link(apikey: &str, url: &str) -> Result<String, String> {
        let client = reqwest::Client::new();
        let resp = client
            .post("https://api.real-debrid.com/rest/1.0/unrestrict/link")
            .header("Authorization", format!("Bearer {}", apikey))
            .form(&[("link", url)])
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?;

        let status = resp.status();
        if !status.is_success() {
            let err_text = resp.text().await.unwrap_or_default();
            return Err(format!(
                "Real-Debrid unrestrict failed (HTTP {}): {}",
                status.as_u16(),
                err_text
            ));
        }

        let body: RealDebridUnrestrictResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse Real-Debrid unrestrict response: {e}"))?;

        body.download
            .or(body.link)
            .ok_or_else(|| "No direct download link returned by Real-Debrid".to_string())
    }

    pub async fn upload_magnet(apikey: &str, magnet: &str) -> Result<DebridUploadResult, String> {
        let client = reqwest::Client::new();
        let resp = client
            .post("https://api.real-debrid.com/rest/1.0/torrents/addMagnet")
            .header("Authorization", format!("Bearer {}", apikey))
            .form(&[("magnet", magnet)])
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?;

        if !resp.status().is_success() {
            let err_text = resp.text().await.unwrap_or_default();
            return Err(format!("Failed to upload magnet to Real-Debrid: {err_text}"));
        }

        let body: RealDebridAddMagnetResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse Real-Debrid addMagnet response: {e}"))?;

        let _ = client
            .post(format!(
                "https://api.real-debrid.com/rest/1.0/torrents/selectFiles/{}",
                body.id
            ))
            .header("Authorization", format!("Bearer {}", apikey))
            .form(&[("files", "all")])
            .send()
            .await;

        Ok(DebridUploadResult {
            id: body.id,
            cached: false,
        })
    }

    pub async fn get_status(apikey: &str, id: &str) -> Result<DebridStatusResult, String> {
        let client = reqwest::Client::new();
        let resp = client
            .get(format!(
                "https://api.real-debrid.com/rest/1.0/torrents/info/{}",
                id
            ))
            .header("Authorization", format!("Bearer {}", apikey))
            .send()
            .await
            .map_err(|e| format!("Request failed: {e}"))?;

        if !resp.status().is_success() {
            return Err("Failed to fetch torrent status from Real-Debrid".to_string());
        }

        let info: RealDebridTorrentInfo = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse Real-Debrid torrent info: {e}"))?;

        let status = match info.status.as_str() {
            "downloaded" => "ready".to_string(),
            "downloading" | "compressing" | "uploading" => "downloading".to_string(),
            "queued" | "waiting_files_selection" => "queued".to_string(),
            _ => "error".to_string(),
        };

        let mut files = Vec::new();
        if status == "ready" {
            for link in info.links {
                if let Ok(unrestricted) = Self::unrestrict_link(apikey, &link).await {
                    files.push(DebridFile {
                        name: String::new(),
                        size: 0,
                        link: unrestricted,
                    });
                } else {
                    files.push(DebridFile {
                        name: String::new(),
                        size: 0,
                        link,
                    });
                }
            }
        }

        Ok(DebridStatusResult {
            id: id.to_string(),
            progress: info.progress,
            status,
            files,
            name: Some(info.filename),
            magnet_size: None,
            error_message: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_files_from_json_documented_payload() {
        // Live shape of POST /v4/magnet/files (data payload): magnets[] →
        // files[] tree with short keys n/s/l and nested folders via e.
        let payload = serde_json::json!({
            "magnets": [
                {
                    "id": 1,
                    "files": [
                        {"n": "a.iso", "s": 145517304, "l": "https://alldebrid.com/f/x"},
                        {"n": "docs", "e": [
                            {"n": "README.txt", "s": 87207, "l": "https://alldebrid.com/f/y"}
                        ]}
                    ]
                }
            ]
        });
        let mut out = Vec::new();
        parse_files_from_json(&payload, &mut out);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].name, "a.iso");
        assert_eq!(out[0].size, 145_517_304);
        assert_eq!(out[0].link, "https://alldebrid.com/f/x");
        assert_eq!(out[1].name, "docs/README.txt");
        assert_eq!(out[1].size, 87_207);
        assert_eq!(out[1].link, "https://alldebrid.com/f/y");
    }

    #[test]
    fn collect_files_empty_name_keeps_parent_path() {
        let nodes: Vec<AllDebridFileNode> = serde_json::from_value(serde_json::json!([
            {"n": "", "s": 10, "l": "https://alldebrid.com/f/z"}
        ]))
        .unwrap();
        let mut out = Vec::new();
        collect_files(&nodes, "parent_dir", &mut out);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].name, "parent_dir");
    }

    #[test]
    fn magnet_status_ready_without_optional_fields_parses() {
        // Regression: once statusCode=4 the v4.1 status response drops
        // downloaded/links/uploaded — and a single-id query returns
        // `magnets` as ONE OBJECT, not an array. Both must parse.
        let body: AllDebridStatusResponse = serde_json::from_value(serde_json::json!({
            "magnets": {
                "id": 42,
                "filename": "Some.Game-CRACKED",
                "size": 145_604_511,
                "statusCode": 4,
                "statusCodeDescription": "Ready"
            }
        }))
        .expect("single-object magnets shape must deserialize");
        assert_eq!(body.magnets.len(), 1);
        let mag = &body.magnets[0];
        assert_eq!(mag.status_code, 4);
        assert_eq!(mag.size, 145_604_511);
        assert_eq!(mag.downloaded, 0);
        assert!(mag.links.is_empty());

        let body: AllDebridStatusResponse = serde_json::from_value(serde_json::json!({
            "magnets": [{"id": 7, "statusCode": 4}]
        }))
        .expect("array magnets shape must deserialize");
        assert_eq!(body.magnets.len(), 1);
        assert_eq!(body.magnets[0].status_code, 4);
    }

    #[test]
    fn unlock_data_accepts_delayed_and_link_shapes() {
        let data: AllDebridUnlockData =
            serde_json::from_value(serde_json::json!({"link": "", "delayed": "abc123"}))
                .expect("delayed-only unlock response must deserialize");
        assert_eq!(data.link, "");
        assert_eq!(
            delayed_id_as_string(data.delayed.as_ref().unwrap()).as_deref(),
            Some("abc123")
        );

        let data: AllDebridUnlockData = serde_json::from_value(
            serde_json::json!({"link": "https://cdn.alldebrid.com/dl/f", "filesize": 123}),
        )
        .expect("immediate unlock response must deserialize");
        assert_eq!(data.link, "https://cdn.alldebrid.com/dl/f");
        assert!(data.delayed.is_none());

        // Numeric delayed ids (older API shape) normalise too.
        assert_eq!(
            delayed_id_as_string(&serde_json::json!(98765)).as_deref(),
            Some("98765")
        );
        assert_eq!(delayed_id_as_string(&serde_json::json!("")), None);
    }
}

