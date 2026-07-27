//! Embedded SQL schema strings, one per logical database file.
//!
//! Every domain GameIndex persists lives in its own constant here, so
//! the schema is reviewable in one place and can be unit-tested (we
//! apply each DDL against a temp DB and verify it's idempotent).
//!
//! ## Conventions
//!
//! - Timestamps: unix seconds (u64), nullable columns default NULL.
//! - Compact JSON columns: when a piece of state is "too varied to be
//!   worth its own columns", we serialize it as compact JSON into a
//!   single TEXT column. Reads accept the deserialization cost; writes
//!   skip the schema-overhead cost.
//! - Foreign keys with `ON DELETE CASCADE` model ownership. The
//!   `sources` table is the canonical source of truth; deleting a
//!   source cascades to its cache, downloads, and FTS5 mirrors.

/// DDL for the `sources` domain: `sources`, `sources_cache`,
/// `downloads`, `downloads_fts` (+ sync triggers). These four are
/// FK/trigger-coupled and must live in the same file.
pub const SOURCES_DDL: &str = include_str!("schema_sources.sql");

/// DDL for the `games` domain: the `games` table plus the v2 (GOG)
/// and v5 (launch orchestration) column additions, in historical
/// order so the Rust DAO's positional column reads stay valid.
pub const GAMES_DDL: &str = include_str!("schema_games.sql");

/// DDL for the `games` domain, v2 migration: emulation linkage columns
/// (`emulator_id`, `rom_path`). Applied as a separate migration version
/// so existing installs (already at `games` v1) pick it up on next
/// launch; fresh installs apply v1 then v2.
pub const GAMES_V2_DDL: &str = include_str!("schema_games_v2.sql");

/// DDL for the `games` domain, v3 migration: mods-tracking columns
/// (`mods_folder`, `mods_size_bytes`, `mods_detected_at`). Applied as a
/// separate migration version so existing installs (already at `games` v2)
/// pick it up on next launch; fresh installs apply v1 → v2 → v3.
pub const GAMES_V3_DDL: &str = include_str!("schema_games_v3.sql");

/// DDL for the `emulators` domain: the `emulators` table.
pub const EMULATORS_DDL: &str = include_str!("schema_emulators.sql");

/// DDL for the `sessions` domain: `sessions` plus the v4 `game_name`
/// denormalization.
pub const SESSIONS_DDL: &str = include_str!("schema_sessions.sql");

/// DDL for the `wishlist` domain.
pub const WISHLIST_DDL: &str = include_str!("schema_wishlist.sql");

/// DDL for the `store_cache` domain: `store_cache` + `store_detail`.
pub const STORE_CACHE_DDL: &str = include_str!("schema_store_cache.sql");

/// DDL for the `achievements` domain.
pub const ACHIEVEMENTS_DDL: &str = include_str!("schema_achievements.sql");

/// DDL for the `kv` domain: the generic `kv_store` table.
pub const KV_DDL: &str = include_str!("schema_kv.sql");

/// DDL for the `news` domain.
pub const NEWS_DDL: &str = include_str!("schema_news.sql");

/// DDL for the `mods` domain: `mods` + `game_mod_settings`.
pub const MODS_DDL: &str = include_str!("schema_mods.sql");

/// DDL for the `mods` domain, v2: destructive rebuild (fixes stale
/// dev-era tables with a different column set) + `custom_root`.
pub const MODS_V2_DDL: &str = include_str!("schema_mods_v2.sql");

/// Bootstrap the schema-meta table on a fresh domain DB. This table is
/// itself part of v1, but we need to read `schema_version` *before*
/// applying v1, so bootstrap is logically a separate step.
pub const META_BOOTSTRAP: &str = "
CREATE TABLE IF NOT EXISTS schema_meta (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
);
";

/// One physical database file and the ordered list of migrations that
/// build it up. Each `versions` entry is `(label, ddl)`; the runner
/// applies any entry whose label is newer than the domain's recorded
/// `schema_version`, inside a single transaction.
///
/// **Adding a new migration to a domain**: append
/// `("vN", &new_ddl)` at the end of that domain's slice — never
/// renumber existing tuples.
pub struct DomainSchema {
    /// File/pool label, e.g. `"games"`. Must match a `Db` pool.
    pub label: &'static str,
    /// Ordered migrations, oldest first.
    pub versions: &'static [(&'static str, &'static str)],
}

/// All known domain schemas, in no particular order (the runner
/// iterates them independently).
pub const DOMAIN_SCHEMAS: &[DomainSchema] = &[
    DomainSchema {
        label: "sources",
        versions: &[("v1", SOURCES_DDL)],
    },
DomainSchema {
    label: "games",
    versions: &[("v1", GAMES_DDL), ("v2", GAMES_V2_DDL), ("v3", GAMES_V3_DDL)],
},
    DomainSchema {
        label: "sessions",
        versions: &[("v1", SESSIONS_DDL)],
    },
    DomainSchema {
        label: "wishlist",
        versions: &[("v1", WISHLIST_DDL)],
    },
    DomainSchema {
        label: "store_cache",
        versions: &[("v1", STORE_CACHE_DDL)],
    },
    DomainSchema {
        label: "achievements",
        versions: &[("v1", ACHIEVEMENTS_DDL)],
    },
    DomainSchema {
        label: "kv",
        versions: &[("v1", KV_DDL)],
    },
    DomainSchema {
        label: "news",
        versions: &[("v1", NEWS_DDL)],
    },
    DomainSchema {
        label: "emulators",
        versions: &[("v1", EMULATORS_DDL)],
    },
    DomainSchema {
        label: "mods",
        versions: &[("v1", MODS_DDL), ("v2", MODS_V2_DDL)],
    },
];
