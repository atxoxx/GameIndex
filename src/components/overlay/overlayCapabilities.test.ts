import { describe, expect, it } from "vitest";
import {
  capabilityNoteKey,
  capabilitySupportsClickThrough,
  type OverlayCapabilities,
} from "./overlayCapabilities";

function caps(overrides: Partial<OverlayCapabilities>): OverlayCapabilities {
  return {
    platform: "windows",
    displayServer: "windows",
    desktop: "none",
    alwaysOnTop: "native",
    clickThrough: true,
    panelFocus: true,
    ...overrides,
  };
}

describe("overlay capabilities", () => {
  it("reports native stacking on Windows and X11", () => {
    expect(capabilityNoteKey(caps({}))).toBe("overlay.capability.windows");
    expect(
      capabilityNoteKey(
        caps({ platform: "linux", displayServer: "x11", desktop: "gnome" }),
      ),
    ).toBe("overlay.capability.x11");
  });

  it("reports the KWin integration only on KDE Wayland", () => {
    expect(
      capabilityNoteKey(
        caps({
          platform: "linux",
          displayServer: "wayland",
          desktop: "kde",
          alwaysOnTop: "compositor",
        }),
      ),
    ).toBe("overlay.capability.kwin");
    expect(
      capabilityNoteKey(
        caps({
          platform: "linux",
          displayServer: "wayland",
          desktop: "gnome",
          alwaysOnTop: "limited",
          clickThrough: false,
        }),
      ),
    ).toBe("overlay.capability.limited");
  });

  it("never advertises click-through where the compositor cannot do it", () => {
    expect(capabilitySupportsClickThrough(caps({ clickThrough: false }))).toBe(false);
    expect(capabilitySupportsClickThrough(caps({}))).toBe(true);
  });
});
