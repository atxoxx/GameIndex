import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownUp,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { ViewDensity } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import DensityToggle from "../DensityToggle";

export interface DealsToolbarOption {
  value: string;
  label: string;
}

export interface DealsToolbarFilter {
  id: string;
  label: string;
  value: string;
  /** Value that means "not filtering" — drives the active-chip row. */
  neutral: string;
  options: DealsToolbarOption[];
  onChange: (value: string) => void;
  display?: "select" | "chips";
}

export interface DealsToolbarToggle {
  id: string;
  label: string;
  icon: ReactNode;
  active: boolean;
  /** Value the toggle resets to; a toggle at its default is not "active". */
  defaultActive?: boolean;
  onToggle: () => void;
}

interface DealsToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  sort: {
    value: string;
    options: DealsToolbarOption[];
    onChange: (value: string) => void;
  };
  filters?: DealsToolbarFilter[];
  toggles?: DealsToolbarToggle[];
  density: ViewDensity;
  onDensityChange: (density: ViewDensity) => void;
  loading?: boolean;
  onReload: () => void;
}

/**
 * DealsToolbar - one control band shared by every source tab.
 *
 * Search leads, then sort, a filters popover, density and refresh. Filters that
 * differ from their neutral value collapse into removable chips so the active
 * scope is visible without reopening the panel.
 */
export default function DealsToolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  sort,
  filters = [],
  toggles = [],
  density,
  onDensityChange,
  loading = false,
  onReload,
}: DealsToolbarProps) {
  const { t } = useLanguage();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!filtersOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      setFiltersOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setFiltersOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [filtersOpen]);

  const activeFilters = filters.filter((filter) => filter.value !== filter.neutral);
  const activeToggles = toggles.filter(
    (toggle) => toggle.active !== (toggle.defaultActive ?? false),
  );
  const activeCount = activeFilters.length + activeToggles.length;
  const hasChips = activeCount > 0 || search.length > 0;

  const resetFilters = () => {
    for (const filter of activeFilters) filter.onChange(filter.neutral);
    for (const toggle of activeToggles) toggle.onToggle();
  };

  const sortOptions = useMemo(
    () => sort.options.map((option) => ({ ...option })),
    [sort.options],
  );

  const activeLabel = (filter: DealsToolbarFilter): string => {
    const option = filter.options.find((item) => item.value === filter.value);
    return option ? `${filter.label}: ${option.label}` : filter.label;
  };

  return (
    <div className="deals-toolbar">
      <div className="deals-toolbar__main">
        <div className={`deals-search${search ? " has-value" : ""}`}>
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
          />
          {search && (
            <button
              type="button"
              className="deals-search__clear"
              onClick={() => onSearchChange("")}
              aria-label={t("common.clearSearch")}
              title={t("common.clearSearch")}
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="deals-toolbar__controls">
          <label className="deals-sort">
            <ArrowDownUp size={14} aria-hidden="true" />
            <span className="deals-sort__label">{t("deals.sortBy")}</span>
            <select
              value={sort.value}
              onChange={(event) => sort.onChange(event.target.value)}
              aria-label={t("deals.sortBy")}
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {filters.length > 0 && (
            <button
              ref={triggerRef}
              type="button"
              className={`deals-filter-trigger${filtersOpen ? " is-open" : ""}${
                activeCount > 0 ? " has-filters" : ""
              }`}
              onClick={() => setFiltersOpen((open) => !open)}
              aria-expanded={filtersOpen}
              aria-haspopup="dialog"
            >
              <SlidersHorizontal size={15} aria-hidden="true" />
              {t("deals.filters")}
              {activeCount > 0 && (
                <span className="deals-filter-trigger__count">{activeCount}</span>
              )}
            </button>
          )}

          <DensityToggle
            density={density}
            onChange={onDensityChange}
            className="deals-density"
          />

          <button
            type="button"
            className={`deals-refresh${loading ? " is-busy" : ""}`}
            onClick={onReload}
            aria-label={t("common.refresh")}
            title={t("common.refresh")}
            aria-busy={loading || undefined}
          >
            <RefreshCw size={15} aria-hidden="true" />
          </button>
        </div>
      </div>

      {hasChips && (
        <div className="deals-toolbar__chips">
          {search && (
            <button
              type="button"
              className="deals-chip"
              onClick={() => onSearchChange("")}
            >
              <span className="deals-chip__label">“{search}”</span>
              <X size={12} aria-hidden="true" />
            </button>
          )}

          {activeFilters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className="deals-chip"
              onClick={() => filter.onChange(filter.neutral)}
            >
              <span className="deals-chip__label">{activeLabel(filter)}</span>
              <X size={12} aria-hidden="true" />
            </button>
          ))}

          {activeToggles.map((toggle) => (
            <button
              key={toggle.id}
              type="button"
              className="deals-chip deals-chip--toggle"
              onClick={toggle.onToggle}
              aria-pressed
            >
              <span className="deals-chip__label">{toggle.label}</span>
              <X size={12} aria-hidden="true" />
            </button>
          ))}

          <button
            type="button"
            className="deals-chip deals-chip--reset"
            onClick={resetFilters}
          >
            {t("deals.resetFilters")}
          </button>
        </div>
      )}

      {filtersOpen && (
        <div
          ref={panelRef}
          className="deals-filter-panel"
          role="dialog"
          aria-label={t("deals.filters")}
        >
          <div className="deals-filter-panel__head">
            <span>{t("deals.filters")}</span>
            <button
              type="button"
              className="deals-filter-panel__close"
              onClick={() => setFiltersOpen(false)}
              aria-label={t("common.close")}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>

          {filters.map((filter) => (
            <div key={filter.id} className="deals-filter-field">
              <span className="deals-filter-field__label">{filter.label}</span>

              {filter.display === "chips" ? (
                <div className="deals-filter-chips" role="group" aria-label={filter.label}>
                  {filter.options.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`deals-filter-chip${
                        option.value === filter.value ? " is-active" : ""
                      }`}
                      onClick={() => filter.onChange(option.value)}
                      aria-pressed={option.value === filter.value}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : (
                <select
                  value={filter.value}
                  onChange={(event) => filter.onChange(event.target.value)}
                  aria-label={filter.label}
                >
                  {filter.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}

          {toggles.length > 0 && (
            <div className="deals-filter-field">
              <span className="deals-filter-field__label">{t("deals.scope")}</span>
              <div className="deals-filter-chips" role="group" aria-label={t("deals.scope")}>
                {toggles.map((toggle) => (
                  <button
                    key={toggle.id}
                    type="button"
                    className={`deals-filter-chip${
                      toggle.active ? " is-active" : ""
                    }`}
                    onClick={toggle.onToggle}
                    aria-pressed={toggle.active}
                  >
                    {toggle.icon}
                    {toggle.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="deals-filter-panel__foot">
            <button
              type="button"
              className="deals-filter-reset"
              onClick={resetFilters}
              disabled={activeCount === 0}
            >
              {t("deals.resetFilters")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
