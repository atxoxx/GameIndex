/**
 * BIOS / firmware detection.
 *
 * Ported from `src-tauri/src/roms.rs` (`bios_requirements`,
 * `bios_check_blocking`, `find_bios_file`, `sha1_file`, `bios_board_ready`).
 *
 * Only file names are shipped — never firmware. The PS1 dumps additionally
 * carry their well-known SHA-1 so a truncated/renamed dump is reported as
 * invalid instead of "found".
 */
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { listEmulators } from "./store";
import type {
  BiosBoardEntry,
  BiosCheckResult,
  BiosRequirement,
  BiosStatus,
  EmulatorRow,
} from "./types";

type RequirementTuple = [name: string, description: string | null, mandatory: boolean];

const REQUIREMENT_TABLE: Array<[platform: string, requirements: RequirementTuple[]]> = [
  [
    "PlayStation",
    [
      ["scph5500.bin", "PS1 NTSC-J BIOS", true],
      ["scph5501.bin", "PS1 NTSC-U/C BIOS", true],
      ["scph5502.bin", "PS1 PAL BIOS", true],
    ],
  ],
  [
    "PlayStation 2",
    [
      ["scph39001.bin", "PS2 NTSC-U/C BIOS", true],
      ["scph70012.bin", "PS2 NTSC-U/C slim BIOS", true],
      ["scph77001.bin", "PS2 NTSC-U/C slim BIOS", true],
      ["scph90000.bin", "PS2 NTSC-U/C slim BIOS", true],
    ],
  ],
  ["Game Boy", [["gb_bios.bin", "Game Boy boot ROM", false]]],
  ["Game Boy Color", [["gbc_bios.bin", "Game Boy Color boot ROM", false]]],
  ["Game Boy Advance", [["gba_bios.bin", "GBA boot ROM", false]]],
  [
    "Nintendo DS",
    [
      ["bios7.bin", "ARM7 BIOS", false],
      ["bios9.bin", "ARM9 BIOS", false],
      ["firmware.bin", "NDS firmware", false],
    ],
  ],
  [
    "Sega Saturn",
    [
      ["sega_1003.bin", "Saturn JP BIOS", true],
      ["sega_100a.bin", "Saturn US BIOS", true],
      ["sega_101.bin", "Saturn EU BIOS", true],
    ],
  ],
  [
    "Sega Dreamcast",
    [
      ["dc_boot.bin", "Dreamcast boot ROM", true],
      ["dc_flash.bin", "Dreamcast flash ROM", true],
    ],
  ],
  [
    "Xbox",
    [
      ["mcpx_1.0.bin", "MCPX boot ROM", true],
      ["xbox-1.0.bin", "Xbox kernel (v1.0)", true],
    ],
  ],
  ["PlayStation 3", [["PS3UPDAT.PUP", "RPCS3 firmware", true]]],
  ["Neo Geo", [["neogeo.zip", "Neo Geo MVS BIOS set", true]]],
];

/** Well-known PS1 dump SHA-1s (RetroArch BIOS list), in requirement order. */
const PS1_SHA1 = [
  "8dd7d5296a650fac7319bce665a6a53c09a8cc19",
  "490f666e1afb15b7362b406ed1cea246abae502b",
  "32736f17079d0b2b7024407c39bd3050e2b9e7b8",
];

/** Curated firmware requirements for a platform (empty when none are known). */
export function biosRequirementsFor(platform: string): BiosRequirement[] {
  const wanted = platform.trim().toLowerCase();
  if (!wanted) return [];
  const hit = REQUIREMENT_TABLE.find(([name]) => name.toLowerCase() === wanted);
  if (!hit) return [];
  return hit[1].map(([name, description, mandatory], index) => {
    const requirement: BiosRequirement = { name, mandatory };
    if (description) requirement.description = description;
    if (hit[0] === "PlayStation") requirement.expectedSha1 = PS1_SHA1[index];
    return requirement;
  });
}

/** Case-insensitive recursive lookup, two levels deep (BIOS folders are flat). */
async function findBiosFile(root: string, target: string): Promise<string | null> {
  const wanted = target.toLowerCase();
  const walk = async (dir: string, depth: number): Promise<string | null> => {
    if (depth > 2) return null;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const hit = await walk(full, depth + 1);
        if (hit) return hit;
      } else if (entry.name.toLowerCase() === wanted) {
        return full;
      }
    }
    return null;
  };
  return walk(root, 0);
}

async function sha1File(file: string): Promise<string | null> {
  return new Promise((resolve) => {
    const hash = crypto.createHash("sha1");
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", () => resolve(null));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Check one emulator's firmware folder. Pure filesystem work — callers should
 * keep the event loop free (the commands are async).
 */
export async function checkBios(emulator: EmulatorRow): Promise<BiosCheckResult> {
  const requirements = biosRequirementsFor(emulator.platform);
  const folder = (emulator.biosFolder ?? "").trim();
  const configured = folder.length > 0;

  const statuses: BiosStatus[] = [];
  const missing: string[] = [];

  for (const requirement of requirements) {
    const status: BiosStatus = {
      name: requirement.name,
      found: false,
      mandatory: requirement.mandatory,
    };
    if (requirement.description) status.description = requirement.description;

    if (configured) {
      const hit = await findBiosFile(folder, requirement.name);
      if (hit) {
        let size = 0;
        try {
          size = (await fsp.stat(hit)).size;
        } catch {
          size = 0;
        }
        status.found = size > 0;
        status.path = hit;
        if (requirement.expectedSha1) {
          const actual = await sha1File(hit);
          status.hashOk = actual === requirement.expectedSha1;
        }
      }
    }
    if (!status.found) missing.push(requirement.name);
    statuses.push(status);
  }

  const result: BiosCheckResult = {
    platform: emulator.platform,
    configured,
    requirements: statuses,
    missing,
  };
  if (configured) result.biosFolder = folder;
  return result;
}

/** Readiness verdict for one check (Rust `bios_board_ready`). */
export function biosBoardReady(check: BiosCheckResult): boolean {
  if (!check.configured) return false;
  return check.requirements.every((requirement) => {
    if (!requirement.mandatory && !requirement.found) return true;
    return requirement.found && requirement.hashOk !== false;
  });
}

/**
 * Firmware readiness for every configured emulator with a curated requirement
 * table (`check_all_bios_status`). Emulators whose platform ships no table are
 * skipped — there is nothing to check.
 */
export async function checkAllBios(): Promise<BiosBoardEntry[]> {
  const entries: BiosBoardEntry[] = [];
  for (const emulator of listEmulators()) {
    if (biosRequirementsFor(emulator.platform).length === 0) continue;
    const check = await checkBios(emulator);
    entries.push({
      emulatorId: emulator.id,
      emulatorName: emulator.name,
      platform: emulator.platform,
      check,
      ready: biosBoardReady(check),
    });
  }
  return entries;
}

/** Missing mandatory dump names for an emulator (health scan helper). */
export function mandatoryBiosMissing(check: BiosCheckResult): string[] {
  return check.requirements
    .filter((requirement) => requirement.mandatory && !requirement.found)
    .map((requirement) => requirement.name);
}
