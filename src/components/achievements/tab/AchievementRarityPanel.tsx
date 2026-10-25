import { ChevronDown } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { RARITY_COLORS, type AchievementRarity } from "../../../types/game";
import { RARITY_TIERS, type RarityBreakdown } from "./achievementTabData";

const TIER_ICONS: Record<AchievementRarity, string> = {
  ultra_rare: "💎",
  rare: "🌟",
  uncommon: "✨",
  common: "🔹",
};

export interface AchievementRarityPanelProps {
  breakdown: RarityBreakdown;
  total: number;
  unlocked: number;
  open: boolean;
  onToggle: () => void;
}

/** Collapsible rarity distribution; the grid keeps the full width when closed. */
export default function AchievementRarityPanel({
  breakdown,
  total,
  unlocked,
  open,
  onToggle,
}: AchievementRarityPanelProps) {
  const { t } = useLanguage();

  return (
    <aside className={`ach-rarity-panel${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="ach-rarity-panel__toggle"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span>{t("achievementsPage.rarityDistribution")}</span>
        <ChevronDown size={15} className={open ? "is-open" : undefined} />
      </button>

      {open && (
        <div className="ach-rarity-panel__body">
          <div className="ach-rarity-side-stats">
            <div className="achievements-stat-card">
              <span className="achievements-stat-value">{unlocked}</span>
              <span className="achievements-stat-label">{t("achievements.unlocked")}</span>
            </div>
            <div className="achievements-stat-card">
              <span className="achievements-stat-value achievements-stat-locked">
                {total - unlocked}
              </span>
              <span className="achievements-stat-label">{t("achievements.locked")}</span>
            </div>
            <div className="achievements-stat-card">
              <span className="achievements-stat-value">{total}</span>
              <span className="achievements-stat-label">{t("achievements.total")}</span>
            </div>
          </div>

          {total > 0 && (
            <div className="achievements-rarity-bar-wrap">
              <div className="achievements-rarity-bar">
                {RARITY_TIERS.map((tier) => {
                  const count = breakdown.total[tier];
                  if (count === 0) return null;
                  const pct = (count / total) * 100;
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
          )}

          {RARITY_TIERS.map((tier) => {
            const tierTotal = breakdown.total[tier];
            if (tierTotal === 0) return null;
            const tierUnlocked = breakdown.unlocked[tier];
            const tierPct = Math.round((tierUnlocked / tierTotal) * 100);
            return (
              <div className="ach-rarity-row" key={tier}>
                <div className="ach-rarity-row-head">
                  <span className="ach-rarity-row-label" style={{ color: RARITY_COLORS[tier] }}>
                    {TIER_ICONS[tier]} {t(`achievementsPage.rarity.${tier}`)}
                  </span>
                  <span className="ach-rarity-row-counts">
                    {tierUnlocked}/{tierTotal} ({tierPct}%)
                  </span>
                </div>
                <div className="ach-rarity-row-bar">
                  <div
                    className="ach-rarity-row-fill"
                    style={{ width: `${tierPct}%`, background: RARITY_COLORS[tier] }}
                  />
                </div>
              </div>
            );
          })}

          {total > unlocked && (
            <div className="ach-sidebar-remaining-box">
              <span className="ach-sidebar-remaining-title">
                {t("achievements.remainingToPerfect")}
              </span>
              <span className="ach-sidebar-remaining-count">
                {total - unlocked} {t("achievements.remainingAchievements")}
              </span>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
