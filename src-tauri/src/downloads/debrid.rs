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
    /// Provider-side id for this file, when the provider exposes one.
    /// TorBox's `requestdl` needs it, and the link refresher uses it to mint
    /// a fresh URL for a long download. AllDebrid and Real-Debrid leave it
    /// `None` — their refresher re-unlocks the original link instead.
    #[serde(default)]
    pub file_id: Option<u64>,
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

/// A single file entry in a debrid file listing. Links are omitted —
/// listing is about choosing; the download resolves the links later.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DebridFileEntry {
    pub name: String,
    pub size: u64,
}

/// Result of listing a magnet's files on a debrid provider (no
/// download started).
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DebridFileListResult {
    pub files: Vec<DebridFileEntry>,
    /// Magnet-level display name reported by the provider, when known.
    pub name: Option<String>,
    /// Magnet-level total size reported by the provider.
    pub total_size: u64,
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
                    file_id: None,
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

    /// List the files of a magnet WITHOUT downloading it. Uploads the
    /// magnet, polls until AllDebrid exposes the file tree (instant for
    /// cached magnets, a couple of seconds once it has scanned the
    /// metadata otherwise), then removes the probe magnet from the
    /// account so the user's active torrent slots are not consumed by a
    /// listing that never downloads.
    ///
    /// The file order reported here is the SAME order the download flow
    /// resolves (both hit `/v4/magnet/files`), so the indices the caller
    /// hands back as `only_files` align with the final download.
    pub async fn list_magnet_files(
        apikey: &str,
        magnet: &str,
    ) -> Result<DebridFileListResult, String> {
        let upload = Self::upload_magnet(apikey, magnet).await?;
        let id = upload.id.clone();

        const POLL_INTERVAL_SECS: u64 = 2;
        // Worst-case bound for magnet metadata that AllDebrid is still
        // pulling from the swarm. Cached magnets resolve on the first poll.
        const LIST_DEADLINE_SECS: u64 = 120;

        let client = ad_client();
        let deadline = std::time::Instant::now()
            + std::time::Duration::from_secs(LIST_DEADLINE_SECS);

        let mut files: Vec<DebridFileEntry> = Vec::new();
        let mut name: Option<String> = None;
        let mut total_size: u64 = 0;
        let mut first = true;

        loop {
            if !first {
                tokio::time::sleep(std::time::Duration::from_secs(POLL_INTERVAL_SECS)).await;
            }
            first = false;
            if std::time::Instant::now() >= deadline {
                break;
            }

            // The file tree lives under /v4/magnet/files and appears as
            // soon as AllDebrid has scanned the magnet metadata, not only
            // once the transfer is fully "ready".
            if files.is_empty() {
                if let Ok(resp) = ad_request(
                    &client,
                    Method::POST,
                    "/v4/magnet/files",
                    apikey,
                    Some(&[("id[]", id.as_str())]),
                )
                .await
                {
                    if let Ok(parsed) = resp.json::<serde_json::Value>().await {
                        if let Some(payload) = parsed.get("data") {
                            let mut collected: Vec<DebridFile> = Vec::new();
                            parse_files_from_json(payload, &mut collected);
                            files = collected
                                .into_iter()
                                .map(|f| DebridFileEntry {
                                    name: f.name,
                                    size: f.size,
                                })
                                .collect();
                        }
                    }
                }
            }

            // Display name + magnet-level size come from the status
            // endpoint; grab them once the file list is available.
            if !files.is_empty() {
                if let Ok(status) = Self::get_status(apikey, &id).await {
                    if name.is_none() {
                        name = status.name;
                    }
                    if total_size == 0 {
                        total_size = status.magnet_size.unwrap_or(0);
                    }
                }
                break;
            }
        }

        // Always free the account slot, even on failure or timeout.
        let _ = Self::delete_magnet(apikey, &id).await;

        if files.is_empty() {
            return Err(
                "AllDebrid could not list the files of this magnet — it may be dead \
                 or its metadata is unavailable."
                    .to_string(),
            );
        }

        Ok(DebridFileListResult {
            files,
            name,
            total_size,
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
                file_id: None,
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
    /// Machine-readable failure code (`DUPLICATE_ITEM`, `BOZO_TORRENT`, …).
    /// Branch on this rather than on the prose in `detail`.
    #[serde(default)]
    error: Option<String>,
    detail: Option<String>,
    data: Option<T>,
}

/// TorBox API client. A wedged connection must not hold a download's active
/// slot indefinitely.
fn tb_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// `/v1/api/user/me` returns the user object DIRECTLY in `data` -- there is no
/// `user` wrapper, and no `is_premium` boolean. Shape verified against TorBox's
/// own generated SDKs (torbox-sdk-go / -dotnet / -py). Requiring `data.user`
/// made every valid key fail with `missing field `user``, surfaced to the user
/// as reqwest's "error decoding response body".
#[derive(Deserialize, Debug)]
struct TorBoxUserData {
    #[serde(default)]
    email: Option<String>,
    /// 0 = Free, 1 = Essential, 2 = Pro, 3 = Standard.
    #[serde(default)]
    plan: u64,
    #[serde(default)]
    is_subscribed: bool,
    /// Not in TorBox's published schema; present on some responses.
    #[serde(default)]
    is_premium: Option<bool>,
}

#[derive(Deserialize, Debug)]
struct TorBoxUploadResponse {
    torrent_id: Option<u64>,
}

/// One entry of `GET /v1/api/torrents/mylist`.
///
/// Every field is `Option` on purpose. The endpoint returns the WHOLE account,
/// so a single odd row breaks the parse for every download: TorBox reports
/// `size: -1` for a torrent whose size it does not know (6 of 400 here) and
/// `files: null` for ones it never fetched (14 of 400). A `u64` size cannot
/// hold -1 and `#[serde(default)]` does not accept an explicit `null`, so
/// strict types made the poll fail with "error decoding response body" until
/// the download gave up.
#[derive(Deserialize, Debug)]
struct TorBoxTorrentList {
    #[serde(default)]
    id: Option<u64>,
    #[serde(default)]
    progress: Option<f32>,
    #[serde(default)]
    download_finished: Option<bool>,
    #[serde(default)]
    download_present: Option<bool>,
    #[serde(default)]
    active: Option<bool>,
    #[serde(default)]
    name: Option<String>,
    /// `-1` means unknown; see the struct note. Keep it signed and filter.
    #[serde(default)]
    size: Option<i64>,
    /// File tree, `null` until TorBox has the metadata.
    /// `id` here is the `file_id` `torrents/requestdl` requires.
    #[serde(default)]
    files: Option<Vec<TorBoxFile>>,
}

/// Per-file detail for a TorBox torrent: `id` is the `file_id` that
/// `torrents/requestdl` needs, and `name` / `size` drive both the modal's
/// file picker and the on-disk naming of the saved files.
#[derive(Deserialize, Debug, Clone)]
struct TorBoxFile {
    #[serde(default)]
    id: Option<u64>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    short_name: Option<String>,
    #[serde(default)]
    size: Option<i64>,
}

/// Accepts a JSON number OR a numeric string -- TorBox is inconsistent between
/// endpoints (torrent ids are numbers, webdl ids are strings).
#[derive(Deserialize, Debug)]
#[serde(untagged)]
enum TorBoxId {
    Num(u64),
    Str(String),
}

impl std::fmt::Display for TorBoxId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TorBoxId::Num(n) => write!(f, "{}", n),
            TorBoxId::Str(s) => write!(f, "{}", s),
        }
    }
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

        let body: TorBoxResponse<TorBoxUserData> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse TorBox user response: {}", e))?;

        if !body.success {
            return Err(body.detail.unwrap_or_else(|| "Invalid API key".to_string()));
        }

        let data = body.data.ok_or("Empty TorBox response data")?;
        // TorBox reports the tier as a numeric plan plus a subscription flag,
        // not as an `is_premium` boolean.
        let is_premium = data.is_premium.unwrap_or(false) || data.is_subscribed || data.plan > 0;
        Ok(DebridUserInfo {
            username: data.email.unwrap_or_else(|| "TorBox user".to_string()),
            premium_until: if is_premium { Some(u64::MAX) } else { None },
        })
    }

    pub async fn upload_magnet(apikey: &str, magnet: &str) -> Result<DebridUploadResult, String> {
        let client = reqwest::Client::new();
        // TorBox's create route parses **multipart/form-data**, not JSON. A
        // JSON body is answered with HTTP 400 `MISSING_REQUIRED_OPTION — You
        // must provide either a file or magnet link`, i.e. TorBox never sees
        // the magnet and every TorBox download dies at the upload step. The
        // `seed` / `allow_asymmetric` extras the JSON body carried never took
        // effect (the whole request was rejected), so they are dropped rather
        // than guessed at; verified live:
        //   multipart {magnet} -> 200, "Found Cached Torrent. Using Cached Torrent."
        let form = reqwest::multipart::Form::new().text("magnet", magnet.to_string());

        let resp = client
            .post("https://api.torbox.app/v1/api/torrents/createtorrent")
            .header("Authorization", format!("Bearer {}", apikey))
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        let body: TorBoxResponse<TorBoxUploadResponse> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse createtorrent response: {}", e))?;

        if !body.success {
            let err_code = body.error.clone().unwrap_or_default();
            let detail = body.detail.clone().unwrap_or_default();

            // Surface TorBox's machine-readable code next to its prose: the
            // code is what made `MISSING_REQUIRED_OPTION` (a request-format
            // fault) distinguishable from a genuine account problem.
            return Err(match (detail.is_empty(), err_code.is_empty()) {
                (false, false) => format!("{} [{}]", detail, err_code),
                (false, true) => detail,
                (true, false) => format!("Failed to upload torrent [{}]", err_code),
                (true, true) => "Failed to upload torrent".to_string(),
            });
        }

        let data = body.data.ok_or("Empty response data")?;
        let id = data
            .torrent_id
            .map(|i| i.to_string())
            .ok_or("No torrent ID returned")?;

        // TorBox states a cache hit only in prose ("Found Cached Torrent.
        // Using Cached Torrent."), so read it out of `detail`.
        let cached = body
            .detail
            .as_deref()
            .map(|d| d.to_lowercase().contains("cached"))
            .unwrap_or(false);
        Ok(DebridUploadResult { id, cached })
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
        let item = list
            .iter()
            .find(|t| t.id == Some(numeric_id))
            .ok_or("Torrent not found on TorBox")?;

        let finished = item.download_finished.unwrap_or(false);
        let present = item.download_present.unwrap_or(false);
        let status = if finished && present {
            "ready".to_string()
        } else if item.active.unwrap_or(false) {
            "downloading".to_string()
        } else {
            "queued".to_string()
        };

        // Resolve per-file direct links once the transfer is ready.
        //
        // TorBox rejects `requestdl` unless the API key is passed as a
        // `token` QUERY param — the Authorization header alone earns
        // HTTP 422 `{"loc":["query","token"],"msg":"Field required"}` — and
        // asking per file is what lets the modal's file selection skip
        // optional content (a repack's bonus soundtrack, sample files)
        // instead of forcing the whole torrent through as one archive.
        let mut files: Vec<DebridFile> = Vec::new();
        if status == "ready" {
            for f in item.files.clone().unwrap_or_default() {
                // A file listed without an id cannot be addressed by
                // `requestdl`, so skip it rather than fail the whole download.
                let Some(file_id) = f.id else { continue };
                if let Some(link) =
                    Self::request_file_link(&client, apikey, numeric_id, file_id).await
                {
                    let name = f.name.clone().filter(|n| !n.trim().is_empty());
                    files.push(DebridFile {
                        name: name.or_else(|| f.short_name.clone()).unwrap_or_default(),
                        // -1 / null means TorBox does not know the size; the
                        // manager sums these for the progress bar.
                        size: f.size.filter(|s| *s > 0).map(|s| s as u64).unwrap_or(0),
                        link,
                        file_id: Some(file_id),
                    });
                }
            }

            // Torrents that expose no per-file tree must still download:
            // fall back to the aggregate zip link.
            if files.is_empty() {
                if let Some(link) = Self::request_zip_link(&client, apikey, numeric_id).await {
                    files.push(DebridFile {
                        name: String::new(),
                        size: item.size.filter(|s| *s > 0).map(|s| s as u64).unwrap_or(0),
                        link,
                        file_id: None,
                    });
                }
            }
        }

        Ok(DebridStatusResult {
            id: id.to_string(),
            progress: item.progress.unwrap_or(0.0) * 100.0,
            status,
            files,
            name: item.name.clone(),
            magnet_size: item.size.filter(|s| *s > 0).map(|s| s as u64),
            error_message: None,
        })
    }

    /// Ask TorBox for one file's direct CDN link.
    ///
    /// The `token` query param is mandatory (`Authorization` alone is not
    /// accepted on this route), and the whole URL is built with
    /// `Url::parse_with_params` so the key is percent-encoded rather than
    /// string-spliced into a query string.
    pub(crate) async fn request_file_link(
        client: &reqwest::Client,
        apikey: &str,
        torrent_id: u64,
        file_id: u64,
    ) -> Option<String> {
        let url = reqwest::Url::parse_with_params(
            "https://api.torbox.app/v1/api/torrents/requestdl",
            &[
                ("token", apikey),
                ("torrent_id", &torrent_id.to_string()),
                ("file_id", &file_id.to_string()),
            ],
        )
        .ok()?;
        Self::requestdl(client, url).await
    }

    /// Ask TorBox for the aggregate zip link for a whole torrent.
    pub(crate) async fn request_zip_link(
        client: &reqwest::Client,
        apikey: &str,
        torrent_id: u64,
    ) -> Option<String> {
        let url = reqwest::Url::parse_with_params(
            "https://api.torbox.app/v1/api/torrents/requestdl",
            &[
                ("token", apikey),
                ("torrent_id", &torrent_id.to_string()),
                ("zip", "true"),
            ],
        )
        .ok()?;
        Self::requestdl(client, url).await
    }

    /// Shared `requestdl` GET: `data` carries the link as a bare string.
    async fn requestdl(client: &reqwest::Client, url: reqwest::Url) -> Option<String> {
        let resp = client
            .get(url)
            .header("Accept", "application/json")
            .send()
            .await
            .ok()?;
        let body: TorBoxResponse<String> = resp.json().await.ok()?;
        body.data.filter(|s| !s.is_empty())
    }

    /// Is this magnet already cached on TorBox?
    ///
    /// Uses the dedicated availability endpoint, so unlike the AllDebrid
    /// path this adds nothing to the account (and therefore has nothing to
    /// clean up afterwards).
    pub async fn check_cache(apikey: &str, magnet: &str) -> Result<DebridCacheResult, String> {
        let btih = super::torrent::btih_from_magnet(magnet)
            .ok_or("Could not read a 40-hex infohash from this magnet")?;

        let url = reqwest::Url::parse_with_params(
            "https://api.torbox.app/v1/api/torrents/checkcached",
            &[("hash", btih.as_str()), ("list_files", "false")],
        )
        .map_err(|e| format!("Failed to build checkcached URL: {}", e))?;

        let resp = tb_client()
            .get(url)
            .header("Authorization", format!("Bearer {}", apikey))
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        let body: TorBoxResponse<serde_json::Value> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse checkcached response: {}", e))?;

        if !body.success {
            return Err(body
                .detail
                .unwrap_or_else(|| "Cache check failed".to_string()));
        }

        // Cached items come back as a map keyed by infohash; an empty map
        // (or a bare false) means the hash is not cached.
        let cached = match body.data {
            Some(serde_json::Value::Object(map)) => {
                map.keys().any(|k| k.eq_ignore_ascii_case(&btih))
            }
            Some(serde_json::Value::Bool(b)) => b,
            _ => false,
        };

        Ok(DebridCacheResult { cached })
    }

    /// List a magnet's files without starting a download.
    ///
    /// `/torrentinfo` is public and hash-addressed, so this works whether or
    /// not the torrent is already in the account and leaves the account
    /// untouched. Files come back in the torrent's own order — the same
    /// order `get_status` resolves links in — so the indices the frontend
    /// hands back as `only_files` line up with the download.
    pub async fn list_magnet_files(
        apikey: &str,
        magnet: &str,
    ) -> Result<DebridFileListResult, String> {
        #[derive(Deserialize, Debug)]
        struct TorrentInfo {
            #[serde(default)]
            name: Option<String>,
            #[serde(default)]
            size: u64,
            #[serde(default)]
            files: Vec<TorrentInfoFile>,
        }
        #[derive(Deserialize, Debug)]
        struct TorrentInfoFile {
            #[serde(default)]
            name: String,
            #[serde(default)]
            size: u64,
        }

        let btih = super::torrent::btih_from_magnet(magnet)
            .ok_or("Could not read a 40-hex infohash from this magnet")?;

        let url = reqwest::Url::parse_with_params(
            "https://api.torbox.app/v1/api/torrents/torrentinfo",
            &[("hash", btih.as_str())],
        )
        .map_err(|e| format!("Failed to build torrentinfo URL: {}", e))?;

        let resp = tb_client()
            .get(url)
            .header("Authorization", format!("Bearer {}", apikey))
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        let body: TorBoxResponse<TorrentInfo> = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse torrentinfo response: {}", e))?;

        if !body.success {
            return Err(body
                .detail
                .unwrap_or_else(|| "Failed to list torrent files".to_string()));
        }

        let data = body.data.ok_or("Empty TorBox torrentinfo data")?;
        let files: Vec<DebridFileEntry> = data
            .files
            .into_iter()
            .map(|f| DebridFileEntry {
                name: f.name,
                size: f.size,
            })
            .collect();

        if files.is_empty() {
            return Err(
                "TorBox could not list the files of this magnet — it may be dead \
                 or its metadata is unavailable."
                    .to_string(),
            );
        }

        Ok(DebridFileListResult {
            files,
            name: data.name,
            total_size: data.size,
        })
    }

    /// "Unrestrict" a web download link via TorBox.
    ///
    /// TorBox does not have an `/unrestrict/link` endpoint (that was a
    /// wrong assumption from the AllDebrid API shape). The correct flow
    /// for turning a hoster URL into a TorBox direct-download URL is:
    ///
    ///   1. `POST /v1/api/webdl/createwebdownload` — submit the link.
    ///      Returns a `webdownload_id` (the TorBox-internal download job).
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
        let webdl_id: String = create_resp
            .data
            .ok_or("No data returned from createwebdownload")?
            .webdownload_id
            .ok_or("No webdownload_id returned from createwebdownload")?;

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
                if let Some(entry) = entries.iter().find(|e| e.id.to_string() == webdl_id) {
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
        let dl_body: TorBoxResponse<String> = dl_resp.json().await.map_err(|e| {
            format!("Failed to parse webdl requestdl response: {}", e)
        })?;
        if !dl_body.success {
            return Err(dl_body.detail.unwrap_or_else(|| {
                "Failed to get direct download link from TorBox".to_string()
            }));
        }
        dl_body
            .data
            .filter(|d| !d.is_empty())
            .ok_or_else(|| "No direct link returned by TorBox".to_string())
    }
}

/// Response from `POST /v1/api/webdl/createwebdownload`.
///
/// TorBox returns the job id as `webdownload_id` (a string), not `webdl_id`.
/// `alias` keeps older/odd payloads working.
#[derive(Deserialize, Debug)]
struct TorBoxWebDlCreateData {
    #[serde(default, alias = "webdl_id", alias = "id")]
    webdownload_id: Option<String>,
}

/// Entry in the `GET /v1/api/webdl/mylist` response array.
/// `#[serde(default)]` on the bool fields guards against TorBox
/// returning a pending entry before those fields are populated —
/// without it the entire `mylist` response would fail to deserialize
/// and kill the poll loop.
#[derive(Deserialize, Debug)]
struct TorBoxWebDlListEntry {
    id: TorBoxId,
    #[serde(default)]
    download_finished: bool,
    #[serde(default)]
    download_present: bool,
    #[serde(default)]
    error: Option<String>,
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
                        file_id: None,
                    });
                } else {
                    files.push(DebridFile {
                        name: String::new(),
                        size: 0,
                        link,
                        file_id: None,
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

    #[test]
    fn torbox_user_me_returns_the_user_object_directly() {
        // Live shape of GET /v1/api/user/me: `data` IS the user object —
        // there is no `user` wrapper and no `is_premium` boolean. The old
        // structs required both, which failed every valid key with
        // `missing field `user``.
        let body: TorBoxResponse<TorBoxUserData> = serde_json::from_value(serde_json::json!({
            "success": true,
            "detail": null,
            "data": {
                "email": "user@example.com",
                "plan": 1,
                "is_subscribed": true,
                "premium_expires_at": "2026-11-01T00:00:00Z"
            }
        }))
        .expect("documented /user/me success payload must deserialize");

        let data = body.data.expect("data present");
        assert_eq!(data.email.as_deref(), Some("user@example.com"));
        assert_eq!(data.plan, 1);
        assert!(data.is_subscribed);
        assert!(data.is_premium.is_none());
    }

    #[test]
    fn torbox_api_error_envelope_deserializes_without_data() {
        // The failure envelope (invalid key) carries a machine code in
        // `error` and `data: null`; it must still parse so the caller reads
        // `success`/`detail` instead of dying on the body.
        let body: TorBoxResponse<TorBoxUserData> = serde_json::from_value(serde_json::json!({
            "success": false,
            "error": "BAD_TOKEN",
            "detail": "Your token is invalid or has expired.",
            "data": null
        }))
        .expect("error envelope must deserialize");

        assert!(!body.success);
        assert_eq!(body.error.as_deref(), Some("BAD_TOKEN"));
        assert!(body.data.is_none());
    }

    #[test]
    fn torbox_requestdl_data_is_a_bare_string() {
        // `torrents/requestdl` (and the webdl route) put the link directly in
        // `data` as a string, not inside a `zip_link` / `download_link`
        // object. Parsing it as an object silently produced no links.
        let body: TorBoxResponse<String> = serde_json::from_value(serde_json::json!({
            "success": true,
            "detail": "Link generated",
            "data": "https://download.torbox.app/abc/xyz.zip"
        }))
        .expect("bare-string data must deserialize");

        assert_eq!(
            body.data.as_deref(),
            Some("https://download.torbox.app/abc/xyz.zip")
        );
    }

    #[test]
    fn torbox_mylist_tolerates_negative_size_and_null_files() {
        // TorBox returns the whole account: `size: -1` for an unknown size
        // and `files: null` for an unfetched torrent. Strict u64 / non-Option
        // types made the whole list fail to parse and killed the poll.
        let body: TorBoxResponse<Vec<TorBoxTorrentList>> = serde_json::from_value(serde_json::json!({
            "success": true,
            "data": [
                {
                    "id": 1,
                    "progress": 99.5,
                    "download_finished": true,
                    "download_present": true,
                    "active": false,
                    "name": "A.Game",
                    "size": -1,
                    "files": null
                },
                {
                    "id": 2,
                    "progress": 0.0,
                    "download_finished": false,
                    "download_present": false,
                    "active": true,
                    "name": "B.Game",
                    "size": 1024,
                    "files": [
                        {"id": 7, "name": "b.iso", "short_name": "b.iso", "size": 1024}
                    ]
                }
            ]
        }))
        .expect("mylist with unknown size / null files must deserialize");

        let list = body.data.expect("data present");
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, Some(1));
        assert_eq!(list[0].size, Some(-1));
        assert!(list[0].files.is_none());
        let files = list[1].files.as_ref().expect("second torrent has files");
        assert_eq!(files[0].id, Some(7));
    }

    #[test]
    fn torbox_webdl_id_accepts_string_or_number() {
        // `createwebdownload` returns the job id as the string key
        // `webdownload_id`; `webdl/mylist` may echo it as a number.
        let create: TorBoxResponse<TorBoxWebDlCreateData> =
            serde_json::from_value(serde_json::json!({
                "success": true,
                "data": {"webdownload_id": "12345"}
            }))
            .expect("createwebdownload payload must deserialize");
        assert_eq!(
            create.data.and_then(|d| d.webdownload_id).as_deref(),
            Some("12345")
        );

        let entry: TorBoxWebDlListEntry =
            serde_json::from_value(serde_json::json!({"id": 12345})).expect("numeric id");
        assert_eq!(entry.id.to_string(), "12345");

        let entry: TorBoxWebDlListEntry =
            serde_json::from_value(serde_json::json!({"id": "12345"})).expect("string id");
        assert_eq!(entry.id.to_string(), "12345");
    }
}

