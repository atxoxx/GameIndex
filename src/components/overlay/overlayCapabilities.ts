/**
 * The overlay's platform capabilities, as reported by
 * `overlay_capabilities` in the Electron main process.
 *
 * The HUD can always open; what differs per compositor is whether it can stay
 * above the game and whether the collapsed ticker can pass clicks through.
 * This module keeps the mapping from those traits to user-facing copy pure and
 * testable so the settings page never claims more than the platform supports.
 */
export interface OverlayCapabilities {
  platform: "windows" | "linux" | "macos" | "other";
  displayServer: "windows" | "x11" | "wayland" | "other";
  desktop: string;
  alwaysOnTop: "native" | "compositor" | "limited";
  clickThrough: boolean;
  panelFocus: boolean;
}

/** i18n key describing the stacking strategy for this session. */
export function capabilityNoteKey(capabilities: OverlayCapabilities): string {
  if (capabilities.alwaysOnTop === "native") {
    if (capabilities.platform === "windows") return "overlay.capability.windows";
    if (capabilities.platform === "linux") return "overlay.capability.x11";
    return "overlay.capability.limited";
  }
  if (capabilities.alwaysOnTop === "compositor") {
    return capabilities.desktop === "kde"
      ? "overlay.capability.kwin"
      : "overlay.capability.compositor";
  }
  return "overlay.capability.limited";
}

/** Whether the session can honestly advertise ticker click-through. */
export function capabilitySupportsClickThrough(
  capabilities: OverlayCapabilities,
): boolean {
  return capabilities.clickThrough;
}
