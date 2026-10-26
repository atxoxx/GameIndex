import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useAchievements } from "../../context/AchievementContext";
import { useDownloads } from "../../context/DownloadContext";
import type { AchievementUnlockRecord } from "../../types/game";
import type { TorrentDownload } from "../../types/download";

/** A notification-worthy event surfaced from an existing store. */
export interface OverlayNotification {
  id: string;
  kind: "achievement" | "download";
  name: string;
  /** Unix milliseconds; 0 when the source has no usable timestamp. */
  timestamp: number;
}

/** The last moment the user looked at the notification feed. */
const STORAGE_KEY = "gamelib.overlay.notifications.lastSeen.v1";
const MAX_ITEMS = 12;

function readLastSeen(): number {
  const now = Date.now();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const stored = raw ? Number(raw) : Number.NaN;
    if (Number.isFinite(stored) && stored > 0) return stored;
    // First run: remember "now" so a library full of old unlocks does not
    // open the HUD with a permanent badge. New events after this count.
    localStorage.setItem(STORAGE_KEY, String(now));
  } catch {
    /* private mode / no storage */
  }
  return now;
}

let lastSeen = readLastSeen();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return lastSeen;
}

/** Advance the read marker. Never moves backwards. */
export function markNotificationsSeen(at: number = Date.now()) {
  if (!Number.isFinite(at) || at <= lastSeen) return;
  lastSeen = at;
  try {
    localStorage.setItem(STORAGE_KEY, String(at));
  } catch {
    /* ignore */
  }
  for (const listener of listeners) listener();
}

/** Test hook: forget the persisted marker. */
export function resetNotificationsSeenForTest() {
  lastSeen = 0;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  for (const listener of listeners) listener();
}

/** Build the bounded, newest-first feed from the two live stores. */
export function buildOverlayNotifications(
  recentUnlocks: AchievementUnlockRecord[],
  completedDownloads: TorrentDownload[],
): OverlayNotification[] {
  const items: OverlayNotification[] = [];

  for (const record of recentUnlocks) {
    const seconds = record.achievement.unlockTime;
    items.push({
      id: `achievement:${record.gameId}:${record.achievement.apiName}`,
      kind: "achievement",
      name: record.achievement.displayName,
      timestamp: seconds > 0 ? seconds * 1000 : 0,
    });
  }

  for (const download of completedDownloads) {
    const seconds = download.completedAt ?? download.addedAt ?? 0;
    items.push({
      id: `download:${download.id}`,
      kind: "download",
      name: download.name,
      timestamp: seconds > 0 ? seconds * 1000 : 0,
    });
  }

  return items
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_ITEMS);
}

/** Feed entries newer than the read marker. */
export function unreadOverlayNotifications(
  items: OverlayNotification[],
  readAt: number,
): OverlayNotification[] {
  return items.filter((item) => item.timestamp > 0 && item.timestamp > readAt);
}

/**
 * Live notification feed shared by the ticker badge, the rail badge and the
 * Notifications widget. The read marker lives in localStorage so opening the
 * feed in one overlay session clears the badge for the next one too.
 */
export function useOverlayNotifications() {
  const { recentUnlocks } = useAchievements();
  const { completedDownloads } = useDownloads();
  const readAt = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const items = useMemo(
    () => buildOverlayNotifications(recentUnlocks, completedDownloads),
    [recentUnlocks, completedDownloads],
  );
  const unread = useMemo(
    () => unreadOverlayNotifications(items, readAt),
    [items, readAt],
  );

  const markAllSeen = useCallback(() => {
    const newest = items.reduce(
      (latest, item) => Math.max(latest, item.timestamp),
      0,
    );
    // Advance the read marker without ever moving it backwards, so a stale
    // closure or a future-dated item can never leave the badge stuck on a
    // non-zero count (and we never re-count items that were already read).
    const at = Math.max(Date.now(), newest);
    const next = Number.isFinite(at) && at > 0 ? Math.max(lastSeen, at) : Math.max(lastSeen, Date.now());
    lastSeen = next;
    try {
      localStorage.setItem(STORAGE_KEY, String(lastSeen));
    } catch {
      /* ignore */
    }
    for (const listener of listeners) listener();
  }, [items]);

  return { items, unread, unreadCount: unread.length, markAllSeen };
}
