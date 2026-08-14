import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";
import type { Game, AchievementSource } from "../../types/game";
import AchievementSourceBadge from "./AchievementSourceBadge";

export interface AlmostDoneGameItem {
  game: Game;
  total: number;
  unlocked: number;
  pct: number;
  remaining: number;
  source: AchievementSource;
}

interface AchievementsAlmostDoneShelfProps {
  games: AlmostDoneGameItem[];
}

export default function AchievementsAlmostDoneShelf({
  games,
}: AchievementsAlmostDoneShelfProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();

  if (games.length === 0) return null;

  return (
    <div className="ach-almost-done-shelf">
      <div className="ach-shelf-header">
        <div className="ach-shelf-title-wrap">
          <h3 className="achievements-section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {t("achievementsPage.almostDoneTitle")}
          </h3>
          <span className="ach-section-subtitle">
            {t("achievementsPage.almostDoneSubtitle")}
          </span>
        </div>
      </div>

      <div className="ach-almost-done-list">
        {games.map((item) => (
          <div
            key={item.game.id}
            className="ach-almost-done-card"
            onClick={() => navigate(`/library/${item.game.id}`)}
          >
            <div className="ach-almost-done-cover">
              {item.game.coverArtUrl ? (
                <img src={item.game.coverArtUrl} alt={item.game.name} loading="lazy" />
              ) : (
                <div className="ach-almost-done-cover-placeholder">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="20" height="20">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                </div>
              )}
            </div>

            <div className="ach-almost-done-info">
              <div className="ach-almost-done-top">
                <span className="ach-almost-done-name" title={item.game.name}>
                  {item.game.name}
                </span>
                <AchievementSourceBadge source={item.source} />
              </div>

              <div className="ach-almost-done-progress-wrap">
                <div className="ach-almost-done-progress-bar">
                  <div
                    className="ach-almost-done-progress-fill"
                    style={{ width: `${item.pct}%` }}
                  />
                </div>
                <div className="ach-almost-done-meta">
                  <span className="ach-almost-done-pct">{item.pct}%</span>
                  <span className="ach-almost-done-remain">
                    {t("achievementsPage.remainingCount", { count: item.remaining })}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
