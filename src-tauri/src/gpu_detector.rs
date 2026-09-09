use serde::Serialize;
#[cfg(windows)]
use wmi::{COMLibrary, WMIConnection};

/// Serializable GPU info matching the frontend GpuInfo type.
#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub vram_mb: u64,
}

/// WMI video controller struct for deserialization.
/// WMI returns PascalCase properties — serde maps them to snake_case.
#[cfg(windows)]
#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "PascalCase")]
struct WmiVideoController {
    name: String,
    adapter_compatibility: Option<String>,
    adapter_ram: Option<u64>,
}

/// Detect GPUs on the system using WMI (Windows Management Instrumentation).
/// Spawns a dedicated thread to avoid COM apartment threading conflicts (0x80010106).
/// Falls back to an empty list if WMI is unavailable (e.g., non-Windows platforms).
#[cfg(windows)]
pub fn detect_gpus() -> Vec<GpuInfo> {
    std::thread::spawn(|| {
        let mut gpus = Vec::new();

        let com_lib = match COMLibrary::new() {
            Ok(lib) => lib,
            Err(e) => {
                eprintln!("COM initialization failed: {}", e);
                return gpus;
            }
        };

        match WMIConnection::new(com_lib) {
            Ok(wmi_con) => {
                let query = "SELECT Name, AdapterCompatibility, AdapterRAM FROM Win32_VideoController";
                match wmi_con.raw_query::<WmiVideoController>(query) {
                    Ok(results) => {
                        // Win32_VideoController can list the same physical adapter
                        // once per display output (a single NVIDIA GPU shows up
                        // twice when two monitors are attached). Dedupe by
                        // name+vendor for the settings list, but keep the ORIGINAL
                        // WMI index in the id so metrics collection can still map
                        // `gpu-N` to the right `phys_N` performance counter.
                        let mut seen: std::collections::HashSet<String> =
                            std::collections::HashSet::new();
                        for (idx, gpu) in results.into_iter().enumerate() {
                            let name = gpu.name.trim().to_string();
                            if name.is_empty() {
                                continue;
                            }

                            let vendor = gpu
                                .adapter_compatibility
                                .unwrap_or_default()
                                .trim()
                                .to_string();
                            let vendor_display = if vendor.is_empty() {
                                detect_vendor_from_name(&name)
                            } else {
                                vendor
                            };

                            let dedupe_key = format!(
                                "{}|{}",
                                name.to_lowercase(),
                                vendor_display.to_lowercase()
                            );
                            if !seen.insert(dedupe_key) {
                                continue;
                            }

                            let vram_bytes = gpu.adapter_ram.unwrap_or(0);
                            // WMI AdapterRAM is uint32 — values near 4 GB (4,294,967,295 bytes)
                            // indicate truncation. Use name-based estimation for GPUs with >4 GB.
                            let vram_mb = if vram_bytes > 0 && vram_bytes < 4_200_000_000 {
                                // Value fits in uint32 and is not truncated — use it directly
                                vram_bytes / 1_048_576
                            } else {
                                // Either 0 (not reported) or truncated — estimate from name
                                estimate_vram_from_name(&name)
                            };

                            gpus.push(GpuInfo {
                                id: format!("gpu-{}", idx),
                                name,
                                vendor: vendor_display,
                                vram_mb,
                            });
                        }
                    }
                    Err(e) => {
                        eprintln!("WMI GPU query failed: {}", e);
                    }
                }
            }
            Err(e) => {
                eprintln!("WMI connection failed: {}", e);
            }
        }

        gpus
    })
    .join()
    .unwrap_or_default()
}

/// DRM cards in `/sys/class/drm`, deduplicated by PCI slot so a single
/// physical GPU that exposes multiple card entries (common with the NVIDIA
/// driver, one card per display head) is listed once. Shared by both
/// `detect_gpus` and the metrics collector so a `gpu-N` id maps to the same
/// card on both sides.
#[cfg(target_os = "linux")]
pub(crate) fn linux_drm_cards() -> Vec<std::path::PathBuf> {
    use std::fs;
    let mut cards = Vec::new();
    let mut seen_pci: std::collections::HashSet<String> = std::collections::HashSet::new();
    if let Ok(entries) = fs::read_dir("/sys/class/drm") {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("card") || name.contains('-') {
                continue;
            }
            if !entry.path().join("device").exists() {
                continue;
            }
            let uevent = fs::read_to_string(entry.path().join("device/uevent"))
                .unwrap_or_default();
            let pci_slot = uevent
                .lines()
                .find(|l| l.starts_with("PCI_SLOT_NAME="))
                .map(|l| l.trim_start_matches("PCI_SLOT_NAME=").to_string())
                .unwrap_or_default();
            if !pci_slot.is_empty() && !seen_pci.insert(pci_slot) {
                continue;
            }
            cards.push(entry.path());
        }
    }
    cards
}

/// Detect GPUs on Linux via /sys/class/drm/card*/device.
#[cfg(target_os = "linux")]
pub fn detect_gpus() -> Vec<GpuInfo> {
    use std::fs;

    let mut gpus = Vec::new();
    let mut idx = 0u32;
    for card in linux_drm_cards() {
        let dev = card.join("device");
        let vendor_id = fs::read_to_string(dev.join("vendor"))
            .map(|s| s.trim().to_lowercase())
            .unwrap_or_default();
        let uevent = fs::read_to_string(dev.join("uevent")).unwrap_or_default();
        let pci_slot = uevent
            .lines()
            .find(|l| l.starts_with("PCI_SLOT_NAME="))
            .map(|l| l.trim_start_matches("PCI_SLOT_NAME=").to_string())
            .unwrap_or_default();
        let vendor = match vendor_id.as_str() {
            "0x10de" => "NVIDIA",
            "0x1002" => "AMD",
            "0x8086" => "Intel",
            _ => "Unknown",
        };
        let gpu_name = if vendor == "NVIDIA" {
            nvidia_name_linux(&pci_slot)
        } else {
            format!("{} GPU ({})", vendor, pci_slot)
        };
        let vram_mb = if vendor == "NVIDIA" {
            nvidia_vram_linux(&pci_slot)
        } else {
            estimate_vram_from_name(&gpu_name)
        };
        gpus.push(GpuInfo {
            id: format!("gpu-{}", idx),
            name: gpu_name,
            vendor: vendor.to_string(),
            vram_mb,
        });
        idx += 1;
    }
    gpus
}

/// Read the value of a `Key: value` line from an NVIDIA `information` file.
#[cfg(target_os = "linux")]
fn read_nvidia_information(path: &std::path::Path, field: &str) -> Option<String> {
    let info = std::fs::read_to_string(path).ok()?;
    info.lines()
        .find(|l| l.trim_start().starts_with(field))
        .map(|l| l.trim_start().trim_start_matches(field).trim().to_string())
        .filter(|v| !v.is_empty())
}

/// NVIDIA GPU model for the card at `pci`. The information file's directory
/// is named after the PCI slot, so look there first; fall back to any NVIDIA
/// GPU's model when the slot-specific file is unreadable.
#[cfg(target_os = "linux")]
fn nvidia_name_linux(pci: &str) -> String {
    let specific = std::path::Path::new("/proc/driver/nvidia/gpus")
        .join(pci)
        .join("information");
    if let Some(model) = read_nvidia_information(&specific, "Model:") {
        return model;
    }
    let base = std::path::Path::new("/proc/driver/nvidia/gpus");
    if let Ok(entries) = std::fs::read_dir(base) {
        for e in entries.flatten() {
            if let Some(model) = read_nvidia_information(&e.path().join("information"), "Model:") {
                return model;
            }
        }
    }
    "NVIDIA GPU".to_string()
}

/// Extract VRAM in MB from a single NVIDIA `information` line. Modern
/// drivers write `GPU Memory Size: 10240 MiB`; older ones wrote
/// `Total Memory: 12288 MiB`. Shared with tests.
#[cfg(any(target_os = "linux", test))]
fn parse_nvidia_vram_mb(line: &str) -> Option<u64> {
    let lower = line.to_lowercase();
    if !(lower.contains("gpu memory size") || lower.contains("total memory")) {
        return None;
    }
    let digits: String = line.chars().filter(|c| c.is_ascii_digit()).collect();
    let mb = digits.parse::<u64>().ok()?;
    (mb > 0).then_some(mb)
}

/// VRAM in MB for the NVIDIA card at `pci`, read from its own information
/// file. Falls back to any NVIDIA GPU when the slot-specific file is
/// unreadable.
#[cfg(target_os = "linux")]
fn nvidia_vram_linux(pci: &str) -> u64 {
    let specific = std::path::Path::new("/proc/driver/nvidia/gpus")
        .join(pci)
        .join("information");
    if let Some(mb) = read_nvidia_vram_from(&specific) {
        return mb;
    }
    let base = std::path::Path::new("/proc/driver/nvidia/gpus");
    if let Ok(entries) = std::fs::read_dir(base) {
        for e in entries.flatten() {
            if let Some(mb) = read_nvidia_vram_from(&e.path().join("information")) {
                return mb;
            }
        }
    }
    0
}

#[cfg(target_os = "linux")]
fn read_nvidia_vram_from(path: &std::path::Path) -> Option<u64> {
    let info = std::fs::read_to_string(path).ok()?;
    info.lines().find_map(parse_nvidia_vram_mb)
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn detect_gpus() -> Vec<GpuInfo> {
    Vec::new()
}

/// Try to infer the vendor from the GPU name when WMI doesn't report it.
fn detect_vendor_from_name(name: &str) -> String {
    let lower = name.to_lowercase();
    if lower.contains("nvidia") || lower.contains("geforce") || lower.contains("rtx") || lower.contains("gtx") || lower.contains("quadro") {
        "NVIDIA".to_string()
    } else if lower.contains("amd") || lower.contains("radeon") || lower.contains("rx") {
        "AMD".to_string()
    } else if lower.contains("intel") || lower.contains("arc") || lower.contains("uhd") || lower.contains("iris") {
        "Intel".to_string()
    } else {
        "Unknown".to_string()
    }
}

/// Estimate VRAM from the GPU name when WMI reports 0 or is truncated (uint32 overflow).
fn estimate_vram_from_name(name: &str) -> u64 {
    let lower = name.to_lowercase();

    // Intel integrated GPUs typically have shared memory — report 0
    if lower.contains("intel") && (lower.contains("uhd") || lower.contains("iris") || lower.contains("hd graphics")) {
        return 0;
    }

    // ─── NVIDIA RTX 50-series (Blackwell) ───
    if lower.contains("5090") { return 32768; }   // 32 GB
    if lower.contains("5080") { return 16384; }   // 16 GB
    if lower.contains("5070 ti") || lower.contains("5070ti") { return 16384; } // 16 GB
    if lower.contains("5070") { return 12288; }   // 12 GB
    if lower.contains("5060 ti") || lower.contains("5060ti") { return 16384; } // 16 GB
    if lower.contains("5060") { return 8192; }    // 8 GB

    // ─── NVIDIA RTX 40-series (Ada Lovelace) ───
    if lower.contains("4090") { return 24576; }
    if lower.contains("4080 super") { return 16384; }
    if lower.contains("4080") { return 16384; }
    if lower.contains("4070 ti super") { return 16384; }
    if lower.contains("4070 ti") || lower.contains("4070ti") { return 12288; }
    if lower.contains("4070 super") { return 12288; }
    if lower.contains("4070") { return 12288; }
    if lower.contains("4060 ti") || lower.contains("4060ti") { return 8192; }
    if lower.contains("4060") { return 8192; }

    // ─── NVIDIA RTX 30-series ───
    if lower.contains("3090 ti") || lower.contains("3090ti") { return 24576; }
    if lower.contains("3090") { return 24576; }
    if lower.contains("3080 ti") || lower.contains("3080ti") { return 12288; }
    if lower.contains("3080") { return 10240; }
    if lower.contains("3070 ti") || lower.contains("3070ti") { return 8192; }
    if lower.contains("3070") { return 8192; }
    if lower.contains("3060 ti") || lower.contains("3060ti") { return 8192; }
    if lower.contains("3060") { return 12288; }
    if lower.contains("3050") { return 8192; }

    // ─── AMD RX 9000-series (RDNA 4) ───
    if lower.contains("9070 xt") { return 16384; }  // 16 GB
    if lower.contains("9070") { return 16384; }     // 16 GB
    if lower.contains("9060 xt") { return 16384; }  // 16 GB
    if lower.contains("9060") { return 8192; }      // 8 GB

    // ─── AMD RX 7000-series (RDNA 3) ───
    if lower.contains("7900 xtx") { return 24576; }
    if lower.contains("7900 xt") { return 20480; }
    if lower.contains("7900 gre") { return 16384; }
    if lower.contains("7900") { return 16384; }
    if lower.contains("7800 xt") { return 16384; }
    if lower.contains("7700 xt") { return 12288; }
    if lower.contains("7600 xt") { return 16384; }
    if lower.contains("7600") { return 8192; }

    // ─── AMD RX 6000-series (RDNA 2) ───
    if lower.contains("6950 xt") { return 16384; }
    if lower.contains("6900 xt") { return 16384; }
    if lower.contains("6800 xt") { return 16384; }
    if lower.contains("6800") { return 16384; }
    if lower.contains("6750 xt") { return 12288; }
    if lower.contains("6700 xt") { return 12288; }
    if lower.contains("6600 xt") { return 8192; }
    if lower.contains("6600") { return 8192; }

    // ─── Intel Arc ───
    if lower.contains("arc b580") { return 12288; }  // Battlemage
    if lower.contains("arc b570") { return 10240; }  // Battlemage
    if lower.contains("arc a770") { return 16384; }
    if lower.contains("arc a750") { return 8192; }
    if lower.contains("arc a580") { return 8192; }
    if lower.contains("arc a380") { return 6144; }

    // ─── Generic NVIDIA pattern matching (catch older cards) ───
    if lower.contains("nvidia") || lower.contains("geforce") {
        // Older naming: GTX 1080 Ti, etc. — default to 8 GB
        return 8192;
    }

    // Default fallback for unknown modern GPUs
    8192
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nvidia_vram_parses_gpu_memory_size_field() {
        // Modern NVIDIA driver format — this is the field that was being
        // missed (the old parser looked for "Total Memory:" only, which
        // doesn't exist → every NVIDIA card reported 0 MB).
        assert_eq!(parse_nvidia_vram_mb("GPU Memory Size: 10240 MiB"), Some(10240));
        assert_eq!(parse_nvidia_vram_mb("GPU Memory Size: 24576 MiB"), Some(24576));
    }

    #[test]
    fn nvidia_vram_parses_legacy_total_memory_field() {
        // Older driver format kept as a fallback.
        assert_eq!(parse_nvidia_vram_mb("Total Memory: 12288 MiB"), Some(12288));
    }

    #[test]
    fn nvidia_vram_rejects_non_memory_lines_and_zero() {
        assert_eq!(parse_nvidia_vram_mb("Model: NVIDIA GeForce RTX 3080"), None);
        assert_eq!(parse_nvidia_vram_mb("Bus Location: 0000:01:00.0"), None);
        assert_eq!(parse_nvidia_vram_mb("GPU Memory Size: 0 MiB"), None);
        assert_eq!(parse_nvidia_vram_mb(""), None);
    }
}