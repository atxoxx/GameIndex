// GameIndex layout - cinematic workspace game page.
//
// A wide hero establishes identity and the primary action; below it the
// page becomes a structured workspace: prose and facts on the left, a
// metadata rail on the right, and a horizontal section spine.

import type { Game } from "../../../../types/game";
import { useLanguage } from "../../../../context/LanguageContext";
import {
  DetailActions,
  DetailBack,
  DetailFactGrid,
  DetailMediaPeek,
  DetailMeta,
  DetailOverlays,
  DetailPanels,
  DetailProse,
  DetailRail,
  DetailSectionNav,
  useDetailController,
} from "./shared";
import HeroIdentity from "../HeroIdentity";

export default function GameIndexDetail({ game }: { game: Game }) {
  const { t } = useLanguage();
  const controller = useDetailController(game, "/library");
  const { backdrop } = controller;

  return (
    <div
      className="bstd bstd--gameindex"
      data-layout="gameindex"
      ref={controller.rootRef}
    >
      <section className="bstd-hero bstd-hero--gameindex" aria-label={game.name}>
        <div className="bstd-hero-art" aria-hidden="true">
          {backdrop.staticUrl ? (
            <div
              key={backdrop.staticUrl}
              className="bstd-hero-art-image"
              style={{ backgroundImage: `url("${backdrop.staticUrl}")` }}
            />
          ) : null}
          {backdrop.animatedUrl ? (
            <img src={backdrop.animatedUrl} alt="" decoding="async" />
          ) : null}
          <span className="bstd-hero-veil" />
        </div>

        <DetailBack onBack={controller.onBack} />
        <div className="bstd-hero-content">
          <div className="bstd-hero-copy">
            <HeroIdentity game={game} />
            <DetailMeta game={game} />
            <p className="bstd-hero-description">
              {game.description || t("bigscreen.gameHub.noDescription")}
            </p>
            <DetailActions controller={controller} />
          </div>
          <DetailFactGrid game={game} />
        </div>
      </section>

      <DetailSectionNav controller={controller} variant="bar" railId="game-tabs" />

      <DetailPanels
        controller={controller}
        overview={
          <div className="bstd-workspace">
            <div className="bstd-workspace-main">
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
