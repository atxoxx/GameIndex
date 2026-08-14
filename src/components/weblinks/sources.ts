import { slugify, type Game, resolveSteamAppId } from "../../types/game";
import type { SourceCategoryKey, SourceDef, SteamSectionDef, SteamSectionKey } from "./types";
import {
  SteamIcon,
  ProtonDBIcon,
  PCGamingWikiIcon,
  IGNIcon,
  NexusModsIcon,
  ModDBIcon,
  SteamDBIcon,
  HLTBIcon,
  ITADIcon,
  MetacriticIcon,
  IGDBIcon,
  YouTubeIcon,
  TwitchIcon,
  RedditIcon,
  SpeedrunIcon,
  SteamGridDBIcon,
  GOGIcon,
  EpicGamesIcon,
  SteamStoreIcon,
  SteamHubIcon,
  SteamChatIcon,
  SteamNewsIcon,
  SteamWorkshopIcon,
  SteamScreenshotsIcon,
  SteamVideosIcon,
  SteamGuidesIcon,
  SteamAchievementsIcon,
  SteamBroadcastsIcon,
} from "./WebLinksIcons";

export const MY_LINKS_KEY = "mylinks";

export const SOURCE_CATEGORIES: { key: SourceCategoryKey; i18nKey: string }[] = [
  { key: "all", i18nKey: "weblinks.categories.all" },
  { key: "stores", i18nKey: "weblinks.categories.stores" },
  { key: "wikis", i18nKey: "weblinks.categories.wikis" },
  { key: "community", i18nKey: "weblinks.categories.community" },
  { key: "modding", i18nKey: "weblinks.categories.modding" },
  { key: "mylinks", i18nKey: "weblinks.categories.mylinks" },
];

export const FIXED_SOURCES: SourceDef[] = [
  // ─── Stores & Deals ────────────────────────────────────────────────────────
  { key: "steam", label: "Steam", category: "stores", accent: "#66c0f4", iconBg: "#1b2838", icon: SteamIcon },
  { key: "steamdb", label: "SteamDB", category: "stores", accent: "#1b9cfc", iconBg: "#0c2540", icon: SteamDBIcon },
  { key: "isthereanydeal", label: "IsThereAnyDeal", category: "stores", accent: "#2ecc71", iconBg: "#123a28", icon: ITADIcon },
  { key: "gog", label: "GOG", category: "stores", accent: "#8c52ff", iconBg: "#2c1a4d", icon: GOGIcon },
  { key: "epic", label: "Epic Games", category: "stores", accent: "#333333", iconBg: "#222222", icon: EpicGamesIcon },

  // ─── Wikis & Guides ────────────────────────────────────────────────────────
  { key: "protondb", label: "ProtonDB", category: "wikis", accent: "#7c5cff", iconBg: "#3a2d8a", icon: ProtonDBIcon },
  { key: "pcgamingwiki", label: "PCGamingWiki", category: "wikis", accent: "#d83b3b", iconBg: "#3a1c1c", icon: PCGamingWikiIcon },
  { key: "hltb", label: "HowLongToBeat", category: "wikis", accent: "#f0762e", iconBg: "#3a1f12", icon: HLTBIcon },
  { key: "metacritic", label: "Metacritic", category: "wikis", accent: "#f5c518", iconBg: "#3a2f10", icon: MetacriticIcon },
  { key: "igdb", label: "IGDB", category: "wikis", accent: "#9146ff", iconBg: "#2a154d", icon: IGDBIcon },
  { key: "ign", label: "IGN", category: "wikis", accent: "#ff3333", iconBg: "#2a0606", icon: IGNIcon },

  // ─── Community & Media ─────────────────────────────────────────────────────
  { key: "youtube", label: "YouTube", category: "community", accent: "#ff3d3d", iconBg: "#3a0f0f", icon: YouTubeIcon },
  { key: "twitch", label: "Twitch", category: "community", accent: "#a970ff", iconBg: "#381e66", icon: TwitchIcon },
  { key: "reddit", label: "Reddit", category: "community", accent: "#ff4500", iconBg: "#4a1b0b", icon: RedditIcon },

  // ─── Modding & Tools ───────────────────────────────────────────────────────
  { key: "nexusmods", label: "NexusMods", category: "modding", accent: "#d88e2b", iconBg: "#3a2810", icon: NexusModsIcon },
  { key: "moddb", label: "ModDB", category: "modding", accent: "#5ec469", iconBg: "#15351b", icon: ModDBIcon },
  { key: "speedrun", label: "Speedrun.com", category: "modding", accent: "#00c3e3", iconBg: "#063742", icon: SpeedrunIcon },
  { key: "steamgriddb", label: "SteamGridDB", category: "modding", accent: "#e056fd", iconBg: "#3d1347", icon: SteamGridDBIcon },
];

export const STEAM_SECTIONS: SteamSectionDef[] = [
  { key: "store", label: "Store", i18nKey: "weblinks.steam.store", icon: SteamStoreIcon, requiresAppId: false },
  { key: "community", label: "Community Hub", i18nKey: "weblinks.steam.community", icon: SteamHubIcon, requiresAppId: true },
  { key: "discussions", label: "Discussions", i18nKey: "weblinks.steam.discussions", icon: SteamChatIcon, requiresAppId: true },
  { key: "news", label: "News", i18nKey: "weblinks.steam.news", icon: SteamNewsIcon, requiresAppId: true },
  { key: "workshop", label: "Workshop", i18nKey: "weblinks.steam.workshop", icon: SteamWorkshopIcon, requiresAppId: true },
  { key: "guides", label: "Guides", i18nKey: "weblinks.steam.guides", icon: SteamGuidesIcon, requiresAppId: true },
  { key: "screenshots", label: "Screenshots", i18nKey: "weblinks.steam.screenshots", icon: SteamScreenshotsIcon, requiresAppId: true },
  { key: "videos", label: "Videos", i18nKey: "weblinks.steam.videos", icon: SteamVideosIcon, requiresAppId: true },
  { key: "achievements", label: "Achievements", i18nKey: "weblinks.steam.achievements", icon: SteamAchievementsIcon, requiresAppId: true },
  { key: "broadcasts", label: "Broadcasts", i18nKey: "weblinks.steam.broadcasts", icon: SteamBroadcastsIcon, requiresAppId: true },
];

export function getNexusModsDomain(gameName: string): string {
  const normalized = gameName.toLowerCase().trim();
  if (normalized.includes("cyberpunk 2077")) return "cyberpunk2077";
  if (normalized.includes("skyrim") && normalized.includes("special edition")) return "skyrimspecialedition";
  if (normalized.includes("skyrim")) return "skyrim";
  if (normalized.includes("witcher 3") || normalized.includes("witcher iii")) return "witcher3";
  if (normalized.includes("fallout 4")) return "fallout4";
  if (normalized.includes("fallout new vegas")) return "newvegas";
  if (normalized.includes("fallout 3")) return "fallout3";
  if (normalized.includes("stardew valley")) return "stardewvalley";
  if (normalized.includes("baldurs gate 3") || normalized.includes("baldur's gate 3")) return "baldursgate3";
  if (normalized.includes("monster hunter world")) return "monsterhunterworld";
  if (normalized.includes("monster hunter rise")) return "monsterhunterrise";
  if (normalized.includes("elden ring")) return "eldenring";
  if (normalized.includes("red dead redemption 2")) return "reddeadredemption2";
  if (normalized.includes("gta v") || normalized.includes("grand theft auto v")) return "grandtheftautov";
  if (normalized.includes("valheim")) return "valheim";
  if (normalized.includes("subnautica")) return "subnautica";
  if (normalized.includes("terraria")) return "terraria";
  if (normalized.includes("mount & blade ii") || normalized.includes("mount and blade 2")) return "mountandblade2bannerlord";

  const noQuotes = normalized.replace(/['’]/g, "");
  return noQuotes.replace(/[^a-z0-9]/g, "");
}

export function getModdbSlug(gameName: string): string {
  const normalized = gameName.toLowerCase().trim();
  const noQuotes = normalized.replace(/['’]/g, "");
  return noQuotes.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function getSpeedrunSlug(gameName: string): string {
  const slug = slugify(gameName);
  return slug.replace(/-/g, "_");
}

export function buildUrl(
  game: Game,
  source: string,
  steamSection: SteamSectionKey = "store",
  appId: string | null = null
): string {
  const trimmed = (source ?? "").trim();
  const enc = encodeURIComponent(game.name);

  if (!trimmed) {
    return `https://www.google.com/search?q=${enc}`;
  }

  // 1. Direct URL check (custom links, address bar navigation)
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  // 2. Serialized JSON custom link check
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.url && /^https?:\/\//i.test(parsed.url)) {
        return parsed.url;
      }
    } catch {
      // ignore
    }
  }

  // 3. My Links container key
  if (trimmed === MY_LINKS_KEY) {
    const first = (game.websites ?? []).find((w) => !!w?.trim());
    if (first) {
      return buildUrl(game, first, steamSection, appId);
    }
    return `https://www.google.com/search?q=${enc}`;
  }

  switch (trimmed) {
    case "steam": {
      if (!appId) {
        return `https://store.steampowered.com/search/?term=${enc}`;
      }
      switch (steamSection) {
        case "store":
          return `https://store.steampowered.com/app/${appId}`;
        case "community":
          return `https://steamcommunity.com/app/${appId}`;
        case "discussions":
          return `https://steamcommunity.com/app/${appId}/discussions/`;
        case "news":
          return `https://store.steampowered.com/news/app/${appId}`;
        case "workshop":
          return `https://steamcommunity.com/app/${appId}/workshop/`;
        case "guides":
          return `https://steamcommunity.com/app/${appId}/guides/`;
        case "screenshots":
          return `https://steamcommunity.com/app/${appId}/screenshots/`;
        case "videos":
          return `https://steamcommunity.com/app/${appId}/videos/`;
        case "achievements":
          return `https://steamcommunity.com/stats/${appId}/achievements`;
        case "broadcasts":
          return `https://steamcommunity.com/app/${appId}/broadcasts`;
        default:
          return `https://store.steampowered.com/app/${appId}`;
      }
    }
    case "protondb":
      return appId
        ? `https://www.protondb.com/app/${appId}`
        : `https://www.protondb.com/search?q=${enc}`;
    case "pcgamingwiki":
      return appId
        ? `https://www.pcgamingwiki.com/api/appid.php?appid=${appId}`
        : `https://www.pcgamingwiki.com/w/index.php?search=${enc}`;
    case "steamdb":
      return appId
        ? `https://steamdb.info/app/${appId}/`
        : `https://steamdb.info/search/?q=${enc}`;
    case "isthereanydeal":
      return `https://isthereanydeal.com/search/?q=${enc}`;
    case "gog":
      return game.gogGameId
        ? `https://www.gog.com/en/game/${game.gogGameId}`
        : `https://www.gog.com/en/games?query=${enc}`;
    case "epic":
      return `https://store.epicgames.com/en-US/browse?q=${enc}`;
    case "hltb":
      return `https://howlongtobeat.com/?q=${enc}`;
    case "metacritic":
      return `https://www.metacritic.com/search/${enc}/`;
    case "igdb":
      return `https://www.igdb.com/search?q=${enc}`;
    case "ign":
      return `https://www.ign.com/search?q=${enc}`;
    case "youtube":
      return `https://www.youtube.com/results?search_query=${enc}+game`;
    case "twitch":
      return `https://www.twitch.tv/directory/game/${enc}`;
    case "reddit":
      return `https://www.reddit.com/search/?q=${enc}`;
    case "nexusmods":
      return `https://www.nexusmods.com/games/${getNexusModsDomain(game.name)}`;
    case "moddb":
      return `https://www.moddb.com/games/${getModdbSlug(game.name)}`;
    case "speedrun":
      return `https://www.speedrun.com/search?q=${enc}`;
    case "steamgriddb":
      return `https://www.steamgriddb.com/search/grids?term=${enc}`;
    default:
      return `https://www.google.com/search?q=${enc}`;
  }
}

/** Extract canonical Steam AppID string using types/game resolveSteamAppId helper */
export function getSteamAppIdString(game: Game): string | null {
  const resolved = resolveSteamAppId(game);
  if (resolved != null) return String(resolved);
  return null;
}

/** Derive a label and host name from a URL */
export function deriveCustomLinkMeta(url: string): { label: string; host: string } {
  try {
    const parsed = new URL(url);
    const host = parsed.host.replace(/^www\./, "");
    const parts = host.split(".");
    const base = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    const label = base ? base.charAt(0).toUpperCase() + base.slice(1) : "Link";
    return { label, host };
  } catch {
    return { label: "Link", host: url };
  }
}
