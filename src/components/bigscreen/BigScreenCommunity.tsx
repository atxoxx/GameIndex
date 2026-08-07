import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";
import { useActivity } from "../../context/ActivityContext";
import { useAchievements } from "../../context/AchievementContext";
import { useGames } from "../../context/GameContext";
import { useFocusable } from "../../hooks/useFocusable";

function formatHours(totalMinutes: number): string {
  if (!totalMinutes || totalMinutes <= 0) return "0m";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h >= 1000) return `${(h / 1000).toFixed(1)}k h`;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function BigScreenCommunity() {
  const { t } = useLanguage();
  const { getAllStats, sessions } = useActivity();
  const { cache } = useAchievements();
  const { games } = useGames();
  const navigate = useNavigate();

  const stats = useMemo(() => getAllStats(), [getAllStats]);

  // Count total achievements across all cached games
  const achievementCounts = useMemo(() => {
    let total = 0;
    let unlocked = 0;
    for (const gid of Object.keys(cache.games)) {
      const g = cache.games[gid];
      total += g.total;
      unlocked += g.unlocked;
    }
    return { total, unlocked };
  }, [cache]);

  // Total achievements completion %
  const achievementPct = achievementCounts.total > 0
    ? Math.round((achievementCounts.unlocked / achievementCounts.total) * 100)
    : 0;

  // Ranked top games (most played)
  const topGames = useMemo(() => {
    const maxMin = stats.topGames.length > 0 ? stats.topGames[0].minutes : 0;
    return stats.topGames.map((g) => {
      const libGame = games.find((lg) => lg.id === g.gameId);
      return {
        ...g,
        coverArtUrl: libGame?.coverArtUrl,
        platform: libGame?.platform,
        pct: maxMin > 0 ? Math.round((g.minutes / maxMin) * 100) : 0,
      };
    });
  }, [stats.topGames, games]);

  return (
    <div className="bigscreen-community-page">
      <h2>{t("bigscreen.community.gamerStats")}</h2>

      {/* KPI Cards Row — informational tiles (not focusable) */}
      <div className="bigscreen-gamepage-2col bigscreen-kpi-grid" data-cols="4">
        <div className="bigscreen-kpi-card">
          <span className="bigscreen-kpi-label">{t("bigscreen.community.totalPlaytime")}</span>
          <span className="bigscreen-kpi-value bigscreen-kpi-value--accent">{formatHours(stats.totalPlayTimeMin)}</span>
          <span className="bigscreen-kpi-sub">{t("bigscreen.community.acrossLaunches")}</span>
        </div>

        <div className="bigscreen-kpi-card">
          <span className="bigscreen-kpi-label">{t("bigscreen.community.achievements")}</span>
          <span className="bigscreen-kpi-value bigscreen-kpi-value--success">{achievementCounts.unlocked} / {achievementCounts.total}</span>
          <span className="bigscreen-kpi-sub">{achievementPct}{t("bigscreen.community.pctUnlocked")}</span>
        </div>

        <div className="bigscreen-kpi-card">
          <span className="bigscreen-kpi-label">{t("bigscreen.community.librarySize")}</span>
          <span className="bigscreen-kpi-value">{games.length} {t("bigscreen.friends.games")}</span>
          <span className="bigscreen-kpi-sub">{t("bigscreen.community.importedFrom")}</span>
        </div>

        <div className="bigscreen-kpi-card">
          <span className="bigscreen-kpi-label">{t("bigscreen.community.launchActivity")}</span>
          <span className="bigscreen-kpi-value bigscreen-kpi-value--warning">{sessions.length} {t("bigscreen.community.launches")}</span>
          <span className="bigscreen-kpi-sub">{t("bigscreen.community.sessionsTracked")}</span>
        </div>
      </div>

      {/* Main Grid: Left side Top Played, Right side breakdowns */}
      <div className="bigscreen-gamepage-2col bigscreen-community-main-grid" data-cols="2">

        {/* Top Played Games */}
        <div className="bigscreen-panel-card">
          <h3>{t("bigscreen.community.mostPlayed")}</h3>
          {topGames.length === 0 ? (
            <p className="bigscreen-kpi-sub" style={{ fontSize: "0.8125rem" }}>{t("bigscreen.community.noPlaytime")}</p>
          ) : (
            <div className="bigscreen-sessions-list" style={{ gap: "1rem" }}>
              {topGames.slice(0, 5).map((g) => (
                <TopGameRow
                  key={g.gameId}
                  game={g}
                  onOpen={() => navigate(`/library/${g.gameId}`)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Breakdown by Genre and Platform */}
        <div className="bigscreen-sessions-list" style={{ gap: "1.5rem", width: "100%" }}>
          <div className="bigscreen-panel-card">
            <h3>{t("bigscreen.community.playtimeByGenre")}</h3>
            {stats.genreBreakdown.length === 0 ? (
              <p className="bigscreen-kpi-sub" style={{ fontSize: "0.8125rem" }}>{t("bigscreen.community.noGenres")}</p>
            ) : (
              <div className="bigscreen-breakdown-list">
                {stats.genreBreakdown.slice(0, 5).map((gen) => (
                  <div key={gen.genre} className="bigscreen-breakdown-row">
                    <div className="bigscreen-breakdown-header">
                      <span className="bigscreen-breakdown-name">{gen.genre}</span>
                      <span className="bigscreen-breakdown-value">{formatHours(gen.minutes)}</span>
                    </div>
                    <div className="bigscreen-breakdown-track">
                      <div
                        className="bigscreen-breakdown-fill bigscreen-breakdown-fill--accent"
                        style={{ width: `${Math.min(100, (gen.minutes / stats.totalPlayTimeMin) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bigscreen-panel-card">
            <h3>{t("bigscreen.community.playtimeByPlatform")}</h3>
            {stats.platformBreakdown.length === 0 ? (
              <p className="bigscreen-kpi-sub" style={{ fontSize: "0.8125rem" }}>{t("bigscreen.community.noPlatforms")}</p>
            ) : (
              <div className="bigscreen-breakdown-list">
                {stats.platformBreakdown.slice(0, 5).map((plat) => (
                  <div key={plat.platform} className="bigscreen-breakdown-row">
                    <div className="bigscreen-breakdown-header">
                      <span className="bigscreen-breakdown-name">{plat.platform}</span>
                      <span className="bigscreen-breakdown-value">{formatHours(plat.minutes)}</span>
                    </div>
                    <div className="bigscreen-breakdown-track">
                      <div
                        className="bigscreen-breakdown-fill bigscreen-breakdown-fill--warning"
                        style={{ width: `${Math.min(100, (plat.minutes / stats.totalPlayTimeMin) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// ─── Top Played Game Row ────────────────────────────────────────────
// Focusable: controller A opens the game's library hub page.

function TopGameRow({
  game,
  onOpen,
}: {
  game: {
    gameId: string;
    gameName: string;
    minutes: number;
    sessions: number;
    coverArtUrl?: string;
  };
  onOpen: () => void;
}) {
  const { t } = useLanguage();
  const focusProps = useFocusable(onOpen);

  return (
    <div
      {...focusProps}
      className="bigscreen-topgame-row"
    >
      <div className="bigscreen-topgame-cover">
        {game.coverArtUrl ? (
          <img src={game.coverArtUrl} alt="" />
        ) : (
          <div className="bigscreen-topgame-cover-fallback">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 3h12v18H6z" />
              <path d="M9 7h6M9 11h6M9 15h4" />
            </svg>
          </div>
        )}
      </div>
      <div className="bigscreen-topgame-id">
        <div className="bigscreen-topgame-name">{game.gameName}</div>
        <div className="bigscreen-topgame-meta">
          {t("bigscreen.community.gameLaunches", { time: formatHours(game.minutes), count: game.sessions })}
        </div>
      </div>
    </div>
  );
}
