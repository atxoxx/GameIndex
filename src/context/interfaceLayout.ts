// interfaceLayout — the shared model behind the Interface settings tab and
// the Layout Studio modal.
//
// The Interface settings surface lets the user hide and rearrange the app's
// chrome. This module is the single declaration of *what* can be arranged so
// the settings tab, the studio modal and the runtime bridge (PageLayoutBridge)
// all agree on the same keys, shipped order and localStorage normalization:
//
//  • PageWidgetKey     — the page-level widget categories pages already mark
//                        with `.ui-item-*` classes (see theme.css). The studio
//                        can hide and reorder them per page.
//  • InterfacePageKey  — one entry per app page, plus "global" for the header
//                        and sidebar chrome shared by every page.
//  • SidebarSectionKey — the sidebar's top-level elements.
//
// localStorage is append-only, so the normalizers below drop unknown keys and
// append anything new — an upgrade never leaves a freshly-added element
// unrendered.

// ── Page widgets ────────────────────────────────────────────────────────────

/** Widget categories a page can render. Mirrors the `.ui-item-*` markers. */
export type PageWidgetKey =
  | "hero"
  | "kpis"
  | "filters"
  | "subtabs"
  | "dashboard";

export const PAGE_WIDGET_KEYS: PageWidgetKey[] = [
  "hero",
  "kpis",
  "filters",
  "subtabs",
  "dashboard",
];

/** Widget key → the CSS class the pages mark their blocks with. */
export const WIDGET_CLASS: Record<PageWidgetKey, string> = {
  hero: "ui-item-hero",
  kpis: "ui-item-kpis",
  filters: "ui-item-filters",
  subtabs: "ui-item-subtabs",
  dashboard: "ui-item-dashboard",
};

/** Widget key → translation key used in the settings UI. */
export const WIDGET_LABEL_KEY: Record<PageWidgetKey, string> = {
  hero: "settings.interface.widgetHero",
  kpis: "settings.interface.widgetKpis",
  filters: "settings.interface.widgetFilters",
  subtabs: "settings.interface.widgetSubtabs",
  dashboard: "settings.interface.widgetDashboard",
};

// ── Pages ───────────────────────────────────────────────────────────────────

export type InterfacePageKey =
  | "global"
  | "home"
  | "library"
  | "game"
  | "store"
  | "wishlist"
  | "deals"
  | "news"
  | "activity"
  | "achievements"
  | "downloads"
  | "storage"
  | "community"
  | "friends"
  | "emulators"
  | "mods";

export interface InterfacePageDef {
  key: InterfacePageKey;
  /** Label shown on the studio's page tabs. */
  labelKey: string;
  /** Route prefixes owned by this page; `""` means "never matched". */
  routes: string[];
  /** Widget categories the page actually renders, in shipped order. */
  items: PageWidgetKey[];
}

/**
 * Page registry. `items` lists only the categories each page really marks so
 * the studio never offers a toggle that would be a no-op.
 */
export const INTERFACE_PAGES: InterfacePageDef[] = [
  { key: "global", labelKey: "settings.interface.studioPageGlobal", routes: [], items: [] },
  { key: "home", labelKey: "nav.home", routes: ["/home"], items: ["hero", "dashboard"] },
  { key: "library", labelKey: "nav.library", routes: ["/library"], items: ["hero", "filters"] },
  { key: "game", labelKey: "settings.interface.studioPageGame", routes: ["/library/"], items: ["kpis"] },
  { key: "store", labelKey: "nav.store", routes: ["/store"], items: ["hero", "filters"] },
  { key: "wishlist", labelKey: "nav.wishlist", routes: ["/wishlist"], items: ["filters"] },
  { key: "deals", labelKey: "nav.deals", routes: ["/deals"], items: ["hero"] },
  { key: "news", labelKey: "nav.news", routes: ["/news"], items: ["hero", "filters"] },
  { key: "activity", labelKey: "nav.activity", routes: ["/activity"], items: ["filters", "subtabs"] },
  { key: "achievements", labelKey: "nav.achievements", routes: ["/achievements"], items: ["dashboard"] },
  { key: "downloads", labelKey: "nav.downloads", routes: ["/downloads"], items: ["dashboard"] },
  { key: "storage", labelKey: "nav.storage", routes: ["/storage"], items: ["kpis", "filters", "dashboard"] },
  { key: "community", labelKey: "nav.community", routes: ["/community"], items: ["subtabs"] },
  { key: "friends", labelKey: "nav.friends", routes: ["/friends"], items: ["kpis", "subtabs"] },
  { key: "emulators", labelKey: "nav.emulators", routes: ["/emulators"], items: ["filters", "dashboard"] },
  { key: "mods", labelKey: "nav.mods", routes: ["/mods"], items: ["dashboard"] },
];

/** Page key → default widget order. Derived from the registry above. */
export const DEFAULT_PAGE_ITEM_ORDER: Record<string, PageWidgetKey[]> =
  INTERFACE_PAGES.reduce<Record<string, PageWidgetKey[]>>((acc, page) => {
    acc[page.key] = [...page.items];
    return acc;
  }, {});

export function interfacePageDef(key: InterfacePageKey): InterfacePageDef | undefined {
  return INTERFACE_PAGES.find((page) => page.key === key);
}

/**
 * Resolve the active page for a route. The game detail page (`/library/<id>`)
 * is checked before the library page so the two never shadow each other.
 */
export function resolveInterfacePage(pathname: string): InterfacePageKey {
  if (pathname.startsWith("/library/")) return "game";
  let best: InterfacePageDef | null = null;
  for (const page of INTERFACE_PAGES) {
    if (page.key === "global") continue;
    if (page.routes.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
      if (!best || page.routes[0].length > best.routes[0].length) best = page;
    }
  }
  return best?.key ?? "global";
}

// ── Per-page item visibility & order ────────────────────────────────────────

/** Only OFF entries are persisted, same overrides pattern as the other maps. */
export type PageItemVisibilityMap = Partial<
  Record<InterfacePageKey, Partial<Record<PageWidgetKey, boolean>>>
>;

/** Custom widget order per page; absent entries fall back to the shipped order. */
export type PageItemOrderMap = Partial<Record<InterfacePageKey, PageWidgetKey[]>>;

/** Normalize a persisted per-page order: drop unknown/duplicates, append the
 *  page's remaining widgets so an upgrade never hides a newly added block. */
export function normalizePageItemOrder(
  page: InterfacePageKey,
  raw: unknown,
): PageWidgetKey[] {
  const known = interfacePageDef(page)?.items ?? [];
  const allowed = new Set<string>(known);
  const seen = new Set<string>();
  const ordered: PageWidgetKey[] = [];
  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (typeof value !== "string" || !allowed.has(value) || seen.has(value)) continue;
      seen.add(value);
      ordered.push(value as PageWidgetKey);
    }
  }
  for (const key of known) {
    if (!seen.has(key)) ordered.push(key);
  }
  return ordered;
}

/** Normalize the whole persisted per-page order map. */
export function normalizePageItemOrderMap(raw: unknown): PageItemOrderMap {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const next: PageItemOrderMap = {};
  for (const page of INTERFACE_PAGES) {
    if (page.key === "global") continue;
    const value = source[page.key];
    if (value === undefined) continue;
    next[page.key] = normalizePageItemOrder(page.key, value);
  }
  return next;
}

/** Normalize the persisted per-page visibility map: keep only known pages,
 *  known widget keys and explicit OFF entries. */
export function normalizePageItemVisibilityMap(raw: unknown): PageItemVisibilityMap {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const next: PageItemVisibilityMap = {};
  for (const page of INTERFACE_PAGES) {
    if (page.key === "global") continue;
    const value = source[page.key];
    if (!value || typeof value !== "object") continue;
    const allowed = new Set<string>(page.items);
    const entry: Partial<Record<PageWidgetKey, boolean>> = {};
    for (const [key, visible] of Object.entries(value as Record<string, unknown>)) {
      if (allowed.has(key) && visible === false) entry[key as PageWidgetKey] = false;
    }
    if (Object.keys(entry).length > 0) next[page.key] = entry;
  }
  return next;
}

// ── Sidebar sections ────────────────────────────────────────────────────────

export type SidebarSectionKey =
  | "search"
  | "activeFilters"
  | "gameList"
  | "alphabetRail"
  | "statsFooter";

export interface SidebarSectionDef {
  key: SidebarSectionKey;
  labelKey: string;
}

export const SIDEBAR_SECTIONS: SidebarSectionDef[] = [
  { key: "search", labelKey: "settings.interface.sidebarSectionSearch" },
  { key: "activeFilters", labelKey: "settings.interface.sidebarSectionActiveFilters" },
  { key: "gameList", labelKey: "settings.interface.sidebarSectionGameList" },
  { key: "alphabetRail", labelKey: "settings.interface.sidebarSectionAlphabet" },
  { key: "statsFooter", labelKey: "settings.interface.sidebarSectionStats" },
];

export type SidebarSectionVisibility = Record<SidebarSectionKey, boolean>;

export const DEFAULT_SIDEBAR_SECTION_VISIBILITY: SidebarSectionVisibility = {
  search: true,
  activeFilters: true,
  gameList: true,
  alphabetRail: true,
  statsFooter: true,
};

/** Normalize the persisted sidebar section visibility (OFF entries only). */
export function normalizeSidebarSectionVisibility(raw: unknown): SidebarSectionVisibility {
  const next = { ...DEFAULT_SIDEBAR_SECTION_VISIBILITY };
  if (raw && typeof raw === "object") {
    for (const { key } of SIDEBAR_SECTIONS) {
      const value = (raw as Record<string, unknown>)[key];
      if (typeof value === "boolean") next[key] = value;
    }
  }
  return next;
}
