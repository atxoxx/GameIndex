use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Instant;

use super::force_close::*;
use super::library::*;
use super::paths::*;
use super::poll::*;
use super::process::*;
use super::resolve::*;
use super::session::*;
use super::steam_install::*;
use super::types::*;
use super::watcher::*;


#[test]
fn test_skip_keywords_cover_known_patterns() {
    let bad_names = [
        "vcredist_x64", "UE4PrereqSetup", "UnityCrashHandler64",
        "CrashReportClient", "unins000", "dotnetfx35", "launcher",
        "patcher", "updater", "dxsetup", "wallpaper64",
    ];
    for name in bad_names {
        assert!(
            SKIP_KEYWORDS.iter().any(|kw| name.to_lowercase().contains(kw)),
            "SKIP_KEYWORDS should cover '{}'",
            name
        );
    }
}

#[test]
fn test_skip_keywords_dont_match_game_names() {
    let good_names = [
        "witcher3", "Cyberpunk2077", "EldenRing", "BaldursGate3",
        "RedDeadRedemption2", "gtav", "cs2", "RocketLeague",
        "Hades2", "Starfield",
    ];
    for name in good_names {
        assert!(
            !SKIP_KEYWORDS.iter().any(|kw| name.to_lowercase().contains(kw)),
            "'{}' should NOT be excluded by SKIP_KEYWORDS",
            name
        );
    }
}

#[test]
fn test_name_scoring_exact_match() {
    // An exact stem match at the install root must beat the same stem
    // buried deeper in the tree, even when the deeper exe is larger
    // (exact stem +200, depth penalty (3-1)*5 = -10).
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("EldenRing");
    std::fs::create_dir_all(root.join("Binaries").join("Win64")).unwrap();
    std::fs::write(root.join("EldenRing.exe"), b"x").unwrap();
    std::fs::write(
        root.join("Binaries").join("Win64").join("eldenring.exe"),
        b"yyy",
    )
    .unwrap();

    let picked = resolve_game_exe(dir.path(), "EldenRing").unwrap();
    assert_eq!(
        Path::new(&picked).file_name().and_then(|s| s.to_str()),
        Some("EldenRing.exe")
    );
}

#[test]
fn test_resolve_ignores_helper_exes_and_pruned_subdirs() {
    // Only non-game executables and a `Redistributables` subfolder: the
    // parallel resolver must find nothing rather than picking a helper.
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("SomeGame");
    std::fs::create_dir_all(root.join("Redistributables")).unwrap();
    std::fs::write(root.join("vcredist_x64.exe"), b"x").unwrap();
    std::fs::write(root.join("unins000.exe"), b"x").unwrap();
    std::fs::write(root.join("Redistributables").join("payload.exe"), b"x").unwrap();

    assert!(
        resolve_game_exe(&root, "SomeGame").is_none(),
        "helper exes and pruned subdirs must not resolve to a game"
    );
}

#[test]
fn test_get_game_root_dir_heuristics() {
    assert_eq!(
        get_game_root_dir(Path::new("C:\\Games\\GameName\\game.exe")),
        Some(PathBuf::from("C:\\Games\\GameName"))
    );
    assert_eq!(
        get_game_root_dir(Path::new("C:\\Games\\GameName\\binaries\\win64\\game.exe")),
        Some(PathBuf::from("C:\\Games\\GameName"))
    );
    assert_eq!(
        get_game_root_dir(Path::new("C:\\Games\\GameName\\game\\bin\\x64\\game.exe")),
        Some(PathBuf::from("C:\\Games\\GameName"))
    );
    assert_eq!(
        get_game_root_dir(Path::new("C:\\Games\\GameName\\MySubFolder\\game.exe")),
        Some(PathBuf::from("C:\\Games\\GameName\\MySubFolder"))
    );
}

#[test]
fn test_emulator_games_excluded_from_passive_index() {
    // All ROMs of one emulator share the emulator exe as their path.
    // They must NOT enter the process index: one running emulator
    // process would otherwise match every ROM and record a phantom
    // session for each on exit.
    let input = vec![
        GameRefInput {
            game_id: "emu-rom-1".to_string(),
            game_name: "Super Mario Bros".to_string(),
            platform: "NES".to_string(),
            exe_path: "C:\\Emulators\\RetroArch\\retroarch.exe".to_string(),
            steam_app_id: None,
            installed: false,
            emulator_id: Some("emu-nes".to_string()),
        },
        GameRefInput {
            game_id: "emu-rom-2".to_string(),
            game_name: "Zelda".to_string(),
            platform: "NES".to_string(),
            exe_path: "C:\\Emulators\\RetroArch\\retroarch.exe".to_string(),
            steam_app_id: None,
            installed: false,
            emulator_id: Some("emu-nes".to_string()),
        },
        GameRefInput {
            game_id: "steam-1".to_string(),
            game_name: "Skyrim".to_string(),
            platform: "Steam".to_string(),
            exe_path: "C:\\Steam\\steamapps\\common\\Skyrim\\Skyrim.exe".to_string(),
            steam_app_id: Some(489830),
            installed: true,
            emulator_id: None,
        },
    ];

    let refs = build_game_refs_from_library(&input);
    assert_eq!(refs.len(), 1, "only non-emulator games may enter the index");
    assert_eq!(refs[0].game_id, "steam-1");
}

// ── Steam install/uninstall detection ────────────────────────────

fn steam_lib(entries: &[(u32, bool)]) -> HashMap<u32, SteamLibraryGame> {
    entries
        .iter()
        .map(|(appid, installed)| {
            (
                *appid,
                SteamLibraryGame {
                    name: format!("Game {appid}"),
                    installed: *installed,
                },
            )
        })
        .collect()
}

fn manifest_map(entries: &[(u32, bool)]) -> HashMap<u32, bool> {
    entries.iter().copied().collect()
}

#[test]
fn reconcile_baseline_seeds_installed_library_games_without_clobbering_observed() {
    let observed = manifest_map(&[(1, false), (7, true)]); // 1 mid-update, 7 not in library
    let library = steam_lib(&[(1, true), (2, true), (3, false), (7, false)]);

    let baseline = reconciled_baseline(&observed, &library);

    // Observed value wins for appid 1 (library lags disk).
    assert_eq!(baseline.get(&1), Some(&false));
    // A library-installed game with no observed entry seeds `true` so
    // its missing manifest shows up as an uninstall.
    assert_eq!(baseline.get(&2), Some(&true));
    // A not-installed library game is never seeded.
    assert_eq!(baseline.get(&3), None);
    // The mirror case: an observed install the library says isn't
    // installed is dropped so the install is announced, not masked by
    // a first scan that ran before the library loaded.
    assert_eq!(baseline.get(&7), None);
}

#[test]
fn diff_detects_closed_app_uninstall_from_seeded_baseline() {
    // Library thinks 440 is installed, but its manifest is gone.
    let library = steam_lib(&[(440, true)]);
    let previous = reconciled_baseline(&HashMap::new(), &library);
    let current = manifest_map(&[]);

    let (installed, uninstalled) =
        diff_steam_install_transitions(&current, &previous, &library, &HashSet::new());

    assert_eq!(installed, Vec::<u32>::new());
    assert_eq!(uninstalled, vec![440]);
}

#[test]
fn diff_detects_closed_app_install_for_not_installed_library_game() {
    // Library thinks 570 is not installed, but it finished downloading
    // while the app was closed.
    let library = steam_lib(&[(570, false)]);
    let previous = reconciled_baseline(&HashMap::new(), &library);
    let current = manifest_map(&[(570, true)]);

    let (installed, uninstalled) =
        diff_steam_install_transitions(&current, &previous, &library, &HashSet::new());

    assert_eq!(installed, vec![570]);
    assert_eq!(uninstalled, Vec::<u32>::new());
}

#[test]
fn diff_ignores_manifests_with_no_library_entry() {
    // The scan sees every manifest on disk; an AppID with no library
    // entry must never produce an event.
    let library = steam_lib(&[]);
    let current = manifest_map(&[(999, true)]);

    let (installed, uninstalled) = diff_steam_install_transitions(
        &current,
        &HashMap::new(),
        &library,
        &HashSet::new(),
    );

    assert!(installed.is_empty());
    assert!(uninstalled.is_empty());
}

#[test]
fn diff_never_re_announces_an_already_reported_uninstall() {
    let library = steam_lib(&[(440, true)]);
    let previous = reconciled_baseline(&HashMap::new(), &library);
    let current = manifest_map(&[]);
    let reported: HashSet<u32> = [440].into_iter().collect();

    let (installed, uninstalled) =
        diff_steam_install_transitions(&current, &previous, &library, &reported);

    assert!(installed.is_empty());
    assert!(uninstalled.is_empty(), "must not repeat the uninstall event");
}

#[test]
fn diff_does_not_treat_mid_update_as_uninstall() {
    // Manifest present but not fully installed (StateFlags flips
    // during an update) is a transition, not a disappearance.
    let library = steam_lib(&[(440, true)]);
    let previous = reconciled_baseline(&manifest_map(&[(440, true)]), &library);
    let current = manifest_map(&[(440, false)]);

    let (installed, uninstalled) =
        diff_steam_install_transitions(&current, &previous, &library, &HashSet::new());

    assert!(installed.is_empty(), "mid-update is not an install");
    assert!(uninstalled.is_empty(), "mid-update keeps the manifest");
}

#[test]
fn diff_announces_install_after_update_completes() {
    let library = steam_lib(&[(440, false)]);
    let previous = manifest_map(&[(440, false)]);
    let current = manifest_map(&[(440, true)]);

    let (installed, uninstalled) =
        diff_steam_install_transitions(&current, &previous, &library, &HashSet::new());

    assert_eq!(installed, vec![440]);
    assert!(uninstalled.is_empty());
}

#[test]
fn manifest_state_needs_read_only_for_unknown_or_incomplete() {
    let previous = manifest_map(&[(1, true), (2, false)]);

    assert!(
        !manifest_state_needs_read(&previous, 1),
        "a known-installed manifest must not be re-read"
    );
    assert!(
        manifest_state_needs_read(&previous, 2),
        "a mid-download manifest must be re-read to catch completion"
    );
    assert!(
        manifest_state_needs_read(&previous, 3),
        "a newly appeared manifest must be read"
    );
}

#[test]
fn resolve_manifest_states_skips_reads_for_known_installed_apps() {
    // The file on disk is mid-download (StateFlags 1026 lacks bit 4).
    // A known-installed app must ignore it without a read; an app not
    // seen before must read it and report not-fully-installed.
    let tmp = tempfile::tempdir().unwrap();
    let manifest = tmp.path().join("appmanifest_440.acf");
    std::fs::write(
        &manifest,
        r#""AppState"
{
"appid"  "440"
"name"  "Team Fortress 2"
"installdir"  "tf"
"StateFlags"  "1026"
}
"#,
    )
    .unwrap();
    let paths: HashMap<u32, PathBuf> = [(440u32, manifest)].into_iter().collect();

    let known = resolve_manifest_states(&paths, &manifest_map(&[(440, true)]));
    assert_eq!(known.get(&440), Some(&true));

    let unseen = resolve_manifest_states(&paths, &HashMap::new());
    assert_eq!(unseen.get(&440), Some(&false));
}

#[test]
fn rebuild_index_captures_all_library_steam_games_including_not_installed() {
    // Owned-but-not-installed Steam games have no exe/install dir, so
    // they never enter the process index — but the install scan needs
    // them to reconcile a later install.
    let tmp = tempfile::tempdir().unwrap();
    let mut watcher = GameWatcher::new(crate::db::Db::open(tmp.path()).unwrap());
    watcher.rebuild_index(vec![GameRef {
        game_id: "steam-570".to_string(),
        game_name: "Dota 2".to_string(),
        platform: "Steam".to_string(),
        exe_path: None,
        install_dir: None,
        steam_app_id: Some(570),
        installed: false,
    }]);

    assert!(watcher.steam_baseline_dirty);
    let entry = watcher.steam_library.get(&570).expect("library entry kept");
    assert_eq!(entry.name, "Dota 2");
    assert!(!entry.installed);
}

#[test]
fn rebuild_index_excludes_non_steam_games_from_steam_library() {
    // A local/manual import may carry a Steam AppID for metadata but
    // has no appmanifest, so it must not seed the Steam install scan.
    let tmp = tempfile::tempdir().unwrap();
    let mut watcher = GameWatcher::new(crate::db::Db::open(tmp.path()).unwrap());
    watcher.rebuild_index(vec![
        GameRef {
            game_id: "local-1".to_string(),
            game_name: "Local Game".to_string(),
            platform: "Local".to_string(),
            exe_path: Some("C:\\Games\\Local\\local.exe".to_string()),
            install_dir: None,
            steam_app_id: Some(489830),
            installed: true,
        },
        GameRef {
            game_id: "manual-1".to_string(),
            game_name: "Manual Game".to_string(),
            platform: "Manual".to_string(),
            exe_path: None,
            install_dir: None,
            steam_app_id: Some(570),
            installed: true,
        },
        GameRef {
            game_id: "steam-1".to_string(),
            game_name: "Team Fortress 2".to_string(),
            platform: "Steam".to_string(),
            exe_path: None,
            install_dir: None,
            steam_app_id: Some(440),
            installed: true,
        },
    ]);

    assert!(
        !watcher.steam_library.contains_key(&489830),
        "a local game's metadata AppID must not seed the Steam library"
    );
    assert!(
        !watcher.steam_library.contains_key(&570),
        "a manual game's metadata AppID must not seed the Steam library"
    );
    assert!(
        watcher.steam_library.contains_key(&440),
        "a genuine Steam game still seeds the Steam library"
    );
    // The local game has no Steam platform, but it is still a
    // runnable process and must stay in the process index.
    assert!(watcher
        .process_index
        .contains_key(&normalize_path_lower("C:\\Games\\Local\\local.exe")));
}

// ── is_currently_running ─────────────────────────────────────────

#[test]
fn test_is_currently_running_matching_exe() {
    // Case- and separator-insensitive compare of the tracked exe.
    let procs = vec![make_proc(42, "C:\\Games\\Witcher3\\Witcher3.exe", 100)];
    assert!(is_currently_running(&procs, 42, "C:\\Games\\Witcher3\\Witcher3.exe"));
    assert!(is_currently_running(&procs, 42, "c:/games/witcher3/witcher3.exe"));
    assert!(is_currently_running(&procs, 42, "C:\\Games\\Witcher3\\WITCHER3.EXE"));
}

#[test]
fn test_is_currently_running_posix_paths() {
    // POSIX paths keep forward slashes through normalization.
    let procs = vec![make_proc(42, "/home/user/Games/Witcher3/Witcher3.exe", 100)];
    assert!(is_currently_running(&procs, 42, "/home/user/Games/Witcher3/Witcher3.exe"));
    assert!(!is_currently_running(&procs, 42, "/home/user/Games/Other/other.exe"));
}

#[test]
fn test_is_currently_running_different_exe() {
    let procs = vec![make_proc(42, "C:\\Games\\Witcher3\\Witcher3.exe", 100)];
    assert!(!is_currently_running(&procs, 42, "C:\\Games\\Other\\other.exe"));
}

#[test]
fn test_is_currently_running_absent_pid() {
    let procs: Vec<ProcessInfo> = Vec::new();
    assert!(!is_currently_running(&procs, 999, "anything.exe"));
}

#[test]
fn test_is_currently_running_follows_children_of_dead_splash() {
    // Regression: a splash / bootstrap (PID 100) spawns the real game
    // and exits before the next poll. The child (PID 101) still reports
    // the dead parent's PID, so the session must stay "running" rather
    // than entering the grace window.
    let procs = vec![make_proc_with_ppid(
        101,
        100,
        "C:\\Games\\Foo\\foo-win64-shipping.exe",
        900,
    )];
    // The tracked exe is the real game (a wrapper launch), matched by
    // path — the child carries it.
    assert!(is_currently_running(
        &procs,
        100,
        "C:\\Games\\Foo\\foo-win64-shipping.exe"
    ));
    // A descendant that does NOT resolve to the tracked exe never
    // keeps the session alive.
    assert!(!is_currently_running(
        &procs,
        100,
        "C:\\Games\\Foo\\foo.exe"
    ));
}

#[test]
fn test_is_currently_running_empty_matched_exe() {
    // Empty matched_exe (only reachable for pending launches) counts
    // as running while the PID is alive.
    let procs = vec![make_proc(42, "C:\\Games\\Witcher3\\Witcher3.exe", 100)];
    assert!(is_currently_running(&procs, 42, ""));
    assert!(!is_currently_running(&procs, 999, ""));
}

#[test]
fn test_is_currently_running_matches_wrapper_descendant() {
    // The tracked PID is a wrapper (gamescope / gamemoderun /
    // mangohud / wine) whose own exe is NOT the game; the game runs
    // as a descendant. The session must stay alive while the
    // descendant still resolves to the tracked exe.
    let procs = vec![
        make_proc_with_ppid(100, 1, "/usr/bin/gamescope", 500),
        make_proc_with_ppid(101, 100, "/usr/lib/wine/wine64-preloader", 300),
        make_proc_with_ppid(102, 101, "/home/user/Games/Foo/foo.exe", 900),
    ];
    assert!(is_currently_running(&procs, 100, "/home/user/Games/Foo/foo.exe"));
    // A wrapper whose descendants do NOT include the game never
    // counts as running.
    assert!(!is_currently_running(&procs, 100, "/home/user/Games/Bar/bar.exe"));
    // The game process itself matches directly.
    assert!(is_currently_running(&procs, 102, "/home/user/Games/Foo/foo.exe"));
}

#[test]
fn test_is_currently_running_ignores_cycle() {
    // A malformed parent graph (cycle) must not hang the walk.
    let procs = vec![
        make_proc_with_ppid(10, 11, "/usr/bin/wrapper", 100),
        make_proc_with_ppid(11, 10, "/usr/bin/wrapper", 100),
    ];
    assert!(!is_currently_running(&procs, 10, "/home/user/Games/Foo/foo.exe"));
}

// ── elapsed_seconds ──────────────────────────────────────────────

#[test]
fn test_elapsed_seconds_never_attached_is_zero() {
    let session = ActiveSession {
        game_id: "g1".to_string(),
        game_name: "Test".to_string(),
        started_at: Instant::now(),
        attached_at: None,
        attached_at_ms: 0,
        last_pid: 0,
        stop_tx: std::sync::mpsc::channel::<()>().0,
        metrics_rx: None,
        launched_by_app: true,
        matched_exe: String::new(),
        install_dir: None,
        lost_at: None,
        post_exit_script: None,
    };
    assert_eq!(session.elapsed_seconds(), 0);
}

#[test]
fn test_elapsed_seconds_anchored_at_attach() {
    // `started_at` is 600 s in the past but `attached_at` is only 2 s
    // ago: elapsed must reflect the attach anchor, not the launch time.
    let session = ActiveSession {
        game_id: "g1".to_string(),
        game_name: "Test".to_string(),
        started_at: Instant::now() - std::time::Duration::from_secs(600),
        attached_at: Some(Instant::now() - std::time::Duration::from_secs(2)),
        attached_at_ms: 0,
        last_pid: 1234,
        stop_tx: std::sync::mpsc::channel::<()>().0,
        metrics_rx: None,
        launched_by_app: true,
        matched_exe: String::new(),
        install_dir: None,
        lost_at: None,
        post_exit_script: None,
    };
    let elapsed = session.elapsed_seconds();
    assert!(
        (1..=3).contains(&elapsed),
        "elapsed should be ~2 s (attached anchor), got {elapsed}"
    );
}

// ── poll interval ────────────────────────────────────────────────

fn make_session(last_pid: u32, lost: bool) -> ActiveSession {
    ActiveSession {
        game_id: "g1".to_string(),
        game_name: "Test".to_string(),
        started_at: Instant::now(),
        attached_at: (last_pid != 0).then(Instant::now),
        attached_at_ms: 0,
        last_pid,
        stop_tx: std::sync::mpsc::channel::<()>().0,
        metrics_rx: None,
        launched_by_app: true,
        matched_exe: String::new(),
        install_dir: None,
        lost_at: lost.then(Instant::now),
        post_exit_script: None,
    }
}

#[test]
fn test_poll_interval_is_fast_for_pending_and_lost_sessions() {
    let tmp = tempfile::tempdir().unwrap();
    let mut watcher = GameWatcher::new(crate::db::Db::open(tmp.path()).unwrap());
    assert_eq!(watcher.current_poll_interval(), POLL_INTERVAL_STEADY);

    // A launch that hasn't produced a process yet.
    watcher
        .active_sessions
        .insert("g1".to_string(), make_session(0, false));
    assert_eq!(watcher.current_poll_interval(), POLL_INTERVAL_FAST);

    // Attached and healthy.
    watcher
        .active_sessions
        .insert("g1".to_string(), make_session(1234, false));
    assert_eq!(watcher.current_poll_interval(), POLL_INTERVAL_STEADY);

    // Process went missing: the grace window polls at 1 s so the exit
    // is confirmed at 1 s resolution instead of POLL_INTERVAL_STEADY.
    watcher
        .active_sessions
        .insert("g1".to_string(), make_session(1234, true));
    assert_eq!(watcher.current_poll_interval(), POLL_INTERVAL_FAST);

    watcher.active_sessions.clear();
    assert_eq!(watcher.current_poll_interval(), POLL_INTERVAL_STEADY);
}

// ── MemoryScanFilter ─────────────────────────────────────────────

#[test]
fn memory_scan_filter_empty_wants_nothing() {
    let filter = MemoryScanFilter::default();
    assert!(!filter.wants(r"C:\Games\Foo\game.exe"));
    assert!(!filter.wants(""));
}

#[test]
fn memory_scan_filter_wants_dir_and_stem_matches_only() {
    let mut filter = MemoryScanFilter::default();
    filter.dir_prefixes.push(normalize_path_lower(r"C:\Games\Foo"));
    filter.exe_stems.push("bar".to_string());

    // Inside the install tree → wanted.
    assert!(filter.wants(r"C:\Games\Foo\sub\launcher.exe"));
    // Any process sharing the tracked exe stem → wanted (parent tier).
    assert!(filter.wants(r"D:\Elsewhere\BAR.exe"));
    // Unrelated system process → not wanted.
    assert!(!filter.wants(r"C:\Windows\explorer.exe"));
}

#[test]
fn memory_scan_filter_derives_from_active_sessions() {
    let tmp = tempfile::tempdir().unwrap();
    let mut watcher = GameWatcher::new(crate::db::Db::open(tmp.path()).unwrap());

    // Idle watcher: no sessions → every per-process memory read is skipped.
    assert!(!watcher.memory_scan_filter().wants(r"C:\Games\Foo\game.exe"));

    let mut session = make_session(1234, false);
    session.matched_exe = r"C:\Games\Foo\game.exe".to_string();
    session.install_dir = Some(PathBuf::from(r"C:\Games\Foo"));
    watcher
        .active_sessions
        .insert("g1".to_string(), session);

    let filter = watcher.memory_scan_filter();
    assert!(filter.wants(r"C:\Games\Foo\sub\anything.exe"));
    assert!(filter.wants(r"D:\Other\game.exe"));
    assert!(!filter.wants(r"C:\Windows\explorer.exe"));
}

// ── find_best_process_in_dir ─────────────────────────────────────

fn make_proc(pid: u32, exe: &str, ws: u64) -> ProcessInfo {
    ProcessInfo {
        pid,
        ppid: 0,
        exe_path: exe.to_string(),
        working_set_size: ws,
    }
}

fn make_proc_with_ppid(pid: u32, ppid: u32, exe: &str, ws: u64) -> ProcessInfo {
    ProcessInfo {
        pid,
        ppid,
        exe_path: exe.to_string(),
        working_set_size: ws,
    }
}

#[test]
fn test_find_best_process_in_dir_picks_largest_working_set() {
    let procs = vec![
        make_proc(1, "C:\\Games\\Foo\\game.exe", 100),
        make_proc(2, "C:\\Games\\Foo\\game2.exe", 500),
        make_proc(3, "C:\\Games\\Foo\\helper.exe", 200),
    ];
    let best =
        find_best_process_in_dir(&procs, Path::new("C:\\Games\\Foo"), None, true).unwrap();
    assert_eq!(best.pid, 2, "largest working set wins among non-skip candidates");
}

#[test]
fn test_find_best_process_in_dir_prefers_non_skip_over_larger_skip() {
    let procs = vec![
        make_proc(1, "C:\\Games\\Foo\\game.exe", 100),
        make_proc(2, "C:\\Games\\Foo\\launcher.exe", 999),
    ];
    let best =
        find_best_process_in_dir(&procs, Path::new("C:\\Games\\Foo"), None, true).unwrap();
    assert_eq!(best.pid, 1, "skip-keyworded exe never beats a real candidate");
}

#[test]
fn test_find_best_process_in_dir_all_skip_never_attaches() {
    let procs = vec![
        make_proc(1, "C:\\Games\\Foo\\launcher.exe", 100),
        make_proc(2, "C:\\Games\\Foo\\crashhandler.exe", 999),
    ];
    assert!(
        find_best_process_in_dir(&procs, Path::new("C:\\Games\\Foo"), None, true).is_none(),
        "all-skip candidates must resolve to None — no skip-keyword fallback"
    );
}

#[test]
fn test_find_best_process_in_dir_known_stem_excludes_other_stem_helpers() {
    // A helper with a different stem must never be picked even when it
    // is the largest process in the folder.
    let procs = vec![
        make_proc(1, "C:\\Games\\Foo\\game.exe", 100),
        make_proc(2, "C:\\Games\\Foo\\anticheatdaemon.exe", 999),
    ];
    let best =
        find_best_process_in_dir(&procs, Path::new("C:\\Games\\Foo"), Some("game"), true)
            .unwrap();
    assert_eq!(best.pid, 1, "only the tracked exe stem qualifies when known");
}

#[test]
fn test_find_best_process_in_dir_known_stem_matches_deep_exe() {
    // Games that ship the real exe deep in the tree still re-attach
    // via the stem even though they are not direct children.
    let procs = vec![
        make_proc(1, "C:\\Games\\Foo\\bin\\win64\\game.exe", 400),
        make_proc(2, "C:\\Games\\Foo\\overlay.exe", 900),
    ];
    let best =
        find_best_process_in_dir(&procs, Path::new("C:\\Games\\Foo"), Some("game"), true)
            .unwrap();
    assert_eq!(best.pid, 1, "deep stem match beats a larger unrelated helper");
}

#[test]
fn test_find_best_process_in_dir_unknown_stem_requires_direct_child() {
    let nested = vec![make_proc(1, "C:\\Games\\Foo\\bin\\win64\\game.exe", 400)];
    assert!(
        find_best_process_in_dir(&nested, Path::new("C:\\Games\\Foo"), None, true).is_none(),
        "with an unknown stem, nested processes must not be attached"
    );
    let direct = vec![make_proc(2, "C:\\Games\\Foo\\game.exe", 400)];
    let best =
        find_best_process_in_dir(&direct, Path::new("C:\\Games\\Foo"), None, true).unwrap();
    assert_eq!(best.pid, 2, "direct child attaches for pending protocol launches");
}

#[test]
fn test_find_best_process_in_dir_empty() {
    assert!(find_best_process_in_dir(&[], Path::new("C:\\Games\\Foo"), None, true).is_none());
    assert!(
        find_best_process_in_dir(&[], Path::new("C:\\Games\\Foo"), Some("game"), true)
            .is_none()
    );
}

#[test]
fn test_find_best_process_in_dir_posix_paths() {
    // Linux/Wine install dirs use forward slashes end to end; the
    // directory-boundary checks must accept them (regression: the
    // old `replace('/', "\\")` normalization mangled POSIX paths).
    let procs = vec![
        make_proc(1, "/home/user/Games/Foo/game.exe", 100),
        make_proc(2, "/home/user/Games/Foo/launcher.exe", 999),
    ];
    let dir = Path::new("/home/user/Games/Foo");
    let best = find_best_process_in_dir(&procs, dir, Some("game"), true).unwrap();
    assert_eq!(best.pid, 1);
    // A sibling path that merely shares the prefix must stay outside.
    let sibling = vec![make_proc(3, "/home/user/Games/FooBar/game.exe", 400)];
    assert!(
        find_best_process_in_dir(&sibling, dir, Some("game"), true).is_none(),
        "prefix-sharing sibling directory must not match"
    );
}

#[test]
fn test_rebuild_index_matches_posix_install_dir_prefix() {
    // The process-index install-dir prefix match must work with POSIX
    // separators (used for Wine games on Linux).
    let tmp = tempfile::tempdir().unwrap();
    let mut watcher = GameWatcher::new(crate::db::Db::open(tmp.path()).unwrap());
    watcher.rebuild_index(vec![GameRef {
        game_id: "g1".to_string(),
        game_name: "Foo".to_string(),
        platform: "Manual".to_string(),
        exe_path: Some("/home/user/Games/Foo/game.exe".to_string()),
        install_dir: Some(PathBuf::from("/home/user/Games/Foo")),
        steam_app_id: None,
        installed: false,
    }]);

    // The key is produced by the same normalization the matcher uses,
    // so this assertion is platform-agnostic (backslashes on Windows,
    // forward slashes on POSIX).
    let dir_key = format!(
        "__dir__{}",
        trim_path_separators(&normalize_path_lower("/home/user/Games/Foo"))
    );
    let games = watcher.process_index.get(&dir_key).expect("install-dir key present");
    assert_eq!(games.len(), 1);
    // A prefix-sharing sibling directory must not share the key.
    let sibling_key = format!(
        "__dir__{}",
        trim_path_separators(&normalize_path_lower("/home/user/Games/FooBar"))
    );
    assert!(watcher.process_index.get(&sibling_key).is_none());
}

// ── bundled-Java-runtime fallback (Songs of Syx regression) ──────

#[test]
fn test_find_best_process_in_dir_attaches_bundled_javaw_after_stub_exit() {
    // Regression: Songs of Syx's `SongsOfSyx.exe` is a stub that
    // spawns `jre\bin\javaw.exe` and exits. The re-attach must
    // pick up the bundled JVM even though its stem (`javaw`) does
    // not match the tracked exe stem (`songsofsyx`).
    let procs = vec![make_proc(7, "C:\\Steam\\steamapps\\common\\Songs of Syx\\jre\\bin\\javaw.exe", 900)];
    let dir = Path::new("C:\\Steam\\steamapps\\common\\Songs of Syx");
    let best = find_best_process_in_dir(&procs, dir, Some("songsofsyx"), true).unwrap();
    assert_eq!(best.pid, 7, "bundled javaw re-attaches when the stub has exited");
}

#[test]
fn test_find_best_process_in_dir_java_fallback_only_in_own_dir() {
    // The Java fallback must be gated: a parent-level scan (shared
    // publisher root) with `allow_bundled_java = false` must NOT
    // grab a bundled javaw — that could steal a sibling game's
    // runtime process.
    let procs = vec![make_proc(
        7,
        "C:\\Steam\\steamapps\\common\\Songs of Syx\\jre\\bin\\javaw.exe",
        900,
    )];
    let dir = Path::new("C:\\Steam\\steamapps\\common");
    assert!(
        find_best_process_in_dir(&procs, dir, Some("songsofsyx"), false).is_none(),
        "Java fallback disabled for parent-directory scans"
    );
}

#[test]
fn test_find_best_process_in_dir_prefers_strict_stem_over_java_host() {
    // A still-alive exe with the tracked stem must always beat a
    // bundled runtime host, regardless of working-set size.
    let procs = vec![
        make_proc(1, "C:\\Games\\Foo\\game.exe", 100),
        make_proc(2, "C:\\Games\\Foo\\jre\\bin\\javaw.exe", 9999),
    ];
    let best =
        find_best_process_in_dir(&procs, Path::new("C:\\Games\\Foo"), Some("game"), true)
            .unwrap();
    assert_eq!(best.pid, 1, "strict stem match wins over the Java fallback");
}

#[test]
fn test_find_best_process_in_dir_system_java_outside_dir_never_attaches() {
    // A system-wide JVM (outside the install dir) is never the game,
    // even with the fallback enabled — the directory boundary still
    // applies.
    let procs = vec![make_proc(
        7,
        "C:\\Program Files\\Java\\jre-17\\bin\\javaw.exe",
        900,
    )];
    let dir = Path::new("C:\\Steam\\steamapps\\common\\Songs of Syx");
    assert!(
        find_best_process_in_dir(&procs, dir, Some("songsofsyx"), true).is_none(),
        "system Java outside the install dir must not re-attach"
    );
}

#[test]
fn test_find_session_process_tier1_attaches_bundled_javaw() {
    // End-to-end re-attach for the Songs of Syx hand-off: the stub
    // (tracked exe) has exited, the bundled javaw is still running.
    let procs = vec![make_proc(
        7,
        "C:\\Steam\\steamapps\\common\\Songs of Syx\\jre\\bin\\javaw.exe",
        900,
    )];
    let dir = PathBuf::from("C:\\Steam\\steamapps\\common\\Songs of Syx");
    let found = find_session_process(
        &procs,
        0,
        Some(&dir),
        "C:\\Steam\\steamapps\\common\\Songs of Syx\\SongsOfSyx.exe",
    )
    .unwrap();
    assert_eq!(found.pid, 7, "session survives the stub→javaw hand-off");
}

// ── find_session_process ─────────────────────────────────────────

#[test]
fn test_find_session_process_tier1_hit() {
    let procs = vec![
        make_proc(1, "C:\\Games\\Foo\\game.exe", 100),
        make_proc(2, "C:\\Games\\Foo\\other.exe", 50),
    ];
    let dir = PathBuf::from("C:\\Games\\Foo");
    let found = find_session_process(&procs, 0, Some(&dir), "C:\\Games\\Foo\\game.exe").unwrap();
    assert_eq!(found.pid, 1, "Tier 1 should attach the tracked exe stem inside the install dir");
}

#[test]
fn test_find_session_process_does_not_attach_leftover_helper() {
    // Regression: the game quit, but a large unrelated process is still
    // running in the install dir. The session must NOT re-attach to it
    // — that would make the app never notice the quit and inflate
    // playtime via the heartbeat.
    let procs = vec![
        make_proc(1, "C:\\Games\\Foo\\anticheatdaemon.exe", 5000),
        make_proc(2, "C:\\Games\\Foo\\bin\\updater.exe", 10),
    ];
    let dir = PathBuf::from("C:\\Games\\Foo");
    assert!(
        find_session_process(&procs, 0, Some(&dir), "C:\\Games\\Foo\\Game.exe").is_none(),
        "leftover non-game processes must not pin the session open"
    );
}

#[test]
fn test_find_session_process_tier2_stem_matched_sibling_attaches() {
    // Publisher root: the tracked exe stem lives in a sibling folder.
    let procs = vec![
        make_proc(1, "C:\\Games\\Publisher\\Launcher\\launcher.exe", 100),
        make_proc(2, "C:\\Games\\Publisher\\GameName\\game.exe", 50),
    ];
    let dir = PathBuf::from("C:\\Games\\Publisher\\Launcher");
    let found = find_session_process(
        &procs,
        0,
        Some(&dir),
        "C:\\Games\\Publisher\\GameName\\game.exe",
    )
    .unwrap();
    assert_eq!(found.pid, 2, "parent climb finds the stem-matched sibling game");
}

#[test]
fn test_find_session_process_tier2_ignores_unrelated_sibling_game() {
    // The tracked game quit, but a DIFFERENT game is running under the
    // same publisher root. It must not be grabbed as this session.
    let procs = vec![
        make_proc(1, "C:\\Games\\Publisher\\Launcher\\launcher.exe", 100),
        make_proc(2, "C:\\Games\\Publisher\\OtherGame\\other.exe", 9999),
    ];
    let dir = PathBuf::from("C:\\Games\\Publisher\\Launcher");
    assert!(
        find_session_process(
            &procs,
            0,
            Some(&dir),
            "C:\\Games\\Publisher\\GameName\\game.exe"
        )
        .is_none(),
        "a sibling game under the shared root must never be re-attached"
    );
}

#[test]
fn test_find_session_process_tier3_empty_matched_exe_returns_none() {
    // Regression pin for protocol launches: with no known exe, Tier 3
    // has no stem to match — even a game-named process elsewhere on
    // disk must not be grabbed.
    let procs = vec![make_proc(1, "D:\\Games\\GameName\\game.exe", 100)];
    let dir = PathBuf::from("C:\\Games\\Foo");
    assert!(find_session_process(&procs, 0, Some(&dir), "").is_none());
}

#[test]
fn test_find_session_process_no_install_dir_empty_matched_exe_returns_none() {
    let procs = vec![make_proc(1, "C:\\Games\\Foo\\game.exe", 100)];
    assert!(find_session_process(&procs, 0, None, "").is_none());
}

#[test]
fn test_find_session_process_skip_keyworded_direct_child_never_attaches() {
    // Only a skip-keyworded process sits inside the install dir. It is
    // never the game — neither for app-launched nor passive sessions.
    let procs = vec![make_proc(7, "C:\\Games\\Foo\\launcher.exe", 100)];
    let dir = PathBuf::from("C:\\Games\\Foo");
    assert!(find_session_process(&procs, 0, Some(&dir), "").is_none());
    assert!(find_session_process(&procs, 0, Some(&dir), "C:\\Games\\Foo\\Game.exe").is_none());
}

#[test]
fn test_find_session_process_unknown_stem_attaches_direct_child() {
    // Pending protocol launch (no exe known): a direct child of the
    // install dir is the game.
    let procs = vec![make_proc(3, "C:\\Games\\Foo\\game.exe", 100)];
    let dir = PathBuf::from("C:\\Games\\Foo");
    let found = find_session_process(&procs, 0, Some(&dir), "").unwrap();
    assert_eq!(found.pid, 3);
}

// ── find_session_process: splash / bootstrap hand-off (Tier 4) ────

#[test]
fn test_find_session_process_tier4_attaches_bootstrap_child_different_stem() {
    // Regression: a splash / bootstrap (`foo.exe`, PID 100) spawns the
    // real game under a different name (`fooswin64shipping.exe`,
    // PID 101) and exits. The strict stem tiers can't match the child,
    // but it is a direct descendant inside the install dir.
    let procs = vec![make_proc_with_ppid(
        101,
        100,
        "C:\\Games\\Foo\\Binaries\\Win64\\fooswin64shipping.exe",
        900,
    )];
    let dir = PathBuf::from("C:\\Games\\Foo");
    let found =
        find_session_process(&procs, 100, Some(&dir), "C:\\Games\\Foo\\foo.exe").unwrap();
    assert_eq!(found.pid, 101, "splash→game hand-off attaches the descendant");
}

#[test]
fn test_find_session_process_tier4_picks_largest_descendant() {
    // The bootstrap spawns a small helper and the real game; the game
    // is the heavyweight process left behind.
    let procs = vec![
        make_proc_with_ppid(101, 100, "C:\\Games\\Foo\\shim.exe", 10),
        make_proc_with_ppid(102, 101, "C:\\Games\\Foo\\Binaries\\Win64\\game.exe", 900),
    ];
    let dir = PathBuf::from("C:\\Games\\Foo");
    let found =
        find_session_process(&procs, 100, Some(&dir), "C:\\Games\\Foo\\foo.exe").unwrap();
    assert_eq!(found.pid, 102, "largest descendant wins (grandchild hand-off)");
}

#[test]
fn test_find_session_process_tier4_ignores_skip_and_outside_descendants() {
    let dir = PathBuf::from("C:\\Games\\Foo");
    // A skip-keyword descendant (crash handler) is never the game.
    let skip = vec![make_proc_with_ppid(
        101,
        100,
        "C:\\Games\\Foo\\crashhandler.exe",
        900,
    )];
    assert!(find_session_process(&skip, 100, Some(&dir), "C:\\Games\\Foo\\foo.exe").is_none());
    // A descendant outside the install dir (a shared helper) is not
    // grabbed either.
    let outside = vec![make_proc_with_ppid(101, 100, "C:\\Other\\foogame.exe", 900)];
    assert!(
        find_session_process(&outside, 100, Some(&dir), "C:\\Games\\Foo\\foo.exe").is_none()
    );
}

#[test]
fn test_find_session_process_no_tracked_pid_skips_tier4() {
    // Legacy/pending callers pass tracked_pid = 0: the descendant tier
    // must not run (no parent to follow), so a lone process outside the
    // install dir is still never attached.
    let procs = vec![make_proc_with_ppid(101, 100, "C:\\Games\\Foo\\game.exe", 900)];
    let dir = PathBuf::from("C:\\Games\\Foo");
    assert!(find_session_process(&procs, 0, Some(&dir), "C:\\Games\\Foo\\foo.exe").is_none());
}

// ── force-close sweep guards ─────────────────────────────────────

#[test]
fn test_is_install_dir_sweep_safe_rejects_broad_roots() {
    assert!(!is_install_dir_sweep_safe("d:\\"));
    assert!(!is_install_dir_sweep_safe("d:/"));
    assert!(!is_install_dir_sweep_safe("d:\\games"));
    assert!(!is_install_dir_sweep_safe(""));
    assert!(is_install_dir_sweep_safe("d:\\games\\witcher3"));
    assert!(is_install_dir_sweep_safe(
        "c:\\program files (x86)\\steam\\steamapps\\common\\skyrim"
    ));
    assert!(is_install_dir_sweep_safe("\\\\server\\share\\games\\skyrim"));
}

// ── Wine argv scanning (Linux) ───────────────────────────────────

#[cfg(target_os = "linux")]
#[test]
fn test_pick_wine_exe_arg_picks_existing_abs_path() {
    let dir = tempfile::tempdir().unwrap();
    let game = dir.path().join("game.exe");
    std::fs::write(&game, b"MZ").unwrap();
    let cmdline = vec![
        "/usr/lib/wine/wine64-preloader".to_string(),
        game.to_string_lossy().to_string(),
    ];
    assert_eq!(
        pick_wine_exe_arg(&cmdline, Some(dir.path())),
        Some(game.to_string_lossy().to_string())
    );
}

#[cfg(target_os = "linux")]
#[test]
fn test_pick_wine_exe_arg_skips_virtual_desktop_host() {
    // `explorer.exe` (the virtual-desktop host) has no host file and
    // must lose to the real game exe.
    let dir = tempfile::tempdir().unwrap();
    let game = dir.path().join("game.exe");
    std::fs::write(&game, b"MZ").unwrap();
    let cmdline = vec![
        "wine".to_string(),
        "run".to_string(),
        "explorer.exe".to_string(),
        "/desktop=GameIndex,1920x1080".to_string(),
        game.to_string_lossy().to_string(),
    ];
    assert_eq!(
        pick_wine_exe_arg(&cmdline, Some(dir.path())),
        Some(game.to_string_lossy().to_string())
    );
}

#[cfg(target_os = "linux")]
#[test]
fn test_pick_wine_exe_arg_resolves_relative_against_cwd() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("game.exe"), b"MZ").unwrap();
    let cmdline = vec![
        "gamemoderun".to_string(),
        "./game.exe".to_string(),
    ];
    let expected = dir.path().join("game.exe");
    assert_eq!(
        pick_wine_exe_arg(&cmdline, Some(dir.path())),
        Some(expected.to_string_lossy().to_string())
    );
}

#[cfg(target_os = "linux")]
#[test]
fn test_pick_wine_exe_arg_no_exe_arg_returns_none() {
    let cmdline = vec!["gamescope".to_string(), "-f".to_string()];
    assert_eq!(pick_wine_exe_arg(&cmdline, None), None);
}

#[cfg(target_os = "linux")]
#[test]
fn test_has_relative_exe_arg_only_flags_cwd_dependent_argv() {
    assert!(!has_relative_exe_arg(&[
        "wine".to_string(),
        "/games/foo/game.exe".to_string(),
    ]));
    assert!(has_relative_exe_arg(&[
        "gamemoderun".to_string(),
        "./game.exe".to_string(),
    ]));
    assert!(has_relative_exe_arg(&[
        "wine".to_string(),
        "C:\\Games\\foo\\game.exe".to_string(),
    ]));
    assert!(!has_relative_exe_arg(&[
        "gamescope".to_string(),
        "-f".to_string(),
    ]));
    assert!(!has_relative_exe_arg(&[]));
}

#[test]
fn test_is_sweep_candidate_bounds_the_install_dir_kill() {
    let dir = "d:\\games\\foo";
    // Deep stem match against the tracked exe → kill.
    assert!(is_sweep_candidate(
        "d:\\games\\foo\\bin\\win64\\foo.exe",
        dir,
        "D:\\Games\\Foo\\bin\\win64\\foo.exe"
    ));
    // Direct child with a known tracked stem → only the matching stem.
    assert!(!is_sweep_candidate("d:\\games\\foo\\overlay.exe", dir, "D:\\Games\\Foo\\foo.exe"));
    assert!(is_sweep_candidate("d:\\games\\foo\\foo.exe", dir, "D:\\Games\\Foo\\foo.exe"));
    // Direct child with an unknown tracked exe (pending launch) → kill.
    assert!(is_sweep_candidate("d:\\games\\foo\\game.exe", dir, ""));
    // Sibling-prefix path (FooBar) → never.
    assert!(!is_sweep_candidate("d:\\games\\foobar\\game.exe", dir, ""));
    // Outside the dir → never.
    assert!(!is_sweep_candidate("d:\\other\\foo.exe", dir, "D:\\Games\\Foo\\foo.exe"));
    // Deeper path with unknown stem → never.
    assert!(!is_sweep_candidate("d:\\games\\foo\\bin\\game.exe", dir, ""));
    // Deeper path with mismatched stem → never (the drive-root crash fix:
    // an unrelated process sharing the folder must never be swept).
    assert!(!is_sweep_candidate("d:\\games\\foo\\explorer.exe", dir, "D:\\Games\\Foo\\foo.exe"));
}
