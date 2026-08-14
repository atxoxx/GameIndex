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

interface AchievementItemCardProps {
  achievement: Achievement;
  globalRevealSecret?: boolean;
}

const TIER_ICONS: Record<AchievementRarity, string> = {
  ultra_rare: "💎",
  rare: "🌟",
  uncommon: "✨",
  common: "🔹",
};

export default function AchievementItemCard({
  achievement: a,
  globalRevealSecret = false,
}: AchievementItemCardProps) {
  const { t } = useLanguage();
  const [localReveal, setLocalReveal] = useState(false);

  const rarity = getAchievementRarity(a.percent);
  const rarityColor = RARITY_COLORS[rarity];
  const points = getAchievementPoints(a.percent);

  // Check if achievement is hidden / secret
  const isHidden = !a.achieved && a.description.toLowerCase().includes("hidden");
  const isRevealed = globalRevealSecret || localReveal || a.achieved;

  return (
    <div
      className={`achievement-card ${a.achieved ? "unlocked" : "locked"} rarity-${rarity}`}
      style={{
        borderColor: a.achieved
          ? `color-mix(in srgb, ${rarityColor} 45%, var(--color-border))`
          : undefined,
      }}
    >
      {/* Icon with glow effect */}
      <div className="achievement-card-icon-wrap">
        <div
          className={`achievement-card-icon ${a.achieved ? "has-glow" : ""}`}
          style={{
            boxShadow: a.achieved && (rarity === "ultra_rare" || rarity === "rare")
              ? `0 0 16px color-mix(in srgb, ${rarityColor} 60%, transparent)`
              : undefined,
          }}
        >
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

      <div className="achievement-card-body">
        <div className="achievement-card-header">
          <div className="achievement-card-title-row">
            <h4 className="achievement-card-name">{a.displayName}</h4>
            <span
              className="achievement-card-points-tag"
              style={{ color: rarityColor, borderColor: rarityColor }}
            >
              +{points} pts
            </span>
          </div>

          {a.achieved && a.unlockTime > 0 && (
            <div className="achievement-card-date" title={formatUnlockDateTime(a.unlockTime)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>{formatRelativeTime(a.unlockTime)}</span>
            </div>
          )}
        </div>

        {/* Description & Secret Toggle */}
        <div className="achievement-card-desc-wrap">
          {isHidden && !isRevealed ? (
            <div className="achievement-card-secret-prompt">
              <span className="achievement-card-secret-text">
                🔒 {t("achievements.secretAchievement")}
              </span>
              <button
                type="button"
                className="achievement-card-reveal-btn"
                onClick={() => setLocalReveal(true)}
                title={t("achievements.revealSpoiler")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                {t("achievements.reveal")}
              </button>
            </div>
          ) : (
            <p className="achievement-card-desc">{a.description}</p>
          )}
        </div>

        {/* Global Rarity Bar */}
        <div className="achievement-card-rarity">
          <div className="achievement-card-rarity-bar">
            <div
              className="achievement-card-rarity-fill"
              style={{ width: `${a.percent}%`, background: rarityColor }}
            />
          </div>
          <span
            className="achievement-card-rarity-pct"
            style={{ color: rarityColor }}
          >
            {TIER_ICONS[rarity]} {a.percent.toFixed(1)}% {t(`achievementsPage.rarity.${rarity}`)}
          </span>
        </div>
      </div>
    </div>
  );
}
