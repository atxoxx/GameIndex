import type { ReactNode } from "react";
import {
  Boxes,
  Braces,
  Film,
  FileText,
  Hammer,
  HardDrive,
  Image,
  Images,
  Library,
  Link as LinkIcon,
  Monitor,
  Palette,
  Play,
  Settings2,
  SlidersHorizontal,
  Star,
  Tag,
  Terminal,
  Wrench,
  Workflow,
} from "lucide-react";
import {
  type EditAreaKey,
  type EditSectionKey,
  AREA_FOR_SECTION,
  DEFAULT_SECTION,
} from "./draftKeys";

export interface EditSectionDef {
  key: EditSectionKey;
  area: EditAreaKey;
  labelKey: string;
  descKey: string;
  icon: ReactNode;
}

export interface EditAreaDef {
  key: EditAreaKey;
  labelKey: string;
  icon: ReactNode;
  sections: EditSectionDef[];
}

function section(
  key: EditSectionKey,
  area: EditAreaKey,
  icon: ReactNode,
): EditSectionDef {
  return {
    key,
    area,
    labelKey: `edit.section.${key}`,
    descKey: `edit.section.${key}Desc`,
    icon,
  };
}

export const EDIT_AREAS: EditAreaDef[] = [
  {
    key: "details",
    labelKey: "edit.tab.details",
    icon: <FileText size={15} aria-hidden="true" />,
    sections: [
      section("identity", "details", <FileText size={14} aria-hidden="true" />),
      section("storage", "details", <HardDrive size={14} aria-hidden="true" />),
      section("tags", "details", <Tag size={14} aria-hidden="true" />),
      section("ratings", "details", <Star size={14} aria-hidden="true" />),
      section("catalog", "details", <Library size={14} aria-hidden="true" />),
    ],
  },
  {
    key: "media",
    labelKey: "edit.tab.media",
    icon: <Images size={15} aria-hidden="true" />,
    sections: [
      section("artwork", "media", <Palette size={14} aria-hidden="true" />),
      section("screenshots", "media", <Image size={14} aria-hidden="true" />),
      section("videos", "media", <Film size={14} aria-hidden="true" />),
      section("links", "media", <LinkIcon size={14} aria-hidden="true" />),
    ],
  },
  {
    key: "launch",
    labelKey: "edit.tab.launch",
    icon: <Play size={15} aria-hidden="true" />,
    sections: [
      section("executable", "launch", <Terminal size={14} aria-hidden="true" />),
      section("options", "launch", <SlidersHorizontal size={14} aria-hidden="true" />),
      section("automation", "launch", <Workflow size={14} aria-hidden="true" />),
      section("integrations", "launch", <Boxes size={14} aria-hidden="true" />),
    ],
  },
  {
    key: "compatibility",
    labelKey: "edit.tab.compatibility",
    icon: <Settings2 size={15} aria-hidden="true" />,
    sections: [
      section("runner", "compatibility", <Settings2 size={14} aria-hidden="true" />),
      section("graphics", "compatibility", <Monitor size={14} aria-hidden="true" />),
      section("tools", "compatibility", <Wrench size={14} aria-hidden="true" />),
      section("environment", "compatibility", <Braces size={14} aria-hidden="true" />),
      section("maintenance", "compatibility", <Hammer size={14} aria-hidden="true" />),
    ],
  },
];

export const SECTIONS_BY_KEY = EDIT_AREAS.reduce((acc, area) => {
  for (const item of area.sections) acc[item.key] = item;
  return acc;
}, {} as Record<EditSectionKey, EditSectionDef>);

export function getAreaDef(key: EditAreaKey): EditAreaDef {
  return EDIT_AREAS.find((area) => area.key === key) ?? EDIT_AREAS[0];
}

export function getSectionDef(key: EditSectionKey): EditSectionDef {
  return SECTIONS_BY_KEY[key];
}

export function getAreaForSection(key: EditSectionKey): EditAreaKey {
  return AREA_FOR_SECTION[key];
}

export function getDefaultSection(key: EditAreaKey): EditSectionKey {
  return DEFAULT_SECTION[key];
}

export function isAreaKey(value: string): value is EditAreaKey {
  return EDIT_AREAS.some((area) => area.key === value);
}

export interface EditSearchField {
  /** DOM id of the control (or of its wrapper when the control is composite). */
  id: string;
  labelKey: string;
  section: EditSectionKey;
  keywords?: string[];
}

/** Searchable fields, in rail order. Labels are resolved through `t()` so the
 *  index follows the active language. */
export const SEARCH_FIELDS: EditSearchField[] = [
  // Details → Identity
  { id: "edit-name", labelKey: "edit.label.name", section: "identity", keywords: ["title", "rename"] },
  { id: "edit-display-name", labelKey: "edit.label.displayName", section: "identity", keywords: ["label", "override", "title"] },
  { id: "edit-play-status", labelKey: "edit.label.playStatus", section: "identity", keywords: ["status", "playing", "completed", "backlog"] },
  { id: "edit-platform", labelKey: "edit.label.platform", section: "identity", keywords: ["store", "steam", "gog", "epic"] },
  { id: "edit-version", labelKey: "edit.label.version", section: "identity", keywords: ["build", "patch", "detect"] },
  { id: "edit-release-date", labelKey: "edit.label.releaseDate", section: "identity", keywords: ["launch", "released", "date"] },
  { id: "edit-developer", labelKey: "edit.label.developer", section: "identity", keywords: ["studio", "dev"] },
  { id: "edit-publisher", labelKey: "edit.label.publisher", section: "identity", keywords: ["publisher", "pub"] },
  { id: "edit-description", labelKey: "edit.label.description", section: "identity", keywords: ["summary", "about", "overview"] },
  // Details → Storage
  { id: "edit-size", labelKey: "edit.label.size", section: "storage", keywords: ["disk", "bytes", "folder", "space"] },
  { id: "edit-playtime-hours", labelKey: "edit.label.playtime", section: "storage", keywords: ["hours", "minutes", "played"] },
  { id: "edit-purchase-cost", labelKey: "edit.label.purchaseCost", section: "storage", keywords: ["cost", "price", "value", "currency", "spent"] },
  // Details → Tags
  { id: "edit-genres", labelKey: "edit.label.genres", section: "tags", keywords: ["genre", "category"] },
  { id: "edit-themes", labelKey: "edit.label.themes", section: "tags", keywords: ["theme", "setting"] },
  { id: "edit-modes", labelKey: "edit.label.gameModes", section: "tags", keywords: ["singleplayer", "multiplayer", "co-op"] },
  { id: "edit-perspectives", labelKey: "edit.label.perspectives", section: "tags", keywords: ["camera", "view", "first-person"] },
  { id: "edit-storyline", labelKey: "edit.label.storyline", section: "tags", keywords: ["story", "narrative"] },
  // Details → Ratings
  { id: "edit-igdb-rating", labelKey: "edit.label.igdbRating", section: "ratings", keywords: ["score", "rating", "igdb"] },
  { id: "edit-critic-rating", labelKey: "edit.label.criticRating", section: "ratings", keywords: ["score", "metacritic", "critic"] },
  { id: "edit-hltb-main", labelKey: "edit.label.hltbMain", section: "ratings", keywords: ["how long to beat", "hltb", "length"] },
  { id: "edit-hltb-extra", labelKey: "edit.label.hltbExtra", section: "ratings", keywords: ["how long to beat", "hltb", "extra"] },
  { id: "edit-hltb-comple", labelKey: "edit.label.hltbComple", section: "ratings", keywords: ["how long to beat", "hltb", "completionist"] },
  // Details → Catalog
  { id: "edit-collection", labelKey: "edit.label.series", section: "catalog", keywords: ["series", "collection"] },
  { id: "edit-franchise", labelKey: "edit.label.franchise", section: "catalog", keywords: ["franchise"] },
  { id: "edit-game-category", labelKey: "edit.label.gameType", section: "catalog", keywords: ["dlc", "expansion", "type"] },
  { id: "edit-release-status", labelKey: "edit.label.releaseStatus", section: "catalog", keywords: ["early access", "released"] },
  { id: "edit-is-vr", labelKey: "edit.label.isVr", section: "catalog", keywords: ["vr", "virtual reality"] },
  { id: "edit-similar-games", labelKey: "edit.label.similarGames", section: "catalog", keywords: ["similar", "related"] },
  { id: "edit-alternative-names", labelKey: "edit.label.alternativeNames", section: "catalog", keywords: ["alias", "alternate title"] },
  { id: "edit-metadata-source", labelKey: "edit.label.metadataSource", section: "catalog", keywords: ["igdb", "steam", "launchbox", "source"] },
  { id: "edit-metadata-url", labelKey: "edit.label.metadataUrl", section: "catalog", keywords: ["url", "link", "source"] },
  { id: "edit-releases", labelKey: "edit.label.releases", section: "catalog", keywords: ["release", "platform", "region"] },
  { id: "edit-languages", labelKey: "edit.label.supportedLanguages", section: "catalog", keywords: ["language", "audio", "subtitles"] },
  // Media
  { id: "edit-artwork-cover", labelKey: "edit.label.cover", section: "artwork", keywords: ["cover", "poster", "artwork", "box art"] },
  { id: "edit-artwork-hero", labelKey: "edit.label.hero", section: "artwork", keywords: ["hero", "banner", "background", "artwork"] },
  { id: "edit-artwork-logo", labelKey: "edit.label.logo", section: "artwork", keywords: ["logo", "title image", "artwork"] },
  { id: "edit-artwork-icon", labelKey: "edit.label.icon", section: "artwork", keywords: ["icon", "artwork"] },
  { id: "edit-screenshots", labelKey: "editExtras.screenshots", section: "screenshots", keywords: ["screenshots", "images", "gallery"] },
  { id: "edit-videos", labelKey: "editExtras.videosTrailers", section: "videos", keywords: ["videos", "trailers", "youtube"] },
  { id: "edit-websites", labelKey: "editExtras.websites", section: "links", keywords: ["links", "website", "wiki"] },
  // Launch
  { id: "edit-path", labelKey: "edit.label.executablePath", section: "executable", keywords: ["exe", "binary", "path", "launch"] },
  { id: "edit-extra-executables", labelKey: "edit.execExtrasTitle", section: "executable", keywords: ["extra", "alternate", "exe", "profiles"] },
  { id: "edit-launch-arguments", labelKey: "edit.label.launchArguments", section: "options", keywords: ["args", "flags", "command line"] },
  { id: "edit-run-as-admin", labelKey: "edit.runAsAdmin", section: "options", keywords: ["admin", "elevated", "uac"] },
  { id: "edit-steam-launch-selection", labelKey: "edit.showSteamLaunchSelection", section: "options", keywords: ["steam", "launch options"] },
  { id: "edit-pre-launch-script", labelKey: "edit.tab.scripts", section: "automation", keywords: ["script", "before", "pre-launch"] },
  { id: "edit-companion-apps", labelKey: "edit.tab.companionApps", section: "automation", keywords: ["companion", "auxiliary", "server"] },
  { id: "edit-mo2-launch", labelKey: "edit.mo2LaunchTitle", section: "integrations", keywords: ["mod organizer", "mo2", "mods"] },
  { id: "edit-untracked", labelKey: "edit.doNotTrack", section: "integrations", keywords: ["tracking", "playtime", "privacy"] },
  // Compatibility
  { id: "compat-enabled", labelKey: "gameEdit.compatibility.bannerTitle", section: "runner", keywords: ["compatibility", "wine", "proton", "layer", "enable"] },
  { id: "compat-runner", labelKey: "gameEdit.compatibility.runnerSelection", section: "runner", keywords: ["proton", "wine", "runner"] },
  { id: "compat-prefix", labelKey: "gameEdit.compatibility.winePrefix", section: "runner", keywords: ["prefix", "wineprefix"] },
  { id: "compat-working-dir", labelKey: "gameEdit.compatibility.workingDir", section: "runner", keywords: ["working directory", "cwd"] },
  { id: "compat-dxvk", labelKey: "gameEdit.compatibility.dxvkTitle", section: "graphics", keywords: ["dxvk", "direct3d", "vulkan"] },
  { id: "compat-vkd3d", labelKey: "gameEdit.compatibility.vkd3dTitle", section: "graphics", keywords: ["vkd3d", "direct3d 12", "vulkan"] },
  { id: "compat-esync", labelKey: "gameEdit.compatibility.esyncTitle", section: "graphics", keywords: ["sync", "cpu"] },
  { id: "compat-fsync", labelKey: "gameEdit.compatibility.fsyncTitle", section: "graphics", keywords: ["sync", "futex"] },
  { id: "compat-specific-gpu", labelKey: "gameEdit.compatibility.specificGpuTitle", section: "graphics", keywords: ["gpu", "vulkan", "prime"] },
  { id: "compat-dxvk-hud", labelKey: "gameEdit.compatibility.dxvkHud", section: "graphics", keywords: ["hud", "fps", "overlay"] },
  { id: "compat-mangohud", labelKey: "gameEdit.compatibility.mangohudTitle", section: "tools", keywords: ["mangohud", "fps", "overlay"] },
  { id: "compat-gamemode", labelKey: "gameEdit.compatibility.gamemodeTitle", section: "tools", keywords: ["gamemode", "performance"] },
  { id: "compat-gamescope", labelKey: "gameEdit.compatibility.gamescopeTitle", section: "tools", keywords: ["gamescope", "scaling", "fsr"] },
  { id: "compat-env-vars", labelKey: "gameEdit.compatibility.envVars", section: "environment", keywords: ["environment", "variables", "env"] },
  { id: "compat-dlls", labelKey: "gameEdit.compatibility.dllOverrides", section: "environment", keywords: ["dll", "overrides", "winedlloverrides"] },
  { id: "compat-pre-launch", labelKey: "gameEdit.compatibility.preLaunchCommand", section: "environment", keywords: ["wrapper", "taskset", "prime-run"] },
  { id: "compat-maintenance", labelKey: "gameEdit.compatibility.maintenanceTools", section: "maintenance", keywords: ["winecfg", "winetricks", "regedit", "prefix"] },
];

export function fieldsForSection(section: EditSectionKey): EditSearchField[] {
  return SEARCH_FIELDS.filter((field) => field.section === section);
}
