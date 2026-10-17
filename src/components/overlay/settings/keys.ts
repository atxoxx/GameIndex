/**
 * Every overlay setting the two settings surfaces — the in-overlay
 * `SettingsWidget` and the Settings → Overlay tab — must both expose.
 *
 * `parity.test.ts` asserts each key is rendered by both surfaces, so a field
 * added to only one surface fails the test instead of silently drifting.
 * Keep this list in sync with the fields rendered via `fields.tsx`.
 */
export const OVERLAY_SETTING_KEYS = [
  "hotkey",
  "corner",
  "opacity",
  "tickerLayout",
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
  "tickerAutoDimSeconds",
  "tickerAutoHideSeconds",
  "tickerWidgets",
  "panelWidgets",
] as const;

export type OverlaySettingKey = (typeof OVERLAY_SETTING_KEYS)[number];
