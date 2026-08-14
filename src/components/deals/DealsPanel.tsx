import type { DealItem } from "../../types/deals";
import type { DealsFiltersState } from "../../pages/deals/dealsConstants";
import {
  DEAL_PLATFORMS,
  DEAL_STORES,
  DEAL_DISCOUNTS,
} from "../../pages/deals/dealsConstants";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";
import DealCard from "./DealCard";
import DealsSkeletonGrid from "./DealsSkeletonGrid";
import DealsEmptyState, { DealsErrorState } from "./DealsEmptyState";

interface DealsPanelProps {
  filters: DealsFiltersState;
  setFilters: React.Dispatch<React.SetStateAction<DealsFiltersState>>;
  deals: DealItem[];
  loading: boolean;
  error: string | null;
  empty: boolean;
  density: string;
  onOpenUrl: (url: string | null | undefined) => void;
  onReload: () => void;
}

export default function DealsPanel({
  filters,
  setFilters,
  deals,
  loading,
  error,
  empty,
  density,
  onOpenUrl,
  onReload,
}: DealsPanelProps) {
  const { t } = useLanguage();

  return (
    <section className="deals-section" aria-label="IsThereAnyDeal">
      <div className="deals-filters">
        <div className="deals-filter-group">
          <label htmlFor="deal-platform">{t("deals.platform")}</label>
          <select
            id="deal-platform"
            className="deals-filter-select"
            value={filters.platform}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                platform: e.target.value,
              }))
            }
          >
            {DEAL_PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>
                {t(p.label)}
              </option>
            ))}
          </select>
        </div>

        <div className="deals-filter-group">
          <label htmlFor="deal-store">{t("deals.store")}</label>
          <select
            id="deal-store"
            className="deals-filter-select"
            value={filters.store}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, store: e.target.value }))
            }
          >
            {DEAL_STORES.map((s) => (
              <option key={s.value} value={s.value}>
                {t(s.label)}
              </option>
            ))}
          </select>
        </div>

        <div className="deals-filter-group">
          <label htmlFor="deal-discount">{t("deals.minDiscount")}</label>
          <select
            id="deal-discount"
            className="deals-filter-select"
            value={filters.minDiscount}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                minDiscount: Number(e.target.value),
              }))
            }
          >
            {DEAL_DISCOUNTS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.value === 0
                  ? t("deals.anyDiscount")
                  : t("deals.discountOrMore", { pct: d.value })}
              </option>
            ))}
          </select>
        </div>

        <Button
          variant="secondary"
          size="sm"
          isLoading={loading}
          onClick={onReload}
          title={t("deals.refreshDeals")}
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
        <DealsSkeletonGrid density={density} variant="deal" count={12} />
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
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          }
          message={t("deals.emptyDeals")}
          onRetry={onReload}
        />
      )}

      {!loading && !error && deals.length > 0 && (
        <div className={`deals-grid density-${density}`}>
          {deals.map((deal, i) => (
            <DealCard
              key={deal.id}
              deal={deal}
              onOpenUrl={onOpenUrl}
              index={i}
            />
          ))}
        </div>
      )}
    </section>
  );
}
