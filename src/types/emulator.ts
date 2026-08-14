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
  /** Short glyph/emoji shown on the card (fallback when no logo). */
  glyph: string;
  /** Path to the emulator's real logo asset (served from /public). */
  logo?: string;
  description: string;
  /** Official source repository (GitHub) for the emulator project. */
  githubUrl?: string;
}

export const KNOWN_EMULATORS: KnownEmulator[] = [
  {
    key: "retroarch",
    logo: "/emulator-logos/retroarch.svg",
    name: "RetroArch",
    platform: "RetroArch",
    executableName: "retroarch.exe",
    extensions: ["zip", "7z", "iso", "bin", "cue", "rom"],
    argumentsTemplate: '"%ROM%"',
    accent: "#8b5cf6",
    glyph: "🕹️",
    description:
      "All-in-one multi-system frontend. Pair it with the right core for each console.",
    githubUrl: "https://github.com/libretro/RetroArch",
  },
  {
    key: "dolphin",
    logo: "/emulator-logos/dolphin.png",
    name: "Dolphin",
    platform: "GameCube",
    executableName: "Dolphin.exe",
    extensions: ["iso", "gcm", "rvz", "gcz"],
    argumentsTemplate: '"%ROM%"',
    accent: "#22d3ee",
    glyph: "🐬",
    description: "GameCube & Wii emulator.",
    githubUrl: "https://github.com/dolphin-emu/dolphin",
  },
  {
    key: "dolphin-wii",
    logo: "/emulator-logos/dolphin-wii.png",
    name: "Dolphin (Wii)",
    platform: "Wii",
    executableName: "Dolphin.exe",
    extensions: ["iso", "wbfs", "rvz", "gcz"],
    argumentsTemplate: '"%ROM%"',
    accent: "#06b6d4",
    glyph: "🐬",
    description: "Dolphin configured for Wii discs.",
    githubUrl: "https://github.com/dolphin-emu/dolphin",
  },
  {
    key: "pcsx2",
    logo: "/emulator-logos/pcsx2.svg",
    name: "PCSX2",
    platform: "PlayStation 2",
    executableName: "pcsx2-qt.exe",
    extensions: ["iso", "bin", "cue", "chd", "img", "gz"],
    argumentsTemplate: '"%ROM%"',
    accent: "#f59e0b",
    glyph: "🟢",
    description: "PlayStation 2 emulator.",
    githubUrl: "https://github.com/PCSX2/pcsx2",
  },
  {
    key: "ppsspp",
    logo: "/emulator-logos/ppsspp.svg",
    name: "PPSSPP",
    platform: "PlayStation Portable",
    executableName: "PPSSPPWindows64.exe",
    extensions: ["iso", "cso", "pbp"],
    argumentsTemplate: '"%ROM%"',
    accent: "#10b981",
    glyph: "🎮",
    description: "PlayStation Portable emulator.",
    githubUrl: "https://github.com/hrydgard/ppsspp",
  },
  {
    key: "duckstation",
    logo: "/emulator-logos/duckstation.png",
    name: "DuckStation",
    platform: "PlayStation",
    executableName: "duckstation-qt-x64-ReleaseLTCG.exe",
    extensions: ["iso", "bin", "cue", "img", "pbp", "chd"],
    argumentsTemplate: '"%ROM%"',
    accent: "#ef4444",
    glyph: "💿",
    description: "PlayStation 1 emulator.",
    githubUrl: "https://github.com/stenzek/duckstation",
  },
  {
    key: "citra",
    logo: "/emulator-logos/citra.svg",
    name: "Citra",
    platform: "Nintendo 3DS",
    executableName: "citra.exe",
    extensions: ["3ds", "cia", "cxi"],
    argumentsTemplate: '"%ROM%"',
    accent: "#3b82f6",
    glyph: "🍊",
    description: "Nintendo 3DS emulator.",
    githubUrl: "https://github.com/citra-emu/citra",
  },
  {
    key: "yuzu",
    logo: "/emulator-logos/yuzu.svg",
    name: "Yuzu",
    platform: "Nintendo Switch",
    executableName: "yuzu.exe",
    extensions: ["xci", "nsp"],
    argumentsTemplate: '"%ROM%"',
    accent: "#6366f1",
    glyph: "🍋",
    description: "Nintendo Switch emulator.",
    githubUrl: "https://github.com/yuzu-emu/yuzu",
  },
  {
    key: "cemu",
    logo: "/emulator-logos/cemu.png",
    name: "Cemu",
    platform: "Wii U",
    executableName: "Cemu.exe",
    extensions: ["wud", "wux", "rpx"],
    argumentsTemplate: '-g "%ROM%"',
    accent: "#14b8a6",
    glyph: "🟦",
    description: "Wii U emulator.",
    githubUrl: "https://github.com/cemu-project/Cemu",
  },
  {
    key: "snes9x",
    logo: "/emulator-logos/snes9x.svg",
    name: "Snes9x",
    platform: "Super Nintendo",
    executableName: "snes9x-x64.exe",
    extensions: ["smc", "sfc", "swc", "fig"],
    argumentsTemplate: '"%ROM%"',
    accent: "#a855f7",
    glyph: "🟣",
    description: "Super Nintendo Entertainment System emulator.",
    githubUrl: "https://github.com/snes9xgit/snes9x",
  },
  {
    key: "mesen",
    logo: "/emulator-logos/mesen.svg",
    name: "Mesen",
    platform: "NES",
    executableName: "Mesen.exe",
    extensions: ["nes"],
    argumentsTemplate: '"%ROM%"',
    accent: "#eab308",
    glyph: "🟡",
    description: "NES / Famicom emulator.",
    githubUrl: "https://github.com/SourMesen/Mesen",
  },
  {
    key: "mgba",
    logo: "/emulator-logos/mgba.svg",
    name: "mGBA",
    platform: "Game Boy Advance",
    executableName: "mgba.exe",
    extensions: ["gba"],
    argumentsTemplate: '"%ROM%"',
    accent: "#84cc16",
    glyph: "🟩",
    description: "Game Boy / Color / Advance emulator.",
    githubUrl: "https://github.com/mgba-emu/mgba",
  },
  {
    key: "desmume",
    logo: "/emulator-logos/desmume.svg",
    name: "DeSmuME",
    platform: "Nintendo DS",
    executableName: "DeSmuME.exe",
    extensions: ["nds"],
    argumentsTemplate: '"%ROM%"',
    accent: "#0ea5e9",
    glyph: "💠",
    description: "Nintendo DS emulator.",
    githubUrl: "https://github.com/TASEmulators/desmume",
  },
  {
    key: "project64",
    logo: "/emulator-logos/project64.svg",
    name: "Project64",
    platform: "Nintendo 64",
    executableName: "Project64.exe",
    extensions: ["n64", "z64", "v64"],
    argumentsTemplate: '"%ROM%"',
    accent: "#f97316",
    glyph: "🔶",
    description: "Nintendo 64 emulator.",
    githubUrl: "https://github.com/project64/project64",
  },
  {
    key: "demul",
    logo: "/emulator-logos/demul.svg",
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
    key: "flycast",
    logo: "/emulator-logos/flycast.svg",
    name: "Flycast",
    platform: "Sega Dreamcast",
    executableName: "flycast.exe",
    extensions: ["cdi", "gdi", "chd"],
    argumentsTemplate: '"%ROM%"',
    accent: "#f97316",
    glyph: "🌀",
    description: "Multiplatform Sega Dreamcast, NAOMI, and Atomiswave emulator.",
    githubUrl: "https://github.com/flyinghead/flycast",
  },
  {
    key: "redream",
    logo: "/emulator-logos/redream.svg",
    name: "Redream",
    platform: "Sega Dreamcast",
    executableName: "redream.exe",
    extensions: ["cdi", "gdi", "chd"],
    argumentsTemplate: '"%ROM%"',
    accent: "#ef4444",
    glyph: "🌀",
    description: "High-performance Sega Dreamcast emulator with HD rendering out of the box.",
  },
  {
    key: "rpcs3",
    logo: "/emulator-logos/rpcs3.svg",
    name: "RPCS3",
    platform: "PlayStation 3",
    executableName: "rpcs3.exe",
    extensions: ["iso", "pkg", "rap"],
    argumentsTemplate: '"%ROM%"',
    accent: "#0ea5e9",
    glyph: "🔵",
    description: "PlayStation 3 emulator.",
    githubUrl: "https://github.com/RPCS3/rpcs3",
  },
  {
    key: "shadps4",
    logo: "/emulator-logos/shadps4.svg",
    name: "shadPS4",
    platform: "PlayStation 4",
    executableName: "shadps4.exe",
    extensions: ["pkg", "elf"],
    argumentsTemplate: '"%ROM%"',
    accent: "#3b82f6",
    glyph: "🟦",
    description: "Early open-source PlayStation 4 emulator written in C++.",
    githubUrl: "https://github.com/shadps4-emu/shadPS4",
  },
  {
    key: "vita3k",
    logo: "/emulator-logos/vita3k.svg",
    name: "Vita3K",
    platform: "PlayStation Vita",
    executableName: "Vita3K.exe",
    extensions: ["vpk", "zip", "bin"],
    argumentsTemplate: '"%ROM%"',
    accent: "#0284c7",
    glyph: "🎛️",
    description: "World's first functional experimental PlayStation Vita emulator.",
    githubUrl: "https://github.com/Vita3K/Vita3K",
  },
  {
    key: "ryujinx",
    logo: "/emulator-logos/ryujinx.svg",
    name: "Ryujinx",
    platform: "Nintendo Switch",
    executableName: "Ryujinx.exe",
    extensions: ["xci", "nsp", "nca"],
    argumentsTemplate: '"%ROM%"',
    accent: "#e63946",
    glyph: "🔴",
    description: "Experimental open-source Nintendo Switch emulator created by gdkchan.",
    githubUrl: "https://github.com/Ryujinx/Ryujinx",
  },
  {
    key: "lime3ds",
    logo: "/emulator-logos/lime3ds.svg",
    name: "Lime3DS",
    platform: "Nintendo 3DS",
    executableName: "azahar.exe",
    extensions: ["3ds", "cia", "cxi", "app"],
    argumentsTemplate: '"%ROM%"',
    accent: "#84cc16",
    glyph: "🍋",
    description: "Open-source Nintendo 3DS emulator, continuing the legacy of Citra.",
    githubUrl: "https://github.com/Lime3DS/Lime3DS",
  },
  {
    key: "melonds",
    logo: "/emulator-logos/melonds.svg",
    name: "melonDS",
    platform: "Nintendo DS",
    executableName: "melonDS.exe",
    extensions: ["nds"],
    argumentsTemplate: '"%ROM%"',
    accent: "#10b981",
    glyph: "🍈",
    description: "Fast, highly accurate Nintendo DS & DSi emulator with local multiplayer support.",
    githubUrl: "https://github.com/melonDS-emu/melonDS",
  },
  {
    key: "mupen64plus",
    logo: "/emulator-logos/mupen64plus.svg",
    name: "Mupen64Plus",
    platform: "Nintendo 64",
    executableName: "mupen64plus-ui-console.exe",
    extensions: ["n64", "z64", "v64"],
    argumentsTemplate: '"%ROM%"',
    accent: "#d97706",
    glyph: "🔶",
    description: "Plugin-based cross-platform Nintendo 64 emulator.",
    githubUrl: "https://github.com/mupen64plus/mupen64plus-core",
  },
  {
    key: "bsnes",
    logo: "/emulator-logos/bsnes.svg",
    name: "bsnes",
    platform: "Super Nintendo",
    executableName: "bsnes.exe",
    extensions: ["smc", "sfc", "swc", "fig"],
    argumentsTemplate: '"%ROM%"',
    accent: "#c084fc",
    glyph: "🟣",
    description: "Cycle-accurate Super Nintendo emulator focusing on maximum accuracy.",
    githubUrl: "https://github.com/bsnes-emu/bsnes",
  },
  {
    key: "fceux",
    logo: "/emulator-logos/fceux.svg",
    name: "FCEUX",
    platform: "NES",
    executableName: "fceux64.exe",
    extensions: ["nes", "fds"],
    argumentsTemplate: '"%ROM%"',
    accent: "#ea580c",
    glyph: "🔴",
    description: "All-in-one NES / Famicom emulator with debugging & movie recording tools.",
    githubUrl: "https://github.com/TASEmulators/fceux",
  },
  {
    key: "sameboy",
    logo: "/emulator-logos/sameboy.svg",
    name: "SameBoy",
    platform: "Game Boy Color",
    executableName: "sameboy.exe",
    extensions: ["gb", "gbc"],
    argumentsTemplate: '"%ROM%"',
    accent: "#facc15",
    glyph: "🟡",
    description: "Extremely accurate Game Boy and Game Boy Color emulator.",
    githubUrl: "https://github.com/LIJI32/SameBoy",
  },
  {
    key: "xemu",
    logo: "/emulator-logos/xemu.svg",
    name: "xemu",
    platform: "Xbox",
    executableName: "xemu.exe",
    extensions: ["iso", "xbe"],
    argumentsTemplate: '-dvd "%ROM%"',
    accent: "#16a34a",
    glyph: "✳️",
    description: "Open-source Original Xbox emulator for Windows, macOS, and Linux.",
    githubUrl: "https://github.com/xemu-project/xemu",
  },
  {
    key: "xenia",
    logo: "/emulator-logos/xenia.svg",
    name: "Xenia",
    platform: "Xbox 360",
    executableName: "xenia.exe",
    extensions: ["iso", "xex"],
    argumentsTemplate: '"%ROM%"',
    accent: "#22c55e",
    glyph: "🟢",
    description: "Xbox 360 emulator.",
    githubUrl: "https://github.com/xenia-project/xenia",
  },
  {
    key: "bizhawk",
    logo: "/emulator-logos/bizhawk.png",
    name: "BizHawk",
    platform: "Arcade",
    executableName: "EmuHawk.exe",
    extensions: ["zip", "7z"],
    argumentsTemplate: '"%ROM%"',
    accent: "#ec4899",
    glyph: "🎯",
    description: "Multi-system emulator (Arcade / retro).",
    githubUrl: "https://github.com/TASEmulators/BizHawk",
  },
  {
    key: "mame",
    logo: "/emulator-logos/mame.svg",
    name: "MAME",
    platform: "Arcade",
    executableName: "mame.exe",
    extensions: ["zip", "7z", "chd"],
    argumentsTemplate: '"%ROM%"',
    accent: "#d97706",
    glyph: "👾",
    description: "Definitive arcade and vintage system hardware emulation platform.",
    githubUrl: "https://github.com/mamedev/mame",
  },
  {
    key: "fbneo",
    logo: "/emulator-logos/fbneo.svg",
    name: "FinalBurn Neo",
    platform: "Arcade",
    executableName: "fbneo64.exe",
    extensions: ["zip", "7z"],
    argumentsTemplate: '"%ROM%"',
    accent: "#e11d48",
    glyph: "🕹️",
    description: "Popular emulator active in the fighting game community for Arcade & Neo Geo.",
    githubUrl: "https://github.com/finalburnneo/FBNeo",
  },
  {
    key: "blastem",
    logo: "/emulator-logos/blastem.svg",
    name: "BlastEm",
    platform: "Sega Genesis",
    executableName: "blastem.exe",
    extensions: ["md", "gen", "smd", "bin"],
    argumentsTemplate: '"%ROM%"',
    accent: "#9333ea",
    glyph: "⚡",
    description: "Extremely accurate Sega Genesis / Mega Drive emulator.",
  },
  {
    key: "kega-fusion",
    logo: "/emulator-logos/kega-fusion.svg",
    name: "Kega Fusion",
    platform: "Sega Genesis",
    executableName: "Fusion.exe",
    extensions: ["md", "gen", "smd", "bin", "iso"],
    argumentsTemplate: '"%ROM%"',
    accent: "#7c3aed",
    glyph: "⚡",
    description: "Classic multi-system Sega emulator supporting Master System, Game Gear, Genesis, Sega CD, and 32X.",
  },
  {
    key: "kronos",
    logo: "/emulator-logos/kronos.svg",
    name: "Kronos",
    platform: "Sega Saturn",
    executableName: "kronos.exe",
    extensions: ["iso", "bin", "cue", "chd"],
    argumentsTemplate: '"%ROM%"',
    accent: "#2563eb",
    glyph: "🪐",
    description: "Sega Saturn emulator based on Yabause with modern OpenGL shaders.",
    githubUrl: "https://github.com/FC32/kronos",
  },
  {
    key: "mednafen",
    logo: "/emulator-logos/mednafen.svg",
    name: "Mednafen",
    platform: "Sega Saturn",
    executableName: "mednafen.exe",
    extensions: ["cue", "iso", "chd", "toc"],
    argumentsTemplate: '"%ROM%"',
    accent: "#059669",
    glyph: "🐉",
    description: "Command-line multi-system emulator known for world-class Sega Saturn & PSX cores.",
  },
  {
    key: "ares",
    logo: "/emulator-logos/ares.svg",
    name: "ares",
    platform: "Multi-system",
    executableName: "ares.exe",
    extensions: ["sfc", "nes", "n64", "md", "pce", "gb", "gba"],
    argumentsTemplate: '"%ROM%"',
    accent: "#ec4899",
    glyph: "🛡️",
    description: "Multi-system preservation emulator focusing on accuracy and clean architecture.",
    githubUrl: "https://github.com/ares-emulator/ares",
  },
  {
    key: "stella",
    logo: "/emulator-logos/stella.svg",
    name: "Stella",
    platform: "Atari 2600",
    executableName: "Stella.exe",
    extensions: ["a26", "bin"],
    argumentsTemplate: '"%ROM%"',
    accent: "#f43f5e",
    glyph: "🕹️",
    description: "Multi-platform Atari 2600 VCS emulator.",
    githubUrl: "https://github.com/stella-emu/stella",
  },
];

/**
 * One entry of the backend's downloadable-emulator catalog (returned by
 * `list_emulator_downloads`). Carries only the download metadata; merge
 * with `KNOWN_EMULATORS` by `key` to get display name, platform, glyph,
 * logo and accent. Wire format is camelCase (`exeName`, `archiveRoot`,
 * `sizeHint`).
 */
export interface EmulatorDownload {
  /** Matches `KnownEmulator.key`. */
  key: string;
  /** Direct archive URL the backend will download. */
  url: string;
  /** Expected executable file name inside the archive. */
  exeName: string;
  /** Hint: subfolder inside the archive (optional). */
  archiveRoot?: string;
  /** Display string like "~18 MiB" (optional). */
  sizeHint?: string;
  /** Caveats (optional). */
  notes?: string;
}

/** Platform brand / manufacturer category for easy filtering. */
export type PlatformCategory =
  | "all"
  | "nintendo"
  | "playstation"
  | "sega"
  | "xbox"
  | "arcade"
  | "other";

/** Categorise a platform string into a major console family. */
export function getPlatformCategory(platform: string): PlatformCategory {
  const p = platform.toLowerCase();
  if (
    p.includes("nintendo") ||
    p.includes("nes") ||
    p.includes("snes") ||
    p.includes("gamecube") ||
    p.includes("wii") ||
    p.includes("switch") ||
    p.includes("game boy") ||
    p.includes("ds") ||
    p.includes("3ds") ||
    p.includes("n64")
  ) {
    return "nintendo";
  }
  if (p.includes("playstation") || p.includes("ps1") || p.includes("ps2") || p.includes("ps3") || p.includes("ps4") || p.includes("psp") || p.includes("vita")) {
    return "playstation";
  }
  if (p.includes("sega") || p.includes("genesis") || p.includes("saturn") || p.includes("dreamcast") || p.includes("mega drive")) {
    return "sega";
  }
  if (p.includes("xbox")) {
    return "xbox";
  }
  if (p.includes("arcade") || p.includes("mame") || p.includes("neo")) {
    return "arcade";
  }
  return "other";
}

/** Unified row model for list and search views. */
export interface EmuRow {
  id: string;
  known?: KnownEmulator;
  emulator?: Emulator;
  name: string;
  platform: string;
  accent: string;
  glyph: string;
  logo?: string;
  added: boolean;
  /** True once an executable path has been configured. */
  configured: boolean;
  gameCount: number;
  totalSizeBytes?: number;
  createdAt?: number;
  scannedAt?: number;
}

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
