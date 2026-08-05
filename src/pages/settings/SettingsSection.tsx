import type { CSSProperties, ReactNode } from "react";

interface SettingsSectionProps {
  /** Leading icon rendered inside the accent-tinted square. */
  icon: ReactNode;
  /** Section title. */
  title: ReactNode;
  /** Supporting description under the title. */
  desc?: ReactNode;
  /** Optional anchor id for sidebar deep-links. */
  id?: string;
  /** Extra class names (e.g. `settings-section hw`). */
  className?: string;
  /** Inline style passthrough (used for spacing tweaks only). */
  style?: CSSProperties;
  /** Optional trailing control(s) at the end of the header row — e.g. the
   *  Hardware tab's master monitoring switch. Additive; existing callers
   *  that don't pass it are unaffected. */
  actions?: ReactNode;
  children: ReactNode;
}

/**
 * SettingsSection — the canonical section block used by every settings
 * tab. Renders the accent icon tile + title + description header once so
 * tabs stop hand-rolling the same `<header className="settings-section-header">`
 * markup, then hosts the tab's controls below it. `actions` lets a tab pin
 * a status control (master switch etc.) to the right edge of the header.
 */
export default function SettingsSection({
  icon,
  title,
  desc,
  id,
  className,
  style,
  actions,
  children,
}: SettingsSectionProps) {
  return (
    <section
      className={`settings-section${className ? ` ${className}` : ""}`}
      id={id}
      style={style}
    >
      <header className="settings-section-header">
        <span className="settings-section-icon">{icon}</span>
        <div className="settings-section-header-text">
          <h2 className="settings-section-title">{title}</h2>
          {desc && <p className="settings-section-desc">{desc}</p>}
        </div>
        {actions && <div className="settings-section-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}
