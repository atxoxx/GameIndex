//! Crash diagnostics.
//!
//! Release builds ship with `strip = true` and `panic = "unwind"`. A Rust
//! panic unwinding to the top of the main thread aborts the process, and a
//! native fast-fail (Control Flow Guard violation, stack buffer overrun —
//! `0xc0000409` / STATUS_STACK_BUFFER_OVERRUN in the Windows event log)
//! leaves nothing but a bare fault offset. This module makes every fatal
//! exit path explain itself:
//!
//! 1. A panic hook (all platforms) that writes the message + backtrace,
//!    the machine/version context, and the recent breadcrumb trail.
//! 2. A Windows vectored exception handler that logs native fatal
//!    exceptions a panic hook can't see — exception code, faulting module,
//!    raw call stack, plus the same context + breadcrumbs.
//! 3. Frontend error capture: `crashlog_record` is called by the webview's
//!    `window.onerror` / unhandled-rejection / React error-boundary hooks,
//!    so a JS bug is persisted instead of vanishing into a console release
//!    builds strip.
//!
//! Every crash is written twice:
//!
//! - appended to the rolling `<app_data_dir>/crash.log` (fast to read,
//!   bounded, what the Downloads diagnostics + Diagnostics tab preview),
//! - and to a standalone dated report `<app_data_dir>/crash-<date>.txt`
//!   that is trivially attached to a bug report.
//!
//! The log directory is registered from `.setup` once the real
//! `app_data_dir` is known; until then a hand-rolled `data_dir/<identifier>`
//! fallback is used so a crash during the earliest startup still lands on
//! disk.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Instant, UNIX_EPOCH};

use serde::Serialize;

const IDENTIFIER: &str = "com.gameindex.app";
const CRASH_LOG_NAME: &str = "crash.log";
const ROTATED_LOG_NAME: &str = "crash.log.old";
const REPORT_PREFIX: &str = "crash-";
const REPORT_EXT: &str = ".txt";
const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;
const MAX_REPORTS: usize = 50;
const MAX_BREADCRUMBS: usize = 64;
const RULE: &str = "─";
const RULE_LEN: usize = 80;

static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();
static START: OnceLock<Instant> = OnceLock::new();
static LOG_LOCK: Mutex<()> = Mutex::new(());
static CONTEXT: Mutex<AppContext> = Mutex::new(AppContext {
    version: String::new(),
    os: String::new(),
    arch: String::new(),
    locale: String::new(),
    profile: String::new(),
    data_dir: String::new(),
    cpu: None,
    ram_gb: None,
    gpus: Vec::new(),
});
static BREADCRUMBS: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Snapshot of the running machine, gathered once and attached to every
/// crash entry. Hardware fields stay empty until the frontend (or
/// `system::get_system_info`) probes them; that costs a WMI call we don't
/// want on the boot path.
#[derive(Clone)]
struct AppContext {
    version: String,
    os: String,
    arch: String,
    locale: String,
    profile: String,
    data_dir: String,
    cpu: Option<String>,
    ram_gb: Option<u32>,
    gpus: Vec<String>,
}

/// Serializable metadata for one dated crash report on disk.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashReportInfo {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub modified_at: u64,
}

/// Serializable summary of the crash-log directory, returned by
/// `crashlog_status` and rendered by the Settings → Diagnostics tab.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashLogStatus {
    pub dir: String,
    pub log_path: String,
    pub log_size_bytes: u64,
    pub log_modified_at: u64,
    pub has_log: bool,
    pub reports: Vec<CrashReportInfo>,
}

#[cfg(target_os = "windows")]
use windows::Win32::System::Diagnostics::Debug::{
    RtlCaptureStackBackTrace, EXCEPTION_POINTERS,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::GetCurrentThreadId;

/// Register the real app-data directory (from `.setup`) so crash logs land
/// next to the database.
pub fn set_log_dir(dir: PathBuf) {
    if let Ok(mut ctx) = CONTEXT.lock() {
        ctx.data_dir = dir.to_string_lossy().into_owned();
    }
    let _ = LOG_DIR.set(dir);
}

/// Record the app version + build profile. Called from `.setup`, where
/// `AppHandle::package_info()` is available.
pub fn set_app_context(version: &str) {
    if let Ok(mut ctx) = CONTEXT.lock() {
        ctx.version = version.to_string();
        ctx.profile = if cfg!(debug_assertions) {
            "debug".to_string()
        } else {
            "release".to_string()
        };
    }
}

/// Attach the CPU/RAM/GPU summary once it has been detected. Cheap and
/// idempotent — called from `system::get_system_info` after its WMI probe.
pub fn set_hardware_context(cpu: &str, ram_gb: u32, gpus: &[crate::gpu_detector::GpuInfo]) {
    if let Ok(mut ctx) = CONTEXT.lock() {
        ctx.cpu = Some(cpu.to_string());
        ctx.ram_gb = Some(ram_gb);
        ctx.gpus = gpus
            .iter()
            .map(|g| {
                if g.vram_mb >= 1024 {
                    format!("{} ({} GB)", g.name, g.vram_mb / 1024)
                } else {
                    format!("{} ({} MB)", g.name, g.vram_mb)
                }
            })
            .collect();
    }
}

/// Install the panic hook and (on Windows) the fatal-exception handler.
/// Call once, at the top of `run()`.
pub fn init() {
    let _ = START.set(Instant::now());
    {
        let mut ctx = CONTEXT.lock().unwrap_or_else(|p| p.into_inner());
        ctx.os = os_description();
        ctx.arch = std::env::consts::ARCH.to_string();
        ctx.locale = locale();
        ctx.profile = if cfg!(debug_assertions) {
            "debug".to_string()
        } else {
            "release".to_string()
        };
    }

    // Backtraces in panic output only materialize when the env var is set
    // (the default hook checks it), and release builds ship it unset.
    if std::env::var_os("RUST_BACKTRACE").is_none() {
        std::env::set_var("RUST_BACKTRACE", "1");
    }

    std::panic::set_hook(Box::new(|info| {
        // A panic inside the hook would abort the process, so keep the whole
        // body panic-guarded and prefer losing detail over losing the log.
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            eprintln!("[gameindex] panic: {info}");
            let location = info
                .location()
                .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
                .unwrap_or_else(|| "<unknown>".to_string());
            let thread = std::thread::current();
            let thread_name = thread.name().unwrap_or("<unnamed>").to_string();
            let backtrace = std::backtrace::Backtrace::force_capture();
            write_crash_log(
                "panic",
                &format!(
                    "message: {info}\nlocation: {location}\nthread: {thread_name}\nbacktrace:\n{backtrace}",
                ),
                true,
            );
        }));
    }));

    #[cfg(target_os = "windows")]
    install_vectored_handler();
}

/// Human-readable text for a `catch_unwind` payload, used by the guarded
/// tray/engine init paths in `lib.rs`.
pub fn panic_message(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "unknown panic payload".to_string()
    }
}

/// Append a lightweight, timestamped "we were here" marker to the in-memory
/// breadcrumb ring. The ring is dumped into every crash report, so a fatal
/// exit explains which subsystem was last active — even for a native crash
/// that never reaches JS or Rust-land.
pub fn breadcrumb(area: &str, message: &str) {
    let stamp = chrono::Local::now().format("%H:%M:%S%.3f");
    let line = format!("  [{stamp}] {area}: {message}");
    if let Ok(mut ring) = BREADCRUMBS.lock() {
        ring.push(line);
        if ring.len() > MAX_BREADCRUMBS {
            ring.remove(0);
        }
    }
}

// ── Tauri commands ─────────────────────────────────────────────────────────

/// Summary of the crash-log directory: the rolling log plus every dated
/// report, newest first. Drives the Settings → Diagnostics tab.
#[tauri::command]
pub fn crashlog_status() -> CrashLogStatus {
    let dir = log_dir();
    let log_path = dir.join(CRASH_LOG_NAME);
    let (log_size_bytes, log_modified_at) = file_meta(&log_path);
    CrashLogStatus {
        dir: dir.to_string_lossy().into_owned(),
        log_path: log_path.to_string_lossy().into_owned(),
        log_size_bytes,
        log_modified_at,
        has_log: log_path.exists(),
        reports: list_reports(&dir),
    }
}

/// Read the rolling `crash.log` (when `name` is `None`) or one dated report
/// by file name. `name` is validated as a bare file name inside the log
/// directory so the frontend can never reach an arbitrary path.
#[tauri::command]
pub fn crashlog_read(name: Option<String>) -> Result<String, String> {
    let dir = log_dir();
    let rolling = name.is_none();
    let path = match name {
        None => dir.join(CRASH_LOG_NAME),
        Some(name) => {
            if !is_report_name(&name) {
                return Err("Invalid crash report name".to_string());
            }
            dir.join(name)
        }
    };
    match std::fs::read_to_string(&path) {
        Ok(content) => Ok(content),
        // A missing rolling log just means the app has never crashed.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound && rolling => Ok(String::new()),
        Err(e) => Err(format!("Failed to read crash log: {e}")),
    }
}

/// Delete every dated report and empty the rolling log. Used by the
/// "Clear" action in the Diagnostics tab.
#[tauri::command]
pub fn crashlog_clear() -> Result<(), String> {
    let dir = log_dir();
    let mut first_err: Option<String> = None;
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if is_report_name(&name) {
                if let Err(e) = std::fs::remove_file(entry.path()) {
                    first_err.get_or_insert_with(|| format!("Failed to delete {name}: {e}"));
                }
            }
        }
    }
    // Truncate the rolling log too so the tab starts clean.
    let log_path = dir.join(CRASH_LOG_NAME);
    if log_path.exists() {
        if let Err(e) = std::fs::write(&log_path, b"") {
            first_err.get_or_insert_with(|| format!("Failed to clear crash.log: {e}"));
        }
    }
    match first_err {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

/// Delete a single dated report.
#[tauri::command]
pub fn crashlog_delete_report(name: String) -> Result<(), String> {
    if !is_report_name(&name) {
        return Err("Invalid crash report name".to_string());
    }
    let path = log_dir().join(&name);
    std::fs::remove_file(&path).map_err(|e| format!("Failed to delete {name}: {e}"))
}

/// In-memory breadcrumb from the frontend, e.g. on route change. Never
/// touches disk — it only enriches the next crash report.
#[tauri::command]
pub fn crashlog_breadcrumb(area: String, message: String) {
    breadcrumb(&area, &message);
}

/// Persist a frontend error (window.onerror, unhandled rejection, React
/// error boundary) to the crash log + a dated report. Release builds strip
/// `console.*`, so without this a JS crash leaves no trace.
#[tauri::command]
pub fn crashlog_record(
    kind: Option<String>,
    message: String,
    stack: Option<String>,
    component_stack: Option<String>,
    extra: Option<String>,
) {
    let kind = kind.unwrap_or_else(|| "frontend-error".to_string());
    let mut body = format!("message: {message}");
    if let Some(stack) = stack.filter(|s| !s.trim().is_empty()) {
        body.push_str(&format!("\nstack:\n{stack}"));
    }
    if let Some(cs) = component_stack.filter(|s| !s.trim().is_empty()) {
        body.push_str(&format!("\ncomponent stack:{cs}"));
    }
    if let Some(extra) = extra.filter(|s| !s.trim().is_empty()) {
        body.push_str(&format!("\ncontext: {extra}"));
    }
    write_crash_log(&kind, &body, true);
}

// ── Paths & formatting ─────────────────────────────────────────────────────

fn timestamp() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string()
}

fn log_dir() -> PathBuf {
    if let Some(dir) = LOG_DIR.get() {
        return dir.clone();
    }
    default_data_dir().join(IDENTIFIER)
}

fn crash_log_path() -> PathBuf {
    log_dir().join(CRASH_LOG_NAME)
}

/// Hand-rolled `dirs::data_dir()` so the hook works before Tauri is up.
fn default_data_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir)
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        home.join("Library").join("Application Support")
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
            PathBuf::from(xdg)
        } else {
            let home = std::env::var_os("HOME")
                .map(PathBuf::from)
                .unwrap_or_else(std::env::temp_dir);
            home.join(".local").join("share")
        }
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        std::env::temp_dir()
    }
}

fn context_block() -> String {
    // Never deadlock a crashing thread: if the context lock is held, fall
    // back to the cheap values we can gather right here.
    let ctx = match CONTEXT.try_lock() {
        Ok(ctx) => ctx.clone(),
        Err(_) => AppContext {
            version: env!("CARGO_PKG_VERSION").to_string(),
            os: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
            locale: "unknown".to_string(),
            profile: if cfg!(debug_assertions) { "debug" } else { "release" }.to_string(),
            data_dir: String::new(),
            cpu: None,
            ram_gb: None,
            gpus: Vec::new(),
        },
    };
    let version = if ctx.version.is_empty() {
        env!("CARGO_PKG_VERSION").to_string()
    } else {
        ctx.version
    };
    let mut out = String::new();
    out.push_str(&format!("version   : {version} ({})\n", ctx.profile));
    out.push_str(&format!("os        : {}\n", ctx.os));
    out.push_str(&format!("arch      : {}\n", ctx.arch));
    out.push_str(&format!("locale    : {}\n", ctx.locale));
    out.push_str(&format!("pid       : {}\n", std::process::id()));
    out.push_str(&format!(
        "thread    : {}\n",
        std::thread::current().name().unwrap_or("<unnamed>")
    ));
    if let Some(start) = START.get() {
        out.push_str(&format!("uptime    : {:.1}s\n", start.elapsed().as_secs_f64()));
    }
    if !ctx.data_dir.is_empty() {
        out.push_str(&format!("data_dir  : {}\n", ctx.data_dir));
    }
    if let Some(cpu) = &ctx.cpu {
        out.push_str(&format!("cpu       : {cpu}\n"));
    }
    if let Some(ram) = ctx.ram_gb {
        out.push_str(&format!("ram       : {ram} GB\n"));
    }
    for (i, gpu) in ctx.gpus.iter().enumerate() {
        out.push_str(&format!("gpu{i:<6} : {gpu}\n"));
    }
    out
}

fn breadcrumb_block() -> String {
    let ring = match BREADCRUMBS.try_lock() {
        Ok(ring) => ring.clone(),
        Err(_) => return String::new(),
    };
    if ring.is_empty() {
        return String::new();
    }
    let mut out = String::from("recent activity (oldest first):\n");
    for line in ring {
        out.push_str(&line);
        out.push('\n');
    }
    out
}

fn format_entry(kind: &str, body: &str) -> String {
    let rule = RULE.repeat(RULE_LEN);
    format!(
        "{rule}\nGameIndex crash report — {kind}\nwhen      : {}\n{}{rule}\n{body}\n{rule}\n{}{rule}\n\n",
        timestamp(),
        context_block(),
        breadcrumb_block(),
    )
}

fn file_meta(path: &Path) -> (u64, u64) {
    match std::fs::metadata(path) {
        Ok(meta) => {
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            (meta.len(), modified)
        }
        Err(_) => (0, 0),
    }
}

fn write_crash_log(kind: &str, body: &str, create_report: bool) {
    // Never let a poisoned lock (the original crash may have been in a
    // thread that held it) stop us from writing the log.
    let _guard = match LOG_LOCK.try_lock() {
        Ok(guard) => Some(guard),
        // The lock is unavailable: we're likely re-entering from within a
        // write. Proceed anyway rather than deadlock the crashing thread.
        Err(_) => None,
    };
    let entry = format_entry(kind, body);
    let path = crash_log_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    rotate_if_needed(&path);

    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = f.write_all(entry.as_bytes());
    }

    if create_report {
        write_report(&path, &entry);
    }
}

/// Roll the rolling log over once it passes the size cap so it can't grow
/// without bound across a long-lived install.
fn rotate_if_needed(path: &Path) {
    let too_big = std::fs::metadata(path).map(|m| m.len() >= MAX_LOG_BYTES).unwrap_or(false);
    if !too_big {
        return;
    }
    let rotated = path.with_file_name(ROTATED_LOG_NAME);
    let _ = std::fs::remove_file(&rotated);
    let _ = std::fs::rename(path, &rotated);
}

/// Write a standalone dated report (`crash-YYYY-MM-DD_HH-MM-SS.txt`) next to
/// the rolling log, then prune the oldest once we exceed `MAX_REPORTS`.
fn write_report(log_path: &Path, entry: &str) {
    let Some(dir) = log_path.parent() else {
        return;
    };
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    let mut report = dir.join(format!("{REPORT_PREFIX}{stamp}{REPORT_EXT}"));
    let mut n = 1;
    while report.exists() && n < 1000 {
        report = dir.join(format!("{REPORT_PREFIX}{stamp}-{n}{REPORT_EXT}"));
        n += 1;
    }
    if std::fs::write(&report, entry.as_bytes()).is_ok() {
        prune_reports(dir);
    }
}

fn list_reports(dir: &Path) -> Vec<CrashReportInfo> {
    let mut reports: Vec<CrashReportInfo> = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return reports;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !is_report_name(&name) {
            continue;
        }
        let path = entry.path();
        let (size_bytes, modified_at) = file_meta(&path);
        reports.push(CrashReportInfo {
            name,
            path: path.to_string_lossy().into_owned(),
            size_bytes,
            modified_at,
        });
    }
    // Newest first — the file name is timestamp-ordered.
    reports.sort_by(|a, b| b.name.cmp(&a.name));
    reports
}

fn prune_reports(dir: &Path) {
    let reports = list_reports(dir);
    for report in reports.into_iter().skip(MAX_REPORTS) {
        let _ = std::fs::remove_file(&report.path);
    }
}

/// A dated report's name: our prefix, our extension, no separators. Guards
/// `crashlog_read` / `crashlog_delete_report` against path traversal.
fn is_report_name(name: &str) -> bool {
    name.starts_with(REPORT_PREFIX)
        && name.ends_with(REPORT_EXT)
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains("..")
}

// ── OS / locale ────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn os_description() -> String {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;
    if let Ok(key) =
        RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
    {
        let product: String = key
            .get_value("ProductName")
            .unwrap_or_else(|_| "Windows".to_string());
        let display: String = key.get_value("DisplayVersion").unwrap_or_default();
        let build: String = key.get_value("CurrentBuildNumber").unwrap_or_default();
        let mut out = product;
        if !display.is_empty() {
            out.push_str(&format!(" {display}"));
        }
        if !build.is_empty() {
            out.push_str(&format!(" (build {build})"));
        }
        return out;
    }
    format!("Windows ({})", std::env::consts::ARCH)
}

#[cfg(target_os = "linux")]
fn os_description() -> String {
    if let Ok(text) = std::fs::read_to_string("/etc/os-release") {
        for line in text.lines() {
            if let Some(value) = line.strip_prefix("PRETTY_NAME=") {
                return value.trim_matches('"').to_string();
            }
        }
    }
    format!("Linux ({})", std::env::consts::ARCH)
}

#[cfg(target_os = "macos")]
fn os_description() -> String {
    format!("macOS ({})", std::env::consts::ARCH)
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn os_description() -> String {
    std::env::consts::OS.to_string()
}

#[cfg(target_os = "windows")]
fn locale() -> String {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    if let Ok(key) =
        RegKey::predef(HKEY_CURRENT_USER).open_subkey(r"Control Panel\International")
    {
        if let Ok(name) = key.get_value::<String, _>("LocaleName") {
            if !name.is_empty() {
                return name;
            }
        }
    }
    fallback_locale()
}

#[cfg(not(target_os = "windows"))]
fn locale() -> String {
    fallback_locale()
}

fn fallback_locale() -> String {
    for key in ["LC_ALL", "LC_MESSAGES", "LANG"] {
        if let Ok(value) = std::env::var(key) {
            if !value.is_empty() {
                return value;
            }
        }
    }
    "unknown".to_string()
}

// ── Windows fatal exceptions ───────────────────────────────────────────────

/// Register a vectored exception handler ahead of the normal dispatch
/// chain so fatal native exceptions get logged before the process dies.
#[cfg(target_os = "windows")]
fn install_vectored_handler() {
    use windows::Win32::System::Diagnostics::Debug::AddVectoredExceptionHandler;
    // `FirstHandler = 1` puts us at the front of the chain.
    let handle = unsafe { AddVectoredExceptionHandler(1, Some(vectored_handler)) };
    if handle.is_null() {
        eprintln!("[gameindex] failed to register vectored exception handler");
    }
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn vectored_handler(pinfo: *mut EXCEPTION_POINTERS) -> i32 {
    // Observe + log only; the process's fate is unchanged. We never touch
    // the exception state, so return EXCEPTION_CONTINUE_SEARCH (0).
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| unsafe {
        write_exception(pinfo);
    }));
    0
}

#[cfg(target_os = "windows")]
unsafe fn write_exception(pinfo: *mut EXCEPTION_POINTERS) {
    if pinfo.is_null() {
        return;
    }
    let info = &*pinfo;
    if info.ExceptionRecord.is_null() {
        return;
    }
    let rec = &*info.ExceptionRecord;
    let code = rec.ExceptionCode.0 as u32;
    if !is_fatal_code(code) {
        return;
    }
    let addr = rec.ExceptionAddress as usize;
    let (module, base) = faulting_module(addr);
    let offset = addr.wrapping_sub(base);

    let mut frames: [*mut core::ffi::c_void; 32] = [std::ptr::null_mut(); 32];
    let count = RtlCaptureStackBackTrace(1, &mut frames, None);
    let mut stack = String::new();
    for i in 0..count {
        stack.push_str(&format!("  {:016X}\n", frames[i as usize] as usize));
    }

    write_crash_log(
        "fatal-exception",
        &format!(
            "pid: {}\nthread_id: {}\nexception: 0x{code:08X}\nmodule: {module}\nfault_addr: 0x{addr:016X}\noffset: 0x{offset:016X}\nstack:\n{stack}",
            std::process::id(),
            GetCurrentThreadId(),
        ),
        true,
    );
}

#[cfg(target_os = "windows")]
fn is_fatal_code(code: u32) -> bool {
    matches!(
        code,
        0xC000_0409 // STATUS_STACK_BUFFER_OVERRUN — __fastfail / CFG violation
            | 0xC000_0005 // STATUS_ACCESS_VIOLATION
            | 0xC000_00FD // STATUS_STACK_OVERFLOW
            | 0xC000_0374 // STATUS_HEAP_CORRUPTION
            | 0xC000_001D // STATUS_ILLEGAL_INSTRUCTION
            | 0xC000_0094 // STATUS_INTEGER_DIVIDE_BY_ZERO
    )
}

/// Resolve the module containing `addr` to (file name, base address) so the
/// log reports a module + offset instead of a bare absolute address.
#[cfg(target_os = "windows")]
unsafe fn faulting_module(addr: usize) -> (String, usize) {
    use windows::Win32::Foundation::HMODULE;
    use windows::Win32::System::LibraryLoader::{
        GetModuleFileNameW, GetModuleHandleExW, GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
        GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
    };

    let mut hmod: HMODULE = HMODULE(std::ptr::null_mut());
    let ok = GetModuleHandleExW(
        GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
        windows::core::PCWSTR(addr as *const u16),
        &mut hmod,
    );
    if ok.is_err() || hmod.is_invalid() {
        return (String::from("<unknown>"), 0);
    }
    let base = hmod.0 as usize;
    let mut buf = [0u16; 1024];
    let len = GetModuleFileNameW(hmod, &mut buf);
    let name = String::from_utf16_lossy(&buf[..len as usize]);
    (name, base)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_names_are_validated() {
        assert!(is_report_name("crash-2026-10-01_14-30-00.txt"));
        assert!(!is_report_name("crash.log"));
        assert!(!is_report_name("crash-../secret.txt"));
        assert!(!is_report_name("crash-..\\secret.txt"));
        assert!(!is_report_name("other.txt"));
    }

    #[test]
    fn entry_contains_kind_context_and_body() {
        let entry = format_entry("panic", "message: boom");
        assert!(entry.contains("crash report"));
        assert!(entry.contains("panic"));
        assert!(entry.contains("message: boom"));
        assert!(entry.contains("pid"));
    }

    #[test]
    fn breadcrumb_ring_is_bounded() {
        for i in 0..(MAX_BREADCRUMBS + 10) {
            breadcrumb("ring", &format!("event {i}"));
        }
        let ring = BREADCRUMBS.lock().unwrap();
        assert!(ring.len() <= MAX_BREADCRUMBS);
    }

    #[test]
    fn panic_message_reads_common_payloads() {
        let s: &(dyn std::any::Any + Send) = &"boom";
        assert_eq!(panic_message(s), "boom");
        let owned: &(dyn std::any::Any + Send) = &String::from("owned");
        assert_eq!(panic_message(owned), "owned");
        let num: &(dyn std::any::Any + Send) = &42u32;
        assert_eq!(panic_message(num), "unknown panic payload");
    }
}
