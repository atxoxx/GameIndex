import type { GamePassGame } from "../../types/deals";
import type { GamePassFiltersState } from "../../pages/deals/dealsConstants";
import {
  GP_REGIONS,
  GP_CATEGORIES,
  GP_CATEGORY_KEYS,
  GP_PLATFORMS,
} from "../../pages/deals/dealsConstants";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";
import GamePassCard from "./GamePassCard";
import DealsSkeletonGrid from "./DealsSkeletonGrid";
import DealsEmptyState, { DealsErrorState } from "./DealsEmptyState";

interface GamePassPanelProps {
  filters: GamePassFiltersState;
  setFilters: React.Dispatch<React.SetStateAction<GamePassFiltersState>>;
  games: GamePassGame[];
  loading: boolean;
  error: string | null;
  empty: boolean;
  density: string;
  onOpenUrl: (url: string | null | undefined) => void;
  onReload: () => void;
}

export default function GamePassPanel({
  filters,
  setFilters,
  games,
  loading,
  error,
  empty,
  density,
  onOpenUrl,
  onReload,
}: GamePassPanelProps) {
  const { t } = useLanguage();

  const toggleCategory = (category: string) => {
    setFilters((prev) => ({
      ...prev,
      categories: prev.categories.includes(category)
        ? prev.categories.filter((c) => c !== category)
        : [...prev.categories, category],
    }));
  };

  return (
    <section className="deals-section" aria-label={t("deals.gamepass")}>
      <div className="deals-filters">
        <div className="deals-filter-group">
          <label htmlFor="gp-region">{t("deals.region")}</label>
          <select
            id="gp-region"
            className="deals-filter-select"
            value={filters.region}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, region: e.target.value }))
            }
          >
            {GP_REGIONS.map((r) => (
              <option key={r.code} value={r.code}>
                {t(r.label)} ({r.code})
              </option>
            ))}
          </select>
        </div>

        <div className="deals-filter-group">
          <label htmlFor="gp-platform">{t("deals.platform")}</label>
          <select
            id="gp-platform"
            className="deals-filter-select"
            value={filters.platform}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                platform: e.target.value,
              }))
            }
          >
            {GP_PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>
                {t(p.label)}
              </option>
            ))}
          </select>
        </div>

        <div className="deals-filter-group deals-filter-group--chips">
          <label>{t("deals.categories")}</label>
          <div className="deals-category-chips">
            {GP_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`deals-category-chip ${
                  filters.categories.includes(cat) ? "active" : ""
                }`}
                onClick={() => toggleCategory(cat)}
                aria-pressed={filters.categories.includes(cat)}
              >
                {t(GP_CATEGORY_KEYS[cat] ?? cat)}
              </button>
            ))}
          </div>
        </div>

        <Button
          variant="secondary"
          size="sm"
          isLoading={loading}
          onClick={onReload}
          title={t("deals.refreshGamepass")}
          leftIcon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          }
        >
          {t("common.refresh")}
        </Button>
      </div>

      {loading && (
        <DealsSkeletonGrid density={density} variant="gamepass" count={8} />
      )}

      {!loading && error && (
        <DealsErrorState message={error} onRetry={onReload} />
      )}

      {!loading && !error && empty && (
        <DealsEmptyState
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          }
          message={t("deals.emptyGamepass")}
          onRetry={onReload}
        />
      )}

      {!loading && !error && games.length > 0 && (
        <div className={`deals-grid density-${density}`}>
          {games.map((game, i) => (
            <GamePassCard
              key={game.id}
              game={game}
              onOpenUrl={onOpenUrl}
              index={i}
            />
          ))}
        </div>
      )}
    </section>
  );
}
