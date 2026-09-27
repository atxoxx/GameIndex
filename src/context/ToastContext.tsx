import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { useLanguage } from "./LanguageContext";
import { playNotificationSound } from "../utils/soundEffects";

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
  /** Bumped every time a duplicate re-arms the toast, restarting its countdown. */
  nonce: number;
}

interface ToastContextType {
  showToast: (message: string, type: ToastType) => void;
}

// Persist the React context instance across Vite HMR module re-evaluations so
// lazy-loaded page chunks never lose their Provider instance.
const globalToastObj = globalThis as unknown as {
  __gamelib_toast_context__?: React.Context<ToastContextType | null>;
};
const ToastContext =
  globalToastObj.__gamelib_toast_context__ ??
  (globalToastObj.__gamelib_toast_context__ = createContext<ToastContextType | null>(null));

let nextToastId = 0;

/** How long a toast stays on screen before auto-dismissing (matches toasts.css). */
const TOAST_LIFETIME_MS = 4000;

/** Never stack more than this many toasts — the oldest ones get pushed out. */
const MAX_VISIBLE_TOASTS = 3;

function toastKey(message: string, type: ToastType): string {
  return `${type}::${message}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType) => {
    playNotificationSound();
    const id = nextToastId++;
    setToasts((prev) => {
      const key = toastKey(message, type);
      const existing = prev.find((t) => toastKey(t.message, t.type) === key);
      // A repeat of a toast we already show is a refresh, not a new entry: keep it
      // in place and bump its nonce so the countdown restarts from full.
      const next = existing
        ? prev.map((t) => (t === existing ? { ...t, nonce: id } : t))
        : [...prev, { id, message, type, nonce: id }];
      // Full stack: the oldest toast is pushed out to make room.
      return next.length > MAX_VISIBLE_TOASTS
        ? next.slice(next.length - MAX_VISIBLE_TOASTS)
        : next;
    });
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const contextValue = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

// Shared no-op used when a component is rendered outside the provider
// (isolated component tests, HMR edge cases) so toasts never crash the tree.
const NOOP_TOAST_CONTEXT: ToastContextType = { showToast: () => {} };

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return NOOP_TOAST_CONTEXT;
  }
  return ctx;
}

/* ---- Internal toast rendering ---- */

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  const { t } = useLanguage();
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (isPaused) return;
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_LIFETIME_MS);
    return () => clearTimeout(timer);
  }, [toast.id, toast.nonce, isPaused, onDismiss]);

  const icon =
    toast.type === "success" ? (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    ) : toast.type === "error" ? (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ) : toast.type === "warning" ? (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
           strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ) : (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    );

  return (
    <div
      className={`toast-item toast-${toast.type}`}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <span className="toast-icon">{icon}</span>
      <span className="toast-message">{toast.message}</span>
      <button
        className="toast-close"
        onClick={() => onDismiss(toast.id)}
        aria-label={t("toast.dismiss")}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
      <div className="toast-progress-track" aria-hidden="true">
        <div
          key={toast.nonce}
          className={`toast-progress-bar toast-progress--${toast.type}${isPaused ? " is-paused" : ""}`}
        />
      </div>
    </div>
  );
}

function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
