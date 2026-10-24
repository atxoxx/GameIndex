//! Leftover install-folder detection for the Storage page.
//!
//! Scans the immediate children of the library roots the user's installs
//! already live in (`C:\Games`, `D:\SteamLibrary\steamapps\common`, …) and
//! reports folders no library entry claims. One directory level per root,
//! deliberately:
//!
//!   * A deep walk of an entire drive would take minutes and surface every
//!     unrelated folder on the machine — noise, not insight.
//!   * A game install sits at the top of a library root by convention, so
//!     one level catches the real leftovers (an uninstalled game whose folder
//!     survived, a re-downloaded title under a variant name).
//!
//! The roots themselves come from the frontend, derived from the games that
//! are actually installed. Nothing is deleted here — the command only reads.

use serde::{Deserialize, Serialize};
use std::path::Path;

/// One folder inside a library root that no library entry points at.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeftoverFolder {
    pub path: String,
    pub name: String,
    /// Summed file bytes. Zero when the folder could not be read.
    pub bytes: u64,
    /// ISO-8601 modification time of the folder itself, when available.
    #[serde(default)]
    pub modified_at: Option<String>,
}

/// Folders that are never a game install, compared case-insensitively.
const RESERVED: &[&str] = &[
    "$recycle.bin",
    "system volume information",
    "$windows.~bt",
    "$windows.~ws",
    "config.msi",
    "recovery",
    "windows",
    "steamapps",
    "steam library",
    ".temp_downloads",
];

/// Cap the number of measured folders so a pathological library root cannot
/// turn one click into a multi-minute disk crawl.
const MAX_MEASURED: usize = 60;

/// Lowercase, slash-normalized, no trailing separator — the comparison form
/// for every path on both sides.
pub(crate) fn normalize_path(path: &str) -> String {
    let mut out = path.replace('\\', "/");
    while out.len() > 1 && out.ends_with('/') {
        out.pop();
    }
    out.to_lowercase()
}

/// True when `candidate` and `known` refer to the same folder or one contains
/// the other. Boundary-aware so `C:/Games/Portal` does not claim
/// `C:/Games/Portal 2`.
pub(crate) fn is_claimed(candidate: &str, known: &[String]) -> bool {
    let candidate = normalize_path(candidate);
    known.iter().any(|entry| {
        let entry = normalize_path(entry);
        if entry.is_empty() || candidate.is_empty() {
            return false;
        }
        if entry == candidate {
            return true;
        }
        let nested = |outer: &str, inner: &str| {
            inner.starts_with(outer) && inner.as_bytes().get(outer.len()) == Some(&b'/')
        };
        nested(&candidate, &entry) || nested(&entry, &candidate)
    })
}

fn is_reserved(name: &str) -> bool {
    if name.starts_with('.') {
        return true;
    }
    let lowered = name.to_lowercase();
    RESERVED.contains(&lowered.as_str())
}

fn modified_at(path: &Path) -> Option<String> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let dt: chrono::DateTime<chrono::Utc> = modified.into();
    Some(dt.to_rfc3339())
}

/// Scan the given roots for folders no known install path claims.
///
/// `roots` are the parent directories of installed games; `known_paths` are
/// the install roots themselves (the same values the page groups by drive).
#[tauri::command]
pub async fn scan_leftover_folders(
    roots: Vec<String>,
    known_paths: Vec<String>,
) -> Result<Vec<LeftoverFolder>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let known: Vec<String> = known_paths
            .iter()
            .map(|p| normalize_path(p))
            .filter(|p| !p.is_empty())
            .collect();

        // Roots repeat constantly (every game in the same folder shares one),
        // so dedupe before touching the filesystem.
        let mut unique_roots: Vec<String> = Vec::new();
        for root in roots {
            let normalized = normalize_path(&root);
            if normalized.is_empty() || unique_roots.contains(&normalized) {
                continue;
            }
            unique_roots.push(normalized);
        }

        let mut found: Vec<LeftoverFolder> = Vec::new();
        let mut measured = 0usize;

        for root in unique_roots {
            let root_path = Path::new(&root);
            if !root_path.is_dir() {
                continue;
            }
            let entries = match std::fs::read_dir(root_path) {
                Ok(entries) => entries,
                Err(_) => continue,
            };
            let mut children: Vec<_> = entries.filter_map(|e| e.ok()).collect();
            children.sort_by_key(|e| e.file_name());

            for entry in children {
                let file_name = entry.file_name().to_string_lossy().to_string();
                if is_reserved(&file_name) {
                    continue;
                }
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let display = path.to_string_lossy().to_string();
                if is_claimed(&display, &known) {
                    continue;
                }
                let bytes = if measured < MAX_MEASURED {
                    measured += 1;
                    crate::size::sum_folder_size(&path).map(|r| r.size_bytes).unwrap_or(0)
                } else {
                    0
                };
                found.push(LeftoverFolder {
                    modified_at: modified_at(&path),
                    path: display,
                    name: file_name,
                    bytes,
                });
            }
        }

        found.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.name.cmp(&b.name)));
        found.truncate(100);
        Ok(found)
    })
    .await
    .map_err(|e| format!("Leftover scan failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn known(paths: &[&str]) -> Vec<String> {
        paths.iter().map(|p| normalize_path(p)).collect()
    }

    #[test]
    fn normalize_collapses_separators_and_case() {
        assert_eq!(normalize_path("C:\\Games\\Portal\\"), "c:/games/portal");
        assert_eq!(normalize_path("C:/Games/Portal"), "c:/games/portal");
    }

    #[test]
    fn exact_match_is_claimed() {
        let k = known(&["C:/Games/Portal"]);
        assert!(is_claimed("C:\\Games\\Portal", &k));
    }

    #[test]
    fn nested_path_is_claimed() {
        let k = known(&["C:/Games/Portal 2/bin"]);
        assert!(is_claimed("C:/Games/Portal 2", &k));
        assert!(is_claimed("C:/Games", &k));
    }

    #[test]
    fn sibling_with_a_shared_prefix_is_not_claimed() {
        let k = known(&["C:/Games/Portal"]);
        assert!(!is_claimed("C:/Games/Portal 2", &k));
        assert!(!is_claimed("C:/Games/Portall", &k));
    }

    #[test]
    fn reserved_names_are_skipped() {
        assert!(is_reserved(".hidden"));
        assert!(is_reserved("$RECYCLE.BIN"));
        assert!(is_reserved("steamapps"));
        assert!(!is_reserved("Elden Ring"));
    }
}
