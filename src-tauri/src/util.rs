//! Small cross-cutting helpers shared across store integrations.

/// Current time as Unix epoch seconds (0 if the system clock predates 1970).
pub(crate) fn current_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
