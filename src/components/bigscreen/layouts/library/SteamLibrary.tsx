// Steam layout - dossier library.
//
// The left column carries the filters, collection counts and the
// selected game's dossier (poster, title, description, actions); the
// right column is a dense poster grid. This mirrors a PC store/library
// layout: information stays put while the grid scrolls.

import { useLanguage } from "../../../../context/LanguageContext";
import { extractYear } from "../../bigscreenFormat";
import HeroIdentity from "../HeroIdentity";
import HomeHeroActions from "../HomeHeroActions";
import TileGrid from "./TileGrid";
import type { LibraryLayoutProps } from "./types";

export default function SteamLibrary({
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
  const installed = games.filter((game) => game.installed).length;
  const year = focused ? extractYear(focused.releaseDate) : null;

  return (
    <div className="bst-library bst-library--steam" data-layout="steam">
      <aside className="bst-steam-side">
        {filters}

        {focused ? (
          <section className="bst-steam-dossier" aria-label={focused.name}>
            <div className="bst-steam-poster">
              {focused.coverArtUrl ? (
                <img
                  src={focused.coverArtUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              ) : null}
            </div>
            <HeroIdentity game={focused} />
            <p className="bst-steam-description">
              {focused.description || t("bigscreen.gameHub.noDescription")}
            </p>
            <dl className="bst-steam-facts">
              <div>
                <dt>{t("bigscreen.detail.platform")}</dt>
                <dd>{focused.platform}</dd>
              </div>
              {year ? (
                <div>
                  <dt>{t("gameInfo.releaseDate")}</dt>
                  <dd>{String(year)}</dd>
                </div>
              ) : null}
              {focused.developer ? (
                <div>
                  <dt>{t("bigscreen.gameHub.developer")}</dt>
                  <dd>{focused.developer}</dd>
                </div>
              ) : null}
              {focused.playTime ? (
                <div>
                  <dt>{t("hero.playTime")}</dt>
                  <dd>{focused.playTime}</dd>
                </div>
              ) : null}
            </dl>
            <HomeHeroActions
              game={focused}
              isRunning={isRunning}
              onPlay={onPlay}
              onOpen={() => onSelect(focused)}
            />
          </section>
        ) : null}
      </aside>

      <div className="bst-steam-main">
        <header className="bst-steam-head">
          <div>
            <h1>{t("bigscreen.library.gameLibrary")}</h1>
            <p>
              {t("bigscreen.library.countOf", { count: games.length, total })}
            </p>
          </div>
          <div className="bst-steam-counts">
            <span>
              <b>{installed}</b> {t("bigscreen.library.installed")}
            </span>
            <span>
              <b>{games.length - installed}</b> {t("filter.notInstalled")}
            </span>
          </div>
        </header>

        <TileGrid
          games={games}
          onSelect={onSelect}
          railId="library-grid"
          variant="poster"
          autoFocusFirst={autoFocusFirst}
          empty={empty}
          className="bst-library-grid bst-library-grid--steam"
        />
      </div>
    </div>
  );
}
