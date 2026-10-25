import { useEffect, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import type { PaletteCategory } from "./commandPaletteTypes";
import { PRIMARY_SCOPES, SCOPE_ORDER, SECONDARY_SCOPES } from "./commandPaletteScopes";

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
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const activeSecondary = SECONDARY_SCOPES.find((entry) => entry.id === scope);

  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) {
        setMoreOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen]);

  const select = (next: PaletteCategory) => {
    onSelectScope(next);
    setMoreOpen(false);
  };

  const shortcutFor = (id: PaletteCategory) => {
    const index = SCOPE_ORDER.indexOf(id);
    return index >= 0 && index < 9 ? `Alt ${index + 1}` : undefined;
  };

  const renderCount = (id: PaletteCategory) => {
    if (id === "all") return null;
    const count = scopeCounts[id] ?? 0;
    if (count <= 0) return null;
    return <span className="cp-scope-count">{count > 99 ? "99+" : count}</span>;
  };

  return (
    <div className="cp-scopes" role="tablist" aria-label={t("commandPalette.scopesLabel")}>
      <div className="cp-scopes-track">
        {PRIMARY_SCOPES.map((entry) => {
          const Icon = entry.icon;
          const isActive = entry.id === scope;
          const shortcut = shortcutFor(entry.id);
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`cp-scope${isActive ? " is-active" : ""}`}
              onClick={() => select(entry.id)}
              title={
                shortcut
                  ? `${t(entry.labelKey)} · ${shortcut}`
                  : t(entry.labelKey)
              }
            >
              <Icon size={13} aria-hidden="true" />
              <span>{t(entry.labelKey)}</span>
              {renderCount(entry.id)}
            </button>
          );
        })}

        {activeSecondary && (
          <button
            type="button"
            role="tab"
            aria-selected
            className="cp-scope is-active is-secondary"
            onClick={() => select("all")}
            title={t("commandPalette.clearScope")}
          >
            <activeSecondary.icon size={13} aria-hidden="true" />
            <span>{t(activeSecondary.labelKey)}</span>
            {renderCount(activeSecondary.id)}
            <X className="cp-scope-x" size={11} aria-hidden="true" />
          </button>
        )}

        <div ref={moreRef} className="cp-scope-more">
          <button
            type="button"
            className={`cp-scope cp-scope-more-btn${activeSecondary ? " is-active" : ""}`}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((open) => !open)}
            title={t("commandPalette.moreScopes")}
          >
            <span>{t("commandPalette.moreScopes")}</span>
            <ChevronDown size={12} aria-hidden="true" />
          </button>

          {moreOpen && (
            <div className="cp-scope-menu" role="menu">
              {SECONDARY_SCOPES.map((entry) => {
                const Icon = entry.icon;
                const isActive = entry.id === scope;
                const shortcut = shortcutFor(entry.id);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    className={`cp-scope-menu-item${isActive ? " is-active" : ""}`}
                    onClick={() => select(entry.id)}
                  >
                    <Icon size={14} aria-hidden="true" />
                    <span className="cp-scope-menu-label">{t(entry.labelKey)}</span>
                    {renderCount(entry.id)}
                    {shortcut && <kbd className="cp-kbd">{shortcut}</kbd>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
