//! Centralized credential management for GameIndex.
//!
//! # Strategy
//!
//! Production builds embed secrets at compile time via `env!()`, then
//! obfuscate the baked-in value with `obfstr!` so it doesn't appear as a
//! plain string in the binary. The developer sets environment variables
//! before running `npm run tauri build`:
//!
//! ```powershell
//! $env:TWITCH_CLIENT_ID="your_id"
//! $env:TWITCH_CLIENT_SECRET="your_secret"
//! $env:OPENCRITIC_RAPIDAPI_KEY="your_key"
//! npm run tauri build
//! ```
//!
//! `build.rs` probes each variable at build time and emits a matching
//! `baked_<VAR>` cfg flag when present; each accessor's compile-time branch
//! is gated on that flag, so `env!()` only ever expands when the variable
//! actually exists (an unguarded `env!()` would fail the build).
//!
//! During development (`npm run tauri dev`), the `.env` file is loaded once
//! at startup by `load_env_file()` and the runtime `std::env::var()` fallback
//! picks the values up — no workflow change required.
//!
//! Each accessor tries compile-time first, then the runtime environment.
//! Returns an empty string when neither source is available (callers handle
//! missing credentials with appropriate error messages).

/// Load the `.env` file from the current or any parent directory into the
/// process environment. Called once during startup so every IGDB / OpenCritic
/// caller doesn't duplicate the walk.
///
/// Skips comments and empty lines. Only sets variables that don't already
/// have a value (compile-time baked-in values always win).
pub fn load_env_file() {
    let mut dir = std::env::current_dir().ok();
    while let Some(path) = dir {
        let env_path = path.join(".env");
        if env_path.exists() {
            if let Ok(content) = std::fs::read_to_string(env_path) {
                for line in content.lines() {
                    let line = line.trim();
                    if line.is_empty() || line.starts_with('#') {
                        continue;
                    }
                    if let Some((key, val)) = line.split_once('=') {
                        let key = key.trim();
                        let val = val.trim().trim_matches('"').trim_matches('\'');
                        // Don't overwrite already-set runtime env vars (earlier
                        // .env loads, system env, etc.). Compile-time values
                        // are baked into the binary and take priority in the
                        // accessor functions themselves.
                        if std::env::var(key).is_err() {
                            std::env::set_var(key, val);
                        }
                    }
                }
            }
            break;
        }
        dir = path.parent().map(|p| p.to_path_buf());
    }
}

// ── Credential accessors ────────────────────────────────────────────────────

/// Returns the Twitch Client ID for IGDB API calls.
///
/// Priority: compile-time `TWITCH_CLIENT_ID` env var (obfuscated via
/// `obfstr!`) → runtime env var → empty string.
pub fn get_twitch_client_id() -> String {
    #[cfg(baked_TWITCH_CLIENT_ID)]
    {
        obfstr::obfstr!(env!("TWITCH_CLIENT_ID")).to_string()
    }
    #[cfg(not(baked_TWITCH_CLIENT_ID))]
    {
        std::env::var("TWITCH_CLIENT_ID").unwrap_or_default()
    }
}

/// Returns the Twitch Client Secret for IGDB API calls.
///
/// Priority: compile-time `TWITCH_CLIENT_SECRET` env var (obfuscated via
/// `obfstr!`) → runtime env var → empty string.
pub fn get_twitch_client_secret() -> String {
    #[cfg(baked_TWITCH_CLIENT_SECRET)]
    {
        obfstr::obfstr!(env!("TWITCH_CLIENT_SECRET")).to_string()
    }
    #[cfg(not(baked_TWITCH_CLIENT_SECRET))]
    {
        std::env::var("TWITCH_CLIENT_SECRET").unwrap_or_default()
    }
}

/// Returns the OpenCritic RapidAPI key for review scraping.
///
/// Priority: compile-time `OPENCRITIC_RAPIDAPI_KEY` env var (obfuscated via
/// `obfstr!`) → runtime env var → empty string.
pub fn get_opencritic_rapidapi_key() -> String {
    #[cfg(baked_OPENCRITIC_RAPIDAPI_KEY)]
    {
        obfstr::obfstr!(env!("OPENCRITIC_RAPIDAPI_KEY")).to_string()
    }
    #[cfg(not(baked_OPENCRITIC_RAPIDAPI_KEY))]
    {
        std::env::var("OPENCRITIC_RAPIDAPI_KEY").unwrap_or_default()
    }
}

/// Returns the SteamGridDB API key used by the `steamgriddb` module to fetch
/// community grid / hero artwork.
///
/// Priority: compile-time `STEAMGRIDDB_API_KEY` env var (obfuscated via
/// `obfstr!`) → runtime env var (loaded from `.env` by `load_env_file()`) →
/// empty string. No key means the artwork feature is a silent no-op (games
/// keep their existing art).
pub fn get_steamgriddb_api_key() -> String {
    #[cfg(baked_STEAMGRIDDB_API_KEY)]
    {
        obfstr::obfstr!(env!("STEAMGRIDDB_API_KEY")).to_string()
    }
    #[cfg(not(baked_STEAMGRIDDB_API_KEY))]
    {
        std::env::var("STEAMGRIDDB_API_KEY").unwrap_or_default()
    }
}

/// Returns the Discord application (client) ID used for Rich Presence.
///
/// Priority: compile-time `DISCORD_CLIENT_ID` env var (obfuscated via
/// `obfstr!`) → runtime env var (loaded from `.env` by `load_env_file()`) →
/// empty string. The ID is the only required value for local Rich Presence —
/// no bot token or OAuth flow is needed.
pub fn get_discord_client_id() -> String {
    #[cfg(baked_DISCORD_CLIENT_ID)]
    {
        obfstr::obfstr!(env!("DISCORD_CLIENT_ID")).to_string()
    }
    #[cfg(not(baked_DISCORD_CLIENT_ID))]
    {
        std::env::var("DISCORD_CLIENT_ID").unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Guards the obfstr round-trip: the accessor must decrypt back to the
    // original value, otherwise the obfuscation would silently corrupt the
    // credentials at runtime. Only meaningful when a var is baked (cfg set);
    // otherwise the runtime fallback is trivially the same value.
    #[test]
    fn baked_credentials_round_trip() {
        if let Some(v) = option_env!("TWITCH_CLIENT_ID") {
            assert_eq!(get_twitch_client_id(), v);
        }
        if let Some(v) = option_env!("TWITCH_CLIENT_SECRET") {
            assert_eq!(get_twitch_client_secret(), v);
        }
        if let Some(v) = option_env!("OPENCRITIC_RAPIDAPI_KEY") {
            assert_eq!(get_opencritic_rapidapi_key(), v);
        }
        if let Some(v) = option_env!("DISCORD_CLIENT_ID") {
            assert_eq!(get_discord_client_id(), v);
        }
        if let Some(v) = option_env!("STEAMGRIDDB_API_KEY") {
            assert_eq!(get_steamgriddb_api_key(), v);
        }
    }
}
