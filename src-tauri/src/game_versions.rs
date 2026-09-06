//! Installed-game version detection.
//!
//! Reads the Windows file-version resource from a game's executable so
//! the frontend can compare the installed build against the newest
//! version found in download sources (`useGameUpdateCheck`).
//!
//! File version resources are a PE/Windows concept; on macOS/Linux this
//! command always reports `None`, which the frontend treats as "unknown
//! installed version" and skips the update check.

/// Read the file version (e.g. `1.2.3.0`) embedded in a Windows
/// executable's version resource.
///
/// Returns `None` when the path doesn't exist, isn't a PE file, carries
/// no version resource, or the platform isn't Windows.
#[cfg(windows)]
#[tauri::command]
pub fn get_exe_file_version(path: String) -> Option<String> {
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
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

    // The fixed-file-info block is queried with the root `\` sub-block.
    let root_block: [u16; 2] = [b'\\' as u16, 0];

    unsafe {
        let size = GetFileVersionInfoSizeW(PCWSTR(wide.as_ptr()), None);
        if size == 0 {
            return None;
        }
        let mut buf = vec![0u8; size as usize];
        if GetFileVersionInfoW(PCWSTR(wide.as_ptr()), 0, size, buf.as_mut_ptr().cast()).is_err() {
            return None;
        }
        let mut info_ptr: *mut core::ffi::c_void = std::ptr::null_mut();
        let mut len: u32 = 0;
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
}