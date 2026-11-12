# Backend command porting notes (Electron / Node)

> **Status: complete.** All 520 catalogued command names now have real handlers
> (0 stubs). The tables below describe the first wave; later passes added
> emulators/ROMs, the save engine, whole-app backups, capture/reels, media,
> store extras, plugins, achievements, MO2/mod compatibility and friends/Nostr.
> Per-feature notes live in `electron/main/features/*/README.md`; the boot
> smoke harness (`GI_SMOKE_TEST=1`, `GI_SMOKE_COMMANDS=a,b,c`) is the quickest
> way to inspect a command's real return shape.

This first pass made the **library shell** genuinely usable: the renderer could
save and hydrate its game library, open a game detail record, read/write
sessions, notes, shelves, wishlists, setup state and small settings, and use the
cheap filesystem/storage helpers. Everything else went through the catalog-wide
rejecting stub registered last in `commands/index.ts`.

> The generated `commandCatalog.ts` / `COMMANDS.txt` list is the source of
> truth for command names. Two commands implemented here — `load_games` and
> `save_games` — are **not** in that generated list (the current Tauri
> registration no longer exposes them). They are still registered explicitly
> and work, so external tooling that calls them keeps working.

## Data files

All paths are under Electron's `app.getPath('userData')`
(Windows: `%APPDATA%\GameIndex`).

| File | Owner | Shape |
| --- | --- | --- |
| `library.json` | `state/libraryStore.ts` | `{ version: 1, games: Game[], updatedAt: ISO string }` |
| `sessions-db.json` | `commands/sessions.ts` | `{ nextId: number, sessions: SessionRecord[] }` |
| `game-notes.json` | `commands/notes.ts` | `{ notes: GameNote[] }` |
| `shelves.json` | `commands/shelves.ts` | `{ shelves: Shelf[], completions: { [gameId]: unixMs } }` |
| `wishlist_cache.json` | `commands/wishlist.ts` | `{ entries: { [slug]: WishlistEntry } }` — same JSON string contract the old file had |
| `saves.json` | `commands/saves.ts` | `{ settings, locations: SaveLocation[], backups: SaveBackup[] }` |
| `storage-history.json` | `commands/files.ts` | `{ events: ReclaimEvent[], snapshots: SizeSnapshot[] }` |
| `app-settings.json` | `state/appSettings.ts` (existing) | theme/accent/language, launcher toggles, autostart, `metrics_config`, `bigscreen_prefs`, `setup_wizard_v1` |
| `sessions.json` | legacy only | Read by `load_sessions` for the old-JSON migration; never written by this port |
| `save_backups/` | future engine | Default backup directory reported by `saves_get_settings` |

Corrupt documents are renamed to `<file>.corrupt-<timestamp>` and replaced with
a clean default rather than crashing the app or blocking boot. Domain stores
write synchronously (temp file + rename) because their documents are small and
only change on explicit user actions.

## Implemented commands

Status legend: **impl** = real handler in this pass, **existing** = real handler
that was already in `commands/index.ts` before this pass.

### Game library — `commands/library.ts`

| Command | Status | Notes |
| --- | --- | --- |
| `load_games_summary` | impl | Every library row minus the heavy arrays (`screenshots`, `videos`, `similarGames`, `releases`, `igdbReviews`, `languageSupports`, `steamAchievements`), matching the Rust summary projection. |
| `load_games` | impl | Full document contents, stored order. Not in the generated catalog but registered. |
| `get_game_detail` | impl | Full row by `id`; `null` when absent. |
| `save_games` | impl | Replaces the whole library. Returns `{ written, deleted }`. Not in the generated catalog but registered. |
| `save_games_subset` | impl | Merge by id; provided rows are shallow-merged over their stored record, other rows untouched. Returns `{ written, deleted: 0 }`. |
| `save_game` | impl | Single-row upsert used by enrichment; merge-by-id so a summary row cannot erase heavy fields. |
| `patch_game` | impl | Sparse merge. Ignores `screenshots`/`videos`/`similarGames`/`releases`/`igdbReviews`/`languageSupports`/`steamAchievements`, `compatibility` and `id`, mirroring `patch_game_blocking`. |
| `delete_games` | impl | Removes by id; returns `null`. |
| `update_game_last_played` | impl | Session-end targeted `lastPlayed` stamp. |
| `delete_rom_file` | impl | Looks up `romPath`, reports/removes the file (best effort) and deletes the row. Mirrors `emulation.rs`. |
| `unlink_rom_file` | impl | Deletes the library row without touching the file. |

### Sessions — `commands/sessions.ts`

| Command | Status | Notes |
| --- | --- | --- |
| `get_sessions` | impl | Finished rows only, newest `startedAtMs` first, `metricsJson.samples` stripped (Rust `list_all_light` contract). |
| `get_session_samples` | impl | `[{ id, samples }]` for requested ids that actually carry curves. |
| `insert_session` | impl | Legacy/manual-session insert; computes `endedAtMs = startedAtMs + elapsedSeconds*1000`, returns numeric id. |
| `delete_session` | impl | Returns rows removed. |
| `delete_sessions_for_game` | impl | Returns rows removed. |
| `relink_sessions_for_game` | impl | Rewrites `gameId`/`gameName`, returns rows updated. |
| `load_sessions` | impl | Read-only read of the legacy `sessions.json` (returns `"[]"` when absent). |

### Notes — `commands/notes.ts`

| Command | Status | Notes |
| --- | --- | --- |
| `load_game_notes` | impl | Pinned first, then newest `updatedAt`. |
| `search_game_notes` | impl | Case-insensitive match over title, content and tags; empty query = recent; limit clamped to 1–200 (default 80). |
| `save_game_note` | impl | Generates id/`createdAt`, always refreshes `updatedAt`, preserves `createdAt` on edit. Returns the normalized row. |
| `delete_game_note` | impl | Returns rows removed (idempotent). |
| `delete_game_notes_for_game` | impl | Cascaded when a game is removed from the library. |

### Smart shelves — `commands/shelves.ts`

| Command | Status | Notes |
| --- | --- | --- |
| `shelves_list` | impl | Drag order (`position`, then `createdAt`). |
| `shelves_save` | impl | Generates id/defaults, appends new rows, keeps 30-shelf cap, refreshes `updatedAt`. |
| `shelves_delete` | impl | Returns rows removed. |
| `shelves_reorder` | impl | Writes `position = index`. |
| `shelves_completions` | impl | `[gameId, completedAt][]` tuples. |
| `shelves_set_completion` | impl | `completedAt === 0` clears; otherwise upserts. |

### Wishlist — `commands/wishlist.ts`

| Command | Status | Notes |
| --- | --- | --- |
| `load_wishlist` | impl | Always returns valid JSON (`{"entries":{}}` on first run), matching the SQL DAO’s string contract. |
| `save_wishlist` | impl | Validates the JSON document and replaces `wishlist_cache.json`. |

### Save backups (configuration only) — `commands/saves.ts`

| Command | Status | Notes |
| --- | --- | --- |
| `saves_get_settings` | impl | Real Rust defaults; empty `backupDir` resolves to `userData/save_backups`. |
| `saves_set_settings` | impl | Normalizes, clamps retention to 1000, returns the stored value. |
| `saves_summary` | impl | Computes counts/bytes from the stored location/backup arrays; first run is a real empty summary. |
| `saves_list_locations` | impl | Per-game stored locations (empty until detection/manual add lands). |
| `saves_list_all_locations` | impl | All stored locations. |
| `saves_location_health` | impl | Probes `fs.existsSync` for each location, optionally scoped to a game. |
| `saves_open_path` | impl | Opens an arbitrary path via `shell.openPath`. |
| `saves_open_location` | impl | Opens the recorded folder (or its parent when it is a file). |
| `saves_open_backup` | impl | Finds the backup and opens its folder. |

The detection/backup/restore engine (`saves_detect_*`, `saves_backup_*`,
`saves_restore_backup`, `saves_add_location`, …) remains stubbed.

### Setup wizard — `commands/setup.ts`

| Command | Status | Notes |
| --- | --- | --- |
| `setup_get_state` | impl | Reads `app-settings.json` key `setup_wizard_v1`; missing = default (not completed). |
| `setup_set_state` | impl | Persists the normalized state. |

### Settings / small kv — `commands/settings.ts`

| Command | Status | Notes |
| --- | --- | --- |
| `get_launcher_settings` | impl | Camel-case object the Settings page hydrates: close-to-tray, minimize-on-launch, restore-on-exit, disable-elevation-prompts, startup-splash. |
| `is_autostart_enabled` | impl | Actual OS login-item state via `app.getLoginItemSettings()`. |
| `set_metrics_config` | impl | Persists the telemetry config object for the future watcher; no watcher is running yet. |
| `bigscreen_prefs_get` | impl | Returns the stored opaque JSON string or `null`. |
| `bigscreen_prefs_set` | impl | 8 KB cap, stored verbatim. |
| `sources_list` | impl | Returns `[]` — the normal “no sources configured” first-run state. Source CRUD/refresh/search is still stubbed. |
| `download_history_get` | impl | Returns `[]` — the download engine is not ported, so there is no history. |

Theme/accent/language getters and setters, splash/window helpers, tray/startup
toggles and updater placeholders are **existing** handlers in
`commands/index.ts` and were left in place.

### System / filesystem — `commands/system.ts`, `commands/files.ts`

| Command | Status | Notes |
| --- | --- | --- |
| `get_system_ram_gb` | impl | `os.totalmem()` rounded to GB. |
| `get_system_info` | impl | CPU model + RAM; `gpus: []` because GPU enumeration is not ported. |
| `detect_gpus` | impl | Returns `[]`; the renderer falls back to its cached adapter list. |
| `refresh_hardware` | impl | No cache to invalidate in this build. |
| `get_platform` | impl | `windows` / `linux` / `macos` / `unknown`. |
| `check_paths_exist` | impl | Parallel `fs.access` probe, `true` = exists. |
| `disk_usage` | impl | `fs.statfs` → `{ total, free, available }`. Empty path probes `userData`. |
| `resolve_mounts` | impl | Resolves each path to its volume root; Windows-first (`device`/`fileSystem` empty strings). |
| `measure_path_size` | impl | File size, or recursive byte sum (symlinks skipped, partial sums kept). |
| `detect_game_size` | impl | `rootOverride`, else walks up to 8 parents for a folder named after the game, else the exe’s parent. Steam-appid resolution is not ported. |
| `scan_leftover_folders` | impl | One directory level per root, reserved-name filter, 60 measured folders, 100 results, byte-descending. |
| `get_exe_file_version` | impl | Pure-Node PE reader: PE/optional-header/resource-directory walk, `ProductVersion` → `FileVersion` string → fixed version block. Verified against `notepad.exe`/`explorer.exe`. |
| `detect_game_version` | impl | GOG `goggame-*.info`, folder manifests (`version.txt`, `build.info`, `version.json`, `build.json`, `package.json`), direct exe PE version, then a size-ordered candidate-exe scan. No Steam/Epic manifest lookup. |
| `storage_history_load` | impl | Bounded maintenance-history document. |
| `storage_history_record` | impl | De-dupes by event id, caps at 500 events. |
| `storage_history_snapshot` | impl | Collapses same-day samples, caps at 260 snapshots. |
| `storage_history_clear` | impl | Writes an empty history. |

## Shape / behaviour decisions

- **Summary vs full records.** `library.json` stores the full records the
  renderer sends. `load_games_summary` strips the same seven heavy fields the
  Rust `load_games_summary` did; `get_game_detail` returns the full row.
- **Subset writes preserve detail.** `save_games_subset` and `save_game` merge
  the incoming row over the stored one (`{ ...stored, ...incoming }`). Keys whose
  value is `undefined` are treated as absent (the renderer explicitly sets
  stripped heavy arrays to `undefined`, while Tauri’s JSON IPC dropped such keys
  before Rust saw them). This is safer than a full-row replacement for
  summary-only rows and still writes every field a detail-loaded row carries.
- **`patch_game` mirrors the Rust guard.** Heavy media keys, `compatibility`
  and `id` are never written by a patch. `null` clears a field; `undefined` is
  treated as absent, matching Tauri’s JSON serialization.
- **Write coalescing.** The library updates memory immediately and lands one
  debounced async write (200 ms) with a revision guard so an older snapshot
  cannot overwrite newer bytes. `before-quit` performs a synchronous flush.
- **First-run boot is never blocked.** A missing/corrupt `library.json` is
  replaced with an empty document synchronously on the first read.
- **Sessions.** JSON auto-increment id (`nextId`), finished rows only in
  `get_sessions`, newest-first, samples stripped. `sessions-db.json` avoids
  colliding with the legacy `sessions.json` migration file.
- **Saves settings default shape.** Same field names/defaults as
  `SavesSettings`; the resolved `backupDir` is reported but only persisted when
  the renderer calls `saves_set_settings`.
- **GPU detection.** Not ported. `detect_gpus` returns `[]` and
  `get_system_info` reports an empty GPU list; this is deliberate and documented
  rather than returning invented adapters. CPU/RAM are real.
- **`sources_list` / `download_history_get`** return `[]` because those are
  genuine “nothing configured / no engine” first-run states. They are not fake
  successful writes: all mutating source/download commands still reject.
- **No SQLite.** As scoped for this pass, every domain is a JSON document.
  The Rust DAO remains the behavioural reference, not a runtime dependency.
- **Progress / long work.** The ported commands that walk disk
  (`measure_path_size`, `detect_game_size`, `scan_leftover_folders`) are async
  and await between directories, so the main process stays responsive. No
  currently-ported command has a renderer-side progress listener, so no
  progress events are emitted for them; `saves-progress` remains reserved for
  the future backup engine.

## Known gaps / stubs

Every catalog name not listed above is registered by the generic stub in
`commands/index.ts` and rejects with an actionable “not implemented in the
Electron build yet” message. The largest stub areas:

| Area | Representative commands | Why |
| --- | --- | --- |
| Game launch / watcher / sessions detection | `launch_game`, `force_close_game`, `rebuild_watcher_index`, `get_game_wine_logs` | Needs process spawning, PE resolution, process polling and session lifecycle; not in this pass. |
| Metadata / media / artwork | `search_game_metadata`, `get_igdb_game_by_id`, `download_image`, `download_artwork`, `artwork_asset_url`, `ensure_artwork_thumbnails`, `sgdb_*`, `fetch_hltb_stats`, reviews, deals, news, CrackWatch, prices | External APIs and the artwork store are not ported. |
| Store integrations / auth | `steam_*`, `gog_*`, `epic_*`, `humble_*`, `rockstar_*`, `uplay_*`, `sources_add/remove/refresh/search` | Network/auth/vendor clients not ported; `sources_list` alone returns the empty first-run list. |
| Downloads / torrents / debrid | `torrent_*`, `direct_download_*`, `debrid_*`, `download_set_*`, `scheduler_*`, `search_downloads*` | Engine not ported; `download_history_get` returns `[]`. |
| Save-backup engine | `saves_detect_*`, `saves_backup_*`, `saves_restore_backup`, `saves_add_location`, `saves_remove_location`, `saves_summary` mutations | Only configuration/list/summary/open commands are ported. |
| News store | `news_*` | The News provider hydrates from `news_snapshot`; without the store it shows its error state. Network feed fetching (`fetch_url`) is also stubbed. |
| Achievements / RetroAchievements | `get_achievement_overview`, `fetch_achievements`, `manual_*`, `retro_*`, `load_achievements_cache` | Cache/schema not ported; the provider logs a warning and shows no data. |
| Emulation / ROM management | `list_emulators`, `scan_emulator_roms`, `rom_*`, `start_emulator_install` | Emulator DB, scanners and installers not ported. |
| Mods / MO2 | `mods_*`, `mo2_*`, `nexus_*` | Large subdomain, not ported. |
| Compatibility / Wine / Proton | `get_compatibility_settings`, `list_compatibility_runners`, `create_wine_prefix`, `run_wine_tool`, … | Linux/Wine tooling not ported. |
| Overlay / capture / reels / metrics | `overlay_*` (mostly owned by the surfaces agent), `capture_*`, `reel*`, `set_metrics_config` consumers | Native capture and metrics collection not ported. |
| Hardware probes | `detect_gpus` beyond the empty result, `get_steam_page_features`, `get_steam_tags`, player counts | Requires WMI / network integrations. |
| Backups / updater / plugins / friends | `backup_*`, `crashlog_*`, `plugins_*`, `friends_*`, `portable_update_download` | Separate subdomains not in this pass. |
| Misc | `scan_folders_for_exes`, `move_game_install`, `uninstall_game`, `read_media_file`, `save_text_file`, `open_prefix_directory` | Not required for the library shell. |

## Verification

Run from the repository root:

```powershell
npx tsc --noEmit
npx electron-vite build
```

Both pass for this pass. The PE version reader was additionally spot-checked
against `C:\Windows\System32\notepad.exe` and `C:\Windows\explorer.exe`; both
return a version string. (Windows may expose several language resources for one
binary; the reader returns the first resource’s string, matching the Rust
“first translation” behaviour.)
