import { useLanguage } from "../../context/LanguageContext";
import type { HealthCategory, HealthCounts, HealthScore } from "./health";
import { HealthCategoryIcon } from "./HealthCategoryIcon";

interface Props {
  score: HealthScore;
  counts: HealthCounts;
  onSelectCategory: (category: HealthCategory) => void;
}

const CATEGORIES: {
  id: HealthCategory;
  labelKey: string;
  descKey: string;
  tone: "danger" | "warning" | "info";
}[] = [
  { id: "paths", labelKey: "storage.health.cat.paths.title", descKey: "storage.health.cat.paths.desc", tone: "danger" },
  { id: "duplicates", labelKey: "storage.health.cat.duplicates.title", descKey: "storage.health.cat.duplicates.desc", tone: "warning" },
  { id: "metadata", labelKey: "storage.health.cat.metadata.title", descKey: "storage.health.cat.metadata.desc", tone: "info" },
  { id: "artwork", labelKey: "storage.health.cat.artwork.title", descKey: "storage.health.cat.artwork.desc", tone: "warning" },
  { id: "sizes", labelKey: "storage.health.cat.sizes.title", descKey: "storage.health.cat.sizes.desc", tone: "info" },
  { id: "backlog", labelKey: "storage.health.cat.backlog.title", descKey: "storage.health.cat.backlog.desc", tone: "warning" },
];

const RING_RADIUS = 42;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function HealthOverviewTab({ score, counts, onSelectCategory }: Props) {
  const { t } = useLanguage();

  return (
    <div className="health-overview">
      <div className={`health-score-card health-score-card--${score.band}`}>
        <div className="health-score-visual">
          <svg className="health-score-ring" viewBox="0 0 100 100" aria-hidden="true">
            <circle className="health-score-ring-track" cx="50" cy="50" r={RING_RADIUS} />
            <circle
              className="health-score-ring-value"
              cx="50"
              cy="50"
              r={RING_RADIUS}
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={RING_CIRCUMFERENCE * (1 - score.score / 100)}
              transform="rotate(-90 50 50)"
            />
          </svg>
          <div className="health-score-text">
            <span className="health-score-value">{score.score}</span>
            <span className="health-score-band">{t(`storage.health.band.${score.band}`)}</span>
          </div>
        </div>
        <div className="health-score-summary">
          <h3 className="health-score-heading">{t("storage.health.score.heading")}</h3>
          <p className="health-score-desc">
            {counts.total === 0
              ? t("storage.health.score.allClear")
              : t("storage.health.score.issues", {
                  count: counts.total,
                  plural: counts.total === 1 ? "" : "s",
                })}
          </p>
        </div>
      </div>

      <div className="health-cat-grid">
        {CATEGORIES.map((category) => {
          const count = counts[category.id];
          return (
            <button
              key={category.id}
              type="button"
              className={`health-cat-card ${count === 0 ? "health-cat-card--clear" : ""}`}
              onClick={() => onSelectCategory(category.id)}
              disabled={count === 0}
            >
              <span className={`health-cat-icon health-cat-icon--${category.tone}`}>
                <HealthCategoryIcon category={category.id} />
              </span>
              <span className="health-cat-body">
                <span className="health-cat-title">
                  {t(category.labelKey)}
                  <span className={`health-cat-count ${count > 0 ? `health-cat-count--${category.tone}` : ""}`}>
                    {count}
                  </span>
                </span>
                <span className="health-cat-desc">{t(category.descKey)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
