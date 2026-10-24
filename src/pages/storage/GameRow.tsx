import { memo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ChevronDown,
  Copy,
  Eraser,
  FolderOpen,
  MoveRight,
  Play,
  RefreshCw,
  Trash2,
  Wrench,
} from "lucide-react";
import { useGames } from "../../context/GameContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useGameCardArt } from "../../hooks/useGameCardArt";
import { useContextMenu } from "../../hooks/useContextMenu";
import ContextMenu from "../../components/ui/ContextMenu";
import { Button } from "../../components/ui";
import { formatSize, gameDisplayName, type Game } from "../../types/game";
import {
  driveOf,
  formatRelativeDay,
  gameTotalBytes,
  type TableColumn,
} from "./utils";
import { useStorageMenuItems } from "./storageMenu";

export interface GameRowProps {
  game: Game;
  stale: boolean;
  maxBytes: number;
  columns: Set<TableColumn>;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onSizeUpdated: () => void;
  onOpenFolder: (game: Game) => void;
  onMove: (game: Game) => void;
  onUninstall: (game: Game) => void;
  onLaunch: (game: Game) => void;
}

interface SizeDetectionResult {
  sizeBytes: number;
  rootPath: string;
}

/**
 * One row of the games table.
 *
 * The visible row is a compact, sortable record; clicking it opens a detail row
 * with the install path, the mods block and every action that used to live in
 * the row body. Keeping actions out of the scannable line is what makes the
 * columns readable at speed.
 */
function GameRowBase({
  game,
  stale,
  maxBytes,
  columns,
  selectMode,
  selected,
  onToggleSelect,
  onSizeUpdated,
  onOpenFolder,
  onMove,
  onUninstall,
  onLaunch,
}: GameRowProps) {
  const { updateGame } = useGames();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { t, language } = useLanguage();
  const { unit } = useSizeUnit();
  const [expanded, setExpanded] = useState(false);
  const [detecting, setDetecting] = useState(false);

  const { displayUrl, handleError } = useGameCardArt({ game, isListOrSmall: true });

  const size = game.sizeBytes ?? 0;
  const mods = game.modsSizeBytes ?? 0;
  const total = gameTotalBytes(game);
  const hasSize = size > 0;
  const hasMods = mods > 0;
  const drive = game.sizeRootPath ? driveOf(game.sizeRootPath) : null;
  const pctOfMax = maxBytes > 0 && total > 0 ? Math.min(100, (total / maxBytes) * 100) : 0;
  const displayName = gameDisplayName(game);

  const colSpan = 3 + columns.size + (selectMode ? 1 : 0);

  async function detect(folderOverride?: string, event?: React.MouseEvent) {
    event?.stopPropagation();
    if (detecting) return;
    setDetecting(true);
    try {
      let override = folderOverride;
      if (!override && (!game.path || game.path.trim() === "") && game.steamAppId == null) {
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
        rootOverride: override ?? null,
        steamAppId: game.steamAppId ?? null,
      });
      updateGame(game.id, {
        sizeBytes: result.sizeBytes,
        sizeRootPath: result.rootPath,
        sizeDetectedAt: new Date().toISOString(),
      });
      onSizeUpdated();
      showToast(
        t("storageRow.detectedSize", {
          size: formatSize(result.sizeBytes, unit),
          name: displayName,
        }),
        "success",
      );
    } catch (err) {
      showToast(t("storageRow.readError", { error: String(err) }), "error");
    } finally {
      setDetecting(false);
    }
  }

  async function copyPath(path: string | undefined) {
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      showToast(t("storage.row.pathCopied"), "success");
    } catch {
      showToast(t("storageRow.copyFailed"), "error");
    }
  }

  function clearSize() {
    updateGame(game.id, {
      sizeBytes: undefined,
      sizeRootPath: undefined,
      sizeDetectedAt: undefined,
    });
    showToast(t("storageRow.clearedSize", { name: displayName }), "info");
    onSizeUpdated();
  }

  async function openModsFolder() {
    if (!game.modsFolder) return;
    try {
      await invoke("open_folder", { path: game.modsFolder });
    } catch (err) {
      showToast(t("storage.couldNotOpenFolder", { error: String(err) }), "error");
    }
  }

  const menu = useContextMenu();
  const menuItems = useStorageMenuItems({
    game,
    hasSize,
    hasModsFolder: hasMods,
    onLaunch: () => onLaunch(game),
    onOpenFolder: () => onOpenFolder(game),
    onDetect: () => {
      menu.close();
      void detect();
    },
    onClearSize: () => {
      menu.close();
      clearSize();
    },
    onCopyPath: () => {
      menu.close();
      void copyPath(game.sizeRootPath || game.path);
    },
    onManageMods: () => {
      menu.close();
      navigate(`/library/${game.id}`);
    },
    onMove: () => {
      menu.close();
      onMove(game);
    },
    onUninstall: game.sizeRootPath || game.path
      ? () => {
          menu.close();
          onUninstall(game);
        }
      : undefined,
  });

  return (
    <>
      <tr
        className={[
          "gt-row",
          expanded ? "is-expanded" : "",
          stale ? "is-stale" : "",
          selected ? "is-selected" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={() => setExpanded((value) => !value)}
        onContextMenu={(event) => menu.open(event)}
        data-game-id={game.id}
      >
        {selectMode && (
          <td className="gt-cell gt-cell--check">
            <label className="gt-check" onClick={(event) => event.stopPropagation()}>
              <input
                type="checkbox"
                checked={selected}
                onChange={onToggleSelect}
                aria-label={t("storageRow.selectGame", { name: displayName })}
              />
            </label>
          </td>
        )}

        <td className="gt-cell gt-cell--name">
          <span className="gt-art">
            {displayUrl ? (
              <img src={displayUrl} alt="" loading="lazy" onError={handleError} />
            ) : (
              <span className="gt-art__letter">{displayName[0]?.toUpperCase() ?? "?"}</span>
            )}
          </span>
          <span className="gt-name">
            <span className="gt-name__text" title={displayName}>
              {displayName}
            </span>
            {(stale || hasMods) && (
              <span className="gt-name__badges">
                {stale && <span className="gt-badge gt-badge--danger">{t("storage.stale")}</span>}
                {hasMods && <span className="gt-badge gt-badge--mods">{t("storageRow.mods.label")}</span>}
              </span>
            )}
          </span>
        </td>

        {columns.has("platform") && (
          <td className="gt-cell gt-cell--muted">{game.platform || t("splash.unknown")}</td>
        )}

        {columns.has("drive") && (
          <td className="gt-cell gt-cell--muted">
            {drive && drive !== "Unknown" ? <span className="gt-drive">{drive}</span> : "—"}
          </td>
        )}

        <td className="gt-cell gt-cell--size">
          {total > 0 ? (
            <>
              <span className="gt-size">{formatSize(total, unit)}</span>
              <span className="gt-sizebar" aria-hidden="true">
                <span style={{ width: `${pctOfMax.toFixed(1)}%` }} />
              </span>
            </>
          ) : (
            <button
              type="button"
              className="gt-measure"
              onClick={(event) => detect(undefined, event)}
              disabled={detecting}
            >
              {detecting ? t("storageRow.measuring") : t("storageRow.setSize")}
            </button>
          )}
        </td>

        {columns.has("mods") && (
          <td className={`gt-cell gt-cell--num${hasMods ? " gt-cell--accent" : " gt-cell--muted"}`}>
            {hasMods ? formatSize(mods, unit) : "—"}
          </td>
        )}

        {columns.has("lastPlayed") && (
          <td className={`gt-cell gt-cell--muted${game.lastPlayed ? "" : " gt-cell--faint"}`}>
            {formatRelativeDay(game.lastPlayed, t("storageRow.neverPlayed"), Date.now(), language)}
          </td>
        )}

        {columns.has("measuredAt") && (
          <td
            className={`gt-cell gt-cell--muted${stale ? " gt-cell--danger" : ""}`}
            title={game.sizeDetectedAt ?? undefined}
          >
            {formatRelativeDay(game.sizeDetectedAt, t("storageRow.neverMeasured"), Date.now(), language)}
          </td>
        )}

        <td className="gt-cell gt-cell--chev">
          <button
            type="button"
            className="gt-chevron"
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((value) => !value);
            }}
            aria-expanded={expanded}
            aria-label={t("storageRow.detailsAria", { name: displayName })}
          >
            <ChevronDown aria-hidden="true" />
          </button>
        </td>
      </tr>

      {expanded && (
        <tr className="gt-detail">
          <td colSpan={colSpan} className="gt-detail__cell">
            <div className="gt-detail__body">
              <div className="gt-detail__path">
                <span className="gt-detail__label">{t("storagePage.path")}</span>
                <code className="gt-detail__path-value" title={game.sizeRootPath ?? game.path ?? ""}>
                  {game.sizeRootPath ?? game.path ?? "—"}
                </code>
                {(game.sizeRootPath || game.path) && (
                  <button
                    type="button"
                    className="gt-detail__icon-btn"
                    onClick={() => copyPath(game.sizeRootPath || game.path)}
                    aria-label={t("storage.row.copyPath")}
                    title={t("storage.row.copyPath")}
                  >
                    <Copy aria-hidden="true" />
                  </button>
                )}
              </div>

              {stale && <p className="gt-detail__stale">{t("storageRow.staleHint")}</p>}

              <dl className="gt-detail__meta">
                {hasSize && (
                  <div>
                    <dt>{t("storageRow.game")}</dt>
                    <dd>{formatSize(size, unit)}</dd>
                  </div>
                )}
                {hasMods && (
                  <div>
                    <dt>{t("storageRow.mods.label")}</dt>
                    <dd>{formatSize(mods, unit)}</dd>
                  </div>
                )}
                {drive && (
                  <div>
                    <dt>{t("storageRow.drive")}</dt>
                    <dd>{drive}</dd>
                  </div>
                )}
              </dl>

              {hasMods && game.modsFolder && (
                <div className="gt-detail__mods">
                  <code title={game.modsFolder}>{game.modsFolder}</code>
                  <button type="button" className="gt-detail__icon-btn" onClick={openModsFolder}>
                    <FolderOpen aria-hidden="true" />
                    <span>{t("downloadRow.openFolder")}</span>
                  </button>
                </div>
              )}

              <div className="gt-detail__actions">
                <Button variant="secondary" size="sm" onClick={() => onLaunch(game)} leftIcon={<Play />}>
                  {t("storage.row.play")}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={(event) => detect(undefined, event)}
                  isLoading={detecting}
                  leftIcon={<RefreshCw />}
                >
                  {stale ? t("storageRow.relink") : t("edit.autoDetect")}
                </Button>
                {hasMods && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(`/library/${game.id}`)}
                    leftIcon={<Wrench />}
                  >
                    {t("storageRow.mods.manage")}
                  </Button>
                )}
                {hasSize && (
                  <Button variant="ghost" size="sm" onClick={clearSize} disabled={detecting} leftIcon={<Eraser />}>
                    {t("common.clear")}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => onOpenFolder(game)} leftIcon={<FolderOpen />}>
                  {t("downloadRow.openFolder")}
                </Button>
                {(game.sizeRootPath || game.path) && (
                  <Button variant="ghost" size="sm" onClick={() => onMove(game)} leftIcon={<MoveRight />}>
                    {t("storageRow.move")}
                  </Button>
                )}
                {(game.sizeRootPath || game.path) && (
                  <Button variant="danger" size="sm" onClick={() => onUninstall(game)} leftIcon={<Trash2 />}>
                    {t("storage.uninstall")}
                  </Button>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}

      {menu.state && (
        <ContextMenu
          x={menu.state.x}
          y={menu.state.y}
          items={menuItems}
          onClose={menu.close}
          ariaLabel={displayName}
          header={
            <>
              <span className="context-menu-title" title={displayName}>
                {displayName}
              </span>
              <span className="ctx-badge">{game.platform}</span>
            </>
          }
        />
      )}
    </>
  );
}

export const GameRow = memo(GameRowBase, (prev, next) => {
  return (
    prev.game === next.game &&
    prev.maxBytes === next.maxBytes &&
    prev.stale === next.stale &&
    prev.columns === next.columns &&
    prev.selectMode === next.selectMode &&
    prev.selected === next.selected
  );
});
