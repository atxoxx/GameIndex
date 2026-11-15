// Xbox layout - dashboard game hub.
//
// Artwork and copy sit side by side, a row of stat tiles summarises the
// game, and the sections read as large dashboard tiles. Content below is
// arranged in horizontal bands rather than one long document.

import type { Game } from "../../../../types/game";
import { PLAY_STATUS_DETAILS } from "../../../../types/game";
import { useLanguage } from "../../../../context/LanguageContext";
import { formatLastPlayedLocalized } from "../../bigscreenFormat";
import {
  DetailActions,
  DetailBack,
  DetailMediaPeek,
  DetailOverlays,
  DetailPanels,
  DetailProse,
  DetailRail,
  DetailSectionNav,
  useDetailController,
} from "./shared";
import HeroIdentity from "../HeroIdentity";

export default function XboxDetail({ game }: { game: Game }) {
  const { t } = useLanguage();
  const controller = useDetailController(game, "/library");
  const status = PLAY_STATUS_DETAILS[game.playStatus || "backlog"];
  const rating = game.igdbRating ?? game.criticRating;

  const tiles = [
    { label: t("hero.playTime"), value: game.playTime || "0h" },
    { label: t("game.lastPlayed"), value: formatLastPlayedLocalized(game.lastPlayed ?? 0, t) },
    { label: t("hero.status"), value: t(status.labelKey) },
    rating != null && rating > 0
      ? { label: t("gameInfo.rating"), value: `${Math.round(rating)}%` }
      : null,
    controller.achTotal > 0
      ? {
          label: t("achievementsPage.achievements"),
          value: `${controller.achCount} / ${controller.achTotal}`,
        }
      : null,
  ].filter((tile): tile is { label: string; value: string } => tile !== null);

  return (
    <div className="bstd bstd--xbox" data-layout="xbox" ref={controller.rootRef}>
      <div className="bstd-toprow">
        <DetailBack onBack={controller.onBack} />
      </div>

      <section className="bstd-xhub" aria-label={game.name}>
        <div className="bstd-xhub-art">
          {controller.backdrop.staticUrl ? (
            <div
              key={controller.backdrop.staticUrl}
              className="bstd-xhub-art-image"
              style={{ backgroundImage: `url("${controller.backdrop.staticUrl}")` }}
            />
          ) : null}
          <span className="bstd-xhub-art-fade" aria-hidden="true" />
        </div>
        <div className="bstd-xhub-copy">
          <HeroIdentity game={game} />
          <div className="bstd-chips">
            <span className="bst-chip bst-chip--brand">{game.platform}</span>
            <span className="bst-chip">
              <i className="bst-chip-dot" style={{ background: status.color }} aria-hidden="true" />
              {t(status.labelKey)}
            </span>
            {game.developer ? <span className="bst-chip">{game.developer}</span> : null}
          </div>
          <p className="bstd-xhub-description">
            {game.description || t("bigscreen.gameHub.noDescription")}
          </p>
          <DetailActions controller={controller} />
        </div>
      </section>

      <div className="bstd-tiles">
        {tiles.map((tile) => (
          <div className="bstd-stat-tile" key={tile.label}>
            <span>{tile.label}</span>
            <b>{tile.value}</b>
          </div>
        ))}
      </div>

      <DetailSectionNav controller={controller} variant="tiles" railId="game-tabs" />

      <DetailPanels
        controller={controller}
        overview={
          <div className="bstd-xboard">
            <div className="bstd-xboard-main">
              <DetailProse game={game} />
            </div>
            <DetailRail game={game} />
            <DetailMediaPeek game={game} onOpen={controller.setLightbox} />
          </div>
        }
      />

      <DetailOverlays controller={controller} />
    </div>
  );
}
