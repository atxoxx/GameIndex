// Switch layout - simple game page.
//
// The icon and title lead, the description follows, and the Play button
// is impossible to miss. Sections are a compact segmented control; the
// content is one readable column with the essential facts.

import type { Game } from "../../../../types/game";
import { useLanguage } from "../../../../context/LanguageContext";
import { PLAY_STATUS_DETAILS, gameDisplayName } from "../../../../types/game";
import { formatLastPlayedLocalized } from "../../bigscreenFormat";
import {
  DetailActions,
  DetailBack,
  DetailOverlays,
  DetailPanels,
  DetailProse,
  DetailSectionNav,
  useDetailController,
} from "./shared";

export default function SwitchDetail({ game }: { game: Game }) {
  const { t } = useLanguage();
  const controller = useDetailController(game, "/library");
  const status = PLAY_STATUS_DETAILS[game.playStatus || "backlog"];
  const art = game.iconUrl ?? game.coverArtUrl;

  return (
    <div className="bstd bstd--switch" data-layout="switch" ref={controller.rootRef}>
      <div className="bstd-nhead">
        <DetailBack onBack={controller.onBack} />
        <div className="bstd-nhead-art">
          {art ? <img src={art} alt="" aria-hidden="true" /> : null}
        </div>
        <div className="bstd-nhead-copy">
          <h1>{gameDisplayName(game)}</h1>
          <span className="bstd-nhead-meta">
            {game.platform} · {t(status.labelKey)}
            {game.playTime ? ` · ${game.playTime}` : ""}
          </span>
          <p>{game.description || t("bigscreen.gameHub.noDescription")}</p>
          <DetailActions controller={controller} />
        </div>
      </div>

      <dl className="bstd-nfacts">
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
        {game.genres && game.genres.length > 0 ? (
          <div>
            <dt>{t("bigscreen.overview.genres")}</dt>
            <dd>{game.genres.slice(0, 3).join(", ")}</dd>
          </div>
        ) : null}
      </dl>

      <DetailSectionNav controller={controller} variant="segments" railId="game-tabs" />

      <DetailPanels
        controller={controller}
        overview={
          <div className="bstd-noverview">
            <DetailProse game={game} />
          </div>
        }
      />

      <DetailOverlays controller={controller} />
    </div>
  );
}
