import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Layers, Plus } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import type { PlayStatus } from "../../types/game";
import { shelfDisplayName, type Shelf } from "../../types/shelf";
import { ShelfIcon } from "../shelves/ShelfIcon";

export type LibraryScope = "all" | "installed" | PlayStatus;

interface LibraryScopeBarProps {
  total: number;
  installed: number;
  playStatusCounts: Record<PlayStatus, number>;
  /** Scope facet values from the shared filter state. */
  status: "all" | "installed" | "not_installed";
  playStatus: PlayStatus | "all";
  /** Shelves, when the feature is enabled. */
  shelves: Shelf[];
  activeShelf: Shelf | null;
  shelfCount: (id: string) => number;
  onSelectScope: (scope: LibraryScope) => void;
  onSelectShelf: (id: string) => void;
  onCreateShelf: () => void;
}

const SCOPE_ORDER: { id: LibraryScope; labelKey: string; dot?: string }[] = [
  { id: "all", labelKey: "common.all" },
  { id: "playing", labelKey: "game.status.playing", dot: "playing" },
  { id: "backlog", labelKey: "game.status.backlog", dot: "backlog" },
  { id: "completed", labelKey: "game.status.completed", dot: "completed" },
  { id: "installed", labelKey: "filter.installed", dot: "installed" },
];

/**
 * LibraryScopeBar — the top row of the command bar.
 *
 * Five live-count scopes cover the states people actually browse by, and the
 * Shelves menu holds the named collections rather than repeating every
 * stored shelf as a permanent tab.
 */
export default function LibraryScopeBar({
  total,
  installed,
  playStatusCounts,
  status,
  playStatus,
  shelves,
  activeShelf,
  shelfCount,
  onSelectScope,
  onSelectShelf,
  onCreateShelf,
}: LibraryScopeBarProps) {
  const { t } = useLanguage();
  const [shelvesOpen, setShelvesOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!shelvesOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      setShelvesOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShelvesOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [shelvesOpen]);

  const countFor = (scope: LibraryScope): number => {
    if (scope === "all") return total;
    if (scope === "installed") return installed;
    return playStatusCounts[scope] ?? 0;
  };

  const isScopeActive = (scope: LibraryScope): boolean => {
    if (activeShelf) return false;
    if (scope === "all") return status === "all" && playStatus === "all";
    if (scope === "installed") return status === "installed";
    return status === "all" && playStatus === scope;
  };

  return (
    <div className="library-scopes">
      <div className="library-scopes-list" role="tablist" aria-label={t("nav.library")}>
        {SCOPE_ORDER.map((scope) => {
          const active = isScopeActive(scope.id);
          return (
            <button
              key={scope.id}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={`library-scope${active ? " is-active" : ""}`}
              onClick={() => onSelectScope(scope.id)}
            >
              {scope.dot && (
                <span
                  className={`library-scope-dot library-scope-dot--${scope.dot}`}
                  aria-hidden="true"
                />
              )}
              <span className="library-scope-label">{t(scope.labelKey)}</span>
              <span className="library-scope-count">{countFor(scope.id)}</span>
            </button>
          );
        })}
      </div>

      {shelves.length > 0 && (
        <div className="library-scope-shelves" ref={rootRef}>
          <button
            type="button"
            className={`library-scope library-scope--shelves${activeShelf ? " is-active" : ""}`}
            aria-haspopup="menu"
            aria-expanded={shelvesOpen}
            onClick={() => setShelvesOpen((open) => !open)}
          >
            <Layers size={13} aria-hidden="true" />
            <span className="library-scope-label">
              {activeShelf ? shelfDisplayName(activeShelf.name, t) : t("shelves.title")}
            </span>
            <ChevronDown size={13} className="library-scope-chevron" aria-hidden="true" />
          </button>

          {shelvesOpen && (
            <div className="library-shelves-menu" role="menu" aria-label={t("shelves.title")}>
              <div className="library-shelves-menu-list">
                {shelves.map((shelf) => {
                  const active = activeShelf?.id === shelf.id;
                  return (
                    <button
                      key={shelf.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      className={`library-shelves-item${active ? " is-active" : ""}`}
                      onClick={() => {
                        setShelvesOpen(false);
                        onSelectShelf(shelf.id);
                      }}
                    >
                      <span
                        className="library-shelves-item-icon"
                        style={{ ["--shelf-swatch" as string]: `var(--color-${shelf.color})` }}
                      >
                        <ShelfIcon name={shelf.icon} size={14} />
                      </span>
                      <span className="library-shelves-item-name">
                        {shelfDisplayName(shelf.name, t)}
                      </span>
                      <span className="library-shelves-item-count">{shelfCount(shelf.id)}</span>
                      {active && <Check size={13} className="library-shelves-item-check" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="library-shelves-create"
                onClick={() => {
                  setShelvesOpen(false);
                  onCreateShelf();
                }}
              >
                <Plus size={14} aria-hidden="true" />
                {t("shelves.create")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
