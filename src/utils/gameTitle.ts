/**
 * Title identity helpers shared by the library, wishlist and deals surfaces.
 *
 * Spreadsheet titles carry punctuation, accents and stray whitespace, so any
 * cross-source comparison (wishlist key, owned check, deal grouping) goes
 * through the same normalisation instead of ad-hoc `toLowerCase()` in each
 * component.
 */

/** Lowercase, accent-stripped, punctuation-free identity string. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** URL-safe slug built from the normalised title. */
export function titleToSlug(title: string): string {
  return normalizeTitle(title).replace(/\s+/g, "-");
}
