// Home — the landing surface of Big Screen Mode.
//
// One hero + two shelves (Continue playing, Recently added). The
// layout preset changes the composition, not the content: Xbox gets a
// dashboard band, PlayStation a full-bleed cinematic hero, Steam a
// compact banner above dense poster shelves, Switch a flat tile grid,
// Classic the spotlight the app shipped with. All of that is CSS keyed
// off `[data-preset]` on the shell root.
//
// The hero follows the card the controller is on (`data-game-id` on
// focusable cards), so browsing a shelf previews the game above it
// without a second click.

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { extractYear, formatLastPlayedLocalized, truncate } from "./bigscreenFormat";

export default function BigScreenHome() {
  const { t } = useLanguage();
  const { games, launchGame, runningGameIds } = useGames();
  const gamepad = useGamepad();
  const navigate = useNavigate();

  const continuePlaying = useMemo(
    () =>
      [...games]
        .filter((game) => (game.lastPlayed ?? 0) > 0)
        .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
        .slice(0, 12),
    [games],
  );

  const recentlyAdded = useMemo(
    () =>
      [...games]
        .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))
        .slice(0, 12),
    [games],
  );

  const initialFeatured = useMemo(
    () => continuePlaying[0] ?? recentlyAdded[0] ?? games[0] ?? null,
    [continuePlaying, recentlyAdded, games],
  );

  const [selectedGame, setSelectedGame] = useState<Game | null>(initialFeatured);
  const [activeRailId, setActiveRailId] = useState<string>(
    continuePlaying.length > 0 ? "continue-playing" : "recently-added",
  );

  useEffect(() => {
    if (continuePlaying.length === 0 && activeRailId === "continue-playing") {
      setActiveRailId("recently-added");
    }
  }, [continuePlaying, activeRailId]);

  useEffect(() => {
    if (!selectedGame && initialFeatured) setSelectedGame(initialFeatured);
  }, [initialFeatured, selectedGame]);

  const featuredGame = useMemo(() => {
    if (!selectedGame) return null;
    return games.find((game) => game.id === selectedGame.id) ?? selectedGame;
  }, [games, selectedGame]);

  const gamesById = useMemo(() => {
    const map = new Map<string, Game>();
    for (const game of games) map.set(game.id, game);
    return map;
  }, [games]);

  // Promote the focused card to the hero. Rails tag their cards with
  // `data-game-id`; shell chrome never does.
  useEffect(() => {
    const element = gamepad.focusedElement;
    if (!element) return;
    const id = element.getAttribute("data-game-id");
    if (!id) return;
    const game = gamesById.get(id);
    if (game && game.id !== selectedGame?.id) setSelectedGame(game);
    const railId = element.closest("[data-rail-id]")?.getAttribute("data-rail-id");
    if (railId) setActiveRailId(railId);
  }, [gamepad.focusedElement, gamesById, selectedGame]);

  const isRunning = featuredGame ? runningGameIds.includes(featuredGame.id) : false;
  const status = featuredGame
    ? PLAY_STATUS_DETAILS[featuredGame.playStatus || "backlog"]
    : null;
  const releaseYear = featuredGame ? extractYear(featuredGame.releaseDate) : null;
  const backdrop = useGameBackdropArt(featuredGame);

  const handlePlay = useCallback(() => {
    if (featuredGame) launchGame(featuredGame);
  }, [featuredGame, launchGame]);

  const handleDetails = useCallback(() => {
    if (featuredGame) navigate(`/library/${featuredGame.id}`);
  }, [featuredGame, navigate]);

  const playProps = useFocusable(handlePlay);
  const detailsProps = useFocusable(handleDetails);

  const facts = useMemo(() => {
    if (!featuredGame) return [];
    const items: Array<{ label: string; value: string }> = [
      { label: t("hero.playTime"), value: featuredGame.playTime || "0h" },
    ];
    if (featuredGame.lastPlayed) {
      items.push({
        label: t("game.lastPlayed"),
        value: formatLastPlayedLocalized(featuredGame.lastPlayed, t),
      });
    }
    if (status) items.push({ label: t("hero.status"), value: t(status.labelKey) });
    if (releaseYear) {
      items.push({ label: t("gameInfo.releaseDate"), value: String(releaseYear) });
    }
    return items;
  }, [featuredGame, status, releaseYear, t]);

  return (
    <div className="bs-home">
      <BigScreenDashboardBackdrop
        staticUrl={backdrop.staticUrl}
        animatedUrl={backdrop.animatedUrl}
        artKey={featuredGame?.id ?? null}
      />

      <div className="bs-home-scroll">
        <section
          className="bs-home-hero"
          data-empty={featuredGame ? undefined : "true"}
          aria-label={
            featuredGame
              ? t("bigscreen.spotlight.featuredGame")
              : t("bigscreen.home.welcome")
          }
        >
          <div
            className="bs-home-hero-art"
            style={
              backdrop.staticUrl
                ? { backgroundImage: `url("${backdrop.staticUrl}")` }
                : undefined
            }
            aria-hidden="true"
          />
          <div className="bs-home-hero-veil" aria-hidden="true" />

          <div className="bs-home-hero-copy">
            <span className="bs-home-eyebrow">
              {t(
                activeRailId === "continue-playing"
                  ? "lib.rail.continue.title"
                  : "lib.rail.recentlyAdded.title",
              )}
            </span>

            {featuredGame?.logoUrl ? (
              <img
                className="bs-home-logo"
                src={featuredGame.logoUrl}
                alt={gameDisplayName(featuredGame)}
              />
            ) : (
              <h1 className="bs-home-title">
                {featuredGame
                  ? gameDisplayName(featuredGame)
                  : t("bigscreen.home.welcome")}
              </h1>
            )}

            {featuredGame ? (
              <>
                <div className="bs-home-meta">
                  <BigScreenPill tone="accent" size="sm">
                    {featuredGame.platform}
                  </BigScreenPill>
                  {status ? (
                    <BigScreenPill
                      tone="muted"
                      size="sm"
                      dot
                      customColor={status.color}
                    >
                      {t(status.labelKey)}
                    </BigScreenPill>
                  ) : null}
                  {releaseYear ? (
                    <BigScreenPill tone="muted" size="sm">
                      {releaseYear}
                    </BigScreenPill>
                  ) : null}
                </div>

                {featuredGame.description ? (
                  <p className="bs-home-description">
                    {truncate(featuredGame.description, 210)}
                  </p>
                ) : null}

                <div className="bs-home-actions">
                  <button
                    {...playProps}
                    type="button"
                    className="bs-btn bs-btn--primary"
                    onClick={handlePlay}
                    disabled={isRunning}
                    data-primary-action="true"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <polygon points="6 4 20 12 6 20 6 4" />
                    </svg>
                    {isRunning ? t("game.running") : t("game.play")}
                  </button>
                  <button
                    {...detailsProps}
                    type="button"
                    className="bs-btn bs-btn--ghost"
                    onClick={handleDetails}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 16v-4M12 8h.01" />
                    </svg>
                    {t("bigscreen.home.gameHub")}
                  </button>
                </div>

                <dl className="bs-home-facts">
                  {facts.map((fact) => (
                    <div key={fact.label} className="bs-home-fact">
                      <dt>{fact.label}</dt>
                      <dd>{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : (
              <>
                <p className="bs-home-description">
                  {t("bigscreen.home.welcomeDesc")}
                </p>
                <div className="bs-home-actions">
                  <button
                    type="button"
                    className="bs-btn bs-btn--primary"
                    onClick={() => navigate("/library")}
                  >
                    {t("nav.library")}
                  </button>
                </div>
              </>
            )}
          </div>
        </section>

        <div className="bs-home-rows">
          {continuePlaying.length > 0 ? (
            <BigScreenRail
              title={t("lib.rail.continue.title")}
              games={continuePlaying}
              onCardClick={handleDetails}
              railId="continue-playing"
              isActive={activeRailId === "continue-playing"}
            />
          ) : null}

          {recentlyAdded.length > 0 ? (
            <BigScreenRail
              title={t("lib.rail.recentlyAdded.title")}
              games={recentlyAdded}
              onCardClick={handleDetails}
              railId="recently-added"
              isActive={activeRailId === "recently-added"}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
