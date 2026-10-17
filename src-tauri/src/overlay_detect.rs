//! "Current game" detection for the in-game overlay.
//!
//! The overlay's session normally arrives from the `GameWatcher` (a
//! `game-started` event once a running process matches the passive index).
//! That leaves gaps: emulator/ROM games are deliberately excluded from the
//! passive index (one running emulator must not fan out into every ROM), and
//! a game started a moment ago may not have been polled yet, so the HUD shows
//! nothing until the next cycle.
//!
//! This module answers a single question — "is a *library* game running right
//! now?" — by snapshotting the live processes and matching them against the
//! library. It is read-only: it never records playtime or starts a session, it
//! just lets the overlay light up. Detection is Windows-only in practice
//! (process enumeration is a no-op elsewhere), but the matching logic is pure
//! and unit-tested on every platform.

use serde::{Deserialize, Serialize};

use crate::db;

/// A library game the overlay should show as the current session.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedGame {
    pub game_id: String,
    pub name: String,
    /// Process id of the detected game, for the live telemetry sampler.
    pub pid: u32,
}

/// The subset of a library game that detection needs.
#[derive(Debug, Clone, PartialEq)]
pub struct DetectTarget {
    pub id: String,
    pub name: String,
    /// The game's executable path (for a ROM game, the emulator executable).
    pub exe_path: String,
    /// ROM file handed to the emulator, when this is a scanned ROM.
    pub rom_path: Option<String>,
    /// Set when the game is a scanned ROM owned by an emulator.
    pub emulator_id: Option<String>,
}

/// Normalize a path for comparison: lowercase, forward slashes. Mirrors the
/// watcher's normalization so both agree on what "the same exe" means.
fn normalize(s: &str) -> String {
    s.trim().to_lowercase().replace('\\', "/")
}

/// Pure match for one process against one library game.
///
/// * A plain game matches when the process exe equals its exe path.
/// * A ROM game matches when the process is running the owning emulator's
///   executable **and** the command line references the ROM file.
pub fn matches_game(exe_path: &str, cmdline: Option<&str>, target: &DetectTarget) -> bool {
    let exe = normalize(exe_path);
    if exe.is_empty() || target.exe_path.is_empty() {
        return false;
    }
    if normalize(&target.exe_path) != exe {
        return false;
    }

    match target.emulator_id.as_deref() {
        // Not a ROM game: the exe match is enough.
        None => true,
        // ROM game: only when the command line carries this ROM's path.
        Some(_) => {
            let Some(rom) = target.rom_path.as_deref() else {
                return false;
            };
            let rom = normalize(rom);
            match cmdline {
                Some(cmd) if !rom.is_empty() => normalize(cmd).contains(&rom),
                _ => false,
            }
        }
    }
}

/// Best-effort match of a running process to a library game, preferring the
/// plain (non-ROM) games so a shared emulator/launcher exe can't shadow a real
/// game that also matches by path.
fn match_process<'a>(
    exe_path: &str,
    cmdline: Option<&str>,
    targets: &'a [DetectTarget],
) -> Option<&'a DetectTarget> {
    targets
        .iter()
        .filter(|t| t.emulator_id.is_none())
        .find(|t| matches_game(exe_path, cmdline, t))
        .or_else(|| targets.iter().find(|t| matches_game(exe_path, cmdline, t)))
}

/// Whether `exe_lower` lives inside the directory that holds `target`'s exe.
/// Catches launcher hand-offs where the tracked exe is a bootstrapper and the
/// process that actually runs is a sibling in the same install folder.
fn in_install_dir(exe_lower: &str, target: &DetectTarget) -> bool {
    if target.emulator_id.is_some() || target.exe_path.is_empty() {
        return false;
    }
    let normalized_target = normalize(&target.exe_path);
    let Some(dir) = normalized_target.rsplit_once('/').map(|(d, _)| d) else {
        return false;
    };
    if dir.is_empty() {
        return false;
    }
    exe_lower.len() > dir.len()
        && exe_lower.starts_with(dir)
        && exe_lower.as_bytes()[dir.len()] == b'/'
}

/// Resolve which library game is running, if any.
fn detect_running(targets: &[DetectTarget]) -> Option<DetectedGame> {
    if targets.is_empty() {
        return None;
    }
    let processes = crate::game_watcher::snapshot_processes();

    // Pass 1: exact exe match against the library. Covers ordinary games and
    // makes the ROM cmdline query below unnecessary for them.
    for (pid, exe_path) in &processes {
        if let Some(target) = match_process(exe_path, None, targets) {
            return Some(DetectedGame {
                game_id: target.id.clone(),
                name: target.name.clone(),
                pid: *pid,
            });
        }
    }

    // Pass 2: install-dir prefix match (launcher hand-off / renamed exe).
    for (pid, exe_path) in &processes {
        let exe_lower = normalize(exe_path);
        if exe_lower.is_empty() {
            continue;
        }
        if let Some(target) = targets.iter().find(|t| in_install_dir(&exe_lower, t)) {
            return Some(DetectedGame {
                game_id: target.id.clone(),
                name: target.name.clone(),
                pid: *pid,
            });
        }
    }

    // Pass 3: ROM games — the emulator exe matches, then the command line
    // confirms which ROM it booted. Only pays the WMI cost for emulator exes.
    for (pid, exe_path) in &processes {
        let candidates: Vec<&DetectTarget> = targets
            .iter()
            .filter(|t| {
                t.emulator_id.is_some()
                    && !t.exe_path.is_empty()
                    && normalize(&t.exe_path) == normalize(exe_path)
            })
            .collect();
        if candidates.is_empty() {
            continue;
        }
        let Some(cmdline) = query_command_line(*pid) else {
            continue;
        };
        if let Some(target) = candidates
            .iter()
            .find(|t| matches_game(exe_path, Some(&cmdline), t))
        {
            return Some(DetectedGame {
                game_id: target.id.clone(),
                name: target.name.clone(),
                pid: *pid,
            });
        }
    }

    None
}

/// Read a process's command line via WMI. Used only for ROM games (to tell
/// which ROM a shared emulator booted). Failing is fine — the game simply
/// isn't matched that round.
#[cfg(windows)]
fn query_command_line(pid: u32) -> Option<String> {
    use wmi::{COMLibrary, WMIConnection};

    #[derive(serde::Deserialize)]
    struct ProcessCmd {
        #[serde(rename = "CommandLine")]
        command_line: Option<String>,
    }

    let com_lib = COMLibrary::new()
        .or_else(|_| COMLibrary::without_security())
        .ok()?;
    let wmi_con = WMIConnection::new(com_lib).ok()?;
    let rows: Vec<ProcessCmd> = wmi_con
        .raw_query(&format!(
            "SELECT CommandLine FROM Win32_Process WHERE ProcessId = {pid}"
        ))
        .ok()?;
    rows.into_iter().next().and_then(|r| r.command_line)
}

#[cfg(not(windows))]
fn query_command_line(_pid: u32) -> Option<String> {
    None
}

/// Load the detection targets from the library. Reads the full game rows
/// (cheap enough for a once-per-show lookup) and keeps only what matching
/// needs.
fn load_targets(db: &db::Db) -> Result<Vec<DetectTarget>, String> {
    let rows = db::games::list_detect_targets(db)?;
    Ok(rows
        .into_iter()
        .map(|g| DetectTarget {
            id: g.id,
            name: g.name,
            exe_path: g.path,
            rom_path: g.rom_path,
            emulator_id: g.emulator_id,
        })
        .collect())
}

/// Which library game is running right now, or `None`. The overlay calls this
/// when it has no tracked session so a game started outside GameIndex (or one
/// the passive index skips) still lights up the HUD.
///
/// When no library title matches, a last pass adopts the **foreground
/// fullscreen window** as a generic view-only session (`external:<exe>`), so
/// any game — library entry or not — gets telemetry and captures while it
/// covers the screen. It still never records playtime.
#[tauri::command]
pub async fn overlay_detect_game(app: tauri::AppHandle) -> Result<Option<DetectedGame>, String> {
    use tauri::Manager;

    let db = app.state::<db::Db>().inner().clone();
    let targets = load_targets(&db)?;
    if let Some(found) = detect_running(&targets) {
        return Ok(Some(found));
    }
    Ok(detect_fullscreen_game())
}

/// Pure check: does a window `rect` cover `monitor`'s rectangle closely enough
/// to count as fullscreen? Borderless-game windows sit exactly on the monitor
/// rect, but a DPI/virtualization off-by-one is tolerated on the edges.
pub fn fullscreen_covers_monitor(rect: (i32, i32, i32, i32), monitor: (i32, i32, i32, i32)) -> bool {
    let (rl, rt_, rr, rb) = rect;
    let (ml, mt_, mr, mb) = monitor;
    let covers_x = rl <= ml && rr >= mr;
    let covers_y = rt_ <= mt_ && rb >= mb;
    // Tolerance: either exact coverage or ≥ 90 % of the monitor area.
    let area = |(l, t, r, b): (i32, i32, i32, i32)| (r - l).max(0) * (b - t).max(0);
    let window_area = area(rect);
    let monitor_area = area(monitor);
    let covered_enough = monitor_area > 0
        && window_area as f64 / monitor_area as f64 >= 0.9
        && rl <= ml
        && rt_ <= mt_;
    (covers_x && covers_y) || covered_enough
}

/// Derive a display name from an exe path: the file stem (`witcher3.exe` →
/// `Witcher3`, first letter up-cased when it was lowercase). Used for the
/// generic (non-library) session title.
pub fn exe_display_name(exe_path: &str) -> String {
    let stem = exe_path
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(exe_path)
        .trim()
        .trim_end_matches(".exe")
        .trim();
    let mut chars = stem.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

/// Adopt the foreground fullscreen window as a generic view-only session when
/// no library game matched. Windows only (the probe needs HWND APIs); other
/// platforms return `None` and the HUD simply stays off for unknown games.
#[cfg(windows)]
fn detect_fullscreen_game() -> Option<DetectedGame> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowRect, GetWindowThreadProcessId,
    };

    let self_pid = std::process::id();

    unsafe {
        let hwnd: HWND = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 || pid == self_pid {
            return None;
        }
        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_err() {
            return None;
        }
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if monitor.0.is_null() {
            return None;
        }
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if GetMonitorInfoW(monitor, &mut info).as_bool() == false {
            return None;
        }
        let m = info.rcMonitor;
        if !fullscreen_covers_monitor(
            (rect.left, rect.top, rect.right, rect.bottom),
            (m.left, m.top, m.right, m.bottom),
        ) {
            return None;
        }

        // Resolve the exe path from the process snapshot (one shared walk);
        // the pid is the only thing the HWND gives us.
        let exe = crate::game_watcher::snapshot_processes()
            .into_iter()
            .find(|(p, _)| *p == pid)
            .map(|(_, exe)| exe)?;
        if exe.is_empty() {
            return None;
        }
        let name = exe_display_name(&exe);
        if name.is_empty() {
            return None;
        }
        Some(DetectedGame {
            game_id: format!("external:{}", normalize(&exe)),
            name,
            pid,
        })
    }
}

#[cfg(not(windows))]
fn detect_fullscreen_game() -> Option<DetectedGame> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(id: &str, exe: &str) -> DetectTarget {
        DetectTarget {
            id: id.to_string(),
            name: id.to_string(),
            exe_path: exe.to_string(),
            rom_path: None,
            emulator_id: None,
        }
    }

    fn rom(id: &str, emu_exe: &str, rom_path: &str) -> DetectTarget {
        DetectTarget {
            id: id.to_string(),
            name: id.to_string(),
            exe_path: emu_exe.to_string(),
            rom_path: Some(rom_path.to_string()),
            emulator_id: Some("emu-1".to_string()),
        }
    }

    #[test]
    fn matches_plain_game_by_exe_path_case_insensitively() {
        let t = target("g1", r"C:\Games\Witcher3\bin\witcher3.exe");
        assert!(matches_game(r"c:\games\witcher3\bin\WITCHER3.EXE", None, &t));
    }

    #[test]
    fn does_not_match_a_different_exe() {
        let t = target("g1", r"C:\Games\Witcher3\witcher3.exe");
        assert!(!matches_game(r"C:\Games\Other\other.exe", None, &t));
    }

    #[test]
    fn rom_game_requires_the_rom_in_the_command_line() {
        let t = rom("rom-1", r"C:\Emu\retroarch.exe", r"C:\Roms\Metroid.nes");
        assert!(matches_game(
            r"C:\Emu\retroarch.exe",
            Some(r"retroarch.exe -L cores\nes.dll C:\Roms\Metroid.nes"),
            &t
        ));
        // Same emulator, a different ROM → no match.
        assert!(!matches_game(
            r"C:\Emu\retroarch.exe",
            Some(r"retroarch.exe C:\Roms\Zelda.nes"),
            &t
        ));
        // No command line at all → no ROM match.
        assert!(!matches_game(r"C:\Emu\retroarch.exe", None, &t));
    }

    #[test]
    fn plain_game_is_preferred_over_a_rom_sharing_the_exe() {
        let games = vec![
            rom("rom-1", r"C:\Emu\retroarch.exe", r"C:\Roms\Metroid.nes"),
            target("standalone", r"C:\Emu\retroarch.exe"),
        ];
        let matched = match_process(r"C:\Emu\retroarch.exe", None, &games).unwrap();
        assert_eq!(matched.id, "standalone");
    }

    #[test]
    fn install_dir_match_covers_a_sibling_exe() {
        let t = target("g1", r"C:\Games\Foo\Binaries\Foo.exe");
        assert!(in_install_dir(
            &normalize(r"C:\Games\Foo\Binaries\Foo-Win64-Shipping.exe"),
            &t
        ));
    }

    #[test]
    fn install_dir_match_rejects_a_sibling_folder_sharing_the_prefix() {
        let t = target("g1", r"C:\Games\Foo\Foo.exe");
        // "Foobar" shares the text prefix but is a different folder.
        assert!(!in_install_dir(&normalize(r"C:\Games\Foobar\Foobar.exe"), &t));
    }

    #[test]
    fn fullscreen_check_accepts_an_exact_borderless_window() {
        let monitor = (0, 0, 1920, 1080);
        assert!(fullscreen_covers_monitor(monitor, monitor));
        // Offset monitor (secondary display to the right).
        let sec = (1920, 0, 3840, 1080);
        assert!(fullscreen_covers_monitor(sec, sec));
    }

    #[test]
    fn fullscreen_check_rejects_a_windowed_game() {
        assert!(!fullscreen_covers_monitor(
            (100, 100, 1200, 800),
            (0, 0, 1920, 1080)
        ));
        assert!(!fullscreen_covers_monitor(
            (0, 0, 800, 600),
            (0, 0, 1920, 1080)
        ));
    }

    #[test]
    fn fullscreen_check_tolerates_a_small_edge_overshoot() {
        // DPI virtualization can leave a 1-2 px overshoot; still fullscreen.
        assert!(fullscreen_covers_monitor(
            (-2, -2, 1922, 1082),
            (0, 0, 1920, 1080)
        ));
    }

    #[test]
    fn exe_display_name_builds_a_title_from_the_stem() {
        assert_eq!(exe_display_name(r"C:\Games\Witcher3\bin\witcher3.exe"), "Witcher3");
        assert_eq!(exe_display_name("/games/eldenring/eldenring.exe"), "Eldenring");
        // Multi-word stems and already-capitalised names pass through.
        assert_eq!(exe_display_name(r"C:\X\Factorio.exe"), "Factorio");
        assert_eq!(exe_display_name(r"C:\X\Cyberpunk2077.exe"), "Cyberpunk2077");
        // Empty / junk inputs degrade to empty (caller then rejects).
        assert_eq!(exe_display_name(""), "");
        assert_eq!(exe_display_name("   "), "");
    }
}
