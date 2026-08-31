import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useGames } from "../../context/GameContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { formatSize, type Game } from "../../types/game";
import { driveOf, gameTotalBytes } from "./utils";
import { Button } from "../../components/ui";
import { useGameCardArt } from "../../hooks/useGameCardArt";

interface Props {
  game: Game;
  maxBytes?: number;
  stale?: boolean;
  density?: string;
  onSizeUpdated?: () => void;
  onOpenFolder?: () => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onMove?: () => void;
  onUninstall?: () => void;
  onLaunch?: () => void;
}

interface SizeDetectionResult {
  sizeBytes: number;
  rootPath: string;
}

export function StorageRow({
  game,
  maxBytes = 0,
  stale = false,
  density = "cozy",
  onSizeUpdated,
  onOpenFolder,
  selectMode = false,
  selected = false,
  onToggleSelect,
  onMove,
  onUninstall,
  onLaunch,
}: Props) {
  const { updateGame } = useGames();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { t } = useLanguage();
  const { unit } = useSizeUnit();
  const [expanded, setExpanded] = useState(false);
  const [detecting, setDetecting] = useState(false);

  const { displayUrl, handleError } = useGameCardArt({
    game,
    isListOrSmall: true,
  });

  const hasSize = game.sizeBytes != null && game.sizeBytes > 0;
  const hasMods = (game.modsSizeBytes ?? 0) > 0;
  const total = gameTotalBytes(game);
  const drive = game.sizeRootPath ? driveOf(game.sizeRootPath) : null;
  const pctOfMax = maxBytes > 0 && total > 0 ? Math.min(100, (total / maxBytes) * 100) : 0;

  async function detect(folderOverride?: string, e?: React.MouseEvent) {
    e?.stopPropagation();
    if (detecting) return;
    setDetecting(true);
    try {
      let override = folderOverride;
      if (!override && (!game.path || game.path.trim() === "")) {
        const picked = await open({
          directory: true,
          multiple: false,
          title: t("edit.selectFolder"),
        });
        if (!picked || typeof picked !== "string") {
          setDetecting(false);
          return;
        }
        override = picked;
      }
      const result = await invoke<SizeDetectionResult>("detect_game_size", {
        exePath: game.path,
        gameName: game.name,
        rootOverride: override,
      });
      updateGame(game.id, {
        sizeBytes: result.sizeBytes,
        sizeRootPath: result.rootPath,
        sizeDetectedAt: new Date().toISOString(),
      });
      onSizeUpdated?.();
      showToast(
        t("storageRow.detectedSize", { size: formatSize(result.sizeBytes, unit), name: game.name }),
        "success"
      );
    } catch (err) {
      showToast(t("storageRow.readError", { error: String(err) }), "error");
    } finally {
      setDetecting(false);
    }
  }

  async function copyPath(path: string | undefined, label: string) {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      showToast(t("storage.row.pathCopied"), "success");
    } catch {
      showToast(`Could not copy ${label}`, "error");
    }
  }

  async function openModsFolder() {
    if (!game.modsFolder) return;
    try {
      await invoke("open_folder", { path: game.modsFolder });
    } catch (err) {
      showToast(t("storage.couldNotOpenFolder", { error: err }), "error");
    }
  }

  function manageMods() {
    navigate(`/library/${game.id}`);
  }

  function clearSize() {
    updateGame(game.id, {
      sizeBytes: undefined,
      sizeRootPath: undefined,
      sizeDetectedAt: undefined,
    });
    showToast(t("storageRow.clearedSize", { name: game.name }), "info");
  }

  return (
    <li
      className={`storage__row storage__row--${density} ${expanded ? "storage__row--expanded" : ""} ${
        stale ? "storage__row--stale" : ""
      } ${selected ? "storage__row--selected" : ""}`}
      data-game-id={game.id}
    >
      {/* ── Collapsed row summary ── */}
      <div
        role="button"
        tabIndex={0}
        className={`storage__row-summary ${selectMode ? "storage__row-summary--select" : ""}`}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        aria-expanded={expanded}
      >
        {/* Selection checkbox */}
        {selectMode && (
          <label
            className="storage__row-select"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect?.()}
              aria-label={t("storageRow.selectGame", { name: game.name })}
            />
          </label>
        )}

        {/* Thumbnail (in cozy / cinematic density) */}
        {density !== "compact" && (
          <div className="storage__row-thumb">
            {displayUrl ? (
              <img src={displayUrl} alt="" loading="lazy" onError={handleError} />
            ) : (
              <span className="storage__row-thumb-placeholder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </span>
            )}
          </div>
        )}

        {/* Game Name & Badges */}
        <div className="storage__row-name-col">
          <div className="storage__row-name-line">
            <span className="storage__row-name" title={game.name}>
              {game.name}
            </span>
            {drive && drive !== "Unknown" && (
              <span className="storage__row-drive-badge" title={drive}>
                {drive}
              </span>
            )}
            {stale && (
              <span className="storage__stale-badge">{t("storage.stale")}</span>
            )}
          </div>

          {/* Relative size progress line beneath the name */}
          {pctOfMax > 0 && (
            <div className="storage__row-footprint-bar" title={`${pctOfMax.toFixed(0)}% of largest game`}>
              <div
                className="storage__row-footprint-fill"
                style={{ width: `${pctOfMax}%` }}
              />
            </div>
          )}
        </div>

        {/* Platform tag */}
        <span className="storage__row-platform">
          {game.platform || t("splash.unknown")}
        </span>

        {/* Size cell */}
        {total > 0 ? (
          <div className="storage__row-size" title={game.sizeBytes != null ? game.sizeBytes.toLocaleString() : undefined}>
            {hasMods && (game.sizeBytes ?? 0) > 0 ? (
              <div className="storage__row-size-equation">
                <span className="storage__row-size-formula">
                  {formatSize(game.sizeBytes ?? 0, unit)} + {formatSize(game.modsSizeBytes ?? 0, unit)} =
                </span>
                <span className="storage__row-size-total">
                  {formatSize(total, unit)}
                </span>
              </div>
            ) : (
              <span className="storage__row-size-total">
                {formatSize(total, unit)}
              </span>
            )}
          </div>
        ) : (
          <div className="storage__row-size">
            <Button
              variant="secondary"
              size="sm"
              className="storage__set-size-pill"
              onClick={(e) => detect(undefined, e)}
              isLoading={detecting}
              title={t("storageRow.pickFolder")}
            >
              {t("storageRow.setSize")}
            </Button>
          </div>
        )}

        {/* Last detected timestamp */}
        <span
          className={`storage__row-detected ${stale ? "storage__row-detected--stale" : ""}`}
          title={game.sizeDetectedAt ?? ""}
        >
          {stale
            ? t("storageRow.lastSeen", { time: formatTimestamp(game.sizeDetectedAt, false, t("editExtras.notSet")) })
            : formatTimestamp(game.sizeDetectedAt, false, t("editExtras.notSet"))}
        </span>

        {/* Expand Chevron */}
        <span
          className={`storage__row-chevron ${expanded ? "storage__row-chevron--open" : ""}`}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </div>

      {/* ── Expanded panel ── */}
      {expanded && (
        <div
          className="storage__row-panel"
          role="region"
          aria-label={t("storageRow.detailsAria", { name: game.name })}
        >
          {/* Path section with 1-click copy */}
          <div className="storage__row-path-block">
            <span className="storage__row-path-label">{t("storagePage.path")}</span>
            <div className="storage__row-path-row">
              <span className="storage__row-path-value" title={game.sizeRootPath ?? game.path ?? ""}>
                {game.sizeRootPath ?? game.path ?? "—"}
              </span>
              {(game.sizeRootPath || game.path) && (
                <button
                  type="button"
                  className="storage__row-copy-btn"
                  onClick={() => copyPath(game.sizeRootPath || game.path, "Path")}
                  title={t("storage.row.copyPath")}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </button>
              )}
            </div>

            {stale && (
              <div className="storage__row-path-stale">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span>{t("storageRow.staleHint")}</span>
              </div>
            )}
          </div>

          {/* Metadata Grid */}
          <div className="storage__row-meta-grid">
            {hasSize && (
              <>
                <div className="storage__row-meta-item">
                  <span className="storage__row-meta-label">{t("storageRow.game")}</span>
                  <span className="storage__row-meta-value">{formatSize(game.sizeBytes ?? 0, unit)}</span>
                </div>
                {hasMods && (
                  <div className="storage__row-meta-item">
                    <span className="storage__row-meta-label">{t("storageRow.mods.label")}</span>
                    <span className="storage__row-meta-value">{formatSize(game.modsSizeBytes ?? 0, unit)}</span>
                  </div>
                )}
                <div className="storage__row-meta-item">
                  <span className="storage__row-meta-label">{t("storagePage.trackedSize")}</span>
                  <span className="storage__row-meta-value storage__row-meta-value--total">
                    {hasMods && (game.sizeBytes ?? 0) > 0
                      ? `${formatSize(game.sizeBytes ?? 0, unit)} + ${formatSize(game.modsSizeBytes ?? 0, unit)} = ${formatSize(total, unit)}`
                      : formatSize(total, unit)}
                  </span>
                </div>
                <div className="storage__row-meta-item">
                  <span className="storage__row-meta-label">{t("storagePage.detected")}</span>
                  <span className="storage__row-meta-value">
                    {formatTimestamp(game.sizeDetectedAt, true, t("editExtras.notSet")) || "—"}
                  </span>
                </div>
                {drive && (
                  <div className="storage__row-meta-item">
                    <span className="storage__row-meta-label">{t("storageRow.drive")}</span>
                    <span className="storage__row-meta-value">{drive}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Mods Subsection */}
          <div className="storage__row-mods-card">
            <div className="storage__row-mods-head">
              <span className="storage__row-mods-title">{t("storageRow.mods.label")}</span>
              <span className="storage__row-mods-size">
                {hasMods ? formatSize(game.modsSizeBytes ?? 0, unit) : t("storageRow.mods.none")}
              </span>
            </div>

            {hasMods && game.modsFolder && (
              <div className="storage__row-mods-path" title={game.modsFolder}>
                <span>{game.modsFolder}</span>
                <button
                  type="button"
                  className="storage__row-copy-btn"
                  onClick={() => copyPath(game.modsFolder, "Mods Path")}
                  title={t("storage.row.copyPath")}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </button>
              </div>
            )}

            <div className="storage__row-mods-actions">
              <Button variant="secondary" size="sm" onClick={manageMods}>
                {hasMods ? t("storageRow.mods.manage") : t("storageRow.mods.set")}
              </Button>
              {hasMods && (
                <Button variant="ghost" size="sm" onClick={openModsFolder}>
                  {t("downloadRow.openFolder")}
                </Button>
              )}
            </div>
          </div>

          {/* Row Actions Strip */}
          <div className="storage__row-actions">
            {onLaunch && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onLaunch}
                leftIcon={
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                }
              >
                {t("storage.row.play")}
              </Button>
            )}

            <Button
              variant="primary"
              size="sm"
              onClick={(e) => detect(undefined, e)}
              isLoading={detecting}
            >
              {stale ? t("storageRow.relink") : t("edit.autoDetect")}
            </Button>

            {hasSize && (
              <Button variant="ghost" size="sm" onClick={clearSize} disabled={detecting}>
                {t("common.clear")}
              </Button>
            )}

            {onOpenFolder && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenFolder()}
                disabled={detecting}
                title={t("storageRow.openFolder")}
              >
                {t("downloadRow.openFolder")}
              </Button>
            )}

            {onMove && (game.sizeRootPath || game.path) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onMove()}
                disabled={detecting}
                title={t("storagePage.moveInstall")}
              >
                {t("storageRow.move")}
              </Button>
            )}

            {onUninstall && (game.sizeRootPath || game.path) && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => onUninstall()}
                disabled={detecting}
                title={t("storagePage.uninstallGame")}
              >
                {t("storage.uninstall")}
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function formatTimestamp(
  iso: string | undefined | null,
  verbose = false,
  notSetLabel = "Not set"
): string {
  if (!iso) return notSetLabel;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return notSetLabel;
  const date = new Date(t);
  if (verbose) {
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
