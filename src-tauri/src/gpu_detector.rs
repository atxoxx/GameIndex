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
                            // indicate truncation, and many drivers report 0 outright.
                            let vram_mb = if vram_bytes > 0 && vram_bytes < 4_200_000_000 {
                                // Value fits in uint32 and is not truncated — use it directly
                                vram_bytes / 1_048_576
                            } else if let Some(nv) = windows_nvidia_smi_vram_mb(&name) {
                                // WMI gave 0 / a truncated value — ask nvidia-smi for the
                                // exact total (it reports MiB with `nounits`).
                                nv
                            } else {
                                // Neither WMI nor nvidia-smi produced a value — estimate from name
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

/// VRAM in MB for the NVIDIA adapter named `wmi_name`, queried via
/// nvidia-smi. WMI `AdapterRAM` is 0 / truncated for most modern NVIDIA
/// cards, so match the WMI controller name against nvidia-smi's GPU names
/// and take the reported `memory.total`. Returns `None` when nvidia-smi
/// isn't available or no GPU name matches.
#[cfg(windows)]
fn windows_nvidia_smi_vram_mb(wmi_name: &str) -> Option<u64> {
    if !crate::compatibility::is_command_available("nvidia-smi") {
        return None;
    }
    let out = std::process::Command::new("nvidia-smi")
        .args(["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let filter_lower = wmi_name.trim().to_lowercase();
    for line in text.lines() {
        let mut parts = line.split(',').map(|p| p.trim());
        let gpu_name = parts.next().unwrap_or("");
        let vram = parts.next().and_then(parse_nvidia_smi_memory_mb);
        if gpu_name.to_lowercase().contains(&filter_lower)
            || filter_lower.contains(&gpu_name.to_lowercase())
        {
            if let Some(mb) = vram {
                return Some(mb);
            }
        }
    }
    None
}

/// Parse the `memory.total` value from a `name,memory.total` nvidia-smi row.
/// nvidia-smi reports MiB with `nounits`; tolerate a stray `MiB` suffix from
/// manual/other queries. Shared with tests.
fn parse_nvidia_smi_memory_mb(raw: &str) -> Option<u64> {
    let token = raw.trim().split_whitespace().next()?;
    let v = token.parse::<f64>().ok()?;
    if v.is_finite() && v > 0.0 {
        Some(v.round() as u64)
    } else {
        None
    }
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

        // VRAM resolution order: nvidia-smi (exact, works even when the
        // /proc information file has no memory line on modern drivers), then
        // the kernel's `mem_info_vram_total` sysfs attribute (bytes — works
        // for amdgpu, nouveau and Intel discrete), then name estimation.
        let gpu_name = if vendor == "NVIDIA" {
            nvidia_name_linux(&pci_slot)
        } else {
            format!("{} GPU ({})", vendor, pci_slot)
        };
        let vram_mb = if vendor == "NVIDIA" {
            nvidia_vram_linux(&pci_slot)
                .or_else(|| linux_sysfs_vram_mb(&dev))
                .unwrap_or_else(|| estimate_vram_from_name(&gpu_name))
        } else {
            linux_sysfs_vram_mb(&dev)
                .unwrap_or_else(|| estimate_vram_from_name(&gpu_name))
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

/// NVIDIA GPU model + VRAM in MB for the card at `pci`, queried via
/// nvidia-smi. This is the authoritative source: modern NVIDIA drivers
/// (535+) dropped the memory line from `/proc/driver/nvidia/gpus/*/information`
/// entirely, while `--query-gpu=memory.total` still reports exact MiB.
/// `-i <pci>` targets the SELECTED card, not the first one nvidia-smi
/// enumerates.
#[cfg(target_os = "linux")]
fn nvidia_smi_info(pci: &str) -> Option<(String, u64)> {
    if pci.is_empty() || !crate::compatibility::is_command_available("nvidia-smi") {
        return None;
    }
    let out = std::process::Command::new("nvidia-smi")
        .args(["-i", pci])
        .args(["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut parts = text.trim().split(',').map(|p| p.trim());
    let name = parts.next().unwrap_or("").to_string();
    let vram = parts.next().and_then(parse_nvidia_smi_memory_mb)?;
    if name.is_empty() {
        return None;
    }
    Some((name, vram))
}

/// NVIDIA GPU model for the card at `pci`. nvidia-smi name first (exact),
/// then the proc `Model:` line, then any NVIDIA GPU's model.
#[cfg(target_os = "linux")]
fn nvidia_name_linux(pci: &str) -> String {
    if let Some((name, _)) = nvidia_smi_info(pci) {
        return name;
    }
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

/// Extract VRAM in MB from a single NVIDIA `information` line. Older drivers
/// write `GPU Memory Size: 10240 MiB` / `Total Memory: 12288 MiB`; modern
/// ones (535+) have no memory line at all. Shared with tests.
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

/// VRAM in MB for the NVIDIA card at `pci`: nvidia-smi `memory.total` first
/// (the only field modern drivers still report), then the proc file.
#[cfg(target_os = "linux")]
fn nvidia_vram_linux(pci: &str) -> Option<u64> {
    if let Some((_, vram)) = nvidia_smi_info(pci) {
        return Some(vram);
    }
    let specific = std::path::Path::new("/proc/driver/nvidia/gpus")
        .join(pci)
        .join("information");
    read_nvidia_vram_from(&specific)
}

/// VRAM in MB from the kernel's `mem_info_vram_total` sysfs attribute
/// (bytes). Exposed by amdgpu, nouveau and Intel discrete GPUs — a driver-
/// agnostic fallback that beats name estimation.
#[cfg(target_os = "linux")]
fn linux_sysfs_vram_mb(dev: &std::path::Path) -> Option<u64> {
    let raw = std::fs::read_to_string(dev.join("mem_info_vram_total")).ok()?;
    let bytes = raw.trim().parse::<u64>().ok()?;
    if bytes > 0 {
        Some(bytes / 1_048_576)
    } else {
        None
    }
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

    #[test]
    fn nvidia_smi_parses_memory_total_mib() {
        // nvidia-smi `--format=csv,noheader,nounits` reports MiB as a plain
        // number — the source of truth for modern drivers that dropped the
        // memory line from /proc/driver/nvidia/gpus/*/information.
        assert_eq!(parse_nvidia_smi_memory_mb("24576"), Some(24576));
        assert_eq!(parse_nvidia_smi_memory_mb("12288 MiB"), Some(12288));
        assert_eq!(parse_nvidia_smi_memory_mb("0"), None);
        assert_eq!(parse_nvidia_smi_memory_mb("N/A"), None);
    }
}