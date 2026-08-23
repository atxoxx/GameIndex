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

export function translate(
  key: string,
  lang: string,
  vars?: Record<string, unknown>,
): string {
  const dict = DICTS[lang] ?? DICTS[DEFAULT_LANGUAGE];
  let str = dict[key] ?? DICTS[DEFAULT_LANGUAGE][key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, "g"), () => String(v));
    }
  }
  return str;
}

export * from "./languages";
