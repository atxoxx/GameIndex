import { useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { Game } from "../../types/game";
import { parsePlayTime, formatPlayTime } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import HeroTrailer from "./HeroTrailer";
import FriendsPlayingStrip from "./FriendsPlayingStrip";
import PlayerCountBadge from "../PlayerCountBadge";
import { useSteamAppId } from "../../hooks/useSteamAppId";
import { useSteamGridArt } from "../../context/SteamGridDbContext";

interface HomeHeroProps {
  games: Game[];
  onOpenGame?: (game: Game) => void;
}

interface SpotlightItem {
  id: string;
  categoryKey: string;
  game: Game;
  badgeType: "running" | "continue" | "topRated" | "backlog" | "mostPlayed" | "surprise";
}

export default function HomeHero({ games, onOpenGame }: HomeHeroProps) {
  const navigate = useNavigate();
  const { launchGame, runningGameIds, liveElapsed } = useGames();
  const { showToast } = useToast();
  const { t } = useLanguage();

  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [rollingDice, setRollingDice] = useState(false);
  const [customSpotlight, setCustomSpotlight] = useState<Game | null>(null);

  // Time-of-day greeting
  const greetingKey = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 5) return "lib.hero.greeting.upLate";
    if (hour < 12) return "lib.hero.greeting.morning";
    if (hour < 18) return "lib.hero.greeting.afternoon";
    return "lib.hero.greeting.evening";
  }, []);

  // Library summary stats
  const stats = useMemo(() => {
    const total = games.length;
    const totalPlayTime = games.reduce((sum, g) => sum + parsePlayTime(g.playTime), 0);
    const recentlyAdded = games.filter(
      (g) => (g.addedAt ?? 0) >= Date.now() - 7 * 24 * 60 * 60 * 1000
    ).length;
    return { total, totalPlayTime, recentlyAdded };
  }, [games]);

  // Curated spotlight candidate deck
  const spotlightDeck = useMemo<SpotlightItem[]>(() => {
    if (games.length === 0) return [];
    const deck: SpotlightItem[] = [];
    const seenIds = new Set<string>();

    // 0. Custom picked (e.g. from "Surprise Me")
    if (customSpotlight) {
      deck.push({
        id: `custom-${customSpotlight.id}`,
        categoryKey: "home.spotlight.surprise",
        game: customSpotlight,
        badgeType: "surprise",
      });
      seenIds.add(customSpotlight.id);
    }

    // 1. Running Game (if any active)
    if (runningGameIds.length > 0) {
      const runningGame = games.find((g) => runningGameIds.includes(g.id));
      if (runningGame && !seenIds.has(runningGame.id)) {
        deck.push({
          id: `running-${runningGame.id}`,
          categoryKey: "home.spotlight.running",
          game: runningGame,
          badgeType: "running",
        });
        seenIds.add(runningGame.id);
      }
    }

    // 2. Continue Playing (most recently active)
    const played = games.filter((g) => g.lastPlayed && !seenIds.has(g.id));
    if (played.length > 0) {
      const latest = [...played].sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))[0];
      deck.push({
        id: `continue-${latest.id}`,
        categoryKey: "home.spotlight.continue",
        game: latest,
        badgeType: "continue",
      });
      seenIds.add(latest.id);
    }

    // 3. Top Rated
    const rated = games.filter(
      (g) => (g.igdbRating ?? g.criticRating ?? 0) > 0 && !seenIds.has(g.id)
    );
    if (rated.length > 0) {
      const best = [...rated].sort(
        (a, b) => (b.igdbRating ?? b.criticRating ?? 0) - (a.igdbRating ?? a.criticRating ?? 0)
      )[0];
      deck.push({
        id: `topRated-${best.id}`,
        categoryKey: "home.spotlight.topRated",
        game: best,
        badgeType: "topRated",
      });
      seenIds.add(best.id);
    }

    // 4. Backlog Gem (unplayed or high potential)
    const backlog = games.filter(
      (g) =>
        (!g.lastPlayed || parsePlayTime(g.playTime) < 60) &&
        !seenIds.has(g.id) &&
        (g.igdbRating ?? g.criticRating ?? 0) >= 70
    );
    if (backlog.length > 0) {
      const gem = backlog[0];
      deck.push({
        id: `backlog-${gem.id}`,
        categoryKey: "home.spotlight.backlog",
        game: gem,
        badgeType: "backlog",
      });
      seenIds.add(gem.id);
    }

    // 5. Most Played All-Time
    const byPlaytime = [...games]
      .filter((g) => !seenIds.has(g.id))
      .sort((a, b) => parsePlayTime(b.playTime) - parsePlayTime(a.playTime));
    if (byPlaytime.length > 0 && parsePlayTime(byPlaytime[0].playTime) > 0) {
      const favorite = byPlaytime[0];
      deck.push({
        id: `mostPlayed-${favorite.id}`,
        categoryKey: "home.spotlight.mostPlayed",
        game: favorite,
        badgeType: "mostPlayed",
      });
      seenIds.add(favorite.id);
    }

    // Fallback if deck is empty
    if (deck.length === 0 && games.length > 0) {
      deck.push({
        id: `default-${games[0].id}`,
        categoryKey: "home.spotlight.continue",
        game: games[0],
        badgeType: "continue",
      });
    }

    return deck;
  }, [games, runningGameIds, customSpotlight]);

  // Keep active index within bounds
  const currentSpotlight = spotlightDeck[activeIndex] ?? spotlightDeck[0] ?? null;
  const activeGame = currentSpotlight?.game ?? null;

  // SteamGridDB community hero art — animated preferred, falling back to the
  // game's own banner / cover for the spotlight card.
  const sgdb = useSteamGridArt(activeGame?.steamAppId);
  const [sgdbHeroFailed, setSgdbHeroFailed] = useState(false);
  const sgdbHeroUrl =
    (sgdb?.heroAnimatedUrl ?? sgdb?.heroUrl) && activeGame && !sgdbHeroFailed
      ? (sgdb?.heroAnimatedUrl ?? sgdb?.heroUrl)
      : null;
  const spotlightPoster =
    sgdbHeroUrl ?? activeGame?.bannerUrl ?? activeGame?.coverArtUrl ?? null;

  // Auto-advance spotlight every 8 seconds if not paused
  useEffect(() => {
    if (isPaused || spotlightDeck.length <= 1) return;
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % spotlightDeck.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [isPaused, spotlightDeck.length]);

  const handlePrev = useCallback(() => {
    setActiveIndex((prev) => (prev - 1 + spotlightDeck.length) % spotlightDeck.length);
  }, [spotlightDeck.length]);

  const handleNext = useCallback(() => {
    setActiveIndex((prev) => (prev + 1) % spotlightDeck.length);
  }, [spotlightDeck.length]);

  // "Surprise Me" random game generator
  const handleSurpriseMe = useCallback(() => {
    if (games.length === 0) return;
    setRollingDice(true);
    setTimeout(() => {
      const candidates = games.filter((g) => g.installed !== false);
      const pool = candidates.length > 0 ? candidates : games;
      const picked = pool[Math.floor(Math.random() * pool.length)];
      setCustomSpotlight(picked);
      setActiveIndex(0);
      setRollingDice(false);
      showToast(t("home.spotlight.surpriseToast", { name: picked.name }), "success");
    }, 450);
  }, [games, showToast, t]);

  const isRunning = activeGame ? runningGameIds.includes(activeGame.id) : false;
  const elapsedSec = activeGame ? liveElapsed[activeGame.id] ?? 0 : 0;

  const handleOpenActiveGame = () => {
    if (activeGame && onOpenGame) onOpenGame(activeGame);
  };

  const handleLaunch = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (activeGame) launchGame(activeGame);
  };

  // Collage covers
  const collage = useMemo(
    () =>
      games
        .filter((g) => g.coverArtUrl)
        .slice(0, 10)
        .map((g) => g.coverArtUrl as string),
    [games]
  );

  // Subtitle text
  const subtitle =
    stats.total === 0
      ? t("home.empty.subtitle")
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

  // Empty library welcome hero
  if (games.length === 0) {
    return (
      <section className="home-hero home-hero--empty" aria-label={t("home.empty.title")}>
        <div className="home-hero__mesh" aria-hidden />
        <div className="home-hero__veil" aria-hidden />
        <div className="home-hero__empty-content">
          <p className="home-hero__eyebrow">{t("page.library.yourGames")}</p>
          <h1 className="home-hero__title">
            {t("home.empty.title")}
            <span className="home-hero__title-accent">.</span>
          </h1>
          <p className="home-hero__subtitle">{subtitle}</p>

          <div className="home-hero__empty-cards">
            <button
              type="button"
              className="home-empty-card"
              onClick={() => navigate("/settings?tab=integrations")}
            >
              <div className="home-empty-card__icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 14.93V18a1 1 0 0 1-2 0v-1.07A6 6 0 0 1 6.07 12H5a1 1 0 0 1 0-2h1.07A6 6 0 0 1 11 4.07V3a1 1 0 0 1 2 0v1.07A6 6 0 0 1 17.93 10H19a1 1 0 0 1 0 2h-1.07A6 6 0 0 1 13 16.93z" />
                </svg>
              </div>
              <div className="home-empty-card__text">
                <span className="home-empty-card__title">{t("home.empty.importSteam")}</span>
                <span className="home-empty-card__desc">Integrations / Cloud</span>
              </div>
            </button>

            <button
              type="button"
              className="home-empty-card"
              onClick={() => navigate("/library?add=true")}
            >
              <div className="home-empty-card__icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
              </div>
              <div className="home-empty-card__text">
                <span className="home-empty-card__title">{t("home.empty.addLocal")}</span>
                <span className="home-empty-card__desc">Executable / ROMs</span>
              </div>
            </button>

            <button
              type="button"
              className="home-empty-card"
              onClick={() => navigate("/store")}
            >
              <div className="home-empty-card__icon" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                  <polyline points="17 6 23 6 23 12" />
                </svg>
              </div>
              <div className="home-empty-card__text">
                <span className="home-empty-card__title">{t("home.empty.exploreStore")}</span>
                <span className="home-empty-card__desc">IGDB Catalog & Deals</span>
              </div>
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className="home-hero"
      aria-label={t("library.overviewAria")}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div className="home-hero__mesh" aria-hidden />
      {collage.length > 0 && (
        <div className="home-hero__collage ui-complete-only" aria-hidden>
          {collage.map((src, i) => (
            <img key={i} src={src} alt="" loading="lazy" />
          ))}
        </div>
      )}
      <div className="home-hero__veil" aria-hidden />

      <div className="home-hero__grid">
        {/* Left Column: Greeting, dynamic stats, actions & spotlight selector */}
        <div className="home-hero__content">
          <p className="home-hero__eyebrow fade-up" style={{ ["--d" as string]: "60ms" }}>
            {t("page.library.yourGames")}
          </p>

          <h1 className="home-hero__title fade-up" style={{ ["--d" as string]: "140ms" }}>
            {t(greetingKey)}
            <span className="home-hero__title-accent" aria-hidden>.</span>
          </h1>

          <p className="home-hero__subtitle fade-up" style={{ ["--d" as string]: "200ms" }}>
            {subtitle}
          </p>

          {/* Spotlight candidate selector pills */}
          {spotlightDeck.length > 1 && (
            <div className="home-hero__spotlight-pills fade-up ui-complete-only" style={{ ["--d" as string]: "260ms" }}>
              {spotlightDeck.map((item, idx) => {
                const isItemActive = idx === activeIndex;
                const isItemRunning = runningGameIds.includes(item.game.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`home-hero__pill${isItemActive ? " is-active" : ""}${
                      isItemRunning ? " is-running" : ""
                    }`}
                    onClick={() => setActiveIndex(idx)}
                    title={item.game.name}
                  >
                    {isItemRunning && <span className="home-hero__pill-dot" aria-hidden />}
                    <span className="home-hero__pill-label">{t(item.categoryKey)}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Quick Action buttons */}
          <div className="home-hero__actions fade-up" style={{ ["--d" as string]: "320ms" }}>
            <button
              type="button"
              className="home-hero__btn home-hero__btn--primary"
              onClick={handleLaunch}
              disabled={!activeGame}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              {isRunning
                ? t("game.resume")
                : activeGame
                  ? t("game.play")
                  : t("lib.hero.browseStore")}
            </button>

            {activeGame && (
              <button
                type="button"
                className="home-hero__btn home-hero__btn--ghost"
                onClick={handleOpenActiveGame}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                {t("home.spotlight.inspect")}
              </button>
            )}

            <button
              type="button"
              className={`home-hero__btn home-hero__btn--dice ui-complete-only${rollingDice ? " rolling" : ""}`}
              onClick={handleSurpriseMe}
              title={t("home.spotlight.surprise")}
              aria-label={t("home.spotlight.surprise")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" />
                <circle cx="15.5" cy="8.5" r="1.5" fill="currentColor" />
                <circle cx="15.5" cy="15.5" r="1.5" fill="currentColor" />
                <circle cx="8.5" cy="15.5" r="1.5" fill="currentColor" />
                <circle cx="12" cy="12" r="1.5" fill="currentColor" />
              </svg>
              <span>{t("home.spotlight.surprise")}</span>
            </button>
          </div>
        </div>

        {/* Right Column: Cinematic Spotlight Card with carousel arrows */}
        {activeGame && currentSpotlight && (
          <div className="home-spotlight-wrapper fade-up" style={{ ["--d" as string]: "200ms" }}>
            <div
              className={`home-spotlight${isRunning ? " is-running" : ""}`}
              role="button"
              tabIndex={0}
              onClick={handleOpenActiveGame}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleOpenActiveGame();
                }
              }}
              aria-label={activeGame.name}
            >
              <div className="home-spotlight__cover">
                {activeGame.videos && activeGame.videos.length > 0 ? (
                  <HeroTrailer src={activeGame.videos[0]} poster={spotlightPoster ?? undefined} autoplay />
                ) : spotlightPoster ? (
                  <img
                    src={spotlightPoster}
                    alt={activeGame.name}
                    loading="lazy"
                    onError={sgdbHeroUrl ? () => setSgdbHeroFailed(true) : undefined}
                  />
                ) : (
                  <div className="home-spotlight__placeholder">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                  </div>
                )}

                <div className="home-spotlight__scrim" aria-hidden />

                {/* Category Chip */}
                <span className={`home-spotlight__chip home-spotlight__chip--${currentSpotlight.badgeType}`}>
                  {isRunning ? (
                    <span className="home-spotlight__live-pulse" aria-hidden />
                  ) : (
                    <svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11" aria-hidden>
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  )}
                  {isRunning ? t("home.spotlight.running") : t(currentSpotlight.categoryKey)}
                </span>

                {/* Quick-play FAB */}
                <button
                  type="button"
                  className={`home-spotlight__play${isRunning ? " running" : ""}`}
                  onClick={handleLaunch}
                  aria-label={
                    isRunning
                      ? t("game.resumeAria", { name: activeGame.name })
                      : t("game.playAria", { name: activeGame.name })
                  }
                  title={isRunning ? t("game.resume") : t("game.play")}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                </button>

                {/* Overlay body */}
                <div className="home-spotlight__body">
                  <h2 className="home-spotlight__name" title={activeGame.name}>
                    {activeGame.name}
                  </h2>
                  {activeGame.developer && (
                    <p className="home-spotlight__dev">
                      {t("bigscreen.spotlight.byDeveloper", { developer: activeGame.developer })}
                    </p>
                  )}
                  <div className="home-spotlight__meta">
                    <span className="home-spotlight__meta-item">{activeGame.platform}</span>

                    {isRunning && elapsedSec > 0 ? (
                      <span className="home-spotlight__meta-item home-spotlight__meta-item--live">
                        <span className="home-spotlight__live-pulse" aria-hidden />
                        {Math.floor(elapsedSec / 60)}m active
                      </span>
                    ) : activeGame.playTime ? (
                      <span className="home-spotlight__meta-item">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                        {activeGame.playTime}
                      </span>
                    ) : null}

                    {(activeGame.igdbRating ?? activeGame.criticRating ?? 0) > 0 && (
                      <span className="home-spotlight__meta-item home-spotlight__meta-item--rating">
                        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                        </svg>
                        {Math.round(activeGame.igdbRating ?? activeGame.criticRating ?? 0)}%
                      </span>
                    )}

                    <HomeSteamPlayerChip game={activeGame} />
                  </div>
                </div>
              </div>

              {/* Friends strip */}
              <div className="home-spotlight__friends">
                <FriendsPlayingStrip gameName={activeGame.name} gameId={activeGame.id} />
              </div>
            </div>

            {/* Carousel navigation controls */}
            {spotlightDeck.length > 1 && (
              <div className="home-spotlight__controls" aria-label="Spotlight carousel controls">
                <button
                  type="button"
                  className="home-spotlight__arrow"
                  onClick={handlePrev}
                  title={t("home.spotlight.prev")}
                  aria-label={t("home.spotlight.prev")}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>

                <div className="home-spotlight__dots">
                  {spotlightDeck.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`home-spotlight__dot${i === activeIndex ? " is-active" : ""}`}
                      onClick={() => setActiveIndex(i)}
                      aria-label={`Slide ${i + 1}`}
                    />
                  ))}
                </div>

                <button
                  type="button"
                  className="home-spotlight__arrow"
                  onClick={handleNext}
                  title={t("home.spotlight.next")}
                  aria-label={t("home.spotlight.next")}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function HomeSteamPlayerChip({ game }: { game: Game }) {
  const { appId: resolvedAppId } = useSteamAppId(game);
  const steamAppId = typeof resolvedAppId === "number" ? resolvedAppId : game.steamAppId ?? null;
  if (!steamAppId) return null;
  return <PlayerCountBadge appId={steamAppId} className="home-spotlight__player-badge" />;
}