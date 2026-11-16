import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  CheckCircle2,
  CircuitBoard,
  Hammer,
  Layers,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import PageWidget from "../../components/PageWidget";
import { Button } from "../../components/ui/Button";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatBand } from "../../components/ui/StatBand";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { PORTS_SOURCE_URL, type PortsCatalog } from "../../types/port";
import PortCard from "./PortCard";
import PortDetailModal from "./PortDetailModal";
import { formatDate, platformAccent, statusRank } from "./portFormat";
import { groupPorts, type PortGameGroup } from "./portGroups";
import "./PortsPage.css";

type PortSort = "name" | "port" | "platform" | "status";
type SortDirection = "asc" | "desc";

interface PortFilters {
  search: string;
  platform: string;
  status: string;
  origin: string;
  sort: PortSort;
  direction: SortDirection;
}

const FILTERS_KEY = "gamelib_ports_filters_v1";
/** Cards rendered per page; the wiki lists ~1,000 projects. */
const PAGE_SIZE = 120;

const DEFAULT_FILTERS: PortFilters = {
  search: "",
  platform: "all",
  status: "all",
  origin: "all",
  sort: "name",
  direction: "asc",
};

function parseStoredFilters(raw: unknown): PortFilters {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_FILTERS;
  const value = raw as Record<string, unknown>;
  const sort: PortSort =
    value.sort === "port" || value.sort === "platform" || value.sort === "status"
      ? value.sort
      : "name";
  return {
    search: typeof value.search === "string" ? value.search : "",
    platform: typeof value.platform === "string" ? value.platform : "all",
    status: typeof value.status === "string" ? value.status : "all",
    origin: typeof value.origin === "string" ? value.origin : "all",
    sort,
    direction: value.direction === "desc" ? "desc" : "asc",
  };
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

interface PortSection {
  key: string;
  label: string;
  accent?: string;
  groups: PortGameGroup[];
}

/**
 * Ports - unofficial PC ports catalogued by PCGamingWiki.
 *
 * The wiki is the source of truth; it is fetched live by the main process on
 * every open (with a short cache and an offline fallback). This page owns
 * search, platform/status/origin filters, sorting and the grouped grid, and it
 * resolves cover art lazily per visible card.
 */
export default function PortsPage() {
  const { t } = useLanguage();
  const { showToast } = useToast();

  const [catalog, setCatalog] = useState<PortsCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PortGameGroup | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [filters, setFilters] = useState<PortFilters>(() => {
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

  const load = useCallback(
    async (refresh: boolean) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const next = await invoke<PortsCatalog>("get_ports_catalog", { refresh });
        setCatalog(next);
        if (refresh) {
          showToast(
            t("ports.toast.refreshed", { count: next.projects.length }),
            next.stale ? "warning" : "success",
          );
        }
      } catch (loadError) {
        setError(String(loadError));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [showToast, t],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const projects = catalog?.projects ?? [];

  const platforms = useMemo(() => {
    const set = new Set(projects.map((project) => project.platform).filter(Boolean));
    return [...set].sort(compareText);
  }, [projects]);

  const statuses = useMemo(() => {
    const set = new Set(projects.map((project) => project.status).filter(Boolean));
    return [...set].sort((a, b) => statusRank(a) - statusRank(b) || compareText(a, b));
  }, [projects]);

  const origins = useMemo(() => {
    const set = new Set(projects.map((project) => project.origin).filter(Boolean));
    return [...set].sort(compareText);
  }, [projects]);

  // A saved filter can point at a platform/status the wiki no longer lists
  // (renamed sections, a project removed). Reset just those facets so the
  // dropdown never renders blank.
  useEffect(() => {
    if (!catalog) return;
    setFilters((current) => {
      const platform =
        current.platform !== "all" && !platforms.includes(current.platform)
          ? "all"
          : current.platform;
      const status =
        current.status !== "all" && !statuses.includes(current.status)
          ? "all"
          : current.status;
      const origin =
        current.origin !== "all" && !origins.includes(current.origin)
          ? "all"
          : current.origin;
      if (
        platform === current.platform &&
        status === current.status &&
        origin === current.origin
      ) {
        return current;
      }
      return { ...current, platform, status, origin };
    });
  }, [catalog, platforms, statuses, origins]);

  const filtered = useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    return projects.filter((project) => {
      if (filters.platform !== "all" && project.platform !== filters.platform) return false;
      if (filters.status !== "all" && project.status !== filters.status) return false;
      if (filters.origin !== "all" && project.origin !== filters.origin) return false;
      if (!query) return true;
      const haystack = [
        project.game,
        project.portName,
        project.platform,
        project.group,
        project.origin,
        project.status,
        project.languages,
        project.notes,
      ]
        .join(" ")
        .toLowerCase();
      return query.split(/\s+/).every((token) => haystack.includes(token));
    });
  }, [projects, filters]);

  const filteredGroups = useMemo(() => groupPorts(filtered), [filtered]);
  const allGroups = useMemo(() => groupPorts(projects), [projects]);

  const sortedGroups = useMemo(() => {
    const direction = filters.direction === "asc" ? 1 : -1;
    const compare = (a: PortGameGroup, b: PortGameGroup): number => {
      switch (filters.sort) {
        case "port":
          return compareText(a.primary.portName, b.primary.portName);
        case "platform":
          return compareText(a.platform, b.platform) || compareText(a.game, b.game);
        case "status":
          return statusRank(a.status) - statusRank(b.status) || compareText(a.game, b.game);
        default:
          return compareText(a.game, b.game);
      }
    };
    return [...filteredGroups].sort((a, b) => compare(a, b) * direction);
  }, [filteredGroups, filters.sort, filters.direction]);

  // A filter/sort change starts a fresh page so the first results are visible
  // immediately instead of keeping a scroll of auto-loads.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filters]);

  const visibleGroups = useMemo(
    () => sortedGroups.slice(0, visibleCount),
    [sortedGroups, visibleCount],
  );
  const remaining = Math.max(0, sortedGroups.length - visibleGroups.length);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Infinite scroll: the sentinel sits past the last section. Re-observing on
  // every page keeps loading while it is still near the viewport (a tall
  // window fills up in one go), then stops as soon as it falls below the
  // rootMargin.
  useEffect(() => {
    if (remaining <= 0) return;
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisibleCount((count) => Math.min(count + PAGE_SIZE, sortedGroups.length));
      },
      { rootMargin: "700px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [remaining, sortedGroups.length, visibleCount]);

  const sections = useMemo<PortSection[]>(() => {
    if (filters.sort === "platform") {
      const buckets = new Map<string, PortGameGroup[]>();
      for (const group of visibleGroups) {
        const key = group.platform || t("ports.unknownPlatform");
        const bucket = buckets.get(key) ?? [];
        bucket.push(group);
        buckets.set(key, bucket);
      }
      const keys = [...buckets.keys()];
      if (filters.direction === "desc") keys.reverse();
      return keys.map((key) => ({
        key,
        label: key,
        accent: platformAccent(key),
        groups: buckets.get(key) ?? [],
      }));
    }

    if (filters.sort === "status") {
      const buckets = new Map<string, PortGameGroup[]>();
      for (const group of visibleGroups) {
        const key = group.status || t("ports.status.unknown");
        const bucket = buckets.get(key) ?? [];
        bucket.push(group);
        buckets.set(key, bucket);
      }
      const keys = [...buckets.keys()].sort((a, b) => statusRank(a) - statusRank(b));
      if (filters.direction === "desc") keys.reverse();
      return keys.map((key) => ({
        key,
        label: key,
        groups: buckets.get(key) ?? [],
      }));
    }

    return [{ key: "all", label: "", groups: visibleGroups }];
  }, [visibleGroups, filters.sort, filters.direction, t]);

  const stats = useMemo(() => {
    const playable = allGroups.filter((group) => statusRank(group.status) === 0).length;
    const building = allGroups.filter((group) => {
      const rank = statusRank(group.status);
      return rank >= 1 && rank <= 4;
    }).length;
    return {
      games: allGroups.length,
      projects: projects.length,
      playable,
      building,
      platforms: platforms.length,
    };
  }, [allGroups, projects.length, platforms.length]);

  const patchFilters = useCallback((patch: Partial<PortFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
  }, []);

  const hasFilters =
    filters.search.trim().length > 0 ||
    filters.platform !== "all" ||
    filters.status !== "all" ||
    filters.origin !== "all";

  return (
    <div className="ports-page">
      <PageWidget page="ports" widget="portsHeader">
        <div className="ui-item-portsHeader">
          <PageHeader
            eyebrow={t("ports.eyebrow")}
            title={t("ports.title")}
            description={t("ports.subtitle")}
            icon={<CircuitBoard size={22} />}
            actions={
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  leftIcon={<ArrowUpRight size={15} />}
                  onClick={() => void openUrl(PORTS_SOURCE_URL)}
                >
                  {t("ports.openSource")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<RefreshCw size={15} />}
                  isLoading={refreshing}
                  onClick={() => void load(true)}
                >
                  {t("ports.refresh")}
                </Button>
              </>
            }
          />
        </div>
      </PageWidget>

      {catalog && catalog.stale ? (
        <div className="ports-stale" role="status">
          <span>
            {t("ports.stale", { date: formatDate(new Date(catalog.fetchedAt).toISOString()) ?? "" })}
          </span>
          <Button variant="ghost" size="sm" onClick={() => void load(true)}>
            {t("ports.retry")}
          </Button>
        </div>
      ) : null}

      {projects.length > 0 ? (
        <PageWidget page="ports" widget="portsStats">
          <div className="ui-item-portsStats">
            <StatBand
              ariaLabel={t("ports.stats.label")}
              items={[
                {
                  id: "games",
                  label: t("ports.stats.games"),
                  value: stats.games,
                  detail: t("ports.stats.projectsDetail", { count: stats.projects }),
                  icon: <Layers size={14} />,
                  tone: "accent",
                },
                {
                  id: "playable",
                  label: t("ports.stats.playable"),
                  value: stats.playable,
                  icon: <CheckCircle2 size={14} />,
                  tone: "success",
                },
                {
                  id: "building",
                  label: t("ports.stats.building"),
                  value: stats.building,
                  icon: <Hammer size={14} />,
                  tone: "warning",
                },
                {
                  id: "platforms",
                  label: t("ports.stats.platforms"),
                  value: stats.platforms,
                  icon: <CircuitBoard size={14} />,
                },
              ]}
            />
          </div>
        </PageWidget>
      ) : null}

      <PageWidget page="ports" widget="portsToolbar">
        <div className="ui-item-portsToolbar ports-toolbar">
          <label className="ports-search">
            <Search size={15} aria-hidden />
            <input
              type="search"
              value={filters.search}
              placeholder={t("ports.searchPlaceholder")}
              aria-label={t("ports.searchPlaceholder")}
              onChange={(event) => patchFilters({ search: event.target.value })}
            />
            {filters.search ? (
              <button
                type="button"
                className="ports-search__clear"
                onClick={() => patchFilters({ search: "" })}
                aria-label={t("ports.clearSearch")}
              >
                <X size={13} />
              </button>
            ) : null}
          </label>

          <div className="ports-toolbar__selects">
            <label className="ports-select">
              <span>{t("ports.filter.platform")}</span>
              <select
                value={filters.platform}
                onChange={(event) => patchFilters({ platform: event.target.value })}
              >
                <option value="all">{t("ports.filter.allPlatforms")}</option>
                {platforms.map((platform) => (
                  <option key={platform} value={platform}>
                    {platform}
                  </option>
                ))}
              </select>
            </label>

            <label className="ports-select">
              <span>{t("ports.filter.status")}</span>
              <select
                value={filters.status}
                onChange={(event) => patchFilters({ status: event.target.value })}
              >
                <option value="all">{t("ports.filter.allStatuses")}</option>
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>

            <label className="ports-select">
              <span>{t("ports.filter.origin")}</span>
              <select
                value={filters.origin}
                onChange={(event) => patchFilters({ origin: event.target.value })}
              >
                <option value="all">{t("ports.filter.allOrigins")}</option>
                {origins.map((origin) => (
                  <option key={origin} value={origin}>
                    {origin}
                  </option>
                ))}
              </select>
            </label>

            <label className="ports-select">
              <span>{t("ports.sort.label")}</span>
              <select
                value={filters.sort}
                onChange={(event) =>
                  patchFilters({ sort: event.target.value as PortSort })
                }
              >
                <option value="name">{t("ports.sort.name")}</option>
                <option value="port">{t("ports.sort.port")}</option>
                <option value="platform">{t("ports.sort.platform")}</option>
                <option value="status">{t("ports.sort.status")}</option>
              </select>
            </label>

            <button
              type="button"
              className="ports-direction"
              onClick={() =>
                patchFilters({ direction: filters.direction === "asc" ? "desc" : "asc" })
              }
              title={filters.direction === "asc" ? t("ports.sort.asc") : t("ports.sort.desc")}
              aria-label={filters.direction === "asc" ? t("ports.sort.asc") : t("ports.sort.desc")}
            >
              {filters.direction === "asc" ? <ArrowUp size={16} /> : <ArrowDown size={16} />}
            </button>
          </div>

          <div className="ports-toolbar__meta">
            <span>
              {t("ports.resultCount", {
                shown: visibleGroups.length,
                total: sortedGroups.length,
              })}
            </span>
            {catalog ? (
              <span>
                {t("ports.updated", {
                  date: formatDate(new Date(catalog.fetchedAt).toISOString()) ?? "-",
                })}
              </span>
            ) : null}
            {hasFilters ? (
              <button
                type="button"
                className="ports-link-btn"
                onClick={() => setFilters({ ...DEFAULT_FILTERS })}
              >
                {t("ports.clearFilters")}
              </button>
            ) : null}
          </div>
        </div>
      </PageWidget>

      <PageWidget page="ports" widget="portsGrid">
        <div className="ui-item-portsGrid">
          {loading ? (
            <div className="ports-grid" aria-busy="true" aria-label={t("ports.loading")}>
              {Array.from({ length: 12 }).map((_, index) => (
                <div key={index} className="ports-card ports-card--skeleton">
                  <span className="ports-card__art" />
                  <span className="ports-card__body">
                    <span className="ports-skeleton-line" />
                    <span className="ports-skeleton-line is-short" />
                  </span>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="ports-empty ports-empty--error">
              <CircuitBoard size={38} strokeWidth={1.4} />
              <h2>{t("ports.error.title")}</h2>
              <p>{error}</p>
              <Button variant="primary" onClick={() => void load(true)}>
                {t("ports.retry")}
              </Button>
            </div>
          ) : sortedGroups.length === 0 ? (
            <div className="ports-empty">
              <Search size={34} strokeWidth={1.4} />
              <h2>{t("ports.empty.title")}</h2>
              <p>{t("ports.empty.body")}</p>
              {hasFilters ? (
                <Button
                  variant="secondary"
                  onClick={() => setFilters({ ...DEFAULT_FILTERS })}
                >
                  {t("ports.clearFilters")}
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="ports-sections">
              {sections.map((section) => (
                <section
                  key={section.key}
                  className="ports-section"
                  style={
                    section.accent
                      ? ({ "--port-accent": section.accent } as CSSProperties)
                      : undefined
                  }
                >
                  {section.label ? (
                    <header className="ports-section__head">
                      <h2>{section.label}</h2>
                      <span className="ports-section__count">{section.groups.length}</span>
                    </header>
                  ) : null}
                  <div className="ports-grid">
                    {section.groups.map((group) => (
                      <PortCard key={group.key} group={group} onOpen={setSelected} />
                    ))}
                  </div>
                </section>
              ))}
              {remaining > 0 ? (
                <div ref={sentinelRef} className="ports-sentinel" aria-hidden>
                  <span className="ports-sentinel__spinner" />
                </div>
              ) : null}
            </div>
          )}
        </div>
      </PageWidget>

      {selected ? (
        <PortDetailModal group={selected} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}
