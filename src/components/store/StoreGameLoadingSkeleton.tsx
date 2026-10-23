import { Skeleton, SkeletonText } from "../ui/Skeleton";
import { useLanguage } from "../../context/LanguageContext";

/**
 * Loading placeholder for the Store detail route.
 *
 * It mirrors the shell it resolves into — a full-bleed hero, the undelimited
 * tab strip and the two-column panel grid — so nothing jumps when the data
 * lands. The previous version drew a bordered card with a pill tray of tabs,
 * which the real page never renders.
 */
export default function StoreGameLoadingSkeleton() {
  const { t } = useLanguage();

  return (
    <div
      className="game-page game-page--immersive store-loading-skeleton"
      aria-busy="true"
      aria-label={t("store.loadingGameDetails")}
    >
      <div className="game-top-bar">
        <Skeleton shape="rect" width="104px" height="30px" className="store-skeleton-back" />
      </div>

      <div className="store-skeleton-hero" aria-hidden="true">
        <div className="store-skeleton-hero__poster">
          <Skeleton shape="rect" width="100%" height="100%" />
        </div>
        <div className="store-skeleton-hero__content">
          <Skeleton shape="rect" width="min(400px, 70%)" height="44px" />
          <div className="store-skeleton-hero__meta">
            <Skeleton shape="text" width="74px" />
            <Skeleton shape="text" width="96px" />
            <Skeleton shape="text" width="64px" />
          </div>
          <Skeleton shape="text" width="min(260px, 50%)" />
          <div className="store-skeleton-hero__footer">
            <div className="store-skeleton-hero__stats">
              <Skeleton shape="text" width="72px" />
              <Skeleton shape="text" width="58px" />
              <Skeleton shape="text" width="86px" />
            </div>
            <div className="store-skeleton-hero__actions">
              <Skeleton shape="rect" width="132px" height="42px" />
              <Skeleton shape="rect" width="124px" height="42px" />
            </div>
          </div>
        </div>
      </div>

      <div className="store-skeleton-tabs" aria-hidden="true">
        <Skeleton shape="text" width="86px" />
        <Skeleton shape="text" width="72px" />
        <Skeleton shape="text" width="104px" />
        <Skeleton shape="text" width="80px" />
        <Skeleton shape="text" width="68px" />
      </div>

      <div className="game-content-grid" aria-hidden="true">
        <div className="game-main-col">
          <div className="game-section">
            <div className="store-skeleton-media">
              <Skeleton shape="rect" width="100%" height="100%" />
            </div>
          </div>
          <div className="game-section">
            <Skeleton shape="text" width="120px" height="20px" />
            <div className="store-skeleton-copy">
              <SkeletonText lines={4} />
              <SkeletonText lines={3} lastLineWidth="42%" />
            </div>
          </div>
        </div>

        <div className="game-side-col">
          <div className="game-section">
            <Skeleton shape="text" width="96px" height="20px" />
            <div className="store-skeleton-rows">
              <Skeleton shape="rect" width="100%" height="30px" />
              <Skeleton shape="rect" width="100%" height="30px" />
              <Skeleton shape="rect" width="100%" height="30px" />
            </div>
          </div>
          <div className="game-section">
            <Skeleton shape="text" width="112px" height="20px" />
            <div className="store-skeleton-figures">
              <Skeleton shape="rect" width="100%" height="64px" />
              <Skeleton shape="rect" width="100%" height="64px" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
