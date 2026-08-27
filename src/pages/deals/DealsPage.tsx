import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useToast } from "../../context/ToastContext";
import type {
  DealItem,
  GamePassGame,
  Giveaway,
  PlaytesterGame,
  PlaytesterFeed,
} from "../../types/deals";
import { PageHeader } from "../../components/ui";
import { useLanguage } from "../../context/LanguageContext";
import {
  type SubTab,
  type GamePassFiltersState,
  type DealsFiltersState,
  type PlaytesterFiltersState,
  DEFAULT_GP_FILTERS,
  DEFAULT_DEAL_FILTERS,
  DEFAULT_PLAYTESTER_FILTERS,
  PLAYTESTER_PAGE_SIZE,
  buildGamePassPayload,
  buildDealsPayload,
} from "./dealsConstants";
import DealsStatsHeader from "../../components/deals/DealsStatsHeader";
import DealsHeroSpotlight from "../../components/deals/DealsHeroSpotlight";
import GamePassPanel from "../../components/deals/GamePassPanel";
import DealsPanel from "../../components/deals/DealsPanel";
import GiveawaysPanel from "../../components/deals/GiveawaysPanel";
import PlaytesterPanel from "../../components/deals/PlaytesterPanel";
import DealDetailModal, {
  type ModalDealTarget,
} from "../../components/deals/DealDetailModal";
import PlaytesterDetailModal from "../../components/deals/PlaytesterDetailModal";
import "./DealsPage.css";
import "../../styles/page-deals.css";

export default function DealsPage() {
  const { t } = useLanguage();
  const { showToast } = useToast();

  const [activeSubTab, setActiveSubTab] = useState<SubTab>("gamepass");

  const [gpFilters, setGpFilters] = useState<GamePassFiltersState>(DEFAULT_GP_FILTERS);
  const [gpGames, setGpGames] = useState<GamePassGame[]>([]);
  const [gpLoading, setGpLoading] = useState(false);
  const [gpError, setGpError] = useState<string | null>(null);
  const [gpEmpty, setGpEmpty] = useState(false);

  const [dealFilters, setDealFilters] = useState<DealsFiltersState>(DEFAULT_DEAL_FILTERS);
  const [deals, setDeals] = useState<DealItem[]>([]);
  const [dealsLoading, setDealsLoading] = useState(false);
  const [dealsError, setDealsError] = useState<string | null>(null);
  const [dealsEmpty, setDealsEmpty] = useState(false);

  const [giveaways, setGiveaways] = useState<Giveaway[]>([]);
  const [giveawaysLoading, setGiveawaysLoading] = useState(false);
  const [giveawaysError, setGiveawaysError] = useState<string | null>(null);
  const [giveawaysEmpty, setGiveawaysEmpty] = useState(false);

  const [ptFilters, setPtFilters] = useState<PlaytesterFiltersState>(
    DEFAULT_PLAYTESTER_FILTERS,
  );
  const [ptGames, setPtGames] = useState<PlaytesterGame[]>([]);
  const [ptLoading, setPtLoading] = useState(false);
  const [ptLoadingMore, setPtLoadingMore] = useState(false);
  const [ptHasMore, setPtHasMore] = useState(false);
  const [ptNextOffset, setPtNextOffset] = useState(0);
  const [ptError, setPtError] = useState<string | null>(null);
  const [ptEmpty, setPtEmpty] = useState(false);

  const [selectedTarget, setSelectedTarget] = useState<ModalDealTarget | null>(null);
  const [selectedPlaytester, setSelectedPlaytester] =
    useState<PlaytesterGame | null>(null);

  const gpRequestId = useRef(0);
  const dealsRequestId = useRef(0);
  const giveawaysRequestId = useRef(0);
  const ptRequestId = useRef(0);

  const [gpReloadNonce, setGpReloadNonce] = useState(0);
  const [dealsReloadNonce, setDealsReloadNonce] = useState(0);
  const [giveawaysReloadNonce, setGiveawaysReloadNonce] = useState(0);
  const [ptReloadNonce, setPtReloadNonce] = useState(0);

  const loadGamePass = useCallback(async () => {
    const myRequest = ++gpRequestId.current;
    setGpLoading(true);
    setGpError(null);
    setGpEmpty(false);
    try {
      const result = await invoke<GamePassGame[]>("fetch_gamepass_catalog", {
        filters: buildGamePassPayload(gpFilters),
      });
      if (myRequest !== gpRequestId.current) return;
      setGpGames(result);
      setGpEmpty(result.length === 0);
    } catch (err) {
      if (myRequest !== gpRequestId.current) return;
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : t("deals.errorGamepass");
      setGpError(message);
      setGpGames([]);
    } finally {
      if (myRequest === gpRequestId.current) setGpLoading(false);
    }
  }, [gpFilters, t]);

  const loadDeals = useCallback(async () => {
    const myRequest = ++dealsRequestId.current;
    setDealsLoading(true);
    setDealsError(null);
    setDealsEmpty(false);
    try {
      const result = await invoke<DealItem[]>("fetch_isthereanydeal_deals", {
        filters: buildDealsPayload(dealFilters),
      });
      if (myRequest !== dealsRequestId.current) return;
      setDeals(result);
      setDealsEmpty(result.length === 0);
    } catch (err) {
      if (myRequest !== dealsRequestId.current) return;
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : t("deals.errorDeals");
      setDealsError(message);
      setDeals([]);
    } finally {
      if (myRequest === dealsRequestId.current) setDealsLoading(false);
    }
  }, [dealFilters, t]);

  const loadGiveaways = useCallback(async () => {
    const myRequest = ++giveawaysRequestId.current;
    setGiveawaysLoading(true);
    setGiveawaysError(null);
    setGiveawaysEmpty(false);
    try {
      const result = await invoke<Giveaway[]>("fetch_giveaways");
      if (myRequest !== giveawaysRequestId.current) return;
      setGiveaways(result);
      setGiveawaysEmpty(result.length === 0);
    } catch (err) {
      if (myRequest !== giveawaysRequestId.current) return;
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : t("deals.errorGiveaways");
      setGiveawaysError(message);
      setGiveaways([]);
    } finally {
      if (myRequest === giveawaysRequestId.current) setGiveawaysLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (activeSubTab === "gamepass") void loadGamePass();
  }, [activeSubTab, loadGamePass, gpReloadNonce]);

  useEffect(() => {
    if (activeSubTab === "isthereanydeal") void loadDeals();
  }, [activeSubTab, loadDeals, dealsReloadNonce]);

  const loadPlaytester = useCallback(async () => {
    const myRequest = ++ptRequestId.current;
    setPtLoading(true);
    setPtLoadingMore(false);
    setPtError(null);
    setPtEmpty(false);
    try {
      const result = await invoke<PlaytesterFeed>("fetch_playtester_games", {
        offset: 0,
        limit: PLAYTESTER_PAGE_SIZE,
      });
      if (myRequest !== ptRequestId.current) return;
      setPtGames(result.games);
      setPtHasMore(result.hasMore);
      setPtNextOffset(result.nextOffset);
      setPtEmpty(result.games.length === 0);
    } catch (err) {
      if (myRequest !== ptRequestId.current) return;
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : t("deals.errorPlaytester");
      setPtError(message);
      setPtGames([]);
      setPtHasMore(false);
    } finally {
      if (myRequest === ptRequestId.current) setPtLoading(false);
    }
  }, [t]);

  const loadMorePlaytester = useCallback(async () => {
    if (ptLoadingMore || !ptHasMore) return;
    const myRequest = ptRequestId.current;
    setPtLoadingMore(true);
    try {
      const result = await invoke<PlaytesterFeed>("fetch_playtester_games", {
        offset: ptNextOffset,
        limit: PLAYTESTER_PAGE_SIZE,
      });
      if (myRequest !== ptRequestId.current) return;
      setPtGames((prev) => {
        const seen = new Set(prev.map((g) => g.id));
        const fresh = result.games.filter((g) => !seen.has(g.id));
        return fresh.length > 0 ? [...prev, ...fresh] : prev;
      });
      setPtHasMore(result.hasMore);
      setPtNextOffset(result.nextOffset);
    } catch (err) {
      if (myRequest !== ptRequestId.current) return;
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : t("deals.errorPlaytester");
      showToast(message, "error");
    } finally {
      if (myRequest === ptRequestId.current) setPtLoadingMore(false);
    }
  }, [ptLoadingMore, ptHasMore, ptNextOffset, showToast, t]);

  useEffect(() => {
    if (activeSubTab === "gamepass") void loadGamePass();
  }, [activeSubTab, loadGamePass, gpReloadNonce]);

  useEffect(() => {
    if (activeSubTab === "isthereanydeal") void loadDeals();
  }, [activeSubTab, loadDeals, dealsReloadNonce]);

  useEffect(() => {
    if (activeSubTab === "giveaways") void loadGiveaways();
  }, [activeSubTab, loadGiveaways, giveawaysReloadNonce]);

  useEffect(() => {
    if (activeSubTab === "playtester") void loadPlaytester();
  }, [activeSubTab, loadPlaytester, ptReloadNonce]);

  const handleOpenUrl = useCallback(
    async (url: string | null | undefined) => {
      if (!url) return;
      try {
        await invoke<void>("open_deal_url", { url });
      } catch (err) {
        console.error("Failed to open URL:", err);
        const message =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : t("deals.errorOpenLink");
        showToast(message, "error");
      }
    },
    [showToast, t],
  );

  const handleInspectDeal = useCallback((deal: DealItem) => {
    setSelectedTarget({ type: "deal", data: deal });
  }, []);

  const handleInspectGamePass = useCallback((game: GamePassGame) => {
    setSelectedTarget({ type: "gamepass", data: game });
  }, []);

  const handleInspectGiveaway = useCallback((giveaway: Giveaway) => {
    setSelectedTarget({ type: "giveaway", data: giveaway });
  }, []);

  const handleInspectPlaytester = useCallback((game: PlaytesterGame) => {
    setSelectedPlaytester(game);
  }, []);

  const subtabs: {
    id: SubTab;
    label: string;
    count: number;
    loading: boolean;
    icon: React.ReactNode;
  }[] = [
    {
      id: "gamepass",
      label: t("deals.gamepass"),
      count: gpGames.length,
      loading: gpLoading,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <line x1="7" y1="12" x2="11" y2="12" />
          <line x1="9" y1="10" x2="9" y2="14" />
          <line x1="15" y1="10" x2="17" y2="14" />
          <line x1="17" y1="10" x2="15" y2="14" />
        </svg>
      ),
    },
    {
      id: "isthereanydeal",
      label: t("deals.isthereanydeal"),
      count: deals.length,
      loading: dealsLoading,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="1" x2="12" y2="23" />
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      ),
    },
    {
      id: "giveaways",
      label: t("deals.freeGames"),
      count: giveaways.length,
      loading: giveawaysLoading,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 12 20 22 4 22 4 12" />
          <rect x="2" y="7" width="20" height="5" />
          <line x1="12" y1="22" x2="12" y2="7" />
          <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
          <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
        </svg>
      ),
    },
    {
      id: "playtester",
      label: t("deals.playtester"),
      count: ptGames.length,
      loading: ptLoading,
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <line x1="8" y1="21" x2="16" y2="21" />
          <line x1="12" y1="17" x2="12" y2="21" />
        </svg>
      ),
    },
  ];

  return (
    <div className="deals-page page">
      <PageHeader
        eyebrow={t("deals.eyebrow")}
        title={t("deals.title")}
        description={t("deals.description")}
        icon={
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 7h-3a2 2 0 0 1-2-2V3" />
            <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" />
            <path d="M9 7H4a2 2 0 0 0-2 2v1" />
            <path d="M14 14l-3 3-3-3" />
            <path d="M11 17V7" />
          </svg>
        }
      />

      {/* Hero Spotlight & Stats Header */}
      <div className="ui-complete-only">
        <DealsHeroSpotlight
          deals={deals}
          giveaways={giveaways}
          gpGames={gpGames}
          onOpenUrl={handleOpenUrl}
          onInspect={setSelectedTarget}
        />

        <DealsStatsHeader
          gpGames={gpGames}
          deals={deals}
          giveaways={giveaways}
          gpLoading={gpLoading}
          dealsLoading={dealsLoading}
          giveawaysLoading={giveawaysLoading}
          onSelectSubTab={setActiveSubTab}
          onFilterWishlist={() => {
            setActiveSubTab("isthereanydeal");
            setDealFilters((prev) => ({ ...prev, wishlistOnly: true }));
          }}
        />
      </div>

      {/* Subtabs */}
      <div className="deals-subtabs" role="tablist">
        {subtabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeSubTab === tab.id}
            className={`deals-subtab ${activeSubTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveSubTab(tab.id)}
          >
            <span className="deals-subtab-icon" aria-hidden="true">
              {tab.icon}
            </span>
            {tab.label}
            {tab.count > 0 && !tab.loading && (
              <span className="deals-subtab-badge">{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Panels */}
      {activeSubTab === "gamepass" && (
        <GamePassPanel
          filters={gpFilters}
          setFilters={setGpFilters}
          games={gpGames}
          loading={gpLoading}
          error={gpError}
          empty={gpEmpty}
          density="cinematic"
          onOpenUrl={handleOpenUrl}
          onInspect={handleInspectGamePass}
          onReload={() => setGpReloadNonce((n) => n + 1)}
        />
      )}

      {activeSubTab === "isthereanydeal" && (
        <DealsPanel
          filters={dealFilters}
          setFilters={setDealFilters}
          deals={deals}
          loading={dealsLoading}
          error={dealsError}
          empty={dealsEmpty}
          density="cinematic"
          onOpenUrl={handleOpenUrl}
          onInspect={handleInspectDeal}
          onReload={() => setDealsReloadNonce((n) => n + 1)}
        />
      )}

      {activeSubTab === "giveaways" && (
        <GiveawaysPanel
          giveaways={giveaways}
          loading={giveawaysLoading}
          error={giveawaysError}
          empty={giveawaysEmpty}
          density="cinematic"
          onOpenUrl={handleOpenUrl}
          onInspect={handleInspectGiveaway}
          onReload={() => setGiveawaysReloadNonce((n) => n + 1)}
        />
      )}

      {activeSubTab === "playtester" && (
        <PlaytesterPanel
          filters={ptFilters}
          setFilters={setPtFilters}
          games={ptGames}
          loading={ptLoading}
          error={ptError}
          empty={ptEmpty}
          density="cinematic"
          hasMore={ptHasMore}
          loadingMore={ptLoadingMore}
          onLoadMore={loadMorePlaytester}
          onInspect={handleInspectPlaytester}
          onReload={() => setPtReloadNonce((n) => n + 1)}
        />
      )}

      {/* Deal Detail Modal */}
      <DealDetailModal
        target={selectedTarget}
        onClose={() => setSelectedTarget(null)}
        onOpenUrl={handleOpenUrl}
      />

      {/* Playtester Detail Modal (fetches on open) */}
      <PlaytesterDetailModal
        game={selectedPlaytester}
        onClose={() => setSelectedPlaytester(null)}
        onOpenUrl={handleOpenUrl}
      />
    </div>
  );
}
