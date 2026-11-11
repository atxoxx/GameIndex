import { describe, expect, it } from "vitest";
import { resolveDisplayGpu } from "./SystemRequirementsCard";
import type { GpuInfo } from "../../types/game";

function makeGpu(overrides: Partial<GpuInfo>): GpuInfo {
  return {
    id: "gpu-0",
    name: "Test GPU",
    vendor: "Test",
    vramMb: 8192,
    ...overrides,
  };
}

const integrated = makeGpu({
  id: "gpu-0",
  name: "Intel UHD Graphics 770",
  vendor: "Intel",
  vramMb: 1024,
});

const discrete = makeGpu({
  id: "gpu-1",
  name: "NVIDIA GeForce RTX 4070",
  vendor: "NVIDIA",
  vramMb: 12288,
});

describe("resolveDisplayGpu", () => {
  it("prefers the GPU selected in settings over the first detected adapter", () => {
    const gpus = [integrated, discrete];
    expect(resolveDisplayGpu(discrete, gpus)).toEqual(discrete);
  });

  it("refreshes the selected GPU against the detected list", () => {
    const staleSelection = { ...discrete, vramMb: 8192 };
    const gpus = [integrated, { ...discrete, vramMb: 12288 }];
    expect(resolveDisplayGpu(staleSelection, gpus)).toEqual({
      ...discrete,
      vramMb: 12288,
    });
  });

  it("keeps the selection when the detected list does not contain it", () => {
    expect(resolveDisplayGpu(discrete, [integrated])).toEqual(discrete);
    expect(resolveDisplayGpu(discrete, [])).toEqual(discrete);
  });

  it("falls back to the first detected adapter when nothing is selected", () => {
    expect(resolveDisplayGpu(null, [integrated, discrete])).toEqual(integrated);
    expect(resolveDisplayGpu(undefined, [integrated])).toEqual(integrated);
  });

  it("returns null when there is no selection and no detection", () => {
    expect(resolveDisplayGpu(null, [])).toBeNull();
    expect(resolveDisplayGpu(null, null)).toBeNull();
    expect(resolveDisplayGpu(undefined, undefined)).toBeNull();
  });
});
