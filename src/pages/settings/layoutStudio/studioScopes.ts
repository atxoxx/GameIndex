// studioScopes — the navigation + search model for the Layout Studio.
//
// The studio edits ~150 small settings spread over the app shell and 17 pages.
// Browsing them through the preview alone assumes the user already knows what
// is clickable, so this module builds one flat, translated index of everything
// the studio can change. The left rail groups it by place; the search box
// queries the same list, which keeps discovery and navigation on one model.

import {
  DETAIL_TOP_BAR,
  DETAIL_TOP_BAR_LABEL_KEY,
  HERO_ELEMENTS,
  HERO_ELEMENT_LABEL_KEY,
  DETAIL_TAB_LABEL_KEY,
  DETAIL_TABS,
  SIDEBAR_SECTIONS,
  WIDGET_LABEL_KEY,
  interfacePageDef,
  isDetailSectionKeyAvailable,
  isDetailTopBarKeyAvailable,
  type DetailTabKey,
  type InterfacePageKey,
} from "../../../context/interfaceLayout";
import {
  BADGE_ITEMS,
  NAV_BUTTON_ITEMS,
  NAV_TAB_ITEMS,
  WIDGET_ITEMS,
} from "../interfaceItems";

export type Translate = (key: string, vars?: Record<string, unknown>) => string;

/** One column in the rail: a plain-language area of the app. */
export interface StudioNavGroup {
  id: "shell" | "library" | "store" | "discover" | "progress" | "tools";
  labelKey: string;
  pages: InterfacePageKey[];
}

/**
 * The rail's grouping. It follows what a user wants to change (their library
 * view, the store, social features) rather than the app's route table, and it
 * keeps 18 page tabs from reading as one undifferentiated strip.
 */
export const STUDIO_NAV_GROUPS: StudioNavGroup[] = [
  { id: "shell", labelKey: "settings.studio.groupShell", pages: ["global"] },
  {
    id: "library",
    labelKey: "settings.studio.groupLibrary",
    pages: ["home", "library", "game"],
  },
  { id: "store", labelKey: "settings.studio.groupStore", pages: ["store", "storeGame"] },
  {
    id: "discover",
    labelKey: "settings.studio.groupDiscover",
    pages: ["wishlist", "deals", "news"],
  },
  {
    id: "progress",
    labelKey: "settings.studio.groupProgress",
    pages: ["activity", "achievements", "friends", "community"],
  },
  {
    id: "tools",
    labelKey: "settings.studio.groupTools",
    pages: ["downloads", "storage", "mods", "saves", "emulators"],
  },
];

/** Element families. The kind is shown as a small caption under each result. */
export type StudioSearchKind =
  | "navTab"
  | "navButton"
  | "sidebar"
  | "badge"
  | "appBlock"
  | "heroExtra"
  | "pageBlock"
  | "detailTab"
  | "heroElement"
  | "detailTopBar";

export const STUDIO_KIND_LABEL_KEY: Record<StudioSearchKind, string> = {
  navTab: "settings.studio.kindNavTab",
  navButton: "settings.studio.kindNavButton",
  sidebar: "settings.studio.kindSidebar",
  badge: "settings.studio.kindBadge",
  appBlock: "settings.studio.kindAppBlock",
  heroExtra: "settings.studio.kindHeroExtra",
  pageBlock: "settings.studio.kindBlock",
  detailTab: "settings.studio.kindDetailTab",
  heroElement: "settings.studio.kindHero",
  detailTopBar: "settings.studio.kindTopBar",
};

export interface StudioSearchEntry {
  /** Stable element id; matches `studio-row-<id>` in the inspector. */
  id: string;
  /** The scope to open when the entry is chosen. */
  scope: InterfacePageKey;
  kind: StudioSearchKind;
  /** Translated, user-facing name. */
  label: string;
  /** Translated family caption ("Top bar tab"). */
  hint: string;
  /** Extra English terms so search works beyond the visible label. */
  keywords: string;
}

export interface StudioSearchIndexOptions {
  t: Translate;
  showDeckVerified: boolean;
  showFullLinuxUi: boolean;
}

const EXTRA_KEYWORDS: Record<string, string> = {
  navHome: "home start dashboard",
  navLibrary: "library games collection",
  navStore: "store shop buy",
  navWishlist: "wishlist saved wants",
  navDeals: "deals sales discounts price",
  navActivity: "activity playtime sessions history",
  navNews: "news feed articles",
  navEmulators: "emulators roms consoles",
  navMods: "mods plugins",
  navAchievements: "achievements trophies",
  navStorage: "storage disk space",
  navDownloads: "downloads queue",
  navSaves: "saves backups",
  navCommunity: "community social",
  navFriends: "friends social",
  btnDownloads: "downloads button queue",
  btnSettings: "settings gear",
  btnDocs: "docs help guide",
  btnBigScreen: "big screen tv controller couch",
  badgePlatform: "platform steam gog epic badge",
  badgePlaytime: "playtime hours badge",
  badgeInstall: "installed ready badge",
  badgeRating: "rating score badge",
  badgeCrackwatch: "crackwatch status badge",
  badgeCompare: "price compare badge",
  widgetKpis: "kpi stats tiles",
  widgetFilters: "filters facets",
  widgetSubtabs: "subtabs sections",
  widgetHero: "hero spotlight banner",
  widgetDashboard: "dashboard overview",
};

/** Build one searchable entry per studio-controlled element. */
export function buildStudioSearchIndex({
  t,
  showDeckVerified,
  showFullLinuxUi,
}: StudioSearchIndexOptions): StudioSearchEntry[] {
  const entries: StudioSearchEntry[] = [];
  const push = (
    id: string,
    scope: InterfacePageKey,
    kind: StudioSearchKind,
    labelKey: string,
    extra?: string,
  ) => {
    entries.push({
      id,
      scope,
      kind,
      label: t(labelKey),
      hint: t(STUDIO_KIND_LABEL_KEY[kind]),
      keywords: `${labelKey} ${EXTRA_KEYWORDS[id] ?? ""} ${extra ?? ""}`.toLowerCase(),
    });
  };

  for (const item of NAV_TAB_ITEMS) push(item.key, "global", "navTab", item.labelKey);
  for (const item of NAV_BUTTON_ITEMS) push(item.key, "global", "navButton", item.labelKey);
  push("now-playing", "global", "navButton", "settings.appearance.navbarNowPlayingTitle", "now playing indicator");
  for (const section of SIDEBAR_SECTIONS) {
    push(section.key, "global", "sidebar", section.labelKey);
  }
  for (const item of BADGE_ITEMS) push(item.key, "global", "badge", item.labelKey);
  for (const item of WIDGET_ITEMS) push(item.key, "global", "appBlock", item.labelKey);
  push("show-card-badges", "global", "badge", "settings.appearance.cardBadgesTitle");
  push("hero-tilt", "global", "heroExtra", "settings.interface.heroTiltChip");
  push(
    "hero-backdrop-controls",
    "global",
    "heroExtra",
    "settings.interface.heroBackdropControlsChip",
  );
  push(
    "hero-interactive-controls",
    "global",
    "heroExtra",
    "settings.interface.heroInteractiveControlsChip",
  );
  push("smart-shelves", "global", "appBlock", "settings.interface.smartShelvesTitle");

  for (const page of STUDIO_NAV_GROUPS.flatMap((group) => group.pages)) {
    if (page === "global") continue;
    const def = interfacePageDef(page);
    for (const key of def?.items ?? []) {
      push(key, page, "pageBlock", WIDGET_LABEL_KEY[key]);
    }

    const scope =
      page === "game" ? "game" : page === "storeGame" ? "store" : null;
    if (!scope) continue;

    for (const key of DETAIL_TABS[scope]) {
      if (key !== "overview" && !isDetailSectionKeyAvailable(key, { showDeckVerified })) {
        continue;
      }
      entries.push({
        // The row id the inspector renders, so a hit can be highlighted there.
        id: key,
        scope: page,
        kind: "detailTab",
        label: t(DETAIL_TAB_LABEL_KEY[key as DetailTabKey]),
        hint: t(STUDIO_KIND_LABEL_KEY.detailTab),
        keywords: `detail tab ${key} ${DETAIL_TAB_LABEL_KEY[key as DetailTabKey]}`.toLowerCase(),
      });
    }

    for (const key of HERO_ELEMENTS) {
      entries.push({
        id: key,
        scope: page,
        kind: "heroElement",
        label: t(HERO_ELEMENT_LABEL_KEY[key]),
        hint: t(STUDIO_KIND_LABEL_KEY.heroElement),
        keywords: `hero header ${key} ${HERO_ELEMENT_LABEL_KEY[key]}`.toLowerCase(),
      });
    }

    for (const key of DETAIL_TOP_BAR[scope]) {
      if (!isDetailTopBarKeyAvailable(key, { showFullLinuxUi })) continue;
      const labelKey = DETAIL_TOP_BAR_LABEL_KEY[scope][key] ?? key;
      entries.push({
        id: key,
        scope: page,
        kind: "detailTopBar",
        label: t(labelKey),
        hint: t(STUDIO_KIND_LABEL_KEY.detailTopBar),
        keywords: `page button ${key} ${scope} top bar ${labelKey}`.toLowerCase(),
      });
    }
  }

  return entries;
}

/** Lowercase, accent-insensitive-enough comparison form for search. */
function normalize(value: string): string {
  return value.toLocaleLowerCase();
}

/**
 * Filter the index for a query. Every whitespace-separated term must match the
 * label or the keywords, and label hits rank before keyword-only hits so
 * "tabs" surfaces the detail tabs before an unrelated block.
 */
export function searchStudioIndex(
  index: StudioSearchEntry[],
  query: string,
  limit = 40,
): StudioSearchEntry[] {
  const trimmed = normalize(query.trim());
  if (trimmed.length === 0) return [];
  const terms = trimmed.split(/\s+/).filter(Boolean);

  const scored: { entry: StudioSearchEntry; score: number; order: number }[] = [];
  index.forEach((entry, order) => {
    const label = normalize(entry.label);
    const haystack = `${label} ${entry.keywords}`;
    if (!terms.every((term) => haystack.includes(term))) return;
    let score = 0;
    if (label.startsWith(trimmed)) score += 4;
    else if (label.includes(trimmed)) score += 2;
    if (label.includes(terms[0])) score += 1;
    scored.push({ entry, score, order });
  });

  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.slice(0, limit).map((item) => item.entry);
}

/** Group search hits by the scope they live in, preserving index order. */
export function groupStudioSearchResults(
  results: StudioSearchEntry[],
): { scope: InterfacePageKey; entries: StudioSearchEntry[] }[] {
  const groups: { scope: InterfacePageKey; entries: StudioSearchEntry[] }[] = [];
  for (const entry of results) {
    const existing = groups.find((group) => group.scope === entry.scope);
    if (existing) existing.entries.push(entry);
    else groups.push({ scope: entry.scope, entries: [entry] });
  }
  return groups;
}

/** The translated name of a scope, for the rail, inspector heading and search. */
export function studioScopeLabel(scope: InterfacePageKey, t: Translate): string {
  if (scope === "global") return t("settings.studio.scopeGlobal");
  const def = interfacePageDef(scope);
  return def ? t(def.labelKey) : t("settings.studio.scopeGlobal");
}
