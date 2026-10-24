import { useMemo } from "react";
import { CheckCheck, RefreshCw, Rss } from "lucide-react";
import { Button, PageHeader } from "../../components/ui";
import PageWidget from "../../components/PageWidget";
import { useLanguage } from "../../context/LanguageContext";
import NewsToolbar from "../../components/news/NewsToolbar";
import NewsOverview from "../../components/news/NewsOverview";
import NewsArticleGrid from "../../components/news/NewsArticleGrid";
import NewsArticlePreview from "../../components/news/NewsArticlePreview";
import NewsSourcesDrawer from "../../components/news/NewsSourcesDrawer";
import { useNewsPageController } from "./useNewsPageController";
import "./NewsPage.css";
import "../../styles/game-news.css";

/**
 * News page.
 *
 * Four destinations only: the briefing (Overview), the Feed, Bookmarks and
 * History. Topics are filters inside the Feed instead of tabs, so the strip no
 * longer mixes "what kind of story" with "what I saved". All state lives in
 * `useNewsPageController`; all durability lives in `NewsContext`.
 */
export default function NewsPage() {
  const { t } = useLanguage();
  const page = useNewsPageController();
  const { news } = page;

  const listTab = page.tab === "saved" || page.tab === "history" ? page.tab : "feed";

  /**
   * Store errors are SQL/IPC details; feed errors are outlet names. Neither
   * belongs on screen verbatim, so the reader gets the translated summary and
   * the console keeps the technical message.
   */
  const friendlyError = useMemo(() => {
    if (!news.error) return null;
    if (news.failedFeeds.length > 0) {
      return t("news.errorFeeds", { names: news.failedFeeds.join(", ") });
    }
    if (/no such column|SELECT |at offset|invoke|undefined/i.test(news.error)) {
      return t("news.errorStore");
    }
    return news.error;
  }, [news.error, news.failedFeeds, t]);

  return (
    <div className="news-page page">
      <PageWidget page="news" widget="newsHeader">
        <div className="ui-item-newsHeader">
          <PageHeader
            eyebrow={t("news.eyebrow")}
            title={t("news.title")}
            description={t("news.description")}
            icon={<Rss size={20} aria-hidden />}
            actions={
              <>
                {page.unreadTotal > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={page.markAllRead}
                    leftIcon={<CheckCheck size={15} />}
                    title={t("newsPage.markAllRead")}
                  >
                    {t("news.markRead")}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void news.refresh(true)}
                  leftIcon={
                    <RefreshCw
                      size={15}
                      className={news.refreshing ? "news-spin" : undefined}
                    />
                  }
                  title={t("common.refresh")}
                  aria-label={t("common.refresh")}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => page.setSourcesOpen(true)}
                  leftIcon={<Rss size={15} />}
                  title={t("news.manageSources")}
                >
                  {t("news.sources")}
                </Button>
              </>
            }
          />
        </div>
      </PageWidget>

      <PageWidget page="news" widget="newsToolbar">
        <div className="ui-item-newsToolbar">
          <NewsToolbar
            tab={page.tab}
            onTabChange={page.setTab}
            counts={page.counts}
            filters={page.filters}
            onFiltersChange={page.updateFilters}
            onResetFilters={page.resetFilters}
            topics={page.topics}
            followedTopics={news.followedTopics}
            mutedTopics={news.mutedTopics}
            onToggleFollowTopic={news.toggleFollowTopic}
            onToggleMuteTopic={news.toggleMuteTopic}
            sourceNames={news.sourceNames}
            density={page.density}
            onDensityChange={page.setDensity}
          />
        </div>
      </PageWidget>

      {page.tab === "overview" ? (
        <PageWidget page="news" widget="newsOverview">
          <div className="ui-item-newsOverview">
            <NewsOverview
              clusters={page.overviewClusters}
              savedLinks={news.savedLinks}
              savedCount={news.saved.length}
              unreadCount={page.unreadTotal}
              sourceCount={news.enabledFeeds.length}
              failingCount={news.failedFeeds.length}
              previousVisit={news.previousVisit}
              density={page.density}
              relatedGames={news.relatedGames}
              followedTopics={news.followedTopics}
              loading={news.loading}
              error={friendlyError}
              onOpen={page.openOverviewItem}
              onToggleSave={page.toggleSave}
              onToggleRead={page.toggleRead}
              onSelectTopic={page.selectTopic}
              onCatchUp={page.startCatchUp}
              onOpenFeed={page.openFeed}
              onOpenSaved={() => page.setTab("saved")}
              onOpenSources={() => page.setSourcesOpen(true)}
              onRefresh={() => void news.refresh(true)}
            />
          </div>
        </PageWidget>
      ) : (
        <PageWidget page="news" widget="newsGrid">
          <div className="ui-item-newsGrid">
            <NewsArticleGrid
              items={page.visibleItems}
              total={page.totalVisible}
              tab={listTab}
              density={page.density}
              loading={news.loading}
              error={friendlyError}
              hasMore={page.hasMore}
              searching={page.filters.query.trim().length > 0}
              filtering={page.filterCount > 0}
              sourceCount={news.enabledFeeds.length}
              savedLinks={news.savedLinks}
              relatedGames={news.relatedGames}
              onOpen={(item) => page.openItem(item)}
              onToggleSave={page.toggleSave}
              onToggleRead={page.toggleRead}
              onSelectTopic={page.selectTopic}
              onLoadMore={page.loadMore}
              onRetry={() => void news.refresh(true)}
              onResetFilters={page.resetFilters}
              onOpenSources={() => page.setSourcesOpen(true)}
              onGoToFeed={() => page.openFeed()}
            />
          </div>
        </PageWidget>
      )}

      <NewsArticlePreview
        article={page.selectedArticle ?? null}
        saved={page.savedSelected}
        onClose={page.closePreview}
        onToggleSave={() => {
          if (page.selected) page.toggleSave(page.selected);
        }}
        onToggleRead={() => {
          if (page.selected) page.toggleRead(page.selected);
        }}
        isRead={page.selected ? news.readLinks.has(page.selected.article.link) : false}
        relatedOutlets={page.selected?.related ?? []}
        onPrevArticle={page.goPrev}
        onNextArticle={page.goNext}
        hasPrev={page.hasPrev}
        hasNext={page.hasNext}
      />

      <NewsSourcesDrawer open={page.sourcesOpen} onClose={() => page.setSourcesOpen(false)} />
    </div>
  );
}
