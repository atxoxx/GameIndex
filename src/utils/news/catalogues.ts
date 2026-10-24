import type { CuratedFeedPack, NewsFeed } from "../../types/news";

/**
 * Feed catalogues.
 *
 * These stay in the frontend on purpose: regional feeds are picked by UI
 * language (so they need translated names) and a new shipped feed should reach
 * existing installs without a database migration. The database stores only the
 * user's decisions on top of this catalogue (`news_feeds`).
 */

export const DEFAULT_FEEDS: NewsFeed[] = [
  { name: "PC Gamer", url: "https://www.pcgamer.com/rss/", isDefault: true, enabled: true, category: "pc" },
  { name: "Rock Paper Shotgun", url: "https://www.rockpapershotgun.com/feed", isDefault: true, enabled: true, category: "pc" },
  { name: "Eurogamer", url: "https://www.eurogamer.net/feed", isDefault: true, enabled: true, category: "general" },
  { name: "Gematsu", url: "https://www.gematsu.com/feed", isDefault: true, enabled: true, category: "console" },
  { name: "Kotaku", url: "https://kotaku.com/rss", isDefault: true, enabled: true, category: "general" },
  { name: "IGN", url: "https://feeds.feedburner.com/ign/all", isDefault: true, enabled: true, category: "general" },
  { name: "VGC", url: "https://www.videogameschronicle.com/feed/", isDefault: true, enabled: true, category: "general" },
];

/** Regional feeds per non-English UI language, appended to `DEFAULT_FEEDS`. */
export const REGIONAL_FEEDS: Record<string, NewsFeed[]> = {
  de: [
    { name: "Eurogamer.de", url: "https://www.eurogamer.de/feed", isDefault: true, enabled: true, category: "general", region: "de" },
    { name: "Mein-MMO", url: "https://mein-mmo.de/feed/", isDefault: true, enabled: true, category: "pc", region: "de" },
    { name: "GamesWirtschaft", url: "https://www.gameswirtschaft.de/feed/", isDefault: true, enabled: true, category: "general", region: "de" },
    { name: "PC Games Hardware", url: "https://www.pcgameshardware.de/feed/", isDefault: true, enabled: true, category: "tech", region: "de" },
    { name: "PC Games", url: "https://www.pcgames.de/feed/", isDefault: true, enabled: true, category: "pc", region: "de" },
  ],
  fr: [
    { name: "Jeuxvideo.com", url: "https://www.jeuxvideo.com/rss/rss-news.xml", isDefault: true, enabled: true, category: "general", region: "fr" },
    { name: "Gamekult", url: "https://www.gamekult.com/feed.xml", isDefault: true, enabled: true, category: "general", region: "fr" },
    { name: "ActuGaming", url: "https://www.actugaming.net/feed/", isDefault: true, enabled: true, category: "general", region: "fr" },
    { name: "Gameblog", url: "https://www.gameblog.fr/feed/", isDefault: true, enabled: true, category: "general", region: "fr" },
    { name: "Frandroid", url: "https://www.frandroid.com/feed", isDefault: true, enabled: true, category: "tech", region: "fr" },
    { name: "Journal du Geek", url: "https://www.journaldugeek.com/feed/", isDefault: true, enabled: true, category: "general", region: "fr" },
    { name: "CanardPC", url: "https://www.canardpc.com/feed", isDefault: true, enabled: true, category: "general", region: "fr" },
    { name: "IGN France", url: "https://fr.ign.com/rss", isDefault: true, enabled: true, category: "general", region: "fr" },
  ],
  es: [
    { name: "Vandal", url: "https://vandal.elespanol.com/rss/", isDefault: true, enabled: true, category: "general", region: "es" },
    { name: "Hobby Consolas", url: "https://www.hobbyconsolas.com/rss/", isDefault: true, enabled: true, category: "console", region: "es" },
    { name: "Nintenderos", url: "https://www.nintenderos.com/feed/", isDefault: true, enabled: true, category: "console", region: "es" },
    { name: "Eurogamer.es", url: "https://www.eurogamer.es/feed", isDefault: true, enabled: true, category: "general", region: "es" },
    { name: "AreaJugones", url: "https://areajugones.sport.es/feed/", isDefault: true, enabled: true, category: "general", region: "es" },
    { name: "Atomix", url: "https://www.atomix.vg/feed/", isDefault: true, enabled: true, category: "general", region: "es" },
  ],
  ru: [
    { name: "StopGame", url: "https://rss.stopgame.ru/rss_news.xml", isDefault: true, enabled: true, category: "general", region: "ru" },
    { name: "GoHa.Ru", url: "https://www.goha.ru/rss/news", isDefault: true, enabled: true, category: "general", region: "ru" },
    { name: "DTF", url: "https://dtf.ru/rss", isDefault: true, enabled: true, category: "general", region: "ru" },
    { name: "Championat Games", url: "https://www.championat.com/rss/news/games/", isDefault: true, enabled: true, category: "general", region: "ru" },
    { name: "IXBT", url: "https://www.ixbt.com/export/rss.xml", isDefault: true, enabled: true, category: "tech", region: "ru" },
    { name: "4PDA", url: "https://4pda.to/feed/", isDefault: true, enabled: true, category: "tech", region: "ru" },
  ],
  "zh-CN": [
    { name: "机核 Gcores", url: "https://www.gcores.com/rss", isDefault: true, enabled: true, category: "general", region: "zh-CN" },
    { name: "Steam 新闻", url: "https://store.steampowered.com/feeds/news/?l=schinese", isDefault: true, enabled: true, category: "general", region: "zh-CN" },
    { name: "IGN中国", url: "https://www.ign.com.cn/rss", isDefault: true, enabled: true, category: "general", region: "zh-CN" },
    { name: "IT之家", url: "https://www.ithome.com/rss/", isDefault: true, enabled: true, category: "tech", region: "zh-CN" },
  ],
};

/** Every managed (international + regional) feed, used for duplicate checks. */
export const ALL_MANAGED_FEEDS: NewsFeed[] = [
  ...DEFAULT_FEEDS,
  ...Object.values(REGIONAL_FEEDS).flat(),
];

export function getRegionalFeeds(language: string): NewsFeed[] {
  return REGIONAL_FEEDS[language] ?? [];
}

export const CURATED_FEED_PACKS: CuratedFeedPack[] = [
  {
    id: "deals_pack",
    nameKey: "news.packDealsTitle",
    descKey: "news.packDealsDesc",
    icon: "🏷️",
    category: "deals",
    feeds: [
      { name: "Reddit r/GameDeals", url: "https://www.reddit.com/r/GameDeals/.rss" },
      { name: "Reddit r/SteamDeals", url: "https://www.reddit.com/r/SteamDeals/.rss" },
      { name: "Reddit r/FreeGamesOnSteam", url: "https://www.reddit.com/r/FreeGamesOnSteam/.rss" },
      { name: "PC Gamer Deals", url: "https://www.pcgamer.com/tag/deals/rss/" },
    ],
  },
  {
    id: "indie_pack",
    nameKey: "news.packIndieTitle",
    descKey: "news.packIndieDesc",
    icon: "🕹️",
    category: "indie",
    feeds: [
      { name: "Indie Games Plus", url: "https://indiegamesplus.com/feed" },
      { name: "Alpha Beta Gamer", url: "https://www.alphabetagamer.com/feed/" },
      { name: "Pocket Tactics", url: "https://www.pockettactics.com/feed" },
      { name: "TechRaptor", url: "https://www.techraptor.net/feed" },
      { name: "The Indie Game Website", url: "https://www.indiegamewebsite.com/feed/" },
    ],
  },
  {
    id: "hardware_pack",
    nameKey: "news.packTechTitle",
    descKey: "news.packTechDesc",
    icon: "⚡",
    category: "tech",
    feeds: [
      { name: "Tom's Hardware", url: "https://www.tomshardware.com/feeds/all" },
      { name: "Ars Technica Gaming", url: "https://feeds.arstechnica.com/arstechnica/gaming" },
    ],
  },
  {
    id: "pc_pack",
    nameKey: "news.packPcTitle",
    descKey: "news.packPcDesc",
    icon: "💻",
    category: "pc",
    feeds: [
      { name: "PCGamesN", url: "https://www.pcgamesn.com/feed" },
      { name: "Rock Paper Shotgun", url: "https://www.rockpapershotgun.com/feed" },
    ],
  },
  {
    id: "console_pack",
    nameKey: "news.packConsoleTitle",
    descKey: "news.packConsoleDesc",
    icon: "🎮",
    category: "console",
    feeds: [
      { name: "Push Square", url: "https://www.pushsquare.com/feeds/latest" },
      { name: "Pure Xbox", url: "https://www.purexbox.com/feeds/latest" },
      { name: "Nintendo Life", url: "https://www.nintendolife.com/feeds/latest" },
    ],
  },
  {
    id: "rpg_japan_pack",
    nameKey: "news.packRpgJapanTitle",
    descKey: "news.packRpgJapanDesc",
    icon: "🌸",
    category: "console",
    feeds: [
      { name: "Gematsu", url: "https://www.gematsu.com/feed" },
      { name: "Siliconera", url: "https://www.siliconera.com/feed/" },
    ],
  },
  {
    id: "esports_pack",
    nameKey: "news.packEsportsTitle",
    descKey: "news.packEsportsDesc",
    icon: "🏆",
    category: "esports",
    feeds: [
      { name: "Dexerto Gaming", url: "https://www.dexerto.com/feed/" },
      { name: "Dot Esports", url: "https://dotesports.com/feed" },
      { name: "ESPN Esports", url: "https://www.espn.com/espn/rss/esports/news" },
      { name: "Esports Insider", url: "https://esportsinsider.com/feed/" },
      { name: "esports.gg", url: "https://esports.gg/feed/" },
    ],
  },
];

/**
 * Merge the shipped catalogue with the user's stored decisions.
 *
 * Catalogue fields (name, category, region, default flag) always come from the
 * catalogue so a translated or corrected feed name reaches existing installs;
 * only the enabled flag is taken from storage.
 */
export function mergeFeeds(
  stored: NewsFeed[],
  language: string,
): NewsFeed[] {
  const storedByUrl = new Map(stored.map((feed) => [feed.url.toLowerCase(), feed]));
  const catalogue = [...DEFAULT_FEEDS, ...getRegionalFeeds(language)];

  const merged = catalogue.map((feed) => {
    const override = storedByUrl.get(feed.url.toLowerCase());
    return override ? { ...feed, enabled: override.enabled } : feed;
  });

  const catalogueUrls = new Set(catalogue.map((feed) => feed.url.toLowerCase()));
  for (const feed of stored) {
    if (feed.isDefault) continue;
    if (catalogueUrls.has(feed.url.toLowerCase())) continue;
    merged.push(feed);
  }
  return merged;
}
