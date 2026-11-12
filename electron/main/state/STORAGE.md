# Storage map: JSON documents → SQLite domains

This build persists every domain in `<userData>/db/<domain>.db`. The old
`<userData>/*.json` documents are **not imported** (the owner chose a clean
start) and are **not deleted**: on the first storage access of a profile
`state/legacyJson.ts` moves the allow-listed files into
`<userData>/json-backup-<timestamp>/` and records the move in `kv.db`
under `storage:legacy-json-parked` (`{ at, dir, files, pluginConfigs }`).

`state/sqliteStore.ts` provides the same `JsonStore<T>` contract the old
`state/jsonStore.ts` had (`read` / `write` / `update` / `invalidate`, all
synchronous). `fileName` is the legacy document name (for diagnostics and the
backup workstream); `filePath()` / `databasePath()` return the database now
backing it.

## File → database → storage

| Legacy file | Database | Storage |
|---|---|---|
| `library.json` | `games.db` | real `games` table (parked, not re-imported) |
| `sessions.json`, `sessions-db.json` | `sessions.db` | real `sessions` table |
| `game-notes.json` | `game_notes.db` | real `game_notes` table |
| `shelves.json` | `shelves.db` | real `shelves` / `game_completions` |
| `wishlist_cache.json` | `wishlist.db` | real `wishlist` table |
| `saves.json` | `saves.db` | real `save_locations` / `save_backups` |
| `achievements.json` | `achievements.db` | **real** `achievements_cache` (codec) |
| `achievement-links.json` | `achievements.db` | **real** `achievement_links` (codec) |
| `achievement-settings.json` | `kv.db` | `documents` → `achievement-settings` (RA key stays safeStorage-encrypted) |
| `news.json` | `news.db` | **real** `news_feeds` / `news_articles` / `news_read` / `news_saved` / `news_history` / `news_prefs` (codec) |
| `plugins.json` | `plugins.db` | **real** `plugins` (codec, full manifest in `manifest_json`) |
| `plugins/<id>/config.json` | `plugins.db` | **real** `plugin_config` (values stay encrypted; file parked under `json-backup-*/plugins/<id>/`) |
| `clips.json` | `clips.db` | **real** `clips` / `reels` / `reel_items` (codec) |
| `mods.json` | `mods.db` | **real** `mods` / `game_mod_settings` / `mod_profiles` / `mod_source_links` / `mod_remote_installs` (codec) |
| `nexus.json` | `mods.db` | `documents` → `nexus` (API key) |
| `emulators.json` | `emulators.db` | **real** `emulators` (codec; unknown fields in `extra_json`) |
| `emulator-installs.json` | `emulators.db` | `documents` → `emulator-installs` |
| `sources.json` | `sources.db` | **real** `sources` / `sources_cache` (codec) |
| `source_cache.json` | `sources.db` | `documents` → `source_cache` (opaque renderer text) |
| `store-cache.json` | `store_cache.db` | **real** `store_cache` (page 0 per category) / `store_detail` (codec) |
| `store_cache.json` | `store_cache.db` | `documents` → `store_cache` (opaque renderer text) |
| `compatibility.json` | `compatibility.db` | **real** `compatibility_settings` (rows `settings` + `custom_prefixes`) (codec) |
| `downloads-state.json` | `downloads.db` | `documents` → `downloads-state` |
| `downloads-queue.json` | `downloads.db` | `documents` → `downloads-queue` |
| `downloads-secrets.json` | `downloads.db` | `documents` → `downloads-secrets` (debrid key stays safeStorage-encrypted) |
| `downloads-history.json` | `downloads.db` | **real** `download_history` (codec) |
| `friends-db.json` | `kv.db` | `documents` → `friends-db` (opaque renderer text) |
| `friends-secrets.json` | `kv.db` | `documents` → `friends-secrets` (Nostr key stays safeStorage-encrypted) |
| `steam-session.json` | `kv.db` | `documents` → `steam-session` (API key stays safeStorage-encrypted) |
| `store-ownership.json` | `kv.db` | `documents` → `store-ownership` |
| `store-settings.json` | `kv.db` | `documents` → `store-settings` |
| `steam-dlc.json` | `kv.db` | `documents` → `steam-dlc` |
| `beta-integrations.json` | `kv.db` | `documents` → `beta-integrations` |
| `extras-cache.json` | `kv.db` | `documents` → `extras-cache` |
| `media-roots.json` | `kv.db` | `documents` → `media-roots` |
| `watcher-index.json` | `kv.db` | `documents` → `watcher-index` |
| `storage-history.json` | `kv.db` | `documents` → `storage-history` |
| `review-quotes.json` | `kv.db` | `documents` → `review-quotes` |
| `plugin_availability_cache.json` | `kv.db` | `documents` → `plugin_availability_cache` (opaque renderer text) |

Every feature domain also has the generic `documents (name, json, updated_at)`
table. The codec-based rows above do not use it except for `*-meta` markers
(`news-meta`, `plugins-meta`, `mods-meta`) that have no Tauri column.

## Deliberately not a table (and why)

- **`store_cache`** keeps its renderer blob in `documents` when written through
  `features/metadata/stores.ts` (opaque text by contract); the catalogue codec
  in `features/stores/storeCache.ts` does split it into `store_cache` /
  `store_detail` rows. Both paths read/write the same document name in
  `store_cache.db`, so whichever command registrar is active behaves the same.
- **`source_cache.json` / `plugin_availability_cache.json`** are opaque maps
  owned by the renderer (validate-then-store). Shredding them into rows would
  change the contract for zero query benefit.
- **`nexus.json` / secrets** are single values; `documents` is the right shape.
  The value itself stays `safeStorage` ciphertext, so a copied `.db` is useless
  on another machine — same guarantee the JSON file had.
- **`emulators.json`** is a real table, but the row allows unknown fields; they
  round-trip through `extra_json` (including `autoScan`, whose "present but
  false" state a 0/1 column cannot express).

## Files that intentionally remain files

| File | Why |
|---|---|
| `app-settings.json` | Read synchronously while the app boots (splash/window setup), before `app.whenReady()`; owned by `state/appSettings.ts`, which is shared with another workstream. Moving it would risk a blank window on first paint. |
| `overlay.json` | Owned by `surfaces/` (outside this workstream's writable scope) and read by the overlay window plus `features/media/paths.ts` when enumerating capture roots. |
| `cache/metadata/<ns>.json` | Throw-away disk cache under `userData/cache/`, not domain data. |

## Backup workstream

`features/backup/**` should archive the **databases**, not the JSON files:
`games.db`, `sessions.db`, `game_notes.db`, `shelves.db`, `wishlist.db`,
`saves.db`, `kv.db`, `achievements.db`, `news.db`, `plugins.db`, `clips.db`,
`mods.db`, `emulators.db`, `sources.db`, `store_cache.db`, `compatibility.db`,
`downloads.db`. A consistent snapshot needs the `-wal` sidecars or a checkpoint
(`closeAllDatabases()` checkpoints on quit). `json-backup-*` folders are
recovery artefacts and need not be included.
