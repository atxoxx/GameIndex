import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../context/GameContext";
import { useToast } from "../context/ToastContext";
import { useLanguage } from "../context/LanguageContext";
import { type Game } from "../types/game";
import type { DealItem } from "../types/deals";
import type { NewsArticle } from "../hooks/useNewsFeeds";
import { loadSavedArticles, toggleSavedArticle } from "./communityStorage";
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

  const [dealTarget, setDealTarget] = useState<ModalDealTarget | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);
  const [savedArticles, setSavedArticles] = useState(() => loadSavedArticles());
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
  }, []);

  const handleToggleSaveArticle = useCallback((article: NewsArticle) => {
    setSavedArticles(toggleSavedArticle(article));
  }, []);

  const handleCloseArticle = useCallback(() => {
    setSelectedArticle(null);
  }, []);

  return (
    <div className="home-page">
      {/* 1. Cinematic Multi-Candidate Spotlight Hero */}
      <HomeHero games={games} onOpenGame={openGame} />

      {/* 2. Glanceable Quick Stats Bar */}
      {sectionsConfig.quickStats && !isEmpty && (
        <div className="ui-complete-only">
          <HomeQuickStats />
        </div>
      )}

      {/* 3. Dashboard Grid Header with Customization Trigger */}
      <div className="home-dashboard-header ui-complete-only">
        <h2 className="home-dashboard-title">{t("stats.tab.overview")}</h2>
        <button
          type="button"
          className="home-customize-btn"
          onClick={() => setCustomizeOpen(true)}
          title={t("home.customize.title")}
          aria-label={t("home.customize.title")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span>{t("home.customize.title")}</span>
        </button>
      </div>

      {/* 4. Two-column Player Dashboard */}
      <div className="home-dashboard">
        {/* Left Sidebar: Quick Launch, Activity, Achievements, Friends */}
        <aside className="home-dashboard__sidebar">
          {sectionsConfig.quickLaunch && !isEmpty && <HomeQuickLaunch />}
          <div className="ui-complete-only">
            {sectionsConfig.activity && <HomeActivityRecap />}
            {sectionsConfig.achievements && <HomeAchievements />}
            {sectionsConfig.friends && <HomeFriendsFeed />}
          </div>
        </aside>

        {/* Right Main Column: Rails, Downloads, Discovery */}
        <div className="home-dashboard__main">
          {sectionsConfig.continuePlaying && !isEmpty && (
            <ContinuePlayingRail games={games} onCardClick={openGame} />
          )}
          {sectionsConfig.recentlyAdded && !isEmpty && games.length >= 4 && (
            <RecentlyAddedRail games={games} onCardClick={openGame} />
          )}
          {sectionsConfig.downloads && <HomeDownloads />}
          <div className="ui-complete-only">
            {sectionsConfig.wishlist && <HomeWishlistRail />}
            {sectionsConfig.deals && <HomeDealsRail onInspect={handleInspectDeal} />}
            {sectionsConfig.news && <HomeNewsRail onSelectArticle={handleSelectArticle} />}
          </div>
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
            ? savedArticles.some((s) => s.link === selectedArticle.link)
            : false
        }
        onClose={handleCloseArticle}
        onToggleSave={handleToggleSaveArticle}
      />
    </div>
  );
}
