import { describe, expect, it } from "vitest";
import {
  buildSettingsCatalog,
  getCategoryForTab,
  isSettingsTab,
} from "./settingsCatalog";

const t = (key: string) => key;

describe("settings catalog", () => {
  it("indexes every tab exactly once, in rail order", () => {
    const { groups, searchIndex, tabOrder } = buildSettingsCatalog(t);

    const grouped = groups.flatMap((group) =>
      group.items.map((item) => item.tab),
    );
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(grouped.sort()).toEqual([...tabOrder].sort());

    const tabEntries = searchIndex.filter((entry) => entry.kind === "tab");
    expect(tabEntries).toHaveLength(tabOrder.length);
    expect(tabEntries.some((entry) => entry.tab === "overview")).toBe(true);
  });

  it("resolves every searchable setting to a real section anchor", () => {
    const { meta, searchIndex } = buildSettingsCatalog(t);
    const settingEntries = searchIndex.filter(
      (entry) => entry.kind === "setting",
    );
    expect(settingEntries.length).toBeGreaterThan(10);

    for (const entry of settingEntries) {
      const sections = meta[entry.tab].sections;
      expect(
        sections.some((section) => section.id === entry.sectionId),
        `${entry.id} points at ${entry.sectionId}`,
      ).toBe(true);
    }
  });

  it("keeps expert sections but flags them as non-essential", () => {
    const { meta } = buildSettingsCatalog(t);
    const advanced = Object.values(meta).flatMap((tab) =>
      tab.sections.filter((section) => section.essential === false),
    );
    expect(advanced.length).toBeGreaterThan(5);
    // The Essentials filter is a real subset, never an empty surface.
    for (const tab of Object.values(meta)) {
      expect(tab.sections.some((section) => section.essential !== false)).toBe(
        true,
      );
    }
  });

  it("hides the Linux tab unless the full support level is on", () => {
    expect(isSettingsTab("compatibility", { showFullLinuxUi: false })).toBe(
      false,
    );
    expect(isSettingsTab("compatibility", { showFullLinuxUi: true })).toBe(true);
    expect(isSettingsTab("nope")).toBe(false);

    const hidden = buildSettingsCatalog(t, { showFullLinuxUi: false });
    expect(hidden.tabOrder).not.toContain("compatibility");
    expect(
      hidden.searchIndex.some((entry) => entry.tab === "compatibility"),
    ).toBe(false);

    const shown = buildSettingsCatalog(t, { showFullLinuxUi: true });
    expect(shown.tabOrder).toContain("compatibility");
  });

  it("maps every tab to a group that actually lists it", () => {
    const { groups, tabOrder } = buildSettingsCatalog(t);
    for (const tab of tabOrder) {
      const groupId = getCategoryForTab(tab);
      const group = groups.find((candidate) => candidate.id === groupId);
      expect(group, `${tab} -> ${groupId}`).toBeDefined();
      expect(group!.items.some((item) => item.tab === tab)).toBe(true);
    }
  });
});
