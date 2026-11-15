/**
 * In-HUD achievement unlock banners.
 *
 * The main app already turns `achievement-unlocked` into a toast, but a toast
 * in a window the player cannot see is useless mid-game. This hook mirrors the
 * same backend event inside the overlay window and queues one banner at a time:
 * while collapsed the ticker morphs into the banner and the window auto-fits
 * to it, so the notification is visible without opening the panel.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";

export interface OverlayAchievementNotice {
  /** Stable identity for dedupe + React keys. */
  id: string;
  gameId: string;
  gameName: string;
  displayName: string;
  description: string;
  icon: string;
  /** Global unlock percentage, or 0 when the source does not report one. */
  percent: number;
  isRare: boolean;
}

export interface AchievementUnlockedPayload {
  gameId?: string;
  gameName?: string;
  achievements?: Array<{
    displayName?: string;
    description?: string;
    icon?: string;
    percent?: number;
    isRare?: boolean;
  }>;
}

/** Keep at most five pending banners, dropping duplicates. */
export function appendNotices(
  queue: OverlayAchievementNotice[],
  incoming: OverlayAchievementNotice[],
  limit = 5,
): OverlayAchievementNotice[] {
  const seen = new Set(queue.map((notice) => notice.id));
  const next = [...queue];
  for (const notice of incoming) {
    if (seen.has(notice.id)) continue;
    seen.add(notice.id);
    next.push(notice);
  }
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** Convert one backend payload into queue entries. */
export function noticesFromPayload(
  payload: AchievementUnlockedPayload | null | undefined,
): OverlayAchievementNotice[] {
  const achievements = payload?.achievements ?? [];
  const gameId = payload?.gameId ?? "";
  const gameName = payload?.gameName ?? "";
  return achievements
    .filter((achievement) => Boolean(achievement.displayName))
    .map((achievement, index) => {
      const displayName = achievement.displayName ?? "";
      const percent = Number.isFinite(achievement.percent)
        ? Number(achievement.percent)
        : 0;
      return {
        id: `${gameId}:${displayName}:${index}`,
        gameId,
        gameName,
        displayName,
        description: achievement.description ?? "",
        icon: achievement.icon ?? "",
        percent,
        isRare: achievement.isRare ?? (percent > 0 && percent < 10),
      };
    });
}

function playAchievementChime(): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    [660, 880, 1320].forEach((frequency, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(frequency, now + index * 0.09);
      gain.gain.setValueAtTime(0.0001, now + index * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.14, now + index * 0.09 + 0.02);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + index * 0.09 + 0.22,
      );
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + index * 0.09);
      osc.stop(now + index * 0.09 + 0.24);
    });
  } catch {
    /* Audio unavailable or blocked */
  }
}

export interface OverlayAchievementToasts {
  current: OverlayAchievementNotice | null;
  pending: number;
  dismiss: () => void;
}

export function useOverlayAchievementToasts(options: {
  enabled: boolean;
  seconds: number;
  sound: boolean;
}): OverlayAchievementToasts {
  const { enabled, seconds, sound } = options;
  const [queue, setQueue] = useState<OverlayAchievementNotice[]>([]);
  const [current, setCurrent] = useState<OverlayAchievementNotice | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<AchievementUnlockedPayload>("achievement-unlocked", (event) => {
      if (!enabledRef.current) return;
      const notices = noticesFromPayload(event.payload);
      if (notices.length === 0) return;
      setQueue((previous) => appendNotices(previous, notices));
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {
        /* no bridge (browser dev) */
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Promote the next queued banner once the visible one leaves.
  useEffect(() => {
    if (!enabled || current || queue.length === 0) return;
    setCurrent(queue[0]);
    setQueue((previous) => previous.slice(1));
  }, [current, enabled, queue]);

  // Timed dismissal. Re-arms whenever a new banner becomes current.
  useEffect(() => {
    if (!current) return;
    if (sound) playAchievementChime();
    const hold = Math.min(20, Math.max(2, Number(seconds) || 6)) * 1000;
    const timer = window.setTimeout(() => setCurrent(null), hold);
    return () => window.clearTimeout(timer);
  }, [current, seconds, sound]);

  // Turning notifications off clears anything already on screen.
  useEffect(() => {
    if (!enabled) {
      setCurrent(null);
      setQueue([]);
    }
  }, [enabled]);

  const dismiss = useCallback(() => setCurrent(null), []);

  return { current, pending: queue.length, dismiss };
}
