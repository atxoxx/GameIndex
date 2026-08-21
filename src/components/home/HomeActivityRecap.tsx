import { useMemo } from "react";
import { useActivity } from "../../context/ActivityContext";
import { useLanguage } from "../../context/LanguageContext";
import { formatPlayTime } from "../../types/game";
import { WeeklyHeatmap } from "../activity/WeeklyHeatmap";
import HomeSection from "./HomeSection";

/**
 * HomeActivityRecap — the Activity dashboard distilled into a sidebar
 * widget. Shows this-week playtime, session count, games played and the
 * most-played title, over a compact 7-day heatmap.
 *
 * All numbers derive from `ActivityContext.sessions` (the same source the
 * full Activity page uses), so the widget stays live as sessions land.
 */
export default function HomeActivityRecap() {
  const { sessions } = useActivity();
  const { t } = useLanguage();

  const week = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weekSessions = sessions.filter((s) => {
      const tMs = new Date(s.date).getTime();
      return tMs >= cutoff && tMs <= Date.now();
    });

    const totalMin = weekSessions.reduce((sum, s) => sum + s.durationMin, 0);
    const gameMinutes = new Map<string, { name: string; minutes: number }>();
    for (const s of weekSessions) {
      const entry = gameMinutes.get(s.gameId) ?? { name: s.gameName, minutes: 0 };
      entry.minutes += s.durationMin;
      gameMinutes.set(s.gameId, entry);
    }
    const mostPlayed = Array.from(gameMinutes.values()).sort(
      (a, b) => b.minutes - a.minutes
    )[0] ?? null;

    return {
      totalMin,
      sessionsCount: weekSessions.length,
      gamesPlayed: gameMinutes.size,
      mostPlayed,
    };
  }, [sessions]);

  const cells = [
    { label: t("activityDash.totalPlaytime"), value: formatPlayTime(week.totalMin) },
    { label: t("activityDash.sessions"), value: String(week.sessionsCount) },
    { label: t("home.activity.gamesPlayed"), value: String(week.gamesPlayed) },
  ];

  return (
    <HomeSection
      className="home-activity"
      icon={
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      }
      title={t("home.activity.title")}
      subtitle={t("home.activity.subtitle")}
      viewAllPath="/activity"
    >
      {week.totalMin === 0 ? (
        <div className="home-activity__empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span>{t("home.activity.empty")}</span>
        </div>
      ) : (
        <>
          <div className="home-activity__stats">
            {cells.map((c) => (
              <div key={c.label} className="home-activity__stat">
                <span className="home-activity__stat-value">{c.value}</span>
                <span className="home-activity__stat-label">{c.label}</span>
              </div>
            ))}
          </div>

          {week.mostPlayed && (
            <div className="home-activity__most-played" title={week.mostPlayed.name}>
              <span className="home-activity__most-played-label">
                {t("home.activity.mostPlayed")}
              </span>
              <span className="home-activity__most-played-name">
                {week.mostPlayed.name}
              </span>
              <span className="home-activity__most-played-time">
                {formatPlayTime(week.mostPlayed.minutes)}
              </span>
            </div>
          )}

          <div className="home-activity__heatmap">
            <WeeklyHeatmap sessions={sessions} timeframeDays={7} />
          </div>
        </>
      )}
    </HomeSection>
  );
}
