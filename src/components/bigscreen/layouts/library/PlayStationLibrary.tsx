// PlayStation layout - cinematic carousel library.
//
// The focused game's artwork fills the stage, its identity and
// description sit beneath the carousel, and the full collection is
// still reachable as a wide grid further down. Horizontal navigation
// is the primary gesture; the grid is the fallback for large libraries.

import { useLanguage } from "../../../../context/LanguageContext";
import { extractYear } from "../../bigscreenFormat";
import HeroIdentity from "../HeroIdentity";
import HomeHeroActions from "../HomeHeroActions";
import { GameShelf } from "../shared";
import TileGrid from "./TileGrid";
import type { LibraryLayoutProps } from "./types";

export default function PlayStationLibrary({
  games,
  total,
  focused,
  isRunning,
  filters,
  empty,
  onSelect,
  onPlay,
  autoFocusFirst,
}: LibraryLayoutProps) {
  const { t } = useLanguage();
  const year = focused ? extractYear(focused.releaseDate) : null;
  const stage = games.slice(0, 30);

  return (
    <div
      className="bst-library bst-library--playstation"
      data-layout="playstation"
    >
      {focused ? (
        <div className="bst-ps-backdrop" aria-hidden="true">
          {focused.bannerUrl || focused.coverArtUrl ? (
            <img
              key={focused.id}
              src={focused.bannerUrl ?? focused.coverArtUrl}
              alt=""
              decoding="async"
            />
          ) : null}
          <span className="bst-ps-backdrop-veil" />
        </div>
      ) : null}

      <header className="bst-library-head bst-library-head--ps">
        <div className="bst-library-heading">
          <span className="bst-eyebrow">{t("nav.library")}</span>
          <h1>{t("bigscreen.library.gameLibrary")}</h1>
          <p>
            {t("bigscreen.library.countOf", { count: games.length, total })}
          </p>
        </div>
        {filters}
      </header>

      <section className="bst-ps-stage">
        <GameShelf
          title={t("bigscreen.library.allGames")}
          games={stage}
          onSelect={onSelect}
          railId="library-carousel"
          variant="square"
          autoFocusFirst={autoFocusFirst}
          className="bst-shelf--inline bst-shelf--carousel"
        />

        {focused ? (
          <div className="bst-ps-info">
            <div className="bst-ps-info-copy">
              <HeroIdentity game={focused} />
              <p className="bst-ps-description">
                {focused.description || t("bigscreen.gameHub.noDescription")}
              </p>
              <span className="bst-ps-meta">
                {focused.platform}
                {year ? ` · ${year}` : ""}
                {focused.developer ? ` · ${focused.developer}` : ""}
                {focused.playTime ? ` · ${focused.playTime}` : ""}
              </span>
            </div>
            <HomeHeroActions
              game={focused}
              isRunning={isRunning}
              onPlay={onPlay}
              onOpen={() => onSelect(focused)}
            />
          </div>
        ) : null}
      </section>

      <TileGrid
        games={games}
        onSelect={onSelect}
        railId="library-grid"
        variant="wide"
        empty={empty}
        className="bst-library-grid bst-library-grid--ps"
      />
    </div>
  );
}
