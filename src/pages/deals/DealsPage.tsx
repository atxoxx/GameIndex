import { useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  CircleDollarSign,
  Gamepad2,
  Gift,
  LayoutDashboard,
  MonitorPlay,
  RefreshCw,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { PageHeader, SubTabs } from "../../components/ui";
import PageWidget from "../../components/PageWidget";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { useViewDensity } from "../../hooks/useViewDensity";
import type { GamePassGame, Giveaway, PlaytesterGame } from "../../types/deals";
import type { DealGroup, SubTab } from "./dealsConstants";
import { useDealsPageController } from "./useDealsPageController";
import {
  dealsToolbar,
  gamePassToolbar,
  giveawaysToolbar,
  playtesterToolbar,
} from "./dealsToolbars";
import DealsToolbar from "../../components/deals/DealsToolbar";
import OverviewTab from "../../components/deals/OverviewTab";
import DealsPanel from "../../components/deals/DealsPanel";
import GamePassPanel from "../../components/deals/GamePassPanel";
import GiveawaysPanel from "../../components/deals/GiveawaysPanel";
import PlaytesterPanel from "../../components/deals/PlaytesterPanel";
import DealDetailModal, {
  type ModalDealTarget,
} from "../../components/deals/DealDetailModal";
import PlaytesterDetailModal from "../../components/deals/PlaytesterDetailModal";
import "./DealsPage.css";

/**
 * Deals page.
 *
 * Structure: header, a sticky band holding the source tabs plus the shared
 * control band, then either the Overview blocks or one source grid. All state
 * (feeds, filters, grouping, clock) lives in `useDealsPageController`; this file
 * only chooses what to show and wires the modals.
 */
export default function DealsPage() {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { density, setDensity } = useViewDensity();

  const controller = useDealsPageController();
  const { activeTab, setActiveTab, filters, setFilters, feeds, rails } = controller;

  const [selectedDeal, setSelectedDeal] = useState<DealGroup | null>(null);
  const [selectedGamePass, setSelectedGamePass] = useState<GamePassGame | null>(null);
  const [selectedGiveaway, setSelectedGiveaway] = useState<Giveaway | null>(null);
  const [selectedPlaytester, setSelectedPlaytester] = useState<PlaytesterGame | null>(null);

  const handleOpenUrl = useCallback(
    async (url: string | null | undefined) => {
      if (!url) return;
      try {
        await invoke<void>("open_deal_url", { url });
      } catch (err) {
        showToast(
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : t("deals.errorOpenLink"),
          "error",
        );
      }
    },
    [showToast, t],
  );

  const giveawayStores = useMemo(() => {
    const stores = new Set<string>();
    for (const giveaway of feeds.giveaways.data ?? []) {
      if (giveaway.storeName) stores.add(giveaway.storeName);
    }
    return [...stores].sort((a, b) => a.localeCompare(b));
  }, [feeds.giveaways.data]);

  const playtesterFacets = useMemo(() => {
    const platforms = new Set<string>();
    const genres = new Set<string>();
    const statuses = new Set<string>();
    const kinds = new Set<string>();
    for (const game of feeds.playtester.data?.games ?? []) {
      for (const platform of game.platforms) platforms.add(platform);
      for (const genre of game.genres) genres.add(genre);
      if (game.status) statuses.add(game.status);
      if (game.kind) kinds.add(game.kind);
    }
    return {
      platforms: [...platforms].sort(),
      genres: [...genres].sort(),
      statuses: [...statuses].sort(),
      kinds: [...kinds].sort(),
    };
  }, [feeds.playtester.data]);

  const toolbar = useMemo(() => {
    switch (activeTab) {
      case "deals":
        return dealsToolbar(filters.deals, setFilters.deals, t);
      case "gamepass":
        return gamePassToolbar(filters.gamepass, setFilters.gamepass, t);
      case "giveaways":
        return giveawaysToolbar(
          filters.giveaways,
          setFilters.giveaways,
          giveawayStores,
          t,
        );
      case "playtester":
        return playtesterToolbar(
          filters.playtester,
          setFilters.playtester,
          playtesterFacets,
          t,
        );
      default:
        return null;
    }
  }, [
    activeTab,
    setFilters.deals,
    setFilters.gamepass,
    setFilters.giveaways,
    setFilters.playtester,
    filters.deals,
    filters.gamepass,
    filters.giveaways,
    filters.playtester,
    giveawayStores,
    playtesterFacets,
    t,
  ]);

  const activeFeed =
    activeTab === "deals"
      ? feeds.deals
      : activeTab === "gamepass"
        ? feeds.gamepass
        : activeTab === "giveaways"
          ? feeds.giveaways
          : activeTab === "playtester"
            ? feeds.playtester
            : null;

  const searchValue =
    activeTab === "deals"
      ? filters.deals.searchQuery
      : activeTab === "gamepass"
        ? filters.gamepass.searchQuery
        : activeTab === "giveaways"
          ? filters.giveaways.searchQuery
          : filters.playtester.searchQuery;

  const setSearch = (value: string) => {
    if (activeTab === "deals") {
      setFilters.deals((prev) => ({ ...prev, searchQuery: value }));
    } else if (activeTab === "gamepass") {
      setFilters.gamepass((prev) => ({ ...prev, searchQuery: value }));
    } else if (activeTab === "giveaways") {
      setFilters.giveaways((prev) => ({ ...prev, searchQuery: value }));
    } else {
      setFilters.playtester((prev) => ({ ...prev, searchQuery: value }));
    }
  };

  const tabs: {
    id: SubTab;
    label: string;
    count: number | null;
    icon: LucideIcon;
  }[] = [
    {
      id: "overview",
      label: t("deals.overview"),
      count: null,
      icon: LayoutDashboard,
    },
    {
      id: "deals",
      label: t("deals.storeDeals"),
      count: feeds.deals.loading ? null : feeds.deals.total,
      icon: CircleDollarSign,
    },
    {
      id: "gamepass",
      label: t("deals.gamepassShort"),
      count: feeds.gamepass.loading ? null : feeds.gamepass.total,
      icon: Gamepad2,
    },
    {
      id: "giveaways",
      label: t("deals.freeGames"),
      count: feeds.giveaways.loading ? null : feeds.giveaways.total,
      icon: Gift,
    },
    {
      id: "playtester",
      label: t("deals.overviewPlaytests"),
      count: feeds.playtester.loading ? null : feeds.playtester.total,
      icon: MonitorPlay,
    },
  ];

  const modalTarget: ModalDealTarget | null = selectedDeal
    ? { type: "deal", data: selectedDeal.best, offers: selectedDeal.offers }
    : selectedGamePass
      ? { type: "gamepass", data: selectedGamePass }
      : selectedGiveaway
        ? { type: "giveaway", data: selectedGiveaway }
        : null;

  const closeDealModal = () => {
    setSelectedDeal(null);
    setSelectedGamePass(null);
    setSelectedGiveaway(null);
  };

  return (
    <div className="deals-page page">
      <PageWidget page="deals" widget="dealsHeader">
        <div className="ui-item-dealsHeader">
          <PageHeader
            eyebrow={t("deals.eyebrow")}
            title={t("deals.title")}
            description={t("deals.description")}
            icon={<Tag size={20} aria-hidden="true" />}
            actions={
              <button
                type="button"
                className="deals-page-refresh"
                onClick={controller.reloadAll}
                aria-label={t("deals.refreshAll")}
                title={t("deals.refreshAll")}
              >
                <RefreshCw size={15} aria-hidden="true" />
                {t("common.refresh")}
              </button>
            }
          />
        </div>
      </PageWidget>

      <PageWidget page="deals" widget="subtabs">
        <div className="deals-sticky ui-item-subtabs">
          <SubTabs
            ariaLabel={t("deals.title")}
            value={activeTab}
            onChange={setActiveTab}
            items={tabs.map((tab) => ({
              id: tab.id,
              label: tab.label,
              icon: tab.icon,
              count: tab.count,
            }))}
          />

          {toolbar && activeFeed && (
            <DealsToolbar
              search={searchValue}
              onSearchChange={setSearch}
              searchPlaceholder={toolbar.searchPlaceholder}
              sort={toolbar.sort}
              filters={toolbar.filters}
              toggles={toolbar.toggles}
              density={density}
              onDensityChange={setDensity}
              loading={activeFeed.loading}
              onReload={() =>
                controller.reloadSource(activeTab as Exclude<SubTab, "overview">)
              }
            />
          )}
        </div>
      </PageWidget>

      <PageWidget page="deals" widget="dealsGrid">
        <div className="ui-item-dealsGrid deals-content">
          {activeTab === "overview" && (
            <OverviewTab
              rails={rails}
              totals={{
                deals: feeds.deals.groups.length,
                giveaways: feeds.giveaways.total,
                gamepass: feeds.gamepass.total,
                playtests: feeds.playtester.total,
              }}
              loading={{
                deals: feeds.deals.loading,
                giveaways: feeds.giveaways.loading,
                gamepass: feeds.gamepass.loading,
                playtester: feeds.playtester.loading,
              }}
              errors={{
                deals: feeds.deals.error,
                giveaways: feeds.giveaways.error,
                gamepass: feeds.gamepass.error,
                playtester: feeds.playtester.error,
              }}
              onReloadAll={controller.reloadAll}
              density={density}
              now={controller.now}
              onSelectTab={setActiveTab}
              onOpenUrl={handleOpenUrl}
              onInspectDeal={setSelectedDeal}
              onInspectGiveaway={setSelectedGiveaway}
              onInspectGamePass={setSelectedGamePass}
              onInspectPlaytester={setSelectedPlaytester}
            />
          )}

          {activeTab === "deals" && (
            <DealsPanel
              groups={feeds.deals.items}
              total={feeds.deals.total}
              loading={feeds.deals.loading}
              error={feeds.deals.error}
              density={density}
              onOpenUrl={handleOpenUrl}
              onInspect={setSelectedDeal}
              onReload={feeds.deals.reload}
              onResetFilters={toolbar?.onReset ?? (() => undefined)}
            />
          )}

          {activeTab === "gamepass" && (
            <GamePassPanel
              games={feeds.gamepass.items}
              total={feeds.gamepass.total}
              loading={feeds.gamepass.loading}
              error={feeds.gamepass.error}
              density={density}
              onOpenUrl={handleOpenUrl}
              onInspect={setSelectedGamePass}
              onReload={feeds.gamepass.reload}
              onResetFilters={toolbar?.onReset ?? (() => undefined)}
            />
          )}

          {activeTab === "giveaways" && (
            <GiveawaysPanel
              giveaways={feeds.giveaways.items}
              total={feeds.giveaways.total}
              loading={feeds.giveaways.loading}
              error={feeds.giveaways.error}
              density={density}
              now={controller.now}
              onOpenUrl={handleOpenUrl}
              onInspect={setSelectedGiveaway}
              onReload={feeds.giveaways.reload}
              onResetFilters={toolbar?.onReset ?? (() => undefined)}
            />
          )}

          {activeTab === "playtester" && (
            <PlaytesterPanel
              games={feeds.playtester.items}
              total={feeds.playtester.total}
              loading={feeds.playtester.loading}
              error={feeds.playtester.error}
              density={density}
              hasMore={feeds.playtester.hasMore}
              loadingMore={feeds.playtester.loadingMore}
              onLoadMore={feeds.playtester.loadMore}
              onOpenUrl={handleOpenUrl}
              onInspect={setSelectedPlaytester}
              onReload={feeds.playtester.reload}
              onResetFilters={toolbar?.onReset ?? (() => undefined)}
            />
          )}
        </div>
      </PageWidget>

      <DealDetailModal
        target={modalTarget}
        onClose={closeDealModal}
        onOpenUrl={handleOpenUrl}
      />

      <PlaytesterDetailModal
        game={selectedPlaytester}
        onClose={() => setSelectedPlaytester(null)}
        onOpenUrl={handleOpenUrl}
      />
    </div>
  );
}
