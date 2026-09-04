import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { Game, GameSession } from "../../types/game";
import { formatPlayTime } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import { GameThumbnail } from "./GameThumbnail";
import {
  buildGameCompletionProgress,
  calculateCompletionForecast,
  type CompletionProgress,
  type CompletionForecast,
} from "./insights";
import * as Icons from "./Icons";

export interface BacklogCompletionHubProps {
  games: Game[];
  sessions: GameSession[];
  onLaunchGame?: (game: Game) => void;
}

interface BacklogGameItem {
  game: Game;
  totalMinutes: number;
  progress: CompletionProgress;
  forecast: CompletionForecast;
  lastPlayedDate: string | null;
}

export function BacklogCompletionHub({
  games,
  sessions,
  onLaunchGame,
}: BacklogCompletionHubProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();

  // Calculate 14-day velocity for each game
  const twoWeeksAgoMs = Date.now() - 14 * 86_400_000;

  const items = useMemo(() => {
    const list: BacklogGameItem[] = [];

    // Group sessions by gameId
    const sessionsByGame = new Map<string, GameSession[]>();
    sessions.forEach((s) => {
      const arr = sessionsByGame.get(s.gameId) || [];
      arr.push(s);
      sessionsByGame.set(s.gameId, arr);
    });

    games.forEach((game) => {
      const gameSessions = sessionsByGame.get(game.id) || [];
      const totalMinutes = gameSessions.reduce((acc, s) => acc + s.durationMin, 0);

      // Only include games that have Time-To-Beat metadata or have recorded playtime
      if (!game.timeToBeat && totalMinutes === 0) return;

      const progress = buildGameCompletionProgress(totalMinutes, game.timeToBeat);

      // Compute recent weekly velocity
      const recentSessions = gameSessions.filter(
        (s) => new Date(s.date).getTime() >= twoWeeksAgoMs,
      );
      const recentMinutes = recentSessions.reduce((acc, s) => acc + s.durationMin, 0);
      const recentWeeklyMinutes = Math.round(recentMinutes / 2); // 2 weeks -> weekly avg

      const forecast = calculateCompletionForecast(
        totalMinutes,
        game.timeToBeat,
        recentWeeklyMinutes,
      );

      // Find latest played date
      let lastPlayedDate: string | null = null;
      if (gameSessions.length > 0) {
        const sorted = [...gameSessions].sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        );
        lastPlayedDate = sorted[0].date;
      }

      list.push({
        game,
        totalMinutes,
        progress,
        forecast,
        lastPlayedDate,
      });
    });

    // Sort: In Progress with forecast first, then completed, then not started
    return list.sort((a, b) => {
      if (a.forecast.status === "onTrack" && b.forecast.status !== "onTrack") return -1;
      if (b.forecast.status === "onTrack" && a.forecast.status !== "onTrack") return 1;
      return b.totalMinutes - a.totalMinutes;
    });
  }, [games, sessions, twoWeeksAgoMs]);

  if (items.length === 0) {
    return (
      <div className="act-empty act-empty--compact">
        <div className="act-empty__icon">
          <Icons.Target size={18} />
        </div>
        <div className="act-empty__title">{t("activityBacklog.noBacklogData")}</div>
        <div className="act-empty__hint">{t("activityBacklog.enrichMetadataHint")}</div>
      </div>
    );
  }

  return (
    <div className="act-backlog-hub">
      <div className="act-backlog-grid">
        {items.slice(0, 6).map(({ game, totalMinutes, progress, forecast }) => {
          return (
            <div key={game.id} className="act-backlog-card">
              <div className="act-backlog-card__head">
                <GameThumbnail
                  iconUrl={game.iconUrl}
                  coverArtUrl={game.coverArtUrl}
                  steamAppId={game.steamAppId}
                  name={game.name}
                  className="act-backlog-card__thumb"
                />
                <div className="act-backlog-card__titles">
                  <span
                    className="act-backlog-card__name"
                    title={game.name}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/library/${game.id}?tab=activity`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        navigate(`/library/${game.id}?tab=activity`);
                      }
                    }}
                  >
                    {game.name}
                  </span>
                  <span className="act-backlog-card__sub">
                    {formatPlayTime(totalMinutes)} · {progress.mainStoryHours ? `${progress.mainStoryHours}h ${t("activityBacklog.target")}` : t("activityBacklog.inProgress")}
                  </span>
                </div>
                {onLaunchGame && (
                  <button
                    type="button"
                    className="act-backlog-card__play-btn"
                    onClick={() => onLaunchGame(game)}
                    title={t("game.play")}
                    aria-label={t("game.play")}
                  >
                    <Icons.Play size={12} />
                  </button>
                )}
              </div>

              {/* Progress Bar */}
              <div className="act-backlog-card__progress">
                <div className="act-backlog-card__bar-track">
                  <div
                    className={`act-backlog-card__bar-fill ${progress.mainStoryPct >= 100 ? "act-backlog-card__bar-fill--complete" : ""}`}
                    style={{ width: `${Math.min(100, Math.max(2, progress.mainStoryPct))}%` }}
                  />
                </div>
                <div className="act-backlog-card__progress-labels">
                  <span className="act-backlog-card__pct-text">
                    {progress.mainStoryPct}% {t("gameActivity.ttb.mainStory")}
                  </span>
                  {forecast.status === "completed" ? (
                    <span className="act-backlog-badge act-backlog-badge--complete">
                      <Icons.Check size={11} /> {t("activityBacklog.storyCompleted")}
                    </span>
                  ) : forecast.estimatedDaysRemaining != null ? (
                    <span className="act-backlog-badge act-backlog-badge--forecast">
                      <Icons.Clock size={11} /> ~{forecast.estimatedDaysRemaining}d {t("activityBacklog.toFinish")}
                    </span>
                  ) : forecast.status === "stalled" ? (
                    <span className="act-backlog-badge act-backlog-badge--stalled">
                      {t("activityBacklog.stalled")}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
