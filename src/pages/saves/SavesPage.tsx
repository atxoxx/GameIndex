import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  Archive,
  Clock,
  Database,
  FolderOpen,
  Gamepad2,
  HardDrive,
  LayoutGrid,
  List,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Zap,
} from "lucide-react";
import { useGames } from "../../context/GameContext";
import { useSaves } from "../../context/SavesContext";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { Badge, Button, ConfirmModal, KpiTile, PageHeader, Skeleton } from "../../components/ui";
import PageWidget from "../../components/PageWidget";
import { formatRelative } from "../../components/game/SaveBackupTab";
import { SAVE_KIND_LABEL_KEY, type SaveBackup, type SaveLocation } from "../../types/saves";
import { gameDisplayName, type Game } from "../../types/game";
import BackupTab from "../settings/BackupTab";
import SettingsToggleCard from "../settings/SettingsToggleCard";
import "../../styles/saves.css";

type SavesSubtab = "games" | "snapshots" | "system" | "settings";
type GameFilter = "all" | "backedUp" | "needsBackup" | "attention";
type GameSort = "name" | "recent" | "count";
type SnapshotSort = "newest" | "oldest" | "size";

/** Square cover thumbnail with a graceful first-letter fallback. */
function GameCoverThumb({ game }: { game: Game }) {
  const [failed, setFailed] = useState(false);
  const cover = game.coverArtUrl;
  return (
    <span className="saves-cover" aria-hidden>
      {cover && !failed ? (
        <img src={cover} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <span className="saves-cover__fallback">
          {gameDisplayName(game).charAt(0).toUpperCase() || "?"}
        </span>
      )}
    </span>
  );
}

/**
 * SavesPage — the unified, library-wide Save Backups and System Protection Hub.
 *
 * Provides a modular, 4-subtab experience:
 *   1. Tracked Games: Scannable grid/list of games, backup health, and 1-click snapshot creation.
 *   2. Snapshot History: Chronological archive timeline with game/kind filtering, restoration, and deletion.
 *   3. Library & System: Full database and application state backups (embedded BackupTab suite).
 *   4. Settings & Storage: In-place automation rules, retention configuration, and maintenance tools.
 */
export default function SavesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { games } = useGames();
  const {
    enabled,
    ready,
    settings,
    summary,
    progress,
    refresh,
    scanAll,
    restoreBackup,
    deleteBackup,
    openBackup,
    pickBackupDir,
    updateSettings,
  } = useSaves();
  const { formatBytes } = useSizeUnit();

  // Active subtab synchronized with URL ?tab=
  const tabParam = searchParams.get("tab");
  const subtab: SavesSubtab =
    tabParam === "snapshots" || tabParam === "system" || tabParam === "settings"
      ? tabParam
      : "games";

  const handleSelectSubtab = (newTab: SavesSubtab) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", newTab);
        return next;
      },
      { replace: true }
    );
  };

  const [locations, setLocations] = useState<SaveLocation[] | null>(null);
  const [backups, setBackups] = useState<SaveBackup[] | null>(null);
  const [busy, setBusy] = useState<null | "backupAll" | "scan">(null);
  const [busyGameId, setBusyGameId] = useState<string | null>(null);
  const [pending, setPending] = useState<null | { kind: "restore" | "delete"; backup: SaveBackup }>(
    null
  );
  const [confirmBusy, setConfirmBusy] = useState(false);

  // ─── Subtab 1: Games filters & view state ──────────────────────────────────
  const [gameSearch, setGameSearch] = useState("");
  const [gameFilter, setGameFilter] = useState<GameFilter>("all");
  const [gameSort, setGameSort] = useState<GameSort>("name");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // ─── Subtab 2: Snapshot timeline filters ────────────────────────────────────
  const [snapshotSearch, setSnapshotSearch] = useState("");
  const [snapshotGameFilter, setSnapshotGameFilter] = useState<string>("all");
  const [snapshotKindFilter, setSnapshotKindFilter] = useState<string>("all");
  const [snapshotSort, setSnapshotSort] = useState<SnapshotSort>("newest");

  const loadLists = useCallback(async () => {
    try {
      const [locs, baks] = await Promise.all([
        invoke<SaveLocation[]>("saves_list_all_locations"),
        invoke<SaveBackup[]>("saves_list_backups", { gameId: null }),
      ]);
      setLocations(locs);
      setBackups(baks);
    } catch {
      setLocations([]);
      setBackups([]);
    }
  }, []);

  useEffect(() => {
    if (enabled) void loadLists();
  }, [enabled, loadLists]);

  // Group locations and latest backups by game
  const perGame = useMemo(() => {
    const counts = new Map<string, number>();
    for (const loc of locations ?? []) {
      if (!loc.include) continue;
      counts.set(loc.gameId, (counts.get(loc.gameId) ?? 0) + 1);
    }
    const latestBackup = new Map<string, SaveBackup>();
    const backupCounts = new Map<string, number>();
    for (const backup of backups ?? []) {
      if (!latestBackup.has(backup.gameId)) latestBackup.set(backup.gameId, backup);
      backupCounts.set(backup.gameId, (backupCounts.get(backup.gameId) ?? 0) + 1);
    }
    return { counts, latestBackup, backupCounts };
  }, [locations, backups]);

  // Game list filtered and sorted
  const trackedGames = useMemo(() => {
    const query = gameSearch.trim().toLowerCase();
    const now = Date.now();
    const sevenDaysMs = 7 * 86400 * 1000;

    return games
      .filter((g) => (perGame.counts.get(g.id) ?? 0) > 0)
      .filter((g) => {
        if (query && !gameDisplayName(g).toLowerCase().includes(query)) return false;

        const latest = perGame.latestBackup.get(g.id);
        if (gameFilter === "backedUp") return Boolean(latest);
        if (gameFilter === "needsBackup") {
          return !latest || now - latest.createdAt > sevenDaysMs;
        }
        if (gameFilter === "attention") {
          return !latest;
        }
        return true;
      })
      .sort((a, b) => {
        if (gameSort === "name") {
          return gameDisplayName(a).localeCompare(gameDisplayName(b));
        }
        if (gameSort === "recent") {
          const aTime = perGame.latestBackup.get(a.id)?.createdAt ?? 0;
          const bTime = perGame.latestBackup.get(b.id)?.createdAt ?? 0;
          return bTime - aTime;
        }
        if (gameSort === "count") {
          const aCount = perGame.backupCounts.get(a.id) ?? 0;
          const bCount = perGame.backupCounts.get(b.id) ?? 0;
          return bCount - aCount;
        }
        return 0;
      });
  }, [games, perGame, gameSearch, gameFilter, gameSort, locations]);

  // Snapshots filtered and sorted
  const filteredSnapshots = useMemo(() => {
    const query = snapshotSearch.trim().toLowerCase();
    return (backups ?? [])
      .filter((b) => {
        if (snapshotGameFilter !== "all" && b.gameId !== snapshotGameFilter) return false;
        if (snapshotKindFilter !== "all" && b.kind !== snapshotKindFilter) return false;
        if (query) {
          const titleMatches = b.gameName.toLowerCase().includes(query);
          const noteMatches = b.note ? b.note.toLowerCase().includes(query) : false;
          if (!titleMatches && !noteMatches) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (snapshotSort === "newest") return b.createdAt - a.createdAt;
        if (snapshotSort === "oldest") return a.createdAt - b.createdAt;
        if (snapshotSort === "size") return b.totalBytes - a.totalBytes;
        return 0;
      });
  }, [backups, snapshotSearch, snapshotGameFilter, snapshotKindFilter, snapshotSort]);

  // Distinct games that have at least one snapshot (for dropdown)
  const gamesWithSnapshots = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of backups ?? []) {
      if (!map.has(b.gameId)) map.set(b.gameId, b.gameName);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [backups]);

  // Actions
  const handleScan = useCallback(async () => {
    setBusy("scan");
    await scanAll();
    await loadLists();
    setBusy(null);
  }, [scanAll, loadLists]);

  const handleBackupAll = useCallback(async () => {
    setBusy("backupAll");
    try {
      const done = await invoke<SaveBackup[]>("saves_backup_all");
      await Promise.all([refresh(), loadLists()]);
      showToast(t("saves.toast.backupAll", { count: done.length }), "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(null);
    }
  }, [refresh, loadLists, showToast, t]);

  const handleBackupGame = useCallback(
    async (gameId: string, name: string) => {
      setBusyGameId(gameId);
      try {
        await invoke<SaveBackup>("saves_backup_game", { gameId, note: null });
        await Promise.all([refresh(), loadLists()]);
        showToast(t("saves.toast.gameBackedUp", { name }), "success");
      } catch (err) {
        showToast(err instanceof Error ? err.message : String(err), "error");
      } finally {
        setBusyGameId(null);
      }
    },
    [refresh, loadLists, showToast, t]
  );

  const handleConfirm = useCallback(async () => {
    if (!pending) return;
    setConfirmBusy(true);
    try {
      if (pending.kind === "restore") {
        const result = await restoreBackup(pending.backup.id);
        showToast(t("saves.toast.restoreDone", { count: result.restoredFiles }), "success");
      } else {
        await deleteBackup(pending.backup.id);
        showToast(t("saves.toast.backupDeleted"), "info");
      }
      await Promise.all([refresh(), loadLists()]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setConfirmBusy(false);
      setPending(null);
    }
  }, [pending, restoreBackup, deleteBackup, refresh, loadLists, showToast, t]);

  const handleViewGameHistory = (gameId: string) => {
    setSnapshotGameFilter(gameId);
    handleSelectSubtab("snapshots");
  };

  if (!ready) {
    return (
      <div className="saves-page page">
        <div className="saves-page__skeleton">
          <Skeleton width="280px" height="2.4em" />
          <Skeleton width="100%" height="120px" />
        </div>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="saves-page page">
        <PageHeader
          eyebrow={t("nav.saves")}
          title={t("saves.page.title")}
          description={t("saves.page.disabledDesc")}
        />
        <div className="saves-empty saves-empty--page">
          <p className="saves-empty__title">{t("saves.page.disabledTitle")}</p>
          <p className="saves-empty__text">{t("saves.page.disabledText")}</p>
          <Button
            variant="primary"
            onClick={async () => {
              await updateSettings({ enabled: true });
              await refresh();
            }}
          >
            {t("saves.settings.enableTitle")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="saves-page page">
      {/* ─── Top Page Header ────────────────────────────────────────────── */}
      <PageWidget page="saves" widget="savesHeader">
        <PageHeader
          eyebrow={t("nav.saves")}
          title={t("saves.page.title")}
          description={t("saves.page.desc")}
          actions={
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleScan}
                isLoading={busy === "scan"}
                disabled={busy !== null}
              >
                <RefreshCw size={14} />
                {t("saves.action.scanLibrary")}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleBackupAll}
                isLoading={busy === "backupAll"}
                disabled={busy !== null || (summary?.gamesWithLocations ?? 0) === 0}
              >
                <Zap size={14} />
                {t("saves.action.backupAll")}
              </Button>
            </>
          }
        />
      </PageWidget>

      {/* ─── Top Subtabs Strip ──────────────────────────────────────────── */}
      <nav className="saves-subtabs-bar" aria-label={t("saves.viewsLabel")}>
        <button
          type="button"
          className={`saves-subtab-pill ${subtab === "games" ? "active" : ""}`}
          onClick={() => handleSelectSubtab("games")}
        >
          <Gamepad2 className="saves-subtab-icon" size={16} />
          <span>{t("saves.subtab.games")}</span>
          {(summary?.gamesWithLocations ?? 0) > 0 && (
            <span className="saves-subtab-badge">{summary?.gamesWithLocations}</span>
          )}
        </button>

        <button
          type="button"
          className={`saves-subtab-pill ${subtab === "snapshots" ? "active" : ""}`}
          onClick={() => handleSelectSubtab("snapshots")}
        >
          <Archive className="saves-subtab-icon" size={16} />
          <span>{t("saves.subtab.snapshots")}</span>
          {(summary?.totalBackups ?? 0) > 0 && (
            <span className="saves-subtab-badge">{summary?.totalBackups}</span>
          )}
        </button>

        <button
          type="button"
          className={`saves-subtab-pill ${subtab === "system" ? "active" : ""}`}
          onClick={() => handleSelectSubtab("system")}
        >
          <Database className="saves-subtab-icon" size={16} />
          <span>{t("saves.subtab.system")}</span>
        </button>

        <button
          type="button"
          className={`saves-subtab-pill ${subtab === "settings" ? "active" : ""}`}
          onClick={() => handleSelectSubtab("settings")}
        >
          <SlidersHorizontal className="saves-subtab-icon" size={16} />
          <span>{t("saves.subtab.settings")}</span>
        </button>
      </nav>

      {/* ─── Shared Progress Bar ────────────────────────────────────────── */}
      {progress && progress.percent < 100 && (
        <div className="saves-progress" role="status" aria-live="polite">
          <div className="saves-progress__bar">
            <div
              className="saves-progress__fill"
              style={{ width: `${Math.max(4, progress.percent)}%` }}
            />
          </div>
          <span className="saves-progress__label">
            {progress.message || t("saves.progress.working")}
          </span>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          SUBTAB 1: TRACKED GAMES
          ═══════════════════════════════════════════════════════════════════ */}
      {subtab === "games" && (
        <>
          {/* KPI Dashboard */}
          <PageWidget page="saves" widget="savesHero">
            <div className="saves-kpis">
              <KpiTile
                label={t("saves.kpi.games")}
                value={summary?.gamesWithLocations ?? 0}
                icon={<Gamepad2 size={16} />}
                intent="accent"
                size="sm"
              />
              <KpiTile
                label={t("saves.kpi.locations")}
                value={summary?.totalLocations ?? 0}
                icon={<FolderOpen size={16} />}
                subtext={
                  (summary?.missingLocations ?? 0) > 0
                    ? t("saves.kpi.missing", { count: summary?.missingLocations ?? 0 })
                    : undefined
                }
                intent={(summary?.missingLocations ?? 0) > 0 ? "warning" : "default"}
                size="sm"
              />
              <KpiTile
                label={t("saves.kpi.backups")}
                value={summary?.totalBackups ?? 0}
                icon={<Archive size={16} />}
                subtext={formatBytes(summary?.totalBackupBytes ?? 0)}
                intent="info"
                size="sm"
              />
              <KpiTile
                label={t("saves.kpi.lastBackup")}
                value={
                  summary?.lastBackupAt
                    ? formatRelative(summary.lastBackupAt)
                    : t("saves.kpi.never")
                }
                icon={<Clock size={16} />}
                size="sm"
              />
            </div>
          </PageWidget>

          {/* Interactive Controls & Filter Bar */}
          <PageWidget page="saves" widget="savesControls">
            <div className="saves-toolbar">
              <div className="saves-input-wrapper" style={{ position: "relative", flex: 1, minWidth: 200, maxWidth: 360 }}>
                <input
                  type="search"
                  className="saves-input"
                  style={{ width: "100%", paddingLeft: 34 }}
                  placeholder={t("saves.searchPlaceholder")}
                  value={gameSearch}
                  onChange={(e) => setGameSearch(e.target.value)}
                  aria-label={t("saves.searchPlaceholder")}
                />
                <Search size={14} style={{ position: "absolute", left: 11, top: 10, color: "var(--color-text-muted)", pointerEvents: "none" }} />
              </div>

              {/* Filter Pills */}
              <div className="saves-filter-pills">
                <button
                  type="button"
                  className={`saves-filter-pill ${gameFilter === "all" ? "active" : ""}`}
                  onClick={() => setGameFilter("all")}
                >
                  <span>{t("saves.filter.all")}</span>
                </button>
                <button
                  type="button"
                  className={`saves-filter-pill ${gameFilter === "backedUp" ? "active" : ""}`}
                  onClick={() => setGameFilter("backedUp")}
                >
                  <span>{t("saves.filter.backedUp")}</span>
                </button>
                <button
                  type="button"
                  className={`saves-filter-pill ${gameFilter === "needsBackup" ? "active" : ""}`}
                  onClick={() => setGameFilter("needsBackup")}
                >
                  <span>{t("saves.filter.needsBackup")}</span>
                </button>
                <button
                  type="button"
                  className={`saves-filter-pill ${gameFilter === "attention" ? "active" : ""}`}
                  onClick={() => setGameFilter("attention")}
                >
                  <span>{t("saves.filter.attention")}</span>
                </button>
              </div>

              {/* Sort selector */}
              <select
                className="saves-sort-select"
                value={gameSort}
                onChange={(e) => setGameSort(e.target.value as GameSort)}
                aria-label={t("saves.sortGames")}
              >
                <option value="name">{t("saves.sort.title")}</option>
                <option value="recent">{t("saves.sort.recent")}</option>
                <option value="count">{t("saves.sort.count")}</option>
              </select>

              {/* View mode toggle */}
              <div className="saves-view-toggles" role="group" aria-label={t("saves.viewMode")}>
                <button
                  type="button"
                  className={`saves-view-btn ${viewMode === "grid" ? "active" : ""}`}
                  onClick={() => setViewMode("grid")}
                  title={t("saves.view.grid")}
                >
                  <LayoutGrid size={15} />
                </button>
                <button
                  type="button"
                  className={`saves-view-btn ${viewMode === "list" ? "active" : ""}`}
                  onClick={() => setViewMode("list")}
                  title={t("saves.view.list")}
                >
                  <List size={15} />
                </button>
              </div>

              {/* Backup Directory Shortcut */}
              <button
                type="button"
                className="saves-toolbar__path"
                onClick={() => void invoke("saves_open_path", { path: summary?.backupDir ?? "" })}
                title={summary?.backupDir}
              >
                <HardDrive size={14} />
                <span className="saves-toolbar__path-label">{t("saves.settings.backupDir")}</span>
                <span className="saves-toolbar__path-value">{summary?.backupDir}</span>
              </button>
            </div>
          </PageWidget>

          {/* Game List Display */}
          <PageWidget page="saves" widget="savesGrid">
            <section className="saves-card">
              <header className="saves-card__header">
                <h3 className="saves-card__title">{t("saves.page.yourGames")}</h3>
                <span className="saves-card__count">{trackedGames.length}</span>
              </header>

              {locations === null ? (
                <div className="saves-card__skeleton">
                  <Skeleton width="100%" height="76px" />
                  <Skeleton width="100%" height="76px" />
                </div>
              ) : trackedGames.length === 0 ? (
                <div className="saves-empty">
                  <p className="saves-empty__title">{t("saves.page.noGamesTitle")}</p>
                  <p className="saves-empty__text">{t("saves.page.noGamesText")}</p>
                  <Button variant="primary" size="sm" onClick={handleScan} isLoading={busy === "scan"}>
                    <RefreshCw size={14} />
                    {t("saves.action.scanLibrary")}
                  </Button>
                </div>
              ) : viewMode === "grid" ? (
                /* Grid View */
                <div className="saves-game-grid">
                  {trackedGames.map((game) => {
                    const latest = perGame.latestBackup.get(game.id);
                    const bCount = perGame.backupCounts.get(game.id) ?? 0;
                    return (
                      <article key={game.id} className="saves-game-card">
                        <button
                          type="button"
                          className="saves-game-card__main"
                          onClick={() => navigate(`/library/${game.id}?tab=saves`)}
                          title={t("saves.action.manage")}
                        >
                          <GameCoverThumb game={game} />
                          <span className="saves-game-card__text">
                            <span className="saves-game-card__name">{gameDisplayName(game)}</span>
                            <span className="saves-game-card__meta">
                              {t("saves.game.locations", { count: perGame.counts.get(game.id) ?? 0 })}
                              {" · "}
                              {latest
                                ? t("saves.game.lastBackup", { when: formatRelative(latest.createdAt) })
                                : t("saves.game.noBackup")}
                            </span>
                          </span>
                        </button>

                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {bCount > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleViewGameHistory(game.id)}
                              title={t("saves.game.viewHistory")}
                            >
                              <Archive size={13} />
                              <span>{bCount}</span>
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => void handleBackupGame(game.id, gameDisplayName(game))}
                            isLoading={busyGameId === game.id}
                            title={t("saves.action.backupNow")}
                          >
                            <Zap size={13} />
                            {t("saves.action.backupNow")}
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                /* Compact List View */
                <div className="saves-game-list-view">
                  {trackedGames.map((game) => {
                    const latest = perGame.latestBackup.get(game.id);
                    const bCount = perGame.backupCounts.get(game.id) ?? 0;
                    return (
                      <div key={game.id} className="saves-game-row">
                        <button
                          type="button"
                          className="saves-game-row__main"
                          onClick={() => navigate(`/library/${game.id}?tab=saves`)}
                        >
                          <GameCoverThumb game={game} />
                          <div className="saves-game-row__info">
                            <span className="saves-game-row__title">{gameDisplayName(game)}</span>
                            <span className="saves-game-row__meta">
                              {t("saves.game.locations", { count: perGame.counts.get(game.id) ?? 0 })}
                              {" · "}
                              {latest
                                ? t("saves.game.lastBackup", { when: formatRelative(latest.createdAt) })
                                : t("saves.game.noBackup")}
                            </span>
                          </div>
                        </button>

                        <div className="saves-game-row__actions">
                          {bCount > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleViewGameHistory(game.id)}
                            >
                              <Archive size={13} />
                              <span>{bCount} {t("saves.game.viewHistory")}</span>
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => void handleBackupGame(game.id, gameDisplayName(game))}
                            isLoading={busyGameId === game.id}
                          >
                            <Zap size={13} />
                            {t("saves.action.backupNow")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigate(`/library/${game.id}?tab=saves`)}
                          >
                            {t("saves.action.manage")}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </PageWidget>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          SUBTAB 2: SNAPSHOT TIMELINE & ARCHIVES
          ═══════════════════════════════════════════════════════════════════ */}
      {subtab === "snapshots" && (
        <section className="saves-card">
          <header className="saves-card__header">
            <h3 className="saves-card__title">{t("saves.subtab.snapshots")}</h3>
            <span className="saves-card__count">
              {t("saves.snapshots.showingCount", {
                count: filteredSnapshots.length,
                size: formatBytes(
                  filteredSnapshots.reduce((acc, b) => acc + b.totalBytes, 0)
                ),
              })}
            </span>
          </header>

          {/* Timeline Filter Controls */}
          <div className="saves-toolbar">
            <div className="saves-input-wrapper" style={{ position: "relative", flex: 1, minWidth: 200, maxWidth: 360 }}>
              <input
                type="search"
                className="saves-input"
                style={{ width: "100%", paddingLeft: 34 }}
                placeholder={t("saves.snapshots.searchPlaceholder")}
                value={snapshotSearch}
                onChange={(e) => setSnapshotSearch(e.target.value)}
              />
              <Search size={14} style={{ position: "absolute", left: 11, top: 10, color: "var(--color-text-muted)", pointerEvents: "none" }} />
            </div>

            {/* Game Selector Dropdown */}
            <select
              className="saves-sort-select"
              value={snapshotGameFilter}
              onChange={(e) => setSnapshotGameFilter(e.target.value)}
              aria-label={t("saves.filterByGame")}
            >
              <option value="all">{t("saves.snapshots.allGames")}</option>
              {gamesWithSnapshots.map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </select>

            {/* Kind Selector Dropdown */}
            <select
              className="saves-sort-select"
              value={snapshotKindFilter}
              onChange={(e) => setSnapshotKindFilter(e.target.value)}
              aria-label={t("saves.filterByType")}
            >
              <option value="all">{t("saves.snapshots.allKinds")}</option>
              <option value="manual">{t("saves.kind.manual")}</option>
              <option value="auto_exit">{t("saves.kind.autoExit")}</option>
              <option value="pre_restore">{t("saves.kind.preRestore")}</option>
            </select>

            {/* Sort Selector Dropdown */}
            <select
              className="saves-sort-select"
              value={snapshotSort}
              onChange={(e) => setSnapshotSort(e.target.value as SnapshotSort)}
              aria-label={t("saves.sortSnapshots")}
            >
              <option value="newest">{t("saves.sort.recent")}</option>
              <option value="oldest">{t("saves.sort.title")}</option>
              <option value="size">Size</option>
            </select>
          </div>

          {backups === null ? (
            <div className="saves-card__skeleton">
              <Skeleton width="100%" height="60px" />
              <Skeleton width="100%" height="60px" />
            </div>
          ) : filteredSnapshots.length === 0 ? (
            <div className="saves-empty">
              <p className="saves-empty__title">{t("saves.snapshots.emptyFilter")}</p>
              <p className="saves-empty__text">{t("saves.backups.emptyText")}</p>
              {snapshotGameFilter !== "all" && (
                <Button variant="secondary" size="sm" onClick={() => setSnapshotGameFilter("all")}>
                  {t("saves.snapshots.allGames")}
                </Button>
              )}
            </div>
          ) : (
            <div className="saves-game-list-view">
              {filteredSnapshots.map((backup) => {
                const game = games.find((g) => g.id === backup.gameId);
                return (
                  <article key={backup.id} className="saves-snapshot-card-rich">
                    <div className="saves-snapshot-card-main">
                      {game && <GameCoverThumb game={game} />}
                      <div className="saves-snapshot-card-details">
                        <div className="saves-snapshot-card-headline">
                          <span className="saves-snapshot-card-game">{backup.gameName}</span>
                          <Badge
                            variant={
                              backup.kind === "manual"
                                ? "accent"
                                : backup.kind === "pre_restore"
                                  ? "warning"
                                  : "info"
                            }
                            size="sm"
                          >
                            {t(SAVE_KIND_LABEL_KEY[backup.kind] ?? "saves.kind.manual")}
                          </Badge>
                        </div>
                        <div className="saves-snapshot-card-meta">
                          <span>{formatRelative(backup.createdAt)}</span>
                          <span>·</span>
                          <span>
                            {t("saves.backups.meta", {
                              files: backup.fileCount,
                              size: formatBytes(backup.totalBytes),
                            })}
                          </span>
                          {backup.note && (
                            <>
                              <span>·</span>
                              <span className="saves-snapshot-card-note">“{backup.note}”</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="saves-snapshot-card-actions">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setPending({ kind: "restore", backup })}
                      >
                        {t("saves.action.restore")}
                      </Button>
                      <button
                        type="button"
                        className="saves-icon-btn"
                        onClick={() => void openBackup(backup.id)}
                        title={t("saves.action.openBackup")}
                        aria-label={t("saves.action.openBackup")}
                      >
                        <FolderOpen size={15} />
                      </button>
                      <button
                        type="button"
                        className="saves-icon-btn saves-icon-btn--danger"
                        onClick={() => setPending({ kind: "delete", backup })}
                        title={t("saves.action.deleteBackup")}
                        aria-label={t("saves.action.deleteBackup")}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M3 6h18" />
                          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        </svg>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          SUBTAB 3: SYSTEM & LIBRARY BACKUP
          ═══════════════════════════════════════════════════════════════════ */}
      {subtab === "system" && (
        <div className="saves-system-wrapper">
          <BackupTab />
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          SUBTAB 4: SETTINGS & STORAGE
          ═══════════════════════════════════════════════════════════════════ */}
      {subtab === "settings" && settings && (
        <div className="saves-settings-panel">
          <section className="saves-card">
            <header className="saves-card__header">
              <h3 className="saves-card__title">{t("saves.settings.title")}</h3>
              <Badge variant={settings.enabled ? "success" : "default"} dot>
                {settings.enabled ? t("saves.settings.on") : t("saves.settings.off")}
              </Badge>
            </header>

            <div className="saves-settings-grid">
              <SettingsToggleCard
                title={t("saves.settings.enableTitle")}
                desc={t("saves.settings.enableDesc")}
                checked={settings.enabled}
                onChange={(checked) => void updateSettings({ enabled: checked })}
              />
              <SettingsToggleCard
                title={t("saves.settings.autoExitTitle")}
                desc={t("saves.settings.autoExitDesc")}
                checked={settings.autoBackupOnExit}
                onChange={(checked) => void updateSettings({ autoBackupOnExit: checked })}
              />
              <SettingsToggleCard
                title={t("saves.settings.safetyTitle")}
                desc={t("saves.settings.safetyDesc")}
                checked={settings.restoreSafetySnapshot}
                onChange={(checked) => void updateSettings({ restoreSafetySnapshot: checked })}
              />
              <SettingsToggleCard
                title={t("saves.settings.emulatorTitle")}
                desc={t("saves.settings.emulatorDesc")}
                checked={settings.includeEmulatorSaves}
                onChange={(checked) => void updateSettings({ includeEmulatorSaves: checked })}
              />
            </div>
          </section>

          {/* Storage Directory & Retention */}
          <section className="saves-card">
            <header className="saves-card__header">
              <h3 className="saves-card__title">{t("saves.settings.storageTitle")}</h3>
            </header>

            <div className="saves-setting-row">
              <div className="saves-setting-row__text">
                <span className="saves-setting-row__label">{t("saves.settings.backupDir")}</span>
                <span className="saves-setting-row__path" title={settings.backupDir}>
                  {settings.backupDir || "—"}
                </span>
              </div>
              <div className="saves-setting-row__actions">
                <Button variant="secondary" size="sm" onClick={() => void pickBackupDir()}>
                  {t("saves.action.browse")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void invoke("saves_open_path", { path: settings.backupDir })}
                >
                  <FolderOpen size={14} />
                  {t("saves.action.openFolder")}
                </Button>
              </div>
            </div>

            <div className="saves-setting-row">
              <div className="saves-setting-row__text">
                <span className="saves-setting-row__label">{t("saves.settings.retention")}</span>
                <span className="saves-setting-row__hint">{t("saves.settings.retentionHint")}</span>
              </div>
              <div className="saves-setting-row__actions">
                <input
                  type="number"
                  min="0"
                  max="100"
                  className="saves-input saves-input--number"
                  value={settings.retention}
                  onChange={(e) => {
                    const parsed = parseInt(e.target.value, 10);
                    if (!Number.isNaN(parsed) && parsed >= 0) {
                      void updateSettings({ retention: parsed });
                    }
                  }}
                />
              </div>
            </div>
          </section>

          {/* Maintenance */}
          <section className="saves-card">
            <header className="saves-card__header">
              <h3 className="saves-card__title">{t("saves.settings.maintenanceTitle")}</h3>
              <span className="saves-card__count">{t("saves.settings.maintenanceDesc")}</span>
            </header>

            <div className="saves-setting-actions">
              <Button variant="secondary" size="sm" onClick={handleScan} isLoading={busy === "scan"}>
                <RefreshCw size={14} />
                {t("saves.action.scanLibrary")}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleBackupAll}
                isLoading={busy === "backupAll"}
                disabled={(summary?.gamesWithLocations ?? 0) === 0}
              >
                <Zap size={14} />
                {t("saves.action.backupAll")}
              </Button>
            </div>
          </section>
        </div>
      )}

      {/* ─── Confirmation Modal ─────────────────────────────────────────── */}
      <ConfirmModal
        open={pending !== null}
        busy={confirmBusy}
        title={
          pending?.kind === "restore"
            ? t("saves.confirm.restoreTitle", { name: pending?.backup.gameName ?? "" })
            : t("saves.confirm.deleteTitle")
        }
        message={
          pending?.kind === "restore"
            ? t("saves.confirm.restoreMessage", {
                when: formatRelative(pending?.backup.createdAt ?? 0),
              })
            : t("saves.confirm.deleteMessage")
        }
        warning={pending?.kind === "restore" ? t("saves.confirm.restoreWarning") : undefined}
        confirmLabel={pending?.kind === "restore" ? "saves.action.restore" : "common.delete"}
        onConfirm={() => void handleConfirm()}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
