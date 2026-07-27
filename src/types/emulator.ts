/**
 * Frontend mirror of the Rust `EmulatorData` struct persisted in the
 * `emulators` SQLite domain. One instance per configured emulator; each
 * is linked to exactly one ROM folder (`romFolder`).
 */
export interface Emulator {
  id: string;
  name: string;
  /** Console platform, e.g. "GameCube", "PlayStation 2". Surfaces as the
   *  ROM's `platform` in the library so it's filterable/sortable. */
  platform: string;
  /** Absolute path to the emulator executable. */
  executablePath: string;
  /** Launch-argument template; `%ROM%` is replaced with the ROM path. */
  argumentsTemplate: string;
  /** Absolute path to the linked ROM folder (flat scan). */
  romFolder: string;
  notes?: string;
  iconUrl?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * A curated, extensible catalog of well-known emulators. Each entry
 * pre-fills the editor (executable name, supported file extensions, a
 * sensible launch-argument default and an accent colour). To add
 * support for a new emulator, append one entry here — the backend's
 * `rom_extensions_for_platform` uses the same `platform` string to
 * decide which files to scan.
 *
 * `platform` values MUST match the backend table in `lib.rs`
 * (`rom_extensions_for_platform`) so scanning recognises the ROMs.
 */
export interface KnownEmulator {
  key: string;
  name: string;
  platform: string;
  /** Default executable file name (without path) shown as a hint. */
  executableName: string;
  /** Supported ROM file extensions (lowercase, no dot). */
  extensions: string[];
  /** Default launch-argument template. */
  argumentsTemplate: string;
  /** Accent colour (hex) used for the card + console badge. */
  accent: string;
  /** Short glyph/emoji shown on the card. */
  glyph: string;
  description: string;
}

export const KNOWN_EMULATORS: KnownEmulator[] = [
  {
    key: "retroarch",
    name: "RetroArch",
    platform: "RetroArch",
    executableName: "retroarch.exe",
    extensions: ["zip", "7z", "iso", "bin", "cue", "rom"],
    argumentsTemplate: '"%ROM%"',
    accent: "#8b5cf6",
    glyph: "🕹️",
    description:
      "All-in-one multi-system frontend. Pair it with the right core for each console.",
  },
  {
    key: "dolphin",
    name: "Dolphin",
    platform: "GameCube",
    executableName: "Dolphin.exe",
    extensions: ["iso", "gcm", "rvz", "gcz"],
    argumentsTemplate: '"%ROM%"',
    accent: "#22d3ee",
    glyph: "🐬",
    description: "GameCube & Wii emulator.",
  },
  {
    key: "dolphin-wii",
    name: "Dolphin (Wii)",
    platform: "Wii",
    executableName: "Dolphin.exe",
    extensions: ["iso", "wbfs", "rvz", "gcz"],
    argumentsTemplate: '"%ROM%"',
    accent: "#06b6d4",
    glyph: "🐬",
    description: "Dolphin configured for Wii discs.",
  },
  {
    key: "pcsx2",
    name: "PCSX2",
    platform: "PlayStation 2",
    executableName: "pcsx2.exe",
    extensions: ["iso", "bin", "cue", "chd", "img", "gz"],
    argumentsTemplate: '"%ROM%"',
    accent: "#f59e0b",
    glyph: "🟢",
    description: "PlayStation 2 emulator.",
  },
  {
    key: "ppsspp",
    name: "PPSSPP",
    platform: "PlayStation Portable",
    executableName: "PPSSPPWindows.exe",
    extensions: ["iso", "cso", "pbp"],
    argumentsTemplate: '"%ROM%"',
    accent: "#10b981",
    glyph: "🎮",
    description: "PlayStation Portable emulator.",
  },
  {
    key: "duckstation",
    name: "DuckStation",
    platform: "PlayStation",
    executableName: "duckstation.exe",
    extensions: ["iso", "bin", "cue", "img", "pbp", "chd"],
    argumentsTemplate: '"%ROM%"',
    accent: "#ef4444",
    glyph: "💿",
    description: "PlayStation 1 emulator.",
  },
  {
    key: "citra",
    name: "Citra",
    platform: "Nintendo 3DS",
    executableName: "citra.exe",
    extensions: ["3ds", "cia", "cxi"],
    argumentsTemplate: '"%ROM%"',
    accent: "#3b82f6",
    glyph: "🍊",
    description: "Nintendo 3DS emulator.",
  },
  {
    key: "yuzu",
    name: "Yuzu",
    platform: "Nintendo Switch",
    executableName: "yuzu.exe",
    extensions: ["xci", "nsp"],
    argumentsTemplate: '"%ROM%"',
    accent: "#6366f1",
    glyph: "🍋",
    description: "Nintendo Switch emulator.",
  },
  {
    key: "cemu",
    name: "Cemu",
    platform: "Wii U",
    executableName: "Cemu.exe",
    extensions: ["wud", "wux", "rpx"],
    argumentsTemplate: '-g "%ROM%"',
    accent: "#14b8a6",
    glyph: "🟦",
    description: "Wii U emulator.",
  },
  {
    key: "snes9x",
    name: "Snes9x",
    platform: "Super Nintendo",
    executableName: "snes9x.exe",
    extensions: ["smc", "sfc", "swc", "fig"],
    argumentsTemplate: '"%ROM%"',
    accent: "#a855f7",
    glyph: "🟣",
    description: "Super Nintendo Entertainment System emulator.",
  },
  {
    key: "mesen",
    name: "Mesen",
    platform: "NES",
    executableName: "Mesen.exe",
    extensions: ["nes"],
    argumentsTemplate: '"%ROM%"',
    accent: "#eab308",
    glyph: "🟡",
    description: "NES / Famicom emulator.",
  },
  {
    key: "mgba",
    name: "mGBA",
    platform: "Game Boy Advance",
    executableName: "mgba.exe",
    extensions: ["gba"],
    argumentsTemplate: '"%ROM%"',
    accent: "#84cc16",
    glyph: "🟩",
    description: "Game Boy / Color / Advance emulator.",
  },
  {
    key: "desmume",
    name: "DeSmuME",
    platform: "Nintendo DS",
    executableName: "DeSmuME.exe",
    extensions: ["nds"],
    argumentsTemplate: '"%ROM%"',
    accent: "#0ea5e9",
    glyph: "💠",
    description: "Nintendo DS emulator.",
  },
  {
    key: "project64",
    name: "Project64",
    platform: "Nintendo 64",
    executableName: "Project64.exe",
    extensions: ["n64", "z64", "v64"],
    argumentsTemplate: '"%ROM%"',
    accent: "#f97316",
    glyph: "🔶",
    description: "Nintendo 64 emulator.",
  },
  {
    key: "demul",
    name: "Demul",
    platform: "Sega Dreamcast",
    executableName: "demul.exe",
    extensions: ["cdi", "gdi", "chd"],
    argumentsTemplate: '"%ROM%"',
    accent: "#0d9488",
    glyph: "🟢",
    description: "Sega Dreamcast emulator.",
  },
  {
    key: "rpcn",
    name: "RPCS3",
    platform: "PlayStation 3",
    executableName: "rpcs3.exe",
    extensions: ["iso", "pkg", "rap"],
    argumentsTemplate: '"%ROM%"',
    accent: "#0ea5e9",
    glyph: "🔵",
    description: "PlayStation 3 emulator.",
  },
  {
    key: "xenia",
    name: "Xenia",
    platform: "Xbox 360",
    executableName: "xenia.exe",
    extensions: ["iso", "xex"],
    argumentsTemplate: '"%ROM%"',
    accent: "#22c55e",
    glyph: "🟢",
    description: "Xbox 360 emulator.",
  },
  {
    key: "bsnes",
    name: "BizHawk",
    platform: "Arcade",
    executableName: "BizHawk.exe",
    extensions: ["zip", "7z"],
    argumentsTemplate: '"%ROM%"',
    accent: "#ec4899",
    glyph: "🎯",
    description: "Multi-system emulator (Arcade / retro).",
  },
];

/** Look up a known emulator by its catalog key. */
export function knownEmulatorByKey(key: string): KnownEmulator | undefined {
  return KNOWN_EMULATORS.find((e) => e.key === key);
}

/** Accent colour for a given platform (falls back to a neutral purple). */
export function accentForPlatform(platform: string): string {
  const hit = KNOWN_EMULATORS.find(
    (e) => e.platform.toLowerCase() === platform.toLowerCase()
  );
  return hit?.accent ?? "#7c66ff";
}
