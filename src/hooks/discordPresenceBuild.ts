import type { Game } from "../types/game";
import type { PresenceActivityHint } from "../types/presence";
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
  /** Optional second line. Omitted for browsing, where a "GameIndex" value
   *  would just duplicate Discord's app-name header. */
  stateText?: string;
  startedAt?: number;
  /** Unix milliseconds. `endsAt` makes Discord render a live countdown. */
  endsAt?: number;
  detailsUrl?: string;
  largeImage?: string;
  largeText?: string;
  smallImage?: string;
  smallText?: string;
  largeUrl?: string;
  smallUrl?: string;
  statusDisplay: DiscordStatusDisplay;
  partyId?: string;
  partyCurrent?: number;
  partyMax?: number;
  /** Optional Discord activity type (`watching`, `listening`, `competing`). */
  activityType?: "playing" | "listening" | "watching" | "competing";
  buttonLabel?: string;
  buttonUrl?: string;
  button2Label?: string;
  button2Url?: string;
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

/**
 * Build the "downloading X" activity: title, progress/speed line, poster and
 * a party so Discord renders the queue position ("2 of 5"). When an ETA (or a
 * scheduled start) is known, `endsAt` drives Discord's native countdown.
 */
export function buildDownloadPresence(
  download: TorrentDownload,
  queuePosition: number,
  queueTotal: number,
  t: TranslateFn,
  statusDisplay: DiscordStatusDisplay,
  now: number = Date.now(),
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

  let endsAt: number | undefined;
  if (
    !queued &&
    download.downloadSpeed > 0 &&
    download.totalSize != null &&
    download.totalSize > download.downloaded
  ) {
    endsAt =
      now + Math.ceil((download.totalSize - download.downloaded) / download.downloadSpeed) * 1000;
  } else if (
    kind === "queued" &&
    download.scheduledStartAt &&
    download.scheduledStartAt * 1000 > now
  ) {
    endsAt = download.scheduledStartAt * 1000;
  }

  return {
    state: "downloading",
    details: queued
      ? t("discordPresence.downloadingQueued", { game: download.name })
      : t("discordPresence.downloading", { game: download.name }),
    stateText: queued
      ? t("discordPresence.downloadQueuedState")
      : progressLine || t("discordPresence.downloadStarting"),
    endsAt,
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
  largeUrl?: string;
}

/** Everything the browsing builder needs, gathered by the hook. */
export interface BrowsingContext {
  pathname: string;
  games: Game[];
  wishlistCount: number;
  installedCount: number;
  storePlatforms: string[];
  modsGameName: string | null;
  /** Real title of the store detail page, when available. */
  storeGameName: string | null;
  /** Public cover/logo URL of the store detail page, when available. */
  storeGameArt: string | null;
  /** True while the 10-foot Big Screen shell is active. */
  bigScreen: boolean;
}

/** Big Screen keeps its own shell; name the section the user is on. */
const BIG_SCREEN_SECTION_KEYS: ReadonlyArray<readonly [string, string]> = [
  ["/home", "nav.home"],
  ["/activity", "nav.home"],
  ["/library", "nav.library"],
  ["/store", "nav.store"],
  ["/wishlist", "nav.store"],
  ["/discover", "bigscreen.discover.title"],
  ["/deals", "bigscreen.discover.title"],
  ["/news", "bigscreen.discover.title"],
  ["/community", "bigscreen.discover.title"],
  ["/friends", "nav.friends"],
  ["/downloads", "nav.downloads"],
  ["/storage", "nav.storage"],
  ["/saves", "nav.saves"],
  ["/achievements", "nav.achievements"],
  ["/mods", "nav.mods"],
  ["/ports", "nav.ports"],
  ["/emulators", "nav.emulators"],
  ["/docs", "nav.docs"],
  ["/reels", "nav.reels"],
  ["/settings", "nav.settings"],
];

function bigScreenSectionLabel(pathname: string, t: TranslateFn): string | undefined {
  const match = BIG_SCREEN_SECTION_KEYS.find(
    ([base]) => pathname === base || pathname.startsWith(`${base}/`),
  );
  return match ? t(match[1]) : undefined;
}

/** Settings tab ids → their navigation labels (deep links from the sidebar). */
const SETTINGS_TAB_KEYS: Readonly<Record<string, string>> = {
  overview: "settings.nav.overview",
  general: "settings.nav.general",
  interface: "settings.nav.interface",
  appearance: "settings.nav.appearance",
  hardware: "settings.nav.hardware",
  integrations: "settings.nav.integrations",
  discord: "settings.nav.discord",
  downloads: "settings.nav.downloads",
  plugins: "settings.nav.plugins",
  launcher: "settings.nav.launcher",
  privacy: "settings.nav.privacy",
  backup: "settings.nav.backup",
  saves: "settings.nav.saves",
  diagnostics: "settings.nav.diagnostics",
  overlay: "settings.nav.overlay",
  compatibility: "settings.nav.compatibility",
};

/** Map the current route (+ page-local hints) to the browsing activity text. */
export function browsingHint(ctx: BrowsingContext, t: TranslateFn): BrowsingHint {
  const raw = ctx.pathname;
  const pathname = raw.length > 1 && raw.endsWith("/") ? raw.slice(0, -1) : raw;

  if (ctx.bigScreen) {
    const section = bigScreenSectionLabel(pathname, t);
    return {
      details: section
        ? t("discordPresence.bigScreenSection", { section })
        : t("discordPresence.bigScreen"),
    };
  }
  if (pathname === "/" || pathname === "/home") {
    return {
      details:
        ctx.games.length > 0
          ? t("discordPresence.browsingAppCount", {
              count: ctx.games.length.toLocaleString(),
            })
          : t("discordPresence.browsingApp"),
    };
  }
  if (pathname === "/library") {
    return {
      details:
        ctx.installedCount > 0
          ? t("discordPresence.browsingLibraryInstalled", {
              count: ctx.games.length.toLocaleString(),
              installed: ctx.installedCount.toLocaleString(),
            })
          : t("discordPresence.browsingLibrary", {
              count: ctx.games.length.toLocaleString(),
            }),
    };
  }
  if (pathname.startsWith("/library/")) {
    // HashRouter pathname has no hash prefix; segment [2] is the game id.
    const game = ctx.games.find((g) => g.id === pathname.split("/")[2]);
    const website = discordWebsiteUrl(game);
    return {
      details: t("discordPresence.browsingGamePage", { game: game?.name ?? "" }),
      detailsUrl: website,
      largeImage: discordAsset(game?.coverSourceUrl ?? game?.coverArtUrl),
      largeText: game?.name,
      largeUrl: website,
    };
  }
  if (pathname === "/mods/discover") {
    return { details: t("discordPresence.discoveringMods") };
  }
  if (pathname === "/mods") {
    return {
      details: ctx.modsGameName
        ? t("discordPresence.configuringMods", { game: ctx.modsGameName })
        : t("discordPresence.browsingApp"),
    };
  }
  if (pathname === "/store") {
    return {
      details:
        ctx.storePlatforms.length === 1
          ? t("discordPresence.shoppingStorePlatform", { platform: ctx.storePlatforms[0] })
          : t("discordPresence.shoppingStore"),
    };
  }
  if (pathname.startsWith("/store/")) {
    const slug = pathname.split("/")[2] ?? "";
    const name = ctx.storeGameName ?? slug.replace(/-/g, " ");
    return {
      details: t("discordPresence.storeGamePage", { game: name }),
      largeImage: discordAsset(ctx.storeGameArt),
      largeText: ctx.storeGameName ?? undefined,
    };
  }
  if (pathname === "/wishlist") {
    return {
      details: t("discordPresence.browsingWishlist", {
        count: ctx.wishlistCount.toLocaleString(),
      }),
    };
  }
  if (pathname === "/deals") return { details: t("discordPresence.browsingDeals") };
  if (pathname === "/news") return { details: t("discordPresence.browsingNews") };
  if (pathname === "/downloads") {
    return { details: t("discordPresence.browsingDownloads") };
  }
  if (pathname === "/storage") return { details: t("discordPresence.browsingStorage") };
  if (pathname === "/saves") return { details: t("discordPresence.browsingSaves") };
  if (pathname === "/ports") return { details: t("discordPresence.browsingPorts") };
  if (pathname === "/reels") return { details: t("discordPresence.browsingReels") };
  if (pathname.startsWith("/itch/")) {
    return { details: t("discordPresence.browsingItch") };
  }
  if (pathname === "/achievements") {
    return { details: t("discordPresence.browsingAchievements") };
  }
  if (pathname === "/activity") return { details: t("discordPresence.browsingActivity") };
  if (pathname === "/community") return { details: t("discordPresence.browsingCommunity") };
  if (pathname === "/friends") return { details: t("discordPresence.browsingFriends") };
  if (pathname === "/emulators" || pathname.startsWith("/emulators/")) {
    return { details: t("discordPresence.browsingEmulators") };
  }
  if (pathname === "/docs" || pathname.startsWith("/docs/")) {
    return { details: t("discordPresence.browsingDocs") };
  }
  if (pathname.startsWith("/settings/")) {
    const tabKey = SETTINGS_TAB_KEYS[pathname.split("/")[2] ?? ""];
    return {
      details: tabKey
        ? t("discordPresence.configuringSettings", { section: t(tabKey) })
        : t("discordPresence.browsingSettings"),
    };
  }
  if (pathname === "/settings") {
    return { details: t("discordPresence.browsingSettings") };
  }
  return { details: t("discordPresence.browsingApp") };
}

/**
 * Build the activity for a transient page hint: an open news article or an
 * itch.io detail page. Both outrank downloads and generic browsing, but never
 * a running game.
 */
export function buildActivityHintPresence(
  hint: PresenceActivityHint,
  t: TranslateFn,
  statusDisplay: DiscordStatusDisplay,
  startedAt = 0,
): PresencePayload {
  const url = discordAsset(hint.url);
  const image = discordAsset(hint.image);
  const largeText = hint.subtitle ?? hint.title;

  if (hint.kind === "article") {
    return {
      state: "browsing",
      details: t("discordPresence.readingArticle", { title: hint.title }),
      stateText: hint.subtitle || undefined,
      startedAt,
      detailsUrl: url,
      largeImage: image,
      largeText: image ? largeText : undefined,
      largeUrl: url,
      buttonLabel: url ? t("discordPresence.readArticle") : undefined,
      buttonUrl: url,
      statusDisplay,
    };
  }

  return {
    state: "browsing",
    details: t("discordPresence.browsingItchGame", { game: hint.title }),
    stateText: t("itch.tab"),
    startedAt,
    detailsUrl: url,
    largeImage: image,
    largeText: image ? largeText : undefined,
    largeUrl: url,
    buttonLabel: url ? t("itch.openOnItch") : undefined,
    buttonUrl: url,
    statusDisplay,
  };
}
