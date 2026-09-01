import { useMemo, useRef, useState, memo } from "react";
import { useNavigate } from "react-router-dom";
import type { Game } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { Card } from "../ui";
import { useCollapsedState } from "../../hooks/useCollapsedState";
import PlayerCountBadge from "../PlayerCountBadge";
import { useSteamAppId } from "../../hooks/useSteamAppId";
import { useGameCardArt } from "../../hooks/useGameCardArt";

interface ContinuePlayingRailProps {
  games: Game[];
  maxItems?: number;
  windowDays?: number;
  onCardClick?: (game: Game) => void;
}

const COLLAPSED_STORAGE_KEY = "gamelib:rail:continue-playing:collapsed:v1";

/**
 * "Continue Playing" rail: surfaces games played in the last N days, sorted
 * by most-recently-played first. Always rendered when the Library isn't
 * empty (shows a friendly empty state when nothing qualifies).
 */
export default function ContinuePlayingRail({
  games,
  maxItems = 12,
  windowDays = 14,
  onCardClick,
}: ContinuePlayingRailProps) {
  const navigate = useNavigate();
  const { setSelectedGameId } = useGames();
  const { t } = useLanguage();
  const railRef = useRef<HTMLDivElement | null>(null);

  const recent = useMemo(() => {
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    return [...games]
      .filter((g) => (g.lastPlayed ?? 0) >= cutoff)
      .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
      .slice(0, maxItems);
  }, [games, maxItems, windowDays]);

  const [collapsed, toggleCollapsed] = useCollapsedState(
    COLLAPSED_STORAGE_KEY,
    recent.length > 0,
    true
  );

  function handleClick(game: Game) {
    if (onCardClick) return onCardClick(game);
    setSelectedGameId(game.id);
    navigate(`/library/${game.id}`);
  }

  const viewportId = "lib-rail-continue-viewport";

  return (
    <section
      className={`lib-rail lib-rail--continue${collapsed ? " lib-rail--collapsed" : ""}`}
      aria-label={t("gameCard.continuePlaying")}
    >
      <div className="lib-rail-header">
        <div className="lib-rail-title-row">
          <div className="lib-rail-icon lib-rail-icon--continue" aria-hidden>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6 4 20 12 6 20 6 4" />
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 className="lib-rail-title">{t("lib.rail.continue.title")}</h3>
            <p className="lib-rail-subtitle">{t("lib.rail.continue.subtitle")}</p>
          </div>
        </div>
        <button
          type="button"
          className="lib-rail-toggle-btn"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls={viewportId}
          aria-label={collapsed ? t("lib.rail.continue.expand") : t("lib.rail.continue.collapse")}
          title={collapsed ? t("common.expand") : t("common.collapse")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      <div id={viewportId} className={`lib-rail-body${collapsed ? " lib-rail-body--collapsed" : ""}`}>
        <div className="lib-rail-viewport">
          {recent.length === 0 ? (
            <div className="lib-rail-empty">
              <div className="lib-rail-empty-icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <polygon points="6 4 20 12 6 20 6 4" />
                </svg>
              </div>
              <span>
                {t("lib.rail.continue.empty")}
              </span>
            </div>
          ) : (
            <>
              <div className="lib-rail-track" ref={railRef}>
                {recent.map((game, i) => (
                  <div key={game.id} className={`lib-rail-item animate-fade-in stagger-${Math.min(i + 1, 8)}`}>
                    <ContinuePlayingCard game={game} onClick={handleClick} />
                  </div>
                ))}
              </div>
              <div className="lib-rail-fade lib-rail-fade--left" aria-hidden />
              <div className="lib-rail-fade lib-rail-fade--right" aria-hidden />
            </>
          )}
        </div>
      </div>
    </section>
  );
}

const ContinuePlayingCard = memo(function ContinuePlayingCard({
  game,
  onClick,
}: {
  game: Game;
  onClick: (game: Game) => void;
}) {
  const { t } = useLanguage();
  const { launchGame } = useGames();
  const [hovered, setHovered] = useState(false);
  const { appId: resolvedSteamAppId } = useSteamAppId(game);
  const steamAppId =
    typeof resolvedSteamAppId === "number" ? resolvedSteamAppId : game.steamAppId ?? null;

  const { displayUrl, staticPosterUrl, animatedPosterUrl, handleError } = useGameCardArt({
    game,
    appId: steamAppId,
    isHovered: hovered,
  });

  const handleResume = (e: React.MouseEvent) => {
    e.stopPropagation();
    launchGame(game);
  };

  return (
    <Card
      variant="surface"
      elevation="1"
      hoverLift
      className="lib-rail-card"
      onClick={() => onClick(game)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="lib-rail-cover">
        {(staticPosterUrl || displayUrl) ? (
          <>
            <img
              src={staticPosterUrl || displayUrl!}
              alt={game.name}
              loading="lazy"
              decoding="async"
              onError={handleError}
              className="lib-rail-cover-static"
            />
            {animatedPosterUrl && hovered && (
              <img
                src={animatedPosterUrl}
                alt=""
                aria-hidden="true"
                decoding="async"
                className="lib-rail-cover-animated is-active"
                onError={handleError}
              />
            )}
          </>
        ) : (
          <div className="lib-rail-cover-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </div>
        )}
        <span className="lib-rail-platform">{game.platform}</span>
        {steamAppId != null && (
          <div className="lib-rail-player-chip">
            <PlayerCountBadge appId={steamAppId} className="lib-rail-player-chip-badge" />
          </div>
        )}
        <button
          type="button"
          className="lib-rail-resume"
          onClick={handleResume}
          aria-label={t("game.playAria", { name: game.name })}
          title={t("game.play")}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <span>{t("game.play")}</span>
        </button>
      </div>
      <div className="lib-rail-card-body">
        <div className="lib-rail-name" title={game.name}>{game.name}</div>
        <div className="lib-rail-meta lib-rail-meta--continue" title={t("lib.rail.continue.lastPlayed", { date: new Date(game.lastPlayed ?? 0).toLocaleString() })}>
          {formatAgo(game.lastPlayed ?? 0, t)}
        </div>
      </div>
    </Card>
  );
});

function formatAgo(
  timestamp: number,
  t: (key: string, vars?: Record<string, unknown>) => string
): string {
  if (!timestamp) return t("lib.rail.continue.never");
  const diffMs = Date.now() - timestamp;
  if (diffMs < 0) return t("lib.rail.continue.justNow");
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return t("lib.rail.continue.underHourAgo");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("lib.rail.continue.hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("lib.rail.continue.daysAgo", { n: days });
  const weeks = Math.floor(days / 7);
  return t("lib.rail.continue.weeksAgo", { n: weeks });
}
