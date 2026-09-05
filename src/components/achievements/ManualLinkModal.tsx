// ManualLinkModal — link a local / unlinked game to a Steam Store title
// so its achievements can be tracked manually (schema from Steam, unlock
// state edited by the user). Search hits come from searchManualSteam;
// linking persists an `achievement_links` row and immediately syncs the
// manual payload into the cache.
//
// Renders nothing until the parent mounts it (project convention: modals
// are conditionally rendered, not idle-rendered with an `open` flag).

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAchievements } from "../../context/AchievementContext";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import type { SteamSearchResult } from "../../types/game";
import { Button } from "../ui";

interface ManualLinkModalProps {
  gameId: string;
  onClose: () => void;
}

export default function ManualLinkModal({
  gameId,
  onClose,
}: ManualLinkModalProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const { searchManualSteam, createManualLink, syncManualAchievements } =
    useAchievements();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SteamSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on Escape, and focus the search box on open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !linking) onClose();
    };
    window.addEventListener("keydown", onKey);
    inputRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, linking]);

  async function handleSearch() {
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    setSearchError(null);
    setSearched(false);
    try {
      const hits = await searchManualSteam(q);
      setResults(hits);
      setSearched(true);
    } catch (err) {
      setSearchError(String(err));
      setResults([]);
      setSearched(true);
    } finally {
      setSearching(false);
    }
  }

  async function handleLink(result: SteamSearchResult) {
    if (linking) return;
    setLinking(true);
    try {
      await createManualLink(gameId, result.appid, result.name);
      await syncManualAchievements(gameId);
      showToast(
        t("achievements.manualLink.linked", { name: result.name }),
        "success",
      );
      onClose();
    } catch (err) {
      showToast(t("achievements.manualLink.failed", { error: String(err) }), "error");
      setLinking(false);
    }
  }

  return createPortal(
    <div className="modal-backdrop" onMouseDown={linking ? undefined : onClose}>
      <div
        className="modal ach-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("achievements.manualLink.title")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 15l-2 5-1-3-3-1 5-2z" />
              <path d="M18.364 5.636a9 9 0 0 1-12.728 12.728" />
            </svg>
          </div>
          <div className="modal-header-text">
            <h2 className="modal-title">{t("achievements.manualLink.title")}</h2>
            <p className="modal-subtitle">{t("achievements.manualLink.subtitle")}</p>
          </div>
          <button
            className="modal-close ach-modal-close"
            aria-label={t("common.close")}
            onClick={onClose}
            disabled={linking}
          >
            ×
          </button>
        </div>

        <div className="modal-body ach-modal-body">
          <div className="ach-modal-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" aria-hidden>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              className="ach-modal-search-input"
              placeholder={t("achievements.manualLink.searchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
              disabled={searching}
            />
            <Button
              variant="primary"
              size="sm"
              onClick={handleSearch}
              isLoading={searching}
              disabled={query.trim().length < 2}
            >
              {t("common.search")}
            </Button>
          </div>

          {!searched && !searching && (
            <p className="ach-modal-hint">{t("achievements.manualLink.searchHint")}</p>
          )}

          {searchError && (
            <p className="ach-modal-error">
              {t("achievements.manualLink.searchFailed", { error: searchError })}
            </p>
          )}

          {searched && !searchError && results.length === 0 && !searching && (
            <p className="ach-modal-empty">{t("achievements.manualLink.noResults", { query })}</p>
          )}

          {results.length > 0 && (
            <ul className="ach-modal-results">
              {results.map((r) => (
                <li key={r.appid} className="ach-modal-result">
                  <div className="ach-modal-result-text">
                    <span className="ach-modal-result-name">{r.name}</span>
                    <span className="ach-modal-result-id">AppID {r.appid}</span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleLink(r)}
                    isLoading={linking}
                    disabled={linking}
                  >
                    {t("achievements.manualLink.link")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="modal-footer">
          <span className="modal-footer-count">&nbsp;</span>
          <div className="modal-footer-actions">
            <Button variant="ghost" onClick={onClose} disabled={linking}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
