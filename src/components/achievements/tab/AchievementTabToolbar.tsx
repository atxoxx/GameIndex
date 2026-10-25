import { BarChart3, Clock3, LayoutGrid, List } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { RARITY_COLORS, type AchievementRarity } from "../../../types/game";
import { Button } from "../../ui";
import {
  GameTabChips,
  GameTabSearch,
  GameTabToolbar,
  GameTabViewSwitch,
} from "../../game/tabs";
import {
  RARITY_TIERS,
  type AchievementFilter,
  type AchievementSort,
  type AchievementView,
  type RarityBreakdown,
} from "./achievementTabData";

const TIER_ICONS: Record<AchievementRarity, string> = {
  ultra_rare: "💎",
  rare: "🌟",
  uncommon: "✨",
  common: "🔹",
};

export interface AchievementTabToolbarProps {
  filter: AchievementFilter;
  onFilterChange: (filter: AchievementFilter) => void;
  counts: { all: number; unlocked: number; locked: number; secret: number };
  rarityFilter: "all" | AchievementRarity;
  onRarityFilterChange: (rarity: "all" | AchievementRarity) => void;
  breakdown: RarityBreakdown;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sort: AchievementSort;
  onSortChange: (sort: AchievementSort) => void;
  view: AchievementView;
  onViewChange: (view: AchievementView) => void;
  showSecret: boolean;
  onShowSecretChange: (value: boolean) => void;
  rarityOpen: boolean;
  onToggleRarity: () => void;
}

/** Achievement command row: status, rarity, search, sort and view. */
export default function AchievementTabToolbar({
  filter,
  onFilterChange,
  counts,
  rarityFilter,
  onRarityFilterChange,
  breakdown,
  searchQuery,
  onSearchChange,
  sort,
  onSortChange,
  view,
  onViewChange,
  showSecret,
  onShowSecretChange,
  rarityOpen,
  onToggleRarity,
}: AchievementTabToolbarProps) {
  const { t } = useLanguage();

  return (
    <GameTabToolbar
      search={
        <GameTabSearch
          value={searchQuery}
          onChange={onSearchChange}
          placeholder={t("achievements.searchAchievementsPlaceholder")}
          label={t("achievements.searchAchievementsPlaceholder")}
          clearLabel={t("achievements.clearSearch")}
        />
      }
      filters={
        <GameTabChips
          items={[
            { id: "all" as const, label: t("achievements.filter.all", { total: counts.all }) },
            {
              id: "unlocked" as const,
              label: t("achievements.filter.unlocked", { count: counts.unlocked }),
              tone: "success" as const,
            },
            {
              id: "locked" as const,
              label: t("achievements.filter.locked", { count: counts.locked }),
            },
            ...(counts.secret > 0
              ? [
                  {
                    id: "secret" as const,
                    label: t("achievements.filterSecret", { count: counts.secret }),
                    tone: "warning" as const,
                  },
                ]
              : []),
          ]}
          value={filter}
          onChange={onFilterChange}
          ariaLabel={t("achievements.filterLabel")}
        />
      }
      view={
        <GameTabViewSwitch
          items={[
            { id: "grid", label: t("achievementsPage.viewGrid"), icon: LayoutGrid },
            { id: "list", label: t("achievementsPage.viewList"), icon: List },
            { id: "timeline", label: t("achievementsPage.viewTimeline"), icon: Clock3 },
          ]}
          value={view}
          onChange={onViewChange}
          ariaLabel={t("achievements.viewLabel")}
        />
      }
      actions={
        <>
          <select
            className="game-tab-select"
            value={sort}
            onChange={(event) => onSortChange(event.target.value as AchievementSort)}
            aria-label={t("achievements.sort")}
          >
            <option value="default">{t("achievements.sortDefault")}</option>
            <option value="rarity_rare_first">{t("achievements.sortRarestFirst")}</option>
            <option value="rarity_common_first">{t("achievements.sortCommonFirst")}</option>
            <option value="unlockDate">{t("achievements.sortUnlockDate")}</option>
            <option value="name">{t("achievements.sortName")}</option>
          </select>
          {counts.secret > 0 && (
            <label className="ach-reveal-toggle-label">
              <input
                type="checkbox"
                checked={showSecret}
                onChange={(event) => onShowSecretChange(event.target.checked)}
              />
              <span>{t("achievements.revealAllSecrets")}</span>
            </label>
          )}
          <Button
            variant={rarityOpen ? "secondary" : "ghost"}
            size="sm"
            leftIcon={<BarChart3 size={14} />}
            onClick={onToggleRarity}
            aria-expanded={rarityOpen}
          >
            {t("achievements.rarityPanel")}
          </Button>
        </>
      }
      below={
        <div className="ach-rarity-filter-pills">
          <button
            type="button"
            className={`ach-rarity-filter-pill${rarityFilter === "all" ? " active" : ""}`}
            onClick={() => onRarityFilterChange("all")}
          >
            {t("common.all")}
          </button>
          {RARITY_TIERS.map((tier) => {
            const tierTotal = breakdown.total[tier];
            if (tierTotal === 0) return null;
            const active = rarityFilter === tier;
            return (
              <button
                key={tier}
                type="button"
                className={`ach-rarity-filter-pill${active ? " active" : ""}`}
                style={{
                  color: RARITY_COLORS[tier],
                  borderColor: active ? RARITY_COLORS[tier] : undefined,
                }}
                onClick={() => onRarityFilterChange(active ? "all" : tier)}
              >
                {TIER_ICONS[tier]} {t(`achievementsPage.rarity.${tier}`)} (
                {breakdown.unlocked[tier]}/{tierTotal})
              </button>
            );
          })}
        </div>
      }
    />
  );
}
