import type { HltbStats } from "../../../types/game";
import { StatBand } from "../../ui";
import type { StatBandItem } from "../../ui";
import {
  IconCheck,
  IconClock,
  IconPlay,
  IconRefresh,
  IconStar,
  IconUsers,
  IconX,
} from "../icons";
import { formatCount, type Translate } from "./hltbShared";

function scoreTone(score: number): "success" | "warning" | "danger" {
  if (score >= 75) return "success";
  if (score >= 50) return "warning";
  return "danger";
}

/** Review score + histogram, then the HLTB community tallies. */
export function HltbCommunitySection({
  stats,
  t,
}: {
  stats: HltbStats;
  t: Translate;
}) {
  const community = stats.community ?? {};
  const score = community.reviewScore;
  const histogram = [...(stats.reviewHistogram ?? [])]
    .filter((bucket) => bucket.count > 0)
    .sort((a, b) => b.score - a.score);
  const maxCount = Math.max(1, ...histogram.map((bucket) => bucket.count));

  const allTallies: StatBandItem[] = [
    {
      id: "playing",
      label: t("hltb.playing"),
      value: formatCount(community.playing),
      icon: <IconPlay size={12} />,
      tone: "info",
    },
    {
      id: "backlog",
      label: t("hltb.backlog"),
      value: formatCount(community.backlog),
      icon: <IconClock size={12} />,
    },
    {
      id: "completed",
      label: t("hltb.completed"),
      value: formatCount(community.completed),
      icon: <IconCheck size={12} />,
      tone: "success",
    },
    {
      id: "replays",
      label: t("hltb.replays"),
      value: formatCount(community.replays),
      icon: <IconRefresh size={12} />,
    },
    {
      id: "retired",
      label: t("hltb.retired"),
      value: formatCount(community.retired),
      icon: <IconX size={12} />,
    },
    {
      id: "reviews",
      label: t("hltb.reviews"),
      value: formatCount(community.reviews),
      icon: <IconStar size={12} />,
      tone: "accent",
    },
    {
      id: "total",
      label: t("hltb.totalLogged"),
      value: formatCount(community.total),
      icon: <IconUsers size={12} />,
    },
  ];
  const tallies = allTallies.filter((item) => item.value !== "—");

  return (
    <>
      {(score != null || histogram.length > 0) && (
        <section className="hltb-section">
          <div className="hltb-section__head">
            <h3 className="hltb-section__title">
              <IconStar size={14} />
              {t("hltb.reviews")}
            </h3>
            {score == null && community.reviews != null && (
              <span className="hltb-section__note">
                {t("hltb.basedOnReviews", { count: formatCount(community.reviews) })}
              </span>
            )}
          </div>

          <div className="hltb-community-top">
            {score != null && (
              <div className={`hltb-score-card hltb-score-card--${scoreTone(score)}`}>
                <span className="hltb-score-card__value">{score}</span>
                <span className="hltb-score-card__label">{t("hltb.communityScore")}</span>
                {community.reviews != null && (
                  <span className="hltb-score-card__meta">
                    {t("hltb.basedOnReviews", { count: formatCount(community.reviews) })}
                  </span>
                )}
              </div>
            )}

            {histogram.length > 0 && (
              <div className="hltb-hist-block">
                <span className="hltb-subhead">{t("hltb.reviewDistribution")}</span>
                <div className="hltb-hist">
                  {histogram.map((bucket) => (
                    <div className="hltb-hist__row" key={bucket.score}>
                      <span className="hltb-hist__score">{bucket.score}</span>
                      <span className="hltb-hist__track">
                        <span
                          className="hltb-hist__fill"
                          style={{ width: `${(bucket.count / maxCount) * 100}%` }}
                        />
                      </span>
                      <span className="hltb-hist__count">{formatCount(bucket.count)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {tallies.length > 0 && (
        <section className="hltb-section">
          <div className="hltb-section__head">
            <h3 className="hltb-section__title">
              <IconUsers size={14} />
              {t("hltb.community")}
            </h3>
          </div>
          <StatBand
            items={tallies}
            ariaLabel={t("hltb.community")}
            className="hltb-tallies"
          />
        </section>
      )}
    </>
  );
}

export default HltbCommunitySection;
