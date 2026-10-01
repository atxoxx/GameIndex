// Frontend crash reporting.
//
// Release builds strip `console.*` (see vite.config.ts) and the webview has
// no console, so an uncaught JS error, an unhandled promise rejection, or a
// React render throw leaves no trace once shipped. This module forwards
// those to the Rust crash log via the `crashlog_record` command, and pushes
// lightweight breadcrumbs (route changes) via `crashlog_breadcrumb` so a
// later native crash — which no JS handler can observe — still records where
// the user was.
//
// Everything here is best-effort: reporting must never throw into the app.

import { invoke } from "@tauri-apps/api/core";

function tauriAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

function safeInvoke(command: string, args?: Record<string, unknown>): void {
  if (!tauriAvailable()) return;
  try {
    void invoke(command, args).catch(() => {
      /* the crash reporter itself must stay silent on failure */
    });
  } catch {
    /* invoke unavailable (frontend-only dev build) — ignore */
  }
}

/** Where the user was when the error fired — attached to every report. */
export function describeContext(): string {
  const url = typeof window !== "undefined" ? window.location.href : "unknown";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "unknown";
  return `url: ${url}\nuserAgent: ${ua}`;
}

/** Drop a breadcrumb into the Rust-side ring buffer. */
export function recordBreadcrumb(area: string, message: string): void {
  safeInvoke("crashlog_breadcrumb", { area, message });
}

export interface FrontendCrashInput {
  kind?: string;
  message: string;
  stack?: string | null;
  componentStack?: string | null;
  extra?: string | null;
}

/** Persist a frontend error to the crash log and a dated report. */
export function recordFrontendCrash(input: FrontendCrashInput): void {
  safeInvoke("crashlog_record", {
    kind: input.kind ?? "frontend-error",
    message: input.message,
    stack: input.stack ?? null,
    componentStack: input.componentStack ?? null,
    extra: input.extra ?? describeContext(),
  });
}

let installed = false;

/**
 * Install global handlers for uncaught errors and unhandled rejections.
 * Idempotent; safe to call from `main.tsx` before the app renders.
 */
export function installCrashReporter(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    const errorEvent = event as ErrorEvent;
    const error = errorEvent.error as Error | undefined;
    // Resource-load failures surface here too, with an empty message and no
    // Error object; fall back to the target so they aren't dropped.
    const message =
      errorEvent.message ||
      error?.message ||
      (errorEvent.target ? `failed to load ${String((errorEvent.target as { src?: string }).src ?? "")}` : "unknown error");
    recordFrontendCrash({
      kind: "window-error",
      message,
      stack: error?.stack ?? null,
      extra: describeContext(),
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    const error = reason instanceof Error ? reason : undefined;
    recordFrontendCrash({
      kind: "unhandled-rejection",
      message: error?.message ?? String(reason),
      stack: error?.stack ?? null,
      extra: describeContext(),
    });
  });
}

/** Test seam: reset the one-shot install guard. */
export function resetCrashReporterForTests(): void {
  installed = false;
}
