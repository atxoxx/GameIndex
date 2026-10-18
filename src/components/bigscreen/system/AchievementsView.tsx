// AchievementsView — System hub sub-view ranking games by unlocked
// achievements and linking each row to the game's hub page.

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../../context/LanguageContext";
import { useGames } from "../../../context/GameContext";
import { useAchievements } from "../../../context/AchievementContext";
import type { Game, AchievementSummary } from "../../../types/game";
import { gameDisplayName } from "../../../types/game";
import { useFocusable } from "../../../hooks/useFocusable";
import { BigScreenEmptyState } from "../BigScreenState";
import "../../../styles/achievements.css";

export default function AchievementsView() {
  const { t } = useLanguage();
  const { games } = useGames();
  const { summaries } = useAchievements();
  const navigate = useNavigate();

  const gamesWithAchievements = useMemo(() => {
    return games
      .map((g) => ({ game: g, summary: summaries[g.id] ?? null }))
      .filter((x) => x.summary && x.summary.total > 0)
      .sort((a, b) => (b.summary?.unlocked ?? 0) - (a.summary?.unlocked ?? 0));
  }, [games, summaries]);

  return (
    <div className="bigscreen-system-section-view">
      <h3>{t("bigscreen.system.achievementsTracker")}</h3>
      {gamesWithAchievements.length === 0 ? (
        <BigScreenEmptyState message={t("bigscreen.system.noAchievements")} />
      ) : (
        <div className="system-achievements-list">
          {gamesWithAchievements.map(({ game, summary }) => (
            <AchievementGameRow
              key={game.id}
              game={game}
              summary={summary}
              onOpen={() => navigate(`/library/${game.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AchievementGameRow({
  game,
  summary,
  onOpen,
}: {
  game: Game;
  summary: AchievementSummary | null;
  onOpen: () => void;
}) {
  const { t } = useLanguage();
  const cardProps = useFocusable(onOpen);
  const pct = summary ? Math.round((summary.unlocked / summary.total) * 100) : 0;

  return (
    <div className="system-achievement-game-row" {...cardProps} role="link">
      <div className="ach-game-header">
        <span className="ach-game-name">{gameDisplayName(game)}</span>
        <span className="ach-game-counts">
          {t("bigscreen.system.achCounts", { unlocked: summary?.unlocked ?? 0, total: summary?.total ?? 0, pct })}
        </span>
      </div>
      <div className="dl-progress-bar">
        <div className="dl-progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
