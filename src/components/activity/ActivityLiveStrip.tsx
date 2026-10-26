import { Gamepad2, ExternalLink } from "lucide-react";
import { useGames, useLiveElapsed, useRunningGames } from "../../context/GameContext";
import { useLanguage } from "../../context/LanguageContext";
import { formatPlayTime, gameDisplayName } from "../../types/game";
import { GameThumbnail } from "./GameThumbnail";

export interface ActivityLiveStripProps {
  onOpenGame: (gameId: string) => void;
}

function elapsedLabel(seconds: number | undefined, startingLabel: string): string {
  if (!seconds || seconds < 60) return startingLabel;
  return formatPlayTime(Math.round(seconds / 60));
}

/**
 * The only live thing on the page: a slim, accent-tinted strip that appears
 * while a game is running. It reads before the historical figures because
 * "what am I playing right now" is the question the launcher can answer.
 */
export function ActivityLiveStrip({ onOpenGame }: ActivityLiveStripProps) {
  const { t } = useLanguage();
  const { games } = useGames();
  const running = useRunningGames();
  const elapsed = useLiveElapsed();

  if (running.length === 0) return null;

  const visible = running.slice(0, 2);
  const remaining = running.length - visible.length;

  return (
    <div className="activity-live" aria-live="polite">
      <span className="activity-live__pulse" aria-hidden="true" />
      <span className="activity-live__eyebrow">
        <Gamepad2 size={13} aria-hidden="true" />
        {t("activityWs.live.title")}
      </span>
      <div className="activity-live__entries">
        {visible.map((gameId) => {
          const game = games.find((candidate) => candidate.id === gameId);
          const name = game ? gameDisplayName(game) : gameId;
          return (
            <div key={gameId} className="activity-live__entry">
              <span className="activity-live__cover">
                <GameThumbnail
                  iconUrl={game?.iconUrl}
                  coverArtUrl={game?.coverArtUrl}
                  steamAppId={game?.steamAppId}
                  name={name}
                  className="activity-live__cover-img"
                />
              </span>
              <span className="activity-live__meta">
                <span className="activity-live__name">{name}</span>
                <span className="activity-live__time">
                  {elapsedLabel(elapsed[gameId], t("activityWs.live.starting"))}
                </span>
              </span>
              <button
                type="button"
                className="activity-live__open"
                onClick={() => onOpenGame(gameId)}
              >
                <ExternalLink size={12} aria-hidden="true" />
                {t("activityWs.live.open")}
              </button>
            </div>
          );
        })}
      </div>
      {remaining > 0 && (
        <span className="activity-live__more">
          {t("activityWs.live.more", { count: remaining })}
        </span>
      )}
    </div>
  );
}

export default ActivityLiveStrip;
