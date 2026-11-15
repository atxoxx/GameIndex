// Xbox layout - dashboard library.
//
// A wide information band under the page header (art, title,
// description, actions) and a full-width grid of landscape tiles below.
// The band is the persistent selection readout, so it never disappears
// while the controller moves through the grid.

import { useLanguage } from "../../../../context/LanguageContext";
import { extractYear } from "../../bigscreenFormat";
import HeroIdentity from "../HeroIdentity";
import HomeHeroActions from "../HomeHeroActions";
import TileGrid from "./TileGrid";
import type { LibraryLayoutProps } from "./types";

export default function XboxLibrary({
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

  return (
    <div className="bst-library bst-library--xbox" data-layout="xbox">
      <header className="bst-library-head bst-library-head--xbox">
        <div className="bst-library-heading">
          <span className="bst-eyebrow">{t("nav.library")}</span>
          <h1>{t("bigscreen.library.myGames")}</h1>
          <p>
            {t("bigscreen.library.countOf", { count: games.length, total })}
          </p>
        </div>
        {filters}
      </header>

      {focused ? (
        <section className="bst-xinfo" aria-label={focused.name}>
          <div className="bst-xinfo-art">
            {focused.coverArtUrl || focused.bannerUrl ? (
              <img
                src={focused.bannerUrl ?? focused.coverArtUrl}
                alt=""
                loading="lazy"
                decoding="async"
              />
            ) : null}
            <span className="bst-xinfo-art-fade" aria-hidden="true" />
          </div>
          <div className="bst-xinfo-copy">
            <HeroIdentity game={focused} />
            <div className="bst-xinfo-meta">
              <span className="bst-chip bst-chip--brand">{focused.platform}</span>
              {year ? <span className="bst-chip">{year}</span> : null}
              {focused.playTime ? (
                <span className="bst-chip">{focused.playTime}</span>
              ) : null}
              {focused.developer ? (
                <span className="bst-chip">{focused.developer}</span>
              ) : null}
            </div>
            <p className="bst-xinfo-description">
              {focused.description || t("bigscreen.gameHub.noDescription")}
            </p>
          </div>
          <HomeHeroActions
            game={focused}
            isRunning={isRunning}
            onPlay={onPlay}
            onOpen={() => onSelect(focused)}
          />
        </section>
      ) : null}

      <TileGrid
        games={games}
        onSelect={onSelect}
        railId="library-grid"
        variant="wide"
        autoFocusFirst={autoFocusFirst}
        empty={empty}
        className="bst-library-grid bst-library-grid--xbox"
      />
    </div>
  );
}
