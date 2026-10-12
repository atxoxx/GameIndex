//! Shared, rayon-parallel filesystem walking.
//!
//! Every scanner in the app walks a directory tree the same way: read a
//! directory, hand each entry to a visitor, and recurse into the
//! subdirectories that pass a filter. Doing that recursively and
//! single-threaded is what makes large library imports stall on machines
//! with many cores, so the loops fan the tree out over rayon's pool.
//!
//! Callers keep their own semantics through two closures: `visit` runs
//! for every non-symlink entry, `descend` decides whether a directory is
//! walked. Both must be `Sync` because they run on rayon workers.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use rayon::prelude::*;

/// Visit every non-symlink entry under `root`, recursing into the
/// directories `descend` approves.
///
/// `visit` receives the entry's containing directory, the entry path,
/// the containing directory's depth (the root is `0`) and the entry's
/// metadata. Recursion stops past `max_depth`, so an entry whose
/// containing directory is deeper than `max_depth` is never visited.
///
/// Directory recursion runs in parallel on rayon's pool; symlinks are
/// skipped so a reparse point / junction can neither double-count a tree
/// nor spin forever. When `cancel` is set, the walk tears down as soon as
/// a worker notices it.
pub(crate) fn walk_parallel<Visit, Descend>(
    root: &Path,
    max_depth: u32,
    cancel: Option<&AtomicBool>,
    visit: &Visit,
    descend: &Descend,
) where
    Visit: Fn(&Path, &Path, u32, &std::fs::Metadata) + Sync,
    Descend: Fn(&Path, &str, u32) -> bool + Sync,
{
    walk_dir(root, 0, max_depth, cancel, visit, descend);
}

fn walk_dir<Visit, Descend>(
    dir: &Path,
    depth: u32,
    max_depth: u32,
    cancel: Option<&AtomicBool>,
    visit: &Visit,
    descend: &Descend,
) where
    Visit: Fn(&Path, &Path, u32, &std::fs::Metadata) + Sync,
    Descend: Fn(&Path, &str, u32) -> bool + Sync,
{
    if depth > max_depth || is_cancelled(cancel) {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    let mut subdirs: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
        if is_cancelled(cancel) {
            return;
        }
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_symlink() {
            continue;
        }
        visit(dir, &path, depth, &meta);
        if meta.is_dir() {
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();
            if descend(&path, name, depth) {
                subdirs.push(path);
            }
        }
    }

    // Fan this directory's children out over the pool. rayon nests fine:
    // a recursive `par_iter` inside a worker just steals from the same
    // global pool instead of spawning another one.
    subdirs.into_par_iter().for_each(|sub| {
        walk_dir(&sub, depth + 1, max_depth, cancel, visit, descend);
    });
}

fn is_cancelled(cancel: Option<&AtomicBool>) -> bool {
    cancel.is_some_and(|flag| flag.load(Ordering::Relaxed))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn unique_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "gamescan-{tag}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn no_filter(_dir: &Path, _name: &str, _depth: u32) -> bool {
        true
    }

    #[test]
    fn visits_every_file_across_nested_dirs() {
        let root = unique_dir("nested");
        std::fs::create_dir_all(root.join("a/b")).unwrap();
        std::fs::write(root.join("one.txt"), b"1").unwrap();
        std::fs::write(root.join("a/two.txt"), b"2").unwrap();
        std::fs::write(root.join("a/b/three.txt"), b"3").unwrap();

        let seen: Mutex<Vec<(String, u32)>> = Mutex::new(Vec::new());
        walk_parallel(
            &root,
            8,
            None,
            &|_dir: &Path, entry: &Path, depth: u32, _meta: &std::fs::Metadata| {
                if entry.is_file() {
                    seen.lock()
                        .unwrap()
                        .push((entry.file_name().unwrap().to_string_lossy().to_string(), depth));
                }
            },
            &no_filter,
        );

        let mut names: Vec<String> = seen.into_inner().unwrap().into_iter().map(|(n, _)| n).collect();
        names.sort();
        assert_eq!(names, vec!["one.txt", "three.txt", "two.txt"]);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn respects_max_depth() {
        let root = unique_dir("depth");
        std::fs::create_dir_all(root.join("d1/d2/d3")).unwrap();
        std::fs::write(root.join("shallow.txt"), b"x").unwrap();
        std::fs::write(root.join("d1/mid.txt"), b"x").unwrap();
        std::fs::write(root.join("d1/d2/deep.txt"), b"x").unwrap();
        std::fs::write(root.join("d1/d2/d3/deepest.txt"), b"x").unwrap();

        let seen: Mutex<Vec<String>> = Mutex::new(Vec::new());
        walk_parallel(
            &root,
            1, // root + one level of subdirectories
            None,
            &|_dir: &Path, entry: &Path, _depth: u32, _meta: &std::fs::Metadata| {
                if entry.is_file() {
                    seen.lock()
                        .unwrap()
                        .push(entry.file_name().unwrap().to_string_lossy().to_string());
                }
            },
            &no_filter,
        );

        let mut names = seen.into_inner().unwrap();
        names.sort();
        assert_eq!(names, vec!["mid.txt", "shallow.txt"]);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn descend_filter_prunes_subtree() {
        let root = unique_dir("prune");
        std::fs::create_dir_all(root.join("keep/deep")).unwrap();
        std::fs::create_dir_all(root.join("skip/deep")).unwrap();
        std::fs::write(root.join("keep/deep/kept.txt"), b"x").unwrap();
        std::fs::write(root.join("skip/deep/dropped.txt"), b"x").unwrap();

        let seen: Mutex<Vec<String>> = Mutex::new(Vec::new());
        walk_parallel(
            &root,
            8,
            None,
            &|_dir: &Path, entry: &Path, _depth: u32, _meta: &std::fs::Metadata| {
                if entry.is_file() {
                    seen.lock()
                        .unwrap()
                        .push(entry.file_name().unwrap().to_string_lossy().to_string());
                }
            },
            &|_dir: &Path, name: &str, _depth: u32| name != "skip",
        );

        let seen = seen.into_inner().unwrap();
        assert_eq!(seen, vec!["kept.txt"]);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn stops_when_cancelled() {
        let root = unique_dir("cancel");
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("f.txt"), b"x").unwrap();

        let cancel = AtomicBool::new(true);
        let seen: Mutex<usize> = Mutex::new(0);
        walk_parallel(
            &root,
            8,
            Some(&cancel),
            &|_dir: &Path, _entry: &Path, _depth: u32, _meta: &std::fs::Metadata| {
                *seen.lock().unwrap() += 1;
            },
            &no_filter,
        );

        assert_eq!(*seen.lock().unwrap(), 0, "cancelled walk must visit nothing");
        std::fs::remove_dir_all(&root).ok();
    }

    #[cfg(unix)]
    #[test]
    fn skips_symlinks() {
        let root = unique_dir("symlink");
        let real = root.join("real");
        std::fs::create_dir_all(&real).unwrap();
        std::fs::write(real.join("a.txt"), b"x").unwrap();
        let link = root.join("link.txt");
        if std::os::unix::fs::symlink(real.join("a.txt"), &link).is_ok() {
            let seen: Mutex<Vec<String>> = Mutex::new(Vec::new());
            walk_parallel(
                &root,
                8,
                None,
                &|_dir: &Path, entry: &Path, _depth: u32, _meta: &std::fs::Metadata| {
                    if entry.is_file() {
                        seen.lock()
                            .unwrap()
                            .push(entry.file_name().unwrap().to_string_lossy().to_string());
                    }
                },
                &no_filter,
            );
            let seen = seen.into_inner().unwrap();
            assert_eq!(seen, vec!["a.txt"], "the symlink entry must be skipped");
        }
        std::fs::remove_dir_all(&root).ok();
    }
}
