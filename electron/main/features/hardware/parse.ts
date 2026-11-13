/**
 * Pure parsers used by the host-hardware detector.
 *
 * They are kept free of `fs`/`child_process` so each format can be tested
 * against a captured sample without touching the machine that runs the test.
 */

export interface PciIdEntry {
  /** Vendor marketing label (`NVIDIA`, `AMD`, `Intel`, …). */
  vendor: string;
  /** Device id (lowercase, no `0x`) → marketing name from `pci.ids`. */
  devices: Map<string, string>;
}

/** Normalize a sysfs/Vulkan hex id: `0x10DE` → `10de`. */
export function normalizeHexId(raw: string): string {
  return raw.trim().replace(/^0x/i, "").toLowerCase();
}

/** Normalize a PCI slot: `0000:01:00.0` → same; tolerant of `0000:01:00.0\n`. */
export function normalizePciSlot(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Parse `/usr/share/hwdata/pci.ids` (or the older `/usr/share/misc/pci.ids`).
 *
 * The file alternates vendor headers (`10de  NVIDIA Corporation`) with
 * tab-indented device rows (`\t2c05  GB203 [GeForce RTX 5070 Ti]`). Several
 * layered subsections (`\t\t`, subsystem rows) exist and are ignored.
 */
export function parsePciIds(text: string): Map<string, PciIdEntry> {
  const vendors = new Map<string, PciIdEntry>();
  let current: PciIdEntry | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith("#")) continue;
    if (rawLine.startsWith("\t\t")) continue;
    if (rawLine.startsWith("\t")) {
      if (!current) continue;
      const match = /^\t([0-9a-fA-F]{4})\s+(.+)$/.exec(rawLine);
      if (!match) continue;
      current.devices.set(match[1].toLowerCase(), match[2].trim());
      continue;
    }
    const match = /^([0-9a-fA-F]{4})\s+(.+)$/.exec(rawLine);
    if (!match) {
      // A new top-level section (`C 03`, `S 100`, …) ends the device list.
      current = null;
      continue;
    }
    const vendorId = match[1].toLowerCase();
    if (!vendors.has(vendorId)) {
      vendors.set(vendorId, { vendor: match[2].trim(), devices: new Map() });
    }
    current = vendors.get(vendorId) ?? null;
  }
  return vendors;
}

/**
 * Marketing label for a PCI vendor id.
 *
 * `pci.ids` names are long (`Advanced Micro Devices, Inc. [AMD/ATI]`); the UI
 * wants the short form so a GPU chip reads `AMD Radeon 610M`, not a company
 * legal name.
 */
export function shortVendorName(vendorId: string, pciIdsVendor: string | null): string {
  switch (normalizeHexId(vendorId)) {
    case "10de":
      return "NVIDIA";
    case "1002":
      return "AMD";
    case "8086":
      return "Intel";
    case "13b5":
      return "ARM";
    case "5143":
      return "Qualcomm";
    default: {
      const clean = (pciIdsVendor ?? "").replace(/\[[^\]]*\]/g, "").trim();
      const first = clean.split(/[,/]/)[0]?.trim();
      return first && first.length > 0 ? first : "Unknown";
    }
  }
}

/**
 * Compact a `pci.ids` device name for display.
 *
 * `GB203 [GeForce RTX 5070 Ti]` → `NVIDIA GeForce RTX 5070 Ti`
 * `Granite Ridge [Radeon 610M]` → `AMD Radeon 610M`
 *
 * The bracketed marketing name is preferred when present; otherwise the
 * raw device name is used as-is.
 */
export function displayPciDeviceName(
  vendorLabel: string,
  rawDeviceName: string | null,
): string | null {
  const raw = rawDeviceName?.trim();
  if (!raw) return null;
  const bracket = /\[([^\]]+)\]/.exec(raw)?.[1]?.trim();
  const name = bracket && bracket.length > 0 ? bracket : raw;
  if (!name) return null;
  return name.toLowerCase().startsWith(vendorLabel.toLowerCase())
    ? name
    : `${vendorLabel} ${name}`;
}

export interface LspciDevice {
  slot: string;
  name: string;
  vendorId?: string;
  deviceId?: string;
}

/**
 * Parse `lspci -nn` (machine-readable-ish) lines.
 *
 * `01:00.0 VGA compatible controller [0300]: NVIDIA Corporation GB203
 *  [GeForce RTX 5070 Ti] [10de:2c05] (rev a1)`
 */
export function parseLspciNn(text: string): LspciDevice[] {
  const out: LspciDevice[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F:.]+)\s+[^:]+:\s+(.+?)(?:\s+\[([0-9a-fA-F]{4}):([0-9a-fA-F]{4})\])?(?:\s+\(rev .*\))?$/.exec(
      line.trim(),
    );
    if (!match) continue;
    const name = match[2].trim();
    out.push({
      slot: match[1].toLowerCase(),
      name,
      vendorId: match[3]?.toLowerCase(),
      deviceId: match[4]?.toLowerCase(),
    });
  }
  return out;
}

export interface NvidiaSmiGpu {
  name: string;
  vramMb: number;
  /** PCI slot as sysfs reports it (`0000:01:00.0`), or null. */
  pciSlot: string | null;
}

/**
 * Parse `nvidia-smi --query-gpu=name,memory.total,pci.bus_id
 * --format=csv,noheader,nounits`.
 */
export function parseNvidiaSmi(text: string): NvidiaSmiGpu[] {
  const out: NvidiaSmiGpu[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split(",").map((part) => part.trim());
    if (parts.length < 2) continue;
    const name = parts[0];
    const vram = Number.parseFloat(parts[1]);
    if (!name || !Number.isFinite(vram) || vram <= 0) continue;
    // nvidia-smi prints an 8-digit PCI domain (`00000000:01:00.0`); sysfs
    // prints a 4-digit one (`0000:01:00.0`). Normalize to the sysfs form so
    // the two lists can be joined by slot.
    const rawSlot = (parts[2] ?? "").toLowerCase();
    const slotParts = rawSlot.split(":");
    const pciSlot =
      slotParts.length === 3
        ? `${slotParts[0].padStart(4, "0").slice(-4)}:${slotParts[1]}:${slotParts[2]}`
        : null;
    out.push({
      name,
      vramMb: Math.round(vram),
      pciSlot,
    });
  }
  return out;
}

export interface VulkanDevice {
  index: number;
  vendorId: string;
  deviceId: string;
  name: string;
  uuid: string | null;
  isCpu: boolean;
}

/**
 * Parse the `Devices:` block of `vulkaninfo --summary`.
 *
 * `GPU0:` … `vendorID = 0x10de`, `deviceID = 0x2c05`,
 * `deviceName = NVIDIA GeForce RTX 5070 Ti`, `deviceUUID = …`.
 */
export function parseVulkanInfoSummary(text: string): VulkanDevice[] {
  const devices: VulkanDevice[] = [];
  let inDevices = false;
  let current: VulkanDevice | null = null;

  const flush = () => {
    if (current) devices.push(current);
    current = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "Devices:") {
      inDevices = true;
      continue;
    }
    if (!inDevices) continue;
    if (/^GPU\d+:$/.test(line)) {
      flush();
      current = {
        index: Number.parseInt(line.slice(3, -1), 10),
        vendorId: "",
        deviceId: "",
        name: "",
        uuid: null,
        isCpu: false,
      };
      continue;
    }
    if (!current) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === "vendorID") current.vendorId = normalizeHexId(value);
    else if (key === "deviceID") current.deviceId = normalizeHexId(value);
    else if (key === "deviceName") current.name = value;
    else if (key === "deviceUUID") current.uuid = normalizeVulkanUuid(value);
    else if (key === "deviceType" && value === "PHYSICAL_DEVICE_TYPE_CPU") {
      current.isCpu = true;
    }
  }
  flush();
  return devices.filter((device) => Number.isFinite(device.index));
}

/** `b5291141-3ff6-…` → `b52911413ff6…` (32 lowercase hex), or null. */
export function normalizeVulkanUuid(raw: string): string | null {
  const cleaned = raw
    .split("")
    .filter((char) => /[0-9a-fA-F]/.test(char))
    .join("")
    .toLowerCase();
  return cleaned.length === 32 ? cleaned : null;
}

/** Image size in MB from a sysfs byte counter, or null when it is 0/missing. */
export function sysfsBytesToMb(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const bytes = Number.parseFloat(raw.trim());
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  return Math.round(bytes / (1024 * 1024));
}

export interface WindowsVideoController {
  name: string;
  vendor: string;
  vramMb: number;
  pnpDeviceId: string | null;
}

/**
 * Parse the JSON emitted by
 * `Get-CimInstance Win32_VideoController | Select Name,AdapterCompatibility,
 * AdapterRAM,PNPDeviceID | ConvertTo-Json`.
 */
export function parseWindowsVideoControllers(text: string): WindowsVideoController[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
  const out: WindowsVideoController[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const value = row as Record<string, unknown>;
    const name = typeof value.Name === "string" ? value.Name.trim() : "";
    if (!name) continue;
    const vendorRaw =
      typeof value.AdapterCompatibility === "string"
        ? value.AdapterCompatibility.trim()
        : "";
    const vendor = vendorRaw.replace(/\[[^\]]*\]/g, "").split(/[,/]/)[0]?.trim() || "Unknown";
    const bytes = typeof value.AdapterRAM === "number" ? value.AdapterRAM : 0;
    // WMI AdapterRAM is a uint32: values at/above 4 GB are truncated and must
    // not be shown as the real VRAM figure.
    const vramMb = bytes > 0 && bytes < 4_200_000_000 ? Math.round(bytes / (1024 * 1024)) : 0;
    out.push({
      name,
      vendor,
      vramMb,
      pnpDeviceId: typeof value.PNPDeviceID === "string" ? value.PNPDeviceID : null,
    });
  }
  return out;
}
