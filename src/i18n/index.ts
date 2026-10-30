// i18n entry point.
//
// `translate(key, lang, vars?)` resolves a dotted key against the chosen
// language's dictionary, falling back to English, then to the raw key
// (so missing translations are always visible and never crash the UI).
//
// Interpolation: `{name}` placeholders in a string are replaced by the
// matching entry in `vars`.
//
// Bundle-splitting: only `en` is eagerly imported. The other five locales
// (~5k lines each) are loaded on demand via `ensureLocaleLoaded()` — see
// LanguageContext.tsx. This keeps the initial JS chunk lean and splits
// each locale into its own Vite chunk (fr, es, de, ru, zh-CN).
//
// The in-app guide is a second, larger split: every `docs.*` string lives
// in a per-locale pack under `./docs/` and only merges into the runtime
// dictionary when a Docs page mounts (`ensureDocsLoaded()`). The guide is
// ~20% of each dictionary's bytes and is never needed before then, so
// keeping it out of the base chunks keeps every language switch cheaper.

import { en } from "./en";
import { DEFAULT_LANGUAGE } from "./languages";

export type TranslationDict = Record<string, string>;

// Eager dictionary — only English is bundled in the initial chunk.
const DICTS: Record<string, TranslationDict> = {
  en,
};

let activeLocale = DEFAULT_LANGUAGE;

export function getActiveLocale(): string {
  return activeLocale;
}

export function setActiveLocale(lang: string): void {
  activeLocale = lang;
}

const loaded = new Set<string>(["en"]);
const pending = new Map<string, Promise<void>>();

/**
 * Ensure `lang`'s dictionary is loaded. No-op for `en` / already-loaded
 * locales. Deduplicates concurrent calls via `pending`.
 * Each `import("./xx")` becomes a separate Vite chunk (visualizer-friendly).
 */
export async function ensureLocaleLoaded(lang: string): Promise<void> {
  if (loaded.has(lang)) return;
  if (pending.has(lang)) return pending.get(lang)!;
  let promise: Promise<void>;
  switch (lang) {
    case "fr":
      promise = import("./fr").then((m) => {
        DICTS.fr = m.fr;
        loaded.add(lang);
      });
      break;
    case "es":
      promise = import("./es").then((m) => {
        DICTS.es = m.es;
        loaded.add(lang);
      });
      break;
    case "de":
      promise = import("./de").then((m) => {
        DICTS.de = m.de;
        loaded.add(lang);
      });
      break;
    case "ru":
      promise = import("./ru").then((m) => {
        DICTS.ru = m.ru;
        loaded.add(lang);
      });
      break;
    case "zh-CN":
      promise = import("./zh-CN").then((m) => {
        DICTS["zh-CN"] = m.zhCN;
        loaded.add(lang);
      });
      break;
    default:
      return;
  }
  pending.set(lang, promise);
  try {
    await promise;
  } finally {
    pending.delete(lang);
  }
}

export function isLocaleLoaded(lang: string): boolean {
  return loaded.has(lang);
}

// ── In-app guide (`docs.*`) ────────────────────────────────────────────────
// Guide strings are split out of the base dictionaries into their own
// per-locale pack. `ensureDocsLoaded()` loads the active locale's pack (and
// its base dictionary, if needed) and merges the strings in. The Docs pages
// await it before rendering so the UI never flashes raw `docs.*` keys.

const docsLoaded = new Set<string>();
const docsPending = new Map<string, Promise<void>>();

export function isDocsLoaded(lang: string): boolean {
  return docsLoaded.has(lang);
}

/**
 * Ensure `lang`'s `docs.*` strings are merged into the runtime dictionary.
 * No-op when already loaded; concurrent calls share one import. Failures are
 * rethrown so callers can decide whether to render with the English fallback.
 */
export async function ensureDocsLoaded(lang: string): Promise<void> {
  if (docsLoaded.has(lang)) return;
  if (docsPending.has(lang)) return docsPending.get(lang)!;
  const promise = (async () => {
    await ensureLocaleLoaded(lang);
    const base = DICTS[lang];
    if (!base) return;
    let pack: TranslationDict | undefined;
    switch (lang) {
      case "en":
        pack = (await import("./docs/docsEn")).docsEn;
        break;
      case "fr":
        pack = (await import("./docs/docsFr")).docsFr;
        break;
      case "es":
        pack = (await import("./docs/docsEs")).docsEs;
        break;
      case "de":
        pack = (await import("./docs/docsDe")).docsDe;
        break;
      case "ru":
        pack = (await import("./docs/docsRu")).docsRu;
        break;
      case "zh-CN":
        pack = (await import("./docs/docsZhCN")).docsZhCN;
        break;
      default:
        return;
    }
    DICTS[lang] = { ...base, ...pack };
    docsLoaded.add(lang);
  })();
  docsPending.set(lang, promise);
  try {
    await promise;
  } finally {
    docsPending.delete(lang);
  }
}

/**
 * Placeholders the English source uses as a bare plural suffix (`3 game{s}`).
 * English injects "s"/"es" into them; every other locale pluralises its own
 * way, so the injected English suffix must never reach a translated string —
 * "3 game" + "s" dropped into "3 игра" would render "3 играs". Those variables
 * therefore resolve to "" unless the rendered dictionary is the English one,
 * which lets a translation place `{plural}` where an empty string reads
 * naturally (usually at the end of the clause).
 */
const ENGLISH_PLURAL_SUFFIX_VARS = new Set(["plural", "s", "seedPlural"]);

export function translate(
  key: string,
  lang: string,
  vars?: Record<string, unknown>,
): string {
  const requested = DICTS[lang];
  // Resolve the dictionary entry itself, so a key that only exists in English
  // is still treated as English even when the rest of the locale is loaded.
  const localized = requested?.[key];
  const englishValue = DICTS[DEFAULT_LANGUAGE][key];
  let str = localized ?? englishValue ?? key;
  if (vars) {
    // Unsupported/not-yet-loaded locales and per-key English fallbacks render
    // English text, so the English suffix rule applies there too.
    const english = lang === DEFAULT_LANGUAGE || localized === undefined;
    for (const [k, v] of Object.entries(vars)) {
      const value =
        !english && ENGLISH_PLURAL_SUFFIX_VARS.has(k) ? "" : String(v);
      str = str.split(`{${k}}`).join(value);
    }
  }
  return str;
}

export * from "./languages";
