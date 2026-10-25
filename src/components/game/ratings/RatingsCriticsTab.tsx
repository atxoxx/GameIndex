import type { MetacriticScore } from "../../../types/game";
import { useLanguage } from "../../../context/LanguageContext";
import { IconStar } from "../icons";
import RatingsDistribution from "./RatingsDistribution";
import RatingsScoreBlock from "./RatingsScoreBlock";
import RatingsSection from "./RatingsSection";
import {
  criticRows,
  formatCount,
  hasRows,
  scoreTone,
  sentimentKey,
} from "./ratingsShared";

interface RatingsCriticsTabProps {
  score: MetacriticScore | null;
}

/** Metacritic critic score plus the positive / mixed / negative split. */
export function RatingsCriticsTab({ score }: RatingsCriticsTabProps) {
  const { t } = useLanguage();
  const metascore = score?.metascore ?? null;
  const rows = criticRows(score, t);
  const hasBreakdown = hasRows(rows);

  if (metascore == null && !hasBreakdown) {
    return (
      <div className="rt-empty">
        <IconStar size={22} />
        <p>{t("ratings.metacriticEmpty")}</p>
      </div>
    );
  }

  const sentiment = sentimentKey(metascore);

  return (
    <RatingsSection
      title={t("ratings.metacriticTitle")}
      note={t("ratings.metacritic")}
      icon={<IconStar size={14} />}
    >
      <div className="rt-detail">
        <RatingsScoreBlock
          label={t("ratings.metascore")}
          value={metascore != null ? Math.round(metascore) : "—"}
          unit={metascore != null ? "/ 100" : undefined}
          sentiment={sentiment ? t(sentiment) : null}
          meta={
            score?.criticReviewCount != null
              ? t("ratings.basedOnCritics", {
                  count: formatCount(score.criticReviewCount),
                })
              : undefined
          }
          icon={<IconStar size={12} />}
          tone={scoreTone(metascore)}
        />

        <div className="rt-detail__main">
          <span className="rt-detail__caption">{t("ratings.scoreBreakdown")}</span>
          {hasBreakdown ? (
            <RatingsDistribution rows={rows} ariaLabel={t("ratings.critics")} />
          ) : (
            <p className="rt-detail__hint">{t("ratings.metacriticEmpty")}</p>
          )}
        </div>
      </div>
    </RatingsSection>
  );
}

export default RatingsCriticsTab;
