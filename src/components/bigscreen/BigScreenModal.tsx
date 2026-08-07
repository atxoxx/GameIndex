// BigScreenModal — shared console modal primitive for Big Screen Mode.
//
// Unlike the desktop ConfirmModal (`.modal` / `.modal-backdrop` classes,
// designed for mouse-first dialogs), this surface follows the bigscreen
// overlay conventions already used by BigScreenNewsReader:
//
//   • Renders into `document.body` via a React Portal so ancestor
//     overflow clipping can never hide it.
//   • Reuses the existing `.bigscreen-overlay-drawer` + 
//     `.bigscreen-overlay-drawer-panel` / -header / -content classes
//     with centering overrides (justify-content/align-items) applied
//     inline, exactly like the News reader modal.
//   • `role="dialog"` + `data-bigscreen-overlay="true"` — the gamepad
//     engine's B-button flow checks `isBigScreenOverlayOpen()` and
//     dispatches Escape when an overlay is mounted, which the Escape
//     keydown listener below turns into `onClose()`.
//   • Backdrop mousedown closes; the panel stops propagation so clicks
//     inside the dialog don't leak.
//   • The close (X) button is registered with the spatial-nav registry
//     via `useFocusable`, so controller D-pad users can reach it too.
//     Action buttons in `footer` / `children` are provided by callers,
//     who spread `useFocusable(...)` onto them (same pattern as the
//     News reader's footer).

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFocusable } from "../../hooks/useFocusable";
import { useLanguage } from "../../context/LanguageContext";

export interface BigScreenModalProps {
  /** Open state. When false the portal renders `null`. */
  open: boolean;
  /** Headline shown in the modal header (usually the item name). */
  title: ReactNode;
  /** Called on Escape / B, backdrop click, or the close button. */
  onClose: () => void;
  /** Scrollable body content (details, stats, confirm copy…). */
  children?: ReactNode;
  /** Right-aligned action row (callers build focusable buttons). */
  footer?: ReactNode;
  /** Panel width override (defaults to a centered 560px dialog). */
  width?: string;
  /** Panel max-height override (defaults to 80% of the viewport). */
  maxHeight?: string;
}

export default function BigScreenModal({
  open,
  title,
  onClose,
  children,
  footer,
  width = "560px",
  maxHeight = "80%",
}: BigScreenModalProps) {
  const { t } = useLanguage();
  // Focusable close button — registered with the spatial-nav registry so
  // the D-pad can land on it and A activates it.
  const closeProps = useFocusable(onClose);

  // Escape closes. This fires for BOTH a physical keyboard Escape and the
  // gamepad B button (the engine dispatches a synthetic Escape keydown
  // when a `data-bigscreen-overlay` is mounted). Listen on `document` so
  // the engine's `document.dispatchEvent` reaches us.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="bigscreen-overlay-drawer bigscreen-overlay-drawer--modal"
      data-bigscreen-overlay="true"
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : undefined}
      onMouseDown={onClose}
    >
      <div
        className="bigscreen-overlay-drawer-panel bigscreen-overlay-drawer-panel--modal"
        style={{
          width,
          maxHeight,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="bigscreen-overlay-drawer-header">
          <h3>{title}</h3>
          <button
            type="button"
            className="bigscreen-overlay-drawer-close"
            aria-label={t("common.close")}
            {...closeProps}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              width="18"
              height="18"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {children && <div className="bigscreen-overlay-drawer-content">{children}</div>}

        {footer && <div className="bigscreen-modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
