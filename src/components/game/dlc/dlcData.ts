import type { SteamDlcItem } from "../../../types/steam";

export type DlcFilter = "all" | "owned" | "unowned" | "onSale" | "free" | "watched";
export type DlcSort = "default" | "priceAsc" | "priceDesc" | "discount" | "name" | "release";
export type DlcView = "gallery" | "table";

export const DLC_FILTERS: readonly DlcFilter[] = [
  "all",
  "owned",
  "unowned",
  "onSale",
  "free",
  "watched",
];

export const DLC_SORTS: readonly DlcSort[] = [
  "default",
  "priceAsc",
  "priceDesc",
  "discount",
  "name",
  "release",
];

export const DLC_VIEWS: readonly DlcView[] = ["gallery", "table"];

/** A DLC is on sale when it is discounted and still missing from the library. */
export function isOnSale(dlc: SteamDlcItem): boolean {
  return !dlc.isOwned && (dlc.discountPercent ?? 0) > 0;
}

export function dlcPriceCents(dlc: SteamDlcItem): number {
  if (dlc.isFree) return 0;
  return dlc.finalPriceCents ?? Number.POSITIVE_INFINITY;
}

export function releaseTime(dlc: SteamDlcItem): number {
  if (!dlc.releaseDate) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(dlc.releaseDate);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

export interface DlcCounts {
  all: number;
  owned: number;
  unowned: number;
  onSale: number;
  free: number;
  watched: number;
}

export function dlcCounts(dlcs: readonly SteamDlcItem[]): DlcCounts {
  const counts: DlcCounts = {
    all: dlcs.length,
    owned: 0,
    unowned: 0,
    onSale: 0,
    free: 0,
    watched: 0,
  };
  for (const dlc of dlcs) {
    if (dlc.isOwned) counts.owned += 1;
    else counts.unowned += 1;
    if (isOnSale(dlc)) counts.onSale += 1;
    if (dlc.isFree) counts.free += 1;
    if (dlc.isWatched) counts.watched += 1;
  }
  return counts;
}

export function filterDlcList(
  dlcs: readonly SteamDlcItem[],
  options: { filter: DlcFilter; query?: string; sort?: DlcSort }
): SteamDlcItem[] {
  const { filter, query = "", sort = "default" } = options;
  const needle = query.trim().toLowerCase();

  let list = dlcs.filter((dlc) => {
    if (filter === "owned" && !dlc.isOwned) return false;
    if (filter === "unowned" && dlc.isOwned) return false;
    if (filter === "onSale" && !isOnSale(dlc)) return false;
    if (filter === "free" && !dlc.isFree) return false;
    if (filter === "watched" && !dlc.isWatched) return false;
    if (!needle) return true;
    return (
      dlc.name.toLowerCase().includes(needle) ||
      (dlc.shortDescription ?? "").toLowerCase().includes(needle)
    );
  });

  if (sort === "default") return list;

  list = [...list];
  switch (sort) {
    case "priceAsc":
      list.sort((a, b) => dlcPriceCents(a) - dlcPriceCents(b));
      break;
    case "priceDesc":
      list.sort((a, b) => dlcPriceCents(b) - dlcPriceCents(a));
      break;
    case "discount":
      list.sort(
        (a, b) =>
          (b.discountPercent ?? 0) - (a.discountPercent ?? 0) ||
          dlcPriceCents(a) - dlcPriceCents(b)
      );
      break;
    case "name":
      list.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "release":
      list.sort((a, b) => releaseTime(b) - releaseTime(a));
      break;
    default:
      break;
  }
  return list;
}

/** 0–100 progress for the collection figure. */
export function ownershipPercent(total: number, owned: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((owned / total) * 100)));
}

/** Strip Steam's BBCode/HTML-ish store copy down to readable paragraphs. */
export function cleanDescription(raw?: string | null): string {
  if (!raw) return "";
  return raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
