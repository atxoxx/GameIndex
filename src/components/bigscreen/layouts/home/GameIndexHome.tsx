// GameIndex layout - the flagship home screen.
//
// Cinematic, editorial composition: one full-bleed featured game whose
// identity, description and actions own the top of the page, followed
// by quiet horizontal shelves. The hero follows controller focus, so the
// selected game is always named and described on screen.

import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../../../context/LanguageContext";
import { formatLastPlayedLocalized, extractYear } from "../../bigscreenFormat";
import { useHomeSections } from "../useHomeSections";
import { useHomeSelection } from "../useHomeSelection";
import { GameShelf } from "../shared";
import HomeHeroActions from "../HomeHeroActions";
import HeroIdentity from "../HeroIdentity";
import HomeEmpty from "../HomeEmpty";

export default function GameIndexHome() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const sections = useHomeSections();
  const selection = useHomeSelection(sections.pool);
  const game = selection.focused;

  if (!game) {
    return (
      <div className="bst-home bst-home--gameindex" data-layout="gameindex">
        <HomeEmpty onBrowse={() => navigate("/library")} />
      </div>
    );
  }

  const year = extractYear(game.releaseDate);

  return (
    <div className="bst-home bst-home--gameindex" data-layout="gameindex">
      <section className="bst-hero bst-hero--gameindex" aria-label={game.name}>
        <div className="bst-hero-art" aria-hidden="true">
          {selection.backdrop.staticUrl ? (
            <div
              key={selection.backdrop.staticUrl}
              className="bst-hero-art-image"
              style={{ backgroundImage: `url("${selection.backdrop.staticUrl}")` }}
            />
          ) : null}
          {selection.backdrop.animatedUrl ? (
            <img
              className="bst-hero-art-animated"
              src={selection.backdrop.animatedUrl}
              alt=""
              decoding="async"
            />
          ) : null}
          <div className="bst-hero-veil" />
          <div className="bst-hero-glow" />
        </div>

        <div className="bst-hero-inner">
          <p className="bst-eyebrow">
            <span className="bst-eyebrow-line" aria-hidden="true" />
            {t("bigscreen.home.featured")}
          </p>

          <HeroIdentity game={game} />

          <div className="bst-hero-meta">
            <span className="bst-chip bst-chip--brand">{game.platform}</span>
            {selection.status ? (
              <span className="bst-chip">
                <i
                  className="bst-chip-dot"
                  style={{ background: selection.status.color }}
                  aria-hidden="true"
                />
                {t(selection.status.labelKey)}
              </span>
            ) : null}
            {year ? <span className="bst-chip">{year}</span> : null}
            {game.playTime ? (
              <span className="bst-chip">{game.playTime}</span>
            ) : null}
          </div>

          <p className="bst-hero-description">
            {game.description || t("bigscreen.gameHub.noDescription")}
          </p>

          <HomeHeroActions
            game={game}
            isRunning={selection.isRunning}
            onPlay={() => selection.play(game)}
            onOpen={() => selection.open(game)}
            autoFocusPrimary
          />

          <dl className="bst-hero-facts">
            <div>
              <dt>{t("hero.playTime")}</dt>
              <dd>{game.playTime || "0h"}</dd>
            </div>
            <div>
              <dt>{t("game.lastPlayed")}</dt>
              <dd>{formatLastPlayedLocalized(game.lastPlayed ?? 0, t)}</dd>
            </div>
            {game.developer ? (
              <div>
                <dt>{t("bigscreen.gameHub.developer")}</dt>
                <dd>{game.developer}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      </section>

      <div className="bst-home-scroll">
        <GameShelf
          title={t("lib.rail.continue.title")}
          subtitle={t("lib.rail.continue.subtitle")}
          games={sections.continuePlaying}
          onSelect={selection.open}
          railId="gi-continue"
          variant="wide"
        />
        <GameShelf
          title={t("lib.rail.recentlyAdded.title")}
          games={sections.recentlyAdded}
          onSelect={selection.open}
          railId="gi-recent"
          variant="poster"
        />
        <GameShelf
          title={t("bigscreen.home.readyToPlay")}
          games={sections.installed}
          onSelect={selection.open}
          railId="gi-installed"
          variant="wide"
        />
        {sections.favorites.length > 0 ? (
          <GameShelf
            title={t("bigscreen.home.yourFavorites")}
            games={sections.favorites}
            onSelect={selection.open}
            railId="gi-favorites"
            variant="poster"
          />
        ) : null}
      </div>
    </div>
  );
}
