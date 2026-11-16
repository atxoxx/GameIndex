import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  CircuitBoard,
  Hammer,
  Layers,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from "lucide-react";

import PageWidget from "../../components/PageWidget";
import { Button } from "../../components/ui/Button";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatBand } from "../../components/ui/StatBand";
import { SubTabs } from "../../components/ui/SubTabs";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { PORT_SOURCES, PORT_SOURCE_PRIORITY, type PortSourceId, type PortsCatalog, type PortsSyncEvent, type PortsSyncProgress } from "../../types/port";
import PortCard from "./PortCard";
import PortDetailModal from "./PortDetailModal";
import PortsVirtualGrid from "./PortsVirtualGrid";
import { formatDate, platformAccent, statusRank } from "./portFormat";
import { groupPorts, orderTargets, type PortGameGroup } from "./portGroups";
import { prefetchPortCovers } from "./usePortCover";
import "./PortsPage.css";

/** The bundled VR catalog is large; only load it when that subtab is opened. */
const VrModsTab = lazy(() => import("./vrMods/VrModsTab"));

type PortSort = "name" | "port" | "platform" | "status";
type SortDirection = "asc" | "desc";
type PortsPageTab = "ports" | "vrMods";
const PAGE_TAB_KEY = "gamelib_ports_page_tab_v1";

interface PortFilters {
  search: string;
  platform: string;
  status: string;
  origin: string;
  source: PortSourceId | "all";
  runsOn: string;
  sort: PortSort;
  direction: SortDirection;
}

const FILTERS_KEY = "gamelib_ports_filters_v1";
/** Skip the background refresh when the merged catalog is this fresh. */
const REFRESH_AFTER_MS = 60 * 60_000;
const SOURCE_IDS = new Set<string>(PORT_SOURCE_PRIORITY);

const DEFAULT_FILTERS: PortFilters = {
  search: "",
  platform: "all",
  status: "all",
  origin: "all",
  source: "all",
  runsOn: "all",
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
    source:
      typeof value.source === "string" && SOURCE_IDS.has(value.source)
        ? (value.source as PortSourceId)
        : "all",
    runsOn: typeof value.runsOn === "string" ? value.runsOn : "all",
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
 * Ports - merged unofficial-port catalog.
 *
 * The main process keeps one merged catalog from five public sources. This page
 * paints the saved copy immediately, then refreshes stale sources in the
 * background (the first run fetches everything and can take a few minutes).
 * It owns search, platform/status/origin/source/runs-on filters, sorting, the
 * grouped grid and lazy cover art.
 */
export default function PortsPage() {
  const { t } = useLanguage();
  const { showToast } = useToast();

  const [catalog, setCatalog] = useState<PortsCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState<PortsSyncProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PortGameGroup | null>(null);
  const [pageTab, setPageTab] = useState<PortsPageTab>(() => {
    try {
      const stored = localStorage.getItem(PAGE_TAB_KEY);
      if (stored === "ports" || stored === "vrMods") return stored;
    } catch {
      /* storage unavailable */
    }
    return "ports";
  });
  const lastEventVersion = useRef(0);
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

  useEffect(() => {
    try {
      localStorage.setItem(PAGE_TAB_KEY, pageTab);
    } catch {
      /* ignore quota errors */
    }
  }, [pageTab]);

  const loadCached = useCallback(async (): Promise<PortsCatalog | null> => {
    try {
      const cached = await invoke<PortsCatalog>("get_ports_catalog");
      setCatalog(cached);
      return cached;
    } catch (loadError) {
      setError(String(loadError));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(
    async (force: boolean) => {
      setRefreshing(true);
      setError(null);
      try {
        const next = await invoke<PortsCatalog>("refresh_ports_catalog", { force });
        setCatalog(next);
        if (force) {
          showToast(
            t("ports.toast.refreshed", { count: next.projects.length }),
            next.stale ? "warning" : "success",
          );
        }
        return next;
      } catch (loadError) {
        setError(String(loadError));
        return null;
      } finally {
        setRefreshing(false);
        setProgress(null);
      }
    },
    [showToast, t],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cached = await loadCached();
      if (cancelled) return;
      const needsRefresh =
        !cached ||
        cached.projects.length === 0 ||
        Date.now() - cached.fetchedAt > REFRESH_AFTER_MS;
      if (needsRefresh) void refresh(cached?.projects.length === 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadCached, refresh]);

  // The main process streams each source as it finishes, so rows appear
  // without waiting for the slowest site. Events carry a version; ignore any
  // that arrive out of order.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void listen<PortsSyncEvent>("ports:sync", (event) => {
      const data = event.payload;
      if (cancelled || data.version <= lastEventVersion.current) return;
      lastEventVersion.current = data.version;
      setProgress(data.progress);
      setRefreshing(data.syncing);
      if (data.catalog) {
        setCatalog({ ...data.catalog, syncing: data.syncing });
        setError(null);
      }
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        /* no bridge (web dev / tests) - the cached command path still works */
      });

    void invoke<PortsSyncProgress>("get_ports_sync_status")
      .then((status) => {
        if (cancelled || !status.active) return;
        setProgress(status);
        setRefreshing(true);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

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

  const targets = useMemo(
    () => orderTargets(projects.flatMap((project) => project.platforms ?? [])),
    [projects],
  );

  // A saved filter can point at a platform/status/source that no longer exists
  // (renamed sections, a project removed, a source offline). Reset just those
  // facets so no dropdown renders blank.
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
      const runsOn =
        current.runsOn !== "all" && !targets.includes(current.runsOn)
          ? "all"
          : current.runsOn;
      if (
        platform === current.platform &&
        status === current.status &&
        origin === current.origin &&
        runsOn === current.runsOn
      ) {
        return current;
      }
      return { ...current, platform, status, origin, runsOn };
    });
  }, [catalog, platforms, statuses, origins, targets]);

  const filtered = useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    return projects.filter((project) => {
      if (filters.platform !== "all" && project.platform !== filters.platform) return false;
      if (filters.status !== "all" && project.status !== filters.status) return false;
      if (filters.origin !== "all" && project.origin !== filters.origin) return false;
      if (
        filters.source !== "all" &&
        !(project.sources ?? []).some((source) => source.id === filters.source)
      ) {
        return false;
      }
      if (
        filters.runsOn !== "all" &&
        !(project.platforms ?? []).includes(filters.runsOn)
      ) {
        return false;
      }
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
        ...(project.sources ?? []).map((source) => source.name),
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

  // Warm the first screenful of covers in one batch. Source-supplied images
  // bypass this entirely; the rest resolve through SteamGridDB.
  useEffect(() => {
    if (sortedGroups.length === 0) return;
    prefetchPortCovers(sortedGroups.slice(0, 96).map((group) => group.game));
  }, [sortedGroups]);

  const sections = useMemo<PortSection[]>(() => {
    if (filters.sort === "platform") {
      const buckets = new Map<string, PortGameGroup[]>();
      for (const group of sortedGroups) {
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
      for (const group of sortedGroups) {
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

    return [{ key: "all", label: "", groups: sortedGroups }];
  }, [sortedGroups, filters.sort, filters.direction, t]);

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
    filters.origin !== "all" ||
    filters.source !== "all" ||
    filters.runsOn !== "all";

  const progressSources = progress?.sources ?? [];
  const finishedSources = progressSources.filter((source) => source.finished);
  const activeSource = progressSources.find((source) => !source.finished);
  const activeLabel = activeSource
    ? activeSource.total > 0
      ? t("ports.syncingProgress", {
          source: PORT_SOURCES[activeSource.id].name,
          done: activeSource.done,
          total: activeSource.total,
        })
      : t("ports.syncingSource", { source: PORT_SOURCES[activeSource.id].name })
    : "";
  const syncLabel =
    progressSources.length > 0
      ? `${t("ports.syncingCount", {
          done: finishedSources.length,
          total: progressSources.length,
        })}${activeLabel ? ` · ${activeLabel}` : ""}`
      : t("ports.syncing");
  const failedSources = (catalog?.sources ?? []).filter((source) => !source.ok);

  return (
    <>
      <SubTabs
        className="ports-page__tabs"
        ariaLabel={`${t("ports.tab.ports")} / ${t("ports.tab.vrMods")}`}
        value={pageTab}
        onChange={(next) => setPageTab(next as PortsPageTab)}
        items={[
          { id: "ports", label: t("ports.tab.ports"), icon: CircuitBoard },
          { id: "vrMods", label: t("ports.tab.vrMods"), icon: Sparkles },
        ]}
      />
      {pageTab === "vrMods" ? (
        <Suspense
          fallback={
            <div className="ports-page" role="status" aria-label={t("ports.vrMods.loading")}>
              <div className="ports-grid" aria-busy="true">
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
            </div>
          }
        >
          <VrModsTab />
        </Suspense>
      ) : (
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
                {refreshing ? (
                  <span className="ports-sync" role="status">
                    <span className="ports-sync__spinner" aria-hidden />
                    {syncLabel}
                  </span>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<RefreshCw size={15} />}
                  isLoading={refreshing}
                  onClick={() => void refresh(true)}
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
            {failedSources.length > 0
              ? ` · ${failedSources.map((source) => source.name).join(", ")}`
              : ""}
          </span>
          <Button variant="ghost" size="sm" onClick={() => void refresh(true)}>
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
              <span>{t("ports.filter.source")}</span>
              <select
                value={filters.source}
                onChange={(event) =>
                  patchFilters({ source: event.target.value as PortSourceId | "all" })
                }
              >
                <option value="all">{t("ports.filter.allSources")}</option>
                {PORT_SOURCE_PRIORITY.map((id) => (
                  <option key={id} value={id}>
                    {PORT_SOURCES[id].name}
                  </option>
                ))}
              </select>
            </label>

            <label className="ports-select">
              <span>{t("ports.filter.runsOn")}</span>
              <select
                value={filters.runsOn}
                onChange={(event) => patchFilters({ runsOn: event.target.value })}
              >
                <option value="all">{t("ports.filter.anyPlatform")}</option>
                {targets.map((target) => (
                  <option key={target} value={target}>
                    {target}
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
                shown: sortedGroups.length,
                total: allGroups.length,
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
          ) : projects.length === 0 && refreshing ? (
            <div className="ports-empty ports-empty--sync">
              <span className="ports-sync__spinner ports-sync__spinner--lg" aria-hidden />
              <h2>{t("ports.firstSync.title")}</h2>
              <p>{t("ports.firstSync.body")}</p>
              <span className="ports-sync__progress">{syncLabel}</span>
              {progressSources.length > 0 ? (
                <div className="ports-sync-list">
                  {progressSources.map((source) => (
                    <div
                      key={source.id}
                      className={`ports-sync-row${source.finished ? " is-done" : ""}${
                        source.finished && !source.ok ? " is-failed" : ""
                      }`}
                    >
                      <span className="ports-sync-row__name">
                        {PORT_SOURCES[source.id].name}
                      </span>
                      <span className="ports-sync-row__state">
                        {source.finished && !source.ok
                          ? t("ports.syncFailed")
                          : source.finished
                            ? t("ports.syncDone")
                            : source.total > 0
                              ? `${source.done.toLocaleString()} / ${source.total.toLocaleString()}`
                              : t("ports.syncWaiting")}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : error ? (
            <div className="ports-empty ports-empty--error">
              <CircuitBoard size={38} strokeWidth={1.4} />
              <h2>{t("ports.error.title")}</h2>
              <p>{error}</p>
              <Button variant="primary" onClick={() => void refresh(true)}>
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
              <PortsVirtualGrid
                sections={sections}
                resetKey={JSON.stringify(filters)}
                renderGroup={(group) => (
                  <PortCard group={group} onOpen={setSelected} />
                )}
              />
            </div>
          )}
        </div>
      </PageWidget>

      {selected ? (
        <PortDetailModal group={selected} onClose={() => setSelected(null)} />
      ) : null}
      </div>
      )}
    </>
  );
}
