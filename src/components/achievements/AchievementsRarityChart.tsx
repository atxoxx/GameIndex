import { useLanguage } from "../../context/LanguageContext";
import { type AchievementRarity, RARITY_COLORS } from "../../types/game";

interface AchievementsRarityChartProps {
  rarityTotal: Record<AchievementRarity, number>;
  rarityUnlocked: Record<AchievementRarity, number>;
  totalAchievements: number;
}

const TIERS: readonly AchievementRarity[] = [
  "ultra_rare",
  "rare",
  "uncommon",
  "common",
];

const TIER_ICONS: Record<AchievementRarity, string> = {
  ultra_rare: "💎",
  rare: "🌟",
  uncommon: "✨",
  common: "🔹",
};

export default function AchievementsRarityChart({
  rarityTotal,
  rarityUnlocked,
  totalAchievements,
}: AchievementsRarityChartProps) {
  const { t } = useLanguage();

  if (totalAchievements === 0) return null;

  return (
    <div className="ach-card-section ach-rarity-widget">
      <div className="ach-card-section-head">
        <h3 className="achievements-section-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          {t("achievementsPage.rarityDistribution")}
        </h3>
        <span className="ach-section-subtitle">
          {t("achievementsPage.raritySubtitle")}
        </span>
      </div>

      {/* Segmented Stacked Bar */}
      <div className="achievements-rarity-bar-wrap">
        <div className="achievements-rarity-bar achievements-rarity-bar-lg">
          {TIERS.map((tier) => {
            const count = rarityTotal[tier];
            if (count === 0) return null;
            const pct = (count / totalAchievements) * 100;
            return (
              <div
                key={tier}
                className="achievements-rarity-segment"
                data-tier={tier}
                style={{
                  width: `${pct}%`,
                  backgroundColor: RARITY_COLORS[tier],
                }}
                title={`${t(`achievementsPage.rarity.${tier}`)}: ${count} (${Math.round(pct)}%)`}
              />
            );
          })}
        </div>
      </div>

      {/* Tier Cards Grid */}
      <div className="ach-rarity-cards-grid">
        {TIERS.map((tier) => {
          const total = rarityTotal[tier] || 0;
          const unlocked = rarityUnlocked[tier] || 0;
          const pct = total > 0 ? Math.round((unlocked / total) * 100) : 0;
          const tierColor = RARITY_COLORS[tier];

          return (
            <div
              key={tier}
              className="ach-rarity-card"
              data-tier={tier}
              style={{
                borderColor: `color-mix(in srgb, ${tierColor} 30%, var(--color-border))`,
              }}
            >
              <div className="ach-rarity-card-top">
                <span className="ach-rarity-card-icon">{TIER_ICONS[tier]}</span>
                <span className="ach-rarity-card-name" style={{ color: tierColor }}>
                  {t(`achievementsPage.rarity.${tier}`)}
                </span>
                <span className="ach-rarity-card-pct">{pct}%</span>
              </div>
              <div className="ach-rarity-card-bar">
                <div
                  className="ach-rarity-card-bar-fill"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: tierColor,
                  }}
                />
              </div>
              <div className="ach-rarity-card-counts">
                <span className="ach-rarity-card-unlocked">
                  {unlocked} <span className="ach-rarity-card-of">{t("common.of")}</span> {total}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
