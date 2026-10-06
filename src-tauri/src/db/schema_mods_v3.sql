-- v3: multi-source mod browsing.
--
-- `mods` gains provenance columns so a mod installed from a remote
-- site (Thunderstore, GameBanana, …) can be traced back to its page.
-- `mod_source_links` stores the resolved external id of a library game
-- on each mod site (Nexus domain, Thunderstore community, GameBanana
-- game id, …) so the Discover browser knows which sites are relevant.
-- `mod_remote_installs` is the audit log of downloads performed from
-- the Discover browser (source + remote mod/file + where it landed).
ALTER TABLE mods ADD COLUMN source TEXT;
ALTER TABLE mods ADD COLUMN source_mod_id TEXT;
ALTER TABLE mods ADD COLUMN source_file_id TEXT;
ALTER TABLE mods ADD COLUMN remote_url TEXT;

CREATE TABLE IF NOT EXISTS mod_source_links (
    game_id TEXT NOT NULL,
    source TEXT NOT NULL,
    external_id TEXT NOT NULL,
    display_name TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (game_id, source)
);

CREATE TABLE IF NOT EXISTS mod_remote_installs (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL,
    source TEXT NOT NULL,
    source_mod_id TEXT NOT NULL,
    source_file_id TEXT,
    name TEXT NOT NULL,
    author TEXT,
    version TEXT,
    remote_url TEXT,
    installed_path TEXT,
    installed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_mod_remote_installs_game ON mod_remote_installs(game_id);
