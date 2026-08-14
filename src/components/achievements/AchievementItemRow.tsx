import { useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import {
  type Achievement,
  type AchievementRarity,
  getAchievementRarity,
  RARITY_COLORS,
} from "../../types/game";
import {
  getAchievementPoints,
  formatUnlockDateTime,
  formatRelativeTime,
} from "./achievementUtils";

interface AchievementItemRowProps {
  achievement: Achievement;
  globalRevealSecret?: boolean;
}

const TIER_ICONS: Record<AchievementRarity, string> = {
  ultra_rare: "💎",
  rare: "🌟",
  uncommon: "✨",
  common: "🔹",
};

export default function AchievementItemRow({
  achievement: a,
  globalRevealSecret = false,
}: AchievementItemRowProps) {
  const { t } = useLanguage();
  const [localReveal, setLocalReveal] = useState(false);

  const rarity: AchievementRarity = getAchievementRarity(a.percent);
  const rarityColor = RARITY_COLORS[rarity];
  const points = getAchievementPoints(a.percent);

  const isHidden = !a.achieved && a.description.toLowerCase().includes("hidden");
  const isRevealed = globalRevealSecret || localReveal || a.achieved;

  return (
    <div
      className={`ach-compact-row ${a.achieved ? "unlocked" : "locked"} rarity-${rarity}`}
    >
      <div className="ach-compact-status-col">
        <div className="ach-compact-icon">
          <img
            src={(a.achieved ? a.icon : a.iconGray) || a.icon}
            alt={a.displayName}
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      </div>

      <div className="ach-compact-info-col">
        <div className="ach-compact-title-row">
          <span className="ach-compact-name">{a.displayName}</span>
          <span className="ach-compact-points" style={{ color: rarityColor }}>
            +{points} pts
          </span>
        </div>

        {isHidden && !isRevealed ? (
          <div className="ach-compact-secret-row">
            <span className="ach-compact-secret-label">
              🔒 {t("achievements.secretAchievement")}
            </span>
            <button
              type="button"
              className="ach-compact-reveal-btn"
              onClick={() => setLocalReveal(true)}
            >
              {t("achievements.reveal")}
            </button>
          </div>
        ) : (
          <span className="ach-compact-desc">{a.description}</span>
        )}
      </div>

      <div className="ach-compact-rarity-col">
        <span className="ach-compact-rarity-pill" style={{ color: rarityColor }}>
          {TIER_ICONS[rarity]} {a.percent.toFixed(1)}%
        </span>
      </div>

      <div className="ach-compact-date-col">
        {a.achieved && a.unlockTime > 0 ? (
          <span
            className="ach-compact-date-text"
            title={formatUnlockDateTime(a.unlockTime)}
          >
            {formatRelativeTime(a.unlockTime)}
          </span>
        ) : (
          <span className="ach-compact-locked-label">
            {t("achievements.locked")}
          </span>
        )}
      </div>
    </div>
  );
}
