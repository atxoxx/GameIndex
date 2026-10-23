import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../../context/LanguageContext";
import SidebarViewOptionsPanel from "./SidebarViewOptionsPanel";
import type { SidebarOverflowMenuProps } from "./types";

/**
 * SidebarOverflowMenu
 * ───────────────────
 * The rail's "…" panel: import actions, the random roll, and — expanded inline
 * — the grouping / sorting / density controls.
 *
 * View options used to open a second floating panel anchored to the same
 * button, which could silently show nothing when the anchor or the open state
 * was stale. Inline, the click just reveals the controls in place.
 */
export default function SidebarOverflowMenu({
  anchorEl,
  onClose,
  onImportExe,
  onImportFolder,
  onRandomGame,
  viewOptions,
}: SidebarOverflowMenuProps) {
  const { t } = useLanguage();
  const menuRef = useRef<HTMLDivElement>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (menuRef.current?.contains(target ?? null)) return;
      if (anchorEl?.contains(target ?? null)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [anchorEl, onClose]);

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el || !anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const width = 272;
    const height = el.offsetHeight;
    const left = Math.min(
      Math.max(8, rect.right - width),
      Math.max(8, window.innerWidth - width - 8),
    );
    const top = Math.min(
      rect.bottom + 6,
      Math.max(8, window.innerHeight - height - 8),
    );
    setPosition({ top, left });
  }, [anchorEl]);

  if (!anchorEl) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="sbn-menu"
      role="menu"
      aria-label={t("sidebar.menuTitle")}
      data-sidebar-context-menu="true"
      style={{
        position: "fixed",
        top: position?.top ?? anchorEl.getBoundingClientRect().bottom + 6,
        left: position?.left ?? 8,
        width: 272,
        visibility: position ? "visible" : "hidden",
        zIndex: "var(--z-popover)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="sbn-menu__section">
        <span className="sbn-menu__label">{t("lib.hero.importGames")}</span>
        <button
          type="button"
          className="sbn-menu__item"
          role="menuitem"
          onClick={() => {
            onClose();
            onImportExe();
          }}
        >
          <span className="sbn-menu__icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
          </span>
          <span className="sbn-menu__text">
            <span className="sbn-menu__title">{t("sidebar.importGameExe")}</span>
            <span className="sbn-menu__desc">{t("sidebar.importExeDesc")}</span>
          </span>
        </button>
        <button
          type="button"
          className="sbn-menu__item"
          role="menuitem"
          onClick={() => {
            onClose();
            onImportFolder();
          }}
        >
          <span className="sbn-menu__icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              <line x1="12" y1="11" x2="12" y2="17" />
              <line x1="9" y1="14" x2="15" y2="14" />
            </svg>
          </span>
          <span className="sbn-menu__text">
            <span className="sbn-menu__title">{t("sidebar.importFolder")}</span>
            <span className="sbn-menu__desc">{t("sidebar.importFolderDesc")}</span>
          </span>
        </button>
      </div>

      <div className="sbn-menu__divider" aria-hidden />

      <div className="sbn-menu__section">
        <button
          type="button"
          className="sbn-menu__item sbn-menu__item--row"
          role="menuitem"
          onClick={() => {
            onClose();
            onRandomGame();
          }}
        >
          <span className="sbn-menu__icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
              <path d="M16 8h.01" />
              <path d="M8 8h.01" />
              <path d="M8 16h.01" />
              <path d="M16 16h.01" />
              <path d="M12 12h.01" />
            </svg>
          </span>
          <span className="sbn-menu__text">
            <span className="sbn-menu__title">{t("sidebar.randomGame")}</span>
          </span>
        </button>

        <button
          type="button"
          className={`sbn-menu__item sbn-menu__item--row${viewOpen ? " is-open" : ""}`}
          aria-expanded={viewOpen}
          onClick={() => setViewOpen((v) => !v)}
        >
          <span className="sbn-menu__icon" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="14" y2="12" />
              <line x1="4" y1="18" x2="18" y2="18" />
            </svg>
          </span>
          <span className="sbn-menu__text">
            <span className="sbn-menu__title">{t("sidebar.viewOptionsTitle")}</span>
          </span>
          <svg className="sbn-menu__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        {viewOpen && (
          <div className="sbn-menu__view">
            <SidebarViewOptionsPanel
              groupBy={viewOptions.groupBy}
              onGroupByChange={viewOptions.onGroupByChange}
              sort={viewOptions.sort}
              onSortChange={viewOptions.onSortChange}
              sortDirection={viewOptions.sortDirection}
              onToggleSortDirection={viewOptions.onToggleSortDirection}
              density={viewOptions.density}
              onDensityChange={viewOptions.onDensityChange}
              viewOptions={viewOptions.options}
              onToggleOption={viewOptions.onToggleOption}
              onExpandAllGroups={viewOptions.onExpandAllGroups}
              onCollapseAllGroups={viewOptions.onCollapseAllGroups}
              hasGroups={viewOptions.hasGroups}
            />
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
