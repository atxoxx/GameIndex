import { describe, expect, it } from "vitest";
import { resolvePublicAssetUrl } from "./publicAsset";

/**
 * The packaged renderer loads from `file:///.../out/renderer/index.html`, so a
 * root-absolute `/emulator-logos/...` URL resolves against the drive root and
 * the image 404s. These cases pin the two forms the app can hold.
 */
describe("resolvePublicAssetUrl", () => {
  it("resolves a catalog path against the page", () => {
    expect(resolvePublicAssetUrl("emulator-logos/rpcs3.svg")).toBe(
      new URL("emulator-logos/rpcs3.svg", window.location.href).toString(),
    );
  });

  it("normalises the legacy root-absolute form", () => {
    expect(resolvePublicAssetUrl("/emulator-logos/rpcs3.svg")).toBe(
      new URL("emulator-logos/rpcs3.svg", window.location.href).toString(),
    );
  });

  it("accepts a ./-prefixed path", () => {
    expect(resolvePublicAssetUrl("./emulator-logos/dolphin.png")).toBe(
      new URL("emulator-logos/dolphin.png", window.location.href).toString(),
    );
  });

  it("keeps complete URLs untouched", () => {
    for (const value of [
      "https://example.com/a.png",
      "http://example.com/a.png",
      "data:image/png;base64,AAAA",
      "giasset://local/C:/art/x.png",
      "blob:file:///abc",
      "//cdn.example.com/a.png",
      "C:\\art\\x.png",
    ]) {
      expect(resolvePublicAssetUrl(value)).toBe(value);
    }
  });

  it("returns undefined for empty input", () => {
    expect(resolvePublicAssetUrl(undefined)).toBeUndefined();
    expect(resolvePublicAssetUrl(null)).toBeUndefined();
    expect(resolvePublicAssetUrl("   ")).toBeUndefined();
  });
});
