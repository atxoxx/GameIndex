// GameGrid — windowed console game grid for Big Screen Mode.
//
// Port of the LibraryVirtualGrid windowing pattern (see
// src/components/library/LibraryVirtualGrid.tsx) for the
// controller-first library: renders a fixed-height spacer that
// preserves the full scroll extent and absolutely-positions the
// visible row window inside it, translated by the current scroll
// offset. Only the visible rows of cards are mounted at any time, so
// multi-thousand-game libraries stay responsive without an external
// virtualization dependency (knowledge.md: no react-window).
//
// Row strides are measured at runtime from a painted card (the
// rem-scaled density pass shrinks cards to 9.25rem wide at some
// viewports), falling back to the base 2:3 card height until the
// first measurement lands.
//
// Focus restore
// ─────────────
// When the `games` list changes, the grid keeps the previously
// focused game focused if it is still in the list, otherwise it
// restores focus to the first item. The restore is skipped while a
// dialog/drawer is open (`isBigScreenOverlayOpen`) or while the user
// is typing in the search field, so focus is never yanked out of the
// filter drawer or the search box mid-interaction. Restores land on
// the real DOM element, which the GamepadProvider's `registerAction`
// focus listener picks up (it syncs `focusedRef` on native focus), so
// spatial navigation keeps working after a restore.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Game } from "../../types/game";
import BigScreenGameCard from "../library/BigScreenGameCard";
import { isBigScreenOverlayOpen } from "../../context/BigScreenContext";

const VIRTUALIZE_THRESHOLD = 60;

/** `.bigscreen-library-grid` column floor: `minmax(170px, 1fr)`. */
const CARD_MIN_WIDTH = 170;
/** `.bigscreen-library-grid` row gap (28px). */
const GAP = 28;
/** Default 2:3 card height at 170px wide; re-measured at runtime. */
const DEFAULT_CARD_HEIGHT = 255;
/** Rows of overscan mounted above/below the visible window. */
const OVERSCAN = 2;
/** Scroll inset used to land the restored row near the top. */
const FOCUS_SCROLL_MARGIN = 120;

interface GameGridProps {
  /** Filtered/sorted games to render in the grid. */
  games: Game[];
  /** Invoked when the user activates a card. */
  onSelect: (game: Game) => void;
  /** Rendered in place of the grid when `games` is empty. */
  emptyState?: ReactNode;
}

export default function GameGrid({
  games,
  onSelect,
  emptyState,
}: GameGridProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const [containerW, setContainerW] = useState(0);
  const [cardH, setCardH] = useState(DEFAULT_CARD_HEIGHT);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastFocusedIdRef = useRef<string | null>(null);
  const prevKeyRef = useRef<string | null>(null);
  const mountedRef = useRef(false);

  const useVirtual = games.length > VIRTUALIZE_THRESHOLD;

  // Identity of the current list — focus restore keys off this so
  // unrelated `games` array churn (running-state flips, playtime
  // ticks) doesn't fight the user's scroll position.
  const gamesKey = useMemo(() => games.map((g) => g.id).join("|"), [games]);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setViewportH(rect.height);
    setContainerW(rect.width);
    // Measure a painted card so the row stride survives the
    // rem-scaled density pass / breakpoint card sizes.
    const card = el.querySelector<HTMLElement>(".bigscreen-game-card");
    if (card) {
      const h = card.getBoundingClientRect().height;
      if (h > 0) setCardH(h);
    }
  }, []);

  // Window tracking: the grid container is itself the scroll owner
  // (`.bigscreen-library-grid-container { overflow-y: auto }`), so we
  // read scrollTop straight off it — no ancestor walk needed.
  useEffect(() => {
    if (!useVirtual) return;
    const el = scrollRef.current;
    if (!el) return;

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);

    const onScroll = () => setScrollTop(Math.max(0, el.scrollTop));
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, [useVirtual, measure]);

  // Track the last card that actually received focus so a list change
  // can restore to it. Focus events bubble in React (focusin-backed),
  // so capturing at the container catches every card.
  const handleFocusCapture = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
    const target = e.target as Element;
    const card = target.closest<HTMLElement>("[data-game-id]");
    if (card?.dataset.gameId) lastFocusedIdRef.current = card.dataset.gameId;
  }, []);

  const focusCard = useCallback(
    (id: string) => {
      const root = scrollRef.current;
      if (!root) return;
      const selector = `[data-game-id="${CSS.escape(id)}"]`;
      const el = root.querySelector<HTMLElement>(selector);
      if (el) {
        el.focus({ preventScroll: true });
        return;
      }
      // Virtualized out of the window — jump the scroll position to
      // its row first, then focus once the row has mounted.
      if (!useVirtual) return;
      const idx = games.findIndex((g) => g.id === id);
      if (idx < 0) return;
      const cols = Math.max(1, Math.floor((containerW + GAP) / (CARD_MIN_WIDTH + GAP)));
      const rowStride = cardH + GAP;
      const row = Math.floor(idx / cols);
      root.scrollTop = Math.max(0, row * rowStride - FOCUS_SCROLL_MARGIN);
      requestAnimationFrame(() => {
        root.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
      });
    },
    [games, useVirtual, containerW, cardH],
  );

  // Focus restore on list change.
  useEffect(() => {
    if (games.length === 0) return;
    const key = gamesKey;
    if (prevKeyRef.current === key) return;
    const wasMounted = mountedRef.current;
    prevKeyRef.current = key;
    if (!wasMounted) {
      mountedRef.current = true;
      return;
    }
    // Overlays (filter drawer, lightbox) own focus while open, and a
    // focused search input is the user typing — back off in both cases.
    if (isBigScreenOverlayOpen()) return;
    const active = document.activeElement;
    if (
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        (active as HTMLElement).isContentEditable)
    ) {
      return;
    }
    const targetId = games.some((g) => g.id === lastFocusedIdRef.current)
      ? lastFocusedIdRef.current
      : games[0].id;
    if (!targetId) return;
    focusCard(targetId);
  }, [gamesKey, games, focusCard]);

  if (games.length === 0) {
    return (
      <div className="bigscreen-library-grid-container" ref={scrollRef}>
        {emptyState}
      </div>
    );
  }

  if (!useVirtual) {
    return (
      <div
        className="bigscreen-library-grid-container"
        ref={scrollRef}
        onFocusCapture={handleFocusCapture}
      >
        <div className="bigscreen-library-grid">
          {games.map((game) => (
            <BigScreenGameCard
              key={game.id}
              game={game}
              onClick={() => onSelect(game)}
            />
          ))}
        </div>
      </div>
    );
  }

  const cols = Math.max(1, Math.floor((containerW + GAP) / (CARD_MIN_WIDTH + GAP)));
  const rowStride = cardH + GAP;
  const rowCount = Math.ceil(games.length / cols);
  const totalHeight = rowCount * cardH + (rowCount - 1) * GAP;

  const firstRow = Math.max(0, Math.floor(scrollTop / rowStride) - OVERSCAN);
  const visibleRows = Math.ceil(viewportH / rowStride) + OVERSCAN * 2;
  const lastRow = Math.min(rowCount - 1, firstRow + visibleRows);

  const visible: ReactNode[] = [];
  for (let r = firstRow; r <= lastRow; r++) {
    const start = r * cols;
    const rowItems = games.slice(start, start + cols);
    rowItems.forEach((g) =>
      visible.push(
        <BigScreenGameCard
          key={g.id}
          game={g}
          onClick={() => onSelect(g)}
        />,
      ),
    );
  }

  return (
    <div
      className="bigscreen-library-grid-container"
      ref={scrollRef}
      onFocusCapture={handleFocusCapture}
    >
      <div style={{ position: "relative", height: totalHeight }}>
        <div
          className="bigscreen-library-grid"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            transform: `translateY(${firstRow * rowStride}px)`,
          }}
        >
          {visible}
        </div>
      </div>
    </div>
  );
}
