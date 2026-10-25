import { Sparkles, Trophy } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { RARITY_COLORS, getAchievementRarity, type Achievement } from "../../../types/game";
import type { AlmostDoneMode } from "./achievementTabData";

export interface AchievementAlmostDoneShelfProps {
  items: Achievement[];
  mode: AlmostDoneMode;
}

/**
 * The next-unlocks shelf.
 *
 * With three or fewer unlocks left it becomes a finish line; otherwise it
 * surfaces the most commonly unlocked achievements still missing, which is
 * the closest honest proxy for "easiest next" without per-achievement progress.
 */
export default function AchievementAlmostDoneShelf({
  items,
  mode,
}: AchievementAlmostDoneShelfProps) {
  const { t } = useLanguage();
  if (items.length === 0) return null;

  const finish = mode === "finish";

  return (
    <section className="ach-shelf" aria-label={t("achievements.shelfLabel")}>
      <header className="ach-shelf__head">
        <span className="ach-shelf__icon" aria-hidden="true">
          {finish ? <Trophy size={15} /> : <Sparkles size={15} />}
        </span>
        <span className="ach-shelf__titles">
          <strong>
            {finish ? t("achievements.finishLine") : t("achievements.likelyNext")}
          </strong>
          <span>
            {finish
              ? t("achievements.finishLineHint", { count: items.length })
              : t("achievements.likelyNextHint")}
          </span>
        </span>
      </header>

      <div className="ach-shelf__items">
        {items.map((achievement) => {
          const rarity = getAchievementRarity(achievement.percent);
          return (
            <article className="ach-shelf__item" key={achievement.apiName}>
              <span className="ach-shelf__art" aria-hidden="true">
                {achievement.iconGray ? (
                  <img src={achievement.iconGray} alt="" loading="lazy" />
                ) : (
                  <Trophy size={18} />
                )}
              </span>
              <span className="ach-shelf__text">
                <span className="ach-shelf__name">{achievement.displayName}</span>
                <span className="ach-shelf__desc">
                  {achievement.description || t("achievements.noDescription")}
                </span>
              </span>
              <span
                className="ach-shelf__rarity"
                style={{ color: RARITY_COLORS[rarity] }}
              >
                {achievement.percent.toFixed(1)}%
              </span>
            </article>
          );
        })}
      </div>
    </section>
  );
}
