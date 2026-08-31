import { useMemo, memo } from "react";
import { useNavigate } from "react-router-dom";
import { useGames } from "../../context/GameContext";
import { useActivity } from "../../context/ActivityContext";
import { useAchievements } from "../../context/AchievementContext";
import { useLanguage } from "../../context/LanguageContext";
import { formatPlayTime } from "../../types/game";
import { formatBytesShort } from "../../types/download";

function HomeQuickStatsBase() {
  const navigate = useNavigate();
  const { games } = useGames();
  const { sessions } = useActivity();
  const { cache: achCache } = useAchievements();
  const { t } = useLanguage();

  const stats = useMemo(() => {
    // 1. Library installed & total
    const totalGames = games.length;
    const installedGames = games.filter((g) => g.installed !== false).length;

    // 2. Weekly playtime
    const weekCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weekSessions = sessions.filter((s) => {
      const ms = new Date(s.date).getTime();
      return ms >= weekCutoff && ms <= Date.now();
    });
    const weekMinutes = weekSessions.reduce((acc, s) => acc + s.durationMin, 0);
    const weekSessionCount = weekSessions.length;

    // 3. Achievements
    let unlockedAch = 0;
    let totalAch = 0;
    for (const data of Object.values(achCache.games)) {
      if (!data?.achievements) continue;
      for (const a of data.achievements) {
        totalAch++;
        if (a.achieved && a.unlockTime > 0) {
          unlockedAch++;
        }
      }
    }
    const achRate = totalAch > 0 ? Math.round((unlockedAch / totalAch) * 100) : 0;

    // 4. Storage
    let totalBytes = 0;
    let sizedGamesCount = 0;
    for (const g of games) {
      if (g.sizeBytes && g.sizeBytes > 0) {
        totalBytes += g.sizeBytes;
        sizedGamesCount++;
      }
      if (g.modsSizeBytes && g.modsSizeBytes > 0) {
        totalBytes += g.modsSizeBytes;
      }
    }

    return {
      totalGames,
      installedGames,
      weekMinutes,
      weekSessionCount,
      unlockedAch,
      totalAch,
      achRate,
      totalBytes,
      sizedGamesCount,
    };
  }, [games, sessions, achCache]);

  if (stats.totalGames === 0) return null;

  return (
    <section className="home-quick-stats" aria-label={t("home.stats.library")}>
      <div
        className="home-stat-tile"
        role="button"
        tabIndex={0}
        onClick={() => navigate("/library")}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && navigate("/library")}
        title={t("nav.library")}
      >
        <div className="home-stat-tile__icon home-stat-tile__icon--library" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="18" x2="12" y2="21" />
          </svg>
        </div>
        <div className="home-stat-tile__content">
          <span className="home-stat-tile__value">{stats.totalGames}</span>
          <span className="home-stat-tile__label">{t("home.stats.library")}</span>
          <span className="home-stat-tile__sub">
            {t("home.stats.installed", { count: stats.installedGames })}
          </span>
        </div>
      </div>

      <div
        className="home-stat-tile"
        role="button"
        tabIndex={0}
        onClick={() => navigate("/activity")}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && navigate("/activity")}
        title={t("home.activity.title")}
      >
        <div className="home-stat-tile__icon home-stat-tile__icon--playtime" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>
        <div className="home-stat-tile__content">
          <span className="home-stat-tile__value">{formatPlayTime(stats.weekMinutes)}</span>
          <span className="home-stat-tile__label">{t("home.stats.weekPlaytime")}</span>
          <span className="home-stat-tile__sub">
            {t("home.stats.sessions", { count: stats.weekSessionCount })}
          </span>
        </div>
      </div>

      <div
        className="home-stat-tile"
        role="button"
        tabIndex={0}
        onClick={() => navigate("/achievements")}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && navigate("/achievements")}
        title={t("home.stats.achievements")}
      >
        <div className="home-stat-tile__icon home-stat-tile__icon--achievements" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="7" />
            <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
          </svg>
        </div>
        <div className="home-stat-tile__content">
          <span className="home-stat-tile__value">
            {stats.totalAch > 0 ? `${stats.achRate}%` : `${stats.unlockedAch}`}
          </span>
          <span className="home-stat-tile__label">{t("home.stats.achievements")}</span>
          <span className="home-stat-tile__sub">
            {t("home.stats.unlocked", { count: stats.unlockedAch })}
          </span>
        </div>
      </div>

      <div
        className="home-stat-tile"
        role="button"
        tabIndex={0}
        onClick={() => navigate("/storage")}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && navigate("/storage")}
        title={t("home.stats.storage")}
      >
        <div className="home-stat-tile__icon home-stat-tile__icon--storage" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <ellipse cx="12" cy="5" rx="9" ry="3" />
            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          </svg>
        </div>
        <div className="home-stat-tile__content">
          <span className="home-stat-tile__value">
            {stats.totalBytes > 0 ? formatBytesShort(stats.totalBytes) : "0 B"}
          </span>
          <span className="home-stat-tile__label">{t("home.stats.storage")}</span>
          <span className="home-stat-tile__sub">
            {t("home.stats.sized", { count: stats.sizedGamesCount })}
          </span>
        </div>
      </div>
    </section>
  );
}

export default memo(HomeQuickStatsBase);
