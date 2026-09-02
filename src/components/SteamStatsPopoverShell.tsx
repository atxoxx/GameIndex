import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "../context/LanguageContext";

interface SteamStatsPopoverShellProps {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
}

const VIEWPORT_MARGIN = 12;
const FALLBACK_WIDTH_PX = 440;

export default function SteamStatsPopoverShell({ anchorRef, onClose, children }: SteamStatsPopoverShellProps) {
  const { t } = useLanguage();
  const popoverRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const [position, setPosition] = useState({ top: VIEWPORT_MARGIN, left: VIEWPORT_MARGIN, growFromLeft: true });

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useLayoutEffect(() => {
    const recompute = () => {
      const anchor = anchorRef.current;
      const popover = popoverRef.current;
      if (!anchor || !popover) return;
      const rect = anchor.getBoundingClientRect();
      const popRect = popover.getBoundingClientRect();
      const width = popRect.width || FALLBACK_WIDTH_PX;
      const right = window.innerWidth - rect.right - VIEWPORT_MARGIN;
      const leftSpace = rect.left - VIEWPORT_MARGIN;
      const growFromLeft = right >= width || right >= leftSpace;
      const left = Math.max(VIEWPORT_MARGIN, Math.min(
        growFromLeft ? rect.right + 6 : rect.left - width - 6,
        window.innerWidth - width - VIEWPORT_MARGIN,
      ));
      const below = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
      const above = rect.top - VIEWPORT_MARGIN;
      const height = popRect.height;
      const top = height <= below ? rect.top : height <= above ? rect.top - height : Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);
      setPosition({ top, left, growFromLeft });
    };
    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    const ro = new ResizeObserver(recompute);
    if (popoverRef.current) ro.observe(popoverRef.current);
    return () => { window.removeEventListener("resize", recompute); window.removeEventListener("scroll", recompute, true); ro.disconnect(); };
  }, [anchorRef]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => popoverRef.current?.querySelector<HTMLElement>(".steam-stats-popover-close")?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); }
      if (event.key !== "Tab" || !popoverRef.current) return;
      const focusable = Array.from(popoverRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], [tabindex]:not([tabindex=\"-1\"])"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!popoverRef.current?.contains(target) && !anchorRef.current?.contains(target)) onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointerDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onPointerDown); previous?.focus(); };
  }, [anchorRef]);

  return createPortal(
    <div ref={popoverRef} className={`steam-stats-popover ${position.growFromLeft ? "from-left" : "from-right"}`} style={{ top: position.top, left: position.left }} role="dialog" aria-modal="true" aria-label={t("steamPlayer.steamStatsTitle")}>
      {children}
    </div>,
    document.body,
  );
}
