/**
 * `wishlist` domain repository (mirrors `src-tauri/src/db/wishlist.rs`).
 *
 * One row per slug (`payload_json` is the entry as compact JSON, `added_at`
 * unix ms). The renderer still saves the whole `{ entries }` document, so the
 * write path replaces the table in one transaction; `load_wishlist` rebuilds
 * the same object in insertion order.
 */
import { openDb, prepare } from "./sqlite";

export type WishlistEntries = Record<string, unknown>;

/** Entries in insertion order (the order the JSON document was written in). */
export function listWishlistEntries(): WishlistEntries {
  const rows = prepare(
    "wishlist",
    "SELECT slug, payload_json FROM wishlist ORDER BY rowid ASC",
  ).all() as { slug?: string; payload_json?: string }[];

  const entries: WishlistEntries = {};
  for (const row of rows) {
    if (typeof row.slug !== "string" || row.slug.length === 0) continue;
    if (typeof row.payload_json !== "string") continue;
    try {
      entries[row.slug] = JSON.parse(row.payload_json) as unknown;
    } catch {
      // A corrupt payload is skipped instead of failing the whole document.
    }
  }
  return entries;
}

function addedAtOf(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const raw = (value as { addedAt?: unknown }).addedAt;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** Replace every row (`save_wishlist`). */
export function replaceWishlistEntries(entries: WishlistEntries): number {
  const db = openDb("wishlist");
  const run = db.transaction(() => {
    prepare("wishlist", "DELETE FROM wishlist").run();
    const insert = prepare(
      "wishlist",
      "INSERT OR REPLACE INTO wishlist(slug, payload_json, added_at) VALUES (?, ?, ?)",
    );
    let written = 0;
    for (const [slug, entry] of Object.entries(entries)) {
      insert.run(slug, JSON.stringify(entry), addedAtOf(entry));
      written += 1;
    }
    return written;
  });
  return run();
}

/** Import helper: keep slugs that are already stored. */
export function insertMissingWishlist(entries: WishlistEntries): number {
  const insert = prepare(
    "wishlist",
    "INSERT OR IGNORE INTO wishlist(slug, payload_json, added_at) VALUES (?, ?, ?)",
  );
  let written = 0;
  for (const [slug, entry] of Object.entries(entries)) {
    written += insert.run(slug, JSON.stringify(entry), addedAtOf(entry)).changes;
  }
  return written;
}

/** Import helper for the legacy `wishlist.db` shape (pre-serialized payload). */
export function insertMissingWishlistRows(
  rows: { slug: string; payloadJson: string; addedAt: number }[],
): number {
  const insert = prepare(
    "wishlist",
    "INSERT OR IGNORE INTO wishlist(slug, payload_json, added_at) VALUES (?, ?, ?)",
  );
  let written = 0;
  for (const row of rows) {
    written += insert.run(row.slug, row.payloadJson, row.addedAt).changes;
  }
  return written;
}
