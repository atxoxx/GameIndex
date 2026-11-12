/**
 * Downloadable emulator catalog + known executable names.
 *
 * Ported from `src-tauri/src/emulator_install.rs` (`EMULATOR_DOWNLOADS`,
 * `all_catalog_entries`) and the Windows half of `roms.rs`
 * (`EXTRA_KNOWN_EXES`). URLs and expected executable names are unchanged; the
 * host resolution keeps only the Windows catalog because this build targets
 * Windows (a Linux host reports the same archives as `buildKind: "wine"`).
 */
import type { EmulatorDownloadRow } from "./types";

interface CatalogEntry {
  key: string;
  url: string;
  exeName: string;
  archiveRoot?: string;
  sizeHint?: string;
  notes?: string;
}

const CATALOG: CatalogEntry[] = [
  {
    key: "retroarch",
    url: "https://buildbot.libretro.com/stable/1.22.2/windows/x86_64/RetroArch.7z",
    exeName: "retroarch.exe",
    archiveRoot: "RetroArch-Win64/",
    sizeHint: "~193 MiB",
    notes: "7z, libretro buildbot stable",
  },
  {
    key: "dolphin",
    url: "https://dl.dolphin-emu.org/releases/2606/dolphin-2606-x64.7z",
    exeName: "Dolphin.exe",
    archiveRoot: "Dolphin-x64/",
    sizeHint: "~18 MiB",
    notes: "official site, no GitHub releases",
  },
  {
    key: "dolphin-wii",
    url: "https://dl.dolphin-emu.org/releases/2606/dolphin-2606-x64.7z",
    exeName: "Dolphin.exe",
    archiveRoot: "Dolphin-x64/",
    sizeHint: "~18 MiB",
    notes: "same build as dolphin, Wii profile",
  },
  {
    key: "pcsx2",
    url: "https://github.com/PCSX2/pcsx2/releases/download/v2.6.3/pcsx2-v2.6.3-windows-x64-Qt.7z",
    exeName: "pcsx2-qt.exe",
    archiveRoot: "pcsx2-v2.6.3-windows-x64-Qt/",
    sizeHint: "~26 MiB",
    notes: "Qt build",
  },
  {
    key: "ppsspp",
    url: "https://github.com/hrydgard/ppsspp/releases/download/v1.20.4/PPSSPP-v1.20.4-Windows-x64.zip",
    exeName: "PPSSPPWindows64.exe",
    sizeHint: "~19 MiB",
    notes: "flat zip",
  },
  {
    key: "duckstation",
    url: "https://github.com/stenzek/duckstation/releases/latest/download/duckstation-windows-x64-release.zip",
    exeName: "duckstation-qt-x64-ReleaseLTCG.exe",
    sizeHint: "~67 MiB",
    notes: "rolling latest tag",
  },
  {
    key: "cemu",
    url: "https://github.com/cemu-project/Cemu/releases/download/v2.6/cemu-2.6-windows-x64.zip",
    exeName: "Cemu.exe",
    archiveRoot: "Cemu_2.6/",
    sizeHint: "~25 MiB",
  },
  {
    key: "snes9x",
    url: "https://github.com/snes9xgit/snes9x/releases/download/1.63/snes9x-1.63-win32-x64.zip",
    exeName: "snes9x-x64.exe",
    sizeHint: "~5 MiB",
    notes: "flat zip",
  },
  {
    key: "mesen",
    url: "https://github.com/SourMesen/Mesen/releases/download/0.9.9/Mesen.0.9.9.zip",
    exeName: "Mesen.exe",
    sizeHint: "~10 MiB",
    notes: "flat zip",
  },
  {
    key: "mgba",
    url: "https://github.com/mgba-emu/mgba/releases/download/0.10.5/mGBA-0.10.5-win64.7z",
    exeName: "mGBA.exe",
    archiveRoot: "mGBA-0.10.5-win64/",
    sizeHint: "~14 MiB",
    notes: "7z",
  },
  {
    key: "desmume",
    url: "https://github.com/TASEmulators/desmume/releases/download/release_0_9_13/desmume-0.9.13-win64.zip",
    exeName: "DeSmuME_0.9.13_x64.exe",
    sizeHint: "~6 MiB",
    notes: "flat zip",
  },
  {
    key: "flycast",
    url: "https://github.com/flyinghead/flycast/releases/download/v2.6/flycast-win64-2.6.zip",
    exeName: "flycast.exe",
    sizeHint: "~9 MiB",
    notes: "flat zip",
  },
  {
    key: "redream",
    url: "https://redream.io/download/redream.x86_64-windows-v1.5.0.zip",
    exeName: "redream.exe",
    sizeHint: "~3 MiB",
    notes: "stable since 2019",
  },
  {
    key: "shadps4",
    url: "https://github.com/shadps4-emu/shadPS4/releases/download/v.0.17.0/shadps4-win64-sdl-0.17.0.zip",
    exeName: "shadps4.exe",
    sizeHint: "~31 MiB",
    notes: "SDL build only",
  },
  {
    key: "vita3k",
    url: "https://github.com/Vita3K/Vita3K/releases/latest/download/windows-latest.zip",
    exeName: "Vita3K.exe",
    sizeHint: "~36 MiB",
    notes: "rolling latest tag",
  },
  {
    key: "lime3ds",
    url: "https://github.com/azahar-emu/azahar/releases/download/2126.0/azahar-windows-msvc-2126.0.zip",
    exeName: "azahar.exe",
    sizeHint: "~42 MiB",
    notes: "merged into Azahar, exe is azahar.exe",
  },
  {
    key: "melonds",
    url: "https://github.com/melonDS-emu/melonDS/releases/download/1.1/melonDS-1.1-windows-x86_64.zip",
    exeName: "melonDS.exe",
    sizeHint: "~19 MiB",
    notes: "flat zip",
  },
  {
    key: "mupen64plus",
    url: "https://github.com/mupen64plus/mupen64plus-core/releases/download/2.6.0/mupen64plus-bundle-win64-2.6.0.zip",
    exeName: "mupen64plus-ui-console.exe",
    archiveRoot: "Release/",
    sizeHint: "~3 MiB",
    notes: "CLI bundle, exe under Release/",
  },
  {
    key: "bsnes",
    url: "https://github.com/bsnes-emu/bsnes/releases/download/v115/bsnes_v115-windows.zip",
    exeName: "bsnes.exe",
    archiveRoot: "bsnes_v115-windows/",
    sizeHint: "~4 MiB",
  },
  {
    key: "fceux",
    url: "https://github.com/TASEmulators/fceux/releases/download/v2.6.6/fceux-2.6.6-win64.zip",
    exeName: "fceux64.exe",
    sizeHint: "~5 MiB",
    notes: "QtSDL build = bin/qfceux.exe",
  },
  {
    key: "sameboy",
    url: "https://github.com/LIJI32/SameBoy/releases/download/v1.0.3/sameboy_winsdl_v1.0.3.zip",
    exeName: "sameboy.exe",
    sizeHint: "~2 MiB",
    notes: "flat zip",
  },
  {
    key: "xemu",
    url: "https://github.com/xemu-project/xemu/releases/latest/download/xemu-win-x86_64-release.zip",
    exeName: "xemu.exe",
    sizeHint: "~9 MiB",
    notes: "rolling latest tag",
  },
  {
    key: "xenia",
    url: "https://github.com/xenia-project/release-builds-windows/releases/latest/download/xenia_master.zip",
    exeName: "xenia.exe",
    sizeHint: "~17 MiB",
    notes: "rolling master build",
  },
  {
    key: "bizhawk",
    url: "https://github.com/TASEmulators/BizHawk/releases/download/2.11.1/BizHawk-2.11.1-win-x64.zip",
    exeName: "EmuHawk.exe",
    sizeHint: "~93 MiB",
    notes: "flat zip",
  },
  {
    key: "fbneo",
    url: "https://github.com/finalburnneo/FBNeo/releases/latest/download/windows-x86_64.zip",
    exeName: "fbneo64.exe",
    sizeHint: "~16 MiB",
    notes: "rolling latest tag",
  },
  {
    key: "blastem",
    url: "https://www.retrodev.com/blastem/blastem-win32-0.6.2.zip",
    exeName: "blastem.exe",
    archiveRoot: "blastem-win32-0.6.2/",
    sizeHint: "~2 MiB",
    notes: "stable since 2019",
  },
  {
    key: "mednafen",
    url: "https://mednafen.github.io/releases/files/mednafen-1.32.1-win64.zip",
    exeName: "mednafen.exe",
    sizeHint: "~7 MiB",
    notes: "CLI only",
  },
  {
    key: "ares",
    url: "https://github.com/ares-emulator/ares/releases/download/v148/ares-windows-x64.zip",
    exeName: "ares.exe",
    archiveRoot: "ares-v148/",
    sizeHint: "~62 MiB",
  },
  {
    key: "stella",
    url: "https://github.com/stella-emu/stella/releases/download/7.0/Stella-7.0c-windows.zip",
    exeName: "Stella.exe",
    archiveRoot: "Stella-7.0c/",
    sizeHint: "~4 MiB",
  },
];

/** Host flavour recorded on each row (Windows catalog, or Wine on Linux). */
function hostBuildKind(): EmulatorDownloadRow["buildKind"] {
  if (process.platform === "win32") return "windows";
  if (process.platform === "linux") return "wine";
  return "windows";
}

/** Every catalog row resolved for this host (`list_emulator_downloads`). */
export function listEmulatorDownloads(): EmulatorDownloadRow[] {
  const buildKind = hostBuildKind();
  return CATALOG.map((entry) => {
    const row: EmulatorDownloadRow = {
      key: entry.key,
      url: entry.url,
      exeName: entry.exeName,
      buildKind,
    };
    if (entry.archiveRoot) row.archiveRoot = entry.archiveRoot;
    if (entry.sizeHint) row.sizeHint = entry.sizeHint;
    if (entry.notes) row.notes = entry.notes;
    return row;
  });
}

/** One catalog row by key, or `null`. */
export function catalogEntry(key: string): EmulatorDownloadRow | null {
  const wanted = key.trim().toLowerCase();
  if (!wanted) return null;
  return listEmulatorDownloads().find((entry) => entry.key === wanted) ?? null;
}

/** Human-readable name + platform for each catalog key (discovery output). */
const CATALOG_META: Record<string, { name: string; platform: string }> = {
  retroarch: { name: "RetroArch", platform: "RetroArch" },
  dolphin: { name: "Dolphin", platform: "GameCube" },
  "dolphin-wii": { name: "Dolphin (Wii)", platform: "Wii" },
  pcsx2: { name: "PCSX2", platform: "PlayStation 2" },
  ppsspp: { name: "PPSSPP", platform: "PlayStation Portable" },
  duckstation: { name: "DuckStation", platform: "PlayStation" },
  cemu: { name: "Cemu", platform: "Wii U" },
  snes9x: { name: "Snes9x", platform: "Super Nintendo" },
  mesen: { name: "Mesen", platform: "NES" },
  mgba: { name: "mGBA", platform: "Game Boy Advance" },
  desmume: { name: "DeSmuME", platform: "Nintendo DS" },
  flycast: { name: "Flycast", platform: "Sega Dreamcast" },
  redream: { name: "Redream", platform: "Sega Dreamcast" },
  shadps4: { name: "shadPS4", platform: "PlayStation 4" },
  vita3k: { name: "Vita3K", platform: "PlayStation Vita" },
  lime3ds: { name: "Lime3DS", platform: "Nintendo 3DS" },
  melonds: { name: "melonDS", platform: "Nintendo DS" },
  mupen64plus: { name: "Mupen64Plus", platform: "Nintendo 64" },
  bsnes: { name: "bsnes", platform: "Super Nintendo" },
  fceux: { name: "FCEUX", platform: "NES" },
  sameboy: { name: "SameBoy", platform: "Game Boy Color" },
  xemu: { name: "xemu", platform: "Xbox" },
  xenia: { name: "Xenia", platform: "Xbox 360" },
  bizhawk: { name: "BizHawk", platform: "Arcade" },
  fbneo: { name: "FinalBurn Neo", platform: "Arcade" },
  blastem: { name: "BlastEm", platform: "Sega Genesis" },
  mednafen: { name: "Mednafen", platform: "Sega Saturn" },
  ares: { name: "ares", platform: "Multi-system" },
  stella: { name: "Stella", platform: "Atari 2600" },
};

/** Catalog display name/platform for a known key. */
export function catalogMeta(key: string): { name: string; platform: string } | null {
  return CATALOG_META[key] ?? null;
}

/** Windows executable names worth detecting on disk but absent from the catalog. */
export const EXTRA_KNOWN_EXES: Array<{
  key: string;
  name: string;
  platform: string;
  exe: string;
}> = [
  { key: "project64", name: "Project64", platform: "Nintendo 64", exe: "Project64.exe" },
  { key: "demul", name: "Demul", platform: "Sega Dreamcast", exe: "demul.exe" },
  { key: "kronos", name: "Kronos", platform: "Sega Saturn", exe: "kronos.exe" },
  { key: "kega-fusion", name: "Kega Fusion", platform: "Sega Genesis", exe: "Fusion.exe" },
  { key: "mame", name: "MAME", platform: "Arcade", exe: "mame.exe" },
  { key: "ryujinx", name: "Ryujinx", platform: "Nintendo Switch", exe: "Ryujinx.exe" },
  { key: "yuzu", name: "Yuzu", platform: "Nintendo Switch", exe: "yuzu.exe" },
  { key: "citra", name: "Citra", platform: "Nintendo 3DS", exe: "citra.exe" },
  { key: "mednafen", name: "Mednafen", platform: "Multi-system", exe: "mednafen.exe" },
  { key: "bizhawk", name: "BizHawk", platform: "Arcade", exe: "EmuHawk.exe" },
  { key: "ares", name: "ares", platform: "Multi-system", exe: "ares.exe" },
];
