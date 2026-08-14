import { Skeleton, SkeletonText } from "../ui/Skeleton";
import { useLanguage } from "../../context/LanguageContext";

export default function StoreGameLoadingSkeleton() {
  const { t } = useLanguage();

  return (
    <div className="game-page store-detail-page store-loading-skeleton" aria-busy="true" aria-label={t("store.loadingGameDetails")}>
      {/* Top back button skeleton */}
      <div className="game-top-bar">
        <Skeleton shape="rect" width="100px" height="32px" style={{ borderRadius: "var(--radius-full)" }} />
      </div>

      {/* Cinematic Hero Skeleton */}
      <div className="store-hero-skeleton">
        <div className="store-hero-skeleton__poster">
          <Skeleton shape="rect" width="100%" height="100%" style={{ borderRadius: "var(--radius-lg)" }} />
        </div>
        <div className="store-hero-skeleton__content">
          <div className="store-hero-skeleton__head">
            <Skeleton shape="text" width="60%" height="38px" style={{ marginBottom: "var(--space-md)" }} />
            <div style={{ display: "flex", gap: "var(--space-sm)", marginBottom: "var(--space-lg)" }}>
              <Skeleton shape="rect" width="90px" height="22px" style={{ borderRadius: "var(--radius-full)" }} />
              <Skeleton shape="rect" width="110px" height="22px" style={{ borderRadius: "var(--radius-full)" }} />
              <Skeleton shape="rect" width="70px" height="22px" style={{ borderRadius: "var(--radius-full)" }} />
            </div>
          </div>
          <div className="store-hero-skeleton__footer">
            <div style={{ display: "flex", gap: "var(--space-md)", flexWrap: "wrap" }}>
              <Skeleton shape="rect" width="140px" height="64px" style={{ borderRadius: "var(--radius-md)" }} />
              <Skeleton shape="rect" width="140px" height="64px" style={{ borderRadius: "var(--radius-md)" }} />
            </div>
            <div style={{ display: "flex", gap: "var(--space-md)", marginTop: "var(--space-md)" }}>
              <Skeleton shape="rect" width="150px" height="42px" style={{ borderRadius: "var(--radius-full)" }} />
              <Skeleton shape="rect" width="130px" height="42px" style={{ borderRadius: "var(--radius-full)" }} />
            </div>
          </div>
        </div>
      </div>

      {/* Tabs bar skeleton */}
      <div style={{ display: "flex", justifyContent: "center", margin: "var(--space-xl) 0" }}>
        <div style={{ display: "flex", gap: "var(--space-sm)", padding: "4px", background: "var(--color-surface-raised)", borderRadius: "var(--radius-full)" }}>
          <Skeleton shape="rect" width="90px" height="34px" style={{ borderRadius: "var(--radius-full)" }} />
          <Skeleton shape="rect" width="90px" height="34px" style={{ borderRadius: "var(--radius-full)" }} />
          <Skeleton shape="rect" width="110px" height="34px" style={{ borderRadius: "var(--radius-full)" }} />
          <Skeleton shape="rect" width="90px" height="34px" style={{ borderRadius: "var(--radius-full)" }} />
        </div>
      </div>

      {/* 2-Column Overview Grid Skeleton */}
      <div className="game-content-grid">
        <div className="game-main-col">
          {/* About Card */}
          <div className="game-section" style={{ padding: "var(--space-xl)", borderRadius: "var(--radius-lg)", background: "var(--color-surface-raised)" }}>
            <Skeleton shape="text" width="120px" height="24px" style={{ marginBottom: "var(--space-lg)" }} />
            <div style={{ marginBottom: "var(--space-md)" }}>
              <SkeletonText lines={4} />
            </div>
            <SkeletonText lines={3} />
          </div>

          {/* Screenshots Carousel Skeleton */}
          <div className="game-section" style={{ padding: "var(--space-xl)", borderRadius: "var(--radius-lg)", background: "var(--color-surface-raised)" }}>
            <Skeleton shape="text" width="140px" height="24px" style={{ marginBottom: "var(--space-lg)" }} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-md)" }}>
              <Skeleton shape="rect" width="100%" height="120px" style={{ borderRadius: "var(--radius-md)" }} />
              <Skeleton shape="rect" width="100%" height="120px" style={{ borderRadius: "var(--radius-md)" }} />
              <Skeleton shape="rect" width="100%" height="120px" style={{ borderRadius: "var(--radius-md)" }} />
            </div>
          </div>
        </div>

        <div className="game-side-col">
          {/* Side Info Card */}
          <div className="game-section" style={{ padding: "var(--space-xl)", borderRadius: "var(--radius-lg)", background: "var(--color-surface-raised)" }}>
            <Skeleton shape="text" width="100px" height="24px" style={{ marginBottom: "var(--space-lg)" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
              <Skeleton shape="rect" width="100%" height="32px" style={{ borderRadius: "var(--radius-sm)" }} />
              <Skeleton shape="rect" width="100%" height="32px" style={{ borderRadius: "var(--radius-sm)" }} />
              <Skeleton shape="rect" width="100%" height="32px" style={{ borderRadius: "var(--radius-sm)" }} />
            </div>
          </div>

          {/* Ratings Card */}
          <div className="game-section" style={{ padding: "var(--space-xl)", borderRadius: "var(--radius-lg)", background: "var(--color-surface-raised)" }}>
            <Skeleton shape="text" width="110px" height="24px" style={{ marginBottom: "var(--space-lg)" }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-md)", marginBottom: "var(--space-lg)" }}>
              <Skeleton shape="rect" width="100%" height="70px" style={{ borderRadius: "var(--radius-md)" }} />
              <Skeleton shape="rect" width="100%" height="70px" style={{ borderRadius: "var(--radius-md)" }} />
            </div>
            <Skeleton shape="rect" width="100%" height="12px" style={{ borderRadius: "var(--radius-full)", marginBottom: "var(--space-xs)" }} />
            <Skeleton shape="rect" width="100%" height="12px" style={{ borderRadius: "var(--radius-full)" }} />
          </div>
        </div>
      </div>
    </div>
  );
}
