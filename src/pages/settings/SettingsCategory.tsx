import type { ReactNode } from "react";
import { ChevronDownIcon } from "./settingsIcons";

interface SettingsCategoryProps {
  /** Optional anchor id so a category can be deep-linked via `?section=`. */
  id?: string;
  icon?: ReactNode;
  title: ReactNode;
  desc?: ReactNode;
  /** Whether the category body is expanded. Categories start collapsed. */
  open: boolean;
  onToggle: () => void;
  /** Screen-reader labels for the header toggle. */
  expandLabel?: string;
  collapseLabel?: string;
  children: ReactNode;
}

/**
 * SettingsCategory — a collapsible grouping shell for the Integrations tab.
 *
 * The header (icon + title + description) is a full-width toggle; the body
 * collapses via the grid-template-rows 0fr → 1fr trick so the height eases
 * without JS measuring. The body stays mounted while collapsed so deep-link
 * anchors inside remain in the DOM, but it is marked `inert` so collapsed
 * controls are neither focusable nor exposed to assistive tech.
 */
export default function SettingsCategory({
  id,
  icon,
  title,
  desc,
  open,
  onToggle,
  expandLabel,
  collapseLabel,
  children,
}: SettingsCategoryProps) {
  return (
    <section className={`settings-category${open ? " is-open" : ""}`} id={id}>
      <button
        type="button"
        className="settings-category__header"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? collapseLabel : expandLabel}
      >
        {icon && (
          <span className="settings-category__icon" aria-hidden>
            {icon}
          </span>
        )}
        <span className="settings-category__text">
          <span className="settings-category__title">{title}</span>
          {desc && <span className="settings-category__desc">{desc}</span>}
        </span>
        <span
          className={`settings-category__chevron${open ? " open" : ""}`}
          aria-hidden
        >
          <ChevronDownIcon />
        </span>
      </button>
      <div className="settings-category__body">
        <div className="settings-category__content" inert={!open || undefined}>
          {children}
        </div>
      </div>
    </section>
  );
}
