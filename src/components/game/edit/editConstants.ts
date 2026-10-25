/** Shared option lists and per-slot metadata for the game editor. */

export const GENRE_SUGGESTIONS = [
  "Action", "Adventure", "RPG", "Shooter", "Strategy", "Puzzle", "Platformer",
  "Simulation", "Sports", "Racing", "Fighting", "Horror", "Indie", "Casual", "MMO",
];

export const THEME_SUGGESTIONS = [
  "Sci-Fi", "Fantasy", "Horror", "Open World", "Sandbox", "Survival",
  "Story Rich", "Atmospheric", "Pixel Graphics", "Post-Apocalyptic", "Cyberpunk", "Comedy",
];

export const MODE_SUGGESTIONS = [
  "Singleplayer", "Multiplayer", "Co-op", "Online Co-Op", "Split Screen", "PvP", "PvE", "Massively Multiplayer",
];

export const PERSPECTIVE_SUGGESTIONS = [
  "First-Person", "Third-Person", "Top-Down", "Side View", "Isometric", "Bird's-Eye", "Text",
];

export const LANGUAGE_SUPPORT_TYPES = ["Audio", "Subtitles", "Interface"];

export const ARTWORK_SLOT_LABEL_KEYS: Record<
  "icon" | "cover" | "hero" | "banner" | "logo",
  string
> = {
  icon: "edit.label.icon",
  cover: "edit.label.cover",
  hero: "edit.label.hero",
  banner: "edit.label.hero",
  logo: "edit.label.logo",
};

/** Quick launch flags offered as one-click chips. */
export const COMMON_LAUNCH_ARGS = [
  { label: "-windowed", descKey: "edit.arg.windowed" },
  { label: "-fullscreen", descKey: "edit.arg.fullscreen" },
  { label: "-novid", descKey: "edit.arg.novid" },
  { label: "-dx11", descKey: "edit.arg.dx11" },
  { label: "-vulkan", descKey: "edit.arg.vulkan" },
  { label: "-dev", descKey: "edit.arg.dev" },
  { label: "-high", descKey: "edit.arg.high" },
];

/** Currency options for the purchase-cost field. */
export const COST_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "BRL", "JPY", "INR", "RUB", "CNY"];

export type ArtworkSlot = "icon" | "cover" | "hero" | "logo";

/** Pinned-panel shape for each artwork slot: its label/subtitle keys and the
 *  preview box that matches the artwork's natural aspect ratio. */
export const IMAGE_SUBTAB_CONFIG: Record<
  ArtworkSlot,
  { labelKey: string; subtitleKey: string; preview: { w: number; h: number }; transparent?: boolean }
> = {
  icon: { labelKey: "edit.label.icon", subtitleKey: "edit.label.sidebar", preview: { w: 64, h: 64 }, transparent: true },
  cover: { labelKey: "edit.label.cover", subtitleKey: "edit.label.libraryCards", preview: { w: 120, h: 160 } },
  hero: { labelKey: "edit.label.hero", subtitleKey: "edit.label.gamePageTop", preview: { w: 240, h: 100 } },
  logo: { labelKey: "edit.label.logo", subtitleKey: "edit.label.titleImage", preview: { w: 200, h: 60 }, transparent: true },
};
