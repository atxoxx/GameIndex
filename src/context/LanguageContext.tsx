// LanguageContext — owns the active UI display language and exposes the
// `t()` translator. The chosen language is persisted to the backend kv
// store under the `language` key (the same key the achievements
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
import { ensureLocaleLoaded, translate } from "../i18n";

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

  // Hydrate persisted language and eagerly load its dictionary chunk.
  useEffect(() => {
    invoke<string | null>("get_language")
      .then(async (v) => {
        if (v && isSupportedUiCode(v)) {
          try {
            await ensureLocaleLoaded(v);
          } catch {
            /* load failed — translate() will fall back to English */
          }
          setLangState(v);
        }
      })
      .catch(() => {
        /* backend unavailable — keep default */
      });
  }, []);

  // Whenever the active language changes (including the initial hydrate),
  // ensure its chunk is loaded so `t()` has the real dictionary and not
  // just the English fallback. `en` is eager, so this is a no-op for it.
  useEffect(() => {
    void ensureLocaleLoaded(language).catch(() => {
      /* fallback handled inside translate() */
    });
  }, [language]);

  const setLanguage = useCallback(async (code: string) => {
    // Load the target locale's chunk before switching state so the UI
    // never flashes English. Failure keeps us on the previous language's
    // dictionary via translate()'s fallback.
    try {
      await ensureLocaleLoaded(code);
    } catch {
      /* non-fatal — still switch, translate() falls back to en */
    }
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
