import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import StoreFilterSidebar from "./StoreFilterSidebar";
import type { StoreCatalogue } from "../../hooks/useStoreCatalogue";
import { useLanguage } from "../../context/LanguageContext";

interface StoreFilterPanelProps {
  catalogue: StoreCatalogue;
  /** The filter button this popover hangs from (optional fallback if hidden). */
  anchorRef?: { current: HTMLElement | null };
}

interface PanelPlacement {
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

/**
 * The catalogue filter panel. It opens as a compact popover anchored to the
 * filter button in the sticky command bar, rather than a full-height drawer:
 * filters are a quick contextual edit, not a separate workspace.
 */export default function StoreFilterPanel({
  catalogue: c,
  anchorRef,
}: StoreFilterPanelProps) {
  const { t } = useLanguage();
  const open = c.filtersOpen;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [placement, setPlacement] = useState<PanelPlacement | null>(null);

  const close = useCallback(() => {
    c.setFiltersOpen(false);
  }, [c.setFiltersOpen]);

  // Position against the trigger whenever it opens or the viewport moves.
  useLayoutEffect(() => {
    if (!open) return;

    const update = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const width = Math.min(PANEL_WIDTH, vw - VIEWPORT_MARGIN * 2);
      const anchor = anchorRef?.current;

      let left: number;
      let top: number | undefined;
      let bottom: number | undefined;
      let maxHeight: number;

      if (anchor) {
        const rect = anchor.getBoundingClientRect();
        left = Math.min(
          Math.max(VIEWPORT_MARGIN, rect.right - width),
          vw - width - VIEWPORT_MARGIN
        );

        const below = vh - rect.bottom - ANCHOR_GAP - VIEWPORT_MARGIN;
        const above = rect.top - ANCHOR_GAP - VIEWPORT_MARGIN;
        const openBelow = below >= above;
        maxHeight = Math.min(PANEL_MAX_HEIGHT, Math.max(below, above));
        if (maxHeight < 240) maxHeight = Math.min(PANEL_MAX_HEIGHT, vh - VIEWPORT_MARGIN * 2);

        if (openBelow) {
          top = rect.bottom + ANCHOR_GAP;
        } else {
          // Pin the bottom edge to the trigger so the panel stays adjacent
          // even when its content is shorter than the available space.
          bottom = Math.max(VIEWPORT_MARGIN, vh - rect.top + ANCHOR_GAP);
        }
      } else {
        left = (vw - width) / 2;
        top = 96;
        maxHeight = Math.min(PANEL_MAX_HEIGHT, vh - top - VIEWPORT_MARGIN);
      }

      setPlacement((prev) =>
        prev &&
        prev.left === left &&
        prev.top === top &&
        prev.bottom === bottom &&
        prev.width === width &&
        prev.maxHeight === maxHeight
          ? prev
          : { left, top, bottom, width, maxHeight }
      );
    };

    update();
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };

    window.addEventListener("resize", update);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [open, anchorRef]);

  // Escape + click-away. Portaled menus inside the panel (the multi-select
  // lists) live outside the panel node, so they count as "inside".
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (target.closest(".msd__menu")) return;
      if (anchorRef?.current?.contains(target)) return;
      close();
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown, true);
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 30);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.clearTimeout(focusTimer);
      // Closing drops the focused control with the panel: hand focus back to
      // the trigger, unless the user moved it somewhere else themselves.
      const active = document.activeElement;
      const trigger = anchorRef?.current;
      if (
        trigger?.isConnected &&
        (!active || active === document.body || panelRef.current?.contains(active))
      ) {
        trigger.focus();
      }
    };
  }, [open, close, anchorRef]);

  if (!open || !placement) return null;

  return createPortal(
    <div
      ref={panelRef}
      id="store-filter-popover"
      className="store-filter-popover"
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
      <div className="store-filter-popover-header">
        <h3>{t("store.filtersTitle")}</h3>
        <button
          ref={closeRef}
          type="button"
          className="store-filter-popover-close"
          onClick={close}
          aria-label={t("store.closeFilters")}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="store-filter-popover-body">
        <StoreFilterSidebar
          selectedGenres={c.selectedGenres}
          selectedPlatforms={c.selectedPlatforms}
          platformNames={c.platformNames}
          yearMin={c.yearMin}
          yearMax={c.yearMax}
          ratingMin={c.ratingMin}
          selectedSourceIds={c.selectedSourceIds}
          onGenresChange={c.setSelectedGenres}
          onPlatformsChange={c.setSelectedPlatforms}
          onYearRangeChange={c.setYearRange}
          onRatingMinChange={c.setRatingMin}
          onSourcesChange={c.setSelectedSourceIds}
          sourceCounts={c.sourceCounts}
          sourceMatchMode={c.sourceMatchMode}
          onSourceMatchModeChange={c.setSourceMatchMode}
          countSource={c.displayedGames}
          onReset={c.resetFilters}
        />
      </div>

      <div className="store-filter-popover-footer">
        <button
          type="button"
          className="store-filter-popover-clear"
          onClick={c.resetFilters}
        >
          {t("store.chips.clearAll")}
        </button>
        <button
          type="button"
          className="store-filter-popover-apply"
          onClick={close}
        >
          {t("store.drawer.showResults", { count: c.displayedGames.length })}
        </button>
      </div>
    </div>,
    document.body
  );
}
