//! Steam per-app `LaunchOptions` (`localconfig.vdf`) helpers.
//!
//! Steam reads a game's launch options from the account's
//! `localconfig.vdf` and splices them around `%command%` before it
//! hands the command to Proton/Wine. That file is the only channel that
//! reliably reaches a game launched by an already-running client — the
//! `steam` launcher forwards `-applaunch` over its IPC pipe and drops
//! the invoker's environment — so GameIndex merges its Wine/Proton
//! flags in there instead of relying on the `steam` process env alone.
//!
//! The editor is format-preserving on purpose: `localconfig.vdf` holds
//! every Steam client setting for the account, so only the one
//! `LaunchOptions` string is rewritten in place and the rest of the
//! document is left byte-for-byte untouched.

use std::path::PathBuf;

/// `steamapps/compatdata/<appid>` for an installed Steam app, when the
/// compatdata prefix exists. Used by the compatibility launch path so a
/// game started outside the client still finds its Steam-managed Proton
/// prefix (saves, config, Cloud). This is the compatdata *base*: Proton
/// derives `${STEAM_COMPAT_DATA_PATH}/pfx` itself.
pub fn steam_compat_prefix(steam_app_id: u32) -> Option<PathBuf> {
    let install = crate::steam_game_watcher::game_install_path(steam_app_id)?;
    let steamapps = install.parent()?.parent()?;
    let compatdata = steamapps.join("compatdata").join(steam_app_id.to_string());
    compatdata.join("pfx").is_dir().then_some(compatdata)
}

/// `localconfig.vdf` of the account Steam is most likely logged into.
///
/// Prefers the `MostRecent` user from `config/loginusers.vdf` and falls
/// back to the most recently written `userdata/<id>/config/localconfig.vdf`
/// so multi-account installs still resolve without UI.
pub fn active_localconfig_path() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    for root in crate::compatibility::steam_candidate_roots() {
        let Ok(entries) = std::fs::read_dir(root.join("userdata")) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if name == "0" || !name.chars().all(|c| c.is_ascii_digit()) {
                continue;
            }
            let config = entry.path().join("config").join("localconfig.vdf");
            if config.is_file() {
                candidates.push(config);
            }
        }
    }

    if let Some(account_id) = most_recent_account_id() {
        let account_id = account_id.to_string();
        if let Some(hit) = candidates.iter().find(|path| {
            path.parent()
                .and_then(|config| config.parent())
                .and_then(|userdata| userdata.file_name())
                .is_some_and(|name| name == account_id.as_str())
        }) {
            return Some(hit.clone());
        }
    }

    candidates.into_iter().max_by_key(|path| {
        std::fs::metadata(path)
            .and_then(|meta| meta.modified())
            .ok()
    })
}

/// SteamID64 → `userdata` account id offset used by Valve's layout.
const STEAM_ID64_BASE: u64 = 76561197960265728;

fn most_recent_account_id() -> Option<u32> {
    for root in crate::compatibility::steam_candidate_roots() {
        let Ok(raw) = std::fs::read_to_string(root.join("config").join("loginusers.vdf")) else {
            continue;
        };
        let mut current_steam_id: Option<u64> = None;
        for line in raw.lines() {
            if let Some(id) = line
                .split('"')
                .find(|part| part.len() == 17 && part.chars().all(|c| c.is_ascii_digit()))
                .and_then(|part| part.parse::<u64>().ok())
            {
                current_steam_id = Some(id);
            }
            if line.contains("\"MostRecent\"") && line.contains('1') {
                if let Some(id) = current_steam_id {
                    if id > STEAM_ID64_BASE {
                        return Some((id - STEAM_ID64_BASE) as u32);
                    }
                }
            }
        }
    }
    None
}

/// Read the `LaunchOptions` string for `app_id`, when set.
pub fn read_launch_options(raw: &str, app_id: u32) -> Option<String> {
    let root = VdfParser::new(raw).parse_document()?;
    let apps = descendant(&root, &["Software", "Valve", "Steam", "apps"])?;
    let VdfValue::Obj { children, .. } = &apps.value else {
        return None;
    };
    let app = child(children, &app_id.to_string())?;
    let VdfValue::Obj { children, .. } = &app.value else {
        return None;
    };
    match child(children, "LaunchOptions").map(|node| &node.value) {
        Some(VdfValue::Str { value, .. }) => Some(value.clone()),
        _ => None,
    }
}

/// Rewrite the `LaunchOptions` string for `app_id`, creating the app
/// entry when the account config does not have one yet.
///
/// Returns `Ok(None)` when the value is already exactly `value`.
pub fn set_launch_options(raw: &str, app_id: u32, value: &str) -> Result<Option<String>, String> {
    let root = VdfParser::new(raw)
        .parse_document()
        .ok_or_else(|| "localconfig.vdf is not valid VDF".to_string())?;
    let apps_node = descendant(&root, &["Software", "Valve", "Steam", "apps"])
        .ok_or_else(|| "localconfig.vdf has no Steam apps section".to_string())?;
    let VdfValue::Obj {
        open: apps_open,
        close: apps_close,
        children: apps_children,
    } = &apps_node.value
    else {
        return Err("Steam apps section is not an object".to_string());
    };

    let app_key = app_id.to_string();
    let Some(app_node) = child(apps_children, &app_key) else {
        let child_indent = apps_children
            .first()
            .map(|node| line_indent(raw, node.key_start))
            .unwrap_or_else(|| format!("{}\t", line_indent(raw, *apps_open)));
        let inner_indent = format!("{child_indent}\t");
        let close_indent = line_indent(raw, *apps_close);
        let insert = format!(
            "{app_key}\n{child_indent}{{\n{inner_indent}\"LaunchOptions\"\t\t{}\n{child_indent}}}\n{close_indent}",
            encode_value(value)
        );
        let mut out = String::with_capacity(raw.len() + insert.len());
        out.push_str(&raw[..*apps_close]);
        out.push_str(&insert);
        out.push_str(&raw[*apps_close..]);
        return Ok(Some(out));
    };

    let VdfValue::Obj {
        open: app_open,
        close: app_close,
        children: app_children,
    } = &app_node.value
    else {
        return Err(format!("Steam app {app_key} entry is not an object"));
    };

    match child(app_children, "LaunchOptions") {
        Some(VdfNode {
            value:
                VdfValue::Str {
                    start,
                    end,
                    value: old,
                },
            ..
        }) => {
            if old == value {
                return Ok(None);
            }
            let mut out = String::with_capacity(raw.len() + value.len());
            out.push_str(&raw[..*start]);
            out.push_str(&encode_value(value));
            out.push_str(&raw[*end..]);
            Ok(Some(out))
        }
        Some(_) => Err("LaunchOptions is not a string".to_string()),
        None => {
            let body_empty = raw[*app_open + 1..*app_close].trim().is_empty();
            let inner_indent = app_children
                .first()
                .map(|node| line_indent(raw, node.key_start))
                .unwrap_or_else(|| format!("{}\t", line_indent(raw, app_node.key_start)));
            let at = app_open + 1;
            let insert = if body_empty {
                format!(
                    "\n{inner_indent}\"LaunchOptions\"\t\t{}\n{}",
                    encode_value(value),
                    line_indent(raw, app_node.key_start)
                )
            } else {
                format!(
                    "\n{inner_indent}\"LaunchOptions\"\t\t{}",
                    encode_value(value)
                )
            };
            let mut out = String::with_capacity(raw.len() + insert.len());
            out.push_str(&raw[..at]);
            out.push_str(&insert);
            out.push_str(&raw[at..]);
            Ok(Some(out))
        }
    }
}

/// Merge GameIndex's `prefix` into the existing launch options.
///
/// `previous` is the managed prefix written on the last launch (if any)
/// so stale flags are removed when settings change or are disabled.
/// Tokens whose env key is managed by the new prefix are replaced;
/// every other user token — env vars, wrappers, and arguments after
/// `%command%` — is preserved.
pub fn merge_launch_options(existing: &str, previous: Option<&str>, prefix: &str) -> String {
    let cleaned = strip_previous(existing, previous);

    let (before, args) = match cleaned.split_once("%command%") {
        Some((before, args)) => (before.to_string(), args.to_string()),
        None => {
            // Without `%command%` Steam appends the string as arguments,
            // but users commonly leave bare `KEY=VALUE` assignments
            // there. Split those back out so they keep working.
            let (env, rest) = split_bare_env(&cleaned);
            (env, rest)
        }
    };

    let managed = managed_env_keys(prefix);
    let kept: Vec<String> = split_tokens(&before)
        .into_iter()
        .filter(|token| {
            !(is_env_assignment(token) && managed.contains(env_key(token).unwrap_or_default()))
        })
        .collect();

    let mut head = String::new();
    let prefix = prefix.trim();
    if !prefix.is_empty() {
        head.push_str(prefix);
    }
    for token in kept {
        if !head.is_empty() {
            head.push(' ');
        }
        head.push_str(&reemit_token(&token));
    }
    let tail = args.trim();

    match (head.is_empty(), tail.is_empty()) {
        (true, true) => String::new(),
        (true, false) => format!("%command% {tail}"),
        (false, true) => format!("{head} %command%"),
        (false, false) => format!("{head} %command% {tail}"),
    }
}

/// Quote an env value for a launch-options string. Steam splits the
/// prefix on whitespace, so values with spaces (paths, configs) get
/// shell-style quoting; ordinary values stay bare for readability.
pub fn quote_env_value(value: &str) -> String {
    let bare = !value.is_empty()
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_/.,:;+@%=-".contains(c));
    if bare {
        value.to_string()
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

fn strip_previous(existing: &str, previous: Option<&str>) -> String {
    let Some(previous) = previous.map(str::trim).filter(|value| !value.is_empty()) else {
        return existing.to_string();
    };
    if let Some(index) = existing.find(previous) {
        let mut out = String::with_capacity(existing.len());
        out.push_str(&existing[..index]);
        out.push_str(&existing[index + previous.len()..]);
        return collapse_spaces(out.trim());
    }
    existing.to_string()
}

fn collapse_spaces(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut last_space = false;
    for ch in raw.chars() {
        if ch == ' ' {
            if last_space {
                continue;
            }
            last_space = true;
        } else {
            last_space = false;
        }
        out.push(ch);
    }
    out.trim().to_string()
}

fn split_bare_env(raw: &str) -> (String, String) {
    let mut env: Vec<String> = Vec::new();
    let mut rest: Vec<String> = Vec::new();
    for token in split_tokens(raw) {
        if is_env_assignment(&token) {
            env.push(token);
        } else {
            rest.push(token);
        }
    }
    (env.join(" "), rest.join(" "))
}

fn managed_env_keys(prefix: &str) -> std::collections::HashSet<String> {
    split_tokens(prefix)
        .into_iter()
        .filter_map(|token| env_key(&token).map(str::to_string))
        .collect()
}

fn split_tokens(raw: &str) -> Vec<String> {
    shlex::split(raw).unwrap_or_else(|| raw.split_whitespace().map(str::to_string).collect())
}

fn reemit_token(token: &str) -> String {
    if let Some((key, value)) = token.split_once('=') {
        if !key.contains(char::is_whitespace) && value.contains(char::is_whitespace) {
            return format!("{key}={}", quote_env_value(value));
        }
    }
    if token.contains(char::is_whitespace) {
        return quote_env_value(token);
    }
    token.to_string()
}

fn is_env_assignment(token: &str) -> bool {
    env_key(token).is_some()
}

fn env_key(token: &str) -> Option<&str> {
    let (key, _) = token.split_once('=')?;
    let mut chars = key.chars();
    let first = chars.next()?;
    if !(first.is_ascii_alphabetic() || first == '_') {
        return None;
    }
    if !chars.all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return None;
    }
    Some(key)
}

fn encode_value(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            _ => out.push(ch),
        }
    }
    out.push('"');
    out
}

fn line_indent(raw: &str, pos: usize) -> String {
    let bytes = raw.as_bytes();
    let mut start = pos.min(bytes.len());
    while start > 0 && bytes[start - 1] != b'\n' && bytes[start - 1] != b'\r' {
        start -= 1;
    }
    raw[start..pos]
        .chars()
        .take_while(|c| *c == ' ' || *c == '\t')
        .collect()
}

fn child<'a>(nodes: &'a [VdfNode], key: &str) -> Option<&'a VdfNode> {
    nodes.iter().find(|node| node.key.eq_ignore_ascii_case(key))
}

fn descendant<'a>(root: &'a VdfNode, keys: &[&str]) -> Option<&'a VdfNode> {
    let mut current = root;
    for key in keys {
        let VdfValue::Obj { children, .. } = &current.value else {
            return None;
        };
        current = child(children, key)?;
    }
    Some(current)
}

#[derive(Debug)]
enum VdfValue {
    Str {
        start: usize,
        end: usize,
        value: String,
    },
    Obj {
        open: usize,
        close: usize,
        children: Vec<VdfNode>,
    },
}

#[derive(Debug)]
struct VdfNode {
    key: String,
    key_start: usize,
    value: VdfValue,
}

struct VdfParser<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> VdfParser<'a> {
    fn new(raw: &'a str) -> Self {
        Self {
            bytes: raw.as_bytes(),
            pos: 0,
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn skip_trivia(&mut self) {
        loop {
            while matches!(self.peek(), Some(byte) if byte.is_ascii_whitespace()) {
                self.pos += 1;
            }
            if self.peek() == Some(b'/') && self.bytes.get(self.pos + 1) == Some(&b'/') {
                while !matches!(self.peek(), None | Some(b'\n')) {
                    self.pos += 1;
                }
                continue;
            }
            break;
        }
    }

    fn parse_document(&mut self) -> Option<VdfNode> {
        self.skip_trivia();
        let (key, key_start, _) = self.parse_token()?;
        self.skip_trivia();
        let value = self.parse_value()?;
        Some(VdfNode {
            key,
            key_start,
            value,
        })
    }

    fn parse_value(&mut self) -> Option<VdfValue> {
        self.skip_trivia();
        if self.peek() == Some(b'{') {
            return self.parse_object();
        }
        let (value, start, end) = self.parse_token()?;
        Some(VdfValue::Str { start, end, value })
    }

    fn parse_object(&mut self) -> Option<VdfValue> {
        let open = self.pos;
        self.pos += 1;
        let mut children = Vec::new();
        loop {
            self.skip_trivia();
            match self.peek() {
                Some(b'}') => {
                    let close = self.pos;
                    self.pos += 1;
                    return Some(VdfValue::Obj {
                        open,
                        close,
                        children,
                    });
                }
                None => return None,
                _ => {}
            }
            let (key, key_start, _) = self.parse_token()?;
            self.skip_trivia();
            let value = self.parse_value()?;
            children.push(VdfNode {
                key,
                key_start,
                value,
            });
        }
    }

    fn parse_token(&mut self) -> Option<(String, usize, usize)> {
        self.skip_trivia();
        let start = self.pos;
        match self.peek()? {
            b'"' => {
                self.pos += 1;
                let mut out = String::new();
                while let Some(byte) = self.peek() {
                    self.pos += 1;
                    match byte {
                        b'"' => return Some((out, start, self.pos)),
                        b'\\' => match self.peek() {
                            Some(b'"') => {
                                out.push('"');
                                self.pos += 1;
                            }
                            Some(b'\\') => {
                                out.push('\\');
                                self.pos += 1;
                            }
                            Some(b'n') => {
                                out.push('\n');
                                self.pos += 1;
                            }
                            Some(b't') => {
                                out.push('\t');
                                self.pos += 1;
                            }
                            Some(other) => {
                                out.push('\\');
                                if other.is_ascii() {
                                    out.push(other as char);
                                }
                                self.pos += 1;
                            }
                            None => return None,
                        },
                        _ => {
                            let remaining =
                                std::str::from_utf8(&self.bytes[self.pos - 1..]).ok()?;
                            let ch = remaining.chars().next()?;
                            out.push(ch);
                            self.pos += ch.len_utf8() - 1;
                        }
                    }
                }
                None
            }
            b'{' | b'}' => None,
            _ => {
                while matches!(self.peek(), Some(byte)
                    if !byte.is_ascii_whitespace() && byte != b'{' && byte != b'}')
                {
                    self.pos += 1;
                }
                let raw = std::str::from_utf8(&self.bytes[start..self.pos]).ok()?;
                Some((raw.to_string(), start, self.pos))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#""UserLocalConfigStore"
{
	"Software"
	{
		"Valve"
		{
			"Steam"
			{
				"apps"
				{
					"730"
					{
						"Playtime"		"5"
						"LaunchOptions"		"__NV_PRIME_RENDER_OFFLOAD=1"
					}
					"440"
					{
						"Playtime"		"10"
					}
				}
			}
		}
	}
	"WebStorage"
	{
		"foo"		"bar"
	}
}
"#;

    #[test]
    fn reads_existing_launch_options() {
        assert_eq!(
            read_launch_options(SAMPLE, 730).as_deref(),
            Some("__NV_PRIME_RENDER_OFFLOAD=1")
        );
        assert_eq!(read_launch_options(SAMPLE, 440), None);
        assert_eq!(read_launch_options(SAMPLE, 620), None);
    }

    #[test]
    fn replaces_launch_options_in_place() {
        let updated = set_launch_options(SAMPLE, 730, "MANGOHUD=1 %command%")
            .unwrap()
            .expect("value changed");
        assert_eq!(
            read_launch_options(&updated, 730).as_deref(),
            Some("MANGOHUD=1 %command%")
        );
        // Everything else survives untouched.
        assert!(updated.contains("\"Playtime\"\t\t\"5\""));
        assert!(updated.contains("\"foo\"\t\t\"bar\""));
        assert_eq!(updated.matches("WebStorage").count(), 1);
    }

    #[test]
    fn inserts_launch_options_into_existing_app() {
        let updated = set_launch_options(SAMPLE, 440, "WINEESYNC=1 %command%")
            .unwrap()
            .expect("value changed");
        assert_eq!(
            read_launch_options(&updated, 440).as_deref(),
            Some("WINEESYNC=1 %command%")
        );
        assert!(updated.contains("\"Playtime\"\t\t\"10\""));
    }

    #[test]
    fn creates_missing_app_entry() {
        let updated = set_launch_options(SAMPLE, 999, "WINEFSYNC=1 %command%")
            .unwrap()
            .expect("value changed");
        assert_eq!(
            read_launch_options(&updated, 999).as_deref(),
            Some("WINEFSYNC=1 %command%")
        );
        assert!(updated.contains("\"730\""));
        // Round-trips through the parser without structural damage.
        assert!(VdfParser::new(&updated).parse_document().is_some());
    }

    #[test]
    fn unchanged_value_is_a_noop() {
        assert_eq!(
            set_launch_options(SAMPLE, 730, "__NV_PRIME_RENDER_OFFLOAD=1").unwrap(),
            None
        );
    }

    #[test]
    fn missing_apps_section_is_an_error() {
        let raw = "\"UserLocalConfigStore\"\n{\n\t\"WebStorage\"\n\t{\n\t}\n}\n";
        assert!(set_launch_options(raw, 730, "X=1 %command%").is_err());
    }

    #[test]
    fn merge_replaces_managed_env_and_keeps_user_tokens() {
        let existing = "MANGOHUD=1 DXVK_HUD=fps gamemoderun %command% -novid";
        let merged = merge_launch_options(existing, None, "MANGOHUD=0 WINEESYNC=1");
        assert_eq!(
            merged,
            "MANGOHUD=0 WINEESYNC=1 DXVK_HUD=fps gamemoderun %command% -novid"
        );
    }

    #[test]
    fn merge_strips_previous_managed_prefix() {
        let existing = "OLD=1 gamemoderun %command%";
        let merged = merge_launch_options(existing, Some("OLD=1 gamemoderun"), "NEW=1");
        assert_eq!(merged, "NEW=1 %command%");
    }

    #[test]
    fn merge_handles_missing_command_marker() {
        // Bare env assignments stay before `%command%`; the rest becomes args.
        let merged = merge_launch_options("DXVK_HUD=fps -novid", None, "MANGOHUD=1");
        assert_eq!(merged, "MANGOHUD=1 DXVK_HUD=fps %command% -novid");
    }

    #[test]
    fn merge_clears_when_prefix_and_user_options_are_empty() {
        assert_eq!(
            merge_launch_options("OLD=1 gamemoderun", Some("OLD=1 gamemoderun"), ""),
            ""
        );
        assert_eq!(merge_launch_options("", None, ""), "");
    }

    #[test]
    fn quotes_env_values_with_spaces() {
        assert_eq!(quote_env_value("-all"), "-all");
        assert_eq!(quote_env_value("/home/u/My Games"), "'/home/u/My Games'");
        assert_eq!(quote_env_value("it's"), "'it'\\''s'");
    }
}
