import { useEffect, useRef, useState } from "react";
import {
  Bookmark,
  Check,
  ChevronDown,
  Download,
  Flame,
  Gamepad2,
  type LucideIcon,
  Plus,
  Sliders,
  Sparkles,
  Trash2,
  Tv,
  Upload,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { useToast } from "../../../context/ToastContext";
import {
  BUILTIN_PRESETS,
  deleteCustomPreset,
  exportLayoutToJson,
  importLayoutFromJson,
  loadCustomPresets,
  saveCustomPreset,
} from "./layoutPresets";
import type { LayoutPreset, LayoutSnapshot } from "./types";

interface StudioPresetsBarProps {
  currentSnapshot: LayoutSnapshot;
  onApplyPreset: (preset: LayoutPreset) => void;
  onImportSnapshot: (snapshot: Partial<LayoutSnapshot>) => void;
}

export function StudioPresetsBar({
  currentSnapshot,
  onApplyPreset,
  onImportSnapshot,
}: StudioPresetsBarProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();

  const [customPresets, setCustomPresets] = useState<LayoutPreset[]>(() =>
    loadCustomPresets(),
  );
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [showImportModal, setShowImportModal] = useState(false);
  const [importJsonText, setImportJsonText] = useState("");
  const [copied, setCopied] = useState(false);

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [SelectedIcon, setSelectedIcon] = useState<LucideIcon | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDropdownOpen]);

  const getPresetIcon = (id: string) => {
    switch (id) {
      case "balanced":
        return Sparkles;
      case "minimal":
        return Sliders;
      case "deck":
        return Gamepad2;
      case "power":
        return Flame;
      case "streamer":
        return Tv;
      default:
        return Bookmark;
    }
  };

  const handleSave = () => {
    if (!saveName.trim()) return;
    const created = saveCustomPreset(saveName, currentSnapshot);
    setCustomPresets(loadCustomPresets());
    setSaveName("");
    setShowSaveModal(false);
    setActivePresetId(created.id);
    setSelectedLabel(created.customName || created.id);
    setSelectedIcon(() => Bookmark);
    showToast(t("settings.interface.presetSavedToast", { name: created.customName }), "success");
  };

  const handleDeleteCustom = (id: string, name: string) => {
    deleteCustomPreset(id);
    setCustomPresets(loadCustomPresets());
    if (activePresetId === id) {
      setActivePresetId(null);
      setSelectedLabel(null);
      setSelectedIcon(null);
    }
    showToast(t("settings.interface.presetDeletedToast", { name }), "info");
  };

  const handleExport = async () => {
    const json = exportLayoutToJson(currentSnapshot);
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      showToast(t("settings.interface.exportCopiedToast"), "success");
    } catch {
      showToast(t("settings.interface.exportFailedToast"), "error");
    }
  };

  const handleImportApply = () => {
    if (!importJsonText.trim()) return;
    const parsed = importLayoutFromJson(importJsonText);
    if (!parsed) {
      showToast(t("settings.interface.importInvalidToast"), "error");
      return;
    }
    onImportSnapshot(parsed);
    setShowImportModal(false);
    setImportJsonText("");
    setActivePresetId(null);
    setSelectedLabel(null);
    setSelectedIcon(null);
    showToast(t("settings.interface.importSuccessToast"), "success");
  };

  return (
    <div className="studio-presets-bar">
      <div className="studio-presets-bar__label">
        <Sparkles size={14} className="studio-presets-bar__icon" aria-hidden="true" />
        <span>{t("settings.interface.presetsTitle")}</span>
      </div>

      <div className="studio-presets-dropdown" ref={dropdownRef}>
        <button
          type="button"
          className={`studio-presets-dropdown__trigger${isDropdownOpen ? " is-open" : ""}`}
          onClick={() => setIsDropdownOpen((prev) => !prev)}
          aria-expanded={isDropdownOpen}
          aria-haspopup="listbox"
        >
          {SelectedIcon ? (
            <SelectedIcon size={13} className="studio-presets-dropdown__trigger-icon" aria-hidden="true" />
          ) : (
            <Sparkles size={13} className="studio-presets-dropdown__trigger-icon" aria-hidden="true" />
          )}
          <span className="studio-presets-dropdown__trigger-text">
            {selectedLabel || t("settings.interface.presetsSelect")}
          </span>
          <ChevronDown
            size={13}
            className={`studio-presets-dropdown__chevron${isDropdownOpen ? " is-open" : ""}`}
            aria-hidden="true"
          />
        </button>

        {isDropdownOpen && (
          <div className="studio-presets-dropdown__menu" role="listbox">
            <div className="studio-presets-dropdown__group">
              <span className="studio-presets-dropdown__group-title">
                {t("settings.interface.presetsBuiltin")}
              </span>
              {BUILTIN_PRESETS.map((preset) => {
                const Icon = getPresetIcon(preset.id);
                const isSelected = activePresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`studio-presets-dropdown__item${isSelected ? " is-selected" : ""}`}
                    onClick={() => {
                      onApplyPreset(preset);
                      setActivePresetId(preset.id);
                      setSelectedLabel(t(preset.nameKey));
                      setSelectedIcon(() => Icon);
                      setIsDropdownOpen(false);
                    }}
                  >
                    <Icon size={14} className="studio-presets-dropdown__item-icon" aria-hidden="true" />
                    <div className="studio-presets-dropdown__item-text">
                      <span className="studio-presets-dropdown__item-name">{t(preset.nameKey)}</span>
                      <span className="studio-presets-dropdown__item-desc">{t(preset.descKey)}</span>
                    </div>
                    {isSelected && (
                      <Check size={13} className="studio-presets-dropdown__check" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>

            {customPresets.length > 0 && (
              <div className="studio-presets-dropdown__group">
                <div className="studio-presets-dropdown__divider" />
                <span className="studio-presets-dropdown__group-title">
                  {t("settings.interface.presetsCustom")}
                </span>
                {customPresets.map((preset) => {
                  const isSelected = activePresetId === preset.id;
                  return (
                    <div
                      key={preset.id}
                      className={`studio-presets-dropdown__item studio-presets-dropdown__item--custom${
                        isSelected ? " is-selected" : ""
                      }`}
                      onClick={() => {
                        onApplyPreset(preset);
                        setActivePresetId(preset.id);
                        setSelectedLabel(preset.customName || preset.id);
                        setSelectedIcon(() => Bookmark);
                        setIsDropdownOpen(false);
                      }}
                      role="option"
                      aria-selected={isSelected}
                    >
                      <Bookmark
                        size={14}
                        className="studio-presets-dropdown__item-icon"
                        aria-hidden="true"
                      />
                      <span className="studio-presets-dropdown__item-name">
                        {preset.customName || preset.id}
                      </span>
                      {isSelected && (
                        <Check size={13} className="studio-presets-dropdown__check" aria-hidden="true" />
                      )}
                      <button
                        type="button"
                        className="studio-presets-dropdown__delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteCustom(preset.id, preset.customName || "");
                        }}
                        title={t("settings.interface.deletePreset")}
                        aria-label={t("settings.interface.deletePreset")}
                      >
                        <Trash2 size={12} aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="studio-presets-bar__actions">
        <button
          type="button"
          className="studio-presets-bar__action-btn"
          onClick={() => setShowSaveModal(true)}
          title={t("settings.interface.saveCustomPreset")}
        >
          <Plus size={13} aria-hidden="true" />
          <span>{t("settings.interface.savePresetBtn")}</span>
        </button>

        <button
          type="button"
          className="studio-presets-bar__action-btn"
          onClick={handleExport}
          title={t("settings.interface.exportPresetTooltip")}
        >
          {copied ? (
            <Check size={13} className="studio-icon-success" aria-hidden="true" />
          ) : (
            <Download size={13} aria-hidden="true" />
          )}
          <span>{copied ? t("settings.interface.copied") : t("settings.interface.exportBtn")}</span>
        </button>

        <button
          type="button"
          className="studio-presets-bar__action-btn"
          onClick={() => setShowImportModal(true)}
          title={t("settings.interface.importPresetTooltip")}
        >
          <Upload size={13} aria-hidden="true" />
          <span>{t("settings.interface.importBtn")}</span>
        </button>
      </div>

      {/* Save Preset Modal */}
      {showSaveModal && (
        <div className="studio-modal-backdrop" onClick={() => setShowSaveModal(false)}>
          <div className="studio-modal" onClick={(e) => e.stopPropagation()}>
            <h4 className="studio-modal__title">{t("settings.interface.savePresetModalTitle")}</h4>
            <p className="studio-modal__desc">{t("settings.interface.savePresetModalDesc")}</p>
            <input
              type="text"
              className="studio-modal__input"
              placeholder={t("settings.interface.savePresetPlaceholder")}
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") setShowSaveModal(false);
              }}
            />
            <div className="studio-modal__actions">
              <button
                type="button"
                className="studio-modal__btn studio-modal__btn--ghost"
                onClick={() => setShowSaveModal(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="studio-modal__btn studio-modal__btn--primary"
                onClick={handleSave}
                disabled={!saveName.trim()}
              >
                {t("settings.interface.savePresetConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Preset Modal */}
      {showImportModal && (
        <div className="studio-modal-backdrop" onClick={() => setShowImportModal(false)}>
          <div className="studio-modal studio-modal--wide" onClick={(e) => e.stopPropagation()}>
            <h4 className="studio-modal__title">{t("settings.interface.importModalTitle")}</h4>
            <p className="studio-modal__desc">{t("settings.interface.importModalDesc")}</p>
            <textarea
              className="studio-modal__textarea"
              placeholder='{ "layout": { ... } }'
              value={importJsonText}
              onChange={(e) => setImportJsonText(e.target.value)}
              rows={8}
              autoFocus
            />
            <div className="studio-modal__actions">
              <button
                type="button"
                className="studio-modal__btn studio-modal__btn--ghost"
                onClick={() => setShowImportModal(false)}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="studio-modal__btn studio-modal__btn--primary"
                onClick={handleImportApply}
                disabled={!importJsonText.trim()}
              >
                {t("settings.interface.importApplyBtn")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
