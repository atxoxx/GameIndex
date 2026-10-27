import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Settings2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../context/GameContext";
import { useToast } from "../context/ToastContext";
import { useLanguage } from "../context/LanguageContext";
import { useSettings } from "../context/SettingsContext";
import { type Game } from "../types/game";
import type { DealItem } from "../types/deals";
import type { NewsArticle } from "../types/news";
import { useNews } from "../context/NewsContext";
import PageWidget from "../components/PageWidget";
import HomeHero from "../components/hero/HomeHero";
import HomeQuickStats from "../components/home/HomeQuickStats";
import HomeQuickLaunch from "../components/home/HomeQuickLaunch";
import HomeFriendsFeed from "../components/home/HomeFriendsFeed";
import HomeCustomizeModal, {
  loadHomeSectionsConfig,
  type HomeSectionsConfig,
} from "../components/home/HomeCustomizeModal";
import ContinuePlayingRail from "../components/library/ContinuePlayingRail";
import RecentlyAddedRail from "../components/library/RecentlyAddedRail";
import ShelfRails from "../components/shelves/ShelfRails";
import HomeActivityRecap from "../components/home/HomeActivityRecap";
import HomeAchievements from "../components/home/HomeAchievements";
import HomeDownloads from "../components/home/HomeDownloads";
import HomeWishlistRail from "../components/home/HomeWishlistRail";
import HomeDealsRail from "../components/home/HomeDealsRail";
import HomeNewsRail from "../components/home/HomeNewsRail";
import DealDetailModal, {
  type ModalDealTarget,
} from "../components/deals/DealDetailModal";
import NewsArticlePreview from "../components/news/NewsArticlePreview";
import "../styles/home.css";
import "../library.css";
import "../styles/game-news.css";

/**
 * HomePage — the app's refined central dashboard.
 *
 * Cinematic multi-spotlight hero with instant resume, quick stats KPI bar,
 * customizable 2-column player dashboard with sidebar widgets (Quick Launch,
 * Weekly Activity, Achievements, Friends) and curated discovery rails
 * (Continue Playing, Recently Added, Active Downloads, Wishlist, Deals, News).
 */
export default function HomePage() {
  const navigate = useNavigate();
  const { games } = useGames();
  const { showToast } = useToast();
  const { t } = useLanguage();
  const { isSimpleUi } = useSettings();

  const [dealTarget, setDealTarget] = useState<ModalDealTarget | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);
  const { savedLinks, toggleSaved, loadArticle } = useNews();
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [sectionsConfig, setSectionsConfig] = useState<HomeSectionsConfig>(() =>
    loadHomeSectionsConfig()
  );

  const isEmpty = games.length === 0;

  const openGame = (game: Game) => navigate(`/library/${game.id}`);

  const handleOpenDealUrl = useCallback(
    async (url: string | null | undefined) => {
      if (!url) return;
      try {
        await invoke<void>("open_deal_url", { url });
      } catch (err) {
        console.error("Failed to open URL:", err);
        showToast(
          err instanceof Error ? err.message : t("deals.errorOpenLink"),
          "error"
        );
      }
    },
    [showToast, t]
  );

  const handleInspectDeal = useCallback((deal: DealItem) => {
    setDealTarget({ type: "deal", data: deal });
  }, []);

  const handleSelectArticle = useCallback((article: NewsArticle) => {
    setSelectedArticle(article);
    if (!article.content) {
      void loadArticle(article.link).then((full) => {
        if (full) {
          setSelectedArticle((prev) => (prev && prev.link === full.link ? full : prev));
        }
      });
    }
  }, [loadArticle]);

  const handleToggleSaveArticle = useCallback((article: NewsArticle) => {
    void toggleSaved(article);
  }, [toggleSaved]);

  const handleCloseArticle = useCallback(() => {
    setSelectedArticle(null);
  }, []);

  return (
    <div className="home-page">
      {/* 1. Cinematic Multi-Candidate Spotlight Hero.
             Simple mode keeps its welcome header outside the hero widget: the
             `.ui-item-hero` marker is hidden in Simple mode, which used to take
             the whole first-run greeting down with it. */}
      {isSimpleUi ? (
        <header className="home-simple-header">
          <h1 className="home-simple-title">{t("home.simple.title")}</h1>
          <p className="home-simple-subtitle">{t("home.simple.subtitle")}</p>
          <div className="home-simple-actions">
            <button
              type="button"
              className="home-simple-btn home-simple-btn--primary"
              onClick={() => navigate("/store")}
            >
              {t("home.simple.browseStore")}
            </button>
            <button
              type="button"
              className="home-simple-btn"
              onClick={() => navigate("/library")}
            >
              {t("home.simple.yourLibrary")}
            </button>
          </div>
        </header>
      ) : (
        <PageWidget page="home" widget="hero">
          <div className="ui-item-hero">
            <HomeHero games={games} onOpenGame={openGame} />
          </div>
        </PageWidget>
      )}

      {/* 2. Glanceable Quick Stats Bar */}
      {sectionsConfig.quickStats && !isEmpty && (
        <PageWidget page="home" widget="homeQuickStats">
          <div className="ui-complete-only ui-item-homeQuickStats">
            <HomeQuickStats />
          </div>
        </PageWidget>
      )}

      {/* 3. Dashboard Grid Header with Customization Trigger.
             Rendered outside PageWidget on purpose: the global "Dashboard
             widget rows" toggle must not remove the only entry point to the
             Home section toggles. */}
      <div className="home-dashboard-header ui-complete-only">
        <h2 className="home-dashboard-title">{t("stats.tab.overview")}</h2>
        <button
          type="button"
          className="home-customize-btn"
          onClick={() => setCustomizeOpen(true)}
          title={t("home.customize.title")}
          aria-label={t("home.customize.title")}
        >
          <Settings2 size={15} aria-hidden="true" />
          <span>{t("home.customize.title")}</span>
        </button>
      </div>

      {/* 4. Two-column Player Dashboard */}
      <div className="home-dashboard">
        {/* Left Sidebar: Quick Launch, Activity, Achievements, Friends */}
        <aside className="home-dashboard__sidebar">
          {sectionsConfig.quickLaunch && !isEmpty && (
            <PageWidget page="home" widget="homeQuickLaunch">
              <div className="ui-item-homeQuickLaunch">
                <HomeQuickLaunch />
              </div>
            </PageWidget>
          )}
          {sectionsConfig.activity && (
            <PageWidget page="home" widget="homeActivity">
              <div className="ui-complete-only ui-item-homeActivity">
                <HomeActivityRecap />
              </div>
            </PageWidget>
          )}
          {sectionsConfig.achievements && (
            <PageWidget page="home" widget="homeAchievements">
              <div className="ui-complete-only ui-item-homeAchievements">
                <HomeAchievements />
              </div>
            </PageWidget>
          )}
          {sectionsConfig.friends && (
            <PageWidget page="home" widget="homeFriends">
              <div className="ui-complete-only ui-item-homeFriends">
                <HomeFriendsFeed />
              </div>
            </PageWidget>
          )}
        </aside>

        {/* Right Main Column: Rails, Downloads, Discovery */}
        <div className="home-dashboard__main">
          {sectionsConfig.continuePlaying && !isEmpty && (
            <PageWidget page="home" widget="homeContinuePlaying">
              <div className="ui-item-homeContinuePlaying">
                <ContinuePlayingRail games={games} onCardClick={openGame} />
              </div>
            </PageWidget>
          )}
          {sectionsConfig.recentlyAdded && !isEmpty && games.length >= 4 && (
            <PageWidget page="home" widget="homeRecentlyAdded">
              <div className="ui-item-homeRecentlyAdded">
                <RecentlyAddedRail games={games} onCardClick={openGame} />
              </div>
            </PageWidget>
          )}
          {!isEmpty && (
            <PageWidget page="home" widget="homeShelves">
              <div className="ui-item-homeShelves">
                <ShelfRails onCardClick={openGame} />
              </div>
            </PageWidget>
          )}
          {sectionsConfig.downloads && (
            <PageWidget page="home" widget="homeDownloads">
              <div className="ui-item-homeDownloads">
                <HomeDownloads />
              </div>
            </PageWidget>
          )}
          {sectionsConfig.wishlist && (
            <PageWidget page="home" widget="homeWishlist">
              <div className="ui-complete-only ui-item-homeWishlist">
                <HomeWishlistRail />
              </div>
            </PageWidget>
          )}
          {sectionsConfig.deals && (
            <PageWidget page="home" widget="homeDeals">
              <div className="ui-complete-only ui-item-homeDeals">
                <HomeDealsRail onInspect={handleInspectDeal} />
              </div>
            </PageWidget>
          )}
          {sectionsConfig.news && (
            <PageWidget page="home" widget="homeNews">
              <div className="ui-complete-only ui-item-homeNews">
                <HomeNewsRail onSelectArticle={handleSelectArticle} />
              </div>
            </PageWidget>
          )}
        </div>
      </div>

      {/* 5. Customization Modal */}
      <HomeCustomizeModal
        isOpen={customizeOpen}
        config={sectionsConfig}
        onChange={setSectionsConfig}
        onClose={() => setCustomizeOpen(false)}
      />

      {/* 6. Detail modals */}
      <DealDetailModal
        target={dealTarget}
        onClose={() => setDealTarget(null)}
        onOpenUrl={handleOpenDealUrl}
      />

      <NewsArticlePreview
        article={selectedArticle}
        saved={
          selectedArticle
            ? savedLinks.has(selectedArticle.link)
            : false
        }
        onClose={handleCloseArticle}
        onToggleSave={handleToggleSaveArticle}
      />
    </div>
  );
}
