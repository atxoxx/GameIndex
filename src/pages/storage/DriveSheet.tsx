import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, FolderOpen, MoveRight, RefreshCw, X } from "lucide-react";
import type { Game } from "../../types/game";
import { formatSize, gameDisplayName } from "../../types/game";
import { Button } from "../../components/ui";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useLanguage } from "../../context/LanguageContext";
import type { DriveUsage } from "./useDriveUsage";
import { gameTotalBytes } from "./utils";
import { formatRelativeDay } from "./utils";
import { LOW_SPACE_PCT } from "./recommendations";

interface Props {
  drive: string;
  games: Game[];
  usage?: DriveUsage;
  rootPath?: string;
  onClose: () => void;
  onOpenFolder: (path: string) => void;
  onSelectGame: (game: Game) => void;
  onMove: (games: Game[]) => void;
  onRemeasure: () => void;
  remeasuring?: boolean;
}

const MAX_LISTED = 40;

/**
 * DriveSheet — the drill-down the rail's chevron opens.
 *
 * A right-hand sheet rather than a route: the table stays exactly where it
 * was, and closing returns the user to the same scroll position.
 */
export function DriveSheet({
  drive,
  games,
  usage,
  rootPath,
  onClose,
  onOpenFolder,
  onSelectGame,
  onMove,
  onRemeasure,
  remeasuring = false,
}: Props) {
  const { t, language } = useLanguage();
  const { unit } = useSizeUnit();
  const panelRef = useRef<HTMLDivElement | null>(null);

  const sorted = useMemo(
    () => [...games].sort((a, b) => gameTotalBytes(b) - gameTotalBytes(a)),
    [games],
  );
  const libraryBytes = useMemo(
    () => games.reduce((sum, game) => sum + gameTotalBytes(game), 0),
    [games],
  );
  const freePct = usage && usage.total > 0 ? (usage.available / usage.total) * 100 : null;
  const usedPct = freePct == null ? null : 100 - freePct;
  const libraryPct = usage && usage.total > 0 ? Math.min(100, (libraryBytes / usage.total) * 100) : null;
  const lowSpace = freePct != null && freePct < LOW_SPACE_PCT;

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      // Keep focus inside the sheet while it is open.
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  return createPortal(
    <div className="drive-sheet__layer">
      <button
        type="button"
        className="drive-sheet__backdrop"
        onClick={onClose}
        aria-label={t("common.close")}
        tabIndex={-1}
      />
      <div
        className="drive-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t("storage.sheet.aria", { drive })}
        ref={panelRef}
        tabIndex={-1}
      >
        <header className="drive-sheet__head">
          <div className="drive-sheet__identity">
            <span className="drive-sheet__letter">{drive}</span>
            <div className="drive-sheet__titles">
              <h2 className="drive-sheet__title">{t("storage.sheet.title")}</h2>
              <p className="drive-sheet__subtitle">
                {t("storage.gamesCount", { count: games.length, plural: games.length === 1 ? "" : "s" })}
                {libraryPct != null && ` · ${Math.round(libraryPct)}% ${t("storage.sheet.ofDrive")}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="drive-sheet__close"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="drive-sheet__body">
          <section className={`drive-sheet__capacity${lowSpace ? " is-low" : ""}`}>
            <div className="drive-sheet__figures">
              <div className="drive-sheet__figure">
                <span className="drive-sheet__figure-value">{formatSize(libraryBytes, unit)}</span>
                <span className="drive-sheet__figure-label">{t("storage.drive.library")}</span>
              </div>
              {usage && usage.total > 0 && (
                <>
                  <div className="drive-sheet__figure">
                    <span className="drive-sheet__figure-value">{formatSize(usage.available, unit)}</span>
                    <span className="drive-sheet__figure-label">{t("storage.sheet.free")}</span>
                  </div>
                  <div className="drive-sheet__figure">
                    <span className="drive-sheet__figure-value">{formatSize(usage.total, unit)}</span>
                    <span className="drive-sheet__figure-label">{t("storage.sheet.capacity")}</span>
                  </div>
                </>
              )}
            </div>

            {usage && usage.total > 0 && (
              <>
                <div className="drive-sheet__bar">
                  <span
                    className="drive-sheet__seg drive-sheet__seg--library"
                    style={{ width: `${libraryPct?.toFixed(1)}%` }}
                  />
                  <span
                    className="drive-sheet__seg drive-sheet__seg--other"
                    style={{
                      width: `${Math.max(0, (usedPct ?? 0) - (libraryPct ?? 0)).toFixed(1)}%`,
                    }}
                  />
                </div>
                <div className="drive-sheet__legend">
                  <span className="drive-sheet__legend-item">
                    <i className="drive-sheet__dot drive-sheet__dot--library" aria-hidden="true" />
                    {t("storage.sheet.legendLibrary", { pct: Math.round(libraryPct ?? 0) })}
                  </span>
                  <span className="drive-sheet__legend-item">
                    <i className="drive-sheet__dot drive-sheet__dot--other" aria-hidden="true" />
                    {t("storage.sheet.legendOther", { pct: Math.round(Math.max(0, (usedPct ?? 0) - (libraryPct ?? 0))) })}
                  </span>
                  <span className="drive-sheet__legend-item">
                    <i className="drive-sheet__dot drive-sheet__dot--free" aria-hidden="true" />
                    {t("storage.sheet.legendFree", { pct: Math.round(freePct ?? 0) })}
                  </span>
                </div>
                {lowSpace && (
                  <p className="drive-sheet__warning">
                    <AlertTriangle aria-hidden="true" />
                    {t("storage.drive.lowSpaceWarning")}
                  </p>
                )}
              </>
            )}
          </section>

          <section className="drive-sheet__list-section">
            <h3 className="drive-sheet__list-title">{t("storage.sheet.largest")}</h3>
            {sorted.length === 0 ? (
              <p className="drive-sheet__empty">{t("storage.emptyDrive", { drive })}</p>
            ) : (
              <ul className="drive-sheet__list">
                {sorted.slice(0, MAX_LISTED).map((game) => {
                  const bytes = gameTotalBytes(game);
                  const share = libraryBytes > 0 ? (bytes / libraryBytes) * 100 : 0;
                  const art = game.coverArtUrl || game.iconUrl;
                  return (
                    <li key={game.id}>
                      <button
                        type="button"
                        className="drive-sheet__row"
                        onClick={() => {
                          onSelectGame(game);
                          onClose();
                        }}
                      >
                        <span className="drive-sheet__thumb">
                          {art ? (
                            <img src={art} alt="" loading="lazy" />
                          ) : (
                            <span className="drive-sheet__thumb-letter">
                              {(gameDisplayName(game)[0] ?? "?").toUpperCase()}
                            </span>
                          )}
                        </span>
                        <span className="drive-sheet__row-main">
                          <span className="drive-sheet__row-name">{gameDisplayName(game)}</span>
                          <span className="drive-sheet__row-meta">
                            <span className="drive-sheet__row-bar">
                              <span style={{ width: `${share.toFixed(1)}%` }} />
                            </span>
                            <span>
                              {game.lastPlayed
                                ? formatRelativeDay(
                                    game.lastPlayed,
                                    t("storage.sheet.neverPlayed"),
                                    Date.now(),
                                    language,
                                  )
                                : t("storage.sheet.neverPlayed")}
                            </span>
                          </span>
                        </span>
                        <span className="drive-sheet__row-size">
                          {bytes > 0 ? formatSize(bytes, unit) : "—"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {sorted.length > MAX_LISTED && (
              <p className="drive-sheet__more">
                {t("storage.sheet.andMore", { count: sorted.length - MAX_LISTED })}
              </p>
            )}
          </section>
        </div>

        <footer className="drive-sheet__foot">
          {rootPath && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenFolder(rootPath)}
              leftIcon={<FolderOpen />}
            >
              {t("storage.sheet.openDrive")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemeasure}
            isLoading={remeasuring}
            leftIcon={<RefreshCw />}
          >
            {t("storage.sheet.remeasure")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onMove(games)}
            disabled={games.length === 0}
            leftIcon={<MoveRight />}
          >
            {t("storage.move")}
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
