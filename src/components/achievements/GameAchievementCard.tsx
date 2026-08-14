import { useLanguage } from "../../context/LanguageContext";
import {
  type Game,
  type AchievementSource,
  type AchievementRarity,
  RARITY_COLORS,
} from "../../types/game";
import AchievementSourceBadge from "./AchievementSourceBadge";

interface GameAchievementCardProps {
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

export default function GameAchievementCard({
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
}: GameAchievementCardProps) {
  const { t } = useLanguage();
  const isPerfect = pct === 100 && total > 0;

  return (
    <div
      className={`ach-game-card ${isPerfect ? "is-perfect" : ""}`}
      onClick={onClick}
    >
      {/* Top Banner / Cover */}
      <div className="ach-game-card-cover-wrap">
        {game.coverArtUrl ? (
          <img
            src={game.coverArtUrl}
            alt={game.name}
            className="ach-game-card-cover"
            loading="lazy"
          />
        ) : (
          <div className="ach-game-card-cover-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
        )}

        {/* Source Badge overlay */}
        <div className="ach-game-card-source-overlay">
          <AchievementSourceBadge source={source} />
        </div>

        {/* Perfect Trophy Badge overlay */}
        {isPerfect && (
          <div className="ach-game-card-perfect-tag" title={t("achievements.perfectComplete")}>
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            <span>100%</span>
          </div>
        )}
      </div>

      {/* Card Body */}
      <div className="ach-game-card-body">
        <h4 className="ach-game-card-name" title={game.name}>
          {game.name}
        </h4>

        {/* Points & Progress stats */}
        {total > 0 ? (
          <div className="ach-game-card-stats-wrap">
            <div className="ach-game-card-progress-bar">
              <div
                className="ach-game-card-progress-fill"
                style={{
                  width: `${pct}%`,
                  background: isPerfect
                    ? "linear-gradient(90deg, #f59e0b, #fbbf24)"
                    : "linear-gradient(90deg, var(--color-accent), var(--color-accent-hover))",
                }}
              />
            </div>

            <div className="ach-game-card-meta-row">
              <span className="ach-game-card-ratio">
                {unlocked}/{total} ({pct}%)
              </span>
              {pointsTotal > 0 && (
                <span className="ach-game-card-points">
                  {pointsEarned} <span className="ach-game-card-points-total">/ {pointsTotal} pts</span>
                </span>
              )}
            </div>

            {/* Rarity Mini-Pills */}
            <div className="ach-game-card-rarity-pills">
              {RARITY_TIERS.map((tier) => (
                <span
                  key={tier}
                  className="ach-game-card-rarity-pill"
                  title={`${t(`achievementsPage.rarity.${tier}`)}: ${rarity[tier]}`}
                  style={{ color: RARITY_COLORS[tier] }}
                >
                  <span
                    className="ach-game-card-rarity-dot"
                    style={{ backgroundColor: RARITY_COLORS[tier] }}
                  />
                  {rarity[tier]}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="ach-game-card-not-synced">
            <span>{t("achievementsPage.notSynced")}</span>
          </div>
        )}

        {/* Card Footer */}
        {lastSynced > 0 && (
          <div className="ach-game-card-footer">
            <span className="ach-game-card-synced">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {new Date(lastSynced).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
