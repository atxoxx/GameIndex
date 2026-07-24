// i18n entry point.
//
// `translate(key, lang, vars?)` resolves a dotted key against the chosen
// language's dictionary, falling back to English, then to the raw key
// (so missing translations are always visible and never crash the UI).
//
// Interpolation: `{name}` placeholders in a string are replaced by the
// matching entry in `vars`.

import { en } from "./en";
import { fr } from "./fr";
import { es } from "./es";
import { de } from "./de";
import { ru } from "./ru";
import { zhCN } from "./zh-CN";
import { DEFAULT_LANGUAGE } from "./languages";

export type TranslationDict = Record<string, string>;

const DICTS: Record<string, TranslationDict> = {
  en,
  fr,
  es,
  de,
  ru,
  "zh-CN": zhCN,
};

export function translate(
  key: string,
  lang: string,
  vars?: Record<string, string | number>,
): string {
  const dict = DICTS[lang] ?? DICTS[DEFAULT_LANGUAGE];
  let str = dict[key] ?? DICTS[DEFAULT_LANGUAGE][key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return str;
}

export * from "./languages";
