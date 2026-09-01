use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModOperationError { pub code: String, pub message: String, pub recoverable: bool }
impl ModOperationError { pub fn new(code: &str, message: impl Into<String>, recoverable: bool) -> Self { Self { code: code.into(), message: message.into(), recoverable } } }
impl std::fmt::Display for ModOperationError { fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { write!(f, "{}: {}", self.code, self.message) } }
impl std::error::Error for ModOperationError {}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoRecord { pub game_id: String, pub operation: String, pub original_path: String, pub backup_path: Option<String>, pub current_path: Option<String>, pub timestamp: u64 }

pub fn validate_mod_path(path: &Path, roots: &[&Path]) -> Result<(), ModOperationError> {
    let normalized = path.canonicalize().map_err(|e| ModOperationError::new("path_unavailable", format!("cannot resolve '{}': {e}", path.display()), true))?;
    if roots.iter().filter_map(|r| r.canonicalize().ok()).any(|root| normalized.starts_with(root)) { Ok(()) } else { Err(ModOperationError::new("unsafe_path", format!("path '{}' is outside the managed mod roots", path.display()), false)) }
}

pub fn backup_path(data_dir: &Path, game_id: &str) -> PathBuf { data_dir.join("mod-backups").join(game_id).join(format!("{}-{}", unix_now(), std::process::id())) }
pub fn backup_file(source: &Path, destination_dir: &Path) -> Result<PathBuf, ModOperationError> {
    fs::create_dir_all(destination_dir).map_err(|e| ModOperationError::new("backup_failed", e.to_string(), true))?;
    let target = destination_dir.join(source.file_name().ok_or_else(|| ModOperationError::new("invalid_path", "missing file name", false))?);
    fs::copy(source, &target).map_err(|e| ModOperationError::new("backup_failed", e.to_string(), true))?;
    Ok(target)
}
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), ModOperationError> {
    let parent = path.parent().ok_or_else(|| ModOperationError::new("invalid_path", "missing parent directory", false))?;
    fs::create_dir_all(parent).map_err(|e| ModOperationError::new("write_failed", e.to_string(), true))?;
    let tmp = parent.join(format!(".{}.tmp-{}", path.file_name().and_then(|n| n.to_str()).unwrap_or("file"), std::process::id()));
    fs::write(&tmp, bytes).map_err(|e| ModOperationError::new("write_failed", e.to_string(), true))?;
    if let Err(e) = fs::rename(&tmp, path) { let _ = fs::remove_file(&tmp); return Err(ModOperationError::new("write_failed", e.to_string(), true)); }
    Ok(())
}
pub fn journal_entry(data_dir: &Path, game_id: &str, operation: &str, details: &str) -> Result<(), ModOperationError> {
    let dir = data_dir.join("mod-journal"); fs::create_dir_all(&dir).map_err(|e| ModOperationError::new("journal_failed", e.to_string(), true))?;
    let path = dir.join("operations.jsonl"); let mut old = fs::read(&path).unwrap_or_default();
    old.extend_from_slice(format!("{{\"timestamp\":{},\"gameId\":{:?},\"operation\":{:?},\"details\":{:?}}}\n", unix_now(), game_id, operation, details).as_bytes()); atomic_write(&path, &old)
}
pub fn write_undo(data_dir: &Path, record: &UndoRecord) -> Result<(), ModOperationError> {
    let path = data_dir.join("mod-journal").join("last-undo.json");
    atomic_write(&path, serde_json::to_vec_pretty(record).map_err(|e| ModOperationError::new("undo_failed", e.to_string(), true))?.as_slice())
}
pub fn read_undo(data_dir: &Path) -> Result<Option<UndoRecord>, ModOperationError> {
    let path = data_dir.join("mod-journal").join("last-undo.json"); if !path.is_file() { return Ok(None); }
    let bytes = fs::read(path).map_err(|e| ModOperationError::new("undo_failed", e.to_string(), true))?;
    serde_json::from_slice(&bytes).map(Some).map_err(|e| ModOperationError::new("undo_failed", e.to_string(), true))
}
pub fn clear_undo(data_dir: &Path) { let _ = fs::remove_file(data_dir.join("mod-journal").join("last-undo.json")); }
fn unix_now() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) }

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn atomic_write_replaces_file() { let d=tempfile::tempdir().unwrap(); let p=d.path().join("nested/file.txt"); atomic_write(&p,b"hello").unwrap(); assert_eq!(fs::read_to_string(p).unwrap(),"hello"); }
    #[test] fn rejects_paths_outside_roots() { let r=tempfile::tempdir().unwrap(); let o=tempfile::tempdir().unwrap(); let p=o.path().join("x"); fs::write(&p,b"x").unwrap(); assert!(validate_mod_path(&p,&[r.path()]).is_err()); }
    #[test] fn journal_is_append_only() { let d=tempfile::tempdir().unwrap(); journal_entry(d.path(),"g","toggle","m").unwrap(); journal_entry(d.path(),"g","delete","m").unwrap(); assert_eq!(fs::read_to_string(d.path().join("mod-journal/operations.jsonl")).unwrap().lines().count(),2); }
    #[test] fn undo_round_trips() { let d=tempfile::tempdir().unwrap(); let r=UndoRecord{game_id:"g".into(),operation:"delete".into(),original_path:"x".into(),backup_path:None,current_path:None,timestamp:1}; write_undo(d.path(),&r).unwrap(); assert_eq!(read_undo(d.path()).unwrap().unwrap().game_id,"g"); }
}
