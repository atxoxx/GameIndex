import { Clock3, ExternalLink, Link2, Play, Plus, Trash2 } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import type { TempUnit } from "../../context/SettingsContext";
import type { Game, GameSession } from "../../types/game";
import { formatPlayTime, gameDisplayName } from "../../types/game";
import { Button, DetailDrawer } from "../ui";
import { GameSessionDetail } from "../game/GameSessionDetail";
import PlayerCountBadge from "../PlayerCountBadge";
import { useSteamAppId } from "../../hooks/useSteamAppId";
import { ActivitySessionNotes } from "./ActivitySessionNotes";
import {
  formatSessionClockRange,
  formatSessionDay,
} from "../../utils/activity/sessionTime";

export interface ActivitySessionDrawerProps {
  session: GameSession | null;
  game?: Game;
  tempUnit: TempUnit;
  onClose: () => void;
  onDelete: (session: GameSession) => void;
  onLaunchGame?: (game: Game) => void;
  onOpenGame?: (gameId: string) => void;
  onRequestLink?: (gameId: string, name: string) => void;
  onRequestAdd?: (gameId: string, name: string) => void;
}

/**
 * Right-hand session inspector. Replaces the old inline expansion: one
 * pattern for telemetry, notes, tags and actions, opened from the list or the
 * timeline without reflowing the page behind it.
 */
export function ActivitySessionDrawer({
  session,
  game,
  tempUnit,
  onClose,
  onDelete,
  onLaunchGame,
  onOpenGame,
  onRequestLink,
  onRequestAdd,
}: ActivitySessionDrawerProps) {
  const { t, language } = useLanguage();
  const { appId } = useSteamAppId(session ? game : null);
  if (!session) return null;

  const title = game ? gameDisplayName(game) : session.gameName;
  const hasTemps = Boolean(
    session.metrics && (session.metrics.avgCpuTemp > 0 || session.metrics.avgGpuTemp > 0),
  );
  const dateLabel = formatSessionDay(session, language, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const clock = formatSessionClockRange(session, language);

  return (
    <DetailDrawer
      open
      onClose={onClose}
      eyebrow={t("activityWs.drawer.eyebrow")}
      title={title}
      description={`${dateLabel} · ${clock} · ${formatPlayTime(session.durationMin)}`}
      closeLabel={t("common.close")}
      badges={
        <div className="activity-drawer__badges">
          <span className="activity-drawer__badge">
            <Clock3 size={12} aria-hidden="true" />
            {formatPlayTime(session.durationMin)}
          </span>
          {game?.platform && <span className="activity-drawer__badge">{game.platform}</span>}
          {session.metrics?.resolution && (
            <span className="activity-drawer__badge">{session.metrics.resolution}</span>
          )}
          {session.metrics?.avgFps ? (
            <span className="activity-drawer__badge activity-drawer__badge--accent">
              {Math.round(session.metrics.avgFps)} FPS
            </span>
          ) : null}
          {appId ? (
            <PlayerCountBadge
              appId={appId}
              gameName={title}
              className="activity-drawer__player-count"
            />
          ) : null}
        </div>
      }
      footer={
        <div className="activity-drawer__footer">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Trash2 size={14} />}
            onClick={() => onDelete(session)}
          >
            {t("activitySessions.delete")}
          </Button>
          <span className="activity-drawer__footer-gap" />
          {game ? (
            <>
              {onOpenGame && (
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<ExternalLink size={14} />}
                  onClick={() => onOpenGame(game.id)}
                >
                  {t("gameActivity.viewGamePage")}
                </Button>
              )}
              {onLaunchGame && (
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<Play size={14} />}
                  onClick={() => onLaunchGame(game)}
                >
                  {t("game.play")}
                </Button>
              )}
            </>
          ) : (
            <>
              {onRequestLink && (
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Link2 size={14} />}
                  onClick={() => onRequestLink(session.gameId, session.gameName)}
                >
                  {t("activityWs.rail.link")}
                </Button>
              )}
              {onRequestAdd && (
                <Button
                  variant="primary"
                  size="sm"
                  leftIcon={<Plus size={14} />}
                  onClick={() => onRequestAdd(session.gameId, session.gameName)}
                >
                  {t("activityWs.rail.add")}
                </Button>
              )}
            </>
          )}
        </div>
      }
    >
      <div className="activity-drawer">
        {session.metrics ? (
          <section className="activity-drawer__section">
            <h3 className="activity-drawer__section-title">
              {t("activityWs.drawer.telemetry")}
            </h3>
            <GameSessionDetail session={session} tempUnit={tempUnit} hasTemps={hasTemps} />
          </section>
        ) : (
          <div className="activity-drawer__empty">
            <p>{t("activityWs.drawer.noTelemetry")}</p>
            <p className="activity-drawer__empty-hint">
              {t("activityPerf.enableMonitoringHint")}
            </p>
          </div>
        )}

        <ActivitySessionNotes sessionId={session.id} />
      </div>
    </DetailDrawer>
  );
}

export default ActivitySessionDrawer;
