import { useState, type ReactNode } from "react";

interface FilterSectionProps {
  /** Leading icon rendered inside the header (inline SVG). */
  icon?: ReactNode;
  /** Heading text (already localized by the caller). */
  title: ReactNode;
  /** Optional count badge next to the title (e.g. active genre count). */
  count?: number;
  /** Open by default. All filter groups default to open. */
  defaultOpen?: boolean;
  /** Extra class names (e.g. `ui-complete-only`). */
  className?: string;
  children: ReactNode;
}

/**
 * FilterSection — a collapsible accordion group for filter sidebars.
 *
 * The header is a full-width button (keyboard accessible) with a chevron
 * that rotates on open; the body collapses via the grid-template-rows
 * 0fr → 1fr trick, so the height animates smoothly without measuring.
 * Used by LibraryFilterSidebar so every filter group can be tucked away
 * without losing the active-filter count badge.
 */
export default function FilterSection({
  icon,
  title,
  count,
  defaultOpen = true,
  className,
  children,
}: FilterSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section
      className={["lib-filter-section", "lib-filter-group", open ? "is-open" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        className="lib-filter-group__header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="lib-filter-group__head-left">
          {icon && <span className="lib-filter-heading-icon" aria-hidden>{icon}</span>}
          <span className="lib-filter-group__title">{title}</span>
          {count != null && count > 0 && (
            <span className="lib-filter-count-badge">{count}</span>
          )}
        </span>
        <svg
          className="lib-filter-group__chevron"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div className="lib-filter-group__body">
        <div className="lib-filter-group__content">{children}</div>
      </div>
    </section>
  );
}
