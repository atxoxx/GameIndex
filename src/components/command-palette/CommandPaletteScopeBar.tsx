import { useCallback, useEffect, useRef, useState } from "react";
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
  ChevronDown,
  Check,
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  const activeIndex = Math.max(
    0,
    SCOPE_DEFINITIONS.findIndex((def) => def.id === scope)
  );
  const activeDef = SCOPE_DEFINITIONS[activeIndex];
  const ActiveIcon = activeDef.icon;

  const selectScope = useCallback(
    (id: PaletteCategory) => {
      onSelectScope(id);
      setOpen(false);
    },
    [onSelectScope]
  );

  // Focus the menu when it opens so arrow-key navigation works immediately
  useEffect(() => {
    if (open) {
      setHighlighted(activeIndex);
      menuRef.current?.focus();
    }
  }, [open, activeIndex]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const openMenu = () => {
    setOpen(true);
    setHighlighted(activeIndex);
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      openMenu();
    }
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      setHighlighted((prev) => (prev + 1) % SCOPE_DEFINITIONS.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      setHighlighted(
        (prev) => (prev - 1 + SCOPE_DEFINITIONS.length) % SCOPE_DEFINITIONS.length
      );
    } else if (e.key === "Home") {
      e.preventDefault();
      e.stopPropagation();
      setHighlighted(0);
    } else if (e.key === "End") {
      e.preventDefault();
      e.stopPropagation();
      setHighlighted(SCOPE_DEFINITIONS.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      const def = SCOPE_DEFINITIONS[highlighted];
      if (def) selectScope(def.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === "Tab") {
      // Hand the Tab back to the palette (scope cycling); close the menu
      setOpen(false);
    }
  };

  return (
    <div className="cmd-scope-dropdown-bar">
      <div className="cmd-scope-dropdown" ref={wrapRef}>
        <button
          ref={triggerRef}
          type="button"
          className="cmd-scope-dropdown-trigger"
          onClick={() => (open ? setOpen(false) : openMenu())}
          onKeyDown={handleTriggerKeyDown}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <ActiveIcon size={13} className="cmd-scope-dropdown-icon" />
          <span className="cmd-scope-dropdown-trigger-label">{t(activeDef.labelKey)}</span>
          {(scopeCounts[scope] ?? 0) > 0 && (
            <span className="cmd-scope-count">{scopeCounts[scope]}</span>
          )}
          {activeDef.prefix && <kbd className="cmd-chip-prefix">{activeDef.prefix}</kbd>}
          <ChevronDown size={13} className="cmd-scope-dropdown-chevron" />
        </button>

        {open && (
          <div
            ref={menuRef}
            className="cmd-scope-dropdown-menu"
            role="menu"
            tabIndex={-1}
            onKeyDown={handleMenuKeyDown}
          >
            {SCOPE_DEFINITIONS.map((def, idx) => {
              const Icon = def.icon;
              const count = scopeCounts[def.id] || 0;
              const isActive = def.id === scope;
              const isHighlighted = idx === highlighted;

              return (
                <button
                  key={def.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  className={`cmd-scope-dropdown-item${isActive ? " is-active" : ""}${
                    isHighlighted ? " is-highlighted" : ""
                  }`}
                  onClick={() => selectScope(def.id)}
                  onMouseEnter={() => setHighlighted(idx)}
                >
                  <Icon size={13} className="cmd-scope-dropdown-item-icon" />
                  <span className="cmd-scope-dropdown-item-label">{t(def.labelKey)}</span>
                  {count > 0 && <span className="cmd-scope-count">{count}</span>}
                  {def.prefix && <kbd className="cmd-chip-prefix">{def.prefix}</kbd>}
                  {isActive && <Check size={13} className="cmd-scope-dropdown-check" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}