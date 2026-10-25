import { Trophy } from "lucide-react";
import { useAchievements } from "../../../context/AchievementContext";
import { useLanguage } from "../../../context/LanguageContext";
import { Badge, Card } from "../../ui";
import type { OverlayWidgetProps } from "./types";

/** Recent-unlock summary from the achievements store. */
export default function AchievementsWidget({ bare = false }: OverlayWidgetProps) {
  const { recentUnlocks, stats } = useAchievements();
  const { t } = useLanguage();

  return (
    <Card variant="glass" className="overlay-widget">
      {!bare && (
        <div className="overlay-widget__head">
          <span className="overlay-widget__icon" aria-hidden>
            <Trophy />
          </span>
          <h3 className="overlay-widget__title">{t("overlay.widget.achievements")}</h3>
          {stats && (
            <Badge variant="accent">
              {t("overlay.achievements.unlocked", {
                unlocked: stats.unlocked,
                total: stats.total,
              })}
            </Badge>
          )}
        </div>
      )}

      {recentUnlocks.length === 0 ? (
        <p className="overlay-widget__empty">{t("overlay.achievements.none")}</p>
      ) : (
        <ul className="overlay-list">
          {recentUnlocks.slice(0, 4).map((record) => (
            <li
              key={`${record.gameId}:${record.achievement.apiName}`}
              className="overlay-list__row"
            >
              <span className="overlay-list__name">
                {record.achievement.displayName}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
