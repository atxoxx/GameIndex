// BigScreenBackHeader — small breadcrumb-style back header for Big
// Screen pages that drill down (Mods, Emulators, Docs).
//
//   • Back button uses `useFocusable` so the D-pad / A button work; it
//     also remains a plain `<button>` for mouse users.
//   • Default behavior is `navigate(-1)`; pass `onBack` to override
//     (e.g. returning to a local "select" phase instead of a route).
//   • Styling reuses the existing `.bigscreen-details-btn--secondary`
//     class for the button; the title/subtitle are inline-styled so no
//     new CSS is needed.

import { type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useFocusable } from "../../hooks/useFocusable";
import { useLanguage } from "../../context/LanguageContext";

export interface BigScreenBackHeaderProps {
  /** Optional page title rendered next to the back button. */
  title?: ReactNode;
  /** Optional muted subtitle (breadcrumb context). */
  subtitle?: ReactNode;
  /** Override the default `navigate(-1)` back behavior. */
  onBack?: () => void;
}

const BackArrow = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    width="16"
    height="16"
    aria-hidden="true"
  >
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

export default function BigScreenBackHeader({
  title,
  subtitle,
  onBack,
}: BigScreenBackHeaderProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const handleBack = onBack ?? (() => navigate(-1));
  const backProps = useFocusable(handleBack);

  return (
    <div className="bigscreen-back-header">
      <button
        type="button"
        className="bigscreen-back-header-btn"
        aria-label={t("bigscreen.backHeader.back")}
        {...backProps}
      >
        {BackArrow}
        {t("bigscreen.backHeader.back")}
      </button>
      <div className="bigscreen-back-header-copy">
        {title && <h2 className="bigscreen-back-header-title">{title}</h2>}
        {subtitle && <span className="bigscreen-back-header-subtitle">{subtitle}</span>}
      </div>
    </div>
  );
}
