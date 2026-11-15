// Big Screen interface layouts.
//
// A layout is not a skin: it selects a whole composition - the chrome
// paradigm, the home page, the library, the game detail page, the card
// geometry and the motion budget. Everything it changes is expressed as
// data attributes on the shell root (`data-layout`, plus the legacy
// `data-preset` alias) and consumed by the layout compositions under
// `components/bigscreen/layouts/`. Components read the structured
// traits from here instead of hardcoding a look.
//
// Adding a layout means: one entry in LAYOUTS, one `[data-layout]`
// block in the layout stylesheet, one composition set under
// `components/bigscreen/layouts/`, and new i18n keys in all six
// locales.

export type BigScreenPresetId =
  | "gameindex"
  | "xbox"
  | "steam"
  | "playstation"
  | "switch";

/** Backwards-compatible alias so persisted "classic" keeps working. */
export const LEGACY_PRESET_ALIASES: Record<string, BigScreenPresetId> = {
  classic: "gameindex",
  gameindex: "gameindex",
};

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
  /** Inline icon+label strip with a utility cluster. */
  | "strip";

/** How the home screen is assembled. */
export type HomeParadigm =
  | "editorial"
  | "dashboard"
  | "shelves"
  | "cinematic"
  | "grid";

/** How the library organises the collection. */
export type LibraryParadigm =
  | "editorial"
  | "dashboard"
  | "docs"
  | "carousel"
  | "grid";

/** How the game detail page is composed. */
export type DetailParadigm =
  | "workspace"
  | "hub"
  | "dossier"
  | "cinematic"
  | "simple";

export type CardShape = "landscape" | "poster" | "square";

export type MotionBudget = "cinematic" | "subtle" | "flat";

/** Default section-navigation visibility. */
export type NavVisibility = "always" | "compact" | "auto";

export interface BigScreenPreset {
  id: BigScreenPresetId;
  /** i18n key for the layout name. */
  labelKey: string;
  /** i18n key for the one-line description in the picker. */
  blurbKey: string;
  nav: NavParadigm;
  home: HomeParadigm;
  library: LibraryParadigm;
  detail: DetailParadigm;
  cardShape: CardShape;
  motion: MotionBudget;
  /** Whether the nav sits above the content, beside it, or below it. */
  placement: "top" | "side" | "bottom";
  /** Nav visibility the layout ships with. */
  navVisibility: NavVisibility;
}

export const PRESETS: readonly BigScreenPreset[] = [
  {
    id: "gameindex",
    labelKey: "bigscreen.presets.gameindex",
    blurbKey: "bigscreen.presets.gameindexBlurb",
    nav: "strip",
    home: "editorial",
    library: "editorial",
    detail: "workspace",
    cardShape: "landscape",
    motion: "subtle",
    placement: "top",
    navVisibility: "compact",
  },
  {
    id: "xbox",
    labelKey: "bigscreen.presets.xbox",
    blurbKey: "bigscreen.presets.xboxBlurb",
    nav: "tiles",
    home: "dashboard",
    library: "dashboard",
    detail: "hub",
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
    library: "docs",
    detail: "dossier",
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
    library: "carousel",
    detail: "cinematic",
    cardShape: "square",
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
    library: "grid",
    detail: "simple",
    cardShape: "square",
    motion: "flat",
    placement: "bottom",
    navVisibility: "always",
  },
] as const;

/** Layout used by a fresh install and by unknown persisted values. */
export const DEFAULT_PRESET: BigScreenPresetId = "gameindex";

/** Order used by the layout selector and the "next layout" action. */
export const PRESET_CYCLE: readonly BigScreenPresetId[] = PRESETS.map(
  (preset) => preset.id,
);

const PRESET_BY_ID = new Map(PRESETS.map((preset) => [preset.id, preset]));

export function isPresetId(value: unknown): value is BigScreenPresetId {
  return typeof value === "string" && PRESET_BY_ID.has(value as BigScreenPresetId);
}

/** Never throws: legacy aliases resolve, unknown ids fall back. */
export function coercePreset(value: unknown): BigScreenPresetId {
  if (typeof value === "string" && LEGACY_PRESET_ALIASES[value]) {
    return LEGACY_PRESET_ALIASES[value];
  }
  return isPresetId(value) ? value : DEFAULT_PRESET;
}

export function getPreset(id: BigScreenPresetId): BigScreenPreset {
  return PRESET_BY_ID.get(id) ?? PRESET_BY_ID.get(DEFAULT_PRESET)!;
}

/** The layout after `id` in cycle order, wrapping at the end. */
export function nextPreset(id: BigScreenPresetId): BigScreenPresetId {
  const index = PRESET_CYCLE.indexOf(id);
  return PRESET_CYCLE[(index + 1) % PRESET_CYCLE.length] ?? DEFAULT_PRESET;
}

export function isNavVisibility(value: unknown): value is NavVisibility {
  return value === "always" || value === "compact" || value === "auto";
}

/** Card geometry shared with `GameGrid`/`GameTile`. */
export const CARD_SHAPE_ASPECT: Record<CardShape, string> = {
  landscape: "16 / 9",
  poster: "2 / 3",
  square: "1 / 1",
};
