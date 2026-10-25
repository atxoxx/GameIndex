import type {
  OverlayDensity,
  OverlayTickerLayout,
} from "../../context/OverlayContext";

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
    id: "gauges",
    labelKey: "overlay.layout.gauges",
    hintKey: "overlay.layout.gaugesHint",
  },
];

export const DEFAULT_TICKER_LAYOUT: OverlayTickerLayout = "strip";

/**
 * Coerce an unknown persisted value to a valid preset. Older builds shipped
 * `single` and `minimal`; both collapse into the condensed strip, which now
 * covers their use cases.
 */
export function normalizeTickerLayout(
  value: unknown,
): OverlayTickerLayout {
  return value === "gauges" ? "gauges" : DEFAULT_TICKER_LAYOUT;
}

export const DENSITY_OPTIONS: {
  id: OverlayDensity;
  labelKey: string;
  hintKey: string;
}[] = [
  {
    id: "comfortable",
    labelKey: "overlay.density.comfortable",
    hintKey: "overlay.density.comfortableHint",
  },
  {
    id: "compact",
    labelKey: "overlay.density.compact",
    hintKey: "overlay.density.compactHint",
  },
];

export function normalizeDensity(value: unknown): OverlayDensity {
  return value === "compact" ? "compact" : "comfortable";
}
