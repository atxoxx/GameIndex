// LanguageContext — owns the active UI display language and exposes the
// `t()` translator. The chosen language is persisted to the backend kv
// store under the `language` key (the same key the achievements/Hydra
// sync paths already read via `resolve_language`), so the preference
// survives restarts and is shared across features.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_LANGUAGE, isSupportedUiCode, UI_LANGUAGES } from "../i18n/languages";
import { translate } from "../i18n";

interface LanguageContextValue {
  /** Active UI locale code (e.g. "en", "zh-CN"). */
  language: string;
  /** Persist + activate a new UI language. */
  setLanguage: (code: string) => Promise<void>;
  /** The full list of selectable languages. */
  languages: typeof UI_LANGUAGES;
  /** Translate `key` in the active language (English fallback). */
  t: (key: string, vars?: Record<string, unknown>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLangState] = useState<string>(DEFAULT_LANGUAGE);

  useEffect(() => {
    invoke<string | null>("get_language")
      .then((v) => {
        if (v && isSupportedUiCode(v)) setLangState(v);
      })
      .catch(() => {
        /* backend unavailable — keep default */
      });
  }, []);

  const setLanguage = useCallback(async (code: string) => {
    setLangState(code);
    try {
      await invoke("set_language", { language: code });
    } catch {
      /* non-fatal */
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, unknown>) =>
      translate(key, language, vars),
    [language],
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage, languages: UI_LANGUAGES, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return ctx;
}
