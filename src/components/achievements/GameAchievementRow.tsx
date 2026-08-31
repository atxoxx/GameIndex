import { memo } from "react";
import { useLanguage } from "../../context/LanguageContext";
import {
  type Game,
  type AchievementSource,
  type AchievementRarity,
  RARITY_COLORS,
} from "../../types/game";
import AchievementSourceBadge from "./AchievementSourceBadge";

interface GameAchievementRowProps {
  game: Game;
  total: number;
  unlocked: number;
  pct: number;
  pointsEarned: number;
  pointsTotal: number;
  lastSynced: number;
  source: AchievementSource;
  rarity: Record<AchievementRarity, number>;
  onClick: () => void;
}

const RARITY_TIERS: readonly AchievementRarity[] = [
  "ultra_rare",
  "rare",
  "uncommon",
  "common",
];

function GameAchievementRowBase({
  game,
  total,
  unlocked,
  pct,
  pointsEarned,
  pointsTotal,
  lastSynced,
  source,
  rarity,
  onClick,
}: GameAchievementRowProps) {
  const { t } = useLanguage();
  const isPerfect = pct === 100 && total > 0;

  return (
    <div className={`achievements-game-row ${isPerfect ? "is-perfect" : ""}`} onClick={onClick}>
      <div className="achievements-game-cover">
        {game.coverArtUrl ? (
          <img src={game.coverArtUrl} alt={game.name} loading="lazy" />
        ) : (
          <div className="achievements-game-cover-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="20" height="20">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
        )}
      </div>

      <div className="achievements-game-info">
        <div className="achievements-game-name-row">
          <span className="achievements-game-name">{game.name}</span>
          {pointsTotal > 0 && (
            <span className="ach-row-points-badge">
              {pointsEarned} / {pointsTotal} pts
            </span>
          )}
        </div>

        {total > 0 ? (
          <div className="achievements-game-progress-wrap">
            <div className="achievements-game-progress-bar">
              <div
                className="achievements-game-progress-fill"
                style={{
                  width: `${pct}%`,
                  background: isPerfect
                    ? "linear-gradient(90deg, var(--color-warning), var(--color-stale))"
                    : "linear-gradient(90deg, var(--color-accent), var(--color-accent-hover))",
                }}
              />
            </div>
            <span className="achievements-game-progress-text">
              {unlocked}/{total} ({pct}%)
            </span>
          </div>
        ) : (
          <span className="achievements-game-not-synced">{t("achievementsPage.notSynced")}</span>
        )}
      </div>

      <AchievementSourceBadge source={source} />

      <div className="ach-rarity-counts">
        {RARITY_TIERS.map((tier) => (
          <div
            key={tier}
            className="ach-rarity-count"
            title={`${t(`achievementsPage.rarity.${tier}`)}: ${rarity[tier]}`}
          >
            <span className="ach-rarity-count-value" style={{ color: RARITY_COLORS[tier] }}>
              {rarity[tier]}
            </span>
            <span className="ach-rarity-count-label">{t(`achievementsPage.rarity.${tier}`)}</span>
          </div>
        ))}
      </div>

      <div className="achievements-game-row-trail">
        {isPerfect && (
          <div className="achievements-perfect-badge" title={t("achievements.perfectComplete")}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </div>
        )}
        {lastSynced > 0 && (
          <span className="achievements-game-synced-at">
            {new Date(lastSynced).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
        )}
      </div>
    </div>
  );
}

const GameAchievementRow = memo(GameAchievementRowBase, (prev, next) => {
  return (
    prev.game === next.game &&
    prev.total === next.total &&
    prev.unlocked === next.unlocked &&
    prev.pct === next.pct &&
    prev.pointsEarned === next.pointsEarned &&
    prev.pointsTotal === next.pointsTotal &&
    prev.lastSynced === next.lastSynced &&
    prev.source === next.source
  );
});

export default GameAchievementRow;
