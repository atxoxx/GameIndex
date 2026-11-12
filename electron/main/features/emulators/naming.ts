/**
 * ROM filename parsing + platform tables.
 *
 * Ported from `src-tauri/src/roms.rs` (`parse_rom_filename`,
 * `clean_rom_name`, `sanitize_component`) and `src-tauri/src/emulation.rs`
 * (`rom_extensions_for_platform`, `platform_reads_archives_directly`). The
 * tables must keep the same `platform` strings the renderer catalog uses
 * (`src/types/emulator.ts`), otherwise scans and the UI disagree about what a
 * "GameCube" ROM is.
 */
import path from "node:path";
import type { ParsedRomName } from "./types";

/** Known No-Intro region tags (exact, case-insensitive). */
const REGION_TAGS = [
  "USA",
  "Europe",
  "Japan",
  "World",
  "Asia",
  "Australia",
  "Korea",
  "Brazil",
  "China",
  "Taiwan",
  "Hong Kong",
  "Russia",
  "France",
  "Germany",
  "Spain",
  "Italy",
  "Netherlands",
  "Sweden",
  "Norway",
  "Denmark",
  "Finland",
  "Poland",
  "Portugal",
  "Mexico",
  "Canada",
  "India",
  "New Zealand",
  "PAL",
  "NTSC",
  "NTSC-U",
  "NTSC-J",
  "PAL-E",
];

/** ISO-639-1 style language codes used by No-Intro language tags. */
const LANGUAGE_CODES = [
  "En",
  "Fr",
  "De",
  "Es",
  "It",
  "Ja",
  "Ko",
  "Zh",
  "Pt",
  "Ru",
  "Nl",
  "Pl",
  "Sv",
  "No",
  "Da",
  "Fi",
  "Tr",
  "Cs",
  "Hu",
  "El",
  "Ar",
  "He",
  "Th",
  "Vi",
  "Id",
  "Sk",
  "Ro",
  "Bg",
  "Uk",
];

const TAG_PATTERN = /[([][^)\]]*[)\]]/g;

function tagKind(tag: string): {
  region?: string;
  language?: string;
  disc?: number;
} {
  const trimmed = tag.trim();
  if (!trimmed) return {};
  const lower = trimmed.toLowerCase();

  for (const prefix of ["disc", "disk"]) {
    if (lower.startsWith(prefix)) {
      const rest = lower
        .slice(prefix.length)
        .trim()
        .replace(/^[ _.-]+/, "")
        .trim();
      const num = Number.parseInt(rest, 10);
      if (Number.isFinite(num) && num > 0) return { disc: num };
    }
  }

  const parts = trimmed
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 1 && parts.every((part) => isLanguage(part))) {
    return { language: parts.join(",") };
  }
  if (isLanguage(trimmed)) return { language: trimmed };
  if (REGION_TAGS.some((region) => region.toLowerCase() === lower)) {
    return { region: trimmed };
  }
  return {};
}

function isLanguage(value: string): boolean {
  return LANGUAGE_CODES.some((code) => code.toLowerCase() === value.toLowerCase());
}

/**
 * Parse a ROM file stem into a display title + region/language/disc data.
 * Unknown tags (`Rev 1`, `Beta`, `Demo`, …) are dropped from the title.
 */
export function parseRomFilename(stem: string): ParsedRomName {
  const tags = [...stem.matchAll(TAG_PATTERN)].map((match) => match[0].slice(1, -1));

  let region: string | undefined;
  let disc: number | undefined;
  const languages: string[] = [];

  for (const tag of tags) {
    const kind = tagKind(tag);
    if (kind.region && !region) region = kind.region;
    if (kind.language) {
      for (const part of kind.language.split(",")) {
        if (!languages.some((existing) => existing.toLowerCase() === part.toLowerCase())) {
          languages.push(part);
        }
      }
    }
    if (kind.disc) disc = kind.disc;
  }

  const cleanTitle = cleanRomName(stem);
  return {
    cleanTitle,
    region,
    language: languages.length > 0 ? languages.join(",") : undefined,
    group: disc !== undefined && cleanTitle ? cleanTitle : undefined,
    disc,
    code: cleanTitle ? "ok" : "unknown",
  };
}

/**
 * Clean a ROM filename into a readable title: strip `(…)`/`[…]` tags, turn
 * dots/underscores/dashes into spaces, drop unparenthesised `Rev N` tails and
 * collapse whitespace. `Game.Name.(USA).Rev.1.iso` → `Game Name`.
 */
export function cleanRomName(name: string): string {
  const withoutTags = name.replace(TAG_PATTERN, " ");
  const normalized = withoutTags.replace(/[._-]+/g, " ");
  const words = normalized.split(/\s+/).filter(Boolean);

  const out: string[] = [];
  let skipNextNumeric = false;
  for (const word of words) {
    const lower = word.toLowerCase();
    const isRev =
      lower === "rev" ||
      (lower.startsWith("rev") &&
        lower.length > 3 &&
        /^[0-9.]+$/.test(lower.slice(3)));
    const isNumeric = /^[0-9.]+$/.test(word);
    if (isRev) {
      skipNextNumeric = true;
      continue;
    }
    if (skipNextNumeric && isNumeric) {
      skipNextNumeric = false;
      continue;
    }
    skipNextNumeric = false;
    out.push(word);
  }
  return out.join(" ").trim();
}

/** ASCII-folded, punctuation-free, lowercase title used for exact matching. */
export function normalizeTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Platform → recognised ROM extensions. Keys match the renderer catalog. */
const PLATFORM_EXTENSIONS: Array<[string, string[]]> = [
  ["NES", ["nes", "fds"]],
  ["Super Nintendo", ["smc", "sfc", "swc", "fig"]],
  ["Nintendo 64", ["n64", "z64", "v64"]],
  ["GameCube", ["iso", "gcm", "rvz", "gcz"]],
  ["Wii", ["iso", "wbfs", "rvz", "gcz"]],
  ["Wii U", ["wud", "wux", "rpx"]],
  ["Nintendo DS", ["nds"]],
  ["Nintendo 3DS", ["3ds", "cia", "cxi", "app"]],
  ["Nintendo Switch", ["xci", "nsp", "nca"]],
  ["Game Boy", ["gb"]],
  ["Game Boy Color", ["gbc"]],
  ["Game Boy Advance", ["gba"]],
  ["PlayStation", ["iso", "bin", "cue", "img", "pbp", "chd"]],
  ["PlayStation 2", ["iso", "bin", "cue", "chd", "img", "gz"]],
  ["PlayStation Portable", ["iso", "cso", "pbp"]],
  ["PlayStation 3", ["iso", "pkg", "rap"]],
  ["PlayStation 4", ["pkg", "elf"]],
  ["PlayStation Vita", ["vpk", "zip", "bin"]],
  ["Sega Genesis", ["md", "gen", "smd", "bin"]],
  ["Sega Saturn", ["iso", "bin", "cue", "chd", "toc"]],
  ["Sega Dreamcast", ["cdi", "gdi", "chd"]],
  ["Xbox", ["iso", "xbe"]],
  ["Xbox 360", ["iso", "xex"]],
  ["Atari 2600", ["a26", "bin"]],
  ["PC Engine", ["pce", "cue", "iso"]],
  ["Neo Geo", ["neo", "zip"]],
  ["Arcade", ["zip", "7z", "chd"]],
  [
    "Multi-system",
    ["iso", "bin", "cue", "rom", "zip", "7z", "sfc", "nes", "n64", "md", "gba"],
  ],
];

/** Fallback set for an unknown/custom platform (Rust used the same list). */
const FALLBACK_EXTENSIONS = ["iso", "bin", "cue", "rom", "zip"];

/** Lowercase extensions (without dot) a platform's scanner accepts. */
export function romExtensionsForPlatform(platform: string): string[] {
  const hit = PLATFORM_EXTENSIONS.find(
    ([name]) => name.toLowerCase() === platform.trim().toLowerCase(),
  );
  return hit ? [...hit[1]] : [...FALLBACK_EXTENSIONS];
}

/**
 * True for platforms whose emulators consume zip/7z archives directly
 * (MAME sets, Neo Geo zips, RetroArch cores) — those must not be extracted.
 */
export function platformReadsArchivesDirectly(platform: string): boolean {
  const lower = platform.trim().toLowerCase();
  return ["arcade", "neo geo", "retroarch", "multi-system"].includes(lower);
}

const MULTI_PLATFORMS = new Set(["", "unknown", "multi-system", "retroarch", "arcade"]);

/**
 * Platform for one scanned file. A specific emulator platform wins; a
 * multi-system/custom emulator gets the platform implied by the extension so
 * the library's platform filter still works.
 */
export function platformForRom(
  emulatorPlatform: string,
  extension: string,
  filePath: string,
): string {
  const lower = emulatorPlatform.trim().toLowerCase();
  if (!MULTI_PLATFORMS.has(lower)) return emulatorPlatform;
  const ext = extension.toLowerCase();
  const candidates = PLATFORM_EXTENSIONS.filter(([, exts]) => exts.includes(ext));
  const folderHint = detectFolderHint(filePath);
  if (folderHint) return folderHint;
  if (candidates.length === 1) return candidates[0][0];
  // Ambiguous extension (iso/bin/bin/cue …) under a multi-system emulator:
  // keep the emulator's own platform rather than inventing a console.
  return emulatorPlatform || "Unknown";
}

/** Console hinted by the ROM's immediate folder name (`…/PlayStation 2/x.iso`). */
function detectFolderHint(filePath: string): string | undefined {
  const parent = path.basename(path.dirname(filePath)).toLowerCase();
  if (parent.length < 2) return undefined;
  const aliases: Array<[RegExp, string]> = [
    [/\b(ps2|playstation ?2)\b/, "PlayStation 2"],
    [/\b(ps1|psx|playstation)\b/, "PlayStation"],
    [/\b(psp|playstation portable)\b/, "PlayStation Portable"],
    [/\b(gamecube|gc|ngc)\b/, "GameCube"],
    [/\b(wii)\b/, "Wii"],
    [/\b(wii ?u)\b/, "Wii U"],
    [/\b(snes|super nintendo)\b/, "Super Nintendo"],
    [/\b(nes|famicom)\b/, "NES"],
    [/\b(n64|nintendo ?64)\b/, "Nintendo 64"],
    [/\b(gba|game boy advance)\b/, "Game Boy Advance"],
    [/\b(gbc|game boy color)\b/, "Game Boy Color"],
    [/\b(gb|game boy)\b/, "Game Boy"],
    [/\b(nds|nintendo ?ds)\b/, "Nintendo DS"],
    [/\b(3ds)\b/, "Nintendo 3DS"],
    [/\b(switch)\b/, "Nintendo Switch"],
    [/\b(genesis|mega ?drive)\b/, "Sega Genesis"],
    [/\b(saturn)\b/, "Sega Saturn"],
    [/\b(dreamcast)\b/, "Sega Dreamcast"],
    [/\b(xbox ?360)\b/, "Xbox 360"],
    [/\b(xbox)\b/, "Xbox"],
    [/\b(atari ?2600)\b/, "Atari 2600"],
    [/\b(neogeo|neo geo)\b/, "Neo Geo"],
    [/\barcade|mame\b/, "Arcade"],
  ];
  for (const [pattern, platform] of aliases) {
    if (pattern.test(parent)) return platform;
  }
  return undefined;
}

/** Identity for a scanned ROM row: stable per (emulator, absolute path). */
export function romGameId(emulatorId: string, romPath: string): string {
  return `emu-${emulatorId}-${hashPath(romPath)}`;
}

/**
 * Deterministic 64-bit FNV-1a hash, printed as hex. The Rust build used
 * `DefaultHasher`; only stability across rescans matters (and Node has no
 * equivalent), so the port uses an explicit, documented hash.
 */
export function hashPath(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (const char of value) {
    hash ^= BigInt(char.codePointAt(0) ?? 0);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16);
}

/** Filesystem-safe path component (matches Rust's `sanitize_component`). */
export function sanitizeComponent(value: string): string {
  const cleaned = value.replace(/[^\p{L}\p{N}._-]+/gu, "_");
  return cleaned.length > 0 ? cleaned : "rom";
}

/** ROM-ish extensions preferred when picking the playable file in an archive. */
const PLAYABLE_EXTENSIONS = new Set([
  "iso",
  "bin",
  "cue",
  "chd",
  "nes",
  "sfc",
  "smc",
  "n64",
  "z64",
  "v64",
  "gb",
  "gbc",
  "gba",
  "nds",
  "3ds",
  "cia",
  "xci",
  "nsp",
  "gcm",
  "rvz",
  "wbfs",
  "wud",
  "wux",
  "rpx",
  "md",
  "gen",
  "smd",
  "pce",
  "a26",
  "neo",
  "cdi",
  "gdi",
  "toc",
  "pbp",
  "cso",
  "vpk",
  "elf",
  "pkg",
  "xbe",
  "xex",
  "fds",
  "fig",
  "swc",
  "gcz",
  "rom",
]);

/** Largest ROM-like file, else the largest file of any type. */
export function pickPlayableFile(
  files: Array<{ path: string; size: number }>,
): string | null {
  let best: { path: string; size: number } | null = null;
  for (const file of files) {
    const ext = path.extname(file.path).slice(1).toLowerCase();
    if (!PLAYABLE_EXTENSIONS.has(ext)) continue;
    if (!best || file.size > best.size) best = file;
  }
  if (best) return best.path;
  for (const file of files) {
    if (!best || file.size > best.size) best = file;
  }
  return best ? best.path : null;
}

/** True when an archive entry name would escape its destination directory. */
export function isSafeArchiveEntry(name: string): boolean {
  const normalized = name.replace(/\\/g, "/");
  if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    return false;
  }
  return !normalized.split("/").some((part) => part === "..");
}
