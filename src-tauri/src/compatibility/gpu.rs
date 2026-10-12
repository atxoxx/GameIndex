use serde::{Deserialize, Serialize};
use std::path::Path;

use super::*;

/// Build the MangoHud CSV-logging config used for GameIndex sessions:
/// one line per second into `folder` so `metrics_collector` finds the
/// frame log. `read_cfg` must come first: `MANGOHUD_CONFIG` otherwise
/// replaces the user's `MangoHud.conf` wholesale, and only keys listed
/// after it override the file. When `hidden` the overlay starts hidden
/// (`no_display`, toggled back with the MangoHud hotkey) while still
/// logging — useful when the overlay is only needed for telemetry, not
/// on screen.
pub fn mangohud_log_config(folder: &Path, hidden: bool) -> String {
    let mut cfg = format!(
        "read_cfg,log_interval=1000,output_folder={},autostart_log=1",
        folder.display()
    );
    if hidden {
        cfg.push_str(",no_display");
    }
    cfg
}

/// Whether the specific-GPU launch override is active. The per-game
/// `useSpecificGpu` tri-state wins over the global `use_specific_gpu`.
pub fn specific_gpu_enabled(
    settings: &CompatibilitySettings,
    game_profile: Option<&serde_json::Value>,
) -> bool {
    game_profile
        .and_then(|p| p.get("useSpecificGpu"))
        .and_then(|v| v.as_bool())
        .unwrap_or(settings.use_specific_gpu)
}

/// GPU identity handed to the launch environment. Mirrors the fields the
/// frontend `GpuInfo` carries; every field is optional because older
/// payloads and the tray-launch path only persist a single id string.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GpuSelection {
    /// PCI `vendor:device`, e.g. `10de:2c05`.
    pub pci_id: Option<String>,
    /// PCI slot, e.g. `0000:01:00.0` — unique for identical cards.
    pub pci_slot: Option<String>,
    /// Vulkan `deviceUUID` (32 hex chars; dashes are stripped).
    pub vulkan_uuid: Option<String>,
    /// Position in the Vulkan device enumeration.
    pub vulkan_index: Option<u32>,
    /// `NVIDIA`, `AMD`, `Intel`, …
    pub vendor: Option<String>,
    /// RandR offload-screen name (`NVIDIA-G0`).
    pub nvidia_provider: Option<String>,
}

impl GpuSelection {
    fn is_empty(&self) -> bool {
        self.pci_id.is_none()
            && self.pci_slot.is_none()
            && self.vulkan_uuid.is_none()
            && self.vulkan_index.is_none()
            && self.nvidia_provider.is_none()
    }
}

/// Normalize a `vendor:device` string, rejecting anything else. Shared with tests.
pub(crate) fn normalized_pci_id(raw: &str) -> Option<String> {
    let value = raw.trim().to_lowercase();
    let bytes = value.as_bytes();
    let shape_ok = bytes.len() == 9
        && bytes[4] == b':'
        && bytes[..4].iter().all(u8::is_ascii_hexdigit)
        && bytes[5..].iter().all(u8::is_ascii_hexdigit);
    shape_ok.then_some(value)
}

/// Normalize a `0000:01:00.0` PCI slot, rejecting anything else. Shared with tests.
pub(crate) fn normalized_pci_slot(raw: &str) -> Option<String> {
    let value = raw.trim().to_lowercase();
    let bytes = value.as_bytes();
    let hex_at = |i: usize| bytes.get(i).is_some_and(u8::is_ascii_hexdigit);
    let shape_ok = bytes.len() == 12
        && bytes[4] == b':'
        && bytes[7] == b':'
        && bytes[10] == b'.'
        && [0, 1, 2, 3, 5, 6, 8, 9, 11].iter().all(|&i| hex_at(i));
    shape_ok.then_some(value)
}

/// Normalize an `NVIDIA-G<n>` provider name, rejecting others. Shared with tests.
pub(crate) fn normalized_nvidia_provider(raw: &str) -> Option<String> {
    let value = raw.trim().to_uppercase();
    let digits = value.strip_prefix("NVIDIA-G")?;
    (!digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())).then_some(value)
}

/// Drop fields that aren't shaped like real identifiers, so a stale or
/// hand-edited setting can't inject garbage into the launch environment.
fn sanitize_gpu_selection(gpu: &GpuSelection) -> GpuSelection {
    GpuSelection {
        pci_id: gpu.pci_id.as_deref().and_then(normalized_pci_id),
        pci_slot: gpu.pci_slot.as_deref().and_then(normalized_pci_slot),
        vulkan_uuid: gpu
            .vulkan_uuid
            .as_deref()
            .and_then(crate::gpu_detector::normalize_vulkan_uuid),
        vulkan_index: gpu.vulkan_index,
        vendor: gpu
            .vendor
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(str::to_string),
        nvidia_provider: gpu
            .nvidia_provider
            .as_deref()
            .and_then(normalized_nvidia_provider),
    }
}

/// Interpret the single persisted id string (tray launches) as either a PCI
/// slot or a `vendor:device` pair.
fn selection_from_id(raw: &str) -> GpuSelection {
    let trimmed = raw.trim();
    if let Some(slot) = normalized_pci_slot(trimmed) {
        return GpuSelection {
            pci_slot: Some(slot),
            ..Default::default()
        };
    }
    if let Some(pci_id) = normalized_pci_id(trimmed) {
        return GpuSelection {
            pci_id: Some(pci_id),
            ..Default::default()
        };
    }
    GpuSelection::default()
}

/// Resolve the GPU override for a launch. The launch-provided selection (the
/// GPU currently selected in Settings) wins; the id persisted on the global
/// setting is the fallback for launches that don't go through the frontend
/// (e.g. the tray menu). `None` means no injection: setting off, no GPU
/// selected, or disabled per game.
pub fn specific_gpu_selection(
    settings: &CompatibilitySettings,
    game_profile: Option<&serde_json::Value>,
    gpu: Option<&GpuSelection>,
) -> Option<GpuSelection> {
    if !specific_gpu_enabled(settings, game_profile) {
        return None;
    }
    if let Some(gpu) = gpu {
        let cleaned = sanitize_gpu_selection(gpu);
        if !cleaned.is_empty() {
            return Some(cleaned);
        }
    }
    settings
        .specific_gpu_id
        .as_deref()
        .map(selection_from_id)
        .filter(|selection| !selection.is_empty())
}

/// Environment variables that pin a launch to the selected GPU. The set is a
/// matrix because every graphics stack has its own selector: Vulkan (DXVK
/// UUID filter, vkdevicechooser, loader + Mesa `vid:did`), OpenGL (NVIDIA
/// PRIME offload provider) and Mesa `DRI_PRIME`. Missing fields simply
/// produce fewer entries, so old selections and tray launches degrade
/// gracefully. Shared with tests.
pub fn specific_gpu_env(selection: &GpuSelection) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = Vec::new();

    // DXVK's UUID filter is the only precise selector for two identical GPUs.
    if let Some(uuid) = selection
        .vulkan_uuid
        .as_deref()
        .and_then(crate::gpu_detector::normalize_vulkan_uuid)
    {
        env.push(("DXVK_FILTER_DEVICE_UUID".to_string(), uuid));
    }
    // vkdevicechooser covers native Vulkan titles; harmless without the layer.
    if let Some(index) = selection.vulkan_index {
        env.push(("ENABLE_DEVICE_CHOOSER_LAYER".to_string(), "1".to_string()));
        env.push(("VULKAN_DEVICE_INDEX".to_string(), index.to_string()));
    }
    if let Some(pci_id) = selection.pci_id.as_deref().and_then(normalized_pci_id) {
        if let Some((vendor, device)) = pci_id.split_once(':') {
            env.push((
                "VK_LOADER_DEVICE_SELECT".to_string(),
                format!("0x{vendor}:0x{device}"),
            ));
        }
        env.push(("MESA_VK_DEVICE_SELECT".to_string(), pci_id));
    }

    let is_nvidia = selection
        .vendor
        .as_deref()
        .is_some_and(|vendor| vendor.eq_ignore_ascii_case("NVIDIA"))
        || selection
            .pci_id
            .as_deref()
            .is_some_and(|pci| pci.to_lowercase().starts_with("10de:"));

    if is_nvidia {
        // X11 OpenGL offload needs the GPU screen name; the adapter that
        // drives the X screen needs nothing (GL already runs there).
        if let Some(provider) = selection
            .nvidia_provider
            .as_deref()
            .and_then(normalized_nvidia_provider)
        {
            env.push(("__NV_PRIME_RENDER_OFFLOAD".to_string(), "1".to_string()));
            env.push(("__GLX_VENDOR_LIBRARY_NAME".to_string(), "nvidia".to_string()));
            env.push(("__NV_PRIME_RENDER_OFFLOAD_PROVIDER".to_string(), provider));
            env.push(("__VK_LAYER_NV_optimus".to_string(), "NVIDIA_only".to_string()));
        }
    } else if let Some(slot) = selection.pci_slot.as_deref().and_then(normalized_pci_slot) {
        // Mesa selects by bus path, which stays unique for identical cards.
        let dri = format!("pci-{}", slot.replace(':', "_").replace('.', "_"));
        env.push(("DRI_PRIME".to_string(), dri));
    }

    env
}
