import { SOURCE_CATEGORIES, deriveCustomLinkMeta } from "./sources";
import type { SourceCategoryKey, SourceDef } from "./types";

export interface SourceMenuGroup {
  key: SourceCategoryKey;
  i18nKey: string;
  sources: SourceDef[];
}

/** Categories in the order the menu renders them; "all" is a filter, not a group. */
const MENU_CATEGORIES = SOURCE_CATEGORIES.filter(
  (category) => category.key !== "all",
);

/** True when a source matches a free-text query by label or by link host. */
export function matchesSourceQuery(source: SourceDef, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (source.label.toLowerCase().includes(needle)) return true;
  if (!source.url) return false;
  return (
    source.url.toLowerCase().includes(needle) ||
    deriveCustomLinkMeta(source.url).host.toLowerCase().includes(needle)
  );
}

/**
 * Bucket sources into their menu sections, preserving the category order and
 * dropping sections that end up empty (whether empty by design or by search).
 */
export function groupSourcesByCategory(
  sources: SourceDef[],
  query = "",
): SourceMenuGroup[] {
  const groups: SourceMenuGroup[] = [];
  for (const { key, i18nKey } of MENU_CATEGORIES) {
    const matching = sources.filter(
      (source) => source.category === key && matchesSourceQuery(source, query),
    );
    if (matching.length > 0) groups.push({ key, i18nKey, sources: matching });
  }
  return groups;
}
