/**
 * Host hardware detection (CPU / RAM / GPUs).
 *
 * The Tauri build used WMI on Windows and sysfs + `lspci`/`vulkaninfo` on
 * Linux. This is the Electron port of that behaviour:
 *
 *  • **Linux** — DRM cards in `/sys/class/drm`, named from `pci.ids`, with
 *    VRAM from sysfs or `nvidia-smi`, and Vulkan UUIDs/indices when
 *    `vulkaninfo` is installed. PCI ids/slots are preserved because the
 *    compatibility launcher uses them (`MESA_VK_DEVICE_SELECT`,
 *    `DXVK_FILTER_DEVICE_UUID`, `DRI_PRIME`).
 *  • **Windows** — `Win32_VideoController` through PowerShell/CIM.
 *  • **macOS** — `system_profiler SPDisplaysDataType`.
 *
 * Detection is cached: the values cannot change during a normal run and the
 * probe may spawn helper binaries. `refreshHardware()` clears the cache when
 * the user asks for a re-detect (eGPU, driver install).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  displayPciDeviceName,
  normalizeHexId,
  normalizePciSlot,
  parseLspciNn,
  parseNvidiaSmi,
  parsePciIds,
  parseVulkanInfoSummary,
  parseWindowsVideoControllers,
  shortVendorName,
  sysfsBytesToMb,
  type NvidiaSmiGpu,
  type PciIdEntry,
  type VulkanDevice,
} from "./parse";

export interface DetectedGpu {
  id: string;
  name: string;
  vendor: string;
  vramMb: number;
  pciId?: string | null;
  pciSlot?: string | null;
  vulkanUuid?: string | null;
  vulkanIndex?: number | null;
  nvidiaProvider?: string | null;
}

export interface HardwareSummary {
  cpuName: string;
  ramGb: number;
  gpus: DetectedGpu[];
}

const IS_WINDOWS = process.platform === "win32";
const IS_LINUX = process.platform === "linux";
const IS_MAC = process.platform === "darwin";

let cached: HardwareSummary | null = null;
let pciIdsCache: Map<string, PciIdEntry> | null | undefined;

function run(command: string, args: string[], timeout = 4000): string | null {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      timeout,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function readFirstLine(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8").split(/\r?\n/)[0]?.trim() || null;
  } catch {
    return null;
  }
}

// ── CPU / RAM ────────────────────────────────────────────────────────

/** Model name where `os.cpus()` is unhelpful (some ARM/kernel builds). */
function linuxCpuName(): string | null {
  const cpuinfo = readText("/proc/cpuinfo");
  if (!cpuinfo) return null;
  for (const line of cpuinfo.split(/\r?\n/)) {
    const match = /^(?:model name|Model|Hardware|cpu model)\s*:\s*(.+)$/i.exec(line);
    if (match) {
      const name = match[1].replace(/\s+/g, " ").trim();
      if (name) return name;
    }
  }
  return null;
}

function windowsCpuName(): string | null {
  const raw = run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "(Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty Name)",
  ]);
  const name = raw?.trim();
  return name && name.length > 0 ? name : null;
}

function macCpuName(): string | null {
  return run("sysctl", ["-n", "machdep.cpu.brand_string"])?.trim() || null;
}

function cpuName(): string {
  const fromOs = os.cpus()[0]?.model?.replace(/\s+/g, " ").trim();
  if (fromOs) return fromOs;
  if (IS_LINUX) return linuxCpuName() ?? "Unknown CPU";
  if (IS_WINDOWS) return windowsCpuName() ?? "Unknown CPU";
  if (IS_MAC) return macCpuName() ?? "Unknown CPU";
  return "Unknown CPU";
}

function ramGb(): number {
  const bytes = os.totalmem();
  return bytes > 0 ? Math.round(bytes / (1024 * 1024 * 1024)) : 0;
}

// ── Linux GPU detection ──────────────────────────────────────────────

interface DrmCard {
  cardPath: string;
  devicePath: string;
  pciSlot: string;
  vendorId: string;
  deviceId: string;
}

/** Physical DRM cards, deduplicated by PCI slot and sorted for stable ids. */
function linuxDrmCards(): DrmCard[] {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync("/sys/class/drm");
  } catch {
    return [];
  }

  const bySlot = new Map<string, DrmCard>();
  for (const entry of entries) {
    // `card0`, `card1` … but never `card0-DP-1` connector entries.
    if (!/^card\d+$/.test(entry)) continue;
    const cardPath = path.join("/sys/class/drm", entry);
    const devicePath = path.join(cardPath, "device");
    if (!fs.existsSync(devicePath)) continue;

    const uevent = readText(path.join(devicePath, "uevent")) ?? "";
    const slotLine = uevent.split(/\r?\n/).find((line) => line.startsWith("PCI_SLOT_NAME="));
    const pciSlot = normalizePciSlot(slotLine?.slice("PCI_SLOT_NAME=".length) ?? entry);

    const vendorId = normalizeHexId(readFirstLine(path.join(devicePath, "vendor")) ?? "");
    if (!vendorId) continue;
    const deviceId = normalizeHexId(readFirstLine(path.join(devicePath, "device")) ?? "");

    if (!bySlot.has(pciSlot)) {
      bySlot.set(pciSlot, { cardPath, devicePath, pciSlot, vendorId, deviceId });
    }
  }
  return [...bySlot.values()].sort((a, b) => a.pciSlot.localeCompare(b.pciSlot));
}

/** `pci.ids` is ~1 MB; parse it once and reuse for every detected card. */
function pciIds(): Map<string, PciIdEntry> | null {
  if (pciIdsCache !== undefined) return pciIdsCache;
  const candidates = [
    "/usr/share/hwdata/pci.ids",
    "/usr/share/misc/pci.ids",
    "/usr/share/pci.ids",
    "/var/lib/pciutils/pci.ids",
  ];
  for (const candidate of candidates) {
    const text = readText(candidate);
    if (text) {
      pciIdsCache = parsePciIds(text);
      return pciIdsCache;
    }
  }
  pciIdsCache = null;
  return null;
}

function nvidiaSmiGpus(): NvidiaSmiGpu[] {
  const raw = run("nvidia-smi", [
    "--query-gpu=name,memory.total,pci.bus_id",
    "--format=csv,noheader,nounits",
  ]);
  return raw ? parseNvidiaSmi(raw) : [];
}

function vulkanDevices(): VulkanDevice[] {
  const raw = run("vulkaninfo", ["--summary"], 6000);
  return raw ? parseVulkanInfoSummary(raw) : [];
}

function lspciDevices() {
  const raw = run("lspci", ["-nn"], 4000);
  return raw ? parseLspciNn(raw) : [];
}

function linuxGpus(): DetectedGpu[] {
  const cards = linuxDrmCards();
  // Spawn each helper at most once per detection pass.
  const smi = nvidiaSmiGpus();
  if (cards.length === 0) {
    // No DRM devices (headless box / VM). Fall back to nvidia-smi so a
    // discrete card that has no DRM node yet is still listed.
    return smi.map((gpu, index) => ({
      id: `gpu-${index}`,
      name: gpu.name,
      vendor: "NVIDIA",
      vramMb: gpu.vramMb,
      pciId: null,
      pciSlot: gpu.pciSlot,
      vulkanUuid: null,
      vulkanIndex: null,
      nvidiaProvider: null,
    }));
  }

  const vulkan = vulkanDevices();
  const lspci = lspciDevices();
  const ids = pciIds();

  return cards.map((card, index) => {
    const vendor = shortVendorName(
      card.vendorId,
      ids?.get(card.vendorId)?.vendor ?? null,
    );

    const smiEntry = smi.find((gpu) => gpu.pciSlot === card.pciSlot);
    let name = vendor === "NVIDIA" ? smiEntry?.name ?? "" : "";
    if (!name) {
      const deviceName = ids?.get(card.vendorId)?.devices.get(card.deviceId) ?? null;
      name = displayPciDeviceName(vendor, deviceName) ?? "";
    }
    if (!name) {
      const fromLspci = lspci.find((device) => device.slot === card.pciSlot);
      if (fromLspci?.name) {
        const bracketed = /\[([^\]]+)\]/.exec(fromLspci.name)?.[1];
        name = bracketed ? `${vendor} ${bracketed}` : fromLspci.name;
      }
    }
    const vulkanMatch = vulkan.find(
      (device) =>
        device.vendorId === card.vendorId && device.deviceId === card.deviceId,
    );
    if (!name && vulkanMatch?.name) name = vulkanMatch.name;
    if (!name) name = `${vendor} GPU (${card.pciSlot})`;

    let vramMb = vendor === "NVIDIA" && smiEntry ? smiEntry.vramMb : 0;
    if (vramMb === 0) {
      vramMb = sysfsBytesToMb(readText(path.join(card.devicePath, "mem_info_vram_total"))) ?? 0;
    }
    if (vramMb === 0 && name.toLowerCase().includes("radeon 610m")) vramMb = 512;

    return {
      id: `gpu-${index}`,
      name,
      vendor,
      vramMb,
      pciId: `${card.vendorId}:${card.deviceId}`,
      pciSlot: card.pciSlot,
      vulkanUuid: vulkanMatch?.uuid ?? null,
      vulkanIndex: vulkanMatch?.index ?? null,
      nvidiaProvider: null,
    };
  });
}

// ── Windows GPU detection ────────────────────────────────────────────

function windowsGpus(): DetectedGpu[] {
  const raw = run(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterCompatibility,AdapterRAM,PNPDeviceID | ConvertTo-Json -Compress",
    ],
    8000,
  );
  if (!raw) return [];
  const controllers = parseWindowsVideoControllers(raw);
  const smi = nvidiaSmiGpus();

  const seen = new Set<string>();
  const out: DetectedGpu[] = [];
  for (const controller of controllers) {
    const key = `${controller.name.toLowerCase()}|${controller.vendor.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let vramMb = controller.vramMb;
    if (vramMb === 0 && /nvidia/i.test(controller.vendor)) {
      const match = smi.find(
        (gpu) =>
          gpu.name.toLowerCase().includes(controller.name.toLowerCase()) ||
          controller.name.toLowerCase().includes(gpu.name.toLowerCase()),
      );
      if (match) vramMb = match.vramMb;
    }

    out.push({
      id: `gpu-${out.length}`,
      name: controller.name,
      vendor: controller.vendor,
      vramMb,
      pciId: null,
      pciSlot: null,
      vulkanUuid: null,
      vulkanIndex: null,
      nvidiaProvider: null,
    });
  }
  return out;
}

// ── macOS GPU detection ──────────────────────────────────────────────

interface MacDisplayRow {
  _name?: string;
  sppci_model?: string;
  spdisplays_device_id?: string;
  spdisplays_vram?: string;
  spdisplays_vram_shared?: string;
  spdisplays_vendor?: string;
}

function macGpus(): DetectedGpu[] {
  const raw = run("system_profiler", ["SPDisplaysDataType", "-json"], 10000);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as {
      SPDisplaysDataType?: Array<{ spdisplays_ndrvs?: MacDisplayRow[] }>;
    };
    const rows = (parsed.SPDisplaysDataType ?? []).flatMap(
      (entry) => entry.spdisplays_ndrvs ?? [],
    );
    const seen = new Set<string>();
    const out: DetectedGpu[] = [];
    for (const row of rows) {
      const name = (row.sppci_model || row._name || "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const vramText = row.spdisplays_vram || row.spdisplays_vram_shared || "";
      const vramMatch = /(\d+)\s*(GB|MB)/i.exec(vramText);
      let vramMb = 0;
      if (vramMatch) {
        const value = Number.parseInt(vramMatch[1], 10);
        vramMb = vramMatch[2].toUpperCase() === "GB" ? value * 1024 : value;
      }
      const vendorRaw = (row.spdisplays_vendor ?? "").trim();
      const vendor = /nvidia/i.test(vendorRaw + name)
        ? "NVIDIA"
        : /amd|ati|radeon/i.test(vendorRaw + name)
          ? "AMD"
          : /intel/i.test(vendorRaw + name)
            ? "Intel"
            : "Apple";
      out.push({
        id: `gpu-${out.length}`,
        name,
        vendor,
        vramMb,
        pciId: row.spdisplays_device_id ?? null,
        pciSlot: null,
        vulkanUuid: null,
        vulkanIndex: null,
        nvidiaProvider: null,
      });
    }
    return out;
  } catch {
    return [];
  }
}

// ── Public API ───────────────────────────────────────────────────────

export function detectGpus(): DetectedGpu[] {
  if (IS_LINUX) return linuxGpus();
  if (IS_WINDOWS) return windowsGpus();
  if (IS_MAC) return macGpus();
  return [];
}

/** Cached host summary; detection runs once per process. */
export function getHardwareSummary(): HardwareSummary {
  if (!cached) {
    cached = { cpuName: cpuName(), ramGb: ramGb(), gpus: detectGpus() };
  }
  return cached;
}

/** Force the next call to re-detect (GPU plugged in / driver installed). */
export function refreshHardware(): null {
  cached = null;
  pciIdsCache = undefined;
  return null;
}
