import type { ReactNode } from "react";

interface SettingsToggleCardProps {
  /** Bold title line. */
  title: ReactNode;
  /** Muted helper description under the title. */
  desc?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  /** Yellow warning variant (e.g. the UAC bypass toggle). */
  warn?: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * SettingsToggleCard — the two-line checkbox card used across the
 * Launcher and Data & sync tabs. Renders a bold title above a muted
 * helper description with a square checkbox, so every toggle reads as
 * a real option instead of a bare tick. `warn` tints the card border
 * amber to flag destructive/sensitive options.
 */
export default function SettingsToggleCard({
  title,
  desc,
  checked,
  disabled,
  warn,
  onChange,
}: SettingsToggleCardProps) {
  return (
    <div
      className={`settings-launcher-card${warn ? " settings-launcher-card--warn" : ""}`}
    >
      <label className="settings-checkbox-label">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div className="settings-checkbox-text">
          <span className="settings-checkbox-title">{title}</span>
          {desc && <span className="settings-checkbox-desc">{desc}</span>}
        </div>
      </label>
    </div>
  );
}
