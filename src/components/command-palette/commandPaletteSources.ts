import { createElement, useEffect, useMemo, useState } from "react";
import { ExternalLink, Settings } from "lucide-react";
import { buildSettingsCatalog } from "../../pages/settings/settingsCatalog";
import { ALL_SUBCATEGORIES, findCategoryBySubId } from "../docs/docsContent";
import { ensureDocsLoaded, isDocsLoaded } from "../../i18n";
import type { PaletteItem } from "./commandPaletteTypes";
import { scoreMatch } from "./commandPaletteUtils";

export interface SettingsPaletteEntry {
  id: string;
  tab: string;
  sectionId?: string;
  kind: "tab" | "section";
  title: string;
  crumb: string;
  keywords: string;
  icon: ReturnType<typeof buildSettingsCatalog>["searchIndex"][number]["icon"];
}

/**
 * Flat settings destinations from the settings catalog — the same index the
 * settings page searches, so the palette can never drift from it.
 */
export function buildSettingsEntries(
  t: (key: string, vars?: Record<string, unknown>) => string,
  showFullLinuxUi: boolean
): SettingsPaletteEntry[] {
  const { searchIndex } = buildSettingsCatalog(t, { showFullLinuxUi });
  return searchIndex.map((entry) => ({
    id: entry.id,
    tab: entry.tab,
    sectionId: entry.kind === "section" ? entry.id : undefined,
    kind: entry.kind,
    title: entry.label,
    crumb: entry.crumb,
    keywords: entry.keywords,
    icon: entry.icon,
  }));
}

export function settingsEntryPath(entry: SettingsPaletteEntry): string {
  return entry.sectionId
    ? `/settings/${entry.tab}?section=${entry.sectionId}`
    : `/settings/${entry.tab}`;
}

/** Build navigable palette rows for every settings destination. */
export function buildSettingsPaletteItems(
  entries: SettingsPaletteEntry[],
  navigate: (path: string) => void,
  onClose: () => void,
  t: (key: string, vars?: Record<string, unknown>) => string
): PaletteItem[] {
  return entries.map((entry) => ({
    id: `settings-${entry.id}`,
    category: "settings",
    group: "settings",
    title: entry.title,
    subtitle: entry.crumb,
    icon: entry.icon ?? createElement(Settings, { size: 16 }),
    description: entry.crumb,
    actionText: t("commandPalette.jumpTo"),
    settingsData: { tab: entry.tab, sectionId: entry.sectionId },
    onSelect: () => {
      onClose();
      navigate(settingsEntryPath(entry));
    },
  }));
}

export interface DocsPaletteEntry {
  id: string;
  title: string;
  summary: string;
  categoryId: string;
  categoryTitle: string;
  keywords: string[];
  body?: string;
  bodyLower?: string;
  icon: (typeof ALL_SUBCATEGORIES)[number]["icon"];
}

/** Localized docs destinations built from the documentation index. */
export function buildDocsEntries(
  t: (key: string, vars?: Record<string, unknown>) => string,
  includeBody: boolean
): DocsPaletteEntry[] {
  return ALL_SUBCATEGORIES.map((sub) => {
    const titleKey = `docs.${sub.id}.title`;
    const localizedTitle = t(titleKey);
    const cat = findCategoryBySubId(sub.id);
    const catKey = cat ? `docs.cat.${cat.id}` : "";
    const localizedCat = catKey ? t(catKey) : "";

    let body: string | undefined;
    if (includeBody) {
      const bodyKey = `docs.${sub.id}.body`;
      const localizedBody = t(bodyKey);
      body = localizedBody && localizedBody !== bodyKey ? localizedBody : sub.body;
    }

    return {
      id: sub.id,
      title: localizedTitle && localizedTitle !== titleKey ? localizedTitle : sub.title,
      summary: sub.summary,
      categoryId: sub.categoryId,
      categoryTitle:
        cat && localizedCat && localizedCat !== catKey ? localizedCat : cat?.title ?? sub.categoryId,
      keywords: sub.keywords,
      body,
      bodyLower: body?.toLowerCase(),
      icon: sub.icon,
    };
  });
}

export function buildDocsPaletteItems(
  entries: DocsPaletteEntry[],
  navigate: (path: string) => void,
  onClose: () => void,
  t: (key: string, vars?: Record<string, unknown>) => string
): PaletteItem[] {
  return entries.map((entry) => ({
    id: `doc-${entry.id}`,
    category: "docs",
    group: "docs",
    title: entry.title,
    subtitle: `${entry.categoryTitle} · ${entry.summary}`,
    icon: createElement(entry.icon, { size: 16 }),
    description: entry.summary,
    actionText: t("commandPalette.jumpTo"),
    docsData: { id: entry.id, categoryId: entry.categoryId },
    quickActions: [
      {
        id: "open-docs",
        icon: createElement(ExternalLink, { size: 12 }),
        title: t("commandPalette.quickActionPage"),
        onClick: (e) => {
          e.stopPropagation();
          onClose();
          navigate(`/docs?article=${entry.id}`);
        },
      },
    ],
    onSelect: () => {
      onClose();
      navigate(`/docs?article=${entry.id}`);
    },
  }));
}

/** Score a settings/docs entry against the query. */
export function scoreSettingsEntry(entry: SettingsPaletteEntry, query: string): number {
  return scoreMatch(query, entry.title, [entry.crumb, entry.keywords]);
}

export function scoreDocsEntry(entry: DocsPaletteEntry, query: string): number {
  const base = scoreMatch(query, entry.title, [
    entry.categoryTitle,
    entry.summary,
    entry.keywords.join(" "),
  ]);
  if (base > 0) return base;
  if (!entry.bodyLower) return -1;
  const needle = query.trim().toLowerCase();
  if (needle.length < 3) return -1;
  return entry.bodyLower.includes(needle) ? 220 : -1;
}

/**
 * Docs are bundled on demand (~120 KB per locale). The palette only asks for
 * the pack once the user has typed enough to make a guide hit plausible, so
 * opening the palette stays free.
 */
export function useDocsPaletteEntries(
  t: (key: string, vars?: Record<string, unknown>) => string,
  language: string,
  enabled: boolean
): DocsPaletteEntry[] {
  const [ready, setReady] = useState(() => isDocsLoaded(language));

  useEffect(() => {
    setReady(isDocsLoaded(language));
    if (!enabled || isDocsLoaded(language)) return;
    let cancelled = false;
    ensureDocsLoaded(language)
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        // English article titles and metadata still work without the pack.
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, language]);

  return useMemo(
    () => (enabled || ready ? buildDocsEntries(t, ready) : []),
    // `ready` is a cache-busting dependency: the merged docs strings live in
    // the i18n runtime, not in React state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, ready, t, language]
  );
}
