import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Game } from "../../types/game";
import { PLAY_STATUS_DETAILS } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import type { LibraryGroupBy } from "./LibraryToolbar";

const VIRTUALIZE_THRESHOLD = 80;

interface LibraryVirtualGridProps {
  items: Game[];
  density: string;
  isBigScreen: boolean;
  editorial?: boolean;
  groupBy?: LibraryGroupBy;
  resetKey?: string;
  renderItem: (game: Game, index: number) => React.ReactNode;
}

function isWindow(target: HTMLElement | Window): target is Window {
  return target === window;
}

function findScrollContainer(el: HTMLElement | null): HTMLElement | Window {
  let node: HTMLElement | null = el?.parentElement ?? null;
  while (node) {
    const style = getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(style.overflowY)) return node;
    node = node.parentElement;
  }
  return window;
}

interface GameGroup {
  id: string;
  title: string;
  count: number;
  games: Game[];
  accentColor?: string;
}

interface GridMetrics {
  cols: number;
  rowStride: number;
  rowGap: number;
  headerHeight: number;
  headerGap: number;
  sectionGap: number;
}

interface GroupLayout {
  group: GameGroup;
  collapsed: boolean;
  cardsTop: number;
  cardsHeight: number;
  rows: number;
  firstRow: number;
  lastRow: number;
  topSpace: number;
  bottomSpace: number;
}

function sameMetrics(a: GridMetrics, b: GridMetrics): boolean {
  return (
    a.cols === b.cols &&
    a.rowStride === b.rowStride &&
    a.rowGap === b.rowGap &&
    a.headerHeight === b.headerHeight &&
    a.headerGap === b.headerGap &&
    a.sectionGap === b.sectionGap
  );
}

/** Rich visual icons for groups based on grouping type & key */
function renderGroupIcon(groupBy: LibraryGroupBy, id: string): ReactNode {
  const norm = id.toLowerCase();

  if (groupBy === "platform") {
    if (norm.includes("steam")) {
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true">
          <path d="M12 2a10 10 0 0 0-10 10c0 4.7 3.25 8.64 7.63 9.71l2.45-3.55a3.67 3.67 0 0 1-.08-.73c0-.18.02-.35.05-.53l-3.32-2.37a2.53 2.53 0 1 1 3.52-3.4l2.36 3.32c.17-.03.35-.05.53-.05 2.03 0 3.67 1.64 3.67 3.67s-1.64 3.67-3.67 3.67c-.24 0-.48-.03-.7-.08l-3.53 2.45A10 10 0 1 0 12 2z" />
        </svg>
      );
    }
    if (norm.includes("gog")) {
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12a4 4 0 1 0 4-4H8v4z" fill="var(--color-bg-primary)" />
        </svg>
      );
    }
    if (norm.includes("epic")) {
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true">
          <path d="M12 2L3 5v14l9 3 9-3V5l-9-3zm0 2.2l6.8 2.3v10.9L12 19.6l-6.8-2.2V6.5L12 4.2z" />
        </svg>
      );
    }
    if (norm.includes("local")) {
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      );
    }
    if (norm.includes("playstation") || norm.includes("ps4") || norm.includes("ps5")) {
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5v-9l7 4.5-7 4.5z" />
        </svg>
      );
    }
    if (norm.includes("xbox")) {
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="var(--color-bg-primary)" strokeWidth="2.5" />
        </svg>
      );
    }
    if (norm.includes("nintendo") || norm.includes("switch")) {
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true">
          <rect x="4" y="4" width="7" height="16" rx="3" />
          <rect x="13" y="4" width="7" height="16" rx="3" />
          <circle cx="7.5" cy="8.5" r="1.5" fill="var(--color-bg-primary)" />
          <circle cx="16.5" cy="15.5" r="1.5" fill="var(--color-bg-primary)" />
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    );
  }

  if (groupBy === "playStatus") {
    if (norm === "playing") {
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
      );
    }
    if (norm === "completed") {
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    }
    if (norm === "backlog") {
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
      );
    }
    if (norm === "on_hold") {
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
          <line x1="10" y1="4" x2="10" y2="20" />
          <line x1="14" y1="4" x2="14" y2="20" />
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
        <circle cx="12" cy="12" r="10" />
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
      </svg>
    );
  }

  if (groupBy === "releaseYear") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    );
  }

  if (groupBy === "genre") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16" aria-hidden="true">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    );
  }

  // Alphabetical
  return (
    <span className="lib-group-letter-badge" aria-hidden="true">
      {id.charAt(0)}
    </span>
  );
}

export default function LibraryVirtualGrid({
  items,
  density,
  isBigScreen,
  editorial,
  groupBy = "none",
  resetKey = "",
  renderItem,
}: LibraryVirtualGridProps) {
  const { t } = useLanguage();
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const [containerW, setContainerW] = useState(0);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [gridMetrics, setGridMetrics] = useState<GridMetrics | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLElement | Window | null>(null);

  const isList = density === "list";
  const useGrouping = groupBy !== "none";

  const isNarrow = containerW > 0 && containerW <= 950;
  const isUltraWide = containerW >= 2200;

  // List rows render `.lib-card--list` (~66px tall + 6px margin); a fixed
  // 72px track keeps the stride exact so virtual offsets never drift.
  const rowHeight = isList
    ? 72
    : density === "compact"
    ? (isNarrow ? 195 : isUltraWide ? 260 : 220)
    : density === "cinematic"
    ? (isNarrow ? 360 : isUltraWide ? 510 : 420)
    : (isNarrow ? 370 : isUltraWide ? 490 : 424);

  const gap = isList
    ? 0
    : density === "compact"
    ? (isNarrow ? 10 : isUltraWide ? 16 : 12)
    : density === "cinematic"
    ? (isNarrow ? 16 : isUltraWide ? 28 : 24)
    : (isNarrow ? 12 : isUltraWide ? 20 : 16);

  const minCol = density === "compact"
    ? (isNarrow ? 115 : isUltraWide ? 155 : 130)
    : density === "cinematic"
    ? (isNarrow ? 205 : isUltraWide ? 290 : 240)
    : density === "list"
    ? 99999
    : (isNarrow ? 150 : isUltraWide ? 215 : 180);

  // Build grouped structure when groupBy is active
  const groups: GameGroup[] = useMemo(() => {
    if (!useGrouping) return [];

    const map = new Map<string, { title: string; games: Game[] }>();

    for (const g of items) {
      let key = "other";
      let title = t("library.groupBy.other");

      if (groupBy === "platform") {
        key = g.platform || "Other";
        title = key;
      } else if (groupBy === "playStatus") {
        key = g.playStatus || "backlog";
        const meta = PLAY_STATUS_DETAILS[g.playStatus || "backlog"];
        title = meta ? t(meta.labelKey) : key;
      } else if (groupBy === "genre") {
        const firstGenre = g.genres && g.genres.length > 0 ? g.genres[0] : null;
        key = firstGenre || "none";
        title = firstGenre || t("library.groupBy.noGenre");
      } else if (groupBy === "releaseYear") {
        const y = g.releaseDate ? parseInt(g.releaseDate.substring(0, 4), 10) : null;
        if (!y || isNaN(y)) {
          key = "unknown";
          title = t("library.groupBy.noYear");
        } else if (y >= 2024) {
          key = "2024-2026";
          title = "2024–2026";
        } else if (y >= 2020) {
          key = "2020-2023";
          title = "2020–2023";
        } else if (y >= 2010) {
          key = "2010s";
          title = "2010–2019";
        } else if (y >= 2000) {
          key = "2000s";
          title = "2000–2009";
        } else {
          key = "retro";
          title = "Retro (< 2000)";
        }
      } else if (groupBy === "alphabetical") {
        const firstChar = (g.name || "").trim().charAt(0).toUpperCase();
        if (/[A-Z]/.test(firstChar)) {
          key = firstChar;
          title = firstChar;
        } else {
          key = "#";
          title = "# (0–9 / Symbols)";
        }
      }

      if (!map.has(key)) {
        map.set(key, { title, games: [] });
      }
      map.get(key)!.games.push(g);
    }

    // Convert map to sorted groups
    const result: GameGroup[] = [];
    map.forEach((value, id) => {
      result.push({
        id,
        title: value.title,
        count: value.games.length,
        games: value.games,
      });
    });

    if (groupBy === "alphabetical" || groupBy === "platform" || groupBy === "genre") {
      result.sort((a, b) => a.title.localeCompare(b.title));
    }

    return result;
  }, [items, groupBy, useGrouping, t]);

  const toggleGroup = (id: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const useVirtualFlat = !useGrouping && items.length > VIRTUALIZE_THRESHOLD;
  const useVirtualGrouped = useGrouping && items.length > VIRTUALIZE_THRESHOLD;
  const useVirtual = useVirtualFlat || useVirtualGrouped;

  const fallbackCols = density === "list" ? 1 : Math.max(1, Math.floor((containerW + gap) / (minCol + gap)));

  // Grouped mode keeps the browser's own `auto-fill` column layout, so the
  // virtual window has to measure what the grid actually resolved to rather
  // than trusting the flat-grid constants. Approximations cover first paint.
  const metrics = useMemo<GridMetrics>(
    () =>
      gridMetrics ?? {
        cols: fallbackCols,
        rowStride: rowHeight + gap,
        rowGap: gap,
        headerHeight: 50,
        headerGap: 8,
        sectionGap: 24,
      },
    [gridMetrics, fallbackCols, rowHeight, gap]
  );

  const readMetrics = useCallback((): GridMetrics | null => {
    const root = scrollRef.current;
    if (!root) return null;
    const card = root.querySelector<HTMLElement>(".lib-card");
    const cards = card?.closest<HTMLElement>(".lib-cards") ?? null;
    const section = cards?.closest<HTMLElement>(".lib-group-section") ?? null;
    const header = section?.querySelector<HTMLElement>(".lib-group-header");
    if (!card || !cards || !header) return null;

    const num = (value: string) => {
      const parsed = parseFloat(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const cardsStyle = getComputedStyle(cards);
    const rowGap = num(cardsStyle.rowGap);
    const rowStride = card.getBoundingClientRect().height + num(getComputedStyle(card).marginBottom) + rowGap;
    const cols = cardsStyle.gridTemplateColumns.split(/\s+/).filter(Boolean).length;
    const headerHeight = header.getBoundingClientRect().height;
    if (rowStride <= 0 || cols <= 0 || headerHeight <= 0) return null;

    const headerGap = section ? num(getComputedStyle(section).rowGap) : 0;
    const sectionGap = num(getComputedStyle(root).rowGap);

    return {
      cols,
      rowStride,
      rowGap,
      headerHeight,
      headerGap: headerGap || 8,
      sectionGap: sectionGap || 24,
    };
  }, []);

  useLayoutEffect(() => {
    if (!useVirtualGrouped) return;
    const next = readMetrics();
    if (!next) return;
    setGridMetrics((prev) => (prev && sameMetrics(prev, next) ? prev : next));
  }, [useVirtualGrouped, readMetrics, containerW, density, isBigScreen, groups, collapsedGroups]);

  // Flatten the groups into a single ordered row timeline. Headers stay in the
  // normal flow so their markup and spacing are untouched; only the game rows
  // inside each group are windowed.
  const groupLayouts = useMemo<GroupLayout[]>(() => {
    if (!useVirtualGrouped) return [];
    const { cols, rowStride, rowGap, headerHeight, headerGap, sectionGap } = metrics;
    const viewportBottom = scrollTop + viewportH;
    const overscanPx = rowStride * 2;

    let cursor = 0;
    return groups.map((group) => {
      const collapsed = collapsedGroups[group.id] || false;
      cursor += headerHeight;
      const cardsTop = cursor;
      let rows = 0;
      let cardsHeight = 0;
      if (!collapsed) {
        cursor += headerGap;
        rows = Math.ceil(group.games.length / cols);
        cardsHeight = rows * rowStride - rowGap;
        cursor += cardsHeight;
      }
      cursor += sectionGap;

      let firstRow = 0;
      let lastRow = rows - 1;
      if (rows > 0) {
        const intersects =
          cardsTop + cardsHeight >= scrollTop - overscanPx && cardsTop <= viewportBottom + overscanPx;
        if (intersects) {
          firstRow = Math.min(
            rows - 1,
            Math.max(0, Math.floor((scrollTop - overscanPx - cardsTop) / rowStride))
          );
          lastRow = Math.min(rows - 1, Math.ceil((viewportBottom + overscanPx - cardsTop) / rowStride) - 1);
          if (lastRow < firstRow) lastRow = firstRow;
        } else {
          // Nothing visible: a single top spacer reserves the group's height.
          firstRow = rows;
          lastRow = rows - 1;
        }
      }

      const topSpace = firstRow > 0 ? firstRow * rowStride - rowGap : 0;
      const hiddenBelow = rows - 1 - lastRow;
      const bottomSpace = hiddenBelow > 0 ? hiddenBelow * rowStride - rowGap : 0;

      return { group, collapsed, cardsTop, cardsHeight, rows, firstRow, lastRow, topSpace, bottomSpace };
    });
  }, [useVirtualGrouped, groups, collapsedGroups, metrics, scrollTop, viewportH]);

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const container = containerRef.current ?? findScrollContainer(el);
    setContainerW(el.clientWidth);
    const h = isWindow(container) ? window.innerHeight : container.clientHeight;
    if (h > 0) setViewportH(h);
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
    if (!isWindow(container)) ro.observe(container);
    window.addEventListener("resize", measure);

    let rafId = 0;
    const computeScrollTop = () => {
      const elRect = el.getBoundingClientRect();
      const containerRect = isWindow(container)
        ? { top: 0, height: window.innerHeight }
        : { top: container.getBoundingClientRect().top, height: container.clientHeight };
      const relativeTop = Math.max(0, containerRect.top - elRect.top);
      setScrollTop(relativeTop);
      if (containerRect.height > 0) setViewportH(containerRect.height);
      setContainerW(el.clientWidth);
    };
    computeScrollTop();

    const onScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        computeScrollTop();
      });
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener("resize", measure);
      container.removeEventListener("scroll", onScroll);
      containerRef.current = null;
    };
  }, [useVirtual, useVirtualFlat, useVirtualGrouped, measure]);

  useEffect(() => {
    if (!useVirtual) return;
    const container = containerRef.current;
    if (!container) return;
    const top = isWindow(container)
      ? window.scrollY || document.documentElement.scrollTop
      : container.scrollTop;
    if (top === 0) return;
    requestAnimationFrame(() => {
      const c = containerRef.current;
      if (!c) return;
      if (isWindow(c)) window.scrollTo({ top: 0 });
      else c.scrollTop = 0;
    });
  }, [resetKey, useVirtual, useVirtualFlat, useVirtualGrouped]);

  // List view table header component
  const renderListHeader = () => (
    <div className="lib-list-table-header" aria-hidden="true">
      <div className="lib-th-thumb" />
      <div className="lib-th-title">{t("library.table.title")}</div>
      <div className="lib-th-platform">{t("library.table.platform")}</div>
      <div className="lib-th-status">{t("library.table.status")}</div>
      <div className="lib-th-playtime">{t("library.table.playtime")}</div>
      <div className="lib-th-rating">{t("library.table.rating")}</div>
      <div className="lib-th-last-played">{t("library.table.lastPlayed")}</div>
      <div className="lib-th-actions">{t("library.table.actions")}</div>
    </div>
  );

  const renderGroupHeader = (group: GameGroup, isCollapsed: boolean) => (
    <div
      className={`lib-group-header${isCollapsed ? " is-collapsed" : ""}`}
      onClick={() => toggleGroup(group.id)}
      role="button"
      tabIndex={0}
      aria-expanded={!isCollapsed}
    >
      <div className="lib-group-header-left">
        <span className="lib-group-icon-badge" aria-hidden="true">
          {renderGroupIcon(groupBy, group.id)}
        </span>
        <h3 className="lib-group-title">{group.title}</h3>
        <span className="lib-group-count-pill">{group.count}</span>
      </div>

      <div className="lib-group-divider-line" aria-hidden="true" />

      <div className="lib-group-header-right">
        <span className="lib-group-toggle-text" aria-hidden="true">
          {isCollapsed ? t("common.show") : t("common.hide")}
        </span>
        <span className={`lib-group-toggle-icon${isCollapsed ? " is-collapsed" : ""}`} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </div>
    </div>
  );

  const cardsClassName = `lib-cards density-${density}${isBigScreen ? " bigscreen-cards" : ""}${isList ? " lib-cards--list" : ""}`;

  // Grouped Mode — small libraries keep the original fully-mounted layout.
  if (useGrouping && !useVirtualGrouped) {
    return (
      <div className="lib-grouped-container">
        {isList && renderListHeader()}

        {groups.map((group) => {
          const isCollapsed = collapsedGroups[group.id] || false;

          return (
            <section key={group.id} className="lib-group-section">
              {renderGroupHeader(group, isCollapsed)}

              {!isCollapsed && (
                <div className={cardsClassName}>
                  {group.games.map((g, i) => renderItem(g, i))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    );
  }

  // Grouped Mode — large libraries window each group's rows. Headers stay in
  // the document flow; spacers reserve the rows that scroll out of view.
  if (useGrouping && useVirtualGrouped) {
    const { cols } = metrics;
    return (
      <div className="lib-grouped-container" ref={scrollRef}>
        {isList && renderListHeader()}

        {groupLayouts.map((layout) => {
          const { group, collapsed, firstRow, lastRow, topSpace, bottomSpace } = layout;
          const sliceStart = firstRow * cols;
          const visibleGames = collapsed
            ? []
            : group.games.slice(sliceStart, (lastRow + 1) * cols);

          return (
            <section key={group.id} className="lib-group-section">
              {renderGroupHeader(group, collapsed)}

              {!collapsed && (
                <div className={cardsClassName}>
                  {topSpace > 0 && (
                    <div
                      className="lib-group-row-spacer"
                      aria-hidden="true"
                      style={{ gridColumn: "1 / -1", height: topSpace }}
                    />
                  )}
                  {visibleGames.map((g, i) => renderItem(g, sliceStart + i))}
                  {bottomSpace > 0 && (
                    <div
                      className="lib-group-row-spacer"
                      aria-hidden="true"
                      style={{ gridColumn: "1 / -1", height: bottomSpace }}
                    />
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    );
  }

  // Non-virtual flat mode
  if (!useVirtualFlat) {
    return (
      <div className="lib-grid-container">
        {isList && renderListHeader()}
        <div
          className={`lib-cards density-${density}${isBigScreen ? " bigscreen-cards" : ""}${editorial ? " lib-cards--editorial" : ""}${isList ? " lib-cards--list" : ""}`}
        >
          {items.map((g, i) => renderItem(g, i))}
        </div>
      </div>
    );
  }

  // Virtualized flat grid for large collections — dynamically scales across Handhelds, 1080p, 2K, and 4K
  const cols = density === "list" ? 1 : Math.max(1, Math.floor((containerW + gap) / (minCol + gap)));

  const rowCount = Math.ceil(items.length / cols);
  const totalHeight = rowCount * rowHeight + (rowCount - 1) * gap;

  const overscan = 4;
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
    <div className="lib-grid-container">
      {isList && renderListHeader()}
      <div className="lib-grid-scroll" ref={scrollRef}>
        <div className="lib-grid-spacer" style={{ height: totalHeight }}>
          <div
            className={`lib-cards density-${density}${isBigScreen ? " bigscreen-cards" : ""}${editorial ? " lib-cards--editorial" : ""} lib-cards--virtual${isList ? " lib-cards--list" : ""}`}
            style={{
              transform: `translateY(${firstRow * rowStride}px)`,
              gridTemplateColumns: isList ? "1fr" : `repeat(${cols}, minmax(0, 1fr))`,
              gap: `${gap}px`,
              gridAutoRows: isList ? `${rowHeight}px` : undefined,
            }}
          >
            {visible}
          </div>
        </div>
      </div>
    </div>
  );
}
