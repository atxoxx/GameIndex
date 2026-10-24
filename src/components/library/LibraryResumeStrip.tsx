import { useMemo, memo } from "react";
import { Play } from "lucide-react";
import { gameDisplayName, type Game } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import { useGameBackdropArt } from "../../hooks/useGameBackdropArt";
import { ArtworkImage } from "../ui/ArtworkImage";

interface LibraryResumeStripProps {
  games: Game[];
  maxItems?: number;
  windowDays?: number;
  /** Ids of games currently running, so their card always shows the state. */
  runningIds?: string[];
  onOpen: (game: Game) => void;
  onLaunch: (game: Game) => void;
}

export const RESUME_WINDOW_DAYS = 30;

/**
 * LibraryResumeStrip — "Jump back in": the handful of games played most
 * recently, as wide 16:9 cards.
 *
 * Unlike the Home rail this is a single row of the latest sessions, so the
 * library page keeps its promise of showing the grid almost immediately. It
 * renders nothing at all when no session falls inside the window.
 */
export default function LibraryResumeStrip({
  games,
  maxItems = 6,
  windowDays = RESUME_WINDOW_DAYS,
  runningIds = [],
  onOpen,
  onLaunch,
}: LibraryResumeStripProps) {
  const { t } = useLanguage();

  const recent = useMemo(() => {
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    return [...games]
      .filter((game) => (game.lastPlayed ?? 0) >= cutoff)
      .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
      .slice(0, maxItems);
  }, [games, maxItems, windowDays]);

  const running = useMemo(() => new Set(runningIds), [runningIds]);

  if (recent.length === 0) return null;

  return (
    <section className="library-resume" aria-label={t("gameCard.continuePlaying")}>
      <header className="library-resume-head">
        <div className="library-resume-heading">
          <span className="library-resume-dot" aria-hidden="true" />
          <h2 className="library-resume-title">{t("library.hero.jumpBackIn")}</h2>
        </div>
        <p className="library-resume-subtitle">{t("lib.rail.continue.subtitle")}</p>
      </header>

      <div className="library-resume-track">
        {recent.map((game) => (
          <ResumeCard
            key={game.id}
            game={game}
            isRunning={running.has(game.id)}
            onOpen={onOpen}
            onLaunch={onLaunch}
          />
        ))}
      </div>
    </section>
  );
}

const ResumeCard = memo(function ResumeCard({
  game,
  isRunning,
  onOpen,
  onLaunch,
}: {
  game: Game;
  isRunning: boolean;
  onOpen: (game: Game) => void;
  onLaunch: (game: Game) => void;
}) {
  const { t } = useLanguage();
  const { staticUrl } = useGameBackdropArt(game);
  const name = gameDisplayName(game);

  const lastPlayed = game.lastPlayed
    ? t("library.hero.lastPlayed", { time: formatRelative(game.lastPlayed, t) })
    : t("lib.rail.continue.never");

  return (
    <article
      className="library-resume-card"
      role="button"
      tabIndex={0}
      data-game-detail-route={`/library/${game.id}`}
      data-game-detail-title={name}
      aria-label={name}
      onClick={() => onOpen(game)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(game);
        }
      }}
    >
      <div className="library-resume-art">
        {staticUrl ? (
          <ArtworkImage src={staticUrl} alt="" className="library-resume-image" />
        ) : (
          <div className="library-resume-image library-resume-image--empty" aria-hidden="true">
            <Play size={22} />
          </div>
        )}
        <span className="library-resume-scrim" aria-hidden="true" />

        <button
          type="button"
          className={`library-resume-play${isRunning ? " is-running" : ""}`}
          title={isRunning ? t("library.running") : t("game.play")}
          aria-label={
            isRunning
              ? t("game.resumeAria", { name })
              : t("game.playAria", { name })
          }
          onClick={(event) => {
            event.stopPropagation();
            onLaunch(game);
          }}
        >
          <Play size={13} fill="currentColor" aria-hidden="true" />
          <span>{isRunning ? t("library.running") : t("library.hero.resumePlaying")}</span>
        </button>

        <div className="library-resume-caption">
          <h3 className="library-resume-name" title={name}>
            {name}
          </h3>
          <p className="library-resume-meta">
            <span>{lastPlayed}</span>
            {game.playTime ? (
              <>
                <span className="library-resume-sep" aria-hidden="true">·</span>
                <span>{game.playTime}</span>
              </>
            ) : null}
          </p>
        </div>
      </div>
    </article>
  );
});

function formatRelative(timestamp: number, t: (key: string, vars?: Record<string, unknown>) => string) {
  const diff = Date.now() - timestamp;
  if (diff < 0) return t("lib.rail.continue.justNow");
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return t("lib.rail.continue.underHourAgo");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("lib.rail.continue.hoursAgo", { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("lib.rail.continue.daysAgo", { n: days });
  const weeks = Math.floor(days / 7);
  return t("lib.rail.continue.weeksAgo", { n: weeks });
}
