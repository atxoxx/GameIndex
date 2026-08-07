import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";
import { useFocusable } from "../../hooks/useFocusable";
import { useGamepad } from "../../hooks/GamepadProvider";
import BigScreenCover from "./BigScreenCover";
import { formatPrice } from "./bigscreenFormat";
import type { DealItem, GamePassGame, Giveaway } from "../../types/deals";

export default function BigScreenDeals() {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const gamepad = useGamepad();
  const [gamepassGames, setGamepassGames] = useState<GamePassGame[]>([]);
  const [deals, setDeals] = useState<DealItem[]>([]);
  const [giveaways, setGiveaways] = useState<Giveaway[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedGamepass, setSelectedGamepass] = useState<GamePassGame | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<DealItem | null>(null);
  const [selectedGiveaway, setSelectedGiveaway] = useState<Giveaway | null>(null);

  // Controller B returns to the library grid (instead of the shell's
  // default of exiting Big Screen). Unregistered on unmount so the
  // shell reclaims B when the user leaves the Deals hub.
  useEffect(() => {
    return gamepad.registerBackHandler(() => navigate("/library"), 0);
  }, [gamepad.registerBackHandler, navigate]);

  // Fetch Game Pass Catalog
  const fetchGamePass = useCallback(async () => {
    try {
      const res = await invoke<GamePassGame[]>("fetch_gamepass_catalog", {
        filters: { region: "US", categories: null, platform: null },
      });
      setGamepassGames(res || []);
      if (res && res.length > 0) {
        setSelectedGamepass(res[0]);
      }
    } catch (e) {
      console.error("Failed to fetch GamePass catalog:", e);
    }
  }, []);

  // Fetch Deals
  const fetchDeals = useCallback(async () => {
    try {
      const res = await invoke<DealItem[]>("fetch_isthereanydeal_deals", {
        filters: { platform: null, minDiscount: 25, store: null },
      });
      setDeals(res || []);
      if (res && res.length > 0) {
        setSelectedDeal(res[0]);
      }
    } catch (e) {
      console.error("Failed to fetch ITAD deals:", e);
    }
  }, []);

  // Fetch Giveaways
  const fetchGiveaways = useCallback(async () => {
    try {
      const res = await invoke<Giveaway[]>("fetch_giveaways");
      setGiveaways(res || []);
      if (res && res.length > 0) {
        setSelectedGiveaway(res[0]);
      }
    } catch (e) {
      console.error("Failed to fetch giveaways:", e);
    }
  }, []);

  // All three sections live on the page now (no tabs), so fire every
  // fetch on mount in parallel. The single loading flag only clears
  // once all of them have settled.
  useEffect(() => {
    let active = true;
    Promise.allSettled([fetchGamePass(), fetchDeals(), fetchGiveaways()]).then(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [fetchGamePass, fetchDeals, fetchGiveaways]);

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
        {loading ? (
          <div className="bigscreen-rail-empty">{t("bigscreen.deals.loadingGamepass")}</div>
        ) : gamepassGames.length === 0 ? (
          <div className="bigscreen-rail-empty">{t("bigscreen.deals.noGamepass")}</div>
        ) : (
          <div className="bigscreen-rail">
            <div className="bigscreen-rail-header">
              <h3 className="bigscreen-rail-title">{t("bigscreen.deals.gamepassTitles")}</h3>
              <span className="bigscreen-rail-count">{gamepassGames.length}</span>
            </div>
            <div className="bigscreen-rail-viewport">
              <div className="bigscreen-rail-track" role="list">
                {gamepassGames.map((game) => (
                  <div key={game.id} className="bigscreen-rail-item" role="listitem">
                    <GamePassCard game={game} onSelect={() => setSelectedGamepass(game)} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Deals section */}
        {loading ? (
          <div className="bigscreen-rail-empty">{t("bigscreen.deals.loadingDeals")}</div>
        ) : deals.length === 0 ? (
          <div className="bigscreen-rail-empty">{t("bigscreen.deals.noDeals")}</div>
        ) : (
          <div className="bigscreen-rail">
            <div className="bigscreen-rail-header">
              <h3 className="bigscreen-rail-title">{t("bigscreen.deals.topDiscounts")}</h3>
              <span className="bigscreen-rail-count">{deals.length}</span>
            </div>
            <div className="bigscreen-rail-viewport">
              <div className="bigscreen-rail-track" role="list">
                {deals.map((deal) => (
                  <div key={deal.id} className="bigscreen-rail-item" role="listitem">
                    <DealCard item={deal} onSelect={() => setSelectedDeal(deal)} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Giveaways section */}
        {loading ? (
          <div className="bigscreen-rail-empty">{t("bigscreen.deals.loadingGiveaways")}</div>
        ) : giveaways.length === 0 ? (
          <div className="bigscreen-rail-empty">{t("bigscreen.deals.noGiveaways")}</div>
        ) : (
          <div className="bigscreen-rail">
            <div className="bigscreen-rail-header">
              <h3 className="bigscreen-rail-title">{t("bigscreen.deals.freeGamesTitle")}</h3>
              <span className="bigscreen-rail-count">{giveaways.length}</span>
            </div>
            <div className="bigscreen-rail-viewport">
              <div className="bigscreen-rail-track" role="list">
                {giveaways.map((giveaway) => (
                  <div key={giveaway.id} className="bigscreen-rail-item" role="listitem">
                    <GiveawayCard item={giveaway} onSelect={() => setSelectedGiveaway(giveaway)} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GamePassCard({ game, onSelect }: { game: GamePassGame; onSelect: () => void }) {
  const focusProps = useFocusable(onSelect);
  return (
    <div className="bigscreen-game-card" {...focusProps}>
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
    <div className="bigscreen-game-card" {...focusProps}>
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
    <div className="bigscreen-game-card" {...focusProps}>
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
