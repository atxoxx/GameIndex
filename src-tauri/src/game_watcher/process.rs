use std::path::Path;


use super::paths::normalize_path_lower;

#[derive(Debug, Clone)]
pub(crate) struct ProcessInfo {
    pub(crate) pid: u32,
    /// Parent PID. Lets `is_currently_running` walk the process tree so a
    /// session tracked on a wrapper process (gamescope / gamemoderun /
    /// mangohud / a launcher) stays alive while the actual game runs as
    /// one of its descendants.
    pub(crate) ppid: u32,
    pub(crate) exe_path: String,
    /// Working set size in bytes; used to pick the dominant process
    /// when multiple candidates live inside the same install directory.
    pub(crate) working_set_size: u64,
}

/// Snapshot of an in-progress session produced by
/// [`GameWatcher::snapshot_running_rows`]. Owned so the background poll
/// loop can persist it via `db::sessions::upsert_running` after releasing
/// the watcher mutex.
pub(crate) struct RunningSessionSnapshot {
    pub(crate) game_id: String,
    pub(crate) game_name: String,
    pub(crate) started_at_ms: u64,
    pub(crate) elapsed_seconds: u64,
}

/// Tells `query_running_processes` which processes need their working-set
/// size read. Working-set memory is only consulted to score launcher /
/// hand-off candidates: processes inside an active session's install tree
/// (`find_best_process_in_dir`, `find_handoff_descendant`) or ones sharing
/// the session's tracked exe stem (the parent-directory tier of
/// `find_session_process`). Reading it for every process in a snapshot, as
/// the poll used to, is wasted work — and when no session is active the
/// filter is empty, so every per-process memory query is skipped.
#[derive(Debug, Default, Clone)]
pub(crate) struct MemoryScanFilter {
    /// Normalized, lowercased install-dir prefixes of active sessions.
    pub(crate) dir_prefixes: Vec<String>,
    /// Lowercased exe stems of active sessions.
    pub(crate) exe_stems: Vec<String>,
}

impl MemoryScanFilter {
    /// `true` when the process at `exe_path` is a plausible hand-off
    /// candidate for an active session, so its working set is worth reading.
    pub(crate) fn wants(&self, exe_path: &str) -> bool {
        if self.dir_prefixes.is_empty() && self.exe_stems.is_empty() {
            return false;
        }
        let lower = normalize_path_lower(exe_path);
        if self.dir_prefixes.iter().any(|prefix| lower.starts_with(prefix)) {
            return true;
        }
        if !self.exe_stems.is_empty() {
            if let Some(stem) = Path::new(exe_path).file_stem().and_then(|s| s.to_str()) {
                let stem = stem.to_lowercase();
                if self.exe_stems.iter().any(|s| *s == stem) {
                    return true;
                }
            }
        }
        false
    }
}

#[cfg(windows)]
pub(crate) fn is_ignorable_system_exe(raw_name: &[u16]) -> bool {
    let len = raw_name.iter().position(|&c| c == 0).unwrap_or(raw_name.len());
    let mut name = [0u8; 40];
    if len == 0 || len >= name.len() {
        return false;
    }
    for (i, &c) in raw_name[..len].iter().enumerate() {
        let ch = c as u32;
        if ch > 127 {
            return false;
        }
        name[i] = (ch as u8).to_ascii_lowercase();
    }
    let s = match std::str::from_utf8(&name[..len]) {
        Ok(s) => s,
        Err(_) => return false,
    };
    matches!(
        s,
        "svchost.exe"
            | "conhost.exe"
            | "runtimebroker.exe"
            | "dllhost.exe"
            | "dwm.exe"
            | "csrss.exe"
            | "smss.exe"
            | "lsass.exe"
            | "services.exe"
            | "wininit.exe"
            | "winlogon.exe"
            | "spoolsv.exe"
            | "fontdrvhost.exe"
            | "sihost.exe"
            | "taskhostw.exe"
            | "ctfmon.exe"
            | "audiodg.exe"
            | "smartscreen.exe"
            | "securityhealthservice.exe"
            | "securityhealthsystray.exe"
            | "searchhost.exe"
            | "searchindexer.exe"
            | "searchfilterhost.exe"
            | "searchprotocolhost.exe"
            | "wmiprvse.exe"
            | "backgroundtaskhost.exe"
            | "applicationframehost.exe"
            | "shellexperiencehost.exe"
            | "startmenuexperiencehost.exe"
            | "textinputhost.exe"
            | "explorer.exe"
            | "msedgewebview2.exe"
            | "gameindex.exe"
            | "tauri.exe"
            | "dashost.exe"
            | "wudfhost.exe"
            | "aggregatorhost.exe"
            | "compattelrunner.exe"
            | "sppsvc.exe"
            | "system"
            | "registry"
            | "memory compression"
    )
}

/// Query running processes natively using Toolhelp32 snapshot.
/// This is 1000x faster than WMI, handles UAC elevated processes via
/// PROCESS_QUERY_LIMITED_INFORMATION, and does not depend on COM or WMI service availability.
#[cfg(windows)]
pub(crate) fn query_running_processes(mem_scan: &MemoryScanFilter) -> Vec<ProcessInfo> {
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW, PROCESS_NAME_WIN32};
    use windows::Win32::System::ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows::Win32::Foundation::CloseHandle;
    use std::os::windows::ffi::OsStringExt;

    let mut result = Vec::with_capacity(128);

    unsafe {
        let snapshot = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            Ok(h) => h,
            Err(_) => return Vec::new(),
        };

        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let pid = entry.th32ProcessID;
                if pid != 0 {
                    if is_ignorable_system_exe(&entry.szExeFile) {
                        if Process32NextW(snapshot, &mut entry).is_err() {
                            break;
                        }
                        continue;
                    }

                    if let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
                        let mut buffer = [0u16; 1024];
                        let mut size = buffer.len() as u32;
                        if QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, windows::core::PWSTR::from_raw(buffer.as_mut_ptr()), &mut size).is_ok() {
                            let path = std::ffi::OsString::from_wide(&buffer[..size as usize])
                                .to_string_lossy()
                                .into_owned();

                            // Working-set size is only consulted to score
                            // launcher / hand-off candidates for active
                            // sessions (see `MemoryScanFilter`). Skip the
                            // extra query for the hundreds of unrelated
                            // processes each snapshot contains; at idle this
                            // skips every process.
                            let working_set = if mem_scan.wants(&path) {
                                let mut counters = PROCESS_MEMORY_COUNTERS::default();
                                if GetProcessMemoryInfo(
                                    handle,
                                    &mut counters,
                                    std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
                                ).is_ok() {
                                    counters.WorkingSetSize as u64
                                } else {
                                    0
                                }
                            } else {
                                0
                            };

                            result.push(ProcessInfo {
                                pid,
                                ppid: entry.th32ParentProcessID,
                                exe_path: path,
                                working_set_size: working_set,
                            });
                        }
                        let _ = CloseHandle(handle);
                    }
                }

                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snapshot);
    }

    result
}

#[cfg(target_os = "linux")]
pub(crate) fn query_running_processes(_mem_scan: &MemoryScanFilter) -> Vec<ProcessInfo> {
    let mut result = Vec::new();
    let procs: Vec<procfs::process::Process> = match procfs::process::all_processes() {
        Ok(iter) => iter.filter_map(|r| r.ok()).collect(),
        Err(_) => return result,
    };

    for proc in &procs {
        let pid = proc.pid as u32;
        // Wine/Proton (and wrapper chains like gamescope → gamemoderun →
        // mangohud → wine) keep the game's `.exe` in the process argv —
        // `/proc/<pid>/exe` points at the wine loader / wrapper binary
        // (`wine64-preloader`, `gamescope`, …), not the game. Resolve the
        // argv first so process matching sees the actual game executable.
        let exe_path = cmdline_game_exe(proc).unwrap_or_else(|| {
            proc.exe()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_default()
        });

        if exe_path.is_empty() {
            continue;
        }

        let stat = proc.stat().ok();
        let working_set_size = stat
            .as_ref()
            .map(|s| (s.rss as u64) * 4096)
            .unwrap_or(0);

        result.push(ProcessInfo {
            pid,
            ppid: stat.map(|s| s.ppid as u32).unwrap_or(0),
            exe_path,
            working_set_size,
        });
    }
    result
}

/// Pick the Windows executable a Wine/Proton process is running from its
/// argv, if any. Wine passes the game's `.exe` as a command-line argument
/// (the `/proc/<pid>/exe` symlink only names the wine loader), and wrapper
/// chains (gamescope, gamemoderun, mangohud, proton scripts) forward the
/// whole command line, so the game path is always in argv.
///
/// Of the argv entries ending in `.exe`, prefer one that resolves to a
/// real file on disk (relative entries are resolved against the process
/// cwd) — this skips Wine's virtual `explorer.exe` desktop host and
/// built-in tools like `winecfg.exe` that have no host file. When none
/// resolve (e.g. the prefix lives on a path we can't read), fall back to
/// the last `.exe` argument, which is the game in every supported
/// command layout (`[gamescope … --] [gamemoderun] [mangohud] runner [run]
/// [explorer.exe …] game.exe [args]`).
#[cfg(target_os = "linux")]
pub(crate) fn cmdline_game_exe(proc: &procfs::process::Process) -> Option<String> {
    let cmdline = proc.cmdline().ok()?;
    // `/proc/<pid>/cwd` is a readlink, and this runs for every process on
    // every poll. Only a RELATIVE `.exe` argument needs it, so resolve it
    // lazily rather than paying for it on all of them.
    let cwd = if has_relative_exe_arg(&cmdline) {
        proc.cwd().ok()
    } else {
        None
    };
    pick_wine_exe_arg(&cmdline, cwd.as_deref())
}

/// True when argv carries an `.exe` argument that isn't absolute - the only
/// case [`pick_wine_exe_arg`] consults the process cwd for. The cwd lookup
/// exists precisely for this, including Windows-style paths passed to Wine
/// (no POSIX root, so they read as relative).
#[cfg(target_os = "linux")]
pub(crate) fn has_relative_exe_arg(cmdline: &[String]) -> bool {
    cmdline
        .iter()
        .any(|arg| is_exe_arg(arg) && !std::path::Path::new(arg).is_absolute())
}

#[cfg(target_os = "linux")]
pub(crate) fn is_exe_arg(arg: &str) -> bool {
    arg.len() >= 4 && arg.as_bytes()[arg.len() - 4..].eq_ignore_ascii_case(b".exe")
}

/// Pure argv-scan used by [`cmdline_game_exe`]; split out so it can be
/// unit-tested without a live `/proc`.
#[cfg(target_os = "linux")]
pub(crate) fn pick_wine_exe_arg(cmdline: &[String], cwd: Option<&std::path::Path>) -> Option<String> {
    let mut last: Option<String> = None;
    let mut existing: Option<String> = None;
    for arg in cmdline {
        if !is_exe_arg(arg) {
            continue;
        }
        last = Some(arg.clone());
        let abs = if std::path::Path::new(arg).is_absolute() {
            std::path::PathBuf::from(arg)
        } else if let Some(c) = cwd {
            c.join(arg)
        } else {
            continue;
        };
        if abs.is_file() {
            // Return the cleaned absolute path (relative argv like
            // `./game.exe` is resolved against the process cwd, with `.`
            // components stripped) so exact/prefix matching against the
            // library's stored exe path works.
            let clean: std::path::PathBuf = abs.components().collect();
            existing = Some(clean.to_string_lossy().into_owned());
        }
    }
    existing.or(last)
}

#[cfg(not(any(windows, target_os = "linux")))]
pub(crate) fn query_running_processes(_mem_scan: &MemoryScanFilter) -> Vec<ProcessInfo> {
    Vec::new()
}

/// Read-only snapshot of every running process as `(pid, exe path)`, for the
/// overlay's "current game" detection (`overlay_detect`). Uses the same
/// enumeration the poll loop relies on, with no working-set scoring because
/// detection never needs to rank candidates.
pub(crate) fn snapshot_processes() -> Vec<(u32, String)> {
    query_running_processes(&MemoryScanFilter::default())
        .into_iter()
        .map(|p| (p.pid, p.exe_path))
        .collect()
}
