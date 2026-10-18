import { useState, useEffect, useCallback, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useLanguage } from "../../context/LanguageContext";
import { useFocusable } from "../../hooks/useFocusable";
import BigScreenCover from "./BigScreenCover";
import BigScreenRailSection from "./BigScreenRailSection";
import {
  BigScreenEmptyState,
  BigScreenErrorState,
  BigScreenLoadingState,
} from "./BigScreenState";
import { formatPrice } from "./bigscreenFormat";
import type { DealItem, GamePassGame, Giveaway } from "../../types/deals";

/** Per-section fetch state — an empty and an errored Game Pass feed
 *  should not blank out the Deals and Giveaways rails next to it. */
interface SectionState<T> {
  items: T[];
  error: string | null;
}

export default function BigScreenDeals() {
  const { t, language } = useLanguage();
  const [gamepass, setGamepass] = useState<SectionState<GamePassGame>>({ items: [], error: null });
  const [deals, setDeals] = useState<SectionState<DealItem>>({ items: [], error: null });
  const [giveaways, setGiveaways] = useState<SectionState<Giveaway>>({ items: [], error: null });
  const [loading, setLoading] = useState(true);

  const [selectedGamepass, setSelectedGamepass] = useState<GamePassGame | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<DealItem | null>(null);
  const [selectedGiveaway, setSelectedGiveaway] = useState<Giveaway | null>(null);

  // Top-level section: controller Back is owned by the shell resolver,
  // which offers the exit confirmation at this level.

  const loadAll = useCallback(() => {
    setLoading(true);
    const gamepassLoader = async () => {
      try {
        const res = await invoke<GamePassGame[]>("fetch_gamepass_catalog", {
          filters: { region: "US", categories: null, platform: null },
        });
        const items = res ?? [];
        setGamepass({ items, error: null });
        setSelectedGamepass((prev) => prev ?? items[0] ?? null);
      } catch (e) {
        console.error("Failed to fetch GamePass catalog:", e);
        setGamepass({ items: [], error: t("bigscreen.deals.loadGamepassError") });
      }
    };
    const dealsLoader = async () => {
      try {
        const res = await invoke<DealItem[]>("fetch_isthereanydeal_deals", {
          filters: { platform: null, minDiscount: 25, store: null },
        });
        const items = res ?? [];
        setDeals({ items, error: null });
        setSelectedDeal((prev) => prev ?? items[0] ?? null);
      } catch (e) {
        console.error("Failed to fetch ITAD deals:", e);
        setDeals({ items: [], error: t("bigscreen.deals.loadDealsError") });
      }
    };
    const giveawaysLoader = async () => {
      try {
        const res = await invoke<Giveaway[]>("fetch_giveaways");
        const items = res ?? [];
        setGiveaways({ items, error: null });
        setSelectedGiveaway((prev) => prev ?? items[0] ?? null);
      } catch (e) {
        console.error("Failed to fetch giveaways:", e);
        setGiveaways({ items: [], error: t("bigscreen.deals.loadGiveawaysError") });
      }
    };
    return Promise.allSettled([gamepassLoader(), dealsLoader(), giveawaysLoader()]);
  }, [t]);

  // All three sections live on the page now (no tabs), so fire every
  // fetch on mount in parallel. The single loading flag only clears
  // once all of them have settled.
  useEffect(() => {
    let active = true;
    loadAll().then(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [loadAll]);

  const retry = useCallback(async () => {
    setLoading(true);
    // A single-section retry reuses the batch loader; the other two
    // lists refresh alongside it, which keeps state transitions and
    // the loading flag simple.
    await loadAll();
    setLoading(false);
  }, [loadAll]);

  return (
    <div className="bigscreen-store-dashboard">
      {/* Background Hero Banner */}
      <div className="bigscreen-hero-backdrop">
        {selectedGamepass?.coverImage ? (
          <img src={selectedGamepass.coverImage} alt="" className="bigscreen-hero-bg-img" />
        ) : selectedGiveaway?.imageUrl ? (
          <img src={selectedGiveaway.imageUrl} alt="" className="bigscreen-hero-bg-img" />
        ) : null}
        <div className="bigscreen-hero-overlay" />
      </div>

      <div className="bigscreen-dashboard-scrollable-content bigscreen-deals-content">
        {/* Spotlight Hero Section — Game Pass is the page's default/first
            section, so it owns the hero; deals and giveaways only step in
            if no Game Pass selection has loaded yet. */}
        {selectedGamepass ? (
          <div className="bigscreen-spotlight-hero">
            <div className="bigscreen-spotlight-info">
              <span className="bigscreen-badge bigscreen-badge--success">
                {t("bigscreen.deals.xboxGamePass")}
              </span>
              <h1 className="bigscreen-spotlight-title">
                {selectedGamepass.title}
              </h1>
              {selectedGamepass.categories && selectedGamepass.categories.length > 0 && (
                <p className="bigscreen-spotlight-meta">
                  {selectedGamepass.categories.join(" • ")}
                </p>
              )}
            </div>
          </div>
        ) : selectedDeal ? (
          <div className="bigscreen-spotlight-hero">
            <div className="bigscreen-spotlight-info">
              <span className="bigscreen-badge bigscreen-badge--danger">
                {t("bigscreen.deals.discountBadge", { pct: selectedDeal.discountPercent })}
              </span>
              <h1 className="bigscreen-spotlight-title">
                {selectedDeal.gameTitle}
              </h1>
              <div className="bigscreen-spotlight-price-row">
                <span className="bigscreen-spotlight-price">{formatPrice(selectedDeal.dealPrice, language)}</span>
                <span className="bigscreen-spotlight-store">
                  {t("bigscreen.deals.onStore", { store: selectedDeal.storeName })}
                </span>
              </div>
            </div>
          </div>
        ) : selectedGiveaway ? (
          <div className="bigscreen-spotlight-hero">
            <div className="bigscreen-spotlight-info">
              <span className="bigscreen-badge bigscreen-badge--info">
                {t("bigscreen.deals.freeGiveawayBadge")}
              </span>
              <h1 className="bigscreen-spotlight-title">
                {selectedGiveaway.title}
              </h1>
              <p className="bigscreen-spotlight-meta">
                {t("bigscreen.deals.freeOnStore", { store: selectedGiveaway.storeName })}
              </p>
            </div>
          </div>
        ) : null}

        {/* Game Pass section */}
        <DealsRail
          railId="deals-gamepass"
          title={t("bigscreen.deals.gamepassTitles")}
          loading={loading}
          error={gamepass.error}
          empty={gamepass.items.length === 0}
          emptyMessage={t("bigscreen.deals.noGamepass")}
          loadingMessage={t("bigscreen.deals.loadingGamepass")}
          onRetry={retry}
          items={gamepass.items}
          renderItem={(game) => (
            <GamePassCard game={game} onSelect={() => setSelectedGamepass(game)} />
          )}
          itemKey={(game) => game.id}
        />

        {/* Deals section */}
        <DealsRail
          railId="deals-discounts"
          title={t("bigscreen.deals.topDiscounts")}
          loading={loading}
          error={deals.error}
          empty={deals.items.length === 0}
          emptyMessage={t("bigscreen.deals.noDeals")}
          loadingMessage={t("bigscreen.deals.loadingDeals")}
          onRetry={retry}
          items={deals.items}
          renderItem={(deal) => (
            <DealCard item={deal} onSelect={() => setSelectedDeal(deal)} />
          )}
          itemKey={(deal) => deal.id}
        />

        {/* Giveaways section */}
        <DealsRail
          railId="deals-giveaways"
          title={t("bigscreen.deals.freeGamesTitle")}
          loading={loading}
          error={giveaways.error}
          empty={giveaways.items.length === 0}
          emptyMessage={t("bigscreen.deals.noGiveaways")}
          loadingMessage={t("bigscreen.deals.loadingGiveaways")}
          onRetry={retry}
          items={giveaways.items}
          renderItem={(giveaway) => (
            <GiveawayCard item={giveaway} onSelect={() => setSelectedGiveaway(giveaway)} />
          )}
          itemKey={(giveaway) => giveaway.id}
        />
      </div>
    </div>
  );
}

interface DealsRailProps<T> {
  railId: string;
  title: string;
  loading: boolean;
  error: string | null;
  empty: boolean;
  loadingMessage: string;
  emptyMessage: string;
  onRetry: () => void;
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  itemKey: (item: T, index: number) => string;
}

/** One rail, one tri-state surface. Errors keep the rest of the page
 *  interactive and land the controller on a Retry button. */
function DealsRail<T>({
  railId,
  title,
  loading,
  error,
  empty,
  loadingMessage,
  emptyMessage,
  onRetry,
  items,
  renderItem,
  itemKey,
}: DealsRailProps<T>) {
  if (loading) {
    return <BigScreenLoadingState message={loadingMessage} />;
  }
  if (error) {
    return <BigScreenErrorState message={error} onRetry={onRetry} />;
  }
  if (empty) {
    return <BigScreenEmptyState message={emptyMessage} />;
  }
  return (
    <BigScreenRailSection
      railId={railId}
      title={title}
      items={items}
      renderItem={renderItem}
      itemKey={itemKey}
    />
  );
}

function GamePassCard({ game, onSelect }: { game: GamePassGame; onSelect: () => void }) {
  const focusProps = useFocusable(onSelect);
  return (
    <div className="bigscreen-game-card" {...focusProps} role="button">
      <BigScreenCover url={game.coverImage || undefined} alt={game.title} aspectRatio="2 / 3" />
      <div className="bigscreen-card-meta">
        <h4 className="bigscreen-card-title">{game.title}</h4>
        {game.categories && game.categories.length > 0 && (
          <span className="bigscreen-card-subtitle">{game.categories[0]}</span>
        )}
      </div>
    </div>
  );
}

function DealCard({ item, onSelect }: { item: DealItem; onSelect: () => void }) {
  const { language } = useLanguage();
  const focusProps = useFocusable(async () => {
    onSelect();
    if (item.storeUrl) {
      try {
        await openUrl(item.storeUrl);
      } catch (e) {
        console.error("Failed to open deal URL:", e);
      }
    }
  });

  return (
    <div className="bigscreen-game-card" {...focusProps} role="link">
      <BigScreenCover url={item.thumbnail || undefined} alt={item.gameTitle} aspectRatio="2 / 3" />
      <div className="bigscreen-card-meta">
        <h4 className="bigscreen-card-title">{item.gameTitle}</h4>
        <div className="bigscreen-card-deal-row">
          <span className="bigscreen-card-price">{formatPrice(item.dealPrice, language)}</span>
          <span className="bigscreen-card-discount">-{item.discountPercent}%</span>
        </div>
      </div>
    </div>
  );
}

function GiveawayCard({ item, onSelect }: { item: Giveaway; onSelect: () => void }) {
  const { t } = useLanguage();
  const focusProps = useFocusable(async () => {
    onSelect();
    if (item.dealUrl) {
      try {
        await openUrl(item.dealUrl);
      } catch (e) {
        console.error("Failed to open giveaway URL:", e);
      }
    }
  });

  return (
    <div className="bigscreen-game-card" {...focusProps} role="link">
      <BigScreenCover url={item.imageUrl || undefined} alt={item.title} aspectRatio="2 / 3" />
      <div className="bigscreen-card-meta">
        <h4 className="bigscreen-card-title">{item.title}</h4>
        <span className="bigscreen-card-free">
          {t("bigscreen.deals.freeStoreBadge", { store: item.storeName })}
        </span>
      </div>
    </div>
  );
}

