// "Discover" — browse and install mods from the popular mod websites.
// A separate route (/mods/discover) so the existing Mods manager stays
// focused on installed mods. Reached from the Mods page header.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Boxes, FolderOpen, History, Search, Trash2 } from "lucide-react";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { Button, PageHeader } from "../../components/ui";
import SourceSelect from "../../components/mods/discover/SourceSelect";
import SourceConfigModal from "../../components/mods/discover/SourceConfigModal";
import RemoteModGrid from "../../components/mods/discover/RemoteModGrid";
import RemoteModDetailModal from "../../components/mods/discover/RemoteModDetailModal";
import { sourceLabel, formatRemoteDate } from "../../components/mods/discover/format";
import {
  useModBrowse,
  useModSources,
  useRemoteInstalls,
} from "../../hooks/useModDiscover";
import { gameDisplayName } from "../../types/game";
import type { RemoteModSummary } from "../../types/mods";
import "../../styles/page-mods.css";
import "../../components/mods/discover/mods-discover.css";

const SORTS = ["trending", "latest", "updated", "downloads"] as const;

export default function ModsDiscoverPage() {
  const { games } = useGames();
  const { t } = useLanguage();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [gameId, setGameId] = useState<string | null>(
    searchParams.get("gameId"),
  );
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [activeMod, setActiveMod] = useState<RemoteModSummary | null>(null);

  const candidates = useMemo(
    () =>
      games
        .filter((g) => g.installed !== false)
        .sort((a, b) => gameDisplayName(a).localeCompare(gameDisplayName(b))),
    [games],
  );

  const selectedGame = candidates.find((g) => g.id === gameId) ?? null;
  const gameName = selectedGame ? gameDisplayName(selectedGame) : undefined;

  const { sources, loading, resolving, resolveAll, setCredential, setLink, clearLink } =
    useModSources(gameId);

  const selectedSource = sources.find((s) => s.id === sourceId) ?? null;
  const browse = useModBrowse(
    selectedSource?.available ? selectedSource.id : null,
    selectedSource?.externalId ?? null,
  );

  const installs = useRemoteInstalls(gameId);
  const autoResolvedRef = useRef<string | null>(null);

  // First visit to a game with nothing mapped: try to detect its mod
  // sites once automatically (network), then leave it to the user.
  useEffect(() => {
    if (!gameId || loading || resolving || sources.length === 0) return;
    if (autoResolvedRef.current === gameId) return;
    if (sources.some((s) => s.available)) return;
    autoResolvedRef.current = gameId;
    void resolveAll();
  }, [gameId, loading, resolving, sources, resolveAll]);

  // Default game selection.
  useEffect(() => {
    if (!gameId && candidates.length > 0) {
      setGameId(candidates[0].id);
    }
  }, [gameId, candidates]);

  // Keep the URL shareable.
  useEffect(() => {
    if (gameId && searchParams.get("gameId") !== gameId) {
      setSearchParams({ gameId }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  // Default to the first available source whenever the game changes.
  useEffect(() => {
    if (sources.length === 0) {
      setSourceId(null);
      return;
    }
    if (sourceId && sources.some((s) => s.id === sourceId)) return;
    const first = sources.find((s) => s.available);
    setSourceId(first?.id ?? null);
  }, [sources, sourceId]);

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

      <div className="mods-discover-controls">
        <div className="mods-discover-field">
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

        <SourceSelect
          sources={sources}
          value={sourceId}
          onChange={setSourceId}
          onConfigure={() => setConfigOpen(true)}
          onResolve={resolveAll}
          resolving={resolving}
          loading={loading}
          disabled={!gameId}
        />

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
      </div>

      <div className="mods-discover-meta">
        {selectedSource?.available && !browse.loading && (
          <span>
            {browse.total != null
              ? t("mods.discover.resultsCount", { count: String(browse.total) })
              : t("mods.discover.resultsCount", {
                  count: String(browse.results.length),
                })}
          </span>
        )}
        {selectedSource?.note && (
          <span className="mods-discover-note">{selectedSource.note}</span>
        )}
      </div>

      <RemoteModGrid
        results={browse.results}
        loading={browse.loading}
        loadingMore={browse.loadingMore}
        error={browse.error}
        hasMore={browse.hasMore}
        hasSource={!!selectedSource?.available}
        onOpen={setActiveMod}
        onOpenExternal={(mod) => void openUrl(mod.url)}
        onLoadMore={browse.loadMore}
        onRetry={browse.refresh}
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
                      onClick={() =>
                        void invoke("open_folder", { path: item.installedPath })
                      }
                    >
                      <FolderOpen size={14} />
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
        gameName={gameName}
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
