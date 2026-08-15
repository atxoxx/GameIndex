import { type SteamHardware } from "../../types/game";

export interface FormattedHardwareLine {
  label: string;
  value: string;
}

export function parseSteamHardware(raw: SteamHardware | string | undefined): SteamHardware | null {
  if (!raw) return null;
  if (typeof raw === "object") {
    return raw as SteamHardware;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const os = pickString(parsed, ["os", "OS"]);
    const cpuName = pickString(parsed, ["cpuName", "cpu", "processorName"]);
    const gpuName = pickString(parsed, ["adapterDescription", "gpu", "gpuName"]);
    const systemRamMb = pickNumber(parsed, ["systemRam", "ram", "totalMemoryMB"]);
    const vramSizeMb = pickNumber(parsed, ["vramSizeMb", "vramSize", "vram", "videoMemoryMB"]);
    if (!os && !cpuName && !gpuName && !systemRamMb && !vramSizeMb) return null;
    return { os, cpuName, gpuName, systemRamMb, vramSizeMb };
  } catch {
    return null;
  }
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return undefined;
}

export function formatRam(mb: number | undefined): string | null {
  if (mb === undefined || mb <= 0) return null;
  if (mb < 65536) return `${(mb / 1024).toFixed(1)} GB`;
  return `${(mb / 1024).toFixed(0)} GB`;
}

export function formatVram(mb: number | undefined): string | null {
  if (mb === undefined || mb <= 0) return null;
  return `${(mb / 1024).toFixed(1)} GB`;
}

export function getHardwareLines(hw: SteamHardware | string | undefined): FormattedHardwareLine[] {
  const parsed = parseSteamHardware(hw);
  if (!parsed) return [];
  const lines: FormattedHardwareLine[] = [];
  if (parsed.os) lines.push({ label: "OS", value: parsed.os });
  if (parsed.cpuName || parsed.systemRamMb) {
    const cpu = parsed.cpuName ?? "Unknown CPU";
    const ram = formatRam(parsed.systemRamMb);
    lines.push({ label: "CPU", value: ram ? `${cpu} • ${ram}` : cpu });
  }
  if (parsed.gpuName || parsed.vramSizeMb) {
    const gpu = parsed.gpuName ?? "Unknown GPU";
    const vram = formatVram(parsed.vramSizeMb);
    lines.push({ label: "GPU", value: vram ? `${gpu} • ${vram}` : gpu });
  }
  return lines;
}
