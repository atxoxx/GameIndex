// "Discover" — browse and install mods from the popular mod websites.
// A separate route (/mods/discover) so the existing Mods manager stays
// focused on installed mods. Reached from the Mods page header.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Boxes,
  ExternalLink,
  FolderOpen,
  History,
  LayoutGrid,
  List,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { Button, PageHeader } from "../../components/ui";
import MultiSelectDropdown from "../../components/ui/MultiSelectDropdown";
import SourceSelect from "../../components/mods/discover/SourceSelect";
import SourceConfigModal from "../../components/mods/discover/SourceConfigModal";
import DiscoverHero from "../../components/mods/discover/DiscoverHero";
import RemoteModGrid, {
  type DiscoverView,
} from "../../components/mods/discover/RemoteModGrid";
import RemoteModDetailModal from "../../components/mods/discover/RemoteModDetailModal";
import {
  sourceLabel,
  formatRemoteDate,
  collectTagCounts,
  modHasSelectedTag,
} from "../../components/mods/discover/format";
import { useModBrowse, useModSources, useRemoteInstalls } from "../../hooks/useModDiscover";
import { usePersistedState } from "../../hooks/usePersistedState";
import { gameDisplayName } from "../../types/game";
import type { RemoteModSummary } from "../../types/mods";
import "../../styles/page-mods.css";
import "../../components/mods/discover/mods-discover.css";

const SORTS = ["trending", "latest", "updated", "downloads"] as const;

/** Remember the last website used for each game. */
const sourcePrefKey = (gameId: string) => `gamelib.mods.discover.source.${gameId}`;

/** Re-attempt unresolved websites after this long. */
const DETECT_TTL_MS = 6 * 60 * 60 * 1000;
const detectedKey = (gameId: string) => `gamelib.mods.discover.detected.${gameId}`;

export default function ModsDiscoverPage() {
  const { games } = useGames();
  const { t } = useLanguage();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [gameId, setGameId] = useState<string | null>(searchParams.get("gameId"));
  const [sourceId, setSourceId] = useState<string | null>(searchParams.get("source"));
  const [configOpen, setConfigOpen] = useState(false);
  const [activeMod, setActiveMod] = useState<RemoteModSummary | null>(null);
  const [category, setCategory] = useState("all");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [view, setView] = usePersistedState<DiscoverView>(
    "gamelib.mods.discover.view_v1",
    "grid",
    ["grid", "list"],
  );

  const candidates = useMemo(
    () =>
      games
        .filter((g) => g.installed !== false)
        .sort((a, b) => gameDisplayName(a).localeCompare(gameDisplayName(b))),
    [games],
  );

  const selectedGame = candidates.find((g) => g.id === gameId) ?? null;

  const { sources, loading, resolving, resolveAll, setCredential, setLink, clearLink } =
    useModSources(gameId);

  const selectedSource = sources.find((s) => s.id === sourceId) ?? null;
  const browse = useModBrowse(
    selectedSource?.available ? selectedSource.id : null,
    selectedSource?.externalId ?? null,
  );

  const installs = useRemoteInstalls(gameId);
  const autoResolvedRef = useRef<string | null>(null);

  const availableCount = useMemo(
    () => sources.filter((s) => s.available).length,
    [sources],
  );

  const installedKeys = useMemo(
    () => new Set(installs.installs.map((i) => `${i.source}:${i.sourceModId}`)),
    [installs.installs],
  );

  // Detect the websites a game lives on, once per game — even when
  // another site is already mapped (a Steam game always has Workshop).
  useEffect(() => {
    if (!gameId || loading || resolving || sources.length === 0) return;
    if (autoResolvedRef.current === gameId) return;
    if (!sources.some((s) => !s.externalId)) return;
    let last = 0;
    try {
      last = Number(localStorage.getItem(detectedKey(gameId)) || 0);
    } catch {
      /* ignore */
    }
    if (last && Date.now() - last < DETECT_TTL_MS) return;
    autoResolvedRef.current = gameId;
    try {
      localStorage.setItem(detectedKey(gameId), String(Date.now()));
    } catch {
      /* ignore */
    }
    void resolveAll();
  }, [gameId, loading, resolving, sources, resolveAll]);

  const handleResolve = () => {
    if (gameId) {
      try {
        localStorage.setItem(detectedKey(gameId), String(Date.now()));
      } catch {
        /* ignore */
      }
    }
    void resolveAll();
  };

  // Default game selection.
  useEffect(() => {
    if (!gameId && candidates.length > 0) {
      setGameId(candidates[0].id);
    }
  }, [gameId, candidates]);

  // Keep the URL shareable.
  useEffect(() => {
    const next: Record<string, string> = {};
    if (gameId) next.gameId = gameId;
    if (sourceId) next.source = sourceId;
    if (searchParams.get("gameId") !== next.gameId || searchParams.get("source") !== next.source) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, sourceId]);

  // Pick a source whenever the game changes: prefer the one this game
  // used last, else the first detected/available one.
  useEffect(() => {
    if (sources.length === 0) {
      setSourceId(null);
      return;
    }
    if (sourceId && sources.some((s) => s.id === sourceId)) return;
    let stored: string | null = null;
    try {
      stored = gameId ? localStorage.getItem(sourcePrefKey(gameId)) : null;
    } catch {
      /* ignore */
    }
    const remembered = stored
      ? (sources.find((s) => s.id === stored && s.available) ?? null)
      : null;
    const first = remembered ?? sources.find((s) => s.available);
    setSourceId(first?.id ?? null);
  }, [sources, sourceId, gameId]);

  const handleSourceChange = (id: string) => {
    setSourceId(id);
    try {
      if (gameId) localStorage.setItem(sourcePrefKey(gameId), id);
    } catch {
      /* ignore */
    }
  };

  // Facets are derived from the current result page.
  const categories = useMemo(
    () =>
      Array.from(
        new Set(
          browse.results
            .map((r) => r.category)
            .filter((c): c is string => !!c && c.trim().length > 0),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [browse.results],
  );
  const tagCounts = useMemo(() => collectTagCounts(browse.results), [browse.results]);
  const tagOptions = useMemo(
    () =>
      Array.from(tagCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 24)
        .map(([tag]) => tag),
    [tagCounts],
  );
  const tagCountMap = useMemo(
    () => Object.fromEntries(tagCounts.entries()),
    [tagCounts],
  );

  const visibleResults = useMemo(() => {
    let list = browse.results;
    if (category !== "all") list = list.filter((r) => r.category === category);
    if (selectedTags.length > 0) {
      list = list.filter((r) => modHasSelectedTag(r, selectedTags));
    }
    return list;
  }, [browse.results, category, selectedTags]);

  // Reset filters when the game or website changes.
  useEffect(() => {
    setCategory("all");
    setSelectedTags([]);
  }, [gameId, sourceId]);

  const handleInstalled = async () => {
    if (selectedGame) {
      try {
        await invoke("mods_scan_game", {
          gameId: selectedGame.id,
          gamePath: selectedGame.path ?? "",
          steamAppId: selectedGame.steamAppId ?? null,
        });
      } catch {
        /* a scan failure shouldn't block the install feedback */
      }
    }
    void installs.refresh();
    showToast(t("mods.discover.installedRescan"), "success");
  };

  return (
    <div className="mods-discover-page">
      <PageHeader
        eyebrow={t("mods.eyebrow")}
        title={t("mods.discover.title")}
        description={t("mods.discover.subtitle")}
        actions={
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Boxes size={14} />}
            onClick={() => navigate("/mods")}
          >
            {t("mods.discover.openManager")}
          </Button>
        }
      />

      <DiscoverHero
        game={selectedGame}
        detectedCount={availableCount}
        detecting={resolving || loading}
      />

      <SourceSelect
        sources={sources}
        value={sourceId}
        onChange={handleSourceChange}
        onConfigure={() => setConfigOpen(true)}
        onResolve={handleResolve}
        resolving={resolving}
        loading={loading}
        disabled={!gameId}
      />

      <div className="mods-discover-toolbar">
        <div className="mods-discover-toolbar-row">
          <div className="mods-discover-field mods-discover-field--game">
            <label className="mods-discover-label" htmlFor="mods-discover-game">
              {t("mods.discover.selectGame")}
            </label>
            <select
              id="mods-discover-game"
              className="mods-discover-select"
              value={gameId ?? ""}
              onChange={(e) => setGameId(e.target.value || null)}
            >
              <option value="" disabled>
                {t("mods.discover.selectGamePlaceholder")}
              </option>
              {candidates.map((g) => (
                <option key={g.id} value={g.id}>
                  {gameDisplayName(g)}
                </option>
              ))}
            </select>
          </div>

          <div className="mods-discover-field mods-discover-field--search">
            <label className="mods-discover-label" htmlFor="mods-discover-search">
              {t("mods.discover.search")}
            </label>
            <div className="mods-discover-search">
              <Search size={15} className="mods-discover-search-icon" />
              <input
                id="mods-discover-search"
                type="text"
                className="mods-discover-search-input"
                placeholder={t("mods.discover.searchPlaceholder")}
                value={browse.query}
                disabled={!selectedSource?.available}
                onChange={(e) => browse.setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") browse.flush();
                }}
              />
            </div>
          </div>

          <div className="mods-discover-field">
            <label className="mods-discover-label" htmlFor="mods-discover-sort">
              {t("mods.discover.sortBy")}
            </label>
            <select
              id="mods-discover-sort"
              className="mods-discover-select"
              value={browse.sort}
              disabled={!selectedSource?.available}
              onChange={(e) => browse.setSort(e.target.value)}
            >
              {SORTS.map((s) => (
                <option key={s} value={s}>
                  {t(`mods.discover.sort.${s}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="mods-discover-field">
            <label className="mods-discover-label" htmlFor="mods-discover-category">
              {t("mods.discover.category")}
            </label>
            <select
              id="mods-discover-category"
              className="mods-discover-select"
              value={category}
              disabled={categories.length === 0}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="all">{t("mods.discover.allCategories")}</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {tagOptions.length > 0 && (
            <div className="mods-discover-field mods-discover-field--tags">
              <label className="mods-discover-label">{t("mods.discover.tags")}</label>
              <MultiSelectDropdown
                label={t("mods.discover.tags")}
                placeholder={t("mods.discover.allTags")}
                options={tagOptions}
                selected={selectedTags}
                onChange={setSelectedTags}
                counts={tagCountMap}
                clearLabel={t("mods.source.clear")}
                showSearch
                searchPlaceholder={t("mods.discover.tags")}
                noResultsLabel={t("mods.discover.empty")}
              />
            </div>
          )}
        </div>

        <div className="mods-discover-toolbar-row mods-discover-toolbar-row--meta">
          <span className="mods-discover-count">
            {selectedSource?.available && !browse.loading
              ? browse.total != null
                ? t("mods.discover.resultsCount", { count: String(browse.total) })
                : t("mods.discover.resultsCount", { count: String(browse.results.length) })
              : selectedSource?.note ?? ""}
          </span>
          <div className="mods-discover-meta-right">
            {selectedSource?.available && (
              <button
                type="button"
                className="mods-discover-icon-btn"
                onClick={browse.refresh}
                disabled={browse.loading}
                title={t("mods.discover.refresh")}
                aria-label={t("mods.discover.refresh")}
              >
                <RefreshCw size={15} className={browse.loading ? "spinning" : undefined} />
              </button>
            )}
            <div
              className="mods-discover-viewtoggle"
              role="group"
              aria-label={t("mods.discover.viewAria")}
            >
              <button
                type="button"
                className={`mods-discover-viewtoggle-btn${view === "grid" ? " active" : ""}`}
                onClick={() => setView("grid")}
                title={t("mods.discover.view.grid")}
                aria-label={t("mods.discover.view.grid")}
                aria-pressed={view === "grid"}
              >
                <LayoutGrid size={15} />
              </button>
              <button
                type="button"
                className={`mods-discover-viewtoggle-btn${view === "list" ? " active" : ""}`}
                onClick={() => setView("list")}
                title={t("mods.discover.view.list")}
                aria-label={t("mods.discover.view.list")}
                aria-pressed={view === "list"}
              >
                <List size={15} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <RemoteModGrid
        results={visibleResults}
        loading={browse.loading}
        loadingMore={browse.loadingMore}
        error={browse.error}
        hasMore={browse.hasMore}
        hasSource={!!selectedSource?.available}
        view={view}
        total={browse.total}
        installedKeys={installedKeys}
        onOpen={setActiveMod}
        onOpenExternal={(mod) => void openUrl(mod.url)}
        onLoadMore={browse.loadMore}
        onRetry={browse.refresh}
        onConfigure={() => setConfigOpen(true)}
      />

      {installs.installs.length > 0 && (
        <section className="mods-discover-recent">
          <h3>
            <History size={15} /> {t("mods.discover.recent")}
          </h3>
          <ul>
            {installs.installs.slice(0, 8).map((item) => (
              <li key={item.id} className="mods-discover-recent-row">
                <div className="mods-discover-recent-info">
                  <span className="mods-discover-recent-name">{item.name}</span>
                  <span className="mods-discover-recent-meta">
                    {sourceLabel(item.source)}
                    {item.version ? ` · v${item.version}` : ""}
                    {formatRemoteDate(String(item.installedAt))
                      ? ` · ${formatRemoteDate(String(item.installedAt))}`
                      : ""}
                  </span>
                </div>
                <div className="mods-discover-recent-actions">
                  {item.installedPath && (
                    <button
                      type="button"
                      className="mods-discover-icon-btn"
                      title={t("mods.discover.openFolder")}
                      aria-label={t("mods.discover.openFolder")}
                      onClick={() => void invoke("open_folder", { path: item.installedPath })}
                    >
                      <FolderOpen size={14} />
                    </button>
                  )}
                  {item.remoteUrl && (
                    <button
                      type="button"
                      className="mods-discover-icon-btn"
                      title={t("mods.discover.openPage")}
                      aria-label={t("mods.discover.openPage")}
                      onClick={() => void openUrl(item.remoteUrl!)}
                    >
                      <ExternalLink size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="mods-discover-icon-btn"
                    title={t("mods.discover.remove")}
                    aria-label={t("mods.discover.remove")}
                    onClick={() => void installs.remove(item.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <SourceConfigModal
        open={configOpen}
        gameId={gameId}
        gameName={selectedGame ? gameDisplayName(selectedGame) : undefined}
        sources={sources}
        onClose={() => setConfigOpen(false)}
        onSetCredential={setCredential}
        onSetLink={setLink}
        onClearLink={clearLink}
      />

      {activeMod && selectedSource && selectedSource.externalId && (
        <RemoteModDetailModal
          open
          gameId={selectedGame?.id ?? ""}
          source={activeMod.source}
          externalId={selectedSource.externalId}
          summary={activeMod}
          onClose={() => setActiveMod(null)}
          onInstalled={handleInstalled}
        />
      )}
    </div>
  );
}
