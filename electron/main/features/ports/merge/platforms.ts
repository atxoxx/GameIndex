/**
 * Platform names differ on every source (`N64`, `Nintendo 64`, `n64`,
 * `PC (Windows)`, `windows`). This module folds them into one display label so
 * grouping, filters and sections line up across catalogs.
 */

function key(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

const PLATFORM_ALIASES: Record<string, string> = {
  n64: "Nintendo 64",
  nintendo64: "Nintendo 64",
  snes: "Super Nintendo",
  supernintendo: "Super Nintendo",
  superfamicom: "Super Nintendo",
  supernintendosuperfamicom: "Super Nintendo",
  supernintendoentertainmentsystem: "Super Nintendo",
  nes: "NES",
  famicom: "NES",
  nintendoentertainmentsystem: "NES",
  gb: "Game Boy",
  gameboy: "Game Boy",
  gbc: "Game Boy Color",
  gameboycolor: "Game Boy Color",
  gba: "Game Boy Advance",
  gameboyadvance: "Game Boy Advance",
  nds: "Nintendo DS",
  ds: "Nintendo DS",
  nintendods: "Nintendo DS",
  "3ds": "Nintendo 3DS",
  nintendo3ds: "Nintendo 3DS",
  gc: "GameCube",
  gamecube: "GameCube",
  nintendogamecube: "GameCube",
  wii: "Wii",
  nintendowii: "Wii",
  wiiu: "Wii U",
  nintendowiiu: "Wii U",
  switch: "Nintendo Switch",
  nintendoswitch: "Nintendo Switch",
  switch2: "Nintendo Switch 2",
  nintendoswitch2: "Nintendo Switch 2",
  virtualboy: "Virtual Boy",
  nintendovirtualboy: "Virtual Boy",
  ps1: "PlayStation",
  psx: "PlayStation",
  playstation: "PlayStation",
  playstation1: "PlayStation",
  ps2: "PlayStation 2",
  playstation2: "PlayStation 2",
  ps3: "PlayStation 3",
  playstation3: "PlayStation 3",
  ps4: "PlayStation 4",
  playstation4: "PlayStation 4",
  ps5: "PlayStation 5",
  playstation5: "PlayStation 5",
  psp: "PlayStation Portable",
  playstationportable: "PlayStation Portable",
  psvita: "PS Vita",
  vita: "PS Vita",
  playstationvita: "PS Vita",
  xbox: "Xbox",
  xbox360: "Xbox 360",
  xboxone: "Xbox One",
  xboxseries: "Xbox Series",
  xboxseriesxs: "Xbox Series",
  genesis: "Genesis",
  megadrive: "Genesis",
  segagenesis: "Genesis",
  mastersystem: "Master System",
  segamastersystem: "Master System",
  saturn: "Saturn",
  segasaturn: "Saturn",
  dreamcast: "Dreamcast",
  segadreamcast: "Dreamcast",
  segacd: "Sega CD",
  megacd: "Sega CD",
  "32x": "32X",
  sega32x: "32X",
  arcade: "Arcade",
  pc: "PC",
  pcwindows: "PC",
  windows: "PC",
  microsoftwindows: "PC",
  pcdos: "DOS",
  dos: "DOS",
  msdos: "DOS",
  mac: "Mac",
  macos: "Mac",
  osx: "Mac",
  macosx: "Mac",
  macintosh: "Mac",
  mobile: "Mobile",
  android: "Mobile",
  ios: "Mobile",
  amiga: "Amiga",
  c64: "Commodore 64",
  commodore64: "Commodore 64",
  msx: "MSX",
  msx2: "MSX2",
  pc98: "PC-98",
  pc88: "PC-88",
  x68000: "X68000",
  ngage: "N-Gage",
  "3do": "3DO",
  cdi: "CD-i",
  jaguar: "Jaguar",
};

const SMALL_WORDS = new Set(["of", "the", "and", "a", "an", "de", "la"]);

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((word, index) => {
      if (index > 0 && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase();
      if (/^[A-Z0-9-]{2,}$/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/** Canonical original-platform label. Unknown labels keep their title case. */
export function canonicalPlatform(raw: string): string {
  const value = raw.replace(/\s+/g, " ").trim();
  if (!value) return "";
  return PLATFORM_ALIASES[key(value)] ?? titleCase(value);
}

/** Canonical supported-target label, or null for noise. */
export function canonicalTarget(raw: string): string | null {
  const value = raw.replace(/\s+/g, " ").trim();
  if (!value) return null;
  const k = key(value);
  if (k === "windows" || k === "win" || k === "win64" || k === "windows64") return "Windows";
  if (k === "linux" || k === "linux64") return "Linux";
  if (k === "macos" || k === "mac" || k === "osx" || k === "macosx" || k === "darwin")
    return "macOS";
  if (k === "android") return "Android";
  if (k === "ios") return "iOS";
  if (k === "steamdeck") return "Steam Deck";
  if (k === "switch" || k === "nintendoswitch") return "Nintendo Switch";
  if (k === "wiiu") return "Wii U";
  if (k === "wii") return "Wii";
  if (k === "3ds" || k === "nintendo3ds") return "Nintendo 3DS";
  if (k === "psvita" || k === "vita") return "PS Vita";
  if (k === "psp" || k === "playstationportable") return "PlayStation Portable";
  if (k === "ps4" || k === "playstation4") return "PlayStation 4";
  if (k === "ps5" || k === "playstation5") return "PlayStation 5";
  if (k === "xboxone") return "Xbox One";
  if (k === "xboxseries" || k === "xboxseriesxs") return "Xbox Series";
  if (k === "web" || k === "browser" || k === "html5") return "Web";
  // Unknown values are dropped instead of becoming a bogus platform badge.
  return null;
}

/** Vendor/family for the details panel, derived from the original platform. */
export function vendorForPlatform(platform: string): string {
  const value = platform.toLowerCase();
  // Check SEGA first: "genesis" contains "nes".
  if (/^(genesis|mega drive|saturn|dreamcast|master system|sega|32x|sega cd)/.test(value))
    return "SEGA";
  if (/^(nintendo|super nintendo|nes|snes|famicom|game boy|gamecube|wii|virtual boy)/.test(value))
    return "Nintendo";
  if (/^(playstation|ps vita|psp)/.test(value)) return "Sony";
  if (/^xbox/.test(value)) return "Microsoft";
  if (/^arcade/.test(value)) return "Arcade";
  if (/^(pc|dos|windows|mac)/.test(value)) return "PC";
  return "";
}

const TARGET_ORDER = ["Windows", "macOS", "Linux"];

/** Deduplicated targets with the card trio first. */
export function sortTargets(targets: string[]): string[] {
  const unique = [...new Set(targets.filter(Boolean))];
  return unique.sort((a, b) => {
    const ai = TARGET_ORDER.indexOf(a);
    const bi = TARGET_ORDER.indexOf(b);
    if (ai !== -1 || bi !== -1) {
      return (ai === -1 ? TARGET_ORDER.length : ai) - (bi === -1 ? TARGET_ORDER.length : bi);
    }
    return a.localeCompare(b);
  });
}
