import { useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import type { FilterPreset } from "./useFilterPresets";

/**
 * Chip row for saving / applying / deleting named filter presets.
 */
export function FilterPresetBar({
  presets,
  activeId,
  canSave,
  onApply,
  onSave,
  onDelete,
}: {
  presets: FilterPreset[];
  activeId: string | null;
  canSave: boolean;
  onApply: (preset: FilterPreset) => void;
  onSave: (name: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useLanguage();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const commit = () => {
    if (!name.trim()) return;
    onSave(name.trim());
    setName("");
    setNaming(false);
  };

  return (
    <div className="dl-preset-bar">
      <span className="dl-preset-bar-label">{t("downloadModal.presets")}</span>

      <div className="dl-preset-chips">
        {presets.length === 0 && !naming && (
          <span className="dl-preset-empty">{t("downloadModal.presetSave")}</span>
        )}
        {presets.map((preset) => (
          <span
            key={preset.id}
            className={`dl-preset-chip${activeId === preset.id ? " is-active" : ""}`}
          >
            <button
              type="button"
              className="dl-preset-chip-apply"
              onClick={() => onApply(preset)}
              title={preset.name}
            >
              {preset.name}
            </button>
            <button
              type="button"
              className="dl-preset-chip-delete"
              onClick={() => onDelete(preset.id)}
              aria-label={t("downloadModal.presetDelete")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </span>
        ))}

        {naming ? (
          <span className="dl-preset-naming">
            <input
              className="dl-preset-name-input"
              value={name}
              placeholder={t("downloadModal.presetNamePlaceholder")}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setNaming(false);
                  setName("");
                }
              }}
            />
            <button type="button" className="dl-preset-save-btn" onClick={commit}>
              {t("common.save")}
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="dl-preset-add-btn"
            onClick={() => setNaming(true)}
            disabled={!canSave}
            title={t("downloadModal.presetSave")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>{t("downloadModal.presetSave")}</span>
          </button>
        )}
      </div>
    </div>
  );
}
