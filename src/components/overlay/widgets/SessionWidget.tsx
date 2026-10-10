import { useEffect, useState } from "react";
import { useOverlay } from "../../../context/OverlayContext";
import { useGames } from "../../../context/GameContext";
import { useLanguage } from "../../../context/LanguageContext";
import { KpiTile } from "../../ui";

/** Format elapsed seconds as `mm:ss`, or `h:mm:ss` past an hour. */
export function formatClock(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Local 1 s elapsed timer anchored to a session's `startedAt`. Returns 0
 * when no session is running. Shared by the ticker and the session widget so
 * the two readouts stay in lockstep.
 */
export function useSessionElapsed(startedAt: number | null | undefined): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (!startedAt) return 0;
  return Math.max(0, (now - startedAt) / 1000);
}

/** Session / playtime tile for the expanded overlay panel. */
export default function SessionWidget() {
  const { session } = useOverlay();
  const { getGame } = useGames();
  const { t } = useLanguage();
  const elapsed = useSessionElapsed(session?.startedAt ?? null);

  if (!session) {
    return (
      <KpiTile
        size="sm"
        label={t("overlay.widget.session")}
        value="—"
        subtext={t("overlay.noSession")}
      />
    );
  }

  const game = getGame(session.gameId);

  return (
    <KpiTile
      size="sm"
      intent="accent"
      label={t("overlay.widget.session")}
      value={formatClock(elapsed)}
      subtext={game?.name ?? t("overlay.session.playtime")}
    />
  );
}
