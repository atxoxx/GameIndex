//! Game launch / force-close / launcher-settings / script helpers.

use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Listener, Manager, WindowEvent};
use crate::db;
use crate::{discord_presence, game_watcher, metrics_collector};
use crate::game_watcher::{GameRefInput, GameWatcher};
use crate::steam::launch_options::SteamLaunchOption;

/// Force-terminate the tracked process for `game_id` and finalize the
/// session. Frontend exposes this as the "Force Close" button on the
/// Game page when a game is in the running state.
///
/// Returns a `ForceCloseResult { pid, killed }` so the frontend can
/// distinguish "we actually terminated the process" (success toast)
/// from "we cleared the session state but the underlying process
/// could not be safely killed" (warning toast) â€” the latter happens
/// when the tracked PID was recycled by the OS to an unrelated
/// process between the last poll and the click, or when the user
/// doesn't have `PROCESS_TERMINATE` rights on it.
///
/// On Windows, terminates via `TerminateProcess` after verifying the
/// PID still belongs to the session's tracked exe (PID-recycling
/// guard; see `kill_pid_if_exe_matches`). On every other target the
/// watcher doesn't track processes at all (the cross-platform
/// `query_running_processes()` returns empty on non-Windows), so
/// there is nothing to terminate â€” but we still run the full
/// session cleanup so the running indicator clears and the activity
/// session is recorded.
///
/// **Lock discipline**: this command used to acquire the watcher
/// mutex once and hold it through both the `kill_matching_processes`
/// Win32 enumeration AND a 10-second `metrics_rx.recv_timeout`,
/// freezing the background poll loop and any concurrent
/// `force_close_game` IPC (a frantic double-click) for the full
/// duration. The phases below split the work so the watcher mutex
/// is only held during two short critical sections (~sub-millisecond
/// each): gather the kill-target paths, then pluck the session out
/// of `active_sessions`. The post-exit script, the metrics
/// `recv_timeout` (now capped at 1 s — metrics are nice-to-have
/// telemetry, not a UX blocker), SQLite writes, and the
/// `game-exited` emit all run with the lock RELEASED.
#[tauri::command]
pub fn force_close_game(
    app: tauri::AppHandle,
    game_id: String,
) -> Result<game_watcher::ForceCloseResult, String> {
    let watcher: tauri::State<'_, Arc<std::sync::Mutex<GameWatcher>>> = app.state();

    // Phase 1 — read session lookup fields we need for the kill. Brief
    // critical section; everything copied out as owned data.
    let kill_data = {
        let w = watcher.lock().map_err(|e| e.to_string())?;
        match w.gather_force_close_data(&game_id) {
            Some(d) => d,
            None => return Err(format!("Game is not running: {game_id}")),
        }
    }; // <-- watcher mutex released here.

    // Phase 2 — kill matching processes WITHOUT the lock. May spawn
    // `taskkill.exe` and calls `query_running_processes()`, which opens
    // a Win32 handle on every running PID. Doing this outside the
    // mutex was the missing piece behind the "second click crash":
    // a stuck WaitForSingleObject on a system process could block the
    // lock for seconds, during which the forced-close button's click
    // handler queued a second IPC.
    #[cfg(windows)]
    let killed = game_watcher::kill_matching_processes(
        &kill_data.expected_exe_lower,
        kill_data.install_dir_lower.as_deref(),
    );
    #[cfg(not(windows))]
    let killed = false;

    // Phase 3 — compute the wall-clock finish stamp OUTSIDE the lock so the
    // session finalization below can record it. (The Discord presence
    // "stopped" event is now frontend-driven on game-exited.)
    let finished_at_ms = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    // Phase 4 — take ownership of the session AND clone the db handle
    // (`Db` is a cheap-to-clone `Arc<Pool>` bag). After this block,
    // no watcher lock is held during the slow finalization work.
    let (mut session, remaining_name, db) = {
        let mut w = watcher.lock().map_err(|e| e.to_string())?;
        match w.take_active_session(&game_id) {
            Some((s, rn)) => (s, rn, w.db_clone()),
            None => {
                // Race — the background poll loop (or a second
                // concurrent `force_close_game` IPC) already cleared
                // the session. We still emit `game-exited` here so the
                // frontend React listener drops the id from
                // `runningGameIds` and the tray status flips; without
                // this a fast double-click leaves the UI stuck on the
                // running indicator even though no process is alive.
                //
                // The natural-clear path will most likely emit its own
                // `game-exited` shortly after (the background poll's
                // emit happens AFTER its `active_sessions.remove`), which
                // is fine: React's filter is idempotent and the tray
                // listener re-reads `remainingGameName` either way. We
                // can't cheaply recover the *real* `remaining_name`
                // here without another lock step, so we send `None`
                // and let the natural emit carry the canonical value
                // when it lands. There is a small race window where the
                // tray briefly flips to "idle" before the natural emit
                // restores the correct remaining game — accepted as
                // cheaper than a second lock round-trip in this branch.
                eprintln!(
                    "[force_close_game] session {game_id} already cleared before take; killed={killed}"
                );
                let _ = app.emit(
                    "game-exited",
                    game_watcher::GameExitPayload {
                        // Use the function-arg `game_id` (the stable id used
                        // in `runningGameIds`), NOT the game's display name, so
                        // the frontend filter `event.payload.gameId` matches.
                        game_id: game_id.clone(),
                        elapsed_seconds: 0,
                        finished_at: finished_at_ms,
                        metrics: None,
                        remaining_game_name: None,
                    },
                );
                return Ok(game_watcher::ForceCloseResult {
                    pid: kill_data.pid,
                    killed,
                });
            }
        }
    }; // <-- watcher mutex released here.

    // Phase 5 — post-kill cleanup without the lock. The previous
    // implementation blocked on `metrics_rx.recv_timeout(10s)` here;
    // we cap at 1 s because metrics are nice-to-have telemetry, not a
    // UX blocker — the running indicator clears on `game-exited`,
    // which fires immediately below and the user sees within a
    // sub-second of the kill returning.
    if let Some((script, admin)) = &session.post_exit_script {
        let _ = crate::run_script_blocking(script, *admin);
    }
    let _ = session.stop_tx.send(());
    let elapsed = session.elapsed_seconds();
    let metrics = session
        .metrics_rx
        .as_mut()
        .and_then(|rx| rx.recv_timeout(std::time::Duration::from_secs(1)).unwrap_or(None));
    // Attach-anchored wall-clock stamp when available; back-dated otherwise.
    let started_at_ms = if session.attached_at_ms > 0 {
        session.attached_at_ms
    } else {
        finished_at_ms.saturating_sub(elapsed * 1000)
    };

    let metrics_json = metrics
        .as_ref()
        .and_then(|m| serde_json::to_string(m).ok());
    let (avg_fps, avg_cpu, avg_gpu, avg_ram) = match metrics.as_ref() {
        Some(m) => (
            Some(m.avg_fps as f32),
            Some(m.avg_cpu_usage as f32),
            Some(m.avg_gpu_usage as f32),
            Some(m.avg_ram_usage as f32),
        ),
        None => (None, None, None, None),
    };
    // Skip the DB row for a pending session that never attached a real
    // process (matches the natural-exit path's guard).
    if session.last_pid != 0 {
        if let Err(e) = db::sessions::finalize(
            &db,
            &game_id,
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
            eprintln!("[force_close_game] failed to record session for {game_id}: {e}");
        }
    }
    if let Err(e) = db::games::update_last_played(&db, &game_id, finished_at_ms) {
        eprintln!("[force_close_game] failed to update last_played for {game_id}: {e}");
    }

    let _ = app.emit(
        "game-exited",
        game_watcher::GameExitPayload {
            game_id: session.game_id.clone(),
            elapsed_seconds: elapsed,
            finished_at: finished_at_ms,
            metrics,
            remaining_game_name: remaining_name,
        },
    );

    Ok(game_watcher::ForceCloseResult {
        pid: kill_data.pid,
        killed,
    })
}

/// Windows error code ERROR_ELEVATION_REQUIRED (740). Returned when a
/// process needs to be launched with administrator privileges.
#[cfg(windows)]
const ERROR_ELEVATION_REQUIRED: i32 = 740;

/// Launch an executable with elevated privileges using the Windows
/// `runas` verb. Returns the PID of the newly created process so the
/// GameWatcher can track it. Returns `Ok(None)` when the process was
/// launched but no process handle could be obtained; the watcher will
/// fall back to passive detection.
///
/// This triggers a UAC prompt. If the user cancels, an error is returned.
#[cfg(windows)]
fn launch_elevated(path: &std::path::Path, cwd: &std::path::Path, args: Option<&str>) -> Result<Option<u32>, String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;
    use windows::Win32::Foundation::{CloseHandle, HWND, ERROR_CANCELLED};
    use windows::core::PCWSTR;
    use windows::Win32::System::Threading::GetProcessId;
    use windows::Win32::UI::Shell::{ShellExecuteExW, SHELLEXECUTEINFOW, SEE_MASK_NOCLOSEPROCESS};
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let file_wide: Vec<u16> = OsStr::new(path)
        .encode_wide()
        .chain(Some(0))
        .collect();
    let cwd_wide: Vec<u16> = OsStr::new(cwd)
        .encode_wide()
        .chain(Some(0))
        .collect();
    let runas_verb: Vec<u16> = OsStr::new("runas")
        .encode_wide()
        .chain(Some(0))
        .collect();
    let args_wide: Option<Vec<u16>> = args.map(|s| {
        OsStr::new(s)
            .encode_wide()
            .chain(Some(0))
            .collect()
    });

    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        hwnd: HWND(ptr::null_mut()),
        lpVerb: PCWSTR::from_raw(runas_verb.as_ptr()),
        lpFile: PCWSTR::from_raw(file_wide.as_ptr()),
        lpParameters: args_wide.as_ref()
            .map(|v| PCWSTR::from_raw(v.as_ptr()))
            .unwrap_or(PCWSTR::null()),
        lpDirectory: PCWSTR::from_raw(cwd_wide.as_ptr()),
        nShow: SW_SHOWNORMAL.0,
        ..Default::default()
    };

    unsafe {
        ShellExecuteExW(&mut info).map_err(|e| {
            // ERROR_CANCELLED (1223) is returned when the user declines the UAC prompt.
            // ShellExecuteExW surfaces it as an HRESULT, so extract the Win32 code.
            let win32_code = (e.code().0 as u32) & 0xFFFF;
            if win32_code == ERROR_CANCELLED.0 {
                format!("Failed to launch game with elevation: The operation was cancelled by the user")
            } else {
                format!("Failed to launch game with elevation: {}", e)
            }
        })?;
    }

    // hProcess may be null if ShellExecuteEx could not obtain a handle.
    // The game may still have launched, so return None to let the watcher
    // detect it passively instead of failing outright.
    if info.hProcess.is_invalid() || info.hProcess.0.is_null() {
        eprintln!("[launch_elevated] no process handle returned; falling back to passive detection");
        return Ok(None);
    }

    let pid = unsafe { GetProcessId(info.hProcess) };

    // Close the handle we received; the process keeps running.
    unsafe {
        let _ = CloseHandle(info.hProcess);
    }

    if pid == 0 {
        return Ok(None);
    }

    Ok(Some(pid))
}

// === Launcher settings (L2/L3/L5) ============================================
//
// State that needs to be read on the hot path (every launch, every
// window-close event) is held in an Arc<Mutex<â€¦>> managed through
// `tauri::State`. Reads are O(1) and take the std sync lock briefly;
// writes go through the kv_store so the values survive restarts. Each
// setter command keeps the in-memory copy and the on-disk copy in sync.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LauncherSettings {
    /// L2: When the user clicks the close button, hide the window
    /// instead of quitting the app. The user reopens via the OS
    /// tray/dock icon.
    pub(crate) close_to_tray_enabled: bool,
    /// L3: When the user clicks Play, the main window hides itself so
    /// the game gets full-screen focus without a competing GameIndex
    /// window in the taskbar.
    pub(crate) minimize_on_launch_enabled: bool,
    /// L6: When the last running game exits, restore the main window
    /// (show + unminimize) if it was hidden by minimize-on-launch.
    pub(crate) restore_on_exit_enabled: bool,
    /// L5: When true, the launch path REFUSES to silently retry with
    /// ShellExecuteExW(runas) on ERROR_ELEVATION_REQUIRED. The launch
    /// just fails with a clear error message â€” for users who don't
    /// want surprise UAC prompts mid-session.
    pub(crate) disable_elevation_prompts: bool,
}

impl Default for LauncherSettings {
    fn default() -> Self {
        Self {
            close_to_tray_enabled: false,
            minimize_on_launch_enabled: false,
            restore_on_exit_enabled: false,
            disable_elevation_prompts: false,
        }
    }
}

/// Read the persisted launcher settings on startup so the in-memory
/// mirror matches the kv_store. Each missing key falls back to the
/// struct default â€” a fresh install lands in a fully-default state.
pub(crate) fn load_launcher_settings(db: &db::Db) -> LauncherSettings {
    let get = |key: &str| db::kv::get(db, key).ok().flatten();
    LauncherSettings {
        close_to_tray_enabled: get(KV_CLOSE_TO_TRAY)
            .map(|v| v == "true")
            .unwrap_or(false),
        minimize_on_launch_enabled: get(KV_MINIMIZE_ON_LAUNCH)
            .map(|v| v == "true")
            .unwrap_or(false),
        restore_on_exit_enabled: get(KV_RESTORE_ON_EXIT)
            .map(|v| v == "true")
            .unwrap_or(false),
        disable_elevation_prompts: get(KV_DISABLE_ELEVATION_PROMPTS)
            .map(|v| v == "true")
            .unwrap_or(false),
    }
}

const KV_CLOSE_TO_TRAY: &str = "launcher.close_to_tray_enabled";

const KV_MINIMIZE_ON_LAUNCH: &str = "launcher.minimize_on_launch_enabled";

const KV_RESTORE_ON_EXIT: &str = "launcher.restore_on_exit_enabled";

const KV_DISABLE_ELEVATION_PROMPTS: &str = "launcher.disable_elevation_prompts";

/// L6: `true` while the main window is hidden by the minimize-on-launch
/// behavior. Set in `launch_game` when the hide succeeds; cleared by the
/// restore-on-last-exit listener after it re-shows the window. A plain
/// atomic keeps this readable from the `game-exited` listener without any
/// mutex — the watcher mutex is held during that synchronous emit, so
/// re-locking it (or any state behind it) would deadlock.
pub(crate) static WINDOW_HIDDEN_ON_LAUNCH: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// L2: Get the current launcher settings. Read-only IPC; the frontend
/// hydrates its UI forms from this on mount.
#[tauri::command]
pub fn get_launcher_settings(state: tauri::State<'_, Arc<std::sync::Mutex<LauncherSettings>>>) -> LauncherSettings {
    state.lock().map(|s| s.clone()).unwrap_or_default()
}

/// L2: Toggle close-to-tray at runtime. Updates both the in-memory
/// state (so the CloseRequested handler picks up the new value without
/// needing a restart) and the kv_store (so it survives restarts).
#[tauri::command]
pub fn set_close_to_tray_enabled(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<std::sync::Mutex<LauncherSettings>>>,
    enabled: bool,
) -> Result<(), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::kv::set(db_state.inner(), KV_CLOSE_TO_TRAY, if_enabled(enabled))?;
    state.lock().map(|mut s| s.close_to_tray_enabled = enabled).map_err(|e| e.to_string())?;
    Ok(())
}

/// L3: Toggle minimize-on-launch. Affects the next `launch_game`.
#[tauri::command]
pub fn set_minimize_on_launch_enabled(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<std::sync::Mutex<LauncherSettings>>>,
    enabled: bool,
) -> Result<(), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::kv::set(db_state.inner(), KV_MINIMIZE_ON_LAUNCH, if_enabled(enabled))?;
    state.lock().map(|mut s| s.minimize_on_launch_enabled = enabled).map_err(|e| e.to_string())?;
    Ok(())
}

/// L6: Toggle restore-window-on-last-exit. When enabled, the main
/// window is shown + unminimized once the last running game exits
/// (provided minimize-on-launch hid it in the first place).
#[tauri::command]
pub fn set_restore_on_exit_enabled(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<std::sync::Mutex<LauncherSettings>>>,
    enabled: bool,
) -> Result<(), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::kv::set(db_state.inner(), KV_RESTORE_ON_EXIT, if_enabled(enabled))?;
    state.lock().map(|mut s| s.restore_on_exit_enabled = enabled).map_err(|e| e.to_string())?;
    Ok(())
}

/// L5: Toggle whether strictly-forbidding UAC elevation prompts are
/// allowed during launch. When true,ERROR_ELEVATION_REQUIRED is
/// returned as a clear user-facing error rather than a surprise UAC.
#[tauri::command]
pub fn set_disable_elevation_prompts(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<std::sync::Mutex<LauncherSettings>>>,
    enabled: bool,
) -> Result<(), String> {
    let db_state: tauri::State<'_, db::Db> = app.state();
    db::kv::set(db_state.inner(), KV_DISABLE_ELEVATION_PROMPTS, if_enabled(enabled))?;
    state.lock().map(|mut s| s.disable_elevation_prompts = enabled).map_err(|e| e.to_string())?;
    Ok(())
}

fn if_enabled(b: bool) -> &'static str {
    if b {
        "true"
    } else {
        "false"
    }
}

/// Enable or disable Discord Rich Presence.
///
/// When enabled, lazily spawns the IPC connection thread (if it isn't
/// already running) so subsequent `discord-presence-update` events from
/// `launch_game` / `force_close_game` start driving the presence. When
/// disabled, flips the flag off and clears any active presence so the
/// status line goes back to idle immediately.
#[tauri::command]
pub fn set_discord_presence_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let state: tauri::State<'_, discord_presence::DiscordPresenceState> = app.state();
    if enabled {
        state.ensure_started(&app);
        state.set_enabled(true);
    } else {
        state.set_enabled(false);
        state.clear();
    }
    Ok(())
}

/// L4: Toggle the OS-level auto-launch on boot. Wraps the
/// tauri-plugin-autostart calls â€” enabling registers the binary,
/// disabling unregisters it. Errors from the OS layer are surfaced
/// verbatim so the UI can show "permission denied" vs "already
/// registered" cleanly.
#[tauri::command]
pub fn set_autostart_enabled(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|e| format!("autostart enable: {e}"))?;
    } else {
        manager.disable().map_err(|e| format!("autostart disable: {e}"))?;
    }
    Ok(())
}

/// L4: Probe the OS-level autostart registration state. Mirrors the
/// setting the OS reports (not the user's preference) so the toggle
/// can show what's *actually* registered after a system reset that
/// cleared the registry entry.
#[tauri::command]
pub fn is_autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(|e| format!("autostart status: {e}"))
}

/// An additional executable launched alongside the main game.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionApp {
    pub(crate) path: String,
    pub(crate) arguments: Option<String>,
    pub(crate) delay_ms: u64,
    pub(crate) run_as_admin: Option<bool>,
}

/// Run a script file to completion (blocking). Used for pre-launch and
/// post-exit scripts. Admin scripts are elevated via PowerShell's
/// `Start-Process -Verb RunAs -Wait` so we still wait for completion.
#[cfg(windows)]
pub(crate) fn run_script_blocking(script: &str, admin: bool) -> Result<(), String> {
    if admin {
        let escaped = script.replace('\'', "''");
        let ps = format!(
            "Start-Process -FilePath '{}' -Verb RunAs -Wait -WindowStyle Hidden",
            escaped
        );
        let status = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &ps])
            .status()
            .map_err(|e| format!("Failed to run elevated script {}: {}", script, e))?;
        if !status.success() {
            return Err(format!(
                "Elevated script {} exited with status {}",
                script,
                status
                    .code()
                    .map(|c| c.to_string())
                    .unwrap_or_else(|| "?".to_string())
            ));
        }
        return Ok(());
    }
    run_script_direct(script)
}

#[cfg(windows)]
fn run_script_direct(script: &str) -> Result<(), String> {
    let lower = script.to_lowercase();
    let mut cmd = if lower.ends_with(".ps1") {
        let mut c = std::process::Command::new("powershell");
        c.args(["-NoProfile", "-File", script]);
        c
    } else {
        std::process::Command::new(script)
    };
    let status = cmd
        .status()
        .map_err(|e| format!("Failed to run script {}: {}", script, e))?;
    if !status.success() {
        return Err(format!(
            "Script {} exited with status {}",
            script,
            status
                .code()
                .map(|c| c.to_string())
                .unwrap_or_else(|| "?".to_string())
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
pub(crate) fn run_script_blocking(script: &str, _admin: bool) -> Result<(), String> {
    let status = std::process::Command::new(script)
        .status()
        .map_err(|e| format!("Failed to run script {}: {}", script, e))?;
    if !status.success() {
        return Err(format!(
            "Script {} exited with status {}",
            script,
            status
                .code()
                .map(|c| c.to_string())
                .unwrap_or_else(|| "?".to_string())
        ));
    }
    Ok(())
}

/// Launch a companion executable in the background after a delay.
/// Fire-and-forget: not tracked by the game watcher.
fn spawn_companion(app: CompanionApp) {
    std::thread::spawn(move || {
        if app.delay_ms > 0 {
            std::thread::sleep(std::time::Duration::from_millis(app.delay_ms));
        }
        #[cfg(windows)]
        {
            if app.run_as_admin.unwrap_or(false) {
                let escaped = app.path.replace('\'', "''");
                let mut ps = format!(
                    "Start-Process -FilePath '{}' -Verb RunAs -WindowStyle Hidden",
                    escaped
                );
                if let Some(args) = &app.arguments {
                    if !args.trim().is_empty() {
                        ps.push_str(&format!(" -ArgumentList '{}'", args.replace('\'', "''")));
                    }
                }
                let _ = std::process::Command::new("powershell")
                    .args(["-NoProfile", "-Command", &ps])
                    .spawn();
                return;
            }
        }
        let mut cmd = std::process::Command::new(&app.path);
        if let Some(args) = &app.arguments {
            if !args.trim().is_empty() {
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    cmd.raw_arg(args);
                }
                #[cfg(not(windows))]
                {
                    cmd.args(args.split_whitespace());
                }
            }
        }
        let _ = cmd.spawn();
    });
}

/// Launch a game executable with unified process tracking.
///
/// Replaces the old split between `launch_game` (local, child.wait()),
/// `spawn_game_exe` (Steam fire-and-forget), and `watch_steam_game`
/// (Steam WMI polling). Now all platforms use the same GameWatcher
/// poll loop for process lifecycle detection.
///
/// **Steam games with known exe path**: spawns the exe directly,
/// registers with the watcher for WMI-based tracking.
///
/// **Steam games without exe path**: opens `steam://run/<appid>` via
/// the opener plugin, registers a pending session that the watcher
/// activates when a matching process appears.
///
/// **Local games**: spawns the exe directly, registers with the watcher.
///
/// **Elevation**: On Windows, if the executable requires administrator
/// privileges (ERROR_ELEVATION_REQUIRED), the launch is retried with a
/// UAC elevation prompt.
///
/// The watcher's background poll loop handles all session lifecycle:
/// process detection â†’ metrics collection â†’ exit detection â†’ game-exited event.
/// Progress checkpoints emitted while a game is launching so the
/// frontend splash can show honest step-by-step feedback instead of a
/// fixed animation timer. `step` is one of resolvingPaths / startingGame /
/// loadingAssets / launching.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LaunchProgressPayload {
    game_id: String,
    step: String,
}

fn emit_launch_progress(app: &tauri::AppHandle, game_id: &str, step: &str) {
    let _ = app.emit(
        "launch-progress",
        LaunchProgressPayload {
            game_id: game_id.to_string(),
            step: step.to_string(),
        },
    );
}

#[tauri::command]
pub fn launch_game(
    app: tauri::AppHandle,
    game_id: String,
    game_name: String,
    game_path: String,
    platform: String,
    steam_app_id: Option<u32>,
    gpu_id: Option<String>,
    gpu_name: Option<String>,
    launch_arguments: Option<String>,
    run_as_admin: Option<bool>,
    pre_launch_script: Option<String>,
    pre_launch_admin: Option<bool>,
    post_exit_script: Option<String>,
    post_exit_admin: Option<bool>,
    companion_apps: Option<Vec<CompanionApp>>,
    show_steam_launch_selection: Option<bool>,
) -> Result<String, String> {
    let watcher: tauri::State<'_, Arc<std::sync::Mutex<GameWatcher>>> = app.state();
    let launcher: tauri::State<'_, Arc<std::sync::Mutex<LauncherSettings>>> = app.state();

    let launcher_settings = launcher
        .lock()
        .map(|s| s.clone())
        .unwrap_or_default();

    emit_launch_progress(&app, &game_id, "resolvingPaths");

    if launcher_settings.disable_elevation_prompts
        && run_as_admin.unwrap_or(false)
    {
        return Err(
            "Launch with admin elevation is blocked by Settings â†’ Disable UAC elevation prompts. Enable the setting or unset \"Run as administrator\" on the game to launch."
                .to_string(),
        );
    }

    // ── Pre-launch script (synchronous, blocking) ──
    // Runs before any window-hide / process spawn so a failure aborts the
    // launch cleanly without leaving the main window hidden.
    if let Some(script) = pre_launch_script.as_deref() {
        if !script.trim().is_empty() {
            if launcher_settings.disable_elevation_prompts && pre_launch_admin.unwrap_or(false) {
                return Err(
                    "Pre-launch script requires admin elevation but Settings → Disable UAC elevation prompts is on."
                        .to_string(),
                );
            }
            emit_launch_progress(&app, &game_id, "preLaunchScript");
            run_script_blocking(script, pre_launch_admin.unwrap_or(false))?;
        }
    }

    // Update GPU info on the watcher for metrics collection
    {
        let mut w = watcher.lock().map_err(|e| e.to_string())?;
        w.set_gpu(gpu_id.clone(), gpu_name.clone());
    }

    // L3: Hide the main window when minimize-on-launch is on, BEFORE
    // spawning the game process, so the OS doesn't briefly flash both
    // windows during the launch transition. Failure to hide isn't fatal
    // â€” the launch proceeds anyway.
    if launcher_settings.minimize_on_launch_enabled {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.hide();
            // L6: remember that we hid the window so the
            // restore-on-last-exit listener knows it may restore it.
            WINDOW_HIDDEN_ON_LAUNCH.store(true, std::sync::atomic::Ordering::Relaxed);
        }
    }

    let mut initial_pid: u32 = 0;
    let exe_path: Option<String>;

    // â”€â”€ Determine launch strategy â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if platform == "Steam" && show_steam_launch_selection.unwrap_or(false) {
        // Steam game with the launch-picker option enabled — go through
        // `steam://launch/<appid>/dialog` so Steam shows its
        // choose-executable/action window (games with a single launch
        // action still launch directly).
        let sid = steam_app_id.ok_or("Steam games require a steamAppId")?;
        let url = crate::steam::launch_options::steam_launch_url(sid, true);
        tauri_plugin_opener::open_url(url, None::<&str>)
            .map_err(|e| format!("Failed to open Steam URL: {}", e))?;

        // No PID â€" the watcher will detect the process when it appears
        initial_pid = 0;
        // Carry the sync-resolved exe so the watcher's Tier-3 stem
        // attach and the exe-based install_dir fallback still work while
        // Steam owns the process. On attach `matched_exe` is overwritten
        // with the real process path before any liveness check.
        exe_path = if game_path.is_empty() { None } else { Some(game_path.clone()) };
    } else if platform == "Steam" && (game_path.is_empty() || !Path::new(&game_path).exists()) {
        // Steam game without local exe â€" use steam:// protocol
        let sid = steam_app_id.ok_or("Steam games require a steamAppId")?;
        let url = format!("steam://run/{}", sid);
        tauri_plugin_opener::open_url(url, None::<&str>)
            .map_err(|e| format!("Failed to open Steam URL: {}", e))?;

        // No PID â€" the watcher will detect the process when it appears
        initial_pid = 0;
        // Carry the sync-resolved exe so the watcher's Tier-3 stem
        // attach and the exe-based install_dir fallback still work while
        // Steam owns the process. On attach `matched_exe` is overwritten
        // with the real process path before any liveness check.
        exe_path = if game_path.is_empty() { None } else { Some(game_path.clone()) };
    } else if platform == "Ubisoft" && game_path.is_empty() {
        // Ubisoft Connect game without a local exe path -- launch via
        // the `uplay://launch/<id>` protocol. Mirrors Playnite's
        // `UplayPlayController.Play`. The watcher detects the child
        // process when UbisoftConnect.exe hands off to the game.
        let sid = game_id
            .strip_prefix("uplay-")
            .ok_or("Ubisoft games require a uplay-<id> game id")?;
        let url = format!("uplay://launch/{}", sid);
        tauri_plugin_opener::open_url(url, None::<&str>)
            .map_err(|e| format!("Failed to open Ubisoft URL: {}", e))?;
        initial_pid = 0;
        exe_path = None;
    } else {
        // Known exe path: spawn directly
        let path = Path::new(&game_path);
        if !path.exists() {
            return Err(format!("Game executable not found: {}", game_path));
        }
        let cwd = path.parent().unwrap_or_else(|| Path::new("."));

        // Check if we need to force run as admin
        let child = if run_as_admin.unwrap_or(false) {
            #[cfg(windows)]
            {
                emit_launch_progress(&app, &game_id, "elevating");
                initial_pid = launch_elevated(path, cwd, launch_arguments.as_deref())?.unwrap_or(0);
                None
            }
            #[cfg(not(windows))]
            {
                return Err("Running as administrator is only supported on Windows".to_string());
            }
        } else {
            let mut cmd = std::process::Command::new(path);
            cmd.current_dir(cwd);

            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                if let Some(args) = launch_arguments.as_deref() {
                    if !args.trim().is_empty() {
                        cmd.raw_arg(args);
                    }
                }
            }
            #[cfg(not(windows))]
            {
                if let Some(args) = launch_arguments.as_deref() {
                    if !args.trim().is_empty() {
                        cmd.args(args.split_whitespace());
                    }
                }
            }

            let spawn_res = cmd.spawn();
            match spawn_res {
                Ok(child) => Some(child),
                Err(e) => {
                    #[cfg(windows)]
                    {
                        // L5: Respect the user's no-UAC choice on the
                        // implicit retry path too. ERROR_ELEVATION_REQUIRED
                        // is exactly the kind of "surprise UAC mid-session"
                        // that the toggle is meant to suppress.
                        if e.raw_os_error() == Some(ERROR_ELEVATION_REQUIRED) {
                            if launcher_settings.disable_elevation_prompts {
                                return Err(
                                    "Game requires administrator privileges and Settings â†’ Disable UAC elevation prompts is on. Enable the setting or unset \"Run as administrator\" on the game to launch."
                                        .to_string(),
                                );
                            }
                            emit_launch_progress(&app, &game_id, "elevating");
                            initial_pid = launch_elevated(path, cwd, launch_arguments.as_deref())?.unwrap_or(0);
                            None
                        } else {
                            return Err(format!("Failed to launch game: {}", e));
                        }
                    }
                    #[cfg(not(windows))]
                    {
                        return Err(format!("Failed to launch game: {}", e));
                    }
                }
            }
        };

        if let Some(child) = child.as_ref() {
            initial_pid = child.id();
        }
        exe_path = Some(game_path.clone());
        // std::process::Child does not kill on drop, so we can safely
        // discard the handle â€” the watcher's WMI poll will track the
        // real process lifecycle.
    }

    // â”€â”€ Register with watcher â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Lock the watcher once here (std::sync::Mutex is not reentrant) so the
    // same guard can both supply the live telemetry config and register the
    // launched session below without a double-lock deadlock.
    emit_launch_progress(&app, &game_id, "startingGame");

    let mut w = watcher.lock().map_err(|e| e.to_string())?;

    // Start metrics collection immediately if we have a valid PID.
    // The stop_tx and metrics_rx are stored in the session so the
    // watcher's finish_session can stop collection and read results.
    let (metrics_stop_tx, metrics_rx) = if initial_pid > 0 {
        let (tx, rx) = metrics_collector::start_metrics_collection(
            w.metrics_config().clone(), initial_pid, gpu_id.clone(), gpu_name.clone(),
        );
        (tx, rx)
    } else {
        // No PID yet (Steam protocol launch) — create dummy channels.
        // Sends will fail silently in finish_session — acceptable
        // because metrics were never started for this session.
        let (dummy_stop_tx, _) = std::sync::mpsc::channel::<()>();
        let (_, dummy_metrics_rx) = std::sync::mpsc::channel::<Option<metrics_collector::SessionMetrics>>();
        (dummy_stop_tx, dummy_metrics_rx)
    };

    {
        let post_exit = post_exit_script
            .filter(|s| !s.trim().is_empty())
            .map(|s| (s, post_exit_admin.unwrap_or(false)));
        w.register_launched_session(
            &app,
            &game_id,
            &game_name,
            &platform,
            steam_app_id,
            exe_path.as_deref(),
            initial_pid,
            metrics_stop_tx,
            metrics_rx,
            post_exit,
        );
    }

    emit_launch_progress(&app, &game_id, "loadingAssets");

    // ── Companion apps (delayed, fire-and-forget) ──
    // Launched after the main game so a server/overlay can start in the
    // background on its own timer. Not tracked by the watcher.
    let has_companion_apps = companion_apps
        .as_ref()
        .is_some_and(|apps| apps.iter().any(|a| !a.path.trim().is_empty()));
    if has_companion_apps {
        emit_launch_progress(&app, &game_id, "companionApps");
    }
    if let Some(apps) = companion_apps.as_ref() {
        for app in apps.iter() {
            if !app.path.trim().is_empty() {
                spawn_companion(app.clone());
            }
        }
    }

    emit_launch_progress(&app, &game_id, "launching");

    let msg = if platform == "Steam" && show_steam_launch_selection.unwrap_or(false) {
        format!("Launched {} via Steam (launch picker)", game_name)
    } else if platform == "Steam" && initial_pid == 0 {
        format!("Launched {} via Steam (tracking via process watcher)", game_name)
    } else {
        format!("Launched: {}", game_path)
    };
    Ok(msg)
}

/// Best-effort list of the launch actions a Steam game exposes, read
/// from the local install's `appcache/appinfo.vdf`. Returns an empty
/// vec when Steam / the cache / the app's entry is missing — never an
/// error. Lets the edit modal hint whether the launch-picker option is
/// worth enabling.
#[tauri::command]
pub fn steam_launch_options(steam_app_id: u32) -> Vec<SteamLaunchOption> {
    crate::steam::launch_options::steam_launch_options(steam_app_id)
}

/// Rebuild the game watcher's process index from the current library.
/// Called by the frontend after loading games and after Steam/Epic syncs.
/// This enables passive detection â€” the background poll loop can match
/// running processes to known games even when launched outside GameIndex.
#[tauri::command]
pub fn rebuild_watcher_index(
    app: tauri::AppHandle,
    games: Vec<GameRefInput>,
) -> Result<(), String> {
    let watcher: tauri::State<'_, Arc<std::sync::Mutex<GameWatcher>>> = app.state();
    let refs = game_watcher::build_game_refs_from_library(&games);
    let mut w = watcher.lock().map_err(|e| e.to_string())?;
    w.rebuild_index(refs);
    Ok(())
}



