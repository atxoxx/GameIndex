//! Curated save-location registry.
//!
//! A small, hand-maintained table of exact-ish save paths for widely
//! played titles, keyed by Steam app id and/or normalized title. It
//! complements the heuristic scanner in [`super::detect`]: the registry
//! gives precise answers for known games, and the heuristic + manual
//! paths cover everything else.
//!
//! Paths are templates. The scanner resolves these tokens against the
//! host's known folders (see `detect::Roots`):
//!
//!   `<winAppData>`      <winLocalAppData>   <winLocalLow>
//!   <winDocuments>      <winSavedGames>     <winProgramData>
//!   <home>              <base>              <storeAppId>
//!   <osUserName>
//!
//! Templates that don't resolve (e.g. a Windows-only token on Linux) or
//! point at a path that doesn't exist are simply skipped, so it is safe
//! to list both Windows and Linux variants for the same game.

/// One registry entry: the identities it matches + its save templates.
pub struct CuratedSave {
    /// Steam app id, when the title ships on Steam.
    pub steam_appid: Option<u32>,
    /// Alternative normalized names to match when there's no app id
    /// (or the game was imported without one).
    pub names: &'static [&'static str],
    /// Save path templates, in display order.
    pub paths: &'static [&'static str],
}

/// Normalize a title/folder for comparison: lowercase alphanumerics only.
pub fn normalize_name(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// Look up a registry entry by Steam app id first, then by name.
pub fn lookup(app_id: Option<u32>, name: &str) -> Option<&'static CuratedSave> {
    if let Some(id) = app_id {
        if let Some(entry) = CURATED_SAVES.iter().find(|e| e.steam_appid == Some(id)) {
            return Some(entry);
        }
    }
    let target = normalize_name(name);
    if target.is_empty() {
        return None;
    }
    CURATED_SAVES.iter().find(|e| {
        e.names
            .iter()
            .any(|n| normalize_name(n) == target)
    })
}

/// The curated table. Deliberately modest: broad coverage comes from the
/// heuristics; these are the titles users most often want pinned down.
pub static CURATED_SAVES: &[CuratedSave] = &[
    CuratedSave {
        steam_appid: Some(292030),
        names: &["The Witcher 3", "The Witcher 3 Wild Hunt"],
        paths: &[
            "<winDocuments>/The Witcher 3/gamesaves",
            "<winDocuments>/The Witcher 3",
        ],
    },
    CuratedSave {
        steam_appid: Some(1245620),
        names: &["Elden Ring"],
        paths: &[
            "<winAppData>/EldenRing",
            "<home>/.steam/steam/steamapps/compatdata/<storeAppId>/pfx/drive_c/users/steamuser/AppData/Roaming/EldenRing",
        ],
    },
    CuratedSave {
        steam_appid: Some(374320),
        names: &["Dark Souls III", "Dark Souls 3"],
        paths: &["<winAppData>/DarkSoulsIII"],
    },
    CuratedSave {
        steam_appid: Some(570940),
        names: &["DARK SOULS REMASTERED", "Dark Souls Remastered"],
        paths: &[
            "<winDocuments>/NBGI/DARK SOULS REMASTERED",
            "<winAppData>/DarkSoulsRemastered",
        ],
    },
    CuratedSave {
        steam_appid: Some(814380),
        names: &["Sekiro Shadows Die Twice", "Sekiro"],
        paths: &["<winAppData>/Sekiro"],
    },
    CuratedSave {
        steam_appid: Some(489830),
        names: &["The Elder Scrolls V Skyrim Special Edition", "Skyrim Special Edition"],
        paths: &["<winDocuments>/My Games/Skyrim Special Edition/Saves"],
    },
    CuratedSave {
        steam_appid: Some(377160),
        names: &["Fallout 4"],
        paths: &["<winDocuments>/My Games/Fallout4/Saves"],
    },
    CuratedSave {
        steam_appid: Some(1086940),
        names: &["Baldurs Gate 3", "Baldur's Gate 3"],
        paths: &[
            "<winLocalAppData>/Larian Studios/Baldur's Gate 3/PlayerProfiles",
            "<home>/.steam/steam/steamapps/compatdata/<storeAppId>/pfx/drive_c/users/steamuser/AppData/Local/Larian Studios/Baldur's Gate 3/PlayerProfiles",
        ],
    },
    CuratedSave {
        steam_appid: Some(435150),
        names: &["Divinity Original Sin 2"],
        paths: &[
            "<winLocalAppData>/Larian Studios/Divinity Original Sin 2",
            "<winDocuments>/Larian Studios/Divinity Original Sin 2",
        ],
    },
    CuratedSave {
        steam_appid: Some(1091500),
        names: &["Cyberpunk 2077"],
        paths: &["<winSavedGames>/CD Projekt Red/Cyberpunk 2077"],
    },
    CuratedSave {
        steam_appid: Some(271590),
        names: &["Grand Theft Auto V", "GTA V", "GTAV"],
        paths: &[
            "<winDocuments>/Rockstar Games/GTA V/Profiles",
            "<winAppData>/Goldberg SocialClub Emu Saves/GTA V",
        ],
    },
    CuratedSave {
        steam_appid: Some(1174180),
        names: &["Red Dead Redemption 2"],
        paths: &["<winDocuments>/Rockstar Games/Red Dead Redemption 2/Profiles"],
    },
    CuratedSave {
        steam_appid: Some(413150),
        names: &["Stardew Valley"],
        paths: &[
            "<winAppData>/StardewValley",
            "<home>/.config/StardewValley",
        ],
    },
    CuratedSave {
        steam_appid: Some(105600),
        names: &["Terraria"],
        paths: &[
            "<winDocuments>/My Games/Terraria",
            "<home>/.local/share/Terraria",
        ],
    },
    CuratedSave {
        steam_appid: Some(427520),
        names: &["Factorio"],
        paths: &[
            "<winAppData>/Factorio/saves",
            "<home>/.factorio/saves",
        ],
    },
    CuratedSave {
        steam_appid: Some(294100),
        names: &["RimWorld"],
        paths: &[
            "<winLocalLow>/Ludeon Studios/RimWorld by Ludeon Studios/Saves",
            "<home>/.config/unity3d/Ludeon Studios/RimWorld by Ludeon Studios/Saves",
        ],
    },
    CuratedSave {
        steam_appid: Some(367520),
        names: &["Hollow Knight"],
        paths: &[
            "<winLocalLow>/Team Cherry/Hollow Knight",
            "<home>/.config/unity3d/Team Cherry/Hollow Knight",
            "<home>/.local/share/Steam/steamapps/compatdata/<storeAppId>/pfx/drive_c/users/steamuser/AppData/LocalLow/Team Cherry/Hollow Knight",
        ],
    },
    CuratedSave {
        steam_appid: Some(1145360),
        names: &["Hades"],
        paths: &[
            "<winSavedGames>/Hades",
            "<home>/.config/unity3d/Supergiant Games/Hades",
        ],
    },
    CuratedSave {
        steam_appid: Some(632470),
        names: &["Disco Elysium"],
        paths: &[
            "<winLocalLow>/ZAUM Studio/Disco Elysium",
            "<home>/.config/unity3d/ZAUM Studio/Disco Elysium",
        ],
    },
    CuratedSave {
        steam_appid: Some(391540),
        names: &["Undertale"],
        paths: &[
            "<winAppData>/UNDERTALE",
            "<home>/.config/UNDERTALE",
        ],
    },
    CuratedSave {
        steam_appid: Some(892970),
        names: &["Valheim"],
        paths: &[
            "<winAppData>/IronGate/Valheim",
            "<home>/.config/unity3d/IronGate/Valheim",
        ],
    },
    CuratedSave {
        steam_appid: Some(1623730),
        names: &["Palworld"],
        paths: &[
            "<winLocalAppData>/Pal/Saved/SaveGames",
            "<home>/.steam/steam/steamapps/compatdata/<storeAppId>/pfx/drive_c/users/steamuser/AppData/Local/Pal/Saved/SaveGames",
        ],
    },
    CuratedSave {
        steam_appid: Some(1326470),
        names: &["Sons Of The Forest"],
        paths: &["<winLocalAppData>/Sons Of The Forest"],
    },
    CuratedSave {
        steam_appid: Some(255710),
        names: &["Cities Skylines", "Cities: Skylines"],
        paths: &[
            "<winLocalLow>/Colossal Order/Cities_Skylines",
            "<home>/.config/unity3d/Colossal Order/Cities_Skylines",
        ],
    },
    CuratedSave {
        steam_appid: Some(582010),
        names: &["Monster Hunter World", "Monster Hunter: World"],
        paths: &["<winSavedGames>/Monster Hunter World"],
    },
    CuratedSave {
        steam_appid: Some(1222670),
        names: &["The Sims 4"],
        paths: &["<winDocuments>/Electronic Arts/The Sims 4/saves"],
    },
    CuratedSave {
        steam_appid: None,
        names: &["Minecraft"],
        paths: &[
            "<winAppData>/.minecraft/saves",
            "<home>/.minecraft/saves",
        ],
    },
];
