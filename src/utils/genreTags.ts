/**
 * genreTags.ts
 *
 * Utilities for normalizing, deduplicating, and merging genre and user tags
 * from multiple sources (Steam, IGDB, LaunchBox, manual entries).
 */

/**
 * Noise tags that are subjective opinions, content warnings, or meta attributes
 * rather than gameplay genres, settings, or art styles.
 */
const NOISE_TAGS = new Set([
  "great soundtrack",
  "soundtrack",
  "good soundtrack",
  "music",
  "benchmark",
  "memes",
  "meme",
  "illuminati",
  "masterpiece",
  "replay value",
  "cult classic",
  "funny",
  "comedy",
  "violent",
  "violence",
  "gore",
  "blood",
  "nudity",
  "sexual content",
  "nsfw",
  "mature",
  "fast-paced",
  "short",
  "casual",
  "difficult",
  "unforgiving",
  "family friendly",
  "moddable",
  "mod",
  "early access",
  "crowdfunded",
  "kickstarter",
  "software",
  "utilities",
  "episodic",
  "free to play",
  "f2p",
  "audiobook",
  "documentary",
  "trackir",
  "hardware",
  "controller",
  "steam cloud",
  "steam achievements",
  "steam trading cards",
  "trading cards",
  "achievements",
  "remote play",
  "remote play together",
]);

/**
 * Canonical dictionary for unifying synonymous or differently-punctuated
 * genre and theme labels from Steam, IGDB, and other storefronts.
 */
const CANONICAL_TAG_MAP: Record<string, string> = {
  // RPG variants
  "rpg": "RPG",
  "role-playing": "RPG",
  "role-playing (rpg)": "RPG",
  "role-playing game": "RPG",
  "action rpg": "Action RPG",
  "action-rpg": "Action RPG",
  "arpg": "Action RPG",
  "crpg": "cRPG",
  "jrpg": "JRPG",
  "tactical rpg": "Tactical RPG",
  "strategy rpg": "Strategy RPG",
  "mmorpg": "MMORPG",
  "mmo": "MMO",

  // Sci-Fi
  "science fiction": "Sci-Fi",
  "sci-fi": "Sci-Fi",
  "scifi": "Sci-Fi",
  "cyberpunk": "Cyberpunk",
  "steampunk": "Steampunk",
  "post-apocalyptic": "Post-Apocalyptic",
  "post apocalyptic": "Post-Apocalyptic",
  "space": "Space",

  // Action / Adventure
  "action": "Action",
  "adventure": "Adventure",
  "action/adventure": "Action-Adventure",
  "action / adventure": "Action-Adventure",
  "action-adventure": "Action-Adventure",
  "hack and slash": "Hack and Slash",
  "hack and slash/beat 'em up": "Hack and Slash",
  "beat 'em up": "Beat 'Em Up",
  "beat em up": "Beat 'Em Up",

  // Shooters
  "shooter": "Shooter",
  "fps": "FPS",
  "first person shooter": "FPS",
  "first-person shooter": "FPS",
  "first-person": "First-Person",
  "first person": "First-Person",
  "third-person shooter": "Third-Person Shooter",
  "third person shooter": "Third-Person Shooter",
  "tps": "Third-Person Shooter",
  "third-person": "Third-Person",
  "third person": "Third-Person",
  "shoot 'em up": "Shoot 'Em Up",
  "shmup": "Shoot 'Em Up",
  "bullet hell": "Bullet Hell",
  "twin stick shooter": "Twin Stick Shooter",
  "top-down shooter": "Top-Down Shooter",
  "arena shooter": "Arena Shooter",
  "looter shooter": "Looter Shooter",
  "hero shooter": "Hero Shooter",
  "boomer shooter": "Boomer Shooter",

  // Gameplay modes
  "singleplayer": "Single-player",
  "single-player": "Single-player",
  "single player": "Single-player",
  "multiplayer": "Multiplayer",
  "multi-player": "Multiplayer",
  "multi player": "Multiplayer",
  "co-op": "Co-op",
  "coop": "Co-op",
  "co-operative": "Co-op",
  "cooperative": "Co-op",
  "online co-op": "Online Co-op",
  "local co-op": "Local Co-op",
  "couch co-op": "Couch Co-op",
  "pvp": "PvP",
  "pve": "PvE",
  "split screen": "Split Screen",
  "cross-platform multiplayer": "Cross-Platform",

  // Distinct subgenres
  "souls-like": "Souls-like",
  "soulslike": "Souls-like",
  "rogue-like": "Roguelike",
  "roguelike": "Roguelike",
  "rogue-lite": "Roguelite",
  "roguelite": "Roguelite",
  "metroidvania": "Metroidvania",
  "open world": "Open World",
  "open-world": "Open World",
  "sandbox": "Sandbox",
  "deckbuilder": "Deckbuilder",
  "deck building": "Deckbuilder",
  "deckbuilding": "Deckbuilder",
  "card game": "Card Game",
  "card battler": "Card Battler",
  "turn-based": "Turn-Based",
  "turn based": "Turn-Based",
  "turn-based combat": "Turn-Based Combat",
  "turn-based strategy": "Turn-Based Strategy",
  "turn-based tactics": "Turn-Based Tactics",
  "real-time strategy": "RTS",
  "rts": "RTS",
  "real-time with pause": "RTwP",
  "tower defense": "Tower Defense",
  "city builder": "City Builder",
  "base building": "Base Building",
  "survival": "Survival",
  "survival horror": "Survival Horror",
  "psychological horror": "Psychological Horror",
  "horror": "Horror",
  "stealth": "Stealth",
  "immersive sim": "Immersive Sim",
  "visual novel": "Visual Novel",
  "point & click": "Point & Click",
  "point-and-click": "Point & Click",
  "walking simulator": "Walking Simulator",
  "puzzle": "Puzzle",
  "platformer": "Platformer",
  "2d platformer": "2D Platformer",
  "3d platformer": "3D Platformer",
  "auto battler": "Auto Battler",
  "battle royale": "Battle Royale",
  "extract shooter": "Extraction Shooter",
  "extraction shooter": "Extraction Shooter",
  "4x": "4X",
  "grand strategy": "Grand Strategy",
  "colony sim": "Colony Sim",
  "farming sim": "Farming Sim",
  "life sim": "Life Sim",
  "dating sim": "Dating Sim",
  "management": "Management",
  "simulation": "Simulation",
  "strategy": "Strategy",
  "indie": "Indie",
  "retro": "Retro",
  "pixel graphics": "Pixel Graphics",
  "dark fantasy": "Dark Fantasy",
  "fantasy": "Fantasy",
  "atmospheric": "Atmospheric",
  "story rich": "Story Rich",
  "exploration": "Exploration",
  "loot": "Loot",
  "crafting": "Crafting",
  "procedural generation": "Procedural Generation",
  "physics": "Physics",
  "vr": "VR",
  "vr supported": "VR",
};

/**
 * Normalizes a single tag string into title-cased English if not already in the dictionary.
 */
export function normalizeTag(tag: string): string {
  const trimmed = tag.trim();
  if (!trimmed) return "";

  const lower = trimmed.toLowerCase();
  if (CANONICAL_TAG_MAP[lower]) {
    return CANONICAL_TAG_MAP[lower];
  }

  // Proper title casing for unknown words
  return trimmed
    .split(/[\s_-]+/)
    .map((word) => {
      if (!word) return "";
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * True if a tag is a noise/meta tag that should not appear in genre chips.
 */
export function isNoiseTag(tag: string): boolean {
  const lower = tag.toLowerCase().trim();
  return NOISE_TAGS.has(lower);
}

/**
 * Deduplicates and merges tags from multiple sources:
 * - existing genres already on the game record
 * - IGDB genres and themes
 * - Steam broad genres and community user tags
 *
 * Filters out noise/meta tags, applies canonical dictionary mappings,
 * eliminates case-insensitive duplicates, and limits the output to a clean,
 * comprehensive list.
 */
export function deduplicateAndMergeTags(
  ...sources: (string[] | undefined | null)[]
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    if (!source || !Array.isArray(source)) continue;
    for (const raw of source) {
      if (!raw || typeof raw !== "string") continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;

      if (isNoiseTag(trimmed)) continue;

      const canonical = normalizeTag(trimmed);
      if (!canonical) continue;

      const lowerKey = canonical.toLowerCase();
      if (!seen.has(lowerKey)) {
        seen.add(lowerKey);
        result.push(canonical);
      }
    }
  }

  return result;
}
