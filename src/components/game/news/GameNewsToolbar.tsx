import {
  CheckCheck,
  Clock3,
  ExternalLink,
  LayoutGrid,
  List,
  Newspaper,
  RefreshCw,
  Rss,
  Sparkles,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { Button } from "../../ui";
import {
  GameTabChips,
  GameTabSearch,
  GameTabToolbar,
  GameTabViewSwitch,
} from "../tabs";
import type {
  GameNewsFilterCategory,
  GameNewsPageView,
  GameNewsSortOption,
  GameNewsViewMode,
} from "./gameNewsTypes";

interface CategoryCount {
  all: number;
  unread: number;
  patch_notes: number;
  official: number;
  press: number;
  saved: number;
}

interface GameNewsToolbarProps {
  view: GameNewsPageView;
  onViewChange: (view: GameNewsPageView) => void;
  density: GameNewsViewMode;
  onDensityChange: (mode: GameNewsViewMode) => void;
  activeCategory: GameNewsFilterCategory;
  onSelectCategory: (cat: GameNewsFilterCategory) => void;
  counts: CategoryCount;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  sortOption: GameNewsSortOption;
  onSortChange: (sort: GameNewsSortOption) => void;
  onMarkAllRead: () => void;
  onOpenCustomFeeds: () => void;
  onRefresh: () => void;
  onOpenNewsHub: () => void;
  isRefreshing?: boolean;
  hasUnread?: boolean;
  unreadCount?: number;
}

/**
 * News command row.
 *
 * Briefing and Feed are the two surfaces; feed density and sort only appear
 * where they apply. Categories are filters, not navigation, so they stay as
 * chips beside the search instead of a second tab strip.
 */
export default function GameNewsToolbar({
  view,
  onViewChange,
  density,
  onDensityChange,
  activeCategory,
  onSelectCategory,
  counts,
  searchQuery,
  onSearchChange,
  sortOption,
  onSortChange,
  onMarkAllRead,
  onOpenCustomFeeds,
  onRefresh,
  onOpenNewsHub,
  isRefreshing = false,
  hasUnread = false,
  unreadCount = 0,
}: GameNewsToolbarProps) {
  const { t } = useLanguage();

  const categories: { id: GameNewsFilterCategory; label: string; count: number }[] = [
    { id: "all", label: t("game.news.all"), count: counts.all },
    { id: "unread", label: t("game.news.unread"), count: counts.unread },
    {
      id: "patch_notes",
      label: t("game.news.patchNotes"),
      count: counts.patch_notes,
    },
    { id: "official", label: t("game.news.official"), count: counts.official },
    { id: "press", label: t("game.news.press"), count: counts.press },
    { id: "saved", label: t("game.news.saved"), count: counts.saved },
  ];

  return (
    <GameTabToolbar
      search={
        <GameTabSearch
          value={searchQuery}
          onChange={onSearchChange}
          placeholder={t("game.news.searchPlaceholder")}
          label={t("game.news.searchPlaceholder")}
          clearLabel={t("game.news.clearFilter")}
        />
      }
      filters={
        <GameTabChips
          items={categories}
          value={activeCategory}
          onChange={onSelectCategory}
          ariaLabel={t("game.news.categories")}
        />
      }
      view={
        <GameTabViewSwitch
          items={[
            { id: "briefing", label: t("game.news.viewBriefing"), icon: Sparkles },
            { id: "feed", label: t("game.news.viewFeed"), icon: Newspaper },
          ]}
          value={view}
          onChange={onViewChange}
          ariaLabel={t("game.news.viewLabel")}
        />
      }
      actions={
        <>
          {hasUnread && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onMarkAllRead}
              leftIcon={<CheckCheck size={14} />}
              title={t("game.news.markAllRead")}
            >
              {t("game.news.markAllRead")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenCustomFeeds}
            leftIcon={<Rss size={14} />}
            title={t("game.news.customFeedsTitle")}
          >
            {t("game.news.customFeeds")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            leftIcon={
              <RefreshCw size={14} className={isRefreshing ? "spin-animation" : undefined} />
            }
            title={t("common.refresh")}
          >
            {t("common.refresh")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenNewsHub}
            leftIcon={<ExternalLink size={14} />}
            title={t("game.news.openNewsHub")}
          >
            {t("game.news.openNewsHub")}
          </Button>
        </>
      }
      below={
        view === "feed" ? (
          <div className="game-news-feed-controls">
            <GameTabViewSwitch
              items={[
                { id: "grid", label: t("game.news.viewGrid"), icon: LayoutGrid },
                { id: "list", label: t("game.news.viewList"), icon: List },
                { id: "timeline", label: t("game.news.viewTimeline"), icon: Clock3 },
              ]}
              value={density}
              onChange={onDensityChange}
              ariaLabel={t("game.news.densityLabel")}
            />
            <select
              className="game-tab-select"
              value={sortOption}
              onChange={(event) =>
                onSortChange(event.target.value as GameNewsSortOption)
              }
              aria-label={t("game.news.sortLabel")}
            >
              <option value="newest">{t("game.news.sortByNewest")}</option>
              <option value="oldest">{t("game.news.sortByOldest")}</option>
            </select>
          </div>
        ) : (
          <p className="game-news-unread-note">
            {unreadCount > 0
              ? t("game.news.sinceLastVisitCount", { count: unreadCount })
              : t("game.news.caughtUp")}
          </p>
        )
      }
    />
  );
}
