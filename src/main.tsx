import React from "react";
import ReactDOM from "react-dom/client";
import { markBootStart } from "./utils/bootPerf";
import {
  BootstrapErrorBoundary,
  BootstrapErrorPanel,
} from "./components/BootstrapErrorBoundary";
import "./index.css";
import "./styles/animations.css";
import "./styles/ui.css";
// Shared feature stylesheets: loaded globally because the components they
// style (DownloadModal/DownloadButton, store cards + density toggle, ...)
// render on many routes, not just the pages that used to import them.
import "./styles/store-discover.css";
import "./styles/store-polish.css";
import "./styles/download.css";

// The friends page resolves its Nostr signing key lazily via `getNostrKeys`,
// which falls back to a session-stable placeholder when the backend key
// isn't loaded yet. So hydration can run in the background instead of
// blocking the first render — a slow kv_store read must never delay the
// app shell from painting.
//
// friendsStorage is imported dynamically (not statically) so the
// nostr-tools stack (~190 KB) never lands in the startup bundle: it is
// split into its own async chunk that only loads in the background after
// bootstrap, and on the rare occasion the user opens the Friends page
// before it has landed, `getNostrKeys` degrades to the session fallback.
markBootStart();

const root = document.getElementById("root") as HTMLElement;

/** Window discriminator set on the Tauri URL by the Rust window builder. */
const LAUNCH_SPLASH_PARAM = "launch-splash";

async function bootstrap() {
  // The standalone launch splash lives in its own `launch-splash` webview.
  // Boot only the splash entry there — skipping the App chunk keeps the
  // window's first paint (and therefore the reveal) fast.
  if (
    new URLSearchParams(window.location.search).get("window") ===
    LAUNCH_SPLASH_PARAM
  ) {
    const { default: LaunchSplashWindow } = await import(
      "./components/LaunchSplashWindow"
    );
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <BootstrapErrorBoundary>
          <LaunchSplashWindow />
        </BootstrapErrorBoundary>
      </React.StrictMode>,
    );
    return;
  }

  // Fire-and-forget: hydrate the Nostr key cache when reachable, but never
  // gate first paint on it. Any failure is non-fatal and flows through the
  // legacy/placeholder fallback path.
  void import("./pages/friendsStorage")
    .then((m) => m.initNostrKeys())
    .catch(() => {});
  const { default: App } = await import("./App");
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <BootstrapErrorBoundary>
        <App />
      </BootstrapErrorBoundary>
    </React.StrictMode>,
  );
}

void bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[bootstrap] Failed to load the app chunk:", err);
  const rootEl = document.getElementById("root") as HTMLElement;
  const message =
    err instanceof Error ? err : new Error(String(err));
  ReactDOM.createRoot(rootEl).render(
    <BootstrapErrorPanel error={message} />,
  );
});
