import { useCallback, useEffect, useRef, useState } from "react";
import type { Game } from "../../types/game";

const VIRTUALIZE_THRESHOLD = 60;

interface LibraryVirtualGridProps {
  items: Game[];
  density: string;
  isBigScreen: boolean;
  editorial?: boolean;
  /**
   * Stable string that only changes when the active filter/sort set
   * changes (e.g. `JSON.stringify(filters)`). The grid resets its scroll
   * offset when this changes so a newly-filtered result starts from the
   * top — but NOT when `items` changes for other reasons (lazy cover
   * enrichment, playtime ticks, running-state flips), which would yank
   * the user back to the top mid-scroll.
   */
  resetKey?: string;
  renderItem: (game: Game, index: number) => React.ReactNode;
}

/**
 * Find the actual scroll container for an element. The Library page lives
 * inside `.app-main` (overflow-y: auto), NOT the window — so a window
 * scroll listener never fires and the windowed grid freezes at the first
 * viewport. Walk up the tree for the nearest scrollable ancestor and
 * fall back to the window for pages that scroll at the document level.
 */
function findScrollContainer(el: HTMLElement | null): HTMLElement | Window {
  let node: HTMLElement | null = el?.parentElement ?? null;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(style.overflowY)) return node;
    node = node.parentElement;
  }
  return window;
}

/**
 * Windowed grid for large libraries (> VIRTUALIZE_THRESHOLD items).
 *
 * Renders a fixed-height spacer that preserves the full scroll extent and
 * absolutely-positions the visible row window inside it, translated by the
 * current scroll offset. Only `visibleRows` worth of cards are mounted at
 * any time, so multi-thousand-game libraries stay responsive without an
 * external virtualization dependency (knowledge.md: no react-window).
 *
 * Row strides must match the rendered card heights or rows overlap once
 * the library exceeds the threshold. A cozy grid card is ~400-430px tall
 * (2:3 cover at a 180-200px column + ~130px of body: name, meta badges,
 * developer, genres, 2-line notes), so 424px keeps a small safety margin
 * across column widths. Compact/list/cinematic use their own strides.
 */
export default function LibraryVirtualGrid({
  items,
  density,
  isBigScreen,
  editorial,
  resetKey = "",
  renderItem,
}: LibraryVirtualGridProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const [containerW, setContainerW] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLElement | Window | null>(null);

  const useVirtual = items.length > VIRTUALIZE_THRESHOLD;

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setViewportH(rect.height);
    setContainerW(rect.width);
  }, []);

  useEffect(() => {
    if (!useVirtual) return;
    const el = scrollRef.current;
    if (!el) return;

    const container = findScrollContainer(el);
    containerRef.current = container;

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);

    const computeScrollTop = () => {
      const top =
        container instanceof Window
          ? window.scrollY || document.documentElement.scrollTop
          : container.scrollTop;
      setScrollTop(Math.max(0, top));
    };
    computeScrollTop();

    container.addEventListener("scroll", computeScrollTop, { passive: true });
    return () => {
      ro.disconnect();
      container.removeEventListener("scroll", computeScrollTop);
      containerRef.current = null;
    };
  }, [useVirtual, measure]);

  // Reset the scroll offset when the ACTIVE FILTER/SORT SET changes (not
  // on every `items` reference change — games updates like lazy cover
  // enrichment, playtime ticks and running-state flips all create a new
  // `filteredGames` array, and resetting on those would yank the user
  // back to the top mid-scroll). Only fires when the user was actually
  // scrolled, so an in-place re-render doesn't scroll at all.
  useEffect(() => {
    if (!useVirtual) return;
    const container = containerRef.current;
    if (!container) return;
    const top =
      container instanceof Window
        ? window.scrollY || document.documentElement.scrollTop
        : container.scrollTop;
    if (top === 0) return;
    // Defer to next frame so the DOM has settled after the item swap.
    requestAnimationFrame(() => {
      const c = containerRef.current;
      if (!c) return;
      if (c instanceof Window) window.scrollTo({ top: 0 });
      else c.scrollTop = 0;
    });
  }, [resetKey, useVirtual]);

  const rowHeight =
    density === "compact" ? 220 : density === "cinematic" ? 420 : density === "list" ? 96 : 424;
  const gap = density === "compact" ? 12 : density === "cinematic" ? 24 : 16;

  if (!useVirtual) {
    return (
      <div
        className={`lib-cards density-${density}${isBigScreen ? " bigscreen-cards" : ""}${editorial ? " lib-cards--editorial" : ""}`}
      >
        {items.map((g, i) => renderItem(g, i))}
      </div>
    );
  }

  const minCol =
    density === "compact" ? 130 : density === "cinematic" ? 240 : density === "list" ? 99999 : 180;
  const cols = density === "list" ? 1 : Math.max(1, Math.floor((containerW + gap) / (minCol + gap)));

  const rowCount = Math.ceil(items.length / cols);
  const totalHeight = rowCount * rowHeight + (rowCount - 1) * gap;

  const overscan = 2;
  const rowStride = rowHeight + gap;
  const firstRow = Math.max(0, Math.floor(scrollTop / rowStride) - overscan);
  const visibleRows = Math.ceil(viewportH / rowStride) + overscan * 2;
  const lastRow = Math.min(rowCount - 1, firstRow + visibleRows);

  const visible: React.ReactNode[] = [];
  for (let r = firstRow; r <= lastRow; r++) {
    const start = r * cols;
    const rowItems = items.slice(start, start + cols);
    rowItems.forEach((g, i) => visible.push(renderItem(g, start + i)));
  }

  return (
    <div className="lib-grid-scroll" ref={scrollRef}>
      <div className="lib-grid-spacer" style={{ height: totalHeight }}>
        <div
          className={`lib-cards density-${density}${isBigScreen ? " bigscreen-cards" : ""}${editorial ? " lib-cards--editorial" : ""} lib-cards--virtual`}
          style={{ transform: `translateY(${firstRow * rowStride}px)` }}
        >
          {visible}
        </div>
      </div>
    </div>
  );
}
