import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useWishlistContext } from "../../context/WishlistContext";
import { useLanguage } from "../../context/LanguageContext";
import { useFocusable } from "../../hooks/useFocusable";
import { useGamepad } from "../../hooks/GamepadProvider";
import { formatPrice } from "../bigscreen/bigscreenFormat";
import BigScreenStoreRail from "./BigScreenStoreRail";
import BigScreenPill from "../bigscreen/BigScreenPill";
import BigScreenTabBar, { type TabDef } from "../bigscreen/BigScreenTabBar";
import type { StoreGameSummary } from "../../types/game";
import type { DealItem } from "../../types/deals";

type StoreTab = "trending" | "deals" | "wishlist";

const STORE_TABS: TabDef<StoreTab>[] = [
  { id: "trending", label: "store.tab.discover" },
  { id: "deals", label: "nav.deals" },
  { id: "wishlist", label: "nav.wishlist" },
];

export default function BigScreenStore() {
  const { t } = useLanguage();
  const gamepad = useGamepad();
  const navigate = useNavigate();
  const location = useLocation();
  const { wishlist } = useWishlistContext();

  const initialTab = useMemo<StoreTab>(() => {
    const path = location.pathname;
    if (path.startsWith("/wishlist")) return "wishlist";
    if (path.startsWith("/deals")) return "deals";
    return "trending";
  }, [location.pathname]);

  const [activeTab, setActiveTab] = useState<StoreTab>(initialTab);
  const activeTabLabel = t(
    STORE_TABS.find((tab) => tab.id === activeTab)?.label ?? "store.tab.discover",
  );

  // Sync activeTab when URL pathname changes. BigScreenStore only
  // mounts at /store and /wishlist (the /deals route renders the
  // separate BigScreenDeals page), so only those two tabs need syncing.
  useEffect(() => {
    const path = location.pathname;
    if (path.startsWith("/wishlist")) {
      setActiveTab("wishlist");
    } else {
      setActiveTab("trending");
    }
  }, [location.pathname]);

  const handleSelectTab = useCallback(
    (tabId: StoreTab) => {
      setActiveTab(tabId);
      if (tabId === "deals") {
        // Deals is rendered as an inline panel right here in the
        // store, so deliberately DO NOT navigate. Hopping to /deals
        // used to unmount BigScreenStore and mount BigScreenDeals
        // (a different tab set with no bumper cycler) — after which
        // the next LB/RB press suddenly cycled the header's top-level
        // sections instead of tabs. Keeping the tab local makes
        // bumpers behave consistently across Discover / Deals /
        // Wishlist.
        return;
      }
      navigate(tabId === "wishlist" ? "/wishlist" : "/store");
    },
    [navigate]
  );

  // Trending state
  const [trending, setTrending] = useState<StoreGameSummary[]>([]);
  const [popular, setPopular] = useState<StoreGameSummary[]>([]);
  const [top, setTop] = useState<StoreGameSummary[]>([]);
  const [comingSoon, setComingSoon] = useState<StoreGameSummary[]>([]);
  const [loadingTrending, setLoadingTrending] = useState(true);

  // Deals state
  const [deals, setDeals] = useState<DealItem[]>([]);
  const [loadingDeals, setLoadingDeals] = useState(false);

  const [selectedGame, setSelectedGame] = useState<StoreGameSummary | null>(null);
  const [activeRailId, setActiveRailId] = useState<string>("trending");

  // Fetch Trending categories
  useEffect(() => {
    let active = true;
    const fetchTrending = async () => {
      setLoadingTrending(true);
      try {
        const fetchCat = (cat: string) =>
          invoke<StoreGameSummary[]>("fetch_store_games", {
            category: cat,
            offset: 0,
            limit: 12,
          });

        const [tr, pop, tp, cs] = await Promise.all([
          fetchCat("trending"),
          fetchCat("popular"),
          fetchCat("top"),
          fetchCat("coming_soon"),
        ]);

        if (active) {
          setTrending(tr);
          setPopular(pop);
          setTop(tp);
          setComingSoon(cs);
          if (tr[0] && !selectedGame) setSelectedGame(tr[0]);
        }
      } catch (err) {
        console.error("Failed to load trending storefront:", err);
      } finally {
        if (active) setLoadingTrending(false);
      }
    };
    fetchTrending();
    return () => {
      active = false;
    };
  }, []);

  // Fetch Deals
  useEffect(() => {
    if (activeTab !== "deals") return;
    let active = true;
    const fetchDealsList = async () => {
      setLoadingDeals(true);
      try {
        const data = await invoke<DealItem[]>("fetch_isthereanydeal_deals", {
          filters: {
            platform: null,
            minDiscount: null,
            store: null,
          },
        });
        if (active) {
          setDeals(data);
        }
      } catch (err) {
        console.error("Failed to load deals:", err);
      } finally {
        if (active) setLoadingDeals(false);
      }
    };
    fetchDealsList();
    return () => {
      active = false;
    };
  }, [activeTab]);

  // Sync selected game on load or when trending list changes
  useEffect(() => {
    if (!selectedGame && trending[0]) {
      setSelectedGame(trending[0]);
    }
  }, [trending, selectedGame]);

  // Spatial navigation watcher for backdrop sync in trending tab
  const trendingGamesMap = useMemo(() => {
    const map = new Map<string, StoreGameSummary>();
    for (const list of [trending, popular, top, comingSoon]) {
      for (const g of list) map.set(String(g.id), g);
    }
    return map;
  }, [trending, popular, top, comingSoon]);

  // Keep selectedGame reference fresh from trending list
  const featuredGame = useMemo(() => {
    if (!selectedGame) return null;
    return trendingGamesMap.get(String(selectedGame.id)) ?? selectedGame;
  }, [trendingGamesMap, selectedGame]);

  useEffect(() => {
    if (activeTab !== "trending") return;
    const el = gamepad.focusedElement;
    if (!el) return;
    const id = el.getAttribute("data-game-id");
    if (id) {
      const game = trendingGamesMap.get(id);
      if (game && game.id !== selectedGame?.id) {
        setSelectedGame(game);
      }
      
      const railEl = el.closest("[data-rail-id]");
      if (railEl) {
        const rId = railEl.getAttribute("data-rail-id");
        if (rId) {
          setActiveRailId(rId);
        }
      }
    }
  }, [gamepad.focusedElement, trendingGamesMap, selectedGame, activeTab]);

  // LB/RB tab switcher
  useEffect(() => {
    return gamepad.registerTabCycler((direction) => {
      const currentIndex = STORE_TABS.findIndex((t) => t.id === activeTab);
      const baseIndex = currentIndex < 0 ? 0 : currentIndex;
      const nextIndex =
        direction === "forward"
          ? (baseIndex + 1) % STORE_TABS.length
          : (baseIndex - 1 + STORE_TABS.length) % STORE_TABS.length;
      handleSelectTab(STORE_TABS[nextIndex].id);
    }, 1);
    // Dep on the stable `registerTabCycler` only — depending on the
    // whole `gamepad` object here would re-register the cycler on
    // every focus change.
  }, [gamepad.registerTabCycler, activeTab, handleSelectTab]);

  const handleCardClick = useCallback(
    (game: StoreGameSummary) => {
      navigate(`/store/${game.slug}`);
    },
    [navigate]
  );

  const handleDetails = useCallback(() => {
    if (featuredGame) {
      handleCardClick(featuredGame);
    }
  }, [featuredGame, handleCardClick]);

  const detailsFocusable = useFocusable(handleDetails);

  const renderDetailsPane = (railId: string) => {
    if (activeRailId !== railId) return null;
    return (
      <section className="bigscreen-dashboard-details-pane bigscreen-store-featured-pane animate-fade-in" aria-label={t("bigscreen.store.gameInfo")}>
        <div className="bigscreen-details-pane-content">
          {featuredGame ? (
            <>
              <div className="bigscreen-details-logo-area">
                {featuredGame.logoUrl ? (
                  <img
                    src={featuredGame.logoUrl}
                    alt={featuredGame.name}
                    className="bigscreen-gamepage-hero-logo bigscreen-store-featured-logo"
                    width={360}
                    height={88}
                  />
                ) : (
                  <h1 className="bigscreen-gamepage-hero-title bigscreen-store-featured-title">{featuredGame.name}</h1>
                )}
              </div>

              <div className="bigscreen-details-meta">
                {featuredGame.rating && (
                  <BigScreenPill tone="accent" size="sm">
                    {t("bigscreen.store.score", { score: Math.round(featuredGame.rating) })}
                  </BigScreenPill>
                )}
                {featuredGame.genres && featuredGame.genres.slice(0, 2).map((g: string) => (
                  <BigScreenPill key={g} tone="muted" size="sm">
                    {g}
                  </BigScreenPill>
                ))}
              </div>

              {/* Always rendered so the reserved description slot keeps
                  the actions row stable while navigating between games. */}
              <p className="bigscreen-details-description">
                {featuredGame.summary
                  ? featuredGame.summary.length > 200
                    ? `${featuredGame.summary.substring(0, 200)}...`
                    : featuredGame.summary
                  : ""}
              </p>

              <div className="bigscreen-details-actions">
                <button
                  type="button"
                  className="bigscreen-details-btn bigscreen-details-btn--primary"
                  {...detailsFocusable}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <span>{t("bigscreen.store.storeDetails")}</span>
                </button>
              </div>
            </>
          ) : (
            <div className="bigscreen-details-placeholder">
              <h2 className="bigscreen-details-title">{t("bigscreen.store.welcomeTitle")}</h2>
              <p className="bigscreen-details-description">
                {t("bigscreen.store.welcomeDesc")}
              </p>
            </div>
          )}
        </div>
      </section>
    );
  };

  return (
    <div className="bigscreen-store-dashboard">
      {/* Dynamic full-bleed backdrop (only on trending page for premium vibes) */}
      {activeTab === "trending" && (
        <div className="bigscreen-dashboard-backdrop-container">
          {featuredGame && featuredGame.coverUrl && (
            <img
              key={featuredGame.id}
              src={featuredGame.coverUrl}
              alt=""
              className="bigscreen-dashboard-backdrop-img animate-fade-in"
              style={{ opacity: 1 }}
            />
          )}
          <div className="bigscreen-dashboard-backdrop-overlay" />
        </div>
      )}

      {/* Main scrolling wrapper */}
      <div className="bigscreen-dashboard-scrollable-content">
        {/* Navigation tabs */}
        <div className="bigscreen-store-context" aria-live="polite">
          <div>
            <span className="bigscreen-store-context-eyebrow">{t("nav.store")}</span>
            <strong>{activeTabLabel}</strong>
          </div>
          <span className="bigscreen-store-context-hint">A {t("gamepad.click")} · D-pad {t("gamepad.move")} · LB/RB {t("bigscreen.tabbar.tabs")}</span>
        </div>
        <div className="bigscreen-store-tabs-wrapper">
          <BigScreenTabBar
            tabs={STORE_TABS.map((tb) => ({ ...tb, label: t(tb.label) }))}
            activeTab={activeTab}
            onActivate={handleSelectTab}
          />
        </div>

        {/* Categories Panel */}
        <div className="bigscreen-store-panel-content">
          {activeTab === "trending" && (
            <div className="store-trending-panel">
              {loadingTrending ? (
                <div className="store-tab-loading">
                  <div className="store-spinner" />
                  <span>{t("bigscreen.store.loading")}</span>
                </div>
              ) : (
                <>
                  {/* Rails */}
                  <div className="store-rails-group">
                    <>
                      {renderDetailsPane("trending")}
                      <BigScreenStoreRail
                        railId="trending"
                        title={t("store.tab.trending")}
                        games={trending}
                        onCardClick={handleCardClick}
                        isActive={activeRailId === "trending"}
                      />
                    </>
                    <>
                      {renderDetailsPane("popular")}
                      <BigScreenStoreRail
                        railId="popular"
                        title={t("bigscreen.store.popularNow")}
                        games={popular}
                        onCardClick={handleCardClick}
                        isActive={activeRailId === "popular"}
                      />
                    </>
                    <>
                      {renderDetailsPane("top")}
                      <BigScreenStoreRail
                        railId="top"
                        title={t("bigscreen.store.topCritic")}
                        games={top}
                        onCardClick={handleCardClick}
                        isActive={activeRailId === "top"}
                      />
                    </>
                    <>
                      {renderDetailsPane("coming-soon")}
                      <BigScreenStoreRail
                        railId="coming-soon"
                        title={t("store.tab.comingSoon")}
                        games={comingSoon}
                        onCardClick={handleCardClick}
                        isActive={activeRailId === "coming-soon"}
                      />
                    </>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === "deals" && (
            <div className="store-deals-panel">
              {loadingDeals ? (
                <div className="store-tab-loading">
                  <div className="store-spinner" />
                  <span>{t("bigscreen.store.scanningDeals")}</span>
                </div>
              ) : (
                <div className="store-deals-grid">
                  {deals.map((deal: DealItem) => (
                    <BigScreenDealCard key={deal.id} deal={deal} />
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "wishlist" && (
            <div className="store-wishlist-panel">
              {wishlist.length === 0 ? (
                <div className="wishlist-empty-state">
                  <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" width="64" height="64" opacity="0.3">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                  <h3>{t("bigscreen.store.wishlistEmpty")}</h3>
                  <p>{t("bigscreen.store.wishlistHint")}</p>
                </div>
              ) : (
                <div className="store-wishlist-grid">
                  {wishlist.map((item) => (
                    <BigScreenWishlistCard key={item.slug} item={item} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BigScreenDealCard({ deal }: { deal: DealItem }) {
  const { t, language } = useLanguage();
  const focusProps = useFocusable(async () => {
    if (deal.storeUrl) {
      try {
        await openUrl(deal.storeUrl);
      } catch (err) {
        console.error("Failed to open deal URL:", err);
      }
    }
  });

  return (
    <div
      className="bigscreen-game-card store-deal-card"
      {...focusProps}
      aria-label={t("bigscreen.store.dealCardAria", {
        game: deal.gameTitle,
        pct: deal.discountPercent,
      })}
    >
      <div className="bigscreen-game-card-cover">
        {deal.thumbnail ? (
          <img src={deal.thumbnail} alt={deal.gameTitle} loading="lazy" />
        ) : (
          <div className="bigscreen-game-card-cover-placeholder">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              width="40"
              height="40"
              aria-hidden="true"
            >
              <path d="M4 8h16l-1 12H5L4 8Z" />
              <path d="m7 8 2-5h6l2 5" />
              <path d="M9 12h6" />
            </svg>
          </div>
        )}
        <div className="deal-discount-badge">-{deal.discountPercent}%</div>
      </div>
      <div className="bigscreen-store-card-details">
        <h4 className="deal-game-title">{deal.gameTitle}</h4>
        <div className="deal-price-row">
          <span className="deal-price-new">{formatPrice(deal.dealPrice, language)}</span>
        </div>
        <div className="deal-store-tag">{deal.storeName}</div>
      </div>
    </div>
  );
}

function BigScreenWishlistCard({ item }: { item: StoreGameSummary }) {
  const navigate = useNavigate();
  const focusProps = useFocusable(() => navigate(`/store/${item.slug}`));

  return (
    <div
      className="bigscreen-game-card store-wishlist-card"
      {...focusProps}
      aria-label={item.name}
    >
      <div className="bigscreen-game-card-cover">
        {item.coverUrl ? (
          <img src={item.coverUrl} alt={item.name} loading="lazy" />
        ) : (
          <div className="bigscreen-game-card-cover-placeholder">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              width="40"
              height="40"
              aria-hidden="true"
            >
              <path d="M20.8 8.8c0 5.4-8.8 10.2-8.8 10.2S3.2 14.2 3.2 8.8A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 8.8 2.8Z" />
            </svg>
          </div>
        )}
      </div>
      <div className="bigscreen-store-card-details">
        <h4 className="deal-game-title">{item.name}</h4>
      </div>
    </div>
  );
}
