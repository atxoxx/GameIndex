import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../../context/LanguageContext";
import type { DealItem } from "../../types/deals";
import {
  DEFAULT_DEAL_FILTERS,
  buildDealsPayload,
  formatPrice,
  storeTint,
} from "../../pages/deals/dealsConstants";
import HomeSection from "./HomeSection";

const MAX_ITEMS = 8;
const DEALS_TTL_MS = 10 * 60 * 1000;

/** Module-level cache so repeated home visits don't re-hit the ITAD
 *  scrape within the TTL window (the Deals page itself refetches). */
let dealsCache: { data: DealItem[]; fetchedAt: number } | null = null;

interface HomeDealsRailProps {
  onInspect: (deal: DealItem) => void;
}

/**
 * HomeDealsRail — the best current discounts as a compact horizontal
 * strip. Fetches from the same ITAD command as the Deals page (cached
 * for 10 minutes), sorted by discount descending. Clicking a tile opens
 * the shared DealDetailModal via the `onInspect` callback.
 */
export default function HomeDealsRail({ onInspect }: HomeDealsRailProps) {
  const { t } = useLanguage();
  const [deals, setDeals] = useState<DealItem[]>(() => {
    if (dealsCache && Date.now() - dealsCache.fetchedAt < DEALS_TTL_MS) {
      return dealsCache.data;
    }
    return [];
  });
  const [loading, setLoading] = useState(deals.length === 0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (dealsCache && Date.now() - dealsCache.fetchedAt < DEALS_TTL_MS) {
      setDeals(dealsCache.data);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<DealItem[]>("fetch_isthereanydeal_deals", {
        filters: buildDealsPayload(DEFAULT_DEAL_FILTERS),
      });
      dealsCache = { data: result, fetchedAt: Date.now() };
      setDeals(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeals([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const topDeals = useMemo(
    () => [...deals].sort((a, b) => b.discountPercent - a.discountPercent).slice(0, MAX_ITEMS),
    [deals]
  );

  return (
    <HomeSection
      className="home-deals"
      icon={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 12a2 2 0 0 0 0-4h-1a2 2 0 0 1-2-2V5a2 2 0 0 0-4 0 2 2 0 0 1-4 0 2 2 0 0 0-4 0v1a2 2 0 0 1-2 2 2 2 0 0 0 0 4 2 2 0 0 1 2 2v1a2 2 0 0 0 4 0 2 2 0 0 1 4 0 2 2 0 0 0 4 0v-1a2 2 0 0 1 2-2Z" />
          <path d="m9 15 6-6" />
        </svg>
      }
      title={t("home.deals.title")}
      subtitle={topDeals.length > 0 ? t("home.deals.subtitle") : undefined}
      viewAllPath="/deals"
    >
      {loading ? (
        <div className="home-deals__loading">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="home-deals__skeleton" />
          ))}
        </div>
      ) : error ? (
        <div className="home-deals__empty">{t("home.deals.error")}</div>
      ) : topDeals.length === 0 ? (
        <div className="home-deals__empty">{t("home.deals.empty")}</div>
      ) : (
        <div className="home-rail-track home-rail-track--deals">
          {topDeals.map((deal, i) => (
            <HomeDealTile
              key={deal.id}
              deal={deal}
              index={i}
              onInspect={() => onInspect(deal)}
            />
          ))}
        </div>
      )}
    </HomeSection>
  );
}

function HomeDealTile({
  deal,
  index,
  onInspect,
}: {
  deal: DealItem;
  index: number;
  onInspect: () => void;
}) {
  const tint = storeTint(deal.storeName);
  return (
    <button
      type="button"
      className="home-deal-tile"
      onClick={onInspect}
      style={
        {
          "--deal-tint": tint,
        } as React.CSSProperties
      }
      title={`${deal.gameTitle} — ${deal.storeName}`}
      aria-label={`${deal.gameTitle} — ${deal.storeName}`}
    >
      <div className="home-deal-tile__cover">
        {deal.thumbnail ? (
          <img src={deal.thumbnail} alt="" loading="lazy" />
        ) : (
          <div className="home-deal-tile__placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </div>
        )}
        <span className="home-deal-tile__discount">-{deal.discountPercent}%</span>
      </div>
      <div className="home-deal-tile__body">
        <span className="home-deal-tile__name" title={deal.gameTitle}>
          {deal.gameTitle}
        </span>
        <span className="home-deal-tile__store">{deal.storeName}</span>
        <span className="home-deal-tile__price">{formatPrice(deal.dealPrice)}</span>
      </div>
      <span className="home-deal-tile__rank" aria-hidden>
        {String(index + 1).padStart(2, "0")}
      </span>
    </button>
  );
}
