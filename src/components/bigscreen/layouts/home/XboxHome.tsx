// Xbox layout - dashboard home.
//
// Content-rich dashboard: a split featured band (artwork beside a glass
// information panel), then dense horizontal shelves of landscape tiles.
// Navigation reads as a top tile dock; the green identity lives in the
// brand furniture, never the focus ring.

import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../../../context/LanguageContext";
import { extractYear } from "../../bigscreenFormat";
import { useHomeSections } from "../useHomeSections";
import { useHomeSelection } from "../useHomeSelection";
import { GameShelf } from "../shared";
import HomeHeroActions from "../HomeHeroActions";
import HeroIdentity from "../HeroIdentity";
import HomeEmpty from "../HomeEmpty";

export default function XboxHome() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const sections = useHomeSections();
  const selection = useHomeSelection(sections.pool);
  const game = selection.focused;

  if (!game) {
    return (
      <div className="bst-home bst-home--xbox" data-layout="xbox">
        <HomeEmpty onBrowse={() => navigate("/library")} />
      </div>
    );
  }

  const year = extractYear(game.releaseDate);

  return (
    <div className="bst-home bst-home--xbox" data-layout="xbox">
      <section className="bst-xhero" aria-label={game.name}>
        <div className="bst-xhero-art">
          {selection.backdrop.staticUrl ? (
            <div
              key={selection.backdrop.staticUrl}
              className="bst-xhero-art-image"
              style={{ backgroundImage: `url("${selection.backdrop.staticUrl}")` }}
            />
          ) : null}
          <span className="bst-xhero-art-scrim" aria-hidden="true" />
          <span className="bst-xhero-badge">
            {t("bigscreen.home.featured")}
          </span>
        </div>

        <aside className="bst-xhero-panel">
          <HeroIdentity game={game} className="bst-xhero-logo" />
          <div className="bst-xhero-meta">
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
          </div>
          <p className="bst-xhero-description">
            {game.description || t("bigscreen.gameHub.noDescription")}
          </p>
          <HomeHeroActions
            game={game}
            isRunning={selection.isRunning}
            onPlay={() => selection.play(game)}
            onOpen={() => selection.open(game)}
            autoFocusPrimary
          />
          <div className="bst-xhero-stats">
            <div>
              <span>{t("hero.playTime")}</span>
              <b>{game.playTime || "0h"}</b>
            </div>
            <div>
              <span>{t("hero.status")}</span>
              <b>{selection.status ? t(selection.status.labelKey) : "—"}</b>
            </div>
          </div>
        </aside>
      </section>

      <div className="bst-home-scroll bst-home-scroll--xbox">
        <GameShelf
          title={t("bigscreen.home.quickResume")}
          games={sections.continuePlaying}
          onSelect={selection.open}
          railId="xbox-continue"
          variant="wide"
        />
        <GameShelf
          title={t("lib.rail.recentlyAdded.title")}
          games={sections.recentlyAdded}
          onSelect={selection.open}
          railId="xbox-recent"
          variant="wide"
        />
        <GameShelf
          title={t("bigscreen.home.mostPlayed")}
          games={sections.mostPlayed}
          onSelect={selection.open}
          railId="xbox-most-played"
          variant="wide"
        />
        <GameShelf
          title={t("bigscreen.home.readyToPlay")}
          games={sections.installed}
          onSelect={selection.open}
          railId="xbox-installed"
          variant="wide"
        />
      </div>
    </div>
  );
}
