import { memo, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { gameDisplayName, type Game } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { useShelves } from "../../context/ShelfContext";
import { Card } from "../ui";
import { useCollapsedState } from "../../hooks/useCollapsedState";
import { useGameCardArt } from "../../hooks/useGameCardArt";
import { sortGames } from "../../hooks/libraryFilters";
import { ShelfIcon } from "./ShelfIcon";
import { shelfDisplayName, type Shelf } from "../../types/shelf";

export interface ShelfRailsProps {
  /** Overrides the default navigation to a game's detail page. */
  onCardClick?: (game: Game) => void;
  /** Max games shown per rail. */
  maxItems?: number;
}

/**
 * ShelfRails — Home-page rails for the user's pinned shelves.
 *
 * Every pinned shelf with at least one match renders as its own row; empty
 * shelves are skipped (the sidebar still lists them with a 0 count).
 */
export function ShelfRails({ onCardClick, maxItems = 12 }: ShelfRailsProps) {
  const { shelves, enabled } = useShelves();

  const pinned = useMemo(
    () =>
      shelves
        .filter((s) => s.pinned)
        .sort((a, b) => a.position - b.position),
    [shelves]
  );

  if (!enabled || pinned.length === 0) return null;

  return (
    <>
      {pinned.map((shelf) => (
        <ShelfRail
          key={shelf.id}
          shelf={shelf}
          maxItems={maxItems}
          onCardClick={onCardClick}
        />
      ))}
    </>
  );
}

function ShelfRail({
  shelf,
  maxItems,
  onCardClick,
}: {
  shelf: Shelf;
  maxItems: number;
  onCardClick?: (game: Game) => void;
}) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { setSelectedGameId } = useGames();
  const { shelfGames, completedAtOf } = useShelves();

  const games = useMemo(() => {
    const matched = sortGames(shelfGames(shelf.id), shelf.sort, { completedAtOf });
    return matched.slice(0, maxItems);
  }, [shelf.id, shelf.sort, shelfGames, completedAtOf, maxItems]);

  const [collapsed, toggleCollapsed] = useCollapsedState(
    `gamelib:rail:shelf:${shelf.id}:collapsed:v1`,
    games.length > 0
  );

  // Empty rails are hidden entirely on Home (the sidebar is the place to
  // see "0 games"), so nothing renders below.
  if (games.length === 0) return null;

  function handleClick(game: Game) {
    if (onCardClick) return onCardClick(game);
    setSelectedGameId(game.id);
    navigate(`/library/${game.id}`);
  }

  const viewportId = `shelf-rail-${shelf.id}`;
  const swatch = `var(--color-${shelf.color})`;
  const displayName = shelfDisplayName(shelf.name, t);

  return (
    <section
      className={`lib-rail lib-rail--shelf${collapsed ? " lib-rail--collapsed" : ""}`}
      style={{ ["--shelf-swatch" as string]: swatch }}
      aria-label={displayName}
    >
      <div className="lib-rail-header">
        <div className="lib-rail-title-row">
          <div className="lib-rail-icon lib-rail-icon--shelf" aria-hidden>
            <ShelfIcon name={shelf.icon} size={16} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 className="lib-rail-title">{displayName}</h3>
            <p className="lib-rail-subtitle">
              {t("shelves.rail.subtitle", { count: games.length })}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="lib-rail-toggle-btn"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls={viewportId}
          aria-label={collapsed ? t("common.expand") : t("common.collapse")}
          title={collapsed ? t("common.expand") : t("common.collapse")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      <div id={viewportId} className={`lib-rail-body${collapsed ? " lib-rail-body--collapsed" : ""}`}>
        <div className="lib-rail-viewport">
          <div className="lib-rail-track">
            {games.map((game, i) => (
              <div key={game.id} className={`lib-rail-item animate-fade-in stagger-${Math.min(i + 1, 8)}`}>
                <ShelfRailCard game={game} onClick={handleClick} />
              </div>
            ))}
          </div>
          <div className="lib-rail-fade lib-rail-fade--left" aria-hidden />
          <div className="lib-rail-fade lib-rail-fade--right" aria-hidden />
        </div>
      </div>
    </section>
  );
}

const ShelfRailCard = memo(function ShelfRailCard({
  game,
  onClick,
}: {
  game: Game;
  onClick: (game: Game) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const { staticPosterUrl, displayUrl, handleError } = useGameCardArt({ game, isHovered: hovered });
  const cover = staticPosterUrl || displayUrl;

  return (
    <Card
      variant="surface"
      elevation="1"
      hoverLift
      className="lib-rail-card"
      data-game-detail-route={`/library/${game.id}`}
      data-game-detail-title={gameDisplayName(game)}
      onClick={() => onClick(game)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="lib-rail-cover">
        {cover ? (
          <img
            src={cover}
            alt={gameDisplayName(game)}
            loading="lazy"
            decoding="async"
            onError={handleError}
            className="lib-rail-cover-static"
          />
        ) : (
          <div className="lib-rail-cover-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
        )}
        <span className="lib-rail-platform">{game.platform}</span>
      </div>
      <div className="lib-rail-card-body">
        <div className="lib-rail-name" title={gameDisplayName(game)}>
          {gameDisplayName(game)}
        </div>
      </div>
    </Card>
  );
});

export default ShelfRails;
