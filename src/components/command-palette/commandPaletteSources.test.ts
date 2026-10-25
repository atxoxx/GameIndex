import { describe, expect, it, vi } from "vitest";
import {
  buildDocsEntries,
  buildDocsPaletteItems,
  buildSettingsEntries,
  buildSettingsPaletteItems,
  scoreDocsEntry,
  scoreSettingsEntry,
} from "./commandPaletteSources";

const t = (key: string) => key;

describe("settings palette source", () => {
  it("indexes tabs and sections from the settings catalog", () => {
    const entries = buildSettingsEntries(t, false);

    expect(entries.some((entry) => entry.kind === "tab")).toBe(true);
    expect(entries.some((entry) => entry.kind === "section")).toBe(true);
    expect(entries.some((entry) => entry.keywords.toLowerCase().includes("deadzone"))).toBe(true);
  });

  it("scores keyword matches and navigates to the owning section", () => {
    const entries = buildSettingsEntries(t, false);
    const deadzone = entries.find((entry) =>
      entry.keywords.toLowerCase().includes("deadzone")
    );
    expect(deadzone).toBeDefined();
    expect(scoreSettingsEntry(deadzone!, "deadzone")).toBeGreaterThan(0);

    const navigate = vi.fn();
    const onClose = vi.fn();
    const items = buildSettingsPaletteItems(entries, navigate, onClose, t);
    const item = items.find((entry) => entry.id === `settings-${deadzone!.id}`);
    expect(item).toBeDefined();

    item!.onSelect();
    expect(onClose).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(
      deadzone!.sectionId
        ? `/settings/${deadzone!.tab}?section=${deadzone!.sectionId}`
        : `/settings/${deadzone!.tab}`,
    );
  });
});

describe("docs palette source", () => {
  it("builds article rows that deep-link into the guide", () => {
    const entries = buildDocsEntries(t, false);
    expect(entries.length).toBeGreaterThan(10);

    const navigate = vi.fn();
    const onClose = vi.fn();
    const items = buildDocsPaletteItems(entries, navigate, onClose, t);
    const welcome = items.find((item) => item.id === "doc-welcome");
    expect(welcome).toBeDefined();

    welcome!.onSelect();
    expect(onClose).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/docs?article=welcome");
  });

  it("matches article body text when the guide pack is loaded", () => {
    const entries = buildDocsEntries(t, true);
    const matches = entries.filter((entry) => scoreDocsEntry(entry, "prefix") > 0);
    expect(matches.length).toBeGreaterThan(0);
  });
});
