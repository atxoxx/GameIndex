// Canonical language set shared by the UI translation layer and the
// per-language IGDB/Steam metadata fetcher.
//
// Each entry carries both:
//  - `code`    : the UI locale code used for display + i18n dictionaries
//                (e.g. "en", "zh-CN").
//  - `steamCode`: the Steam storefront `l=` parameter used when fetching
//                localized `about_the_game` text (e.g. "english", "schinese").
//
// The "usual" language is whatever the user picks in Settings (defaults to
// `en`); the remaining five are the configured "top" languages we always
// fetch so the About section can switch without a refetch.

export interface UiLanguage {
  /** UI locale code, matches a dictionary in `src/i18n/`. */
  code: string;
  /** Steam storefront `l=` code used for localized fetches. */
  steamCode: string;
  /** Native, end-user-facing label. */
  label: string;
  /** Lowercase ISO 3166-1 alpha-2 country code for the selector flag.
   *  Rendered as an inline SVG via `FlagIcon` — Windows can't render
   *  flag emoji (they show as bare letter pairs). */
  flag: string;
}

export const UI_LANGUAGES: UiLanguage[] = [
  { code: "en", steamCode: "english", label: "English", flag: "gb" },
  { code: "fr", steamCode: "french", label: "Français", flag: "fr" },
  { code: "es", steamCode: "spanish", label: "Español", flag: "es" },
  { code: "de", steamCode: "german", label: "Deutsch", flag: "de" },
  { code: "ru", steamCode: "russian", label: "Русский", flag: "ru" },
  { code: "zh-CN", steamCode: "schinese", label: "简体中文", flag: "cn" },
];

/** Default UI language (also the ultimate fallback for missing translations). */
export const DEFAULT_LANGUAGE = "en";

/** The fixed set of Steam `l=` codes we fetch localized About text for. */
export const ABOUT_FETCH_LANGUAGES: string[] = UI_LANGUAGES.map((l) => l.steamCode);

export function steamCodeForUi(uiCode: string): string {
  return UI_LANGUAGES.find((l) => l.code === uiCode)?.steamCode ?? "english";
}

export function uiCodeForSteam(steamCode: string): string {
  return UI_LANGUAGES.find((l) => l.steamCode === steamCode)?.code ?? "en";
}

export function isSupportedUiCode(code: string): boolean {
  return UI_LANGUAGES.some((l) => l.code === code);
}
