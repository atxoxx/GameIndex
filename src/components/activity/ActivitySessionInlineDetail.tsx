import { ExternalLink, Link2, Play, Plus, Trash2 } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import type { TempUnit } from "../../context/SettingsContext";
import type { Game, GameSession } from "../../types/game";
import { gameDisplayName } from "../../types/game";
import { Button } from "../ui";
import { GameSessionDetail } from "../game/GameSessionDetail";
import { ActivitySessionNotes } from "./ActivitySessionNotes";

export interface ActivitySessionInlineDetailProps {
  session: GameSession;
  game?: Game;
  tempUnit: TempUnit;
  onDelete: (session: GameSession) => void;
  onLaunchGame?: (game: Game) => void;
  onOpenGame?: (gameId: string) => void;
  onRequestLink?: (gameId: string, name: string) => void;
  onRequestAdd?: (gameId: string, name: string) => void;
}

/**
 * The expanded session body inside the history list. Same content as the
 * timeline's inspector drawer, but it unfolds in place so reading a session
 * never moves the user to another surface.
 */
export function ActivitySessionInlineDetail({
  session,
  game,
  tempUnit,
  onDelete,
  onLaunchGame,
  onOpenGame,
  onRequestLink,
  onRequestAdd,
}: ActivitySessionInlineDetailProps) {
  const { t } = useLanguage();
  const hasTemps = Boolean(
    session.metrics && (session.metrics.avgCpuTemp > 0 || session.metrics.avgGpuTemp > 0),
  );
  const title = game ? gameDisplayName(game) : session.gameName;

  return (
    <div
      className="activity-session-inline"
      role="region"
      aria-label={`${title} — ${t("activityWs.drawer.eyebrow")}`}
    >
      {session.metrics ? (
        <GameSessionDetail session={session} tempUnit={tempUnit} hasTemps={hasTemps} />
      ) : (
        <div className="activity-session-inline__empty">
          <p>{t("activityWs.drawer.noTelemetry")}</p>
          <p>{t("activityPerf.enableMonitoringHint")}</p>
        </div>
      )}

      <ActivitySessionNotes sessionId={session.id} />

      <div className="activity-session-inline__actions">
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Trash2 size={14} />}
          onClick={() => onDelete(session)}
        >
          {t("activitySessions.delete")}
        </Button>
        <span className="activity-session-inline__spacer" />
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
    </div>
  );
}

export default ActivitySessionInlineDetail;
