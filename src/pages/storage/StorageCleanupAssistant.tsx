import { useState, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Game } from "../../types/game";
import { formatSize } from "../../types/game";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useLanguage } from "../../context/LanguageContext";
import { useGames } from "../../context/GameContext";
import { useToast } from "../../context/ToastContext";
import { gameTotalBytes, totalBytesWithMods, driveOf } from "./utils";
import { Button } from "../../components/ui";
import { useDriveUsage } from "./useDriveUsage";

interface Props {
  games: Game[];
  staleMap: Map<string, boolean>;
  onRefreshStale: () => void;
  onOpenFolder: (game: Game) => void;
  onMoveGame: (game: Game) => void;
  onUninstallGame: (game: Game) => void;
}

export function StorageCleanupAssistant({
  games,
  staleMap,
  onRefreshStale,
  onOpenFolder,
  onMoveGame,
  onUninstallGame,
}: Props) {
  const { t } = useLanguage();
  const { unit } = useSizeUnit();
  const { updateGame } = useGames();
  const { showToast } = useToast();
  const driveUsage = useDriveUsage(games);

  const [detectingId, setDetectingId] = useState<string | null>(null);
  const [wizardRunning, setWizardRunning] = useState(false);
  const [wizardDone, setWizardDone] = useState(0);
  const [wizardTotal, setWizardTotal] = useState(0);

  const totalLibBytes = useMemo(() => totalBytesWithMods(games), [games]);

  // Identify stale games
  const staleGames = useMemo(() => {
    return games.filter((g) => staleMap.get(g.id) === true);
  }, [games, staleMap]);

  // Identify unmeasured games
  const unmeasuredGames = useMemo(() => {
    return games.filter((g) => g.sizeBytes == null || g.sizeBytes <= 0);
  }, [games]);

  // Top 10 largest space consumers
  const topHogs = useMemo(() => {
    return [...games]
      .filter((g) => (g.sizeBytes ?? 0) > 0)
      .sort((a, b) => gameTotalBytes(b) - gameTotalBytes(a))
      .slice(0, 8);
  }, [games]);

  // High-utilization drive games (>85% full)
  const fullDriveGames = useMemo(() => {
    const fullDrives = new Set<string>();
    for (const [label, usage] of driveUsage) {
      if (usage.total > 0 && usage.available / usage.total < 0.15) {
        fullDrives.add(label);
      }
    }
    if (fullDrives.size === 0) return [];
    return games
      .filter((g) => g.sizeRootPath && fullDrives.has(driveOf(g.sizeRootPath)))
      .sort((a, b) => gameTotalBytes(b) - gameTotalBytes(a))
      .slice(0, 6);
  }, [games, driveUsage]);

  // Handle re-linking a broken path
  const handleRelinkFolder = useCallback(
    async (game: Game) => {
      try {
        const picked = await open({
          directory: true,
          multiple: false,
          title: t("storageRow.relinkFolder"),
        });
        if (!picked || typeof picked !== "string") return;

        setDetectingId(game.id);
        const result = await invoke<{ sizeBytes: number; rootPath: string }>(
          "detect_game_size",
          { exePath: game.path, gameName: game.name, rootOverride: picked }
        );
        updateGame(game.id, {
          sizeBytes: result.sizeBytes,
          sizeRootPath: result.rootPath,
          sizeDetectedAt: new Date().toISOString(),
        });
        onRefreshStale();
        showToast(
          t("storageRow.detectedSize", { size: formatSize(result.sizeBytes, unit), name: game.name }),
          "success"
        );
      } catch (err) {
        showToast(t("storageRow.readError", { error: String(err) }), "error");
      } finally {
        setDetectingId(null);
      }
    },
    [updateGame, onRefreshStale, showToast, t, unit]
  );

  // Clear dead reference
  const handleClearDeadPath = useCallback(
    (game: Game) => {
      updateGame(game.id, {
        sizeBytes: undefined,
        sizeRootPath: undefined,
        sizeDetectedAt: undefined,
      });
      onRefreshStale();
      showToast(t("storageRow.clearedSize", { name: game.name }), "info");
    },
    [updateGame, onRefreshStale, showToast, t]
  );

  // Run Unmeasured Games Wizard
  const handleRunWizard = useCallback(async () => {
    const targets = unmeasuredGames.filter((g) => g.path && g.path.trim() !== "");
    if (targets.length === 0) {
      showToast(t("storageHeader.noMeasurements"), "info");
      return;
    }

    setWizardRunning(true);
    setWizardDone(0);
    setWizardTotal(targets.length);

    let succeeded = 0;
    for (let i = 0; i < targets.length; i++) {
      const g = targets[i];
      try {
        const result = await invoke<{ sizeBytes: number; rootPath: string }>(
          "detect_game_size",
          { exePath: g.path, gameName: g.name, rootOverride: null }
        );
        updateGame(g.id, {
          sizeBytes: result.sizeBytes,
          sizeRootPath: result.rootPath,
          sizeDetectedAt: new Date().toISOString(),
        });
        succeeded++;
      } catch {
        // Continue with next game
      }
      setWizardDone(i + 1);
    }

    setWizardRunning(false);
    onRefreshStale();
    showToast(
      t("storageBulk.recalculated", { count: succeeded, plural: succeeded === 1 ? "" : "s", stopped: "" }),
      "success"
    );
  }, [unmeasuredGames, updateGame, onRefreshStale, showToast, t]);

  const maxHogBytes = topHogs.length > 0 ? gameTotalBytes(topHogs[0]) : 0;

  return (
    <div className="storage-cleanup-page">
      {/* ── Cleanup Hero Banner ──────────────────────────────────────── */}
      <div className="storage-cleanup-hero">
        <div className="storage-cleanup-hero-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
        </div>
        <div className="storage-cleanup-hero-text">
          <h2 className="storage-cleanup-hero-title">{t("storage.cleanup.title")}</h2>
          <p className="storage-cleanup-hero-desc">{t("storage.cleanup.subtitle")}</p>
        </div>
      </div>

      <div className="storage-cleanup-sections">
        {/* ── Section 1: Broken / Stale Paths ────────────────────────── */}
        <div className="storage-cleanup-card">
          <div className="storage-cleanup-card-header">
            <div className="storage-cleanup-card-title-group">
              <span className="storage-cleanup-card-icon storage-cleanup-card-icon--danger">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </span>
              <div>
                <h3 className="storage-cleanup-card-title">
                  {t("storage.cleanup.staleTitle", { count: staleGames.length })}
                </h3>
                <p className="storage-cleanup-card-subtitle">{t("storage.cleanup.staleDesc")}</p>
              </div>
            </div>
          </div>

          {staleGames.length === 0 ? (
            <div className="storage-cleanup-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <p>{t("storage.cleanup.allHealthy")}</p>
            </div>
          ) : (
            <ul className="storage-cleanup-stale-list">
              {staleGames.map((g) => (
                <li key={g.id} className="storage-cleanup-stale-item">
                  <div className="storage-cleanup-stale-info">
                    <span className="storage-cleanup-stale-name">{g.name}</span>
                    <span className="storage-cleanup-stale-path" title={g.sizeRootPath ?? ""}>
                      {g.sizeRootPath ?? g.path}
                    </span>
                  </div>
                  <div className="storage-cleanup-stale-actions">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleRelinkFolder(g)}
                      isLoading={detectingId === g.id}
                    >
                      {t("storage.cleanup.fixPath")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleClearDeadPath(g)}
                    >
                      {t("storage.cleanup.clearDeadPath")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── Section 2: Unmeasured Games Wizard ───────────────────────── */}
        {unmeasuredGames.length > 0 && (
          <div className="storage-cleanup-card">
            <div className="storage-cleanup-card-header">
              <div className="storage-cleanup-card-title-group">
                <span className="storage-cleanup-card-icon storage-cleanup-card-icon--warning">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </span>
                <div>
                  <h3 className="storage-cleanup-card-title">
                    {t("storage.cleanup.unmeasuredTitle", { count: unmeasuredGames.length })}
                  </h3>
                  <p className="storage-cleanup-card-subtitle">{t("storage.cleanup.unmeasuredDesc")}</p>
                </div>
              </div>
              {!wizardRunning ? (
                <Button variant="primary" onClick={handleRunWizard}>
                  {t("storage.cleanup.runWizard")}
                </Button>
              ) : (
                <div className="storage-wizard-progress">
                  <span>{`${wizardDone} / ${wizardTotal}`}</span>
                  <div className="storage-wizard-track">
                    <div
                      className="storage-wizard-fill"
                      style={{ width: `${(wizardDone / (wizardTotal || 1)) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Section 3: Top Storage Consumers (Space Hogs) ──────────── */}
        {topHogs.length > 0 && (
          <div className="storage-cleanup-card">
            <div className="storage-cleanup-card-header">
              <div className="storage-cleanup-card-title-group">
                <span className="storage-cleanup-card-icon storage-cleanup-card-icon--primary">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                </span>
                <div>
                  <h3 className="storage-cleanup-card-title">{t("storage.cleanup.topHogsTitle")}</h3>
                  <p className="storage-cleanup-card-subtitle">{t("storage.cleanup.topHogsDesc")}</p>
                </div>
              </div>
            </div>

            <div className="storage-hogs-list">
              {topHogs.map((g, index) => {
                const b = gameTotalBytes(g);
                const pctOfTotal = totalLibBytes > 0 ? Math.round((b / totalLibBytes) * 100) : 0;
                const pctOfMax = maxHogBytes > 0 ? (b / maxHogBytes) * 100 : 0;

                return (
                  <div key={g.id} className="storage-hog-row">
                    <span className="storage-hog-rank">{`#${index + 1}`}</span>
                    <div className="storage-hog-meta">
                      <div className="storage-hog-headline">
                        <span className="storage-hog-name" title={g.name}>
                          {g.name}
                        </span>
                        <span className="storage-hog-size">{formatSize(b, unit)}</span>
                      </div>
                      <div className="storage-hog-bar-track">
                        <div
                          className="storage-hog-bar-fill"
                          style={{ width: `${pctOfMax}%` }}
                        />
                      </div>
                      <div className="storage-hog-subline">
                        <span>{g.platform || "PC"}</span>
                        <span>{t("storage.cleanup.shareOfLibrary", { pct: pctOfTotal })}</span>
                        {g.sizeRootPath && <span>{driveOf(g.sizeRootPath)}</span>}
                      </div>
                    </div>
                    <div className="storage-hog-actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onOpenFolder(g)}
                        title={t("downloadRow.openFolder")}
                      >
                        {t("downloadRow.openFolder")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onMoveGame(g)}
                        title={t("storagePage.moveInstall")}
                      >
                        {t("storage.move")}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => onUninstallGame(g)}
                        title={t("storage.uninstall")}
                      >
                        {t("storage.uninstall")}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Section 4: Relocation Suggestions ───────────────────────── */}
        {fullDriveGames.length > 0 && (
          <div className="storage-cleanup-card">
            <div className="storage-cleanup-card-header">
              <div className="storage-cleanup-card-title-group">
                <span className="storage-cleanup-card-icon storage-cleanup-card-icon--info">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7h13l-3-3" />
                    <path d="M21 17H8l3 3" />
                  </svg>
                </span>
                <div>
                  <h3 className="storage-cleanup-card-title">{t("storage.cleanup.relocationTitle")}</h3>
                  <p className="storage-cleanup-card-subtitle">{t("storage.cleanup.relocationDesc")}</p>
                </div>
              </div>
            </div>

            <ul className="storage-cleanup-stale-list">
              {fullDriveGames.map((g) => (
                <li key={g.id} className="storage-cleanup-stale-item">
                  <div className="storage-cleanup-stale-info">
                    <span className="storage-cleanup-stale-name">{g.name}</span>
                    <span className="storage-cleanup-stale-path">
                      {`${driveOf(g.sizeRootPath)} · ${formatSize(gameTotalBytes(g), unit)}`}
                    </span>
                  </div>
                  <div className="storage-cleanup-stale-actions">
                    <Button variant="secondary" size="sm" onClick={() => onMoveGame(g)}>
                      {t("storagePage.moveInstall")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
