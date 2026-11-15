// Switch layout - flat icon grid home.
//
// Two presses to anything: a recent row, a compact persistent selection
// strip and the whole library as square icons. No full-bleed art, no
// elevation - the identity comes from the tiles and the red accent.

import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../../../context/LanguageContext";
import { extractYear } from "../../bigscreenFormat";
import { gameDisplayName } from "../../../../types/game";
import { useHomeSections } from "../useHomeSections";
import { useHomeSelection } from "../useHomeSelection";
import { GameShelf } from "../shared";
import HomeHeroActions from "../HomeHeroActions";
import HomeEmpty from "../HomeEmpty";

export default function SwitchHome() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const sections = useHomeSections();
  const selection = useHomeSelection(sections.pool);
  const game = selection.focused;

  if (!game) {
    return (
      <div className="bst-home bst-home--switch" data-layout="switch">
        <HomeEmpty onBrowse={() => navigate("/library")} />
      </div>
    );
  }

  const year = extractYear(game.releaseDate);
  const wall = sections.all.slice(0, 40);

  return (
    <div className="bst-home bst-home--switch" data-layout="switch">
      <GameShelf
        title={t("lib.rail.continue.title")}
        games={sections.continuePlaying}
        onSelect={selection.open}
        railId="switch-recent"
        variant="square"
        autoFocusFirst
        className="bst-shelf--switch-recent"
      />

      <section className="bst-ninfo" aria-label={gameDisplayName(game)}>
        <div className="bst-ninfo-art">
          {game.iconUrl ? (
            <img src={game.iconUrl} alt="" aria-hidden="true" />
          ) : game.coverArtUrl ? (
            <img src={game.coverArtUrl} alt="" aria-hidden="true" />
          ) : null}
        </div>
        <div className="bst-ninfo-copy">
          <h2>{gameDisplayName(game)}</h2>
          <p>{game.description || t("bigscreen.gameHub.noDescription")}</p>
          <span className="bst-ninfo-meta">
            {game.platform}
            {year ? ` · ${year}` : ""}
            {game.playTime ? ` · ${game.playTime}` : ""}
          </span>
        </div>
        <HomeHeroActions
          game={game}
          isRunning={selection.isRunning}
          onPlay={() => selection.play(game)}
          onOpen={() => selection.open(game)}
        />
      </section>

      <GameShelf
        title={t("bigscreen.home.allSoftware")}
        games={wall}
        onSelect={selection.open}
        railId="switch-wall"
        variant="square"
        wrap
        className="bst-shelf--wall"
      />
    </div>
  );
}
