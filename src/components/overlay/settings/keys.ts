/**
 * Overlay settings exposed by the desktop page (Settings → Overlay).
 *
 * `parity.test.ts` asserts every key here is rendered by `OverlayTab`, so a
 * field added to the backend without a UI surface fails the test instead of
 * silently drifting.
 */
export const OVERLAY_SETTING_KEYS = [
  "hotkey",
  "corner",
  "opacity",
  "tickerLayout",
  "panelDensity",
  "backgroundStyle",
  "nativeBlur",
  "backgroundBlur",
  "backgroundOpacity",
  "reduceEffects",
  "tickerClickThrough",
  "highContrast",
  "textScale",
  "showTemps",
  "showGraphs",
  "detectCurrentGame",
  "screenshotFormat",
  "screenshotHotkey",
  "screenshotSound",
  "screenshotFlash",
  "screenshotCopyToClipboard",
  "screenshotIncludeOverlay",
  "videoEnabled",
  "videoHotkey",
  "replayHotkey",
  "videoFps",
  "videoBitrateKbps",
  "videoCountdownMs",
  "videoGameAudio",
  "videoMicrophone",
  "videoShowCursor",
  "videoHideOverlay",
  "videoAudioDevice",
  "videoMicDevice",
  "replayBufferSeconds",
  "tickerAutoDimSeconds",
  "tickerAutoHideSeconds",
  "tickerWidgets",
  "panelWidgets",
] as const;

/**
 * The curated subset the in-overlay quick-settings widget renders. Everything
 * else is one button away in the full settings page, which keeps the HUD
 * short and avoids two hand-maintained copies of every control.
 */
export const QUICK_SETTING_KEYS = [
  "panelDensity",
  "tickerLayout",
  "tickerWidgets",
  "tickerClickThrough",
  "backgroundStyle",
  "nativeBlur",
  "backgroundBlur",
  "backgroundOpacity",
  "reduceEffects",
  "highContrast",
  "textScale",
  "hotkey",
  "screenshotHotkey",
  "videoHotkey",
  "replayHotkey",
  "screenshotSound",
  "screenshotFlash",
  "screenshotCopyToClipboard",
  "videoEnabled",
  "replayBufferSeconds",
  "videoCountdownMs",
  "detectCurrentGame",
  "showTemps",
  "showGraphs",
] as const;

export type OverlaySettingKey = (typeof OVERLAY_SETTING_KEYS)[number];
export type QuickSettingKey = (typeof QUICK_SETTING_KEYS)[number];
