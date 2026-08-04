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
  children: ReactNode;
}

/**
 * SettingsSection — the canonical section block used by every settings
 * tab. Renders the accent icon + title + description header once so
 * tabs stop hand-rolling the same `<header className="settings-section-header">`
 * markup, then hosts the tab's controls below it.
 */
export default function SettingsSection({
  icon,
  title,
  desc,
  id,
  className,
  style,
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
      </header>
      {children}
    </section>
  );
}
