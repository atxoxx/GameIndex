use std::path::{Path, PathBuf};



/// Current wall-clock time in Unix milliseconds. Used to stamp session
/// start/end times for the DB (the watcher's own clocks are monotonic
/// `Instant`s with no fixed epoch).
pub(crate) fn now_unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Normalize a path string for case-insensitive matching.
///
/// Windows paths are lowercased with `/` converted to the canonical `\`
/// separator. POSIX paths keep forward slashes — converting them to
/// backslashes would break install-dir prefix matching on Linux/macOS,
/// where both library exe paths and Wine/Proton `/proc/<pid>/cmdline`
/// argv use `/` — and stray backslashes (e.g. Windows-style paths passed
/// to Wine) are folded to `/` so every comparison sees one separator
/// style. Used for index keys and comparisons only; stored exe paths are
/// never rewritten.
#[cfg(windows)]
pub(crate) fn normalize_path_lower(s: &str) -> String {
    s.to_lowercase().replace('/', "\\")
}

#[cfg(not(windows))]
pub(crate) fn normalize_path_lower(s: &str) -> String {
    s.to_lowercase().replace('\\', "/")
}

/// `true` when `c` is a path separator in either style. Normalized paths
/// use only the platform separator, but matching both keeps Windows-style
/// test fixtures (and mixed-separator Wine argv) working on every target.
pub(crate) fn is_path_sep(c: char) -> bool {
    c == '\\' || c == '/'
}

/// Trim trailing path separators (either style) from a normalized path.
pub(crate) fn trim_path_separators(s: &str) -> &str {
    s.trim_end_matches(is_path_sep)
}

/// Helper to extract the game's root directory from an executable path,
/// walking up out of common binary or helper subfolders to prevent
/// launcher vs. game process sibling directory path mismatches.
pub(crate) fn get_game_root_dir(exe_path: &Path) -> Option<PathBuf> {
    if exe_path.is_dir() {
        return Some(exe_path.to_path_buf());
    }
    let mut current = exe_path.parent()?;
    const COMMON_SUBDIRS: &[&str] = &[
        "bin", "binaries", "win64", "win32", "x64", "x86", "release", "debug",
        "win-x64", "win-x86", "game", "retail", "launcher",
    ];
    // Walk up as long as the current directory name is a common binary/launcher folder,
    // up to a maximum of 3 levels.
    for _ in 0..3 {
        if let Some(name) = current.file_name().and_then(|n| n.to_str()) {
            let lower = name.to_lowercase();
            if COMMON_SUBDIRS.iter().any(|&item| item == lower) {
                if let Some(parent) = current.parent() {
                    current = parent;
                    continue;
                }
            }
        }
        break;
    }
    Some(current.to_path_buf())
}
