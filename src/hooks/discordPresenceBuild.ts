import type { Game } from "../types/game";
import type { DiscordStatusDisplay } from "../context/SettingsContext";
import { formatSpeed, type TorrentDownload } from "../types/download";
import {
  discordAsset,
  discordWebsiteUrl,
  type TranslateFn,
} from "../context/game/discordPlayingPresence";

/**
 * discordPresenceBuild
 * ────────────────────
 * Pure builders for the non-playing presence states (browsing + downloads).
 * `useDiscordPresence` owns the effect, refs and IPC throttling; everything
 * here is a side-effect-free mapping so it can be unit-tested with plain
 * inputs.
 */

/** Statuses that count as "download work in progress" for presence. Paused,
 *  seeding, errored and removed downloads are intentionally excluded. */
export const PRESENCE_DOWNLOAD_KINDS = new Set([
  "downloading",
  "fetchingMetadata",
  "queued",
]);

export interface PresencePayload {
  state: "browsing" | "downloading";
  details: string;
  /** Optional second line. Omitted for browsing, where an "GameIndex" value
   *  would just duplicate Discord's app-name header. */
  stateText?: string;
  startedAt?: number;
  detailsUrl?: string;
  largeImage?: string;
  largeText?: string;
  smallImage?: string;
  smallText?: string;
  statusDisplay: DiscordStatusDisplay;
  partyId?: string;
  partyCurrent?: number;
  partyMax?: number;
}

/** Pick the download worth broadcasting: a live transfer first, then the one
 *  fetching metadata, then whichever sits at the front of the queue. */
export function primaryDownload(downloads: TorrentDownload[]): TorrentDownload | undefined {
  const candidates = downloads.filter((d) => PRESENCE_DOWNLOAD_KINDS.has(d.status.kind));
  return (
    candidates.find((d) => d.status.kind === "downloading") ??
    candidates.find((d) => d.status.kind === "fetchingMetadata") ??
    candidates[0]
  );
}

/** Build the "downloading X" activity: title, progress/speed line, poster and
 *  a party so Discord renders the queue position ("2 of 5"). */
export function buildDownloadPresence(
  download: TorrentDownload,
  queuePosition: number,
  queueTotal: number,
  t: TranslateFn,
  statusDisplay: DiscordStatusDisplay,
): PresencePayload {
  const kind = download.status.kind;
  const queued = kind === "queued" || kind === "fetchingMetadata";
  const percent =
    download.progress != null
      ? `${Math.round(Math.max(0, Math.min(1, download.progress)) * 100)}%`
      : "";
  const speed =
    !queued && download.downloadSpeed > 0 ? formatSpeed(download.downloadSpeed) : "";
  const progressLine = [percent, speed].filter(Boolean).join(" • ");

  return {
    state: "downloading",
    details: queued
      ? t("discordPresence.downloadingQueued", { game: download.name })
      : t("discordPresence.downloading", { game: download.name }),
    stateText: queued
      ? t("discordPresence.downloadQueuedState")
      : progressLine || t("discordPresence.downloadStarting"),
    largeImage: discordAsset(download.gamePoster),
    largeText: download.name,
    smallText: t("discordPresence.smallText"),
    statusDisplay,
    partyId: queueTotal > 1 ? "gamelib-downloads" : undefined,
    partyCurrent: queueTotal > 1 ? queuePosition : undefined,
    partyMax: queueTotal > 1 ? queueTotal : undefined,
  };
}

export interface BrowsingHint {
  details: string;
  detailsUrl?: string;
  largeImage?: string;
  largeText?: string;
}

/** Map the current route (+ page-local hints) to the browsing activity text. */
export function browsingHint(
  pathname: string,
  games: Game[],
  wishlistCount: number,
  storePlatforms: string[],
  modsGameName: string | null,
  t: TranslateFn,
): BrowsingHint {
  if (pathname === "/" || pathname === "/home") {
    return { details: t("discordPresence.browsingApp") };
  }
  if (pathname === "/library") {
    return {
      details: t("discordPresence.browsingLibrary", {
        count: games.length.toLocaleString(),
      }),
    };
  }
  if (pathname.startsWith("/library/")) {
    // HashRouter pathname has no hash prefix; segment [2] is the game id.
    const game = games.find((g) => g.id === pathname.split("/")[2]);
    return {
      details: t("discordPresence.browsingGamePage", { game: game?.name ?? "" }),
      detailsUrl: discordWebsiteUrl(game),
      largeImage: discordAsset(game?.coverSourceUrl ?? game?.coverArtUrl),
      largeText: game?.name,
    };
  }
  if (pathname === "/mods") {
    return {
      details: modsGameName
        ? t("discordPresence.configuringMods", { game: modsGameName })
        : t("discordPresence.browsingApp"),
    };
  }
  if (pathname === "/store") {
    return {
      details:
        storePlatforms.length === 1
          ? t("discordPresence.shoppingStorePlatform", { platform: storePlatforms[0] })
          : t("discordPresence.shoppingStore"),
    };
  }
  if (pathname.startsWith("/store/")) {
    const slug = pathname.split("/")[2] ?? "";
    return {
      details: t("discordPresence.storeGamePage", { game: slug.replace(/-/g, " ") }),
    };
  }
  if (pathname === "/wishlist") {
    return {
      details: t("discordPresence.browsingWishlist", {
        count: wishlistCount.toLocaleString(),
      }),
    };
  }
  if (pathname === "/deals") return { details: t("discordPresence.browsingDeals") };
  if (pathname === "/news") return { details: t("discordPresence.browsingNews") };
  if (pathname === "/downloads") {
    return { details: t("discordPresence.browsingDownloads") };
  }
  if (pathname === "/storage") return { details: t("discordPresence.browsingStorage") };
  if (pathname === "/achievements") {
    return { details: t("discordPresence.browsingAchievements") };
  }
  if (pathname === "/activity") return { details: t("discordPresence.browsingActivity") };
  if (pathname === "/community") return { details: t("discordPresence.browsingCommunity") };
  if (pathname === "/friends") return { details: t("discordPresence.browsingFriends") };
  if (pathname === "/emulators") return { details: t("discordPresence.browsingEmulators") };
  if (pathname === "/docs" || pathname.startsWith("/docs/")) {
    return { details: t("discordPresence.browsingDocs") };
  }
  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    return { details: t("discordPresence.browsingSettings") };
  }
  return { details: t("discordPresence.browsingApp") };
}
