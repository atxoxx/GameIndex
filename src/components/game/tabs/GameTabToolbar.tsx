import type { ReactNode } from "react";
import { Search, X } from "lucide-react";

export interface GameTabSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  clearLabel: string;
}

/** Search field shared by every tab command row. */
export function GameTabSearch({
  value,
  onChange,
  placeholder,
  label,
  clearLabel,
}: GameTabSearchProps) {
  return (
    <label className="game-tab-search">
      <Search size={14} aria-hidden="true" />
      <input
        type="search"
        className="game-tab-search__input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
      />
      {value && (
        <button
          type="button"
          className="game-tab-search__clear"
          onClick={() => onChange("")}
          aria-label={clearLabel}
        >
          <X size={13} />
        </button>
      )}
    </label>
  );
}

export interface GameTabToolbarProps {
  search?: ReactNode;
  filters?: ReactNode;
  view?: ReactNode;
  actions?: ReactNode;
  /** Extra line under the row (active filter chips, progress). */
  below?: ReactNode;
  className?: string;
}

/**
 * One command row per tab: search on the left, filter chips beside it,
 * the view switch and actions on the right. Wraps in place on narrow
 * windows rather than collapsing into a menu.
 */
export default function GameTabToolbar({
  search,
  filters,
  view,
  actions,
  below,
  className,
}: GameTabToolbarProps) {
  return (
    <div className={["game-tab-toolbar", className ?? ""].filter(Boolean).join(" ")}>
      <div className="game-tab-toolbar__row">
        {search && <div className="game-tab-toolbar__search">{search}</div>}
        {filters && <div className="game-tab-toolbar__filters">{filters}</div>}
        {view && <div className="game-tab-toolbar__view">{view}</div>}
        {actions && <div className="game-tab-toolbar__actions">{actions}</div>}
      </div>
      {below && <div className="game-tab-toolbar__below">{below}</div>}
    </div>
  );
}
