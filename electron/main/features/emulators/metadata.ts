/**
 * ROM identification and metadata that must not be invented.
 *
 * The Rust build searched IGDB through `game_scraper::search_igdb`. This build
 * has no metadata provider wired into the emulation commands, so the port
 * matches against the user's own library instead of fabricating results:
 *
 *  • `rom_identify` derives a clean No-Intro/Redump-style title plus
 *    region/language/disc data. It returns `code: "unknown"` when the filename
 *    contains nothing usable.
 *  • `rom_scrape_metadata` returns library rows whose normalized title (and
 *    platform) match the ROM exactly. No match → `[]`, which the modal already
 *    renders as "no candidates".
 *  • `rom_apply_metadata` applies a user/accepted patch and stamps
 *    `metadataSource = "manual"`, so a rescan preserves the correction.
 *  • `enrich_emulator_metadata` fills only fields that are still empty, from
 *    those exact matches, and counts everything else as `failed` (unknown),
 *    never as a match.
 */
import path from "node:path";
import { getGame, listGames, patchGameRecord, upsertGames } from "../../state/libraryStore";
import type { Game } from "../../../../src/types/game";
import { parseRomFilename, normalizeTitle } from "./naming";
import { romCleanTitle } from "./library";
import { createThrottledEmitter } from "./progress";
import { getEmulator } from "./store";
import type {
  ParsedRomName,
  RomEnrichSummary,
  RomMetadataCandidate,
  RomProfile,
} from "./types";

/** Upper bound for one enrichment pass (same 500 as the Rust command). */
const MAX_ENRICH = 500;

function requireGame(gameId: string): Game {
  const game = getGame(gameId);
  if (!game) throw new Error(`ROM not found: ${gameId}`);
  return game;
}

function romStem(game: Game): string {
  if (game.romPath) {
    const stem = path.basename(game.romPath, path.extname(game.romPath));
    if (stem) return stem;
  }
  return game.name;
}

/** `rom_identify` — filename parsing with an explicit unknown verdict. */
export function identifyRom(gameId: string): ParsedRomName {
  const game = requireGame(gameId);
  const parsed = parseRomFilename(romStem(game));
  if (!parsed.cleanTitle) {
    return {
      cleanTitle: game.name.trim(),
      code: game.name.trim() ? "ok" : "unknown",
    };
  }
  return parsed;
}

/**
 * Strict title/platform match against the library.
 *
 * A match requires equal normalized titles; when both sides carry a real
 * platform it must be the same platform string. Non-ROM library entries are
 * preferred because they usually carry scraped metadata.
 */
function findLibraryMatches(
  title: string,
  platform: string | undefined,
  excludeGameId: string,
): Game[] {
  const wanted = normalizeTitle(title);
  if (!wanted) return [];
  const wantedPlatform = (platform ?? "").trim().toLowerCase();

  const matches: Game[] = [];
  for (const game of listGames()) {
    if (game.id === excludeGameId) continue;
    if (normalizeTitle(game.name) !== wanted) continue;
    const candidatePlatform = (game.platform ?? "").trim().toLowerCase();
    if (
      wantedPlatform &&
      candidatePlatform &&
      wantedPlatform !== "unknown" &&
      candidatePlatform !== "unknown" &&
      wantedPlatform !== candidatePlatform
    ) {
      continue;
    }
    matches.push(game);
  }
  matches.sort((left, right) => {
    const leftRom = left.emulatorId ? 1 : 0;
    const rightRom = right.emulatorId ? 1 : 0;
    return leftRom - rightRom;
  });
  // Prefer real library entries over other ROM rows with the same title: the
  // latter carry no extra metadata and would just duplicate the candidate list.
  const nonRom = matches.filter((game) => !game.emulatorId);
  return nonRom.length > 0 ? nonRom : matches;
}

function toCandidate(game: Game): RomMetadataCandidate {
  const candidate: RomMetadataCandidate = {
    title: game.name,
    genres: game.genres ?? [],
    sourceName: "Library",
  };
  if (game.description) candidate.description = game.description;
  if (game.developer) candidate.developer = game.developer;
  if (game.publisher) candidate.publisher = game.publisher;
  if (game.releaseDate) candidate.releaseDate = game.releaseDate;
  if (game.coverArtUrl) candidate.coverUrl = game.coverArtUrl;
  if (game.coverSourceUrl) candidate.sourceUrl = game.coverSourceUrl;
  if (game.igdbId) candidate.igdbId = game.igdbId;
  return candidate;
}

/** Library candidates for one ROM (`rom_scrape_metadata`). */
export function scrapeRomMetadata(gameId: string): RomMetadataCandidate[] {
  const game = requireGame(gameId);
  const title = romCleanTitle(game);
  const matches = findLibraryMatches(title, game.platform, game.id).slice(0, 10);
  return matches.map(toCandidate);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.filter((entry): entry is string => typeof entry === "string");
  return out.length > 0 ? out : [];
}

/** Apply a metadata patch and persist it (`rom_apply_metadata`). */
export function applyRomMetadata(gameId: string, rawPatch: unknown): Game {
  const game = requireGame(gameId);
  const patch = (rawPatch ?? {}) as Record<string, unknown>;
  const next: Game = { ...game };

  const name = text(patch.name);
  if (name) next.name = name;
  const cover = text(patch.coverArtUrl);
  if (cover) next.coverArtUrl = cover;
  if (patch.description !== undefined) {
    next.description = typeof patch.description === "string" ? patch.description : undefined;
  }
  if (patch.developer !== undefined) {
    next.developer = typeof patch.developer === "string" ? patch.developer : undefined;
  }
  if (patch.publisher !== undefined) {
    next.publisher = typeof patch.publisher === "string" ? patch.publisher : undefined;
  }
  if (patch.releaseDate !== undefined) {
    next.releaseDate = typeof patch.releaseDate === "string" ? patch.releaseDate : undefined;
  }
  const genres = stringList(patch.genres);
  if (genres !== null) next.genres = genres;
  const screenshots = stringList(patch.screenshots);
  if (screenshots !== null) next.screenshots = screenshots;
  const region = text(patch.region);
  if (region) next.romRegion = region;
  const language = text(patch.language);
  if (language) next.romLanguage = language;

  next.metadataSource = "manual";
  upsertGames([next]);
  return next;
}

function fillMissing(target: Game, source: Game): boolean {
  let changed = false;
  if (!target.coverArtUrl && source.coverArtUrl) {
    target.coverArtUrl = source.coverArtUrl;
    changed = true;
  }
  if (!target.coverSourceUrl && source.coverSourceUrl) {
    target.coverSourceUrl = source.coverSourceUrl;
    changed = true;
  }
  if (!target.bannerUrl && source.bannerUrl) {
    target.bannerUrl = source.bannerUrl;
    changed = true;
  }
  if (!target.description && source.description) {
    target.description = source.description;
    changed = true;
  }
  if (!target.developer && source.developer) {
    target.developer = source.developer;
    changed = true;
  }
  if (!target.publisher && source.publisher) {
    target.publisher = source.publisher;
    changed = true;
  }
  if (!target.releaseDate && source.releaseDate) {
    target.releaseDate = source.releaseDate;
    changed = true;
  }
  if ((!target.genres || target.genres.length === 0) && source.genres?.length) {
    target.genres = source.genres;
    changed = true;
  }
  if ((!target.screenshots || target.screenshots.length === 0) && source.screenshots?.length) {
    target.screenshots = source.screenshots;
    changed = true;
  }
  if (target.igdbId === undefined && source.igdbId !== undefined) {
    target.igdbId = source.igdbId;
    changed = true;
  }
  if (!target.metadataSource && source.metadataSource) {
    target.metadataSource = source.metadataSource;
    changed = true;
  }
  if (!target.metadataUrl && source.metadataUrl) {
    target.metadataUrl = source.metadataUrl;
    changed = true;
  }
  return changed;
}

/**
 * Enrich one emulator's ROMs from exact library matches
 * (`enrich_emulator_metadata`). Streams `rom-enrich-progress`.
 */
export async function enrichEmulatorMetadata(
  emulatorId: string,
  onlyMissing = true,
): Promise<RomEnrichSummary> {
  if (!getEmulator(emulatorId)) throw new Error(`Emulator not found: ${emulatorId}`);
  const rows = listGames()
    .filter((game) => game.emulatorId === emulatorId)
    .slice(0, MAX_ENRICH);

  const summary: RomEnrichSummary = {
    requested: rows.length,
    matched: 0,
    failed: 0,
    skipped: 0,
  };
  if (rows.length === 0) return summary;

  const progress = createThrottledEmitter("rom-enrich-progress", 100);
  progress.reset();
  const updated: Game[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const game = rows[index];
    if (onlyMissing && (game.coverArtUrl || game.description)) {
      summary.skipped += 1;
      continue;
    }
    const title = romCleanTitle(game);
    if (!title.trim()) {
      summary.skipped += 1;
      continue;
    }
    const matches = findLibraryMatches(title, game.platform, game.id);
    const best = matches[0];
    if (!best) {
      summary.failed += 1;
      progress.send({
        emulatorId,
        done: index + 1,
        total: rows.length,
        title: game.name,
      });
      continue;
    }

    const next: Game = { ...game };
    if (fillMissing(next, best)) {
      updated.push(next);
      summary.matched += 1;
    } else {
      summary.skipped += 1;
    }
    progress.send({
      emulatorId,
      done: index + 1,
      total: rows.length,
      title: next.name,
    });
    if (index % 16 === 15) await new Promise<void>((resolve) => setImmediate(resolve));
  }

  if (updated.length > 0) upsertGames(updated);
  progress.send(
    {
      emulatorId,
      done: rows.length,
      total: rows.length,
      title: summary.matched > 0 ? `${summary.matched} matched` : "done",
    },
    true,
  );
  return summary;
}

function normalizeProfile(raw: unknown): RomProfile | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const profile: RomProfile = {};
  if (typeof value.argumentsOverride === "string" && value.argumentsOverride.trim()) {
    profile.argumentsOverride = value.argumentsOverride.trim();
  }
  if (typeof value.graphicsBackend === "string" && value.graphicsBackend.trim()) {
    profile.graphicsBackend = value.graphicsBackend.trim();
  }
  if (typeof value.resolution === "string" && value.resolution.trim()) {
    profile.resolution = value.resolution.trim();
  }
  if (typeof value.controllerLayout === "string" && value.controllerLayout.trim()) {
    profile.controllerLayout = value.controllerLayout.trim();
  }
  if (typeof value.shaders === "string" && value.shaders.trim()) {
    profile.shaders = value.shaders.trim();
  }
  if (value.fullscreen === true) profile.fullscreen = true;
  if (Array.isArray(value.envVars)) {
    const env = value.envVars.filter(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
    );
    if (env.length > 0) profile.envVars = env;
  }
  return Object.keys(profile).length > 0 ? profile : null;
}

/**
 * Save (or clear, when the profile is empty) a ROM's launch profile
 * (`rom_profile_save`). Returns the updated library row.
 */
export function saveRomProfile(gameId: string, rawProfile: unknown): Game {
  requireGame(gameId);
  const profile = normalizeProfile(rawProfile);
  // `null` (not `undefined`) is the only value the library store writes through
  // as a real "clear" — `undefined` means "leave the stored value alone".
  patchGameRecord(gameId, { romProfile: profile });
  const updated = getGame(gameId);
  if (!updated) throw new Error(`ROM not found: ${gameId}`);
  return updated;
}
