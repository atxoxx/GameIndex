import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../../context/LanguageContext";
import type { SidebarImportDropdownProps } from "./types";

/**
 * SidebarImportDropdown
 * ─────────────────────
 * Portaled dropdown menu anchored to the import button (or empty-state CTA).
 * Exposes options to import a single game executable or scan a folder.
 */
export default function SidebarImportDropdown({
  anchorEl,
  onClose,
  onImportExe,
  onImportFolder,
}: SidebarImportDropdownProps) {
  const { t } = useLanguage();
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on Escape or click outside
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!anchorEl) return null;

  const rect = anchorEl.getBoundingClientRect();
  const menuStyle: React.CSSProperties = {
    position: "fixed",
    top: rect.bottom + 6,
    left: Math.max(8, Math.min(rect.left, window.innerWidth - 248)),
    width: 240,
    zIndex: 10000,
  };

  return createPortal(
    <div
      ref={menuRef}
      className="sidebar-import-menu"
      data-sidebar-context-menu="true"
      style={menuStyle}
      onMouseDown={(e) => e.stopPropagation()}
      role="menu"
      aria-label={t("sidebar.importGamesTitle")}
    >
      <button
        type="button"
        className="sidebar-import-option"
        onClick={onImportExe}
        role="menuitem"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="12" y1="18" x2="12" y2="12" />
          <line x1="9" y1="15" x2="15" y2="15" />
        </svg>
        <div className="sidebar-import-option-text">
          <span className="sidebar-import-option-title">
            {t("sidebar.importGameExe")}
          </span>
          <span className="sidebar-import-option-desc">
            {t("sidebar.importExeDesc")}
          </span>
        </div>
      </button>

      <button
        type="button"
        className="sidebar-import-option"
        onClick={onImportFolder}
        role="menuitem"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          <line x1="12" y1="11" x2="12" y2="17" />
          <line x1="9" y1="14" x2="15" y2="14" />
        </svg>
        <div className="sidebar-import-option-text">
          <span className="sidebar-import-option-title">
            {t("sidebar.importFolder")}
          </span>
          <span className="sidebar-import-option-desc">
            {t("sidebar.importFolderDesc")}
          </span>
        </div>
      </button>
    </div>,
    document.body
  );
}
