import { useState } from "react";
import { useVisibleInterval } from "../../hooks/useVisibleInterval";

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
 * Local 1 s elapsed timer anchored to a session's `startedAt`. Returns 0 when
 * no session is running. Shared by the ticker, the panel header and the
 * session widget so every clock stays in lockstep.
 */
export function useSessionElapsed(startedAt: number | null | undefined): number {
  const [now, setNow] = useState(() => Date.now());

  useVisibleInterval(
    () => setNow(Date.now()),
    1000,
    Boolean(startedAt)
  );

  if (!startedAt) return 0;
  return Math.max(0, (now - startedAt) / 1000);
}
