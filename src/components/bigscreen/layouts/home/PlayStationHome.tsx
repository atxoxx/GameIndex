// PlayStation layout - cinematic home.
//
// The selected game owns the screen: full-bleed art, logo, description
// and Play sit in the centre, with the games carousel directly beneath
// them so it reads as a single cinematic surface. A second row appears
// below the fold for new additions.

import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../../../context/LanguageContext";
import { extractYear } from "../../bigscreenFormat";
import { useHomeSections } from "../useHomeSections";
import { useHomeSelection } from "../useHomeSelection";
import { GameShelf } from "../shared";
import HomeHeroActions from "../HomeHeroActions";
import HeroIdentity from "../HeroIdentity";
import HomeEmpty from "../HomeEmpty";

export default function PlayStationHome() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const sections = useHomeSections();
  const selection = useHomeSelection(sections.pool);
  const game = selection.focused;

  if (!game) {
    return (
      <div className="bst-home bst-home--playstation" data-layout="playstation">
        <HomeEmpty onBrowse={() => navigate("/library")} />
      </div>
    );
  }

  const year = extractYear(game.releaseDate);
  const carousel = sections.pool.slice(0, 12);

  return (
    <div className="bst-home bst-home--playstation" data-layout="playstation">
      <section className="bst-phero" aria-label={game.name}>
        <div className="bst-phero-art" aria-hidden="true">
          {selection.backdrop.staticUrl ? (
            <div
              key={selection.backdrop.staticUrl}
              className="bst-phero-art-image"
              style={{ backgroundImage: `url("${selection.backdrop.staticUrl}")` }}
            />
          ) : null}
          {selection.backdrop.animatedUrl ? (
            <img
              className="bst-phero-art-animated"
              src={selection.backdrop.animatedUrl}
              alt=""
              decoding="async"
            />
          ) : null}
          <span className="bst-phero-veil" />
        </div>

        <div className="bst-phero-content">
          <div className="bst-phero-copy">
            <span className="bst-phero-eyebrow">
              {t("bigscreen.home.featured")}
            </span>
            <HeroIdentity game={game} />
            <div className="bst-phero-meta">
              {game.platform}
              {year ? ` · ${year}` : ""}
              {game.developer ? ` · ${game.developer}` : ""}
            </div>
            <p className="bst-phero-description">
              {game.description || t("bigscreen.gameHub.noDescription")}
            </p>
            <HomeHeroActions
              game={game}
              isRunning={selection.isRunning}
              onPlay={() => selection.play(game)}
              onOpen={() => selection.open(game)}
              autoFocusPrimary
            />
          </div>

          <div className="bst-phero-row">
            <GameShelf
              title={t("bigscreen.home.yourLibrary")}
              games={carousel}
              onSelect={selection.open}
              railId="ps-carousel"
              variant="square"
              className="bst-shelf--inline"
            />
          </div>
        </div>
      </section>

      <div className="bst-home-scroll bst-home-scroll--playstation">
        <GameShelf
          title={t("lib.rail.recentlyAdded.title")}
          games={sections.recentlyAdded}
          onSelect={selection.open}
          railId="ps-recent"
          variant="square"
        />
      </div>
    </div>
  );
}
