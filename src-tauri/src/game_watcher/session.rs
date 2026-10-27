use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

use crate::db::{self};

use super::*;
use super::paths::{
    exe_stem_lower, is_path_sep, normalize_path_lower, now_unix_ms, trim_path_separators,
};
use super::process::ProcessInfo;
use super::resolve::SKIP_KEYWORDS;

/// Finalize an ended game session: run the post-exit script, stop the
/// metrics collector (waiting up to 1 s for it to drain — metrics are
/// nice-to-have telemetry, not a UX blocker), record the session row +
/// `last_played` stamp in SQLite, then emit `game-exited` with the name
/// of any still-active session.
///
/// Designed to run OUTSIDE the global `Arc<Mutex<GameWatcher>>`: the
/// caller (`start_background_poll`, `force_close_game`) extracts the
/// owned session via `take_active_session` first and drops the lock
/// before invoking this, so the blocking script / recv / db work never
/// freezes IPC handlers or the background poll loop.
pub(crate) fn finalize_session(
    db: &db::Db,
    app_handle: &AppHandle,
    mut session: ActiveSession,
    remaining_name: Option<String>,
) {
    // Run the post-exit script (if any) before recording the session.
    // Blocking is fine — the game has already exited and the watcher
    // mutex is not held here.
    if let Some((script, admin)) = &session.post_exit_script {
        let _ = crate::run_script_blocking(script, *admin);
    }
    let _ = session.stop_tx.send(());
    let elapsed = session.elapsed_seconds();
    let drained = session
        .metrics_rx
        .as_mut()
        .and_then(|rx| rx.recv_timeout(std::time::Duration::from_secs(1)).unwrap_or(None));
    // A slow WMI shutdown can outlast the 1 s drain. Fall back to the live
    // accumulator so the freshest samples are still recorded instead of
    // dropping telemetry for the session.
    let metrics = drained.or_else(|| {
        session
            .metrics_acc
            .as_ref()
            .and_then(|acc| acc.snapshot())
    });

    // Capture the wall-clock time at session-end (Unix ms). The frontend
    // uses this to stamp `Game.lastPlayed`, which drives the "Continue
    // Playing" rail on the Library page. We use the same clock the
    // frontend reads via `Date.now()` (i.e. system time, not monotonic)
    // so the value survives timezone shifts and clock corrections without
    // a re-derivation step.
    let finished_at_ms = now_unix_ms();
    // Prefer the attach-anchored wall-clock stamp captured when the
    // process first appeared; fall back to back-dating from the finish
    // time for sessions that predate that field.
    let started_at_ms = if session.attached_at_ms > 0 {
        session.attached_at_ms
    } else {
        finished_at_ms.saturating_sub(elapsed * 1000)
    };

    // Phase 3: write the session row before emitting the event so any
    // frontend listener that reads from the DB sees a row in place.
    // Synchronous SQLite insert on a WAL pool is sub-millisecond; the
    // emit follows only after the commit returns.
    // A `None` drain result does not erase telemetry: `finalize` COALESCEs
    // these columns, preserving the checkpoint the last heartbeat persisted.
    let (avg_fps, avg_cpu, avg_gpu, avg_ram, metrics_json) =
        crate::metrics_collector::persist_parts(metrics.as_ref());
    // A session that never attached (last_pid == 0 — only reachable via
    // the pending-launch timeout) never ran a process: skip the phantom
    // session row and the last_played stamp entirely. `game-exited` is
    // still emitted below (with elapsed 0) so the frontend's running
    // indicator clears.
    if session.last_pid != 0 {
        if let Err(e) = db::sessions::finalize(
            db,
            &session.game_id,
            &session.game_name,
            started_at_ms,
            finished_at_ms,
            elapsed,
            avg_fps,
            avg_cpu,
            avg_gpu,
            avg_ram,
            metrics_json.as_deref(),
        ) {
            eprintln!(
                "[game_watcher] failed to record session for {}: {e}",
                session.game_id
            );
        }

        // Mirror the timestamp into the games table so the Library
        // "Continue Playing" rail can sort without a JOIN. Phase 3 hot-path:
        // replaces the old full-library-rewrite triggered by save_games.
        if let Err(e) = db::games::update_last_played(db, &session.game_id, finished_at_ms) {
            eprintln!(
                "[game_watcher] failed to update last_played for {}: {e}",
                session.game_id
            );
        }
    }

    let _ = app_handle.emit(
        "game-exited",
        GameExitPayload {
            game_id: session.game_id.clone(),
            elapsed_seconds: elapsed,
            finished_at: finished_at_ms,
            metrics,
            remaining_game_name: remaining_name,
        },
    );

    // Watchdog healing: surface the two "launch went nowhere" shapes to
    // the frontend. A launch the watcher never saw attached means the
    // chain broke before the game window showed (missing exe, Steam
    // relaunch never matched, launcher died); a process that attached
    // and died inside HEAL_SHORT_RUN_SECS is a crash-class exit. Both
    // are actionable healing candidates — the user force-close path
    // (`force_close_game`) does NOT route through here, so deliberate
    // quits never trigger the heal dialog.
    let attached = session.last_pid != 0;
    if elapsed < HEAL_SHORT_RUN_SECS {
        let _ = app_handle.emit(
            "game-failed",
            GameFailurePayload {
                game_id: session.game_id.clone(),
                game_name: session.game_name.clone(),
                elapsed_seconds: elapsed,
                attached,
            },
        );
    }
}

/// A session that attached and ran shorter than this is treated as a
/// doomed launch (instant crash), not a real play session. Manual
/// quits inside this window are a rare false positive — the heal
/// dialog is dismissible and mute-able, so the noise cost is low.
pub(crate) const HEAL_SHORT_RUN_SECS: u64 = 15;

/// `true` when the tracked PID is alive AND still resolves to the
/// tracked exe. Liveness by PID alone is not enough: between 5 s polls
/// the OS can recycle a PID to an unrelated process, which would keep
/// a dead session "running" against a foreign exe — inflated playtime,
/// metrics sampling the wrong process, and `game-exited` never firing
/// until that foreign process exits. A session is only currently
/// running when its PID is alive AND still resolves to the tracked exe.
///
/// Empty `matched_exe` (only possible for pending launches, which have
/// last_pid == 0 and never reach this check) counts as running. Both
/// the PID and its path come from the same `processes` snapshot, so a
/// present PID always has a queryable path here — no PID-only fallback
/// needed.
pub(crate) fn is_currently_running(
    processes: &[ProcessInfo],
    last_pid: u32,
    matched_exe: &str,
) -> bool {
    if last_pid == 0 {
        return false;
    }
    let matched_norm = normalize_path_lower(matched_exe);

    // Walk the tracked PID and its descendants. The tracked PID is often
    // a wrapper (gamescope / gamemoderun / mangohud / a launcher) whose
    // own `/proc/<pid>/exe` names the wrapper binary — the game runs as a
    // child (or grandchild) process. A descendant counts as running only
    // when it resolves to the tracked exe, so a wrapper that spawned an
    // unrelated helper never keeps the session alive.
    let mut stack: Vec<u32> = vec![last_pid];
    let mut visited: std::collections::HashSet<u32> = std::collections::HashSet::new();
    while let Some(pid) = stack.pop() {
        if !visited.insert(pid) {
            continue;
        }
        if let Some(p) = processes.iter().find(|p| p.pid == pid) {
            if matched_norm.is_empty() || normalize_path_lower(&p.exe_path) == matched_norm {
                return true;
            }
        }
        // Follow children even when the tracked PID itself is gone. A
        // splash / bootstrap process exits after spawning the game and the
        // child keeps reporting the dead parent's PID, so this is what
        // keeps a hand-off from ever entering the grace window when the
        // child still resolves to the tracked exe.
        stack.extend(
            processes
                .iter()
                .filter(|c| c.ppid == pid && !visited.contains(&c.pid))
                .map(|c| c.pid),
        );
    }
    false
}

/// Locate a still-running process for an active session when the tracked
/// PID has gone missing (the launcher / bootstrapper / splash exited and
/// handed off to the real game — commonly right as the game goes
/// fullscreen).
///
/// Search strategy, in priority order:
///   1. The session's `install_dir`.
///   2. Progressively higher parent directories (up to 3 levels). This
///      catches publisher launchers that install their games in a *sibling*
///      folder under a shared root — e.g. `Rockstar Games\Launcher` launches
///      `Rockstar Games\Grand Theft Auto V`, or `Ubisoft\UbisoftConnect`
///      launches `Ubisoft\GameName`.
///   3. As a last resort, any running process whose exe stem exactly matches
///      the session's tracked exe stem (handles games that relaunch the same
///      binary under a different path). Candidates are restricted to the
///      install-dir tree (and its parents) so an unrelated title with a
///      similar name is never grabbed.
///   4. A live descendant of the tracked PID, confined to the install-dir
///      tree. A splash / bootstrap executable frequently spawns the real
///      game under a *different* name (`Game.exe` →
///      `Game-Win64-Shipping.exe`, `Launcher` → `GameName`) and then exits;
///      the child still reports the dead parent's PID, so the descendant
///      relationship identifies the hand-off even when the stem differs.
///
/// Every tier requires the candidate to be *the game*, not just any
/// process in the folder: with a known tracked exe, only processes
/// sharing its exe stem qualify (or a descendant of the tracked PID for
/// tier 4); without one (pending protocol launch), only direct children
/// of the install dir qualify. This is what keeps the session from
/// pinning to a leftover process — an anti-cheat daemon, an updater, a
/// crash handler, or a *sibling game under the same publisher root* —
/// which would make the app never notice the game quit and inflate
/// playtime forever. Skip-keyword executables are always excluded from
/// every tier.
pub(crate) fn find_session_process(
    processes: &[ProcessInfo],
    tracked_pid: u32,
    install_dir: Option<&PathBuf>,
    matched_exe: &str,
) -> Option<ProcessInfo> {
    // Stem of the tracked exe. `None` only for pending protocol launches
    // with no known exe; those fall back to direct children of the dir.
    let expected_stem = exe_stem_lower(matched_exe)
        .filter(|s| !s.is_empty() && !SKIP_KEYWORDS.iter().any(|kw| s.contains(kw)));

    // Normalize the install dir up front. Parsing the *normalized* path is
    // what makes the parent climbs below platform-independent: on Linux a
    // Windows-style install dir (`C:\Games\Publisher\Launcher`) canonicalizes
    // to `c:/games/publisher/launcher`, so `Path::parent` splits it into
    // components instead of returning the whole string as one component.
    // The same normalization keeps Wine/Proton paths (mixed separators)
    // climbing on Windows.
    let install_dir_norm: Option<PathBuf> = install_dir.map(|d| {
        PathBuf::from(
            trim_path_separators(&normalize_path_lower(&d.to_string_lossy())).to_string(),
        )
    });

    // Tier 1: the session's own install dir. This is the only scan
    // allowed to use the bundled-Java-runtime fallback — a Java game's
    // real process (e.g. Songs of Syx's `jre\bin\javaw.exe`) lives in
    // this exact folder, while a parent-level scan must never steal a
    // sibling game's bundled runtime.
    if let Some(dir) = install_dir_norm.as_deref() {
        if let Some(p) =
            find_best_process_in_dir(processes, dir, expected_stem.as_deref(), true)
        {
            return Some(p);
        }

        // Tier 2: climb the directory tree (max 3 levels) to catch sibling
        // publisher folders.
        let mut cur = dir.parent();
        for _ in 0..3 {
            match cur {
                Some(p) if !p.as_os_str().is_empty() => {
                    if let Some(found) = find_best_process_in_dir(
                        processes,
                        p,
                        expected_stem.as_deref(),
                        false,
                    ) {
                        return Some(found);
                    }
                    cur = p.parent();
                }
                _ => break,
            }
        }
    }

    // Tier 3: exact exe-stem match, restricted to the install-dir tree.
    let stem = exe_stem_lower(matched_exe);
    if let Some(lower) = stem {
        if !lower.is_empty() && !SKIP_KEYWORDS.iter().any(|kw| lower.contains(kw)) {
            if let Some(dir_norm) = install_dir_norm.as_deref() {
                let dir_lower = dir_norm.to_string_lossy();
                let mut best: Option<(u64, ProcessInfo)> = None;
                for p in processes {
                    let pstem = match exe_stem_lower(&p.exe_path) {
                        Some(s) => s,
                        None => continue,
                    };
                    if SKIP_KEYWORDS.iter().any(|kw| pstem.contains(kw)) {
                        continue;
                    }
                    if pstem != lower {
                        continue;
                    }
                    // Keep the candidate within the install-dir tree (or its
                    // parents) to avoid stealing an unrelated game.
                    let pl = normalize_path_lower(&p.exe_path);
                    if pl.starts_with(dir_lower.as_ref()) {
                        let score = p.working_set_size;
                        if best.as_ref().map(|(s, _)| score > *s).unwrap_or(true) {
                            best = Some((score, p.clone()));
                        }
                        continue;
                    }
                    let mut cur = dir_norm.parent();
                    let mut within = false;
                    for _ in 0..4 {
                        if let Some(pp) = cur {
                            let pp_l = pp.to_string_lossy();
                            if !pp_l.is_empty() && pl.starts_with(pp_l.as_ref()) {
                                within = true;
                                break;
                            }
                            cur = pp.parent();
                        } else {
                            break;
                        }
                    }
                    if within {
                        let score = p.working_set_size;
                        if best.as_ref().map(|(s, _)| score > *s).unwrap_or(true) {
                            best = Some((score, p.clone()));
                        }
                    }
                }
                if let Some((_, p)) = best {
                    return Some(p);
                }
            }
        }
    }

    // Tier 4: a live descendant of the tracked PID, confined to the
    // install-dir tree. Covers splash / bootstrap hand-offs where the real
    // game is spawned under a different executable name and the parent
    // exits immediately after (Unreal's `Game.exe` →
    // `Game-Win64-Shipping.exe`, `Launcher.exe` → `GameName.exe`, …).
    if let Some(p) = find_handoff_descendant(processes, tracked_pid, install_dir) {
        return Some(p);
    }

    None
}

/// Locate the real game process after a splash / bootstrap executable
/// spawned it and exited. The child's reported parent PID still points at
/// the tracked (now dead) process, so following the ppid graph from the
/// tracked PID identifies the hand-off even when the game's executable
/// name differs from the bootstrap's.
///
/// Candidates are restricted to descendants of `root_pid`, non-skip
/// executables, and — when an install dir is known — the install-dir tree.
/// The largest working set wins: a splash / bootstrap is a thin loader
/// that exits, so whatever heavyweight process it left behind is the game.
/// Confining to the install dir (rather than its parents) keeps an
/// unrelated child of a shared helper from being grabbed.
pub(crate) fn find_handoff_descendant(
    processes: &[ProcessInfo],
    root_pid: u32,
    install_dir: Option<&PathBuf>,
) -> Option<ProcessInfo> {
    if root_pid == 0 {
        return None;
    }

    // ppid closure from the tracked PID, excluding the root itself.
    let mut descendants: Vec<&ProcessInfo> = Vec::new();
    let mut stack: Vec<u32> = vec![root_pid];
    let mut visited: std::collections::HashSet<u32> = std::collections::HashSet::new();
    visited.insert(root_pid);
    while let Some(pid) = stack.pop() {
        for p in processes {
            if p.ppid == pid && visited.insert(p.pid) {
                descendants.push(p);
                stack.push(p.pid);
            }
        }
    }
    if descendants.is_empty() {
        return None;
    }

    let dir_lower = install_dir.map(|d| {
        trim_path_separators(&normalize_path_lower(&d.to_string_lossy())).to_string()
    });

    descendants
        .into_iter()
        .filter(|p| {
            // Skip-keyword executables (launchers, crash handlers,
            // redistributables) are never the game.
            if let Some(lower) = exe_stem_lower(&p.exe_path) {
                if SKIP_KEYWORDS.iter().any(|kw| lower.contains(kw)) {
                    return false;
                }
            }
            // Confine to the install-dir tree so a descendant that lives
            // elsewhere on disk (a shared overlay helper, a runtimes dir)
            // is never mistaken for the game.
            if let Some(dir) = dir_lower.as_deref() {
                let path_lower = normalize_path_lower(&p.exe_path);
                if !path_lower.starts_with(dir) {
                    return false;
                }
                let remainder = &path_lower[dir.len()..];
                if !remainder.is_empty() && !remainder.starts_with(is_path_sep) {
                    return false;
                }
            }
            true
        })
        .max_by_key(|p| p.working_set_size)
        .cloned()
}

/// Find the best running process inside an install directory that can
/// plausibly be the game we're re-attaching to. Prefers executables
/// whose stem does not contain known non-game keywords (launchers,
/// crash handlers, etc.) and, when multiple candidates remain, picks the
/// one with the largest working set.
///
/// `expected_stem` bounds the match: when the tracked exe stem is known
/// (most sessions), ONLY candidates sharing that stem qualify — a leftover
/// helper or a sibling game in the same folder is never picked. When the
/// stem is unknown (pending protocol launch), only direct children of
/// the directory qualify. Skip-keyword executables are always excluded.
///
/// When the strict rule finds nothing, a *bundled Java runtime* process
/// running inside the same directory is accepted as the game (gated by
/// `allow_bundled_java`, see `is_java_runtime_host`). This covers Java
/// games whose launcher stub exits right after spawning the real game —
/// Songs of Syx ships `jre\bin\javaw.exe` and its `SongsOfSyx.exe` stub
/// hands off to it and dies, so without the fallback the session would
/// end while the game is still running. The fallback is scoped to the
/// game's own install dir (callers pass `false` for parent-directory
/// scans) so a bundled runtime from a *sibling* game under a shared
/// publisher root is never stolen.
pub(crate) fn find_best_process_in_dir(
    processes: &[ProcessInfo],
    install_dir: &Path,
    expected_stem: Option<&str>,
    allow_bundled_java: bool,
) -> Option<ProcessInfo> {
    let dir_lower = trim_path_separators(&normalize_path_lower(&install_dir.to_string_lossy()))
        .to_string();

    if dir_lower.is_empty() {
        return None;
    }

    let expected_stem = expected_stem.map(|s| s.to_lowercase());

    // Strict rule — the existing stem/direct-child acceptance. Direct
    // children qualify when the tracked exe stem is unknown (pending
    // launch) or the child shares that stem; deeper processes qualify
    // only on an exact stem match. A different-stem process in the
    // folder (anti-cheat daemon, updater, sibling game) is never the
    // game. `best_process_in_dir` already guarantees `p` lives inside
    // `dir_lower`, so the remainder slicing here is safe.
    let strict_match = |p: &ProcessInfo| {
        let path_lower = normalize_path_lower(&p.exe_path);
        let remainder = &path_lower[dir_lower.len()..];
        let rel = remainder.trim_start_matches(is_path_sep);
        if rel.is_empty() || !rel.contains(is_path_sep) {
            return match expected_stem.as_deref() {
                None => true,
                Some(stem) => exe_stem_matches(p, stem),
            };
        }
        match expected_stem.as_deref() {
            Some(stem) => exe_stem_matches(p, stem),
            None => false,
        }
    };

    // Strict matches always win — the Java fallback must never displace
    // a real exe-stem match that is still alive.
    if let Some(p) = best_process_in_dir(processes, &dir_lower, strict_match) {
        return Some(p);
    }

    // Bundled-Java-runtime fallback (launcher-stub hand-off, e.g.
    // SongsOfSyx.exe → jre\bin\javaw.exe).
    if allow_bundled_java {
        if let Some(p) = best_process_in_dir(processes, &dir_lower, is_java_runtime_host) {
            return Some(p);
        }
    }

    None
}

/// `true` when `p` is one of the standard Java launcher executables
/// (`java` / `javaw` / `javaws`) running from a bundled runtime
/// directory inside the game folder (a path segment named `jre`, `jdk`,
/// `jvm` or `jbr`). Games that ship their own JVM launch a stub exe
/// that spawns this process and exits; the real gameplay process is the
/// runtime host, not the stub. Scoping to the bundled-runtime path is
/// what keeps this from matching the user's system-wide Java install.
pub(crate) fn is_java_runtime_host(p: &ProcessInfo) -> bool {
    let stem = match exe_stem_lower(&p.exe_path) {
        Some(s) => s,
        None => return false,
    };
    if stem != "java" && stem != "javaw" && stem != "javaws" {
        return false;
    }
    normalize_path_lower(&p.exe_path)
        .split(is_path_sep)
        .any(|seg| {
            let seg = seg.trim_end_matches(':');
            seg.starts_with("jre") || seg.starts_with("jdk") || seg.starts_with("jvm") || seg.starts_with("jbr")
        })
}

/// `true` when the process's exe stem (case-insensitive) equals `stem`.
pub(crate) fn exe_stem_matches(p: &ProcessInfo, stem: &str) -> bool {
    exe_stem_lower(&p.exe_path)
        .map(|s| s == stem)
        .unwrap_or(false)
}

/// Pick the best running process inside `dir_lower` accepted by `accept`:
/// the largest working set among non-skip-keyworded candidates, or `None`
/// when nothing qualifies. The directory-boundary guard (inside the dir,
/// not a sibling path that merely shares the prefix) is applied here so
/// every `accept` predicate sees only genuinely-inside candidates.
///
/// Skip-keyword executables (launchers, crash handlers, Wallpaper
/// Engine, etc.) are NEVER the game we're looking for. If every
/// candidate matches a skip keyword we return None rather than
/// picking one — without this guard a lone wallpaper64.exe (or
/// similar background app) in a parent directory like
/// `…\steamapps\common\` would be chosen as the "best process".
pub(crate) fn best_process_in_dir<F>(
    processes: &[ProcessInfo],
    dir_lower: &str,
    accept: F,
) -> Option<ProcessInfo>
where
    F: Fn(&ProcessInfo) -> bool,
{
    let mut candidates: Vec<ProcessInfo> = processes
        .iter()
        .filter(|p| {
            let path_lower = normalize_path_lower(&p.exe_path);
            if !path_lower.starts_with(dir_lower) {
                return false;
            }
            // Make sure the match is actually inside the directory, not a
            // sibling path that happens to share the prefix (e.g. "FooBar"
            // when looking for "Foo").
            let remainder = &path_lower[dir_lower.len()..];
            if !remainder.is_empty() && !remainder.starts_with(is_path_sep) {
                return false;
            }
            accept(p)
        })
        .cloned()
        .collect();

    if candidates.is_empty() {
        return None;
    }

    // Prefer executables that are not launchers/crash handlers/etc.
    let skip_filtered: Vec<ProcessInfo> = candidates
        .iter()
        .filter(|p| {
            if let Some(lower) = exe_stem_lower(&p.exe_path) {
                !SKIP_KEYWORDS.iter().any(|kw| lower.contains(kw))
            } else {
                true
            }
        })
        .cloned()
        .collect();

    if skip_filtered.is_empty() {
        return None;
    }
    candidates = skip_filtered;

    candidates.sort_by(|a, b| b.working_set_size.cmp(&a.working_set_size));
    candidates.into_iter().next()
}

// ─── Background Poll Thread ───────────────────────────────────────────────────
