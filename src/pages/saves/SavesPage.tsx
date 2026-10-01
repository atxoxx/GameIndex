import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { Archive, Clock, FolderOpen, Gamepad2, HardDrive } from "lucide-react";
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
import "../../styles/saves.css";

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
 * SavesPage — the library-wide Save Backups hub.
 *
 * New users land here with a plain-language intro and two obvious actions
 * (Scan library / Back up all); returning users get a scannable grid of
 * their games with cover art, followed by a full-width recent-snapshots
 * feed. Per-game management lives on each game's "Saves" tab.
 */
export default function SavesPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { games } = useGames();
  const {
    enabled,
    ready,
    summary,
    progress,
    refresh,
    scanAll,
    restoreBackup,
    deleteBackup,
    openBackup,
  } = useSaves();
  const { formatBytes } = useSizeUnit();

  const [locations, setLocations] = useState<SaveLocation[] | null>(null);
  const [backups, setBackups] = useState<SaveBackup[] | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<null | "backupAll" | "scan">(null);
  const [busyGameId, setBusyGameId] = useState<string | null>(null);
  const [pending, setPending] = useState<null | { kind: "restore" | "delete"; backup: SaveBackup }>(
    null
  );
  const [confirmBusy, setConfirmBusy] = useState(false);

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

  // Group locations + backups by game for the overview list.
  const perGame = useMemo(() => {
    const counts = new Map<string, number>();
    for (const loc of locations ?? []) {
      if (!loc.include) continue;
      counts.set(loc.gameId, (counts.get(loc.gameId) ?? 0) + 1);
    }
    const latestBackup = new Map<string, SaveBackup>();
    for (const backup of backups ?? []) {
      if (!latestBackup.has(backup.gameId)) latestBackup.set(backup.gameId, backup);
    }
    return { counts, latestBackup };
  }, [locations, backups]);

  const trackedGames = useMemo(() => {
    const query = search.trim().toLowerCase();
    return games
      .filter((g) => (perGame.counts.get(g.id) ?? 0) > 0)
      .filter((g) => (query ? gameDisplayName(g).toLowerCase().includes(query) : true))
      .sort((a, b) => gameDisplayName(a).localeCompare(gameDisplayName(b)));
  }, [games, perGame, search]);

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
    async (gameId: string, gameName: string) => {
      setBusyGameId(gameId);
      try {
        await invoke<SaveBackup>("saves_backup_game", { gameId, note: null });
        await Promise.all([refresh(), loadLists()]);
        showToast(t("saves.toast.gameBackedUp", { name: gameName }), "success");
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
          <Button variant="primary" onClick={() => navigate("/settings/saves")}>
            {t("saves.page.openSettings")}
          </Button>
        </div>
      </div>
    );
  }

  const recent = (backups ?? []).slice(0, 24);

  return (
    <div className="saves-page page">
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
                {t("saves.action.scanLibrary")}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleBackupAll}
                isLoading={busy === "backupAll"}
                disabled={busy !== null || (summary?.gamesWithLocations ?? 0) === 0}
              >
                {t("saves.action.backupAll")}
              </Button>
            </>
          }
        />
      </PageWidget>

      {progress && progress.percent < 100 && (
        <div className="saves-progress" role="status" aria-live="polite">
          <div className="saves-progress__bar">
            <div className="saves-progress__fill" style={{ width: `${Math.max(4, progress.percent)}%` }} />
          </div>
          <span className="saves-progress__label">
            {progress.message || t("saves.progress.working")}
          </span>
        </div>
      )}

      <PageWidget page="saves" widget="savesHero">
        <div className="saves-kpis">
          <KpiTile
            label={t("saves.kpi.games")}
            value={summary?.gamesWithLocations ?? 0}
            icon={<Gamepad2 size={14} />}
            intent="accent"
            size="sm"
          />
          <KpiTile
            label={t("saves.kpi.locations")}
            value={summary?.totalLocations ?? 0}
            icon={<FolderOpen size={14} />}
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
            icon={<Archive size={14} />}
            subtext={formatBytes(summary?.totalBackupBytes ?? 0)}
            intent="info"
            size="sm"
          />
          <KpiTile
            label={t("saves.kpi.lastBackup")}
            value={summary?.lastBackupAt ? formatRelative(summary.lastBackupAt) : t("saves.kpi.never")}
            icon={<Clock size={14} />}
            size="sm"
          />
        </div>
      </PageWidget>

      <PageWidget page="saves" widget="savesControls">
        <div className="saves-toolbar">
          <input
            type="search"
            className="saves-input saves-toolbar__search"
            placeholder={t("saves.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t("saves.searchPlaceholder")}
          />
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

      <PageWidget page="saves" widget="savesGrid">
        <div className="saves-sections">
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
                  {t("saves.action.scanLibrary")}
                </Button>
              </div>
            ) : (
              <div className="saves-game-grid">
                {trackedGames.map((game) => {
                  const latest = perGame.latestBackup.get(game.id);
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
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleBackupGame(game.id, gameDisplayName(game))}
                        isLoading={busyGameId === game.id}
                      >
                        {t("saves.action.backupNow")}
                      </Button>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section className="saves-card">
            <header className="saves-card__header">
              <h3 className="saves-card__title">{t("saves.page.recentBackups")}</h3>
              <span className="saves-card__count">{backups?.length ?? 0}</span>
            </header>

            {backups === null ? (
              <div className="saves-card__skeleton">
                <Skeleton width="100%" height="76px" />
              </div>
            ) : recent.length === 0 ? (
              <div className="saves-empty">
                <p className="saves-empty__title">{t("saves.backups.emptyTitle")}</p>
                <p className="saves-empty__text">{t("saves.backups.emptyText")}</p>
              </div>
            ) : (
              <div className="saves-backup-grid">
                {recent.map((backup) => (
                  <article key={backup.id} className="saves-backup-card">
                    <div className="saves-backup-card__top">
                      <span className="saves-backup-card__game">{backup.gameName}</span>
                      <Badge variant={backup.kind === "manual" ? "accent" : "info"} size="sm">
                        {t(SAVE_KIND_LABEL_KEY[backup.kind] ?? "saves.kind.manual")}
                      </Badge>
                    </div>
                    <span className="saves-backup-card__meta">
                      {formatRelative(backup.createdAt)} ·{" "}
                      {t("saves.backups.meta", {
                        files: backup.fileCount,
                        size: formatBytes(backup.totalBytes),
                      })}
                    </span>
                    <div className="saves-backup-card__actions">
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
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
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
                ))}
              </div>
            )}
          </section>
        </div>
      </PageWidget>

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
            ? t("saves.confirm.restoreMessage", { when: formatRelative(pending?.backup.createdAt ?? 0) })
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
