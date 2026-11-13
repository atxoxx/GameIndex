import { describe, expect, it } from "vitest";
import {
  RUNNER_SOURCES,
  runnerAssetMatches,
} from "../../electron/main/features/compatibility/runnerCatalog";
import {
  sanitizeGpuSelection,
  selectionFromId,
  specificGpuEnv,
  specificGpuSelection,
} from "../../electron/main/features/compatibility/gpuSelection";

describe("runner catalogue", () => {
  it("maps every source pill to its GitHub repo and target type", () => {
    expect(RUNNER_SOURCES["ge-proton"]).toEqual({
      repo: "GloriousEggroll/proton-ge-custom",
      targetType: "proton",
    });
    expect(RUNNER_SOURCES.cachyos.repo).toBe("CachyOS/proton-cachyos");
    expect(RUNNER_SOURCES["wine-ge"].targetType).toBe("wine");
    expect(RUNNER_SOURCES.kron4ek.repo).toBe("Kron4ek/Wine-Builds");
    expect(RUNNER_SOURCES.soda.targetType).toBe("wine");
  });

  it("matches real release assets and skips checksums/wrong architectures", () => {
    expect(runnerAssetMatches("ge-proton", "GE-Proton9-20.tar.gz")).toBe(true);
    expect(runnerAssetMatches("ge-proton", "GE-Proton9-20.sha512sum")).toBe(false);
    expect(runnerAssetMatches("soda", "soda-9-x86_64-symbols.tar.xz")).toBe(false);
    // x64 host: an aarch64 archive must not be offered.
    expect(runnerAssetMatches("ge-proton", "GE-Proton9-20-aarch64.tar.gz")).toBe(false);

    expect(runnerAssetMatches("cachyos", "proton-cachyos-11.0-x86_64.tar.xz")).toBe(true);
    expect(runnerAssetMatches("cachyos", "proton-cachyos-11.0-x86_64_v3.tar.xz")).toBe(false);

    // Kron4ek requires an explicit x86_64/amd64 token.
    expect(runnerAssetMatches("kron4ek", "wine-10.0-amd64.tar.xz")).toBe(true);
    expect(runnerAssetMatches("kron4ek", "wine-10.0.tar.xz")).toBe(false);

    // Proton-EM publishes architecture-agnostic archives.
    expect(runnerAssetMatches("proton-em", "Proton-EM-10.0.tar.xz")).toBe(true);
  });
});

describe("GPU pinning environment", () => {
  it("honours the per-game tri-state over the global toggle", () => {
    const globalOn = { useSpecificGpu: true, specificGpuId: "0000:01:00.0" };
    const globalOff = { useSpecificGpu: false, specificGpuId: "0000:01:00.0" };
    expect(specificGpuSelection(globalOn, null, null)?.pciSlot).toBe("0000:01:00.0");
    expect(specificGpuSelection(globalOff, { useSpecificGpu: true }, null)?.pciSlot).toBe(
      "0000:01:00.0",
    );
    expect(specificGpuSelection(globalOn, { useSpecificGpu: false }, null)).toBeNull();
    expect(specificGpuSelection(globalOff, null, null)).toBeNull();
  });

  it("prefers the launch selection and parses the persisted id", () => {
    const launch = {
      pciId: "10DE:2C05",
      pciSlot: "0000:01:00.0",
      vulkanUuid: "b5291141-3ff6-4e7a-8d1a-0a2b3c4d5e6f",
      vulkanIndex: 1,
      vendor: "NVIDIA",
      nvidiaProvider: "NVIDIA-G0",
    };
    const resolved = specificGpuSelection(
      { useSpecificGpu: true, specificGpuId: "0000:11:00.0" },
      null,
      launch,
    );
    expect(resolved?.pciId).toBe("10de:2c05");

    expect(selectionFromId("0000:11:00.0")).toEqual({ pciSlot: "0000:11:00.0" });
    expect(selectionFromId("10de:2c05")).toEqual({ pciId: "10de:2c05" });
    expect(selectionFromId("not-a-gpu")).toBeNull();
  });

  it("rejects malformed identifiers", () => {
    expect(sanitizeGpuSelection({ pciId: "garbage" })).toBeNull();
    expect(
      sanitizeGpuSelection({
        vulkanUuid: "not-a-uuid",
        pciSlot: "00:01.0",
      }),
    ).toBeNull();
  });

  it("builds the Vulkan, Mesa and NVIDIA PRIME selectors", () => {
    const env = Object.fromEntries(
      specificGpuEnv({
        pciId: "10de:2c05",
        pciSlot: "0000:01:00.0",
        vulkanUuid: "b52911413ff64e7a8d1a0a2b3c4d5e6f",
        vulkanIndex: 1,
        vendor: "NVIDIA",
        nvidiaProvider: "NVIDIA-G0",
      }),
    );
    expect(env.DXVK_FILTER_DEVICE_UUID).toBe("b52911413ff64e7a8d1a0a2b3c4d5e6f");
    expect(env.VULKAN_DEVICE_INDEX).toBe("1");
    expect(env.MESA_VK_DEVICE_SELECT).toBe("10de:2c05");
    expect(env.VK_LOADER_DEVICE_SELECT).toBe("0x10de:0x2c05");
    expect(env.__NV_PRIME_RENDER_OFFLOAD_PROVIDER).toBe("NVIDIA-G0");

    const amd = Object.fromEntries(
      specificGpuEnv({ pciId: "1002:13c0", pciSlot: "0000:7a:00.0", vendor: "AMD" }),
    );
    expect(amd.DRI_PRIME).toBe("pci-0000_7a_00_0");
    expect(amd.__NV_PRIME_RENDER_OFFLOAD).toBeUndefined();
  });
});
