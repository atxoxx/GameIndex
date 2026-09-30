import type { Game } from "../../types/game";
import type { DiscordStatusDisplay } from "../SettingsContext";

/**
 * discordPlayingPresence
 * ──────────────────────
 * Builds the `discord-presence-update` payload for a running game. Kept as a
 * pure function (game + options + translate → payload) so both session
 * handlers in `useSessions` share one implementation and the mapping can be
 * unit-tested without a DOM, Tauri or a running Discord client.
 */

/** Minimal translate signature so the builder stays independent of the hook. */
export type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

/** Discord's large/small image must be a public https URL; data: URIs are skipped. */
export function discordAsset(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const normalized = url.startsWith("//") ? `https:${url}` : url;
  return /^https:\/\//i.test(normalized) ? normalized : undefined;
}

/** First https website URL for the "View Website" button / details link. */
export function discordWebsiteUrl(game: Game | undefined): string | undefined {
  if (!game) return undefined;
  const candidates = [...(game.websites ?? []), game.metadataUrl].filter(
    (u): u is string => typeof u === "string" && u.length > 0,
  );
  return candidates.find((u) => /^https:\/\//i.test(u));
}

/**
 * Platform store-page URL used for the secondary button. Only Steam has a
 * reliable app-id → URL mapping, so other stores fall back to no store button
 * rather than guessing a slug that may 404.
 */
export function discordStoreUrl(game: Game | undefined): string | undefined {
  if (!game?.steamAppId) return undefined;
  return `https://store.steampowered.com/app/${game.steamAppId}`;
}

export interface PlayingPresencePayload {
  state: "playing";
  gameId: string;
  gameName: string;
  startedAt: number;
  details: string;
  stateText: string;
  detailsUrl?: string;
  largeImage?: string;
  largeText?: string;
  smallImage?: string;
  smallText?: string;
  buttonLabel?: string;
  buttonUrl?: string;
  button2Label?: string;
  button2Url?: string;
  statusDisplay: DiscordStatusDisplay;
}

export interface PlayingPresenceOptions {
  /** Unix milliseconds when the session started. */
  startedAt: number;
  showArt: boolean;
  showPlaytime: boolean;
  showWebsiteButton: boolean;
  showStoreButton: boolean;
  statusDisplay: DiscordStatusDisplay;
}

/**
 * Pure mapping from a game + visibility options to the presence payload.
 *
 * `game` is optional so the builder still works when the watcher names a game
 * we haven't matched to a library entry yet.
 */
export function buildPlayingPresence(
  game: Game | undefined,
  gameId: string,
  gameName: string,
  opts: PlayingPresenceOptions,
  t: TranslateFn,
): PlayingPresencePayload {
  const website = discordWebsiteUrl(game);
  const store = discordStoreUrl(game);
  const showWebsite = opts.showWebsiteButton && !!website;
  const showStore = opts.showStoreButton && !!store && store !== website;

  const platform = game?.platform?.trim();
  const stateLine = platform
    ? t("discordPresence.playingVia", { platform })
    : t("discordPresence.playingState");
  const playTime = game?.playTime?.trim();
  const timeTotal =
    opts.showPlaytime && playTime
      ? t("discordPresence.playtimeTotal", { time: playTime })
      : "";

  return {
    state: "playing",
    gameId,
    gameName,
    startedAt: opts.showPlaytime ? opts.startedAt : 0,
    details: gameName,
    stateText: [stateLine, timeTotal].filter(Boolean).join(" • "),
    detailsUrl: showWebsite ? website : undefined,
    largeImage: opts.showArt
      ? discordAsset(game?.coverSourceUrl ?? game?.coverArtUrl)
      : undefined,
    largeText: gameName,
    smallImage: opts.showArt ? discordAsset(game?.iconUrl) : undefined,
    smallText: t("discordPresence.smallText"),
    buttonLabel: showWebsite ? t("discordPresence.viewWebsite") : undefined,
    buttonUrl: showWebsite ? website : undefined,
    button2Label: showStore ? t("discordPresence.viewStore") : undefined,
    button2Url: showStore ? store : undefined,
    statusDisplay: opts.statusDisplay,
  };
}
