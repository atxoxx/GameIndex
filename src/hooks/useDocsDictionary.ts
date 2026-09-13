// Tracks whether the in-app guide strings (`docs.*`) for the active
// language are loaded. The Docs pages gate their render on this so the
// guide never flashes raw `docs.*` keys while its per-locale pack loads.

import { useEffect, useState } from "react";
import { useLanguage } from "../context/LanguageContext";
import { ensureDocsLoaded, isDocsLoaded } from "../i18n";

export function useDocsDictionary(): boolean {
  const { language } = useLanguage();
  const [readyLang, setReadyLang] = useState<string | null>(() =>
    isDocsLoaded(language) ? language : null,
  );

  useEffect(() => {
    if (isDocsLoaded(language)) {
      setReadyLang(language);
      return;
    }
    let cancelled = false;
    ensureDocsLoaded(language)
      .catch(() => {
        // Load failure is non-fatal: `translate()` falls back to English
        // (and ultimately to the raw key) rather than blocking the page.
      })
      .finally(() => {
        if (!cancelled) setReadyLang(language);
      });
    return () => {
      cancelled = true;
    };
  }, [language]);

  return readyLang === language;
}
