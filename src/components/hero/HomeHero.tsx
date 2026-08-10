import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { Game } from "../../types/game";
import { parsePlayTime, formatPlayTime } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import HeroTrailer from "./HeroTrailer";
import FriendsPlayingStrip from "./FriendsPlayingStrip";

interface HomeHeroProps {
  games: Game[];
  /** Called when the spotlight card is clicked (e.g. open the game page). */
  onOpenGame?: (game: Game) => void;
}

/**
 * HomeHero — the app's first-run "wow" surface.
 *
 * A cinematic two-column hero: on the left the time-of-day greeting with
 * quick actions; on the right a "spotlight" card promoting the game the
 * user most likely wants to return to (most recently played, else highest
 * rated, else the first title). The spotlight cover plays the game's
 * trailer as ambient autoplay when one exists, carries a quick-play FAB,
 * and surfaces the friends-playing strip below the art — the classic
 * premium-launcher composition (Steam / GOG Galaxy).
 *
 * Decorative backdrop layers (mesh, blurred cover collage, veil) are
 * aria-hidden and respect `prefers-reduced-motion`.
 */
export default function HomeHero({ games, onOpenGame }: HomeHeroProps) {
  const navigate = useNavigate();
  const { launchGame, runningGameIds } = useGames();
  const { t } = useLanguage();

  const greetingKey = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 5) return "lib.hero.greeting.upLate";
    if (hour < 12) return "lib.hero.greeting.morning";
    if (hour < 18) return "lib.hero.greeting.afternoon";
    return "lib.hero.greeting.evening";
  }, []);

  const stats = useMemo(() => {
    const total = games.length;
    const totalPlayTime = games.reduce((sum, g) => sum + parsePlayTime(g.playTime), 0);
    const recentlyAdded = games.filter(
      (g) => (g.addedAt ?? 0) >= Date.now() - 7 * 24 * 60 * 60 * 1000
    ).length;
    return { total, totalPlayTime, recentlyAdded };
  }, [games]);

  // Spotlight: most recently played → highest rated → first title.
  const spotlight = useMemo<Game | null>(() => {
    if (games.length === 0) return null;
    const played = games.filter((g) => g.lastPlayed);
    if (played.length > 0) {
      return [...played].sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))[0];
    }
    const rated = games.filter((g) => (g.igdbRating ?? g.criticRating ?? 0) > 0);
    if (rated.length > 0) {
      return [...rated].sort(
        (a, b) => (b.igdbRating ?? b.criticRating ?? 0) - (a.igdbRating ?? a.criticRating ?? 0)
      )[0];
    }
    return games[0];
  }, [games]);

  // A handful of covers for the blurred backdrop collage.
  const collage = useMemo(
    () => games.filter((g) => g.coverArtUrl).slice(0, 8).map((g) => g.coverArtUrl as string),
    [games]
  );

  const isRunning = spotlight ? runningGameIds.includes(spotlight.id) : false;

  const openSpotlight = () => {
    if (spotlight && onOpenGame) onOpenGame(spotlight);
  };

  const handleLaunch = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (spotlight) launchGame(spotlight);
  };

  const handleBrowseStore = () => navigate("/store");

  const subtitle = stats.total === 0
    ? t("lib.hero.subtitle.empty")
    : stats.recentlyAdded > 0
      ? t("lib.hero.subtitle.body", {
          time: formatPlayTime(stats.totalPlayTime),
          count: stats.total,
          added: stats.recentlyAdded,
        })
      : t("lib.hero.subtitle.noAdded", {
          time: formatPlayTime(stats.totalPlayTime),
          count: stats.total,
          plural: stats.total === 1 ? "" : "s",
        });

  return (
    <section className="home-hero" aria-label={t("library.overviewAria")}>
      <div className="home-hero__mesh" aria-hidden />
      {collage.length > 0 && (
        <div className="home-hero__collage" aria-hidden>
          {collage.map((src, i) => (
            <img key={i} src={src} alt="" loading="lazy" />
          ))}
        </div>
      )}
      <div className="home-hero__veil" aria-hidden />

      <div className="home-hero__grid">
        <div className="home-hero__content">
          <p className="home-hero__eyebrow fade-up" style={{ ["--d" as string]: "60ms" }}>
            {t("page.library.yourGames")}
          </p>
          <h1 className="home-hero__title fade-up" style={{ ["--d" as string]: "140ms" }}>
            {t(greetingKey)}
            <span className="home-hero__title-accent" aria-hidden>.</span>
          </h1>
          <p className="home-hero__subtitle fade-up" style={{ ["--d" as string]: "220ms" }}>
            {subtitle}
          </p>

          <div className="home-hero__actions fade-up" style={{ ["--d" as string]: "300ms" }}>
            <button
              type="button"
              className="home-hero__btn home-hero__btn--primary"
              onClick={handleBrowseStore}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                <polyline points="17 6 23 6 23 12" />
              </svg>
              {t("lib.hero.browseStore")}
            </button>
            <button
              type="button"
              className="home-hero__btn home-hero__btn--ghost"
              onClick={() => navigate("/library")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="3" y="4" width="18" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="18" x2="12" y2="21" />
              </svg>
              {t("nav.library")}
            </button>
          </div>
        </div>

        {spotlight && (
          <div
            className="home-spotlight fade-up"
            style={{ ["--d" as string]: "200ms" }}
            role="button"
            tabIndex={0}
            onClick={openSpotlight}
            onKeyDown={(e) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openSpotlight();
              }
            }}
            aria-label={spotlight.name}
          >
            <div className="home-spotlight__cover">
              {spotlight.videos && spotlight.videos.length > 0 ? (
                <HeroTrailer src={spotlight.videos[0]} poster={spotlight.coverArtUrl} autoplay />
              ) : spotlight.coverArtUrl ? (
                <img src={spotlight.coverArtUrl} alt={spotlight.name} loading="lazy" />
              ) : (
                <div className="home-spotlight__placeholder">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                </div>
              )}

              <div className="home-spotlight__scrim" aria-hidden />
              <span className="home-spotlight__chip">
                <svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11" aria-hidden>
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                {t("bigscreen.spotlight.featured")}
              </span>

              <button
                type="button"
                className={`home-spotlight__play${isRunning ? " running" : ""}`}
                onClick={handleLaunch}
                aria-label={isRunning ? t("game.resumeAria", { name: spotlight.name }) : t("game.playAria", { name: spotlight.name })}
                title={isRunning ? t("game.resume") : t("game.play")}
              >
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              </button>

              <div className="home-spotlight__body">
                <h2 className="home-spotlight__name" title={spotlight.name}>
                  {spotlight.name}
                </h2>
                {spotlight.developer && (
                  <p className="home-spotlight__dev">
                    {t("bigscreen.spotlight.byDeveloper", { developer: spotlight.developer })}
                  </p>
                )}
                <div className="home-spotlight__meta">
                  <span className="home-spotlight__meta-item">{spotlight.platform}</span>
                  {spotlight.playTime && (
                    <span className="home-spotlight__meta-item">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      {spotlight.playTime}
                    </span>
                  )}
                  {(spotlight.igdbRating ?? spotlight.criticRating ?? 0) > 0 && (
                    <span className="home-spotlight__meta-item home-spotlight__meta-item--rating">
                      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                      {Math.round(spotlight.igdbRating ?? spotlight.criticRating ?? 0)}%
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="home-spotlight__friends">
              <FriendsPlayingStrip gameName={spotlight.name} gameId={spotlight.id} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}