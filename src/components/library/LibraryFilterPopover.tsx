import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import type { LibraryStatus } from "../../hooks/useLibraryFilters";
import type { LibraryFilters } from "../../hooks/libraryFilters";
import type { LibrarySource, PlayStatus } from "../../types/game";
import type { LibraryFacetCounts } from "../../hooks/useLibraryFacetCounts";
import MultiSelectDropdown from "../ui/MultiSelectDropdown";
import {
  PLAY_STATUS_LABEL_KEYS,
  PLAY_STATUS_ORDER,
  SOURCE_PLATFORMS,
} from "./librarySources";

interface LibraryFilterPopoverProps {
  open: boolean;
  onClose: () => void;
  /** The Filters button the panel hangs from. */
  anchorRef: { current: HTMLElement | null };
  filters: LibraryFilters;
  availableGenres: string[];
  counts: LibraryFacetCounts;
  /** How many games survive the current facet set. */
  resultCount: number;
  onGenresChange: (genres: string[]) => void;
  onPlatformsChange: (platforms: string[]) => void;
  onYearRangeChange: (min: number | null, max: number | null) => void;
  onRatingMinChange: (rating: number | null) => void;
  onStatusChange: (status: LibraryStatus) => void;
  onPlayStatusChange: (playStatus: PlayStatus | "all") => void;
  onSourceChange: (source: LibrarySource) => void;
  onVrOnlyChange: (vrOnly: boolean) => void;
  onReset: () => void;
  onSaveAsShelf: () => void;
}

interface Placement {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

const PANEL_WIDTH = 420;
const PANEL_MAX_HEIGHT = 560;
const VIEWPORT_MARGIN = 12;
const ANCHOR_GAP = 8;

const STATUS_OPTIONS: { value: LibraryStatus; labelKey: string }[] = [
  { value: "all", labelKey: "common.all" },
  { value: "installed", labelKey: "filter.installed" },
  { value: "not_installed", labelKey: "filter.notInstalled" },
];

/**
 * LibraryFilterPopover — the facet editor, floating under the Filters button.
 *
 * A popover rather than a side sheet: filtering is a quick contextual edit and
 * the grid should stay visible behind it. Every change applies live; the
 * footer reports the matching count and closes the panel.
 */
export default function LibraryFilterPopover({
  open,
  onClose,
  anchorRef,
  filters,
  availableGenres,
  counts,
  resultCount,
  onGenresChange,
  onPlatformsChange,
  onYearRangeChange,
  onRatingMinChange,
  onStatusChange,
  onPlayStatusChange,
  onSourceChange,
  onVrOnlyChange,
  onReset,
  onSaveAsShelf,
}: LibraryFilterPopoverProps) {
  const { t } = useLanguage();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const close = useCallback(() => onClose(), [onClose]);

  // The store facet is multi-select over `Game.platform`; a single legacy
  // `source` value folds into the same selection so nothing stays hidden.
  // The mapping is language-independent on purpose — facet values are the
  // stored platform names, not translated labels.
  const selectedStores = useMemo(() => {
    if (filters.platforms.length > 0) return filters.platforms;
    if (filters.source !== "all") return [SOURCE_PLATFORMS[filters.source]];
    return [];
  }, [filters.platforms, filters.source]);

  const storeOptions = useMemo(() => {
    const entries = Object.entries(counts.sources);
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    return entries;
  }, [counts.sources]);

  const toggleStore = (store: string) => {
    const next = selectedStores.includes(store)
      ? selectedStores.filter((value) => value !== store)
      : [...selectedStores, store];
    onSourceChange("all");
    onPlatformsChange(next);
  };

  // Track the trigger: the command bar is sticky, so the anchor moves while
  // scrolling and the panel has to follow (or close rather than float away).
  useLayoutEffect(() => {
    if (!open) return;

    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(PANEL_WIDTH, vw - VIEWPORT_MARGIN * 2);
      const left = Math.min(
        Math.max(VIEWPORT_MARGIN, rect.right - width),
        vw - width - VIEWPORT_MARGIN
      );

      const below = vh - rect.bottom - ANCHOR_GAP - VIEWPORT_MARGIN;
      const above = rect.top - ANCHOR_GAP - VIEWPORT_MARGIN;
      const openBelow = below >= above || below >= 240;
      const available = openBelow ? below : above;
      const maxHeight = Math.min(PANEL_MAX_HEIGHT, Math.max(available, 240));

      setPlacement((prev) =>
        prev &&
        prev.left === left &&
        prev.width === width &&
        prev.maxHeight === maxHeight &&
        prev.top === (openBelow ? rect.bottom + ANCHOR_GAP : undefined) &&
        prev.bottom === (openBelow ? undefined : vh - rect.top + ANCHOR_GAP)
          ? prev
          : {
              left,
              width,
              maxHeight,
              top: openBelow ? rect.bottom + ANCHOR_GAP : undefined,
              bottom: openBelow ? undefined : vh - rect.top + ANCHOR_GAP,
            }
      );
    };

    update();
    let frame = 0;
    const onScrollOrResize = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };

    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, anchorRef]);

  // Escape + click-away. Menus portaled by the multi-selects live outside the
  // panel node, so they count as "inside".
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (target.closest(".msd__menu")) return;
      if (anchorRef.current?.contains(target)) return;
      close();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 40);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.clearTimeout(focusTimer);
    };
  }, [open, close, anchorRef]);

  if (!open || !placement) return null;

  return createPortal(
    <div
      ref={panelRef}
      id="library-filter-popover"
      className="library-popover"
      role="dialog"
      aria-label={t("store.filtersTitle")}
      style={{
        left: placement.left,
        top: placement.top,
        bottom: placement.bottom,
        width: placement.width,
        maxHeight: placement.maxHeight,
      }}
    >
      <header className="library-popover-header">
        <div>
          <h2 className="library-popover-title">{t("store.filtersTitle")}</h2>
          <p className="library-popover-subtitle">
            {t("storage.gamesCount", {
              count: resultCount,
              plural: resultCount !== 1 ? "s" : "",
            })}
          </p>
        </div>
        <button
          ref={closeRef}
          type="button"
          className="library-popover-close"
          onClick={close}
          aria-label={t("store.closeFilters")}
          title={t("store.closeFilters")}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      <div className="library-popover-body">
        <section className="library-facet">
          <h3 className="library-facet-title">{t("edit.label.playStatus")}</h3>
          <div className="library-facet-chips">
            <button
              type="button"
              className={`library-facet-chip${filters.playStatus === "all" ? " is-active" : ""}`}
              aria-pressed={filters.playStatus === "all"}
              onClick={() => onPlayStatusChange("all")}
            >
              {t("common.all")}
            </button>
            {PLAY_STATUS_ORDER.map((status) => (
              <button
                key={status}
                type="button"
                className={`library-facet-chip${filters.playStatus === status ? " is-active" : ""}`}
                aria-pressed={filters.playStatus === status}
                onClick={() =>
                  onPlayStatusChange(filters.playStatus === status ? "all" : status)
                }
              >
                <span
                  className={`library-facet-dot library-facet-dot--${status}`}
                  aria-hidden="true"
                />
                {t(PLAY_STATUS_LABEL_KEYS[status])}
                <span className="library-facet-count">{counts.playStatus[status]}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="library-facet">
          <h3 className="library-facet-title">{t("library.filter.status")}</h3>
          <div className="library-facet-segments" role="group" aria-label={t("library.filter.status")}>
            {STATUS_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`library-facet-segment${filters.status === option.value ? " is-active" : ""}`}
                aria-pressed={filters.status === option.value}
                onClick={() => onStatusChange(option.value)}
              >
                {t(option.labelKey)}
                <span className="library-facet-count">
                  {option.value === "installed"
                    ? counts.installed
                    : option.value === "not_installed"
                      ? counts.notInstalled
                      : counts.total}
                </span>
              </button>
            ))}
          </div>
        </section>

        {storeOptions.length > 1 && (
          <section className="library-facet">
            <h3 className="library-facet-title">{t("library.filter.source")}</h3>
            <div className="library-facet-chips">
              <button
                type="button"
                className={`library-facet-chip${selectedStores.length === 0 ? " is-active" : ""}`}
                aria-pressed={selectedStores.length === 0}
                onClick={() => {
                  onSourceChange("all");
                  onPlatformsChange([]);
                }}
              >
                {t("common.all")}
              </button>
              {storeOptions.map(([store, count]) => (
                <button
                  key={store}
                  type="button"
                  className={`library-facet-chip${selectedStores.includes(store) ? " is-active" : ""}`}
                  aria-pressed={selectedStores.includes(store)}
                  onClick={() => toggleStore(store)}
                >
                  {store}
                  <span className="library-facet-count">{count}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {availableGenres.length > 0 && (
          <section className="library-facet">
            <h3 className="library-facet-title">
              {t("edit.label.genres")}
              {filters.genres.length > 0 && (
                <span className="library-facet-badge">{filters.genres.length}</span>
              )}
            </h3>
            <MultiSelectDropdown
              label={t("edit.label.genres")}
              placeholder={t("common.all")}
              options={availableGenres}
              selected={filters.genres}
              onChange={onGenresChange}
              counts={counts.genres}
              clearLabel={t("common.clear")}
              searchPlaceholder={t("store.filters.searchGenres")}
              noResultsLabel={t("common.noResults")}
            />
          </section>
        )}

        <section className="library-facet">
          <h3 className="library-facet-title">{t("library.filter.releaseYear")}</h3>
          <div className="library-facet-years">
            <label className="library-facet-year">
              <span>{t("library.filter.yearFrom")}</span>
              <input
                type="number"
                inputMode="numeric"
                min={1970}
                max={2100}
                value={filters.yearMin ?? ""}
                onChange={(event) => {
                  const raw = event.target.value.trim();
                  onYearRangeChange(raw ? Number(raw) : null, filters.yearMax);
                }}
              />
            </label>
            <span className="library-facet-year-sep" aria-hidden="true">
              –
            </span>
            <label className="library-facet-year">
              <span>{t("library.filter.yearTo")}</span>
              <input
                type="number"
                inputMode="numeric"
                min={1970}
                max={2100}
                value={filters.yearMax ?? ""}
                onChange={(event) => {
                  const raw = event.target.value.trim();
                  onYearRangeChange(filters.yearMin, raw ? Number(raw) : null);
                }}
              />
            </label>
          </div>
        </section>

        <section className="library-facet">
          <h3 className="library-facet-title">
            {t("library.filter.minRating")}
            <span className="library-facet-value">
              {filters.ratingMin != null ? `${filters.ratingMin}+` : t("common.all")}
            </span>
          </h3>
          <input
            type="range"
            className="library-facet-range"
            min={0}
            max={100}
            step={5}
            value={filters.ratingMin ?? 0}
            aria-label={t("library.filter.minRating")}
            onChange={(event) => {
              const next = Number(event.target.value);
              onRatingMinChange(next > 0 ? next : null);
            }}
          />
        </section>

        <label className="library-facet-switch">
          <input
            type="checkbox"
            checked={filters.vrOnly}
            onChange={(event) => onVrOnlyChange(event.target.checked)}
          />
          <span className="library-facet-switch-track" aria-hidden="true">
            <span className="library-facet-switch-knob" />
          </span>
          <span className="library-facet-switch-label">{t("library.filter.vrOnly")}</span>
        </label>
      </div>

      <footer className="library-popover-footer">
        <button type="button" className="library-popover-ghost" onClick={onReset}>
          {t("wishlist.clearAll")}
        </button>
        <button type="button" className="library-popover-ghost" onClick={onSaveAsShelf}>
          {t("library.chips.saveAsShelf")}
        </button>
        <button type="button" className="library-popover-done" onClick={close}>
          {t("library.drawer.showGames", { count: resultCount })}
        </button>
      </footer>
    </div>,
    document.body
  );
}
