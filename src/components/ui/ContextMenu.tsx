import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight } from "lucide-react";

const VIEWPORT_MARGIN = 8;
const SUBMENU_GAP = 4;

export interface ContextMenuAction {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  accent?: boolean;
  active?: boolean;
  /** Color dot rendered before the label (status-style submenu entries). */
  swatch?: string;
  submenu?: ContextMenuAction[];
}

export interface ContextMenuSeparator {
  id: string;
  separator: true;
}

export type ContextMenuItem = ContextMenuAction | ContextMenuSeparator;

export interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  /** Optional header content (title, badges, meta). */
  header?: ReactNode;
  ariaLabel?: string;
  className?: string;
}

export function isContextMenuSeparator(
  item: ContextMenuItem
): item is ContextMenuSeparator {
  return "separator" in item;
}

/**
 * ContextMenu
 * ───────────
 * Generic right-click menu: portaled to `document.body`, measured against
 * the viewport, scrollable on short screens, fully keyboard navigable and
 * with nested submenus. Callers supply a flat item list; the menu owns
 * dismissal, focus tracking and submenu placement.
 */
export default function ContextMenu({
  x,
  y,
  items,
  onClose,
  header,
  ariaLabel,
  className,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [pos, setPos] = useState({ left: x, top: y });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const [submenuIndex, setSubmenuIndex] = useState(0);

  const actions = items.filter((item): item is ContextMenuAction => !isContextMenuSeparator(item));

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - VIEWPORT_MARGIN) {
      left = Math.max(VIEWPORT_MARGIN, x - rect.width);
    }
    if (top + rect.height > window.innerHeight - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN);
    }
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    setActiveId(null);
    setOpenSubmenu(null);
    setSubmenuIndex(0);
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (target.closest("[data-context-menu]")) return;
      onClose();
    };
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-context-menu]")) return;
      onClose();
    };
    const onScroll = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target && (menuRef.current?.contains(target) || target.closest?.("[data-context-menu]"))) {
        return;
      }
      onClose();
    };
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("resize", onScroll);
    window.addEventListener("blur", onScroll);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("blur", onScroll);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  const activeSubmenu = actions.find((item) => item.id === openSubmenu)?.submenu ?? null;

  const openItemSubmenu = useCallback((item: ContextMenuAction) => {
    if (!item.submenu) return;
    setOpenSubmenu(item.id);
    setSubmenuIndex(0);
    setActiveId(item.id);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Tab") {
        onClose();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (openSubmenu) {
          setOpenSubmenu(null);
        } else {
          onClose();
        }
        return;
      }

      const currentIndex = Math.max(
        0,
        actions.findIndex((item) => item.id === activeId)
      );

      if (activeSubmenu && openSubmenu) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const delta = e.key === "ArrowDown" ? 1 : -1;
          setSubmenuIndex((prev) => (prev + delta + activeSubmenu.length) % activeSubmenu.length);
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setOpenSubmenu(null);
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activeSubmenu[submenuIndex]?.onSelect?.();
          return;
        }
      }

      const move = (delta: number) => {
        e.preventDefault();
        if (actions.length === 0) return;
        if (!activeId) {
          const first = actions.find((item) => !item.disabled);
          if (!first) return;
          setActiveId(first.id);
          setOpenSubmenu(null);
          itemRefs.current[first.id]?.scrollIntoView({ block: "nearest" });
          return;
        }
        let next = currentIndex;
        for (let step = 0; step < actions.length; step++) {
          next = (next + delta + actions.length) % actions.length;
          if (!actions[next].disabled) break;
        }
        setActiveId(actions[next].id);
        setOpenSubmenu(null);
        itemRefs.current[actions[next].id]?.scrollIntoView({ block: "nearest" });
      };

      switch (e.key) {
        case "ArrowDown":
          move(1);
          break;
        case "ArrowUp":
          move(-1);
          break;
        case "Home":
          e.preventDefault();
          setActiveId(actions.find((item) => !item.disabled)?.id ?? null);
          setOpenSubmenu(null);
          break;
        case "End": {
          e.preventDefault();
          const last = [...actions].reverse().find((item) => !item.disabled);
          setActiveId(last?.id ?? null);
          setOpenSubmenu(null);
          break;
        }
        case "ArrowRight": {
          const item = actions[currentIndex];
          if (item?.submenu) {
            e.preventDefault();
            openItemSubmenu(item);
          }
          break;
        }
        case "Enter":
        case " ": {
          const item = actions[currentIndex];
          if (!item || item.disabled) return;
          e.preventDefault();
          if (item.submenu) openItemSubmenu(item);
          else item.onSelect?.();
          break;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [actions, activeId, activeSubmenu, onClose, openItemSubmenu, openSubmenu, submenuIndex]);

  return createPortal(
    <>
      <div
        ref={menuRef}
        className={`context-menu ctx-menu${className ? ` ${className}` : ""}`}
        data-context-menu="true"
        role="menu"
        aria-label={ariaLabel}
        tabIndex={-1}
        style={{ left: pos.left, top: pos.top }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
        onScroll={() => setOpenSubmenu(null)}
      >
        {header && <div className="ctx-menu__header">{header}</div>}

        {items.map((item) =>
          isContextMenuSeparator(item) ? (
            <div key={item.id} className="context-menu-separator" role="separator" />
          ) : (
            <div
              key={item.id}
              ref={(el) => {
                itemRefs.current[item.id] = el;
              }}
              role="menuitem"
              aria-haspopup={item.submenu ? "menu" : undefined}
              aria-expanded={item.submenu ? openSubmenu === item.id : undefined}
              aria-disabled={item.disabled || undefined}
              className={`context-menu-item${item.accent ? " play-action" : ""}${
                item.danger ? " remove-action" : ""
              }${item.disabled ? " is-disabled" : ""}${
                activeId === item.id ? " is-active" : ""
              }${item.submenu ? " has-submenu" : ""}${
                openSubmenu === item.id ? " submenu-open" : ""
              }`}
              onClick={() => {
                if (item.disabled) return;
                if (item.submenu) {
                  if (openSubmenu === item.id) setOpenSubmenu(null);
                  else openItemSubmenu(item);
                } else {
                  item.onSelect?.();
                }
              }}
              onMouseEnter={() => {
                setActiveId(item.id);
                if (item.submenu) openItemSubmenu(item);
                else setOpenSubmenu(null);
              }}
            >
              <span className="ctx-icon">{item.icon}</span>
              <span className="ctx-label">{item.label}</span>
              {item.submenu && <ChevronRight className="ctx-chevron" size={13} aria-hidden="true" />}
            </div>
          )
        )}
      </div>

      {activeSubmenu && openSubmenu && (
        <ContextSubmenu
          triggerRef={() => itemRefs.current[openSubmenu]}
          entries={activeSubmenu}
          activeIndex={submenuIndex}
          onHoverEntry={setSubmenuIndex}
          onSelect={(entry) => entry.onSelect?.()}
        />
      )}
    </>,
    document.body
  );
}

function ContextSubmenu({
  triggerRef,
  entries,
  activeIndex,
  onHoverEntry,
  onSelect,
}: {
  triggerRef: () => HTMLElement | null;
  entries: ContextMenuAction[];
  activeIndex: number;
  onHoverEntry: (index: number) => void;
  onSelect: (entry: ContextMenuAction) => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const computePosition = useCallback(() => {
    const trigger = triggerRef();
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const rect = trigger.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    let left = rect.right + SUBMENU_GAP;
    if (left + width > window.innerWidth - VIEWPORT_MARGIN) {
      left = Math.max(VIEWPORT_MARGIN, rect.left - width - SUBMENU_GAP);
    }
    let top = rect.top - SUBMENU_GAP;
    if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
    }
    setPos({ left, top });
  }, [triggerRef]);

  useLayoutEffect(() => {
    computePosition();
  }, [computePosition, entries.length]);

  useEffect(() => {
    window.addEventListener("resize", computePosition);
    return () => window.removeEventListener("resize", computePosition);
  }, [computePosition]);

  return createPortal(
    <div
      ref={panelRef}
      className="context-menu ctx-menu ctx-submenu"
      data-context-menu="true"
      role="menu"
      style={{
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos ? "visible" : "hidden",
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, index) => (
        <div
          key={entry.id}
          role="menuitem"
          className={`context-menu-item ctx-submenu__item${
            index === activeIndex ? " is-active" : ""
          }${entry.active ? " is-selected" : ""}${entry.disabled ? " is-disabled" : ""}`}
          onClick={() => {
            if (!entry.disabled) onSelect(entry);
          }}
          onMouseEnter={() => onHoverEntry(index)}
        >
          {entry.swatch ? (
            <span className="ctx-swatch" style={{ background: entry.swatch }} aria-hidden="true" />
          ) : entry.icon ? (
            <span className="ctx-icon">{entry.icon}</span>
          ) : (
            <span className="ctx-icon" aria-hidden="true" />
          )}
          <span className="ctx-label">{entry.label}</span>
          {entry.active && <Check className="ctx-check" size={13} aria-hidden="true" />}
        </div>
      ))}
    </div>,
    document.body
  );
}
