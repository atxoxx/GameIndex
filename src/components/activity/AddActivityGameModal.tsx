import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Game, GameMetadataResult } from "../../types/game";
import { useGames } from "../../context/GameContext";
import { useActivity } from "../../context/ActivityContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { fetchAllImages } from "../../context/game/useEnrich";
import { calculateNewGamePlaytime } from "./activityLinkUtils";
import * as Icons from "./Icons";

export interface AddActivityGameModalProps {
  isOpen: boolean;
  onClose: () => void;
  unlinkedGameId: string;
  unlinkedGameTitle: string;
  onAdded?: (newGame: Game) => void;
}

export function AddActivityGameModal({
  isOpen,
  onClose,
  unlinkedGameId,
  unlinkedGameTitle,
  onAdded,
}: AddActivityGameModalProps) {
  const { t } = useLanguage();
  const { addGame } = useGames();
  const { sessions, relinkSessionsForGame } = useActivity();
  const { showToast } = useToast();

  const [title, setTitle] = useState(unlinkedGameTitle);
  const [exePath, setExePath] = useState("");
  const [searching, setSearching] = useState(false);
  const [metadataResults, setMetadataResults] = useState<GameMetadataResult[]>([]);
  const [selectedMetadata, setSelectedMetadata] = useState<GameMetadataResult | null>(null);
  const [saving, setSaving] = useState(false);

  const searchMetadata = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    try {
      const results = await invoke<GameMetadataResult[]>("search_game_metadata", {
        gameName: q,
      });
      setMetadataResults(results || []);
      if (results && results.length > 0) {
        setSelectedMetadata(results[0]);
      } else {
        setSelectedMetadata(null);
      }
    } catch (err) {
      console.error("Failed to search metadata:", err);
      setMetadataResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  // Auto-search on initial open
  useEffect(() => {
    if (isOpen && unlinkedGameTitle) {
      setTitle(unlinkedGameTitle);
      setExePath("");
      setSelectedMetadata(null);
      void searchMetadata(unlinkedGameTitle);
    }
  }, [isOpen, unlinkedGameTitle, searchMetadata]);

  if (!isOpen) return null;

  const handleBrowseExe = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: t("activityAdd.selectExe"),
        filters: [{ name: "Executable", extensions: ["exe"] }],
      });
      if (selected && typeof selected === "string") {
        setExePath(selected);
      }
    } catch (err) {
      console.error("Failed to select exe:", err);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalTitle = title.trim();
    if (!finalTitle) return;

    setSaving(true);
    try {
      // Calculate recorded activity stats from unlinked sessions
      const unlinkedSessions = sessions.filter((s) => s.gameId === unlinkedGameId);
      const { playTime, lastPlayed } = calculateNewGamePlaytime(unlinkedSessions);

      // Fetch and download artwork to local cache / base64
      const images = selectedMetadata?.images || {};
      const imageData = await fetchAllImages(images);

      const newId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const newGame: Game = {
        id: newId,
        name: finalTitle,
        path: exePath.trim(),
        platform: "Local",
        installed: Boolean(exePath.trim()),
        playTime,
        lastPlayed,
        addedAt: Date.now(),
        coverArtUrl: imageData.coverArtUrl,
        coverSourceUrl: imageData.coverSourceUrl,
        bannerUrl: imageData.bannerUrl,
        logoUrl: imageData.logoUrl,
        description: selectedMetadata?.description ?? undefined,
        developer: selectedMetadata?.developer ?? undefined,
        publisher: selectedMetadata?.publisher ?? undefined,
        releaseDate: selectedMetadata?.releaseDate ?? undefined,
        genres:
          selectedMetadata?.genres && selectedMetadata.genres.length > 0
            ? selectedMetadata.genres
            : undefined,
        storyline: selectedMetadata?.storyline,
        igdbRating: selectedMetadata?.igdbRating ?? undefined,
        criticRating: selectedMetadata?.criticRating ?? undefined,
      };

      // Add to GameContext (persists to DB)
      addGame(newGame);

      // Re-link existing activity sessions to the new game
      await relinkSessionsForGame(unlinkedGameId, newGame.id, newGame.name);

      showToast(t("activityAdd.success", { name: newGame.name }), "success");
      onAdded?.(newGame);
      onClose();
    } catch (err) {
      console.error("Failed to add activity game to library:", err);
      showToast(t("activityAdd.error"), "error");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="act-modal-backdrop" onClick={onClose}>
      <div
        className="act-modal act-add-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="act-add-modal-title"
      >
        <div className="act-modal__header">
          <div className="act-add-modal__header-info">
            <h3 id="act-add-modal-title" className="act-modal__title">
              <Icons.Plus size={16} /> {t("activityAdd.modalTitle")}
            </h3>
            <p className="act-add-modal__desc">
              {t("activityAdd.modalDesc", { name: unlinkedGameTitle })}
            </p>
          </div>
          <button
            type="button"
            className="act-modal__close-btn"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <Icons.X size={16} />
          </button>
        </div>

        <form onSubmit={handleSave} className="act-add-modal__form">
          {/* Title and Search */}
          <div className="act-form-group">
            <label className="act-form-label">{t("activityAdd.gameNameLabel")}</label>
            <div className="act-add-modal__search-row">
              <input
                type="text"
                className="act-form-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("activityAdd.gameNamePlaceholder")}
                required
              />
              <button
                type="button"
                className="act-inspector-btn act-inspector-btn--secondary"
                onClick={() => searchMetadata(title)}
                disabled={searching || !title.trim()}
              >
                <Icons.Search size={13} /> {searching ? t("activityAdd.searching") : t("activityAdd.searchMetadata")}
              </button>
            </div>
          </div>

          {/* Metadata Results Selector */}
          {metadataResults.length > 0 && (
            <div className="act-form-group">
              <label className="act-form-label">
                {t("activityAdd.matchedMetadata")} ({metadataResults.length})
              </label>
              <div className="act-add-modal__results-list">
                {metadataResults.map((meta, idx) => {
                  const isSelected = selectedMetadata === meta;
                  const cover = meta.images.cover;
                  return (
                    <div
                      key={meta.title + idx}
                      className={`act-add-modal__result-card ${
                        isSelected ? "act-add-modal__result-card--selected" : ""
                      }`}
                      onClick={() => setSelectedMetadata(meta)}
                    >
                      {cover ? (
                        <img
                          src={cover}
                          alt={meta.title}
                          className="act-add-modal__result-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="act-add-modal__result-placeholder">
                          {meta.title.slice(0, 1)}
                        </div>
                      )}
                      <div className="act-add-modal__result-info">
                        <span className="act-add-modal__result-title">{meta.title}</span>
                        {meta.releaseDate && (
                          <span className="act-add-modal__result-year">
                            {meta.releaseDate.slice(0, 4)}
                          </span>
                        )}
                        {meta.developer && (
                          <span className="act-add-modal__result-dev">{meta.developer}</span>
                        )}
                      </div>
                      {isSelected && (
                        <span className="act-add-modal__result-badge">
                          <Icons.Check size={12} />
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {searching && (
            <div className="act-add-modal__loading">
              <Icons.History size={16} className="act-spin" />
              <span>{t("activityAdd.searching")}...</span>
            </div>
          )}

          {/* Executable Path (Optional) */}
          <div className="act-form-group">
            <label className="act-form-label">
              {t("activityAdd.exeLabel")}{" "}
              <span className="act-form-label-optional">({t("activityAdd.exeOptional")})</span>
            </label>
            <div className="act-add-modal__exe-row">
              <input
                type="text"
                className="act-form-input"
                placeholder={t("activityAdd.exePlaceholder")}
                value={exePath}
                onChange={(e) => setExePath(e.target.value)}
              />
              <button
                type="button"
                className="act-inspector-btn act-inspector-btn--secondary"
                onClick={handleBrowseExe}
              >
                <Icons.Folder size={13} /> {t("activityAdd.browseExe")}
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="act-modal__actions">
            <button
              type="button"
              className="act-inspector-btn act-inspector-btn--ghost"
              onClick={onClose}
              disabled={saving}
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              className="act-inspector-btn act-inspector-btn--primary"
              disabled={saving || !title.trim()}
            >
              <Icons.Plus size={13} />{" "}
              {saving ? t("common.saving") : t("activityAdd.submitBtn")}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
