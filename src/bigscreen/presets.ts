// Big Screen layout presets.
//
// A preset is not a skin: it picks the navigation paradigm, the home
// composition, the card geometry and the motion budget for the whole
// TV shell. Everything it changes is expressed as data attributes on
// the shell root (`data-preset`) plus CSS custom properties in
// `styles/bigscreen/presets.css`; components read the structured
// traits from here instead of hardcoding a look.
//
// Adding a preset means: one entry in PRESETS, one `[data-preset]`
// block in presets.css, and any new i18n keys in all six locales.

export type BigScreenPresetId =
  | "xbox"
  | "steam"
  | "playstation"
  | "switch"
  | "classic";

/** Where the section navigation lives and how it is drawn. */
export type NavParadigm =
  /** Wide tiles across the top; labels always visible. */
  | "tiles"
  /** Persistent vertical icon+label rail on the left. */
  | "rail"
  /** Centred typographic row with no icons. */
  | "hub"
  /** Square icon-only row, labels on focus. */
  | "icons"
  /** Inline icon+label strip with a utility cluster (pre-1.7 look). */
  | "strip";

/** How the home screen is assembled. */
export type HomeParadigm =
  | "dashboard"
  | "shelves"
  | "cinematic"
  | "grid"
  | "spotlight";

export type CardShape = "landscape" | "poster" | "square";

export type MotionBudget = "cinematic" | "subtle" | "flat";

/** Default section-navigation visibility. */
export type NavVisibility = "always" | "compact" | "auto";

export interface BigScreenPreset {
  id: BigScreenPresetId;
  /** i18n key for the preset name. */
  labelKey: string;
  /** i18n key for the one-line description in the picker. */
  blurbKey: string;
  nav: NavParadigm;
  home: HomeParadigm;
  cardShape: CardShape;
  motion: MotionBudget;
  /** Whether the nav sits above the content or beside it. */
  placement: "top" | "side";
  /** Nav visibility the preset ships with. */
  navVisibility: NavVisibility;
}

export const PRESETS: readonly BigScreenPreset[] = [
  {
    id: "xbox",
    labelKey: "bigscreen.presets.xbox",
    blurbKey: "bigscreen.presets.xboxBlurb",
    nav: "tiles",
    home: "dashboard",
    cardShape: "landscape",
    motion: "cinematic",
    placement: "top",
    navVisibility: "compact",
  },
  {
    id: "steam",
    labelKey: "bigscreen.presets.steam",
    blurbKey: "bigscreen.presets.steamBlurb",
    nav: "rail",
    home: "shelves",
    cardShape: "poster",
    motion: "subtle",
    placement: "side",
    navVisibility: "always",
  },
  {
    id: "playstation",
    labelKey: "bigscreen.presets.playstation",
    blurbKey: "bigscreen.presets.playstationBlurb",
    nav: "hub",
    home: "cinematic",
    cardShape: "landscape",
    motion: "cinematic",
    placement: "top",
    navVisibility: "compact",
  },
  {
    id: "switch",
    labelKey: "bigscreen.presets.switch",
    blurbKey: "bigscreen.presets.switchBlurb",
    nav: "icons",
    home: "grid",
    cardShape: "square",
    motion: "flat",
    placement: "top",
    navVisibility: "compact",
  },
  {
    id: "classic",
    labelKey: "bigscreen.presets.classic",
    blurbKey: "bigscreen.presets.classicBlurb",
    nav: "strip",
    home: "spotlight",
    cardShape: "poster",
    motion: "subtle",
    placement: "top",
    navVisibility: "always",
  },
] as const;

/** Preset used by a fresh install and by unknown persisted values. */
export const DEFAULT_PRESET: BigScreenPresetId = "xbox";

/** Order used by the "next preset" quick-settings action. */
export const PRESET_CYCLE: readonly BigScreenPresetId[] = PRESETS.map(
  (preset) => preset.id,
);

const PRESET_BY_ID = new Map(PRESETS.map((preset) => [preset.id, preset]));

export function isPresetId(value: unknown): value is BigScreenPresetId {
  return typeof value === "string" && PRESET_BY_ID.has(value as BigScreenPresetId);
}

/** Never throws: unknown ids fall back to the default preset. */
export function coercePreset(value: unknown): BigScreenPresetId {
  return isPresetId(value) ? value : DEFAULT_PRESET;
}

export function getPreset(id: BigScreenPresetId): BigScreenPreset {
  return PRESET_BY_ID.get(id) ?? PRESET_BY_ID.get(DEFAULT_PRESET)!;
}

/** The preset after `id` in cycle order, wrapping at the end. */
export function nextPreset(id: BigScreenPresetId): BigScreenPresetId {
  const index = PRESET_CYCLE.indexOf(id);
  return PRESET_CYCLE[(index + 1) % PRESET_CYCLE.length] ?? DEFAULT_PRESET;
}

export function isNavVisibility(value: unknown): value is NavVisibility {
  return value === "always" || value === "compact" || value === "auto";
}

/**
 * Card geometry shared with `GameGrid`, which measures the first
 * painted card instead of hardcoding a column width. These are the
 * CSS fallbacks the presets resolve to.
 */
export const CARD_SHAPE_ASPECT: Record<CardShape, string> = {
  landscape: "16 / 9",
  poster: "2 / 3",
  square: "1 / 1",
};
