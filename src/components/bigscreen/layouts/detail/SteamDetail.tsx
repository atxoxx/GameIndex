// Steam layout - dossier game page.
//
// A poster-led sidebar holds identity, facts and the action rail; the
// right-hand document column carries the description, a vertical section
// index and the content. Information-dense and built for browsing rather
// than spectacle.

import type { Game } from "../../../../types/game";
import { gameDisplayName } from "../../../../types/game";
import { useLanguage } from "../../../../context/LanguageContext";
import { extractYear, formatLastPlayedLocalized } from "../../bigscreenFormat";
import {
  DetailActions,
  DetailBack,
  DetailFactGrid,
  DetailMeta,
  DetailOverlays,
  DetailPanels,
  DetailPlayers,
  DetailProse,
  DetailRail,
  DetailSectionNav,
  useDetailController,
} from "./shared";

export default function SteamDetail({ game }: { game: Game }) {
  const { t } = useLanguage();
  const controller = useDetailController(game, "/library");

  return (
    <div className="bstd bstd--steam" data-layout="steam" ref={controller.rootRef}>
      <div className="bstd-steam-grid">
        <aside className="bstd-steam-left">
          <DetailBack onBack={controller.onBack} />
          <div className="bstd-steam-poster">
            {game.coverArtUrl ? (
              <img src={game.coverArtUrl} alt={gameDisplayName(game)} loading="lazy" decoding="async" />
            ) : null}
          </div>
          <h1 className="bstd-steam-title">{gameDisplayName(game)}</h1>
          <DetailMeta game={game} />
          <DetailFactGrid game={game} />
          <DetailActions controller={controller} />
          <DetailPlayers appId={controller.resolvedSteamAppId} />
          {extractYear(game.releaseDate) ? (
            <p className="bstd-steam-released">
              {t("gameInfo.releaseDate")}: {extractYear(game.releaseDate)}
            </p>
          ) : null}
          <p className="bstd-steam-lastplayed">
            {t("game.lastPlayed")}: {formatLastPlayedLocalized(game.lastPlayed ?? 0, t)}
          </p>
        </aside>

        <div className="bstd-steam-main">
          <section className="bstd-steam-about">
            <h2>{t("bigscreen.gameHub.about")}</h2>
            <p>{game.description || t("bigscreen.gameHub.noDescription")}</p>
          </section>

          <div className="bstd-steam-body">
            <DetailSectionNav controller={controller} variant="list" railId="game-tabs" />
            <DetailPanels
              controller={controller}
              overview={
                <div className="bstd-steam-doc">
                  <DetailProse game={game} />
                  <DetailRail game={game} />
                </div>
              }
            />
          </div>
        </div>
      </div>

      <DetailOverlays controller={controller} />
    </div>
  );
}
