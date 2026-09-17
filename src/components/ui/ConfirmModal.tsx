// Reusable destructive-action confirmation modal.
//
// Destructive actions in the app (currently: "delete download from
// disk", "unlink Steam", "delete session") need a confirmation step
// before they run — the action is irreversible and the user should see
// *what* they're about to lose (name, size, save path) before they
// click. We render via a React Portal (`document.body`) so callers that
// have CSS `overflow: hidden` (the top-nav Downloads popover) don't clip
// the overlay.
//
// The modal is visually small but rich: bold title, descriptive body
// children, optional inline warning (for the auto-extract case where
// only archives are deleted, not the installed game), and a
// two-button footer (Cancel / Confirm). Cancel is the default —
// focused on mount, closes on Escape, or backdrop click.
//
// Controller support
// ──────────────────
// Both footer buttons register with the Big Screen focus registry, so
// the D-pad can reach them and A activates the focused one. Focus starts
// on Cancel (NOT Confirm) for the same reason it does with a mouse: an
// irreversible action must be a deliberate second press, never a
// muscle-memory A-press that lands on the destructive button. The
// footer is also a spatial rail, so Left/Right cycles Cancel ↔ Confirm
// with edge wrapping. On desktop none of this changes anything — the
// registry is inert while Big Screen Mode is off, and the native focus
// + Tab order still work.
//
// We deliberately do NOT use the native `window.confirm()`: native
// confirms are thread-blocking, visually jarring, and don't allow
// bold typography for the torrent name. A custom modal lets the
// confirmation read as part of the same design language as the rest
// of the app.

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { useLanguage } from "../../context/LanguageContext";
import { useFocusable } from "../../hooks/useFocusable";

export interface ConfirmModalProps {
  /** Open state. When false, the portal renders `null`. */
  open: boolean;
  /** Bold headline (e.g. "Delete Game Name from disk?"). */
  title: ReactNode;
  /** Supporting paragraph(s). Optional. Rendered under the title. */
  message?: ReactNode;
  /**
   * Optional inline warning block (e.g. for the auto-extract case
   * where the deletion only wipes archives and leaves the installed
   * game untouched). Rendered with a yellow accent so it reads as
   * a warning, not a regular paragraph.
   */
  warning?: ReactNode;
  /** Label of the destructive action button. Defaults to "Delete". */
  confirmLabel?: ReactNode;
  /** Label of the cancel button. Defaults to "Cancel". */
  cancelLabel?: ReactNode;
  /** Disable both buttons while async work is in flight. */
  busy?: boolean;
  /** Called when the user confirms. Should resolve any pending work. */
  onConfirm: () => void;
  /** Called on cancel/backdrop/Escape. */
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  message,
  warning,
  confirmLabel = "common.delete",
  cancelLabel = "common.cancel",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const { t } = useLanguage();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const label = (l: ReactNode) => (typeof l === "string" ? t(l) : l);

  // Register both footer actions with the Big Screen focus registry. The
  // refs double as the DOM handles we use for the initial focus below.
  const {
    ref: registerCancel,
    tabIndex: focusTabIndex,
    onClick: activateCancel,
    onKeyDown: cancelKeyDown,
  } = useFocusable(onCancel);
  const {
    ref: registerConfirm,
    onClick: activateConfirm,
    onKeyDown: confirmKeyDown,
  } = useFocusable(onConfirm);

  const setCancelRef = useCallback(
    (el: HTMLButtonElement | null) => {
      cancelRef.current = el;
      registerCancel(el);
    },
    [registerCancel],
  );

  // Focus the Cancel button on open. Putting focus on Cancel
  // (NOT Delete) deliberately protects against activating an
  // irreversible action through muscle memory: the user has to move to
  // Confirm — or click it specifically — to commit. This is also what
  // parks the controller's focus on Cancel, because focusing a
  // registered element syncs the engine's focused ref.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      cancelRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Escape to cancel — except while busy, so an in-flight delete
  // can't be orphaned by a stray key-press. Controller B reaches this
  // too: the engine dispatches a synthetic Escape while a `role`
  // dialog/alertdialog is mounted.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  // Focus trap. The controller's D-pad moves focus by geometry, not by DOM
  // containment, so a stray Up/Down press can land on something behind the
  // backdrop — and A would then activate that instead of the confirmation.
  // Anything that takes focus outside the dialog is pulled back to Cancel.
  // Keyboard Tab between the two buttons stays untouched (both are inside).
  useEffect(() => {
    if (!open) return;
    const onFocusIn = (event: FocusEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const target = event.target as Node | null;
      if (target && dialog.contains(target)) return;
      cancelRef.current?.focus();
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      data-busy={busy ? "true" : undefined}
      onMouseDown={busy ? undefined : onCancel}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="modal confirm-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-body"
      >
        <div className="modal-header">
          <div className="modal-header-icon modal-header-icon--danger">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
          </div>
          <div className="modal-header-text">
            <h2 className="modal-title" id="confirm-modal-title">
              {title}
            </h2>
          </div>
        </div>

        <div className="modal-body confirm-modal-body" id="confirm-modal-body">
          {message}
          {warning && (
            <div className="confirm-modal-warning" role="note">
              {warning}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <span className="modal-footer-count">&nbsp;</span>
          {/* The action row is a rail: Left/Right cycles the two buttons
              with wrapping, so a controller never has to guess which way
              Confirm sits. */}
          <div className="modal-footer-actions" data-rail-id="confirm-modal-actions">
            <Button
              variant="ghost"
              ref={setCancelRef}
              tabIndex={focusTabIndex}
              onClick={activateCancel}
              onKeyDown={cancelKeyDown}
              disabled={busy}
            >
              {label(cancelLabel)}
            </Button>
            <Button
              variant="danger"
              ref={registerConfirm}
              tabIndex={focusTabIndex}
              onClick={activateConfirm}
              onKeyDown={confirmKeyDown}
              isLoading={busy}
            >
              {label(confirmLabel)}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
