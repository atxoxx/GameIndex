// Steam layout - shelf-first home.
//
// Information-dense PC-gaming composition: a wide featured card with a
// details column, a library summary strip, then poster shelves. The
// Steam rail owns navigation, so the page starts flush against the
// content column.

import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../../../context/LanguageContext";
import { formatLastPlayedLocalized, extractYear } from "../../bigscreenFormat";
import { useHomeSections } from "../useHomeSections";
import { useHomeSelection } from "../useHomeSelection";
import { GameShelf } from "../shared";
import HomeHeroActions from "../HomeHeroActions";
import HeroIdentity from "../HeroIdentity";
import HomeEmpty from "../HomeEmpty";

export default function SteamHome() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const sections = useHomeSections();
  const selection = useHomeSelection(sections.pool);
  const game = selection.focused;

  if (!game) {
    return (
      <div className="bst-home bst-home--steam" data-layout="steam">
        <HomeEmpty onBrowse={() => navigate("/library")} />
      </div>
    );
  }

  const year = extractYear(game.releaseDate);

  return (
    <div className="bst-home bst-home--steam" data-layout="steam">
      <section className="bst-shero" aria-label={game.name}>
        <div className="bst-shero-art">
          {selection.backdrop.staticUrl ? (
            <div
              key={selection.backdrop.staticUrl}
              className="bst-shero-art-image"
              style={{ backgroundImage: `url("${selection.backdrop.staticUrl}")` }}
            />
          ) : null}
          <span className="bst-shero-art-scrim" aria-hidden="true" />
          <span className="bst-shero-label">{t("bigscreen.home.featured")}</span>
        </div>

        <div className="bst-shero-body">
          <HeroIdentity game={game} />
          <div className="bst-shero-meta">
            <span className="bst-chip bst-chip--brand">{game.platform}</span>
            {year ? <span className="bst-chip">{year}</span> : null}
            {game.developer ? (
              <span className="bst-chip">{game.developer}</span>
            ) : null}
          </div>
          <p className="bst-shero-description">
            {game.description || t("bigscreen.gameHub.noDescription")}
          </p>
          <HomeHeroActions
            game={game}
            isRunning={selection.isRunning}
            onPlay={() => selection.play(game)}
            onOpen={() => selection.open(game)}
            autoFocusPrimary
            detailsLabel={t("bigscreen.home.gameHub")}
          />
          <dl className="bst-shero-facts">
            <div>
              <dt>{t("hero.playTime")}</dt>
              <dd>{game.playTime || "0h"}</dd>
            </div>
            <div>
              <dt>{t("game.lastPlayed")}</dt>
              <dd>{formatLastPlayedLocalized(game.lastPlayed ?? 0, t)}</dd>
            </div>
            <div>
              <dt>{t("hero.status")}</dt>
              <dd>{selection.status ? t(selection.status.labelKey) : "—"}</dd>
            </div>
          </dl>
        </div>
      </section>

      <div className="bst-library-strip">
        <div className="bst-library-stat">
          <b>{sections.all.length}</b>
          <span>{t("nav.library")}</span>
        </div>
        <div className="bst-library-stat">
          <b>{sections.installedCount}</b>
          <span>{t("bigscreen.library.installed")}</span>
        </div>
        <div className="bst-library-stat">
          <b>{sections.favoritesCount}</b>
          <span>{t("bigscreen.home.yourFavorites")}</span>
        </div>
        <button
          type="button"
          className="bst-library-link"
          onClick={() => navigate("/library")}
        >
          {t("bigscreen.home.browseLibrary")}
          <span aria-hidden="true">→</span>
        </button>
      </div>

      <div className="bst-home-scroll bst-home-scroll--steam">
        <GameShelf
          title={t("bigscreen.home.jumpBackIn")}
          games={sections.continuePlaying}
          onSelect={selection.open}
          railId="steam-continue"
          variant="wide"
        />
        <GameShelf
          title={t("lib.rail.recentlyAdded.title")}
          games={sections.recentlyAdded}
          onSelect={selection.open}
          railId="steam-recent"
          variant="poster"
        />
        <GameShelf
          title={t("bigscreen.home.mostPlayed")}
          games={sections.mostPlayed}
          onSelect={selection.open}
          railId="steam-most-played"
          variant="poster"
        />
        <GameShelf
          title={t("bigscreen.home.readyToPlay")}
          games={sections.installed}
          onSelect={selection.open}
          railId="steam-installed"
          variant="poster"
        />
      </div>
    </div>
  );
}
