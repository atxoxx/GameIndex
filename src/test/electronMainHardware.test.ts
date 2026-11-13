import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  displayPciDeviceName,
  parseNvidiaSmi,
  parsePciIds,
  parseVulkanInfoSummary,
  parseWindowsVideoControllers,
  shortVendorName,
  sysfsBytesToMb,
} from "../../electron/main/features/hardware/parse";
import { programSignature } from "../../electron/main/features/launch/walk";
import { isLaunchableFile } from "../../electron/main/features/launch/programFile";
import { parseVdfInstallPath } from "../../electron/main/features/compatibility/vdf";

const tempRoot = path.join(os.tmpdir(), `gameindex-hw-test-${process.pid}`);

afterAll(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("hardware parsers", () => {
  it("parses pci.ids vendor/device rows and compacts marketing names", () => {
    const ids = parsePciIds(
      [
        "10de  NVIDIA Corporation",
        "\t2c05  GB203 [GeForce RTX 5070 Ti]",
        "\t\t2c05 1234  Subsystem",
        "1002  Advanced Micro Devices, Inc. [AMD/ATI]",
        "\t13c0  Granite Ridge [Radeon 610M]",
        "C 03  Display controller",
      ].join("\n"),
    );

    expect(ids.get("10de")?.devices.get("2c05")).toBe("GB203 [GeForce RTX 5070 Ti]");
    expect(shortVendorName("0x10DE", ids.get("10de")?.vendor ?? null)).toBe("NVIDIA");
    expect(shortVendorName("0x1002", ids.get("1002")?.vendor ?? null)).toBe("AMD");
    expect(
      displayPciDeviceName("NVIDIA", ids.get("10de")?.devices.get("2c05") ?? null),
    ).toBe("NVIDIA GeForce RTX 5070 Ti");
    expect(
      displayPciDeviceName("AMD", ids.get("1002")?.devices.get("13c0") ?? null),
    ).toBe("AMD Radeon 610M");
  });

  it("normalizes nvidia-smi rows onto sysfs PCI slots", () => {
    expect(
      parseNvidiaSmi("NVIDIA GeForce RTX 5070 Ti, 16303, 00000000:01:00.0"),
    ).toEqual([
      { name: "NVIDIA GeForce RTX 5070 Ti", vramMb: 16303, pciSlot: "0000:01:00.0" },
    ]);
  });

  it("parses vulkaninfo --summary devices with UUID and index", () => {
    const devices = parseVulkanInfoSummary(
      [
        "Devices:",
        "=========",
        "GPU0:",
        "\tdeviceType = PHYSICAL_DEVICE_TYPE_DISCRETE_GPU",
        "\tvendorID = 0x10de",
        "\tdeviceID = 0x2c05",
        "\tdeviceName = NVIDIA GeForce RTX 5070 Ti",
        "\tdeviceUUID = b5291141-3ff6-4e7a-8d1a-0a2b3c4d5e6f",
        "GPU1:",
        "\tvendorID = 0x8086",
        "\tdeviceID = 0x4680",
        "\tdeviceName = Intel UHD Graphics 770",
      ].join("\n"),
    );

    expect(devices).toHaveLength(2);
    expect(devices[0]).toMatchObject({
      index: 0,
      vendorId: "10de",
      deviceId: "2c05",
      name: "NVIDIA GeForce RTX 5070 Ti",
      uuid: "b52911413ff64e7a8d1a0a2b3c4d5e6f",
    });
    expect(devices[1].uuid).toBeNull();
  });

  it("marks truncated Windows AdapterRAM as unknown instead of 4 GB", () => {
    const [gpu] = parseWindowsVideoControllers(
      JSON.stringify({
        Name: "NVIDIA GeForce RTX 5070 Ti",
        AdapterCompatibility: "NVIDIA",
        AdapterRAM: 4294967295,
        PNPDeviceID: "PCI\\VEN_10DE",
      }),
    );
    expect(gpu.vramMb).toBe(0);
    expect(gpu.vendor).toBe("NVIDIA");
  });

  it("converts sysfs byte counters to MB", () => {
    expect(sysfsBytesToMb("2147483648")).toBe(2048);
    expect(sysfsBytesToMb("0")).toBeNull();
    expect(sysfsBytesToMb(null)).toBeNull();
  });
});

describe("compatibility tool manifests", () => {
  it("reads install_path from a bare CachyOS manifest", () => {
    const raw = [
      '"compatibilitytools"',
      "{",
      '  "compat_tools"',
      "  {",
      '    "proton-cachyos"',
      "    {",
      '      "install_path" "/usr/share/proton-cachyos"',
      '      "display_name" "proton-cachyos-11.0"',
      "    }",
      "  }",
      "}",
    ].join("\n");
    expect(parseVdfInstallPath(raw)).toBe("/usr/share/proton-cachyos");
  });

  it("handles the compact in-directory manifest", () => {
    expect(
      parseVdfInstallPath(
        '"compatibilitytools" { "compat_tools" { "proton-x" { "install_path" "." } } }',
      ),
    ).toBe(".");
  });

  it("returns null when the manifest has no install_path", () => {
    expect(parseVdfInstallPath('"compatibilitytools" { }')).toBeNull();
  });
});

describe("program signature detection", () => {  async function write(name: string, bytes: Buffer): Promise<string> {
    await fs.mkdir(tempRoot, { recursive: true });
    const target = path.join(tempRoot, name);
    await fs.writeFile(target, bytes);
    return target;
  }

  it("recognizes ELF, shebang and PE headers", async () => {
    expect(await programSignature(await write("game", Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02])))).toBe("elf");
    expect(await programSignature(await write("launcher", Buffer.from("#!/bin/sh\n")))).toBe("script");
    expect(await programSignature(await write("renamed", Buffer.from("MZ\x90\x00")))).toBe("pe");
  });

  it("rejects text, images and other non-program files", async () => {
    expect(await programSignature(await write("readme.txt", Buffer.from("hello world")))).toBeNull();
    expect(
      await programSignature(await write("cover.png", Buffer.from("89504e470d0a1a0a", "hex"))),
    ).toBeNull();
    expect(
      await programSignature(await write("library.dll", Buffer.from("MZ\x90\x00"))),
    ).toBe("pe"); // the scanner still rejects this by extension
  });

  it("only treats real programs as launchable even when every file is 0755", async () => {
    const elf = await write("game", Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02]));
    const script = await write("run.sh", Buffer.from("#!/bin/sh\n"));
    const exe = await write("setup.exe", Buffer.from("MZ\x90\x00"));
    const png = await write("cover.png", Buffer.from("89504e470d0a1a0a", "hex"));
    const readme = await write("README", Buffer.from("read me"));
    const dll = await write("library.dll", Buffer.from("MZ\x90\x00"));

    // Every file reports the execute bit (the NTFS mount case).
    expect(await isLaunchableFile(elf, true)).toBe(true);
    expect(await isLaunchableFile(script, true)).toBe(true);
    expect(await isLaunchableFile(exe, true)).toBe(true);
    expect(await isLaunchableFile(png, true)).toBe(false);
    expect(await isLaunchableFile(readme, true)).toBe(false);
    expect(await isLaunchableFile(dll, true)).toBe(false);

    // Windows: only the extension allowlist applies.
    expect(await isLaunchableFile(exe, false)).toBe(true);
    expect(await isLaunchableFile(elf, false)).toBe(false);
  });
});
