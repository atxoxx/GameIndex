import type { ReactNode } from "react";
import { useLanguage } from "../../context/LanguageContext";

type SettingsRowLayout = "inline" | "stacked";

interface SettingsRowProps {
  /** Row anchor. Search jumps flash this id after navigating. */
  id?: string;
  /** Control name — always a real sentence-cased label, never a code key. */
  title: ReactNode;
  /** One plain-language sentence: what it does, and what happens if changed. */
  desc?: ReactNode;
  /** Longer explanation behind a "More info" disclosure (jargon, caveats). */
  help?: ReactNode;
  /** Right-hand control. Omit for rows whose control lives in `children`. */
  control?: ReactNode;
  /** `inline` puts the control on the right; `stacked` keeps it below full width. */
  layout?: SettingsRowLayout;
  /** Small leading note, e.g. "Recommended" or "Beta". */
  badge?: ReactNode;
  /** Explains a disabled control instead of leaving the user guessing. */
  disabledHint?: ReactNode;
  /** Additional content rendered under the main row (sliders, previews...). */
  children?: ReactNode;
  /** Extra class names for one-off layouts. */
  className?: string;
}

/**
 * SettingsRow — the canonical "one decision per row" primitive.
 *
 * Left side states the choice in plain language with a short consequence
 * sentence (and optional deeper explanation), right side holds the control.
 * Rows are separated by hairlines instead of stacked cards, which makes long
 * tabs scannable and gives every control the same visual grammar.
 */
export default function SettingsRow({
  id,
  title,
  desc,
  help,
  control,
  layout = "inline",
  badge,
  disabledHint,
  children,
  className,
}: SettingsRowProps) {
  const { t } = useLanguage();
  return (
    <div
      id={id}
      className={`settings-field settings-field--${layout}${
        className ? ` ${className}` : ""
      }`}
    >
      <div className="settings-field-main">
        <div className="settings-field-text">
          <span className="settings-field-title">
            {title}
            {badge && <span className="settings-field-badge">{badge}</span>}
          </span>
          {desc && <p className="settings-field-desc">{desc}</p>}
          {help && (
            <details className="settings-help">
              <summary>{t("settings.moreInfo")}</summary>
              <div className="settings-help-body">{help}</div>
            </details>
          )}
          {disabledHint && (
            <p className="settings-field-hint">{disabledHint}</p>
          )}
        </div>
        {control && <div className="settings-field-control">{control}</div>}
      </div>
      {children && <div className="settings-field-body">{children}</div>}
    </div>
  );
}
