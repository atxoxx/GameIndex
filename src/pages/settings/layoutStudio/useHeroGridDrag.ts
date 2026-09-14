import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import {
  HERO_GRID_COLUMNS,
  HERO_GRID_MAX_ROWS,
  HERO_GRID_MIN_SPAN,
  type HeroGridItemKey,
  type HeroGridLayout,
  type HeroGridPlacement,
} from "../../../context/heroGrid";
import { HERO_ELEMENT_LABEL_KEY } from "../../../context/interfaceLayout";
import { useLanguage } from "../../../context/LanguageContext";

/**
 * useHeroGridDrag — pointer + keyboard editing for the Layout Studio's hero grid.
 *
 * The editor places hero elements on a fixed 12-column track by their cell rect
 * (see `heroGrid.ts`). This hook owns the interaction, not the rendering:
 *
 *  • Pointer drag starts on the element (move) or its edge handles (resize) and
 *    uses **pointer capture on the dragged element** — not window listeners and
 *    not HTML5 drag-and-drop, both of which are unreliable inside Tauri's
 *    WebKit/WebView2 shells.
 *  • Every move snaps to whole cells: the pointer position is converted to a
 *    cell and the item follows it. A ~4px dead-zone keeps a plain click a
 *    click (the caller swallows the trailing click via `movedRef`).
 *  • The live rect is held in `preview`; `onChange` is only called on a real
 *    `pointerup`, and discarded on `pointercancel` / `blur` / lost capture.
 *  • Overlap is allowed and never auto-corrected — the caller flags it.
 *
 * The cell math lives in the pure exports below so it can be unit-tested
 * without a DOM.
 */

/** Height of one implicit grid row in the studio, matching `--hero-grid-unit`. */
export const HERO_GRID_ROW_UNIT = 40;

/** Pointer travel (px) before a press counts as a drag instead of a click. */
export const HERO_GRID_DRAG_DEAD_ZONE = 4;

export type HeroGridResizeMode = "e" | "s" | "se";
export type HeroGridDragMode = "move" | HeroGridResizeMode;

export interface HeroGridCell {
  /** 1-based column on the track. */
  col: number;
  /** 1-based row on the track. */
  row: number;
}

/** The bit of `DOMRect` the cell math needs. */
export interface HeroGridRect {
  left: number;
  top: number;
  width: number;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.round(value), min), max);
}

/**
 * Convert a viewport point into a 1-based grid cell.
 *
 * Columns: the track is *not* `rect.width / columns` — the grid has horizontal
 * padding and `columns - 1` gaps, so the real track width is
 * `(width - padLeft - padRight - colGap * (columns - 1)) / columns`. The point
 * is measured from the padded content box's left edge and divided by the track
 * pitch (track + gap), or it would land about a column off mid-track.
 *
 * Rows: `rowUnit` is the implicit row height and `rowGap` the measured gap
 * between rows, so a point maps to the cell the user actually sees. Always
 * clamped into the track (1 … columns / max rows).
 */
export function pointerToGridCell(
  x: number,
  y: number,
  rect: HeroGridRect,
  columns: number = HERO_GRID_COLUMNS,
  rowUnit: number = HERO_GRID_ROW_UNIT,
  rowGap: number = 0,
  colGap: number = 0,
  padLeft: number = 0,
  padRight: number = 0,
): HeroGridCell {
  const safeColumns = Math.max(1, columns);
  const safeColGap = Math.max(0, colGap);
  const contentWidth = rect.width - padLeft - padRight;
  const trackWidth =
    contentWidth > 0
      ? (contentWidth - safeColGap * (safeColumns - 1)) / safeColumns
      : 0;
  const pitch = trackWidth + safeColGap;
  const rowHeight = Math.max(1, rowUnit + Math.max(0, rowGap));
  const col =
    trackWidth > 0 ? Math.floor((x - rect.left - padLeft) / pitch) + 1 : 1;
  const row = Math.floor((y - rect.top) / rowHeight) + 1;
  return {
    col: clampInt(col, 1, safeColumns),
    row: clampInt(row, 1, HERO_GRID_MAX_ROWS),
  };
}

/**
 * Move a placement so its *grabbed* cell lands on `pointer`. `grabCol`/`grabRow`
 * are the offset (in cells) between the pointer and the item's top-left at the
 * start of the drag, so the item doesn't jump under the cursor. The rect is
 * kept inside the track.
 */
export function moveGridPlacement(
  placement: HeroGridPlacement,
  pointer: HeroGridCell,
  grabCol: number,
  grabRow: number,
  columns: number = HERO_GRID_COLUMNS,
  maxRows: number = HERO_GRID_MAX_ROWS,
): HeroGridPlacement {
  const maxCol = Math.max(1, columns - placement.colSpan + 1);
  const maxRow = Math.max(1, maxRows - placement.rowSpan + 1);
  return {
    col: clampInt(pointer.col - grabCol, 1, maxCol),
    row: clampInt(pointer.row - grabRow, 1, maxRow),
    colSpan: placement.colSpan,
    rowSpan: placement.rowSpan,
  };
}

/**
 * Grow a placement from its top-left corner toward the pointer cell. `e` grows
 * columns, `s` grows rows, `se` grows both. Spans are clamped between the
 * per-key minimum and the track edge.
 */
export function resizeGridPlacement(
  key: HeroGridItemKey,
  placement: HeroGridPlacement,
  pointer: HeroGridCell,
  mode: HeroGridResizeMode,
  columns: number = HERO_GRID_COLUMNS,
  maxRows: number = HERO_GRID_MAX_ROWS,
): HeroGridPlacement {
  const min = HERO_GRID_MIN_SPAN[key];
  const maxColSpan = Math.max(1, columns - placement.col + 1);
  const maxRowSpan = Math.max(1, maxRows - placement.row + 1);
  let colSpan = placement.colSpan;
  let rowSpan = placement.rowSpan;
  if (mode === "e" || mode === "se") {
    colSpan = clampInt(
      pointer.col - placement.col + 1,
      Math.min(min.cols, maxColSpan),
      maxColSpan,
    );
  }
  if (mode === "s" || mode === "se") {
    rowSpan = clampInt(
      pointer.row - placement.row + 1,
      Math.min(min.rows, maxRowSpan),
      maxRowSpan,
    );
  }
  return { col: placement.col, row: placement.row, colSpan, rowSpan };
}

/**
 * Keyboard nudge. Without `resize`, moves the rect by a cell; with `resize`,
 * grows/shrinks the spans. Both respect the same clamps as the pointer paths.
 */
export function nudgeGridPlacement(
  key: HeroGridItemKey,
  placement: HeroGridPlacement,
  dCol: number,
  dRow: number,
  resize: boolean,
  columns: number = HERO_GRID_COLUMNS,
  maxRows: number = HERO_GRID_MAX_ROWS,
): HeroGridPlacement {
  if (resize) {
    const min = HERO_GRID_MIN_SPAN[key];
    const maxColSpan = Math.max(1, columns - placement.col + 1);
    const maxRowSpan = Math.max(1, maxRows - placement.row + 1);
    return {
      col: placement.col,
      row: placement.row,
      colSpan: clampInt(
        placement.colSpan + dCol,
        Math.min(min.cols, maxColSpan),
        maxColSpan,
      ),
      rowSpan: clampInt(
        placement.rowSpan + dRow,
        Math.min(min.rows, maxRowSpan),
        maxRowSpan,
      ),
    };
  }
  return moveGridPlacement(
    placement,
    { col: placement.col + dCol, row: placement.row + dRow },
    0,
    0,
    columns,
    maxRows,
  );
}

export interface UseHeroGridDragArgs {
  /** The authored layout, or null in flex mode (nothing to drag). */
  layout: HeroGridLayout | null;
  onChange: (next: HeroGridLayout) => void;
  gridRef: RefObject<HTMLElement | null>;
  /** Track width in columns (default 12). */
  columns?: number;
  /**
   * Fallback implicit row height, used only when the grid's computed
   * `--hero-grid-unit` can't be read (default 40).
   */
  rowUnit?: number;
}

export interface UseHeroGridDragResult {
  /** The element currently being dragged, or null. */
  activeKey: HeroGridItemKey | null;
  /** The interaction in flight, or null. */
  mode: HeroGridDragMode | null;
  /** Live layout during a drag; null at rest. */
  preview: HeroGridLayout | null;
  startMove: (key: HeroGridItemKey) => (e: ReactPointerEvent) => void;
  startResize: (
    key: HeroGridItemKey,
    mode: HeroGridResizeMode,
  ) => (e: ReactPointerEvent) => void;
  /** Keyboard move/resize (called from the item's arrow-key handler). */
  nudge: (key: HeroGridItemKey, dCol: number, dRow: number, resize: boolean) => void;
  /** aria-live text describing the current interaction. */
  statusMessage: string;
  /** True once a press became a real drag — callers swallow the trailing click. */
  movedRef: { current: boolean };
}

interface DragSession {
  key: HeroGridItemKey;
  mode: HeroGridDragMode;
  pointerId: number;
  target: HTMLElement;
  origin: HeroGridPlacement;
  base: HeroGridLayout;
  grabCol: number;
  grabRow: number;
  startX: number;
  startY: number;
  moved: boolean;
  cleanup: () => void;
}

export function useHeroGridDrag({
  layout,
  onChange,
  gridRef,
  columns = HERO_GRID_COLUMNS,
  rowUnit = HERO_GRID_ROW_UNIT,
}: UseHeroGridDragArgs): UseHeroGridDragResult {
  const { t } = useLanguage();

  // Latest-value refs so pointer handlers (created at drag start) always read
  // current args without re-subscribing mid-drag.
  const layoutRef = useRef(layout);
  const onChangeRef = useRef(onChange);
  const columnsRef = useRef(columns);
  const rowUnitRef = useRef(rowUnit);
  const translateRef = useRef(t);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    columnsRef.current = columns;
  }, [columns]);
  useEffect(() => {
    rowUnitRef.current = rowUnit;
  }, [rowUnit]);
  useEffect(() => {
    translateRef.current = t;
  }, [t]);

  const [activeKey, setActiveKey] = useState<HeroGridItemKey | null>(null);
  const [mode, setMode] = useState<HeroGridDragMode | null>(null);
  const [preview, setPreview] = useState<HeroGridLayout | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  const sessionRef = useRef<DragSession | null>(null);
  const previewRef = useRef<HeroGridLayout | null>(null);
  const movedRef = useRef(false);

  const readMetrics = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return null;
    const rect = grid.getBoundingClientRect();
    const style = getComputedStyle(grid);
    const px = (value: string, fallback: number) => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    return {
      rect: { left: rect.left, top: rect.top, width: rect.width },
      rowGap: px(style.rowGap, 0),
      colGap: px(style.columnGap, 0),
      padLeft: px(style.paddingLeft, 0),
      padRight: px(style.paddingRight, 0),
      // Read the unit straight from the stylesheet so the row math can't drift
      // from `--hero-grid-unit`; the prop stays as a fallback for tests/DOM.
      rowUnit: px(style.getPropertyValue("--hero-grid-unit"), rowUnitRef.current),
    };
  }, [gridRef]);

  const describe = useCallback(
    (key: HeroGridItemKey, placement: HeroGridPlacement, resizing: boolean) => {
      const translate = translateRef.current;
      const name = translate(HERO_ELEMENT_LABEL_KEY[key]);
      const cols = translate("settings.interface.heroGridSpanCols", {
        count: placement.colSpan,
      });
      const rows = translate("settings.interface.heroGridSpanRows", {
        count: placement.rowSpan,
      });
      const prefix = resizing
        ? `${translate("settings.interface.heroGridResize")} · `
        : "";
      return `${prefix}${name} · ${cols} × ${rows}`;
    },
    [],
  );

  const beginSession = useCallback(
    (key: HeroGridItemKey, dragMode: HeroGridDragMode, e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      const base = layoutRef.current;
      const metrics = readMetrics();
      const target = e.currentTarget as HTMLElement | null;
      if (!base || !metrics || !target) return;
      // Never let the press bubble to an outer list drag.
      e.stopPropagation();

      const pointer = pointerToGridCell(
        e.clientX,
        e.clientY,
        metrics.rect,
        columnsRef.current,
        metrics.rowUnit,
        metrics.rowGap,
        metrics.colGap,
        metrics.padLeft,
        metrics.padRight,
      );
      const origin = { ...base[key] };
      const grabCol = dragMode === "move" ? pointer.col - origin.col : 0;
      const grabRow = dragMode === "move" ? pointer.row - origin.row : 0;

      previewRef.current = base;
      movedRef.current = false;
      setActiveKey(key);
      setMode(dragMode);
      setStatusMessage(describe(key, origin, dragMode !== "move"));

      const pointerId = e.pointerId;
      const session: DragSession = {
        key,
        mode: dragMode,
        pointerId,
        target,
        origin,
        base,
        grabCol,
        grabRow,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        cleanup: () => {},
      };

      const finish = (commit: boolean) => {
        if (sessionRef.current !== session) return;
        session.cleanup();
        sessionRef.current = null;
        const committed = previewRef.current;
        if (commit && session.moved && committed) {
          const placed = committed[session.key];
          const unchanged =
            placed.col === session.origin.col &&
            placed.row === session.origin.row &&
            placed.colSpan === session.origin.colSpan &&
            placed.rowSpan === session.origin.rowSpan;
          // A drag that ends where it began is a no-op: emitting an identical
          // layout would still cost a state update + localStorage write.
          if (!unchanged) onChangeRef.current(committed);
        }
        movedRef.current = session.moved;
        previewRef.current = null;
        setActiveKey(null);
        setMode(null);
        setPreview(null);
      };

      const onMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const live = readMetrics();
        if (!live) return;
        if (!session.moved) {
          const dx = Math.abs(ev.clientX - session.startX);
          const dy = Math.abs(ev.clientY - session.startY);
          if (dx < HERO_GRID_DRAG_DEAD_ZONE && dy < HERO_GRID_DRAG_DEAD_ZONE) return;
          session.moved = true;
          movedRef.current = true;
        }
        const cell = pointerToGridCell(
          ev.clientX,
          ev.clientY,
          live.rect,
          columnsRef.current,
          live.rowUnit,
          live.rowGap,
          live.colGap,
          live.padLeft,
          live.padRight,
        );
        const nextPlacement =
          dragMode === "move"
            ? moveGridPlacement(
                origin,
                cell,
                grabCol,
                grabRow,
                columnsRef.current,
              )
            : resizeGridPlacement(
                key,
                origin,
                cell,
                dragMode,
                columnsRef.current,
              );
        const nextLayout: HeroGridLayout = {
          ...session.base,
          [key]: nextPlacement,
        };
        previewRef.current = nextLayout;
        setPreview(nextLayout);
        setStatusMessage(describe(key, nextPlacement, dragMode !== "move"));
      };

      const onUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        finish(true);
      };
      const onCancel = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        finish(false);
      };
      const onBlur = () => finish(false);
      const onLostCapture = (ev: PointerEvent) => {
        // Fires right after `pointerup` normally, but we remove the listeners
        // in `finish` first — so reaching here means capture was lost early.
        if (ev.pointerId !== pointerId) return;
        finish(false);
      };

      session.cleanup = () => {
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onCancel);
        target.removeEventListener("lostpointercapture", onLostCapture);
        target.removeEventListener("blur", onBlur);
        if (target.hasPointerCapture?.(pointerId)) {
          target.releasePointerCapture?.(pointerId);
        }
      };

      sessionRef.current = session;
      try {
        target.setPointerCapture(pointerId);
      } catch {
        /* capture unsupported — the element listeners still track within it */
      }
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onCancel);
      target.addEventListener("lostpointercapture", onLostCapture);
      target.addEventListener("blur", onBlur);
    },
    [describe, readMetrics],
  );

  const startMove = useCallback(
    (key: HeroGridItemKey) => (e: ReactPointerEvent) =>
      beginSession(key, "move", e),
    [beginSession],
  );

  const startResize = useCallback(
    (key: HeroGridItemKey, resizeMode: HeroGridResizeMode) =>
      (e: ReactPointerEvent) => beginSession(key, resizeMode, e),
    [beginSession],
  );

  const nudge = useCallback(
    (key: HeroGridItemKey, dCol: number, dRow: number, resize: boolean) => {
      const base = layoutRef.current;
      if (!base) return;
      const placement = nudgeGridPlacement(
        key,
        base[key],
        dCol,
        dRow,
        resize,
        columnsRef.current,
      );
      onChangeRef.current({ ...base, [key]: placement });
      setStatusMessage(describe(key, placement, resize));
    },
    [describe],
  );

  // A drag that never ends (unmount / navigation) must not strand listeners.
  useEffect(
    () => () => {
      sessionRef.current?.cleanup();
      sessionRef.current = null;
    },
    [],
  );

  // Dismissing the grid (reset to flex) mid-session must not leave the
  // click-swallow flag armed, or the next flex click would be eaten.
  useEffect(() => {
    if (!layout) {
      movedRef.current = false;
    }
  }, [layout]);

  return {
    activeKey,
    mode,
    preview,
    startMove,
    startResize,
    nudge,
    statusMessage,
    movedRef,
  };
}
