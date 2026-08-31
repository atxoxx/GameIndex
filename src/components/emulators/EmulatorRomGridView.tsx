import { useMemo, memo } from "react";
import { useLanguage } from "../../context/LanguageContext";
import type { Game } from "../../types/game";
import { formatBytesShort } from "../../types/download";

interface RomGridViewProps {
  games: Game[];
  selectedGameIds: Set<string>;
  runningGameIds: string[];
  accentColor: string;
  onToggleSelect: (id: string) => void;
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

function EmulatorRomGridViewBase({
  games,
  selectedGameIds,
  runningGameIds,
  accentColor,
  onToggleSelect,
  onLaunch,
  onOpenLocation,
  onRename,
  onDelete,
  onInspect,
}: RomGridViewProps) {
  const { t } = useLanguage();
  const runningSet = useMemo(() => new Set(runningGameIds), [runningGameIds]);

  return (
    <div className="emu-rom-grid">
      {games.map((g) => {
        const isSelected = selectedGameIds.has(g.id);
        const isRunning = runningSet.has(g.id);
        const cover = g.coverArtUrl || g.iconUrl;

        return (
          <div
            key={g.id}
            className={`emu-rom-card${isSelected ? " is-selected" : ""}${
              isRunning ? " is-running" : ""
            }`}
            style={{ ["--emu-accent" as string]: accentColor }}
          >
            {/* Top Selection Checkbox & Running Badge */}
            <div className="emu-rom-card-topbar">
              <label className="emu-rom-card-check" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleSelect(g.id)}
                  aria-label={t("emulators.games.selectOne", { name: g.name })}
                />
              </label>
              {isRunning && (
                <span className="emu-rom-running-pill">
                  <span className="emu-running-dot" />
                  {t("game.running")}
                </span>
              )}
            </div>

            {/* Media / Artwork Cover with Launch Overlay */}
            <div
              className="emu-rom-card-cover-wrap"
              onClick={() => onInspect(g)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onInspect(g);
                }
              }}
            >
              {cover ? (
                <img
                  src={cover}
                  alt={g.name}
                  className="emu-rom-card-cover-img"
                  loading="lazy"
                />
              ) : (
                <div className="emu-rom-card-cover-fallback">
                  <span className="emu-rom-fallback-glyph">🎮</span>
                  <span className="emu-rom-fallback-platform">{g.platform}</span>
                </div>
              )}

              {/* Hover Launch Trigger */}
              <div className="emu-rom-card-overlay">
                <button
                  type="button"
                  className="emu-rom-play-btn"
                  title={t("emulators.games.launch")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onLaunch(g);
                  }}
                  disabled={isRunning}
                >
                  <svg {...ICON}>
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Card Metadata Details */}
            <div className="emu-rom-card-body">
              <div className="emu-rom-card-title-row">
                <h4
                  className="emu-rom-card-title"
                  title={g.name}
                  onClick={() => onInspect(g)}
                >
                  {g.name}
                </h4>
              </div>

              <div className="emu-rom-card-meta">
                <span className="emu-rom-card-size">
                  {g.sizeBytes ? formatBytesShort(g.sizeBytes) : "—"}
                  {g.modsSizeBytes ? (
                    <span className="emu-game-mods" title={t("emulators.games.hasMods")}>
                      {" +"}
                      {formatBytesShort(g.modsSizeBytes)}
                    </span>
                  ) : null}
                </span>

                {g.playTime && g.playTime !== "0h" && (
                  <span className="emu-rom-card-playtime">
                    <svg {...ICON}>
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    {g.playTime}
                  </span>
                )}
              </div>

              {/* Card Footer Quick Actions */}
              <div className="emu-rom-card-actions">
                <button
                  type="button"
                  className="emu-icon-btn"
                  title={t("emulators.games.openLocation")}
                  aria-label={t("emulators.games.openLocation")}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (g.romPath) onOpenLocation(g.romPath);
                  }}
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
                  onClick={(e) => {
                    e.stopPropagation();
                    onRename(g);
                  }}
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
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(g);
                  }}
                >
                  <svg {...ICON}>
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default memo(EmulatorRomGridViewBase);
