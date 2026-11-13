/**
 * GPU pinning for Wine/Proton launches.
 *
 * The selected adapter is passed to the launch environment through a small
 * matrix of selectors: Vulkan (DXVK UUID filter, vkdevicechooser, loader and
 * Mesa), OpenGL (NVIDIA PRIME offload) and Mesa `DRI_PRIME`. Kept free of
 * Electron/disk imports so the rules can be unit-tested.
 */

export interface GpuSelection {
  pciId?: string | null;
  pciSlot?: string | null;
  vulkanUuid?: string | null;
  vulkanIndex?: number | null;
  vendor?: string | null;
  nvidiaProvider?: string | null;
}

export interface GpuSettings {
  useSpecificGpu?: boolean | null;
  specificGpuId?: string | null;
}

export function normalizeVulkanUuid(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .split("")
    .filter((char) => /[0-9a-fA-F]/.test(char))
    .join("")
    .toLowerCase();
  return cleaned.length === 32 ? cleaned : null;
}

export function normalizedPciId(raw: string | null | undefined): string | null {
  const value = raw?.trim().toLowerCase() ?? "";
  return /^[0-9a-f]{4}:[0-9a-f]{4}$/.test(value) ? value : null;
}

export function normalizedPciSlot(raw: string | null | undefined): string | null {
  const value = raw?.trim().toLowerCase() ?? "";
  return /^[0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-9a-f]$/.test(value) ? value : null;
}

export function normalizedNvidiaProvider(raw: string | null | undefined): string | null {
  const value = raw?.trim().toUpperCase() ?? "";
  return /^NVIDIA-G\d+$/.test(value) ? value : null;
}

/** Reject malformed/stale identifiers before they reach the environment. */
export function sanitizeGpuSelection(
  gpu: GpuSelection | null | undefined,
): GpuSelection | null {
  if (!gpu) return null;
  const cleaned: GpuSelection = {
    pciId: normalizedPciId(gpu.pciId),
    pciSlot: normalizedPciSlot(gpu.pciSlot),
    vulkanUuid: normalizeVulkanUuid(gpu.vulkanUuid),
    vulkanIndex:
      typeof gpu.vulkanIndex === "number" && Number.isInteger(gpu.vulkanIndex)
        ? gpu.vulkanIndex
        : null,
    vendor: gpu.vendor?.trim() || null,
    nvidiaProvider: normalizedNvidiaProvider(gpu.nvidiaProvider),
  };
  return Object.values(cleaned).some((value) => value !== null) ? cleaned : null;
}

/** The persisted single id (`pciSlot` or `vendor:device`) from older launches. */
export function selectionFromId(raw: string | null | undefined): GpuSelection | null {
  const value = raw?.trim();
  if (!value) return null;
  const slot = normalizedPciSlot(value);
  if (slot) return { pciSlot: slot };
  const pciId = normalizedPciId(value);
  if (pciId) return { pciId };
  return null;
}

/**
 * Resolve the GPU override for a launch: per-game tri-state wins over the
 * global toggle; the launch-provided selection wins over the persisted id.
 */
export function specificGpuSelection(
  settings: GpuSettings,
  profile: { useSpecificGpu?: boolean | null } | null,
  launchSelection: GpuSelection | null | undefined,
): GpuSelection | null {
  const enabled =
    typeof profile?.useSpecificGpu === "boolean"
      ? profile.useSpecificGpu
      : Boolean(settings.useSpecificGpu);
  if (!enabled) return null;
  return (
    sanitizeGpuSelection(launchSelection) ?? selectionFromId(settings.specificGpuId)
  );
}

/** Environment entries that pin a launch to `selection`. */
export function specificGpuEnv(selection: GpuSelection): Array<[string, string]> {
  const env: Array<[string, string]> = [];
  if (selection.vulkanUuid) {
    env.push(["DXVK_FILTER_DEVICE_UUID", selection.vulkanUuid]);
  }
  if (typeof selection.vulkanIndex === "number") {
    env.push(["ENABLE_DEVICE_CHOOSER_LAYER", "1"]);
    env.push(["VULKAN_DEVICE_INDEX", String(selection.vulkanIndex)]);
  }
  if (selection.pciId) {
    const [vendor, device] = selection.pciId.split(":");
    env.push(["VK_LOADER_DEVICE_SELECT", `0x${vendor}:0x${device}`]);
    env.push(["MESA_VK_DEVICE_SELECT", selection.pciId]);
  }
  const isNvidia =
    selection.vendor?.toLowerCase() === "nvidia" ||
    selection.pciId?.startsWith("10de:") === true;
  if (isNvidia) {
    if (selection.nvidiaProvider) {
      env.push(["__NV_PRIME_RENDER_OFFLOAD", "1"]);
      env.push(["__GLX_VENDOR_LIBRARY_NAME", "nvidia"]);
      env.push(["__NV_PRIME_RENDER_OFFLOAD_PROVIDER", selection.nvidiaProvider]);
      env.push(["__VK_LAYER_NV_optimus", "NVIDIA_only"]);
    }
  } else if (selection.pciSlot) {
    const dri = `pci-${selection.pciSlot.replace(/:/g, "_").replace(/\./g, "_")}`;
    env.push(["DRI_PRIME", dri]);
  }
  return env;
}
