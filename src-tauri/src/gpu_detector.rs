use serde::Serialize;
#[cfg(windows)]
use wmi::{COMLibrary, WMIConnection};

/// Serializable GPU info matching the frontend GpuInfo type.
#[derive(Debug, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub vram_mb: u64,
    /// PCI `vendor:device` identifier (e.g. `10de:2c05`) used to target the
    /// GPU through `MESA_VK_DEVICE_SELECT` / `VK_LOADER_DEVICE_SELECT`.
    /// Linux only — `None` elsewhere.
    pub pci_id: Option<String>,
    /// PCI slot (e.g. `0000:01:00.0`) — unique even for identical cards.
    /// Used to build the Mesa `DRI_PRIME=pci-…` selector. Linux only.
    pub pci_slot: Option<String>,
    /// Vulkan `deviceUUID` (32 lowercase hex chars, no dashes). This is what
    /// `DXVK_FILTER_DEVICE_UUID` expects and the only reliable way to tell
    /// two identical GPUs apart. Linux only — `None` elsewhere.
    pub vulkan_uuid: Option<String>,
    /// Position in the Vulkan physical-device enumeration (the index the
    /// `vkdevicechooser` layer expects). Linux only.
    pub vulkan_index: Option<u32>,
    /// RandR provider name of the GPU's offload screen (e.g. `NVIDIA-G0`),
    /// fed to `__NV_PRIME_RENDER_OFFLOAD_PROVIDER`. Linux/X11 only.
    pub nvidia_provider: Option<String>,
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
                            } else if vendor_display.to_lowercase().contains("nvidia") {
                                // WMI gave 0 / a truncated value — ask nvidia-smi for the
                                // exact total (it reports MiB with `nounits`). nvidia-smi
                                // only ever lists NVIDIA GPUs, so querying it for other
                                // vendors (Intel iGPU, basic render adapter) would spawn a
                                // console process for a guaranteed miss.
                                match windows_nvidia_smi_vram_mb(&name) {
                                    Some(nv) => nv,
                                    None => estimate_vram_from_name(&name),
                                }
                            } else {
                                // Neither WMI nor nvidia-smi produced a value — estimate from name
                                estimate_vram_from_name(&name)
                            };

                            gpus.push(GpuInfo {
                                id: format!("gpu-{}", idx),
                                name,
                                vendor: vendor_display,
                                vram_mb,
                                pci_id: None,
                                pci_slot: None,
                                vulkan_uuid: None,
                                vulkan_index: None,
                                nvidia_provider: None,
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
    use std::os::windows::process::CommandExt;

    if !crate::compatibility::is_command_available("nvidia-smi") {
        return None;
    }
    let out = std::process::Command::new("nvidia-smi")
        .args(["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"])
        // CREATE_NO_WINDOW: this runs from a GUI-subsystem process, so without
        // it Windows flashes a console window for every spawned nvidia-smi.
        .creation_flags(0x08000000)
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
/// driver, one card per display head) is listed once, sorted by PCI slot so
/// `gpu-N` ids are stable across boots. Shared by both `detect_gpus` and the
/// metrics collector so a `gpu-N` id maps to the same card on both sides.
#[cfg(target_os = "linux")]
pub(crate) fn linux_drm_cards() -> Vec<std::path::PathBuf> {
    use std::fs;
    let mut cards: Vec<(String, std::path::PathBuf)> = Vec::new();
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
            if !pci_slot.is_empty() && !seen_pci.insert(pci_slot.clone()) {
                continue;
            }
            cards.push((pci_slot, entry.path()));
        }
    }
    cards.sort_by(|a, b| a.0.cmp(&b.0));
    cards.into_iter().map(|(_, path)| path).collect()
}

/// NVIDIA's PCI vendor id as sysfs reports it in `.../device/vendor`.
#[cfg(any(target_os = "linux", test))]
fn is_nvidia_vendor(vendor: &str) -> bool {
    vendor.trim().eq_ignore_ascii_case("0x10de")
}

/// True when any DRM card belongs to NVIDIA. Reads sysfs only, so it is cheap
/// enough for the pre-GTK startup path — `detect_gpus` shells out to
/// vulkaninfo/nvidia-smi/xrandr and is not.
#[cfg(target_os = "linux")]
pub fn has_nvidia_drm_device() -> bool {
    linux_drm_cards().iter().any(|card| {
        std::fs::read_to_string(card.join("device/vendor"))
            .map(|vendor| is_nvidia_vendor(&vendor))
            .unwrap_or(false)
    })
}

/// Parse the PCI vendor:device id from a sysfs `uevent` body. The kernel
/// writes `PCI_ID=10DE:2C05` (uppercase); normalize to the lowercase
/// `10de:2c05` form `MESA_VK_DEVICE_SELECT` expects. Shared with tests.
#[cfg(any(target_os = "linux", test))]
fn parse_pci_id_from_uevent(uevent: &str) -> Option<String> {
    uevent
        .lines()
        .find_map(|l| l.strip_prefix("PCI_ID="))
        .map(|v| v.trim().to_lowercase())
        .filter(|v| !v.is_empty())
}

/// Normalize a sysfs vendor/device pair (`0x10de`, `0x2c05`) into
/// `10de:2c05`. Returns `None` when either half is missing. Shared with tests.
#[cfg(any(target_os = "linux", test))]
fn format_pci_id(vendor: &str, device: &str) -> Option<String> {
    fn normalize(raw: &str) -> String {
        raw.trim()
            .trim_start_matches("0x")
            .trim_start_matches("0X")
            .to_lowercase()
    }
    let vendor = normalize(vendor);
    let device = normalize(device);
    if vendor.is_empty() || device.is_empty() {
        return None;
    }
    Some(format!("{}:{}", vendor, device))
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
        let pci_id = parse_pci_id_from_uevent(&uevent).or_else(|| {
            fs::read_to_string(dev.join("device"))
                .ok()
                .and_then(|device| format_pci_id(&vendor_id, &device))
        });
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
        let gpu_name = match vendor {
            "NVIDIA" => nvidia_name_linux(&pci_slot),
            "AMD" => amd_name_linux(&pci_slot, pci_id.as_deref(), &dev),
            "Intel" => intel_name_linux(&pci_slot, pci_id.as_deref(), &dev),
            _ => format!("{} GPU ({})", vendor, pci_slot),
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
            pci_id,
            pci_slot: (!pci_slot.is_empty()).then_some(pci_slot),
            vulkan_uuid: None,
            vulkan_index: None,
            nvidia_provider: None,
        });
        idx += 1;
    }

    // Enrich with data only the Vulkan/RandR layers know: deviceUUID is the
    // only identifier that tells two identical GPUs apart, vulkan_index
    // drives the vkdevicechooser layer, and the RandR provider selects the
    // OpenGL offload screen. All optional — a missing vulkaninfo/xrandr
    // just leaves the fields empty and the launch falls back to the
    // vendor:device selectors.
    assign_vulkan_info(&mut gpus, &query_vulkan_devices());
    if gpus.iter().any(|g| g.vendor == "NVIDIA") {
        let (first_provider_is_nvidia, gpu_screens) = query_nvidia_providers();
        assign_nvidia_providers(&mut gpus, first_provider_is_nvidia, &gpu_screens);
    }

    gpus
}

/// A physical device as reported by `vulkaninfo --summary`.
#[cfg(any(target_os = "linux", test))]
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct VulkanDevice {
    /// Position in the Vulkan device enumeration (`GPU0` → 0).
    pub index: u32,
    /// Normalized PCI vendor id (lowercase, no `0x`), e.g. `10de`.
    pub vendor_id: String,
    /// Normalized PCI device id (lowercase, no `0x`), e.g. `2c05`.
    pub device_id: String,
    pub name: String,
    /// `deviceUUID` as 32 lowercase hex chars, when the driver reports one.
    pub uuid: Option<String>,
    pub is_cpu: bool,
}

/// Parse the `Devices:` section of `vulkaninfo --summary` into one entry per
/// physical device. CPU/software devices are kept (their index still counts
/// towards `VULKAN_DEVICE_INDEX`) but flagged via `is_cpu`. Shared with tests.
#[cfg(any(target_os = "linux", test))]
pub(crate) fn parse_vulkaninfo_summary(output: &str) -> Vec<VulkanDevice> {
    let mut devices: Vec<VulkanDevice> = Vec::new();
    let mut in_devices = false;
    let mut current: Option<VulkanDevice> = None;

    let flush = |current: &mut Option<VulkanDevice>, devices: &mut Vec<VulkanDevice>| {
        if let Some(dev) = current.take() {
            if dev.index != u32::MAX {
                devices.push(dev);
            }
        }
    };

    for raw in output.lines() {
        let line = raw.trim();
        if line == "Devices:" {
            in_devices = true;
            continue;
        }
        if !in_devices {
            continue;
        }
        if let Some(rest) = line.strip_prefix("GPU") {
            if let Some(digits) = rest.strip_suffix(':') {
                flush(&mut current, &mut devices);
                let index = digits.trim().parse::<u32>().unwrap_or(u32::MAX);
                current = Some(VulkanDevice {
                    index,
                    vendor_id: String::new(),
                    device_id: String::new(),
                    name: String::new(),
                    uuid: None,
                    is_cpu: false,
                });
                continue;
            }
        }
        let Some(dev) = current.as_mut() else { continue };
        let Some((key, value)) = line.split_once('=') else { continue };
        let key = key.trim();
        let value = value.trim();
        match key {
            "vendorID" => dev.vendor_id = normalize_hex_id(value),
            "deviceID" => dev.device_id = normalize_hex_id(value),
            "deviceName" => dev.name = value.to_string(),
            "deviceUUID" => dev.uuid = normalize_vulkan_uuid(value),
            "deviceType" if value == "PHYSICAL_DEVICE_TYPE_CPU" => dev.is_cpu = true,
            _ => {}
        }
    }
    flush(&mut current, &mut devices);
    devices
}

/// `0x10de` → `10de`, `2C05` → `2c05`.
#[cfg(any(target_os = "linux", test))]
fn normalize_hex_id(raw: &str) -> String {
    raw.trim()
        .trim_start_matches("0x")
        .trim_start_matches("0X")
        .to_lowercase()
}

/// `b5291141-3ff6-…` → `b52911413ff6…` (32 hex chars), or `None` when the
/// value isn't a full UUID. Shared with tests and the launch env matrix.
pub(crate) fn normalize_vulkan_uuid(raw: &str) -> Option<String> {
    let cleaned: String = raw
        .chars()
        .filter(|c| c.is_ascii_hexdigit())
        .collect::<String>()
        .to_lowercase();
    (cleaned.len() == 32).then_some(cleaned)
}

/// Clean driver-internal or architecture tags from Vulkan device names.
/// E.g. "AMD Radeon RX 6700 XT (RADV NAVI22)" -> "AMD Radeon RX 6700 XT",
/// "Mesa Intel(R) UHD Graphics 630 (CFL GT2)" -> "Intel(R) UHD Graphics 630",
/// "NVIDIA GeForce GTX 1080 (NVK)" -> "NVIDIA GeForce GTX 1080".
#[cfg(any(target_os = "linux", test))]
pub(crate) fn clean_vulkan_gpu_name(raw: &str) -> String {
    let mut name = raw.trim();
    if let Some(rest) = name.strip_prefix("Mesa ") {
        name = rest.trim();
    }
    if let Some(open_paren) = name.rfind(" (") {
        if name.ends_with(')') {
            let tag = &name[open_paren + 2..name.len() - 1];
            if tag.starts_with("RADV")
                || tag.starts_with("AMDVLK")
                || tag == "NVK"
                || tag.starts_with("DG")
                || tag.starts_with("ACM")
                || tag.starts_with("BMG")
                || tag.contains("GT")
            {
                name = name[..open_paren].trim();
            }
        }
    }
    name.to_string()
}

/// Check if a GPU name is a placeholder or generic label that lacks model specificity.
#[cfg(any(target_os = "linux", test))]
pub(crate) fn is_generic_gpu_name(name: &str) -> bool {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return true;
    }
    let lower = trimmed.to_lowercase();
    lower == "nvidia gpu"
        || lower == "amd gpu"
        || lower == "amd radeon gpu"
        || lower == "intel gpu"
        || lower == "intel graphics"
        || lower == "unknown gpu"
        || lower.starts_with("amd gpu (")
        || lower.starts_with("amd radeon gpu (")
        || lower.starts_with("intel gpu (")
        || lower.starts_with("intel graphics (")
        || lower.starts_with("unknown gpu (")
        || lower.contains("unknown")
}

/// Decide if the Vulkan device name should supersede the currently assigned GPU name.
#[cfg(any(target_os = "linux", test))]
pub(crate) fn should_prefer_vulkan_name(vulkan_name: &str, current: &str) -> bool {
    if is_generic_gpu_name(current) {
        return true;
    }
    // If the current name contains multi-model slash chains or brackets (from PCI tables)
    // and Vulkan provides a single concrete marketing name, prefer Vulkan.
    if (current.contains('/') || current.contains('['))
        && !vulkan_name.contains('/')
        && !vulkan_name.contains('[')
    {
        return true;
    }
    let cur_lower = current.to_lowercase();
    let vulk_lower = vulkan_name.to_lowercase();
    if !cur_lower.contains("radeon") && vulk_lower.contains("radeon") {
        return true;
    }
    if !cur_lower.contains("geforce") && vulk_lower.contains("geforce") {
        return true;
    }
    if !cur_lower.contains("arc") && vulk_lower.contains("arc") {
        return true;
    }
    false
}

/// Map Vulkan devices onto the detected DRM cards. The Vulkan loader sorts
/// physical devices by PCI bus info, which is the same order as
/// `linux_drm_cards` — so when several cards share a `vendor:device` id (two
/// identical GPUs) the Nth Vulkan device goes to the Nth card by PCI slot.
/// Shared with tests.
#[cfg(any(target_os = "linux", test))]
pub(crate) fn assign_vulkan_info(gpus: &mut [GpuInfo], vulkan: &[VulkanDevice]) {
    use std::collections::HashMap;

    let mut by_pci: HashMap<String, Vec<&VulkanDevice>> = HashMap::new();
    for dev in vulkan
        .iter()
        .filter(|d| !d.is_cpu && !d.vendor_id.is_empty() && !d.device_id.is_empty())
    {
        by_pci
            .entry(format!("{}:{}", dev.vendor_id, dev.device_id))
            .or_default()
            .push(dev);
    }

    for (pci_id, devices) in by_pci {
        let mut indices: Vec<usize> = gpus
            .iter()
            .enumerate()
            .filter(|(_, gpu)| gpu.pci_id.as_deref() == Some(pci_id.as_str()))
            .map(|(i, _)| i)
            .collect();
        if indices.is_empty() {
            continue;
        }
        indices.sort_by(|&a, &b| gpus[a].pci_slot.cmp(&gpus[b].pci_slot));
        let mut devices = devices;
        devices.sort_by_key(|d| d.index);
        for (gpu_index, dev) in indices.into_iter().zip(devices) {
            gpus[gpu_index].vulkan_index = Some(dev.index);
            gpus[gpu_index].vulkan_uuid = dev.uuid.clone();
            if !dev.name.is_empty() {
                let clean = clean_vulkan_gpu_name(&dev.name);
                if !clean.is_empty()
                    && (is_generic_gpu_name(&gpus[gpu_index].name)
                        || should_prefer_vulkan_name(&clean, &gpus[gpu_index].name))
                {
                    gpus[gpu_index].name = clean;
                }
            }
            if gpus[gpu_index].vram_mb == 0 {
                gpus[gpu_index].vram_mb = estimate_vram_from_name(&gpus[gpu_index].name);
            }
        }
    }
}

/// Pull the RandR provider names out of `xrandr --listproviders`. Returns
/// whether the X screen itself runs on an NVIDIA GPU (first provider) and,
/// in order, the `NVIDIA-G<n>` GPU-screen names (the OpenGL offload
/// sources). Shared with tests.
#[cfg(target_os = "linux")]
pub(crate) fn parse_xrandr_providers(output: &str) -> (bool, Vec<String>) {
    let mut names: Vec<String> = Vec::new();
    for line in output.lines() {
        if let Some(pos) = line.find("name:") {
            let name = line[pos + "name:".len()..].trim().to_string();
            if !name.is_empty() {
                names.push(name);
            }
        }
    }
    let first_provider_is_nvidia = names
        .first()
        .is_some_and(|name| name.starts_with("NVIDIA-"));
    let gpu_screens = names
        .into_iter()
        .filter(|name| name.starts_with("NVIDIA-G"))
        .collect();
    (first_provider_is_nvidia, gpu_screens)
}

/// Attach each offload GPU screen (`NVIDIA-G0`, `NVIDIA-G1`, …) to the
/// matching NVIDIA adapter. GPU screens are created in PCI order; when the X
/// screen itself runs on NVIDIA it occupies the first adapter and gets no
/// provider (it is the sink, not an offload source). Shared with tests.
#[cfg(target_os = "linux")]
pub(crate) fn assign_nvidia_providers(
    gpus: &mut [GpuInfo],
    first_provider_is_nvidia: bool,
    gpu_screens: &[String],
) {
    if gpu_screens.is_empty() {
        return;
    }
    let mut indices: Vec<usize> = gpus
        .iter()
        .enumerate()
        .filter(|(_, gpu)| gpu.vendor == "NVIDIA")
        .map(|(i, _)| i)
        .collect();
    indices.sort_by(|&a, &b| gpus[a].pci_slot.cmp(&gpus[b].pci_slot));
    let skip_primary = usize::from(first_provider_is_nvidia && !indices.is_empty());
    for (gpu_index, provider) in indices.into_iter().skip(skip_primary).zip(gpu_screens) {
        gpus[gpu_index].nvidia_provider = Some(provider.clone());
    }
}

/// Run a short-lived helper (`vulkaninfo`, `xrandr`) without ever letting it
/// wedge hardware detection: stdout/stderr are captured and the child is
/// killed after `timeout`. Returns `None` when the binary is missing, exits
/// non-zero, or overruns the deadline.
#[cfg(target_os = "linux")]
fn run_command_timeout(
    program: &str,
    args: &[&str],
    timeout: std::time::Duration,
) -> Option<std::process::Output> {
    use std::process::{Command, Stdio};

    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;
    let deadline = std::time::Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return child.wait_with_output().ok(),
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            Err(_) => return None,
        }
    }
}

/// `vulkaninfo --summary`, or an empty list when the tool isn't installed.
#[cfg(target_os = "linux")]
fn query_vulkan_devices() -> Vec<VulkanDevice> {
    let Some(output) = run_command_timeout(
        "vulkaninfo",
        &["--summary"],
        std::time::Duration::from_secs(4),
    ) else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    parse_vulkaninfo_summary(&String::from_utf8_lossy(&output.stdout))
}

/// `xrandr --listproviders`, or an empty result on Wayland/headless sessions.
#[cfg(target_os = "linux")]
fn query_nvidia_providers() -> (bool, Vec<String>) {
    if std::env::var_os("DISPLAY").is_none() {
        return (false, Vec::new());
    }
    let Some(output) = run_command_timeout(
        "xrandr",
        &["--listproviders"],
        std::time::Duration::from_secs(2),
    ) else {
        return (false, Vec::new());
    };
    if !output.status.success() {
        return (false, Vec::new());
    }
    parse_xrandr_providers(&String::from_utf8_lossy(&output.stdout))
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

/// Extract clean marketing name from a PCI database description (e.g. from udevadm,
/// lspci, or pci.ids). Handles bracketed marketing names like
/// "Navi 22 [Radeon RX 6700/6700 XT/6750 XT / 6800M/6850M XT]" and strips revision tags.
#[cfg(any(target_os = "linux", test))]
pub(crate) fn clean_pci_database_name(raw: &str, vendor: &str) -> String {
    let mut text = raw.trim();

    // Strip trailing revision if present, e.g. " (rev e7)" or " (rev c1)"
    if let Some(pos) = text.rfind(" (rev ") {
        if text.ends_with(')') {
            text = text[..pos].trim();
        }
    }

    // Find bracketed marketing names like [Radeon RX 6700/6700 XT...]
    let mut candidates: Vec<&str> = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find('[') {
        if let Some(end) = rest[start + 1..].find(']') {
            let inside = rest[start + 1..start + 1 + end].trim();
            // Skip vendor brackets like [AMD/ATI]
            if inside != "AMD/ATI" && !inside.is_empty() {
                candidates.push(inside);
            }
            rest = &rest[start + 1 + end + 1..];
        } else {
            break;
        }
    }

    let model = if let Some(bracketed) = candidates.last() {
        bracketed.to_string()
    } else {
        let stripped = text
            .strip_prefix("Advanced Micro Devices, Inc. [AMD/ATI]")
            .or_else(|| text.strip_prefix("Advanced Micro Devices, Inc."))
            .or_else(|| text.strip_prefix("Intel Corporation"))
            .unwrap_or(text)
            .trim();
        stripped.to_string()
    };

    let lower = model.to_lowercase();
    match vendor {
        "AMD" => {
            if lower.starts_with("amd ") {
                model
            } else if lower.starts_with("radeon ") || lower.starts_with("custom gpu") {
                format!("AMD {}", model)
            } else {
                format!("AMD Radeon {}", model)
            }
        }
        "Intel" => {
            if lower.starts_with("intel ") || lower.starts_with("intel(r)") {
                model
            } else {
                format!("Intel {}", model)
            }
        }
        _ => model,
    }
}

/// Known PCI device ID table for common AMD Radeon GPUs and APUs.
#[cfg(any(target_os = "linux", test))]
pub(crate) fn amd_pci_device_name(device_hex: &str) -> Option<&'static str> {
    let clean = device_hex
        .trim()
        .trim_start_matches("0x")
        .trim_start_matches("0X")
        .to_lowercase();

    match clean.as_str() {
        // ─── RDNA 4 (RX 9000 series) ───
        "7490" => Some("AMD Radeon RX 9070 XT"),
        "7491" => Some("AMD Radeon RX 9070"),
        "7492" => Some("AMD Radeon RX 9060 XT"),

        // ─── RDNA 3 (RX 7000 series) ───
        "744c" => Some("AMD Radeon RX 7900 XTX"),
        "7448" => Some("AMD Radeon RX 7900 XT"),
        "745c" => Some("AMD Radeon RX 7900 GRE"),
        "747e" => Some("AMD Radeon RX 7800 XT"),
        "7470" => Some("AMD Radeon RX 7700 XT"),
        "7480" => Some("AMD Radeon RX 7600 / 7600 XT"),

        // ─── RDNA 2 (RX 6000 series) ───
        "73bf" => Some("AMD Radeon RX 6800 / 6800 XT / 6900 XT"),
        "73df" => Some("AMD Radeon RX 6700 XT / 6750 XT"),
        "73ff" => Some("AMD Radeon RX 6600 / 6600 XT / 6650 XT"),
        "743f" => Some("AMD Radeon RX 6400 / 6500 XT"),

        // ─── RDNA 1 (RX 5000 series) ───
        "731f" | "73a5" => Some("AMD Radeon RX 5700 / 5700 XT"),
        "7340" => Some("AMD Radeon RX 5500 / 5500 XT"),

        // ─── Vega ───
        "687f" => Some("AMD Radeon RX Vega 56 / 64"),
        "6867" => Some("AMD Radeon Vega Frontier Edition"),
        "66af" => Some("AMD Radeon VII"),

        // ─── Polaris (RX 400 / 500 series) ───
        "67df" => Some("AMD Radeon RX 470 / 480 / 570 / 580 / 590"),
        "67c0" => Some("AMD Radeon Pro WX 7100"),
        "67ef" => Some("AMD Radeon RX 460 / 560"),
        "67ff" => Some("AMD Radeon RX 550 / 560"),
        "699f" => Some("AMD Radeon RX 550"),

        // ─── Custom / Handheld (Steam Deck & APUs) ───
        "163f" | "0405" => Some("AMD Custom GPU 0405 (Steam Deck)"),
        "1435" => Some("AMD Custom GPU 0405 (Steam Deck OLED)"),
        "15bf" => Some("AMD Radeon 680M"),
        "15c8" => Some("AMD Radeon 660M"),
        "15e7" => Some("AMD Radeon 780M"),
        "15e8" => Some("AMD Radeon 760M"),
        "15e9" => Some("AMD Radeon 740M"),
        "1900" => Some("AMD Radeon 890M"),
        "1901" => Some("AMD Radeon 880M"),

        _ => None,
    }
}

/// Known PCI device ID table for common Intel discrete and integrated graphics.
#[cfg(any(target_os = "linux", test))]
pub(crate) fn intel_pci_device_name(device_hex: &str) -> Option<&'static str> {
    let clean = device_hex
        .trim()
        .trim_start_matches("0x")
        .trim_start_matches("0X")
        .to_lowercase();

    match clean.as_str() {
        // ─── Intel Arc Alchemist ───
        "56a0" => Some("Intel Arc A770"),
        "56a1" => Some("Intel Arc A750"),
        "56a2" => Some("Intel Arc A580"),
        "56a5" => Some("Intel Arc A380"),
        "56a6" => Some("Intel Arc A310"),
        "56b0" => Some("Intel Arc Pro A60"),
        "56b1" => Some("Intel Arc Pro A40 / A50"),
        "5690" => Some("Intel Arc A770M"),
        "5691" => Some("Intel Arc A730M"),
        "5692" => Some("Intel Arc A550M"),
        "5693" => Some("Intel Arc A370M"),
        "5694" => Some("Intel Arc A350M"),

        // ─── Intel Arc Battlemage ───
        "e20b" => Some("Intel Arc B580"),
        "e202" => Some("Intel Arc B570"),

        // ─── Intel Integrated ───
        "46a6" | "9a49" => Some("Intel Iris Xe Graphics"),
        "9bc5" | "3e92" => Some("Intel UHD Graphics 630"),
        "5912" => Some("Intel HD Graphics 630"),

        _ => None,
    }
}

/// Search for a device model name in standard Linux pci.ids files.
#[cfg(any(target_os = "linux", test))]
#[allow(dead_code)]
fn query_pci_ids_file(vendor_hex: &str, device_hex: &str) -> Option<String> {
    use std::fs::File;
    use std::io::{BufRead, BufReader};

    let candidates = [
        "/usr/share/hwdata/pci.ids",
        "/usr/share/misc/pci.ids",
        "/usr/share/pci.ids",
        "/var/lib/pciutils/pci.ids",
    ];
    let path = candidates.iter().find(|p| std::path::Path::new(p).exists())?;
    let file = File::open(path).ok()?;
    let reader = BufReader::new(file);

    let v_lower = vendor_hex
        .trim()
        .trim_start_matches("0x")
        .trim_start_matches("0X")
        .to_lowercase();
    let d_lower = device_hex
        .trim()
        .trim_start_matches("0x")
        .trim_start_matches("0X")
        .to_lowercase();

    let mut in_vendor = false;
    for line in reader.lines().flatten() {
        if line.starts_with('#') || line.is_empty() {
            continue;
        }
        if !line.starts_with('\t') {
            if in_vendor {
                break;
            }
            let mut parts = line.split_whitespace();
            if let Some(v) = parts.next() {
                in_vendor = v.eq_ignore_ascii_case(&v_lower);
            }
            continue;
        }
        if in_vendor && line.starts_with('\t') && !line.starts_with("\t\t") {
            let rest = &line[1..];
            let mut parts = rest.split_whitespace();
            if let Some(d) = parts.next() {
                if d.eq_ignore_ascii_case(&d_lower) {
                    let desc = rest[d.len()..].trim();
                    if !desc.is_empty() {
                        return Some(desc.to_string());
                    }
                }
            }
        }
    }
    None
}

/// Query udev database via udevadm for device model properties.
#[cfg(target_os = "linux")]
fn query_udevadm_model(dev: &std::path::Path) -> Option<String> {
    let output = run_command_timeout(
        "udevadm",
        &["info", "-p", dev.to_str()?],
        std::time::Duration::from_millis(500),
    )?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut subfs_model = None;
    let mut model = None;
    for line in text.lines() {
        if let Some(val) = line.strip_prefix("E: ID_PCI_SUBFS_MODEL_FROM_DATABASE=") {
            let v = val.trim();
            if !v.is_empty() {
                subfs_model = Some(v.to_string());
            }
        } else if let Some(val) = line.strip_prefix("E: ID_MODEL_FROM_DATABASE=") {
            let v = val.trim();
            if !v.is_empty() {
                model = Some(v.to_string());
            }
        }
    }
    subfs_model.or(model)
}

/// Query lspci for subsystem device or base device name.
#[cfg(target_os = "linux")]
fn query_lspci_device(pci_slot: &str) -> Option<String> {
    if pci_slot.is_empty() {
        return None;
    }
    let output = run_command_timeout(
        "lspci",
        &["-vmm", "-s", pci_slot],
        std::time::Duration::from_millis(500),
    )?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut sdevice = None;
    let mut device = None;
    for line in text.lines() {
        if let Some((k, v)) = line.split_once(':') {
            let key = k.trim();
            let val = v.trim();
            if key == "SDevice" && !val.is_empty() {
                sdevice = Some(val.to_string());
            } else if key == "Device" && !val.is_empty() {
                device = Some(val.to_string());
            }
        }
    }
    sdevice.or(device)
}

/// Detect AMD GPU model name on Linux via udevadm, lspci, pci.ids, or built-in PCI table.
#[cfg(target_os = "linux")]
fn amd_name_linux(pci_slot: &str, pci_id: Option<&str>, dev: &std::path::Path) -> String {
    let device_hex = pci_id.and_then(|id| id.split_once(':').map(|(_, d)| d.trim()));

    // 1. Check udevadm for specific board/subsystem name (e.g. "Radeon RX 6700 XT Pulse")
    if let Some(model) = query_udevadm_model(dev) {
        let cleaned = clean_pci_database_name(&model, "AMD");
        if !cleaned.is_empty() && !is_generic_gpu_name(&cleaned) {
            return cleaned;
        }
    }

    // 2. Check lspci -vmm (SDevice gives the specific board/model)
    if let Some(model) = query_lspci_device(pci_slot) {
        let cleaned = clean_pci_database_name(&model, "AMD");
        if !cleaned.is_empty() && !is_generic_gpu_name(&cleaned) {
            return cleaned;
        }
    }

    // 3. Check built-in table for clean marketing names (e.g. "AMD Radeon RX 6700 XT / 6750 XT")
    if let Some(dev_id) = device_hex {
        if let Some(name) = amd_pci_device_name(dev_id) {
            return name.to_string();
        }
    }

    // 4. Check system pci.ids database
    if let Some(dev_id) = device_hex {
        if let Some(model) = query_pci_ids_file("1002", dev_id) {
            let cleaned = clean_pci_database_name(&model, "AMD");
            if !cleaned.is_empty() && !is_generic_gpu_name(&cleaned) {
                return cleaned;
            }
        }
    }

    // 5. Fallback
    if !pci_slot.is_empty() {
        format!("AMD Radeon GPU ({})", pci_slot)
    } else {
        "AMD Radeon GPU".to_string()
    }
}

/// Detect Intel GPU model name on Linux via udevadm, lspci, pci.ids, or built-in PCI table.
#[cfg(target_os = "linux")]
fn intel_name_linux(pci_slot: &str, pci_id: Option<&str>, dev: &std::path::Path) -> String {
    let device_hex = pci_id.and_then(|id| id.split_once(':').map(|(_, d)| d.trim()));

    if let Some(model) = query_udevadm_model(dev) {
        let cleaned = clean_pci_database_name(&model, "Intel");
        if !cleaned.is_empty() && !is_generic_gpu_name(&cleaned) {
            return cleaned;
        }
    }

    if let Some(model) = query_lspci_device(pci_slot) {
        let cleaned = clean_pci_database_name(&model, "Intel");
        if !cleaned.is_empty() && !is_generic_gpu_name(&cleaned) {
            return cleaned;
        }
    }

    if let Some(dev_id) = device_hex {
        if let Some(name) = intel_pci_device_name(dev_id) {
            return name.to_string();
        }
        if let Some(model) = query_pci_ids_file("8086", dev_id) {
            let cleaned = clean_pci_database_name(&model, "Intel");
            if !cleaned.is_empty() && !is_generic_gpu_name(&cleaned) {
                return cleaned;
            }
        }
    }

    if !pci_slot.is_empty() {
        format!("Intel Graphics ({})", pci_slot)
    } else {
        "Intel Graphics".to_string()
    }
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
#[cfg(windows)]
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

    #[test]
    fn pci_id_reads_from_drm_uevent() {
        let uevent = "DRIVER=nvidia\nPCI_CLASS=30000\nPCI_ID=10DE:2C05\nPCI_SLOT_NAME=0000:01:00.0\n";
        assert_eq!(parse_pci_id_from_uevent(uevent), Some("10de:2c05".to_string()));
        // The amdgpu/radeon sysfs uevent exposes the same line.
        assert_eq!(
            parse_pci_id_from_uevent("PCI_ID=1002:744C\n"),
            Some("1002:744c".to_string())
        );
    }

    #[test]
    fn pci_id_is_none_when_absent_or_incomplete() {
        assert_eq!(parse_pci_id_from_uevent("PCI_SLOT_NAME=0000:01:00.0\n"), None);
        assert_eq!(parse_pci_id_from_uevent(""), None);
        assert_eq!(parse_pci_id_from_uevent("PCI_ID=\n"), None);
        assert_eq!(format_pci_id("", "0x2c05"), None);
        assert_eq!(format_pci_id("0x10de", ""), None);
    }

    #[test]
    fn nvidia_vendor_id_is_recognized() {
        // sysfs appends a newline, and hex case varies by kernel.
        assert!(is_nvidia_vendor("0x10de\n"));
        assert!(is_nvidia_vendor("0X10DE\n"));
    }

    #[test]
    fn non_nvidia_vendor_ids_are_rejected() {
        // AMD and Intel are the vendors that must keep the DMA-BUF path.
        assert!(!is_nvidia_vendor("0x1002\n"));
        assert!(!is_nvidia_vendor("0x8086\n"));
        assert!(!is_nvidia_vendor(""));
        assert!(!is_nvidia_vendor("10de"));
    }

    #[test]
    fn pci_id_falls_back_to_vendor_and_device_files() {
        assert_eq!(
            format_pci_id("0x10de\n", "0x2c05\n"),
            Some("10de:2c05".to_string())
        );
        assert_eq!(
            format_pci_id("0x1002", "0X744C"),
            Some("1002:744c".to_string())
        );
    }

    fn test_gpu(id: &str, vendor: &str, pci_id: &str, slot: &str) -> GpuInfo {
        GpuInfo {
            id: id.to_string(),
            vendor: vendor.to_string(),
            pci_id: Some(pci_id.to_string()),
            pci_slot: Some(slot.to_string()),
            ..Default::default()
        }
    }

    const SAMPLE_VULKANINFO: &str = "\
==========
VULKANINFO
==========

Vulkan Instance Version: 1.3.275

Some Layer = noise before the device list

Devices:
========
GPU0:
\tapiVersion         = 1.3.260
\tvendorID           = 0x10de
\tdeviceID           = 0x1e84
\tdeviceType         = PHYSICAL_DEVICE_TYPE_DISCRETE_GPU
\tdeviceName         = NVIDIA GeForce RTX 2070 SUPER
\tdeviceUUID         = b5291141-3ff6-f8bf-c85d-2f8e52fc144d
\tdriverUUID         = 468717c2-5245-5d6d-9401-72b8a4ff98e5
GPU1:
\tapiVersion         = 1.3.275
\tvendorID           = 0x10005
\tdeviceID           = 0x0000
\tdeviceType         = PHYSICAL_DEVICE_TYPE_CPU
\tdeviceName         = llvmpipe (LLVM 17.0.6, 256 bits)
\tdeviceUUID         = 00000000-0000-0000-0000-000000000000
GPU2:
\tapiVersion         = 1.3.274
\tvendorID           = 0x1002
\tdeviceID           = 0x744c
\tdeviceType         = PHYSICAL_DEVICE_TYPE_DISCRETE_GPU
\tdeviceName         = AMD Radeon RX 7900 XTX (RADV NAVI31)
\tdeviceUUID         = 11111111-2222-3333-4444-555555555555
";

    #[test]
    fn vulkaninfo_summary_parses_devices_and_flags_cpu() {
        let devices = parse_vulkaninfo_summary(SAMPLE_VULKANINFO);
        assert_eq!(devices.len(), 3);

        assert_eq!(devices[0].index, 0);
        assert_eq!(devices[0].vendor_id, "10de");
        assert_eq!(devices[0].device_id, "1e84");
        assert_eq!(devices[0].name, "NVIDIA GeForce RTX 2070 SUPER");
        assert_eq!(
            devices[0].uuid.as_deref(),
            Some("b52911413ff6f8bfc85d2f8e52fc144d")
        );
        assert!(!devices[0].is_cpu);

        // The software device keeps its enumeration index but is flagged.
        assert_eq!(devices[1].index, 1);
        assert!(devices[1].is_cpu);

        assert_eq!(devices[2].vendor_id, "1002");
        assert_eq!(devices[2].device_id, "744c");
        assert!(!devices[2].is_cpu);
    }

    #[test]
    fn vulkaninfo_summary_ignores_malformed_uuid() {
        let devices = parse_vulkaninfo_summary(
            "Devices:\nGPU0:\n\tvendorID = 0x10de\n\tdeviceID = 0x2204\n\tdeviceUUID = nope\n",
        );
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].uuid, None);
    }

    #[test]
    fn vulkan_info_assigns_identical_gpus_in_pci_order() {
        // DRM ids are slot-sorted upstream, so the first matching card owns
        // Vulkan device 0 even though the vectors are deliberately reversed.
        let mut gpus = vec![
            test_gpu("gpu-1", "NVIDIA", "10de:2204", "0000:03:00.0"),
            test_gpu("gpu-0", "NVIDIA", "10de:2204", "0000:01:00.0"),
        ];
        let vulkan = vec![
            VulkanDevice {
                index: 0,
                vendor_id: "10de".to_string(),
                device_id: "2204".to_string(),
                name: "RTX 3090".to_string(),
                uuid: Some("aaaaaaaabbbbbbbbccccccccdddddddd".to_string()),
                is_cpu: false,
            },
            VulkanDevice {
                index: 1,
                vendor_id: "10de".to_string(),
                device_id: "2204".to_string(),
                name: "RTX 3090".to_string(),
                uuid: Some("11111111222222223333333344444444".to_string()),
                is_cpu: false,
            },
        ];

        assign_vulkan_info(&mut gpus, &vulkan);

        assert_eq!(gpus[1].vulkan_index, Some(0));
        assert_eq!(
            gpus[1].vulkan_uuid.as_deref(),
            Some("aaaaaaaabbbbbbbbccccccccdddddddd")
        );
        assert_eq!(gpus[0].vulkan_index, Some(1));
        assert_eq!(
            gpus[0].vulkan_uuid.as_deref(),
            Some("11111111222222223333333344444444")
        );
        assert_eq!(gpus[1].name, "RTX 3090");
        assert_eq!(gpus[0].name, "RTX 3090");
    }

    #[test]
    fn vulkan_info_enriches_amd_and_intel_gpu_names() {
        let mut gpus = vec![
            GpuInfo {
                id: "gpu-0".to_string(),
                name: "AMD GPU (0000:04:00.0)".to_string(),
                vendor: "AMD".to_string(),
                pci_id: Some("1002:67df".to_string()),
                pci_slot: Some("0000:04:00.0".to_string()),
                vram_mb: 8192,
                ..Default::default()
            },
            GpuInfo {
                id: "gpu-1".to_string(),
                name: "AMD GPU (0000:09:00.0)".to_string(),
                vendor: "AMD".to_string(),
                pci_id: Some("1002:73df".to_string()),
                pci_slot: Some("0000:09:00.0".to_string()),
                vram_mb: 12272,
                ..Default::default()
            },
        ];
        let vulkan = vec![
            VulkanDevice {
                index: 0,
                vendor_id: "1002".to_string(),
                device_id: "67df".to_string(),
                name: "AMD Radeon RX 580 Series (RADV POLARIS10)".to_string(),
                uuid: Some("11111111111111111111111111111111".to_string()),
                is_cpu: false,
            },
            VulkanDevice {
                index: 1,
                vendor_id: "1002".to_string(),
                device_id: "73df".to_string(),
                name: "AMD Radeon RX 6700 XT (RADV NAVI22)".to_string(),
                uuid: Some("22222222222222222222222222222222".to_string()),
                is_cpu: false,
            },
        ];

        assign_vulkan_info(&mut gpus, &vulkan);

        assert_eq!(gpus[0].name, "AMD Radeon RX 580 Series");
        assert_eq!(gpus[1].name, "AMD Radeon RX 6700 XT");
        assert_eq!(gpus[0].vulkan_index, Some(0));
        assert_eq!(gpus[1].vulkan_index, Some(1));
    }

    #[test]
    fn clean_vulkan_gpu_name_strips_driver_suffixes() {
        assert_eq!(
            clean_vulkan_gpu_name("AMD Radeon RX 6700 XT (RADV NAVI22)"),
            "AMD Radeon RX 6700 XT"
        );
        assert_eq!(
            clean_vulkan_gpu_name("AMD Radeon RX 7900 XTX (RADV NAVI31)"),
            "AMD Radeon RX 7900 XTX"
        );
        assert_eq!(
            clean_vulkan_gpu_name("AMD Radeon RX 580 Series (RADV POLARIS10)"),
            "AMD Radeon RX 580 Series"
        );
        assert_eq!(
            clean_vulkan_gpu_name("AMD Radeon RX 6700 XT"),
            "AMD Radeon RX 6700 XT"
        );
        assert_eq!(
            clean_vulkan_gpu_name("Intel(R) Arc(TM) A770 Graphics (DG2)"),
            "Intel(R) Arc(TM) A770 Graphics"
        );
        assert_eq!(
            clean_vulkan_gpu_name("Mesa Intel(R) UHD Graphics 630 (CFL GT2)"),
            "Intel(R) UHD Graphics 630"
        );
        assert_eq!(
            clean_vulkan_gpu_name("NVIDIA GeForce GTX 1080 (NVK)"),
            "NVIDIA GeForce GTX 1080"
        );
        assert_eq!(
            clean_vulkan_gpu_name("NVIDIA GeForce RTX 3080"),
            "NVIDIA GeForce RTX 3080"
        );
    }

    #[test]
    fn clean_pci_database_name_extracts_clean_marketing_names() {
        assert_eq!(
            clean_pci_database_name("Navi 22 [Radeon RX 6700/6700 XT/6750 XT / 6800M/6850M XT]", "AMD"),
            "AMD Radeon RX 6700/6700 XT/6750 XT / 6800M/6850M XT"
        );
        assert_eq!(
            clean_pci_database_name("Ellesmere [Radeon RX 470/480/570/570X/580/580X/590]", "AMD"),
            "AMD Radeon RX 470/480/570/570X/580/580X/590"
        );
        assert_eq!(
            clean_pci_database_name("Advanced Micro Devices, Inc. [AMD/ATI] Ellesmere [Radeon RX 470/480/570/570X/580/580X/590] (rev e7)", "AMD"),
            "AMD Radeon RX 470/480/570/570X/580/580X/590"
        );
        assert_eq!(
            clean_pci_database_name("Radeon RX 6700 XT Pulse", "AMD"),
            "AMD Radeon RX 6700 XT Pulse"
        );
        assert_eq!(
            clean_pci_database_name("DG2 [Arc A770]", "Intel"),
            "Intel Arc A770"
        );
    }

    #[test]
    fn amd_pci_device_name_resolves_known_cards() {
        assert_eq!(
            amd_pci_device_name("73df"),
            Some("AMD Radeon RX 6700 XT / 6750 XT")
        );
        assert_eq!(
            amd_pci_device_name("67df"),
            Some("AMD Radeon RX 470 / 480 / 570 / 580 / 590")
        );
        assert_eq!(
            amd_pci_device_name("744c"),
            Some("AMD Radeon RX 7900 XTX")
        );
        assert_eq!(
            amd_pci_device_name("163f"),
            Some("AMD Custom GPU 0405 (Steam Deck)")
        );
        assert_eq!(
            amd_pci_device_name("15e7"),
            Some("AMD Radeon 780M")
        );
        assert_eq!(amd_pci_device_name("ffff"), None);
    }

    #[test]
    fn intel_pci_device_name_resolves_known_cards() {
        assert_eq!(intel_pci_device_name("56a0"), Some("Intel Arc A770"));
        assert_eq!(intel_pci_device_name("e20b"), Some("Intel Arc B580"));
        assert_eq!(intel_pci_device_name("46a6"), Some("Intel Iris Xe Graphics"));
        assert_eq!(intel_pci_device_name("ffff"), None);
    }

    #[test]
    fn is_generic_gpu_name_identifies_placeholders() {
        assert!(is_generic_gpu_name("AMD GPU (0000:04:00.0)"));
        assert!(is_generic_gpu_name("AMD GPU (0000:09:00.0)"));
        assert!(is_generic_gpu_name("AMD GPU"));
        assert!(is_generic_gpu_name("NVIDIA GPU"));
        assert!(is_generic_gpu_name("Intel GPU (0000:00:02.0)"));
        assert!(is_generic_gpu_name(""));
        assert!(!is_generic_gpu_name("AMD Radeon RX 6700 XT"));
        assert!(!is_generic_gpu_name("NVIDIA GeForce RTX 3080"));
        assert!(!is_generic_gpu_name("Intel Arc A770"));
    }

    #[test]
    fn should_prefer_vulkan_name_logic() {
        assert!(should_prefer_vulkan_name(
            "AMD Radeon RX 6700 XT",
            "AMD Radeon RX 6700 XT / 6750 XT"
        ));
        assert!(should_prefer_vulkan_name(
            "AMD Radeon RX 6700 XT",
            "AMD GPU (0000:09:00.0)"
        ));
        assert!(!should_prefer_vulkan_name(
            "NVIDIA GeForce RTX 3080",
            "NVIDIA GeForce RTX 3080"
        ));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn xrandr_providers_detects_hybrid_and_dual_nvidia() {
        let hybrid = "\
Providers: number : 2
Provider 0: id: 0x48 cap: 0xf, Source Output, Sink Output, Source Offload, Sink Offload crtcs: 4 outputs: 6 associated providers: 1 name:modesetting
Provider 1: id: 0x257 cap: 0x2, Sink Output crtcs: 4 outputs: 5 associated providers: 1 name:NVIDIA-G0
";
        assert_eq!(
            parse_xrandr_providers(hybrid),
            (false, vec!["NVIDIA-G0".to_string()])
        );

        let dual = "\
Providers: number : 2
Provider 0: id: 0x1b7 cap: 0x1, Source Output crtcs: 4 outputs: 3 associated providers: 1 name:NVIDIA-0
Provider 1: id: 0x378 cap: 0x2, Sink Output crtcs: 4 outputs: 1 associated providers: 1 name:NVIDIA-G0
";
        assert_eq!(
            parse_xrandr_providers(dual),
            (true, vec!["NVIDIA-G0".to_string()])
        );

        assert_eq!(parse_xrandr_providers(""), (false, Vec::new()));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn nvidia_provider_skips_the_x_screen_gpu() {
        // Hybrid: iGPU drives X, so the sole NVIDIA adapter is the G0 source.
        let mut hybrid = vec![
            test_gpu("gpu-0", "Intel", "8086:46a6", "0000:00:02.0"),
            test_gpu("gpu-1", "NVIDIA", "10de:2204", "0000:01:00.0"),
        ];
        assign_nvidia_providers(&mut hybrid, false, &["NVIDIA-G0".to_string()]);
        assert_eq!(hybrid[1].nvidia_provider.as_deref(), Some("NVIDIA-G0"));

        // Dual NVIDIA: the X screen adapter is a sink and gets no provider.
        let mut dual = vec![
            test_gpu("gpu-0", "NVIDIA", "10de:2684", "0000:01:00.0"),
            test_gpu("gpu-1", "NVIDIA", "10de:2204", "0000:03:00.0"),
        ];
        assign_nvidia_providers(&mut dual, true, &["NVIDIA-G0".to_string()]);
        assert_eq!(dual[0].nvidia_provider, None);
        assert_eq!(dual[1].nvidia_provider.as_deref(), Some("NVIDIA-G0"));

        // No GPU screens (single NVIDIA driving the display) → no change.
        let mut single = vec![test_gpu("gpu-0", "NVIDIA", "10de:2684", "0000:01:00.0")];
        assign_nvidia_providers(&mut single, true, &[]);
        assert_eq!(single[0].nvidia_provider, None);
    }

    #[test]
    fn normalize_vulkan_uuid_strips_dashes_and_rejects_partial() {
        assert_eq!(
            normalize_vulkan_uuid("B5291141-3FF6-F8BF-C85D-2F8E52FC144D"),
            Some("b52911413ff6f8bfc85d2f8e52fc144d".to_string())
        );
        assert_eq!(normalize_vulkan_uuid("0000"), None);
        assert_eq!(normalize_vulkan_uuid(""), None);
    }

    #[test]
    fn normalize_hex_id_strips_prefix_and_lowercases() {
        assert_eq!(normalize_hex_id("0x10DE"), "10de");
        assert_eq!(normalize_hex_id("0X2C05"), "2c05");
        assert_eq!(normalize_hex_id(" 744C "), "744c");
    }

    #[test]
    fn query_pci_ids_file_handles_missing_file_gracefully() {
        assert_eq!(query_pci_ids_file("ffff", "ffff"), None);
    }
}