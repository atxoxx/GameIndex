import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useLanguage } from "../../context/LanguageContext";
import { useFocusable } from "../../hooks/useFocusable";
import BigScreenTabBar, { type TabDef } from "./BigScreenTabBar";
import BigScreenTabPanel from "./BigScreenTabPanel";
import BigScreenCover from "./BigScreenCover";
import type { DealItem, GamePassGame, Giveaway } from "../../types/deals";

type DealsTab = "gamepass" | "deals" | "giveaways";

function formatPrice(price: number): string {
  if (!Number.isFinite(price)) return "—";
  return `€${price.toFixed(2)}`;
}

export default function BigScreenDeals() {
  const { t } = useLanguage();
  const DEALS_TABS: TabDef<DealsTab>[] = [
    { id: "gamepass", label: "Xbox Game Pass" },
    { id: "deals", label: t("deals.subTabIsThereAnyDeal") },
    { id: "giveaways", label: t("deals.subTabGiveaways") },
  ];

  const [activeTab, setActiveTab] = useState<DealsTab>("gamepass");
  const [gamepassGames, setGamepassGames] = useState<GamePassGame[]>([]);
  const [deals, setDeals] = useState<DealItem[]>([]);
  const [giveaways, setGiveaways] = useState<Giveaway[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedGamepass, setSelectedGamepass] = useState<GamePassGame | null>(null);
  const [selectedDeal, setSelectedDeal] = useState<DealItem | null>(null);
  const [selectedGiveaway, setSelectedGiveaway] = useState<Giveaway | null>(null);

  // Fetch Game Pass Catalog
  const fetchGamePass = useCallback(async () => {
    try {
      setLoading(true);
      const res = await invoke<GamePassGame[]>("fetch_gamepass_catalog", {
        filters: { region: "US", categories: null, platform: null },
      });
      setGamepassGames(res || []);
      if (res && res.length > 0) {
        setSelectedGamepass(res[0]);
      }
    } catch (e) {
      console.error("Failed to fetch GamePass catalog:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch Deals
  const fetchDeals = useCallback(async () => {
    try {
      setLoading(true);
      const res = await invoke<DealItem[]>("fetch_isthereanydeal_deals", {
        filters: { platform: null, minDiscount: 25, store: null },
      });
      setDeals(res || []);
      if (res && res.length > 0) {
        setSelectedDeal(res[0]);
      }
    } catch (e) {
      console.error("Failed to fetch ITAD deals:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch Giveaways
  const fetchGiveaways = useCallback(async () => {
    try {
      setLoading(true);
      const res = await invoke<Giveaway[]>("fetch_giveaways");
      setGiveaways(res || []);
      if (res && res.length > 0) {
        setSelectedGiveaway(res[0]);
      }
    } catch (e) {
      console.error("Failed to fetch giveaways:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "gamepass") fetchGamePass();
    else if (activeTab === "deals") fetchDeals();
    else if (activeTab === "giveaways") fetchGiveaways();
  }, [activeTab, fetchGamePass, fetchDeals, fetchGiveaways]);

  return (
    <div className="bigscreen-store-dashboard">
      {/* Background Hero Banner */}
      <div className="bigscreen-hero-backdrop">
        {activeTab === "gamepass" && selectedGamepass?.coverImage ? (
          <img src={selectedGamepass.coverImage} alt="" className="bigscreen-hero-bg-img" />
        ) : activeTab === "giveaways" && selectedGiveaway?.imageUrl ? (
          <img src={selectedGiveaway.imageUrl} alt="" className="bigscreen-hero-bg-img" />
        ) : null}
        <div className="bigscreen-hero-overlay" />
      </div>

      <div className="bigscreen-dashboard-scrollable-content" style={{ padding: "30px 40px" }}>
        {/* Spotlight Hero Section */}
        {activeTab === "gamepass" && selectedGamepass ? (
          <div className="bigscreen-spotlight-hero" style={{ marginBottom: 30 }}>
            <div className="bigscreen-spotlight-info">
              <span className="bigscreen-badge" style={{ background: "rgba(16, 185, 129, 0.2)", color: "#10b981", padding: "4px 12px", borderRadius: 12, fontWeight: 800 }}>
                XBOX GAME PASS
              </span>
              <h1 className="bigscreen-spotlight-title" style={{ fontSize: 36, marginTop: 12 }}>
                {selectedGamepass.title}
              </h1>
              {selectedGamepass.categories && selectedGamepass.categories.length > 0 && (
                <p style={{ color: "rgba(255, 255, 255, 0.7)", fontSize: 15, margin: "8px 0" }}>
                  {selectedGamepass.categories.join(" • ")}
                </p>
              )}
            </div>
          </div>
        ) : activeTab === "deals" && selectedDeal ? (
          <div className="bigscreen-spotlight-hero" style={{ marginBottom: 30 }}>
            <div className="bigscreen-spotlight-info">
              <span className="bigscreen-badge" style={{ background: "rgba(239, 68, 68, 0.2)", color: "#ef4444", padding: "4px 12px", borderRadius: 12, fontWeight: 800 }}>
                -{selectedDeal.discountPercent}% DISCOUNT
              </span>
              <h1 className="bigscreen-spotlight-title" style={{ fontSize: 36, marginTop: 12 }}>
                {selectedDeal.gameTitle}
              </h1>
              <div style={{ display: "flex", gap: 12, alignItems: "center", margin: "12px 0" }}>
                <span style={{ fontSize: 24, fontWeight: 800, color: "#10b981" }}>{formatPrice(selectedDeal.dealPrice)}</span>
                <span style={{ color: "rgba(255, 255, 255, 0.6)", fontSize: 14 }}>on {selectedDeal.storeName}</span>
              </div>
            </div>
          </div>
        ) : activeTab === "giveaways" && selectedGiveaway ? (
          <div className="bigscreen-spotlight-hero" style={{ marginBottom: 30 }}>
            <div className="bigscreen-spotlight-info">
              <span className="bigscreen-badge" style={{ background: "rgba(56, 189, 248, 0.2)", color: "#38bdf8", padding: "4px 12px", borderRadius: 12, fontWeight: 800 }}>
                100% FREE GIVEAWAY
              </span>
              <h1 className="bigscreen-spotlight-title" style={{ fontSize: 36, marginTop: 12 }}>
                {selectedGiveaway.title}
              </h1>
              <p style={{ color: "rgba(255, 255, 255, 0.7)", fontSize: 15, margin: "8px 0" }}>
                Free on {selectedGiveaway.storeName}
              </p>
            </div>
          </div>
        ) : null}

        {/* Tab Selector */}
        <BigScreenTabBar tabs={DEALS_TABS} activeTab={activeTab} onActivate={(id) => setActiveTab(id)} />

        {/* Content Panels */}
        <BigScreenTabPanel tabId="gamepass" activeTab={activeTab}>
          {loading ? (
            <div className="bigscreen-rail-empty">Loading Xbox Game Pass catalog...</div>
          ) : gamepassGames.length === 0 ? (
            <div className="bigscreen-rail-empty">No Game Pass titles found.</div>
          ) : (
            <div className="bigscreen-rail" style={{ marginTop: 24 }}>
              <div className="bigscreen-rail-header">
                <h3 className="bigscreen-rail-title">Game Pass Titles</h3>
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
        </BigScreenTabPanel>

        <BigScreenTabPanel tabId="deals" activeTab={activeTab}>
          {loading ? (
            <div className="bigscreen-rail-empty">Loading bargains...</div>
          ) : deals.length === 0 ? (
            <div className="bigscreen-rail-empty">No active deals found.</div>
          ) : (
            <div className="bigscreen-rail" style={{ marginTop: 24 }}>
              <div className="bigscreen-rail-header">
                <h3 className="bigscreen-rail-title">Top Discounts</h3>
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
        </BigScreenTabPanel>

        <BigScreenTabPanel tabId="giveaways" activeTab={activeTab}>
          {loading ? (
            <div className="bigscreen-rail-empty">Loading free giveaways...</div>
          ) : giveaways.length === 0 ? (
            <div className="bigscreen-rail-empty">No active giveaways available.</div>
          ) : (
            <div className="bigscreen-rail" style={{ marginTop: 24 }}>
              <div className="bigscreen-rail-header">
                <h3 className="bigscreen-rail-title">Free Games & Giveaways</h3>
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
        </BigScreenTabPanel>
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
          <span style={{ color: "#10b981", fontWeight: 800 }}>{formatPrice(item.dealPrice)}</span>
          <span style={{ background: "#ef4444", color: "#fff", fontSize: 11, fontWeight: 800, padding: "2px 6px", borderRadius: 4 }}>
            -{item.discountPercent}%
          </span>
        </div>
      </div>
    </div>
  );
}

function GiveawayCard({ item, onSelect }: { item: Giveaway; onSelect: () => void }) {
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
        <span style={{ color: "#38bdf8", fontWeight: 800, fontSize: 12 }}>FREE • {item.storeName}</span>
      </div>
    </div>
  );
}
