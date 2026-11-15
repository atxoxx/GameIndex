// GameIndex layout - editorial library.
//
// A collection browser, not a wall of cards: the grid is the working
// area and a persistent inspector on the right always names and
// describes the focused game, with Play and Game Hub within reach.

import { useLanguage } from "../../../../context/LanguageContext";
import { extractYear } from "../../bigscreenFormat";
import HeroIdentity from "../HeroIdentity";
import HomeHeroActions from "../HomeHeroActions";
import { GameShelf } from "../shared";
import TileGrid from "./TileGrid";
import type { LibraryLayoutProps } from "./types";

export default function GameIndexLibrary({
  games,
  total,
  focused,
  isRunning,
  recent,
  filters,
  empty,
  onSelect,
  onPlay,
  autoFocusFirst,
}: LibraryLayoutProps) {
  const { t } = useLanguage();
  const year = focused ? extractYear(focused.releaseDate) : null;

  return (
    <div className="bst-library bst-library--gameindex" data-layout="gameindex">
      <header className="bst-library-head">
        <div className="bst-library-heading">
          <span className="bst-eyebrow">{t("bigscreen.home.yourLibrary")}</span>
          <h1>{t("bigscreen.library.myCollection")}</h1>
          <p>
            {t("bigscreen.library.countOf", {
              count: games.length,
              total,
            })}
          </p>
        </div>
        {filters}
      </header>

      {recent.length > 0 ? (
        <GameShelf
          title={t("bigscreen.home.jumpBackIn")}
          games={recent.slice(0, 8)}
          onSelect={onSelect}
          railId="library-continue"
          variant="wide"
          className="bst-shelf--library"
        />
      ) : null}

      <div className="bst-library-body">
        <TileGrid
          games={games}
          onSelect={onSelect}
          railId="library-grid"
          variant="poster"
          autoFocusFirst={autoFocusFirst}
          empty={empty}
          className="bst-library-grid"
        />

        {focused ? (
          <aside className="bst-inspector" aria-label={focused.name}>
            <div className="bst-inspector-art">
              {focused.coverArtUrl || focused.bannerUrl ? (
                <img
                  src={focused.bannerUrl ?? focused.coverArtUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              ) : null}
              <span className="bst-inspector-art-fade" aria-hidden="true" />
            </div>
            <div className="bst-inspector-copy">
              <HeroIdentity game={focused} />
              <div className="bst-inspector-meta">
                <span className="bst-chip bst-chip--brand">
                  {focused.platform}
                </span>
                {year ? <span className="bst-chip">{year}</span> : null}
                {focused.playTime ? (
                  <span className="bst-chip">{focused.playTime}</span>
                ) : null}
              </div>
              <p className="bst-inspector-description">
                {focused.description || t("bigscreen.gameHub.noDescription")}
              </p>
              <HomeHeroActions
                game={focused}
                isRunning={isRunning}
                onPlay={onPlay}
                onOpen={() => onSelect(focused)}
              />
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
