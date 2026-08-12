// RetroLinkModal — link a game to a RetroAchievements title: pick a
// console, search its game list, and "Use this game" persists the
// forced RA id and syncs the payload. Also offers a one-click
// "detect from ROM hash" path for games that have a ROM file.
//
// Search is debounced (350ms) so typing flows naturally without
// hammering the RA API on every keystroke.

import { useEffect, useRef, useState } from "react";
import { useAchievements } from "../../context/AchievementContext";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import type { Game, RaConsole, RaSearchResult } from "../../types/game";
import { Button } from "../ui";

interface RetroLinkModalProps {
  game: Game;
  onClose: () => void;
}

export default function RetroLinkModal({ game, onClose }: RetroLinkModalProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const {
    getRetroConsoles,
    searchRetroGames,
    setForcedRaGameId,
    syncRetroAchievements,
  } = useAchievements();

  const [consoles, setConsoles] = useState<RaConsole[]>([]);
  const [consoleId, setConsoleId] = useState<number>(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RaSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load consoles once on open; pick the first one by default.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await getRetroConsoles();
        if (cancelled) return;
        setConsoles(list);
        if (list.length > 0) setConsoleId(list[0].id);
      } catch (err) {
        if (!cancelled) setLoadError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getRetroConsoles]);

  // Close on Escape (not while a link/sync is in flight).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    inputRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  // Debounced search whenever the console or query changes.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || !consoleId) return;
    setSearching(true);
    setSearchError(null);
    const timer = window.setTimeout(async () => {
      try {
        const hits = await searchRetroGames(consoleId, q);
        setResults(hits);
        setSearched(true);
      } catch (err) {
        setSearchError(String(err));
        setResults([]);
        setSearched(true);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      setSearching(false);
    };
  }, [consoleId, query, searchRetroGames]);

  async function handleUse(result: RaSearchResult) {
    if (busy) return;
    setBusy(true);
    try {
      await setForcedRaGameId(game.id, result.id);
      await syncRetroAchievements(game.id);
      showToast(t("achievements.retroLink.linked"), "success");
      onClose();
    } catch (err) {
      showToast(t("achievements.retroLink.failed", { error: String(err) }), "error");
      setBusy(false);
    }
  }

  async function handleDetect() {
    if (busy) return;
    setBusy(true);
    try {
      await syncRetroAchievements(game.id);
      showToast(t("achievements.retroLink.linked"), "success");
      onClose();
    } catch (err) {
      showToast(t("achievements.retroLink.failed", { error: String(err) }), "error");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={busy ? undefined : onClose}>
      <div
        className="modal ach-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("achievements.retroLink.title")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
            </svg>
          </div>
          <div className="modal-header-text">
            <h2 className="modal-title">{t("achievements.retroLink.title")}</h2>
            <p className="modal-subtitle">{t("achievements.retroLink.subtitle")}</p>
          </div>
          <button
            className="modal-close ach-modal-close"
            aria-label={t("common.close")}
            onClick={onClose}
            disabled={busy}
          >
            ×
          </button>
        </div>

        <div className="modal-body ach-modal-body">
          {loadError ? (
            <p className="ach-modal-error">
              {t("achievements.retroLink.loadFailed", { error: loadError })}
            </p>
          ) : consoles.length === 0 ? (
            <p className="ach-modal-hint ach-modal-hint--center">
              {t("achievements.retroLink.noConsoles")}
            </p>
          ) : (
            <>
              <label className="ach-modal-field">
                <span className="ach-modal-field-label">
                  {t("achievements.retroLink.console")}
                </span>
                <select
                  className="ach-modal-select"
                  value={consoleId}
                  onChange={(e) => {
                    setConsoleId(Number(e.target.value));
                    setResults([]);
                    setSearched(false);
                  }}
                >
                  {consoles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="ach-modal-search">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" aria-hidden>
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  ref={inputRef}
                  type="text"
                  className="ach-modal-search-input"
                  placeholder={t("achievements.retroLink.searchPlaceholder")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>

              {query.trim().length < 2 && !searchError && (
                <p className="ach-modal-hint">{t("achievements.retroLink.searchHint")}</p>
              )}

              {searchError && (
                <p className="ach-modal-error">
                  {t("achievements.retroLink.searchFailed", { error: searchError })}
                </p>
              )}

              {searched && !searchError && results.length === 0 && !searching && (
                <p className="ach-modal-empty">
                  {t("achievements.retroLink.noResults", { query })}
                </p>
              )}

              {results.length > 0 && (
                <ul className="ach-modal-results">
                  {results.map((r) => (
                    <li key={r.id} className="ach-modal-result">
                      <div className="ach-modal-result-text">
                        <span className="ach-modal-result-name">{r.title}</span>
                        <span className="ach-modal-result-id">
                          {t("achievements.retroLink.achievements", {
                            count: r.numAchievements,
                          })}
                        </span>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleUse(r)}
                        isLoading={busy}
                        disabled={busy}
                      >
                        {t("achievements.retroLink.useGame")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              {game.romPath && (
                <div className="ach-modal-detect">
                  <span className="ach-modal-detect-hint">
                    {t("achievements.retroLink.detectHint")}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDetect}
                    isLoading={busy}
                    disabled={busy}
                  >
                    {t("achievements.retroLink.detect")}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer">
          <span className="modal-footer-count">&nbsp;</span>
          <div className="modal-footer-actions">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
