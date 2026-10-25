// Layout preset picker.
//
// The thumbnails are drawn from the preset's own traits (nav paradigm,
// home composition, card shape) instead of shipping screenshots, so a
// new preset needs no image assets and always mirrors what the CSS
// actually does.

import { useLanguage } from "../../../context/LanguageContext";
import { PRESETS, type BigScreenPresetId } from "../../../bigscreen/presets";
import { useFocusable } from "../../../hooks/useFocusable";
import "../../../styles/bigscreen/picker.css";

interface PresetThumbProps {
  presetId: BigScreenPresetId;
  onSelect: () => void;
  selected: boolean;
}

function PresetThumb({ presetId, onSelect, selected }: PresetThumbProps) {
  const { t } = useLanguage();
  const preset = PRESETS.find((entry) => entry.id === presetId)!;

  return (
    <button
      {...useFocusable(onSelect)}
      type="button"
      className="bs-preset"
      data-selected={selected ? "true" : undefined}
      data-preset-preview={preset.id}
      data-nav={preset.nav}
      data-home={preset.home}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="bs-preset-thumb" aria-hidden="true">
        <span className="bs-preset-thumb-nav">
          <i /><i /><i /><i />
        </span>
        <span className="bs-preset-thumb-body">
          <span className="bs-preset-thumb-hero" />
          <span className="bs-preset-thumb-cards">
            <i /><i /><i /><i />
          </span>
        </span>
      </span>
      <span className="bs-preset-copy">
        <span className="bs-preset-name">{t(preset.labelKey)}</span>
        <span className="bs-preset-blurb">{t(preset.blurbKey)}</span>
      </span>
    </button>
  );
}

interface PresetPickerProps {
  value: BigScreenPresetId;
  onChange: (preset: BigScreenPresetId) => void;
}

export default function PresetPicker({ value, onChange }: PresetPickerProps) {
  return (
    <div className="bs-preset-grid" role="group">
      {PRESETS.map((preset) => (
        <PresetThumb
          key={preset.id}
          presetId={preset.id}
          selected={preset.id === value}
          onSelect={() => onChange(preset.id)}
        />
      ))}
    </div>
  );
}
