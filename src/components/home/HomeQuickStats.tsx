import { useMemo, memo } from "react";
import { useNavigate } from "react-router-dom";
import { Library, Clock, Trophy, HardDrive } from "lucide-react";
import { useGames } from "../../context/GameContext";
import { useActivity } from "../../context/ActivityContext";
import { useAchievements } from "../../context/AchievementContext";
import { useLanguage } from "../../context/LanguageContext";
import { formatPlayTime } from "../../types/game";
import { formatBytesShort } from "../../types/download";
import { StatBand, type StatBandItem } from "../ui/StatBand";

function HomeQuickStatsBase() {
  const navigate = useNavigate();
  const { games } = useGames();
  const { sessions } = useActivity();
  const { stats: achStats } = useAchievements();
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

    // 3. Achievements — library-wide counts computed in the backend.
    const unlockedAch = achStats?.unlocked ?? 0;
    const totalAch = achStats?.total ?? 0;
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
  }, [games, sessions, achStats]);

  const items = useMemo<StatBandItem[]>(() => {
    if (stats.totalGames === 0) return [];
    return [
      {
        id: "library",
        label: t("home.stats.library"),
        value: stats.totalGames,
        detail: t("home.stats.installed", { count: stats.installedGames }),
        icon: <Library size={14} />,
        onClick: () => navigate("/library"),
      },
      {
        id: "playtime",
        label: t("home.stats.weekPlaytime"),
        value: formatPlayTime(stats.weekMinutes),
        detail: t("home.stats.sessions", { count: stats.weekSessionCount }),
        icon: <Clock size={14} />,
        tone: "info",
        onClick: () => navigate("/activity"),
      },
      {
        id: "achievements",
        label: t("home.stats.achievements"),
        value: stats.totalAch > 0 ? `${stats.achRate}%` : `${stats.unlockedAch}`,
        detail: t("home.stats.unlocked", { count: stats.unlockedAch }),
        icon: <Trophy size={14} />,
        tone: "accent",
        onClick: () => navigate("/achievements"),
      },
      {
        id: "storage",
        label: t("home.stats.storage"),
        value: stats.totalBytes > 0 ? formatBytesShort(stats.totalBytes) : "0 B",
        detail: t("home.stats.sized", { count: stats.sizedGamesCount }),
        icon: <HardDrive size={14} />,
        onClick: () => navigate("/storage"),
      },
    ];
  }, [stats, navigate, t]);

  if (items.length === 0) return null;

  return (
    <StatBand
      items={items}
      ariaLabel={t("home.stats.library")}
      className="home-quick-stats"
    />
  );
}

export default memo(HomeQuickStatsBase);
