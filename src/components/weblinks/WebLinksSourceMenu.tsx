import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Check, LayoutGrid, Settings2 } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { ChevronDownIcon } from "./WebLinksIcons";
import { MY_LINKS_KEY } from "./sources";
import { groupSourcesByCategory } from "./sourceMenu";
import type { SourceDef } from "./types";

interface WebLinksSourceMenuProps {
  /** Every selectable source: the fixed sites plus the reader's own links. */
  sources: SourceDef[];
  activeSourceKey: string;
  /** Resolved definition of the active source, used for the trigger. */
  activeSourceDef: SourceDef;
  onSelectSource: (key: string) => void;
  /** Opens the link hub (the old landing surface). */
  onOpenHub: () => void;
  /**
   * Told whenever the popover opens or closes so the native webview can hide
   * behind it — a Tauri child webview always paints above the DOM.
   */
  onMenuOpenChange?: (open: boolean) => void;
}

const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

/**
 * The Web Links source picker.
 *
 * One dropdown replaces the old scrollable tab strip: sources are grouped under
 * their category headers, searchable across every group, and the reader's own
 * links sit alongside the built-in sites instead of behind a separate filter.
 */
export default function WebLinksSourceMenu({
  sources,
  activeSourceKey,
  activeSourceDef,
  onSelectSource,
  onOpenHub,
  onMenuOpenChange,
}: WebLinksSourceMenuProps) {
  const { t } = useLanguage();
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const setMenuOpen = useCallback(
    (next: boolean, restoreFocus = false) => {
      setOpen(next);
      onMenuOpenChange?.(next);
      if (next) return;
      setQuery("");
      if (restoreFocus) triggerRef.current?.focus();
    },
    [onMenuOpenChange],
  );

  // Outside click and Escape close the popover; Escape hands focus back to the
  // trigger so keyboard readers are not dropped at the top of the page.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false, true);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setMenuOpen]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const groups = useMemo(
    () => groupSourcesByCategory(sources, query),
    [sources, query],
  );
  const hasMyLinksGroup = groups.some((group) => group.key === "mylinks");

  const select = (key: string) => {
    setMenuOpen(false);
    onSelectSource(key);
  };

  const onPopoverKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!NAV_KEYS.has(event.key)) return;
    const items = Array.from(
      popoverRef.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"], [role="menuitemradio"]',
      ) ?? [],
    );
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (current === -1) next = event.key === "ArrowDown" ? 0 : items.length - 1;
    else
      next =
        (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
        items.length;
    items[next]?.focus();
  };

  const renderItem = (source: SourceDef) => {
    const isActive = source.key === activeSourceKey;
    return (
      <button
        key={source.key}
        type="button"
        role="menuitemradio"
        aria-checked={isActive}
        className={`wl-source-menu-item${isActive ? " active" : ""}`}
        onClick={() => select(source.key)}
      >
        <span
          className="wl-source-menu-item-icon"
          aria-hidden="true"
          style={{ background: source.iconBg, color: source.accent }}
        >
          {source.icon}
        </span>
        <span className="wl-source-menu-item-label">{source.label}</span>
        {isActive && (
          <Check
            size={14}
            className="wl-source-menu-item-check"
            aria-hidden="true"
          />
        )}
      </button>
    );
  };

  const manageItem = (
    <button
      key="manage"
      type="button"
      role="menuitem"
      className={`wl-source-menu-item wl-source-menu-item--manage${
        activeSourceKey === MY_LINKS_KEY ? " active" : ""
      }`}
      onClick={() => select(MY_LINKS_KEY)}
    >
      <span
        className="wl-source-menu-item-icon wl-source-menu-item-icon--manage"
        aria-hidden="true"
      >
        <Settings2 size={14} />
      </span>
      <span className="wl-source-menu-item-label">{t("weblinks.hub.manage")}</span>
    </button>
  );

  return (
    <div ref={containerRef} className="wl-source-menu">
      <button
        ref={triggerRef}
        type="button"
        className={`wl-source-menu-trigger${open ? " open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={t("weblinks.menu.switchSource")}
        onClick={() => setMenuOpen(!open)}
      >
        <span
          className="wl-source-menu-trigger-icon"
          aria-hidden="true"
          style={{
            background: activeSourceDef.iconBg,
            color: activeSourceDef.accent,
          }}
        >
          {activeSourceDef.icon}
        </span>
        <span className="wl-source-menu-trigger-label">
          {activeSourceDef.label}
        </span>
        <span
          className={`wl-source-menu-trigger-chevron${open ? " open" : ""}`}
          aria-hidden="true"
        >
          <ChevronDownIcon />
        </span>
      </button>

      {open && (
        <div
          ref={popoverRef}
          id={menuId}
          className="wl-source-menu-popover"
          role="menu"
          aria-label={t("weblinks.menu.switchSource")}
          onKeyDown={onPopoverKeyDown}
        >
          <div className="wl-source-menu-search">
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("weblinks.hub.searchPlaceholder")}
              aria-label={t("weblinks.hub.searchPlaceholder")}
            />
          </div>

          <div className="wl-source-menu-scroll">
            {groups.map((group) => (
              <div
                key={group.key}
                role="group"
                aria-label={t(group.i18nKey)}
                className="wl-source-menu-group"
              >
                <div className="wl-source-menu-group-head" aria-hidden="true">
                  {t(group.i18nKey)}
                </div>
                {group.sources.map(renderItem)}
                {group.key === "mylinks" && manageItem}
              </div>
            ))}

            {groups.length === 0 && (
              <p className="wl-source-menu-empty">{t("weblinks.hub.noResults")}</p>
            )}

            {!hasMyLinksGroup && (
              <div
                role="group"
                aria-label={t("weblinks.categories.mylinks")}
                className="wl-source-menu-group"
              >
                <div className="wl-source-menu-group-head" aria-hidden="true">
                  {t("weblinks.categories.mylinks")}
                </div>
                {manageItem}
              </div>
            )}
          </div>

          <div className="wl-source-menu-footer">
            <button
              type="button"
              role="menuitem"
              className="wl-source-menu-footer-btn"
              onClick={() => {
                setMenuOpen(false);
                onOpenHub();
              }}
            >
              <LayoutGrid size={14} aria-hidden="true" />
              <span>{t("weblinks.menu.browseAll")}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
