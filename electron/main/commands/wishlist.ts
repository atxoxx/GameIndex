/**
 * Wishlist cache.
 *
 * The renderer owns the in-memory wishlist and saves the whole
 * `{ entries: { [slug]: WishlistEntry } }` document on a debounce. The Rust
 * build stored one SQLite row per slug but exposed the same JSON string
 * contract; this port does the same in `<userData>/db/wishlist.db`
 * (`state/db/wishlist.ts`), so `load_wishlist` / `save_wishlist` keep their
 * exact shapes.
 */
import type { CommandHandler } from "../ipc";
import {
  ensureStorage,
  listWishlistEntries,
  replaceWishlistEntries,
} from "../state/db";

export const wishlistCommands: Record<string, CommandHandler> = {
  load_wishlist: () => {
    ensureStorage("wishlist");
    return JSON.stringify({ entries: listWishlistEntries() });
  },

  save_wishlist: (args) => {
    const data = args.data;
    if (typeof data !== "string") throw new Error("save_wishlist expects a JSON `data` string");

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch (error) {
      throw new Error(
        `parse wishlist: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("parse wishlist: expected an object");
    }

    const rawEntries = (parsed as { entries?: unknown }).entries;
    const entries =
      rawEntries && typeof rawEntries === "object" && !Array.isArray(rawEntries)
        ? (rawEntries as Record<string, unknown>)
        : {};

    ensureStorage("wishlist");
    replaceWishlistEntries(entries);
    return null;
  },
};
