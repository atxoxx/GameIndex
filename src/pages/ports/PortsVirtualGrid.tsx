import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import type { PortGameGroup } from "./portGroups";
import "./PortsVirtualGrid.css";

/* ===========================================================================
 * Ports virtual grid
 * ──────────────────
 * Windows the Ports catalog so a sync with thousands of games only mounts the
 * card rows inside the scroll viewport (+ two overscan rows). The page keeps
 * owning section data and the card component; this file owns geometry only.
 *
 * Geometry is deterministic on purpose: card height is derived from the
 * resolved card width and the fixed 2:3 art aspect ratio, so no card ever has
 * to be measured. `buildRows` / `visibleRows` are pure and unit-tested.
 * =========================================================================== */

/** Column gap, matching `.ports-grid` (`var(--space-lg)`). */
export const GRID_GAP = 16;
/** Gap between card rows. */
export const ROW_GAP = 18;
/** Gap between two sections. */
export const SECTION_GAP = 32;
/** Height of a section header row. */
export const HEADER_HEIGHT = 44;
/** Smallest allowed card width, matching `.ports-grid` minmax(178px, 1fr). */
export const CARD_MIN_WIDTH = 178;
/** Art is 2:3, so the cover occupies cardWidth * 1.5. */
export const CARD_ART_RATIO = 1.5;
/** Fixed body height below the art plus the card's 1px border (104 + 2). */
export const CARD_BODY_HEIGHT = 106;
/** Result sets below this stay fully mounted. */
export const VIRTUALIZE_THRESHOLD = 40;
/** Extra rows kept mounted above and below the viewport. */
export const OVERSCAN_ROWS = 2;

export interface PortsVirtualSection {
  key: string;
  label: string;
  accent?: string;
  groups: PortGameGroup[];
}

export interface VirtualRow {
  kind: "header" | "cards";
  /** Offset from the top of the grid spacer, in px. */
  top: number;
  height: number;
  sectionKey: string;
  label?: string;
  accent?: string;
  /** `groups.length` for header rows; unused for card rows. */
  count?: number;
  /** The slice of groups this card row renders (at most `columns`). */
  groups?: PortGameGroup[];
}

export interface PortsVirtualGridProps {
  sections: PortsVirtualSection[];
  renderGroup: (group: PortGameGroup) => ReactNode;
  resetKey?: string;
  className?: string;
}

type VarStyle = CSSProperties & Record<`--${string}`, string | number | undefined>;

/* -- Pure geometry --------------------------------------------------------- */

/** Column count for a measured container width (always at least one). */
export function columnsForWidth(width: number): number {
  if (!(width > 0)) return 1;
  return Math.max(1, Math.floor((width + GRID_GAP) / (CARD_MIN_WIDTH + GRID_GAP)));
}

/** Width of a card in the CSS grid `repeat(columns, minmax(0, 1fr))`. */
export function cardWidthForContainer(width: number, columns: number): number {
  const cols = Math.max(1, Math.floor(columns) || 1);
  const usable = Math.max(0, width) - GRID_GAP * (cols - 1);
  return Math.max(0, usable / cols);
}

/** Deterministic card height: 2:3 art plus the fixed body. */
export function cardHeightForContainer(width: number, columns: number): number {
  return Math.round(cardWidthForContainer(width, columns) * CARD_ART_RATIO + CARD_BODY_HEIGHT);
}

/** Only large, measured result sets get windowed. */
export function shouldVirtualize(totalGroups: number, containerWidth: number): boolean {
  return containerWidth > 0 && totalGroups >= VIRTUALIZE_THRESHOLD;
}

/**
 * Flatten sections into an ordered row timeline.
 *
 * Headers are only emitted for non-empty labels; empty sections are dropped so
 * they cannot leave a stray gap behind. Rows are spaced by `ROW_GAP` inside a
 * section and `sectionGap` between sections. If a section has a header, the
 * first card row is also separated by `ROW_GAP`.
 */
export function buildRows(
  sections: PortsVirtualSection[],
  columns: number,
  cardHeight: number,
  headerHeight: number,
  sectionGap: number
): VirtualRow[] {
  const cols = Math.max(1, Math.floor(columns) || 1);
  const cardsH = Math.max(0, cardHeight);
  const headerH = Math.max(0, headerHeight);
  const gapBetweenSections = Math.max(0, sectionGap);

  const rows: VirtualRow[] = [];
  let cursor = 0;
  let emittedAny = false;

  for (const section of sections) {
    if (section.groups.length === 0) continue;

    if (emittedAny) cursor += gapBetweenSections;

    if (section.label) {
      rows.push({
        kind: "header",
        top: cursor,
        height: headerH,
        sectionKey: section.key,
        label: section.label,
        accent: section.accent,
        count: section.groups.length,
      });
      cursor += headerH;
    }

    let emittedInSection = Boolean(section.label);

    for (let start = 0; start < section.groups.length; start += cols) {
      if (emittedInSection) cursor += ROW_GAP;
      rows.push({
        kind: "cards",
        top: cursor,
        height: cardsH,
        sectionKey: section.key,
        groups: section.groups.slice(start, start + cols),
      });
      cursor += cardsH;
      emittedInSection = true;
    }

    emittedAny = true;
  }

  return rows;
}

/** First row whose bottom edge is at or below `y`. */
function firstRowIntersecting(rows: VirtualRow[], y: number): number {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (rows[mid].top + rows[mid].height < y) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Last row whose top edge is at or above `y` (may be -1). */
function lastRowStartingBefore(rows: VirtualRow[], y: number): number {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (rows[mid].top <= y) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

/**
 * Rows intersecting `[scrollTop, scrollTop + viewportHeight]`, widened by
 * `overscan` rows on each side. Rows are sorted by `top`, so the window is
 * found with two binary searches instead of a scan.
 */
export function visibleRows(
  rows: VirtualRow[],
  scrollTop: number,
  viewportHeight: number,
  overscan: number
): VirtualRow[] {
  const count = rows.length;
  if (count === 0) return [];

  const viewTop = Math.max(0, scrollTop);
  const viewBottom = viewTop + Math.max(0, viewportHeight);

  const first = Math.min(firstRowIntersecting(rows, viewTop), count - 1);
  const last = Math.max(lastRowStartingBefore(rows, viewBottom), 0);

  const span = Math.max(0, Math.floor(overscan) || 0);
  const start = Math.max(0, Math.min(first, last) - span);
  const end = Math.min(count - 1, Math.max(first, last) + span);

  return end < start ? [] : rows.slice(start, end + 1);
}

/* -- DOM helpers ----------------------------------------------------------- */

function isWindow(target: HTMLElement | Window): target is Window {
  return target === window;
}

/** Walk up until an element actually scrolls vertically, like LibraryVirtualGrid. */
function findScrollContainer(el: HTMLElement | null): HTMLElement | Window {
  let node: HTMLElement | null = el?.parentElement ?? null;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(style.overflowY)) return node;
    node = node.parentElement;
  }
  return window;
}

/** How far the grid has scrolled past the container's viewport top. */
function gridScrollTop(el: HTMLElement, container: HTMLElement | Window): number {
  const rect = el.getBoundingClientRect();
  const containerTop = isWindow(container) ? 0 : container.getBoundingClientRect().top;
  return Math.max(0, containerTop - rect.top);
}

function containerViewportHeight(container: HTMLElement | Window): number {
  return isWindow(container) ? window.innerHeight : container.clientHeight;
}

/* -- Component ------------------------------------------------------------- */

export default function PortsVirtualGrid({
  sections,
  renderGroup,
  resetKey = "",
  className,
}: PortsVirtualGridProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLElement | Window | null>(null);
  const rowsRef = useRef<VirtualRow[]>([]);
  const totalHeightRef = useRef(0);

  const [width, setWidth] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const totalGroups = useMemo(
    () => sections.reduce((sum, section) => sum + section.groups.length, 0),
    [sections]
  );

  const columns = columnsForWidth(width);
  const cardHeight = cardHeightForContainer(width, columns);
  const virtual = shouldVirtualize(totalGroups, width);

  const rows = useMemo(
    () => (virtual ? buildRows(sections, columns, cardHeight, HEADER_HEIGHT, SECTION_GAP) : []),
    [virtual, sections, columns, cardHeight]
  );

  const totalHeight =
    rows.length > 0 ? rows[rows.length - 1].top + rows[rows.length - 1].height : 0;

  const activeRows = useMemo(
    () => (virtual ? visibleRows(rows, scrollTop, viewportHeight, OVERSCAN_ROWS) : []),
    [virtual, rows, scrollTop, viewportHeight]
  );

  rowsRef.current = rows;
  totalHeightRef.current = totalHeight;

  const geometryStyle: VarStyle = {
    "--ports-vgrid-columns": String(columns),
    "--ports-vgrid-gap": `${GRID_GAP}px`,
    "--ports-vgrid-row-gap": `${ROW_GAP}px`,
    "--ports-vgrid-section-gap": `${SECTION_GAP}px`,
    "--ports-vgrid-min": `${CARD_MIN_WIDTH}px`,
    "--ports-vgrid-card-h": `${cardHeight}px`,
  };

  const rootClassName = [
    "ports-vgrid",
    virtual ? "ports-vgrid--virtual" : "ports-vgrid--plain",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const accentStyle = (accent?: string): VarStyle | undefined =>
    accent ? { "--port-accent": accent } : undefined;

  // Container width drives the column count and the card height. Measured in a
  // layout effect so the first paint after mount already uses real columns.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const measure = () => {
      const next = el.clientWidth;
      setWidth((prev) => (prev === next ? prev : next));
    };

    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Scroll + viewport subscription. rAF-throttled, and the committed state only
  // changes when the visible row window changes, so a wheel tick does not
  // re-render every mounted card.
  useLayoutEffect(() => {
    if (!virtual) return;
    const el = rootRef.current;
    if (!el) return;

    const container = findScrollContainer(el);
    containerRef.current = container;

    let rafId = 0;
    let disposed = false;
    let lastSignature = "";
    let lastHeight = -1;

    const commit = () => {
      if (disposed) return;
      const height = containerViewportHeight(container);
      const top = gridScrollTop(el, container);
      const maxTop = Math.max(0, totalHeightRef.current - height);
      const nextTop = Math.max(0, Math.min(top, maxTop));
      const windowRows = visibleRows(rowsRef.current, nextTop, height, OVERSCAN_ROWS);
      const signFirst = windowRows.length > 0 ? windowRows[0].top : -1;
      const signLast = windowRows.length > 0 ? windowRows[windowRows.length - 1].top : -1;
      const signature = `${height}:${signFirst}:${signLast}`;

      if (height !== lastHeight) {
        lastHeight = height;
        setViewportHeight(height);
      }
      if (signature === lastSignature) return;
      lastSignature = signature;
      setScrollTop(nextTop);
    };

    const schedule = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        commit();
      });
    };

    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    if (observer && !isWindow(container)) observer.observe(container);
    container.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    commit();

    return () => {
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      observer?.disconnect();
      container.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      containerRef.current = null;
    };
  }, [virtual]);

  // Filter/sort reset: jump back to the top of the page once the key changes.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const container = containerRef.current ?? findScrollContainer(el);
    const current = isWindow(container)
      ? window.scrollY || document.documentElement.scrollTop
      : container.scrollTop;
    if (current === 0) return;

    const raf = requestAnimationFrame(() => {
      if (isWindow(container)) window.scrollTo({ top: 0 });
      else container.scrollTop = 0;
      setScrollTop(0);
    });
    return () => cancelAnimationFrame(raf);
  }, [resetKey]);

  // Result sets shrink when filters are applied. Clamp both the window state and
  // the real scroll offset so the grid never sits below its last row.
  useLayoutEffect(() => {
    if (!virtual) return;
    const el = rootRef.current;
    if (!el) return;
    const container = containerRef.current ?? findScrollContainer(el);
    const height = containerViewportHeight(container);
    const top = gridScrollTop(el, container);
    const maxTop = Math.max(0, totalHeight - height);
    const clamped = Math.min(top, maxTop);

    if (top > maxTop) {
      const overflow = top - maxTop;
      if (isWindow(container)) {
        window.scrollTo({ top: Math.max(0, (window.scrollY || 0) - overflow) });
      } else {
        container.scrollTop = Math.max(0, container.scrollTop - overflow);
      }
    }

    if (clamped !== scrollTop) setScrollTop(clamped);
  }, [rows, totalHeight, virtual]);

  const renderSectionHeader = (label: string, accent: string | undefined, count: number) => (
    <header className="ports-vgrid__header ports-section__head" style={accentStyle(accent)}>
      <h2>{label}</h2>
      <span className="ports-section__count">{count}</span>
    </header>
  );

  if (!virtual) {
    return (
      <div ref={rootRef} className={rootClassName} style={geometryStyle}>
        {sections.map((section) => {
          if (section.groups.length === 0) return null;
          return (
            <section
              key={section.key}
              className="ports-vgrid__section"
              style={accentStyle(section.accent)}
            >
              {section.label
                ? renderSectionHeader(section.label, section.accent, section.groups.length)
                : null}
              <div className="ports-vgrid__row ports-vgrid__row--flow">
                {section.groups.map((group) => (
                  <Fragment key={group.key}>{renderGroup(group)}</Fragment>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div ref={rootRef} className={rootClassName} style={geometryStyle}>
      <div className="ports-vgrid__spacer" style={{ height: totalHeight }}>
        {activeRows.map((row) => {
          if (row.kind === "header") {
            return (
              <header
                key={`header:${row.sectionKey}`}
                className="ports-vgrid__header ports-section__head"
                style={{
                  ...accentStyle(row.accent),
                  top: row.top,
                  height: row.height,
                }}
              >
                <h2>{row.label}</h2>
                <span className="ports-section__count">{row.count ?? 0}</span>
              </header>
            );
          }

          return (
            <div
              key={`cards:${row.sectionKey}:${row.top}`}
              className="ports-vgrid__row"
              style={{ top: row.top, height: row.height }}
            >
              {(row.groups ?? []).map((group) => (
                <Fragment key={group.key}>{renderGroup(group)}</Fragment>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
