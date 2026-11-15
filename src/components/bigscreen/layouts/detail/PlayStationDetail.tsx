// PlayStation layout - cinematic game hub.
//
// Artwork dominates: a full-bleed hero with a centred logo, description
// and Play button, then a restrained content area with the section row
// centred beneath it. Motion is slow and the surface stays minimal.

import type { Game } from "../../../../types/game";
import { useLanguage } from "../../../../context/LanguageContext";
import {
  DetailActions,
  DetailBack,
  DetailFactGrid,
  DetailMeta,
  DetailOverlays,
  DetailPanels,
  DetailProse,
  DetailRail,
  DetailSectionNav,
  useDetailController,
} from "./shared";
import HeroIdentity from "../HeroIdentity";

export default function PlayStationDetail({ game }: { game: Game }) {
  const { t } = useLanguage();
  const controller = useDetailController(game, "/library");

  return (
    <div
      className="bstd bstd--playstation"
      data-layout="playstation"
      ref={controller.rootRef}
    >
      <section className="bstd-phero" aria-label={game.name}>
        <div className="bstd-phero-art" aria-hidden="true">
          {controller.backdrop.staticUrl ? (
            <div
              key={controller.backdrop.staticUrl}
              className="bstd-phero-art-image"
              style={{ backgroundImage: `url("${controller.backdrop.staticUrl}")` }}
            />
          ) : null}
          {controller.backdrop.animatedUrl ? (
            <img src={controller.backdrop.animatedUrl} alt="" decoding="async" />
          ) : null}
          <span className="bstd-phero-veil" />
        </div>

        <div className="bstd-phero-top">
          <DetailBack onBack={controller.onBack} />
        </div>

        <div className="bstd-phero-content">
          <HeroIdentity game={game} />
          <DetailMeta game={game} />
          <p className="bstd-phero-description">
            {game.description || t("bigscreen.gameHub.noDescription")}
          </p>
          <DetailActions controller={controller} />
          <DetailFactGrid game={game} />
        </div>
      </section>

      <DetailSectionNav controller={controller} variant="icons" railId="game-tabs" />

      <DetailPanels
        controller={controller}
        overview={
          <div className="bstd-ps-overview">
            <div className="bstd-ps-prose">
              <DetailProse game={game} />
            </div>
            <DetailRail game={game} />
          </div>
        }
      />

      <DetailOverlays controller={controller} />
    </div>
  );
}
