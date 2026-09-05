import { useRef, useState, useEffect, useCallback } from "react";
import {
  Search,
  Gamepad2,
  Heart,
  Sparkles,
  Compass,
  Palette,
  Download,
  Store,
  Calculator,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { PaletteCategory } from "./commandPaletteTypes";

export const SCOPE_DEFINITIONS: {
  id: PaletteCategory;
  labelKey: string;
  prefix?: string;
  icon: typeof Search;
}[] = [
  { id: "all", labelKey: "commandPalette.scopeAll", icon: Search },
  { id: "games", labelKey: "commandPalette.scopeGames", prefix: "@", icon: Gamepad2 },
  { id: "wishlist", labelKey: "commandPalette.scopeWishlist", prefix: "!", icon: Heart },
  { id: "actions", labelKey: "commandPalette.scopeActions", prefix: ">", icon: Sparkles },
  { id: "navigation", labelKey: "commandPalette.scopeNavigation", prefix: "/", icon: Compass },
  { id: "themes", labelKey: "commandPalette.scopeThemes", prefix: "#", icon: Palette },
  { id: "downloads", labelKey: "commandPalette.scopeDownloads", prefix: "$", icon: Download },
  { id: "store", labelKey: "commandPalette.scopeStore", prefix: "?", icon: Store },
  { id: "utility", labelKey: "commandPalette.scopeUtility", prefix: "~", icon: Calculator },
];

interface CommandPaletteScopeBarProps {
  scope: PaletteCategory;
  onSelectScope: (scope: PaletteCategory) => void;
  scopeCounts: Record<PaletteCategory, number>;
  t: (key: string, vars?: Record<string, unknown>) => string;
}

export default function CommandPaletteScopeBar({
  scope,
  onSelectScope,
  scopeCounts,
  t,
}: CommandPaletteScopeBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    checkScroll();
    window.addEventListener("resize", checkScroll);
    return () => window.removeEventListener("resize", checkScroll);
  }, [checkScroll, scopeCounts]);

  const handleWheel = (e: React.WheelEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) {
      el.scrollLeft += e.deltaY;
      checkScroll();
    }
  };

  const scrollByAmount = (amt: number) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: amt, behavior: "smooth" });
    setTimeout(checkScroll, 200);
  };

  return (
    <div className={`cmd-scope-container${canScrollLeft ? " can-scroll-left" : ""}${canScrollRight ? " can-scroll-right" : ""}`}>
      {canScrollLeft && (
        <button
          type="button"
          className="cmd-scope-scroll-arrow cmd-scope-scroll-left"
          onClick={() => scrollByAmount(-120)}
          aria-label="Scroll left"
        >
          <ChevronLeft size={13} />
        </button>
      )}

      <div
        ref={scrollRef}
        className="cmd-scope-bar"
        onScroll={checkScroll}
        onWheel={handleWheel}
        role="tablist"
        aria-label="Filter Categories"
      >
        {SCOPE_DEFINITIONS.map((def) => {
          const isActive = scope === def.id;
          const Icon = def.icon;
          const count = scopeCounts[def.id] || 0;

          return (
            <button
              key={def.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`cmd-scope-chip${isActive ? " active" : ""}`}
              onClick={() => onSelectScope(def.id)}
            >
              <Icon size={12} className="cmd-scope-chip-icon" />
              <span>{t(def.labelKey)}</span>
              {count > 0 && <span className="cmd-scope-count">{count}</span>}
              {def.prefix && <kbd className="cmd-chip-prefix">{def.prefix}</kbd>}
            </button>
          );
        })}
      </div>

      {canScrollRight && (
        <button
          type="button"
          className="cmd-scope-scroll-arrow cmd-scope-scroll-right"
          onClick={() => scrollByAmount(120)}
          aria-label="Scroll right"
        >
          <ChevronRight size={13} />
        </button>
      )}
    </div>
  );
}
