import { useEffect, useRef } from "react";
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
  History,
  Puzzle,
} from "lucide-react";
import type { PaletteCategory } from "./commandPaletteTypes";

export const SCOPE_DEFINITIONS: {
  id: PaletteCategory;
  labelKey: string;
  prefix?: string;
  icon: typeof Search;
}[] = [
  { id: "all", labelKey: "commandPalette.scopeAll", icon: Search },
  { id: "recent", labelKey: "commandPalette.scopeRecent", icon: History },
  { id: "games", labelKey: "commandPalette.scopeGames", prefix: "@", icon: Gamepad2 },
  { id: "mods", labelKey: "commandPalette.scopeMods", prefix: "%", icon: Puzzle },
  { id: "actions", labelKey: "commandPalette.scopeActions", prefix: ">", icon: Sparkles },
  { id: "navigation", labelKey: "commandPalette.scopeNavigation", prefix: "/", icon: Compass },
  { id: "store", labelKey: "commandPalette.scopeStore", prefix: "?", icon: Store },
  { id: "wishlist", labelKey: "commandPalette.scopeWishlist", prefix: "!", icon: Heart },
  { id: "downloads", labelKey: "commandPalette.scopeDownloads", prefix: "$", icon: Download },
  { id: "themes", labelKey: "commandPalette.scopeThemes", prefix: "#", icon: Palette },
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
  const ribbonRef = useRef<HTMLDivElement>(null);
  const activeBtnRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll active scope chip into view on selection change
  useEffect(() => {
    if (activeBtnRef.current) {
      activeBtnRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [scope]);

  return (
    <div className="cmd-scope-ribbon-bar" role="tablist" aria-label="Scope Selector">
      <div className="cmd-scope-ribbon-scroll" ref={ribbonRef}>
        {SCOPE_DEFINITIONS.map((def) => {
          const Icon = def.icon;
          const isActive = def.id === scope;
          const count = scopeCounts[def.id] || 0;

          return (
            <button
              key={def.id}
              ref={isActive ? activeBtnRef : undefined}
              type="button"
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              className={`cmd-scope-ribbon-pill${isActive ? " is-active" : ""}`}
              onClick={() => onSelectScope(def.id)}
            >
              <Icon size={12} className="cmd-scope-pill-icon" />
              <span className="cmd-scope-pill-label">{t(def.labelKey)}</span>
              {count > 0 && <span className="cmd-scope-pill-count">{count}</span>}
              {def.prefix && <kbd className="cmd-scope-pill-prefix">{def.prefix}</kbd>}
            </button>
          );
        })}
      </div>
    </div>
  );
}