import { memo, useCallback, useEffect, useRef } from "react";
import { useSidebarCollapse } from "../../context/SidebarCollapseContext";
import { useLanguage } from "../../context/LanguageContext";

/**
 * SidebarResizeHandle
 * ───────────────────
 * Interactive grab handle positioned on the right border of the sidebar.
 * Features:
 *   • Real-time drag resizing with document mouse event listeners.
 *   • Visual drag indicator with active glow.
 *   • Double-click to reset width to standard default (280px).
 *   • Touch & mouse friendly with accessible tooltip.
 */
function SidebarResizeHandleBase() {
  const { isIconRail, setSidebarWidth, resetSidebarWidth, isResizing, setIsResizing } =
    useSidebarCollapse();
  const { t } = useLanguage();
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (isIconRail || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const sidebarEl = (e.currentTarget as HTMLElement).closest(".sidebar") as HTMLElement | null;
      const currentWidth = sidebarEl?.offsetWidth || 280;

      startXRef.current = e.clientX;
      startWidthRef.current = currentWidth;
      setIsResizing(true);
    },
    [isIconRail, setIsResizing]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resetSidebarWidth();
    },
    [resetSidebarWidth]
  );

  useEffect(() => {
    if (!isResizing) return;

    function handleMouseMove(e: MouseEvent) {
      const deltaX = e.clientX - startXRef.current;
      const newWidth = startWidthRef.current + deltaX;
      setSidebarWidth(newWidth);
    }

    function handleMouseUp() {
      setIsResizing(false);
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth, setIsResizing]);

  if (isIconRail) return null;

  return (
    <div
      className={`sidebar-resize-handle${isResizing ? " is-resizing" : ""}`}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      title={t("sidebar.resizeHandleTooltip")}
      role="separator"
      aria-orientation="vertical"
      aria-label={t("sidebar.resizeHandleAria")}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          const current = parseInt(
            getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width") || "280",
            10
          );
          setSidebarWidth(current - 16);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          const current = parseInt(
            getComputedStyle(document.documentElement).getPropertyValue("--sidebar-width") || "280",
            10
          );
          setSidebarWidth(current + 16);
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          resetSidebarWidth();
        }
      }}
    >
      <div className="sidebar-resize-handle__bar" />
    </div>
  );
}

export const SidebarResizeHandle = memo(SidebarResizeHandleBase);
export default SidebarResizeHandle;
