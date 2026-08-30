import { useState, type ReactNode } from "react";
import { useSettings } from "../../context/SettingsContext";
import { useLanguage } from "../../context/LanguageContext";

interface DisclosureProps {
  children: ReactNode;
  /** i18n key for the toggle label. Defaults to "ui.advanced". */
  labelKey?: string;
  className?: string;
}

/**
 * Disclosure — progressive-disclosure wrapper for Simple UI mode.
 *
 * In Simple mode advanced/secondary content is collapsed behind a small
 * "Advanced" toggle so the default view stays clean but nothing is ever
 * lost. In Complete mode the children render inline (no toggle, no
 * behavior change for existing users).
 */
export default function Disclosure({
  children,
  labelKey = "ui.advanced",
  className,
}: DisclosureProps) {
  const { isSimpleUi } = useSettings();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  if (!isSimpleUi) {
    return <>{children}</>;
  }

  return (
    <div className={`ui-disclosure${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        className="ui-disclosure__toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="ui-disclosure__label">{t(labelKey)}</span>
        <span className="ui-disclosure__caret" aria-hidden="true">
          {open ? "−" : "+"}
        </span>
      </button>
      {open && <div className="ui-disclosure__body">{children}</div>}
    </div>
  );
}