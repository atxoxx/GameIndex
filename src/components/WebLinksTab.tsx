import { useEffect, useMemo, useState, useRef } from "react";
import type { ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, LogicalPosition } from "@tauri-apps/api/dpi";
import { slugify, type Game } from "../types/game";
import { useBigScreen } from "../context/BigScreenContext";
import { useLanguage } from "../context/LanguageContext";
import { useFocusable } from "../hooks/useFocusable";

interface WebLinksTabProps {
  game: Game;
  visible?: boolean;
  onWebsitesChange?: (websites: string[]) => void;
}

type FixedSourceKey =
  | "steam"
  | "protondb"
  | "pcgamingwiki"
  | "ign"
  | "nexusmods"
  | "moddb"
  | "steamdb"
  | "hltb"
  | "isthereanydeal"
  | "metacritic"
  | "youtube";

type SteamSectionKey =
  | "store"
  | "discussions"
  | "news"
  | "workshop"
  | "screenshots"
  | "videos"
  | "guides";

interface SourceDef {
  /** Either a FixedSourceKey or a full user-added URL (for custom sources). */
  key: string;
  label: string;
  /** Brand color for the active-tab accent. */
  accent: string;
  /** Background gradient for the icon chip. */
  iconBg: string;
  /** Inline SVG for the source's logo. */
  icon: ReactNode;
  /** Raw URL — set for user-added custom sources (used as the key too). */
  url?: string;
}

interface SteamSectionDef {
  key: SteamSectionKey;
  label: string;
  i18nKey: string;
  icon: ReactNode;
}

/** Key of the special "My Links" source tab that hosts user-added URLs. */
const MY_LINKS_KEY = "mylinks";

// ─── Steam AppID Detection ────────────────────────────────────────────────────

/**
 * Try to extract a Steam AppID from a game's executable path. Steam games
 * sometimes launch via a `steam://run/{appid}` URI or have an executable file
 * literally named `{appid}.exe` inside `steamapps/common/`. Returns null if no
 * AppID can be detected.
 *
 * NOTE: best-effort only — most modern Steam installs name the executable
 * after the game (e.g. `hl2.exe`, `portal2.exe`) rather than the AppID, so
 * callers should treat a `null` return as "fall back to a search URL" and
 * surface that gracefully in the UI.
 */
function extractSteamAppId(game: Game): string | null {
  const path = game.path || "";
  const rungame = path.match(/steam:\/\/run(?:gameid)?\/(\d+)/i);
  if (rungame) return rungame[1];
  const appidExe = path.match(/[\\/](\d+)\.exe$/i);
  if (appidExe) return appidExe[1];

  const urlsToCheck = [
    ...(game.metadataUrl ? [game.metadataUrl] : []),
    ...(game.websites ?? [])
  ];
  for (const u of urlsToCheck) {
    const m = u.match(/store\.steampowered\.com\/app\/(\d+)/i);
    if (m) return m[1];
  }

  if (game.platform === "Steam" && /^\d+$/.test(game.id)) {
    return game.id;
  }
  return null;
}

function getNexusModsDomain(gameName: string): string {
  const normalized = gameName.toLowerCase().trim();

  // Custom manual mappings for extremely common games
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

  // Default fallback: slugify without hyphens (after stripping quotes)
  const noQuotes = normalized.replace(/['’]/g, "");
  return noQuotes.replace(/[^a-z0-9]/g, "");
}

function getModdbSlug(gameName: string): string {
  const normalized = gameName.toLowerCase().trim();
  const noQuotes = normalized.replace(/['’]/g, "");
  return noQuotes.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ─── URL Builders ─────────────────────────────────────────────────────────────

/**
 * Build a URL for the selected source. Falls back to a site-specific search
 * page when no AppID is available so the user always lands on a relevant
 * page even for non-Steam games.
 */
function buildUrl(
  game: Game,
  source: FixedSourceKey,
  steamSection: SteamSectionKey,
  appId: string | null
): string {
  const enc = encodeURIComponent(game.name);
  if (source === "steam") {
    if (!appId) {
      return `https://store.steampowered.com/search/?term=${enc}`;
    }
    switch (steamSection) {
      case "store":
        return `https://store.steampowered.com/app/${appId}`;
      case "discussions":
        return `https://steamcommunity.com/app/${appId}/discussions/`;
      case "news":
        return `https://store.steampowered.com/news/app/${appId}`;
      case "workshop":
        return `https://steamcommunity.com/app/${appId}/workshop/`;
      case "screenshots":
        return `https://steamcommunity.com/app/${appId}/screenshots/`;
      case "videos":
        return `https://steamcommunity.com/app/${appId}/videos/`;
      case "guides":
        return `https://steamcommunity.com/app/${appId}/guides/`;
    }
  }
  if (source === "protondb") {
    return appId
      ? `https://www.protondb.com/app/${appId}`
      : `https://www.protondb.com/search?q=${enc}`;
  }
  if (source === "pcgamingwiki") {
    return appId
      ? `https://www.pcgamingwiki.com/api/appid.php?appid=${appId}`
      : `https://www.pcgamingwiki.com/w/index.php?search=${enc}`;
  }
  if (source === "ign") {
    return `https://www.ign.com/search?q=${enc}`;
  }
  if (source === "nexusmods") {
    const domain = getNexusModsDomain(game.name);
    return `https://www.nexusmods.com/games/${domain}`;
  }
  if (source === "moddb") {
    const slug = getModdbSlug(game.name);
    return `https://www.moddb.com/games/${slug}`;
  }
  if (source === "steamdb") {
    return appId
      ? `https://steamdb.info/app/${appId}/`
      : `https://steamdb.info/search/?q=${enc}`;
  }
  if (source === "hltb") {
    return `https://howlongtobeat.com/?q=${enc}`;
  }
  if (source === "isthereanydeal") {
    return `https://isthereanydeal.com/search/?q=${enc}`;
  }
  if (source === "metacritic") {
    return `https://www.metacritic.com/search/game/${slugify(game.name)}/results`;
  }
  if (source === "youtube") {
    return `https://www.youtube.com/results?search_query=${enc}`;
  }
  return "about:blank";
}

// ─── SVG Icons (inline, theme-friendly) ───────────────────────────────────────

const SteamIcon = (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="12" r="10" />
    <circle cx="15.5" cy="9.5" r="2.5" />
    <circle cx="9" cy="14" r="1.6" />
    <path d="M2 15l5.5 2.2a3 3 0 0 0 4.7-3l5.6 1.5a2.4 2.4 0 1 0 .5-1.9L13 10.2a3 3 0 0 0-5.4-.4L2 7.6V15z" opacity="0.25" />
  </svg>
);

const ProtonDBIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="3" />
    <line x1="12" y1="2" x2="12" y2="9" />
    <line x1="12" y1="15" x2="12" y2="22" />
    <line x1="2" y1="12" x2="9" y2="12" />
    <line x1="15" y1="12" x2="22" y2="12" />
  </svg>
);

const PCGamingWikiIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
    <line x1="9" y1="9" x2="15" y2="15" />
    <line x1="15" y1="9" x2="9" y2="15" />
  </svg>
);

const IGNIcon = (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <rect x="2" y="3" width="20" height="18" rx="2" />
    <text x="12" y="16" fontSize="11" fontWeight="900" textAnchor="middle" fill="currentColor" fontFamily="sans-serif">IGN</text>
  </svg>
);

const NexusModsIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 22 8 22 16 12 22 2 16 2 8" />
    <line x1="12" y1="2" x2="12" y2="22" />
    <line x1="2" y1="8" x2="22" y2="16" />
    <line x1="22" y1="8" x2="2" y2="16" />
  </svg>
);

const ModDBIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7h18v10H3z" />
    <path d="M7 7v10" />
    <path d="M11 7v10" />
    <path d="M15 7l4 5-4 5" />
  </svg>
);

const SteamDBIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
    <path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" />
  </svg>
);

const HLTBIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </svg>
);

const ITADIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="5" x2="5" y2="19" />
    <circle cx="6.5" cy="6.5" r="2.5" />
    <circle cx="17.5" cy="17.5" r="2.5" />
  </svg>
);

const MetacriticIcon = (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <text x="12" y="16.5" fontSize="13" fontWeight="900" textAnchor="middle" fill="currentColor" fontFamily="sans-serif">M</text>
  </svg>
);

const YouTubeIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="5" width="20" height="14" rx="4" ry="4" />
    <path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
  </svg>
);

const CustomLinkIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const OpenExternalIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

const ReloadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

const BackIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const ForwardIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const SteamStoreIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="21" r="1" />
    <circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
  </svg>
);

const SteamChatIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const SteamNewsIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2" />
    <path d="M18 14h-8M15 18h-5M10 6h8M10 10h8" />
  </svg>
);

const SteamWorkshopIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </svg>
);

const SteamScreenshotsIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="2" ry="2" />
    <circle cx="8.5" cy="10" r="1.5" />
    <path d="M21 17l-5-5L5 21" />
  </svg>
);

const SteamVideosIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="5" width="14" height="14" rx="2" ry="2" />
    <path d="M16 9l6-3v12l-6-3z" />
  </svg>
);

const SteamGuidesIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

const FixedSources: SourceDef[] = [
  { key: "steam", label: "Steam", accent: "#66c0f4", iconBg: "#1b2838", icon: SteamIcon },
  { key: "protondb", label: "ProtonDB", accent: "#7c5cff", iconBg: "#3a2d8a", icon: ProtonDBIcon },
  { key: "pcgamingwiki", label: "PCGamingWiki", accent: "#d83b3b", iconBg: "#3a1c1c", icon: PCGamingWikiIcon },
  { key: "ign", label: "IGN", accent: "#ff3333", iconBg: "#2a0606", icon: IGNIcon },
  { key: "steamdb", label: "SteamDB", accent: "#1b9cfc", iconBg: "#0c2540", icon: SteamDBIcon },
  { key: "metacritic", label: "Metacritic", accent: "#f5c518", iconBg: "#3a2f10", icon: MetacriticIcon },
  { key: "hltb", label: "HowLongToBeat", accent: "#f0762e", iconBg: "#3a1f12", icon: HLTBIcon },
  { key: "isthereanydeal", label: "IsThereAnyDeal", accent: "#2ecc71", iconBg: "#123a28", icon: ITADIcon },
  { key: "youtube", label: "YouTube", accent: "#ff3d3d", iconBg: "#3a0f0f", icon: YouTubeIcon },
  { key: "nexusmods", label: "NexusMods", accent: "#d88e2b", iconBg: "#3a2810", icon: NexusModsIcon },
  { key: "moddb", label: "ModDB", accent: "#5ec469", iconBg: "#15351b", icon: ModDBIcon },
];

const SteamSections: SteamSectionDef[] = [
  { key: "store", label: "Store", i18nKey: "weblinks.steam.store", icon: SteamStoreIcon },
  { key: "discussions", label: "Discussions", i18nKey: "weblinks.steam.discussions", icon: SteamChatIcon },
  { key: "news", label: "News", i18nKey: "weblinks.steam.news", icon: SteamNewsIcon },
  { key: "workshop", label: "Workshop", i18nKey: "weblinks.steam.workshop", icon: SteamWorkshopIcon },
  { key: "screenshots", label: "Screenshots", i18nKey: "weblinks.steam.screenshots", icon: SteamScreenshotsIcon },
  { key: "videos", label: "Videos", i18nKey: "weblinks.steam.videos", icon: SteamVideosIcon },
  { key: "guides", label: "Guides", i18nKey: "weblinks.steam.guides", icon: SteamGuidesIcon },
];

/** Derive a display label + host for a user-added URL. */
function deriveCustomLink(url: string): { label: string; host: string } {
  try {
    const parsed = new URL(url);
    const host = parsed.host.replace(/^www\./, "");
    const parts = host.split(".");
    // Use the second-level domain (e.g. "steamcommunity" from "steamcommunity.com").
    const base = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    const label = base ? base.charAt(0).toUpperCase() + base.slice(1) : "Link";
    return { label, host };
  } catch {
    return { label: "Link", host: url };
  }
}

/** Favicon chip for a custom link, with a graceful fallback icon on error. */
function CustomFavicon({ host }: { host: string }) {
  const [failed, setFailed] = useState(false);
  if (failed || !host) {
    return (
      <span className="wl-mylink-favicon-fallback">
        <CustomLinkIcon />
      </span>
    );
  }
  return (
    <img
      className="wl-mylink-favicon-img"
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

// ─── Keyboard navigation for tab strips ───────────────────────────────────────

/**
 * Roving tabindex + arrow-key navigation shared by the outer source tablist
 * and the Steam sub-tablist. `onSelect(index)` is invoked with the newly
 * selected tab's index; the tab itself is focused here.
 */
function handleTabListKeyDown(e: React.KeyboardEvent<HTMLDivElement>, onSelect: (index: number) => void) {
  const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  if (tabs.length === 0) return;
  const current = tabs.findIndex((t) => t.tabIndex === 0);
  let next = current;
  if (e.key === "ArrowRight") next = (current + 1) % tabs.length;
  else if (e.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = tabs.length - 1;
  else return;
  e.preventDefault();
  onSelect(next);
  tabs[next].focus();
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function WebLinksTab({ game, visible = true, onWebsitesChange }: WebLinksTabProps) {
  const { t } = useLanguage();
  /** True when the parent supplies onWebsitesChange (editable mode). */
  const editable = typeof onWebsitesChange === "function";
  const [activeSource, setActiveSource] = useState<string>("steam");
  const [steamSection, setSteamSection] = useState<SteamSectionKey>("store");
  /** URL of the custom link currently loaded in the preview (My Links tab). */
  const [customPreviewUrl, setCustomPreviewUrl] = useState<string | null>(null);
  /** Bumped (via Reload) to force webview recreation. */
  const [reloadNonce, setReloadNonce] = useState(0);
  /** True briefly after the user copies the current URL to the clipboard. */
  const [copied, setCopied] = useState(false);
  /** Add-link input value (My Links panel, editable mode only). */
  const [linkInput, setLinkInput] = useState("");
  /** Validation error for the add-link input, if any. */
  const [linkError, setLinkError] = useState<string | null>(null);
  /** Whether the webview can go back / forward (tracked via URL polling). */
  const [navState, setNavState] = useState<{ back: boolean; forward: boolean }>({ back: false, forward: false });
  /** Stack of URLs visited inside the current webview (index = current page). */
  const navHistoryRef = useRef<string[]>([]);
  const navIndexRef = useRef(0);

  const appId = useMemo(() => extractSteamAppId(game), [game.path, game.platform]);

  /** Custom URLs from Edit form / metadata scraper, de-duped (case-insensitive). */
  const customLinks = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const u of game.websites ?? []) {
      const trimmed = (u ?? "").trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
    return out;
  }, [game.websites]);

  /** Each custom URL becomes a card inside the My Links tab. */
  const customSources = useMemo<SourceDef[]>(() => {
    return customLinks.map((url) => {
      const meta = deriveCustomLink(url);
      return {
        key: url,
        label: meta.label,
        accent: "var(--color-accent)",
        iconBg: "var(--color-bg-tertiary)",
        icon: <CustomLinkIcon />,
        url,
      };
    });
  }, [customLinks]);

  const isMyLinksActive = activeSource === MY_LINKS_KEY;

  // The custom URL currently shown in the preview (first link by default).
  const activeCustomUrl = useMemo(() => {
    if (!isMyLinksActive || customSources.length === 0) return null;
    if (customPreviewUrl && customSources.some((s) => s.url === customPreviewUrl)) {
      return customPreviewUrl;
    }
    return customSources[0].url ?? null;
  }, [isMyLinksActive, customSources, customPreviewUrl]);

  const activeSourceDef = useMemo(
    () => FixedSources.find((s) => s.key === activeSource) ?? FixedSources[0],
    [activeSource]
  );
  const isSteamActive = activeSource === "steam";
  const isCustomActive = activeCustomUrl !== null;

  // URL to embed in the webview.
  const url = useMemo(() => {
    if (activeCustomUrl) return activeCustomUrl;
    return buildUrl(game, activeSource as FixedSourceKey, steamSection, appId);
  }, [game, activeSource, steamSection, appId, activeCustomUrl]);

  // Steam sub-sections that REQUIRE an AppID (no useful search URL exists).
  const steamSubDisabled = isSteamActive && steamSection !== "store" && !appId;

  // The URL bar + preview only make sense when there is a URL to show.
  // My Links with zero custom links renders just the empty-state panel.
  const hasPreviewableUrl = !isMyLinksActive || customSources.length > 0;

  const { isBigScreen } = useBigScreen();

  const bigScreenLinks = useMemo(() => {
    const list: { label: string; url: string; icon: ReactNode; accent: string; iconBg: string; disabled?: boolean }[] = [];

    // Steam links
    const steamStoreUrl = appId ? `https://store.steampowered.com/app/${appId}` : `https://store.steampowered.com/search/?term=${encodeURIComponent(game.name)}`;
    list.push({ label: "Steam Store", url: steamStoreUrl, icon: SteamIcon, accent: "#66c0f4", iconBg: "#1b2838" });

    list.push({
      label: "Steam Discussions",
      url: appId ? `https://steamcommunity.com/app/${appId}/discussions/` : "",
      icon: SteamChatIcon,
      accent: "#66c0f4",
      iconBg: "#1b2838",
      disabled: !appId
    });
    list.push({
      label: "Steam News",
      url: appId ? `https://store.steampowered.com/news/app/${appId}` : "",
      icon: SteamNewsIcon,
      accent: "#66c0f4",
      iconBg: "#1b2838",
      disabled: !appId
    });
    list.push({
      label: "Steam Workshop",
      url: appId ? `https://steamcommunity.com/app/${appId}/workshop/` : "",
      icon: SteamWorkshopIcon,
      accent: "#66c0f4",
      iconBg: "#1b2838",
      disabled: !appId
    });
    list.push({
      label: "Steam Guides",
      url: appId ? `https://steamcommunity.com/app/${appId}/guides/` : "",
      icon: SteamGuidesIcon,
      accent: "#66c0f4",
      iconBg: "#1b2838",
      disabled: !appId
    });

    // ProtonDB
    const protonUrl = appId ? `https://www.protondb.com/app/${appId}` : `https://www.protondb.com/search?q=${encodeURIComponent(game.name)}`;
    list.push({ label: "ProtonDB", url: protonUrl, icon: ProtonDBIcon, accent: "#7c5cff", iconBg: "#3a2d8a" });

    // PCGamingWiki
    const pcgwUrl = appId ? `https://www.pcgamingwiki.com/api/appid.php?appid=${appId}` : `https://www.pcgamingwiki.com/w/index.php?search=${encodeURIComponent(game.name)}`;
    list.push({ label: "PCGamingWiki", url: pcgwUrl, icon: PCGamingWikiIcon, accent: "#d83b3b", iconBg: "#3a1c1c" });

    // SteamDB
    const steamdbUrl = appId ? `https://steamdb.info/app/${appId}/` : `https://steamdb.info/search/?q=${encodeURIComponent(game.name)}`;
    list.push({ label: "SteamDB", url: steamdbUrl, icon: SteamDBIcon, accent: "#1b9cfc", iconBg: "#0c2540" });

    // HowLongToBeat
    list.push({ label: "HowLongToBeat", url: `https://howlongtobeat.com/?q=${encodeURIComponent(game.name)}`, icon: HLTBIcon, accent: "#f0762e", iconBg: "#3a1f12" });

    // IsThereAnyDeal
    list.push({ label: "IsThereAnyDeal", url: `https://isthereanydeal.com/search/?q=${encodeURIComponent(game.name)}`, icon: ITADIcon, accent: "#2ecc71", iconBg: "#123a28" });

    // Metacritic
    list.push({ label: "Metacritic", url: `https://www.metacritic.com/search/game/${slugify(game.name)}/results`, icon: MetacriticIcon, accent: "#f5c518", iconBg: "#3a2f10" });

    // YouTube
    list.push({ label: "YouTube", url: `https://www.youtube.com/results?search_query=${encodeURIComponent(game.name)}`, icon: YouTubeIcon, accent: "#ff3d3d", iconBg: "#3a0f0f" });

    // IGN
    list.push({ label: "IGN Search", url: `https://www.ign.com/search?q=${encodeURIComponent(game.name)}`, icon: IGNIcon, accent: "#ff3333", iconBg: "#2a0606" });

    // NexusMods
    const nexusDomain = getNexusModsDomain(game.name);
    list.push({ label: "NexusMods", url: `https://www.nexusmods.com/games/${nexusDomain}`, icon: NexusModsIcon, accent: "#d88e2b", iconBg: "#3a2810" });

    // ModDB
    const moddbSlug = getModdbSlug(game.name);
    list.push({ label: "ModDB", url: `https://www.moddb.com/games/${moddbSlug}`, icon: ModDBIcon, accent: "#5ec469", iconBg: "#15351b" });

    // Custom links
    customLinks.forEach((cUrl) => {
      const meta = deriveCustomLink(cUrl);
      list.push({
        label: meta.label,
        url: cUrl,
        icon: <CustomLinkIcon />,
        accent: "var(--color-accent)",
        iconBg: "var(--color-bg-tertiary)"
      });
    });

    return list;
  }, [game, appId, customLinks]);

  if (isBigScreen) {
    return (
      <div className="wl-tab-bigscreen" style={{ padding: "10px 0" }}>
        <h3 style={{ margin: "0 0 20px 0" }}>{t("weblinks.title")}</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "16px" }}>
          {bigScreenLinks.map((link, idx) => (
            <BigScreenLinkCard key={idx} link={link} />
          ))}
        </div>
      </div>
    );
  }

  async function handleOpenExternal(targetUrl?: string) {
    const urlToOpen = targetUrl ?? url;
    try {
      await openUrl(urlToOpen);
    } catch (err) {
      console.error("openUrl failed:", err);
      window.open(urlToOpen, "_blank", "noopener,noreferrer");
    }
  }

  function handleReload() {
    setReloadNonce((n) => n + 1);
  }

  /** Recompute the back/forward button state from the local history stack. */
  function updateNavState() {
    const idx = navIndexRef.current;
    const len = navHistoryRef.current.length;
    setNavState({ back: idx > 0, forward: idx < len - 1 });
  }

  function handleGoBack() {
    if (!webviewInstanceState || !navState.back) return;
    // Optimistically move the index so the buttons react instantly; the
    // URL poll reconciles against the webview's actual history.
    navIndexRef.current -= 1;
    updateNavState();
    invoke("webview_history_navigate", {
      label: webviewInstanceState.label,
      direction: "back",
    }).catch((e: any) => console.error("goBack failed:", e));
  }

  function handleGoForward() {
    if (!webviewInstanceState || !navState.forward) return;
    navIndexRef.current += 1;
    updateNavState();
    invoke("webview_history_navigate", {
      label: webviewInstanceState.label,
      direction: "forward",
    }).catch((e: any) => console.error("goForward failed:", e));
  }

  async function handleCopy() {
    const text = activeCustomUrl ?? url;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Clipboard API unavailable (web preview) — legacy fallback.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
      } catch {
        // ignore
      }
      document.body.removeChild(ta);
    }
    window.setTimeout(() => setCopied(false), 1600);
  }

  /** Validate and append a user-typed link to the game's website list. */
  function handleAddLink() {
    if (!onWebsitesChange) return;
    const trimmed = linkInput.trim();
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      setLinkError(t("weblinks.addLinkInvalid"));
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      setLinkError(t("weblinks.addLinkInvalid"));
      return;
    }
    if (customLinks.some((u) => u.toLowerCase() === trimmed.toLowerCase())) {
      setLinkError(t("weblinks.addLinkInvalid"));
      return;
    }
    onWebsitesChange([...customLinks, trimmed]);
    setLinkInput("");
    setLinkError(null);
    setCustomPreviewUrl(trimmed);
  }

  // ─── Webview preview state ─────────────────────────────────────────────
  // Native Tauri Webview overlays the placeholder container. Pages are
  // fully interactive and bypass the X-Frame-Options restrictions that
  // made iframe-based previews unreliable.
  const [webviewReady, setWebviewReady] = useState(false);

  useEffect(() => {
    setWebviewReady(false);
  }, [url, reloadNonce]);

  // ─── Webview lifecycle & geometry sync ──────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const [webviewInstanceState, setWebviewInstanceState] = useState<Webview | null>(null);

  /** Latest `visible` prop, readable from the poll interval closure. */
  const visibleRef = useRef(visible);
  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  // Initialize and recreate webview on url/nonce change
  useEffect(() => {
    let active = true;
    let webviewInst: any = null;

    // ── Navigation history tracking ───────────────────────────────
    // Tauri exposes no canGoBack/canGoForward and no JS-visible
    // navigation event, so we poll the webview's current URL and rebuild
    // a small history stack from the deltas: a URL we've already seen
    // means back/forward navigation (index moves to it), a new URL
    // truncates forward entries and pushes. The buttons derive their
    // disabled state from where the index sits in that stack.
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    async function pollCurrentUrl() {
      if (!webviewInst || !active || !visibleRef.current) return;
      try {
        const current = await invoke<string>("webview_current_url", {
          label: webviewInst.label,
        });
        if (!current) return;
        const hist = navHistoryRef.current;
        const idx = navIndexRef.current;
        if (hist[idx] === current) return; // unchanged
        const known = hist.indexOf(current);
        if (known !== -1) {
          // Back/forward landed on an already-recorded URL.
          navIndexRef.current = known;
        } else {
          // Brand-new page: drop forward entries, then append.
          const truncated = hist.slice(0, idx + 1);
          truncated.push(current);
          navHistoryRef.current = truncated;
          navIndexRef.current = truncated.length - 1;
        }
        updateNavState();
      } catch (e) {
        // webview closed or mid-navigation — ignore
      }
    }

    async function initWebview() {
      if (steamSubDisabled || !url) {
        // If we are showing empty state, close any existing webviews
        try {
          const allWebviews = await Webview.getAll();
          for (const wv of allWebviews) {
            if (wv.label.startsWith("weblinks-preview-")) {
              await wv.close();
            }
          }
        } catch (e) {
          // ignore
        }
        return;
      }

      // Close existing webviews first to avoid label collisions
      try {
        const allWebviews = await Webview.getAll();
        for (const wv of allWebviews) {
          if (wv.label.startsWith("weblinks-preview-")) {
            await wv.close();
          }
        }
      } catch (e) {
        // ignore
      }

      if (!active || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const uniqueLabel = "weblinks-preview-" + Math.random().toString(36).substring(2, 9);

      try {
        const appWindow = getCurrentWindow();
        const webview = new Webview(appWindow, uniqueLabel, {
          url,
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        });

        if (!active) {
          webview.close().catch(() => {});
          return;
        }

        webviewInst = webview;
        setWebviewInstanceState(webview);

        // Reset history for the fresh webview and start polling.
        navHistoryRef.current = [url];
        navIndexRef.current = 0;
        setNavState({ back: false, forward: false });
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(pollCurrentUrl, 500);

        // Mark as ready immediately so the HTML spinner disappears and reveals the webview
        setWebviewReady(true);

        webview.once("tauri://error", (e) => {
          console.error("Webview creation error:", e);
        });
      } catch (err) {
        console.error("Failed to create webview:", err);
      }
    }

    initWebview();

    return () => {
      active = false;
      setWebviewInstanceState(null);
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (webviewInst) {
        webviewInst.close().catch(() => {});
      } else {
        Webview.getAll().then((all) => {
          for (const wv of all) {
            if (wv.label.startsWith("weblinks-preview-")) {
              wv.close().catch(() => {});
            }
          }
        }).catch(() => {});
      }
    };
  }, [url, steamSubDisabled, reloadNonce]);

  // Keep webview sized and positioned over placeholder
  useEffect(() => {
    if (!containerRef.current || !webviewInstanceState) return;

    const handleResize = () => {
      if (!containerRef.current || !webviewInstanceState) return;
      const rect = containerRef.current.getBoundingClientRect();

      webviewInstanceState.setPosition(new LogicalPosition(rect.left, rect.top))
        .catch((e: any) => console.error("Error setting webview position:", e));
      webviewInstanceState.setSize(new LogicalSize(rect.width, rect.height))
        .catch((e: any) => console.error("Error setting webview size:", e));
    };

    // Trigger initial layout sync
    handleResize();

    const observer = new ResizeObserver(() => {
      handleResize();
    });

    observer.observe(containerRef.current);
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleResize, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleResize, true);
    };
  }, [webviewInstanceState]);

  // Handle visibility transitions (hiding webview when modals are open)
  useEffect(() => {
    if (!webviewInstanceState) return;
    if (visible) {
      webviewInstanceState.show().catch((e: any) => console.error("Error showing webview:", e));
    } else {
      webviewInstanceState.hide().catch((e: any) => console.error("Error hiding webview:", e));
    }
  }, [webviewInstanceState, visible]);

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="wl-tab">
      {/* ─── Outer source TABS (fixed sources + My Links) ──────────── */}
      <div
        className="wl-source-tabs"
        role="tablist"
        onKeyDown={(e) =>
          handleTabListKeyDown(e, (i) => {
            const all = [...FixedSources, { key: MY_LINKS_KEY }];
            const item = all[i];
            if (item.key === MY_LINKS_KEY) setActiveSource(MY_LINKS_KEY);
            else setActiveSource(item.key);
          })
        }
      >
        {FixedSources.map((src) => {
          const isActive = activeSource === src.key;
          return (
            <button
              key={src.key}
              role="tab"
              tabIndex={isActive ? 0 : -1}
              aria-selected={isActive}
              className={`wl-source-tab${isActive ? " active" : ""}`}
              onClick={() => setActiveSource(src.key)}
              style={
                isActive
                  ? {
                      color: src.accent,
                      borderBottomColor: src.accent,
                      background: `linear-gradient(180deg, ${src.iconBg}33, transparent)`,
                    }
                  : undefined
              }
            >
              <span
                className="wl-source-tab-icon"
                style={{ background: isActive ? src.iconBg : "var(--color-bg-tertiary)" }}
              >
                {src.icon}
              </span>
              <span>{src.label}</span>
            </button>
          );
        })}

        {/* My Links tab — hosts all user-added custom URLs */}
        <button
          key={MY_LINKS_KEY}
          role="tab"
          tabIndex={isMyLinksActive ? 0 : -1}
          aria-selected={isMyLinksActive}
          className={`wl-source-tab mylinks${isMyLinksActive ? " active" : ""}`}
          onClick={() => setActiveSource(MY_LINKS_KEY)}
          style={
            isMyLinksActive
              ? {
                  color: "var(--color-accent)",
                  borderBottomColor: "var(--color-accent)",
                  background: "linear-gradient(180deg, var(--color-accent-soft), transparent)",
                }
              : undefined
          }
        >
          <span className="wl-source-tab-icon">
            <CustomLinkIcon />
          </span>
          <span>{t("weblinks.myLinks")}</span>
          {customSources.length > 0 && (
            <span className="wl-source-tab-count">{customSources.length}</span>
          )}
        </button>
      </div>

      {/* ─── My Links panel: favicon card grid or empty state ───────── */}
      {isMyLinksActive && (
        <div className="wl-mylinks">
          {editable && (
            <div className="wl-mylinks-add">
              <input
                className="wl-mylinks-add-input"
                type="url"
                placeholder={t("weblinks.addLinkPlaceholder")}
                aria-label={t("weblinks.addLink")}
                value={linkInput}
                onChange={(e) => {
                  setLinkInput(e.target.value);
                  if (linkError) setLinkError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddLink();
                  }
                }}
              />
              <button
                className="wl-mylinks-add-btn"
                type="button"
                onClick={handleAddLink}
                disabled={!linkInput.trim()}
              >
                {t("weblinks.addLink")}
              </button>
              {linkError && <div className="wl-mylinks-add-error">{linkError}</div>}
              <div className="wl-mylinks-add-hint">{t("weblinks.addLinkHint")}</div>
            </div>
          )}
          {customSources.length === 0 ? (
            <div className="wl-mylinks-empty">
              <span className="wl-mylinks-empty-icon">
                <CustomLinkIcon />
              </span>
              <div className="wl-mylinks-empty-text">
                <h4>{t("weblinks.noCustomLinks")}</h4>
                <p>{t("weblinks.noCustomLinksBody")}</p>
              </div>
            </div>
          ) : (
            <div className="wl-mylinks-grid">
              {customSources.map((src) => {
                const isActive = activeCustomUrl === src.url;
                const meta = deriveCustomLink(src.url ?? "");
                return (
                  <div key={src.key} className={`wl-mylink-card${isActive ? " active" : ""}`}>
                    <button
                      type="button"
                      className="wl-mylink-card-main"
                      onClick={() => setCustomPreviewUrl(src.url ?? null)}
                      title={t("weblinks.openInPreview")}
                    >
                      <span className="wl-mylink-favicon">
                        <CustomFavicon host={meta.host} />
                      </span>
                      <span className="wl-mylink-card-text">
                        <span className="wl-mylink-card-label">{src.label}</span>
                        <span className="wl-mylink-card-host">{meta.host}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="wl-mylink-card-open"
                      onClick={() => src.url && handleOpenExternal(src.url)}
                      title={t("weblinks.openInBrowser")}
                    >
                      <OpenExternalIcon />
                    </button>
                    {editable && src.url && (
                      <button
                        type="button"
                        className="wl-mylink-card-remove"
                        aria-label={t("weblinks.removeLink")}
                        title={t("weblinks.removeLink")}
                        onClick={() => src.url && onWebsitesChange(customLinks.filter((u) => u !== src.url))}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          width="12"
                          height="12"
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─── Steam sub-tabs (only when Steam tab is active) ──────────── */}
      {isSteamActive && (
        <div
          className="wl-steam-subtabs"
          role="tablist"
          onKeyDown={(e) =>
            handleTabListKeyDown(e, (i) => {
              const sec = SteamSections[i];
              // Mirror the click guard: only Store (or any section with an
              // AppID) can be activated — disabled sections are skipped.
              if (sec.key === "store" || appId) setSteamSection(sec.key);
            })
          }
        >
          {SteamSections.map((sec) => {
            const isActive = steamSection === sec.key;
            const disabled = sec.key !== "store" && !appId;
            return (
              <button
                key={sec.key}
                role="tab"
                tabIndex={isActive ? 0 : -1}
                aria-selected={isActive}
                aria-disabled={disabled}
                disabled={disabled}
                className={`wl-steam-subtab${isActive ? " active" : ""}${disabled ? " disabled" : ""}`}
                onClick={() => !disabled && setSteamSection(sec.key)}
                title={disabled ? t("weblinks.steamAppIdNotDetected") : undefined}
              >
                <span className="wl-steam-subtab-icon">{sec.icon}</span>
                <span>{t(sec.i18nKey)}</span>
                {disabled && (
                  <span className="wl-steam-subtab-lock" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* ─── URL bar (controls over the webview) ──────────────────────── */}
      {hasPreviewableUrl && (
        <div
          className="wl-urlbar"
          style={{
            borderColor: isCustomActive
              ? "var(--color-accent)55"
              : `${activeSourceDef.accent}55`,
          }}
        >
          <div className="wl-urlbar-nav">
            <button
              className={`wl-urlbar-btn${navState.back ? "" : " disabled"}`}
              onClick={handleGoBack}
              type="button"
              disabled={!navState.back}
              title={t("weblinks.goBack")}
              aria-label={t("weblinks.goBack")}
            >
              <BackIcon />
            </button>
            <button
              className={`wl-urlbar-btn${navState.forward ? "" : " disabled"}`}
              onClick={handleGoForward}
              type="button"
              disabled={!navState.forward}
              title={t("weblinks.goForward")}
              aria-label={t("weblinks.goForward")}
            >
              <ForwardIcon />
            </button>
          </div>
          <span
            className="wl-urlbar-source-chip"
            style={{
              background: isCustomActive
                ? "var(--color-bg-tertiary)"
                : activeSourceDef.iconBg,
              color: isCustomActive ? "var(--color-accent)" : activeSourceDef.accent,
            }}
          >
            {isCustomActive
              ? deriveCustomLink(activeCustomUrl ?? "").label
              : activeSourceDef.label}
          </span>
          <span className="wl-urlbar-url" title={url}>
            {url.replace(/^https?:\/\//, "").replace(/^www\./, "")}
          </span>
          <div className="wl-urlbar-actions">
            <button className="wl-urlbar-btn" onClick={handleReload} type="button" title={t("weblinks.reloadPreview")}>
              <ReloadIcon />
              <span>{t("weblinks.reload")}</span>
            </button>
            <button
              className={`wl-urlbar-btn${copied ? " copied" : ""}`}
              onClick={handleCopy}
              type="button"
              title={t("weblinks.copyLink")}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              <span>{copied ? t("weblinks.copied") : t("weblinks.copy")}</span>
            </button>
            <button
              className="wl-urlbar-btn primary"
              onClick={() => handleOpenExternal()}
              type="button"
              title={t("weblinks.openInBrowser")}
            >
              <OpenExternalIcon />
              <span>{t("weblinks.openBrowser")}</span>
            </button>
          </div>
        </div>
      )}

      {/* ─── Preview area: Tauri native webview overlaid on placeholder ── */}
      {hasPreviewableUrl && (
        <div className="wl-preview">
          {steamSubDisabled ? (
            // Steam sub-page (Discussions/News/Workshop) without an AppID
            <div className="wl-empty">
              <div className="wl-empty-header">
                <span
                  className="wl-empty-icon"
                  style={{ color: activeSourceDef.accent, background: activeSourceDef.iconBg }}
                >
                  {SteamSections.find((s) => s.key === steamSection)?.icon}
                </span>
                <h3>{t("weblinks.steamAppIdNotDetected")}</h3>
              </div>
              <p>
                {t("weblinks.steamAppIdNotDetectedBody", {
                  section: SteamSections.find((s) => s.key === steamSection)?.label ?? "",
                  game: game.name,
                  appid: "{appid}",
                })}
              </p>
              <button className="wl-empty-btn primary" onClick={() => handleOpenExternal()} type="button">
                <OpenExternalIcon />
                {t("weblinks.steam.searchStore")}
              </button>
            </div>
          ) : isSteamActive && !appId ? (
            // Steam Store fallback (search URL is reasonable)
            <div className="wl-empty subtle">
              <div className="wl-empty-header">
                <span
                  className="wl-empty-icon"
                  style={{ color: activeSourceDef.accent, background: activeSourceDef.iconBg }}
                >
                  {SteamIcon}
                </span>
                <h3>{t("weblinks.steamSearchMode")}</h3>
              </div>
              <p>
                {t("weblinks.steamSearchModeBody", { game: game.name })}
              </p>
            </div>
          ) : null}

          {/* Native Webview container placeholder */}
          {!steamSubDisabled && (
            <div ref={containerRef} className="wl-webview-frame">
              {!webviewReady && (
                <div className="wl-webview-loader" aria-hidden>
                  <div className="wl-webview-spinner" />
                  <span>{t("weblinks.loading", { source: isCustomActive ? t("weblinks.myLinks") : activeSourceDef.label })}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Footnote */}
      <div className="wl-footnote">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>
          {t("weblinks.footnote")}
        </span>
      </div>
    </div>
  );
}

function BigScreenLinkCard({
  link,
}: {
  link: { label: string; url: string; icon: ReactNode; accent: string; iconBg: string; disabled?: boolean };
}) {
  const handleOpen = async () => {
    if (link.disabled) return;
    try {
      await openUrl(link.url);
    } catch {
      window.open(link.url, "_blank", "noopener,noreferrer");
    }
  };

  const focusProps = useFocusable(handleOpen);

  return (
    <button
      type="button"
      className={`bigscreen-system-menu-item${link.disabled ? " disabled" : ""}`}
      {...(link.disabled ? {} : focusProps)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "14px",
        padding: "14px 18px",
        border: "1px solid transparent",
        borderRadius: "8px",
        background: link.disabled ? "rgba(255,255,255,0.01)" : "rgba(255, 255, 255, 0.02)",
        opacity: link.disabled ? 0.3 : 1,
        textAlign: "left",
        width: "100%",
        cursor: link.disabled ? "default" : "pointer"
      }}
      disabled={link.disabled}
    >
      <div
        className="wl-source-tab-icon"
        style={{
          background: link.iconBg,
          color: link.accent,
          width: "32px",
          height: "32px",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          borderRadius: "6px"
        }}
      >
        <span style={{ width: "16px", height: "16px", display: "block" }}>{link.icon}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "14px", fontWeight: "600", color: "var(--color-text-primary)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>{link.label}</div>
        {!link.disabled && (
          <div style={{ fontSize: "11px", color: "var(--color-text-muted)", marginTop: "3px", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
            {link.url.replace(/^https?:\/\//, "").replace(/^www\./, "")}
          </div>
        )}
      </div>
    </button>
  );
}
