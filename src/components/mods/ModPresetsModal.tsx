import { useState, useEffect } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { useToast } from "../../context/ToastContext";
import { Button } from "../ui";
import type { Game } from "../../types/game";
import type { GameMod } from "../../types/mods";

export interface ModPreset {
  id: string;
  name: string;
  createdAt: number;
  gameId: string;
  modStates: Record<string, boolean>;
  order?: string[];
}

interface ModPresetsModalProps {
  game: Game;
  mods: GameMod[];
  isOpen: boolean;
  onClose: () => void;
  onApplyPreset: (preset: ModPreset) => Promise<void>;
}

export function getGamePresets(gameId: string): ModPreset[] {
  try {
    const raw = localStorage.getItem(`gamelib_mods_presets_${gameId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveGamePresets(gameId: string, presets: ModPreset[]) {
  try {
    localStorage.setItem(`gamelib_mods_presets_${gameId}`, JSON.stringify(presets));
  } catch {
    // ignore
  }
}

export default function ModPresetsModal({
  game,
  mods,
  isOpen,
  onClose,
  onApplyPreset,
}: ModPresetsModalProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [presets, setPresets] = useState<ModPreset[]>([]);
  const [nameInput, setNameInput] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPresets(getGamePresets(game.id));
      setNameInput("");
    }
  }, [isOpen, game.id]);

  if (!isOpen) return null;

  const handleSaveCurrent = () => {
    const name = nameInput.trim();
    if (!name) return;

    const modStates: Record<string, boolean> = {};
    for (const m of mods) {
      modStates[m.id] = m.enabled;
    }
    const order = mods.map((m) => m.id);

    const newPreset: ModPreset = {
      id: `preset_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      createdAt: Date.now(),
      gameId: game.id,
      modStates,
      order,
    };

    const next = [...presets.filter((p) => p.name.toLowerCase() !== name.toLowerCase()), newPreset];
    saveGamePresets(game.id, next);
    setPresets(next);
    setNameInput("");
    showToast(t("mods.presets.saved", { name }), "success");
  };

  const handleApply = async (preset: ModPreset) => {
    setBusy(true);
    try {
      await onApplyPreset(preset);
      showToast(t("mods.presets.applied", { name: preset.name }), "success");
      onClose();
    } catch (e) {
      showToast(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = (preset: ModPreset) => {
    const next = presets.filter((p) => p.id !== preset.id);
    saveGamePresets(game.id, next);
    setPresets(next);
    showToast(t("mods.presets.deleted", { name: preset.name }), "info");
  };

  const handleExport = (preset: ModPreset) => {
    navigator.clipboard
      .writeText(JSON.stringify(preset, null, 2))
      .then(() => showToast(t("mods.export.copied"), "info"))
      .catch(() => showToast(t("mods.copyFailed"), "error"));
  };

  const handleImport = () => {
    const input = prompt(t("mods.presets.namePlaceholder"));
    if (!input) return;
    try {
      const parsed = JSON.parse(input) as ModPreset;
      if (parsed.name && parsed.modStates) {
        const imported: ModPreset = {
          ...parsed,
          id: `preset_${Date.now()}`,
          gameId: game.id,
        };
        const next = [...presets, imported];
        saveGamePresets(game.id, next);
        setPresets(next);
        showToast(t("mods.presets.imported"), "success");
      }
    } catch {
      showToast(t("mods.installFailed", { error: "Invalid JSON" }), "error");
    }
  };

  return (
    <div className="mods-modal-backdrop" onClick={onClose}>
      <div
        className="mods-modal-card"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mods-presets-title"
      >
        <div className="mods-modal-header">
          <div>
            <h3 id="mods-presets-title">{t("mods.presets.title")}</h3>
            <p className="mods-modal-subtitle">{t("mods.presets.subtitle")}</p>
          </div>
          <button type="button" className="mods-modal-close" onClick={onClose} aria-label={t("common.close")}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Save Current Section */}
        <div className="mods-presets-save-box">
          <label htmlFor="preset-name-input" className="mods-presets-label">
            {t("mods.presets.saveCurrent")}
          </label>
          <div className="mods-presets-input-row">
            <input
              id="preset-name-input"
              type="text"
              className="mods-presets-input"
              placeholder={t("mods.presets.namePlaceholder")}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveCurrent();
              }}
            />
            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveCurrent}
              disabled={!nameInput.trim()}
            >
              {t("mods.presets.save")}
            </Button>
          </div>
        </div>

        {/* Presets List */}
        <div className="mods-presets-list-wrap">
          <div className="mods-presets-list-header">
            <span>{t("mods.presets")} ({presets.length})</span>
            <Button variant="ghost" size="sm" onClick={handleImport}>
              {t("mods.presets.import")}
            </Button>
          </div>

          {presets.length === 0 ? (
            <div className="mods-presets-empty">{t("mods.presets.noPresets")}</div>
          ) : (
            <div className="mods-presets-list">
              {presets.map((p) => {
                const activeCount = Object.values(p.modStates).filter(Boolean).length;
                return (
                  <div key={p.id} className="mods-preset-item">
                    <div className="mods-preset-info">
                      <span className="mods-preset-name">{p.name}</span>
                      <span className="mods-preset-meta">
                        {t("mods.enabledCount", {
                          enabled: String(activeCount),
                          total: String(Object.keys(p.modStates).length),
                        })} · {new Date(p.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="mods-preset-actions">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleApply(p)}
                        isLoading={busy}
                      >
                        {t("mods.presets.apply")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleExport(p)}
                        title={t("mods.presets.export")}
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleDelete(p)}
                        title={t("mods.presets.delete")}
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
