import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export interface DetailDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Small label above the title. */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Optional line under the title. */
  description?: ReactNode;
  /** Badges or metadata rendered under the title. */
  badges?: ReactNode;
  /** Header actions, placed before the close button. */
  actions?: ReactNode;
  /** Sticky footer. */
  footer?: ReactNode;
  /** Optional media area above the header (wide art, cover, ...). */
  media?: ReactNode;
  children: ReactNode;
  className?: string;
  closeLabel?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * DetailDrawer — a right-hand slide-over for inspecting one item without
 * losing the workspace behind it.
 *
 * The drawer owns the interaction contract every detail surface should share:
 * it renders nothing while closed, locks page scroll, traps Tab, closes on
 * Escape or backdrop click, and returns focus to the element that opened it.
 * Callers only worry about content.
 */
export function DetailDrawer({
  open,
  onClose,
  eyebrow,
  title,
  description,
  badges,
  actions,
  footer,
  media,
  children,
  className,
  closeLabel = "Close",
}: DetailDrawerProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Remember the opener and restore focus when the drawer leaves.
  useEffect(() => {
    if (open) {
      triggerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return;
    }
    const trigger = triggerRef.current;
    triggerRef.current = null;
    trigger?.focus();
  }, [open]);

  // Move focus into the panel once it has painted.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => closeRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Escape + Tab containment.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => node.offsetParent !== null || node === document.activeElement,
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  // The app shell scrolls on `.app-main`; lock the body as well for the
  // game-detail popout where the body itself is the scroll container.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="ui-drawer"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={panelRef}
        className={[
          "ui-drawer__panel",
          media ? "ui-drawer__panel--media" : "",
          className ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {media && <div className="ui-drawer__media">{media}</div>}

        <header className="ui-drawer__head">
          <div className="ui-drawer__titles">
            {eyebrow && <span className="ui-drawer__eyebrow">{eyebrow}</span>}
            <h2 className="ui-drawer__title" id={titleId}>
              {title}
            </h2>
            {description && <p className="ui-drawer__description">{description}</p>}
            {badges && <div className="ui-drawer__badges">{badges}</div>}
          </div>
          <div className="ui-drawer__actions">
            {actions}
            <button
              ref={closeRef}
              type="button"
              className="ui-drawer__close"
              onClick={onClose}
              title={closeLabel}
              aria-label={closeLabel}
            >
              <X size={17} />
            </button>
          </div>
        </header>

        <div className="ui-drawer__body">{children}</div>

        {footer && <footer className="ui-drawer__footer">{footer}</footer>}
      </aside>
    </div>,
    document.body,
  );
}

export default DetailDrawer;
