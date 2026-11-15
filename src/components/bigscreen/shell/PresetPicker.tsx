// Layout preset picker.
//
// Used by the System hub, Quick Settings and the Appearance settings.
// Cards carry a real schematic preview of each layout plus its name and
// one-line description, so the five interfaces are recognisable before
// applying them.

import { useLanguage } from "../../../context/LanguageContext";
import { PRESETS, type BigScreenPresetId } from "../../../bigscreen/presets";
import { useFocusable } from "../../../hooks/useFocusable";
import LayoutPreview from "./LayoutPreview";
import "../../../styles/bigscreen/picker.css";

function PresetCard({
  presetId,
  onSelect,
  selected,
}: {
  presetId: BigScreenPresetId;
  onSelect: () => void;
  selected: boolean;
}) {
  const { t } = useLanguage();
  const preset = PRESETS.find((entry) => entry.id === presetId)!;
  const props = useFocusable(onSelect);

  return (
    <button
      {...props}
      type="button"
      className="bs-preset"
      data-selected={selected ? "true" : undefined}
      data-preset-preview={preset.id}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <LayoutPreview id={preset.id} />
      <span className="bs-preset-copy">
        <span className="bs-preset-name">
          {t(preset.labelKey)}
          {selected ? <span className="bs-preset-check" aria-hidden="true">✓</span> : null}
        </span>
        <span className="bs-preset-blurb">{t(preset.blurbKey)}</span>
      </span>
    </button>
  );
}

export default function PresetPicker({
  value,
  onChange,
}: {
  value: BigScreenPresetId;
  onChange: (preset: BigScreenPresetId) => void;
}) {
  return (
    <div className="bs-preset-grid" role="group">
      {PRESETS.map((preset) => (
        <PresetCard
          key={preset.id}
          presetId={preset.id}
          selected={preset.id === value}
          onSelect={() => onChange(preset.id)}
        />
      ))}
    </div>
  );
}
