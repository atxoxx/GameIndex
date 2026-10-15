use serde::Serialize;
use std::path::Path;


#[cfg(target_os = "linux")]
use super::paths::{exe_stem_lower, normalize_path_lower};
use super::process::{query_running_processes, MemoryScanFilter};
use super::resolve::SKIP_KEYWORDS;

/// Owned kill-target data produced by
/// [`GameWatcher::gather_force_close_data`] — extracted under the
/// watcher mutex so the caller can drop the lock and pass the strings
/// (which include normalized exe paths used by
/// [`kill_matching_processes`]) into the slow Win32 phase without
/// holding the global mutex.
#[derive(Debug, Clone)]
pub struct ForceCloseData {
    pub pid: u32,
    pub expected_exe_lower: String,
    pub install_dir_lower: Option<String>,
}

/// Whether a force-close install-dir sweep is safe for `dir_lower`.
///
/// The sweep kills every qualifying process *under* the directory, so it
/// must never be pointed at a drive root or a shallow shared root (e.g.
/// `d:\` or `d:\games`): a sweep there would match unrelated user
/// processes — including GameIndex itself (stem `gameindex` is not in
/// `SKIP_KEYWORDS`) and explorer.exe — and terminate them. A directory
/// with at least three path components (drive + two levels) is
/// specific enough to be a single game's folder.
pub(crate) fn is_install_dir_sweep_safe(dir_lower: &str) -> bool {
    let components: Vec<&str> = dir_lower.split(['\\', '/']).filter(|c| !c.is_empty()).collect();
    // "c:" or root counts as one component; require drive/root + at least two levels.
    components.len() >= 3
}

/// Whether a running process at `proc_path_lower` may be force-killed by
/// an install-dir sweep.
pub(crate) fn is_sweep_candidate(proc_path_lower: &str, dir_lower: &str, expected_exe_lower: &str) -> bool {
    let proc_norm = proc_path_lower.replace('\\', "/");
    let dir_norm = dir_lower.replace('\\', "/");
    let exe_norm = expected_exe_lower.replace('\\', "/");

    if !proc_norm.starts_with(&dir_norm) {
        return false;
    }
    let remainder = &proc_norm[dir_norm.len()..];
    if !remainder.is_empty() && !remainder.starts_with('/') {
        return false;
    }
    let expected_stem = Path::new(&exe_norm)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();
    let stem_matches = Path::new(&proc_norm)
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase() == expected_stem)
        .unwrap_or(false);

    let rel = remainder.trim_start_matches('/');
    if rel.is_empty() || !rel.contains('/') {
        return expected_stem.is_empty() || stem_matches;
    }
    if expected_stem.is_empty() {
        return false;
    }
    stem_matches
}

/// Terminate every currently-running process belonging to a game.
///
/// A process is "the game" when its exe path equals the expected
/// (normalized) exe, OR it lives inside the game's install directory
/// and passes `is_sweep_candidate` (a direct child when the tracked exe
/// stem is unknown, or a stem match of the tracked exe at any depth)
/// plus the `SKIP_KEYWORDS` filter. The install-dir branch lets us kill
/// the real game even when:
///
///   * the launch was a pending session (no tracked PID yet), or
///   * the tracked PID was a launcher that already exited, or
///   * the game re-spawned under a new child PID.
///
/// The sweep is deliberately bounded: `is_install_dir_sweep_safe`
/// rejects drive roots / shallow shared roots so a force-close can
/// never kill unrelated processes (including GameIndex itself) just
/// because they share a directory with the game.
///
/// Each candidate is killed via `kill_pid_if_exe_matches` (which
/// verifies the exe and escalates TerminateProcess → taskkill /T so
/// the whole process tree, including anti-cheat daemons, dies).
///
/// Returns `true` if at least one matching process was terminated.
#[cfg(windows)]
pub fn kill_matching_processes(expected_exe_lower: &str, install_dir_lower: Option<&str>) -> bool {
    let processes = query_running_processes(&MemoryScanFilter::default());
    if processes.is_empty() {
        return false;
    }

    let mut killed_any = false;

    // 1. Exact tracked-exe match (fast, no install-dir assumption).
    if !expected_exe_lower.is_empty() {
        for proc in &processes {
            let path_lower = proc.exe_path.to_lowercase().replace('/', "\\");
            if path_lower == expected_exe_lower {
                if kill_pid_if_exe_matches(proc.pid, expected_exe_lower) {
                    killed_any = true;
                }
            }
        }
    }

    // 2. Install-dir match — covers pending launches and re-parented
    //    game processes that don't share the tracked exe path exactly.
    //    Bounded so it can never sweep an entire drive or shared root:
    //    the directory must be game-specific (≥3 path components) and
    //    each candidate must be a direct child (when the tracked exe
    //    stem is unknown) or share the tracked exe's stem.
    if let Some(dir) = install_dir_lower {
        if is_install_dir_sweep_safe(dir) {
            for proc in &processes {
                let path_lower = proc.exe_path.to_lowercase().replace('/', "\\");
                if !is_sweep_candidate(&path_lower, dir, expected_exe_lower) {
                    continue;
                }
                // Skip known non-game binaries (launchers, crash
                // handlers, redistributables) so we don't nuke a
                // harmless sibling. The game process won't be in here.
                if let Some(stem) = std::path::Path::new(&proc.exe_path)
                    .file_stem()
                    .and_then(|s| s.to_str())
                {
                    let lower = stem.to_lowercase();
                    if SKIP_KEYWORDS.iter().any(|kw| lower.contains(kw)) {
                        continue;
                    }
                }
                // Use the candidate's own exact path for the verify step.
                if kill_pid_if_exe_matches(proc.pid, &path_lower) {
                    killed_any = true;
                }
            }
        }
    }

    killed_any
}

/// Collect the PIDs of every currently-running process belonging to a
/// game, using the same exact-exe / install-dir-sweep matching as the
/// Windows path (see [`kill_matching_processes`] docs). Re-used both for
/// the initial SIGTERM pass and, against a FRESH snapshot, to re-verify
/// survivors before the SIGKILL pass so a recycled PID is never hard-
/// killed.
#[cfg(target_os = "linux")]
pub(crate) fn linux_force_close_targets(expected_exe_lower: &str, install_dir_lower: Option<&str>) -> Vec<u32> {
    let processes = query_running_processes(&MemoryScanFilter::default());
    let mut targets: Vec<u32> = Vec::new();

    // 1. Exact tracked-exe match (fast, no install-dir assumption).
    if !expected_exe_lower.is_empty() {
        for proc in &processes {
            if normalize_path_lower(&proc.exe_path) == expected_exe_lower {
                targets.push(proc.pid);
            }
        }
    }

    // 2. Install-dir match — covers pending launches, wrapper hand-offs
    //    and re-parented game processes that don't share the tracked exe
    //    path exactly. Bounded so it can never sweep an entire drive or
    //    shared root (see `is_install_dir_sweep_safe`).
    if let Some(dir) = install_dir_lower {
        if is_install_dir_sweep_safe(dir) {
            for proc in &processes {
                let path_lower = normalize_path_lower(&proc.exe_path);
                if !is_sweep_candidate(&path_lower, dir, expected_exe_lower) {
                    continue;
                }
                // Skip known non-game binaries (launchers, crash
                // handlers, redistributables) so we don't nuke a
                // harmless sibling.
                if let Some(lower) = exe_stem_lower(&proc.exe_path) {
                    if SKIP_KEYWORDS.iter().any(|kw| lower.contains(kw)) {
                        continue;
                    }
                }
                targets.push(proc.pid);
            }
        }
    }

    targets.sort_unstable();
    targets.dedup();
    targets
}

/// Terminate every currently-running process belonging to a game on
/// Linux, mirroring the Windows sweep semantics (exact exe match, then
/// a bounded install-dir sweep). Wine/Proton games are covered because
/// `query_running_processes` resolves the game's `.exe` from each
/// process's argv.
///
/// Two-phase termination: a graceful `SIGTERM` first so the game can
/// flush saves and tear down cleanly (Wine writes prefix state on clean
/// exit), then — after a short window — `SIGKILL` for anything that is
/// still alive. The hard-kill pass re-verifies every survivor against a
/// fresh process snapshot first: within the grace window a dying
/// process's PID can be recycled to an unrelated process, and only
/// processes that still match the game may be force-killed.
///
/// Returns `true` if at least one matching process was terminated (or
/// was already gone by the time the hard pass ran).
#[cfg(target_os = "linux")]
pub fn kill_matching_processes(expected_exe_lower: &str, install_dir_lower: Option<&str>) -> bool {
    let targets = linux_force_close_targets(expected_exe_lower, install_dir_lower);
    if targets.is_empty() {
        return false;
    }

    for pid in &targets {
        unsafe {
            let _ = libc::kill(*pid as i32, libc::SIGTERM);
        }
    }
    std::thread::sleep(std::time::Duration::from_millis(2000));

    let survivors = linux_force_close_targets(expected_exe_lower, install_dir_lower);
    let mut killed_any = false;
    for pid in targets {
        if survivors.contains(&pid) {
            unsafe {
                if libc::kill(pid as i32, libc::SIGKILL) == 0 {
                    killed_any = true;
                }
            }
        } else {
            // Already gone — SIGTERM worked, or the process exited on its own.
            killed_any = true;
        }
    }
    killed_any
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn kill_matching_processes(_expected_exe_lower: &str, _install_dir_lower: Option<&str>) -> bool {
    false
}

/// Outcome of `GameWatcher::force_close`. Serialised via serde so the
/// frontend can render an accurate toast without guessing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForceCloseResult {
    /// The PID that was tracked at the time the user clicked
    /// force-close. `0` when the session had no PID yet (pending Steam
    /// protocol / UAC). Informational; primarily used by debug logs
    /// and the toast copy ("PID N for "X") when killed.
    pub pid: u32,
    /// `true` when at least one matching process (the tracked exe and/or
    /// a live process inside the game's install dir) was terminated.
    /// The match is verified via `QueryFullProcessImageNameW` and
    /// escalates TerminateProcess → taskkill /T, so the whole process
    /// tree (anti-cheat, crash handler, VR runtime) is killed. `false`
    /// only when no live game process could be found/terminated (PID
    /// recycled, access denied, or nothing matched). The session is
    /// ALWAYS cleaned up via `finalize_session` regardless of this flag —
    /// only the toast copy diverges.
    pub killed: bool,
}

/// Windows-only helper. Re-reads the tracked PID's exe path and
/// compares it against the expected lowercase/normalized path we
/// stored in `ActiveSession.matched_exe` at launch time. Only when
/// the path matches do we escalate to killing, escalating through:
///
///   1. Direct `TerminateProcess` (fast, requires `PROCESS_TERMINATE`
///      rights on the target). Works for ~99% of games — user launches
///      the game under their own token, owns the resulting process.
///
///   2. Fallback to `taskkill /F /T /PID <pid>`. Doesn't require
///      `PROCESS_TERMINATE` because taskkill hands the kill off to
///      the SYSTEM-owned Task Scheduler service which has rights
///      the user's token doesn't. This is the escape hatch for the
///      elevation case: game launched with `runas`/UAC and our
///      GameIndex process runs at a lower integrity level, so the
///      DACL on the game's process token denies us
///      `PROCESS_TERMINATE` and TerminateProcess returns
///      `ERROR_ACCESS_DENIED`.
///
/// The `/T` flag on taskkill also nukes the process TREE (anti-cheat
/// daemon, crash handler, VR runtime, any helper that shares the
/// tracked PID as parent) which single-TerminateProcess would
/// leave orphaned. Game-level "I closed it but something is still
/// using my GPU/IO" complaints usually come from this omission.
///
/// Doing this with a QUERY handle FIRST then escalating to terminate
/// (or taskkill) is intentional: `PROCESS_QUERY_LIMITED_INFORMATION`
/// is granted more liberally than `PROCESS_TERMINATE`, so we want to
/// be sure the target IS the right process before asking for the
/// higher privilege (or shelling out a subprocess). The reverse
/// order (open terminate first, then query) would work too but
/// needlessly escalates without first confirming intent.
///
/// Returns `true` on a verified+successful kill by any path,
/// `false` on any verification or kill failure.
///
/// Anti-cheat caveat: PPL (Protected Process Light) anti-cheat
/// cannot be terminated via either path without admin / driver
/// cooperation. For those titles the kill is best-effort — the
/// user will see the warning toast and may need to close via the
/// anti-cheat's own menu or reboot the system.
#[cfg(windows)]
pub(crate) fn kill_pid_if_exe_matches(pid: u32, expected_exe_lower: &str) -> bool {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, TerminateProcess,
        PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
        PROCESS_TERMINATE,
    };

    unsafe {
        // 1. Verify the PID still belongs to the process we expect.
        //    OpenProcess may fail with ERROR_ACCESS_DENIED if the
        //    tracked process has already exited AND its PID has been
        //    recycled to a system process owned by another user —
        //    in that case we cannot safely issue a kill on this PID.
        let query_handle = match OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION,
            false,
            pid,
        ) {
            Ok(h) => h,
            Err(e) => {
                eprintln!(
                    "[game_watcher] force_close: OpenProcess(query) failed for PID {pid}: {e}; cannot verify PID safety, skipping kill"
                );
                return false;
            }
        };

        let mut buf = [0u16; 1024];
        let mut size = buf.len() as u32;
        let verified = QueryFullProcessImageNameW(
            query_handle,
            PROCESS_NAME_WIN32,
            PWSTR::from_raw(buf.as_mut_ptr()),
            &mut size,
        )
        .is_ok()
            && {
                let actual = OsString::from_wide(&buf[..size as usize])
                    .to_string_lossy()
                    .to_string()
                    .to_lowercase()
                    .replace('/', "\\");
                actual == expected_exe_lower
            };
        let _ = CloseHandle(query_handle);

        if !verified {
            eprintln!(
                "[game_watcher] force_close: PID {pid} exe path no longer matches tracked session; PID likely recycled. Skipping kill."
            );
            return false;
        }

        // 2. PID verified — escalate to direct TerminateProcess.
        //    Fast and synchronous in the typical case (game running
        //    under our token). On access-denied (game elevated above
        //    us, or DACL denied) fall through to taskkill which uses
        //    SYSTEM-level Task Scheduler service rights.
        let term_handle = match OpenProcess(PROCESS_TERMINATE, false, pid) {
            Ok(h) => h,
            Err(e) => {
                eprintln!(
                    "[game_watcher] force_close: OpenProcess(terminate) failed for PID {pid}: {e}; falling back to taskkill"
                );
                return try_taskkill(pid);
            }
        };
        if TerminateProcess(term_handle, 0).is_ok() {
            let _ = CloseHandle(term_handle);
            eprintln!(
                "[game_watcher] force-closed PID {pid} via TerminateProcess"
            );
            return true;
        }
        let _ = CloseHandle(term_handle);
        eprintln!(
            "[game_watcher] force_close: TerminateProcess returned false for PID {pid}; falling back to taskkill"
        );
    }

    // 3. Fallback for elevated/process-tree cases — see helper.
    try_taskkill(pid)
}

/// Win32 fallback: `taskkill /F /T /PID <pid>`. Returns true on
/// exit-code 0, false otherwise.
///
/// The `/F` switch forces termination (kills the process even if
/// it's hung in a non-responding window). The `/T` switch kills the
/// entire process tree (parent + children), which matters for
/// games with separate processes for the launcher, anti-cheat
/// daemon, VR runtime, crash reporter — a single TerminateProcess
/// on the parent leaves those orphaned and still consuming GPU/IO
/// until they notice their parent is gone (EAC/BattleEye especially
/// are notorious for this — "I closed the game but my fans are
/// still spinning at 100%").
///
/// Why we shell out: invoking taskkill.exe means spawning a child
/// Rust process, paying the CreateProcess + stdio pipe cost (~50ms
/// cold, ~10ms warm). We could use `NtTerminateProcess` / the
/// Task Scheduler COM API to avoid that, but taskkill.exe is what
/// every Microsoft / Steam / Epic-process tool calls here, is
/// present on every Windows install since XP, and side-steps the
/// 32/64-bit token + privilege juggling that would be required to
/// inline it. Trailing whitespace in the search path is benign
/// — `Command::new("taskkill")` relies on PATH resolution, which
/// for `%SystemRoot%\System32` is always present in the default
/// user's PATH.
#[cfg(windows)]
pub(crate) fn try_taskkill(pid: u32) -> bool {
    use std::process::Command;
    let pid_str = pid.to_string();

    match Command::new("taskkill")
        .args(["/F", "/T", "/PID", &pid_str])
        .output()
    {
        Ok(output) => {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                eprintln!(
                    "[game_watcher] taskkill /F /T /PID {} succeeded: {}",
                    pid,
                    stdout.trim()
                );
                true
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let stdout = String::from_utf8_lossy(&output.stdout);
                eprintln!(
                    "[game_watcher] taskkill /F /T /PID {} failed: exit={:?} stdout={} stderr={}",
                    pid,
                    output.status.code(),
                    stdout.trim(),
                    stderr.trim()
                );
                false
            }
        }
        Err(e) => {
            eprintln!(
                "[game_watcher] force_close: failed to invoke taskkill for PID {pid}: {e}"
            );
            false
        }
    }
}

// ─── Shared Types ─────────────────────────────────────────────────────────────
