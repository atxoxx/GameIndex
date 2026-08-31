import { memo, useEffect, useRef, useState } from "react";
import { Badge } from "../ui";
import type { Game } from "../../types/game";
import { PLAY_STATUS_DETAILS } from "../../types/game";
import { useGames, NO_IGDB_MATCH_SOURCE } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { useSettings } from "../../context/SettingsContext";
import { useGameCardArt } from "../../hooks/useGameCardArt";
import { playLaunchSound } from "../../utils/soundEffects";

interface LibraryGameCardProps {
  game: Game;
  density: string;
  isRunning: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onLaunch?: (game: Game) => void;
  className?: string;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (game: Game) => void;
}

function formatRelativeTime(timestamp: number | undefined, t: (key: string, vars?: Record<string, unknown>) => string): string {
  if (!timestamp) return t("lib.rail.continue.never");
  const diffMs = Date.now() - timestamp;
  if (diffMs < 0) return t("lib.rail.continue.justNow");
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 24) return t("lib.rail.continue.hoursAgo", { n: Math.max(1, hours) });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("lib.rail.continue.daysAgo", { n: days });
  const weeks = Math.floor(days / 7);
  return t("lib.rail.continue.weeksAgo", { n: weeks });
}

function LibraryGameCardBase({
  game,
  density,
  isRunning,
  onClick,
  onContextMenu,
  onLaunch,
  className,
  selectable = false,
  selected = false,
  onToggleSelect,
}: LibraryGameCardProps) {
  const { enrichGameMetadata, launchGame } = useGames();
  const { t } = useLanguage();
  const { showCardBadges, isSimpleUi } = useSettings();
  const coverRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);

  const isList = density === "list";
  const { displayUrl, isIcon, handleError } = useGameCardArt({
    game,
    isHovered: hovered,
    isListOrSmall: isList,
  });

  const canAutoFetchCover =
    !game.coverArtUrl &&
    (game.igdbId != null || game.metadataSource !== NO_IGDB_MATCH_SOURCE) &&
    !!game.name;

  useEffect(() => {
    if (!canAutoFetchCover || !coverRef.current) return;
    const node = coverRef.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        enrichGameMetadata(game.id, game.name, game.steamAppId).catch((err) =>
          console.warn(`Auto-cover fetch failed for ${game.name}:`, err)
        );
      },
      { rootMargin: "300px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [canAutoFetchCover, game.id, game.name, game.steamAppId, enrichGameMetadata]);

  const handleLaunch = (e: React.MouseEvent) => {
    e.stopPropagation();
    playLaunchSound();
    if (onLaunch) onLaunch(game);
    else launchGame(game);
  };

  const rating = game.igdbRating ?? game.criticRating;
  const playStatus = game.playStatus || "backlog";
  const statusMeta = PLAY_STATUS_DETAILS[playStatus];

  // List view mode
  if (density === "list") {
    return (
      <div
        role="button"
        tabIndex={0}
        className={`lib-card lib-card--list${isRunning ? " running" : ""}${selectable ? " selectable" : ""}${selected ? " selected" : ""}${className ? ` ${className}` : ""}`}
        onClick={() => {
          if (selectable && onToggleSelect) {
            onToggleSelect(game);
          } else {
            onClick();
          }
        }}
        onContextMenu={onContextMenu}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (selectable && onToggleSelect) {
              onToggleSelect(game);
            } else {
              onClick();
            }
          }
        }}
        aria-label={game.name}
      >
        {selectable && (
          <span className={`lib-card-select${selected ? " checked" : ""}`} aria-hidden="true">
            {selected && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </span>
        )}

        <div className={`lib-card-list-thumb${isIcon ? " has-icon" : ""}`}>
          {displayUrl ? (
            <img
              src={displayUrl}
              alt={game.name}
              loading="lazy"
              onError={handleError}
              className={isIcon ? "lib-card-icon-img" : "lib-card-poster-img"}
            />
          ) : (
            <div className="lib-card-placeholder">
              <span className="lib-card-placeholder-letter">{game.name.charAt(0)}</span>
            </div>
          )}
        </div>

        <div className="lib-card-list-info">
          <h3 className="lib-card-name" title={game.name}>
            {game.name}
          </h3>
          {game.developer && (
            <span className="lib-card-list-dev" title={game.developer}>
              {game.developer}
            </span>
          )}
        </div>

        {showCardBadges && (
          <div className="lib-card-list-platform">
            <Badge variant="info" size="sm" className="lib-card-platform">
              {game.platform}
            </Badge>
          </div>
        )}

        {showCardBadges && !isSimpleUi && (
          <div className="lib-card-list-status">
            <Badge variant={statusMeta.variant} size="sm" dot className="lib-card-status-badge">
              {t(statusMeta.labelKey)}
            </Badge>
          </div>
        )}

        {showCardBadges && (
          <div className="lib-card-list-playtime">
            <Badge variant="default" size="sm" className="lib-card-badge--playtime">
              <svg className="lib-card-badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>{game.playTime}</span>
            </Badge>
          </div>
        )}

        {showCardBadges && !isSimpleUi && (
          <div className="lib-card-list-rating">
            {rating != null && rating > 0 ? (
              <Badge variant="accent" size="sm" className="lib-card-rating">
                <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10" aria-hidden="true">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                <span>{Math.round(rating)}%</span>
              </Badge>
            ) : (
              <span className="lib-card-list-muted">–</span>
            )}
          </div>
        )}

        <div className="lib-card-list-last-played">
          <span>{formatRelativeTime(game.lastPlayed, t)}</span>
        </div>

        <div className="lib-card-list-actions" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`lib-card-list-play-btn${isRunning ? " running" : ""}`}
            onClick={handleLaunch}
            title={isRunning ? t("game.resume") : t("game.play")}
            aria-label={isRunning ? t("game.resumeAria", { name: game.name }) : t("game.playAria", { name: game.name })}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12" aria-hidden="true">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <span>{isRunning ? t("library.running") : t("game.play")}</span>
          </button>
        </div>
      </div>
    );
  }

  // Grid, Compact, Cinematic modes
  return (
    <div
      role="button"
      tabIndex={0}
      className={`lib-card density-${density}${isRunning ? " running" : ""}${selectable ? " selectable" : ""}${selected ? " selected" : ""}${className ? ` ${className}` : ""}`}
      onClick={() => {
        if (selectable && onToggleSelect) {
          onToggleSelect(game);
        } else {
          onClick();
        }
      }}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (selectable && onToggleSelect) {
            onToggleSelect(game);
          } else {
            onClick();
          }
        }
      }}
      aria-label={game.name}
    >
      <div className="lib-card-cover" ref={coverRef}>
        {selectable && (
          <span className={`lib-card-select${selected ? " checked" : ""}`} aria-hidden="true">
            {selected && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </span>
        )}

        {displayUrl ? (
          <img
            src={displayUrl}
            alt={game.name}
            loading="lazy"
            decoding="async"
            onError={handleError}
          />
        ) : (
          <div className="lib-card-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
        )}

        {showCardBadges && (
          <div className="lib-card-badges">
            {isRunning && (
              <Badge variant="success" size="sm" dot className="lib-card-badge lib-card-badge--running">
                <span className="lib-card-running-pulse" aria-hidden="true" />
                {t("library.running")}
              </Badge>
            )}
            <Badge variant="default" size="sm" className="lib-card-badge lib-card-badge--playtime">
              <svg className="lib-card-badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>{game.playTime}</span>
            </Badge>
          </div>
        )}

        <button
          type="button"
          className="lib-card-fab"
          onClick={handleLaunch}
          aria-label={isRunning ? t("game.resumeAria", { name: game.name }) : t("game.playAria", { name: game.name })}
          title={isRunning ? t("game.resume") : t("game.play")}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </button>
      </div>

      <div className="lib-card-body">
        <h3 className="lib-card-name" title={game.name}>
          {game.name}
        </h3>
        {showCardBadges && (
          <div className="lib-card-meta">
            <Badge variant="info" size="sm" className="lib-card-platform">
              {game.platform}
            </Badge>
            {!isSimpleUi && (
              <>
                <Badge variant={statusMeta.variant} size="sm" dot className="lib-card-status-badge">
                  {t(statusMeta.labelKey)}
                </Badge>
                {rating != null && rating > 0 && (
                  <Badge
                    variant="accent"
                    size="sm"
                    className="lib-card-rating"
                    title={`${t(game.igdbRating != null ? "gameInfo.igdbRating" : "gameInfo.criticRating")}: ${Math.round(rating)}%`}
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" width="10" height="10" style={{ marginRight: 3 }} aria-hidden="true">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                    <span>{Math.round(rating)}%</span>
                  </Badge>
                )}
              </>
            )}
          </div>
        )}
        {!isSimpleUi && game.developer && (
          <p className="lib-card-developer" title={game.developer}>
            {game.developer}
          </p>
        )}
        {!isSimpleUi && game.genres && game.genres.length > 0 && (
          <div className="lib-card-genres">
            {game.genres.slice(0, 3).map((g) => (
              <span key={g} className="lib-card-genre">
                {g}
              </span>
            ))}
          </div>
        )}
        {game.notes ? (
          <p className="lib-card-notes">{game.notes}</p>
        ) : game.description ? (
          <p className="lib-card-notes">{game.description.slice(0, 80)}{game.description.length > 80 ? "..." : ""}</p>
        ) : (
          <p className="lib-card-notes is-empty">{t("library.noNotes")}</p>
        )}
      </div>
    </div>
  );
}

const LibraryGameCard = memo(LibraryGameCardBase, (prev, next) => {
  return (
    prev.game === next.game &&
    prev.density === next.density &&
    prev.isRunning === next.isRunning &&
    prev.selectable === next.selectable &&
    prev.selected === next.selected &&
    prev.onClick === next.onClick &&
    prev.onContextMenu === next.onContextMenu &&
    prev.onLaunch === next.onLaunch &&
    prev.onToggleSelect === next.onToggleSelect &&
    prev.className === next.className
  );
});

export default LibraryGameCard;
