import { describe, it, expect } from "vitest";
import {
  KNOWN_EMULATORS,
  argumentsTemplateForHost,
  executableNameForHost,
  linuxLaunchPresets,
  matchKnownEmulator,
  type Emulator,
} from "./emulator";

const retroarch = KNOWN_EMULATORS.find((k) => k.key === "retroarch")!;
const dolphin = KNOWN_EMULATORS.find((k) => k.key === "dolphin")!;
const xemu = KNOWN_EMULATORS.find((k) => k.key === "xemu")!;

function makeEmulator(overrides: Partial<Emulator> = {}): Emulator {
  return {
    id: "emu-1",
    name: "Dolphin",
    platform: "GameCube",
    executablePath: "/usr/bin/dolphin-emu",
    argumentsTemplate: '"%ROM%"',
    romFolder: "/home/user/ROMs",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("host-aware emulator catalog helpers", () => {
  it("uses the native Linux executable name on Linux only", () => {
    expect(executableNameForHost(dolphin, "linux")).toBe("dolphin-emu");
    expect(executableNameForHost(dolphin, "windows")).toBe("Dolphin.exe");
  });

  it("uses the Linux argument template for xemu", () => {
    expect(argumentsTemplateForHost(xemu, "linux")).toBe('-dvd_path "%ROM%"');
    expect(argumentsTemplateForHost(xemu, "windows")).toBe('-dvd "%ROM%"');
  });
});

describe("linuxLaunchPresets", () => {
  it("offers native, Flatpak and Snap commands when catalogued", () => {
    const presets = linuxLaunchPresets(retroarch);
    const ids = presets.map((p) => p.id);
    expect(ids).toEqual(["native", "flatpak", "snap"]);
    expect(presets[0].executablePath).toBe("/usr/bin/retroarch");
    expect(presets[1]).toMatchObject({
      executablePath: "/usr/bin/flatpak",
      argumentsTemplate: 'run org.libretro.RetroArch "%ROM%"',
    });
    expect(presets[2].argumentsTemplate).toBe('run retroarch "%ROM%"');
  });

  it("omits Flatpak/Snap when the emulator publishes none", () => {
    const presets = linuxLaunchPresets(dolphin);
    expect(presets.map((p) => p.id)).toEqual(["native", "flatpak"]);
    expect(presets.every((p) => p.id !== "snap")).toBe(true);
  });
});

describe("matchKnownEmulator on Linux paths", () => {
  it("matches a native Linux binary name", () => {
    const custom = makeEmulator({
      name: "My Emulator",
      platform: "Custom",
      executablePath: "/usr/bin/retroarch",
    });
    expect(matchKnownEmulator(custom)?.key).toBe("retroarch");
  });

  it("matches a Flatpak export wrapper name", () => {
    const flatpak = makeEmulator({
      name: "RetroArch",
      platform: "RetroArch",
      executablePath: "/var/lib/flatpak/exports/bin/org.libretro.RetroArch",
    });
    expect(matchKnownEmulator(flatpak)?.key).toBe("retroarch");
  });
});

describe("catalog integrity", () => {
  it("has unique keys and well-formed Flatpak ids", () => {
    const keys = KNOWN_EMULATORS.map((k) => k.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const known of KNOWN_EMULATORS) {
      if (known.flatpakId) {
        expect(known.flatpakId).toMatch(/^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+){2,}$/);
      }
    }
  });
});
