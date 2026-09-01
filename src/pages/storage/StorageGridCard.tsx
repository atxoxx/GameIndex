import { useState, memo } from "react";
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
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  onSizeUpdated?: () => void;
  onOpenFolder?: () => void;
  onMove?: () => void;
  onUninstall?: () => void;
  onLaunch?: () => void;
}

function StorageGridCardBase({
  game,
  maxBytes = 0,
  stale = false,
  density = "cozy",
  selectMode = false,
  selected = false,
  onToggleSelect,
  onSizeUpdated,
  onOpenFolder,
  onMove,
  onUninstall,
  onLaunch,
}: Props) {
  const { updateGame } = useGames();
  const { showToast } = useToast();
  const { t } = useLanguage();
  const { unit } = useSizeUnit();
  const [detecting, setDetecting] = useState(false);
  const [hovered, setHovered] = useState(false);

  const { displayUrl, staticPosterUrl, animatedPosterUrl, handleError } = useGameCardArt({
    game,
    isHovered: hovered,
  });

  const total = gameTotalBytes(game);
  const hasMods = (game.modsSizeBytes ?? 0) > 0;
  const drive = game.sizeRootPath ? driveOf(game.sizeRootPath) : null;
  const pctOfMax = maxBytes > 0 && total > 0 ? Math.min(100, (total / maxBytes) * 100) : 0;

  async function handleDetect(e?: React.MouseEvent) {
    e?.stopPropagation();
    if (detecting) return;
    setDetecting(true);
    try {
      let override: string | null = null;
      if (!game.path || game.path.trim() === "") {
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
      const result = await invoke<{ sizeBytes: number; rootPath: string }>("detect_game_size", {
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

  return (
    <div
      className={`storage-grid-card storage-grid-card--${density} ${
        stale ? "storage-grid-card--stale" : ""
      } ${selected ? "storage-grid-card--selected" : ""}`}
      onClick={() => {
        if (selectMode) onToggleSelect?.();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Selection Checkbox */}
      {selectMode && (
        <label
          className="storage-grid-card-select"
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

      {/* Cover Image + Overlay */}
      <div className="storage-grid-card-media">
        {(staticPosterUrl || displayUrl) ? (
          <>
            <img
              src={staticPosterUrl || displayUrl!}
              alt=""
              className="storage-grid-card-img storage-grid-card-img-static"
              loading="lazy"
              decoding="async"
              onError={handleError}
            />
            {animatedPosterUrl && (
              <img
                src={animatedPosterUrl}
                alt=""
                aria-hidden="true"
                className={`storage-grid-card-img storage-grid-card-img-animated${hovered ? " is-active" : ""}`}
                decoding="async"
                onError={handleError}
              />
            )}
          </>
        ) : (
          <div className="storage-grid-card-placeholder">
            <span className="storage-grid-card-letter">{game.name.charAt(0)}</span>
          </div>
        )}

        {/* Badges on cover */}
        <div className="storage-grid-card-badges">
          {drive && drive !== "Unknown" && (
            <span className="storage-grid-badge storage-grid-badge--drive">{drive}</span>
          )}
          {game.platform && (
            <span className="storage-grid-badge storage-grid-badge--platform">{game.platform}</span>
          )}
          {stale && (
            <span className="storage-grid-badge storage-grid-badge--stale">{t("storage.stale")}</span>
          )}
        </div>

        {/* Hover Action Overlay */}
        <div className="storage-grid-card-overlay">
          {onLaunch && (
            <button
              type="button"
              className="storage-grid-action-btn storage-grid-action-btn--primary"
              onClick={(e) => {
                e.stopPropagation();
                onLaunch();
              }}
              title={t("storage.row.play")}
            >
              <svg viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </button>
          )}

          <button
            type="button"
            className="storage-grid-action-btn"
            onClick={(e) => {
              e.stopPropagation();
              onOpenFolder?.();
            }}
            title={t("downloadRow.openFolder")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
          </button>

          <button
            type="button"
            className="storage-grid-action-btn"
            onClick={handleDetect}
            title={t("edit.autoDetect")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" />
            </svg>
          </button>

          {onMove && (game.sizeRootPath || game.path) && (
            <button
              type="button"
              className="storage-grid-action-btn"
              onClick={(e) => {
                e.stopPropagation();
                onMove();
              }}
              title={t("storagePage.moveInstall")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7h13l-3-3" />
                <path d="M21 17H8l3 3" />
              </svg>
            </button>
          )}

          {onUninstall && (
            <button
              type="button"
              className="storage-grid-action-btn storage-grid-action-btn--danger"
              onClick={(e) => {
                e.stopPropagation();
                onUninstall();
              }}
              title={t("storage.uninstall")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          )}
        </div>

        {/* Relative size progress line across bottom of card image */}
        {pctOfMax > 0 && (
          <div className="storage-grid-card-sizebar" title={`${pctOfMax.toFixed(0)}% of largest game`}>
            <div
              className="storage-grid-card-sizebar-fill"
              style={{ width: `${pctOfMax}%` }}
            />
          </div>
        )}
      </div>

      {/* Card Info */}
      <div className="storage-grid-card-content">
        <h3 className="storage-grid-card-title" title={game.name}>
          {game.name}
        </h3>

        <div className="storage-grid-card-size-row">
          {total > 0 ? (
            <div className="storage-grid-card-size-info">
              {hasMods && (game.sizeBytes ?? 0) > 0 ? (
                <div className="storage-grid-card-size-equation">
                  <span className="storage-grid-card-size-parts">
                    {formatSize(game.sizeBytes ?? 0, unit)} + {formatSize(game.modsSizeBytes ?? 0, unit)} =
                  </span>
                  <span className="storage-grid-card-size-val">
                    {formatSize(total, unit)}
                  </span>
                </div>
              ) : (
                <span className="storage-grid-card-size-val">
                  {formatSize(total, unit)}
                </span>
              )}
            </div>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              className="storage-grid-card-measure-btn"
              onClick={handleDetect}
              isLoading={detecting}
            >
              {t("storageRow.setSize")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export const StorageGridCard = memo(StorageGridCardBase, (prev, next) => {
  return (
    prev.game === next.game &&
    prev.maxBytes === next.maxBytes &&
    prev.stale === next.stale &&
    prev.density === next.density &&
    prev.selectMode === next.selectMode &&
    prev.selected === next.selected
  );
});
