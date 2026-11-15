// Switch layout - simple icon grid library.
//
// A compact strip names and describes the focused game, then the whole
// collection is a square icon grid. No background art, no elevation,
// no extra navigation layers.

import { useLanguage } from "../../../../context/LanguageContext";
import { extractYear } from "../../bigscreenFormat";
import HomeHeroActions from "../HomeHeroActions";
import TileGrid from "./TileGrid";
import type { LibraryLayoutProps } from "./types";

export default function SwitchLibrary({
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
    <div className="bst-library bst-library--switch" data-layout="switch">
      <header className="bst-switch-head">
        <h1>{t("bigscreen.home.allSoftware")}</h1>
        <span>{t("bigscreen.library.countOf", { count: games.length, total })}</span>
        {filters}
      </header>

      {focused ? (
        <section className="bst-ninfo bst-ninfo--library" aria-label={focused.name}>
          <div className="bst-ninfo-art">
            {focused.iconUrl ? (
              <img src={focused.iconUrl} alt="" aria-hidden="true" />
            ) : focused.coverArtUrl ? (
              <img src={focused.coverArtUrl} alt="" aria-hidden="true" />
            ) : null}
          </div>
          <div className="bst-ninfo-copy">
            <h2>{focused.name}</h2>
            <p>{focused.description || t("bigscreen.gameHub.noDescription")}</p>
            <span className="bst-ninfo-meta">
              {focused.platform}
              {year ? ` · ${year}` : ""}
              {focused.playTime ? ` · ${focused.playTime}` : ""}
            </span>
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
        variant="square"
        autoFocusFirst={autoFocusFirst}
        empty={empty}
        className="bst-library-grid bst-library-grid--switch"
      />
    </div>
  );
}
