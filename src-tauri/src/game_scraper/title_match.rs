// ─── Title Matching Helpers ─────────────────────────────────────────────────────

/// Remove common accents / diacritics (e.g. é -> e, ö -> o) for uniform title matching.
pub(crate) fn deaccent(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'À' | 'Á' | 'Â' | 'Ã' | 'Ä' | 'Å' => out.push('a'),
            'æ' | 'Æ' => out.push_str("ae"),
            'ç' | 'Ç' => out.push('c'),
            'è' | 'é' | 'ê' | 'ë' | 'È' | 'É' | 'Ê' | 'Ë' => out.push('e'),
            'ì' | 'í' | 'î' | 'ï' | 'Ì' | 'Í' | 'Î' | 'Ï' => out.push('i'),
            'ñ' | 'Ñ' => out.push('n'),
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'Ò' | 'Ó' | 'Ô' | 'Õ' | 'Ö' | 'Ø' => out.push('o'),
            'œ' | 'Œ' => out.push_str("oe"),
            'ß' => out.push_str("ss"),
            'ù' | 'ú' | 'û' | 'ü' | 'Ù' | 'Ú' | 'Û' | 'Ü' => out.push('u'),
            'ý' | 'ÿ' | 'Ý' => out.push('y'),
            _ => out.push(c),
        }
    }
    out
}

/// Split camelCase, PascalCase, or number-letter transitions (e.g., "TheFinals" -> "The Finals").
pub(crate) fn split_camel_case(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    let chars: Vec<char> = s.chars().collect();
    for i in 0..chars.len() {
        let curr = chars[i];
        if i > 0 {
            let prev = chars[i - 1];
            let next = chars.get(i + 1).copied();
            let is_prev_lower = prev.is_lowercase();
            let is_prev_digit = prev.is_ascii_digit();
            let is_curr_upper = curr.is_uppercase();
            let is_curr_digit = curr.is_ascii_digit();
            let is_prev_letter = prev.is_alphabetic();
            let is_curr_letter = curr.is_alphabetic();

            if (is_prev_lower && is_curr_upper)
                || (is_prev_letter && is_curr_digit)
                || (is_prev_digit && is_curr_letter)
                || (prev.is_uppercase() && is_curr_upper && next.map_or(false, |n| n.is_lowercase()))
            {
                out.push(' ');
            }
        }
        out.push(curr);
    }
    out
}

/// Clean a raw executable or imported game name before metadata searching:
/// - Strips `.exe` extension
/// - Splits camelCase/PascalCase
/// - Strips bracketed noise like `[FitGirl]`, `(v1.0)`, `(2023)`
/// - Replaces `_` and `.` with spaces
/// - Deaccents diacritics
pub fn clean_game_name_for_search(name: &str) -> String {
    let s = if name.to_lowercase().ends_with(".exe") {
        &name[..name.len() - 4]
    } else {
        name
    };

    let s = split_camel_case(s);

    if let Ok(re_brackets) = regex::Regex::new(r"(?i)\[.*?\]|\{.*?\}|\(v\d+.*?\)|(?:\(|\[)(?:fitgirl|dodi|repack|gog|proper|multi\d*)(?:\)|\])") {
        let s_cleaned = re_brackets.replace_all(&s, " ");
        let s_spaced = s_cleaned.replace(['.', '_'], " ");
        return deaccent(&s_spaced).split_whitespace().collect::<Vec<_>>().join(" ");
    }

    let s_spaced = s.replace(['.', '_'], " ");
    deaccent(&s_spaced).split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Normalize a game title for fuzzy comparison: lowercase, strip punctuation
/// and non-alphanumeric separators, and collapse whitespace.
pub(crate) fn normalize_title(name: &str) -> String {
    let cleaned = clean_game_name_for_search(name);
    cleaned
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
}

/// Score how well a candidate title matches the query.
/// Returns a value in `[0.0, 1.0]` where `1.0` means an exact normalized
/// match.
pub(crate) fn title_similarity(query: &str, candidate: &str) -> f64 {
    let q = normalize_title(query);
    let c = normalize_title(candidate);
    if q.is_empty() || c.is_empty() {
        return 0.0;
    }
    if q == c {
        return 1.0;
    }

    let q_tokens: Vec<&str> = q.split_whitespace().collect();
    let c_tokens: Vec<&str> = c.split_whitespace().collect();

    // Substring containment: bounded by min_tok / max_tok so ratio is always <= 1.0
    if c.contains(&q) || q.contains(&c) {
        let min_tok = q_tokens.len().min(c_tokens.len()) as f64;
        let max_tok = q_tokens.len().max(c_tokens.len()) as f64;
        return (min_tok / max_tok).min(1.0);
    }

    // Token overlap (Jaccard over significant words)
    let q_set: std::collections::HashSet<&str> = q_tokens.iter().copied().collect();
    let c_set: std::collections::HashSet<&str> = c_tokens.iter().copied().collect();
    let intersection = q_set.intersection(&c_set).count() as f64;
    let union = q_set.union(&c_set).count() as f64;
    if union == 0.0 {
        return 0.0;
    }
    (intersection / union).min(1.0)
}

/// Minimum similarity a metadata source title must reach before we accept it
/// as a match for the queried game. Below this we treat the source as having
/// no real match instead of wrongly attributing an unrelated game.
pub(crate) const MIN_TITLE_SIMILARITY: f64 = 0.6;

#[cfg(test)]
mod title_match_tests {
    use super::*;
    use super::super::igdb::{extract_year_hint, igdb_quality_key, strip_year_marker};
    use super::super::types::{GameImages, GameMetadataResult};

    #[test]
    fn exact_match_scores_one() {
        assert_eq!(title_similarity("Among Us", "Among Us"), 1.0);
        assert_eq!(title_similarity("AMONG US", "among us"), 1.0);
    }

    #[test]
    fn unrelated_longer_title_is_rejected() {
        // The reported bug: "The Wolf Among Us" must NOT be accepted for "Among Us".
        let s = title_similarity("Among Us", "The Wolf Among Us");
        assert!(s < MIN_TITLE_SIMILARITY, "score was {s}");
    }

    #[test]
    fn punctuation_insensitive() {
        assert_eq!(title_similarity("Halo: Combat Evolved", "Halo Combat Evolved"), 1.0);
    }

    #[test]
    fn borderline_subtitle_rejected_when_too_long() {
        // "Doom (2016)" shares only half its significant words with "Doom",
        // so it falls below the 0.6 threshold and is not auto-attributed.
        // IGDB (the preferred source) still resolves the correct title.
        assert!(title_similarity("Doom", "Doom (2016)") < MIN_TITLE_SIMILARITY);
    }

    #[test]
    fn ranking_picks_best_candidate() {
        let mut candidates = vec![
            ("The Wolf Among Us".to_string(), title_similarity("Among Us", "The Wolf Among Us")),
            ("Among Us".to_string(), title_similarity("Among Us", "Among Us")),
            ("Among Us VR".to_string(), title_similarity("Among Us", "Among Us VR")),
        ];
        candidates.sort_by(|a, b| {
            b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal)
        });
        assert_eq!(candidates[0].0, "Among Us");
    }

    #[test]
    fn test_the_finals_not_matching_final_fantasy() {
        let score = title_similarity("The Finals", "Final Fantasy IV");
        assert!(
            score < MIN_TITLE_SIMILARITY,
            "The Finals vs Final Fantasy IV score was {score}, should be < {MIN_TITLE_SIMILARITY}"
        );
    }

    #[test]
    fn test_camel_case_and_clean_search_name() {
        assert_eq!(clean_game_name_for_search("TheFinals.exe"), "The Finals");
        assert_eq!(clean_game_name_for_search("Pokémon"), "Pokemon");
        assert_eq!(clean_game_name_for_search("The_Finals_[FitGirl]"), "The Finals");
        assert_eq!(title_similarity("TheFinals", "THE FINALS"), 1.0);
    }

    #[test]
    fn year_hint_extraction() {
        assert_eq!(extract_year_hint("Prototype (2009)").as_deref(), Some("2009"));
        assert_eq!(extract_year_hint("Prototype").as_deref(), None);
        assert_eq!(extract_year_hint("Half-Life 2").as_deref(), None);
    }

    #[test]
    fn year_marker_stripped_from_search_term() {
        assert_eq!(strip_year_marker("Prototype (2009)"), "Prototype");
        assert_eq!(strip_year_marker("Prototype"), "Prototype");
    }

    /// Minimal IGDB-shaped result used by the tie-break tests below.
    fn sample_result(
        title: &str,
        release_date: Option<&str>,
        status: Option<&str>,
        category: Option<&str>,
        rating: Option<f64>,
    ) -> GameMetadataResult {
        GameMetadataResult {
            title: title.to_string(),
            description: None,
            developer: None,
            publisher: None,
            release_date: release_date.map(|s| s.to_string()),
            genres: Vec::new(),
            images: GameImages {
                icon: None,
                cover: Some("https://images.igdb.com/cover.jpg".to_string()),
                hero: None,
                banner: None,
                logo: None,
            },
            source_url: String::new(),
            source_name: "IGDB".to_string(),
            storyline: None,
            igdb_rating: rating,
            critic_rating: None,
            themes: None,
            game_modes: None,
            player_perspectives: None,
            screenshots: None,
            videos: None,
            websites: None,
            time_to_beat: None,
            similar_games: None,
            releases: None,
            igdb_reviews: None,
            alternative_names: None,
            collection: None,
            collection_id: None,
            igdb_id: None,
            franchise: None,
            game_category: category.map(|s| s.to_string()),
            release_status: status.map(|s| s.to_string()),
            language_supports: None,
            is_vr: None,
        }
    }

    #[test]
    fn same_name_tie_prefers_matching_release_year() {
        // Two IGDB entries both named "Prototype" — the 2009 release must
        // outrank the same-named title when the query carries the year hint.
        let a = sample_result("Prototype", Some("2009-06-09"), Some("Released"), Some("Main Game"), Some(80.0));
        let b = sample_result("Prototype", Some("2001-01-01"), Some("Released"), Some("Main Game"), Some(60.0));
        assert!(igdb_quality_key(Some("2009"), &a) > igdb_quality_key(Some("2009"), &b));
    }

    #[test]
    fn same_name_tie_prefers_released_main_game() {
        // No year hint: a released main game beats a cancelled DLC pack.
        let good = sample_result("Prototype", None, Some("Released"), Some("Main Game"), None);
        let bad = sample_result("Prototype", None, Some("Cancelled"), Some("DLC / Add-on"), None);
        assert!(igdb_quality_key(None, &good) > igdb_quality_key(None, &bad));
    }
}
