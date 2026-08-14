import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Game } from "../../types/game";
import { PLAY_STATUS_DETAILS } from "../../types/game";
import { useLanguage } from "../../context/LanguageContext";
import type { LibraryGroupBy } from "./LibraryToolbar";

const VIRTUALIZE_THRESHOLD = 60;

interface LibraryVirtualGridProps {
  items: Game[];
  density: string;
  isBigScreen: boolean;
  editorial?: boolean;
  groupBy?: LibraryGroupBy;
  resetKey?: string;
  renderItem: (game: Game, index: number) => React.ReactNode;
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

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLElement | Window | null>(null);

  const isList = density === "list";
  const useGrouping = groupBy !== "none";

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

  const useVirtual = !useGrouping && items.length > VIRTUALIZE_THRESHOLD;

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

  useEffect(() => {
    if (!useVirtual) return;
    const container = containerRef.current;
    if (!container) return;
    const top =
      container instanceof Window
        ? window.scrollY || document.documentElement.scrollTop
        : container.scrollTop;
    if (top === 0) return;
    requestAnimationFrame(() => {
      const c = containerRef.current;
      if (!c) return;
      if (c instanceof Window) window.scrollTo({ top: 0 });
      else c.scrollTop = 0;
    });
  }, [resetKey, useVirtual]);

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

  // Grouped Mode
  if (useGrouping) {
    return (
      <div className="lib-grouped-container">
        {isList && renderListHeader()}

        {groups.map((group) => {
          const isCollapsed = collapsedGroups[group.id] || false;
          const icon = renderGroupIcon(groupBy, group.id);

          return (
            <section key={group.id} className="lib-group-section">
              <div
                className={`lib-group-header${isCollapsed ? " is-collapsed" : ""}`}
                onClick={() => toggleGroup(group.id)}
                role="button"
                tabIndex={0}
                aria-expanded={!isCollapsed}
              >
                <div className="lib-group-header-left">
                  <span className="lib-group-icon-badge" aria-hidden="true">
                    {icon}
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

              {!isCollapsed && (
                <div
                  className={`lib-cards density-${density}${isBigScreen ? " bigscreen-cards" : ""}${isList ? " lib-cards--list" : ""}`}
                >
                  {group.games.map((g, i) => renderItem(g, i))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    );
  }

  // Non-virtual flat mode
  if (!useVirtual) {
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

  // Virtualized flat grid for large collections
  const rowHeight =
    density === "compact" ? 220 : density === "cinematic" ? 420 : density === "list" ? 80 : 424;
  const gap = density === "compact" ? 12 : density === "cinematic" ? 24 : density === "list" ? 8 : 16;

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
    <div className="lib-grid-container">
      {isList && renderListHeader()}
      <div className="lib-grid-scroll" ref={scrollRef}>
        <div className="lib-grid-spacer" style={{ height: totalHeight }}>
          <div
            className={`lib-cards density-${density}${isBigScreen ? " bigscreen-cards" : ""}${editorial ? " lib-cards--editorial" : ""} lib-cards--virtual${isList ? " lib-cards--list" : ""}`}
            style={{ transform: `translateY(${firstRow * rowStride}px)` }}
          >
            {visible}
          </div>
        </div>
      </div>
    </div>
  );
}
