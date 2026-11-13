import { afterEach, describe, expect, it } from "vitest";
import {
  mangohudLogDir,
  parseMangohudCsv,
} from "../../electron/main/features/telemetry/linux";

const HEADER =
  "fps,frametime,cpu_load,gpu_load,cpu_temp,gpu_temp,gpu_core_clock,elapsed";

describe("MangoHud CSV parsing", () => {
  it("reads the newest data row and its optional columns", () => {
    const tail = [
      "60.0,16.6,30,40,55,60,1200,1",
      "75.5,13.2,35,88,58,61,1800,2",
    ].join("\n");
    expect(parseMangohudCsv(HEADER, tail)).toEqual({
      fps: 75.5,
      gpuLoad: 88,
      gpuTempC: 61,
      cpuTempC: 58,
      gpuClockMhz: 1800,
    });
  });

  it("finds the header after MangoHud's metadata preamble", () => {
    const head = ["os,cpu,gpu,ram", "Steam Runtime,AMD,NVIDIA,32"].join("\n") + "\n" + HEADER;
    expect(parseMangohudCsv(head, "144,6.9,10,5,0,0,900,1")).toMatchObject({
      fps: 144,
      gpuLoad: 5,
      gpuTempC: null,
      cpuTempC: null,
      gpuClockMhz: 900,
    });
  });

  it("ignores a partial first line in the tail and invalid FPS rows", () => {
    const tail = [
      ",0.2,3,4,5,6,7,8",
      "0,0,0,0,55,60,1200,1",
      "60,16.6,30,40,55,60,1200,2",
    ].join("\n");
    expect(parseMangohudCsv(HEADER, tail)?.fps).toBe(60);
  });

  it("rejects summary CSVs and files without an fps header", () => {
    expect(parseMangohudCsv("os,cpu,gpu\nSteam,AMD,NVIDIA", "1,2,3")).toBeNull();
    expect(parseMangohudCsv("", "")).toBeNull();
  });

  it("keeps a zero GPU load but treats zero temperatures as unknown", () => {
    const parsed = parseMangohudCsv(HEADER, "60,16.6,30,0,0,0,1200,1");
    expect(parsed).toMatchObject({ gpuLoad: 0, gpuTempC: null, cpuTempC: null });
  });
});

describe("MangoHud log folders", () => {
  const original = process.env.XDG_DATA_HOME;
  afterEach(() => {
    if (original === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = original;
  });

  it("writes per-game logs under GameIndex and sanitizes the id", () => {
    process.env.XDG_DATA_HOME = "/tmp/gi-xdg";
    expect(mangohudLogDir("game/with spaces")).toBe(
      "/tmp/gi-xdg/MangoHud/GameIndex/game_with_spaces",
    );
  });
});
