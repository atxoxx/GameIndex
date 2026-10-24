import type { LibrarySource } from "../../types/game";
import { PLAY_STATUS_DETAILS } from "../../types/game";

/**
 * Source facet labels. Store names are brand marks and stay untranslated;
 * only the catch-all and the local bucket go through i18n.
 */
export const SOURCE_LABELS: Record<LibrarySource, string | { key: string }> = {
  all: { key: "common.all" },
  steam: "Steam",
  local: { key: "common.local" },
  gog: "GOG",
  epic: "Epic",
  humble: "Humble",
  rockstar: "Rockstar",
  ubisoft: "Ubisoft",
  battlenet: "Battle.net",
  ea: "EA",
  xbox: "Xbox",
  itch: "itch.io",
};

/** The `Game.platform` value each source facet matches. */
export const SOURCE_PLATFORMS: Record<Exclude<LibrarySource, "all">, string> = {
  steam: "Steam",
  local: "Local",
  gog: "GOG",
  epic: "Epic",
  humble: "Humble",
  rockstar: "Rockstar",
  ubisoft: "Ubisoft",
  battlenet: "Battle.net",
  ea: "EA",
  xbox: "Xbox",
  itch: "itch.io",
};

export function sourceLabel(
  source: LibrarySource,
  t: (key: string) => string
): string {
  const label = SOURCE_LABELS[source];
  return typeof label === "string" ? label : t(label.key);
}

/** Play statuses in browsing order, with their translation keys. */
export const PLAY_STATUS_ORDER = [
  "playing",
  "backlog",
  "completed",
  "on_hold",
  "abandoned",
] as const;

export const PLAY_STATUS_LABEL_KEYS: Record<
  (typeof PLAY_STATUS_ORDER)[number],
  string
> = {
  playing: PLAY_STATUS_DETAILS.playing.labelKey,
  backlog: PLAY_STATUS_DETAILS.backlog.labelKey,
  completed: PLAY_STATUS_DETAILS.completed.labelKey,
  on_hold: PLAY_STATUS_DETAILS.on_hold.labelKey,
  abandoned: PLAY_STATUS_DETAILS.abandoned.labelKey,
};
