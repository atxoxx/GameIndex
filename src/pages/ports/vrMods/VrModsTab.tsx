import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, CircuitBoard, GitBranch, Layers, Search, Sparkles, X } from "lucide-react";

import { Button } from "../../../components/ui/Button";
import { PageHeader } from "../../../components/ui/PageHeader";
import { StatBand } from "../../../components/ui/StatBand";
import { useLanguage } from "../../../context/LanguageContext";
import type { VrModGameGroup, VrModKind, VrModsCatalog, VrSourceId } from "../../../types/vrMod";
import catalogJson from "../../../data/vr-mods.catalog.json";
import PortsVirtualGrid, { type PortsVirtualSection } from "../PortsVirtualGrid";
import { formatDate } from "../portFormat";
import VrModCard from "./VrModCard";
import VrModDetailModal from "./VrModDetailModal";
import { groupVrMods } from "./vrModData";
import "./VrMods.css";

type VrSort = "name" | "mod" | "date";
type SortDirection = "asc" | "desc";

interface VrFilters {
  search: string;
  kind: VrModKind | "all";
  platform: string;
  source: VrSourceId | "all";
  sort: VrSort;
  direction: SortDirection;
}

const FILTERS_KEY = "gamelib_vr_mods_filters_v1";
const catalog = catalogJson as VrModsCatalog;
const KIND_IDS = new Set<string>(["dedicated", "uevr", "conversion", "unknown"]);
const SOURCE_IDS = new Set<string>(["vrportnews", "pcvrcentral"]);

const DEFAULT_FILTERS: VrFilters = {
  search: "",
  kind: "all",
  platform: "all",
  source: "all",
  sort: "name",
  direction: "asc",
};

function parseStoredFilters(raw: unknown): VrFilters {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_FILTERS;
  const value = raw as Record<string, unknown>;
  return {
    search: typeof value.search === "string" ? value.search : "",
    kind: typeof value.kind === "string" && KIND_IDS.has(value.kind) ? (value.kind as VrModKind) : "all",
    platform: typeof value.platform === "string" ? value.platform : "all",
    source:
      typeof value.source === "string" && SOURCE_IDS.has(value.source)
        ? (value.source as VrSourceId)
        : "all",
    sort: value.sort === "mod" || value.sort === "date" ? (value.sort as VrSort) : "name",
    direction: value.direction === "desc" ? "desc" : "asc",
  };
}

/* ---------------------------------------------------------------------------
 * The catalog is immutable. Everything derived from it is computed once at
 * module load, while the lazy chunk is being parsed, instead of on every
 * keystroke or scroll frame. Sorting 2,461 groups with localeCompare costs
 * ~70 ms; one Intl.Collator plus pre-sorted orders makes filtering ~1 ms.
 * ------------------------------------------------------------------------- */
const ALL_GROUPS = groupVrMods(catalog.entries ?? []);
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

const NAME_ORDER = [...ALL_GROUPS].sort((a, b) => collator.compare(a.title, b.title));
const MOD_ORDER = [...ALL_GROUPS].sort(
  (a, b) =>
    collator.compare(a.entries[0]?.modName ?? "", b.entries[0]?.modName ?? "") ||
    collator.compare(a.title, b.title),
);
const DATE_ORDER = [...ALL_GROUPS].sort(
  (a, b) =>
    (b.date ?? "").localeCompare(a.date ?? "") || collator.compare(a.title, b.title),
);

interface GroupMeta {
  haystack: string;
  platforms: Set<string>;
  sources: Set<string>;
}

const GROUP_META = new Map<string, GroupMeta>();
for (const group of ALL_GROUPS) {
  GROUP_META.set(group.key, {
    haystack: [
      group.title,
      ...group.platforms,
      ...group.sources.map((source) => source.name),
      ...group.entries.flatMap((entry) => [entry.modName, entry.description, entry.author ?? ""]),
    ]
      .join(" ")
      .toLowerCase(),
    platforms: new Set(group.platforms),
    sources: new Set(group.sources.map((source) => source.id)),
  });
}

const PLATFORMS = [...new Set(ALL_GROUPS.flatMap((group) => group.platforms))].sort((a, b) =>
  collator.compare(a, b),
);
const STATS = {
  games: ALL_GROUPS.length,
  mods: catalog.entries?.length ?? 0,
  repos: new Set(ALL_GROUPS.flatMap((group) => group.githubLinks.map((link) => link.repoKey ?? link.url))).size,
  sources: catalog.sources?.length ?? 0,
};

function matchesFilters(
  group: VrModGameGroup,
  filters: VrFilters,
  tokens: string[],
): boolean {
  if (filters.kind !== "all" && !group.kinds.includes(filters.kind)) return false;
  const meta = GROUP_META.get(group.key);
  if (filters.platform !== "all" && !meta?.platforms.has(filters.platform)) return false;
  if (filters.source !== "all" && !meta?.sources.has(filters.source)) return false;
  if (tokens.length === 0) return true;
  const haystack = meta?.haystack ?? group.title.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

/** The VR Mods subtab. Derived data is precomputed, so this paints fast. */
export default function VrModsTab() {
  const { t, language } = useLanguage();
  const [selected, setSelected] = useState<VrModGameGroup | null>(null);
  const [filters, setFilters] = useState<VrFilters>(() => {
    try {
      const raw = localStorage.getItem(FILTERS_KEY);
      if (raw) return parseStoredFilters(JSON.parse(raw));
    } catch {
      /* storage unavailable */
    }
    return DEFAULT_FILTERS;
  });

  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
    } catch {
      /* ignore quota errors */
    }
  }, [filters]);

  const tokens = useMemo(
    () => filters.search.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [filters.search],
  );

  const sortedGroups = useMemo(() => {
    const base =
      filters.sort === "mod" ? MOD_ORDER : filters.sort === "date" ? DATE_ORDER : NAME_ORDER;
    const matched = base.filter((group) => matchesFilters(group, filters, tokens));
    return filters.direction === "desc" ? matched.reverse() : matched;
  }, [filters, tokens]);

  const sections = useMemo<PortsVirtualSection<VrModGameGroup>[]>(
    () => [{ key: "all", label: "", groups: sortedGroups }],
    [sortedGroups],
  );

  const patchFilters = useCallback((patch: Partial<VrFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
  }, []);
  const openGroup = useCallback((group: VrModGameGroup) => setSelected(group), []);

  const hasFilters =
    filters.search.trim().length > 0 ||
    filters.kind !== "all" ||
    filters.platform !== "all" ||
    filters.source !== "all";

  return (
    <div className="ports-page vrmods-page">
      <PageHeader
        eyebrow={t("ports.vrMods.eyebrow")}
        title={t("ports.vrMods.title")}
        description={t("ports.vrMods.subtitle")}
        icon={<Sparkles size={22} />}
      />

      {catalog.stale ? (
        <div className="ports-stale" role="status">
          <span>{t("ports.vrMods.stale")}</span>
        </div>
      ) : null}

      {STATS.games > 0 ? (
        <StatBand
          ariaLabel={t("ports.stats.label")}
          items={[
            { id: "games", label: t("ports.vrMods.stats.games"), value: STATS.games, icon: <Layers size={14} />, tone: "accent" },
            { id: "mods", label: t("ports.vrMods.stats.mods"), value: STATS.mods, icon: <Sparkles size={14} /> },
            { id: "repos", label: t("ports.vrMods.stats.repos"), value: STATS.repos, icon: <GitBranch size={14} />, tone: "success" },
            { id: "sources", label: t("ports.vrMods.stats.sources"), value: STATS.sources, icon: <CircuitBoard size={14} /> },
          ]}
        />
      ) : null}

      <div className="ports-toolbar">
        <label className="ports-search">
          <Search size={15} aria-hidden />
          <input
            type="search"
            value={filters.search}
            placeholder={t("ports.vrMods.searchPlaceholder")}
            aria-label={t("ports.vrMods.searchPlaceholder")}
            onChange={(event) => patchFilters({ search: event.target.value })}
          />
          {filters.search ? (
            <button
              type="button"
              className="ports-search__clear"
              onClick={() => patchFilters({ search: "" })}
              aria-label={t("ports.clearSearch")}
              title={t("ports.clearSearch")}
            >
              <X size={13} aria-hidden="true" />
            </button>
          ) : null}
        </label>

        <div className="ports-toolbar__selects">
          <label className="ports-select">
            <span>{t("ports.vrMods.filter.kind")}</span>
            <select
              value={filters.kind}
              onChange={(event) => patchFilters({ kind: event.target.value as VrModKind | "all" })}
            >
              <option value="all">{t("ports.vrMods.filter.allKinds")}</option>
              {(["dedicated", "uevr", "conversion", "unknown"] as VrModKind[]).map((kind) => (
                <option key={kind} value={kind}>
                  {t(
                    kind === "dedicated"
                      ? "ports.vrMods.kind.dedicated"
                      : kind === "uevr"
                        ? "ports.vrMods.kind.uevr"
                        : kind === "conversion"
                          ? "ports.vrMods.kind.conversion"
                          : "ports.vrMods.kind.unknown",
                  )}
                </option>
              ))}
            </select>
          </label>

          <label className="ports-select">
            <span>{t("ports.vrMods.filter.platform")}</span>
            <select
              value={filters.platform}
              onChange={(event) => patchFilters({ platform: event.target.value })}
            >
              <option value="all">{t("ports.filter.allPlatforms")}</option>
              {PLATFORMS.map((platform) => (
                <option key={platform} value={platform}>
                  {platform}
                </option>
              ))}
            </select>
          </label>

          <label className="ports-select">
            <span>{t("ports.vrMods.filter.source")}</span>
            <select
              value={filters.source}
              onChange={(event) => patchFilters({ source: event.target.value as VrSourceId | "all" })}
            >
              <option value="all">{t("ports.vrMods.filter.allSources")}</option>
              {(["vrportnews", "pcvrcentral"] as VrSourceId[]).map((id) => (
                <option key={id} value={id}>
                  {id === "vrportnews" ? "VR Port News" : "PCVR Central"}
                </option>
              ))}
            </select>
          </label>

          <label className="ports-select">
            <span>{t("ports.vrMods.sort.label")}</span>
            <select
              value={filters.sort}
              onChange={(event) => patchFilters({ sort: event.target.value as VrSort })}
            >
              <option value="name">{t("ports.vrMods.sort.name")}</option>
              <option value="mod">{t("ports.vrMods.sort.mod")}</option>
              <option value="date">{t("ports.vrMods.sort.date")}</option>
            </select>
          </label>

          <button
            type="button"
            className="ports-direction"
            onClick={() =>
              patchFilters({ direction: filters.direction === "asc" ? "desc" : "asc" })
            }
            title={filters.direction === "asc" ? t("ports.vrMods.sort.asc") : t("ports.vrMods.sort.desc")}
            aria-label={filters.direction === "asc" ? t("ports.vrMods.sort.asc") : t("ports.vrMods.sort.desc")}
          >
            {filters.direction === "asc" ? (
              <ArrowUp size={16} aria-hidden="true" />
            ) : (
              <ArrowDown size={16} aria-hidden="true" />
            )}
          </button>
        </div>

        <div className="ports-toolbar__meta">
          <span>
            {t("ports.vrMods.resultCount", { shown: sortedGroups.length, total: STATS.games })}
          </span>
          <span>
            {t("ports.vrMods.updated", {
              date: formatDate(new Date(catalog.generatedAt).toISOString(), language) ?? "-",
            })}
          </span>
          {hasFilters ? (
            <button type="button" className="ports-link-btn" onClick={() => setFilters({ ...DEFAULT_FILTERS })}>
              {t("ports.vrMods.clearFilters")}
            </button>
          ) : null}
        </div>
      </div>

      {sortedGroups.length === 0 ? (
        <div className="ports-empty">
          <Search size={34} strokeWidth={1.4} aria-hidden="true" />
          <h2>{t("ports.vrMods.empty.title")}</h2>
          <p>{t("ports.vrMods.empty.body")}</p>
          {hasFilters ? (
            <Button variant="secondary" onClick={() => setFilters({ ...DEFAULT_FILTERS })}>
              {t("ports.vrMods.clearFilters")}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="ports-sections">
          <PortsVirtualGrid
            sections={sections}
            resetKey={JSON.stringify(filters)}
            renderGroup={(group) => <VrModCard group={group} onOpen={openGroup} />}
          />
        </div>
      )}

      {selected ? (
        <VrModDetailModal group={selected} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}
