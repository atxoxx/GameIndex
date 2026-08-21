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
 * Home — the app's dashboard landing surface.
 *
 * A cinematic spotlight hero leads the page; below it a two-column
 * dashboard grid pulls in the best of every other surface:
 *   • Sidebar — Activity recap (this-week stats + heatmap) and recent
 *     achievement unlocks.
 *   • Main — the library rails (Continue Playing / Recently Added),
 *     live downloads, the wishlist strip, top deals and latest news.
 *
 * Each widget reuses the owning page's context/hook so the data is the
 * same the user sees on the dedicated page, just distilled. Modals for
 * deal detail and article reading are mounted here so nothing on the
 * home page dead-ends.
 */
export default function HomePage() {
  const navigate = useNavigate();
  const { games } = useGames();
  const { showToast } = useToast();
  const { t } = useLanguage();

  const [dealTarget, setDealTarget] = useState<ModalDealTarget | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);
  const [savedArticles, setSavedArticles] = useState(() => loadSavedArticles());

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
      <HomeHero games={games} onOpenGame={openGame} />

      <div className="home-dashboard">
        <aside className="home-dashboard__sidebar">
          <HomeActivityRecap />
          <HomeAchievements />
        </aside>

        <div className="home-dashboard__main">
          {!isEmpty && <ContinuePlayingRail games={games} onCardClick={openGame} />}
          {!isEmpty && games.length >= 4 && (
            <RecentlyAddedRail games={games} onCardClick={openGame} />
          )}
          <HomeDownloads />
          <HomeWishlistRail />
          <HomeDealsRail onInspect={handleInspectDeal} />
          <HomeNewsRail onSelectArticle={handleSelectArticle} />
        </div>
      </div>

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
