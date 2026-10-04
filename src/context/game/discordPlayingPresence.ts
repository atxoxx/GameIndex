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
 * Public poster URL used for the large activity image. Discord fetches
 * activity art server-side, so only the original https source
 * (`coverSourceUrl`) is usable — the stored `coverArtUrl` is usually a
 * data/asset URI that Discord cannot load.
 */
export function discordPoster(game: Game | undefined): string | undefined {
  return discordAsset(game?.coverSourceUrl ?? game?.coverArtUrl);
}

/**
 * Public logo URL for the small activity badge. Prefers the tracked original
 * https source of the current logo (`logoSourceUrl`), then a legacy
 * `logoUrl` already stored as https, then derives the Steam CDN logo from
 * the app id. Falls back to `undefined` when the game has none, so callers
 * can show the poster instead.
 */
export function discordGameLogo(game: Game | undefined): string | undefined {
  const source = discordAsset(game?.logoSourceUrl);
  if (source) return source;
  const stored = discordAsset(game?.logoUrl);
  if (stored) return stored;
  if (game?.steamAppId) {
    return `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.steamAppId}/logo.png`;
  }
  return undefined;
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
  largeUrl?: string;
  smallUrl?: string;
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
  /** Adds developer/year to the art hover and the version to the icon hover,
   *  and makes the art clickable. */
  showExtraDetails: boolean;
  /** Appends achievement progress to the status line. */
  showAchievements: boolean;
  statusDisplay: DiscordStatusDisplay;
  /** Transient "achievement unlocked" line that temporarily replaces the
   *  status line (already localized). */
  unlockText?: string;
  /** Unlocked/total achievement counts for the running game. */
  achievement?: { unlocked: number; total: number };
}

/** Best-effort release year from a stored release date ("2017-02-24" → "2017"). */
function releaseYear(releaseDate: string | undefined): string | undefined {
  return releaseDate?.match(/\b(19|20)\d{2}\b/)?.[0];
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
  const achievement =
    opts.showAchievements && opts.achievement && opts.achievement.total > 0
      ? t("discordPresence.achievementsProgress", {
          unlocked: opts.achievement.unlocked,
          total: opts.achievement.total,
          percent: Math.round((opts.achievement.unlocked / opts.achievement.total) * 100),
        })
      : "";

  const stateText = opts.unlockText
    ? opts.unlockText
    : [stateLine, achievement, timeTotal].filter(Boolean).join(" • ");

  const credits = [game?.developer, releaseYear(game?.releaseDate)]
    .filter(Boolean)
    .join(", ");
  const largeText =
    opts.showExtraDetails && credits ? `${gameName} · ${credits}` : gameName;
  const smallText =
    opts.showExtraDetails && game?.version ? game.version : t("discordPresence.smallText");

  const poster = discordPoster(game);
  // The small badge shows the game logo and falls back to the poster when no
  // public logo is available.
  const logo = discordGameLogo(game) ?? poster;

  return {
    state: "playing",
    gameId,
    gameName,
    startedAt: opts.showPlaytime ? opts.startedAt : 0,
    details: gameName,
    stateText,
    detailsUrl: showWebsite ? website : undefined,
    largeImage: opts.showArt ? poster : undefined,
    largeText,
    smallImage: opts.showArt ? logo : undefined,
    smallText,
    largeUrl: opts.showExtraDetails ? website : undefined,
    smallUrl: opts.showExtraDetails ? store : undefined,
    buttonLabel: showWebsite ? t("discordPresence.viewWebsite") : undefined,
    buttonUrl: showWebsite ? website : undefined,
    button2Label: showStore ? t("discordPresence.viewStore") : undefined,
    button2Url: showStore ? store : undefined,
    statusDisplay: opts.statusDisplay,
  };
}
