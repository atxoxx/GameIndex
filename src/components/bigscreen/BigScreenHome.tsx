import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";
import { useGames } from "../../context/GameContext";
import { useFocusable } from "../../hooks/useFocusable";
import { useGamepad } from "../../hooks/GamepadProvider";
import { PLAY_STATUS_DETAILS } from "../../types/game";
import type { Game } from "../../types/game";
import BigScreenRail from "../library/BigScreenRail";
import BigScreenPill from "./BigScreenPill";
import { extractYear } from "./bigscreenFormat";

export default function BigScreenHome() {
  const { t } = useLanguage();
  const { games, launchGame, runningGameIds } = useGames();
  const gamepad = useGamepad();
  const navigate = useNavigate();

  const [logoError, setLogoError] = useState(false);

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

  useEffect(() => {
    setLogoError(false);
  }, [selectedGame?.id]);

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

  const renderDetailsPane = (railId: string) => {
    if (activeRailId !== railId) return null;
    return (
      <div className="bigscreen-dashboard-details-pane animate-fade-in" style={{ padding: "0 64px 24px 64px" }}>
        <div className="bigscreen-details-pane-content">
          {featuredGame ? (
            <>
              <div className="bigscreen-details-logo-area">
                {featuredGame.logoUrl && !logoError ? (
                  <img
                    src={featuredGame.logoUrl}
                    alt={featuredGame.name}
                    className="bigscreen-details-logo"
                    onError={() => setLogoError(true)}
                  />
                ) : (
                  <h2 className="bigscreen-details-title">{featuredGame.name}</h2>
                )}
              </div>

              <div className="bigscreen-details-meta">
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
              </div>

              {/* Always rendered so the reserved description slot keeps
                  the actions row stable while navigating between games. */}
              <p className="bigscreen-details-description">
                {featuredGame.description
                  ? featuredGame.description.length > 200
                    ? `${featuredGame.description.substring(0, 200)}...`
                    : featuredGame.description
                  : ""}
              </p>

              <div className="bigscreen-details-actions">
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
              </div>
            </>
          ) : (
            <div className="bigscreen-details-placeholder">
              <h2 className="bigscreen-details-title">{t("bigscreen.home.welcome")}</h2>
              <p className="bigscreen-details-description">
                {t("bigscreen.home.welcomeDesc")}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="bigscreen-library-dashboard">
      {/* Backdrop */}
      <div className="bigscreen-dashboard-backdrop-container">
        {featuredGame && (
          <img
            key={featuredGame.id}
            src={featuredGame.bannerUrl || featuredGame.coverArtUrl || ""}
            alt=""
            className="bigscreen-dashboard-backdrop-img animate-fade-in"
          />
        )}
        <div className="bigscreen-dashboard-backdrop-overlay" />
      </div>

      <div className="bigscreen-dashboard-scrollable-content">
        {/* Shelves / Rails */}
        <div className="bigscreen-dashboard-main-rail">
          {continuePlaying.length > 0 && (
            <>
              {renderDetailsPane("continue-playing")}
              <BigScreenRail
                title={t("lib.rail.continue.title")}
                games={continuePlaying}
                onCardClick={handleDetails}
                railId="continue-playing"
              />
            </>
          )}

          <>
            {renderDetailsPane("recently-added")}
            <BigScreenRail
              title={t("lib.rail.recentlyAdded.title")}
              games={recentlyAdded.length > 0 ? recentlyAdded : games.slice(0, 12)}
              emptyLabel={t("bigscreen.library.noGamesDesc")}
              onCardClick={handleDetails}
              railId="recently-added"
            />
          </>
        </div>
      </div>
    </div>
  );
}
