import { describe, expect, it, vi } from "vitest";
import { cycleTabId, focusTabLanding } from "./bigscreenGameTabs";

describe("cycleTabId", () => {
  const ids = ["overview", "media", "specs"] as const;

  it("steps forward and wraps at the end", () => {
    expect(cycleTabId(ids, "overview", "forward")).toBe("media");
    expect(cycleTabId(ids, "specs", "forward")).toBe("overview");
  });

  it("steps back and wraps to the last tab", () => {
    expect(cycleTabId(ids, "overview", "back")).toBe("specs");
    expect(cycleTabId(ids, "media", "back")).toBe("overview");
  });

  it("falls back to the first tab when the active id is unknown", () => {
    expect(cycleTabId(ids, "nope" as (typeof ids)[number], "forward")).toBe(
      "overview",
    );
  });

  it("refuses an empty tab list rather than returning undefined", () => {
    expect(() => cycleTabId([], "overview", "forward")).toThrow();
  });
});

describe("focusTabLanding", () => {
  function fixture(panelContent: string, tabId = "media") {
    document.body.innerHTML = `
      <div id="root">
        <button id="bigscreen-tab-${tabId}" role="tab">${tabId}</button>
        <div role="tabpanel" data-tab-id="${tabId}" data-active="true">
          ${panelContent}
        </div>
      </div>`;
    return document.getElementById("root") as HTMLElement;
  }

  it("lands on the first focusable inside the active panel", () => {
    const root = fixture('<button id="inner">inner</button>');
    const focusFirst = vi.fn((scope: HTMLElement) => {
      const el = scope.querySelector<HTMLElement>("#inner");
      if (!el) return false;
      el.focus();
      return !!document.activeElement && document.activeElement === el;
    });

    expect(focusTabLanding({ root, tabId: "media", focusFirst })).toBe("content");
    expect(focusFirst).toHaveBeenCalledTimes(1);
    expect(document.activeElement?.id).toBe("inner");
  });

  it("keeps focus on the tab when the panel has nothing focusable", () => {
    const root = fixture("<p>read only</p>");
    const focusFirst = vi.fn(() => false);

    expect(focusTabLanding({ root, tabId: "media", focusFirst })).toBe("tab");
    expect(document.activeElement?.id).toBe("bigscreen-tab-media");
  });

  it("does not look at an inactive panel", () => {
    document.body.innerHTML = `
      <div id="root">
        <button id="bigscreen-tab-specs" role="tab">specs</button>
        <div role="tabpanel" data-tab-id="specs" data-active="false">
          <button id="hidden">hidden</button>
        </div>
      </div>`;
    const root = document.getElementById("root") as HTMLElement;
    const focusFirst = vi.fn(() => true);

    expect(focusTabLanding({ root, tabId: "specs", focusFirst })).toBe("tab");
    expect(focusFirst).not.toHaveBeenCalled();
  });

  it("reports nothing to do when the page root is gone", () => {
    expect(
      focusTabLanding({ root: null, tabId: "media", focusFirst: () => true }),
    ).toBe("none");
  });
});
