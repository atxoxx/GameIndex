import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface WebviewNavState {
  back: boolean;
  forward: boolean;
}

/**
 * Track back/forward availability for an embedded child webview. Tauri's JS
 * `Webview` API has no canGoBack/canGoForward, so we poll the live URL and
 * mirror it against a local history stack — the same approach the WebLinks
 * preview uses.
 */
export function useEmbeddedWebviewNav(
  label: string | null,
  initialUrl: string,
  enabled = true
) {
  const [navState, setNavState] = useState<WebviewNavState>({ back: false, forward: false });
  const historyRef = useRef<string[]>(initialUrl ? [initialUrl] : []);
  const indexRef = useRef(0);

  useEffect(() => {
    historyRef.current = initialUrl ? [initialUrl] : [];
    indexRef.current = 0;
    setNavState({ back: false, forward: false });
  }, [initialUrl, label]);

  useEffect(() => {
    if (!label || !enabled) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const current = await invoke<string>("webview_current_url", { label });
        if (cancelled || !current || current.startsWith("about:blank")) return;

        const history = historyRef.current;
        if (history[indexRef.current] === current) return;

        const known = history.indexOf(current);
        if (known !== -1) {
          indexRef.current = known;
        } else {
          const truncated = history.slice(0, indexRef.current + 1);
          truncated.push(current);
          historyRef.current = truncated;
          indexRef.current = truncated.length - 1;
        }

        setNavState({
          back: indexRef.current > 0,
          forward: indexRef.current < historyRef.current.length - 1,
        });
      } catch {
        // webview closed or mid-navigation
      }
    };

    const timer = setInterval(poll, 700);
    poll();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [label, enabled]);

  const goBack = useCallback(() => {
    if (!label) return;
    invoke("webview_history_navigate", { label, direction: "back" }).catch(() => {});
  }, [label]);

  const goForward = useCallback(() => {
    if (!label) return;
    invoke("webview_history_navigate", { label, direction: "forward" }).catch(() => {});
  }, [label]);

  return { navState, goBack, goForward };
}

/** Re-run the consent-banner dismissal inside an embedded webview. */
export function dismissWebviewConsent(label: string | null) {
  if (!label) return;
  invoke("webview_dismiss_consent", { label }).catch(() => {});
}
