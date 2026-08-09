//! Install-mode-aware update path. `tauri-plugin-updater` classifies any
//! Windows `.exe` artifact as an NSIS installer and executes it with
//! `/UPDATE`-style flags — meaningless for a portable build (a bare
//! `target/release/GameIndex.exe` copy that was never bundled), and it
//! rejects the artifact because tauri doesn't sign portable exes. So
//! NSIS/MSI-installed builds keep using the plugin, while portable
//! builds download, verify, and swap in the new exe themselves.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use futures::StreamExt;
use tauri::utils::config::BundleType;

/// Set by `portable_update_cancel`; checked between download chunks.
static CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Progress events mirrored to the frontend. The `event`/`data` shape
/// matches `tauri-plugin-updater`'s `DownloadEvent` so the UI can reuse
/// the plugin's event handling.
#[derive(Clone, serde::Serialize)]
#[serde(tag = "event", content = "data")]
pub enum PortableDownloadEvent {
    Started { content_length: Option<u64> },
    Progress { downloaded: u64, total: Option<u64> },
    #[allow(dead_code)] // kept for parity with the plugin's event enum
    Finished,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableStageInfo {
    pub path: String,
    pub size_bytes: u64,
}

/// `"dev"` for dev builds, `"nsis"` for installer-built binaries, and
/// `"portable"` for raw `target/release` copies. Portable is the only
/// mode that must self-update: installed builds go through the plugin.
#[tauri::command]
#[allow(unused_variables)] // `app` is just a signature placeholder
pub fn updater_install_mode(app: tauri::AppHandle) -> String {
    if tauri::is_dev() {
        return "dev".to_string();
    }
    match tauri::utils::platform::bundle_type() {
        // An installed exe has its bundle type baked in at build time;
        // every other bundle shape is installer-managed too.
        Some(BundleType::Nsis) | Some(BundleType::Msi) => "nsis",
        Some(_) => "nsis",
        None => {
            // Unbundled binaries report no bundle type. A sibling
            // `uninstall.exe` marks an NSIS install dir, so a portable
            // copy sitting next to one still routes to the plugin.
            if has_uninstaller_near(std::env::current_exe().ok().as_deref()) {
                "nsis"
            } else {
                "portable"
            }
        }
    }
    .to_string()
}

/// Whether an NSIS `uninstall.exe` sits next to the given exe directory.
fn has_uninstaller_near(exe_dir: Option<&Path>) -> bool {
    exe_dir
        .map(|dir| dir.join("uninstall.exe").exists())
        .unwrap_or(false)
}

/// Download, verify, and stage a portable update. Returns the staged exe
/// path once the new binary is fully written to disk.
#[tauri::command]
pub async fn portable_update_download(
    app: tauri::AppHandle,
    url: String,
    signature: String,
    on_event: tauri::ipc::Channel<PortableDownloadEvent>,
) -> Result<PortableStageInfo, String> {
    CANCEL_REQUESTED.store(false, Ordering::SeqCst);

    let pubkey = updater_pubkey(&app)?;

    let client = reqwest::Client::builder()
        .user_agent(concat!("GameIndex/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to download update: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!(
            "Failed to download update: HTTP {}",
            resp.status()
        ));
    }

    let total = resp.content_length();
    let _ = on_event.send(PortableDownloadEvent::Started { content_length: total });

    let mut stream = resp.bytes_stream();
    let mut bytes: Vec<u8> = Vec::new();
    let mut downloaded: u64 = 0;
    while let Some(chunk) = stream.next().await {
        if CANCEL_REQUESTED.load(Ordering::SeqCst) {
            return Err("Update download cancelled".to_string());
        }
        let chunk = chunk.map_err(|e| format!("Failed to read update stream: {e}"))?;
        downloaded += chunk.len() as u64;
        bytes.extend_from_slice(&chunk);
        let _ = on_event.send(PortableDownloadEvent::Progress { downloaded, total });
    }

    verify_tauri_signature(&bytes, &signature, &pubkey)
        .map_err(|_| "Update signature verification failed".to_string())?;

    let staging = std::env::temp_dir().join("gameindex-update");
    std::fs::create_dir_all(&staging).map_err(|e| format!("Failed to create staging dir: {e}"))?;
    let final_path = staging.join("GameIndex.exe");
    let tmp_path = staging.join("GameIndex.exe.tmp");
    std::fs::write(&tmp_path, &bytes).map_err(|e| format!("Failed to write staged update: {e}"))?;
    std::fs::rename(&tmp_path, &final_path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp_path);
        format!("Failed to finalize staged update: {e}")
    })?;

    Ok(PortableStageInfo {
        path: final_path.to_string_lossy().into_owned(),
        size_bytes: bytes.len() as u64,
    })
}

/// Abort an in-flight `portable_update_download`.
#[tauri::command]
pub fn portable_update_cancel() -> Result<(), String> {
    CANCEL_REQUESTED.store(true, Ordering::SeqCst);
    Ok(())
}

/// Pull the minisign pubkey from the live plugin config rather than
/// duplicating it — it already ships in tauri.conf.json.
fn updater_pubkey(app: &tauri::AppHandle) -> Result<String, String> {
    let value = app
        .config()
        .plugins
        .0
        .get("updater")
        .ok_or_else(|| "updater plugin config not found".to_string())?;
    let config: tauri_plugin_updater::Config = serde_json::from_value(value.clone())
        .map_err(|e| format!("invalid updater plugin config: {e}"))?;
    if config.pubkey.is_empty() {
        return Err("updater plugin config missing pubkey".to_string());
    }
    Ok(config.pubkey)
}

/// Verify a tauri-signed artifact. Both the pubkey and the latest.json
/// `signature` are base64-wrapped minisign TEXT files, so each needs two
/// layers of unwrapping before the minisign types can parse them (the
/// plugin does the same in `updater::verify_signature`).
fn verify_tauri_signature(data: &[u8], signature_b64: &str, pubkey_b64: &str) -> Result<(), String> {
    let pubkey_text = String::from_utf8(
        STANDARD
            .decode(pubkey_b64)
            .map_err(|e| format!("invalid public key encoding: {e}"))?,
    )
    .map_err(|e| format!("invalid public key text: {e}"))?;
    let public_key = minisign_verify::PublicKey::decode(&pubkey_text)
        .map_err(|e| format!("invalid public key: {e}"))?;

    let signature_text = String::from_utf8(
        STANDARD
            .decode(signature_b64)
            .map_err(|e| format!("invalid signature encoding: {e}"))?,
    )
    .map_err(|e| format!("invalid signature text: {e}"))?;
    let signature = minisign_verify::Signature::decode(&signature_text)
        .map_err(|e| format!("invalid signature: {e}"))?;

    public_key
        .verify(data, &signature, true) // allow_legacy, matching the plugin
        .map_err(|e| format!("signature verification failed: {e}"))
}

/// Apply a staged portable update on Windows. This exits the app: the
/// detached script waits for this process to die, then swaps the exe.
#[tauri::command]
pub fn portable_update_apply(
    app: tauri::AppHandle,
    staged_path: String,
    relaunch: bool,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        let target = std::env::current_exe()
            .map_err(|e| format!("failed to locate current executable: {e}"))?;
        let target = target.to_string_lossy();
        let pid = std::process::id();

        let dir = std::env::temp_dir().join("gameindex-update");
        std::fs::create_dir_all(&dir).map_err(|e| format!("failed to create updater dir: {e}"))?;
        let script = dir.join("apply.cmd");
        let relaunch_flag = if relaunch { "1" } else { "0" };
        let body = format!(
            "@echo off\r\n\
             set /a tries=0\r\n\
             :wait\r\n\
             tasklist /FI \"PID eq {pid}\" | findstr /C:\"{pid}\" >nul\r\n\
             if errorlevel 1 goto copy\r\n\
             set /a tries+=1\r\n\
             if %tries% GEQ 120 goto fail\r\n\
             timeout /t 1 /nobreak >nul\r\n\
             goto wait\r\n\
             :copy\r\n\
             copy /Y \"{staged_path}\" \"{target}\" >nul\r\n\
             if errorlevel 1 goto fail\r\n\
             del /Q \"{staged_path}\" >nul 2>nul\r\n\
             if \"{relaunch_flag}\"==\"1\" start \"\" \"{target}\"\r\n\
             del /Q \"%~f0\" >nul 2>nul\r\n\
             exit /b 0\r\n\
             :fail\r\n\
             del /Q \"%~f0\" >nul 2>nul\r\n\
             exit /b 1\r\n"
        );
        std::fs::write(&script, body).map_err(|e| format!("failed to write updater script: {e}"))?;

        // CREATE_NO_WINDOW | DETACHED_PROCESS: the swap must run after
        // this process exits, so the script must not die with us.
        let mut cmd = std::process::Command::new("cmd");
        cmd.arg("/C")
            .arg(&script)
            .creation_flags(0x08000000 | 0x00000008)
            .spawn()
            .map_err(|e| format!("failed to launch updater script: {e}"))?;

        app.exit(0);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, staged_path, relaunch);
        Err("Portable updates are only supported on Windows".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD;

    // Fixtures generated once (the private key stays out of the repo):
    //   npx tauri signer generate --ci -f -w <tmp>/gamelib-updater-test.key
    //   npx tauri signer sign -f <tmp>/gamelib-updater-test.key <fixture>
    // where <fixture> contains exactly "GameIndex updater test fixture 42".
    // PUBKEY_B64 / SIGNATURE_B64 are the base64-wrapped minisign TEXT
    // files — i.e. what tauri.conf.json `pubkey` and latest.json
    // `signature` contain — matching the two-layer decode in
    // `verify_tauri_signature`.
    const PUBKEY_B64: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDYzNjlDNjcyNzVEMjNEMDIKUldRQ1BkSjFjc1pwWXc0N2xKS0lJeEJ0WWJrOEhoRkhpallka2gvR3FZNnRNWVJCa3lydXNyVmkK";
    const SIGNATURE_B64: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVRQ1BkSjFjc1pwWXd3aEM4b2ROU0kwMVV4RWFlME1meEE0OG5nM2NLZ2VVaHZrUTdzNVNwbkc4NWlUVmpmSTA4WUtQbm1ZQ0FDbzhNamtVb2JmT2FiS1FMSWozQUh0amdJPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg2Mjk3NTk5CWZpbGU6dXBkYXRlci10ZXN0LWZpeHR1cmUudHh0CjIrU0tGeDJLd0d6eHFid1dHR2hUTEJ4UWVnYkZlYWV0Q2ZsclJqSDRZS2w3bU1JQ3NDNmNhNWJYZTZEbE9LNHIyQU5CSEQ1T3ZxbHFTU3dyek1OakJRPT0K";
    const FIXTURE_B64: &str = "R2FtZUluZGV4IHVwZGF0ZXIgdGVzdCBmaXh0dXJlIDQy";

    #[test]
    fn verify_accepts_genuine_signature() {
        let data = STANDARD.decode(FIXTURE_B64).unwrap();
        verify_tauri_signature(&data, SIGNATURE_B64, PUBKEY_B64).unwrap();
    }

    #[test]
    fn verify_rejects_tampered_data() {
        let mut data = STANDARD.decode(FIXTURE_B64).unwrap();
        data[0] ^= 0xff;
        assert!(verify_tauri_signature(&data, SIGNATURE_B64, PUBKEY_B64).is_err());
    }

    #[test]
    fn verify_rejects_bad_signature() {
        // Flip a byte inside the wrapped signature's main-signature line
        // (base64 stays valid, inner minisign payload no longer matches).
        let data = STANDARD.decode(FIXTURE_B64).unwrap();
        let mut bad = SIGNATURE_B64.as_bytes().to_vec();
        bad[80] = if bad[80] == b'A' { b'B' } else { b'A' };
        let bad = String::from_utf8(bad).unwrap();
        assert!(verify_tauri_signature(&data, &bad, PUBKEY_B64).is_err());
    }

    #[test]
    fn has_uninstaller_detects_sibling() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!has_uninstaller_near(Some(dir.path())));
        assert!(!has_uninstaller_near(None));
        std::fs::write(dir.path().join("uninstall.exe"), b"x").unwrap();
        assert!(has_uninstaller_near(Some(dir.path())));
    }
}
