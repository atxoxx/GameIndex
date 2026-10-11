//! Parser for Ubisoft Connect's local product cache (`configurations`).
//!
//! Playnite reads this file as a protobuf-net blob
//! (`UplayCacheGameCollection` → `List<UplayCacheGame>` where each entry
//! carries a `UplayId`, `InstallId`, and a `GameInfo` YAML string) and
//! then deserializes each `GameInfo` as a `ProductInformation` via
//! `Serialization.FromYaml`. We can't link protobuf-net, but the wire
//! layout is simple enough to walk by hand:
//!
//! 1. Slurp the raw file bytes.
//! 2. Read the top-level message (`UplayCacheGameCollection`): field
//!    `1`, wire type 2 (length-delimited) repeats once per entry.
//! 3. Each entry is itself a message whose field `1` is the `UplayId`
//!    varint, field `2` is the `InstallId` varint, and field `3` is the
//!    embedded `GameInfo` YAML document (a UTF-8 `bytes` field).
//! 4. Deserialize that YAML as `RawProductInfo` (top-level `root` +
//!    `localizations`) and resolve localized asset URLs against the
//!    Ubisoft CDN base, mirroring Playnite's
//!    `Uplay.GetLocalProductCache` localization stitching.
//!
//! The reader is bounds-checked and never panics on a truncated or
//! corrupt cache; it stops at the first malformed field.

use serde::Deserialize;
use std::path::Path;

use super::types::{Product, ProductInformation};

/// Ubisoft CDN base for asset image URLs, mirrored from
/// `Uplay.AssertUrlBase`.
pub const ASSET_URL_BASE: &str = "https://ubistatic3-a.akamaihd.net/orbit/uplay_launcher_3_0/assets/";

/// Raw YAML shape of a single cache entry's `GameInfo`. Only the
/// fields Playnite actually reads are mapped; everything else is
/// ignored by serde. `uplay_id` / `install_id` are not part of the YAML
/// — they ride alongside it as protobuf varints on the enclosing entry.
#[derive(Debug, Default, Deserialize)]
struct RawProductInfo {
    #[serde(default)]
    root: Option<GameProduct>,
    #[serde(default)]
    localizations: Option<Localizations>,
}

/// A protobuf-wire value decoded by [`read_field`].
///
/// `Other` covers the fixed-width wire types (fixed64 / fixed32) whose
/// bytes we skip but don't otherwise interpret.
enum PbValue<'a> {
    Varint(u64),
    Bytes(&'a [u8]),
    Other,
}

/// Read a base-128 varint (little-endian, 7 bits per byte). Returns
/// `None` on truncation or when the encoding exceeds 64 bits so a
/// corrupt file can't loop forever or overflow.
fn read_varint(buf: &[u8], pos: &mut usize) -> Option<u64> {
    let mut result: u64 = 0;
    let mut shift: u32 = 0;
    loop {
        if shift >= 64 {
            return None;
        }
        let byte = *buf.get(*pos)?;
        *pos += 1;
        result |= ((byte & 0x7f) as u64) << shift;
        if byte & 0x80 == 0 {
            return Some(result);
        }
        shift += 7;
    }
}

/// Read one protobuf field (tag + value) from `pos`, advancing it past
/// the whole field. Returns `None` on an unknown wire type, truncation,
/// or an out-of-bounds length so the caller stops cleanly.
fn read_field<'a>(buf: &'a [u8], pos: &mut usize) -> Option<(u32, PbValue<'a>)> {
    let key = read_varint(buf, pos)?;
    let field_number = (key >> 3) as u32;
    let wire_type = (key & 0x07) as u32;

    match wire_type {
        0 => {
            let value = read_varint(buf, pos)?;
            Some((field_number, PbValue::Varint(value)))
        }
        1 => {
            if *pos + 8 > buf.len() {
                return None;
            }
            *pos += 8;
            Some((field_number, PbValue::Other))
        }
        2 => {
            let len = read_varint(buf, pos)? as usize;
            let end = (*pos).checked_add(len)?;
            if end > buf.len() {
                return None;
            }
            let slice = &buf[*pos..end];
            *pos = end;
            Some((field_number, PbValue::Bytes(slice)))
        }
        5 => {
            if *pos + 4 > buf.len() {
                return None;
            }
            *pos += 4;
            Some((field_number, PbValue::Other))
        }
        _ => None,
    }
}

#[derive(Debug, Default, Deserialize)]
struct GameProduct {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    background_image: Option<String>,
    #[serde(default)]
    thumb_image: Option<String>,
    #[serde(default)]
    logo_image: Option<String>,
    #[serde(default)]
    dialog_image: Option<String>,
    #[serde(default)]
    icon_image: Option<String>,
    #[serde(default)]
    third_party_platform: Option<serde_yaml::Value>,
    #[serde(default)]
    is_ulc: Option<bool>,
    #[serde(default)]
    start_game: Option<serde_yaml::Value>,
    #[serde(default)]
    addons: Option<Vec<Addon>>,
}

#[derive(Debug, Default, Deserialize)]
struct Addon {
    #[serde(default)]
    id: Option<u64>,
}

#[derive(Debug, Default, Deserialize)]
struct Localizations {
    #[serde(default)]
    #[serde(rename = "default")]
    default: Option<std::collections::HashMap<String, String>>,
}

/// Parse the Ubisoft Connect `configurations` cache into product
/// records. Returns an empty vec (never errors) when the cache is
/// missing or unreadable, mirroring Playnite's "client not initialized"
/// path; the sync orchestrator turns an empty result into a user-facing
/// warning.
pub fn get_local_product_cache() -> Vec<ProductInformation> {
    let path = super::configurations_cache_path();
    if path.is_empty() || !Path::new(&path).is_file() {
        return Vec::new();
    }
    match std::fs::read(&path) {
        Ok(bytes) => parse_cache_bytes(&bytes),
        Err(_) => Vec::new(),
    }
}

/// Walk the top-level `UplayCacheGameCollection` message and parse each
/// field-1 (repeated, length-delimited) `UplayCacheGame` entry. Exposed
/// for unit-testing without touching the filesystem.
pub fn parse_cache_bytes(bytes: &[u8]) -> Vec<ProductInformation> {
    let mut products = Vec::new();
    let mut pos = 0usize;
    while let Some((field_number, value)) = read_field(bytes, &mut pos) {
        if field_number != 1 {
            continue;
        }
        if let PbValue::Bytes(entry) = value {
            if let Some(product) = parse_entry(entry) {
                products.push(product);
            }
        }
    }
    products
}

/// Decode a single `UplayCacheGame` entry: field 1 = `uplay_id` varint,
/// field 2 = `install_id` varint, field 3 = `GameInfo` YAML bytes.
/// Returns `None` when the entry carries no YAML document.
fn parse_entry(entry: &[u8]) -> Option<ProductInformation> {
    let mut uplay_id = None;
    let mut install_id = None;
    let mut yaml = None;

    let mut pos = 0usize;
    while let Some((field_number, value)) = read_field(entry, &mut pos) {
        match (field_number, value) {
            (1, PbValue::Varint(v)) => uplay_id = Some(v),
            (2, PbValue::Varint(v)) => install_id = Some(v),
            (3, PbValue::Bytes(b)) => yaml = Some(String::from_utf8_lossy(b).into_owned()),
            _ => {}
        }
    }

    parse_one(&yaml?, uplay_id, install_id)
}

fn parse_one(
    yaml: &str,
    uplay_id: Option<u64>,
    install_id: Option<u64>,
) -> Option<ProductInformation> {
    let raw: RawProductInfo = serde_yaml::from_str(yaml).ok()?;
    let root = raw.root?;

    let loc = raw
        .localizations
        .and_then(|l| l.default)
        .unwrap_or_default();

    let resolve = |key: &Option<String>| -> Option<String> {
        let k = key.as_ref()?;
        if k.is_empty() {
            return None;
        }
        // Localized override (e.g. the value is a localization key).
        if let Some(v) = loc.get(k) {
            return Some(v.clone());
        }
        Some(k.clone())
    };

    let name = resolve(&root.name);
    let background_image = resolve(&root.background_image).map(|s| format!("{ASSET_URL_BASE}{s}"));
    let thumb_image = resolve(&root.thumb_image).map(|s| format!("{ASSET_URL_BASE}{s}"));
    let logo_image = resolve(&root.logo_image).map(|s| format!("{ASSET_URL_BASE}{s}"));
    let dialog_image = resolve(&root.dialog_image).map(|s| format!("{ASSET_URL_BASE}{s}"));
    let icon_image = resolve(&root.icon_image).map(|s| format!("{ASSET_URL_BASE}{s}"));

    let product = Product {
        name,
        background_image,
        thumb_image,
        logo_image,
        dialog_image,
        icon_image,
        third_party_platform: root.third_party_platform.is_some(),
        is_ulc: root.is_ulc.unwrap_or(false),
        has_start_game: root.start_game.is_some(),
        addon_ids: root.addons.unwrap_or_default().into_iter().filter_map(|a| a.id).collect(),
    };

    Some(ProductInformation {
        root: product,
        uplay_id,
        install_id,
    })
}

/// One discovered installed Ubisoft game from the registry
/// `SOFTWARE\ubisoft\Launcher\Installs\<uplayId>` key. Mirrors
/// Playnite's `UplayLibrary.GetInstalledGames` output.
#[derive(Debug, Clone)]
pub struct UplayInstalledGame {
    pub uplay_id: String,
    pub name: String,
    pub install_dir: String,
    pub is_installed: bool,
}

/// Scan the registry `SOFTWARE\ubisoft\Launcher\Installs\` keys for
/// installed Ubisoft Connect games. Mirrors Playnite's
/// `UplayLibrary.GetInstalledGames`.
pub fn scan_installed_uplay_games() -> Vec<UplayInstalledGame> {
    scan_installed_uplay_games_inner()
}

#[cfg(windows)]
fn scan_installed_uplay_games_inner() -> Vec<UplayInstalledGame> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    let mut out = Vec::new();
    let root = RegKey::predef(HKEY_LOCAL_MACHINE);

    for view in [
        ("SOFTWARE\\ubisoft\\Launcher\\Installs\\", true),
        ("SOFTWARE\\WOW6432Node\\ubisoft\\Launcher\\Installs\\", true),
    ] {
        let Ok(installs_key) = root.open_subkey(view.0) else {
            continue;
        };
        for sub in installs_key.enum_keys().flatten() {
            let Ok(game_data) = installs_key.open_subkey(&sub) else {
                continue;
            };
            let install_dir: Option<String> = game_data.get_value("InstallDir").ok();
            let Some(dir) = install_dir else {
                continue;
            };
            let dir = dir.replace('/', std::path::MAIN_SEPARATOR_STR);
            let is_installed = !dir.is_empty() && Path::new(&dir).is_dir();
            // Mirror Playnite: name = the install dir's folder name.
            let name = if !dir.is_empty() {
                Path::new(&dir)
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| sub.clone())
            } else {
                sub.clone()
            };
            out.push(UplayInstalledGame {
                uplay_id: sub.clone(),
                name,
                install_dir: if is_installed { dir } else { String::new() },
                is_installed,
            });
        }
    }
    out
}

#[cfg(not(windows))]
fn scan_installed_uplay_games_inner() -> Vec<UplayInstalledGame> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Minimal protobuf encoders so the tests don't need a fixture ──

    fn write_varint(out: &mut Vec<u8>, mut value: u64) {
        loop {
            let mut byte = (value & 0x7f) as u8;
            value >>= 7;
            if value != 0 {
                byte |= 0x80;
            }
            out.push(byte);
            if value == 0 {
                break;
            }
        }
    }

    fn varint_field(out: &mut Vec<u8>, field: u32, value: u64) {
        write_varint(out, (field as u64) << 3);
        write_varint(out, value);
    }

    fn bytes_field(out: &mut Vec<u8>, field: u32, data: &[u8]) {
        write_varint(out, ((field as u64) << 3) | 2);
        write_varint(out, data.len() as u64);
        out.extend_from_slice(data);
    }

    fn entry(uplay_id: u64, install_id: u64, yaml: &str) -> Vec<u8> {
        let mut e = Vec::new();
        varint_field(&mut e, 1, uplay_id);
        varint_field(&mut e, 2, install_id);
        bytes_field(&mut e, 3, yaml.as_bytes());
        e
    }

    fn collection(entries: &[Vec<u8>]) -> Vec<u8> {
        let mut c = Vec::new();
        for e in entries {
            bytes_field(&mut c, 1, e);
        }
        c
    }

    const SAMPLE_YAML: &str = "\
root:
  name: AC 4
  background_image: bg.jpg
  thumb_image: thumb.jpg
  logo_image: logo.png
  dialog_image: dialog.jpg
  icon_image: icon.png
  start_game:
    executable: game.exe
localizations:
  default:
    \"AC 4\": \"Assassin's Creed IV\"
";

    #[test]
    fn parses_one_entry_with_ids_and_localized_assets() {
        let bytes = collection(&[entry(1234, 5678, SAMPLE_YAML)]);
        let products = parse_cache_bytes(&bytes);

        assert_eq!(products.len(), 1);
        let p = &products[0];
        assert_eq!(p.uplay_id, Some(1234));
        assert_eq!(p.install_id, Some(5678));
        assert_eq!(p.root.name.as_deref(), Some("Assassin's Creed IV"));
        assert!(p.root.has_start_game);
        assert_eq!(
            p.root.background_image,
            Some(format!("{ASSET_URL_BASE}bg.jpg"))
        );
        assert_eq!(
            p.root.thumb_image,
            Some(format!("{ASSET_URL_BASE}thumb.jpg"))
        );
        assert_eq!(p.root.icon_image, Some(format!("{ASSET_URL_BASE}icon.png")));
    }

    #[test]
    fn empty_and_truncated_input_do_not_panic() {
        assert!(parse_cache_bytes(&[]).is_empty());

        // Field 1 (length-delimited) claims 10 bytes but only 2 follow.
        let mut truncated = Vec::new();
        write_varint(&mut truncated, (1u64 << 3) | 2);
        write_varint(&mut truncated, 10);
        truncated.extend_from_slice(b"ab");
        assert!(parse_cache_bytes(&truncated).is_empty());

        // Arbitrary garbage must be handled without panicking.
        let garbage: Vec<u8> = (0..128u32).map(|i| (i.wrapping_mul(37) & 0xff) as u8).collect();
        let _ = parse_cache_bytes(&garbage);

        // A valid tag with an unreadable varint body must stop cleanly.
        let mut bad_varint = vec![0x08u8];
        bad_varint.extend_from_slice(&[0x80, 0x80, 0x80]);
        assert!(parse_cache_bytes(&bad_varint).is_empty());
    }

    #[test]
    fn entry_with_addons_keeps_base_game_and_records_addon_ids() {
        let yaml = "\
root:
  name: Base Game
  start_game:
    executable: game.exe
  addons:
    - id: 9001
    - id: 9002
";
        let bytes = collection(&[entry(100, 200, yaml)]);
        let products = parse_cache_bytes(&bytes);

        assert_eq!(products.len(), 1);
        assert_eq!(products[0].uplay_id, Some(100));
        assert_eq!(products[0].root.addon_ids, vec![9001, 9002]);
    }
}
