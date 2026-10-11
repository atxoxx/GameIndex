import type { OverlayTickerLayout } from "../../context/OverlayContext";

/**
 * Reduced-HUD presentation presets.
 *
 * These live outside `OverlayContext` so the ticker component (whose context
 * module is mocked in tests) can import the labels/defaults without pulling in
 * the provider, and so the settings surfaces share one source of truth.
 */
export interface OverlayTickerLayoutOption {
  id: OverlayTickerLayout;
  labelKey: string;
  hintKey: string;
}

export const TICKER_LAYOUTS: OverlayTickerLayoutOption[] = [
  {
    id: "strip",
    labelKey: "overlay.layout.strip",
    hintKey: "overlay.layout.stripHint",
  },
  {
    id: "single",
    labelKey: "overlay.layout.single",
    hintKey: "overlay.layout.singleHint",
  },
  {
    id: "gauges",
    labelKey: "overlay.layout.gauges",
    hintKey: "overlay.layout.gaugesHint",
  },
  {
    id: "minimal",
    labelKey: "overlay.layout.minimal",
    hintKey: "overlay.layout.minimalHint",
  },
];

export const DEFAULT_TICKER_LAYOUT: OverlayTickerLayout = "strip";

/** Coerce an unknown persisted value to a valid preset. */
export function normalizeTickerLayout(
  value: unknown,
): OverlayTickerLayout {
  return TICKER_LAYOUTS.some((option) => option.id === value)
    ? (value as OverlayTickerLayout)
    : DEFAULT_TICKER_LAYOUT;
}
