/**
 * Host hardware / platform probes that are trivial in Node.
 *
 * `get_system_ram_gb` and `get_system_info` are read by the Activity and
 * Settings surfaces on mount. CPU model + RAM come straight from `node:os`.
 *
 * GPU enumeration (WMI on Windows, sysfs/lspci on Linux) is NOT ported in this
 * pass. `detect_gpus` returns `[]` and `get_system_info` reports an empty GPU
 * list; the renderer falls back to its own cached adapter list, and the
 * Hardware page simply shows no adapters until the detector lands.
 */
import os from "node:os";
import type { CommandHandler } from "../ipc";

function ramGb(): number {
  return Math.round(os.totalmem() / (1024 * 1024 * 1024));
}

function cpuName(): string {
  const model = os.cpus()[0]?.model?.trim();
  return model && model.length > 0 ? model : "Unknown CPU";
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

  get_system_info: () => ({
    cpuName: cpuName(),
    ramGb: ramGb(),
    gpus: [],
  }),

  /** GPU detector not ported — see the module note. */
  detect_gpus: () => [],

  /** No hardware cache to invalidate in this build. */
  refresh_hardware: () => null,

  get_platform: () => platformName(),
};
