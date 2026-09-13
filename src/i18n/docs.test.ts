import { describe, expect, it } from "vitest";
import { ensureDocsLoaded, isDocsLoaded, translate } from "./index";
import { docsDe } from "./docs/docsDe";

describe("docs dictionary packs", () => {
  it("merges a locale's guide strings on demand", async () => {
    expect(isDocsLoaded("de")).toBe(false);
    // Base dictionaries no longer carry `docs.*`, so the key falls through.
    expect(translate("docs.title", "de")).toBe("docs.title");

    await ensureDocsLoaded("de");

    expect(isDocsLoaded("de")).toBe(true);
    expect(translate("docs.title", "de")).toBe(docsDe["docs.title"]);
  });

  it("stays a no-op for repeats and unsupported locales", async () => {
    await expect(ensureDocsLoaded("de")).resolves.toBeUndefined();
    await expect(ensureDocsLoaded("xx")).resolves.toBeUndefined();
    expect(isDocsLoaded("xx")).toBe(false);
  });
});
