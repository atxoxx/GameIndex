/**
 * Host hardware / platform probes.
 *
 * `get_system_ram_gb`, `get_system_info` and `detect_gpus` are read by the
 * Activity, Settings → Hardware, GamePage and Diagnostics surfaces on mount.
 * CPU model + RAM come from `node:os`; GPU enumeration lives in
 * `features/hardware/detect` (sysfs/pci.ids on Linux, WMI on Windows,
 * system_profiler on macOS).
 *
 * The summary is cached in the detector because GPU probing may spawn helper
 * binaries; `refresh_hardware` clears that cache.
 */
import os from "node:os";
import type { CommandHandler } from "../ipc";
import {
  getHardwareSummary,
  refreshHardware,
} from "../features/hardware/detect";

function ramGb(): number {
  return Math.round(os.totalmem() / (1024 * 1024 * 1024));
}

function platformName(): string {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "linux":
      return "linux";
    case "darwin":
      return "macos";
    default:
      return "unknown";
  }
}

export const systemCommands: Record<string, CommandHandler> = {
  get_system_ram_gb: () => ramGb(),

  get_system_info: () => getHardwareSummary(),

  detect_gpus: () => getHardwareSummary().gpus,

  refresh_hardware: () => refreshHardware(),

  get_platform: () => platformName(),
};
