import type { CSSProperties, ReactNode } from "react";
import { useSettingsUi } from "./SettingsUiContext";

interface SettingsSectionProps {
  /** Leading icon rendered inside the accent-tinted square. */
  icon: ReactNode;
  /** Section title. */
  title: ReactNode;
  /** Supporting description under the title. */
  desc?: ReactNode;
  /** Optional anchor id for deep links and the jump list. */
  id?: string;
  /** Extra class names (e.g. `settings-section hw`). */
  className?: string;
  /** Inline style passthrough (only for one-off layout tweaks). */
  style?: CSSProperties;
  /** Optional trailing control(s) at the end of the header row. */
  actions?: ReactNode;
  /** Expert-only section: hidden while the rail's Essentials filter is on. */
  advanced?: boolean;
  children: ReactNode;
}

/**
 * SettingsSection — the canonical section block used by every settings tab.
 *
 * It owns the section chrome (icon tile, title, description, hairline header)
 * once, so tabs stop hand-rolling headers. It also honours the Essentials
 * filter: a section marked `advanced` removes itself when the user is in
 * "essentials" mode, which keeps the first-run experience to a handful of
 * meaningful choices while the full set stays one toggle away.
 */
export default function SettingsSection({
  icon,
  title,
  desc,
  id,
  className,
  style,
  actions,
  advanced,
  children,
}: SettingsSectionProps) {
  const { showAdvanced } = useSettingsUi();
  if (advanced && !showAdvanced) return null;

  return (
    <section
      className={`settings-section${className ? ` ${className}` : ""}${
        advanced ? " settings-section--advanced" : ""
      }`}
      id={id}
      style={style}
    >
      <header className="settings-section-header">
        <span className="settings-section-icon" aria-hidden>
          {icon}
        </span>
        <div className="settings-section-header-text">
          <h2 className="settings-section-title">{title}</h2>
          {desc && <p className="settings-section-desc">{desc}</p>}
        </div>
        {actions && <div className="settings-section-actions">{actions}</div>}
      </header>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}
