import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { Game } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import HomeSection from "./HomeSection";

const MAX_ITEMS = 5;

export default function HomeQuickLaunch() {
  const navigate = useNavigate();
  const { games, runningGameIds, launchGame } = useGames();
  const { t } = useLanguage();

  const quickGames = useMemo<Game[]>(() => {
    if (games.length === 0) return [];
    // Sort by: currently running first -> most recently played -> highest playtime -> first added
    const pool = [...games].sort((a, b) => {
      const aRun = runningGameIds.includes(a.id) ? 1 : 0;
      const bRun = runningGameIds.includes(b.id) ? 1 : 0;
      if (aRun !== bRun) return bRun - aRun;

      const aLast = a.lastPlayed ?? 0;
      const bLast = b.lastPlayed ?? 0;
      if (aLast !== bLast) return bLast - aLast;

      return (b.addedAt ?? 0) - (a.addedAt ?? 0);
    });

    return pool.slice(0, MAX_ITEMS);
  }, [games, runningGameIds]);

  if (quickGames.length === 0) return null;

  return (
    <HomeSection
      className="home-quick-launch"
      icon={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      }
      title={t("home.quickLaunch.title")}
      subtitle={t("home.quickLaunch.subtitle")}
      viewAllPath="/library"
    >
      <div className="home-quick-launch__list">
        {quickGames.map((game) => {
          const isRunning = runningGameIds.includes(game.id);
          return (
            <div
              key={game.id}
              className={`home-quick-launch__item${isRunning ? " is-running" : ""}`}
              onClick={() => navigate(`/library/${game.id}`)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigate(`/library/${game.id}`);
                }
              }}
            >
              <div className="home-quick-launch__cover">
                {game.coverArtUrl ? (
                  <img src={game.coverArtUrl} alt="" loading="lazy" />
                ) : (
                  <div className="home-quick-launch__placeholder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                  </div>
                )}
                {isRunning && <span className="home-quick-launch__pulse-dot" aria-hidden />}
              </div>

              <div className="home-quick-launch__info">
                <span className="home-quick-launch__name" title={game.name}>
                  {game.name}
                </span>
                <span className="home-quick-launch__meta">
                  {isRunning ? (
                    <span className="home-quick-launch__running-label">
                      {t("home.spotlight.running")}
                    </span>
                  ) : (
                    game.platform
                  )}
                  {game.playTime ? ` · ${game.playTime}` : ""}
                </span>
              </div>

              <button
                type="button"
                className={`home-quick-launch__btn${isRunning ? " is-active" : ""}`}
                onClick={(e) => {
                  e.stopPropagation();
                  launchGame(game);
                }}
                title={isRunning ? t("game.resume") : t("game.play")}
                aria-label={isRunning ? t("game.resume") : t("game.play")}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </HomeSection>
  );
}
