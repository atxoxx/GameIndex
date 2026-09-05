import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import "../styles/page-achievements.css";
import "../styles/achievements.css";
import { useAchievements } from "../context/AchievementContext";
import { useGames } from "../context/GameContext";
import { useToast } from "../context/ToastContext";
import { useLanguage } from "../context/LanguageContext";
import {
  type AchievementSource,
  type AchievementRarity,
  getAchievementRarity,
} from "../types/game";
import {
  ACHIEVEMENT_SOURCES,
  sourceOfPayload,
} from "../components/achievements/AchievementSourceBadge";
import { PageHeader } from "../components/ui";

import {
  calculateLibraryGamerscore,
  calculateGameGamerscore,
  getMonthlyUnlockActivity,
} from "../components/achievements/achievementUtils";
import AchievementsSummaryHero from "../components/achievements/AchievementsSummaryHero";
import AchievementsRarityChart from "../components/achievements/AchievementsRarityChart";
import AchievementsActivityChart from "../components/achievements/AchievementsActivityChart";
import AchievementsAlmostDoneShelf, {
  type AlmostDoneGameItem,
} from "../components/achievements/AchievementsAlmostDoneShelf";
import AchievementsRecentFeed, {
  type RecentAchievementFeedItem,
} from "../components/achievements/AchievementsRecentFeed";
import GameAchievementCard from "../components/achievements/GameAchievementCard";
import GameAchievementRow from "../components/achievements/GameAchievementRow";

type CompletionFilter = "all" | "perfect" | "in_progress" | "almost_done" | "not_started";
type SortBy = "completion" | "gamerscore" | "name" | "total" | "recent";
type SourceFilter = "all" | AchievementSource;
type ViewMode = "grid" | "list";

export default function AchievementsPage() {
  const { games } = useGames();
  const {
    cache,
    syncAllAchievements,
    syncRetroAchievements,
    syncManualAchievements,
    syncGogAchievements,
    syncEpicAchievements,
    links,
    isSyncing,
    syncProgress,
  } = useAchievements();
  const { showToast } = useToast();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [completionFilter, setCompletionFilter] = useState<CompletionFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [sortBy, setSortBy] = useState<SortBy>("completion");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [bulkSyncing, setBulkSyncing] = useState(false);

  // Aggregate gamerscore points across library
  const gamerscore = useMemo(() => {
    return calculateLibraryGamerscore(cache.games);
  }, [cache]);

  // Build enriched base game list with achievement data (only recomputed when library or cache changes)
  const baseAchievementGames = useMemo(() => {
    return games
      .filter(
        (g) =>
          g.steamAppId ||
          cache.games[g.id] ||
          g.gogGameId ||
          g.epicNamespace ||
          g.emulatorId ||
          g.romPath ||
          (links[g.id]?.length ?? 0) > 0
      )
      .map((g) => {
        const data = cache.games[g.id];
        const rarity: Record<AchievementRarity, number> = {
          common: 0,
          uncommon: 0,
          rare: 0,
          ultra_rare: 0,
        };
        for (const a of data?.achievements ?? []) {
          if (a.achieved) rarity[getAchievementRarity(a.percent)]++;
        }
        const gamePoints = calculateGameGamerscore(data?.achievements ?? []);

        return {
          game: g,
          data,
          total: data?.total ?? 0,
          unlocked: data?.unlocked ?? 0,
          pct: data && data.total > 0 ? Math.round((data.unlocked / data.total) * 100) : 0,
          pointsEarned: gamePoints.earned,
          pointsTotal: gamePoints.total,
          lastSynced: data?.lastSynced ?? 0,
          source: sourceOfPayload(data),
          rarity,
        };
      });
  }, [games, cache, links]);

  // Filtered & sorted games (fast, without re-analyzing raw achievement arrays)
  const gamesWithAchievements = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return baseAchievementGames
      .filter((item) => {
        if (q && !item.game.name.toLowerCase().includes(q)) {
          return false;
        }
        if (completionFilter === "perfect") return item.pct === 100 && item.total > 0;
        if (completionFilter === "almost_done") return item.pct >= 70 && item.pct < 100 && item.total > 0;
        if (completionFilter === "in_progress") return item.unlocked > 0 && item.pct < 100;
        if (completionFilter === "not_started") return item.unlocked === 0 || !item.data;
        if (sourceFilter !== "all" && item.source !== sourceFilter) return false;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "name") return a.game.name.localeCompare(b.game.name);
        if (sortBy === "completion") return b.pct - a.pct || b.unlocked - a.unlocked;
        if (sortBy === "gamerscore") return b.pointsEarned - a.pointsEarned || b.pointsTotal - a.pointsTotal;
        if (sortBy === "total") return b.total - a.total;
        if (sortBy === "recent") return b.lastSynced - a.lastSynced;
        return 0;
      });
  }, [baseAchievementGames, completionFilter, sourceFilter, sortBy, searchQuery]);

  // Aggregate stats
  const stats = useMemo(() => {
    let totalAchievements = 0;
    let totalUnlocked = 0;
    let perfectGames = 0;
    let gamesWithData = 0;

    for (const item of Object.values(cache.games)) {
      if (item.total > 0) {
        gamesWithData++;
        totalAchievements += item.total;
        totalUnlocked += item.unlocked;
        if (item.unlocked === item.total) perfectGames++;
      }
    }

    return {
      totalAchievements,
      totalUnlocked,
      overallPct: totalAchievements > 0 ? Math.round((totalUnlocked / totalAchievements) * 100) : 0,
      perfectGames,
      gamesWithData,
      avgCompletion:
        gamesWithData > 0
          ? Math.round(
              Object.values(cache.games)
                .filter((d) => d.total > 0)
                .reduce((sum, d) => sum + (d.unlocked / d.total) * 100, 0) / gamesWithData
            )
          : 0,
    };
  }, [cache]);

  // Unlocked achievement counts per source
  const bySource = useMemo(() => {
    const counts: Record<AchievementSource, number> = {
      steam: 0,
      retro: 0,
      manual: 0,
      gog: 0,
      epic: 0,
    };
    for (const data of Object.values(cache.games)) {
      const src = sourceOfPayload(data);
      for (const a of data.achievements) {
        if (a.achieved) counts[src]++;
      }
    }
    return counts;
  }, [cache]);

  const bySourceTotal = ACHIEVEMENT_SOURCES.reduce((sum, s) => sum + bySource[s], 0);

  // Rarity distribution across all achievements (total and unlocked)
  const { rarityTotal, rarityUnlocked } = useMemo(() => {
    const totalMap: Record<AchievementRarity, number> = {
      common: 0,
      uncommon: 0,
      rare: 0,
      ultra_rare: 0,
    };
    const unlockedMap: Record<AchievementRarity, number> = {
      common: 0,
      uncommon: 0,
      rare: 0,
      ultra_rare: 0,
    };

    for (const data of Object.values(cache.games)) {
      for (const a of data.achievements ?? []) {
        const tier = getAchievementRarity(a.percent);
        totalMap[tier]++;
        if (a.achieved) {
          unlockedMap[tier]++;
        }
      }
    }
    return { rarityTotal: totalMap, rarityUnlocked: unlockedMap };
  }, [cache]);

  // Monthly unlock activity
  const monthlyActivity = useMemo(() => {
    return getMonthlyUnlockActivity(cache.games, 6);
  }, [cache]);

  // Almost Done games (>= 70% and < 100%)
  const almostDoneGames = useMemo<AlmostDoneGameItem[]>(() => {
    const list: AlmostDoneGameItem[] = [];
    for (const g of games) {
      const data = cache.games[g.id];
      if (data && data.total > 0) {
        const pct = Math.round((data.unlocked / data.total) * 100);
        if (pct >= 70 && pct < 100) {
          list.push({
            game: g,
            total: data.total,
            unlocked: data.unlocked,
            pct,
            remaining: data.total - data.unlocked,
            source: sourceOfPayload(data),
          });
        }
      }
    }
    return list.sort((a, b) => b.pct - a.pct).slice(0, 8);
  }, [games, cache]);

  // Recent achievements (last 16 across all games)
  const recentAchievements = useMemo<RecentAchievementFeedItem[]>(() => {
    const gameMap = new Map<string, (typeof games)[0]>();
    for (const g of games) gameMap.set(g.id, g);

    const all: RecentAchievementFeedItem[] = [];
    for (const [gameId, data] of Object.entries(cache.games)) {
      const game = gameMap.get(gameId);
      for (const a of data.achievements ?? []) {
        if (a.achieved && a.unlockTime > 0) {
          all.push({
            achievement: a,
            gameName: game?.name ?? t("splash.unknown"),
            gameId,
            gameCover: game?.coverArtUrl,
          });
        }
      }
    }
    return all
      .sort((a, b) => b.achievement.unlockTime - a.achievement.unlockTime)
      .slice(0, 16);
  }, [cache, games, t]);

  /**
   * Sync All — Steam + non-Steam sources in parallel lanes
   */
  async function handleSyncAll() {
    const steamGames = games.filter((g) => g.steamAppId && g.platform === "Steam");
    const retroGames = games.filter((g) => g.emulatorId || g.romPath);
    const manualGames = games.filter((g) =>
      (links[g.id] ?? []).some((l) => l.source === "manual")
    );
    const gogIds = games.filter((g) => g.gogGameId).map((g) => g.id);
    const epicIds = games.filter((g) => g.epicNamespace).map((g) => g.id);

    let total = 0;
    let failed = 0;
    const run = async (label: string, fn: () => Promise<unknown>) => {
      total++;
      try {
        await fn();
      } catch (err) {
        failed++;
        console.warn(`[AchievementsPage] ${label} sync failed:`, err);
      }
    };

    setBulkSyncing(true);
    try {
      if (steamGames.length > 0) {
        await run("Steam", () => syncAllAchievements(games));
      }
      for (const g of retroGames) {
        await run(`Retro (${g.name})`, () => syncRetroAchievements(g.id));
      }
      if (manualGames.length > 0) {
        await run("Manual", () =>
          Promise.all(manualGames.map((g) => syncManualAchievements(g.id)))
        );
      }
      if (gogIds.length > 0) {
        await run("GOG", () => syncGogAchievements(gogIds));
      }
      if (epicIds.length > 0) {
        await run("Epic", () => syncEpicAchievements(epicIds));
      }
    } finally {
      setBulkSyncing(false);
    }

    if (total === 0 || failed === 0) {
      showToast(t("achievements.allSynced"), "success");
    } else if (failed === total) {
      showToast(t("achievements.syncFailed", { error: "" }), "error");
    } else {
      showToast(t("achievementsPage.syncPartial", { failed }), "warning");
    }
  }

  const syncing = isSyncing || bulkSyncing;

  return (
    <div className="achievements-page page">
      {/* Page header */}
      <PageHeader
        eyebrow={t("achievementsPage.yourProgress")}
        title={t("achievements.title")}
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
            <circle cx="12" cy="8" r="6" />
            <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
          </svg>
        }
        actions={
          <button
            className="achievements-sync-btn"
            onClick={handleSyncAll}
            disabled={syncing}
          >
            {syncing ? (
              <>
                <span className="achievements-spinner" />
                {syncProgress
                  ? t("achievementsPage.syncingProgress", { current: syncProgress.current, total: syncProgress.total })
                  : t("achievements.syncing")}
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                {t("achievementsPage.syncAll")}
              </>
            )}
          </button>
        }
      />

      {/* Hero Summary & Gamerscore Panel */}
      <AchievementsSummaryHero gamerscore={gamerscore} stats={stats} />

      {/* Visual Analytics Grid: Rarity Distribution + Monthly Activity + Source Breakdown + Shelves */}
      <div className="ui-complete-only">
        {stats.totalAchievements > 0 && (
          <div className="achievements-analytics-grid">
            <AchievementsRarityChart
              rarityTotal={rarityTotal}
              rarityUnlocked={rarityUnlocked}
              totalAchievements={stats.totalAchievements}
            />
            <AchievementsActivityChart activity={monthlyActivity} />
          </div>
        )}

        {/* Source Platform Breakdown */}
        {bySourceTotal > 0 && (
          <div className="ach-card-section ach-source-breakdown-section">
            <div className="ach-card-section-head">
              <h3 className="achievements-section-title">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
                {t("achievementsPage.achievementsBySource")}
              </h3>
            </div>
            <div className="achievements-bysource-bar-wrap">
              <div className="achievements-bysource-bar">
                {ACHIEVEMENT_SOURCES.map((src) => {
                  const count = bySource[src];
                  if (count === 0) return null;
                  return (
                    <div
                      key={src}
                      className="ach-bysource-segment"
                      data-source={src}
                      style={{ width: `${(count / bySourceTotal) * 100}%` }}
                      title={`${t(`achievements.source.${src}`)}: ${count} (${Math.round((count / bySourceTotal) * 100)}%)`}
                    />
                  );
                })}
              </div>
              <div className="achievements-bysource-legend">
                {ACHIEVEMENT_SOURCES.map((src) => (
                  <button
                    type="button"
                    key={src}
                    className={`ach-bysource-item ${sourceFilter === src ? "active" : ""}`}
                    data-source={src}
                    onClick={() => setSourceFilter(sourceFilter === src ? "all" : src)}
                  >
                    {t(`achievements.source.${src}`)} ({bySource[src]})
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Almost Done / Next Up Shelf */}
        {almostDoneGames.length > 0 && (
          <AchievementsAlmostDoneShelf games={almostDoneGames} />
        )}

        {/* Recent Unlocks Timeline Feed */}
        {recentAchievements.length > 0 && (
          <AchievementsRecentFeed recentAchievements={recentAchievements} />
        )}
      </div>

      {/* Games List / Leaderboard Section */}
      <div className="achievements-games-section">
        <div className="ach-section-header-row">
          <div className="ach-section-title-group">
            <h3 className="achievements-section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
              </svg>
              {t("achievementsPage.games")}
            </h3>
            <span className="ach-section-count">
              ({gamesWithAchievements.length})
            </span>
          </div>

          {/* View Mode Switcher */}
          <div className="ach-view-mode-toggle" role="group" aria-label="View mode">
            <button
              type="button"
              className={`ach-view-btn ${viewMode === "grid" ? "active" : ""}`}
              onClick={() => setViewMode("grid")}
              title={t("achievementsPage.viewGrid")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
            </button>
            <button
              type="button"
              className={`ach-view-btn ${viewMode === "list" ? "active" : ""}`}
              onClick={() => setViewMode("list")}
              title={t("achievementsPage.viewList")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Toolbar: Filters, Search, Sort */}
        <div className="achievements-toolbar">
          {/* Status Filter Dropdown */}
          <div className="achievements-sort">
            <label className="achievements-sort-label">{t("library.filter.status")}</label>
            <select
              value={completionFilter}
              onChange={(e) => setCompletionFilter(e.target.value as CompletionFilter)}
              className="achievements-sort-select"
              aria-label={t("library.filter.status")}
            >
              <option value="all">{t("common.all")}</option>
              <option value="perfect">{t("achievementsPage.filterPerfect")}</option>
              <option value="in_progress">{t("achievementsPage.filterInProgress")}</option>
              <option value="almost_done">{t("achievementsPage.filterAlmostDone")}</option>
              <option value="not_started">{t("achievementsPage.filterNotStarted")}</option>
            </select>
          </div>

          {/* Source Filter Dropdown */}
          <div className="achievements-sort">
            <label className="achievements-sort-label">{t("library.filter.source")}</label>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
              className="achievements-sort-select"
              aria-label={t("library.filter.source")}
            >
              <option value="all">{t("achievements.source.all")}</option>
              {ACHIEVEMENT_SOURCES.map((src) => (
                <option key={src} value={src}>
                  {t(`achievements.source.${src}`)}
                </option>
              ))}
            </select>
          </div>

          {/* Search bar */}
          <div className="achievements-search-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              className="achievements-search-input"
              placeholder={t("achievements.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Sort dropdown */}
          <div className="achievements-sort">
            <label className="achievements-sort-label">{t("achievementsPage.sort")}</label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="achievements-sort-select"
            >
              <option value="completion">{t("achievementsPage.completionPct")}</option>
              <option value="gamerscore">{t("achievementsPage.sortGamerscore")}</option>
              <option value="name">{t("achievementsPage.name")}</option>
              <option value="total">{t("achievementsPage.totalAchievements")}</option>
              <option value="recent">{t("achievementsPage.recentlySynced")}</option>
            </select>
          </div>
        </div>

        {/* Games display: Grid or List */}
        {viewMode === "grid" ? (
          <div className="ach-games-cards-grid">
            {gamesWithAchievements.map((item) => (
              <GameAchievementCard
                key={item.game.id}
                game={item.game}
                total={item.total}
                unlocked={item.unlocked}
                pct={item.pct}
                pointsEarned={item.pointsEarned}
                pointsTotal={item.pointsTotal}
                lastSynced={item.lastSynced}
                source={item.source}
                rarity={item.rarity}
                onClick={() => navigate(`/library/${item.game.id}`)}
              />
            ))}
          </div>
        ) : (
          <div className="achievements-games-list">
            {gamesWithAchievements.map((item) => (
              <GameAchievementRow
                key={item.game.id}
                game={item.game}
                total={item.total}
                unlocked={item.unlocked}
                pct={item.pct}
                pointsEarned={item.pointsEarned}
                pointsTotal={item.pointsTotal}
                lastSynced={item.lastSynced}
                source={item.source}
                rarity={item.rarity}
                onClick={() => navigate(`/library/${item.game.id}`)}
              />
            ))}
          </div>
        )}

        {gamesWithAchievements.length === 0 && (
          <div className="achievements-no-results">
            <div className="ach-no-results-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="40" height="40">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <h4>{searchQuery ? t("achievements.noMatchSearch") : t("achievementsPage.noGames")}</h4>
            {searchQuery && (
              <button
                type="button"
                className="achievements-btn achievements-btn--secondary"
                onClick={() => setSearchQuery("")}
              >
                {t("common.clearSearch")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
