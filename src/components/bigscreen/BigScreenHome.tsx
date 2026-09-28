import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";
import { useGames } from "../../context/GameContext";
import { useFocusable } from "../../hooks/useFocusable";
import { useGamepad } from "../../hooks/GamepadProvider";
import { useGameBackdropArt } from "../../hooks/useGameBackdropArt";
import { PLAY_STATUS_DETAILS, gameDisplayName } from "../../types/game";
import type { Game } from "../../types/game";
import BigScreenRail from "../library/BigScreenRail";
import BigScreenDashboardBackdrop from "./BigScreenDashboardBackdrop";
import BigScreenPill from "./BigScreenPill";
import BigScreenSpotlight, { type SpotlightFact } from "./BigScreenSpotlight";
import { extractYear, formatLastPlayed } from "./bigscreenFormat";

export default function BigScreenHome() {
  const { t } = useLanguage();
  const { games, launchGame, runningGameIds } = useGames();
  const gamepad = useGamepad();
  const navigate = useNavigate();


  // Compute game lists
  const continuePlaying = useMemo(() => {
    return [...games]
      .filter((g) => g.lastPlayed && g.lastPlayed > 0)
      .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
      .slice(0, 12);
  }, [games]);

  const recentlyAdded = useMemo(() => {
    return [...games]
      .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
      .slice(0, 12);
  }, [games]);

  const initialFeatured = useMemo(() => {
    return continuePlaying[0] ?? recentlyAdded[0] ?? games[0] ?? null;
  }, [continuePlaying, recentlyAdded, games]);

  const [selectedGame, setSelectedGame] = useState<Game | null>(initialFeatured);
  const [activeRailId, setActiveRailId] = useState<string>(
    continuePlaying.length > 0 ? "continue-playing" : "recently-added"
  );

  useEffect(() => {
    if (continuePlaying.length === 0 && activeRailId === "continue-playing") {
      setActiveRailId("recently-added");
    }
  }, [continuePlaying, activeRailId]);

  // Sync selected game on load or when library initialFeatured changes
  useEffect(() => {
    if (!selectedGame && initialFeatured) {
      setSelectedGame(initialFeatured);
    }
  }, [initialFeatured, selectedGame]);

  // Keep selectedGame reference fresh from games list
  const featuredGame = useMemo(() => {
    if (!selectedGame) return null;
    return games.find((g) => g.id === selectedGame.id) ?? selectedGame;
  }, [games, selectedGame]);

  // Flat lookup for spotlight updates based on spatial focus
  const allGamesById = useMemo(() => {
    const map = new Map<string, Game>();
    for (const g of games) map.set(g.id, g);
    return map;
  }, [games]);

  // Spotlight follows spatial focus: when the controller lands on a
  // game card in either rail, promote it to the details pane.
  useEffect(() => {
    const el = gamepad.focusedElement;
    if (!el) return;
    const id = el.getAttribute("data-game-id");
    if (id) {
      const game = allGamesById.get(id);
      if (game && game.id !== selectedGame?.id) {
        setSelectedGame(game);
      }

      const railEl = el.closest("[data-rail-id]");
      if (railEl) {
        const rId = railEl.getAttribute("data-rail-id");
        if (rId) {
          setActiveRailId(rId);
        }
      }
    }
  }, [gamepad.focusedElement, allGamesById, selectedGame]);

  const isRunning = featuredGame ? runningGameIds.includes(featuredGame.id) : false;
  const status = featuredGame
    ? PLAY_STATUS_DETAILS[featuredGame.playStatus || "backlog"]
    : null;
  const releaseYear = featuredGame ? extractYear(featuredGame.releaseDate) : null;

  // Animated hero art for the currently spotlighted game. Falls back to
  // the banner/cover while SteamGridDB resolves (or when no animated
  // upload exists).
  const backdrop = useGameBackdropArt(featuredGame);

  const handlePlay = useCallback(() => {
    if (featuredGame) {
      launchGame(featuredGame);
    }
  }, [featuredGame, launchGame]);

  const handleDetails = useCallback(() => {
    if (featuredGame) {
      navigate(`/library/${featuredGame.id}`);
    }
  }, [featuredGame, navigate]);

  const playProps = useFocusable(handlePlay);
  const detailsProps = useFocusable(handleDetails);

  // The spotlight is anchored above every rail and simply follows the
  // focused card. Rendering it per-rail (the old approach) made the whole
  // dashboard jump by the pane's height whenever vertical navigation
  // moved between rails.
  const spotlightFacts = useMemo<SpotlightFact[]>(() => {
    if (!featuredGame) return [];
    const facts: SpotlightFact[] = [
      { label: t("hero.playTime"), value: featuredGame.playTime || "0h" },
    ];
    if (featuredGame.lastPlayed) {
      facts.push({
        label: t("game.lastPlayed"),
        value: formatLastPlayed(featuredGame.lastPlayed),
      });
    }
    if (status) {
      facts.push({ label: t("hero.status"), value: t(status.labelKey) });
    }
    if (releaseYear) {
      facts.push({ label: t("gameInfo.releaseDate"), value: String(releaseYear) });
    }
    return facts;
  }, [featuredGame, status, releaseYear, t]);

  const renderSpotlight = () => {
    if (!featuredGame) {
      return (
        <section className="bigscreen-spotlight animate-fade-in">
          <div className="bigscreen-spotlight-info">
            <span className="bigscreen-spotlight-eyebrow">
              {t("bigscreen.spotlight.welcomeLib")}
            </span>
            <h1 className="bigscreen-spotlight-title">
              {t("bigscreen.home.welcome")}
            </h1>
            <p className="bigscreen-spotlight-description">
              {t("bigscreen.home.welcomeDesc")}
            </p>
          </div>
        </section>
      );
    }

    const eyebrowKey =
      activeRailId === "continue-playing"
        ? "lib.rail.continue.title"
        : "lib.rail.recentlyAdded.title";

    return (
      <BigScreenSpotlight
        eyebrow={t(eyebrowKey)}
        title={gameDisplayName(featuredGame)}
        logoUrl={featuredGame.logoUrl}
        ariaLabel={t("bigscreen.spotlight.featuredGame")}
        facts={spotlightFacts}
        description={
          featuredGame.description
            ? featuredGame.description.length > 200
              ? `${featuredGame.description.substring(0, 200)}...`
              : featuredGame.description
            : ""
        }
        meta={
          <>
            <BigScreenPill tone="accent" size="sm">
              {featuredGame.platform}
            </BigScreenPill>
            {status && (
              <BigScreenPill tone="muted" size="sm" dot customColor={status.color}>
                {t(status.labelKey)}
              </BigScreenPill>
            )}
            {releaseYear && (
              <BigScreenPill tone="muted" size="sm">
                {releaseYear}
              </BigScreenPill>
            )}
          </>
        }
        actions={
          <>
            <button
              type="button"
              className="bigscreen-details-btn bigscreen-details-btn--primary"
              {...playProps}
              disabled={isRunning}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                <polygon points="6 4 20 12 6 20 6 4" />
              </svg>
              <span>{isRunning ? t("game.running") : t("game.play")}</span>
            </button>
            <button
              type="button"
              className="bigscreen-details-btn bigscreen-details-btn--secondary"
              {...detailsProps}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <span>{t("bigscreen.home.gameHub")}</span>
            </button>
          </>
        }
      />
    );
  };

  return (
    <div className="bigscreen-library-dashboard">
      {/* Backdrop */}
      <BigScreenDashboardBackdrop
        staticUrl={backdrop.staticUrl}
        animatedUrl={backdrop.animatedUrl}
        artKey={featuredGame?.id ?? null}
      />

      <div className="bigscreen-dashboard-scrollable-content">
        {/* Shelves / Rails */}
        <div className="bigscreen-dashboard-main-rail">
          {renderSpotlight()}

          {continuePlaying.length > 0 && (
            <BigScreenRail
              title={t("lib.rail.continue.title")}
              games={continuePlaying}
              onCardClick={handleDetails}
              railId="continue-playing"
              isActive={activeRailId === "continue-playing"}
            />
          )}

          <BigScreenRail
            title={t("lib.rail.recentlyAdded.title")}
            games={recentlyAdded.length > 0 ? recentlyAdded : games.slice(0, 12)}
            emptyLabel={t("bigscreen.library.noGamesDesc")}
            onCardClick={handleDetails}
            railId="recently-added"
            isActive={activeRailId === "recently-added"}
          />
        </div>
      </div>
    </div>
  );
}
