//! Startup crash diagnostics.
//!
//! Release builds ship with `strip = true` and `panic = "unwind"`. A Rust
//! panic unwinding to the top of the main thread aborts the process, and a
//! native fast-fail (Control Flow Guard violation, stack buffer overrun —
//! `0xc0000409` / STATUS_STACK_BUFFER_OVERRUN in the Windows event log)
//! leaves nothing but a bare fault offset. This module makes every fatal
//! exit path explain itself:
//!
//! 1. A panic hook (all platforms) that appends the message + backtrace to
//!    `<app_data_dir>/crash.log`.
//! 2. A Windows vectored exception handler that logs native fatal
//!    exceptions a panic hook can't see — exception code, faulting module,
//!    and the raw call stack.
//!
//! The log path is registered from `.setup` once the real `app_data_dir` is
//! known; until then a hand-rolled `data_dir/<identifier>` fallback is used
//! so a crash during the earliest startup still lands on disk.

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

const IDENTIFIER: &str = "com.gameindex.app";
const CRASH_LOG_NAME: &str = "crash.log";

static LOG_DIR: OnceLock<PathBuf> = OnceLock::new();
static LOG_LOCK: Mutex<()> = Mutex::new(());

#[cfg(target_os = "windows")]
use windows::Win32::System::Diagnostics::Debug::{
    RtlCaptureStackBackTrace, EXCEPTION_POINTERS,
};
#[cfg(target_os = "windows")]
use windows::Win32::System::Threading::GetCurrentThreadId;

/// Register the real app-data directory (from `.setup`) so crash logs land
/// next to the database.
pub fn set_log_dir(dir: PathBuf) {
    let _ = LOG_DIR.set(dir);
}

/// Install the panic hook and (on Windows) the fatal-exception handler.
/// Call once, at the top of `run()`.
pub fn init() {
    // Backtraces in panic output only materialize when the env var is set
    // (the default hook checks it), and release builds ship it unset.
    if std::env::var_os("RUST_BACKTRACE").is_none() {
        std::env::set_var("RUST_BACKTRACE", "1");
    }

    std::panic::set_hook(Box::new(|info| {
        eprintln!("[gameindex] panic: {info}");
        let backtrace = std::backtrace::Backtrace::force_capture();
        write_crash_log("panic", &format!("message: {info}\nbacktrace:\n{backtrace}\n"));
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

fn timestamp() -> String {
    chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string()
}

fn crash_log_path() -> PathBuf {
    if let Some(dir) = LOG_DIR.get() {
        return dir.join(CRASH_LOG_NAME);
    }
    default_data_dir().join(IDENTIFIER).join(CRASH_LOG_NAME)
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

fn write_crash_log(kind: &str, body: &str) {
    // Never let a poisoned lock (the original crash may have been in a
    // thread that held it) stop us from writing the log.
    let _guard = LOG_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let path = crash_log_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let full = format!("[{}] {kind}\n{body}\n{}\n", timestamp(), "─".repeat(60));
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = f.write_all(full.as_bytes());
    }
}

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
    let code = rec.ExceptionCode as u32;
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
            "pid: {}\nthread: {}\nexception: 0x{code:08X}\nmodule: {module}\nfault_addr: 0x{addr:016X}\noffset: 0x{offset:016X}\nstack:\n{stack}",
            std::process::id(),
            GetCurrentThreadId(),
        ),
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
    if ok.is_err() || hmod.is_null() {
        return (String::from("<unknown>"), 0);
    }
    let base = hmod.0 as usize;
    let mut buf = [0u16; 1024];
    let len = GetModuleFileNameW(hmod, &mut buf);
    let name = String::from_utf16_lossy(&buf[..len as usize]);
    (name, base)
}