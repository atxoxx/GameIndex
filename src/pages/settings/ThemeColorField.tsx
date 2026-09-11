import { useEffect, useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { QUICK_COLOR_SWATCHES, normalizeHexInput } from "../../utils/customTheme";

interface ThemeColorFieldProps {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}

export default function ThemeColorField({ label, value, onChange }: ThemeColorFieldProps) {
  const { t } = useLanguage();
  const [text, setText] = useState(value);
  const [swatchesOpen, setSwatchesOpen] = useState(false);

  useEffect(() => {
    setText(value);
  }, [value]);

  function commit(raw: string) {
    const hex = normalizeHexInput(raw);
    if (hex) onChange(hex);
    else setText(value);
  }

  return (
    <div className="theme-color-field">
      <div className="theme-color-field__head">
        <span className="theme-color-field__picker">
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={label}
          />
        </span>
        <div className="theme-color-field__meta">
          <span className="theme-color-field__label">{label}</span>
          <input
            className="theme-color-field__hex"
            value={text}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setText(e.target.value)}
            onBlur={() => commit(text)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit(text);
              }
            }}
            aria-label={t("settings.themeCreator.hexInputAria", { name: label })}
          />
        </div>
        <button
          type="button"
          className={`theme-color-field__more${swatchesOpen ? " is-open" : ""}`}
          aria-expanded={swatchesOpen}
          aria-label={t("settings.themeCreator.presets")}
          title={t("settings.themeCreator.presets")}
          onClick={() => setSwatchesOpen((open) => !open)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </button>
      </div>

      {swatchesOpen && (
        <div className="theme-color-field__swatches">
          {QUICK_COLOR_SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              className={`theme-color-field__swatch${
                value.toLowerCase() === color ? " is-active" : ""
              }`}
              style={{ backgroundColor: color }}
              aria-label={color}
              title={color}
              onClick={() => {
                onChange(color);
                setSwatchesOpen(false);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
