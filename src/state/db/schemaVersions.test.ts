/**
 * Schema-version selection tests.
 *
 * The migration runner must apply every version above the recorded one, in
 * order, exactly once. These are pure checks on the registry, plus a guard that
 * the DDL actually contains every column the row mapping writes.
 */
import { describe, expect, it } from "vitest";
import {
  DB_FILES,
  MIGRATIONS,
  latestVersion,
  pendingMigrations,
  type DbDomain,
} from "../../../electron/main/state/db/schema";
import { GAME_COLUMNS } from "../../../electron/main/state/db/gameRows";

const DOMAINS = Object.keys(MIGRATIONS) as DbDomain[];
const versionsOf = (domain: DbDomain): number[] =>
  MIGRATIONS[domain].map((migration) => migration.version);

describe("schema versions", () => {
  it("starts a fresh database at version 0 with every migration pending", () => {
    for (const domain of DOMAINS) {
      const pending = pendingMigrations(domain, 0);
      expect(pending.map((migration) => migration.version)).toEqual(versionsOf(domain));
      expect(pending.length).toBeGreaterThan(0);
    }
  });

  it("selects only the migrations above the recorded version", () => {
    expect(pendingMigrations("games", 0).map((m) => m.version)).toEqual(versionsOf("games"));
    expect(pendingMigrations("games", 1).map((m) => m.version)).toEqual(
      versionsOf("games").filter((version) => version > 1),
    );
    // No domain reports work once it is at its latest version.
    for (const domain of DOMAINS) {
      expect(pendingMigrations(domain, latestVersion(domain))).toEqual([]);
    }
    expect(pendingMigrations("kv", 1).map((m) => m.version)).toEqual(
      versionsOf("kv").filter((version) => version > 1),
    );
  });

  it("treats a non-finite or future version safely", () => {
    expect(pendingMigrations("games", Number.NaN).map((m) => m.version)).toEqual(versionsOf("games"));
    expect(pendingMigrations("games", 99)).toEqual([]);
  });

  it("numbers migrations strictly increasing from 1", () => {
    for (const domain of DOMAINS) {
      const versions = MIGRATIONS[domain].map((migration) => migration.version);
      expect(versions[0]).toBe(1);
      for (let i = 1; i < versions.length; i += 1) {
        expect(versions[i]).toBeGreaterThan(versions[i - 1]);
      }
      expect(latestVersion(domain)).toBe(versions[versions.length - 1]);
      expect(MIGRATIONS[domain].every((m) => m.statements.length > 0)).toBe(true);
    }
    expect(new Set(Object.values(DB_FILES)).size).toBe(DOMAINS.length);
  });

  it("has a DDL column for every mapped game column", () => {
    const ddl = MIGRATIONS.games
      .flatMap((migration) => migration.statements)
      .join("\n");
    for (const { column } of GAME_COLUMNS) {
      expect(ddl, `games DDL is missing ${column}`).toContain(column);
    }
    // Electron-only columns live in v2.
    const v2 = MIGRATIONS.games[1].statements.join("\n");
    for (const column of ["position", "extra_json", "compatibility_json"]) {
      expect(v2).toContain(column);
    }
  });

  it("indexes the columns the query paths rely on", () => {
    const games = MIGRATIONS.games.flatMap((m) => m.statements).join("\n");
    expect(games).toContain("ix_games_name");
    const sessions = MIGRATIONS.sessions.flatMap((m) => m.statements).join("\n");
    expect(sessions).toContain("ix_sessions_game   ON sessions(game_id, started_at DESC)");
    expect(sessions).toContain("ix_sessions_started");
  });
});
