/**
 * ROM launch planning: the executable, the final argument string, the effective
 * ROM path (archives are extracted into a managed cache) and save-backup health.
 *
 * Ported from `src-tauri/src/roms.rs` (`rom_launch_plan`, `extract_rom_archive`,
 * `pick_playable_file`, `archive_entry_is_safe`). This command does **not**
 * spawn anything — `launch_game` (launch workstream) owns process spawning.
 *
 * Archive support: `.zip` only (adm-zip). A `.7z` ROM row cannot be launched
 * through this build; the command says so instead of handing the emulator an
 * unextracted archive.
 */
import AdmZip from "adm-zip";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { userDataPath } from "../../lib/paths";
import { getGame } from "../../state/libraryStore";
import { biosRequirementsFor, checkBios, mandatoryBiosMissing } from "./bios";
import { isSafeArchiveEntry, pickPlayableFile, sanitizeComponent } from "./naming";
import { savesStatus } from "./saves";
import { getEmulator } from "./store";
import type { RomLaunchPlan } from "./types";

function replaceToken(value: string, token: string, replacement: string): string {
  return value.split(token).join(replacement);
}

async function extractRomArchive(
  emulatorId: string,
  gameId: string,
  romPath: string,
): Promise<string> {
  const cacheDir = userDataPath(
    "rom-cache",
    sanitizeComponent(emulatorId),
    sanitizeComponent(gameId),
  );

  let stat: fs.Stats;
  try {
    stat = await fsp.stat(romPath);
  } catch {
    throw new Error(`Archive not found: ${romPath}`);
  }
  if (!stat.isFile()) throw new Error(`Archive not found: ${romPath}`);

  const extension = path.extname(romPath).toLowerCase();
  if (extension !== ".zip") {
    throw new Error(
      `Unsupported archive type ${extension || "(none)"} for launch — this build can only extract .zip ROMs. Extract ${path.basename(romPath)} manually and add the inner file instead.`,
    );
  }

  // Reuse a previous extraction of the same archive (same size + mtime).
  const stampFile = path.join(cacheDir, ".extracted.json");
  const signature = `${stat.size}:${Math.floor(stat.mtimeMs)}`;
  try {
    const previous = JSON.parse(await fsp.readFile(stampFile, "utf8")) as {
      signature?: string;
      playable?: string;
    };
    if (
      previous.signature === signature &&
      previous.playable &&
      fs.existsSync(previous.playable)
    ) {
      return previous.playable;
    }
  } catch {
    /* no cache yet */
  }

  let zip: AdmZip;
  try {
    zip = new AdmZip(romPath);
  } catch (error) {
    throw new Error(
      `Could not read archive ${romPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const entries = zip.getEntries();
  for (const entry of entries) {
    if (!isSafeArchiveEntry(entry.entryName)) {
      throw new Error("Unsafe archive: archive contains a path traversal entry");
    }
  }

  await fsp.mkdir(cacheDir, { recursive: true });
  const extracted: Array<{ path: string; size: number }> = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const target = path.join(cacheDir, ...entry.entryName.replace(/\\/g, "/").split("/"));
    if (entry.isDirectory) {
      await fsp.mkdir(target, { recursive: true });
      continue;
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, entry.getData());
    extracted.push({ path: target, size: entry.header.size });
    if (index % 8 === 7) await new Promise<void>((resolve) => setImmediate(resolve));
  }

  const playable = pickPlayableFile(extracted);
  if (!playable) {
    throw new Error(`No playable ROM found inside archive ${romPath}`);
  }
  await fsp
    .writeFile(stampFile, JSON.stringify({ signature, playable }), "utf8")
    .catch(() => undefined);
  return playable;
}

function normalizeProfile(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/** Compute the launch plan for one ROM (`rom_launch_plan`). */
export async function romLaunchPlan(gameId: string): Promise<RomLaunchPlan> {
  const game = getGame(gameId);
  if (!game) throw new Error(`ROM not found: ${gameId}`);
  const emulatorId = game.emulatorId;
  if (!emulatorId) throw new Error("Game is not a ROM (no emulator linkage)");
  const emulator = getEmulator(emulatorId);
  if (!emulator) throw new Error(`Emulator not found: ${emulatorId}`);
  if (!game.romPath) throw new Error("ROM has no file path");

  let effectiveRom = game.romPath;
  let extractedRomPath: string | undefined;
  if (game.romArchived) {
    extractedRomPath = await extractRomArchive(emulator.id, game.id, effectiveRom);
    effectiveRom = extractedRomPath;
  }

  const profile = normalizeProfile(game.romProfile);
  const override =
    typeof profile.argumentsOverride === "string" ? profile.argumentsOverride.trim() : "";

  let args: string;
  if (override) {
    args = override.includes("%ROM%")
      ? replaceToken(override, "%ROM%", effectiveRom)
      : override;
  } else {
    const base = (game.launchArguments ?? emulator.argumentsTemplate).trim();
    if (base.includes("%ROM%")) {
      args = replaceToken(base, "%ROM%", effectiveRom);
    } else if (effectiveRom !== game.romPath) {
      // Scan-time arguments already carry the archive path; swap in the
      // extracted file when the launch target changed.
      args = replaceToken(base, game.romPath, effectiveRom);
    } else {
      args = base;
    }
  }

  const plan: RomLaunchPlan = {
    executablePath: emulator.executablePath,
    arguments: args,
  };
  if (emulator.executablePath) {
    plan.workingDir = path.dirname(emulator.executablePath);
  }
  if (Array.isArray(profile.envVars)) {
    const envVars = profile.envVars.filter(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
    );
    if (envVars.length > 0) plan.envVars = envVars;
  }
  if (extractedRomPath) plan.extractedRomPath = extractedRomPath;
  if (biosRequirementsFor(emulator.platform).length > 0) {
    const check = await checkBios(emulator);
    const missing = mandatoryBiosMissing(check);
    if (missing.length > 0) plan.biosMissing = missing;
  }
  try {
    plan.savesStatus = await savesStatus(game.id);
  } catch {
    // Save health is advisory; a missing emulator/saves folder must not block launch.
  }
  return plan;
}
