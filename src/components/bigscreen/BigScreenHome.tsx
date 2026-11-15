// Home — the landing surface of Big Screen Mode.
//
// Data is shared by every preset: Continue playing, Recently added, a
// deduped hero pool (the PlayStation carousel / Switch recent row) and
// the capped all-software list behind the Switch wall. Only the
// composition changes, and that lives in `[data-preset]` CSS plus the
// shared `BigScreenSelectionPreview`.
//
// Selection: `useFocusedGame` re-resolves the remembered card id
// against the current lists on every render, so the panel can never
// pin a game that was removed by a launch or a resort. Cards activate
// their own id — the featured game is only ever the Game Hub target.
//
// PlayStation owns the square games carousel inside its hero, so its
// page below the hero carries a single shelf; the other presets keep
// the two rails the dashboard shipped with.

import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";
import { useGames } from "../../context/GameContext";
import { useActivePreset } from "../../context/BigScreenPrefsContext";
import { useFocusable } from "../../hooks/useFocusable";
import { useGameBackdropArt } from "../../hooks/useGameBackdropArt";
import { PLAY_STATUS_DETAILS, gameDisplayName } from "../../types/game";
import type { Game } from "../../types/game";
import BigScreenRail from "../library/BigScreenRail";
import BigScreenDashboardBackdrop from "./BigScreenDashboardBackdrop";
import BigScreenPill from "./BigScreenPill";
import GameGrid from "./GameGrid";
import BigScreenSelectionPreview from "./selection/BigScreenSelectionPreview";
import { useFocusedGame } from "./selection/useFocusedGame";
import { extractYear, formatLastPlayedLocalized } from "./bigscreenFormat";

/** Keep the first occurrence of each game; the shelf pools overlap. */
function dedupeById(games: Game[]): Game[] {
  const seen = new Set<string>();
  const out: Game[] = [];
  for (const game of games) {
    if (seen.has(game.id)) continue;
    seen.add(game.id);
    out.push(game);
  }
  return out;
}

export default function BigScreenHome() {
  const { t } = useLanguage();
  const { games, launchGame, runningGameIds } = useGames();
  const navigate = useNavigate();
  const preset = useActivePreset();
  const presetId = preset.id;

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

  const homePool = useMemo(
    () => dedupeById([...continuePlaying, ...recentlyAdded]),
    [continuePlaying, recentlyAdded],
  );

  /** The carousel inside the hero: one entry per game, newest first. */
  const heroRow = useMemo(() => homePool.slice(0, 10), [homePool]);

  /** Switch's wall: the whole library, capped so the grid stays cheap. */
  const allSoftware = useMemo(() => games.slice(0, 24), [games]);

  // The controller can land on a shelf card or on the Switch wall, so
  // the selection pool is their union: every reachable card resolves.
  const selectionPool = useMemo(
    () => dedupeById([...homePool, ...allSoftware]),
    [homePool, allSoftware],
  );

  const { item: featuredGame, railId } = useFocusedGame({
    items: selectionPool,
    getId: (game) => game.id,
  });

  const isRunning = featuredGame ? runningGameIds.includes(featuredGame.id) : false;
  const status = featuredGame
    ? PLAY_STATUS_DETAILS[featuredGame.playStatus || "backlog"]
    : null;
  const releaseYear = featuredGame ? extractYear(featuredGame.releaseDate) : null;
  const backdrop = useGameBackdropArt(featuredGame);

  const openGame = useCallback(
    (game: Game) => {
      navigate(`/library/${game.id}`);
    },
    [navigate],
  );

  const handlePlay = useCallback(() => {
    if (featuredGame) launchGame(featuredGame);
  }, [featuredGame, launchGame]);

  // Only the hero's Game Hub button may use this: a card press always
  // activates that card, never the previously featured game.
  const handleDetails = useCallback(() => {
    if (featuredGame) navigate(`/library/${featuredGame.id}`);
  }, [featuredGame, navigate]);

  const playProps = useFocusable(handlePlay);
  const detailsProps = useFocusable(handleDetails);
  // The welcome hero is the whole page when the library is empty, so its
  // only action must be a controller focus stop too (same contract as the
  // Play / Game Hub buttons above).
  const browseLibraryProps = useFocusable(() => navigate("/library"));

  const isSwitch = presetId === "switch";
  const isPlaystation = presetId === "playstation";

  const eyebrow = useMemo(() => {
    switch (railId) {
      case "recently-added":
        return t("lib.rail.recentlyAdded.title");
      case "home-all":
        return t("bigscreen.home.allSoftware");
      case "continue-playing":
      case "home-row":
      case "home-recent":
        return t("lib.rail.continue.title");
      default:
        // Nothing focused yet (or the user is up in the chrome): the
        // hero is still a featured game, not a section.
        return t("bigscreen.spotlight.featuredGame");
    }
  }, [railId, t]);

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

  const selectionInfo = featuredGame
    ? {
        id: featuredGame.id,
        title: gameDisplayName(featuredGame),
        logoUrl: featuredGame.logoUrl,
        description: featuredGame.description,
        coverUrl: featuredGame.coverArtUrl,
      }
    : null;

  const meta = featuredGame ? (
    <>
      <BigScreenPill tone="accent" size="sm">
        {featuredGame.platform}
      </BigScreenPill>
      {status ? (
        <BigScreenPill tone="muted" size="sm" dot customColor={status.color}>
          {t(status.labelKey)}
        </BigScreenPill>
      ) : null}
      {releaseYear ? (
        <BigScreenPill tone="muted" size="sm">
          {releaseYear}
        </BigScreenPill>
      ) : null}
    </>
  ) : undefined;

  // The hero's Play is the page's entry point on the dashboard presets;
  // PlayStation and Switch enter on their first tile instead, which is
  // where those consoles start and keeps the hero following focus.
  const actions = featuredGame ? (
    <>
      <button
        {...playProps}
        type="button"
        className="bs-btn bs-btn--primary"
        onClick={handlePlay}
        disabled={isRunning}
        data-primary-action="true"
        data-bs-autofocus={isSwitch || isPlaystation ? undefined : "true"}
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
    </>
  ) : undefined;

  const empty = {
    title: t("bigscreen.home.welcome"),
    description: t("bigscreen.home.welcomeDesc"),
    actions: (
      <button
        {...browseLibraryProps}
        type="button"
        className="bs-btn bs-btn--primary"
        onClick={() => navigate("/library")}
        data-bs-autofocus="true"
      >
        {t("nav.library")}
      </button>
    ),
  };

  // PlayStation's hero already carries the continue ∪ recent carousel,
  // so only "Recently added" repeats usefully underneath it.
  const shelves = [
    {
      railId: "continue-playing",
      titleKey: "lib.rail.continue.title",
      games: continuePlaying,
    },
    {
      railId: "recently-added",
      titleKey: "lib.rail.recentlyAdded.title",
      games: recentlyAdded,
    },
  ].filter(
    (shelf) =>
      shelf.games.length > 0 && (!isPlaystation || shelf.railId === "recently-added"),
  );

  return (
    <div
      className="bs-home"
      data-preset={presetId}
      data-empty={featuredGame ? undefined : "true"}
    >
      {/* Switch is flat by design: its art is the tiles. */}
      {isSwitch ? null : (
        <BigScreenDashboardBackdrop
          staticUrl={backdrop.staticUrl}
          animatedUrl={backdrop.animatedUrl}
          artKey={featuredGame?.id ?? null}
        />
      )}

      <div className="bs-home-scroll">
        {isSwitch ? (
          <>
            {heroRow.length > 0 ? (
              <BigScreenRail
                title={t("lib.rail.continue.title")}
                games={heroRow}
                onCardClick={openGame}
                railId="home-recent"
                isActive={railId === "home-recent"}
                hideHeader
              />
            ) : null}

            <div className="bs-home-featured">
              <BigScreenSelectionPreview
                preset={presetId}
                variant="inline"
                info={selectionInfo}
                eyebrow={eyebrow}
                meta={meta}
                actions={actions}
                empty={empty}
              />
            </div>

            <section className="bs-home-all" aria-label={t("bigscreen.home.allSoftware")}>
              <div className="bs-home-section-head">
                <h2 className="bs-home-section-title">
                  {t("bigscreen.home.allSoftware")}
                </h2>
                <span className="bs-home-section-count">{allSoftware.length}</span>
              </div>
              <GameGrid
                games={allSoftware}
                railId="home-all"
                onSelect={openGame}
                emptyState={
                  <div className="bigscreen-library-empty-state">
                    <h3>{t("bigscreen.library.noGamesDesc")}</h3>
                  </div>
                }
              />
            </section>
          </>
        ) : (
          <>
            <BigScreenSelectionPreview
              preset={presetId}
              variant="hero"
              info={selectionInfo}
              eyebrow={eyebrow}
              meta={meta}
              facts={facts}
              actions={actions}
              backdrop={{
                staticUrl: backdrop.staticUrl,
                animatedUrl: backdrop.animatedUrl,
                artKey: featuredGame?.id ?? null,
              }}
              row={
                isPlaystation && heroRow.length > 0 ? (
                  <BigScreenRail
                    title={t("lib.rail.continue.title")}
                    games={heroRow}
                    onCardClick={openGame}
                    railId="home-row"
                    hideHeader
                  />
                ) : undefined
              }
              empty={empty}
            />

            <div className="bs-home-rows">
              {shelves.map((shelf) => (
                <BigScreenRail
                  key={shelf.railId}
                  title={t(shelf.titleKey)}
                  games={shelf.games}
                  onCardClick={openGame}
                  railId={shelf.railId}
                  isActive={railId === shelf.railId}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
