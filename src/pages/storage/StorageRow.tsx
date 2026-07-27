import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useGames } from "../../context/GameContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { formatSize, type Game } from "../../types/game";
import { gameTotalBytes } from "./utils";
import { Button } from "../../components/ui";

interface Props {
  game: Game;
  /** When true, the row's `sizeRootPath` no longer resolves on disk.
   *  The row renders a stale indicator + a "Re-link" CTA in its
   *  expanded panel. */
  stale?: boolean;
  /** View density from the shared DensityContext. */
  density?: string;
  /** Fired after the row's sizeRootPath/sizeBytes update successfully.
   *  The StoragePage orchestrator uses this to refresh the per-row
   *  staleness check (the new path may or may not exist yet). */
  onSizeUpdated?: () => void;
  /** Reveal the game's measured folder in the OS file manager. The
   *  StoragePage owns the `invoke("open_folder", ...)` call (and toast
   *  surfacing) so a single failure path is shared across every row. */
  onOpenFolder?: () => void;
  /** Selection mode: renders a checkbox in the row summary and switches
   *  the expanded action set to include management actions. */
  selectMode?: boolean;
  /** Whether this row is currently selected (only meaningful in selectMode). */
  selected?: boolean;
  /** Toggle this row's selection. */
  onToggleSelect?: () => void;
  /** Open the move/relocate dialog for this single game. */
  onMove?: () => void;
  /** Open the uninstall confirmation for this single game. */
  onUninstall?: () => void;
}

interface SizeDetectionResult {
  sizeBytes: number;
  rootPath: string;
}

/** Phase-5 Storage row.
 *
 *  Collapsed layout: [name | platform | size / Set size pill | last detected | chevron]
 *  Expanded panel:  [absolute path · raw bytes · detected-at · Auto-detect · Clear]
 *
 *  Tauri command convention from earlier work -- args are camelCase on
 *  the JS side (`exePath`, `gameName`, `rootOverride`) and map to the
 *  snake_case Rust parameters via Tauri's default rename behavior. */
export function StorageRow({ game, stale = false, density = "cozy", onSizeUpdated, onOpenFolder, selectMode = false, selected = false, onToggleSelect, onMove, onUninstall }: Props) {
  const { updateGame } = useGames();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { t } = useLanguage();
  const { unit } = useSizeUnit();
  const [expanded, setExpanded] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const hasSize = game.sizeBytes != null && game.sizeBytes > 0;
  const hasMods = game.modsSizeBytes != null && game.modsSizeBytes > 0;
  const isSized = hasSize;
  const total = gameTotalBytes(game);

  async function detect(folderOverride?: string) {
    if (detecting) return;
    setDetecting(true);
    try {
      let override = folderOverride;
      if (!override) {
        const picked = await open({
          directory: true,
          multiple: false,
          title: t("edit.selectFolder"),
        });
        if (!picked) return;
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
      console.error("detect_game_size failed", err);
      showToast(t("storageRow.readError", { error: String(err) }), "error");
    } finally {
      setDetecting(false);
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
      className={`storage__row density-${density}${expanded ? " storage__row--expanded" : ""}${stale ? " storage__row--stale" : ""}${selected ? " storage__row--selected" : ""}`}
      data-game-id={game.id}
    >
      {/* Collapsed row summary */}
      <div
        role="button"
        tabIndex={0}
        className={`storage__row-summary${selectMode ? " storage__row-summary--select" : ""}`}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          // Only react when the row summary itself (or a non-button
          // child like the name/chevron span) holds focus. Without
          // this guard, pressing Enter/Space while focus is on the
          // Set-size pill would bubble up here, preventDefault the
          // pill click, and silently toggle expand instead.
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        aria-expanded={expanded}
      >
        {/* Selection checkbox (only in select mode) */}
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
        {/* Game cover thumbnail */}
        <div className="storage__row-thumb">
          {game.coverArtUrl || game.iconUrl ? (
            <img src={game.coverArtUrl || game.iconUrl} alt="" loading="lazy" />
          ) : (
            <span className="storage__row-thumb-placeholder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </span>
          )}
        </div>
        <span className="storage__row-name" title={game.name}>
          {game.name}
          {stale && (
            <span className="storage__stale-badge">{t("storage.stale")}</span>
          )}
        </span>
        <span className="storage__row-platform">
          {game.platform || t("splash.unknown")}
        </span>
        {total > 0 ? (
          <span className="storage__row-size">
            <span className="storage__row-size-game">
              {formatSize(game.sizeBytes ?? 0, unit)}
            </span>
            {hasMods && (
              <>
                <span className="storage__row-size-mods" title={t("storageRow.mods.label")}>
                  {" + "}
                  {formatSize(game.modsSizeBytes ?? 0, unit)}
                </span>
                <span className="storage__row-size-total">
                  {" = "}
                  {formatSize(total, unit)}
                </span>
              </>
            )}
          </span>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              detect();
            }}
            title={t("storageRow.pickFolder")}
            style={{ padding: "2px 8px", fontSize: "11px", height: "auto" }}
          >
            {t("storageRow.setSize")}
          </Button>
        )}
        <span
          className={`storage__row-detected${stale ? " storage__row-detected--stale" : ""}`}
          title={
            stale
              ? t("storageRow.lastSeenTitle", { time: formatTimestamp(game.sizeDetectedAt, true, t("editExtras.notSet")) })
              : game.sizeDetectedAt ?? ""
          }
        >
          {stale
            ? t("storageRow.lastSeen", { time: formatTimestamp(game.sizeDetectedAt, false, t("editExtras.notSet")) })
            : formatTimestamp(game.sizeDetectedAt, false, t("editExtras.notSet"))}
        </span>
        <span
          className={`storage__row-chevron${expanded ? " storage__row-chevron--open" : ""}`}
          aria-hidden="true"
        >
          {"\u25BE"}
        </span>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div
          className="storage__row-panel"
          role="region"
          aria-label={t("storageRow.detailsAria", { name: game.name })}
        >
          <div className="storage__row-path">
            <span className="storage__row-path-label">{t("storagePage.path")}</span>
            <span className="storage__row-path-value" title={game.sizeRootPath ?? ""}>
              {game.sizeRootPath ?? game.path ?? "—"}
            </span>
          </div>
          <div className="storage__row-meta">
            {isSized && (
              <>
                <span>
                  <span className="storage__row-meta-label">{t("storageRow.game")}</span>
                  {game.sizeBytes!.toLocaleString()}
                </span>
                <span>
                  <span className="storage__row-meta-label">{t("storagePage.detected")}</span>
                  {formatTimestamp(game.sizeDetectedAt, true, t("editExtras.notSet")) || "—"}
                </span>
              </>
            )}
            {!isSized && (
              <span className="storage__row-meta-empty">
                {t("storageRow.unsetHint")}
              </span>
            )}
          </div>

          {/* Mods subsection — separate footprint folded into the row total. */}
          <div className="storage__row-mods">
            <div className="storage__row-mods-head">
              <span className="storage__row-mods-title">{t("storageRow.mods.label")}</span>
              {hasMods ? (
                <span className="storage__row-mods-size">
                  {formatSize(game.modsSizeBytes ?? 0, unit)}
                </span>
              ) : (
                <span className="storage__row-mods-size storage__row-mods-size--empty">
                  {t("storageRow.mods.none")}
                </span>
              )}
            </div>
            {hasMods && game.modsFolder && (
              <div className="storage__row-mods-path" title={game.modsFolder}>
                {game.modsFolder}
              </div>
            )}
            <div className="storage__row-mods-actions">
              <Button
                variant="secondary"
                size="sm"
                onClick={manageMods}
                title={t("storageRow.mods.manage")}
              >
                {hasMods ? t("storageRow.mods.manage") : t("storageRow.mods.set")}
              </Button>
              {hasMods && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={openModsFolder}
                  title={t("storageRow.openFolder")}
                >
                  {t("downloadRow.openFolder")}
                </Button>
              )}
            </div>
          </div>
          <div className="storage__row-actions">
            <Button
              variant="primary"
              onClick={() => detect()}
              isLoading={detecting}
              title={
                stale
                  ? t("storageRow.relinkFolder")
                  : undefined
              }
            >
              {stale ? t("storageRow.relink") : t("edit.autoDetect")}
            </Button>
            {isSized && (
              <Button
                variant="ghost"
                onClick={clearSize}
                disabled={detecting}
              >
                {t("common.clear")}
              </Button>
            )}
            {isSized && (
              <Button
                variant="ghost"
                onClick={() => onOpenFolder?.()}
                disabled={detecting}
                title={t("storageRow.openFolder")}
              >
                {t("downloadRow.openFolder")}
              </Button>
            )}
            {onMove && game.sizeRootPath && (
              <Button
                variant="ghost"
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
                onClick={() => onUninstall()}
                disabled={detecting}
                title={t("storagePage.uninstallGame")}
              >
                {t("storage.uninstall")}
              </Button>
            )}
            <span className="storage__row-spacer" />
          </div>
        </div>
      )}
    </li>
  );
}

/** Short human timestamp for the "Last detected" column. Returns "Not set"
 *  when `iso` is undefined / null. Pass `verbose=true` for a longer
 *  date+time string used inside the expanded panel. */
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
