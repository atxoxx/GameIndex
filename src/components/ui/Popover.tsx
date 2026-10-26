import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

export interface PopoverTriggerProps {
  ref: RefObject<HTMLButtonElement | null>;
  onClick: () => void;
  "aria-expanded": boolean;
  "aria-haspopup": "menu" | "dialog";
  "aria-controls": string;
}

export interface PopoverProps {
  /** Accessible name for the surface. */
  label: string;
  trigger: (props: PopoverTriggerProps) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Which edge of the trigger the panel aligns to. */
  align?: "start" | "end";
  /** Preferred panel width in pixels; clamped to the viewport. */
  width?: number;
  role?: "menu" | "dialog";
  /** Extra class on the panel. */
  className?: string;
  /** Focus the first control when the panel opens. */
  autoFocus?: boolean;
}

const VIEWPORT_GAP = 8;
const TRIGGER_GAP = 6;
const PANEL_MAX_HEIGHT = 520;

/**
 * Popover — the app's anchored overlay for menus, filters and editors.
 *
 * The panel is portaled to the body with fixed positioning so it escapes
 * scroll containers and never clips behind a sticky tab strip. It flips above
 * the trigger when there is no room below, closes on an outside click or
 * Escape, and returns focus to the trigger on close.
 */
export function Popover({
  label,
  trigger,
  children,
  align = "start",
  width = 240,
  role = "menu",
  className,
  autoFocus = true,
}: PopoverProps) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const close = useCallback(() => setOpen(false), []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const anchor = triggerRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const panel = panelRef.current;
    const naturalHeight = panel?.offsetHeight ?? 0;
    const panelWidth = Math.min(width, window.innerWidth - VIEWPORT_GAP * 2);
    const left =
      align === "end"
        ? Math.max(VIEWPORT_GAP, rect.right - panelWidth)
        : Math.min(rect.left, window.innerWidth - panelWidth - VIEWPORT_GAP);
    const spaceBelow = window.innerHeight - rect.bottom - TRIGGER_GAP - VIEWPORT_GAP;
    const spaceAbove = rect.top - TRIGGER_GAP - VIEWPORT_GAP;
    const openUp = naturalHeight > spaceBelow && spaceAbove > spaceBelow;
    const top = openUp
      ? Math.max(VIEWPORT_GAP, rect.top - TRIGGER_GAP - Math.min(naturalHeight, spaceAbove, PANEL_MAX_HEIGHT))
      : rect.bottom + TRIGGER_GAP;
    setPos({ top, left, width: panelWidth });
  }, [open, align, width]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !autoFocus) return;
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, autoFocus]);

  const triggerProps = {
    ref: triggerRef,
    onClick: () => setOpen((value) => !value),
    "aria-expanded": open,
    "aria-haspopup": role,
    "aria-controls": id,
  } satisfies PopoverTriggerProps;

  return (
    <>
      {trigger(triggerProps)}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={id}
            role={role}
            aria-label={label}
            className={["ui-popover__panel", className ?? ""].filter(Boolean).join(" ")}
            style={
              pos
                ? { top: pos.top, left: pos.left, width: pos.width }
                : { visibility: "hidden", top: 0, left: 0, width }
            }
          >
            {typeof children === "function" ? children(close) : children}
          </div>,
          document.body,
        )}
    </>
  );
}

export default Popover;
