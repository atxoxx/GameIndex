import { type ExternalSourceDescriptor } from "./types";
import { useLanguage } from "../../context/LanguageContext";
import { useFocusable } from "../../hooks/useFocusable";

interface ReviewsExternalShowcaseProps {
  sources: ExternalSourceDescriptor[];
  openExternal: (url: string) => void;
  isBigScreen?: boolean;
  criticCounts: Record<string, number>;
  onShowInApp: (source: "metacritic" | "opencritic") => void;
}

function ExternalReviewCard({
  src,
  openExternal,
  isBigScreen,
  inAppCount,
  onShowInApp,
}: {
  src: ExternalSourceDescriptor;
  openExternal: (url: string) => void;
  isBigScreen?: boolean;
  inAppCount?: number;
  onShowInApp?: () => void;
}) {
  const { t } = useLanguage();
  const focusProps = useFocusable(() => openExternal(src.url));

  const mono =
    src.criticKey === "metacritic"
      ? "MC"
      : src.criticKey === "opencritic"
      ? "OC"
      : null;

  return (
    <div className="rv-external-cell" style={{ "--accent": src.accent } as React.CSSProperties}>
      <button
        type="button"
        className="rv-external-card"
        {...(isBigScreen ? focusProps : { onClick: () => openExternal(src.url) })}
      >
        <span className="rv-external-card-icon" style={{ color: src.accent }}>
          {mono ? (
            <span className="rv-external-card-mono" aria-hidden="true">
              {mono}
            </span>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          )}
        </span>

        <span className="rv-external-card-body">
          <span className="rv-external-card-name">{src.name}</span>
          <span className="rv-external-card-desc">{src.description}</span>
        </span>

        <svg className="rv-external-card-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      {inAppCount !== undefined && inAppCount > 0 && onShowInApp && (
        <button type="button" className="rv-external-inapp" onClick={onShowInApp}>
          {t("reviewsTab.viewInApp", { count: inAppCount })}
        </button>
      )}
    </div>
  );
}

export function ReviewsExternalShowcase({
  sources,
  openExternal,
  isBigScreen,
  criticCounts,
  onShowInApp,
}: ReviewsExternalShowcaseProps) {
  const { t } = useLanguage();

  if (sources.length === 0) return null;

  return (
    <section className="rv-external-section" aria-label={t("review.externalTitle")}>
      <div className="rv-external-header">
        <div className="rv-external-header-text">
          <h3 className="rv-external-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            {t("review.externalTitle")}
          </h3>
          <p className="rv-external-subtitle">{t("review.externalSubtitle")}</p>
        </div>
      </div>

      <div className="rv-external-grid">
        {sources.map((src) => {
          const criticKey = src.criticKey;
          return (
            <ExternalReviewCard
              key={src.id}
              src={src}
              openExternal={openExternal}
              isBigScreen={isBigScreen}
              inAppCount={criticKey ? criticCounts[criticKey] : undefined}
              onShowInApp={criticKey ? () => onShowInApp(criticKey) : undefined}
            />
          );
        })}
      </div>
    </section>
  );
}
