import { memo, useEffect, useRef, useState } from "react";
import { MoreHorizontal, Play } from "lucide-react";
import type { Game, LibraryDensity } from "../../types/game";
import { PLAY_STATUS_DETAILS, gameDisplayName, gameIsVr } from "../../types/game";
import { useGameCardActions, NO_IGDB_MATCH_SOURCE } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { useCardDisplaySettings } from "../../context/SettingsContext";
import { useGameCardArt } from "../../hooks/useGameCardArt";
import { useSharedViewportVisibility } from "../../hooks/useSharedViewportVisibility";
import { ArtworkImage } from "../ui/ArtworkImage";
import { playLaunchSound } from "../../utils/soundEffects";
import { isLibraryScrolling } from "./libraryScroll";

interface LibraryGameCardProps {
  game: Game;
  density: LibraryDensity;
  isRunning: boolean;
  onClick: () => void;
  /** Right-click or the ⋯ button — both open the same page-level menu. */
  onContextMenu: (event: React.MouseEvent) => void;
  onLaunch?: (game: Game) => void;
  className?: string;
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (game: Game) => void;
}

function formatRelativeTime(
  timestamp: number | undefined,
  t: (key: string, vars?: Record<string, unknown>) => string
): string {
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
  const { enqueueEnrich, launchGame } = useGameCardActions();
  const { t } = useLanguage();
  const { showCardBadges, isSimpleUi, badgePlatform, badgeInstall, badgePlaytime, badgeRating } =
    useCardDisplaySettings();
  const coverRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);

  // Skip the hover state (and the animated poster it enables) while the grid
  // is still moving under the pointer.
  const handlePointerEnter = () => {
    if (isLibraryScrolling()) return;
    setHovered(true);
  };

  // A card can enter its hover state and then be scrolled under the sticky bar
  // without ever receiving mouseleave. Drop the state as soon as the page
  // moves so no animated poster decodes during the scroll.
  useEffect(() => {
    if (!hovered) return;
    const onScroll = () => setHovered(false);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [hovered]);

  const displayName = gameDisplayName(game);
  const isList = density === "list";

  const { displayUrl, isIcon, handleError, staticPosterUrl, animatedPosterUrl } = useGameCardArt({
    game,
    isHovered: hovered,
    isListOrSmall: isList,
  });

  const canAutoFetchCover =
    !game.coverArtUrl &&
    (game.igdbId != null || game.metadataSource !== NO_IGDB_MATCH_SOURCE) &&
    !!game.name;

  // One shared observer for every mounted card (see the hook) instead of an
  // IntersectionObserver per card, and the missing-cover fetch rides the paced
  // background queue so a 300-card import scrolling into view can't fire 300
  // concurrent IGDB pipelines.
  useSharedViewportVisibility({
    targetRef: coverRef,
    enabled: canAutoFetchCover,
    dep: game.id,
    onVisible: () =>
      enqueueEnrich({ id: game.id, name: game.name, steamAppId: game.steamAppId }, true),
  });

  const rating = game.igdbRating ?? game.criticRating;
  const isVr = gameIsVr(game);
  const playStatus = game.playStatus || "backlog";
  const statusMeta = PLAY_STATUS_DETAILS[playStatus];

  const handleActivate = () => {
    if (selectable && onToggleSelect) onToggleSelect(game);
    else onClick();
  };

  const handleLaunch = (event: React.MouseEvent) => {
    event.stopPropagation();
    playLaunchSound();
    if (onLaunch) onLaunch(game);
    else launchGame(game);
  };

  const activateKey = (event: React.KeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleActivate();
    }
  };

  const launchLabel = isRunning ? t("game.resume") : t("game.play");

  if (isList) {
    return (
      <div
        role="button"
        tabIndex={0}
        className={`lib-card lib-card--list${isRunning ? " running" : ""}${selectable ? " selectable" : ""}${selected ? " selected" : ""}${className ? ` ${className}` : ""}`}
        data-game-detail-route={`/library/${game.id}`}
        data-game-detail-title={displayName}
        onClick={handleActivate}
        onContextMenu={onContextMenu}
        onMouseEnter={handlePointerEnter}
        onMouseLeave={() => setHovered(false)}
        onKeyDown={activateKey}
        aria-label={displayName}
      >
        <div className={`lib-card-list-thumb${isIcon ? " has-icon" : ""}`}>
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
              alt={displayName}
              loading="lazy"
              decoding="async"
              onError={handleError}
              className={isIcon ? "lib-card-icon-img" : "lib-card-poster-img"}
            />
          ) : (
            <div className="lib-card-placeholder">
              <span className="lib-card-placeholder-letter">{displayName.charAt(0)}</span>
            </div>
          )}
        </div>

        <div className="lib-card-list-info">
          <h3 className="lib-card-name" title={displayName}>
            {displayName}
          </h3>
          {game.developer && (
            <span className="lib-card-list-dev" title={game.developer}>
              {game.developer}
            </span>
          )}
        </div>

        <div className="lib-card-list-platform">
          <span className="lib-card-chip lib-card-chip--platform">{game.platform}</span>
        </div>

        <div className="lib-card-list-status">
          {showCardBadges && badgeInstall && !isSimpleUi ? (
            <span className={`lib-card-chip lib-card-chip--status is-${statusMeta.variant}`}>
              <span className="lib-card-chip-dot" aria-hidden="true" />
              {t(statusMeta.labelKey)}
            </span>
          ) : (
            <span className="lib-card-list-muted">–</span>
          )}
        </div>

        <div className="lib-card-list-playtime">
          {showCardBadges && badgePlaytime ? (
            <span className="lib-card-list-mono">{game.playTime}</span>
          ) : (
            <span className="lib-card-list-muted">–</span>
          )}
        </div>

        <div className="lib-card-list-rating">
          {showCardBadges && badgeRating && !isSimpleUi && rating != null && rating > 0 ? (
            <span className="lib-card-list-mono">{Math.round(rating)}%</span>
          ) : (
            <span className="lib-card-list-muted">–</span>
          )}
        </div>

        <div className="lib-card-list-last-played">
          <span>{formatRelativeTime(game.lastPlayed, t)}</span>
        </div>

        <div className="lib-card-list-actions" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className={`lib-card-icon-btn lib-card-icon-btn--play${isRunning ? " running" : ""}`}
            onClick={handleLaunch}
            title={launchLabel}
            aria-label={
              isRunning
                ? t("game.resumeAria", { name: displayName })
                : t("game.playAria", { name: displayName })
            }
          >
            <Play size={12} fill="currentColor" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="lib-card-icon-btn"
            onClick={onContextMenu}
            title={t("library.moreActions")}
            aria-label={`${t("library.moreActions")}: ${displayName}`}
          >
            <MoreHorizontal size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  const isCompact = density === "compact";

  return (
    <div
      role="button"
      tabIndex={0}
      className={`lib-card density-${density}${isRunning ? " running" : ""}${selectable ? " selectable" : ""}${selected ? " selected" : ""}${className ? ` ${className}` : ""}`}
      data-game-detail-route={`/library/${game.id}`}
      data-game-detail-title={displayName}
      onClick={handleActivate}
      onContextMenu={onContextMenu}
      onMouseEnter={handlePointerEnter}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={activateKey}
      aria-label={displayName}
      aria-current={isRunning ? "true" : undefined}
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

        {staticPosterUrl || displayUrl ? (
          <>
            <ArtworkImage
              src={(staticPosterUrl || displayUrl)!}
              alt={displayName}
              onError={handleError}
              className="lib-card-cover-static"
            />
            {animatedPosterUrl && hovered && (
              <img
                src={animatedPosterUrl}
                alt=""
                aria-hidden="true"
                decoding="async"
                className="lib-card-cover-animated is-active"
                onError={handleError}
              />
            )}
          </>
        ) : (
          <div className="lib-card-placeholder">
            <span className="lib-card-placeholder-letter">{displayName.charAt(0)}</span>
          </div>
        )}

        <span className="lib-card-cover-scrim" aria-hidden="true" />

        {isRunning && (
          <span className="lib-card-running">
            <span className="lib-card-running-dot" aria-hidden="true" />
            {t("library.running")}
          </span>
        )}

        <div className="lib-card-actions" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className={`lib-card-play${isRunning ? " running" : ""}`}
            onClick={handleLaunch}
            title={launchLabel}
            aria-label={
              isRunning
                ? t("game.resumeAria", { name: displayName })
                : t("game.playAria", { name: displayName })
            }
          >
            <Play size={12} fill="currentColor" aria-hidden="true" />
            <span>{launchLabel}</span>
          </button>
          <button
            type="button"
            className="lib-card-more"
            onClick={onContextMenu}
            title={t("library.moreActions")}
            aria-label={`${t("library.moreActions")}: ${displayName}`}
          >
            <MoreHorizontal size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="lib-card-body">
        <h3 className="lib-card-name" title={displayName}>
          {displayName}
        </h3>

        {isCompact ? (
          <p className="lib-card-meta">
            <span>{game.platform}</span>
            {showCardBadges && badgePlaytime && game.playTime ? (
              <>
                <span className="lib-card-meta-sep" aria-hidden="true">·</span>
                <span>{game.playTime}</span>
              </>
            ) : null}
          </p>
        ) : (
          <div className="lib-card-chips">
            {showCardBadges && badgePlatform && game.platform && (
              <span className="lib-card-chip lib-card-chip--platform">{game.platform}</span>
            )}
            {showCardBadges && badgeRating && !isSimpleUi && rating != null && rating > 0 && (
              <span
                className="lib-card-chip lib-card-chip--rating"
                title={`${t(game.igdbRating != null ? "gameInfo.igdbRating" : "gameInfo.criticRating")}: ${Math.round(rating)}%`}
              >
                {Math.round(rating)}%
              </span>
            )}
            {showCardBadges && badgeInstall && !isSimpleUi && (
              <span className={`lib-card-chip lib-card-chip--status is-${statusMeta.variant}`}>
                <span className="lib-card-chip-dot" aria-hidden="true" />
                {t(statusMeta.labelKey)}
              </span>
            )}
            {isVr && (
              <span className="lib-card-chip lib-card-chip--vr">{t("library.vrBadge")}</span>
            )}
            {game.emulatorId && game.romPath && (
              <span className="lib-card-chip lib-card-chip--rom">{t("library.romBadge")}</span>
            )}
          </div>
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
    prev.className === next.className
  );
});

export default LibraryGameCard;
