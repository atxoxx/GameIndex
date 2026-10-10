//! VR detection heuristics.
//!
//! A game counts as VR when a metadata source says so (an IGDB platform
//! list that contains a known headset/runtime, or a Steam category/tag
//! that mentions VR), when its title carries a standalone "VR" token
//! ("Skyrim VR", "Fallout 4 VR"), or when the user flips the manual
//! override. The heuristics stay conservative: only known platform
//! keywords or a word-boundary "VR" token match, so ordinary words that
//! merely contain the letters "vr" never trigger a false positive.

/// IGDB platform names (lower-cased substrings) that identify VR
/// hardware or runtimes. Matched case-insensitively against the full
/// platform name IGDB reports (e.g. "SteamVR", "Meta Quest 2",
/// "PlayStation VR2").
const VR_PLATFORM_KEYWORDS: &[&str] = &[
    "steamvr",
    "oculus",
    "meta quest",
    "quest 2",
    "quest 3",
    "quest pro",
    "playstation vr",
    "psvr",
    "windows mixed reality",
    "htc vive",
    "valve index",
    "viveport",
    "openxr",
    "pico 4",
    "pico neo",
];

/// True when `name` contains a standalone "vr" token ("Skyrim VR",
/// "Fallout 4 VR", "VR Chat") or the phrase "virtual reality".
pub fn title_looks_vr(name: &str) -> bool {
    let lower = name.to_lowercase();
    if lower.contains("virtual reality") {
        return true;
    }
    lower
        .split(|c: char| !c.is_ascii_alphanumeric())
        .any(|tok| tok == "vr")
}

/// True when a free-text category / tag / genre string denotes VR, e.g.
/// Steam's "VR Support" / "VR Supported" / "VR Only" categories or the
/// community "VR" tag. The phrase "virtual reality" also matches.
pub fn text_looks_vr(text: &str) -> bool {
    let lower = text.to_lowercase();
    if lower.contains("virtual reality") {
        return true;
    }
    lower
        .split(|c: char| !c.is_ascii_alphanumeric())
        .any(|tok| tok == "vr" || tok == "vr2")
}

/// True when an IGDB platform name identifies a VR device or runtime.
pub fn platform_looks_vr(name: &str) -> bool {
    let lower = name.to_lowercase();
    VR_PLATFORM_KEYWORDS
        .iter()
        .any(|needle| lower.contains(needle))
}

/// Aggregate heuristic used by the metadata scrapers: VR when the title,
/// any category/tag, or any platform name says so.
pub fn detect_vr(title: &str, texts: &[String], platforms: &[String]) -> bool {
    title_looks_vr(title)
        || texts.iter().any(|t| text_looks_vr(t))
        || platforms.iter().any(|p| platform_looks_vr(p))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_token_matches_standalone_vr() {
        assert!(title_looks_vr("Skyrim VR"));
        assert!(title_looks_vr("Fallout 4 VR"));
        assert!(title_looks_vr("Half-Life: Alyx VR Edition"));
        assert!(title_looks_vr("Virtual Reality Boxing"));
    }

    #[test]
    fn title_token_ignores_vr_inside_words() {
        // Substring-only matches must not fire.
        assert!(!title_looks_vr("Vroom Racing"));
        assert!(!title_looks_vr("Cover Fire"));
        assert!(!title_looks_vr("Overwatch"));
    }

    #[test]
    fn text_matches_steam_vr_categories() {
        assert!(text_looks_vr("VR Support"));
        assert!(text_looks_vr("VR Supported"));
        assert!(text_looks_vr("VR Only"));
        assert!(!text_looks_vr("Steam Achievements"));
    }

    #[test]
    fn platform_matches_known_headsets() {
        assert!(platform_looks_vr("SteamVR"));
        assert!(platform_looks_vr("Meta Quest 2"));
        assert!(platform_looks_vr("PlayStation VR2"));
        assert!(platform_looks_vr("Oculus Quest"));
        assert!(!platform_looks_vr("PC (Microsoft Windows)"));
        assert!(!platform_looks_vr("PlayStation 5"));
    }

    #[test]
    fn detect_vr_combines_signals() {
        let none: Vec<String> = vec![];
        assert!(detect_vr("Beat Saber VR", &none, &none));
        assert!(detect_vr("Some Game", &["VR Support".into()], &none));
        assert!(detect_vr("Some Game", &none, &["SteamVR".into()]));
        assert!(!detect_vr("Some Game", &["Action".into()], &["PC".into()]));
    }
}
