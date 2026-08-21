import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../context/LanguageContext";

interface HomeSectionProps {
  /** Section glyph (inline SVG). */
  icon: ReactNode;
  /** Section heading. */
  title: string;
  /** Optional one-line description under the heading. */
  subtitle?: string;
  /** Label for the header action link (defaults to t("home.viewAll")). */
  viewAllLabel?: string;
  /** Route the header action navigates to. Omitted = no action link. */
  viewAllPath?: string;
  /** Extra class for the section shell (e.g. sidebar variant). */
  className?: string;
  children: ReactNode;
}

/**
 * HomeSection — the shared card shell for every home-dashboard widget.
 * A themed surface with an icon + title row, an optional "view all"
 * action that navigates to the owning page, and the widget body below.
 */
export default function HomeSection({
  icon,
  title,
  subtitle,
  viewAllLabel,
  viewAllPath,
  className = "",
  children,
}: HomeSectionProps) {
  const navigate = useNavigate();
  const { t } = useLanguage();

  return (
    <section className={`home-section${className ? ` ${className}` : ""}`}>
      <header className="home-section__header">
        <div className="home-section__title-row">
          <span className="home-section__icon" aria-hidden>
            {icon}
          </span>
          <div className="home-section__titles" style={{ minWidth: 0 }}>
            <h3 className="home-section__title">{title}</h3>
            {subtitle && <p className="home-section__subtitle">{subtitle}</p>}
          </div>
        </div>
        {viewAllPath && (
          <button
            type="button"
            className="home-section__view-all"
            onClick={() => navigate(viewAllPath)}
          >
            {viewAllLabel ?? t("home.viewAll")}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        )}
      </header>
      {children}
    </section>
  );
}
