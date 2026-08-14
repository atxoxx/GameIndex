import { useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/plugin-dialog";
import type { Game, PlayStatus } from "../../types/game";
import { parsePlayTime, formatPlayTime, gameNameFromPath } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import type { LibraryStatus } from "../../hooks/useLibraryFilters";

interface LibraryHeroProps {
  games: Game[];
  activeStatus?: LibraryStatus;
  activePlayStatus?: PlayStatus | "all";
  onFilterStatus?: (status: LibraryStatus) => void;
  onFilterPlayStatus?: (playStatus: PlayStatus | "all") => void;
  onCardClick?: (game: Game) => void;
}

function formatTimeAgo(timestamp: number, t: (key: string, vars?: Record<string, unknown>) => string): string {
  if (!timestamp) return t("lib.rail.continue.never");
  const diffMs = Date.now() - timestamp;
  if (diffMs < 0) return t("lib.rail.continue.justNow");
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return t("lib.rail.continue.underHourAgo");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("lib.rail.continue.hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("lib.rail.continue.daysAgo", { n: days });
  const weeks = Math.floor(days / 7);
  return t("lib.rail.continue.weeksAgo", { n: weeks });
}

export default function LibraryHero({
  games,
  activeStatus = "all",
  activePlayStatus = "all",
  onFilterStatus,
  onFilterPlayStatus,
  onCardClick,
}: LibraryHeroProps) {
  const navigate = useNavigate();
  const { importLocalGames, launchGame, runningGameIds } = useGames();
  const { showToast } = useToast();
  const { t } = useLanguage();

  const greetingKey = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 5) return "lib.hero.greeting.upLate";
    if (hour < 12) return "lib.hero.greeting.morning";
    if (hour < 18) return "lib.hero.greeting.afternoon";
    return "lib.hero.greeting.evening";
  }, []);

  const stats = useMemo(() => {
    const total = games.length;
    const installed = games.filter((g) => g.installed).length;
    const installedPct = total > 0 ? Math.round((installed / total) * 100) : 0;
    const totalMinutes = games.reduce((sum, g) => sum + parsePlayTime(g.playTime), 0);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentlyAdded = games.filter((g) => (g.addedAt ?? 0) >= sevenDaysAgo).length;
    const playingCount = games.filter((g) => g.playStatus === "playing").length;
    const completedCount = games.filter((g) => g.playStatus === "completed").length;
    return {
      total,
      installed,
      installedPct,
      totalPlayTime: formatPlayTime(totalMinutes),
      recentlyAdded,
      playingCount,
      completedCount,
    };
  }, [games]);

  // Find most recently played game for "Jump Back In" spotlight
  const mostRecentGame = useMemo(() => {
    if (games.length === 0) return null;
    const played = games
      .filter((g) => (g.lastPlayed ?? 0) > 0)
      .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
    return played[0] || null;
  }, [games]);

  // Pick up to 8 covers for the backdrop collage
  const collage = useMemo(
    () =>
      games
        .filter((g) => g.coverArtUrl)
        .slice(0, 8)
        .map((g) => g.coverArtUrl as string),
    [games]
  );

  const handleQuickImport = useCallback(async () => {
    try {
      const filePath = await open({
        multiple: false,
        directory: false,
        title: t("library.importDialogTitle"),
        filters: [{ name: "Executable", extensions: ["exe"] }],
      });
      if (filePath && typeof filePath === "string") {
        await importLocalGames([{ path: filePath, metadata: null }]);
        showToast(t("library.importedName", { name: gameNameFromPath(filePath) }), "success");
      }
    } catch (err) {
      console.error("Quick import failed:", err);
      showToast(t("library.importFailed", { error: String(err) }), "error");
    }
  }, [importLocalGames, showToast, t]);

  const handleBrowseStore = useCallback(() => {
    navigate("/store");
  }, [navigate]);

  const handleLaunchRecent = (e: React.MouseEvent, game: Game) => {
    e.stopPropagation();
    launchGame(game);
  };

  const isRecentRunning = mostRecentGame ? runningGameIds.includes(mostRecentGame.id) : false;

  return (
    <section className="lib-hero" aria-label={t("library.overviewAria")}>
      <div className="lib-hero-aurora" aria-hidden="true" />
      {collage.length > 0 && (
        <div className="lib-hero-collage" aria-hidden="true">
          {collage.map((src, i) => (
            <img key={i} src={src} alt="" loading="lazy" />
          ))}
        </div>
      )}
      <div className="lib-hero-veil" aria-hidden="true" />

      <div className="lib-hero-top-row">
        {/* Left Welcome & Greeting */}
        <div className="lib-hero-text">
          <div className="lib-hero-eyebrow" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <span>{t("nav.library")}</span>
          </div>

          <h1 className="lib-hero-greeting">
            {t(greetingKey)}
            <span className="lib-hero-greeting-dot" aria-hidden="true">
              .
            </span>
          </h1>

          <p className="lib-hero-subtitle">
            {stats.total === 0
              ? t("lib.hero.subtitle.empty")
              : stats.recentlyAdded > 0
                ? t("lib.hero.subtitle.body", {
                    time: stats.totalPlayTime,
                    count: stats.total,
                    added: stats.recentlyAdded,
                  })
                : t("lib.hero.subtitle.noAdded", {
                    time: stats.totalPlayTime,
                    count: stats.total,
                    plural: stats.total === 1 ? "" : "s",
                  })}
          </p>

          <div className="lib-hero-actions">
            <button type="button" className="lib-hero-btn lib-hero-btn--primary" onClick={handleQuickImport}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>{t("lib.hero.importGames")}</span>
            </button>
            <button type="button" className="lib-hero-btn lib-hero-btn--ghost" onClick={handleBrowseStore}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                <polyline points="17 6 23 6 23 12" />
              </svg>
              <span>{t("lib.hero.browseStore")}</span>
            </button>
          </div>
        </div>

        {/* Right "Jump Back In" Spotlight Card (if a recent game exists) */}
        {mostRecentGame && (
          <div
            className="lib-hero-spotlight"
            onClick={() => onCardClick?.(mostRecentGame)}
            role="button"
            tabIndex={0}
            aria-label={`${t("library.hero.jumpBackIn")}: ${mostRecentGame.name}`}
          >
            <div className="lib-hero-spotlight-backdrop" aria-hidden="true">
              {mostRecentGame.coverArtUrl && (
                <img src={mostRecentGame.coverArtUrl} alt="" loading="lazy" />
              )}
              <div className="lib-hero-spotlight-gradient" />
            </div>

            <div className="lib-hero-spotlight-content">
              <div className="lib-hero-spotlight-tag">
                <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
                <span>{t("library.hero.jumpBackIn")}</span>
              </div>

              <h3 className="lib-hero-spotlight-name" title={mostRecentGame.name}>
                {mostRecentGame.name}
              </h3>

              <div className="lib-hero-spotlight-meta">
                <span className="lib-hero-spotlight-time">
                  {formatTimeAgo(mostRecentGame.lastPlayed ?? 0, t)}
                </span>
                <span className="lib-hero-spotlight-sep">·</span>
                <span className="lib-hero-spotlight-playtime">{mostRecentGame.playTime}</span>
              </div>

              <div className="lib-hero-spotlight-actions">
                <button
                  type="button"
                  className={`lib-hero-spotlight-play${isRecentRunning ? " running" : ""}`}
                  onClick={(e) => handleLaunchRecent(e, mostRecentGame)}
                  title={isRecentRunning ? t("game.running") : t("game.play")}
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" aria-hidden="true">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  <span>{isRecentRunning ? t("game.running") : t("library.hero.resumePlaying")}</span>
                </button>
              </div>
            </div>

            {mostRecentGame.coverArtUrl && (
              <div className="lib-hero-spotlight-poster">
                <img src={mostRecentGame.coverArtUrl} alt={mostRecentGame.name} loading="lazy" />
              </div>
            )}
          </div>
        )}
      </div>

      {/* KPI Stats Tiles */}
      <div className="lib-hero-stats">
        <StatTile
          value={stats.total}
          label={t("lib.hero.stat.total")}
          accent="var(--color-accent)"
          delayMs={0}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          }
        />
        <StatTile
          value={stats.installed}
          label={t("lib.hero.stat.installed")}
          subtext={stats.total > 0 ? t("lib.hero.stat.pctOfLibrary", { count: stats.installedPct }) : t("lib.hero.stat.installedPct")}
          accent="var(--color-success)"
          delayMs={70}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          }
        />
        <StatTile
          value={stats.totalPlayTime}
          label={t("lib.hero.stat.playtime")}
          accent="var(--color-info)"
          delayMs={140}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          }
        />
        <StatTile
          value={stats.recentlyAdded}
          label={t("lib.hero.stat.addedWeek")}
          subtext={stats.recentlyAdded === 1 ? t("lib.hero.stat.addedWeekSub") : undefined}
          accent="var(--color-warning)"
          delayMs={210}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          }
        />
      </div>

      {/* Quick Filter Bar */}
      {games.length > 0 && onFilterStatus && onFilterPlayStatus && (
        <div className="lib-hero-quick-filters" role="tablist" aria-label={t("library.hero.quickFilters")}>
          <button
            type="button"
            role="tab"
            aria-selected={activeStatus === "all" && activePlayStatus === "all"}
            className={`lib-hero-filter-pill${activeStatus === "all" && activePlayStatus === "all" ? " active" : ""}`}
            onClick={() => {
              onFilterStatus("all");
              onFilterPlayStatus("all");
            }}
          >
            {t("library.hero.filterAll")}
            <span className="lib-hero-filter-count">{stats.total}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeStatus === "installed"}
            className={`lib-hero-filter-pill${activeStatus === "installed" ? " active" : ""}`}
            onClick={() => {
              onFilterStatus(activeStatus === "installed" ? "all" : "installed");
              onFilterPlayStatus("all");
            }}
          >
            <span className="lib-hero-filter-dot lib-hero-filter-dot--installed" />
            {t("library.hero.filterInstalled")}
            <span className="lib-hero-filter-count">{stats.installed}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activePlayStatus === "playing"}
            className={`lib-hero-filter-pill${activePlayStatus === "playing" ? " active" : ""}`}
            onClick={() => {
              onFilterPlayStatus(activePlayStatus === "playing" ? "all" : "playing");
              onFilterStatus("all");
            }}
          >
            <span className="lib-hero-filter-dot lib-hero-filter-dot--playing" />
            {t("library.hero.filterPlaying")}
            {stats.playingCount > 0 && <span className="lib-hero-filter-count">{stats.playingCount}</span>}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activePlayStatus === "completed"}
            className={`lib-hero-filter-pill${activePlayStatus === "completed" ? " active" : ""}`}
            onClick={() => {
              onFilterPlayStatus(activePlayStatus === "completed" ? "all" : "completed");
              onFilterStatus("all");
            }}
          >
            <span className="lib-hero-filter-dot lib-hero-filter-dot--completed" />
            {t("library.hero.filterCompleted")}
            {stats.completedCount > 0 && <span className="lib-hero-filter-count">{stats.completedCount}</span>}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activePlayStatus === "backlog"}
            className={`lib-hero-filter-pill${activePlayStatus === "backlog" ? " active" : ""}`}
            onClick={() => {
              onFilterPlayStatus(activePlayStatus === "backlog" ? "all" : "backlog");
              onFilterStatus("all");
            }}
          >
            <span className="lib-hero-filter-dot lib-hero-filter-dot--backlog" />
            {t("library.hero.filterBacklog")}
          </button>
        </div>
      )}
    </section>
  );
}

interface StatTileProps {
  value: string | number;
  label: string;
  subtext?: string;
  accent: string;
  delayMs: number;
  icon: React.ReactNode;
}

function StatTile({ value, label, subtext, accent, delayMs, icon }: StatTileProps) {
  return (
    <div
      className="lib-stat"
      style={{ animationDelay: `${delayMs}ms`, ["--stat-accent" as string]: accent }}
    >
      <div className="lib-stat-icon" aria-hidden="true">
        {icon}
      </div>
      <div className="lib-stat-body">
        <div className="lib-stat-value" title={String(value)}>{value}</div>
        <div className="lib-stat-label">{label}</div>
        {subtext && <div className="lib-stat-subtext">{subtext}</div>}
      </div>
    </div>
  );
}
