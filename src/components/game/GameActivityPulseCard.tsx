import { useMemo } from "react";
import type { Game } from "../../types/game";
import { useActivity } from "../../context/ActivityContext";
import { useAchievements } from "../../context/AchievementContext";
import { useLanguage } from "../../context/LanguageContext";
import { IconActivity, IconClock, IconTrophy } from "./icons";

interface GameActivityPulseCardProps {
  game: Game;
  onNavigateTab: (tab: "activity" | "achievements") => void;
}

function formatSessionDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

export default function GameActivityPulseCard({
  game,
  onNavigateTab,
}: GameActivityPulseCardProps) {
  const { t } = useLanguage();
  const { getGameSessions } = useActivity();
  const { getGameAchievements } = useAchievements();

  const sessions = useMemo(() => getGameSessions(game.id), [getGameSessions, game.id]);
  const achData = useMemo(() => getGameAchievements(game.id), [getGameAchievements, game.id]);

  const latestSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;
  const sessionCount = sessions.length;

  const achievements = game.steamAchievements;
  const achUnlocked = achData?.unlocked ?? achievements?.filter((a) => a.achieved).length ?? 0;
  const achTotal = achData?.total ?? achievements?.length ?? 0;
  const achPercent = achTotal > 0 ? Math.round((achUnlocked / achTotal) * 100) : null;

  if (sessionCount === 0 && achTotal === 0) {
    return null;
  }

  return (
    <section className="game-section activity-pulse-card">
      <div className="activity-pulse__header">
        <h2 className="game-section-title">
          <span className="game-section-title__icon" aria-hidden>
            <IconActivity size={16} />
          </span>
          {t("game.activityPulse.title")}
        </h2>
        {sessionCount > 0 && (
          <button
            type="button"
            className="activity-pulse__jump-btn"
            onClick={() => onNavigateTab("activity")}
          >
            {t("game.activityPulse.viewAllActivity")} →
          </button>
        )}
      </div>

      <div className="activity-pulse__grid">
        {/* Sessions stat */}
        {latestSession ? (
          <div className="activity-pulse__stat-box">
            <div className="activity-pulse__stat-top">
              <span className="activity-pulse__icon-pill">
                <IconClock size={14} />
              </span>
              <span className="activity-pulse__stat-label">
                {t("game.activityPulse.recentSession")}
              </span>
            </div>
            <div className="activity-pulse__stat-val">
              {formatSessionDuration(latestSession.durationMin * 60)}
            </div>
            <div className="activity-pulse__stat-sub">
              {t("gameActivity.sessionCount", { count: sessionCount, s: sessionCount > 1 ? "s" : "" })}
            </div>
          </div>
        ) : (
          <div className="activity-pulse__stat-box">
            <div className="activity-pulse__stat-top">
              <span className="activity-pulse__icon-pill">
                <IconClock size={14} />
              </span>
              <span className="activity-pulse__stat-label">
                {t("hero.playTime")}
              </span>
            </div>
            <div className="activity-pulse__stat-val">{game.playTime || "0h"}</div>
            <div className="activity-pulse__stat-sub">{t("game.activityPulse.noSessions")}</div>
          </div>
        )}

        {/* Achievements stat */}
        {achTotal > 0 && (
          <div className="activity-pulse__stat-box">
            <div className="activity-pulse__stat-top">
              <span className="activity-pulse__icon-pill activity-pulse__icon-pill--ach">
                <IconTrophy size={14} />
              </span>
              <span className="activity-pulse__stat-label">
                {t("nav.achievements")}
              </span>
            </div>
            <div className="activity-pulse__stat-val">
              {achPercent}%
            </div>
            <div className="activity-pulse__stat-sub">
              {achUnlocked} / {achTotal}
            </div>
            <div className="activity-pulse__progress-bar">
              <div
                className="activity-pulse__progress-fill"
                style={{ width: `${achPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
