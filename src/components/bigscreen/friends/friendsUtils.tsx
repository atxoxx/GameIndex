// friendsUtils — shared helpers + tiny inline-SVG set for the Big
// Screen Friends hub.
//
// Mirrors the pure formatting helpers used by the desktop FriendsPage
// (formatHours / formatLastSeen / formatDateTime / isOnline / …) but
// renders through the bigscreen i18n namespace where the desktop keys
// are too coarse (e.g. fine-grained playtime). Every string resolves
// through `t()` — no hardcoded copy.

import { useCallback, useEffect, useRef } from "react";
import { useLanguage } from "../../../context/LanguageContext";
import { useFocusable } from "../../../hooks/useFocusable";
import {
  type Friend,
  getInitials,
  getProceduralAvatarStyle,
  isAppBlacklisted,
  safeCurrentlyPlaying,
} from "../../../pages/friendsStorage";

// ── Formatting ───────────────────────────────────────────────────

/** Fine-grained "3h 12m" playtime, bigscreen flavor. */
export function formatHours(totalMinutes: number, t: (key: string, vars?: Record<string, unknown>) => string): string {
  if (!totalMinutes || totalMinutes <= 0) return t("friendsPage.hoursZero");
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h >= 1000) return t("friendsPage.hoursK", { h: (h / 1000).toFixed(1) });
  if (h === 0) return t("bigscreen.friends.playtimeMin", { m });
  if (m === 0) return t("friendsPage.hoursH", { h });
  return t("bigscreen.friends.playtimeDetailed", { h, m });
}

/** Localized date + time (month short, day numeric, hh:mm). */
export function formatDateTime(dateTimeStr: string, tz?: string): string {
  try {
    const d = new Date(dateTimeStr);
    const opts: Intl.DateTimeFormatOptions = {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    };
    if (tz) {
      try {
        opts.timeZone = tz;
      } catch {
        /* invalid tz — fall back to local */
      }
    }
    return d.toLocaleString(undefined, opts);
  } catch {
    return dateTimeStr;
  }
}

/** Compact "in 3h 12m" / "2d 4h" countdown label from now to the target time. */
export function countdownLabel(targetIso: string, t: (key: string, vars?: Record<string, unknown>) => string): string {
  const diff = new Date(targetIso).getTime() - Date.now();
  if (Number.isNaN(diff)) return "";
  if (diff <= 0) return t("friendsPage.nowLive");
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return t("friendsPage.countdownMin", { m: mins });
  const hours = Math.floor(mins / 60);
  const remMin = mins % 60;
  if (hours < 24) {
    return remMin > 0
      ? t("friendsPage.countdownHourMin", { h: hours, m: remMin })
      : t("friendsPage.countdownHour", { h: hours });
  }
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH > 0
    ? t("friendsPage.countdownDayHour", { d: days, h: remH })
    : t("friendsPage.countdownDay", { d: days });
}

/** Human-friendly "last seen" relative string from epoch seconds. */
export function formatLastSeen(epochSecs: number | undefined, t: (key: string, vars?: Record<string, unknown>) => string): string {
  if (!epochSecs) return t("friendsPage.formatNever");
  const diffSecs = Math.floor(Date.now() / 1000) - epochSecs;
  if (diffSecs < 60) return t("friendsPage.formatJustNow");
  const mins = Math.floor(diffSecs / 60);
  if (mins < 60) return t("friendsPage.minutesAgo", { m: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("friendsPage.hoursAgo", { h: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t("friendsPage.daysAgo", { d: days });
  const months = Math.floor(days / 30);
  if (months < 12) return t("friendsPage.monthsAgo", { m: months });
  return t("friendsPage.yearsAgo", { y: Math.floor(months / 12) });
}

/** "Friends for X" relative string from addedAt epoch ms. */
export function formatFriendsSince(addedAt: number | undefined, t: (key: string, vars?: Record<string, unknown>) => string): string {
  if (!addedAt) return "";
  const days = Math.floor((Date.now() - addedAt) / 86_400_000);
  if (days < 1) return t("friendsPage.formatFriendsSinceToday");
  if (days < 30) {
    return t(days === 1 ? "friendsPage.friendsForDay" : "friendsPage.friendsForDays", { count: days });
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return t(months === 1 ? "friendsPage.friendsForMonth" : "friendsPage.friendsForMonths", { count: months });
  }
  const years = Math.floor(months / 12);
  return t(years > 1 || months >= 24 ? "friendsPage.friendsForYears" : "friendsPage.friendsForYear", { count: years });
}

/** True online status derived from live `currentlyPlaying` or status text. */
export function isOnline(friend: Friend): boolean {
  return (
    !!safeCurrentlyPlaying(friend.currentlyPlaying) ||
    (friend.status || "").toLowerCase().includes("online") ||
    (friend.status || "").toLowerCase().includes("playing")
  );
}

/** Rich presence label for display (online / in-game / empty). */
export function presenceLabel(friend: Friend, t: (key: string, vars?: Record<string, unknown>) => string): string {
  const playing = safeCurrentlyPlaying(friend.currentlyPlaying);
  if (playing) return t("friendsPage.playingGame", { game: playing });
  if (isOnline(friend)) return t("friendsPage.formatOnline");
  return "";
}

/** Number of games the friend and the viewer both own (from shared stats). */
export function sharedGamesCount(friend: Friend, myGameIds: Set<string>): number {
  if (!friend.games || friend.games.length === 0) return 0;
  let count = 0;
  for (const g of friend.games) {
    if (isAppBlacklisted(g.name, g.id)) continue;
    if (myGameIds.has(g.id)) count++;
  }
  return count;
}

/** Two sessions conflict when their time windows overlap. */
export function sessionsConflict(
  a: { id?: string; scheduledAt: string; durationMin?: number },
  b: { id?: string; scheduledAt: string; durationMin?: number },
): boolean {
  if (a.id && b.id && a.id === b.id) return false;
  const startA = new Date(a.scheduledAt).getTime();
  const startB = new Date(b.scheduledAt).getTime();
  if (Number.isNaN(startA) || Number.isNaN(startB)) return false;
  const endA = startA + (a.durationMin || 120) * 60_000;
  const endB = startB + (b.durationMin || 120) * 60_000;
  return startA < endB && startB < endA;
}

/** Detect the viewer's IANA timezone. */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

// ── Avatar ───────────────────────────────────────────────────────

/**
 * Procedural-gradient initials avatar (or the uploaded image when
 * `avatar` is a data URL), matching the desktop friend cards.
 */
export function FriendAvatar({
  avatar,
  name,
  className,
}: {
  avatar: string;
  name: string;
  className?: string;
}) {
  const { t } = useLanguage();
  if (avatar === "procedural" || !avatar) {
    const style = getProceduralAvatarStyle(name);
    return (
      <div className={className} style={style} aria-hidden>
        {getInitials(name)}
      </div>
    );
  }
  return (
    <div className={className} aria-hidden>
      <img
        src={avatar}
        alt={t("friendsPage.avatarAlt", { name })}
        onError={(e) => {
          (e.target as HTMLElement).style.display = "none";
        }}
      />
    </div>
  );
}

// ── Focusable input bridge ───────────────────────────────────────
// Controller A lands on the (hidden) focusable slot, which forwards
// focus to the real text field so the virtual cursor / keyboard can
// type into it. Mirrors the established BigScreenFriends pattern.

export function useFocusableInput<T extends HTMLElement>() {
  const inputRef = useRef<T | null>(null);
  const focusable = useFocusable(() => inputRef.current?.focus());
  const setInputRef = useCallback(
    (el: T | null) => {
      inputRef.current = el;
      (focusable.ref as (node: HTMLElement | null) => void)(el);
    },
    [focusable],
  );
  return { inputRef, setInputRef, inputProps: focusable };
}

// ── Shared filter chip ────────────────────────────────────────────
// Small toggleable pill used across the hub's filter rows (friends
// filters, session views, rec/sug feeds, compare sub-tabs).

export function FilterChip({
  label,
  active,
  onActivate,
  className,
}: {
  label: string;
  active: boolean;
  onActivate: () => void;
  className?: string;
}) {
  const chipProps = useFocusable(onActivate);
  return (
    <button
      type="button"
      className={[
        "bigscreen-filter-chip",
        active ? "active" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...chipProps}
    >
      {label}
    </button>
  );
}

// ── Overlay Escape bridge ─────────────────────────────────────────
// Every Big Screen modal must own controller B (the engine dispatches
// a synthetic Escape keydown while a `data-bigscreen-overlay` is
// mounted). This capture-phase listener closes the surface before the
// shell's global handler can act on the key. Pass `active={false}`
// for surfaces that stay mounted while closed (e.g. friend cards),
// so they never swallow Escape meant for a different overlay.

export function useOverlayEscape(onClose: () => void, active = true): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!active) return;
    function onEscape(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onCloseRef.current();
    }
    document.addEventListener("keydown", onEscape, true);
    return () => document.removeEventListener("keydown", onEscape, true);
  }, [active]);
}

// ── Inline icons (24×24 stroke set, currentColor) ────────────────

const Svg = ({ children, filled }: { children: React.ReactNode; filled?: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    fill={filled ? "currentColor" : "none"}
    stroke={filled ? "none" : "currentColor"}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const Icons = {
  pin: (f?: boolean) => (
    <Svg filled={f}>
      <path d="M16 3v6l2.4 2.4a2 2 0 0 1 .6 1.4V14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-1.2a2 2 0 0 1 .6-1.4L8 9V3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1Z" />
      <path d="M12 15v5" />
    </Svg>
  ),
  block: () => (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.5 5.5 13 13" />
    </Svg>
  ),
  trash: () => (
    <Svg>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </Svg>
  ),
  chat: () => (
    <Svg>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </Svg>
  ),
  star: (f?: boolean) => (
    <Svg filled={f}>
      <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" />
    </Svg>
  ),
  users: () => (
    <Svg>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16 5a3 3 0 0 1 0 6" />
      <path d="M18 14a5 5 0 0 1 3 6" />
    </Svg>
  ),
  check: () => (
    <Svg>
      <path d="M20 6 9 17l-5-5" />
    </Svg>
  ),
  x: () => (
    <Svg>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </Svg>
  ),
  plus: () => (
    <Svg>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </Svg>
  ),
  trophy: () => (
    <Svg>
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3" />
      <path d="M12 14v4M9 21h6M10 18h4" />
    </Svg>
  ),
  gamepad: () => (
    <Svg>
      <path d="M6 11h4M8 9v4" />
      <circle cx="15.5" cy="10.5" r="0.5" />
      <circle cx="17.5" cy="12.5" r="0.5" />
      <path d="M17.3 5H6.7a4.7 4.7 0 0 0-4.6 5.8L3.7 17a3 3 0 0 0 5.4 1L10 16h4l.9 2a3 3 0 0 0 5.4-1l1.6-6.2A4.7 4.7 0 0 0 17.3 5Z" />
    </Svg>
  ),
  calendar: () => (
    <Svg>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </Svg>
  ),
  message: () => (
    <Svg>
      <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H8l-4 4V6a1 1 0 0 1 1-1Z" />
    </Svg>
  ),
  compare: () => (
    <Svg>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20V7" />
    </Svg>
  ),
  refresh: () => (
    <Svg>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </Svg>
  ),
  send: () => (
    <Svg>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </Svg>
  ),
  mapPin: () => (
    <Svg>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </Svg>
  ),
  clock: () => (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </Svg>
  ),
  heart: (f?: boolean) => (
    <Svg filled={f}>
      <path d="M20.8 8.8c0 5.4-8.8 10.2-8.8 10.2S3.2 14.2 3.2 8.8A4.8 4.8 0 0 1 12 6a4.8 4.8 0 0 1 8.8 2.8Z" />
    </Svg>
  ),
  thumbsUp: () => (
    <Svg>
      <path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3Z" />
      <path d="M7 10l4-7a2 2 0 0 1 2 2v4h5.2a2 2 0 0 1 2 2.4l-1.4 7a2 2 0 0 1-2 1.6H7" />
    </Svg>
  ),
  fire: () => (
    <Svg>
      <path d="M12 22c4.4 0 7-2.8 7-6.5 0-2.6-1.4-4.9-3-6.6-.3 1.1-1 2-2 2.5C14 7 12.5 4.5 10 3c.3 2.5-1 4.5-3 6-1.7 1.3-3 3.4-3 6C4 19.2 7.6 22 12 22Z" />
    </Svg>
  ),
  search: () => (
    <Svg>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </Svg>
  ),
  copy: () => (
    <Svg>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Svg>
  ),
  tag: () => (
    <Svg>
      <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 3 12V5a2 2 0 0 1 2-2h7a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.6Z" />
      <circle cx="7.5" cy="7.5" r="1" />
    </Svg>
  ),
  bulb: () => (
    <Svg>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.5 1.1 2.4h5c0-.9.4-1.8 1.1-2.4A6 6 0 0 0 12 3Z" />
    </Svg>
  ),
  chart: () => (
    <Svg>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20V7" />
    </Svg>
  ),
  handshake: () => (
    <Svg>
      <path d="m11 17 2 2a2 2 0 0 0 3-3l-3-3" />
      <path d="m13 12 3 3a2 2 0 0 0 3-3l-2-2" />
      <path d="m13 8 2 2a2 2 0 0 0 3-3L11 4 4 8l4 4 3-1" />
    </Svg>
  ),
  edit: () => (
    <Svg>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Svg>
  ),
  flag: () => (
    <Svg>
      <path d="M4 22V4" />
      <path d="M4 4h12l-2 4 2 4H4" />
    </Svg>
  ),
  dot: () => (
    <Svg filled>
      <circle cx="12" cy="12" r="5" />
    </Svg>
  ),
} as const;
