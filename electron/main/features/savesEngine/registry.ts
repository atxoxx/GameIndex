/**
 * Curated save-location registry (ported from `src-tauri/src/saves/registry.rs`).
 *
 * A small hand-maintained table of exact-ish save paths for widely played
 * titles, keyed by Steam app id and/or normalized title. It complements the
 * heuristic scanner: the registry gives precise answers for known games, and
 * the heuristic + manual paths cover everything else.
 *
 * Templates resolve against the host's known folders (see `detect.ts`):
 *
 *   `<winAppData>`  `<winLocalAppData>`  `<winLocalLow>`
 *   `<winDocuments>` `<winSavedGames>`   `<winProgramData>`
 *   `<home>`  `<base>`  `<storeAppId>`  `<osUserName>`
 */

export interface CuratedSave {
  /** Steam app id, when the title ships on Steam. */
  steamAppid?: number;
  /** Alternative normalized names to match when there is no app id. */
  names: string[];
  /** Save path templates, in display order. */
  paths: string[];
}

/** Normalize a title/folder for comparison: lowercase alphanumerics only. */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Look up a registry entry by Steam app id first, then by name. */
export function lookupCurated(
  appId: number | null,
  name: string,
): CuratedSave | undefined {
  if (appId !== null) {
    const byId = CURATED_SAVES.find((entry) => entry.steamAppid === appId);
    if (byId) return byId;
  }
  const target = normalizeName(name);
  if (!target) return undefined;
  return CURATED_SAVES.find((entry) =>
    entry.names.some((candidate) => normalizeName(candidate) === target),
  );
}

export const CURATED_SAVES: CuratedSave[] = [
  {
    steamAppid: 292030,
    names: ["The Witcher 3", "The Witcher 3 Wild Hunt"],
    paths: ["<winDocuments>/The Witcher 3/gamesaves", "<winDocuments>/The Witcher 3"],
  },
  {
    steamAppid: 1245620,
    names: ["Elden Ring"],
    paths: [
      "<winAppData>/EldenRing",
      "<home>/.steam/steam/steamapps/compatdata/<storeAppId>/pfx/drive_c/users/steamuser/AppData/Roaming/EldenRing",
    ],
  },
  {
    steamAppid: 374320,
    names: ["Dark Souls III", "Dark Souls 3"],
    paths: ["<winAppData>/DarkSoulsIII"],
  },
  {
    steamAppid: 570940,
    names: ["DARK SOULS REMASTERED", "Dark Souls Remastered"],
    paths: [
      "<winDocuments>/NBGI/DARK SOULS REMASTERED",
      "<winAppData>/DarkSoulsRemastered",
    ],
  },
  {
    steamAppid: 814380,
    names: ["Sekiro Shadows Die Twice", "Sekiro"],
    paths: ["<winAppData>/Sekiro"],
  },
  {
    steamAppid: 489830,
    names: ["The Elder Scrolls V Skyrim Special Edition", "Skyrim Special Edition"],
    paths: ["<winDocuments>/My Games/Skyrim Special Edition/Saves"],
  },
  {
    steamAppid: 377160,
    names: ["Fallout 4"],
    paths: ["<winDocuments>/My Games/Fallout4/Saves"],
  },
  {
    steamAppid: 1086940,
    names: ["Baldurs Gate 3", "Baldur's Gate 3"],
    paths: [
      "<winLocalAppData>/Larian Studios/Baldur's Gate 3/PlayerProfiles",
      "<home>/.steam/steam/steamapps/compatdata/<storeAppId>/pfx/drive_c/users/steamuser/AppData/Local/Larian Studios/Baldur's Gate 3/PlayerProfiles",
    ],
  },
  {
    steamAppid: 435150,
    names: ["Divinity Original Sin 2"],
    paths: [
      "<winLocalAppData>/Larian Studios/Divinity Original Sin 2",
      "<winDocuments>/Larian Studios/Divinity Original Sin 2",
    ],
  },
  {
    steamAppid: 1091500,
    names: ["Cyberpunk 2077"],
    paths: ["<winSavedGames>/CD Projekt Red/Cyberpunk 2077"],
  },
  {
    steamAppid: 271590,
    names: ["Grand Theft Auto V", "GTA V", "GTAV"],
    paths: [
      "<winDocuments>/Rockstar Games/GTA V/Profiles",
      "<winAppData>/Goldberg SocialClub Emu Saves/GTA V",
    ],
  },
  {
    steamAppid: 1174180,
    names: ["Red Dead Redemption 2"],
    paths: ["<winDocuments>/Rockstar Games/Red Dead Redemption 2/Profiles"],
  },
  {
    steamAppid: 413150,
    names: ["Stardew Valley"],
    paths: ["<winAppData>/StardewValley", "<home>/.config/StardewValley"],
  },
  {
    steamAppid: 105600,
    names: ["Terraria"],
    paths: ["<winDocuments>/My Games/Terraria", "<home>/.local/share/Terraria"],
  },
  {
    steamAppid: 427520,
    names: ["Factorio"],
    paths: ["<winAppData>/Factorio/saves", "<home>/.factorio/saves"],
  },
  {
    steamAppid: 294100,
    names: ["RimWorld"],
    paths: [
      "<winLocalLow>/Ludeon Studios/RimWorld by Ludeon Studios/Saves",
      "<home>/.config/unity3d/Ludeon Studios/RimWorld by Ludeon Studios/Saves",
    ],
  },
  {
    steamAppid: 367520,
    names: ["Hollow Knight"],
    paths: [
      "<winLocalLow>/Team Cherry/Hollow Knight",
      "<home>/.config/unity3d/Team Cherry/Hollow Knight",
      "<home>/.local/share/Steam/steamapps/compatdata/<storeAppId>/pfx/drive_c/users/steamuser/AppData/LocalLow/Team Cherry/Hollow Knight",
    ],
  },
  {
    steamAppid: 1145360,
    names: ["Hades"],
    paths: ["<winSavedGames>/Hades", "<home>/.config/unity3d/Supergiant Games/Hades"],
  },
  {
    steamAppid: 632470,
    names: ["Disco Elysium"],
    paths: [
      "<winLocalLow>/ZAUM Studio/Disco Elysium",
      "<home>/.config/unity3d/ZAUM Studio/Disco Elysium",
    ],
  },
  {
    steamAppid: 391540,
    names: ["Undertale"],
    paths: ["<winAppData>/UNDERTALE", "<home>/.config/UNDERTALE"],
  },
  {
    steamAppid: 892970,
    names: ["Valheim"],
    paths: [
      "<winAppData>/IronGate/Valheim",
      "<home>/.config/unity3d/IronGate/Valheim",
    ],
  },
  {
    steamAppid: 1623730,
    names: ["Palworld"],
    paths: [
      "<winLocalAppData>/Pal/Saved/SaveGames",
      "<home>/.steam/steam/steamapps/compatdata/<storeAppId>/pfx/drive_c/users/steamuser/AppData/Local/Pal/Saved/SaveGames",
    ],
  },
  {
    steamAppid: 1326470,
    names: ["Sons Of The Forest"],
    paths: ["<winLocalAppData>/Sons Of The Forest"],
  },
  {
    steamAppid: 255710,
    names: ["Cities Skylines", "Cities: Skylines"],
    paths: [
      "<winLocalLow>/Colossal Order/Cities_Skylines",
      "<home>/.config/unity3d/Colossal Order/Cities_Skylines",
    ],
  },
  {
    steamAppid: 582010,
    names: ["Monster Hunter World", "Monster Hunter: World"],
    paths: ["<winSavedGames>/Monster Hunter World"],
  },
  {
    steamAppid: 1222670,
    names: ["The Sims 4"],
    paths: ["<winDocuments>/Electronic Arts/The Sims 4/saves"],
  },
  {
    names: ["Minecraft"],
    paths: ["<winAppData>/.minecraft/saves", "<home>/.minecraft/saves"],
  },
];
