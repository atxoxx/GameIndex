//! Installed-game version detection.
//!
//! Reads the Windows version resource from a game's executable so the
//! frontend can compare the installed build against the newest version
//! found in download sources (`useGameUpdateCheck`).
//!
//! Most shipped games store the human-facing build number in the
//! version resource's **string** table (`StringFileInfo\ProductVersion`
//! / `FileVersion`), e.g. `2.57.1.125`, `1.0.1013.34`, `3.0.5276805`.
//! The numeric fixed block (`VS_FIXEDFILEINFO.dwFileVersion`) is often
//! left at `0.0.0.0` or packed with engine/build numbers instead, so we
//! read the string versions first and only fall back to the fixed block.
//!
//! Version resources are a PE/Windows concept; on macOS/Linux this
//! command always reports `None`, which the frontend treats as "unknown
//! installed version" and skips the update check.

/// Trim a raw version string from the resource to something displayable:
/// strip surrounding whitespace, trailing parentheses (e.g. Witcher 3's
/// `4.0.0.87877(Build Machine)`) and semver build-metadata tails after a
/// `+` hex hash (`1.0.0+c1eba6e0...`). Returns `None` when nothing is
/// left.
fn normalize_version(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.chars().any(|c| c.is_control()) {
        return None;
    }
    let end = trimmed
        .char_indices()
        .find(|(_, c)| c.is_whitespace() || *c == '(')
        .map(|(i, _)| i)
        .unwrap_or(trimmed.len());
    let cut = &trimmed[..end];
    // Semver build metadata: cut a `+` suffix that looks like a hash
    // (`1.0.0+c1eba6e0d7...`) but keep legit `+` in version strings.
    let cut = match cut.find('+') {
        Some(plus) => {
            let hash = &cut[plus + 1..];
            if hash.len() >= 6 && hash.chars().all(|c| c.is_ascii_hexdigit()) {
                &cut[..plus]
            } else {
                cut
            }
        }
        None => cut,
    };
    let cut = cut.trim();
    if cut.is_empty() {
        None
    } else {
        Some(cut.to_string())
    }
}

/// Read the Windows file version (e.g. `2.57.1.125`) embedded in an
/// executable's version resource.
///
/// Returns `None` when the path doesn't exist, isn't a PE file, carries
/// no version resource, or the platform isn't Windows.
#[cfg(windows)]
#[tauri::command]
pub fn get_exe_file_version(path: String) -> Option<String> {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use std::ptr::null_mut;
    use std::slice;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{
        GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW, VS_FIXEDFILEINFO,
    };

    let exe = Path::new(&path);
    if !exe.is_file() {
        return None;
    }

    // Null-terminated UTF-16 path for the Win32 calls.
    let wide: Vec<u16> = exe
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let size = GetFileVersionInfoSizeW(PCWSTR(wide.as_ptr()), None);
        if size == 0 {
            return None;
        }
        let mut buf = vec![0u8; size as usize];
        if GetFileVersionInfoW(PCWSTR(wide.as_ptr()), 0, size, buf.as_mut_ptr().cast()).is_err() {
            return None;
        }

        /// Query a sub-block and, when it holds a UTF-16 string, return it.
        fn query_string(buf: &[u8], sub_block: &str) -> Option<String> {
            let wide: Vec<u16> = sub_block.encode_utf16().chain(std::iter::once(0)).collect();
            unsafe {
                let mut out: *mut c_void = null_mut();
                let mut len: u32 = 0;
                if !VerQueryValueW(
                    buf.as_ptr().cast(),
                    PCWSTR(wide.as_ptr()),
                    &mut out,
                    &mut len,
                )
                .as_bool()
                {
                    return None;
                }
                if out.is_null() {
                    return None;
                }
                let words = len as usize / 2;
                let p = out.cast::<u16>();
                // The value is null-terminated; cap the scan at the reported length.
                let mut count = 0usize;
                while count < words && *p.add(count) != 0 {
                    count += 1;
                }
                let s = String::from_utf16_lossy(slice::from_raw_parts(p, count));
                if s.trim().is_empty() {
                    None
                } else {
                    Some(s)
                }
            }
        }

        // The string table is split per (language, codepage). Enumerate
        // the translation pairs, then read ProductVersion / FileVersion
        // from the first translation that carries them.
        let mut tr_ptr: *mut c_void = null_mut();
        let mut tr_len: u32 = 0;
        let var_info: Vec<u16> = r"\VarFileInfo\Translation"
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        if VerQueryValueW(
            buf.as_ptr().cast(),
            PCWSTR(var_info.as_ptr()),
            &mut tr_ptr,
            &mut tr_len,
        )
        .as_bool()
        {
            let word_count = (tr_len as usize) / 2;
            let words = slice::from_raw_parts(tr_ptr.cast::<u16>(), word_count);
            for pair in words.chunks(2) {
                if pair.len() < 2 {
                    break;
                }
                let (lang, codepage) = (pair[0], pair[1]);
                // ProductVersion is the human-facing game version; most
                // repacks/games tag marketing patches there.
                let pv = format!(r"\StringFileInfo\{lang:04x}{codepage:04x}\ProductVersion");
                if let Some(raw) = query_string(&buf, &pv) {
                    if let Some(v) = normalize_version(&raw) {
                        return Some(v);
                    }
                }
                let fv = format!(r"\StringFileInfo\{lang:04x}{codepage:04x}\FileVersion");
                if let Some(raw) = query_string(&buf, &fv) {
                    if let Some(v) = normalize_version(&raw) {
                        return Some(v);
                    }
                }
            }
        }

        // No usable string version — fall back to the fixed block, but
        // refuse to fabricate "0.0" from a resource whose version numbers
        // were all left at zero.
        let mut info_ptr: *mut c_void = null_mut();
        let mut len: u32 = 0;
        let root_block: [u16; 2] = [b'\\' as u16, 0];
        if !VerQueryValueW(
            buf.as_ptr().cast(),
            PCWSTR(root_block.as_ptr()),
            &mut info_ptr,
            &mut len,
        )
        .as_bool()
        {
            return None;
        }
        let info = &*(info_ptr.cast::<VS_FIXEDFILEINFO>());
        if info.dwSignature != 0xFEEF04BD {
            return None;
        }

        let major = (info.dwFileVersionMS >> 16) & 0xFFFF;
        let minor = info.dwFileVersionMS & 0xFFFF;
        let build = (info.dwFileVersionLS >> 16) & 0xFFFF;
        let revision = info.dwFileVersionLS & 0xFFFF;
        if major == 0 && minor == 0 && build == 0 && revision == 0 {
            return None;
        }

        // Trim trailing zero components (1.2.0.0 -> "1.2"): download
        // titles rarely tag beyond three components, so this keeps the
        // comparison apples-to-apples (1.2 == 1.2.0.0).
        if revision != 0 {
            Some(format!("{major}.{minor}.{build}.{revision}"))
        } else if build != 0 {
            Some(format!("{major}.{minor}.{build}"))
        } else {
            Some(format!("{major}.{minor}"))
        }
    }
}

/// Non-Windows builds have no PE version resource to read.
#[cfg(not(windows))]
#[tauri::command]
pub fn get_exe_file_version(_path: String) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_returns_none() {
        assert_eq!(
            get_exe_file_version("Z:/definitely/not/a/real/game.exe".to_string()),
            None
        );
    }

    #[test]
    fn normalize_trims_surrounding_whitespace() {
        assert_eq!(normalize_version("  2.57.1.125  "), Some("2.57.1.125".to_string()));
        assert_eq!(normalize_version("\t1.0\n"), Some("1.0".to_string()));
    }

    #[test]
    fn normalize_strips_build_metadata_and_parenthetical_suffixes() {
        // Witcher 3 style "(Build Machine)" suffix attached without a space.
        assert_eq!(
            normalize_version("4.0.0.87877(Build Machine)"),
            Some("4.0.0.87877".to_string())
        );
        // Semver build metadata (The Crew / Ravenfield style).
        assert_eq!(
            normalize_version("1.0.0+c1eba6e0d720e2e1336e3ca6219e86abe0ae2311"),
            Some("1.0.0".to_string())
        );
        // A trailing note after whitespace.
        assert_eq!(
            normalize_version("2020.3.49f1 (18249dd5551b)"),
            Some("2020.3.49f1".to_string())
        );
    }

    #[test]
    fn normalize_keeps_unusual_version_strings() {
        // Unreal shipping builds tag odd but meaningful version strings.
        assert_eq!(normalize_version("UE5-CL-0"), Some("UE5-CL-0".to_string()));
        assert_eq!(
            normalize_version("discovery_11.06.x_ue57-CL-1355454"),
            Some("discovery_11.06.x_ue57-CL-1355454".to_string())
        );
        // A `+` suffix that isn't a hex hash stays intact.
        assert_eq!(
            normalize_version("++Wardogs+Live-CL-496598"),
            Some("++Wardogs+Live-CL-496598".to_string())
        );
    }

    #[test]
    fn normalize_rejects_empty_values() {
        assert_eq!(normalize_version(""), None);
        assert_eq!(normalize_version("   "), None);
        assert_eq!(normalize_version("(Build Machine)"), None);
    }

    #[test]
    fn normalize_rejects_control_characters() {
        // Some odd resources carry a bare control code (Sven Co-op's
        // svencoop.exe ships "\u0005" as its version).
        assert_eq!(normalize_version("\u{0005}"), None);
        assert_eq!(normalize_version("1.0\u{0000}"), None);
    }
}
