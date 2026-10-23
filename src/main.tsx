import React from "react";
import ReactDOM from "react-dom/client";
import { markBootStart } from "./utils/bootPerf";
import {
  installCrashReporter,
  recordBreadcrumb,
  recordFrontendCrash,
} from "./utils/crashReporter";
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
import "./styles/download-modal.css";

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

// Install global JS error/unhandled-rejection handlers before anything else
// renders, then leave a boot breadcrumb. Best-effort no-ops in a
// frontend-only dev build.
installCrashReporter();
recordBreadcrumb("app", "frontend boot");

const root = document.getElementById("root") as HTMLElement;

/** Window discriminators set on the Tauri URL by the Rust window builder. */
const LAUNCH_SPLASH_PARAM = "launch-splash";
const OVERLAY_PARAM = "overlay";
const GAME_DETAIL_PARAM = "detail";

async function bootstrap() {
  const windowParam = new URLSearchParams(window.location.search).get("window");

  // The standalone launch splash lives in its own `launch-splash` webview.
  // Boot only the splash entry there — skipping the App chunk keeps the
  // window's first paint (and therefore the reveal) fast.
  if (windowParam === LAUNCH_SPLASH_PARAM) {
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

  // The in-game overlay is its own transparent webview. It mounts a reduced
  // provider tree, so never pull the full App chunk into the overlay window.
  if (windowParam === OVERLAY_PARAM) {
    const { default: OverlayWindow } = await import(
      "./components/OverlayWindow"
    );
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <BootstrapErrorBoundary>
          <OverlayWindow />
        </BootstrapErrorBoundary>
      </React.StrictMode>,
    );
    return;
  }

  // The game-detail popout is its own reusable webview. It mounts the detail
  // pages without the shell bridges, so never pull the full App chunk there.
  if (windowParam === GAME_DETAIL_PARAM) {
    const { default: GameDetailWindow } = await import(
      "./components/GameDetailWindow"
    );
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <BootstrapErrorBoundary>
          <GameDetailWindow />
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
  const message =
    err instanceof Error ? err : new Error(String(err));
  recordFrontendCrash({
    kind: "bootstrap",
    message: message.message,
    stack: message.stack ?? null,
  });
  const rootEl = document.getElementById("root") as HTMLElement;
  ReactDOM.createRoot(rootEl).render(
    <BootstrapErrorPanel error={message} />,
  );
});
