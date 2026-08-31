import { useMemo, memo } from "react";
import { useLanguage } from "../../context/LanguageContext";
import type { Game } from "../../types/game";
import { formatBytesShort } from "../../types/download";
import { Button } from "../ui";

interface RomTableViewProps {
  games: Game[];
  selectedGameIds: Set<string>;
  runningGameIds: string[];
  totalSizeBytes: number;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onLaunch: (game: Game) => void;
  onOpenLocation: (path: string) => void;
  onRename: (game: Game) => void;
  onDelete: (game: Game) => void;
  onInspect: (game: Game) => void;
}

const ICON = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function truncateMiddle(path: string, max = 60): string {
  if (path.length <= max) return path;
  const head = path.slice(0, max / 2 - 1);
  const tail = path.slice(path.length - (max / 2 - 1));
  return `${head}…${tail}`;
}

function EmulatorRomTableViewBase({
  games,
  selectedGameIds,
  runningGameIds,
  totalSizeBytes,
  onToggleSelect,
  onToggleSelectAll,
  onLaunch,
  onOpenLocation,
  onRename,
  onDelete,
  onInspect,
}: RomTableViewProps) {
  const { t } = useLanguage();
  const runningSet = useMemo(() => new Set(runningGameIds), [runningGameIds]);

  const isAllSelected = games.length > 0 && selectedGameIds.size === games.length;
  const isIndeterminate = selectedGameIds.size > 0 && selectedGameIds.size < games.length;

  return (
    <div className="emu-games-table" role="table" aria-label={t("emulators.detail.gamesTitle")}>
      <div className="emu-game-row emu-game-row-head" role="row">
        <span className="emu-game-check" role="columnheader">
          <input
            type="checkbox"
            checked={isAllSelected}
            ref={(el) => {
              if (el) el.indeterminate = isIndeterminate;
            }}
            onChange={onToggleSelectAll}
            aria-label={t("emulators.games.selectAll")}
          />
        </span>
        <span className="emu-game-icon-col" role="columnheader" />
        <span className="emu-game-main-col" role="columnheader">
          {t("emulators.name")}
        </span>
        <span className="emu-game-size-col" role="columnheader">
          {t("emulators.games.size")}
        </span>
        <span className="emu-game-actions-col" role="columnheader" />
        <span className="emu-game-launch-col" role="columnheader" />
      </div>

      {games.map((g) => {
        const isSelected = selectedGameIds.has(g.id);
        const isRunning = runningSet.has(g.id);
        const iconSrc = g.iconUrl || g.coverArtUrl;

        return (
          <div
            className={`emu-game-row${isSelected ? " is-selected" : ""}${
              isRunning ? " is-running" : ""
            }`}
            key={g.id}
            role="row"
          >
            <span className="emu-game-check" role="cell">
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => onToggleSelect(g.id)}
                aria-label={t("emulators.games.selectOne", { name: g.name })}
              />
            </span>

            <span
              className="emu-game-icon"
              role="cell"
              onClick={() => onInspect(g)}
              title={g.name}
            >
              {iconSrc ? (
                <img src={iconSrc} alt="" loading="lazy" />
              ) : (
                <span className="emu-game-icon-fallback">🎮</span>
              )}
            </span>

            <span className="emu-game-main" role="cell" onClick={() => onInspect(g)}>
              <div className="emu-game-name-line">
                <span className="emu-game-name" title={g.name}>
                  {g.name}
                </span>
                {isRunning && (
                  <span className="emu-rom-running-badge">
                    <span className="emu-running-dot" />
                    {t("game.running")}
                  </span>
                )}
              </div>
              <span className="emu-game-path" title={g.romPath}>
                {g.romPath ? truncateMiddle(g.romPath, 64) : t("emulators.games.noRomPath")}
              </span>
            </span>

            <span className="emu-game-size" role="cell">
              {g.sizeBytes ? formatBytesShort(g.sizeBytes) : "—"}
              {g.modsSizeBytes ? (
                <span className="emu-game-mods" title={t("emulators.games.hasMods")}>
                  {" +"}
                  {formatBytesShort(g.modsSizeBytes)}
                </span>
              ) : null}
            </span>

            <span className="emu-game-actions" role="cell">
              <button
                type="button"
                className="emu-icon-btn"
                title={t("emulators.games.openLocation")}
                aria-label={t("emulators.games.openLocation")}
                onClick={() => g.romPath && onOpenLocation(g.romPath)}
                disabled={!g.romPath}
              >
                <svg {...ICON}>
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
              </button>
              <button
                type="button"
                className="emu-icon-btn"
                title={t("emulators.games.rename")}
                aria-label={t("emulators.games.rename")}
                onClick={() => onRename(g)}
              >
                <svg {...ICON}>
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
              </button>
              <button
                type="button"
                className="emu-icon-btn emu-icon-btn--danger"
                title={t("emulators.games.deleteRom")}
                aria-label={t("emulators.games.deleteRom")}
                onClick={() => onDelete(g)}
              >
                <svg {...ICON}>
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                </svg>
              </button>
            </span>

            <Button
              variant="primary"
              size="sm"
              className="emu-game-launch"
              onClick={() => onLaunch(g)}
              disabled={isRunning}
            >
              {isRunning ? "…" : t("emulators.games.launch")}
            </Button>
          </div>
        );
      })}

      <div className="emu-games-footer">
        <span className="emu-games-footer-count">
          {t("emulators.detail.gamesCount", { count: games.length })}
        </span>
        <span className="emu-games-footer-size">
          {t("emulators.detail.totalSize")}: {formatBytesShort(totalSizeBytes)}
        </span>
      </div>
    </div>
  );
}

export default memo(EmulatorRomTableViewBase);
