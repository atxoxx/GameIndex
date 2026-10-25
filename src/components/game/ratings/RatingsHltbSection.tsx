import type { HltbStats } from "../../../types/game";
import { StatBand } from "../../ui";
import type { StatBandItem } from "../../ui";
import { useLanguage } from "../../../context/LanguageContext";
import {
  IconCheck,
  IconClock,
  IconPlay,
  IconRefresh,
  IconStar,
  IconUsers,
  IconX,
} from "../icons";
import RatingsScoreBlock from "./RatingsScoreBlock";
import { formatCount, scoreTone } from "./ratingsShared";

interface RatingsHltbSectionProps {
  stats: HltbStats;
}

/**
 * HowLongToBeat community block, moved out of the HLTB sheet and into the
 * Ratings sheet: community review score, the 1–100 review distribution and
 * the playing / backlog / completed tallies.
 */
export function RatingsHltbSection({ stats }: RatingsHltbSectionProps) {
  const { t } = useLanguage();
  const community = stats.community ?? {};
  const score = community.reviewScore ?? null;
  const histogram = [...(stats.reviewHistogram ?? [])]
    .filter((bucket) => bucket.count > 0)
    .sort((a, b) => b.score - a.score);
  const maxCount = Math.max(1, ...histogram.map((bucket) => bucket.count));

  const tallies: StatBandItem[] = [
    {
      id: "playing",
      label: t("hltb.playing"),
      value: formatCount(community.playing),
      icon: <IconPlay size={12} />,
      tone: "info" as const,
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
      tone: "success" as const,
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
      tone: "accent" as const,
    },
    {
      id: "total",
      label: t("hltb.totalLogged"),
      value: formatCount(community.total),
      icon: <IconUsers size={12} />,
    },
  ].filter((item) => item.value !== "—");

  return (
    <div className="rt-hltb">
      <div className="rt-hltb__top">
        <RatingsScoreBlock
          label={t("hltb.communityScore")}
          value={score != null ? score : "—"}
          unit={score != null ? "/ 100" : undefined}
          meta={
            community.reviews != null
              ? t("hltb.basedOnReviews", { count: formatCount(community.reviews) })
              : undefined
          }
          icon={<IconStar size={12} />}
          tone={scoreTone(score)}
          className="rt-hltb__score"
        />

        {histogram.length > 0 && (
          <div className="rt-hist">
            <span className="rt-hist__title">{t("hltb.reviewDistribution")}</span>
            <div className="rt-hist__rows">
              {histogram.map((bucket) => (
                <div className="rt-hist__row" key={bucket.score}>
                  <span className="rt-hist__label">{bucket.score}</span>
                  <span className="rt-hist__track">
                    <span
                      className={`rt-hist__fill rt-hist__fill--${
                        scoreTone(bucket.score) ?? "warning"
                      }`}
                      style={{ width: `${(bucket.count / maxCount) * 100}%` }}
                    />
                  </span>
                  <span className="rt-hist__count">{formatCount(bucket.count)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {tallies.length > 0 && (
        <div className="rt-hltb__tallies">
          <span className="rt-hltb__subhead">{t("hltb.community")}</span>
          <StatBand
            items={tallies}
            ariaLabel={t("hltb.community")}
            className="rt-hltb__band"
          />
        </div>
      )}
    </div>
  );
}

export default RatingsHltbSection;
