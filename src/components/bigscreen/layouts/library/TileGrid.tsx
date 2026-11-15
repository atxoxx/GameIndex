// Windowed game grid for the layout libraries.
//
// Mirrors the proven approach in `GameGrid` (fixed-height spacer + an
// absolutely positioned visible row window) but renders the new layout
// tiles, so the library matches the home shelves. The scroll container
// keeps the `bigscreen-library-grid-container` class on purpose: the
// spatial engine treats that class as a GRID (row-wrap heuristics)
// rather than a wrapping rail.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import type { Game } from "../../../../types/game";
import { isBigScreenOverlayOpen } from "../../../../context/BigScreenContext";
import {
  scrollElementIntoViewControlled,
  scrollMargins,
} from "../../../../hooks/gamepad/gamepadUtils";
import { parseFocusGameKey, recallFocus } from "../../../../utils/focusMemory";
import { GameTile, type TileVariant } from "../shared";

const VIRTUALIZE_THRESHOLD = 36;
const OVERSCAN = 2;

interface TileGridProps {
  games: Game[];
  onSelect: (game: Game) => void;
  railId: string;
  variant?: TileVariant;
  autoFocusFirst?: boolean;
  empty?: ReactNode;
  className?: string;
}

export default function TileGrid({
  games,
  onSelect,
  railId,
  variant = "poster",
  autoFocusFirst = false,
  empty,
  className,
}: TileGridProps) {
  const location = useLocation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastFocusedIdRef = useRef<string | null>(null);
  const prevKeyRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const didInitialFocusRef = useRef(false);

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const [rowStride, setRowStride] = useState(0);
  const [cols, setCols] = useState(0);

  const useVirtual = games.length > VIRTUALIZE_THRESHOLD;
  const gamesKey = useMemo(() => games.map((game) => game.id).join("|"), [games]);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.height > 0) setViewportH(rect.height);

    const grid = el.querySelector<HTMLElement>(".bst-grid");
    if (grid) {
      const style = getComputedStyle(grid);
      const columnCount = (style.gridTemplateColumns || "")
        .split(" ")
        .filter(Boolean).length;
      if (columnCount > 0) setCols(columnCount);
      const rowGap = parseFloat(style.rowGap) || 0;
      const tile = grid.querySelector<HTMLElement>(".bst-tile");
      const tileH = tile?.getBoundingClientRect().height ?? 0;
      if (tileH > 0) setRowStride(tileH + rowGap);
    }
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    const grid = el.querySelector<HTMLElement>(".bst-grid");
    if (grid) observer.observe(grid);

    const onScroll = () => setScrollTop(Math.max(0, el.scrollTop));
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, [measure, useVirtual]);

  const handleFocusCapture = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const card = (event.target as Element).closest<HTMLElement>("[data-game-id]");
      if (card?.dataset.gameId) lastFocusedIdRef.current = card.dataset.gameId;
    },
    [],
  );

  const focusCard = useCallback(
    (id: string) => {
      const root = scrollRef.current;
      if (!root) return;
      const selector = `[data-game-id="${CSS.escape(id)}"]`;
      const existing = root.querySelector<HTMLElement>(selector);
      if (existing) {
        existing.focus({ preventScroll: true });
        scrollElementIntoViewControlled(existing);
        return;
      }
      if (!useVirtual || cols <= 0 || rowStride <= 0) return;
      const index = games.findIndex((game) => game.id === id);
      if (index < 0) return;
      const row = Math.floor(index / cols);
      root.scrollTop = Math.max(0, row * rowStride - scrollMargins().top);
      requestAnimationFrame(() => {
        const mounted = root.querySelector<HTMLElement>(selector);
        mounted?.focus({ preventScroll: true });
        if (mounted) scrollElementIntoViewControlled(mounted);
      });
    },
    [cols, games, rowStride, useVirtual],
  );

  // Focus restore when the filtered list changes underneath the user.
  useEffect(() => {
    if (games.length === 0) return;
    if (prevKeyRef.current === gamesKey) return;
    const wasMounted = mountedRef.current;
    prevKeyRef.current = gamesKey;
    if (!wasMounted) {
      mountedRef.current = true;
      return;
    }
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
    const target = games.some((game) => game.id === lastFocusedIdRef.current)
      ? lastFocusedIdRef.current
      : games[0]?.id;
    if (target) focusCard(target);
  }, [gamesKey, games, focusCard]);

  useEffect(() => {
    if (!autoFocusFirst) return;
    if (didInitialFocusRef.current) return;
    if (games.length === 0) return;
    if (useVirtual && (cols === 0 || rowStride === 0)) return;
    didInitialFocusRef.current = true;
    if (recallFocus(location.pathname)) return;
    focusCard(games[0].id);
  }, [
    autoFocusFirst,
    cols,
    focusCard,
    games,
    location.pathname,
    rowStride,
    useVirtual,
  ]);

  useEffect(() => {
    const onFocusGame = (event: Event) => {
      const parsed = parseFocusGameKey(
        `game:${(event as CustomEvent<string>).detail}`,
      );
      if (!parsed) return;
      if (parsed.railId && parsed.railId !== railId) return;
      if (!games.some((game) => game.id === parsed.gameId)) return;
      focusCard(parsed.gameId);
    };
    window.addEventListener("bigscreen:focus-game", onFocusGame);
    return () => window.removeEventListener("bigscreen:focus-game", onFocusGame);
  }, [focusCard, games, railId]);

  if (games.length === 0) {
    return (
      <div
        className={`bigscreen-library-grid-container bst-grid-scroll ${className ?? ""}`}
        ref={scrollRef}
        data-rail-id={railId}
      >
        {empty}
      </div>
    );
  }

  const gridInner = (list: Game[], offset: number, absolute: boolean) => (
    <div
      className="bst-grid"
      style={
        absolute
          ? {
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              transform: `translateY(${offset}px)`,
            }
          : undefined
      }
    >
      {list.map((game, i) => (
        <GameTile
          key={game.id}
          game={game}
          variant={variant}
          onSelect={onSelect}
          index={i}
          autoFocus={autoFocusFirst && offset === 0 && i === 0}
        />
      ))}
    </div>
  );

  if (!useVirtual) {
    return (
      <div
        className={`bigscreen-library-grid-container bst-grid-scroll ${className ?? ""}`}
        ref={scrollRef}
        data-rail-id={railId}
        onFocusCapture={handleFocusCapture}
      >
        {gridInner(games, 0, false)}
      </div>
    );
  }

  const columnCount = Math.max(1, cols);
  const rowCount = Math.ceil(games.length / columnCount);
  const stride = rowStride > 0 ? rowStride : 280;
  const totalHeight = rowCount * stride;
  const firstRow = Math.max(0, Math.floor(scrollTop / stride) - OVERSCAN);
  const rowWindow = Math.ceil(viewportH / stride) + OVERSCAN * 2;
  const lastRow = Math.min(rowCount - 1, firstRow + rowWindow);
  const start = firstRow * columnCount;
  const end = Math.min(games.length, (lastRow + 1) * columnCount);

  return (
    <div
      className={`bigscreen-library-grid-container bst-grid-scroll ${className ?? ""}`}
      ref={scrollRef}
      data-rail-id={railId}
      onFocusCapture={handleFocusCapture}
    >
      <div style={{ position: "relative", height: totalHeight }}>
        {gridInner(games.slice(start, end), firstRow * stride, true)}
      </div>
    </div>
  );
}
