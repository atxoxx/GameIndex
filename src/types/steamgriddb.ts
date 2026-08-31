/**
 * SteamGridDB artwork for a single Steam AppID.
 *
 * Mirrors the Rust `SgdbAssets` struct (camelCase serialization). Each kind
 * carries a **static** version (shown by default) and an **animated**
 * version (WebP/APNG — used on card hover and as the hero background, so
 * the animated art plays where the user expects motion). Every field is
 * `null` when the community has no artwork of that kind/variant for the
 * game; `mime` lets a renderer tell whether a URL is animated
 * (`image/apng`, `image/webp`) or static (`image/png`, `image/jpeg`).
 */
export interface SgdbAssets {
  /** Best static vertical grid / poster (600×900-style community art). */
  gridUrl: string | null;
  gridMime: string | null;
  /** Best animated grid (APNG / animated WebP) — card hover. */
  gridAnimatedUrl: string | null;
  gridAnimatedMime: string | null;
  /** Best static wide hero / banner (460×215-style community art). */
  heroUrl: string | null;
  heroMime: string | null;
  /** Best animated hero — hero background. */
  heroAnimatedUrl: string | null;
  heroAnimatedMime: string | null;
  /** Best square icon (flat community icon art). */
  iconUrl: string | null;
  iconMime: string | null;
  /** Best clear logo (flat transparent logo art). */
  logoUrl: string | null;
  logoMime: string | null;
}

/** One image item in the full SteamGridDB gallery for a game. */
export interface SgdbArtworkItem {
  url: string;
  mime: string;
  width: number;
  height: number;
  score: number;
}

/** Every SteamGridDB upload for a game, grouped by kind. Returned by the
 *  `sgdb_get_all_assets` command used by the edit-modal media picker. */
export interface SgdbAllAssets {
  grids: SgdbArtworkItem[];
  heroes: SgdbArtworkItem[];
  icons: SgdbArtworkItem[];
  logos: SgdbArtworkItem[];
}