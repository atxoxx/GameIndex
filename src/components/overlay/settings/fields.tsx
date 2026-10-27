import type { CSSProperties, ReactNode } from "react";

/**
 * Chrome-agnostic overlay-settings field primitives.
 *
 * The in-overlay settings widget and Settings → Overlay render the same
 * controls with different chrome (`.overlay-*` vs `.hw-*` / `.settings-*`).
 * These primitives own the field *logic*, while each surface passes the class
 * names that reproduce its own markup — so a setting is written once and both
 * surfaces stay in sync instead of drifting.
 */

export interface OverlayFieldToggleProps {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
  labelClassName?: string;
  style?: CSSProperties;
  disabled?: boolean;
}

/** A checkbox wrapped in a `<label>`, matching the `.overlay-toggle-item` shape. */
export function OverlayFieldToggle({
  label,
  checked,
  onChange,
  className,
  labelClassName,
  style,
  disabled,
}: OverlayFieldToggleProps) {
  return (
    <label className={className} style={style}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={labelClassName}>{label}</span>
    </label>
  );
}

export interface OverlayFieldSliderProps {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  display: ReactNode;
  onChange: (value: number) => void;
  className?: string;
  infoClassName?: string;
  labelClassName?: string;
  valueClassName?: string;
  inputClassName?: string;
  /** Render the label as a `<label>` (hw cards) instead of a `<span>` (overlay rows). */
  labelAs?: "span" | "label";
  /** Helper node rendered between the label row and the range input (hw help text). */
  help?: ReactNode;
  style?: CSSProperties;
  ariaLabel?: string;
}

/**
 * A label/value row above a range input. Both surfaces render the same
 * "label … value" head and then the slider; only the class names differ.
 */
export function OverlayFieldSlider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
  className,
  infoClassName,
  labelClassName,
  valueClassName,
  inputClassName,
  labelAs = "span",
  help,
  style,
  ariaLabel,
}: OverlayFieldSliderProps) {
  return (
    <div className={className} style={style}>
      <div className={infoClassName}>
        {labelAs === "label" ? (
          <label className={labelClassName}>{label}</label>
        ) : (
          <span className={labelClassName}>{label}</span>
        )}
        <span className={valueClassName}>{display}</span>
      </div>
      {help}
      <input
        type="range"
        className={inputClassName}
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

export interface OverlayChipOption<T extends string | number = string> {
  id: T;
  /** Plain label. Wrapped in a `<span>` when `labelWrap` is set. */
  label?: ReactNode;
  title?: string;
  /** Custom button content (icons, dots, …); takes precedence over `label`. */
  content?: ReactNode;
}

export interface OverlayFieldChipsProps<T extends string | number = string> {
  options: ReadonlyArray<OverlayChipOption<T>>;
  /** Selected id for a single-select group. */
  value?: T;
  /** Active predicate for multi-select groups (overrides `value`). */
  isActive?: (id: T) => boolean;
  onChange: (value: T) => void;
  className?: string;
  chipClassName?: string;
  activeClassName?: string;
  role?: string;
  ariaLabel?: string;
  /** Wrap each `label` in a `<span>` (widget chrome does; hw segmented controls don't). */
  labelWrap?: boolean;
  style?: CSSProperties;
}

/** A row of toggle chips; the selected chip gets the `active` class. */
export function OverlayFieldChips<T extends string | number = string>({
  options,
  value,
  isActive,
  onChange,
  className,
  chipClassName,
  activeClassName = "active",
  role,
  ariaLabel,
  labelWrap = false,
  style,
}: OverlayFieldChipsProps<T>) {
  return (
    <div className={className} role={role} aria-label={ariaLabel} style={style}>
      {options.map((option) => {
        const active = isActive
          ? isActive(option.id)
          : option.id === value;
        const chipClass = active
          ? chipClassName
            ? `${chipClassName} ${activeClassName}`
            : activeClassName
          : chipClassName;
        return (
          <button
            key={option.id}
            type="button"
            className={chipClass}
            title={option.title}
            aria-pressed={active}
            onClick={() => onChange(option.id)}
          >
            {option.content ??
              (labelWrap ? <span>{option.label}</span> : option.label)}
          </button>
        );
      })}
    </div>
  );
}
